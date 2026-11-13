// node tests/performance_settings_tests.js — 성과평가 4단계: 인사평가 설정 › 성과평가 구역 시험. 시트·Firestore·네트워크 없음.
// A그룹: lib/performance.js settingsView·planSettingsWrite(순수 함수). B그룹: index.js getPerformanceTest view=settings·
// savePerformanceTest action=saveSettings를 가짜 시트(메모리)로 호출 — 저장하면 메모리 시트가 바뀌고 다음 요청이 다시 읽는다.
// L그룹: 같은 잠금(performanceEval)을 쓰는 다른 저장과 겹칠 때(가짜 잠금이 실제 writeLock처럼 기다림 — 시간만 1/100로 줄임).
// 팀·사람·숫자는 모두 시험용 예시(실제 실적 아님 — performance_calc_tests.js 상단 방침). 운영 시트에 쓰는 시험은 하지 않는다.
const path = require('path');
const p = require('../lib/performance');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra).slice(0, 600))); } }
const U = function (email, name, role, team, status) { return { email: email, name: name, role: role, team: team, status: status || '활성', office: '' }; };
const NOW = Date.UTC(2026, 10, 13, 3, 0); // 서울 2026-11-13 12:00

// ── A: 순수 함수. 팀 5개 상황: 가팀(활성·사무소 줄·실적 있음) / 나팀(활성·줄 없음) / 다팀(활성·개인 줄) / 라팀(팀원 없음·사무소 줄만) / 마팀(활성·잘못 적힌 줄)
const users = [U('a@x', '김가', '일반', '가팀'), U('b@x', '이나', '담당', '나팀'), U('c@x', '박다', '일반', '다팀'), U('lead@x', '최다', '팀장', '다팀'),
  U('m@x', '정마', '일반', '마팀'), U('z@x', '퇴라', '일반', '라팀', '비활성'), U('ex@x', '임원', '임원', '본사')];
const S = [['키', '값', '설명'], ['전년도입력마감일', 15, ''], ['성과공개일수', 1, '설명'], ['성과평가단위_가팀', '사무소', '설명'],
  ['성과평가단위_다팀', '개인', '설명'], ['성과평가단위_라팀', '사무소', '설명'], ['성과평가단위_마팀', '사무실', '설명'], [], ['탭이모지_자기개발', '📚', '']];
const M = [[2026, 9, '가팀', '사무소', '가사무소', '가사무소', 10, 1, 1, '', '', ''], [2025, 3, '가팀', '팀비용', '', '', '', 5, '', '', '', '']];
let v = p.settingsView({ settingsRows: S, users: users, monthlyRows: M });
const byT = {}; v.teams.forEach(function (x) { byT[x.team] = x; });
t('A1 팀 목록 = 활성 팀(가·나·다·마) + 줄만 있는 라팀, 가나다순, 본사(임원만)는 없음', v.teams.map(function (x) { return x.team; }).join() === '가팀,나팀,다팀,라팀,마팀', v.teams);
t('A2 가팀: 사무소·줄 있음·실적 있음(잠금)·활성', byT['가팀'].mode === '사무소' && byT['가팀'].hasRow && byT['가팀'].hasData && byT['가팀'].active);
t('A3 나팀: 줄 없음 → 개인, 실적 없음', byT['나팀'].mode === '개인' && !byT['나팀'].hasRow && !byT['나팀'].hasData);
t('A4 라팀: 팀원 없음(비활성만)이지만 줄이 있어 보임, active false', byT['라팀'].mode === '사무소' && byT['라팀'].hasRow && byT['라팀'].active === false);
t('A5 마팀: 잘못 적힌 값(사무실) → 개인으로 보고 badRow, badUnitRows에 남김', byT['마팀'].mode === '개인' && byT['마팀'].badRow && v.badUnitRows.length === 1 && v.badUnitRows[0].value === '사무실');
t('A6 공개 일수 1, 정상', v.publishDays.value === 1 && v.publishDays.valid === true);

