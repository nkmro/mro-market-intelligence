// cloud-run/mro-functions/tests/stage2_appsscript_tests.js
// AI 원자재 추천 이전 단계 2(Apps Script 동결·잠금 통일·로그·I열 규칙 v2) 가짜 데이터 시험.
// 실제 시트·Firestore·AI는 쓰지 않는다. apps-script/Code.gs에서 해당 함수들을 그대로 잘라내 가짜 환경에서 실행한다.
//   L그룹: 원자재마스터 공용 잠금(Firestore REST) — 잡기·대기 초과·죽은 잠금 빼앗기·동시 빼앗기·접속 오류·내 것만 풀기
//   X그룹: Cloud Run lib/writeLock.js와 같은 잠금 문서를 정말 같이 쓰는지(교차 시험)
//   S그룹: suggestRawMaterials — 프롬프트 불변, 번호 규칙, 잠금 순서, [suggest] 로그
//   I그룹: I열 규칙 v2 — ②-a(빈 F 자동 채우기)·15분 점검이 I를 찍는지, ②-b는 기존대로인지
// 실행: (cloud-run/mro-functions 폴더에서) node tests/stage2_appsscript_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const dir = path.resolve(__dirname, '..');
const repo = path.resolve(dir, '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');

let failures = 0, passes = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
  if (cond) passes++; else failures++;
}
function extractFn(name) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(/\nfunction [\w$]+\s*\(/);
  return rest.slice(0, m + 1);
}
const SRC = ['rawMaterialFsLockUrl_', 'acquireRawMaterialFsLock_', 'releaseRawMaterialFsLock_', 'suggestRawMaterials',
  'onEditInstallable', 'ensureAllItemRowsComplete', 'normalizeMaterialsForCompare_'].map(extractFn).join('\n');

// ───────── 가짜 Firestore(REST + Cloud Run SDK 흉내가 같은 저장소를 씀) ─────────
function makeFsStore() {
  const st = { doc: null, seq: 0, calls: [], mode: 'ok' };
  st.newUpdateTime = () => '2026-10-14T00:00:00.' + String(++st.seq).padStart(6, '0') + 'Z';
  return st;
}
function makeFetch(st, clock) {
  const DOC = 'https://firestore.googleapis.com/v1/projects/mro-market-intelligence/databases/(default)/documents/writeLocks/rawMaterialMaster';
  const COLL = DOC.replace(/\/rawMaterialMaster$/, '');
  const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj || {}) });
  return {
    fetch: (url, opt) => {
      opt = opt || {};
      const method = (opt.method || 'get').toLowerCase();
      st.calls.push(method + ' ' + url.replace(/^https:\/\/firestore[^?]*documents/, ''));
      if (st.mode === 'http500') return resp(500, { error: 'boom' });
      if (st.mode === 'http403') return resp(403, { error: 'PERMISSION_DENIED' });
      if (st.hook) st.hook(method, url);
      const pre = (/currentDocument\.updateTime=([^&]+)/.exec(url) || [])[1];
      if (method === 'post' && url.startsWith(COLL + '?documentId=rawMaterialMaster')) {
        if (st.doc) return resp(409, { error: { status: 'ALREADY_EXISTS' } });
        st.doc = { fields: JSON.parse(opt.payload).fields, updateTime: st.newUpdateTime() };
        return resp(200, st.doc);
      }
      if (url.split('?')[0] !== DOC) throw new Error('예상 못한 URL ' + url);
      if (method === 'get') return st.doc ? resp(200, Object.assign({ name: 'x' }, st.doc)) : resp(404, {});
      if (!st.doc) return resp(404, {});
      if (pre && decodeURIComponent(pre) !== st.doc.updateTime) return resp(400, { error: { status: 'FAILED_PRECONDITION' } });
      if (method === 'patch') { st.doc = { fields: JSON.parse(opt.payload).fields, updateTime: st.newUpdateTime() }; return resp(200, st.doc); }
      if (method === 'delete') { st.doc = null; return resp(200, {}); }
      throw new Error('예상 못한 요청 ' + method);
    }
  };
}
// Cloud Run lib/writeLock.js가 쓰는 Firestore SDK 모양(같은 저장소)
function sdkOver(st) {
  const ref = {
    get: async () => ({ exists: !!st.doc, data: () => st.doc && { lockedAt: new Date(st.doc.fields.lockedAt.timestampValue), holderId: st.doc.fields.holderId.stringValue } }),
    set: async d => { st.doc = { fields: { lockedAt: { timestampValue: new Date(d.lockedAt).toISOString() }, holderId: { stringValue: d.holderId } }, updateTime: st.newUpdateTime() }; },
    delete: async () => { st.doc = null; }
  };
  return {
    collection: () => ({ doc: () => ref }),
    runTransaction: async fn => { const ops = []; const out = await fn({ get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)) }); for (const o of ops) await o(); return out; }
  };
}

