// node tests/competency_review_tests.js — 3-가 팀장 평가 입력(review)·평가 고치기(reviewEdit) 시험(설계서 v1.30) (실제 Google·Firestore 접속 0건)
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const c = require(path.join(dir, 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }
const J = JSON.stringify;
const clone = o => JSON.parse(J(o));
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const U = (email, name, role, team, status, office) => [email, name, role, team, status, '', '', '', '', office];
let USERS = [U('jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성', '양산'), U('kim@x.com', '김하늘', '담당', '동부', '활성', '양산'), U('lee@x.com', '이도윤', '일반', '동부', '활성', '김해')];
let SETTING_WINDOW = '14';
const FACE = '역량-영업수행역량-대면영업', COST = '역량-개선기획역량-원가개선', SELF = '역량-직무별전문성-자기개발', ADD = '역량-개선기획역량-추가매출';
const GIDS = { [FACE]: 1204504857, [COST]: 1981522387, [SELF]: 0, [ADD]: 772700407 };
const FACE_H = ['순번', '이름', '사무소', '고객사', '대면자', '직급', '미팅 일시(YYMMDD-HH)', '미팅 시간(분)', '기대 성과', '팀장 의견 (상중하)', '팀'].concat(EX);
const COST_H = ['순번', '이름', '사무소', '고객사', '공급사', '원가 개선 항목', '원가 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '기대 성과', '아이템키', '팀장 의견', '팀'].concat(EX);
const SELF_H = ['순번', '이름', '사무소', '자기개발 항목', '자기개발 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '자기 성취 평가 요약', '팀장 의견', '팀'].concat(EX);
const TODAY = c.seoulIsoDate(Date.now());
const daysAgo = n => new Date(Date.UTC(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 1, +TODAY.slice(8, 10)) - n * 86400000).toISOString().slice(0, 10);
const yymmddhh = (iso, h) => iso.slice(2).replace(/-/g, '') + '-' + h;
const ymOf = iso => iso.slice(2, 4) + iso.slice(5, 7);
const OLD = '260101-10'; // 오래된 날짜(14일 밖)
function baseTabs() {
  return {
    [FACE]: [FACE_H,
      ['1', '이도윤', '김해', '가람산업', '최민수', '부장', OLD, '30', '견적 요청', '', '동부', 'CE-F1', 'lee@x.com', '2026-01-01 10:00'],      // 2행: 본인·미평가·오래된 날짜
      ['2', '이도윤', '김해', '나래기공', '정다은', '대리', OLD, '40', '수주', '중 (2610)', '동부', 'CE-F2', 'lee@x.com', '2026-01-02 10:00', '', '좋음'], // 3행: 본인·평가 완료(+한줄의견)
      ['3', '김하늘', '양산', '다온화학', '박부장', '부장', OLD, '20', '분기 견적', '', '동부', 'CE-F3', 'kim@x.com'],                          // 4행: 남의 줄
      ['4', '이도윤', '김해', '마루산업', '최민수', '부장', OLD, '60', '단가 계약', '', '동부', 'CE-F4', 'lee@x.com']],                         // 5행: 본인·미평가
    [COST]: [COST_H, ['1', '이도윤', '김해', '아라전자', '한빛상사', '포장재 변경', '규격 표준화', '2610~', 'Y', '개선 200천원 / 월 평균', '1234567', '', '동부', 'CE-C1', 'lee@x.com']],
    [SELF]: [SELF_H, ['1'], ['2', '이도윤', '김해', '엑셀 고급', '정리 시간 단축', '', 'N', '', '', '동부', 'CE-S1', 'lee@x.com']],
    [ADD]: [['사무소', '담당', '구분', '고객사', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀'].concat(EX), ['김해', '이도윤', '품목확대', '시험', '', '', '', '', '', '동부', 'CE-A1', 'lee@x.com'],
      ['김해', '이도윤', '품목확대', '아라전자', 'Y', '2609~2610', '매출 1,000천원 / 이익 100천원', '1234567', '', '동부', 'CE-A2', 'lee@x.com'], // 3행: 결과 있음·미평가
      ['김해', '이도윤', '품목확대', '나래기공', 'Y', '2609~', '매출 500천원 / 이익 50천원 / 월 평균', '2345678', '상 (2610)', '동부', 'CE-A3', 'lee@x.com'], // 4행: 평가 완료
      ['김해', '이도윤', '이익개선', '가람산업', 'N', '', '', '', '', '동부', 'CE-A4', 'lee@x.com']] // 5행: 이익개선·N
  };
}
// 대면영업 줄(CE-F1)을 화면이 보낼 값으로
const FACE_V = { customer: '가람산업', people: [{ name: '최민수', rank: '부장' }], meetDate: '2026-01-01', meetHour: 10, minutes: 30, expected: '견적 요청' };



// 이 시험의 사용자: 동부 팀장(jhjoo) · 동부 팀원 김하늘(담당)·이도윤(일반) · 동부 퇴사자 정OO · 서부 팀장 박서부(park) · 임원(ceo)
USERS = USERS.concat([U('old@x.com', '정OO', '일반', '동부', '비활성', ''), U('park@x.com', '박서부', '팀장', '서부', '활성', '대구'), U('ceo@x.com', '대표', '임원', '', '활성', '')]);
const RQ = '수정 요청';
const FACE_H2 = FACE_H.concat([RQ]);
const ADD_H2 = ['사무소', '담당', '구분', '고객사', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀'].concat(EX, [RQ]);
// FACE_H2 칸: J(9)=팀장 의견 (상중하) · L(11)=기록ID · M(12)=작성자이메일 · N(13)=기록일시 · O(14)=수정일시 · P(15)=팀장한줄의견 · Q(16)=첨부 · R(17)=수정 요청
function tabs3() {
  return {
    [FACE]: [FACE_H2,
      ['1', '이도윤', '김해', '가람산업', '최민수', '부장', OLD, '30', '견적 요청', '', '동부', 'CE-V1', 'lee@x.com', '2026-10-20 10:00', '2026-10-25 09:30'],              // 2행: 미평가(수정일시 있음)
      ['2', '이도윤', '김해', '나래기공', '정다은', '대리', OLD, '40', '수주', '중', '동부', 'CE-V2', 'lee@x.com', '2026-10-21 10:00', '', '좋음'],                          // 3행: 평가 완료 + 한줄의견
      ['3', '이도윤', '김해', '마루산업', '최민수', '부장', OLD, '60', '단가 계약', '상', '동부', 'CE-V3', 'lee@x.com', '', '', '', '', '요청 2026-10-28 14:20 · 사유: 날짜 오류'], // 4행: 평가 완료 + 수정 요청 중
      ['4', '정OO', '', '하나상사', '김도현', '대리', OLD, '20', '견적', '', '동부', 'CE-V4', 'old@x.com'],                                                               // 5행: 퇴사자 미평가
      ['5', '김하늘', '양산', '다온화학', '박부장', '부장', OLD, '20', '분기 견적', '', '동부', 'CE-V5', 'kim@x.com']],                                                    // 6행: 미평가(수정일시 빈칸)
    [ADD]: [ADD_H2,
      ['김해', '이도윤', '품목확대', '시험', '', '', '', '', '', '동부', 'CE-A1', 'lee@x.com'],                                                                              // 2행: 계획(결과 없음)
      ['김해', '이도윤', '품목확대', '아라전자', 'Y', '2609~2610', '매출 1,000천원 / 이익 100천원', '1234567', '', '동부', 'CE-A2', 'lee@x.com']],                        // 3행: 결과 있음·미평가
    [SELF]: [SELF_H, ['1', '이도윤', '김해', '엑셀 고급', '자동화', '2607~2609', 'Y', '정리 시간 절반', '', '동부', 'CE-S1', 'lee@x.com']]                                  // '수정 요청' 칸 없는 탭, 평가 칸 = '팀장 의견'
  };
}
const TABF = { id: 'faceSales', title: FACE }, TABA = { id: 'addSales', title: ADD }, TABS = { id: 'selfDev', title: SELF };
const NOW = Date.UTC(2026, 9, 29, 5, 20); // 서울 2026-10-29 14:20
const V = (g, l, seen) => c.validateReview({ grade: g, line: l, seen: seen });
const byK = p => { const o = {}; (p.writes || []).forEach(w => { o[w.range.split('!')[1]] = w.value; }); return o; };
// ── A. 순수 함수 ──
{
  let v = V('상', '');
  t('A1 등급 "상"·의견 빈칸 → ok, seen 없으면 null', v.ok && v.grade === '상' && v.line === '' && v.seen === null, v);
  t('A2 등급 앞뒤 띄어쓰기 " 중 " → "중"', V(' 중 ').grade === '중');
  t('A3 상·중·하 밖("최상", "중 (2610)", "", "A") → BAD_GRADE', ['최상', '중 (2610)', '', 'A', undefined].every(g => V(g).error === 'BAD_GRADE'));
  t('A4 한줄 의견 200자 ok · 201자 BAD_INPUT(line)', V('상', 'ㄱ'.repeat(200)).ok && V('상', 'ㄱ'.repeat(201)).error === 'BAD_INPUT' && V('상', 'ㄱ'.repeat(201)).field === 'line');
  t('A5 한줄 의견 줄바꿈 → 띄어쓰기 한 칸', V('중', ' 견적\n 결과 \r\n공유 ').line === '견적 결과 공유');
  t('A6 seen이 글자가 아니면(숫자) BAD_INPUT(seen)', c.validateReview({ grade: '상', seen: 123 }).field === 'seen');
  const T3 = tabs3();
  let p = c.planReview(TABF, T3[FACE], 'CE-V1', V('상', '견적 결과 공유 부탁해요', '2026-10-25 09:30'), false, NOW);
  let k = byK(p);
  t('A7 미평가 평가 → J2 "상" · P2 한줄의견 · O2 수정일시 "2026-10-29 14:20" (3칸), 기록 평가 완료·leaderOpinion "상"', p.ok && p.writes.length === 3 && k.J2 === '상' && k.P2 === '견적 결과 공유 부탁해요' && k.O2 === '2026-10-29 14:20' && p.record.reviewState === 'done' && p.record.leaderOpinion === '상' && p.authorEmail === 'lee@x.com', p.writes);
  p = c.planReview(TABF, T3[FACE], 'CE-V5', V('하', ''), false, NOW); k = byK(p);
  t('A8 한줄의견 빈칸(원래도 빈칸) → 2칸만(J6 "하", O6 수정일시), 한줄의견 칸 안 씀', p.ok && p.writes.length === 2 && k.J6 === '하' && k.O6 && !('P6' in k), p.writes);
  t('A9 이미 평가된 줄에 review → ALREADY_REVIEWED', c.planReview(TABF, T3[FACE], 'CE-V2', V('상', ''), false, NOW).error === 'ALREADY_REVIEWED');
  p = c.planReview(TABF, T3[FACE], 'CE-V2', V('하', ''), true, NOW); k = byK(p);
  t('A10 평가 고치기(reviewEdit) 중→하, 한줄의견 비움 → J3 "하"·P3 ""·O3 (3칸), 평가 완료 그대로', p.ok && p.writes.length === 3 && k.J3 === '하' && k.P3 === '' && k.O3 && p.record.reviewState === 'done', p.writes);
  t('A11 미평가 줄에 reviewEdit → NOT_REVIEWED', c.planReview(TABF, T3[FACE], 'CE-V1', V('상', ''), true, NOW).error === 'NOT_REVIEWED');
  t('A12 팀원이 수정 요청 중("요청")인 줄 reviewEdit → EDIT_REQUESTED(먼저 승인·거절)', c.planReview(TABF, T3[FACE], 'CE-V3', V('중', ''), true, NOW).error === 'EDIT_REQUESTED');
  t('A13 seen이 시트 수정일시와 다름 → RECORD_CHANGED', c.planReview(TABF, T3[FACE], 'CE-V1', V('상', '', '2026-10-24 09:00'), false, NOW).error === 'RECORD_CHANGED');
  t('A14 수정일시 빈칸인 줄 + seen "" → 통과', c.planReview(TABF, T3[FACE], 'CE-V5', V('상', '', ''), false, NOW).ok);
  t('A15 추가매출 결과 없는 계획 줄 → NOT_REPLIED · 결과 있는 줄 → ok(I3 "중")', c.planReview(TABA, T3[ADD], 'CE-A1', V('상', ''), false, NOW).error === 'NOT_REPLIED' && byK(c.planReview(TABA, T3[ADD], 'CE-A2', V('중', ''), false, NOW)).I3 === '중');
  p = c.planReview(TABS, T3[SELF], 'CE-S1', V('상', '좋아요'), false, NOW); k = byK(p);
  t('A16 "수정 요청" 칸 없는 탭(자기개발)도 평가 가능 · 평가 칸은 "팀장 의견"(I2)', p.ok && k.I2 === '상' && k.O2 === '좋아요' && k.N2 === '2026-10-29 14:20', p.writes);
  const noOp = [['순번', '이름', '고객사', '팀'].concat(EX), ['1', '이도윤', '가람', '동부', 'CE-X1', 'lee@x.com']];
  t('A17 평가 칸이 없는 탭 → HEADER_NOT_READY', c.planReview(TABF, noOp, 'CE-X1', V('상', ''), false, NOW).error === 'HEADER_NOT_READY');
  t('A18 없는 기록ID → RECORD_NOT_FOUND', c.planReview(TABF, T3[FACE], 'CE-NO', V('상', ''), false, NOW).error === 'RECORD_NOT_FOUND');
  t('A19 내용 칸·수정 요청 칸은 안 씀(쓰는 칸은 평가·한줄의견·수정일시뿐)', ['CE-V1', 'CE-V2'].every(id => (c.planReview(TABF, tabs3()[FACE], id, V('중', 'x'), id === 'CE-V2', NOW).writes || []).every(w => /!(J|P|O)\d+$/.test(w.range))));
}
function makeFakeFirestore() {
  const store = {}; let chain = Promise.resolve();
  function docRef(col, id) {
    const key = col + '/' + id;
    const ref = {
      _key: key,
      get: async () => ({ exists: key in store, ref: ref, data: () => store[key] && JSON.parse(J(store[key])) }),
      set: async d => { store[key] = JSON.parse(J(d)); },
      update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(J(d))); },
      delete: async () => { delete store[key]; }
    };
    return ref;
  }
  return {
    store,
    collection: n => ({ doc: id => docRef(n, id) }),
    // 실제 Firestore처럼 트랜잭션끼리 겹치지 않게 한 줄로 세운다(동시 요청 시험용)
    runTransaction: fn => {
      const run = chain.then(async () => {
        const ops = [];
        const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.update(d)) };
        const out = await fn(tx);
        for (const op of ops) await op();
        return out;
      });
      chain = run.catch(() => {});
      return run;
    }
  };
}
const MRO_ID = '1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU';
const FILE_ID = 'FILE2026';
function makeFakeSheets(tabs, opts) {
  opts = opts || {};
  const st = { tabs: tabs, requests: [], writes: [], deletes: [], failFileRead: false };
  const titles = Object.keys(tabs);
  const trim = rows => rows.map(r => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  function readRange(a1) {
    const i = a1.lastIndexOf('!'); const tab = a1.slice(0, i).replace(/^'|'$/g, '').replace(/''/g, "'"); const rg = a1.slice(i + 1);
    if (tab === '인사평가설정') return [['키', '값', '설명'], ['기록가능기간일', SETTING_WINDOW, '']];
    if (tab === 'CRM-역량평가-기준') return [];
    const rows = st.tabs[tab]; if (!rows) { const e = new Error('Unable to parse range'); e.response = { status: 400 }; throw e; }
    if (rg === '1:1') return trim([rows[0]]);
    return trim(clone(rows));
  }
  st.client = {
    request: async ({ url, method, data }) => {
      st.requests.push({ url, method: method || 'GET', data });
      if (url.endsWith(':batchUpdate') && !url.includes('/values:batchUpdate')) { // spreadsheets.batchUpdate — deleteDimension(ROWS)만 흉내
        if (opts.beforeWrite) opts.beforeWrite(st);
        data.requests.forEach(q => { const d = q.deleteDimension.range; const tab = Object.keys(st.tabs).find(tt => ((tt in GIDS) ? GIDS[tt] : -1) === d.sheetId); st.tabs[tab].splice(d.startIndex, d.endIndex - d.startIndex); st.deletes.push(Object.assign({ tab }, d)); });
        return { data: { replies: [{}] } };
      }
      if (url.includes('/values:batchUpdate')) {
        if (opts.beforeWrite) opts.beforeWrite(st);
        data.data.forEach(d => {
          const i = d.range.lastIndexOf('!'); const tab = d.range.slice(0, i).replace(/^'|'$/g, ''); const m = d.range.slice(i + 1).match(/^([A-Z]+)(\d+)$/);
          let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); col -= 1;
          while (st.tabs[tab].length < Number(m[2])) st.tabs[tab].push([]);
          const row = st.tabs[tab][Number(m[2]) - 1]; while (row.length <= col) row.push(''); row[col] = d.values[0][0];
          st.writes.push(d);
        });
        return { data: { totalUpdatedCells: data.data.length } };
      }
      if (url.includes(FILE_ID + '?fields=')) {
        if (st.failFileRead) { const e = new Error('403'); e.response = { status: 403 }; throw e; }
        return { data: { sheets: titles.map((tt, i) => ({ properties: { sheetId: (tt in GIDS) ? GIDS[tt] : 100 + i, title: tt, hidden: false, index: i } })).concat([{ properties: { sheetId: 9, title: '인사평가설정', index: 50 } }, { properties: { sheetId: 8, title: 'CRM-역량평가-기준', index: 51 } }]) } };
      }
      const q = url.split('?')[1].split('&').filter(s => s.startsWith('ranges=')).map(s => decodeURIComponent(s.slice(7)));
      if (url.includes(MRO_ID)) {
        return { data: { valueRanges: q.map(a1 => ({ values: a1.includes('설정') ? [['인사평가파일_2026', FILE_ID, '']] : USERS })) } };
      }
      if (url.includes(FILE_ID)) {
        if (st.failFileRead) { const e = new Error('403'); e.response = { status: 403 }; throw e; }
        return { data: { valueRanges: q.map(a1 => ({ values: readRange(a1) })) } };
      }
      throw new Error('모르는 요청 ' + url);
    }
  };
  return st;
}
function makeEnv(tabs, opts) {
  const fs_ = makeFakeFirestore();
  const sh = makeFakeSheets(tabs || baseTabs(), opts);
  const exp = new Date(Date.now() + 3600000).toISOString();
  fs_.store['sessions/TOK_ADMIN'] = { email: 'jhjoo@nkmro.com', expiresAt: exp };
  fs_.store['sessions/TOK_STAFF'] = { email: 'kim@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_LEE'] = { email: 'lee@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_EXEC'] = { email: 'ceo@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_PARK'] = { email: 'park@x.com', expiresAt: exp };
  const stubs = {
    '@google-cloud/firestore': { Firestore: class { constructor() { return fs_; } }, FieldValue: { serverTimestamp: () => 'TS' } },
    'google-auth-library': { GoogleAuth: class { async getClient() { return sh.client; } } }
  };
  const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
  const gal = require.resolve('google-auth-library', { paths: [dir] });
  require.cache[gal] = { id: gal, filename: gal, loaded: true, exports: stubs['google-auth-library'] };
  delete require.cache[path.join(dir, 'lib', 'sheetsClient.js')];
  const mod = { exports: {} };
  const ctx = { require: req, module: mod, exports: mod.exports, console: { log() {}, error() {} }, process: { env: {} }, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder, fetch: async () => { throw new Error('fetch 금지'); }, AbortController };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
  const call = (fn) => async (body, method) => {
    const out = {};
    await mod.exports[fn]({ method: method || 'POST', body }, { set() {}, status: code => ({ json: o => { out.httpStatus = code; Object.assign(out, o); }, send() { out.httpStatus = code; } }) });
    return out;
  };
  return { fs: fs_, sh, save: call('saveCompetencyTest'), get: call('getCompetencyTest') };
}
const fileWrites = sh => sh.requests.filter(r => r.method !== 'GET');

const rv = (e, tok, act, tab, rid, grade, line, seen, key) => e.save(Object.assign({ sessionToken: tok, action: act, tab, recordId: rid, grade, line, idempotencyKey: key || 'K' + Math.random() }, seen === undefined ? {} : { seen }));
(async () => {
  let e = makeEnv(tabs3()); let res;
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V1', '상', ' 견적 결과 공유 부탁해요 ', '2026-10-25 09:30');
  t('B1 같은 팀 팀장 평가 → ok 3칸, 시트 J2 "상"·P2 의견, 기록 평가 완료·작성자 lee·이름 이도윤', res.ok && res.updatedCells === 3 && e.sh.tabs[FACE][1][9] === '상' && e.sh.tabs[FACE][1][15] === '견적 결과 공유 부탁해요' && res.record.reviewState === 'done' && res.record.authorEmail === 'lee@x.com' && res.record.name === '이도윤', res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V1', '중', '');
  t('B2 같은 줄 다시 review → ALREADY_REVIEWED(시트 그대로 "상")', res.error === 'ALREADY_REVIEWED' && e.sh.tabs[FACE][1][9] === '상', res);
  let n0 = fileWrites(e.sh).length;
  for (const [tok, err] of [['TOK_EXEC', 'FORBIDDEN'], ['TOK_LEE', 'FORBIDDEN'], ['TOK_STAFF', 'FORBIDDEN'], ['TOK_PARK', 'NOT_YOUR_TEAM']]) {
    res = await rv(e, tok, 'review', 'faceSales', 'CE-V5', '상', '');
    t('B3 ' + tok + ' 평가 → ' + err, res.error === err, res);
  }
  t('B4 거부된 요청은 시트에 안 씀', fileWrites(e.sh).length === n0);
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V4', '상', '');
  t('B5 퇴사자 기록 → MEMBER_LEFT(보기 전용 ⑫)', res.error === 'MEMBER_LEFT' && e.sh.tabs[FACE][4][9] === '', res);
  const r0 = e.sh.requests.length;
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V5', '최상', '');
  t('B6 등급 오류는 시트를 읽기 전에 BAD_GRADE(시트 요청 0건)', res.error === 'BAD_GRADE' && e.sh.requests.length === r0, res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V5', '상', 'ㄱ'.repeat(201));
  t('B7 한줄 의견 201자 → BAD_INPUT(line)', res.error === 'BAD_INPUT' && res.field === 'line', res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V5', '상', '', '2026-10-01 10:00');
  t('B8 화면이 본 수정일시와 다름 → RECORD_CHANGED, 시트 그대로', res.error === 'RECORD_CHANGED' && e.sh.tabs[FACE][5][9] === '', res);
  res = await rv(e, 'TOK_ADMIN', 'reviewEdit', 'faceSales', 'CE-V2', '하', '');
  t('B9 평가 고치기 중→하 + 한줄의견 비움 → ok 3칸, 시트 J3 "하"·P3 ""', res.ok && res.updatedCells === 3 && e.sh.tabs[FACE][2][9] === '하' && e.sh.tabs[FACE][2][15] === '' && res.record.reviewState === 'done', res);
  res = await rv(e, 'TOK_ADMIN', 'reviewEdit', 'faceSales', 'CE-V3', '중', '');
  t('B10 수정 요청 중인 줄 고치기 → EDIT_REQUESTED', res.error === 'EDIT_REQUESTED', res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'editApprove', tab: 'faceSales', recordId: 'CE-V3', idempotencyKey: 'AP1' });
  t('B11 (2-마-1) 승인 → 미평가로', res.ok && res.record.reviewState === 'pendingReview', res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V3', '중', '날짜 확인했어요', res.record.fields['수정일시']);
  t('B12 승인된 줄 다시 평가 → 평가 완료, "수정 요청" 칸의 "승인 …" 이력은 그대로', res.ok && e.sh.tabs[FACE][3][9] === '중' && /^승인 /.test(e.sh.tabs[FACE][3][17]) && res.record.reviewState === 'done', res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'addSales', 'CE-A1', '상', '');
  t('B13 추가매출 계획 줄(결과 없음) → NOT_REPLIED', res.error === 'NOT_REPLIED', res);
  res = await rv(e, 'TOK_ADMIN', 'review', 'selfDev', 'CE-S1', '상', '');
  t('B14 수정 요청 칸 없는 탭(자기개발) 평가 → ok', res.ok && e.sh.tabs[SELF][1][8] === '상', res);
  const w1 = e.sh.writes.length;
  const a1 = await rv(e, 'TOK_ADMIN', 'review', 'addSales', 'CE-A2', '중', '', undefined, 'SAME');
  const a2 = await rv(e, 'TOK_ADMIN', 'review', 'addSales', 'CE-A2', '중', '', undefined, 'SAME');
  t('B15 같은 중복 방지 키로 두 번 → 두 번째는 저장된 결과(쓰기 1번)', a1.ok && a2.ok && e.sh.writes.length === w1 + 2, { a1, a2, w: e.sh.writes.length - w1 });
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'review', tab: 'faceSales', grade: '상', idempotencyKey: 'X' });
  t('B16 기록ID 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  const g = await e.get({ sessionToken: 'TOK_LEE', view: 'mine' });
  const recV1 = g.records && g.records.faceSales && g.records.faceSales.find(x => x.recordId === 'CE-V1');
  t('B17 팀원 화면(mine): 평가 완료 + 팀장 의견 "상" + 팀장한줄의견이 fields로 옴', g.ok && recV1 && recV1.reviewState === 'done' && recV1.leaderOpinion === '상' && recV1.fields['팀장한줄의견'] === '견적 결과 공유 부탁해요', recV1);
  e.sh.failFileRead = true;
  res = await rv(e, 'TOK_ADMIN', 'review', 'faceSales', 'CE-V5', '상', '');
  t('B18 시트 읽기 실패 → SHEET_ACCESS_FAILED(403)', res.error === 'SHEET_ACCESS_FAILED' && res.httpStatus === 403, res);
  console.log(`pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
