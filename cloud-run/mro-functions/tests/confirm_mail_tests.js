// node tests/confirm_mail_tests.js — 2026-11-27 팀 확정 요청 메일 요일 무관 발송 시험
//  lib/weeklySales.js confirmKey·confirmJobsFor·confirmParts(미리 완료 안내)·SETTING_RULES 설명
//  index.js markConfirmPending_(saveWeeklySalesTest 예약 표시)·runWeeklySalesMail_(예약 있을 때만 시트 읽고 발송, 필요 없는 예약 닫기)
// 시트·Firestore·메일 서버 없음(가짜 객체). 이름·숫자는 시험용.
const path = require('path');
const fs = require('fs');
const ws = require(path.join(__dirname, '..', 'lib', 'weeklySales.js'));
const pc = require(path.join(__dirname, '..', 'lib', 'perfCloseMail.js'));
let pass = 0, fail = 0;
const t = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  → ' + JSON.stringify(info))); };
const at = s => Date.parse(s + '+09:00');

// 시험용 팀: 동부(3단계) 담당 가산·나주·다대, 팀장 김팀장 / 서부(2단계)
const C = [['동부', '', '가산정밀', '', '창원', '가산', true, 1, ''], ['동부', '', '나주금속', '', '달성', '나주', true, 2, ''], ['동부', '', '다대화학', '', '포항', '다대', true, 3, ''],
  ['서부', '', '라온제지', '', '부산', '', true, 1, '']];
const U = [['lead@nkmro.com', '김팀장', '팀장', '동부', '활성'], ['ga@nkmro.com', '가산', '담당', '동부', '활성'], ['na@nkmro.com', '나주', '담당', '동부', '활성'],
  ['da@nkmro.com', '다대', '담당', '동부', '활성'], ['w@nkmro.com', '서부장', '팀장', '서부', '활성']];
const S = ws.readSettings([['입력방식_동부', '3단계']]);
const done3 = [[2026, 11, 2, '동부', '입력 완료', '가산', 'ga@nkmro.com', '2026-11-14 10:00', ''], [2026, 11, 2, '동부', '입력 완료', '나주', 'na@nkmro.com', '2026-11-14 11:00', ''],
  [2026, 11, 2, '동부', '입력 완료', '다대', 'da@nkmro.com', '2026-11-14 12:00', '']];
const KEY = 'confirm_2026_11_2_동부';
const target = { key: KEY, year: 2026, month: 11, week: '2', team: '동부' };
const cj = (nowS, prog, set, tg) => ws.confirmJobsFor({ nowMs: at(nowS), settings: set || S, customers: C, progressRows: prog, users: U, adminEmail: 'admin@nkmro.com', targets: tg || [target] });

// ---- lib
t('W1 예약 키 = stage3Jobs 키와 같은 모양', ws.confirmKey(2026, 11, ws.weekPlan(2026, 11)[1], '동부') === KEY && ws.confirmKey(2026, 11, ws.weekPlan(2026, 11)[3], '동부') === 'confirm_2026_11_가마감_동부');
let r = cj('2026-11-17T10:02:00', done3);
t('W2 화요일(입력일 다음 날)에도 담당 모두 완료 → 팀장에게 1건, 미리 완료 아님', r.jobs.length === 1 && r.cancel.length === 0 && r.jobs[0].key === KEY && r.jobs[0].kind === 'confirm' &&
  r.jobs[0].recipients.map(u => u.email).join() === 'lead@nkmro.com' && r.jobs[0].early === false && r.jobs[0].entry.inputDate === '2026-11-16', r);
