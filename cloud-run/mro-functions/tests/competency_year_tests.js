// node tests/competency_year_tests.js — diff ②-1 (j) 1월 유예·연도 판단 + reply year 틈 시험 (실제 Google·Firestore 접속 0건)
// 설계서 6-3 "1월 전년도 입력 허용", ㉑ ⑤·v1.31(2026-11-10 재홍님: 유예 기간 작년 파일은 일·월 단위 기간 제한 모두 면제).
// A: lib 순수 함수(graceDayOf·yearMode·checkGraceRecord·yearsFromSettings)
// B: index.js saveCompetencyTest·getCompetencyTest 그대로 실행 — 가짜 날짜(2026-12-15 / 2027-01-05 / 2027-01-14 / 2027-01-16)
// G: diff ②-2 B안(2026-11-10) — 1월 올해 화면 graceDay·메모리 10분·저장은 새로 읽음
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const c = require(path.join(dir, 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 500))); } }
const J = JSON.stringify, clone = o => JSON.parse(J(o));
const KST = (y, m, d) => Date.UTC(y, m - 1, d, 3, 0); // 서울 12:00

// ── A. 순수 함수 ──
t('A1 graceDayOf: 없음·0·32·글자 → 15, "10" → 10', c.graceDayOf([]) === 15 && c.graceDayOf([['전년도입력마감일', '0']]) === 15 && c.graceDayOf([['전년도입력마감일', '32']]) === 15 && c.graceDayOf([['전년도입력마감일', 'x']]) === 15 && c.graceDayOf([['전년도입력마감일', '10']]) === 10);
t('A2 yearMode: 올해 current / 1월 1일·15일 작년 grace / 1월 16일 작년 closed / 12월 작년 closed / 2년 전 closed',
  c.yearMode(2026, KST(2026, 12, 15), null) === 'current' && c.yearMode(2026, KST(2027, 1, 1), 15) === 'grace' && c.yearMode(2026, KST(2027, 1, 15), 15) === 'grace' &&
  c.yearMode(2026, KST(2027, 1, 16), 15) === 'closed' && c.yearMode(2025, KST(2026, 12, 15), null) === 'closed' && c.yearMode(2025, KST(2027, 1, 5), 15) === 'closed');
t('A3 yearMode 마감일 설정 10 → 1월 10일 grace, 11일 closed / 서울 기준(UTC 1/15 15:00 = 서울 1/16 0시 → closed)',
  c.yearMode(2026, KST(2027, 1, 10), 10) === 'grace' && c.yearMode(2026, KST(2027, 1, 11), 10) === 'closed' && c.yearMode(2026, Date.UTC(2027, 0, 15, 14, 59), 15) === 'grace' && c.yearMode(2026, Date.UTC(2027, 0, 15, 15, 0), 15) === 'closed');
const G = (v, today) => c.checkGraceRecord(v, today, 2026);
t('A4 checkGraceRecord: 대면영업 2026-03-02(14일 훨씬 전)·원가개선 2026-10 달·위기관리 끝 2026-12-31 → 통과(기간 제한 면제)',
  G({ date: '2026-03-02' }, '2027-01-05') === '' && G({ month: '2026-10', startMonth: '2026-10' }, '2027-01-05') === '' && G({ month: '2026-12-31', startMonth: '2026-12' }, '2027-01-05') === '');
t('A5 checkGraceRecord: 2027 날짜·2025 시작 달 → DATE_OTHER_YEAR / 날짜 없음(N 미완료·결과) → 통과', G({ date: '2027-01-02' }, '2027-01-05') === 'DATE_OTHER_YEAR' && G({ month: '2026-02', startMonth: '2025-12' }, '2027-01-05') === 'DATE_OTHER_YEAR' && G({}, '2027-01-05') === '');
t('A6 checkGraceRecord 미래: 오늘 이후 날짜 → DATE_FUTURE (그 해 안이어도)', c.checkGraceRecord({ date: '2026-07-02' }, '2026-07-01', 2026) === 'DATE_FUTURE' && c.checkGraceRecord({ month: '2026-08', startMonth: '2026-08' }, '2026-07-01', 2026) === 'DATE_FUTURE');
t('A7 yearsFromSettings: 올해 이하·값 있는 키만, 큰 해부터', J(c.yearsFromSettings([['인사평가파일_2026', 'F26'], ['인사평가파일_2027', 'F27'], ['인사평가파일_2025', ''], ['인사평가파일_x', 'Q'], ['기타', '1']], 2027)) === '[2027,2026]' && J(c.yearsFromSettings([['인사평가파일_2026', 'F26'], ['인사평가파일_2027', 'F27']], 2026)) === '[2026]');

