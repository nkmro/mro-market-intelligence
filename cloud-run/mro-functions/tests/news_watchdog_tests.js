// node tests/news_watchdog_tests.js — 새벽 시황 뉴스 수집 재발 방지 점검(2026-11-13) 시험. 네트워크·시트·메일 0건.
// apps-script/Code.gs에서 점검 부분(상수 ~ sendNewsWatchdogMail_)과 블랙아웃 판정(isInNewsBlackout_)을 그대로 잘라
// 가짜 PropertiesService·ScriptApp·Utilities·MailApp·시각으로 실행한다(news_blackout_tests.js와 같은 방식).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.join(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');

let passes = 0, failures = 0;
function t(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
  if (cond) passes++; else failures++;
}
function cut(a, b) {
  const s0 = code.indexOf(a), s1 = code.indexOf(b);
  if (s0 < 0 || s1 < 0 || s1 <= s0) throw new Error('Code.gs에서 코드를 못 찾음: ' + a);
  return code.slice(s0, s1);
}
const SRC = cut('var NEWS_BLACKOUT_DOW_', '// 네이버 뉴스검색 API가') + '\n'
  + cut("const NEWS_WATCHDOG_DONE_KEY_ = 'CMN_DONE_DATE';", '// 편집기 시험(재홍님 실행용)')
  + '\nthis.newsWatchdogDecide_ = newsWatchdogDecide_; this.runNewsWatchdog_ = runNewsWatchdog_;';

// 서울 시각 → UTC 밀리초 (월은 1~12)
const KST = function (y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 9, mi || 0); };

// 가짜 환경 하나 = 스크립트 속성·트리거·메일·로그·지금 시각
function makeEnv(settings) {
  const env = { props: {}, triggers: [], mails: [], logs: [], now: 0, seq: 0, settings: Object.assign({ triggerHour: 1, newsBlackoutPeriods: '' }, settings || {}) };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(env.now); }
    static now() { return env.now; }
  }
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const ctx = {
    Date: FakeDate, JSON, Number, String, Object, Array, Math,
    Logger: { log: function (m) { env.logs.push(String(m)); } },
    ADMIN_EMAIL: 'jhjoo@nkmro.com',
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(env.props, k) ? env.props[k] : null; },
      setProperty: function (k, v) { env.props[k] = String(v); },
      deleteProperty: function (k) { delete env.props[k]; } }; } },
    ScriptApp: {
      getProjectTriggers: function () { return env.triggers.map(function (x) { return { getUniqueId: function () { return x.id; }, getHandlerFunction: function () { return x.fn; } }; }); },
      deleteTrigger: function (tr) { env.triggers = env.triggers.filter(function (x) { return x.id !== tr.getUniqueId(); }); },
      newTrigger: function (fn) { const b = { fn: fn }; return { timeBased: function () { return { after: function (ms) { b.after = ms; return { create: function () {
        const id = 'trg' + (++env.seq); env.triggers.push({ id: id, fn: fn, after: b.after, at: env.now }); return { getUniqueId: function () { return id; } }; } }; } }; } };
      }
    },
    Utilities: { formatDate: function (d, tz, fmt) {
      if (tz !== 'Asia/Seoul') throw new Error('tz ' + tz);
      const k = new RealDate(d.getTime() + 9 * 3600 * 1000);
      const Y = k.getUTCFullYear(), M = pad(k.getUTCMonth() + 1), D = pad(k.getUTCDate()), H = k.getUTCHours();
      if (fmt === 'yyyy-MM-dd') return Y + '-' + M + '-' + D;
      if (fmt === 'yyMMdd') return String(Y).slice(2) + M + D;
      if (fmt === 'H') return String(H);
      throw new Error('fmt ' + fmt);
    } },
    MailApp: { sendEmail: function (to, subject, body, opt) { if (env.mailFails) throw new Error('메일 서버 오류'); env.mails.push({ to: to, subject: subject, body: body, opt: opt }); } },
    getSettings_: function () { return env.settings; }
  };
  vm.runInNewContext(SRC, ctx);
  env.decide = ctx.newsWatchdogDecide_;
  env.check = function (ms) { env.now = ms; env.logs = []; ctx.runNewsWatchdog_(); return env; };
  // collectMarketNews가 그 시각에 실행돼 게시까지 끝난 것처럼(실제 함수가 쓰는 키 그대로)
  env.collectDone = function (ms) { env.now = ms; env.props.CMN_START_AT = String(ms); env.props.CMN_DONE_DATE = ctx.Utilities.formatDate(new FakeDate(ms), 'Asia/Seoul', 'yyyy-MM-dd'); };
  env.state = function () { return JSON.parse(env.props.CMN_WATCHDOG || '{}'); };
  env.retryTriggers = function () { return env.triggers.filter(function (x) { return x.fn === 'collectMarketNews' && x.after === 60 * 1000; }); };
  return env;
}

