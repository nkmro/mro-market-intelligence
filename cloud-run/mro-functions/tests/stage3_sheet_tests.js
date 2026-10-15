// cloud-run/mro-functions/tests/stage3_sheet_tests.js
// AI 원자재 추천 이전 단계 3(시트 편집 → Cloud Run mode=sheet, AI 2회 호출 제거) 가짜 데이터 시험. 2026-10-14
// 실제 시트·Firestore·DeepSeek·Apps Script는 쓰지 않는다(네트워크 호출 0건).
//   P그룹: Apps Script 쪽 — apps-script/Code.gs의 onEditInstallable·dispatchSheetSuggest_ 등을 그대로 잘라 가짜 환경에서 실행
//          (행 모으기·합치기, Cloud Run 1회 호출, 빠른 실패만 동결본 폴백, 30초 규칙, 스위치 끔 = 단계 2와 동일)
//   R그룹: Cloud Run 쪽 — index.js suggestMaterialsTest(mode=sheet)를 그대로 실행
//          (비밀값, 재확인, 처리권 넘겨받기, 동시 5행, 행 한도, 원자재마스터 공용 잠금, I 규칙, 로그)
//   N그룹: 세 벌(Code.gs·index.js·lib)의 원자재 비교 규칙이 같은지
// 실행: (cloud-run/mro-functions 폴더에서) node tests/stage3_sheet_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const dir = path.resolve(__dirname, '..');
const repo = path.resolve(dir, '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
const ms = require(path.join(dir, 'lib', 'materialSuggest.js'));

let failures = 0, passes = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 700)));
  if (cond) passes++; else failures++;
}
const J = s => JSON.stringify(s);
const sleep = ms_ => new Promise(r => setTimeout(r, ms_));
function extractFn(name) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(/\nfunction [\w$]+\s*\(/);
  return rest.slice(0, m + 1);
}

// ═════════════════════════ P그룹: Apps Script ═════════════════════════
const GAS_SRC = ['onEditInstallable', 'sheetSuggestProxyConfig_', 'applyFrozenFill_', 'applyFrozenEdit_', 'dispatchSheetSuggest_',
  'stage3CheckProxy', 'normalizeMaterialsForCompare_'].map(extractFn).join('\n');
const PROXY_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/suggestMaterialsTest';
const TOKEN = 'T'.repeat(64);

function makeGas(opts) {
  opts = opts || {};
  const clock = { now: Date.UTC(2026, 9, 14, 3, 0, 0) };
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(clock.now); }
  FakeDate.now = () => clock.now;
  FakeDate.prototype = RealDate.prototype;
  const env = { clock, logs: [], errors: [], fetches: [], suggests: [], writes: [] };
  const items = opts.items || [
    ['MP자재코드', '고객사', '품목명', '담당', '팀', '주요원자재', '상태', '등록일', '원자재수정일'],
    ['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 'd', '']
  ];
  env.items = items;
  const sheet = {
    getName: () => '품목마스터',
    getRange: (r, c) => ({
      getValue: () => (items[r - 1] || [])[c - 1] === undefined ? '' : items[r - 1][c - 1],
      setValue: v => { while (items.length < r) items.push([]); items[r - 1][c - 1] = v; env.writes.push({ r, c, v: v instanceof RealDate ? 'DATE' : v }); },
      setNumberFormat: () => {}
    })
  };
  env.sheet = sheet;
  const props = Object.assign({ AI_PROVIDER: 'DEEPSEEK' }, opts.props === undefined ? { SUGGEST_PROXY_URL: PROXY_URL, SUGGEST_PROXY_TOKEN: TOKEN } : opts.props);
  const responder = opts.responder || (rows => ({ code: 200, body: { ok: true, results: rows.map(r => ({ itemId: r.itemId, rowNumber: r.rowNumber, status: 'written', materials: ['면'] })) } }));
  const ctx = {
    Date: FakeDate, JSON, Math, String, Number, Object, Array, parseInt,
    console: { log: s => env.logs.push(String(s)), error: s => env.errors.push(String(s)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k] }) },
    UrlFetchApp: {
      fetch: (url, o) => {
        const payload = JSON.parse(o.payload);
        env.fetches.push({ url, headers: o.headers, payload });
        const r = responder(payload.rows, env);
        if (r.advanceMs) clock.now += r.advanceMs;
        if (r.throws) throw new Error(r.throws);
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : J(r.body)) };
      }
    },
    suggestRawMaterials: (name, mode) => { env.suggests.push({ name: String(name), mode }); return opts.frozenFails ? null : { korean: ['면'] }; },
    autofillManagerFromCustomer_: () => {},
    runWithSyncLock_: () => {}, SHEET_USER: '사용자팀마스터'
  };
  vm.runInNewContext(GAS_SRC, ctx);
  env.ctx = ctx;
  env.edit = (row, col, o) => {
    o = o || {};
    const nr = o.numRows || 1, nc = o.numCols || 1;
    ctx.onEditInstallable({ range: { getSheet: () => sheet, getRow: () => row, getColumn: () => col, getLastRow: () => row + nr - 1,
      getNumRows: () => nr, getNumColumns: () => nc, getValue: () => sheet.getRange(row, col).getValue() }, oldValue: o.oldValue });
  };
  env.proxyLog = () => { const l = env.logs.find(x => x.startsWith('[suggest-proxy] ')); return l && JSON.parse(l.slice(16)); };
  return env;
}
const NEW_ROW = ['TEST-003', '반도코리아(주)', '테스트용 면장갑', '', '동부', '', '비활성', '2026-10-14', ''];