// ── B. index.js 그대로 실행 ──
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const U = (email, name, role, team, status, office) => [email, name, role, team, status, '', '', '', '', office];
const USERS = [U('jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성', '양산'), U('kim@x.com', '김하늘', '담당', '동부', '활성', '양산')];
const MRO_ID = '1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU';
const FACE = '역량-영업수행역량-대면영업', COST = '역량-개선기획역량-원가개선', ADD = '역량-개선기획역량-추가매출';
const GIDS = { [FACE]: 1204504857, [COST]: 1981522387, [ADD]: 772700407 };
const FACE_H = ['순번', '이름', '사무소', '고객사', '대면자', '직급', '미팅 일시(YYMMDD-HH)', '미팅 시간(분)', '기대 성과', '팀장 의견', '팀', '수정 요청'].concat(EX);
const COST_H = ['순번', '이름', '사무소', '고객사', '공급사', '원가 개선 항목', '원가 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '기대 성과', '아이템키', '팀장 의견', '팀', '수정 요청'].concat(EX);
const ADD_H = ['사무소', '담당', '고객사', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀', '수정 요청'].concat(EX);
// 각 파일: 대면영업 2줄(평가 전 P·평가 완료 D), 추가매출 2줄(결과 전 R·결과 있음 Q), 원가개선 비어 있음
function fileTabs(y) {
  const p = 'Y' + y + '-';
  return {
    [FACE]: [FACE_H, ['1', '김하늘', '양산', '가람산업', '홍길동', '과장', String(y).slice(2) + '1201-10', '30', '수주', '', '동부', '', p + 'P', 'kim@x.com', y + '-12-01 10:00'],
      ['2', '김하늘', '양산', '나래기공', '최민수', '부장', String(y).slice(2) + '1202-10', '30', '견적', '중', '동부', '', p + 'D', 'kim@x.com', y + '-12-02 10:00']],
    [COST]: [COST_H, ['1']],
    [ADD]: [ADD_H, ['양산', '김하늘', '아라전자', '', '', '', '', '', '동부', '', p + 'R', 'kim@x.com'], ['양산', '김하늘', '다온화학', 'N', '', '', '', '', '동부', '', p + 'Q', 'kim@x.com']]
  };
}
function makeFakeFirestore() {
  const store = {}; let chain = Promise.resolve();
  function docRef(col, id) {
    const key = col + '/' + id;
    const ref = { _key: key, get: async () => ({ exists: key in store, ref: ref, data: () => store[key] && JSON.parse(J(store[key])) }), set: async d => { store[key] = JSON.parse(J(d)); },
      update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(J(d))); }, delete: async () => { delete store[key]; } };
    return ref;
  }
  return { store, collection: n => ({ doc: id => docRef(n, id) }),
    runTransaction: fn => { const run = chain.then(async () => { const ops = []; const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.update(d)) }; const out = await fn(tx); for (const op of ops) await op(); return out; }); chain = run.catch(() => {}); return run; } };
}
function makeEnv(nowMs, opts) {
  opts = opts || {};
  const files = { F2026: fileTabs(2026), F2027: fileTabs(2027) };
  const grace = { F2026: opts.grace2026 === undefined ? '15' : opts.grace2026, F2027: '15' };
  const mroSet = opts.no2026 ? [['인사평가파일_2027', 'F2027', '']] : [['인사평가파일_2026', 'F2026', ''], ['인사평가파일_2027', 'F2027', '']];
  const st = { files, requests: [], grace: grace }; // diff ②-2: grace를 시험에서 바꿀 수 있게
  const trim = rows => rows.map(r => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  const fileOf = url => Object.keys(files).find(f => url.includes('/' + f));
  function readRange(fid, a1) {
    const i = a1.lastIndexOf('!'); const tab = a1.slice(0, i).replace(/^'|'$/g, '').replace(/''/g, "'");
    if (tab === '인사평가설정') return [['키', '값', '설명'], ['기록가능기간일', '14', '']].concat(grace[fid] === '' ? [] : [['전년도입력마감일', grace[fid], '']]);
    if (tab === 'CRM-역량평가-기준') return [];
    const rows = files[fid][tab]; if (!rows) { const e = new Error('range'); e.response = { status: 400 }; throw e; }
    return trim(clone(rows));
  }
  st.client = { request: async ({ url, method, data }) => {
    st.requests.push({ url, method: method || 'GET', data });
    const fid = fileOf(url);
    if (url.includes('/values:batchUpdate')) {
      data.data.forEach(d => { const i = d.range.lastIndexOf('!'); const tab = d.range.slice(0, i).replace(/^'|'$/g, ''); const m = d.range.slice(i + 1).match(/^([A-Z]+)(\d+)$/);
        let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); col -= 1;
        const rows = files[fid][tab]; while (rows.length < Number(m[2])) rows.push([]); const row = rows[Number(m[2]) - 1]; while (row.length <= col) row.push(''); row[col] = d.values[0][0]; });
      return { data: { totalUpdatedCells: data.data.length } };
    }
    if (url.includes(':batchUpdate')) { // deleteDimension
      const rq = data.requests[0].deleteDimension.range; const tab = Object.keys(GIDS).find(k => GIDS[k] === rq.sheetId); files[fid][tab].splice(rq.startIndex, 1); return { data: {} };
    }
    if (fid && url.includes('?fields=')) return { data: { sheets: Object.keys(files[fid]).map((tt, i) => ({ properties: { sheetId: GIDS[tt], title: tt, hidden: false, index: i } })).concat([{ properties: { sheetId: 9, title: '인사평가설정', index: 50 } }, { properties: { sheetId: 8, title: 'CRM-역량평가-기준', index: 51 } }]) } };
    const q = url.split('?')[1].split('&').filter(s => s.startsWith('ranges=')).map(s => decodeURIComponent(s.slice(7)));
    if (url.includes(MRO_ID)) return { data: { valueRanges: q.map(a1 => ({ values: a1.includes('설정') ? mroSet : USERS })) } };
    if (fid) return { data: { valueRanges: q.map(a1 => ({ values: readRange(fid, a1) })) } };
    throw new Error('모르는 요청 ' + url);
  } };
  const fs_ = makeFakeFirestore();
  const exp = new Date(Date.UTC(2031, 0, 1)).toISOString();
  fs_.store['sessions/TOK_LEAD'] = { email: 'jhjoo@nkmro.com', expiresAt: exp };
  fs_.store['sessions/TOK_KIM'] = { email: 'kim@x.com', expiresAt: exp };
  const stubs = { '@google-cloud/firestore': { Firestore: class { constructor() { return fs_; } }, FieldValue: { serverTimestamp: () => 'TS' } }, 'google-auth-library': { GoogleAuth: class { async getClient() { return st.client; } } } };
  const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
  const gal = require.resolve('google-auth-library', { paths: [dir] });
  require.cache[gal] = { id: gal, filename: gal, loaded: true, exports: stubs['google-auth-library'] };
  delete require.cache[path.join(dir, 'lib', 'sheetsClient.js')];
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } }
  const mod = { exports: {} };
  const ctx = { require: req, module: mod, exports: mod.exports, console: { log() {}, error() {} }, process: { env: {} }, Buffer, setTimeout, clearTimeout, Date: FakeDate, URL, TextEncoder, fetch: async () => { throw new Error('fetch 금지'); }, AbortController };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
  const call = fn => async body => { const out = {}; await mod.exports[fn]({ method: 'POST', body }, { set() {}, status: code => ({ json: o => { out.httpStatus = code; Object.assign(out, o); }, send() { out.httpStatus = code; } }) }); return out; };
  return { st, files, save: call('saveCompetencyTest'), get: call('getCompetencyTest'),
    writes: f => st.requests.filter(r => r.method !== 'GET' && r.url.includes('/' + f)).length };
}
let k = 0; const K = () => 'K' + (++k);
const FACE_BODY = (date) => ({ customer: '마루산업', people: [{ name: '정다은', rank: '대리' }], meetDate: date, meetHour: 9, minutes: 30, expected: '단가 협의' });
// 한 날짜·한 연도에서 6가지 쓰기 + 보기
async function allActions(nowMs, year, faceDate) {
  const e = makeEnv(nowMs); const fy = year === null ? c.seoulYear(nowMs) : year; const p = 'Y' + fy + '-';
  // 고치기 날짜: 올해 1월이면 오늘(14일 안), 그 밖은 그 해 12월 1일(12월엔 14일 안, 작년 유예엔 면제, 1/16 작년은 그 전에 거절)
  const updDate = (fy === c.seoulYear(nowMs) && c.seoulIsoDate(nowMs).slice(5, 7) === '01') ? c.seoulIsoDate(nowMs) : fy + '-12-01'; const yb = year === null ? {} : { year: year };
  const r = {};
  r.view = await e.get(Object.assign({ sessionToken: 'TOK_KIM', view: 'mine' }, yb));
  r.create = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'faceSales', tab: 'faceSales', idempotencyKey: K() }, FACE_BODY(faceDate), yb));
  r.update = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'update', form: 'faceSales', tab: 'faceSales', recordId: p + 'P', idempotencyKey: K() }, FACE_BODY(updDate), { meetHour: 10, expected: '고친 내용' }, yb));
  r.reply = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: p + 'R', achieved: 'N', idempotencyKey: K() }, yb));
  r.replyClear = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'replyClear', tab: 'addSales', recordId: p + 'Q', idempotencyKey: K() }, yb));
  r.editRequest = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'editRequest', tab: 'faceSales', recordId: p + 'D', reason: '미팅 시간 정정', idempotencyKey: K() }, yb));
  r.review = await e.save(Object.assign({ sessionToken: 'TOK_LEAD', action: 'review', tab: 'faceSales', recordId: p + 'P', grade: '상', line: '', idempotencyKey: K() }, yb));
  r.del = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'delete', tab: 'faceSales', recordId: p + 'P', idempotencyKey: K() }, yb));
  r.e = e; return r;
}
const okAll = r => ['create', 'update', 'reply', 'replyClear', 'editRequest', 'review'].every(x => r[x].ok === true);
const errAll = (r, err) => ['create', 'update', 'reply', 'replyClear', 'editRequest', 'review', 'del'].every(x => r[x].error === err);
const brief = r => Object.fromEntries(['view', 'create', 'update', 'reply', 'replyClear', 'editRequest', 'review', 'del'].map(x => [x, r[x].ok ? 'ok' : r[x].error]));

