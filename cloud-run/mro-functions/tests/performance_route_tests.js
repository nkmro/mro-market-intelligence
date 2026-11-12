// node tests/performance_route_tests.js — 성과평가 1-다 getPerformanceTest 보기 경로(index.js performanceView_) 시험.
// 시트·Firestore·네트워크 없음: lib/auth.js·lib/sheetsClient.js를 가짜로 바꿔 끼우고 index.js를 불러 요청을 흉내 낸다.
// 숫자는 모두 시험용 예시(실제 실적 아님 — performance_calc_tests.js 상단 방침).
const path = require('path');
const ADMIN = 'jhjoo@nkmro.com';
let currentEmail = null, calls = [];
function stub(rel, exp) { const f = require.resolve(path.join(__dirname, '..', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; }
stub('lib/auth.js', { authenticateSession: async function (fs, tok) { return tok ? { ok: true, email: currentEmail, timings: {} } : { ok: false, status: 401, error: 'SESSION_NOT_FOUND' }; } });
const realSheets = require('../lib/sheetsClient');
const G4 = '110:100, 100:90, 90:80, 나머지:70', G3 = '110:100, 100:90, 나머지:80';
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), Y = Number(today.slice(0, 4));
const OLD = (Y - 1) + '-01-05 10:00'; // 공개 기간이 이미 지난 마감 날짜
let closeStamp = OLD;
const FILE = 'perf-file-' + Y;
function data(spreadsheetId, ranges) {
  const dec = ranges.map(decodeURIComponent);
  calls.push({ id: spreadsheetId, ranges: dec });
  if (spreadsheetId !== FILE) {
    return dec.map(function (r) {
      if (r.indexOf('!A2:J') > 0) return { values: [
        [ADMIN, '관리자', '팀장', '가팀', '활성'], ['m1@x', '김가', '일반', '가팀', '활성', '', '', '', '', '나사무소'],
        ['m2@x', '이가', '담당', '가팀', '활성', '', '', '', '', '다사무소'], ['lead@x', '팀장나', '팀장', '나팀', '활성'],
        ['n1@x', '서나', '일반', '나팀', '활성', '', '', '', '', '나사무소'], ['ex@x', '임원가', '임원', '본사', '활성'],
        ['off@x', '퇴사', '일반', '가팀', '비활성', '', '', '', '', '나사무소']] };
      return { values: [['인사평가파일_' + Y, FILE], ['인사평가파일_' + (Y - 3), 'old-file']] }; // 설정 탭(전년도 파일 없음)
    });
  }
  return dec.map(function (r) {
    if (r.indexOf('인사평가설정') >= 0) return { values: [['키', '값'], ['성과평가단위_가팀', '사무소'], ['성과평가단위_나팀', '사무소'], ['성과공개일수', 1]] };
    if (r.indexOf('성과-월실적') >= 0) return { values: [
      [Y, 1, '가팀', '사무소', '나사무소', '나사무소', 1234567, 123457, 1], [Y - 1, 1, '가팀', '사무소', '나사무소', '나사무소', 1000001, 100001, 1],
      [Y, 1, '가팀', '사무소', '다사무소', '다사무소', 2345671, 234567, 1], [Y - 1, 1, '가팀', '사무소', '다사무소', '다사무소', 2000001, 200001, 1],
      [Y, 1, '가팀', '팀비용', '', '', '', 30001, ''], [Y - 1, 1, '가팀', '팀비용', '', '', '', 30003, ''],
      [Y, 1, '나팀', '사무소', '나사무소', '나사무소', 8765431, 876543, 2], [Y - 1, 1, '나팀', '사무소', '나사무소', '나사무소', 8000001, 800001, 2]] };
    if (r.indexOf('성과-마감') >= 0) return { values: [[Y, '가팀', 1, ADMIN, closeStamp, '1월 마감'], [Y, '나팀', 1, 'lead@x', closeStamp, '']] };
    return { values: [['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'],
      ['전년 실적 대비 성장률', 0.5, 'sales', '매출액 성장', 0.3, G4], ['전년 실적 대비 성장률', 0.5, 'profit', '매출이익 성장', 0.3, G4],
      ['전년 실적 대비 성장률', 0.5, 'margin', '이익률 성장(%)', 0.1, G4], ['전년 실적 대비 성장률', 0.5, 'perHead', '인당 이익금 성장', 0.3, G4],
      ['사업부문 영업이익 성장률', 0.1, 'teamOp', '팀 경상이익 성장률', 1, G3]] };
  });
}
stub('lib/sheetsClient.js', Object.assign({}, realSheets, { getSheetsClient: async function () { return {}; }, batchGetValues: async function (c, id, ranges) { return data(id, ranges); } }));
const idx = require('../index.js');
async function call(email, body) {
  currentEmail = email; calls = [];
  let out = null, code = 0;
  const res = { set: function () { return res; }, setHeader: function () {}, status: function (c) { code = c; return res; }, json: function (o) { out = o; }, send: function () {} };
  await idx.getPerformanceTest({ method: 'POST', body: Object.assign({ sessionToken: 't' }, body), headers: {} }, res);
  return out;
}
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra).slice(0, 400))); } }
const GA = ['1234567', '123457', '2345671', '234567', '30001', '1000001'], NA = ['8765431', '876543', '8000001'];
const has = function (o, list) { const s = JSON.stringify(o); return list.filter(function (n) { return s.indexOf(n) >= 0; }); };