(async () => {
  console.log('── P그룹: Apps Script onEditInstallable → Cloud Run 1회 호출 ──');
  let e = makeGas();
  e.items.push(NEW_ROW.slice());
  e.edit(3, 3); // 시험 (a): A·B 먼저, C를 마지막에 한 칸 입력
  check('P1 새 행(C 마지막 입력): ②-a와 ②-b가 같은 행 → Cloud Run 요청 1번·행 1개·reason single_edit (부록 D-3 해결)',
    e.fetches.length === 1 && e.fetches[0].payload.mode === 'sheet' && J(e.fetches[0].payload.rows) === J([{ itemId: 'TEST-003', rowNumber: 3, itemName: '테스트용 면장갑', reason: 'single_edit' }]), e.fetches.map(f => f.payload));
  check('P2 Apps Script는 AI(동결본)를 안 부르고 F·I를 안 씀(Cloud Run이 씀)', e.suggests.length === 0 && !e.writes.some(w => w.c === 6 || w.c === 9), { s: e.suggests, w: e.writes });
  check('P3 비밀값은 헤더(X-Suggest-Proxy-Token)로만 보내고 로그에는 안 남김', e.fetches[0].headers['X-Suggest-Proxy-Token'] === TOKEN && !e.logs.concat(e.errors).some(l => l.includes(TOKEN)));
  const pl = e.proxyLog();
  check('P4 Apps Script 기록 [suggest-proxy] 1줄: 보낸 행·HTTP·대기·결과·폴백 없음', pl && J(pl.rows) === '["3:single_edit"]' && pl.http === 200 && J(pl.results) === '["3:written"]' && J(pl.fallback) === '[]', pl);

  e = makeGas();
  e.items.push(['TEST-003', '반도코리아(주)', '테스트용 면장갑', '', '동부', '', '', '', '']);
  e.edit(3, 1); // A열 편집(C는 이미 있음, F 빔)
  check('P5 C가 아닌 칸 편집 + F 빈 행 → fill_empty 1행, G·H는 지금처럼 Apps Script가 채움', e.fetches.length === 1 && e.fetches[0].payload.rows[0].reason === 'fill_empty' && e.items[2][6] === '활성' && e.writes.some(w => w.r === 3 && w.c === 8), e.fetches.map(f => f.payload));

  e = makeGas();
  e.items.push(['TEST-004', '반도코리아(주)', '테스트용 비닐장갑', '', '동부', '', '비활성', '2026-10-14', '']);
  e.items.push(['TEST-005', '반도코리아(주)', '테스트용 목장갑', '', '동부', '', '비활성', '2026-10-14', '']);
  e.items.push(['TEST-006', '반도코리아(주)', '테스트용 코팅장갑', '', '동부', '', '비활성', '2026-10-14', '']);
  e.edit(3, 1, { numRows: 3, numCols: 8 }); // 시험 (c): 3행 붙여넣기
  check('P6 3행 붙여넣기 → 요청 1번에 3행 모두 fill_empty', e.fetches.length === 1 && J(e.fetches[0].payload.rows.map(r => r.rowNumber + ':' + r.reason)) === '["3:fill_empty","4:fill_empty","5:fill_empty"]', e.fetches.map(f => f.payload));

  e = makeGas();
  e.items[1][2] = '테스트용 PVC장갑';
  e.edit(2, 3, { oldValue: '기존품목' }); // 시험 (b): F가 이미 있는 행의 C 한 칸 수정
  check('P7 F가 있는 행의 품목명 한 칸 수정 → single_edit(itemId=A열), 요청 1번', e.fetches.length === 1 && J(e.fetches[0].payload.rows) === J([{ itemId: 'A1', rowNumber: 2, itemName: '테스트용 PVC장갑', reason: 'single_edit' }]), e.fetches.map(f => f.payload));

  e = makeGas();
  e.edit(2, 3, { numRows: 2, numCols: 1 }); // C열 여러 칸 붙여넣기, 2행 F는 이미 있음
  check('P8 C열 붙여넣기인데 F가 이미 있음 → 요청 안 함(기존 "붙여넣기는 F가 빌 때만" 원칙)', e.fetches.length === 0 && e.suggests.length === 0);

  e = makeGas();
  e.items.push(['', '', '테스트용 면장갑', '', '', '', '', '', '']);
  e.edit(3, 3); // A·B 없이 C만 입력(지금 코드도 F를 채우는 경우)
  check('P9 A 없이 C만 입력 → itemId 빈 값 + 행 번호로 보냄(계획서 변경 #4)', e.fetches.length === 1 && J(e.fetches[0].payload.rows) === J([{ itemId: '', rowNumber: 3, itemName: '테스트용 면장갑', reason: 'single_edit' }]), e.fetches.map(f => f.payload));

  e = makeGas();
  e.items[1][5] = '';
  e.edit(2, 6, { oldValue: '고무' }); // F 지움
  check('P10 F를 지움 → I는 지금처럼 즉시 찍고(사람이 바꾼 것), 빈 F는 Cloud Run이 채우도록 fill_empty 1번', e.writes.some(w => w.r === 2 && w.c === 9) && e.fetches.length === 1 && e.fetches[0].payload.rows[0].reason === 'fill_empty' && e.suggests.length === 0, { w: e.writes, f: e.fetches.map(f => f.payload) });

  // 폴백 규칙(계획서 변경 #5)
  e = makeGas({ responder: () => ({ code: 500, body: { ok: false, error: 'SERVER_ERROR' }, advanceMs: 2000 }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P11 Cloud Run 5xx(빠름) → 그 행을 동결본으로 1번만 처리(합친 single_edit → sheet_edit 1회), F 채움', e.suggests.length === 1 && e.suggests[0].mode === 'sheet_edit' && e.items[2][5] === '면' && J(e.proxyLog().fallback) === '[3]', { s: e.suggests, pl: e.proxyLog() });
  e = makeGas({ responder: () => ({ code: 401, body: { ok: false, error: 'UNAUTHORIZED' } }) });
  e.items.push(['TEST-003', '반도코리아(주)', '테스트용 면장갑', '', '동부', '', '', '', '']); e.edit(3, 1);
  check('P12 비밀값 불일치(401) → 동결본 sheet_fill 1회 + I 찍음(단계 2 규칙)', e.suggests.length === 1 && e.suggests[0].mode === 'sheet_fill' && e.writes.some(w => w.r === 3 && w.c === 9) && e.proxyLog().error.includes('UNAUTHORIZED'), e.proxyLog());
  e = makeGas({ responder: () => ({ code: 200, body: '<html>oops' }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P13 JSON이 아닌 응답 → 동결본', e.suggests.length === 1 && e.proxyLog().error.includes('non-json'));
  e = makeGas({ responder: () => ({ throws: 'Address unavailable', advanceMs: 500 }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P14 연결 실패(빠름) → 동결본', e.suggests.length === 1 && e.proxyLog().error.startsWith('fetch:'));
  e = makeGas({ responder: () => ({ throws: 'Timeout', advanceMs: 61000 }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P15 30초 넘어 받은 실패(대기 초과) → 동결본으로 넘기지 않음(Cloud Run이 이미 썼을 수 있음), F는 그대로', e.suggests.length === 0 && e.proxyLog().noFallback === 'slow' && e.items[2][5] === '', e.proxyLog());
  e = makeGas({ responder: () => ({ code: 503, body: { ok: false, error: 'PROXY_NOT_CONFIGURED' }, advanceMs: 31000 }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P16 31초 뒤 5xx → 동결본으로 넘기지 않음(30초 규칙)', e.suggests.length === 0 && e.proxyLog().noFallback === 'slow');
  e = makeGas({ responder: rows => ({ code: 200, advanceMs: 3000, body: { ok: true, results: [
    { rowNumber: 3, status: 'written' }, { rowNumber: 4, status: 'lock_timeout' }, { rowNumber: 5, status: 'ai_failed' }] } }) });
  e.items.push(['TEST-004', '반도코리아(주)', '테스트용 비닐장갑', '', '동부', '', '', '', '']);
  e.items.push(['TEST-005', '반도코리아(주)', '테스트용 목장갑', '', '동부', '', '', '', '']);
  e.items.push(['TEST-006', '반도코리아(주)', '테스트용 코팅장갑', '', '동부', '', '', '', '']);
  e.edit(3, 1, { numRows: 3, numCols: 8 });
  check('P17 행별 결과: lock_timeout 행만 동결본(sheet_fill 1회), ai_failed·written 행은 넘기지 않음', e.suggests.length === 1 && e.suggests[0].name === '테스트용 목장갑' && J(e.proxyLog().fallback) === '[4]', { s: e.suggests, pl: e.proxyLog() });
  e = makeGas({ responder: () => ({ code: 200, body: { ok: true, results: [{ rowNumber: 3, status: 'stale', why: 'NAME_CHANGED' }] } }) });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P18 stale(재확인에서 안 씀) → 아무것도 안 함, 기록에 이유 표시', e.suggests.length === 0 && J(e.proxyLog().results) === '["3:stale(NAME_CHANGED)"]');

  // 스위치 끔 = 단계 2와 완전히 같은 동작
  e = makeGas({ props: { SUGGEST_PROXY_URL: '', SUGGEST_PROXY_TOKEN: TOKEN } });
  e.items.push(NEW_ROW.slice()); e.edit(3, 3);
  check('P19 스위치 끔(SUGGEST_PROXY_URL 빈 값) → Cloud Run 호출 0, 단계 2와 같이 동결본 sheet_fill → sheet_edit 순서(②-b는 붙여넣기가 아닌 한 칸 수정이라 다시 추천)', e.fetches.length === 0 && J(e.suggests.map(s => s.mode)) === '["sheet_fill","sheet_edit"]', e.suggests);
  e = makeGas({ props: { SUGGEST_PROXY_URL: PROXY_URL } });
  e.items.push(NEW_ROW.slice()); e.edit(3, 1);
  check('P20 비밀값이 없으면 URL이 있어도 스위치 끔으로 취급(동결본 sheet_fill 1회)', e.fetches.length === 0 && J(e.suggests.map(s => s.mode)) === '["sheet_fill"]');
  e = makeGas({ props: { SUGGEST_PROXY_URL: '' } });
  e.items[1][5] = ''; e.edit(2, 6, { oldValue: '고무' });
  check('P21 스위치 끔 + F 지움 → 단계 2와 같음: ②-a가 먼저 다시 채우고, 그 뒤 F 비교(같은 값이면 I 안 찍음 — 여기선 고무→면이라 찍음)', J(e.suggests.map(s => s.mode)) === '["sheet_fill"]' && e.items[1][5] === '면');

  // 연결 확인 함수
  e = makeGas({ props: { SUGGEST_PROXY_TOKEN: TOKEN } , responder: () => ({ code: 200, body: { ok: true, results: [] } }) });
  const cr = e.ctx.stage3CheckProxy();
  check('P22 stage3CheckProxy: 스위치 끈 상태에서도 확인 가능(기본 주소로 행 0개 요청) → "인증 OK", 비밀값은 길이만 출력', cr === 'ok' && e.fetches[0].url === PROXY_URL && J(e.fetches[0].payload.rows) === '[]' && e.logs.some(l => l.includes('인증 OK') && l.includes('비밀값 길이 64') && l.includes('꺼짐')) && !e.logs.some(l => l.includes(TOKEN)), e.logs);
  e = makeGas({ props: {}, responder: () => ({ code: 401, body: { ok: false, error: 'UNAUTHORIZED' } }) });
  check('P23 stage3CheckProxy: 비밀값 없음 → no_token(요청 안 함)', e.ctx.stage3CheckProxy() === 'no_token' && e.fetches.length === 0);

  // ═════════════════════════ R그룹: Cloud Run mode=sheet ═════════════════════════
  console.log('── R그룹: index.js suggestMaterialsTest mode=sheet 그대로 실행 ──');
  const CURRENT = { client: null };
  require.cache[require.resolve('google-auth-library', { paths: [dir] })] = {
    id: 'gal-stub', filename: 'gal-stub', loaded: true,
    exports: { GoogleAuth: class { async getClient() { if (!CURRENT.client) throw new Error('실제 Google 접속 시도 차단'); return CURRENT.client; } } }
  };
  function makeFakeFirestore() {
    const store = {};
    function docRef(col, id) {
      const key = col + '/' + id;
      return {
        _key: key,
        get: async () => ({ exists: key in store, data: () => store[key] && JSON.parse(JSON.stringify(store[key])) }),
        set: async d => { store[key] = JSON.parse(JSON.stringify(d)); },
        delete: async () => { delete store[key]; }
      };
    }
    return {
      store,
      collection: n => ({ doc: id => docRef(n, id) }),
      runTransaction: async fn => {
        const ops = [];
        const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.set(d)) };
        const out = await fn(tx);
        for (const op of ops) await op();
        return out;
      }
    };
  }
  const REAL_NAMES = { 1: '고무', 2: 'PVC', 9: '면', 29: '니트릴고무' };
  function rawRows() { const r = []; for (let i = 1; i <= 78; i++) r.push(['RM' + String(i).padStart(3, '0'), REAL_NAMES[i] || '원자재' + i, 'k', '활성', 46000 + i]); return r; }
  function makeSheets(items) {
    const st = { raw: rawRows(), items: items.map(r => r.slice()), requests: [], hooks: {} };
    const colIdx = c => c.charCodeAt(0) - 65;
    st.client = {
      request: async ({ url, method, data }) => {
        const u = decodeURIComponent(url);
        st.requests.push({ method: method || 'GET', url: u, data: data && JSON.parse(JSON.stringify(data)) });
        if (u.includes('values:batchGet')) return { data: { valueRanges: [{ values: st.settings || [] }] } };
        if ((!method || method === 'GET') && u.includes('?fields=sheets.properties')) return { data: { sheets: [{ properties: { sheetId: 0, title: '품목마스터' } }, { properties: { sheetId: 721000434, title: '원자재마스터' } }] } };
        if ((!method || method === 'GET') && u.includes('/values/원자재마스터!A2:E')) return { data: { values: st.raw.filter(r => r[0] || r[1]) } };
        if ((!method || method === 'GET') && u.includes('/values/품목마스터!A2:I')) { if (st.hooks.beforeItemRead) st.hooks.beforeItemRead(st); return { data: { values: st.items } }; }
        if (method === 'POST' && u.includes('/values/원자재마스터!A:E:append')) {
          const start = st.raw.length; data.values.forEach(v => st.raw.push(v.slice()));
          return { data: { updates: { updatedRange: "'원자재마스터'!A" + (start + 2) + ':E' + (start + 1 + data.values.length) } } };
        }
        if (method === 'POST' && u.endsWith('/values:batchUpdate')) {
          if (data.valueInputOption !== 'RAW') throw new Error('RAW 아님');
          data.data.forEach(d => {
            const m = d.range.match(/^품목마스터!([A-I])(\d+)$/); if (!m) throw new Error('범위 이상 ' + d.range);
            const r = +m[2] - 2; while (st.items.length <= r) st.items.push([]);
            st.items[r][colIdx(m[1])] = d.values[0][0];
          });
          return { data: {} };
        }
        if (method === 'POST' && u.endsWith(':batchUpdate')) return { data: {} };
        if (method === 'PUT' && u.includes('/values/원자재마스터!')) return { data: {} };
        if (method === 'POST' && u.includes(':clear')) return { data: {} };
        throw new Error('unexpected request ' + method + ' ' + u);
      }
    };
    return st;
  }
  // AI 가짜: 품목명별 응답·지연(ms). 동시에 몇 개가 진행 중이었는지도 기록.
  function makeEnv(o) {
    o = o || {};
    const fs_ = makeFakeFirestore();
    const sh = makeSheets(o.items || [['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, '']]);
    const env = { fs: fs_, sh, logs: [], ai: [], inFlight: 0, maxInFlight: 0 };
    const answers = o.answers || {};
    const fakeFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      const name = (/\[품목명\]\n(.+)/.exec(body.messages[0].content) || [])[1];
      env.ai.push(name);
      env.inFlight++; env.maxInFlight = Math.max(env.maxInFlight, env.inFlight);
      const a = answers[name] || { materials: [{ isNew: false, korean: '면', keyword: '면' }] };
      await sleep(a.delay || 20);
      env.inFlight--;
      if (a.fail) return { status: 500, json: async () => ({}) };
      return { status: 200, json: async () => ({ choices: [{ message: { content: J({ materials: a.materials }) } }] }) };
    };
    CURRENT.client = sh.client;
    const stubs = { '@google-cloud/firestore': { Firestore: class { constructor() { return fs_; } }, FieldValue: { serverTimestamp: () => 'TS' } } };
    const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
    const mod = { exports: {} };
    const penv = { AI_PROVIDER: 'DEEPSEEK', DEEPSEEK_API_KEY: 'sk-TESTKEY-x' };
    if (o.token !== null) penv.SUGGEST_PROXY_TOKEN = o.token || TOKEN;
    const ctx = { require: req, module: mod, exports: mod.exports, console: { log: s => env.logs.push(String(s)), error: s => env.logs.push(String(s)) },
      process: { env: penv }, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder, fetch: fakeFetch, AbortController };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
    env.call = async (body, headers) => {
      const out = {};
      await mod.exports.suggestMaterialsTest({ method: 'POST', headers: headers === undefined ? { 'x-suggest-proxy-token': TOKEN } : headers, body },
        { set() {}, status: c => ({ json: x => { out.httpStatus = c; Object.assign(out, x); }, send() { out.httpStatus = c; } }) });
      return out;
    };
    env.rowLogs = () => env.logs.filter(l => l.startsWith('[suggest] ')).map(l => JSON.parse(l.slice(10)));
    return env;
  }
  const ROW = (o) => Object.assign({ itemId: 'TEST-003', rowNumber: 3, itemName: '테스트용 면장갑', reason: 'fill_empty' }, o || {});
  const ITEMS3 = () => [['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, ''], ['TEST-003', '반도코리아(주)', '테스트용 면장갑', '박태영', '동부', '', '비활성', 46309, '']];

  let r;
  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sheet', rows: [ROW()] }, {});
  check('R1 비밀값 헤더 없음 → 401 UNAUTHORIZED, AI 0·시트 0', r.httpStatus === 401 && r.error === 'UNAUTHORIZED' && e.ai.length === 0 && e.sh.requests.length === 0, r);
  r = await e.call({ mode: 'sheet', rows: [ROW()] }, { 'x-suggest-proxy-token': TOKEN.slice(1) });
  check('R2 비밀값 틀림(길이 다름) → 401', r.httpStatus === 401 && e.ai.length === 0);
  e = makeEnv({ items: ITEMS3(), token: null });
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R3 Cloud Run에 Secret이 연결 안 됨 → 503 PROXY_NOT_CONFIGURED(Apps Script는 빠른 실패로 보고 동결본 처리)', r.httpStatus === 503 && r.error === 'PROXY_NOT_CONFIGURED');
  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sheet', rows: [] });
  check('R4 행 0개(연결 확인) → ok, results=[], AI 0·시트 0', r.ok === true && J(r.results) === '[]' && e.ai.length === 0 && e.sh.requests.length === 0, r);
  check('R5 로그에 비밀값·AI 키 없음', !e.logs.some(l => l.includes(TOKEN) || l.includes('sk-TESTKEY')));

  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sheet', rows: [ROW({ reason: 'single_edit' })] });
  const lg = e.rowLogs().find(x => x.itemId === 'TEST-003');
  check('R6 정상: written, F=면, AI 1회', r.ok && r.results[0].status === 'written' && e.sh.items[1][5] === '면' && e.ai.length === 1, r);
  check('R7 I 규칙 v2: 빈 F → 면(바뀜) → I = 시트 시리얼 숫자(앱 저장과 같은 방식) + I 칸 표시 형식 지정', typeof e.sh.items[1][8] === 'number' && e.sh.items[1][8] > 46000 && e.sh.requests.some(q => q.url.endsWith(':batchUpdate') && !q.url.includes('values') && J(q.data).includes('DATE_TIME') && J(q.data).includes('"startColumnIndex":8')), e.sh.items[1]);
  check('R8 F·I는 요청 1번(values:batchUpdate, RAW)으로 씀', e.sh.requests.filter(q => q.url.endsWith('/values:batchUpdate')).length === 1);
  check('R9 행 로그 1줄: mode=sheet·reason·claim·sheetWrite·sheetRow·iUpdated·attempts·lockMs·newRM·totalMs·reqId', lg && lg.mode === 'sheet' && lg.source === 'cloud-run' && lg.reason === 'single_edit' && lg.claim === 'acquired' && lg.sheetWrite === 'written' && lg.sheetRow === 3 && lg.iUpdated === true && lg.attempts.length === 1 && typeof lg.lockMs === 'number' && J(lg.newRM) === '[]' && typeof lg.totalMs === 'number' && typeof lg.reqId === 'string', lg);
  check('R10 끝나면 행 처리권·품목 쓰기 잠금·원자재마스터 잠금 모두 풀림', !Object.keys(e.fs.store).some(k => k.startsWith('materialRowClaims/') || k.startsWith('writeLocks/')), Object.keys(e.fs.store));

  e = makeEnv({ items: [['A1', '고객', '테스트용 PVC장갑', '박', '동부', 'PVC', '활성', 46000, 46100]], answers: { '테스트용 PVC장갑': { materials: [{ isNew: false, korean: 'PVC', keyword: 'PVC' }] } } });
  r = await e.call({ mode: 'sheet', rows: [{ itemId: 'A1', rowNumber: 2, itemName: '테스트용 PVC장갑', reason: 'single_edit' }] });
  check('R11 품목명 수정인데 결과가 같음(PVC→PVC) → F 다시 쓰되 I는 그대로(46100)', r.results[0].status === 'written' && e.sh.items[0][5] === 'PVC' && e.sh.items[0][8] === 46100 && e.rowLogs()[0].iUpdated === false, e.sh.items[0]);

  // 재확인(검증 포인트 1·3)
  e = makeEnv({ items: ITEMS3() });
  e.sh.hooks.beforeItemRead = st => { st.items[1][5] = '사람이 직접 넣음'; };
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R12 fill_empty인데 쓰기 직전 F가 이미 참 → stale(F_ALREADY_FILLED), 사람이 넣은 값 그대로', r.results[0].status === 'stale' && r.results[0].why === 'F_ALREADY_FILLED' && e.sh.items[1][5] === '사람이 직접 넣음' && !e.sh.requests.some(q => q.url.endsWith('/values:batchUpdate')), r.results);
  e = makeEnv({ items: ITEMS3() });
  e.sh.hooks.beforeItemRead = st => { st.items[1][2] = '테스트용 라텍스장갑'; };
  r = await e.call({ mode: 'sheet', rows: [ROW({ reason: 'single_edit' })] });
  check('R13 쓰기 직전 C가 바뀜 → stale(NAME_CHANGED), F 안 씀', r.results[0].status === 'stale' && r.results[0].why === 'NAME_CHANGED' && e.sh.items[1][5] === '', r.results);
  e = makeEnv({ items: ITEMS3().concat([['TEST-003', '다른고객', '테스트용 면장갑', '', '', '', '', '', '']]) });
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R14 [검증 3] A열(TEST-003)이 2행 이상 → stale(DUPLICATE_ID), 어느 행에도 안 씀, 로그에 겹친 행 번호', r.results[0].why === 'DUPLICATE_ID' && e.sh.items[1][5] === '' && e.sh.items[2][5] === '' && J(e.rowLogs()[0].duplicateRows) === '[3,4]', e.rowLogs()[0]);
  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sheet', rows: [ROW({ itemId: 'NOPE' })] });
  check('R15 A열로 행을 못 찾음(행 삭제 등) → stale(ROW_NOT_FOUND)', r.results[0].why === 'ROW_NOT_FOUND');
  e = makeEnv({ items: [['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, ''], ['', '', '테스트용 면장갑', '', '', '', '', '', '']] });
  r = await e.call({ mode: 'sheet', rows: [ROW({ itemId: '', reason: 'single_edit' })] });
  check('R16 A 없는 새 행 → 같은 행 번호(3)의 A가 여전히 빈칸이고 C가 같으면 씀', r.results[0].status === 'written' && e.sh.items[1][5] === '면', r.results);
  e = makeEnv({ items: [['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, ''], ['', '', '테스트용 면장갑', '', '', '', '', '', '']] });
  e.sh.hooks.beforeItemRead = st => { st.items[1][0] = 'TEST-003'; };
  r = await e.call({ mode: 'sheet', rows: [ROW({ itemId: '' })] });
  check('R17 A 없는 행인데 그 사이 A가 채워짐(행이 바뀌었을 수 있음) → stale(ROW_MOVED)', r.results[0].why === 'ROW_MOVED' && e.sh.items[1][5] === '');

  // 처리권(검증 포인트 1·2)
  e = makeEnv({ items: ITEMS3() });
  e.fs.store['materialRowClaims/id:TEST-003'] = { holder: 'sweep-other', mode: 'try', claimedAt: new Date().toISOString() };
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R18 fill_empty: 다른 처리가 같은 행을 잡고 있음 → busy, AI 0회', r.results[0].status === 'busy' && e.ai.length === 0 && e.fs.store['materialRowClaims/id:TEST-003'].holder === 'sweep-other', r.results);
  e = makeEnv({ items: ITEMS3() });
  e.fs.store['materialRowClaims/id:TEST-003'] = { holder: 'old', mode: 'try', claimedAt: new Date(Date.now() - 91000).toISOString() };
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R19 90초 지난(죽은) 처리권은 fill_empty도 가져감', r.results[0].status === 'written' && e.rowLogs()[0].claim === 'acquired');

  {
    // 시험 (d) 재현: 1번 요청(고무장갑, AI 느림) 처리 중에 사람이 C를 라텍스장갑으로 다시 고침 → 2번 요청(single_edit)
    e = makeEnv({ items: ITEMS3(), answers: {
      '테스트용 고무장갑': { delay: 300, materials: [{ isNew: false, korean: '고무', keyword: '고무' }] },
      '테스트용 라텍스장갑': { delay: 50, materials: [{ isNew: true, korean: '라텍스', keyword: '라텍스' }] } } });
    e.sh.items[1][2] = '테스트용 고무장갑';
    const p1 = e.call({ mode: 'sheet', rows: [ROW({ itemName: '테스트용 고무장갑', reason: 'single_edit' })] });
    await sleep(80);
    e.sh.items[1][2] = '테스트용 라텍스장갑';
    const p2 = e.call({ mode: 'sheet', rows: [ROW({ itemName: '테스트용 라텍스장갑', reason: 'single_edit' })] });
    const [r1, r2] = await Promise.all([p1, p2]);
    const logs = e.rowLogs();
    const l1 = logs.find(x => x.itemName === '테스트용 고무장갑'), l2 = logs.find(x => x.itemName === '테스트용 라텍스장갑');
    check('R20 [검증 1] 처리 중 다시 수정: 2번 요청이 처리권을 넘겨받음(took_over) → 2번 written(F=라텍스)', r2.results[0].status === 'written' && l2.claim === 'took_over' && e.sh.items[1][5] === '라텍스', { r2: r2.results, l2 });
    check('R21 [검증 1] 1번 요청은 쓰기 직전 "처리권이 넘어감"을 보고 안 씀(stale CLAIM_LOST) — 최종 F는 새 품목명 기준', r1.results[0].status === 'stale' && r1.results[0].why === 'CLAIM_LOST' && e.sh.items[1][5] === '라텍스', { r1: r1.results });
    check('R22 1번 요청이 끝나며 처리권을 지울 때 2번의 처리권은 건드리지 않음(내 것만 해제) → 끝나면 문서 없음', !Object.keys(e.fs.store).some(k => k.startsWith('materialRowClaims/')));
    check('R23 AI 호출 = 2회(사람이 2번 고쳤으므로 요청마다 1회), 새 원자재 라텍스 RM079 1행', e.ai.length === 2 && e.sh.raw.filter(x => x[1] === '라텍스').length === 1 && e.sh.raw.find(x => x[1] === '라텍스')[0] === 'RM079', { ai: e.ai });
  }
  {
    // 같은 상황에서 1번이 처리권 확인은 통과했지만 C 비교에서 걸리는 순서(넘겨받기 전에 사람이 이미 C를 바꿈)
    e = makeEnv({ items: ITEMS3() });
    e.sh.items[1][2] = '테스트용 고무장갑';
    e.sh.hooks.beforeItemRead = st => { st.items[1][2] = '테스트용 라텍스장갑'; };
    r = await e.call({ mode: 'sheet', rows: [ROW({ itemName: '테스트용 고무장갑', reason: 'single_edit' })] });
    check('R24 [검증 1] 처리권은 아직 내 것이어도 C가 바뀌었으면 안 씀(이중 확인: ① 처리권 → ④ C 비교)', r.results[0].why === 'NAME_CHANGED' && e.sh.items[1][5] === '');
  }

  // 동시 처리·한도(검증 포인트 2)
  {
    const items = [['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, '']];
    const rows = [];
    for (let i = 0; i < 12; i++) { items.push(['T' + i, '고객', '품목' + i, '', '', '', '', '', '']); rows.push({ itemId: 'T' + i, rowNumber: i + 3, itemName: '품목' + i, reason: 'fill_empty' }); }
    const answers = {};
    for (let i = 0; i < 12; i++) answers['품목' + i] = { delay: 150, materials: [{ isNew: true, korean: '새원자재', keyword: '새' }] };
    e = makeEnv({ items, answers });
    const t0 = Date.now();
    r = await e.call({ mode: 'sheet', rows });
    const el = Date.now() - t0;
    const st = r.results.map(x => x.status);
    check('R25 12행 → 앞 10행 처리, 뒤 2행 deferred(ROW_LIMIT, 15분 점검이 채움)', st.slice(0, 10).every(s => s === 'written') && J(st.slice(10)) === '["deferred","deferred"]' && r.results[11].why === 'ROW_LIMIT', st);
    check('R26 동시에 진행된 AI 호출은 최대 5개(SHEET_CONCURRENCY)', e.maxInFlight === 5, e.maxInFlight);
    check('R27 동시 처리라 10행이 순서대로(10×150ms)보다 훨씬 빨리 끝남', el < 900, el);
    check('R28 [검증 2] 10행이 모두 "새원자재"를 새로 제안해도 원자재마스터에는 1행만(RM079) — 공용 잠금(writeLocks/rawMaterialMaster) 안에서 다시 읽고 같은 이름이면 안 넣음',
      e.sh.raw.filter(x => x[1] === '새원자재').length === 1 && e.sh.raw.find(x => x[1] === '새원자재')[0] === 'RM079', e.sh.raw.slice(-3));
    const lockLogs = e.rowLogs().filter(x => x.sheetWrite === 'written');
    check('R29 [검증 2] 행마다 원자재마스터 잠금을 따로 잡음(로그 lockMs 10건), 행 처리권 문서도 행마다 따로(끝나면 모두 해제)', lockLogs.length === 10 && lockLogs.every(x => typeof x.lockMs === 'number') && !Object.keys(e.fs.store).some(k => k.startsWith('materialRowClaims/') || k.startsWith('writeLocks/')));
  }
  {
    const claimKeys = [];
    const rc = require(path.join(dir, 'lib', 'rowClaim.js'));
    const f2 = makeFakeFirestore();
    const a = await rc.claim(f2, rc.claimKey({ itemId: 'X1' }), 'h1', 'try');
    const b = await rc.claim(f2, rc.claimKey({ itemId: 'X2' }), 'h2', 'try');
    const c = await rc.claim(f2, rc.claimKey({ itemId: 'X1' }), 'h3', 'try');
    claimKeys.push(...Object.keys(f2.store));
    check('R30 [검증 2] 행 처리권은 행별 문서: X1을 잡아도 X2는 따로 잡힘, 같은 X1은 busy', a.ok && b.ok && !c.ok && c.holder === 'h1' && J(claimKeys) === '["materialRowClaims/id:X1","materialRowClaims/id:X2"]', claimKeys);
    check('R31 처리권 키: A열 있으면 id:코드(\'/\'도 안전하게), 없으면 row:행번호', rc.claimKey({ itemId: 'A/1' }) === 'id:A%2F1' && rc.claimKey({ itemId: '', rowNumber: 98 }) === 'row:98');
    const d = await rc.claim(f2, rc.claimKey({ itemId: 'X1' }), 'h4', 'take');
    check('R32 take(품목명 직접 수정)는 살아 있는 처리권도 넘겨받고 이전 holder를 기록, 이전 holder의 isMine은 false', d.ok && d.tookOver === 'h1' && !(await rc.isMine(f2, 'id:X1', 'h1')) && (await rc.isMine(f2, 'id:X1', 'h4')));
    await rc.release(f2, 'id:X1', 'h1');
    check('R33 넘겨받힌 쪽(h1)이 release해도 새 처리권(h4)은 남음', f2.store['materialRowClaims/id:X1'] && f2.store['materialRowClaims/id:X1'].holder === 'h4');
  }

  e = makeEnv({ items: ITEMS3(), answers: { '테스트용 면장갑': { fail: true } } });
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R34 AI 2회 실패 → ai_failed, 시트 쓰기 0, 처리권 해제', r.results[0].status === 'ai_failed' && !e.sh.requests.some(q => q.url.endsWith('/values:batchUpdate')) && !Object.keys(e.fs.store).some(k => k.startsWith('materialRowClaims/')), r.results);
  e = makeEnv({ items: ITEMS3() });
  e.fs.store['writeLocks/upsertItemAndCustomer'] = { lockedAt: new Date().toISOString(), holderId: 'app-save' };
  setTimeout(() => { delete e.fs.store['writeLocks/upsertItemAndCustomer']; }, 400);
  r = await e.call({ mode: 'sheet', rows: [ROW()] });
  check('R35 [검증 1] 앱이 품목을 저장하는 중(같은 쓰기 잠금) → 끝날 때까지 기다렸다가 씀(itemLockMs ≥ 300ms)', r.results[0].status === 'written' && e.rowLogs()[0].itemLockMs >= 300, e.rowLogs()[0]);
  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sheet', rows: [ROW(), ROW({ reason: 'single_edit', itemName: '테스트용 면장갑' }), { itemId: 'X', rowNumber: 1, itemName: 'x' }, { itemId: 'Y', rowNumber: 5, itemName: '' }] });
  check('R36 같은 행이 두 번 오면 1건으로(single_edit 우선), 행 번호 2 미만·품목명 빈 행은 버림 → AI 1회', r.results.length === 1 && e.rowLogs()[0].reason === 'single_edit' && e.ai.length === 1, r.results);
  e = makeEnv({ items: ITEMS3() });
  r = await e.call({ mode: 'sweep' }, {});
  check('R37 mode=sweep은 이 공개 함수에 없음(단계 4는 별도 비공개 함수 materialSweepTest, 결정 1-B) → 400 UNSUPPORTED_MODE', r.httpStatus === 400 && r.error === 'UNSUPPORTED_MODE');

  // ═════════════════════════ N그룹 ═════════════════════════
  console.log('── N그룹: 비교 규칙 세 벌 일치 ──');
  {
    const gas = vm.runInNewContext(extractFn('normalizeMaterialsForCompare_') + '; normalizeMaterialsForCompare_');
    const idx = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
    const s0 = idx.indexOf('function normalizeMaterialsForCompare_(s) {');
    const idxFn = vm.runInNewContext(idx.slice(s0, idx.indexOf('\n}\n', s0) + 2) + '; normalizeMaterialsForCompare_');
    const cases = ['', null, '고무', ' 고무 , PVC ', 'PVC,고무', '고무,,PVC,', '면, 면'];
    check('N1 Code.gs·index.js·lib의 원자재 비교(normalizeMaterialsForCompare) 결과가 모두 같음', cases.every(c => gas(c) === idxFn(c) && idxFn(c) === ms.normalizeMaterialsForCompare(c)), cases.map(c => [gas(c), idxFn(c), ms.normalizeMaterialsForCompare(c)]));
  }

  console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch(err => { console.error('시험 실행 오류:', err); process.exitCode = 1; });
