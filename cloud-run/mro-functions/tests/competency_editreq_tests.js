// node tests/competency_editreq_tests.js — 2-마-1 평가 완료 기록 1회 수정 요청(editRequest)·팀장 승인(editApprove)·거절(editReject) 시험 (실제 Google·Firestore 접속 0건)
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


// 이 시험의 사용자: 동부 팀장(jhjoo) · 동부 팀원 김하늘(담당)·이도윤(일반) · 서부 팀장 박서부(park) · 임원(ceo)
USERS = USERS.concat([U('park@x.com', '박서부', '팀장', '서부', '활성', '대구'), U('ceo@x.com', '대표', '임원', '', '활성', '')]);
const RQ = '수정 요청';
const FACE_H2 = FACE_H.concat([RQ]);
const ADD_H2 = ['사무소', '담당', '구분', '고객사', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀'].concat(EX, [RQ]);
const SELF_H2 = SELF_H.concat([RQ]);
function tabs2() {
  return {
    [FACE]: [FACE_H2,
      ['1', '이도윤', '김해', '가람산업', '최민수', '부장', OLD, '30', '견적 요청', '중 (2610)', '동부', 'CE-R1', 'lee@x.com', '2026-01-01 10:00', '', '좋음', '', ''], // 2행: 평가 완료 + 한줄의견, 요청 없음
      ['2', '이도윤', '김해', '나래기공', '정다은', '대리', OLD, '40', '수주', '', '동부', 'CE-R2', 'lee@x.com'],                                       // 3행: 미평가
      ['3', '이도윤', '김해', '마루산업', '최민수', '부장', OLD, '60', '단가 계약', '상 (2610)', '동부', 'CE-R3', 'lee@x.com', '', '', '', '', '거절 2026-10-20 10:00 · 사유: 날짜 오류'], // 4행: 1회 사용(거절)
      ['4', '김하늘', '양산', '다온화학', '박부장', '부장', OLD, '20', '분기 견적', '하 (2610)', '동부', 'CE-R4', 'kim@x.com']],                         // 5행: 남의 평가 완료 줄
    [SELF]: [SELF_H2, ['1', '이도윤', '김해', '엑셀 고급', '자동화', '2607~2609', 'Y', '정리 시간 절반', '상', '동부', 'CE-S1', 'lee@x.com', '', '', '', '', '']],
    [ADD]: [ADD_H2, ['김해', '이도윤', '품목확대', '아라전자', 'Y', '2609~2610', '매출 1,000천원 / 이익 100천원', '1234567', '중', '동부', 'CE-A1', 'lee@x.com']],
    [COST]: [COST_H, ['1', '이도윤', '김해', '아라전자', '한빛상사', '포장재', '규격', '2610~', 'Y', '개선 200천원 / 월 평균', '1234567', '상', '동부', 'CE-C1', 'lee@x.com']] // '수정 요청' 칸 없는 탭
  };
}
// ── A. 순수 함수 ──
{
  const now = Date.UTC(2026, 9, 28, 5, 20); // 서울 14:20
  t('A1 사유 검사: 빈칸·201자 → BAD_INPUT(reason), 줄바꿈은 띄어쓰기로', c.validateEditReason('  ').field === 'reason' && c.validateEditReason('가'.repeat(201)).error === 'BAD_INPUT' && c.validateEditReason('끝 달\n잘못').reason === '끝 달 잘못' && c.validateEditReason('가'.repeat(200)).ok);
  const tb = tabs2(); const TAB = { id: 'faceSales', title: FACE };
  const p1 = c.planEditRequest(TAB, tb[FACE], 'CE-R1', 'LEE@x.com ', '끝 달 수정', now);
  t('A2 평가 완료 본인 줄 요청 → 수정 요청 칸(R2) 1칸 "요청 2026-10-28 14:20 · 사유: 끝 달 수정", 상태는 평가 완료 그대로', p1.ok && p1.writes.length === 1 && /!R2$/.test(p1.writes[0].range) && p1.writes[0].value === '요청 2026-10-28 14:20 · 사유: 끝 달 수정' && p1.record.reviewState === 'done' && p1.record.leaderOpinion === '중 (2610)', p1);
  t('A3 요청 거부: 미평가 → NOT_REVIEWED / 이미 1회 씀 → ALREADY_REQUESTED / 남의 줄 → NOT_YOUR_RECORD / 칸 없는 탭 → HEADER_NOT_READY',
    c.planEditRequest(TAB, tb[FACE], 'CE-R2', 'lee@x.com', 'x', now).error === 'NOT_REVIEWED' && c.planEditRequest(TAB, tb[FACE], 'CE-R3', 'lee@x.com', 'x', now).error === 'ALREADY_REQUESTED' &&
    c.planEditRequest(TAB, tb[FACE], 'CE-R4', 'lee@x.com', 'x', now).error === 'NOT_YOUR_RECORD' && c.planEditRequest({ id: 'costSave', title: COST }, tb[COST], 'CE-C1', 'lee@x.com', 'x', now).error === 'HEADER_NOT_READY');
  const tb2 = tabs2(); tb2[FACE][1][17] = '요청 2026-10-28 14:20 · 사유: 끝 달 · 수정';
  const ap = c.planEditDecide(TAB, tb2[FACE], 'CE-R1', true, now);
  const byK = {}; (ap.writes || []).forEach(w => { byK[w.range.split('!')[1]] = w.value; });
  t('A4 승인 → 팀장 의견(J2)·팀장한줄의견(P2) 비움 + R2 "승인 … · 이전 평가: 중 (2610) / 한줄: 좋음 · 사유: 끝 달 · 수정" → 미평가, 작성자 lee', ap.ok && byK.J2 === '' && byK.P2 === '' && byK.R2 === '승인 2026-10-28 14:20 · 이전 평가: 중 (2610) / 한줄: 좋음 · 사유: 끝 달 · 수정' && ap.record.reviewState === 'pendingReview' && ap.authorEmail === 'lee@x.com', byK);
  const rj = c.planEditDecide(TAB, tb2[FACE], 'CE-R1', false, now);
  t('A5 거절 → R2만 "거절 … · 사유: …", 평가 그대로(평가 완료)', rj.ok && rj.writes.length === 1 && rj.writes[0].value === '거절 2026-10-28 14:20 · 사유: 끝 달 · 수정' && rj.record.reviewState === 'done', rj.writes);
  t('A6 요청 없는 줄·거절된 줄 승인 → NOT_REQUESTED', c.planEditDecide(TAB, tb[FACE], 'CE-R1', true, now).error === 'NOT_REQUESTED' && c.planEditDecide(TAB, tb[FACE], 'CE-R3', true, now).error === 'NOT_REQUESTED');
  const pr = c.parseEditRequest(byK.R2);
  t('A7 parseEditRequest: 승인 글자 → state·at·이전 평가·사유(사유 안의 " · " 유지) / 빈칸 → null / 모르는 글자 → 기타', pr.state === '승인' && pr.at === '2026-10-28 14:20' && pr.prev === '중 (2610) / 한줄: 좋음' && pr.reason === '끝 달 · 수정' && c.parseEditRequest(' ') === null && c.parseEditRequest('메모').state === '기타', pr);
  // 승인된 뒤: 고치기는 되고 지우기는 안 됨
  const tb3 = tabs2(); tb3[FACE][1][9] = ''; tb3[FACE][1][15] = ''; tb3[FACE][1][17] = byK.R2;
  const vF = c.validateCreate('faceSales', { customer: '가람산업', people: [{ name: '최민수', rank: '부장' }], meetDate: '2026-01-01', meetHour: 10, minutes: 30, expected: '견적 요청 (고침)' });
  t('A8 승인된 줄: 고치기 ok / 지우기 → APPROVED_EDIT_ONLY', c.planUpdate(TAB, tb3[FACE], 'CE-R1', 'lee@x.com', vF, now).ok && c.planDelete(tb3[FACE], 'CE-R1', 'lee@x.com').error === 'APPROVED_EDIT_ONLY');
  const ta = tabs2(); ta[ADD][1][8] = ''; ta[ADD][1][16] = '승인 2026-10-28 14:20 · 이전 평가: 중 · 사유: 결산'; const TA = { id: 'addSales', title: ADD };
  t('A9 추가매출 승인된 줄: 결과 고치기 ok / 결과 지우기 → APPROVED_EDIT_ONLY', c.planReplyEdit(TA, ta[ADD], 'CE-A1', 'lee@x.com', c.validateReply({ achieved: 'N' }), now, false).ok && c.planReplyEdit(TA, ta[ADD], 'CE-A1', 'lee@x.com', null, now, true).error === 'APPROVED_EDIT_ONLY');
  t('A10 원본 값 배열은 바꾸지 않음', J(tb) === J(tabs2()));
  const H = FACE_H.slice(0, 10).concat([RQ, '팀'], EX);
  t('A11 위치: "수정 요청"을 "팀" 바로 왼쪽에 넣으면 머리글 점검(끝 6칸·팀 칸) 통과 / "첨부" 오른쪽에 넣으면 끝 6칸 점검 실패(그래서 "팀" 왼쪽에 넣음)', c.checkHeaderRow(H).ok && c.checkTeamColumn(H).ok && !c.checkHeaderRow(FACE_H.concat([RQ])).ok);
  const tbH = tabs2(); tbH[FACE] = [H].concat(tbH[FACE].slice(1).map(r => r.slice(0, 10).concat([r[17] || '', r[10]], r.slice(11, 17))));
  const pH = c.planEditRequest(TAB, tbH[FACE], 'CE-R1', 'lee@x.com', '위치 시험', now);
  t('A12 "팀" 왼쪽(K열)에 있어도 이름으로 찾아 K2에 씀', pH.ok && /!K2$/.test(pH.writes[0].range), pH.writes);
}

// ── B. index.js 그대로 실행 ──
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
const upd = (e, tok, form, tab, rid, extra) => e.save(Object.assign({ sessionToken: tok, action: 'update', form, tab, recordId: rid, idempotencyKey: 'K' + Math.random() }, extra || {}));
const del = (e, tok, tab, rid, key) => e.save({ sessionToken: tok, action: 'delete', tab, recordId: rid, idempotencyKey: key || 'K' + Math.random() });

const rq = (e, tok, tab, rid, reason, key) => e.save({ sessionToken: tok, action: 'editRequest', tab, recordId: rid, reason, idempotencyKey: key || 'K' + Math.random() });
const dc = (e, tok, act, tab, rid, key) => e.save({ sessionToken: tok, action: act, tab, recordId: rid, idempotencyKey: key || 'K' + Math.random() });
(async () => {
  let e = makeEnv(tabs2()); let res;
  res = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', ' 끝 달을 잘못 골랐어요 ');
  t('B1 팀원 요청 → ok 1칸, 시트 R2 "요청 … · 사유: 끝 달을 잘못 골랐어요", 기록은 평가 완료·이름 이도윤', res.ok && res.updatedCells === 1 && /^요청 \d{4}-\d{2}-\d{2} \d{2}:\d{2} · 사유: 끝 달을 잘못 골랐어요$/.test(e.sh.tabs[FACE][1][17]) && res.record.reviewState === 'done' && res.record.name === '이도윤' && res.record.authorStatus === 'active', res);
  res = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', '한 번 더');
  t('B2 같은 줄 두 번째 요청 → ALREADY_REQUESTED', res.error === 'ALREADY_REQUESTED', res);
  let n0 = fileWrites(e.sh).length;
  res = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', '');
  t('B3 사유 빈칸 → BAD_INPUT(reason), 시트를 읽지도 쓰지도 않음', res.error === 'BAD_INPUT' && res.field === 'reason' && fileWrites(e.sh).length === n0 && !e.sh.requests.slice(-1)[0].url.includes('reason'), res);
  res = await rq(e, 'TOK_ADMIN', 'faceSales', 'CE-R4', '대신 요청');
  t('B4 팀장이 요청 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  res = await dc(e, 'TOK_STAFF', 'editApprove', 'faceSales', 'CE-R1');
  t('B5 팀원(담당)이 승인 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  res = await dc(e, 'TOK_EXEC', 'editApprove', 'faceSales', 'CE-R1');
  t('B6 임원이 승인 → FORBIDDEN(보기만)', res.error === 'FORBIDDEN', res);
  res = await dc(e, 'TOK_PARK', 'editApprove', 'faceSales', 'CE-R1');
  t('B7 다른 팀(서부) 팀장이 승인 → NOT_YOUR_TEAM, 쓰기 없음', res.error === 'NOT_YOUR_TEAM' && e.sh.tabs[FACE][1][9] === '중 (2610)', res);
  n0 = e.sh.writes.length;
  res = await dc(e, 'TOK_ADMIN', 'editApprove', 'faceSales', 'CE-R1');
  t('B8 같은 팀 팀장 승인 → 팀장 의견·한줄의견 비움 + "승인 … · 이전 평가: 중 (2610) / 한줄: 좋음 · 사유: …", 3칸, 기록 미평가·작성자 lee', res.ok && res.updatedCells === 3 && e.sh.tabs[FACE][1][9] === '' && e.sh.tabs[FACE][1][15] === '' && /^승인 .* · 이전 평가: 중 \(2610\) \/ 한줄: 좋음 · 사유: 끝 달을 잘못 골랐어요$/.test(e.sh.tabs[FACE][1][17]) && res.record.reviewState === 'pendingReview' && res.record.authorEmail === 'lee@x.com' && e.sh.writes.length === n0 + 3, res);
  res = await dc(e, 'TOK_ADMIN', 'editApprove', 'faceSales', 'CE-R1');
  t('B9 이미 승인된 줄 다시 승인 → NOT_REQUESTED', res.error === 'NOT_REQUESTED', res);
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-R1', { customer: '가람산업', people: [{ name: '최민수', rank: '부장' }], meetDate: '2026-01-01', meetHour: 10, minutes: 30, expected: '견적 요청 (승인 뒤 고침)' });
  t('B10 승인 뒤 팀원 고치기 → ok(오래된 날짜 그대로라 날짜 검사 없음)', res.ok && e.sh.tabs[FACE][1][8] === '견적 요청 (승인 뒤 고침)', res);
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-R1');
  t('B11 승인 뒤 지우기 → APPROVED_EDIT_ONLY, 줄 그대로', res.error === 'APPROVED_EDIT_ONLY' && e.sh.tabs[FACE].length === 5 && e.sh.deletes.length === 0, res);
  res = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', '또');
  t('B12 승인 뒤(평가 전) 다시 요청 → NOT_REVIEWED', res.error === 'NOT_REVIEWED', res);
  // 거절
  res = await rq(e, 'TOK_LEE', 'selfDev', 'CE-S1', '기간 수정');
  const r2 = await dc(e, 'TOK_ADMIN', 'editReject', 'selfDev', 'CE-S1');
  t('B13 자기개발 요청 → 거절: 칸 "거절 … · 사유: 기간 수정", 평가(상) 그대로', res.ok && r2.ok && r2.updatedCells === 1 && /^거절 .* · 사유: 기간 수정$/.test(e.sh.tabs[SELF][1][16]) && e.sh.tabs[SELF][1][8] === '상' && r2.record.reviewState === 'done', r2);
  res = await rq(e, 'TOK_LEE', 'selfDev', 'CE-S1', '다시');
  t('B14 거절된 줄 다시 요청 → ALREADY_REQUESTED(1회 사용)', res.error === 'ALREADY_REQUESTED', res);
  // 추가매출
  res = await rq(e, 'TOK_LEE', 'addSales', 'CE-A1', '결산 숫자 오타');
  const r3 = await dc(e, 'TOK_ADMIN', 'editApprove', 'addSales', 'CE-A1');
  t('B15 추가매출 요청 → 승인 → 팀장 의견 비움, 결과 칸 그대로, 미평가', res.ok && r3.ok && e.sh.tabs[ADD][1][8] === '' && e.sh.tabs[ADD][1][6] === '매출 1,000천원 / 이익 100천원' && r3.record.reviewState === 'pendingReview', r3);
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'replyClear', tab: 'addSales', recordId: 'CE-A1', idempotencyKey: 'K' + Math.random() });
  t('B16 추가매출 승인 뒤 결과 지우기 → APPROVED_EDIT_ONLY', res.error === 'APPROVED_EDIT_ONLY', res);
  res = await rq(e, 'TOK_LEE', 'costSave', 'CE-C1', '개선액');
  t('B17 수정 요청 칸이 없는 탭(원가개선) → HEADER_NOT_READY', res.error === 'HEADER_NOT_READY', res);
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'editRequest', tab: 'faceSales', reason: 'x', idempotencyKey: 'K1' });
  t('B18 recordId 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  // 중복 방지: 같은 키로 다시 → 같은 결과, 쓰기 1번
  e = makeEnv(tabs2());
  const a1 = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', '사유', 'SAME');
  const w1 = e.sh.writes.length;
  const a2 = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R1', '사유', 'SAME');
  t('B19 같은 중복 방지 키로 두 번 → 두 번째는 저장된 결과(쓰기 1번)', a1.ok && a2.ok && e.sh.writes.length === w1, { a1, a2 });
  // 화면 데이터: getCompetencyTest mine 응답에 '수정 요청' 칸이 fields로 그대로 온다(서버 보기 코드는 바뀌지 않음)
  const g = await e.get({ sessionToken: 'TOK_LEE', view: 'mine' });
  const rec = g.records && g.records.faceSales && g.records.faceSales.find(x => x.recordId === 'CE-R1');
  t('B20 getCompetencyTest(mine): 기록 fields에 "수정 요청" 글자가 그대로 → 화면이 상태를 읽음', g.ok && rec && /^요청 /.test(rec.fields['수정 요청']) && rec.reviewState === 'done', rec);
  e.sh.failFileRead = true;
  res = await rq(e, 'TOK_LEE', 'faceSales', 'CE-R2', '사유');
  t('B21 시트 읽기 실패 → SHEET_ACCESS_FAILED(403)', res.error === 'SHEET_ACCESS_FAILED' && res.httpStatus === 403, res);
  console.log(`pass ${pass} / fail ${fail}`);
  process.exit(fail ? 1 : 0);
})();