// 기존 트리거(매일 1시 수집·백업 점검)는 점검이 건드리면 안 된다 — 모든 환경에 넣어 두고 끝까지 남아 있는지 본다
function withDaily(env) { env.triggers.push({ id: 'daily', fn: 'collectMarketNews', after: null }, { id: 'backup', fn: 'dailyBackupCheck_', after: null }); return env; }
const dailyKept = function (env) { return env.triggers.some(function (x) { return x.id === 'daily'; }) && env.triggers.some(function (x) { return x.id === 'backup'; }); };

// ── 시나리오 1: 1시 실패(0초, 아무 키도 안 씀) → 2시 점검 → 재시도 → 완료 → 3시 무동작
(function () {
  const e = withDaily(makeEnv());
  e.props.CMN_DONE_DATE = '2026-11-13'; // 어제 완료 기록만 있음
  e.check(KST(2026, 11, 14, 0, 8));
  t('S1-a 0시 8분: 수집시각(1시)+1 전이라 할 일 없음, 트리거 안 만듦', e.retryTriggers().length === 0 && /OUT_OF_WINDOW/.test(e.logs.join()), e.logs);
  e.check(KST(2026, 11, 14, 1, 8));
  t('S1-b 1시 8분: 아직 시간 전', e.retryTriggers().length === 0 && /OUT_OF_WINDOW/.test(e.logs.join()));
  e.check(KST(2026, 11, 14, 2, 8));
  t('S1-c 2시 8분: 완료 기록 없음 → 1분 뒤 collectMarketNews 예약 1개, 횟수 1, 트리거 ID 저장', e.retryTriggers().length === 1 && e.state().count === 1 && e.state().triggerId === e.retryTriggers()[0].id && e.state().date === '2026-11-14', e.state());
  e.collectDone(KST(2026, 11, 14, 2, 9));
  e.check(KST(2026, 11, 14, 3, 8));
  t('S1-d 3시 8분: 완료 → 새 예약 없음, 지난 예약 트리거 정리, 메일 없음', e.retryTriggers().length === 0 && e.state().triggerId === '' && e.mails.length === 0, { tr: e.triggers, st: e.state() });
  t('S1-e 매일 1시 트리거·백업 점검 트리거는 그대로', dailyKept(e));
})();

// ── 시나리오 2: 7시 이후 다시 시도 안 함 (7시는 메일만, 8시~는 아무것도 안 읽음)
(function () {
  const e = withDaily(makeEnv());
  e.check(KST(2026, 11, 14, 7, 8));
  t('S2-a 7시 8분 미완료(다시 시도 0번): 다시 시도 안 함, 메일 1번(CUTOFF)', e.retryTriggers().length === 0 && e.mails.length === 1 && e.state().mailed === true && /CUTOFF/.test(e.logs.join()), e.logs);
  let read = 0; const orig = e.settings; e.settings = new Proxy(orig, { get: function (o, k) { read++; return o[k]; } });
  e.check(KST(2026, 11, 14, 8, 8));
  t('S2-b 8시 8분: 아무것도 안 함, 설정 시트도 안 읽음', e.retryTriggers().length === 0 && e.mails.length === 1 && read === 0 && e.logs.length === 0, { read: read, logs: e.logs });
  e.check(KST(2026, 11, 14, 23, 8));
  t('S2-c 23시 8분(백업 시각): 아무것도 안 함', e.retryTriggers().length === 0 && e.logs.length === 0);
})();

