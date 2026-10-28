// node tests/competency_edit_tests.js — 2-라 팀원 본인 기록 고치기(action update)·지우기(action delete) 시험 (실제 Google·Firestore 접속 0건)
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

// ── A. 순수 함수 ──
{
  const tb = baseTabs(); const TAB = { id: 'faceSales', title: FACE }; const now = Date.UTC(2026, 9, 28, 3, 0);
  const vSame = c.validateCreate('faceSales', FACE_V);
  t('A1 바뀐 칸 없음 → NO_CHANGE', c.planUpdate(TAB, tb[FACE], 'CE-F1', 'lee@x.com', vSame, now).error === 'NO_CHANGE');
  const p1 = c.planUpdate(TAB, tb[FACE], 'CE-F1', 'LEE@x.com ', c.validateCreate('faceSales', Object.assign({}, FACE_V, { expected: '견적 요청 + 샘플 전달' })), now);
  t('A2 기대 성과만 고침 → I2·수정일시(O2) 2칸, 날짜 검사 필요 없음(오래된 기록도 고칠 수 있음)', p1.ok && J(p1.writes.map(w => w.range.split('!')[1])) === J(['I2', 'O2']) && p1.writes[0].value === '견적 요청 + 샘플 전달' && p1.needDateCheck === false && p1.record.reviewState === 'pendingReview', p1);
  const p2 = c.planUpdate(TAB, tb[FACE], 'CE-F1', 'lee@x.com', c.validateCreate('faceSales', Object.assign({}, FACE_V, { meetHour: 11 })), now);
  t('A3 미팅 일시 고침 → needDateCheck', p2.ok && p2.needDateCheck === true && p2.writes[0].value === '260101-11', p2);
  const p3 = c.planUpdate(TAB, tb[FACE], 'CE-F2', 'lee@x.com', c.validateCreate('faceSales', Object.assign({}, FACE_V, { customer: '나래기공', people: [{ name: '정다은', rank: '대리' }], minutes: 40, expected: '수주 확정' })), now);
  t('A4 평가 완료 줄은 고치기 거부 → ALREADY_REVIEWED(2026-10-28: 팀장에게 1회 요청은 2-마)', p3.error === 'ALREADY_REVIEWED', p3);
  t('A5 남의 줄 → NOT_YOUR_RECORD, 없는 ID → RECORD_NOT_FOUND', c.planUpdate(TAB, tb[FACE], 'CE-F3', 'lee@x.com', vSame, now).error === 'NOT_YOUR_RECORD' && c.planUpdate(TAB, tb[FACE], 'CE-X', 'lee@x.com', vSame, now).error === 'RECORD_NOT_FOUND');
  const vc = c.validateCreate('costSave', { customer: '아라전자', supplier: '한빛상사', item: '포장재 변경', reason: '규격 표준화', done: 'N' });
  const pc = c.planUpdate({ id: 'costSave', title: COST }, tb[COST], 'CE-C1', 'lee@x.com', vc, now);
  const byK = {}; (pc.writes || []).forEach(w => { byK[w.range.split('!')[1]] = w.value; });
  t('A6 원가개선 Y→N 고침 → 완료 여부 N, 기간·개선액·아이템키 빈칸으로 + 수정일시', pc.ok && byK.I2 === 'N' && byK.H2 === '' && byK.J2 === '' && byK.K2 === '' && pc.needDateCheck === false, byK);
  t('A7 추가매출 줄 → NOT_EDITABLE / 삭제 NOT_DELETABLE', c.planUpdate({ id: 'addSales', title: ADD }, tb[ADD], 'CE-A1', 'lee@x.com', vc, now).error === 'NOT_EDITABLE' && c.planDelete(tb[ADD], 'CE-A1', 'lee@x.com').error === 'NOT_DELETABLE');
  t('A8 삭제: 미평가 본인 줄 → rowIndex 1(2행), 평가 완료 → ALREADY_REVIEWED, 남의 줄 → NOT_YOUR_RECORD', c.planDelete(tb[FACE], 'CE-F1', 'lee@x.com').rowIndex === 1 && c.planDelete(tb[FACE], 'CE-F2', 'lee@x.com').error === 'ALREADY_REVIEWED' && c.planDelete(tb[FACE], 'CE-F3', 'lee@x.com').error === 'NOT_YOUR_RECORD');
  t('A9 원본 값 배열은 바꾸지 않음', J(tb) === J(baseTabs()));
}


