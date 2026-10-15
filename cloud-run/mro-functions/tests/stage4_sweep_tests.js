// cloud-run/mro-functions/tests/stage4_sweep_tests.js
// AI 원자재 추천 이전 단계 4(15분 점검 → Cloud Run materialSweepTest) 가짜 데이터 시험. 2026-10-15
// 실제 시트·Firestore·DeepSeek·Apps Script는 쓰지 않는다(네트워크 호출 0건).
//   L그룹: lib/materialSuggest.js 단계 4 순수 함수(설정 읽기·대상 고르기·한도·하루 실패 한도·서울 날짜·요약)
//   W그룹: index.js materialSweepTest를 그대로 실행(시험 모드, 정상 채우기, 할 일 없음, 회차 겹침 방지, 행 한도,
//          처리권 busy, 재확인 stale, 하루 실패 한도, 동시 3행, 로그, 시트 경로 회귀)
//   G그룹: apps-script/Code.gs — ensureAllItemRowsComplete가 F를 더는 안 건드리는지, stage4ClearTestF가 TEST- 행만 비우는지
// 실행: (cloud-run/mro-functions 폴더에서) node tests/stage4_sweep_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.resolve(__dirname, '..');
const repo = path.resolve(dir, '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
const ms = require(path.join(dir, 'lib', 'materialSuggest.js'));
const rc = require(path.join(dir, 'lib', 'rowClaim.js'));

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

(async () => {
  // ═════════════════════════ L그룹: lib 순수 함수 ═════════════════════════
  console.log('── L그룹: lib/materialSuggest.js 단계 4 함수 ──');
  check('L1 설정 없음 → 기본값(1회 10행, 하루 실패 3회)', J(ms.readSweepOptions({})) === J({ maxRows: 10, dailyFailLimit: 3 }));
  check('L2 설정값 범위 밖·글자 → 범위 안으로(0→1, 99→30, 글자→기본)', J(ms.readSweepOptions({ '원자재점검1회처리한도': '0', '원자재추천일일실패한도': 'abc' })) === J({ maxRows: 1, dailyFailLimit: 3 })
    && ms.readSweepOptions({ '원자재점검1회처리한도': 99 }).maxRows === 30 && ms.readSweepOptions({ '원자재추천일일실패한도': 99 }).dailyFailLimit === 10);
  const rowsL = [
    ['A1', '고객', '품목1', 'd', 'e', '', 'g', 'h', ''],   // 2행: 대상
    ['A2', '고객', '품목2', 'd', 'e', '고무', 'g', 'h', ''], // 3행: F 있음
    ['A3', '', '품목3', '', '', '', '', '', ''],           // 4행: B 없음
    ['', '고객', '품목4', '', '', '', '', '', ''],          // 5행: A 없음(Apps Script 점검과 같은 조건 — 시트 편집 경로가 처리)
    ['A5', '고객', '', '', '', '', '', '', ''],            // 6행: C 없음
    ['A6', '고객', '품목6'],                                // 7행: F 칸 자체가 없음(빈칸) → 대상
    ['A1', '고객', '품목1중복', '', '', '', '', '', '']     // 8행: A1 중복 → 첫 행만 대상
  ];
  const tg = ms.pickSweepTargets(rowsL);
  check('L3 대상 = A·B·C 있고 F 빈 행만(2행·7행), A 중복이면 첫 행만, reason=fill_empty', J(tg.map(r => r.rowNumber)) === '[2,7]' && tg.every(r => r.reason === 'fill_empty') && tg[0].itemName === '품목1' && tg[0].itemId === 'A1', tg);
  const many = []; for (let i = 0; i < 12; i++) many.push({ itemId: 'T' + i, rowNumber: i + 2, itemName: 'p' + i, reason: 'fill_empty' });
  let pl = ms.planSweepBatch(many, {}, { maxRows: 10, dailyFailLimit: 3 }, rc.claimKey);
  check('L4 12행 · 한도 10 → 이번 10행, 다음 회차 2행', pl.batch.length === 10 && pl.remaining === 2 && pl.skippedFailLimit.length === 0);
  pl = ms.planSweepBatch(many, { 'id:T0': 3, 'id:T1': 2 }, { maxRows: 10, dailyFailLimit: 3 }, rc.claimKey);
  check('L5 오늘 3번 실패한 T0은 건너뜀, 2번 실패한 T1은 포함 → 이번 10행(T1~T10), 다음 회차 1행', pl.skippedFailLimit.length === 1 && pl.skippedFailLimit[0].itemId === 'T0' && pl.batch[0].itemId === 'T1' && pl.batch.length === 10 && pl.remaining === 1, pl);
  check('L6 실패로 세는 결과 = ai_failed·lock_timeout·write_lock_timeout·error / busy·stale·deferred·written은 아님',
    ['ai_failed', 'lock_timeout', 'write_lock_timeout', 'error'].every(ms.isSweepFailure) && !['busy', 'stale', 'deferred', 'written'].some(ms.isSweepFailure));
  check('L7 하루 기준은 서울 날짜(UTC 14:59 = 서울 23:59 같은 날, UTC 15:00 = 서울 다음 날 0시)', ms.kstDateStr(Date.UTC(2026, 9, 15, 14, 59)) === '2026-10-15' && ms.kstDateStr(Date.UTC(2026, 9, 15, 15, 0)) === '2026-10-16');
  check('L8 결과 요약(상태별 개수)', J(ms.summarizeSweep([{ status: 'written' }, { status: 'written' }, { status: 'busy' }])) === J({ written: 2, busy: 1 }));
  check('L9 실패 기록 문서 ID = 날짜_행키', ms.sweepFailDocId('2026-10-15', 'id:TEST-003') === '2026-10-15_id:TEST-003');

  // ═════════════════════════ W그룹: index.js materialSweepTest ═════════════════════════
  console.log('── W그룹: index.js materialSweepTest 그대로 실행 ──');
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
  function rawRows() { const r = []; for (let i = 1; i <= 78; i++) r.push(['RM' + String(i).padStart(3, '0'), ({ 1: '고무', 2: 'PVC', 16: '면' })[i] || '원자재' + i, 'k', '활성', 46000 + i]); return r; }
  function makeSheets(items, settings) {
    const st = { raw: rawRows(), items: items.map(r => r.slice()), requests: [], hooks: {}, itemReads: 0, settings: settings || [] };
    const colIdx = c => c.charCodeAt(0) - 65;
    st.client = {
      request: async ({ url, method, data }) => {
        const u = decodeURIComponent(url);
        st.requests.push({ method: method || 'GET', url: u, data: data && JSON.parse(JSON.stringify(data)) });
        if (u.includes('values:batchGet')) return { data: { valueRanges: [{ values: st.settings }] } };
        if ((!method || method === 'GET') && u.includes('?fields=sheets.properties')) return { data: { sheets: [{ properties: { sheetId: 0, title: '품목마스터' } }] } };
        if ((!method || method === 'GET') && u.includes('/values/원자재마스터!A2:E')) return { data: { values: st.raw } };
        if ((!method || method === 'GET') && u.includes('/values/품목마스터!A2:I')) { st.itemReads++; if (st.hooks.beforeItemRead) st.hooks.beforeItemRead(st); return { data: { values: st.items } }; }
        if (method === 'POST' && u.includes('/values/원자재마스터!A:E:append')) {
          const start = st.raw.length; data.values.forEach(v => st.raw.push(v.slice()));
          return { data: { updates: { updatedRange: "'원자재마스터'!A" + (start + 2) + ':E' + (start + 1 + data.values.length) } } };
        }
        if (method === 'POST' && u.endsWith('/values:batchUpdate')) {
          data.data.forEach(d => {
            const m = d.range.match(/^품목마스터!([A-I])(\d+)$/); if (!m) throw new Error('범위 이상 ' + d.range);
            const r = +m[2] - 2; while (st.items.length <= r) st.items.push([]);
            st.items[r][colIdx(m[1])] = d.values[0][0];
          });
          return { data: {} };
        }
        if (method === 'POST' && u.endsWith(':batchUpdate')) return { data: {} };
        if (method === 'PUT' && u.includes('/values/원자재마스터!')) return { data: {} };
        throw new Error('unexpected request ' + method + ' ' + u);
      }
    };
    return st;
  }
  function makeEnv(o) {
    o = o || {};
    const fs_ = o.fs || makeFakeFirestore();
    const sh = makeSheets(o.items, o.settings);
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
    const penv = { AI_PROVIDER: 'DEEPSEEK', DEEPSEEK_API_KEY: 'sk-TESTKEY-x', SUGGEST_PROXY_TOKEN: 'T'.repeat(64) };
    const ctx = { require: req, module: mod, exports: mod.exports, console: { log: s => env.logs.push(String(s)), error: s => env.logs.push(String(s)) },
      process: { env: penv }, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder, fetch: fakeFetch, AbortController };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
    const res = out => ({ set() {}, status: c => ({ json: x => { out.httpStatus = c; Object.assign(out, x); }, send() { out.httpStatus = c; } }) });
    env.sweep = async body => { const out = {}; await mod.exports.materialSweepTest({ method: 'POST', headers: {}, body: body || {} }, res(out)); return out; };
    env.sheet = async body => { const out = {}; await mod.exports.suggestMaterialsTest({ method: 'POST', headers: { 'x-suggest-proxy-token': 'T'.repeat(64) }, body }, res(out)); return out; };
    env.rowLogs = () => env.logs.filter(l => l.startsWith('[suggest] ')).map(l => JSON.parse(l.slice(10)));
    env.sweepLogs = () => env.logs.filter(l => l.startsWith('[sweep] {')).map(l => JSON.parse(l.slice(8)));
    env.writes = () => sh.requests.filter(q => q.url.endsWith('/values:batchUpdate'));
    return env;
  }
  const BASE = ['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 46000, ''];
  const ITEMS = () => [BASE.slice(),
    ['TEST-003', '반도코리아(주)', '테스트용 면장갑', '박태영', '동부', '', '비활성', 46309, ''],
    ['TEST-004', '반도코리아(주)', '테스트용 PVC장갑', '박태영', '동부', '', '비활성', 46309, '']];
  const ANS = { '테스트용 PVC장갑': { materials: [{ isNew: false, korean: 'PVC', keyword: 'PVC' }] } };
  let e, r;

  // 시험 모드
  e = makeEnv({ items: ITEMS(), answers: ANS });
  r = await e.sweep({ dryRun: true });
  check('W1 시험 모드(dryRun): 대상 2행 목록만 돌려줌 — AI 0회, 시트 쓰기 0, Firestore 기록 0', r.ok && r.dryRun === true && J(r.rows.map(x => x.rowNumber)) === '[3,4]' && r.targets === 2 && e.ai.length === 0 && e.writes().length === 0 && Object.keys(e.fs.store).length === 0, r);

  // 정상
  e = makeEnv({ items: ITEMS(), answers: ANS });
  r = await e.sweep();
  const lgs = e.rowLogs();
  check('W2 정상: 빈 F 2행 모두 written, F=면·PVC, AI 2회', r.ok && J(r.results.map(x => x.status)) === '["written","written"]' && e.sh.items[1][5] === '면' && e.sh.items[2][5] === 'PVC' && e.ai.length === 2, r);
  check('W3 I 규칙 v2: 빈 F가 채워졌으므로 I도 찍음(시트 시리얼 숫자) — 단계 3 쓰기 함수 그대로', typeof e.sh.items[1][8] === 'number' && typeof e.sh.items[2][8] === 'number' && e.sh.items[1][8] > 46000);
  check('W4 이미 F가 있는 행(A1 기존품목)은 건드리지 않음', e.sh.items[0][5] === '고무' && e.sh.items[0][8] === '' && !e.ai.includes('기존품목'));
  check('W5 행 로그 mode=sweep · reason=fill_empty · claim=acquired · sheetWrite=written · 같은 회차 번호(reqId=runId)', lgs.length === 2 && lgs.every(l => l.mode === 'sweep' && l.reason === 'fill_empty' && l.claim === 'acquired' && l.sheetWrite === 'written' && l.reqId === r.runId), lgs);
  const sl = e.sweepLogs()[0];
  check('W6 회차 로그 [sweep] 1줄: 대상·처리·남은 행·결과 개수·설정값', e.sweepLogs().length === 1 && sl.targets === 2 && sl.batch === 2 && sl.remaining === 0 && J(sl.counts) === J({ written: 2 }) && sl.maxRows === 10 && sl.dailyFailLimit === 3, sl);
  const run = e.fs.store['sweepRuns/material'];
  const hist = Object.keys(e.fs.store).filter(k => k.startsWith('sweepRuns/material_'));
  check('W7 기록: sweepRuns/material은 끝 표시(running=false) + 마지막 회차 요약, 회차 기록 1건(행별 결과 포함)', run && run.running === false && run.runId === r.runId && run.lastRun.counts.written === 2 && hist.length === 1 && e.fs.store[hist[0]].rows.length === 2, { run, hist });
  check('W8 끝나면 행 처리권·품목 쓰기 잠금·원자재마스터 잠금 모두 풀림, 실패 기록 없음', !Object.keys(e.fs.store).some(k => k.startsWith('materialRowClaims/') || k.startsWith('writeLocks/') || k.startsWith('materialSweepFails/')), Object.keys(e.fs.store));
  check('W9 로그에 AI 키 없음', !e.logs.some(l => l.includes('sk-TESTKEY')));

  // 할 일 없음(같은 시트로 한 번 더)
  const fsKeep = e.fs;
  const e2 = makeEnv({ fs: fsKeep, items: e.sh.items });
  r = await e2.sweep();
  check('W10 다시 돌리면 "할 일 없음": 대상 0, AI 0, 시트 쓰기 0, 회차 기록 추가 안 함(빈 회차는 lastRun만 갱신)', r.ok && r.targets === 0 && r.batch === 0 && e2.ai.length === 0 && e2.writes().length === 0 && Object.keys(fsKeep.store).filter(k => k.startsWith('sweepRuns/material_')).length === 1 && fsKeep.store['sweepRuns/material'].lastRun.targets === 0, r);

  // 회차 겹침 방지
  e = makeEnv({ items: ITEMS() });
  e.fs.store['sweepRuns/material'] = { running: true, runId: 'prev', startedAtMs: Date.now() - 60000 };
  r = await e.sweep();
  check('W11 이전 회차가 1분 전에 시작해 아직 도는 중 → 이번 회차 건너뜀(ALREADY_RUNNING), AI 0·시트 0, 이전 표시 그대로', r.ok && r.skipped && r.reason === 'ALREADY_RUNNING' && e.ai.length === 0 && e.sh.requests.length === 0 && e.fs.store['sweepRuns/material'].runId === 'prev', r);
  e = makeEnv({ items: ITEMS() });
  e.fs.store['sweepRuns/material'] = { running: true, runId: 'dead', startedAtMs: Date.now() - 7 * 60000 };
  r = await e.sweep();
  check('W12 표시가 7분 전 것(비정상 종료) → 무시하고 진행, 끝나면 내 회차로 끝 표시', r.ok && !r.skipped && r.counts.written === 2 && e.fs.store['sweepRuns/material'].runId === r.runId && e.fs.store['sweepRuns/material'].running === false, r);

  // 행 한도
  {
    const items = [BASE.slice()];
    for (let i = 0; i < 12; i++) items.push(['T' + i, '고객', '품목' + i, '', '', '', '', '', '']);
    const answers = {}; for (let i = 0; i < 12; i++) answers['품목' + i] = { delay: 120, materials: [{ isNew: false, korean: '면', keyword: '면' }] };
    e = makeEnv({ items, answers });
    r = await e.sweep();
    check('W13 빈 F 12행 · 기본 한도 10 → 10행 처리, 2행은 다음 회차(remaining=2), 앞에서부터', r.batch === 10 && r.remaining === 2 && r.counts.written === 10 && e.sh.items[10][5] === '면' && !e.sh.items[11][5] && !e.sh.items[12][5], { batch: r.batch, remaining: r.remaining, counts: r.counts });
    check('W14 동시에 진행된 AI 호출은 최대 3개(SWEEP_CONCURRENCY)', e.maxInFlight === 3, e.maxInFlight);
    e = makeEnv({ items, answers, settings: [['원자재점검1회처리한도', 3, '']] });
    r = await e.sweep();
    check('W15 설정 탭에 원자재점검1회처리한도=3 → 3행만, 9행은 다음 회차', r.batch === 3 && r.remaining === 9 && r.maxRows === 3 && e.ai.length === 3, r);
  }

  // 처리권 busy(시트 편집 경로가 같은 행을 처리 중) — 부록 E-4 겹침 해소
  e = makeEnv({ items: ITEMS(), answers: ANS });
  e.fs.store['materialRowClaims/id:TEST-003'] = { holder: 'sheet-path', mode: 'take', claimedAt: new Date().toISOString() };
  r = await e.sweep();
  check('W16 [E-4] 시트 편집 경로가 TEST-003을 처리 중 → 점검은 그 행 busy로 건너뜀(AI 0회), TEST-004만 처리', r.results.find(x => x.itemId === 'TEST-003').status === 'busy' && r.results.find(x => x.itemId === 'TEST-004').status === 'written' && J(e.ai) === '["테스트용 PVC장갑"]' && e.fs.store['materialRowClaims/id:TEST-003'].holder === 'sheet-path', { results: r.results, ai: e.ai });
  check('W17 busy는 실패로 안 셈(materialSweepFails 없음)', !Object.keys(e.fs.store).some(k => k.startsWith('materialSweepFails/')));

  // 재확인: 고른 뒤 쓰기 전에 F가 채워짐
  e = makeEnv({ items: ITEMS(), answers: ANS });
  e.sh.hooks.beforeItemRead = st => { if (st.itemReads >= 2) { st.items[1][5] = '사람이 직접 넣음'; } };
  r = await e.sweep();
  const s3 = r.results.find(x => x.itemId === 'TEST-003');
  check('W18 점검이 고른 뒤 쓰기 직전에 F가 채워짐(사람·시트 경로) → stale(F_ALREADY_FILLED), 그 값 그대로', s3.status === 'stale' && s3.why === 'F_ALREADY_FILLED' && e.sh.items[1][5] === '사람이 직접 넣음', r.results);

  // 하루 실패 한도
  {
    const fsF = makeFakeFirestore();
    const failAns = { '테스트용 면장갑': { fail: true }, '테스트용 PVC장갑': { fail: true } };
    let items = [BASE.slice(), ['TEST-003', '반도코리아(주)', '테스트용 면장갑', '박태영', '동부', '', '비활성', 46309, '']];
    const counts = [];
    for (let k = 0; k < 3; k++) { const ek = makeEnv({ fs: fsF, items, answers: failAns }); const rk = await ek.sweep(); counts.push(rk.results[0].status); }
    const failDoc = Object.keys(fsF.store).find(k => k.startsWith('materialSweepFails/'));
    check('W19 AI 실패 3회 → 매번 ai_failed, 오늘 실패 횟수 문서 count=3(서울 날짜_행키)', J(counts) === '["ai_failed","ai_failed","ai_failed"]' && failDoc === 'materialSweepFails/' + ms.kstDateStr(Date.now()) + '_id:TEST-003' && fsF.store[failDoc].count === 3 && fsF.store[failDoc].lastStatus === 'ai_failed', { counts, failDoc, d: failDoc && fsF.store[failDoc] });
    const e4 = makeEnv({ fs: fsF, items, answers: failAns });
    r = await e4.sweep();
    check('W20 4번째 회차: 그 행은 하루 한도(3)에 걸려 건너뜀 — AI 0회, skippedFailLimit=1', r.batch === 0 && r.skippedFailLimit === 1 && e4.ai.length === 0, r);
    const fsY = makeFakeFirestore();
    fsY.store['materialSweepFails/2000-01-01_id:TEST-003'] = { count: 9 };
    const e5 = makeEnv({ fs: fsY, items, answers: {} });
    r = await e5.sweep();
    check('W21 다른 날짜의 실패 기록은 세지 않음(날이 바뀌면 다시 시도)', r.batch === 1 && r.counts.written === 1, r);
  }

  // 오류 처리
  e = makeEnv({ items: ITEMS() });
  CURRENT.client = null; // 시트 접속 실패 흉내
  r = await e.sweep();
  check('W22 시트 접속 오류 → 500 SERVER_ERROR, 회차 표시는 끝(running=false)으로 정리됨', r.httpStatus === 500 && r.error === 'SERVER_ERROR' && e.fs.store['sweepRuns/material'].running === false, { r, run: e.fs.store['sweepRuns/material'] });

  // 시트 경로 회귀: 같은 행 처리 함수를 쓰지만 시트 경로 로그는 여전히 mode=sheet
  e = makeEnv({ items: ITEMS() });
  r = await e.sheet({ mode: 'sheet', rows: [{ itemId: 'TEST-003', rowNumber: 3, itemName: '테스트용 면장갑', reason: 'fill_empty' }] });
  check('W23 [회귀] 시트 편집 경로(suggestMaterialsTest mode=sheet) 결과·로그 mode=sheet 그대로', r.ok && r.results[0].status === 'written' && e.rowLogs()[0].mode === 'sheet', { r, l: e.rowLogs()[0] });
  r = await e.sheet({ mode: 'sweep' });
  check('W24 [회귀] 공개 함수에 mode=sweep은 여전히 400 UNSUPPORTED_MODE(점검은 비공개 함수에만)', r.httpStatus === 400 && r.error === 'UNSUPPORTED_MODE');

  // ═════════════════════════ G그룹: Apps Script ═════════════════════════
  console.log('── G그룹: apps-script/Code.gs ──');
  function makeGas(items) {
    const env = { items, writes: [], suggests: [], autofill: [], logs: [] };
    const sheet = {
      getDataRange: () => ({ getValues: () => env.items.map(r => r.slice()) }),
      getRange: (r, c) => ({
        getValue: () => (env.items[r - 1] || [])[c - 1] === undefined ? '' : env.items[r - 1][c - 1],
        setValue: v => { env.items[r - 1][c - 1] = v; env.writes.push({ r, c, v: v instanceof Date ? 'DATE' : v }); },
        setNumberFormat: () => {}
      })
    };
    const props = { SHEET_ID: 'S' };
    const ctx = {
      Date, JSON, Math, String, Number, Object, Array, parseInt,
      console: { log: s => env.logs.push(String(s)), error: s => env.logs.push(String(s)) },
      Logger: { log: s => env.logs.push(String(s)) },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] === undefined ? null : props[k], setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
      SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === '품목마스터' ? sheet : null }) },
      suggestRawMaterials: (name, mode) => { env.suggests.push({ name, mode }); return { korean: ['면'] }; },
      autofillManagerFromCustomer_: (sh, row) => { env.autofill.push(row); }
    };
    vm.runInNewContext(['ensureAllItemRowsComplete', 'stage4ClearTestF'].map(extractFn).join('\n'), ctx);
    env.ctx = ctx;
    return env;
  }
  const H = ['MP자재코드', '고객사', '품목명', '담당', '팀', '주요원자재', '상태', '등록일', '원자재수정일'];
  let g = makeGas([H, ['A1', '고객', '품목1', '박', '동부', '', '활성', 'd', ''], ['A2', '고객', '품목2', '', '', '', '', '', '']]);
  g.ctx.ensureAllItemRowsComplete();
  check('G1 Apps Script 15분 점검: F만 빈 행(2행)은 건너뜀 — AI 0회, F 안 씀', g.suggests.length === 0 && !g.writes.some(w => w.c === 6 || w.c === 9), g.writes);
  check('G2 D·G·H가 빈 행(3행)은 지금처럼 담당 자동입력·상태(활성)·등록일을 채움, F는 그대로 빈칸', J(g.autofill) === '[3]' && g.items[2][6] === '활성' && g.writes.some(w => w.r === 3 && w.c === 8 && w.v === 'DATE') && g.items[2][5] === '', g.writes);
  check('G3 Code.gs에 15분 점검의 동결본 AI 호출(suggestRawMaterials(c, \'sweep\'))이 더는 없음', !code.includes("suggestRawMaterials(c, 'sweep')") && !extractFn('ensureAllItemRowsComplete').includes('suggestRawMaterials('));
  g = makeGas([H, ['A1', '고객', '진짜품목', '박', '동부', '고무', '활성', 'd', 46000],
    ['TEST-001', '고객', '테스트품목1', '박', '동부', '면', '비활성', 'd', 46300], ['XTEST-002', '고객', '이름에TEST', '', '', 'PVC', '', '', 46301],
    ['TEST-006', '고객', '테스트품목6', '박', '동부', '라텍스', '비활성', 'd', 46302]]);
  const n = g.ctx.stage4ClearTestF();
  check('G4 stage4ClearTestF: A열이 TEST-로 시작하는 행(3·5행)만 F·I를 비움, 다른 행(진짜 품목·XTEST-)·다른 칸은 그대로', n === 2 && g.items[2][5] === '' && g.items[2][8] === '' && g.items[4][5] === '' && g.items[4][8] === '' && g.items[2][2] === '테스트품목1' && g.items[1][5] === '고무' && g.items[1][8] === 46000 && g.items[3][5] === 'PVC' && g.items[3][8] === 46301 && g.writes.every(w => (w.r === 3 || w.r === 5) && (w.c === 6 || w.c === 9)), g.writes);
  check('G5 stage4ClearTestF 기록: 비운 행 번호·코드·품목명만(2행)', g.logs.some(l => l.includes('2행 F·I 비움') && l.includes('3행 TEST-001') && l.includes('5행 TEST-006')), g.logs);

  console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch(err => { console.error('시험 실행 오류:', err); process.exitCode = 1; });