r = cj('2026-11-14T13:02:00', done3);
t('W3 토요일(입력일 전) 완료 → 1건, 미리 완료 표시', r.jobs.length === 1 && r.jobs[0].early === true, r);
const txt = pc.buildText(ws.confirmParts(r.jobs[0], { email: 'lead@nkmro.com', name: '김팀장' }, pc.APP_URL));
t('W4 미리 완료 안내 한 줄(입력일 날짜)', txt.indexOf('· 입력일 11/16(월) 전에 완료한 숫자는 예상치예요 — 마감 전까지 바뀔 수 있어요.') > 0 && txt.indexOf('· 팀장 마감: 11/16(월) 16:00') > 0, txt);
const txt2 = pc.buildText(ws.confirmParts(cj('2026-11-17T10:02:00', done3).jobs[0], { email: 'lead@nkmro.com', name: '김팀장' }, pc.APP_URL));
t('W5 입력일 뒤 완료는 안내 줄 없음', txt2.indexOf('예상치') < 0 && txt2.indexOf('김팀장 팀장님,') === 0, txt2);
r = cj('2026-11-17T10:02:00', done3.concat([[2026, 11, 2, '동부', '팀 확정', '', 'lead@nkmro.com', '2026-11-17 09:30', '']]));
t('W6 이미 팀 확정 → 안 보냄, 예약 닫음(TEAM_DONE)', r.jobs.length === 0 && r.cancel.length === 1 && r.cancel[0].key === KEY && r.cancel[0].reason === 'TEAM_DONE', r);
r = cj('2026-11-17T10:02:00', done3.concat([[2026, 11, 2, '동부', '완료 취소', '나주', 'na@nkmro.com', '2026-11-17 09:40', '']]));
t('W7 담당이 [완료 취소] → 안 보냄, 예약 닫음(NOT_ALL_DONE)', r.jobs.length === 0 && r.cancel[0].reason === 'NOT_ALL_DONE', r);
r = cj('2026-11-17T10:02:00', done3, null, [{ key: 'confirm_2026_11_9_동부', year: 2026, month: 11, week: '9', team: '동부' }, { key: 'confirm_2026_11_2_서부', year: 2026, month: 11, week: '2', team: '서부' }]);
t('W8 없는 주차·2단계 팀 → 예약 닫음', r.jobs.length === 0 && r.cancel.map(c => c.reason).join() === 'NO_WEEK,NOT_STAGE3', r);
r = cj('2026-11-17T10:02:00', done3, ws.readSettings([['입력방식_동부', '3단계'], ['메일사용', 'FALSE']]));
t('W9 메일사용 FALSE → 안 보내고 예약도 그대로', r.jobs.length === 0 && r.cancel.length === 0, r);
const s3 = d => ws.stage3Jobs({ nowMs: at(d), settings: S, customers: C, progressRows: done3, weeklyRows: [], users: U, adminEmail: 'admin@nkmro.com' });
t('W10 stage3Jobs(입력일 처리)는 예전 그대로: 월요일만, 키 같음, 미리 완료 아님', s3('2026-11-17T10:02:00').length === 0 && s3('2026-11-16T10:02:00').length === 1 && s3('2026-11-16T10:02:00')[0].key === KEY && s3('2026-11-16T10:02:00')[0].early === false);
const desc = k => ws.SETTING_RULES.find(x => x.key === k).desc;
t('W11 기본 설명 3개 = 시트 C열 승인 문구', desc('메일사용') === "주간 실적·확정 실적 메일 전체 켜기/끄기(TRUE/FALSE). 3단계 팀은 담당이 모두 [입력 완료]하면 요일과 상관없이 다음 정시 2분에 팀장에게 '팀 확정 요청' 메일이 갑니다(주차마다 1번)."
  && desc('담당마감시각') === '3단계 팀 담당 [입력 완료] 마감 시각(0~23). 입력일(월) 이 시각부터 아직 완료하지 않은 담당 본인에게 마감 알림 메일이 갑니다.'
  && desc('팀장마감시각') === '팀장 [입력 완료]·[팀 확정] 마감 시각(0~23). 입력일(월) 이 시각에 아직 완료·확정하지 않은 팀의 팀장에게 알림 메일이 갑니다.');