(async () => {
  // ── 2026-12-15 ──
  let D = KST(2026, 12, 15), r;
  r = await allActions(D, null, '2026-12-10');
  t('B1 12/15 year 없음(지금 화면) → 2026 파일, 6가지 쓰기 모두 ok, 보기 years [2026]·current', okAll(r) && r.view.year === 2026 && J(r.view.years) === '[2026]' && r.view.yearMode === 'current' && r.e.writes('F2027') === 0, brief(r));
  r = await allActions(D, 2026, '2026-12-10');
  t('B2 12/15 year 2026 → 같은 결과', okAll(r) && r.e.writes('F2027') === 0, brief(r));
  r = await allActions(D, 2027, '2026-12-10');
  t('B3 12/15 year 2027(다음 해 — 12월에 미리 만든 파일) → 보기·쓰기 모두 BAD_YEAR, 2027 파일 접근 0', r.view.error === 'BAD_YEAR' && errAll(r, 'BAD_YEAR') && r.e.st.requests.every(q => !q.url.includes('/F2027')), brief(r));
  // ── 2027-01-05 ──
  D = KST(2027, 1, 5);
  r = await allActions(D, 2026, '2026-03-02');
  t('B4 1/5 year 2026 → grace: 보기 yearMode grace·graceDay 15·years [2027,2026], 6가지 쓰기 ok(대면영업 3월 날짜 — 14일 제한 면제)', okAll(r) && r.view.yearMode === 'grace' && r.view.graceDay === 15 && J(r.view.years) === '[2027,2026]' && r.e.writes('F2027') === 0, brief(r));
  t('B4b 삭제도 grace에서 됨(평가된 줄은 기존 규칙대로 거절 — review 뒤라 ALREADY_REVIEWED)', r.del.error === 'ALREADY_REVIEWED', r.del);
  r = await allActions(D, null, '2027-01-02');
  t('B5 1/5 year 없음 → 2027 파일(새해 기본), 쓰기 ok, 2026 파일 쓰기 0', okAll(r) && r.view.year === 2027 && r.view.yearMode === 'current' && r.e.writes('F2026') === 0, brief(r));
  {
    const e = makeEnv(D);
    let x = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'faceSales', tab: 'faceSales', idempotencyKey: K(), year: 2027 }, FACE_BODY('2026-12-28')));
    t('B6 1/5 2027 파일에 2026-12-28 대면영업 → DATE_OTHER_YEAR(새해 파일은 기존 규칙)', x.error === 'DATE_OTHER_YEAR', x);
    x = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'faceSales', tab: 'faceSales', idempotencyKey: K(), year: 2026 }, FACE_BODY('2027-01-02')));
    t('B7 1/5 2026 파일에 2027-01-02 → DATE_OTHER_YEAR', x.error === 'DATE_OTHER_YEAR', x);
    const CG = { customer: '아라전자', supplier: '한빛상사', item: '포장재 규격 변경', reason: '규격 표준화', done: 'Y', periodFrom: '2610', periodTo: '2610', amount: '100', itemKeys: '1234567' };
    x = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'costSave', tab: 'costSave', idempotencyKey: K(), year: 2026 }, CG));
    t('B8 (v1.31) 1/5 2026 파일로 원가개선 수행 기간 2610~2610 → 통과(월 단위 제한 면제), 2026 파일에 써짐', x.ok === true && e.files.F2026[COST].some(row => row[7] === '2610~2610'), x);
    x = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'costSave', tab: 'costSave', idempotencyKey: K(), year: 2027 }, CG));
    t('B9 (v1.31) 같은 날 2027 파일로 같은 기록 → DATE_OTHER_YEAR', x.error === 'DATE_OTHER_YEAR', x);
    x = await e.save(Object.assign({ sessionToken: 'TOK_KIM', action: 'create', form: 'costSave', tab: 'costSave', idempotencyKey: K() }, CG));
    t('B10 year 없이(옛 화면) 같은 기록 → 2027 파일 기준 DATE_OTHER_YEAR — 지금 동작 그대로', x.error === 'DATE_OTHER_YEAR', x);
  }
  // ── 2027-01-14 ──
  D = KST(2027, 1, 14);
  r = await allActions(D, 2026, '2026-12-31');
  t('B11 1/14 year 2026 → grace, 6가지 쓰기 ok', okAll(r) && r.view.yearMode === 'grace', brief(r));
  // ── 2027-01-16 ──
  D = KST(2027, 1, 16);
  r = await allActions(D, 2026, '2026-12-31');
  t('B12 1/16 year 2026 → 보기는 ok(yearMode closed), 쓰기 7가지(추가·고치기·결과 적기·결과 지우기·수정 요청·평가·삭제) 모두 YEAR_CLOSED, 2026 파일 쓰기 0',
    r.view.ok === true && r.view.yearMode === 'closed' && errAll(r, 'YEAR_CLOSED') && r.e.writes('F2026') === 0, brief(r));
  r = await allActions(D, 2027, '2027-01-15');
  t('B13 1/16 year 2027 → current, 쓰기 ok', okAll(r) && r.view.yearMode === 'current', brief(r));
  {
    const e = makeEnv(KST(2027, 1, 10), { grace2026: '9' });
    const x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2026-R', achieved: 'N', idempotencyKey: K(), year: 2026 });
    t('B14 2026 파일 전년도입력마감일 9 → 1/10은 YEAR_CLOSED(작년 파일 설정을 읽음)', x.error === 'YEAR_CLOSED' && x.graceDay === 9, x);
  }
  // ── reply year 조작 ──
  {
    const e = makeEnv(KST(2027, 3, 2));
    let x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2026-R', achieved: 'N', idempotencyKey: K(), year: 2026 });
    t('B15 reply year 조작: 3월에 year 2026 → YEAR_CLOSED(예전엔 검사 없이 2026 파일에 씀), 쓰기 0', x.error === 'YEAR_CLOSED' && e.writes('F2026') === 0, x);
    x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2027-R', achieved: 'N', idempotencyKey: K(), year: 2028 });
    t('B16 reply year 2028(미래) → BAD_YEAR', x.error === 'BAD_YEAR', x);
    x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2027-R', achieved: 'N', idempotencyKey: K(), year: 'abc' });
    t('B17 reply year 글자 → BAD_YEAR', x.error === 'BAD_YEAR', x);
    x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2027-R', achieved: 'N', idempotencyKey: K(), year: 2027 });
    t('B18 reply year 2027(올해) → ok', x.ok === true, x);
  }
  // ── diff ②-2 B안: 1월 올해 화면에도 작년 마감일(graceDay) — 보기만 메모리 10분, 저장은 늘 새로 읽음 ──
  t('G1 graceLookupYear: 1/5 올해·작년 → 2026 / 1/31 올해 → 2026 / 2/1 → null / 12/15 → null / 1/5 2025 → null',
    c.graceLookupYear(2027, KST(2027, 1, 5)) === 2026 && c.graceLookupYear(2026, KST(2027, 1, 5)) === 2026 && c.graceLookupYear(2027, KST(2027, 1, 31)) === 2026 &&
    c.graceLookupYear(2027, KST(2027, 2, 1)) === null && c.graceLookupYear(2026, KST(2026, 12, 15)) === null && c.graceLookupYear(2025, KST(2027, 1, 5)) === null);
  { let now = 0; const m = c.makeTtlCache(c.GRACE_DAY_TTL_MS, () => now); m.set('F', 15); now = 10 * 60 * 1000; const a = m.get('F'); now += 1; const b = m.get('F');
    t('G2 메모리 저장 시간 = 10분(10분까지 그대로, 10분 지나면 없음)', c.GRACE_DAY_TTL_MS === 600000 && a === 15 && b === null, { a, b }); }
  const setReads = (e, f) => e.st.requests.filter(q => q.url.includes('/' + f) && decodeURIComponent(q.url).includes("인사평가설정'!A1:C") && (q.url.match(/ranges=/g) || []).length === 1).length; // 마감일만 읽는 요청(범위 1개) — 기록 읽기 묶음(설정+기록 탭 여러 범위)과 구분
  {
    const e = makeEnv(KST(2027, 1, 5), { grace2026: '9' });
    let v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G3 1/5 올해 화면(year 없음) → yearMode current · graceDay 9(작년 파일 설정) · 작년 설정 읽기 1번', v.ok && v.year === 2027 && v.yearMode === 'current' && v.graceDay === 9 && setReads(e, 'F2026') === 1, { v: [v.year, v.yearMode, v.graceDay], n: setReads(e, 'F2026') });
    v = await e.get({ sessionToken: 'TOK_LEAD', view: 'team' });
    t('G4 10분 안 두 번째 올해 화면(팀) → graceDay 9 · 작년 설정 추가 읽기 0(메모리)', v.ok && v.graceDay === 9 && setReads(e, 'F2026') === 1, { g: v.graceDay, n: setReads(e, 'F2026') });
    e.st.grace.F2026 = '3'; // 재홍님이 1월 5일에 마감일을 3으로 바꿈
    let x = await e.save({ sessionToken: 'TOK_KIM', action: 'reply', tab: 'addSales', recordId: 'Y2026-R', achieved: 'N', idempotencyKey: K(), year: 2026 });
    t('G5 마감일을 바꾼 뒤 저장(2026) → 메모리 안 쓰고 새로 읽어 바로 YEAR_CLOSED(graceDay 3)', x.error === 'YEAR_CLOSED' && x.graceDay === 3, x);
    v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G6 그 뒤 올해 화면 → 저장 때 새로 읽은 값으로 메모리 갱신 → graceDay 3', v.graceDay === 3, v.graceDay);
    v = await e.get({ sessionToken: 'TOK_KIM', view: 'criteria' });
    t('G7 평가 기준 보기(criteria)는 작년 설정을 읽지 않음 · graceDay null', v.ok && v.graceDay === null, v.graceDay);
  }
  {
    const e = makeEnv(KST(2027, 2, 1));
    const v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G8 2/1 올해 화면 → graceDay null · 작년 설정 읽기 0', v.ok && v.graceDay === null && setReads(e, 'F2026') === 0, { g: v.graceDay, n: setReads(e, 'F2026') });
  }
  {
    const e = makeEnv(KST(2026, 12, 15));
    const v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G9 12/15 올해 화면 → graceDay null · 설정 읽기 0', v.ok && v.graceDay === null && setReads(e, 'F2025') === 0 && setReads(e, 'F2026') === 0, v.graceDay);
  }
  {
    const e = makeEnv(KST(2027, 1, 5), { no2026: true });
    const v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G10 1/5 작년 파일 줄 없음 → graceDay null(띠 안 뜸) · 보기 정상', v.ok && v.yearMode === 'current' && v.graceDay === null, [v.ok, v.graceDay]);
  }
  {
    const e = makeEnv(KST(2027, 1, 16));
    const v = await e.get({ sessionToken: 'TOK_KIM', view: 'mine' });
    t('G11 1/16 올해 화면 → graceDay 15(화면이 16 > 15로 파랑 띠 숨김)', v.ok && v.graceDay === 15, v.graceDay);
  }
  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
