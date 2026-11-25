// node tests/cost_cut_tests.js — 2026-11-25 요금 절감 A·B·C 시험(시트·Firestore·네트워크 없음, 가짜 객체만).
//  A: index.js gzipJson_ — 큰 JSON 응답을 gzip으로(브라우저가 gzip을 받을 때만, 1KB 이상만)
//  B: lib/auth.js·index.js 세션 연장 — 마지막 연장이 50초 안이면 Firestore에 다시 쓰지 않음
//  C: lib/pushSender.js — 보낼 내용이 없고 이미 '빈 상태'면 다시 쓰지 않음
const path = require('path');
const fs = require('fs');
const zlib = require('node:zlib');
let pass = 0, fail = 0;
const t = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  → ' + JSON.stringify(info))); };

const auth = require(path.join(__dirname, '..', 'lib', 'auth.js'));
const ps = require(path.join(__dirname, '..', 'lib', 'pushSender.js'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// ---- A: index.js의 gzipJson_ 코드를 그대로 꺼내 실행
const a0 = SRC.indexOf('const GZIP_MIN_BYTES'), a1 = SRC.indexOf('\n}\n', a0) + 3;
const gzipJson_ = new Function('zlib', SRC.slice(a0, a1) + '\nreturn gzipJson_;')(zlib);
function fakeRes() {
  const r = { headers: {}, code: 200, body: undefined, kind: null };
  r.set = function (k, v) { r.headers[k.toLowerCase()] = v; return r; };
  r.status = function (c) { r.code = c; return r; };
  r.json = function (o) { r.kind = 'json'; r.body = o; return r; };
  r.send = function (b) { r.kind = 'send'; r.body = b; return r; };
  return r;
}
const big = { ok: true, items: Array.from({ length: 300 }, (_, i) => ({ id: 'P' + i, title: '예시 게시물 제목 ' + i, body: '예시 본문 내용입니다 '.repeat(5) })) };
(function () {
  const res = fakeRes();
  gzipJson_({ headers: { 'accept-encoding': 'gzip, deflate, br' } }, res);
  res.status(200).json(big);
  const ok = res.kind === 'send' && Buffer.isBuffer(res.body) && res.headers['content-encoding'] === 'gzip';
  const back = ok ? JSON.parse(zlib.gunzipSync(res.body).toString('utf8')) : null;
  t('A1 큰 응답 + gzip 받음 → 압축해서 보냄, 풀면 원래 JSON과 같음', ok && JSON.stringify(back) === JSON.stringify(big), { kind: res.kind, h: res.headers });
  t('A2 머리글: Content-Type JSON·Vary Accept-Encoding, 상태 코드 그대로', res.headers['content-type'] === 'application/json; charset=utf-8' && res.headers.vary === 'Accept-Encoding' && res.code === 200, res.headers);
  const raw = Buffer.byteLength(JSON.stringify(big)), gz = res.body.length;
  t('A3 크기가 줄어듦 (' + raw + ' → ' + gz + '바이트)', gz < raw * 0.5, { raw, gz });
})();
(function () {
  const res = fakeRes();
  gzipJson_({ headers: { 'accept-encoding': 'gzip' } }, res);
  res.status(200).json({ ok: false, error: 'SESSION_EXPIRED' });
  t('A4 1KB 미만 응답은 압축하지 않고 예전처럼 json', res.kind === 'json' && !res.headers['content-encoding'] && res.body.error === 'SESSION_EXPIRED', res);
})();
(function () {
  const res = fakeRes();
  gzipJson_({ headers: {} }, res);
  res.status(200).json(big);
  t('A5 gzip을 안 받는 요청은 예전처럼 json', res.kind === 'json' && !res.headers['content-encoding'], res.headers);
  const res2 = fakeRes();
  gzipJson_({}, res2);
  res2.status(500).json(big);
  t('A6 headers가 없어도 오류 없이 예전처럼', res2.kind === 'json' && res2.code === 500, res2.headers);
})();
['pollSignalTest', 'getFeedTest', 'getNotificationsTest'].forEach(function (fn) {
  const i = SRC.indexOf('exports.' + fn + ' = async (req, res) => {');
  t('A7 ' + fn + '가 setCors 바로 다음에 gzipJson_ 호출', i > 0 && SRC.slice(i, i + 140).indexOf('setCors(res);\n  gzipJson_(req, res);') > 0);
});
t('A8 다른 함수에는 붙이지 않음(이번 범위 3개만)', (SRC.match(/\n  gzipJson_\(req, res\);/g) || []).length === 3);

// ---- B: 세션 연장 50초 간격
const TTL = auth.SESSION_TTL_MS, GAP = auth.SESSION_TOUCH_MIN_GAP_MS, NOW = Date.now();
t('B1 간격 상수 50초', GAP === 50000, GAP);
t('B2 방금(10초 전) 연장 → 다시 안 씀', auth.needsTouch(NOW - 10000 + TTL, NOW) === false);
t('B3 49초 전 → 안 씀 / 50초 전 → 씀', auth.needsTouch(NOW - 49000 + TTL, NOW) === false && auth.needsTouch(NOW - 50000 + TTL, NOW) === true);
t('B4 만료 시각을 모르면 예전처럼 씀', auth.needsTouch(NaN, NOW) === true && auth.needsTouch(0, NOW) === true);
function fakeSessionFs(expMs) {
  const st = { updates: 0 };
  const ref = { async update() { st.updates++; } };
  return { st, collection: () => ({ doc: () => ({ async get() { return { exists: true, ref, data: () => ({ email: 'a@x.com', expiresAt: new Date(expMs) }) }; } }) }) };
}
(async function () {
  const f1 = fakeSessionFs(Date.now() + TTL - 5000);
  const r1 = await auth.authenticateSession(f1, 'tok');
  t('B5 authenticateSession: 5초 전 연장된 세션 → 통과, 쓰기 0번', r1.ok && r1.email === 'a@x.com' && f1.st.updates === 0, { r1, st: f1.st });
  const f2 = fakeSessionFs(Date.now() + TTL - 120000);
  const r2 = await auth.authenticateSession(f2, 'tok');
  t('B6 2분 전 연장된 세션 → 통과, 쓰기 1번(예전과 같음)', r2.ok && f2.st.updates === 1, f2.st);
  const f3 = fakeSessionFs(Date.now() - 1000);
  const r3 = await auth.authenticateSession(f3, 'tok');
  t('B7 만료된 세션 → SESSION_EXPIRED, 쓰기 없음(예전과 같음)', !r3.ok && r3.error === 'SESSION_EXPIRED' && f3.st.updates === 0, r3);
  const st4 = { updates: 0 };
  await auth.touchSession({ async update() { st4.updates++; } });
  t('B8 touchSession을 만료 시각 없이 부르면 예전처럼 항상 씀', st4.updates === 1, st4);
  // pushSender의 '앱 열림' 판단(2분 창)과 어긋나지 않는지: 1분마다 오는 요청이면 매번 쓰임
  t('B9 1분 간격 요청은 매번 기록 → pushSender 2분 창 판단 그대로', auth.needsTouch(NOW - 60000 + TTL, NOW) === true && GAP < 2 * 60 * 1000);
  const inline = (SRC.match(/await touchSession_\(sessionSnap\.ref, expiresAt\);/g) || []).length;
  t('B10 index.js 직접 인증 4곳 모두 만료 시각을 넘김', inline === 4 && SRC.indexOf('await touchSession_(sessionSnap.ref);') < 0, inline);

  // ---- C: pushSender 빈 상태
  function fakePushFs(state) {
    const st = { reads: 0, writes: [] , state: state };
    const stateRef = { async get() { st.reads++; return { exists: !!st.state, data: () => st.state }; }, async set(v) { st.writes.push(v); st.state = Object.assign({}, st.state || {}, { lastSignature: v.lastSignature }); } };
    return { st, collection: () => ({ doc: () => stateRef, where: () => ({ where() { return this; }, async get() { return { empty: true, docs: [] }; } }) }) };
  }
  const zero = { newPosts: 0, needsReply: 0, awaitingReply: 0 };
  const c1 = fakePushFs({ lastSignature: '' });
  const rc1 = await ps.sendConsolidatedPushForUser(c1, {}, 'p', 'a@x.com', zero);
  t('C1 보낼 것 없음 + 이미 빈 상태 → 쓰기 0번(읽기 1번)', rc1.reason === 'NO_CONTENT' && c1.st.writes.length === 0 && c1.st.reads === 1, c1.st);
  const c2 = fakePushFs({ lastSignature: '2-0-0' });
  const rc2 = await ps.sendConsolidatedPushForUser(c2, {}, 'p', 'a@x.com', zero);
  t('C2 보낼 것 없음 + 전에 건수 있었음 → 빈 상태로 1번 씀(예전과 같음)', rc2.reason === 'NO_CONTENT' && c2.st.writes.length === 1 && c2.st.writes[0].lastSignature === '', c2.st);
  const c3 = fakePushFs(null);
  const rc3 = await ps.sendConsolidatedPushForUser(c3, {}, 'p', 'a@x.com', zero);
  t('C3 처음 보는 사람 → 빈 상태로 1번 씀(예전과 같음)', rc3.reason === 'NO_CONTENT' && c3.st.writes.length === 1, c3.st);
  const c4 = fakePushFs({ lastSignature: '1-0-0' });
  const rc4 = await ps.sendConsolidatedPushForUser(c4, {}, 'p', 'a@x.com', { newPosts: 1, needsReply: 0, awaitingReply: 0 });
  t('C4 같은 건수 그대로 → UNCHANGED_STATE, 읽기 1번(예전과 같음)', rc4.reason === 'UNCHANGED_STATE' && c4.st.reads === 1 && c4.st.writes.length === 0, { rc4, st: c4.st });

  console.log('cost_cut_tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