// ───────── Apps Script 환경 ─────────
function makeGas(opts) {
  opts = opts || {};
  const clock = { now: Date.UTC(2026, 9, 14, 1, 0, 0), real: !!opts.realClock };
  const RealDate = Date;
  function FakeDate(...a) { if (!(this instanceof FakeDate)) return new RealDate(clock.real ? RealDate.now() : clock.now).toString(); return a.length ? new RealDate(...a) : new RealDate(clock.real ? RealDate.now() : clock.now); }
  FakeDate.now = () => clock.real ? RealDate.now() : clock.now;
  FakeDate.prototype = RealDate.prototype;
  const fsSt = opts.fsStore || makeFsStore();
  const env = { clock, fs: fsSt, logs: [], errors: [], prompts: [], aiQueue: (opts.ai || []).slice(), sleeps: 0, order: [] };
  // 원자재마스터
  const raw = [['원자재코드', '원자재명(한글)', '수집키워드', '상태', '등록일']];
  for (let i = 1; i <= 78; i++) raw.push(['RM' + String(i).padStart(3, '0'), i === 1 ? '고무' : i === 29 ? '니트릴고무' : '원자재' + i, 'k', '활성', 'd']);
  (opts.extraRaw || []).forEach(r => raw.push(r));
  env.raw = raw;
  // 품목마스터(1행 헤더, 2행 기존, 3행 시험 대상)
  const items = opts.items || [
    ['MP자재코드', '고객사', '품목명', '담당', '팀', '주요원자재', '상태', '등록일', '원자재수정일'],
    ['A1', '고객', '기존품목', '박', '동부', '고무', '활성', 'd', ''],
    ['TEST-002', '반도코리아(주)', '테스트용 니트릴장갑', '박태영', '동부', '', '', '', '']
  ];
  env.items = items;
  const cellWrites = [];
  env.cellWrites = cellWrites;
  function sheetOf(rows, name) {
    return {
      getName: () => name,
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      appendRow: r => { env.order.push('appendRow'); rows.push(r.slice()); },
      getLastRow: () => rows.length,
      deleteRow: n => rows.splice(n - 1, 1),
      getRange: (r, c) => {
        if (typeof r === 'string') return { getDataValidation: () => 'RULE' };
        return {
          getValue: () => (rows[r - 1] || [])[c - 1] === undefined ? '' : rows[r - 1][c - 1],
          setValue: v => { while (rows.length < r) rows.push([]); rows[r - 1][c - 1] = v; cellWrites.push({ sheet: name, r, c, v: v instanceof RealDate ? 'DATE' : v }); },
          setNumberFormat: () => {}, setDataValidation: () => {}
        };
      }
    };
  }
  const rawSheet = sheetOf(raw, '원자재마스터'), itemSheet = sheetOf(items, '품목마스터');
  const ctx = {
    Date: FakeDate, JSON, Math, String, Number, Object, Array, Set, RegExp, parseInt, encodeURIComponent, decodeURIComponent,
    GCP_PROJECT_ID: 'mro-market-intelligence',
    console: { log: s => env.logs.push(String(s)), error: s => env.errors.push(String(s)) },
    Logger: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => k === 'AI_PROVIDER' ? 'DEEPSEEK' : k === 'SHEET_ID' ? 'SHEET' : null, setProperty() {}, deleteProperty() {} }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: n => n === '원자재마스터' ? rawSheet : itemSheet }), flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => { env.order.push('scriptLock'); return opts.scriptLockFails ? false : true; }, releaseLock: () => env.order.push('scriptUnlock') }) },
    Utilities: { getUuid: () => 'holder-' + crypto.randomUUID().slice(0, 8), sleep: ms => { env.sleeps++; if (!clock.real) clock.now += ms; } },
    ScriptApp: { getOAuthToken: () => 'TOKEN' },
    UrlFetchApp: makeFetch(fsSt, clock),
    callAI_: p => { env.prompts.push(p); if (opts.aiMs) clock.now += opts.aiMs; return env.aiQueue.length ? env.aiQueue.shift() : null; },
    autofillManagerFromCustomer_: () => {},
    syncManagersForCustomer_: () => {}, syncTeamsForManager_: () => {}, runWithSyncLock_: f => f(), SHEET_USER: '사용자팀마스터'
  };
  vm.runInNewContext(SRC, ctx);
  env.ctx = ctx; env.rawSheet = rawSheet; env.itemSheet = itemSheet;
  env.suggestLog = () => { const l = env.logs.filter(x => x.startsWith('[suggest] ')); return l.length ? JSON.parse(l[l.length - 1].slice(10)) : null; };
  return env;
}
const J = s => JSON.stringify(s);
const OKAI = J({ materials: [{ isNew: true, korean: '리튬망간', keyword: '리튬' }] });

