// node tests/competency_reply_tests.js — 2-나 추가매출 결과 적기(action reply) 시험 (실제 Google·Firestore 접속 0건)
// A: lib/competency.js 순수 함수(validateReply·planReply)  B: index.js saveCompetencyTest action=reply 그대로 실행
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const c = require(path.join(dir, 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }
const J = JSON.stringify;
const clone = o => JSON.parse(J(o));
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
let USERS = [
  ['jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성'],
  ['ceo@x.com', '유대표', '임원', '본사', '활성'],
  ['kim@x.com', '김하늘', '담당', '동부', '활성'],
  ['lee@x.com', '이도윤', '일반', '동부', '활성'],
  ['park@x.com', '박서준', '일반', '동부', '비활성']
];
const ADD = '역량-개선기획역량-추가매출', FACE = '역량-영업수행역량-대면영업';
const ADD_H = ['사무소', '담당', '구분', '고객사', '품목', '예상이익', '추진계획', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀'].concat(EX);
const R = (who, cust, reply, period, settle, id, email, item) => ['양산', who, '품목확대', cust, '공구', '1,200', '계획', reply, period, settle, item || '', '', '동부', id, email];
function baseTabs() {
  return {
    [FACE]: [['순번', '이름', '고객사', '팀장 의견 (상중하)', '팀'].concat(EX), ['1', '김하늘', '가람산업', '', '동부', 'CE-F1', 'kim@x.com']],
    [ADD]: [ADD_H,
      R('김하늘', '아라전자', '', '', '', 'CE-A1', 'kim@x.com'),           // 2행: 김하늘 계획
      R('김하늘', '나래기공', 'Y', '2609', '매출 1천원 / 이익 1천원', 'CE-A2', 'kim@x.com'), // 3행: 이미 결과
      R('이도윤', '다온화학', '', '', '', 'CE-A3', 'lee@x.com'),           // 4행: 이도윤 계획
      R('김하늘', '라온상사', '', '2610', '', 'CE-A4', 'kim@x.com'),       // 5행: 시점만 이미 있음
      R('김하늘', '마루산업', '', '', '', 'CE-DUP', 'kim@x.com'),          // 6·7행: 같은 기록ID 2줄
      R('김하늘', '바른기계', '', '', '', 'CE-DUP', 'kim@x.com'),
      R('최영아', '사랑물산', '', '', '', 'CE-A5', ''),                    // 8행: 이메일 없음(미등록)
      R('박서준', '아름전자', '', '', '', 'CE-A6', 'park@x.com'),          // 9행: 퇴사자 줄
      R('김하늘', '자람테크', '', '', '', 'CE-A7', 'kim@x.com', '7654321')] // 10행: 아이템키만 이미 있음
  };
}
const Y = { achieved: 'Y', reflectFrom: '2611', reflectTo: '2702', reflectOpen: false, settleSales: '3,200', settleProfit: 410, itemKeys: '1234567, 2345678' };

// ── A. 순수 함수 ──
let v = c.validateReply(Y);
t('A1 Y: 기간 2611~2702, 결산 "매출 3,200천원 / 이익 410천원", 아이템키 "1234567,2345678"', v.ok && v.achieved === 'Y' && v.period === '2611~2702' && v.settle === '매출 3,200천원 / 이익 410천원' && v.itemKeys === '1234567,2345678', v);
v = c.validateReply(Object.assign({}, Y, { reflectTo: '', reflectOpen: true }));
t('A2 Y + 끝 없음(계속) → "2611~"', v.ok && v.period === '2611~', v);
v = c.validateReply({ achieved: 'n', reflectFrom: '9999', settleSales: 'x' });
t('A3 N(소문자도): 시점·결산·아이템키는 보지 않고 빈 값', v.ok && v.achieved === 'N' && v.period === '' && v.settle === '' && v.itemKeys === '', v);
const badField = o => c.validateReply(Object.assign({}, Y, o)).field;
t('A4 달성 여부 없음·다른 글자 → achieved', c.validateReply({}).field === 'achieved' && badField({ achieved: '예' }) === 'achieved');
t('A5 시작 달 없음·월 13·3자리 → reflectFrom', badField({ reflectFrom: '' }) === 'reflectFrom' && badField({ reflectFrom: '2613' }) === 'reflectFrom' && badField({ reflectFrom: '261' }) === 'reflectFrom' && badField({ reflectFrom: '2600' }) === 'reflectFrom');
t('A6 끝 달도 끝 없음도 없음 → reflectTo', badField({ reflectTo: '' }) === 'reflectTo');
t('A7 끝 달 + 끝 없음 둘 다 → reflectTo', badField({ reflectOpen: true }) === 'reflectTo');
t('A8 끝 달이 시작 달보다 앞 → reflectTo (같은 달은 허용)', badField({ reflectTo: '2610' }) === 'reflectTo' && c.validateReply(Object.assign({}, Y, { reflectTo: '2611' })).period === '2611~2611');
t('A9 매출 빈칸·음수·소수·글자 → settleSales', badField({ settleSales: '' }) === 'settleSales' && badField({ settleSales: '-1' }) === 'settleSales' && badField({ settleSales: '1.5' }) === 'settleSales' && badField({ settleSales: '백' }) === 'settleSales');
t('A10 이익 빈칸 → settleProfit, 이익 음수(손해)는 허용 "-1,500천원", 0 허용', badField({ settleProfit: '' }) === 'settleProfit' && c.validateReply(Object.assign({}, Y, { settleProfit: '-1500' })).settle === '매출 3,200천원 / 이익 -1,500천원' && c.validateReply(Object.assign({}, Y, { settleSales: 0, settleProfit: '0' })).settle === '매출 0천원 / 이익 0천원');
t('A11 너무 큰 값(10억 천원 초과) 거부', badField({ settleSales: '1000000001' }) === 'settleSales');
t('A11b 아이템키: 없음·글자 섞임·빈 칸(,,)·소수 → itemKeys / 자릿수 상관없음(3자리·7자리)·띄어쓰기·같은 키 합침', badField({ itemKeys: '' }) === 'itemKeys' && badField({ itemKeys: undefined }) === 'itemKeys' && badField({ itemKeys: '12a' }) === 'itemKeys' && badField({ itemKeys: '123,,456' }) === 'itemKeys' && badField({ itemKeys: '1.5' }) === 'itemKeys' && c.validateReply(Object.assign({}, Y, { itemKeys: ' 123 , 1234567,123 ' })).itemKeys === '123,1234567' && c.parseItemKeys('1234567') === '1234567');
t('A12 seoulDateTimeStr 서울 시각', c.seoulDateTimeStr(Date.UTC(2026, 9, 26, 15, 5)) === '2026-10-27 00:05');
const tabs = baseTabs(); const TAB = { id: 'g101', title: ADD };
const now = Date.UTC(2026, 9, 27, 3, 30);
let p = c.planReply(TAB, tabs[ADD], 'CE-A1', 'KIM@x.com ', c.validateReply(Y), now);
t('A13 Y: 달성 여부(H)·시점(I)·결산(J)·아이템키(K)·수정일시(Q) 5칸, 2행', p.ok && J(p.writes.map(w => w.range)) === J(["'역량-개선기획역량-추가매출'!H2", "'역량-개선기획역량-추가매출'!I2", "'역량-개선기획역량-추가매출'!J2", "'역량-개선기획역량-추가매출'!K2", "'역량-개선기획역량-추가매출'!Q2"]) && J(p.writes.map(w => w.value)) === J(['Y', '2611~2702', '매출 3,200천원 / 이익 410천원', '1234567,2345678', '2026-10-27 12:30']), p.writes);
t('A14 돌려주는 기록: 상태 계획 → 미평가(pendingReview), 값 반영', p.record.reviewState === 'pendingReview' && p.record.fields['달성 여부 (Y/N)'] === 'Y' && p.record.fields['수정일시'] === '2026-10-27 12:30' && p.record.recordId === 'CE-A1' && p.record.row === 2, p.record);
p = c.planReply(TAB, tabs[ADD], 'CE-A1', 'kim@x.com', c.validateReply({ achieved: 'N' }), now);
t('A15 N: 달성 여부·수정일시 2칸만(시점·결산·아이템키 안 건드림)', p.ok && J(p.writes.map(w => w.value)) === J(['N', '2026-10-27 12:30']) && p.record.reviewState === 'pendingReview', p.writes);
t('A16 원본 값 배열은 바꾸지 않음', J(tabs) === J(baseTabs()));
const pe = (id, email, vv) => c.planReply(TAB, tabs[ADD], id, email, vv || c.validateReply(Y), now).error;
t('A17 남의 줄 → NOT_YOUR_RECORD', pe('CE-A3', 'kim@x.com') === 'NOT_YOUR_RECORD');
t('A18 이메일 빈 줄 → NOT_YOUR_RECORD(빈 이메일로 보내도)', pe('CE-A5', 'kim@x.com') === 'NOT_YOUR_RECORD' && pe('CE-A5', '') === 'NOT_YOUR_RECORD');
t('A19 이미 결과 있음 → ALREADY_REPLIED', pe('CE-A2', 'kim@x.com') === 'ALREADY_REPLIED');
t('A20 Y인데 시점 칸에 이미 값 → CELL_NOT_EMPTY(덮어쓰지 않음), N이면 허용', pe('CE-A4', 'kim@x.com') === 'CELL_NOT_EMPTY' && c.planReply(TAB, tabs[ADD], 'CE-A4', 'kim@x.com', c.validateReply({ achieved: 'N' }), now).ok);
t('A21 없는 기록ID → RECORD_NOT_FOUND, 같은 ID 2줄 → DUPLICATE_RECORD_ID, 빈 ID → RECORD_NOT_FOUND', pe('CE-NONE', 'kim@x.com') === 'RECORD_NOT_FOUND' && pe('CE-DUP', 'kim@x.com') === 'DUPLICATE_RECORD_ID' && pe('', 'kim@x.com') === 'RECORD_NOT_FOUND');
t('A22 달성 여부 칸 없는 탭(대면영업) → HEADER_NOT_READY', c.planReply({ id: 'g100', title: FACE }, tabs[FACE], 'CE-F1', 'kim@x.com', c.validateReply(Y), now).error === 'HEADER_NOT_READY');
t('A20b Y인데 아이템키 칸에 이미 값 → CELL_NOT_EMPTY', pe('CE-A7', 'kim@x.com') === 'CELL_NOT_EMPTY');
{ const tb = baseTabs(); tb[ADD] = tb[ADD].map((r, i) => r.filter((x, j) => j !== 10));
  t('A23b 아이템키 칸 없는 탭: Y → HEADER_NOT_READY, N → 허용(아이템키 안 씀)', c.planReply(TAB, tb[ADD], 'CE-A1', 'kim@x.com', c.validateReply(Y), now).error === 'HEADER_NOT_READY' && c.planReply(TAB, tb[ADD], 'CE-A1', 'kim@x.com', c.validateReply({ achieved: 'N' }), now).ok); }
{ const tb = baseTabs(); tb[ADD][0] = ADD_H.filter(h => h !== '수정일시');
  t('A23 수정일시 칸 없음 → HEADER_NOT_READY', c.planReply(TAB, tb[ADD], 'CE-A1', 'kim@x.com', c.validateReply(Y), now).error === 'HEADER_NOT_READY'); }

// ── B. index.js 그대로 실행 (가짜 시트·가짜 Firestore — competency_backfill_tests.js와 같은 시험 장치) ──
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
  const st = { tabs: tabs, requests: [], writes: [], failFileRead: false };
  const titles = Object.keys(tabs);
  const trim = rows => rows.map(r => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  function readRange(a1) {
    const i = a1.lastIndexOf('!'); const tab = a1.slice(0, i).replace(/^'|'$/g, '').replace(/''/g, "'"); const rg = a1.slice(i + 1);
    if (tab === '인사평가설정') return [['키', '값', '설명'], ['기록가능기간일', '14', '']];
    if (tab === 'CRM-역량평가-기준') return [];
    const rows = st.tabs[tab]; if (!rows) { const e = new Error('Unable to parse range'); e.response = { status: 400 }; throw e; }
    if (rg === '1:1') return trim([rows[0]]);
    return trim(clone(rows));
  }
  st.client = {
    request: async ({ url, method, data }) => {
      st.requests.push({ url, method: method || 'GET', data });
      if (url.includes('/values:batchUpdate')) {
        if (opts.beforeWrite) opts.beforeWrite(st);
        data.data.forEach(d => {
          const i = d.range.lastIndexOf('!'); const tab = d.range.slice(0, i).replace(/^'|'$/g, ''); const m = d.range.slice(i + 1).match(/^([A-Z]+)(\d+)$/);
          let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); col -= 1;
          const row = st.tabs[tab][Number(m[2]) - 1]; while (row.length <= col) row.push(''); row[col] = d.values[0][0];
          st.writes.push(d);
        });
        return { data: { totalUpdatedCells: data.data.length } };
      }
      if (url.includes(FILE_ID + '?fields=')) {
        if (st.failFileRead) { const e = new Error('403'); e.response = { status: 403 }; throw e; }
        return { data: { sheets: titles.map((tt, i) => ({ properties: { sheetId: 100 + i, title: tt, hidden: false, index: i } })).concat([{ properties: { sheetId: 9, title: '인사평가설정', index: 50 } }, { properties: { sheetId: 8, title: 'CRM-역량평가-기준', index: 51 } }]) } };
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

const callReply = (e, tok, extra) => e.save(Object.assign({ sessionToken: tok, action: 'reply', idempotencyKey: 'K' + Math.random(), tab: 'g101', recordId: 'CE-A1' }, Y, extra || {}));
const changedCells = (a, b) => { let n = 0; Object.keys(a).forEach(tab => a[tab].forEach((row, ri) => { const now = b[tab][ri]; for (let ci = 0; ci < Math.max(row.length, now.length); ci++) { if (String(row[ci] === undefined ? '' : row[ci]) !== String(now[ci] === undefined ? '' : now[ci])) n++; } })); return n; };

(async () => {
  let e = makeEnv(); let res;
  const before = clone(e.sh.tabs);
  res = await callReply(e, 'TOK_ADMIN');
  t('B1 팀장(관리자 이메일이어도) → FORBIDDEN, 인사평가 파일 접근 0', res.error === 'FORBIDDEN' && !e.sh.requests.some(r => r.url.includes(FILE_ID)), res);
  res = await callReply(e, 'TOK_EXEC');
  t('B2 임원 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  res = await callReply(e, 'TOK_PARK', { recordId: 'CE-A6' });
  t('B3 비활성(퇴사) 계정 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  t('B4 거부된 요청은 시트 쓰기 0, 잠금 문서 없음', fileWrites(e.sh).length === 0 && !('writeLocks/competencyEval' in e.fs.store));
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'reply', tab: 'g101', recordId: 'CE-A1', achieved: 'Y' });
  t('B5 중복 방지 키 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  res = await callReply(e, 'TOK_STAFF', { achieved: '' });
  t('B6 Y/N 빈칸 → BAD_INPUT(achieved), 시트 접근 0', res.error === 'BAD_INPUT' && res.field === 'achieved' && !e.sh.requests.some(r => r.url.includes(FILE_ID)), res);
  res = await callReply(e, 'TOK_STAFF', { reflectFrom: '' });
  t('B7 Y인데 실적 반영 시점 없음 → BAD_INPUT(reflectFrom)', res.error === 'BAD_INPUT' && res.field === 'reflectFrom', res);
  res = await callReply(e, 'TOK_STAFF', { settleProfit: '' });
  t('B8 Y인데 실적결산(이익) 없음 → BAD_INPUT(settleProfit)', res.error === 'BAD_INPUT' && res.field === 'settleProfit', res);
  res = await callReply(e, 'TOK_STAFF', { itemKeys: '' });
  t('B8b Y인데 아이템키 없음 → BAD_INPUT(itemKeys), 시트 접근 0', res.error === 'BAD_INPUT' && res.field === 'itemKeys' && !e.sh.requests.some(r => r.url.includes(FILE_ID)), res);
  res = await callReply(e, 'TOK_LEE');
  t('B9 남의 줄(이도윤이 김하늘 줄) → NOT_YOUR_RECORD, 쓰기 0, 잠금 풀림', res.error === 'NOT_YOUR_RECORD' && fileWrites(e.sh).length === 0 && !('writeLocks/competencyEval' in e.fs.store), res);
  res = await callReply(e, 'TOK_STAFF', { recordId: 'CE-A2' });
  t('B10 이미 결과 있는 줄 → ALREADY_REPLIED, 쓰기 0', res.error === 'ALREADY_REPLIED' && fileWrites(e.sh).length === 0, res);
  t('B11 여기까지 시트 내용 그대로', J(e.sh.tabs) === J(before));

  res = await callReply(e, 'TOK_STAFF', { idempotencyKey: 'OK1' });
  const w = fileWrites(e.sh);
  t('B12 본인 계획 줄 Y → ok, 5칸, 쓰기 요청 1번(values:batchUpdate RAW)', res.ok && res.updatedCells === 5 && w.length === 1 && w[0].url.endsWith('/' + FILE_ID + '/values:batchUpdate') && w[0].data.valueInputOption === 'RAW', res);
  const row2 = e.sh.tabs[ADD][1];
  t('B13 시트 2행: 달성 Y · 2611~2702 · 결산 · 아이템키(글자 그대로) · 수정일시, 나머지 칸 그대로', row2[7] === 'Y' && row2[8] === '2611~2702' && row2[9] === '매출 3,200천원 / 이익 410천원' && row2[10] === '1234567,2345678' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row2[16]) && changedCells(before, e.sh.tabs) === 5, row2);
  t('B14 응답 기록: 미평가(pendingReview), 작성자 정보', res.record.reviewState === 'pendingReview' && res.record.recordId === 'CE-A1' && res.record.authorEmail === 'kim@x.com' && res.record.authorStatus === 'active' && res.record.tab === 'g101', res.record);
  t('B15 잠금 풀림, 중복 방지 문서 DONE', !('writeLocks/competencyEval' in e.fs.store) && e.fs.store['writeIdempotency/OK1'].status === 'DONE');
  let r2 = await callReply(e, 'TOK_STAFF', { idempotencyKey: 'OK1' });
  t('B16 같은 키로 다시(두 번 누름) → 같은 응답, 추가 쓰기 0', r2.ok && r2.updatedCells === 5 && fileWrites(e.sh).length === 1, r2);
  r2 = await callReply(e, 'TOK_STAFF', { idempotencyKey: 'OK2' });
  t('B17 새 키로 같은 줄 다시 → ALREADY_REPLIED(덮어쓰기 없음)', r2.error === 'ALREADY_REPLIED' && fileWrites(e.sh).length === 1, r2);

  res = await callReply(e, 'TOK_LEE', { recordId: 'CE-A3', achieved: 'N', reflectFrom: '', settleSales: '' });
  const row4 = e.sh.tabs[ADD][3];
  t('B18 일반(이도윤) 본인 줄 N → ok 2칸, 시점·결산·아이템키 빈 채로', res.ok && res.updatedCells === 2 && row4[7] === 'N' && !row4[8] && !row4[9] && !row4[10] && row4[16], { res, row4 });
  res = await callReply(e, 'TOK_STAFF', { recordId: 'CE-A4' });
  t('B19 시점 칸에 이미 값 있는 줄에 Y → CELL_NOT_EMPTY, 쓰기 없음', res.error === 'CELL_NOT_EMPTY' && fileWrites(e.sh).length === 2, res);
  res = await callReply(e, 'TOK_STAFF', { recordId: 'CE-DUP' });
  t('B20 같은 기록ID 2줄 → DUPLICATE_RECORD_ID', res.error === 'DUPLICATE_RECORD_ID', res);
  res = await callReply(e, 'TOK_STAFF', { recordId: 'CE-GONE' });
  t('B21 시트에서 지워진 줄 → RECORD_NOT_FOUND', res.error === 'RECORD_NOT_FOUND', res);
  res = await callReply(e, 'TOK_STAFF', { tab: 'g100', recordId: 'CE-F1' });
  t('B22 달성 여부 칸 없는 탭 → HEADER_NOT_READY', res.error === 'HEADER_NOT_READY', res);
  res = await callReply(e, 'TOK_STAFF', { tab: 'g999' });
  t('B23 없는 탭 → TAB_NOT_FOUND', res.error === 'TAB_NOT_FOUND', res);

  // 관리자 이메일이라도 역할이 일반이면 허용(시험 계정 방식: 재홍님 역할을 일반으로 바꿔 시험)
  USERS = USERS.map(u => u[0] === 'jhjoo@nkmro.com' ? ['jhjoo@nkmro.com', '주재홍', '일반', '동부', '활성'] : u);
  e = makeEnv(); e.sh.tabs[ADD].push(R('주재홍', '시험용', '', '', '', 'CE-TEST-0001', 'jhjoo@nkmro.com'));
  res = await callReply(e, 'TOK_ADMIN', { recordId: 'CE-TEST-0001', reflectTo: '', reflectOpen: true });
  t('B24 역할을 일반으로 바꾼 관리자 → 본인 시험 줄 허용, 끝 없음 "2611~"', res.ok && e.sh.tabs[ADD][10][8] === '2611~', res);
  USERS = USERS.map(u => u[0] === 'jhjoo@nkmro.com' ? ['jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성'] : u);

  // 잠금: 다른 저장(2-가 채우기 등)이 잠금을 쥐고 있으면 LOCK_TIMEOUT, 쓰기 0
  e = makeEnv();
  e.fs.store['writeLocks/competencyEval'] = { lockedAt: new Date().toISOString(), holderId: 'other' };
  res = await callReply(e, 'TOK_STAFF');
  t('B25 잠금을 못 잡으면 LOCK_TIMEOUT, 인사평가 파일 읽기·쓰기 0, 남의 잠금 그대로', res.error === 'LOCK_TIMEOUT' && !e.sh.requests.some(r => r.url.includes(FILE_ID)) && e.fs.store['writeLocks/competencyEval'].holderId === 'other', res);
  // 동시에 두 번(다른 키): 하나만 쓰고 다른 하나는 잠금 안에서 다시 읽어 ALREADY_REPLIED
  e = makeEnv();
  const [p1, p2] = await Promise.all([callReply(e, 'TOK_STAFF', { idempotencyKey: 'C1' }), callReply(e, 'TOK_STAFF', { idempotencyKey: 'C2' })]);
  t('B26 동시에 두 번 → 하나만 ok, 하나는 ALREADY_REPLIED, 쓰기 1번', [p1, p2].filter(x => x.ok).length === 1 && [p1, p2].filter(x => x.error === 'ALREADY_REPLIED').length === 1 && fileWrites(e.sh).length === 1, [p1.error || 'ok', p2.error || 'ok']);
  // 읽기 실패·쓰기 오류: 잠금 풀림
  e = makeEnv(); e.sh.failFileRead = true;
  res = await callReply(e, 'TOK_STAFF');
  t('B27 파일 읽기 실패 → SHEET_ACCESS_FAILED, 잠금 풀림', res.error === 'SHEET_ACCESS_FAILED' && !('writeLocks/competencyEval' in e.fs.store), res);
  e = makeEnv(null, { beforeWrite: () => { throw new Error('backendError'); } });
  res = await callReply(e, 'TOK_STAFF', { idempotencyKey: 'E1' });
  t('B28 쓰기 오류 → 500, 잠금 풀림, 중복 방지 문서 지워짐(다시 시도 가능)', res.httpStatus === 500 && !('writeLocks/competencyEval' in e.fs.store) && !('writeIdempotency/E1' in e.fs.store), res);
  // 2-가 채우기는 그대로
  e = makeEnv();
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'backfill', mode: 'preview' });
  t('B29 2-가 backfill: 관리자 아니면 FORBIDDEN 그대로', res.error === 'FORBIDDEN', res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'preview' });
  t('B30 2-가 backfill 미리보기 그대로 동작(관리자), 쓰기 0', res.ok && res.mode === 'preview' && fileWrites(e.sh).length === 0, res);
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'create' });
  t('B31 아직 없는 action(create) → NOT_IMPLEMENTED', res.error === 'NOT_IMPLEMENTED', res);

  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