// ---- index.js 코드를 그대로 꺼내 가짜 Firestore·시트·메일로 실행
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const cut = name => { const a0 = SRC.indexOf('async function ' + name + '('); return SRC.slice(a0, SRC.indexOf('\n}\n', a0) + 3); };
function fakeFs(st) {
  const col = n => (st.db[n] = st.db[n] || {});
  return {
    collection: n => ({
      doc: id => ({ async get() { const d = col(n)[id]; return { exists: !!d, data: () => d }; },
        async set(v, o) { st.writes.push([n, id, v.status]); col(n)[id] = o && o.merge ? Object.assign({}, col(n)[id] || {}, v) : v; } }),
      where: (f, op, v) => ({ async get() { st.queries++; const docs = Object.keys(col(n)).filter(id => col(n)[id][f] === v).map(id => ({ id, data: () => col(n)[id] })); return { docs, empty: !docs.length }; } })
    })
  };
}
function makeRun(st) {
  const mailer = {
    FROM_ADDRESS: 'bot@nkmro.com', describeError: e => String(e),
    async verifyLogin() { st.logins++; if (st.loginFail) throw new Error('LOGIN'); },
    async sendMessages(msgs) { st.sent.push(...msgs); return { ok: true, results: msgs.map(m => ({ to: m.to, ok: true })) }; }
  };
  const deps = {
    firestore: fakeFs(st), weeklySales: ws, perfCloseMail: pc, mailer, FieldValue: { serverTimestamp: () => 'TS' }, ADMIN_EMAIL: 'admin@nkmro.com',
    WEEKLY_STATE: 'weeklySalesState', WEEKLY_MAILS: 'weeklySalesMails', WEEKLY_LOCK_NAME: 'weeklySales', WEEKLY_LOCK_WAIT_MS: 1, WEEKLY_LOCK_STALE_MS: 1, WEEKLY_LOCK_POLL_MS: 1,
    async getSheetsClient() { return {}; },
    async weeklyMro_(c, x, y) { st.sheetReads++; st.year = y; return { fileId: 'F', userRows: U, names: {} }; },
    async weeklyFile_() { return { settings: st.settings || S, customers: C, progress: st.progress, weekly: [] }; },
    weeklyEntry_() { throw new Error('결과 메일 시험 아님'); },
    async batchGetValues() { return []; }, competency: { quoteTab: x => "'" + x + "'" }, crypto: { randomUUID: () => 'h' },
    async acquireLock() { return true; }, async releaseLock() {}, async perfBatchWrite_(id, data) { st.logs.push(...data.map(d => d.values[0][4])); return 9; }
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, cut('markConfirmPending_') + cut('runWeeklySalesMail_') + '\nreturn { markConfirmPending_, runWeeklySalesMail_ };');
  return fn(...names.map(k => deps[k]));
}
const fresh = (o) => Object.assign({ db: {}, writes: [], sent: [], logs: [], logins: 0, queries: 0, sheetReads: 0, progress: done3 }, o || {});
const doc = (st) => (st.db.weeklySalesMails || {})[KEY];
const en = { year: 2026, month: 11, entry: ws.weekPlan(2026, 11)[1] };