(async () => {
  console.log('── L그룹: 원자재마스터 공용 잠금(Firestore REST) ──');
  let e = makeGas();
  let r = e.ctx.acquireRawMaterialFsLock_('H1', 10000);
  check('L1 잠금 문서가 없으면 만들어서 잡음(필드 lockedAt·holderId = Cloud Run과 같은 모양)', r === 'acquired' && e.fs.doc.fields.holderId.stringValue === 'H1' && /Z$/.test(e.fs.doc.fields.lockedAt.timestampValue), e.fs.doc);
  e.ctx.releaseRawMaterialFsLock_('H1');
  check('L2 내가 잡은 잠금은 놓으면 문서가 지워짐', e.fs.doc === null);
  e = makeGas();
  e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now - 5000).toISOString() }, holderId: { stringValue: 'cloud-run' } }, updateTime: e.fs.newUpdateTime() };
  const t0 = e.clock.now;
  r = e.ctx.acquireRawMaterialFsLock_('H2', 10000);
  check('L3 다른 쪽(Cloud Run)이 5초 전에 잡은 잠금 → 10초 기다리다 timeout, 남의 잠금은 그대로', r === 'timeout' && e.clock.now - t0 >= 10000 && e.clock.now - t0 < 10500 && e.fs.doc.fields.holderId.stringValue === 'cloud-run', { r, waited: e.clock.now - t0 });
  e = makeGas();
  e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now - 40000).toISOString() }, holderId: { stringValue: 'dead' } }, updateTime: e.fs.newUpdateTime() };
  r = e.ctx.acquireRawMaterialFsLock_('H3', 10000);
  check('L4 40초 전에 잡고 안 놓은 죽은 잠금 → 바로 빼앗음(조건부 수정)', r === 'acquired' && e.fs.doc.fields.holderId.stringValue === 'H3' && e.fs.calls.some(c => c.startsWith('patch')), e.fs.calls);
  e = makeGas();
  e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now - 40000).toISOString() }, holderId: { stringValue: 'dead' } }, updateTime: e.fs.newUpdateTime() };
  let stolen = false;
  e.fs.hook = (m) => { if (m === 'patch' && !stolen) { stolen = true; e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now).toISOString() }, holderId: { stringValue: 'cloud-run' } }, updateTime: e.fs.newUpdateTime() }; } };
  r = e.ctx.acquireRawMaterialFsLock_('H4', 3000);
  check('L5 죽은 잠금을 Cloud Run이 한발 먼저 빼앗으면 → 내 수정은 조건 불일치로 실패, 덮어쓰지 않고 기다리다 timeout', r === 'timeout' && e.fs.doc.fields.holderId.stringValue === 'cloud-run', { r, holder: e.fs.doc.fields.holderId });
  e = makeGas(); e.fs.mode = 'http403';
  r = e.ctx.acquireRawMaterialFsLock_('H5', 10000);
  check('L6 Firestore 권한 오류(403) → error(호출부는 기존 스크립트 잠금만으로 진행), 오류 로그 남김', r === 'error' && e.errors.some(x => x.includes('403')), e.errors);
  e = makeGas();
  e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now).toISOString() }, holderId: { stringValue: 'cloud-run' } }, updateTime: e.fs.newUpdateTime() };
  e.ctx.releaseRawMaterialFsLock_('H6');
  check('L7 남이 잡은 잠금은 놓기를 불러도 지우지 않음', e.fs.doc && e.fs.doc.fields.holderId.stringValue === 'cloud-run');

  console.log('── X그룹: Cloud Run lib/writeLock.js와 같은 잠금을 같이 쓰는지 ──');
  const { acquireLock, releaseLock } = require(path.join(dir, 'lib', 'writeLock.js'));
  const shared = makeFsStore();
  e = makeGas({ fsStore: shared, realClock: true });
  r = e.ctx.acquireRawMaterialFsLock_('GAS', 10000);
  let cr = await acquireLock(sdkOver(shared), 'rawMaterialMaster', 'CR', { waitMs: 400, staleMs: 30000, pollMs: 100 });
  check('X1 Apps Script가 잡고 있으면 Cloud Run(실제 writeLock.js)은 못 잡음', r === 'acquired' && cr === false);
  e.ctx.releaseRawMaterialFsLock_('GAS');
  cr = await acquireLock(sdkOver(shared), 'rawMaterialMaster', 'CR', { waitMs: 400, staleMs: 30000, pollMs: 100 });
  check('X2 Apps Script가 놓으면 Cloud Run이 바로 잡음', cr === true && shared.doc.fields.holderId.stringValue === 'CR');
  r = e.ctx.acquireRawMaterialFsLock_('GAS2', 300);
  check('X3 Cloud Run이 잡고 있으면 Apps Script는 대기 후 timeout', r === 'timeout');
  await releaseLock(sdkOver(shared), 'rawMaterialMaster', 'CR');
  r = e.ctx.acquireRawMaterialFsLock_('GAS3', 1000);
  check('X4 Cloud Run이 놓으면 Apps Script가 잡음', r === 'acquired');

  console.log('── S그룹: suggestRawMaterials ──');
  const tplStart = code.indexOf('const prompt = `', code.indexOf('function suggestRawMaterials('));
  const tpl = code.slice(tplStart + 16, code.indexOf('`;', tplStart));
  check('S1 프롬프트(규칙)는 한 글자도 안 바뀜(SHA-256 d6ce4d85… = Cloud Run 유일본과 동일)', crypto.createHash('sha256').update(tpl).digest('hex').startsWith('d6ce4d85ba18'));
  e = makeGas({ ai: [OKAI], aiMs: 9000 });
  r = e.ctx.suggestRawMaterials('테스트용 리튬망간 전지', 'app');
  const lg = e.suggestLog();
  check('S2 정상: RM079 추가, 반환값은 예전과 같은 모양 { korean:[...] }', r && J(r.korean) === '["리튬망간"]' && e.raw[e.raw.length - 1][0] === 'RM079', r);
  check('S3 잠금 순서: Firestore 잠금 → 스크립트 잠금 → 시트 추가 → 스크립트 잠금 해제 → Firestore 잠금 해제', J(e.order) === '["scriptLock","appendRow","scriptUnlock"]' && e.fs.calls[0].startsWith('post') && e.fs.calls[e.fs.calls.length - 1].startsWith('delete') && e.fs.doc === null, { order: e.order, calls: e.fs.calls });
  check('S4 [suggest] 로그 1줄 = Cloud Run과 같은 형식(mode=app, source=apps-script, attempts, lockMs, newRM, totalMs, fsLock)', lg && lg.mode === 'app' && lg.source === 'apps-script' && lg.provider === 'DEEPSEEK' && lg.attempts.length === 1 && lg.attempts[0].aiMs === 9000 && lg.attempts[0].parseOk === true && typeof lg.lockMs === 'number' && J(lg.newRM) === '["RM079"]' && lg.ok === true && lg.fsLock === 'acquired' && lg.totalMs >= 9000, lg);
  check('S5 로그에 프롬프트 전문이 없음', !e.logs.some(x => x.includes('MRO(산업 소모성 자재)')));
  e = makeGas({ ai: [OKAI], extraRaw: [['X-01', '수기', '수기', '활성', 'd']] });
  e.ctx.suggestRawMaterials('리튬망간', 'sheet_edit');
  check('S6 형식이 다른 코드(X-01)가 섞여도 RM079(예전엔 RMNaN) — Cloud Run과 같은 번호 규칙', e.raw[e.raw.length - 1][0] === 'RM079', e.raw.slice(-1));
  e = makeGas({ ai: [OKAI] });
  e.fs.doc = { fields: { lockedAt: { timestampValue: new Date(e.clock.now + 60000).toISOString() }, holderId: { stringValue: 'cloud-run' } }, updateTime: e.fs.newUpdateTime() };
  r = e.ctx.suggestRawMaterials('리튬망간', 'sweep');
  check('S7 Cloud Run이 원자재마스터를 쓰는 중(잠금 10초 초과) → null(실패), 시트 안 건드림, 스크립트 잠금은 아예 안 잡음, 로그 LOCK_TIMEOUT', r === null && e.raw.length === 79 && e.order.length === 0 && e.suggestLog().error === 'LOCK_TIMEOUT', { r, order: e.order, log: e.suggestLog() });
  e = makeGas({ ai: [OKAI] }); e.fs.mode = 'http500';
  r = e.ctx.suggestRawMaterials('리튬망간', 'app');
  check('S8 Firestore 장애 → 예전처럼 스크립트 잠금만으로 계속 진행(추천 성공), 로그 fsLock=error', r && e.raw[e.raw.length - 1][0] === 'RM079' && e.suggestLog().fsLock === 'error', e.suggestLog());
  e = makeGas({ ai: [OKAI], scriptLockFails: true });
  r = e.ctx.suggestRawMaterials('리튬망간', 'app');
  check('S9 스크립트 잠금 실패 → null, 먼저 잡은 Firestore 잠금은 풀어 줌', r === null && e.fs.doc === null && e.suggestLog().error === 'LOCK_TIMEOUT', { doc: e.fs.doc, log: e.suggestLog() });
  e = makeGas({ ai: ['형식오류', null] });
  r = e.ctx.suggestRawMaterials('알수없음', 'app');
  const lg2 = e.suggestLog();
  check('S10 AI 2회 실패 → null(예전과 동일), 잠금은 아예 안 잡음, 로그 attempts 2건(PARSE, NO_RESPONSE)·AI_FAILED', r === null && e.fs.calls.length === 0 && lg2.error === 'AI_FAILED' && lg2.attempts.length === 2 && lg2.attempts[0].error === 'PARSE' && lg2.attempts[1].error === 'NO_RESPONSE', lg2);

  console.log('── I그룹: I열 규칙 v2 ──');
  e = makeGas({ ai: [J({ materials: [{ isNew: false, korean: '니트릴고무', keyword: 'NBR' }] })] });
  const evt = { range: { getSheet: () => e.itemSheet, getRow: () => 3, getColumn: () => 1, getLastRow: () => 3, getNumRows: () => 1, getNumColumns: () => 1, getValue: () => 'TEST-002' }, oldValue: undefined };
  e.ctx.onEditInstallable(evt);
  check('I1 ②-a: 새 행의 빈 F를 자동으로 채우면 I열(원자재수정일)도 찍음 + 로그 mode=sheet_fill', e.items[2][5] === '니트릴고무' && e.cellWrites.some(w => w.sheet === '품목마스터' && w.r === 3 && w.c === 9 && w.v === 'DATE') && e.suggestLog().mode === 'sheet_fill', { F: e.items[2][5], writes: e.cellWrites });
  e = makeGas({ ai: [J({ materials: [{ isNew: false, korean: '고무', keyword: '고무' }] })] });
  e.items[1][2] = '기존품목'; // F='고무' 이미 있음
  const evt2 = { range: { getSheet: () => e.itemSheet, getRow: () => 2, getColumn: () => 3, getLastRow: () => 2, getNumRows: () => 1, getNumColumns: () => 1, getValue: () => '기존품목' }, oldValue: '옛품목' };
  e.ctx.onEditInstallable(evt2);
  check('I2 ②-b: 품목명을 고쳐 다시 추천했는데 결과가 같으면(고무→고무) I를 안 찍음(기존 규칙 유지) + 로그 mode=sheet_edit', !e.cellWrites.some(w => w.c === 9) && e.suggestLog().mode === 'sheet_edit', e.cellWrites);
  e = makeGas({ ai: [J({ materials: [{ isNew: false, korean: '니트릴고무', keyword: 'NBR' }] })] });
  e.items[2] = ['TEST-002', '반도코리아(주)', '테스트용 니트릴장갑', '박태영', '동부', '', '활성', 'd', ''];
  e.ctx.ensureAllItemRowsComplete();
  check('I3 15분 점검이 빈 F를 채우면 I도 찍음(설계 7-2 "모든 자동 F 쓰기에서 I 갱신") + 로그 mode=sweep', e.items[2][5] === '니트릴고무' && e.cellWrites.some(w => w.r === 3 && w.c === 9 && w.v === 'DATE') && e.suggestLog().mode === 'sweep', e.cellWrites);
  e = makeGas({ ai: [null, null] });
  e.ctx.onEditInstallable({ range: { getSheet: () => e.itemSheet, getRow: () => 3, getColumn: () => 1, getLastRow: () => 3, getNumRows: () => 1, getNumColumns: () => 1, getValue: () => 'TEST-002' } });
  check('I4 AI가 실패해서 F를 못 채우면 I도 안 찍음', e.items[2][5] === '' && !e.cellWrites.some(w => w.c === 9), e.cellWrites);

  console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
  process.exitCode = failures ? 1 : 0;
})().catch(err => { console.error('시험 실행 오류:', err); process.exitCode = 1; });
