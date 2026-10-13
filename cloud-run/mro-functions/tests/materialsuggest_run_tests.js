// cloud-run/mro-functions/tests/materialsuggest_run_tests.js
// AI 원자재 추천(suggestMaterialsTest, 단계 1 mode=app, 2026-10-12 / 2026-10-13 시간 예산 수정) 가짜 데이터 시험.
// 실제 시트·Firestore·DeepSeek는 쓰지 않는다(네트워크 호출 0건).
//
//   A그룹: Apps Script 원본(Code.gs suggestRawMaterials)을 그대로 실행한 결과와 Cloud Run 엔진 결과를
//          같은 가짜 원자재마스터·같은 AI 응답으로 비교(프롬프트 글자 일치, 추가되는 행, 반환값).
//   B그룹: index.js의 suggestMaterialsTest를 그대로 실행(인증·권한·잠금·요청 번호·로그·오류 코드·시트 쓰기 요청).
//   C그룹: feed.html의 suggestMaterialsRemote_ / suggestMaterialsForForm을 그대로 실행(자동 폴백 규칙, 30초 규칙).
//   T그룹: 시간 예산(AI 1회 40초·전체 45초·재시도 10초 기준·요청 50초) — 가짜 시계로 실제 엔진 실행.
//
// 실행: (cloud-run/mro-functions 폴더에서) node tests/materialsuggest_run_tests.js
// Code.gs·feed.html 위치: 저장소 최상위 기준 apps-script/Code.gs, feed.html
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const dir = path.resolve(__dirname, '..');
const repo = path.resolve(dir, '..', '..');
const ms = require(path.join(dir, 'lib', 'materialSuggest.js'));

let failures = 0, passes = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 600)));
  if (cond) passes++; else failures++;
}

// ───────── 가짜 원자재마스터 (RM001~RM078, 실제 시트와 같은 개수·번호) ─────────
const REAL_NAMES = { 1: '고무', 2: 'PVC', 3: '폴리에틸렌', 4: 'PP', 5: '펄프', 6: '재활용 폐지', 7: '철', 8: '알루미늄', 9: '면', 10: '구리' };
function baseRawRows() {
  const rows = [];
  for (let i = 1; i <= 78; i++) {
    const name = REAL_NAMES[i] || ('원자재' + i);
    rows.push(['RM' + String(i).padStart(3, '0'), name, name, '활성', 46000 + i]);
  }
  return rows;
}

// ───────── A그룹: Apps Script 원본 실행기 ─────────
const codeGs = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('not found ' + name);
  // 다음 최상위 function 선언 직전까지
  const rest = src.slice(start + 1);
  const m = rest.search(/\nfunction [\w$]+\s*\(/);
  return src.slice(start, start + 1 + m);
}
const gasSuggestSrc = extractFn(codeGs, 'suggestRawMaterials');

function runAppsScript(rawRows, aiTexts, itemName) {
  const sheet = { rows: [['원자재코드', '원자재명(한글)', '수집키워드', '상태', '등록일']].concat(rawRows.map(r => r.slice())), deleted: [] };
  const prompts = [];
  let aiIdx = 0;
  const fakeSheet = {
    getDataRange: () => ({ getValues: () => sheet.rows.map(r => r.slice()) }),
    appendRow: r => { sheet.rows.push(r.slice()); },
    getLastRow: () => sheet.rows.length,
    getRange: function () { return { setNumberFormat() {}, getDataValidation: () => 'RULE', setDataValidation() {} }; },
    deleteRow: n => { sheet.deleted.push(n); sheet.rows.splice(n - 1, 1); }
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'SHEET' }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => fakeSheet }), flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    callAI_: p => { prompts.push(p); return aiTexts[aiIdx++] || null; },
    console: { log() {}, error() {} }
  };
  vm.runInNewContext(gasSuggestSrc + '\n;__out = suggestRawMaterials(__name);', Object.assign(ctx, { __name: itemName }));
  return { result: ctx.__out, prompts, rows: sheet.rows.slice(1), aiCalls: aiIdx };
}

// ───────── Cloud Run 엔진 실행기(가짜 Sheets REST + 실제 lib/writeLock + 가짜 Firestore) ─────────
function makeFakeFirestore() {
  const store = {};
  function docRef(col, id) {
    const key = col + '/' + id;
    const ref = {
      _key: key,
      get: async () => ({ exists: key in store, ref: ref, data: () => store[key] && JSON.parse(JSON.stringify(store[key])) }),
      set: async d => { store[key] = JSON.parse(JSON.stringify(d)); },
      update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(JSON.stringify(d))); },
      delete: async () => { delete store[key]; }
    };
    return ref;
  }
  return {
    store,
    collection: n => ({ doc: id => docRef(n, id) }),
    runTransaction: async fn => {
      const ops = [];
      const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.update(d)) };
      const out = await fn(tx);
      for (const op of ops) await op();
      return out;
    }
  };
}