(async function () {
  // markConfirmPending_
  let st = fresh(); let f = makeRun(st);
  let m = await f.markConfirmPending_(en, '동부', at('2026-11-17T09:50:00'));
  t('S1 마지막 담당 완료 → 예약 표시(pending, 연·월·주차·팀)', m === 'PENDING' && doc(st).status === 'pending' && doc(st).kind === 'confirm' && doc(st).year === 2026 && doc(st).month === 11 && doc(st).week === '2' && doc(st).team === '동부', doc(st));
  st.db.weeklySalesMails[KEY].status = 'done';
  m = await f.markConfirmPending_(en, '동부', at('2026-11-17T09:55:00'));
  t('S2 이미 보낸 주차(done) → 그대로(주차마다 1번)', m === 'ALREADY_SENT' && doc(st).status === 'done');
  const br = SRC.slice(SRC.indexOf('// 2026-11-27 재홍님 승인: 마지막 담당이'), SRC.indexOf("confirmMail: mail };"));
  t('S3 saveWeeklySalesTest: [입력 완료]일 때만, 남은 담당이 없을 때만 예약(실패해도 저장 성공)', /if \(complete && Object\.keys\(counts\)\.filter\(function \(x\) \{ return counts\[x\]; \}\)\.every\(function \(x\) \{ return x === who \|\| mdone\[x\]; \}\)\)/.test(br) && /try \{ mail = await markConfirmPending_\(en, lead\.team, nowMs\); \} catch/.test(br), br.slice(0, 200));

  // runWeeklySalesMail_
  st = fresh(); f = makeRun(st);
  let r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R1 화요일·예약 없음 → 시트 안 읽음(NOTHING_DUE)', r2.skipped && r2.reason === 'NOTHING_DUE' && st.sheetReads === 0 && st.queries === 1, r2);
  await f.markConfirmPending_(en, '동부', at('2026-11-17T09:50:00'));
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R2 화요일·예약 있음 → 시트 읽고 팀장에게 1통, 기록 done, 실적-진행에 확정 요청 메일', st.sheetReads === 1 && st.year === 2026 && st.sent.length === 1 && st.sent[0].to === 'lead@nkmro.com' && /팀 확정 요청/.test(st.sent[0].subject) && doc(st).status === 'done' && st.logs.join() === '확정 요청 메일', { r2, sent: st.sent.map(x => x.to), d: doc(st), logs: st.logs });
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T11:02:00'));
  t('R3 다음 정시 → 예약 없음, 다시 안 보냄, 시트 안 읽음', r2.reason === 'NOTHING_DUE' && st.sent.length === 1 && st.sheetReads === 1, r2);

  st = fresh({ progress: done3.concat([[2026, 11, 2, '동부', '팀 확정', '', 'lead@nkmro.com', '2026-11-17 09:58', '']]) }); f = makeRun(st);
  await f.markConfirmPending_(en, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R4 그 사이 팀 확정 → 안 보냄, 예약 닫음(cancelled TEAM_DONE)', st.sent.length === 0 && doc(st).status === 'cancelled' && doc(st).reason === 'TEAM_DONE' && r2.due === 0, { r2, d: doc(st) });
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T11:02:00'));
  t('R5 닫은 뒤에는 시트 안 읽음', r2.reason === 'NOTHING_DUE' && st.sheetReads === 1, r2);

  st = fresh({ progress: done3.concat([[2026, 11, 2, '동부', '완료 취소', '다대', 'da@nkmro.com', '2026-11-17 09:59', '']]) }); f = makeRun(st);
  await f.markConfirmPending_(en, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R6 담당 [완료 취소] → 안 보냄, 예약 닫음(NOT_ALL_DONE)', st.sent.length === 0 && doc(st).status === 'cancelled' && doc(st).reason === 'NOT_ALL_DONE', doc(st));

  st = fresh(); f = makeRun(st);
  await f.markConfirmPending_(en, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-16T10:02:00'));
  t('R7 입력일(월)에 예약 + stage3Jobs 같은 키 → 1통만', st.sent.length === 1 && doc(st).status === 'done', { n: st.sent.length, r2 });

  st = fresh({ loginFail: true }); f = makeRun(st);
  await f.markConfirmPending_(en, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R8 메일 로그인 실패 → 예약 그대로(pending) — 다음 정시에 다시', r2.loginFailed && st.sent.length === 0 && doc(st).status === 'pending' && doc(st).kind === 'confirm' && doc(st).week === '2', doc(st));

  st = fresh({ settings: ws.readSettings([['입력방식_동부', '3단계'], ['메일사용', 'FALSE']]) }); f = makeRun(st);
  await f.markConfirmPending_(en, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-17T10:02:00'));
  t('R9 메일사용 FALSE → 안 보내고 예약 그대로', r2.reason === 'DISABLED' && st.sent.length === 0 && doc(st).status === 'pending', r2);

  st = fresh(); f = makeRun(st);
  await f.markConfirmPending_({ year: 2026, month: 11, entry: ws.weekPlan(2026, 11)[1] }, '동부', 0);
  r2 = await f.runWeeklySalesMail_(at('2026-11-14T13:02:00'));
  t('R10 토요일(미리 완료) → 바로 1통, 본문에 예상치 안내', st.sent.length === 1 && st.sent[0].text.indexOf('예상치') > 0, { n: st.sent.length });

  console.log('confirm_mail_tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
