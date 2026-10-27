// node tests/competency_backfill_tests.js — 2-가 기존 기록 정리(backfill) 시험 (실제 Google·Firestore 접속 0건)
// A: lib/competency.js 순수 함수(팀 칸 점검·기록ID·채우기 계획)
// B: index.js saveCompetencyTest / getCompetencyTest(ping)를 가짜 시트·가짜 Firestore로 그대로 실행
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const c = require(path.join(dir, 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }
const J = JSON.stringify;
const clone = o => JSON.parse(J(o));

// ── 시험 데이터(깨끗한 예시 이름) ──
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const USERS = [
  ['jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성'],
  ['kim@x.com', '김하늘', '담당', '동부', '활성'],
  ['lee@x.com', '이도윤', '일반', '동부', '활성'],
  ['park@x.com', '박서준', '일반', '동부', '비활성'],     // 퇴사
  ['han1@x.com', '한지민', '일반', '동부', '활성'],        // 동명이인 1
  ['han2@x.com', '한 지민', '일반', '서부', '활성']        // 동명이인 2(띄어쓰기 무시)
];
const FACE_H = ['순번', '이름', '사무소', '고객사', '대면자', '팀장 의견 (상중하)', '팀'].concat(EX);
const ADD_H = ['사무소', '담당', '고객사', '달성 여부 (Y/N)', '팀장 의견', '팀'].concat(EX);
function baseTabs() {
  return {
    '역량-직무별전문성-자기개발': [['순번', '이름', '자기개발 항목', '팀장 의견', '팀'].concat(EX)],
    '역량-영업수행역량-대면영업': [FACE_H,
      ['1', '김하늘', '양산', '가람산업', '최과장', '중 (2609)', ''],                          // 정상 → 3칸
      ['2', '이도윤', '창원', '나래기공', '정대리', '', '', 'CE-20261001-0abc', 'lee@x.com'],    // 기록ID·이메일 있음 → 팀만
      ['3', '박서준', '대구', '다온화학', '오부장', '', ''],                                    // 퇴사 → 기록ID·팀
      ['4', '송미래', '포항', '라온상사', '문차장', '', ''],                                    // 미등록 → 기록ID·팀
      ['5', '한지민', '포항', '마루산업', '유주임', '', ''],                                    // 동명이인 → 안 채움
      ['', '', '', '', '', '', ''],                                                            // 이름 빈 줄 → 건너뜀
      ['7', '김하늘', '양산', '바른기계', '강과장', '', '서부']],                              // 팀 이미 있음 → 기록ID·이메일만
    '역량-개선기획역량-추가매출': [ADD_H,
      ['양산', '김하늘', '사랑물산', '', '', ''],
      ['창원', '이도윤', '아라전자', 'Y', '상', '', 'CE-X1', 'lee@x.com', '', '', '', ''].slice(0, 6).concat(['CE-X1', 'lee@x.com']), // 팀만
      ['포항', '없는메일', '자람테크', '', '', '', '', 'ghost@x.com']]                          // 모르는 이메일 → 기록ID·팀
  };
}
function headerOk(tabs) { return Object.keys(tabs).every(k => c.checkTeamColumn(tabs[k][0]).ok); }

// ── A. 순수 함수 ──
t('A1 colLetter', c.colLetter(0) === 'A' && c.colLetter(25) === 'Z' && c.colLetter(26) === 'AA' && c.colLetter(51) === 'AZ' && c.colLetter(52) === 'BA');
t('A2 seoulDateStr 경계(UTC 15시 = 서울 다음날 0시)', c.seoulDateStr(Date.UTC(2026, 9, 26, 15, 0, 0)) === '20261027' && c.seoulDateStr(Date.UTC(2026, 9, 26, 14, 59, 0)) === '20261026');
let r = c.checkTeamColumn(FACE_H);
t('A3 팀 칸 정상(기록ID 바로 왼쪽)', r.ok && r.teamIndex === r.idIndex - 1 && r.warning === '');
r = c.checkTeamColumn(['이름', '팀장 의견'].concat(EX));
t('A4 팀 칸 없음 → 경고', !r.ok && /없음/.test(r.warning));
r = c.checkTeamColumn(['이름', '팀', '팀장 의견'].concat(EX));
t('A5 팀 칸이 기록ID 바로 왼쪽이 아님 → 경고', !r.ok && /위치/.test(r.warning));
r = c.checkTeamColumn(['이름', '팀', '팀장 의견', '팀'].concat(EX));
t('A6 팀 칸 2개 → 경고', !r.ok && /2개/.test(r.warning));
r = c.checkTeamColumn(['이름', ' 팀 ', ...EX]);
t('A7 팀 칸 앞뒤 공백 허용', r.ok);
t('A8 팀 칸이 있어도 끝 6칸 점검(checkHeaderRow)은 그대로 통과', c.checkHeaderRow(FACE_H).ok);
{
  const taken = new Set(['CE-20261027-0000']); let k = 0; const seq = [0, 0, 0.5];
  const id = c.makeRecordId('20261027', taken, () => seq[k++]);
  t('A9 기록ID 모양 CE-YYYYMMDD-xxxx, 이미 있는 값이면 다시 뽑음', id === 'CE-20261027-8000' && taken.has(id), id);
  const many = new Set(); for (let i = 0; i < 3000; i++) c.makeRecordId('20261027', many);
  t('A10 3000개 뽑아도 겹침 0(파일 안 고유)', many.size === 3000);
  const full = new Set(); for (let i = 0; i < 65536; i++) full.add('CE-20261027-' + i.toString(16).padStart(4, '0'));
  const id8 = c.makeRecordId('20261027', full);
  t('A11 4자리가 다 차면 8자리로 늘림(무한 반복 없음)', /^CE-20261027-[0-9a-f]{8}$/.test(id8), id8);
}
function users() { return USERS.map(u => ({ email: u[0], name: u[1], role: u[2], team: u[3], status: u[4] })); }
function planOf(tabs, opts) {
  return c.planBackfill(Object.keys(tabs).map((k, i) => ({ id: 't' + i, title: k, values: tabs[k] })), users(), Object.assign({ nowMs: Date.UTC(2026, 9, 27, 3) }, opts || {}));
}
let P = planOf(baseTabs());
const W = (tab, row, col) => P.writes.find(w => w.tab === tab && w.row === row && w.col === col);
const FACE = '역량-영업수행역량-대면영업', ADD = '역량-개선기획역량-추가매출';
t('A12 정상 줄: 기록ID·작성자이메일·팀 3칸', W(FACE, 2, '기록ID') && W(FACE, 2, '작성자이메일').value === 'kim@x.com' && W(FACE, 2, '팀').value === '동부', P.writes.filter(w => w.row === 2));
t('A13 이미 기록ID·이메일 있는 줄: 팀만', !W(FACE, 3, '기록ID') && !W(FACE, 3, '작성자이메일') && W(FACE, 3, '팀'));
t('A14 퇴사(비활성) 줄: 기록ID·팀만, 이메일 안 채움', W(FACE, 4, '기록ID') && !W(FACE, 4, '작성자이메일') && W(FACE, 4, '팀'));
t('A15 미등록 줄: 기록ID·팀만', W(FACE, 5, '기록ID') && !W(FACE, 5, '작성자이메일') && W(FACE, 5, '팀'));
t('A16 동명이인 줄: 아무것도 안 채움 + 따로 알림', !P.writes.some(w => w.tab === FACE && w.row === 6) && J(P.duplicates) === J([{ name: '한지민', users: 2, rows: 1 }]), P.duplicates);
t('A17 이름 빈 줄: 건너뜀', !P.writes.some(w => w.row === 7 && w.tab === FACE));
t('A18 팀 이미 "서부": 덮어쓰지 않음(기록ID·이메일만)', W(FACE, 8, '기록ID') && W(FACE, 8, '작성자이메일') && !W(FACE, 8, '팀'));
t('A19 추가매출(담당 칸) 정상 줄 3칸', W(ADD, 2, '기록ID') && W(ADD, 2, '작성자이메일').value === 'kim@x.com' && W(ADD, 2, '팀'));
t('A20 추가매출 이미 ID·이메일 → 팀만', !W(ADD, 3, '기록ID') && W(ADD, 3, '팀'));
t('A21 모르는 이메일 줄: 기록ID·팀만(이메일 그대로)', W(ADD, 4, '기록ID') && !W(ADD, 4, '작성자이메일') && W(ADD, 4, '팀'));
t('A22 칸 주소 = 머리글 이름으로 찾은 열(대면영업 팀=G, 기록ID=H, 이메일=I)', W(FACE, 2, '팀').range === "'역량-영업수행역량-대면영업'!G2" && W(FACE, 2, '기록ID').range === "'역량-영업수행역량-대면영업'!H2" && W(FACE, 2, '작성자이메일').range === "'역량-영업수행역량-대면영업'!I2");
const ids = P.writes.filter(w => w.col === '기록ID').map(w => w.value);
t('A23 새 기록ID 모두 CE-20261027-xxxx, 서로·기존과 겹침 0', ids.every(x => /^CE-20261027-[0-9a-f]{4}$/.test(x)) && new Set(ids.concat(['CE-20261001-0abc', 'CE-X1'])).size === ids.length + 2, ids);
t('A24 집계: 이름 있는 줄 9 = 정상 5 + 퇴사 1 + 미등록 1 + 모르는 이메일 1 + 동명이인 1, 이미 다 찬 줄 0', P.summary.rows === 9 && P.summary.ok === 5 && P.summary.left === 1 && P.summary.unregistered === 1 && P.summary.unknownEmail === 1 && P.summary.duplicate === 1 && P.summary.complete === 0, P.summary);
t('A25 칸 수: 기록ID 6 · 이메일 3 · 팀 7 = 16', P.summary.cells['기록ID'] === 6 && P.summary.cells['작성자이메일'] === 3 && P.summary.cells['팀'] === 7 && P.writes.length === 16, P.summary.cells);
t('A26 머리글 정상 → canApply', P.canApply && P.headerProblems.length === 0);
t('A27 기록일시·수정일시·팀장한줄의견·첨부 칸은 절대 안 채움', P.writes.every(w => ['기록ID', '작성자이메일', '팀'].includes(w.col)));
{
  const tb = baseTabs(); tb[ADD][0] = ADD_H.filter(h => h !== '팀');
  const p2 = planOf(tb);
  t('A28 한 탭이라도 팀 칸이 없으면 canApply=false + 문제 목록', !p2.canApply && p2.headerProblems.some(x => x.tab === ADD && /없음/.test(x.problem)), p2.headerProblems);
  const tb3 = baseTabs(); tb3[FACE][0] = FACE_H.concat(['메모']);
  t('A29 끝 6칸 뒤에 다른 칸 → canApply=false', !planOf(tb3).canApply);
}
{
  // 채운 뒤 다시 계획 → 채울 칸 0 (두 번 실행해도 안전)
  const tb = baseTabs();
  P.writes.forEach(w => { const tab = tb[w.tab]; const col = tab[0].indexOf(w.col); const row = tab[w.row - 1]; while (row.length <= col) row.push(''); row[col] = w.value; });
  const again = planOf(tb);
  t('A30 채운 뒤 다시 하면 채울 칸 0(동명이인은 그대로 남음)', again.writes.length === 0 && again.summary.complete === 8 && again.summary.duplicate === 1, again.summary);
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

(async () => {
  let e = makeEnv(); let res;
  res = await e.save({}, 'OPTIONS');
  t('B1 OPTIONS → 204', res.httpStatus === 204);
  res = await e.save({ action: 'backfill', mode: 'preview' });
  t('B2 세션 없음 → 400, 시트 접근 0', res.httpStatus === 400 && e.sh.requests.length === 0, res);
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'backfill', mode: 'preview' });
  t('B3 관리자 아님 → FORBIDDEN, 시트 접근 0', res.error === 'FORBIDDEN' && e.sh.requests.length === 0, res);
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'backfill', mode: 'apply', idempotencyKey: 'KS', expectCells: 16 });
  t('B4 관리자 아닌 사람의 채우기 → FORBIDDEN, 쓰기 0', res.error === 'FORBIDDEN' && fileWrites(e.sh).length === 0, res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'create', mode: 'apply' });
  t('B5 다른 action(create 등)은 아직 NOT_IMPLEMENTED', res.error === 'NOT_IMPLEMENTED' && e.sh.requests.length === 0, res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'run' });
  t('B6 mode가 preview·apply가 아니면 BAD_MODE', res.error === 'BAD_MODE' && e.sh.requests.length === 0, res);

  const before = clone(e.sh.tabs);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'preview' });
  t('B7 미리보기: ok, 칸 16, canApply', res.ok && res.mode === 'preview' && res.cells === 16 && res.canApply === true, res);
  t('B8 미리보기: 시트 쓰기 요청 0건, 시트 내용 그대로', fileWrites(e.sh).length === 0 && J(e.sh.tabs) === J(before));
  t('B9 미리보기 응답에 기록ID·이메일 값 자체는 없음(칸 수·사람별 줄 수만)', !/CE-2026|kim@x\.com/.test(J(res)) && Array.isArray(res.people) && res.people.length > 0, res.people);
  t('B10 미리보기 동명이인 알림', J(res.duplicates) === J([{ name: '한지민', users: 2, rows: 1 }]));
  t('B11 미리보기는 잠금·중복 방지 문서를 만들지 않음', !Object.keys(e.fs.store).some(k => k.startsWith('writeLocks/') || k.startsWith('writeIdempotency/')));

  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', expectCells: 16 });
  t('B12 채우기: 중복 방지 키 없으면 MISSING_FIELDS, 쓰기 0', res.error === 'MISSING_FIELDS' && fileWrites(e.sh).length === 0, res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'K0' });
  t('B13 채우기: 미리보기 칸 수(expectCells) 없으면 MISSING_FIELDS, 쓰기 0', res.error === 'MISSING_FIELDS' && fileWrites(e.sh).length === 0, res);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'K1', expectCells: 15 });
  t('B14 채우기: 미리보기 뒤 시트가 바뀌어 칸 수가 다르면 PLAN_CHANGED, 쓰기 0', res.error === 'PLAN_CHANGED' && res.cells === 16 && fileWrites(e.sh).length === 0, res);
  t('B15 PLAN_CHANGED 뒤 잠금 풀림', !('writeLocks/competencyEval' in e.fs.store));

  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'K2', expectCells: 16 });
  const w = fileWrites(e.sh);
  t('B16 채우기: ok, updatedCells 16, 쓰기 요청 딱 1번(values:batchUpdate, RAW)', res.ok && res.updatedCells === 16 && w.length === 1 && w[0].url.endsWith('/' + FILE_ID + '/values:batchUpdate') && w[0].method === 'POST' && w[0].data.valueInputOption === 'RAW', res);
  // 빈 칸만 채웠는지: 원래 값이 있던 칸은 하나도 안 바뀜
  let changedNonEmpty = 0, filledEmpty = 0;
  Object.keys(before).forEach(tab => before[tab].forEach((row, ri) => {
    const now = e.sh.tabs[tab][ri];
    for (let ci = 0; ci < Math.max(row.length, now.length); ci++) {
      const a = row[ci] === undefined ? '' : row[ci], b = now[ci] === undefined ? '' : now[ci];
      if (a !== b) { if (String(a).trim()) changedNonEmpty++; else filledEmpty++; }
    }
  }));
  t('B17 원래 값이 있던 칸 변경 0, 빈 칸만 16칸 채움', changedNonEmpty === 0 && filledEmpty === 16, { changedNonEmpty, filledEmpty });
  const faceNow = e.sh.tabs[FACE];
  t('B18 동명이인 줄(한지민) 그대로', J(faceNow[5]) === J(before[FACE][5]));
  t('B19 퇴사·미등록 줄 이메일 칸 비어 있음, 팀=동부', !faceNow[3][8] && !faceNow[4][8] && faceNow[3][6] === '동부' && faceNow[4][6] === '동부');
  t('B20 "서부"였던 팀 칸 그대로', faceNow[7][6] === '서부');
  t('B21 기록일시 칸(J열)은 모두 빈 채로', Object.keys(e.sh.tabs).every(tab => { const ci = e.sh.tabs[tab][0].indexOf('기록일시'); return e.sh.tabs[tab].slice(1).every(r => !r[ci]); }));
  t('B22 채우기 끝나면 잠금 풀림', !('writeLocks/competencyEval' in e.fs.store));
  t('B23 중복 방지 문서 DONE', e.fs.store['writeIdempotency/K2'] && e.fs.store['writeIdempotency/K2'].status === 'DONE');

  const res2 = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'K2', expectCells: 16 });
  t('B24 같은 키로 다시(두 번 누름) → 같은 응답, 추가 쓰기 0', res2.ok && res2.updatedCells === 16 && fileWrites(e.sh).length === 1, res2);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'preview' });
  t('B25 채운 뒤 미리보기 → 채울 칸 0, 동명이인 1줄 남음', res.ok && res.cells === 0 && res.summary.duplicate === 1, res.summary);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'K3', expectCells: 0 });
  t('B26 채울 칸 0이면 쓰기 요청 없이 ok(updatedCells 0)', res.ok && res.updatedCells === 0 && fileWrites(e.sh).length === 1, res);

  // 잠금: 다른 요청이 잡고 있으면 기다리다 LOCK_TIMEOUT, 쓰기 0
  e = makeEnv();
  e.fs.store['writeLocks/competencyEval'] = { lockedAt: new Date().toISOString(), holderId: 'other' };
  const tl = Date.now();
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'L1', expectCells: 16 });
  t('B27 잠금을 못 잡으면 LOCK_TIMEOUT(10초 기다림), 시트 읽기·쓰기 0', res.error === 'LOCK_TIMEOUT' && Date.now() - tl >= 9900 && fileWrites(e.sh).length === 0 && !e.sh.requests.some(r => r.url.includes(FILE_ID)), res);
  t('B28 남의 잠금은 지우지 않음', e.fs.store['writeLocks/competencyEval'] && e.fs.store['writeLocks/competencyEval'].holderId === 'other');

  // 동시에 두 번(다른 키): 하나만 쓰고, 다른 하나는 잠금 안에서 다시 읽어 PLAN_CHANGED
  e = makeEnv();
  const [p1, p2] = await Promise.all([
    e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'C1', expectCells: 16 }),
    e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'C2', expectCells: 16 })
  ]);
  const oks = [p1, p2].filter(x => x.ok).length, changed = [p1, p2].filter(x => x.error === 'PLAN_CHANGED').length;
  t('B29 동시에 두 번(다른 창): 하나만 16칸 쓰고 다른 하나는 PLAN_CHANGED(잠금 + 잠금 안 다시 읽기)', oks === 1 && changed === 1 && fileWrites(e.sh).length === 1, [p1.error || 'ok', p2.error || 'ok']);

  // 머리글 문제: 미리보기는 문제를 보여주고, 채우기는 HEADER_NOT_READY
  const tb = baseTabs(); tb[ADD][0] = ADD_H.filter(h => h !== '팀');
  e = makeEnv(tb);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'preview' });
  t('B30 팀 칸 없는 탭이 있으면 미리보기 canApply=false + 문제 탭 이름', res.ok && res.canApply === false && res.headerProblems.some(x => x.tab === ADD), res.headerProblems);
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'H1', expectCells: res.cells });
  t('B31 그 상태로 채우기 → HEADER_NOT_READY, 쓰기 0, 잠금 풀림', res.error === 'HEADER_NOT_READY' && fileWrites(e.sh).length === 0 && !('writeLocks/competencyEval' in e.fs.store), res);

  // 시트 읽기 실패(공유 끊김 등): 잠금 풀리고 쓰기 0
  e = makeEnv(); e.sh.failFileRead = true;
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'F1', expectCells: 16 });
  t('B32 파일 읽기 실패 → SHEET_ACCESS_FAILED(403), 쓰기 0, 잠금 풀림', res.error === 'SHEET_ACCESS_FAILED' && res.httpStatus === 403 && fileWrites(e.sh).length === 0 && !('writeLocks/competencyEval' in e.fs.store), res);

  // 쓰기 중 오류: 잠금 풀리고 중복 방지 문서 지워짐(다음 시도 가능)
  e = makeEnv(null, { beforeWrite: () => { throw new Error('backendError'); } });
  res = await e.save({ sessionToken: 'TOK_ADMIN', action: 'backfill', mode: 'apply', idempotencyKey: 'E1', expectCells: 16 });
  t('B33 쓰기 오류 → 500, 잠금 풀림, 중복 방지 문서 지워져 다시 시도 가능', res.httpStatus === 500 && !('writeLocks/competencyEval' in e.fs.store) && !('writeIdempotency/E1' in e.fs.store), res);

  // ping: 팀 칸 경고(경고만 — ok는 끝 6칸 점검 그대로)
  e = makeEnv();
  res = await e.get({ sessionToken: 'TOK_ADMIN', view: 'ping' });
  t('B34 ping: 팀 칸 정상이면 teamColumnOk true, 경고 없음, ok true', res.ok === true && res.tabs.every(x => x.teamColumnOk === true && !x.warnings.some(w => /팀/.test(w))), res.tabs);
  const tb2 = baseTabs(); tb2[ADD][0] = ADD_H.filter(h => h !== '팀'); tb2[FACE][0] = ['순번', '이름', '팀', '사무소', '고객사', '대면자', '팀장 의견 (상중하)'].concat(EX);
  e = makeEnv(tb2);
  res = await e.get({ sessionToken: 'TOK_ADMIN', view: 'ping' });
  const pa = res.tabs.find(x => x.tab === ADD), pf = res.tabs.find(x => x.tab === FACE);
  t('B35 ping: 팀 칸 없음·위치 틀림 → 그 탭에 경고, ok는 그대로 true(끝 6칸은 맞음)', res.ok === true && pa.teamColumnOk === false && pa.warnings.some(w => /없음/.test(w)) && pf.teamColumnOk === false && pf.warnings.some(w => /위치/.test(w)), res.tabs);
  t('B36 ping: 쓰기 요청 0', fileWrites(e.sh).length === 0);

  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