// Sheets REST 흉내: 원자재마스터(A~E) + 사용자팀마스터 + 설정. 요청은 모두 기록한다.
function makeFakeSheets(opts) {
  opts = opts || {};
  const st = {
    raw: (opts.raw || baseRawRows()).map(r => r.slice()),   // index 0 == 시트 2행
    users: opts.users || [],
    settings: opts.settings || [],
    requests: [], batchUpdates: [], hooks: opts.hooks || {}
  };
  function colIdx(c) { return c.charCodeAt(0) - 65; }
  function trimmed(rows) {
    // Sheets API처럼 끝쪽 빈 행·빈 칸은 돌려주지 않는다
    const out = rows.map(r => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }
  st.client = {
    request: async ({ url, method, data }) => {
      const u = decodeURIComponent(url);
      st.requests.push({ method: method || 'GET', url: u, data: data && JSON.parse(JSON.stringify(data)) });
      if (u.includes('values:batchGet')) {
        return { data: { valueRanges: [{ values: st.users }, { values: st.settings }] } };
      }
      if ((!method || method === 'GET') && u.includes('?fields=sheets.properties')) {
        return { data: { sheets: [{ properties: { sheetId: 0, title: '품목마스터' } }, { properties: { sheetId: 721000434, title: '원자재마스터' } }] } };
      }
      if ((!method || method === 'GET') && u.includes('/values/원자재마스터!A2:E')) {
        if (st.hooks.beforeRead) st.hooks.beforeRead(st);
        return { data: { values: trimmed(st.raw) } };
      }
      if (method === 'PUT' && u.includes('/values/원자재마스터!')) {
        const m = u.match(/!([A-E])(\d+)(?::([A-E])(\d+))?\?/);
        const c0 = colIdx(m[1]), r0 = +m[2];
        data.values.forEach((vals, i) => {
          const idx = r0 - 2 + i;
          while (st.raw.length <= idx) st.raw.push(['', '', '', '', '']);
          vals.forEach((v, j) => { st.raw[idx][c0 + j] = v; });
        });
        if (st.hooks.afterWrite) st.hooks.afterWrite(st, r0, data.values);
        return { data: {} };
      }
      if (method === 'POST' && u.includes('/values/원자재마스터!A:E:append')) {
        if (!u.includes('insertDataOption=OVERWRITE') || !u.includes('valueInputOption=RAW')) throw new Error('append 옵션 이상: ' + u);
        if (st.hooks.failAppend) throw new Error(st.hooks.failAppend);
        if (st.hooks.beforeAppend) st.hooks.beforeAppend(st);
        // 서버 동작 흉내: 값이 있는 마지막 행 바로 아래 빈 행에 덮어쓴다(행 삽입 없음)
        let last = -1;
        st.raw.forEach((r, i) => { if (r.some(v => v !== '' && v !== undefined && v !== null)) last = i; });
        const startIdx = last + 1;
        data.values.forEach((vals, i) => { st.raw[startIdx + i] = vals.slice(); });
        const r0 = startIdx + 2, r1 = r0 + data.values.length - 1;
        if (st.hooks.afterAppend) st.hooks.afterAppend(st, r0);
        return { data: { updates: { updatedRange: "'원자재마스터'!A" + r0 + ':E' + r1, updatedRows: data.values.length } } };
      }
      if (method === 'POST' && u.includes(':clear')) {
        const m = u.match(/!A(\d+):E(\d+):clear/);
        st.raw[+m[1] - 2] = ['', '', '', '', ''];
        return { data: {} };
      }
      if (method === 'POST' && u.endsWith(':batchUpdate')) {
        if (st.hooks.failFormat) throw new Error('format boom');
        st.batchUpdates.push(data);
        return { data: {} };
      }
      throw new Error('unexpected request ' + method + ' ' + u);
    }
  };
  return st;
}

function aiFromTexts(texts, prompts) {
  let i = 0;
  return async function (prompt) { prompts.push(prompt); const t = texts[i++]; return { text: t || null, httpStatus: t ? 200 : 500, ms: 5, error: t ? null : 'HTTP_500' }; };
}

async function runCloudRun(rawRows, aiTexts, itemName, extra) {
  extra = extra || {};
  const fs_ = makeFakeFirestore();
  const sh = makeFakeSheets({ raw: rawRows, hooks: extra.hooks });
  const { acquireLock, releaseLock } = require(path.join(dir, 'lib', 'writeLock.js'));
  const prompts = [];
  const holder = 'h1';
  const deps = {
    io: ms.makeSheetsIO(sh.client, 'SHEET'),
    lock: { acquire: w => acquireLock(fs_, ms.RAW_LOCK_NAME, holder, extra.lockOpts || Object.assign({}, ms.RAW_LOCK_OPTS, { waitMs: w })), release: () => releaseLock(fs_, ms.RAW_LOCK_NAME, holder) },
    ai: aiFromTexts(aiTexts, prompts),
    now: () => Date.UTC(2026, 9, 12, 8, 0, 0)
  };
  if (extra.preLock) await fs_.collection('writeLocks').doc(ms.RAW_LOCK_NAME).set({ lockedAt: new Date(), holderId: 'other' });
  const log = {};
  const result = await ms.suggestForItemName(deps, itemName, extra.opts || ms.readOptions({}), log);
  return { result, prompts, rows: sh.raw.filter(r => r.some(v => v !== '' && v !== undefined)), sh, log, fs: fs_ };
}

const J = s => JSON.stringify(s);
const CURRENT_SHEETS = { client: null };
require.cache[require.resolve('google-auth-library', { paths: [dir] })] = {
  id: 'gal-stub', filename: 'gal-stub', loaded: true,
  exports: { GoogleAuth: class { async getClient() { if (!CURRENT_SHEETS.client) throw new Error('실제 Google 접속 시도 차단'); return CURRENT_SHEETS.client; } } }
};
const resp = obj => '```json\n' + J(obj) + '\n```';

(async () => {
  console.log('── A그룹: Apps Script 원본 ↔ Cloud Run 엔진 비교 ──');
  // A0 프롬프트 템플릿 글자 일치
  const tplHash = crypto.createHash('sha256').update(ms.promptTemplate_('${listText}', '${itemName}')).digest('hex');
  const gasTpl = gasSuggestSrc.slice(gasSuggestSrc.indexOf('const prompt = `') + 16, gasSuggestSrc.indexOf('`;', gasSuggestSrc.indexOf('const prompt = `')));
  check('A0 프롬프트 템플릿 = Code.gs 원본과 글자 단위 동일(SHA-256 ' + tplHash.slice(0, 12) + ')',
    tplHash === ms.PROMPT_TEMPLATE_SHA256 && crypto.createHash('sha256').update(gasTpl).digest('hex') === tplHash);

  const scenarios = [
    { id: 'A1', name: '기존 원자재만 재사용', item: '테스트용 고무장갑', ai: [J({ materials: [{ isNew: false, korean: '고무', keyword: '고무' }] })] },
    { id: 'A2', name: '기존 1 + 새 원자재 1(RM079 추가)', item: '방청비닐', ai: [resp({ materials: [{ isNew: false, korean: '폴리에틸렌', keyword: 'PE' }, { isNew: true, korean: 'VCI 방청제', keyword: '방청제' }] })] },
    { id: 'A3', name: 'isNew=true지만 이미 있는 이름(공백·대소문자 차이) → 추가 안 함', item: 'PVC 호스', ai: [J({ materials: [{ isNew: true, korean: ' p v c ', keyword: 'PVC' }] })] },
    { id: 'A4', name: '1차 응답이 JSON이 아님 → 2차 성공(AI 2회)', item: '과산화수소', ai: ['죄송합니다 형식 오류', J({ materials: [{ isNew: true, korean: '과산화수소', keyword: '과산화수소' }] })] },
    { id: 'A5', name: '1차 응답 없음(HTTP 오류) → 2차 성공', item: '황산', ai: [null, J({ materials: [{ isNew: true, korean: '황산', keyword: '황산' }] })] },
    { id: 'A6', name: '새 원자재 2개 → RM079, RM080', item: '아쿠아메이트(벤젠, 구연산)', ai: [J({ materials: [{ isNew: true, korean: '벤젠', keyword: '벤젠' }, { isNew: true, korean: '구연산', keyword: '구연산' }] })] },
    { id: 'A7', name: '빈 materials 배열 → 재시도 후 실패', item: '알수없음', ai: [J({ materials: [] }), J({ materials: [] })] },
    { id: 'A8', name: '2회 모두 응답 없음 → 실패(쓰기 없음)', item: '실패품목', ai: [null, null] }
  ];
  for (const sc of scenarios) {
    const g = runAppsScript(baseRawRows(), sc.ai, sc.item);
    const c = await runCloudRun(baseRawRows(), sc.ai, sc.item);
    const gRows = g.rows.map(r => r.slice(0, 4)); const cRows = c.rows.map(r => r.slice(0, 4));
    const gMat = g.result ? g.result.korean : null; const cMat = c.result.ok ? c.result.materials : null;
    check(sc.id + ' ' + sc.name + ' — 프롬프트 동일', g.prompts.length === c.prompts.length && g.prompts.every((p, i) => p === c.prompts[i]), { g: g.prompts.length, c: c.prompts.length });
    check(sc.id + ' — 반환 원자재 동일 ' + J(cMat), J(gMat) === J(cMat), { gMat, cMat });
    check(sc.id + ' — 원자재마스터 결과 행 동일(' + cRows.length + '행)', J(gRows) === J(cRows), { gTail: gRows.slice(-3), cTail: cRows.slice(-3) });
    if (!g.result) check(sc.id + ' — 실패 코드 AI_FAILED', c.result.error === 'AI_FAILED', c.result);
  }

  // A9 형식이 다른 코드가 섞인 경우 — 의도된 차이(설계 2-7)
  {
    const raw = baseRawRows(); raw.push(['X-01', '수기입력', '수기입력', '활성', 46100]);
    const ai = [J({ materials: [{ isNew: true, korean: '요소', keyword: '요소' }] })];
    const g = runAppsScript(raw, ai, '요소비료');
    const c = await runCloudRun(raw, ai, '요소비료');
    check('A9 비정형 코드(X-01) 섞임: Apps Script는 ' + g.rows[g.rows.length - 1][0] + ', Cloud Run은 RM079(설계 2-7 개선)',
      g.rows[g.rows.length - 1][0] === 'RMNaN' && c.rows[c.rows.length - 1][0] === 'RM079', { g: g.rows.slice(-1), c: c.rows.slice(-1) });
  }

  console.log('── A그룹 보충: Cloud Run 시트 쓰기 세부 ──');
  {
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: 'VCI 방청제', keyword: '방청제' }] })], '방청지');
    const put = c.sh.requests.find(r => r.url.includes(':append'));
    check('A10 새 행은 values.append(OVERWRITE, 행 끼워 넣기 없음)로 붙이고, 서버가 알려준 80행 기준으로 이어서 처리', put && put.url.includes('insertDataOption=OVERWRITE') && c.log.appendRow === 80 && c.sh.raw[78][0] === 'RM079', { url: put && put.url, row: c.log.appendRow });
    const v = put.data.values[0];
    const expectSerial = (Date.UTC(2026, 9, 12, 8, 0, 0) + 9 * 3600000) / 86400000 + 25569;
    check('A11 행 내용 = [RM079, 한글명, 키워드, 활성, 등록일(시트 날짜 숫자, 서울 시각)]', v[0] === 'RM079' && v[1] === 'VCI 방청제' && v[2] === '방청제' && v[3] === '활성' && Math.abs(v[4] - expectSerial) < 1e-9, v);
    const bu = c.sh.batchUpdates[0];
    const cp = bu && bu.requests[0].copyPaste, rc = bu && bu.requests[1].repeatCell;
    check('A12 D열 드롭다운(데이터 확인)을 D2에서 80행으로 복사', cp && cp.pasteType === 'PASTE_DATA_VALIDATION' && cp.source.sheetId === 721000434 && cp.source.startRowIndex === 1 && cp.destination.startRowIndex === 79 && cp.destination.endRowIndex === 80 && cp.destination.startColumnIndex === 3, cp);
    check('A13 E열 날짜 서식 yyyy-mm-dd', rc && rc.cell.userEnteredFormat.numberFormat.pattern === 'yyyy-mm-dd' && rc.range.startColumnIndex === 4 && rc.range.startRowIndex === 79, rc);
    check('A14 잠금이 끝나면 풀림(Firestore에 잠금 문서 없음)', !('writeLocks/rawMaterialMaster' in c.fs.store));
    check('A15 로그: newRM=[RM079], 시도 1회 parseOk', J(c.log.newRM) === '["RM079"]' && c.log.attempts.length === 1 && c.log.attempts[0].parseOk === true, c.log);
  }
  {
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '니켈', keyword: '니켈' }, { isNew: true, korean: '크롬', keyword: '크롬' }] })], '스테인리스판');
    const bu = c.sh.batchUpdates[0];
    check('A16 새 행 2개면 한 번에 붙이고(80~81행) 드롭다운·서식도 2행에 적용', c.sh.raw[78][0] === 'RM079' && c.sh.raw[79][0] === 'RM080' && bu.requests[0].copyPaste.destination.startRowIndex === 79 && bu.requests[0].copyPaste.destination.endRowIndex === 81 && c.sh.requests.filter(r => r.url.includes(':append')).length === 1, bu && bu.requests[0].copyPaste.destination);
  }
  {
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '주석', keyword: '주석' }] })], '납땜', { hooks: { failFormat: true } });
    check('A17 서식·드롭다운 복사만 실패하면 추천은 성공 처리 + 로그에 formatError', c.result.ok === true && c.log.formatError === 'format boom' && c.rows.some(r => r[1] === '주석'), c.log);
  }
  {
    // 사후 검증 1: 잠금 안에서 읽은 직후~내가 붙이기 직전에 Apps Script 경로가 같은 이름을 먼저 붙인 경우 → 내 행(아래)을 비움
    const hooks = { beforeAppend: st => { st.raw.push(['RM079', '코발트', '코발트', '활성', 1]); } };
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '코발트', keyword: '코발트' }] })], '초경공구', { hooks });
    const cobalt = c.rows.filter(r => r[1] === '코발트');
    check('A18 사후 검증: 같은 이름이 먼저 생겼으면 이번에 추가한 행만 비움(코발트 1행만 남음)', cobalt.length === 1 && c.log.clearedDuplicate && c.log.clearedDuplicate.length === 1 && J(c.result.materials) === '["코발트"]', { cobalt, log: c.log });
  }
  {
    // 사후 검증 2: 내가 붙인 직후 Apps Script가 같은 번호(RM079)를 다른 이름으로 붙인 경우 → 내 행 번호를 바꿈
    const hooks = { afterAppend: st => { st.raw.push(['RM079', '텅스텐', '텅스텐', '활성', 1]); } };
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '몰리브덴', keyword: '몰리브덴' }] })], '윤활피막제', { hooks });
    const mine = c.rows.find(r => r[1] === '몰리브덴');
    const codes = c.rows.map(r => r[0]);
    check('A19 사후 검증: 같은 번호가 다른 행에 생기면 이번 행을 새 번호(RM080)로 바꿈, 번호 중복 0', mine && mine[0] === 'RM080' && new Set(codes).size === codes.length && c.log.codeReassigned[0].to === 'RM080', { mine, log: c.log });
  }
  {
    // 사후 검증 3: 내가 붙인 직후 Apps Script가 같은 이름·같은 번호로 붙인 경우 → 내 행(위)은 그대로 둔다(그쪽 사후 검증이 자기 행을 지움)
    const hooks = { afterAppend: st => { st.raw.push(['RM079', '바나듐', '바나듐', '활성', 1]); } };
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '바나듐', keyword: '바나듐' }] })], '공구강', { hooks });
    check('A19b 같은 이름·번호가 내 행 아래에 생기면 내 행은 그대로(RM079 유지, 비우기·번호변경 없음)', c.sh.raw[78][0] === 'RM079' && c.sh.raw[78][1] === '바나듐' && !c.log.clearedDuplicate && !c.log.codeReassigned, c.log);
  }
  {
    const t0 = Date.now();
    const c = await runCloudRun(baseRawRows(), [J({ materials: [{ isNew: true, korean: '아연', keyword: '아연' }] })], '아연도금', { preLock: true, lockOpts: { waitMs: 600, staleMs: 30000, pollMs: 100 } });
    check('A20 원자재마스터 잠금을 못 잡으면 LOCK_TIMEOUT, 시트 쓰기 없음', c.result.error === 'LOCK_TIMEOUT' && !c.sh.requests.some(r => r.method === 'PUT' || r.url.includes(':append')) && Date.now() - t0 >= 600, c.result);
  }
  {
    const o = ms.readOptions({ '원자재추천AI대기초': '99', '원자재추천AI시도횟수': '5' });
    const d = ms.readOptions({});
    const bad = ms.readOptions({ '원자재추천AI대기초': '아무거나' });
    const lo = ms.readOptions({ '원자재추천AI대기초': '3' });
    check('A21 설정값: 없음→40초·2회, 99초→45초(상한), 3초→10초(하한), 5회→2회(상한), 숫자 아님→기본 40초', d.aiTimeoutSec === 40 && d.aiAttempts === 2 && o.aiTimeoutSec === 45 && o.aiAttempts === 2 && lo.aiTimeoutSec === 10 && bad.aiTimeoutSec === 40, { o, d, bad, lo });
  }

  console.log('── B그룹: index.js suggestMaterialsTest 그대로 실행 ──');
  const USERS = [
    ['jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성'],
    ['kim@nkmro.com', '김담당', '담당', '동부', '활성']
  ];
  function makeEnv(opts) {
    opts = opts || {};
    const fs_ = makeFakeFirestore();
    const sh = makeFakeSheets({ users: USERS, settings: opts.settings || [] });
    const env = { fs: fs_, sh, logs: [], fetchCalls: [] };
    fs_.store['sessions/TOK_LEADER'] = { email: 'jhjoo@nkmro.com', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    fs_.store['sessions/TOK_STAFF'] = { email: 'kim@nkmro.com', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    fs_.store['sessions/TOK_OLD'] = { email: 'jhjoo@nkmro.com', expiresAt: new Date(Date.now() - 1000).toISOString() };
    const aiQueue = (opts.ai || []).slice();
    const fakeFetch = async (url, init) => {
      env.fetchCalls.push({ url, init: { method: init.method, headers: init.headers, body: JSON.parse(init.body) } });
      const next = aiQueue.shift();
      if (next === 'HANG') {
        return new Promise((_, reject) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }));
      }
      if (next === undefined || next === null) return { status: 500, json: async () => ({}) };
      return { status: 200, json: async () => ({ choices: [{ message: { content: next } }] }) };
    };
    const stubs = {
      '@google-cloud/firestore': { Firestore: class { constructor() { return fs_; } }, FieldValue: { serverTimestamp: () => 'TS' } },
      'google-auth-library': { GoogleAuth: class { async getClient() { return sh.client; } } }
    };
    // lib/sheetsClient.js처럼 lib 안에서 직접 require하는 google-auth-library도 가짜로(실제 Google 접속 0건)
    CURRENT_SHEETS.client = sh.client;
    const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
    const mod = { exports: {} };
    const fakeProcess = { env: { AI_PROVIDER: 'DEEPSEEK', DEEPSEEK_API_KEY: 'sk-TESTKEY-should-not-appear-in-logs' } };
    const ctx = { require: req, module: mod, exports: mod.exports, console: { log: s => env.logs.push(String(s)), error: s => env.logs.push(String(s)) },
      process: fakeProcess, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder, fetch: fakeFetch, AbortController };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
    env.call = async (body, method) => {
      const out = {};
      await mod.exports.suggestMaterialsTest({ method: method || 'POST', body }, { set() {}, status: c => ({ json: o => { out.httpStatus = c; Object.assign(out, o); }, send() { out.httpStatus = c; } }) });
      return out;
    };
    return env;
  }

  let e = makeEnv();
  let r = await e.call({}, 'OPTIONS');
  check('B1 OPTIONS(브라우저 사전 확인) → 204', r.httpStatus === 204);
  r = await e.call({ mode: 'sheet', itemName: 'x' });
  check('B2 mode=sheet(단계 3 예정) → 400 UNSUPPORTED_MODE', r.httpStatus === 400 && r.error === 'UNSUPPORTED_MODE', r);
  r = await e.call({ mode: 'app', itemName: 'x' });
  check('B3 세션 없음 → 400 MISSING_SESSION_TOKEN', r.httpStatus === 400 && r.error === 'MISSING_SESSION_TOKEN', r);
  r = await e.call({ mode: 'app', sessionToken: 'TOK_OLD', itemName: 'x' });
  check('B4 세션 만료 → SESSION_EXPIRED', r.error === 'SESSION_EXPIRED', r);
  r = await e.call({ mode: 'app', sessionToken: 'TOK_STAFF', itemName: '장갑' });
  check('B5 팀장이 아니면 → FORBIDDEN, AI 호출 0회', r.error === 'FORBIDDEN' && e.fetchCalls.length === 0, r);
  r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', itemName: '' });
  check('B6 품목명 비어 있음 → MISSING_FIELDS', r.error === 'MISSING_FIELDS' && e.fetchCalls.length === 0, r);

  e = makeEnv({ ai: [J({ materials: [{ isNew: false, korean: '고무', keyword: '고무' }, { isNew: true, korean: '니트릴고무', keyword: 'NBR' }] })] });
  r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', idempotencyKey: 'K1', itemName: '테스트용 고무장갑' });
  check('B7 정상 → ok, materials=[고무, 니트릴고무]', r.ok === true && J(r.materials) === '["고무","니트릴고무"]', r);
  const fc = e.fetchCalls[0];
  check('B8 DeepSeek 요청 = Apps Script와 같은 모델·옵션(deepseek-v4-flash, reasoning_effort low)', fc && fc.url === 'https://api.deepseek.com/chat/completions' && fc.init.body.model === 'deepseek-v4-flash' && fc.init.body.reasoning_effort === 'low' && fc.init.headers.Authorization === 'Bearer sk-TESTKEY-should-not-appear-in-logs', fc && fc.init.body.model);
  check('B9 프롬프트에 품목명과 기존 원자재 목록(78건)이 들어감', fc && fc.init.body.messages[0].content.includes('[품목명]\n테스트용 고무장갑') && (fc.init.body.messages[0].content.match(/- 코드:RM\d{3}, 한글명:/g) || []).length === 78);
  check('B10 원자재마스터 80행에 RM079 니트릴고무 추가', e.sh.raw[78] && e.sh.raw[78][0] === 'RM079' && e.sh.raw[78][1] === '니트릴고무' && e.sh.raw[78][2] === 'NBR', e.sh.raw[78]);
  check('B11 품목마스터는 건드리지 않음(F열 쓰기 없음)', !e.sh.requests.some(x => x.url.includes('품목마스터')));
  const logLine = e.logs.find(l => l.startsWith('[suggest] '));
  const lj = logLine && JSON.parse(logLine.slice(10));
  check('B12 로그 1줄: mode/source/email/provider/attempts/lockMs/newRM/totalMs 포함', lj && lj.mode === 'app' && lj.source === 'cloud-run' && lj.email === 'jhjoo@nkmro.com' && lj.provider === 'DEEPSEEK' && lj.attempts.length === 1 && typeof lj.lockMs === 'number' && J(lj.newRM) === '["RM079"]' && lj.ok === true && typeof lj.totalMs === 'number', lj);
  check('B13 로그에 AI 키·프롬프트 전문이 없음', !e.logs.some(l => l.includes('sk-TESTKEY') || l.includes('MRO(산업 소모성 자재)')));
  r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', idempotencyKey: 'K1', itemName: '테스트용 고무장갑' });
  check('B14 같은 요청 번호로 다시 오면 AI를 다시 부르지 않고 같은 답', r.ok === true && J(r.materials) === '["고무","니트릴고무"]' && e.fetchCalls.length === 1 && e.sh.raw.filter(x => x[1] === '니트릴고무').length === 1, { calls: e.fetchCalls.length });
  r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', idempotencyKey: 'K2', itemName: '테스트용 고무장갑' });
  check('B15 새 요청 번호면 다시 추천(AI 큐가 비어 실패) → AI_FAILED, 이전에 추가한 행은 그대로', r.error === 'AI_FAILED' && e.sh.raw.filter(x => x[1] === '니트릴고무').length === 1, r);

  e = makeEnv({ ai: [null, null] });
  r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', itemName: '황산' });
  check('B16 DeepSeek 2회 모두 HTTP 오류 → AI_FAILED(화면은 Apps Script로 넘김), 시트 쓰기 0', r.error === 'AI_FAILED' && e.fetchCalls.length === 2 && !e.sh.requests.some(x => x.method === 'PUT' || x.url.includes(':append')), r);
  const lj2 = JSON.parse(e.logs.find(l => l.startsWith('[suggest] ')).slice(10));
  check('B17 실패 로그에 시도별 httpStatus 500 2건', lj2.attempts.length === 2 && lj2.attempts.every(a => a.httpStatus === 500) && lj2.error === 'AI_FAILED', lj2);

  {
    e = makeEnv({ ai: ['HANG'], settings: [['원자재추천AI대기초', 10], ['원자재추천AI시도횟수', 1]] });
    const t0 = Date.now();
    r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', itemName: '응답없음' });
    const el = Date.now() - t0;
    const lj3 = JSON.parse(e.logs.find(l => l.startsWith('[suggest] ')).slice(10));
    check('B18 AI가 응답 없음 → 설정한 10초(하한)에 실제로 끊고 AI_FAILED(설정 시트 값 반영, 시도 1회)', r.error === 'AI_FAILED' && el >= 9900 && el < 12000 && lj3.attempts[0].error === 'TIMEOUT' && lj3.attempts[0].timeoutMs === 10000 && lj3.aiTimeoutSec === 10 && lj3.aiAttempts === 1, { el, lj3 });
  }
  {
    e = makeEnv({ ai: [J({ materials: [{ isNew: true, korean: '니켈', keyword: '니켈' }] })] });
    e.sh.hooks.failAppend = 'sheets 503';
    r = await e.call({ mode: 'app', sessionToken: 'TOK_LEADER', idempotencyKey: 'K9', itemName: '니켈판' });
    check('B19 시트 쓰기 중 예외 → 500 SERVER_ERROR(화면은 Apps Script로 넘김) + 잠금 풀림 + 요청 번호 기록 지움', r.httpStatus === 500 && r.error === 'SERVER_ERROR' && !('writeLocks/rawMaterialMaster' in e.fs.store) && !('writeIdempotency/suggest_K9' in e.fs.store), r);
    check('B20 오류 로그에 원인 요약 + 키 없음', e.logs.some(l => l.startsWith('[suggest] ') && l.includes('SERVER_ERROR') && l.includes('sheets 503')) && !e.logs.some(l => l.includes('sk-TESTKEY')));
  }

  console.log('── C그룹: feed.html 자동 폴백 그대로 실행 ──');
  const feed = fs.readFileSync(path.join(repo, 'feed.html'), 'utf8');
  function grab(re) { const m = feed.match(re); if (!m) throw new Error('feed.html에서 못 찾음: ' + re); return m[0]; }
  // 함수 본문은 중괄호 짝을 세어서 잘라낸다(문자열·주석 속 중괄호는 이 두 함수에 없음을 확인)
  function grabFn(startMarker, fnHead) {
    const s = feed.indexOf(startMarker); if (s < 0) throw new Error('feed.html에서 못 찾음: ' + startMarker);
    const h = feed.indexOf(fnHead, s); const open = feed.indexOf('{', h);
    let depth = 0, i = open;
    for (; i < feed.length; i++) { if (feed[i] === '{') depth++; else if (feed[i] === '}') { depth--; if (depth === 0) break; } }
    return feed.slice(s, i + 1) + '\n';
  }
  const remoteSrc = grabFn('const SUGGEST_FALLBACK_ERRORS_', 'async function suggestMaterialsRemote_(itemName)');
  const formSrc = grabFn('let suggestMaterialsSeq_ = 0;', 'async function suggestMaterialsForForm()');
  const urlLine = grab(/const CLOUD_RUN_SUGGEST_MATERIALS_URL = '[^']*';/);
  check('C0 스위치 상수 = suggestMaterialsTest 주소', urlLine.includes("'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/suggestMaterialsTest'"));

  function makeFront(opts) {
    const fx = { vnow: 1000000, fetchBodies: [], apiCalls: [], logs: [], btn: { disabled: false, textContent: '', dataset: { default: '✨ AI 추천 다시 받기' } }, rendered: 0 };
    const ctx = {
      console: { log: s => fx.logs.push(s) }, setTimeout, clearTimeout, AbortController, JSON, Object,
      Date: { now: () => fx.vnow }, // 가짜 시계: 응답이 몇 초 뒤에 온 것처럼 흉내
      session: { sessionToken: 'TOK' },
      DEFAULT_API_REQUEST_TIMEOUT_MS: 20000,
      API_REQUEST_TIMEOUT_MS_BY_ACTION: { suggestMaterials: opts.timeoutMs || 60000 },
      generateIdempotencyKey_: () => 'IDEM-' + (fx.fetchBodies.length + 1),
      fetch: async (url, init) => {
        fx.fetchBodies.push(JSON.parse(init.body)); fx.fetchUrl = url;
        const b = opts.remote;
        if (b === 'NETWORK') throw new TypeError('Failed to fetch');
        if (b === 'HANG') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        if (opts.onFetch) await opts.onFetch(fx);
        if (opts.delayMs) fx.vnow += opts.delayMs;
        if (b.networkAfter) throw new TypeError('Failed to fetch');
        return { status: b.status, json: async () => { if (b.html) throw new SyntaxError('Unexpected token <'); return b.json; } };
      },
      callApi: async (action, body) => { fx.apiCalls.push({ action, body }); return opts.gas || { ok: true, materials: ['GAS결과'] }; },
      document: { getElementById: id => id === 'item-name-input' ? { value: '  테스트용 고무장갑 ' } : id === 'ai-suggest-btn' ? fx.btn : null },
      itemsState: { selectedMaterials: null },
      renderMaterialTags: () => { fx.rendered++; }
    };
    vm.runInNewContext("const CLOUD_RUN_SUGGEST_MATERIALS_URL = " + J(opts.url === undefined ? 'https://cr/suggestMaterialsTest' : opts.url) + ";\n" + remoteSrc + formSrc +
      "\n;globalThis.__remote = suggestMaterialsRemote_; globalThis.__form = suggestMaterialsForForm; globalThis.__bump = () => { suggestMaterialsSeq_++; };", ctx);
    fx.ctx = ctx;
    return fx;
  }
  const cases = [
    { id: 'C1', name: '스위치 비움(롤백) → Apps Script만', o: { url: '' }, expectGas: true, expectFetch: 0 },
    { id: 'C2', name: '연결 실패 → Apps Script로 넘김', o: { remote: 'NETWORK' }, expectGas: true },
    { id: 'C3', name: '503 → Apps Script로 넘김', o: { remote: { status: 503, json: { ok: false } } }, expectGas: true },
    { id: 'C4', name: '404 HTML(함수 미배포) → Apps Script로 넘김', o: { remote: { status: 404, html: true } }, expectGas: true },
    { id: 'C5', name: 'AI_FAILED → Apps Script로 넘김', o: { remote: { status: 200, json: { ok: false, error: 'AI_FAILED' } } }, expectGas: true },
    { id: 'C6', name: 'LOCK_TIMEOUT → Apps Script로 넘김', o: { remote: { status: 200, json: { ok: false, error: 'LOCK_TIMEOUT' } } }, expectGas: true },
    { id: 'C7', name: 'FORBIDDEN → 넘기지 않고 실패 표시', o: { remote: { status: 200, json: { ok: false, error: 'FORBIDDEN' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C8', name: 'SESSION_EXPIRED → 넘기지 않고 실패 표시', o: { remote: { status: 200, json: { ok: false, error: 'SESSION_EXPIRED' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C9', name: '성공 → Cloud Run 결과로 태그 표시', o: { remote: { status: 200, json: { ok: true, materials: ['고무'] } } }, expectGas: false, expectTags: '["고무"]' },
    { id: 'C10', name: '60초 무응답(여기선 0.3초로 축소) → 넘기지 않고 실패 표시', o: { remote: 'HANG', timeoutMs: 300 }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' }
  ];
  for (const cs of cases) {
    const fx = makeFront(cs.o);
    await fx.ctx.__form();
    const okGas = cs.expectGas ? fx.apiCalls.length === 1 && fx.apiCalls[0].action === 'suggestMaterials' && fx.apiCalls[0].body.itemName === '테스트용 고무장갑' : fx.apiCalls.length === 0;
    const okFetch = cs.expectFetch === 0 ? fx.fetchBodies.length === 0 : fx.fetchBodies.length === 1;
    const okTags = cs.expectTags ? J(fx.ctx.itemsState.selectedMaterials) === cs.expectTags && fx.btn.textContent === '✨ AI 추천 다시 받기' : true;
    const okBtn = cs.expectBtn ? fx.btn.textContent === cs.expectBtn && fx.btn.disabled === false : true;
    const okGasTags = cs.expectGas ? J(fx.ctx.itemsState.selectedMaterials) === '["GAS결과"]' : true;
    check(cs.id + ' ' + cs.name, okGas && okFetch && okTags && okBtn && okGasTags, { api: fx.apiCalls.length, fetch: fx.fetchBodies.length, btn: fx.btn.textContent, tags: fx.ctx.itemsState.selectedMaterials });
  }
  {
    const fx = makeFront({ remote: { status: 200, json: { ok: true, materials: ['고무'] } } });
    await fx.ctx.__form();
    const b = fx.fetchBodies[0];
    check('C11 Cloud Run 요청 내용 = { mode:app, sessionToken, idempotencyKey, itemName(앞뒤 공백 제거) }', b.mode === 'app' && b.sessionToken === 'TOK' && b.idempotencyKey === 'IDEM-1' && b.itemName === '테스트용 고무장갑', b);
  }
  {
    // Cloud Run 응답을 기다리는 동안 사용자가 폼을 닫거나 다시 요청하면, 실패해도 Apps Script로 넘기지 않음
    let fx;
    fx = makeFront({ remote: { status: 200, json: { ok: false, error: 'AI_FAILED' } }, onFetch: async f => { f.ctx.__bump(); } });
    await fx.ctx.__form();
    check('C12 기다리는 사이 더 최근 요청이 생기면 Apps Script로 넘기지 않음(쓸모없는 AI 호출 방지)', fx.apiCalls.length === 0 && fx.ctx.itemsState.selectedMaterials === null, fx.apiCalls.length);
  }

  console.log('── C그룹 보충: 30초 넘은 실패는 Apps Script로 넘기지 않음 ──');
  const slowCases = [
    { id: 'C14', name: 'AI_FAILED가 29.9초에 옴 → Apps Script로 넘김', o: { delayMs: 29900, remote: { status: 200, json: { ok: false, error: 'AI_FAILED' } } }, expectGas: true },
    { id: 'C15', name: 'AI_FAILED가 30.0초에 옴 → 넘기지 않고 실패 표시(SLOW_FAILURE)', o: { delayMs: 30000, remote: { status: 200, json: { ok: false, error: 'AI_FAILED' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C16', name: 'AI_FAILED가 42초에 옴(AI가 40초에 끊긴 경우) → 넘기지 않음', o: { delayMs: 42000, remote: { status: 200, json: { ok: false, error: 'AI_FAILED' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C17', name: 'LOCK_TIMEOUT이 33초에 옴 → 넘기지 않음', o: { delayMs: 33000, remote: { status: 200, json: { ok: false, error: 'LOCK_TIMEOUT' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C18', name: '503이 35초에 옴 → 넘기지 않음', o: { delayMs: 35000, remote: { status: 503, json: { ok: false } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C19', name: '연결 끊김이 31초에 남 → 넘기지 않음', o: { delayMs: 31000, remote: { networkAfter: true } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' },
    { id: 'C20', name: '503이 2초에 옴 → 그대로 넘김(빠른 실패)', o: { delayMs: 2000, remote: { status: 503, json: { ok: false } } }, expectGas: true },
    { id: 'C21', name: '성공이 45초에 옴 → 시간과 상관없이 결과 표시', o: { delayMs: 45000, remote: { status: 200, json: { ok: true, materials: ['고무'] } } }, expectGas: false, expectTags: '["고무"]' },
    { id: 'C22', name: 'FORBIDDEN이 31초에 옴 → 넘기지 않음(원래도 안 넘김)', o: { delayMs: 31000, remote: { status: 200, json: { ok: false, error: 'FORBIDDEN' } } }, expectGas: false, expectBtn: '⚠️ 추천 실패 - 다시 시도' }
  ];
  for (const cs of slowCases) {
    const fx = makeFront(cs.o);
    await fx.ctx.__form();
    const okGas = cs.expectGas ? fx.apiCalls.length === 1 && J(fx.ctx.itemsState.selectedMaterials) === '["GAS결과"]' : fx.apiCalls.length === 0;
    const okTags = cs.expectTags ? J(fx.ctx.itemsState.selectedMaterials) === cs.expectTags : true;
    const okBtn = cs.expectBtn ? fx.btn.textContent === cs.expectBtn && fx.btn.disabled === false : true;
    const okLog = (cs.id === 'C15' || cs.id === 'C16' || cs.id === 'C17' || cs.id === 'C18' || cs.id === 'C19') ? fx.logs.some(l => /no fallback \(slow\)/.test(l)) : true;
    check(cs.id + ' ' + cs.name, okGas && okTags && okBtn && okLog, { api: fx.apiCalls.length, btn: fx.btn.textContent, tags: fx.ctx.itemsState.selectedMaterials, logs: fx.logs });
  }

  console.log('── T그룹: 서버 시간 예산(가짜 시계로 엔진 실행) ──');
  // 가짜 시계 환경: 시트 읽기·쓰기·잠금은 즉시(또는 지정 시간), AI는 시나리오대로 걸린 시간만큼 시계를 진행
  async function runTimed(sc) {
    const clock = { now: 0 };
    const sh = makeFakeSheets({});
    const io = ms.makeSheetsIO(sh.client, 'SHEET');
    const ioTimed = Object.assign({}, io, { readRawRows: async () => { clock.now += sc.readMs || 0; return io.readRawRows(); } });
    const calls = [];
    const ai = async (prompt, timeoutMs) => {
      const step = sc.ai[calls.length] || { ms: 999999 };
      calls.push({ timeoutMs, at: clock.now });
      if (step.ms > timeoutMs) { clock.now += timeoutMs; return { text: null, httpStatus: 0, ms: timeoutMs, error: 'TIMEOUT' }; }
      clock.now += step.ms;
      if (step.http) return { text: null, httpStatus: step.http, ms: step.ms, error: 'HTTP_' + step.http };
      return { text: step.text || J({ materials: [{ isNew: false, korean: '고무', keyword: '고무' }] }), httpStatus: 200, ms: step.ms, error: null };
    };
    let lockWaitAsked = null;
    const lock = { acquire: async w => { lockWaitAsked = w; if (sc.lockBusy) { clock.now += w; return false; } return true; }, release: async () => {} };
    const opts = Object.assign(ms.readOptions(sc.settings || {}), { deadlineMs: (sc.requestStartMs || 0) + ms.REQUEST_BUDGET_MS });
    const log = {};
    const res = await ms.suggestForItemName({ io: ioTimed, lock, ai, now: () => clock.now }, '시험품목', opts, log);
    return { res, calls, log, end: clock.now, lockWaitAsked };
  }
  let tr;
  tr = await runTimed({ ai: [{ ms: 20500 }] });
  check('T1(D) 시험 1 재현: 1차가 20.5초 걸려도 40초 대기라 끊기지 않고 1회로 성공(총 20.5초)', tr.res.ok && tr.calls.length === 1 && tr.calls[0].timeoutMs === 40000 && tr.end === 20500, tr);
  tr = await runTimed({ ai: [{ ms: 60000 }, { ms: 1000 }] });
  check('T2(A) 1차가 40초에 끊김 → 남은 AI 시간 5초(<10초) → 다시 부르지 않고 AI_FAILED(40초에 종료)', !tr.res.ok && tr.res.error === 'AI_FAILED' && tr.calls.length === 1 && tr.log.aiStop === 'RETRY_SKIPPED_LOW_TIME' && tr.end === 40000, tr);
  tr = await runTimed({ ai: [{ ms: 1500, http: 503 }, { ms: 15000 }] });
  check('T3(A) 1차가 1.5초 만에 서버 오류 → 남은 43.5초 → 2차는 40초 대기로 다시 불러 성공', tr.res.ok && tr.calls.length === 2 && tr.calls[1].timeoutMs === 40000 && tr.end === 16500, tr);
  tr = await runTimed({ ai: [{ ms: 30000, text: '형식오류' }, { ms: 20000 }] });
  check('T4(A) 1차가 30초에 형식 오류 → 남은 15초 → 2차는 15초만 기다리고 끊김 → AI 합계 정확히 45초에서 종료', !tr.res.ok && tr.calls.length === 2 && tr.calls[1].timeoutMs === 15000 && tr.end === 45000 && tr.log.aiTotalMs === 45000, tr);
  tr = await runTimed({ ai: [{ ms: 36000, text: '형식오류' }, { ms: 1000 }] });
  check('T5(A) 1차가 36초에 형식 오류 → 남은 9초(<10초) → 다시 부르지 않음', !tr.res.ok && tr.calls.length === 1 && tr.log.aiStop === 'RETRY_SKIPPED_LOW_TIME', tr);
  tr = await runTimed({ ai: [{ ms: 999999 }], readMs: 8000 });
  check('T6(A) AI 전 단계가 8초 걸린 경우: AI 마감 = 요청 50초 - 쓰기 여유 4초 = 46초 → 1차 대기는 38초로 줄어듦', !tr.res.ok && tr.calls[0].timeoutMs === 38000 && tr.end === 46000, tr);
  tr = await runTimed({ ai: [{ ms: 44000 }], readMs: 500, settings: { '원자재추천AI대기초': 45 } });
  check('T7(A) (설정 45초) AI가 44.5초에 끝남 → 잠금 대기를 10초 대신 2.5초로 줄여 50초 안에 끝냄', tr.res.ok && tr.lockWaitAsked === 2500, tr);
  tr = await runTimed({ ai: [{ ms: 44000 }], readMs: 500, lockBusy: true, settings: { '원자재추천AI대기초': 45 } });
  check('T8(A·E) 최악(설정 45초): AI 44.5초 + 잠금 못 잡음 → LOCK_TIMEOUT, 서버 종료 47초(50초 이내)', tr.res.error === 'LOCK_TIMEOUT' && tr.end === 47000, tr);
  tr = await runTimed({ ai: [{ ms: 999999 }], settings: { '원자재추천AI대기초': 45 } });
  check('T9 설정 45초(상한)여도 AI 전체 45초 예산 안에서 끝남', !tr.res.ok && tr.calls[0].timeoutMs === 45000 && tr.end === 45000, tr);
  // E: 여러 최악 조합에서 서버 종료 시각이 50초를 넘지 않는지
  let worst = 0;
  for (const sec of [40, 45]) for (const readMs of [0, 2000, 8000, 15000]) for (const a1 of [1000, 20000, 39000, 44000, 999999]) for (const busy of [false, true]) {
    const r2 = await runTimed({ readMs, lockBusy: busy, settings: { '원자재추천AI대기초': sec }, ai: [{ ms: a1, http: a1 === 1000 ? 500 : undefined }, { ms: 999999 }] });
    worst = Math.max(worst, r2.end);
  }
  check('T10(E) 80가지 최악 조합(설정 40·45초 × AI 전 단계 0~15초 × AI 지연 5종 × 잠금 실패 여부)에서 서버 종료 최대 ' + (worst / 1000) + '초 ≤ 50초(시트 쓰기 시간 제외, 아래 설명)', worst <= 50000, worst);

  // 전체 문법 확인
  // <script ...src...> 태그(외부 파일)와 주석 속 "<script src>" 글자는 제외
  const scripts = [...feed.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let syntaxOk = true;
  scripts.forEach((s, i) => { try { new vm.Script(s, { filename: 'feed-inline-' + i + '.js' }); } catch (err) { syntaxOk = false; console.log('  문법 오류 script#' + i + ': ' + err.message); } });
  check('C13 feed.html 안의 스크립트 ' + scripts.length + '개 모두 문법 오류 없음', syntaxOk);

  console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch(err => { console.error('시험 실행 오류:', err); process.exitCode = 1; });