const plan = function (o) { return p.planSettingsWrite(Object.assign({ settingsRows: S, users: users, monthlyRows: M }, o)); };
let w = plan({ units: { 나팀: '사무소' } });
t('A7 줄 없는 나팀 → 사무소: 마지막 값 있는 줄(9행) 다음 10행에 A~C 새 줄(키·값·설명)', w.ok && w.writes.length === 1 && w.writes[0].row === 10 && w.writes[0].col === 'A:C'
  && JSON.stringify(w.writes[0].values) === JSON.stringify(['성과평가단위_나팀', '사무소', '성과평가 단위(개인/사무소). 팀마다 1줄, 줄이 없는 팀은 개인']), w);
w = plan({ units: { 다팀: '사무소' } });
t('A8 줄 있는 다팀 → 사무소: 그 줄(5행) B열만', w.ok && w.writes.length === 1 && w.writes[0].row === 5 && w.writes[0].col === 'B' && w.writes[0].values[0] === '사무소' && w.changed[0].from === '개인', w);
w = plan({ units: { 라팀: '개인' } });
t('A9 "개인"으로 되돌리기: 줄(6행)은 지우지 않고 값만 개인', w.ok && w.writes[0].row === 6 && w.writes[0].col === 'B' && w.writes[0].values[0] === '개인');
t('A10 바뀌지 않은 값만 보냄 → NOTHING_TO_SAVE (가팀 사무소 그대로, 나팀 개인 그대로 = 줄 새로 안 만듦, 공개 일수 1 그대로)', plan({ units: { 가팀: '사무소', 나팀: '개인' }, publishDays: 1 }).error === 'NOTHING_TO_SAVE');
w = plan({ units: { 가팀: '개인' } });
t('A11 실적 있는 가팀 단위 변경 → MODE_LOCKED(팀 이름 함께), 쓰기 없음', w.ok === false && w.error === 'MODE_LOCKED' && w.field === '가팀', w);
w = plan({ units: { 마팀: '개인' } });
t('A12 잘못 적힌 마팀 줄(사무실) → "개인"으로 고쳐 씀(7행 B열)', w.ok && w.writes[0].row === 7 && w.writes[0].values[0] === '개인');
t('A13 잘못된 값 거절: 단위 "사무실" → BAD_MODE, 모르는 팀 → UNKNOWN_TEAM', plan({ units: { 나팀: '사무실' } }).error === 'BAD_MODE' && plan({ units: { 없는팀: '개인' } }).error === 'UNKNOWN_TEAM');
t('A14 공개 일수 32·-1·1.5·"abc"·빈칸 → BAD_PUBLISH_DAYS, 0·31·"7" 허용', [32, -1, 1.5, 'abc', ''].every(function (d) { return plan({ publishDays: d }).error === 'BAD_PUBLISH_DAYS'; })
  && plan({ publishDays: 0 }).ok && plan({ publishDays: 31 }).ok && plan({ publishDays: '7' }).writes[0].values[0] === 7);
w = plan({ publishDays: 0 });
t('A15 공개 일수 1 → 0: 그 줄(3행) B열만, 숫자 0으로', w.ok && w.writes.length === 1 && w.writes[0].row === 3 && w.writes[0].col === 'B' && w.writes[0].values[0] === 0, w);
w = p.planSettingsWrite({ settingsRows: [['키', '값', '설명']], users: users, monthlyRows: [], publishDays: 2, units: { 나팀: '사무소', 다팀: '사무소' } });
t('A16 빈 탭: 다팀·나팀(입력 순서)·공개 일수 줄을 2·3·4행에 새로', w.ok && w.writes.map(function (x) { return x.row + x.col; }).join() === '2A:C,3A:C,4A:C' && w.writes[2].values[0] === '성과공개일수', w.writes);
t('A17 같은 키 줄이 둘이면 → DUPLICATE_SETTING_KEY(어느 줄인지 모호)', p.planSettingsWrite({ settingsRows: S.concat([['성과평가단위_다팀', '개인', '']]), users: users, monthlyRows: M, units: { 다팀: '사무소' } }).error === 'DUPLICATE_SETTING_KEY');
t('A18 units가 배열이면 BAD_MODE', plan({ units: ['나팀'] }).error === 'BAD_MODE');