{
  const tb = baseTabs(); const TAB = { id: 'addSales', title: ADD }; const now = Date.UTC(2026, 9, 28, 3, 0);
  const Y = { achieved: 'Y', reflectFrom: '2609', reflectTo: '2610', settleSales: '1,200', settleProfit: '120', itemKeys: '1234567' };
  const e1 = c.planReplyEdit(TAB, tb[ADD], 'CE-A2', 'lee@x.com', c.validateReply(Y), now, false);
  t('A10 결과 고치기: 결산만 바뀜 → 결산(G3)·수정일시 2칸', e1.ok && J(e1.writes.map(w => w.range.split('!')[1])) === J(['G3', 'N3']) && e1.writes[0].value === '매출 1,200천원 / 이익 120천원' && e1.record.reviewState === 'pendingReview', e1);
  const e2 = c.planReplyEdit(TAB, tb[ADD], 'CE-A2', 'lee@x.com', c.validateReply({ achieved: 'N' }), now, false);
  t('A11 Y→N 고치기 → 달성 N, 시점·결산·아이템키 비움', e2.ok && J(e2.writes.map(w => w.value).slice(0, 4)) === J(['N', '', '', '']), e2.writes);
  const e3 = c.planReplyEdit(TAB, tb[ADD], 'CE-A4', 'lee@x.com', c.validateReply(Object.assign({}, Y, { settleSales: '', reflectTo: '', reflectOpen: true })), now, false);
  t('A12 이익개선 N→Y → 결산 "이익 120천원 / 월 평균"', e3.ok && e3.writes.find(w => /!G5$/.test(w.range)).value === '이익 120천원 / 월 평균', e3.writes);
  t('A13 평가 완료(CE-A3) → 고치기·지우기 ALREADY_REVIEWED / 결과 없는 줄(CE-A1) → NOT_REPLIED / 같은 값 → NO_CHANGE',
    c.planReplyEdit(TAB, tb[ADD], 'CE-A3', 'lee@x.com', c.validateReply(Y), now, false).error === 'ALREADY_REVIEWED' && c.planReplyEdit(TAB, tb[ADD], 'CE-A3', 'lee@x.com', null, now, true).error === 'ALREADY_REVIEWED' &&
    c.planReplyEdit(TAB, tb[ADD], 'CE-A1', 'lee@x.com', c.validateReply(Y), now, false).error === 'NOT_REPLIED' &&
    c.planReplyEdit(TAB, tb[ADD], 'CE-A2', 'lee@x.com', c.validateReply(Object.assign({}, Y, { settleSales: '1,000', settleProfit: '100' })), now, false).error === 'NO_CHANGE');
  const e4 = c.planReplyEdit(TAB, tb[ADD], 'CE-A2', 'lee@x.com', null, now, true);
  t('A14 결과 지우기 → 4칸 비움 + 수정일시, 다시 계획(awaitingReply)', e4.ok && J(e4.writes.map(w => w.value).slice(0, 4)) === J(['', '', '', '']) && e4.record.reviewState === 'awaitingReply', e4);
}