// ── 시나리오 3: 하루 3번 넘으면 중단 + 메일 1번
(function () {
  const e = withDaily(makeEnv());
  [2, 3, 4].forEach(function (h) { e.check(KST(2026, 11, 14, h, 8)); e.now = KST(2026, 11, 14, h, 9); /* 예약이 돌았지만 또 0초 실패 — 키를 안 씀 */ });
  t('S3-a 2·3·4시: 다시 시도 3번, 남은 예약은 마지막 1개만', e.state().count === 3 && e.retryTriggers().length === 1, { st: e.state(), tr: e.triggers });
  e.check(KST(2026, 11, 14, 5, 8));
  t('S3-b 5시: 4번째는 안 함, 메일 1번(MAX_RETRIES), 받는 사람 jhjoo@nkmro.com', e.retryTriggers().length === 0 && e.mails.length === 1 && e.mails[0].to === 'jhjoo@nkmro.com' && /MAX_RETRIES/.test(e.logs.join()) && /3번/.test(e.mails[0].body), e.mails);
  e.check(KST(2026, 11, 14, 6, 8)); e.check(KST(2026, 11, 14, 7, 8));
  t('S3-c 6·7시: 메일 다시 안 보냄(MAILED_ALREADY), 횟수 그대로 3', e.mails.length === 1 && e.state().count === 3 && /MAILED_ALREADY/.test(e.logs.join()));
  t('S3-d 매일 1시 트리거·백업 점검 트리거는 그대로', dailyKept(e));
  const f = withDaily(makeEnv()); f.mailFails = true;
  f.check(KST(2026, 11, 14, 7, 8));
  t('S3-e 메일이 실패하면 mailed=false로 남김(다음 점검에서 다시)', f.state().mailed === false && /못 보냄/.test(f.logs.join()), f.logs);
})();

// ── 시나리오 4: 블랙아웃이면 아무것도 안 함 (점검이 isInNewsBlackout_로 직접 판단 — 수집 함수가 안 돌아도)
(function () {
  const e = withDaily(makeEnv({ newsBlackoutPeriods: '261114' }));
  [2, 3, 4, 5, 6, 7].forEach(function (h) { e.check(KST(2026, 11, 14, h, 8)); });
  t('S4-a 날짜 블랙아웃(261114): 2~7시 예약·메일 없음', e.retryTriggers().length === 0 && e.mails.length === 0 && /BLACKOUT/.test(e.logs.join()));
  const g = withDaily(makeEnv({ newsBlackoutPeriods: '토' }));
  g.check(KST(2026, 11, 14, 2, 8)); // 2026-11-14 = 토요일
  t('S4-b 요일 블랙아웃(토): 2026-11-14(토) 예약 없음', g.retryTriggers().length === 0 && /BLACKOUT/.test(g.logs.join()));
  const h = withDaily(makeEnv({ newsBlackoutPeriods: '토' }));
  h.check(KST(2026, 11, 13, 2, 8)); // 금요일
  t('S4-c 요일 블랙아웃(토)인데 오늘 금요일: 다시 시도함', h.retryTriggers().length === 1);
})();

// ── 시나리오 5: 수집 중이면 건너뜀
(function () {
  const e = withDaily(makeEnv());
  e.props.CMN_START_AT = String(KST(2026, 11, 14, 1, 58)); // 1시 58분 시작, 아직 게시 전
  e.check(KST(2026, 11, 14, 2, 8));
  t('S5-a 시작 10분 뒤 점검: 수집 중 → 예약 없음', e.retryTriggers().length === 0 && /RUNNING/.test(e.logs.join()) && e.state().count === 0);
  e.check(KST(2026, 11, 14, 3, 8)); // 시작 70분 지남(6분 제한으로 끊긴 경우) → 다시 시도
  t('S5-b 시작 70분 뒤에도 완료 없음: 다시 시도 1번', e.retryTriggers().length === 1 && e.state().count === 1);
})();