// ── B·L: index.js 경로 — 가짜 시트(메모리)
const ADMIN = 'jhjoo@nkmro.com';
let me = null;
const SHEET = {
  mroUsers: [[ADMIN, '관리자', '팀장', '가팀', '활성'], ['lead@x', '팀장가', '팀장', '가팀', '활성'], ['a@x', '김가', '일반', '가팀', '활성', '', '', '', '', '가사무소'],
    ['lead2@x', '팀장나', '팀장', '나팀', '활성'], ['b@x', '이나', '일반', '나팀', '활성'], ['ex@x', '임원', '임원', '본사', '활성']],
  mroSettings: [['인사평가파일_2026', 'F26']],
  F26: { '인사평가설정': [['키', '값', '설명'], ['성과평가단위_가팀', '사무소', '설명'], ['성과공개일수', 1, '설명']],
    '성과-월실적': [['h'], [2026, 9, '가팀', '사무소', '가사무소', '가사무소', 100, 10, 1, '', '', '']],
    '성과-마감': [['h'], [2026, '가팀', 9, 'jh', '2026-10-14 10:00', '9월 마감']],
    '성과-평가기준': [['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'], ['성장', 0.5, 'sales', '매출', 0.3, '110:100, 100:90, 90:80, 나머지:70'],
      ['성장', 0.5, 'profit', '이익', 0.3, '110:100, 100:90, 90:80, 나머지:70'], ['성장', 0.5, 'margin', '이익률', 0.1, '110:100, 100:90, 90:80, 나머지:70'],
      ['성장', 0.5, 'perHead', '인당', 0.3, '110:100, 100:90, 90:80, 나머지:70'], ['영업이익', 0.1, 'teamOp', '경상이익', 1, '110:100, 100:90, 나머지:80']] }
};
function colIdx(c) { return c.charCodeAt(0) - 65; }
function readRange(file, r) {
  const m = /^'?(.+?)'?!([A-Z])(\d+):([A-Z])(\d*)$/.exec(r); const all = file[m[1]] || [];
  if (m[2] === 'A' && m[3] === '1') return all.map(function (x) { return x.slice(); });
  return all.slice(Number(m[3]) - 1).map(function (x) { return x.slice(); });
}
let writes = [];
let writeDelayMs = 0;
function stub(rel, exp) { const f = require.resolve(path.join(__dirname, '..', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; }
stub('lib/auth.js', { authenticateSession: async function () { return { ok: true, email: me, timings: {} }; } });
// 가짜 잠금: 실제 writeLock(acquireLock)처럼 waitMs 동안 pollMs마다 다시 시도하고, 못 잡으면 false. 시간만 1/100(10초 → 100ms)
const held = {};
let lockWaits = [];
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
stub('lib/writeLock.js', {
  acquireLock: async function (fs, name, holder, opts) {
    const t0 = Date.now(), deadline = t0 + opts.waitMs / 100;
    for (;;) {
      if (!held[name]) { held[name] = holder; lockWaits.push({ name: name, waited: Date.now() - t0 }); return true; }
      if (Date.now() >= deadline) { lockWaits.push({ name: name, waited: Date.now() - t0, timeout: true }); return false; }
      await sleep(Math.max(1, opts.pollMs / 100));
    }
  },
  releaseLock: async function (fs, name, holder) { if (held[name] === holder) delete held[name]; }
});
const idem = {};
stub('lib/writeIdempotency.js', { IDEMPOTENCY_COLLECTION: 'x', withIdempotency: async function (fs, key, action, fn) { if (idem[key]) return idem[key]; idem[key] = await fn(); return idem[key]; } });
const real = require('../lib/sheetsClient');
stub('lib/sheetsClient.js', Object.assign({}, real, { getSheetsClient: async function () { return {}; },
  batchGetValues: async function (c, id, ranges) {
    return ranges.map(decodeURIComponent).map(function (r) {
      if (id !== 'F26') return { values: r.indexOf('!A2:J') > 0 ? SHEET.mroUsers.map(function (x) { return x.slice(); }) : SHEET.mroSettings };
      return { values: readRange(SHEET.F26, r) };
    });
  } }));
const gal = require.resolve('google-auth-library', { paths: [path.join(__dirname, '..')] });
const realGal = require(gal);
require.cache[gal] = { id: gal, filename: gal, loaded: true, exports: Object.assign({}, realGal, { GoogleAuth: function () { this.getClient = async function () { return { request: async function (o) {
  if (writeDelayMs) await sleep(writeDelayMs);
  let n = 0;
  o.data.data.forEach(function (d) {
    writes.push({ range: d.range, values: d.values[0] });
    const m = /^'?(.+?)'?!([A-Z])(\d+)(?::([A-Z])\d+)?$/.exec(d.range); const row = Number(m[3]) - 1;
    const arr = (SHEET.F26[m[1]] = SHEET.F26[m[1]] || []);
    while (arr.length <= row) arr.push([]);
    d.values[0].forEach(function (val, i) { arr[row][colIdx(m[2]) + i] = val; n++; });
  });
  return { data: { totalUpdatedCells: n } }; } }; }; } }) };
const idx = require('../index.js');
let kseq = 0;
async function call(fn, email, body) {
  me = email; let out = null;
  const res = { set: function () { return res; }, setHeader: function () {}, status: function () { return res; }, json: function (o) { out = o; }, send: function () {} };
  await idx[fn]({ method: 'POST', body: Object.assign({ sessionToken: 't' }, body), headers: {} }, res);
  return out;
}
const save = function (email, body) { return call('savePerformanceTest', email, Object.assign({ idempotencyKey: 'k' + (++kseq) }, body)); };
const realNow = Date.now;

(async function () {
  const start = realNow();
  Date.now = function () { return NOW + (realNow() - start); }; // 서울 2026-11-13 12시부터 실제로 흐르는 시계(잠금 기다림을 재려고)
  let r = await call('getPerformanceTest', ADMIN, { view: 'settings' });
  t('B1 관리자 view=settings: 2026, 팀 가팀(사무소·잠금)·나팀(개인), 공개 일수 1', r.ok && r.year === 2026 && r.teams.map(function (x) { return x.team + x.mode + (x.hasData ? '잠금' : ''); }).join() === '가팀사무소잠금,나팀개인' && r.publishDays.value === 1, r);
  t('B2 팀장·임원 view=settings → FORBIDDEN', (await call('getPerformanceTest', 'lead@x', { view: 'settings' })).error === 'FORBIDDEN' && (await call('getPerformanceTest', 'ex@x', { view: 'settings' })).error === 'FORBIDDEN');
  r = await save('lead@x', { action: 'saveSettings', units: { 나팀: '사무소' } });
  t('B3 팀장 saveSettings → FORBIDDEN, 시트 안 바뀜', r.error === 'FORBIDDEN' && writes.length === 0);
  r = await call('savePerformanceTest', ADMIN, { action: 'saveSettings', units: { 나팀: '사무소' } });
  t('B4 중복 방지 키 없이 → MISSING_FIELDS', r.error === 'MISSING_FIELDS' && writes.length === 0);
  r = await save(ADMIN, { action: 'saveSettings', units: { 가팀: '개인' } });
  t('B5 실적 있는 가팀 → MODE_LOCKED(가팀), 시트 안 바뀜', r.error === 'MODE_LOCKED' && r.field === '가팀' && writes.length === 0);
  r = await save(ADMIN, { action: 'saveSettings', units: { 나팀: '사무소' }, publishDays: 2 });
  t('B6 나팀 → 사무소(새 줄 4행 A~C) + 공개 일수 2(3행 B): 3+1 = 4칸, 바뀐 내용 돌려줌', r.ok && r.updatedCells === 4
    && writes.map(function (x) { return x.range; }).join() === "'인사평가설정'!A4:C4,'인사평가설정'!B3" && r.changed.length === 2, { r: r, w: writes });
  t('B7 메모리 시트: 4행 = 성과평가단위_나팀·사무소·설명, 3행 B = 2', SHEET.F26['인사평가설정'][3][0] === '성과평가단위_나팀' && SHEET.F26['인사평가설정'][3][1] === '사무소' && SHEET.F26['인사평가설정'][2][1] === 2);
  // 확인 2: 저장 뒤 다른 화면을 새로 열면 새 값 — 서버는 요청마다 시트를 다시 읽는다(캐시 없음)
  r = await call('getPerformanceTest', ADMIN, { view: 'settings' });
  t('B8 설정 화면 다시 열기: 나팀 사무소(줄 있음), 공개 일수 2', r.teams.filter(function (x) { return x.team === '나팀'; })[0].mode === '사무소' && r.teams.filter(function (x) { return x.team === '나팀'; })[0].hasRow && r.publishDays.value === 2);
  r = await call('getPerformanceTest', 'lead2@x', { view: 'input' });
  t('B9 나팀 팀장 [실적 입력] 새로 열기: mode 사무소(저장 전엔 개인)', r.ok && r.mode === '사무소', { mode: r.mode, err: r.error });
  r = await call('getPerformanceTest', 'a@x', { view: 'mine' });
  t('B10 가팀 팀원 점수 보기 새로 열기: 공개 일수 2로 계산(publish.days 2)', r.ok && r.publish.days === 2, r.publish);
  writes = [];
  r = await save(ADMIN, { action: 'saveSettings', units: { 나팀: '개인' } });
  t('B11 나팀 "개인"으로 되돌리기: 4행 B열만, 줄은 남음', r.ok && writes.length === 1 && writes[0].range === "'인사평가설정'!B4" && SHEET.F26['인사평가설정'][3][0] === '성과평가단위_나팀' && SHEET.F26['인사평가설정'][3][1] === '개인');
  writes = [];
  r = await save(ADMIN, { action: 'saveSettings', units: { 나팀: '개인' }, publishDays: 2 });
  t('B12 바뀐 것 없음 → NOTHING_TO_SAVE, 쓰기 0', r.error === 'NOTHING_TO_SAVE' && writes.length === 0);
  r = await save(ADMIN, { action: 'saveSettings', publishDays: 40 });
  t('B13 공개 일수 40 → BAD_PUBLISH_DAYS, 쓰기 0', r.error === 'BAD_PUBLISH_DAYS' && writes.length === 0);
  r = await save(ADMIN, { action: 'saveSettings', units: { 본사: '개인' } });
  t('B14 성과평가 팀이 아닌 본사 → UNKNOWN_TEAM', r.error === 'UNKNOWN_TEAM');
  const key = 'same-settings';
  writes = [];
  const r1 = await call('savePerformanceTest', ADMIN, { idempotencyKey: key, action: 'saveSettings', publishDays: 3 });
  const r2 = await call('savePerformanceTest', ADMIN, { idempotencyKey: key, action: 'saveSettings', publishDays: 3 });
  t('B15 같은 키로 두 번 눌러도 1번만 씀', r1.ok && r2.ok && writes.length === 1);

  // ── L: 잠금 겹침 (확인 1). 실제 대기 10초 = 시험 100ms
  writes = []; lockWaits = []; writeDelayMs = 40;  // 설정 저장이 쓰기에 40ms(= 실제 4초 상당) 걸리는 동안
  const pa = save(ADMIN, { action: 'saveSettings', publishDays: 1 });
  await sleep(5);
  const pb = save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '가사무소', sales: 1, profit: 1, heads: 1 }] });
  const ra = await pa, rb = await pb;
  t('L1 설정 저장 중 팀장 실적 저장: 기다렸다가(잠금 대기 > 0) 둘 다 성공 — LOCK_TIMEOUT 없음', ra.ok && rb.ok && lockWaits.length === 2 && lockWaits[1].waited > 0 && !lockWaits.some(function (x) { return x.timeout; }), { ra: ra, rb: rb, lockWaits: lockWaits });
  writes = []; lockWaits = []; writeDelayMs = 250; // 쓰기가 비정상적으로 오래(= 실제 25초 상당, 대기 10초 초과)
  const pc = save(ADMIN, { action: 'saveSettings', publishDays: 2 });
  await sleep(5);
  writeDelayMs = 0;
  const rd = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '가사무소', sales: 2, profit: 1, heads: 1 }] });
  const rc = await pc;
  t('L2 대기 시간(10초 상당)을 넘기면 실적 저장은 LOCK_TIMEOUT, 시트 안 바뀜(설정 쓰기만 1번)', rd.error === 'LOCK_TIMEOUT' && rc.ok && writes.length === 1 && /인사평가설정/.test(writes[0].range), { rd: rd, w: writes });
  const re = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '가사무소', sales: 2, profit: 1, heads: 1 }] });
  t('L3 설정 저장이 끝난 뒤 다시 누르면 실적 저장 성공', re.ok && re.rows === 1);
  t('L4 잠금이 남아 있지 않음(끝나면 풀림)', Object.keys(held).length === 0);

  Date.now = realNow;
  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { Date.now = realNow; console.log('ERROR ' + (e && e.stack)); process.exit(1); });