(async function () {
  let r = await call('m1@x', { view: 'mine' });
  t('R1 팀원 mine(공개 기간 밖): ok·계산됨·내 사무소 = 나사무소', r.ok && r.scored && r.myKey === '나사무소' && r.showNumbers === false, r);
  t('R2 팀원 응답에 가팀 매출·이익·비용 숫자 없음', has(r, GA).length === 0, has(r, GA));
  t('R3 팀원 응답에 다른 팀(나팀) 숫자 없음', has(r, NA).length === 0);
  t('R4 읽기 횟수: MRO 1번 + 인사평가 파일 1번(전년도 파일 없음)', calls.length === 2 && calls[1].id === FILE, calls.map(function (c) { return c.id; }));
  closeStamp = today + ' 09:00';
  r = await call('m1@x', { view: 'mine' });
  t('R5 팀원 mine(오늘 마감 → 공개 기간): 숫자 있음, 나팀 숫자는 없음', r.showNumbers && r.publish.open && has(r, GA).length > 0 && has(r, NA).length === 0);
  closeStamp = OLD;
  r = await call('lead@x', { view: 'mine' });
  t('R6 팀장 mine: 자기 팀(나팀) 숫자 항상, 가팀 숫자 없음', r.ok && r.team === '나팀' && r.showNumbers && has(r, NA).length > 0 && has(r, GA).length === 0);
  r = await call('lead@x', { view: 'team', team: '가팀' });
  t('R7 팀장 team → FORBIDDEN(다른 팀 못 봄)', r.ok === false && r.error === 'FORBIDDEN');
  r = await call('m1@x', { view: 'team', team: '나팀' });
  t('R8 팀원 team → FORBIDDEN', r.ok === false && r.error === 'FORBIDDEN');
  r = await call('ex@x', { view: 'mine' });
  t('R9 임원 mine → FORBIDDEN(임원은 team)', r.ok === false && r.error === 'FORBIDDEN');
  r = await call('ex@x', { view: 'team', team: '나팀' });
  t('R10 임원 team 나팀: 숫자 있음·가팀 숫자 없음·팀 칩 2개(가팀·나팀)', r.ok && r.team === '나팀' && r.showNumbers && has(r, GA).length === 0 && r.teams.map(function (x) { return x.team + x.mode + x.closeMonth; }).join() === '가팀사무소1,나팀사무소1', r.teams);
  r = await call('ex@x', { view: 'team', team: '없는팀' });
  t('R11 임원 모르는 팀 → 첫 팀(가팀)', r.ok && r.team === '가팀');
  r = await call(ADMIN, { view: 'mine' });
  t('R12 관리자(팀장) mine: 숫자 항상', r.ok && r.team === '가팀' && r.showNumbers === true && r.preview === false);
  r = await call(ADMIN, { view: 'mine', previewRole: '일반' });
  t('R13 관리자 previewRole 일반: 팀원과 같은 거름(숫자 없음)', r.ok && r.preview === true && r.viewer.role === '일반' && r.showNumbers === false && has(r, GA).length === 0);
  r = await call('m1@x', { view: 'mine', previewRole: '일반' });
  t('R14 관리자가 아니면 previewRole 무시', r.preview === false);
  // W_preview_forbidden: 관리자가 아니면 previewRole을 보내도 무시 — 본인 역할 그대로(팀원은 숫자 없음, 팀장은 숫자 있음)
  r = await call('m1@x', { view: 'mine', previewRole: '일반' });
  t('W_preview_forbidden1 팀원 + previewRole: preview false·숫자 없음(본인 역할 그대로)', r.ok && r.preview === false && r.previewIgnored === false && r.viewer.role === '일반' && r.showNumbers === false && has(r, GA).length === 0);
  r = await call('lead@x', { view: 'mine', previewRole: '일반' });
  t('W_preview_forbidden2 팀장 + previewRole: preview false·역할 팀장·자기 팀 숫자 그대로', r.ok && r.preview === false && r.viewer.role === '팀장' && r.showNumbers === true && has(r, NA).length > 0);
  r = await call('ex@x', { view: 'team', team: '나팀', previewRole: '일반' });
  t('W_preview_forbidden3 임원 + previewRole: 무시(previewIgnored false — 관리자 아님), 임원 화면 그대로', r.ok && r.preview === false && r.previewIgnored === false && r.showNumbers === true);
  r = await call(ADMIN, { view: 'team', team: '나팀', previewRole: '일반' });
  t('W_preview_team 관리자 team + previewRole: 미리보기 안 함(preview false)·previewIgnored true(화면 경고 띠)', r.ok && r.preview === false && r.previewIgnored === true && r.showNumbers === true);
  r = await call('off@x', { view: 'mine' });
  t('R15 비활성 사용자 → FORBIDDEN', r.ok === false && r.error === 'FORBIDDEN');
  r = await call('nobody@x', { view: 'mine' });
  t('R16 명단에 없는 사람 → USER_NOT_FOUND', r.error === 'USER_NOT_FOUND');
  r = await call('m1@x', { view: 'mine', year: Y + 1 });
  t('R17 올해보다 큰 해 → BAD_YEAR', r.error === 'BAD_YEAR');
  r = await call('m1@x', { view: 'mine', year: Y - 2 });
  t('R18 파일 없는 해 → PERF_SETTINGS_MISSING', r.error === 'PERF_SETTINGS_MISSING');
  r = await call('m2@x', { view: 'criteria' });
  t('R19 criteria(담당): 항목 5개·60점·오류 목록 비움', r.ok && r.criteria.items.length === 5 && r.criteria.maxPoints === 60 && r.criteria.errors.length === 0 && r.criteria.items[0].maxPts === 15);
  t('R20 criteria 응답에 실적 숫자 없음', has(r, GA.concat(NA)).length === 0);
  r = await call('m1@x', { view: 'ping' });
  t('R21 ping은 그대로 관리자 전용', r.error === 'FORBIDDEN');
  r = await call('m1@x', { view: 'nope' });
  t('R22 모르는 view → NOT_IMPLEMENTED', r.error === 'NOT_IMPLEMENTED');
  r = await call('m1@x', { view: 'input' });
  t('R23 3-가 view=input: 팀원 → FORBIDDEN', r.ok === false && r.error === 'FORBIDDEN');
  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('ERROR ' + (e && e.stack)); process.exit(1); });