// ── 시나리오 6: 수집 함수 자신의 1시간 뒤 재실행이 대기 중이면 건너뜀
(function () {
  const e = withDaily(makeEnv());
  e.props.CATCHUP_TRIGGER_ID = 'catch1'; e.props.CATCHUP_TRIGGER_AT = String(KST(2026, 11, 14, 1, 30));
  e.triggers.push({ id: 'catch1', fn: 'collectMarketNews', after: 3600000 });
  e.check(KST(2026, 11, 14, 2, 8));
  t('S6-a 1시간 뒤 재실행 예약 38분 뒤: 대기 중 → 새 예약 없음, 기존 예약도 안 지움', e.retryTriggers().length === 0 && e.triggers.some(function (x) { return x.id === 'catch1'; }) && /CATCHUP_PENDING/.test(e.logs.join()));
  e.check(KST(2026, 11, 14, 3, 8));
  t('S6-b 98분 뒤(재실행이 이미 돌았는데 완료 없음): 다시 시도 1번', e.retryTriggers().length === 1 && e.state().count === 1);
})();

// ── 시나리오 7: 날짜가 바뀌면 횟수 처음부터
(function () {
  const e = withDaily(makeEnv());
  e.props.CMN_WATCHDOG = JSON.stringify({ date: '2026-11-13', count: 3, triggerId: 'old9', mailed: true });
  e.triggers.push({ id: 'old9', fn: 'collectMarketNews', after: 60000 });
  e.check(KST(2026, 11, 14, 2, 8));
  t('S7-a 어제 3번·메일 보냄 기록 → 오늘 0부터: 다시 시도 1번, mailed false, 어제 남은 예약(old9) 정리', e.state().date === '2026-11-14' && e.state().count === 1 && e.state().mailed === false && !e.triggers.some(function (x) { return x.id === 'old9'; }), { st: e.state(), tr: e.triggers });
  t('S7-b 매일 1시 트리거·백업 점검 트리거는 그대로', dailyKept(e));
})();

// ── 판단표 직접(순수 함수) — 순서 ①~⑥
(function () {
  const e = makeEnv();
  const C = function (o) { return Object.assign({ today: '2026-11-14', hour: 3, nowMs: KST(2026, 11, 14, 3, 8), triggerHour: 1, cutoffHour: 7, maxRetries: 3, runningMs: 900000, catchupMs: 3900000, blackout: false, doneDate: '', startAtMs: 0, catchupAtMs: 0, state: {} }, o); };
  t('D1 ① 완료가 블랙아웃·시간 밖보다 먼저', e.decide(C({ doneDate: '2026-11-14', blackout: true, hour: 9 })).reason === 'DONE');
  t('D2 ② 트리거시각 4시로 바꾸면 4시까지는 시간 전, 5시부터 점검', e.decide(C({ triggerHour: 4, hour: 4 })).reason === 'OUT_OF_WINDOW' && e.decide(C({ triggerHour: 4, hour: 5 })).action === 'retry');
  t('D3 ③ 블랙아웃은 수집 중 판단보다 먼저', e.decide(C({ blackout: true, startAtMs: KST(2026, 11, 14, 3, 0) })).reason === 'BLACKOUT');
  t('D4 ④ 시작 시각이 미래(시계 차이)면 수집 중으로 보지 않음', e.decide(C({ startAtMs: KST(2026, 11, 14, 3, 20) })).action === 'retry');
  t('D5 ⑤ 7시 정각대·횟수 남아도 메일(다시 시도 안 함)', e.decide(C({ hour: 7, state: { date: '2026-11-14', count: 1 } })).action === 'mail');
  t('D6 ⑥ 다시 시도는 횟수만 +1, 입력 state는 바꾸지 않음', (function () { const s = { date: '2026-11-14', count: 1 }; const d = e.decide(C({ state: s })); return d.action === 'retry' && d.state.count === 2 && s.count === 1; })());
})();

console.log('\n결과: ' + passes + '건 통과 / ' + failures + '건 실패');
process.exit(failures ? 1 : 0);