// ── A-직급역량 (2026-10-28: 5개 탭 모두 고치기·지우기 — 직급역량도 따로 확인) ──
{
  const GRADE = '역량-직급별업무역량-직급역량';
  const GRADE_H = ['순번', '이름', '사무소', '개선 직급 역량 항목', '직급 역량 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '자기 성취 평가', '팀장 의견', '팀'].concat(EX);
  const rows = [GRADE_H, ['1', '이도윤', '김해', '산업안전기사', '법규 설명', '', 'N', '', '', '동부', 'CE-G1', 'lee@x.com'], ['2', '이도윤', '김해', '원가 분석', '보고서 품질', '2607~2609', 'Y', '보고서 3건', '상', '동부', 'CE-G2', 'lee@x.com']];
  const now = Date.UTC(2026, 9, 28, 3, 0); const TAB = { id: 'gradeComp', title: GRADE };
  const v = c.validateCreate('gradeComp', { item: '산업안전기사 자격 취득', reason: '법규 설명', done: 'N' });
  const g1 = c.planUpdate(TAB, rows, 'CE-G1', 'lee@x.com', v, now);
  t('AG1 직급역량 미평가 줄 항목 고침 → D2·수정일시(N2) 2칸', g1.ok && J(g1.writes.map(w => w.range.split('!')[1])) === J(['D2', 'N2']) && g1.writes[0].value === '산업안전기사 자격 취득' && g1.needDateCheck === false, g1);
  t('AG2 직급역량 평가 완료 줄 → 고치기·지우기 ALREADY_REVIEWED / 미평가 줄 지우기 → rowIndex 1', c.planUpdate(TAB, rows, 'CE-G2', 'lee@x.com', v, now).error === 'ALREADY_REVIEWED' && c.planDelete(rows, 'CE-G2', 'lee@x.com').error === 'ALREADY_REVIEWED' && c.planDelete(rows, 'CE-G1', 'lee@x.com').rowIndex === 1);
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
(async () => {
  let e = makeEnv(); let res;
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F1', Object.assign({}, FACE_V, { expected: '견적 요청 + 샘플 전달' }));
  t('B1 오래된 본인 줄 내용만 고침 → ok 2칸(날짜 검사 안 함)', res.ok && res.updatedCells === 2 && e.sh.tabs[FACE][1][8] === '견적 요청 + 샘플 전달' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.sh.tabs[FACE][1][14]), res);
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F1', Object.assign({}, FACE_V, { expected: '견적 요청 + 샘플 전달', meetHour: 11 }));
  t('B2 미팅 일시를 오래된 날짜로 바꾸면 → DATE_TOO_OLD(meetDate), 쓰기 없음', res.error === 'DATE_TOO_OLD' && res.field === 'meetDate' && e.sh.tabs[FACE][1][6] === OLD, res);
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F1', Object.assign({}, FACE_V, { expected: '견적 요청 + 샘플 전달', meetDate: daysAgo(2), meetHour: 9 }));
  t('B3 미팅 일시를 최근 14일 안으로 → ok', res.ok && e.sh.tabs[FACE][1][6] === yymmddhh(daysAgo(2), '09'), res);
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F1', Object.assign({}, FACE_V, { expected: '견적 요청 + 샘플 전달', meetDate: daysAgo(2), meetHour: 9 }));
  t('B4 같은 값으로 다시 → NO_CHANGE', res.error === 'NO_CHANGE', res);
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F2', Object.assign({}, FACE_V, { customer: '나래기공', people: [{ name: '정다은', rank: '대리' }], minutes: 40, expected: '수주 확정' }));
  const r3 = e.sh.tabs[FACE][2];
  t('B5 평가 완료 줄 고침 → ALREADY_REVIEWED, 팀장 의견 그대로', res.error === 'ALREADY_REVIEWED' && r3[9] === '중 (2610)', { res, r3 });
  res = await upd(e, 'TOK_LEE', 'faceSales', 'faceSales', 'CE-F3', FACE_V);
  t('B6 남의 줄 → NOT_YOUR_RECORD', res.error === 'NOT_YOUR_RECORD', res);
  res = await upd(e, 'TOK_ADMIN', 'faceSales', 'faceSales', 'CE-F1', FACE_V);
  t('B7 팀장 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  res = await upd(e, 'TOK_LEE', 'costSave', 'faceSales', 'CE-F1', { customer: 'x', supplier: 'y', item: 'z', reason: 'r', done: 'N' });
  t('B8 원가개선 입력으로 대면영업 줄 → TAB_NOT_SUPPORTED', res.error === 'TAB_NOT_SUPPORTED', res);
  res = await upd(e, 'TOK_LEE', 'selfDev', 'selfDev', 'CE-S1', { item: '엑셀 고급', reason: '정리 시간 단축', done: 'Y', periodFrom: ymOf(daysAgo(40)), periodTo: ymOf(TODAY), evaluation: '수료' });
  const s3 = e.sh.tabs[SELF][2];
  t('B9 자기개발 N→Y 고침(기간 바뀜 → 달 검사 통과) → 기간·평가 채움', res.ok && s3[6] === 'Y' && s3[5] === ymOf(daysAgo(40)) + '~' + ymOf(TODAY) && s3[7] === '수료', { res, s3 });
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'update', tab: 'faceSales', recordId: 'CE-F1', idempotencyKey: 'x' });
  t('B10 form 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  // 지우기
  e = makeEnv();
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F2');
  t('B11 평가 완료 줄 지우기 → ALREADY_REVIEWED, 지운 줄 없음', res.error === 'ALREADY_REVIEWED' && !e.sh.deletes.length, res);
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F3');
  t('B12 남의 줄 → NOT_YOUR_RECORD', res.error === 'NOT_YOUR_RECORD', res);
  res = await del(e, 'TOK_LEE', 'addSales', 'CE-A1');
  t('B13 추가매출 줄 → NOT_DELETABLE', res.error === 'NOT_DELETABLE', res);
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F4', 'D1');
  t('B14 미평가 본인 줄(5행) 지우기 → ok, deleteDimension sheetId 1204504857 · 4~5(5행), 시트 4줄 남음', res.ok && e.sh.deletes.length === 1 && e.sh.deletes[0].sheetId === 1204504857 && e.sh.deletes[0].startIndex === 4 && e.sh.deletes[0].endIndex === 5 && e.sh.tabs[FACE].length === 4 && !e.sh.tabs[FACE].some(r => r[11] === 'CE-F4') && res.deleted.recordId === 'CE-F4', { res, d: e.sh.deletes });
  const dreq = fileWrites(e.sh).find(r => r.url.endsWith(':batchUpdate') && !r.url.includes('/values:'));
  t('B15 쓰기 요청 = spreadsheets/{id}:batchUpdate 1번, requests[0].deleteDimension.range.dimension ROWS', dreq && dreq.url.endsWith('/FILE2026:batchUpdate') && dreq.data.requests[0].deleteDimension.range.dimension === 'ROWS', dreq);
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F4', 'D1');
  t('B16 같은 키로 다시(두 번 누름) → 같은 응답, 더 지우지 않음', res.ok && e.sh.deletes.length === 1, res);
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F4', 'D2');
  t('B17 새 키로 이미 지운 줄 → RECORD_NOT_FOUND', res.error === 'RECORD_NOT_FOUND', res);
  res = await del(e, 'TOK_LEE', 'selfDev', 'CE-S1');
  t('B18 자기개발 지우기 → 3행(index 2), 2행 빈 줄(순번 1)은 그대로', res.ok && e.sh.deletes[1].sheetId === 0 && e.sh.deletes[1].startIndex === 2 && J(e.sh.tabs[SELF][1]) === J(['1']), e.sh.deletes);
  // 잠금·오류
  e = makeEnv(); e.fs.store['writeLocks/competencyEval'] = { lockedAt: new Date().toISOString(), holderId: 'other' };
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F1');
  t('B19 잠금을 못 잡으면 LOCK_TIMEOUT, 지운 줄 없음', res.error === 'LOCK_TIMEOUT' && !e.sh.deletes.length, res);
  e = makeEnv(null, { beforeWrite: () => { throw new Error('backendError'); } });
  res = await del(e, 'TOK_LEE', 'faceSales', 'CE-F1', 'E1');
  t('B20 지우기 오류 → 500, 잠금 풀림, 중복 방지 문서 지워짐', res.httpStatus === 500 && !('writeLocks/competencyEval' in e.fs.store) && !('writeIdempotency/E1' in e.fs.store), res);

  // 추가매출 결과 고치기·지우기
  e = makeEnv();
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'replyEdit', tab: 'addSales', recordId: 'CE-A2', idempotencyKey: 'R1', achieved: 'Y', reflectFrom: '2609', reflectTo: '', reflectOpen: true, settleSales: '300', settleProfit: '30', itemKeys: '1234567' });
  const a3 = e.sh.tabs[ADD][2];
  t('B21 결과 고치기(끝 없음) → 시점 "2609~", 결산 "… / 월 평균", 미평가 그대로', res.ok && a3[5] === '2609~' && a3[6] === '매출 300천원 / 이익 30천원 / 월 평균' && res.record.reviewState === 'pendingReview', { res, a3 });
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'replyClear', tab: 'addSales', recordId: 'CE-A2', idempotencyKey: 'R2' });
  t('B22 결과 지우기 → 4칸 빈칸, 다시 계획', res.ok && !e.sh.tabs[ADD][2][4] && !e.sh.tabs[ADD][2][5] && !e.sh.tabs[ADD][2][6] && !e.sh.tabs[ADD][2][7] && res.record.reviewState === 'awaitingReply', res);
  res = await e.save({ sessionToken: 'TOK_LEE', action: 'replyClear', tab: 'addSales', recordId: 'CE-A3', idempotencyKey: 'R3' });
  t('B23 평가 완료 결과 지우기 → ALREADY_REVIEWED', res.error === 'ALREADY_REVIEWED', res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'replyEdit', tab: 'addSales', recordId: 'CE-A2', idempotencyKey: 'R4', achieved: 'N' });
  t('B24 팀장 → FORBIDDEN', res.error === 'FORBIDDEN', res);

  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
