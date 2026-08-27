const {GoogleAuth} = require('google-auth-library');
// 2026-08-21 (postComment 1단계): Code.gs의 Utilities.getUuid()(v4 UUID)에 대응하는
// commentId 생성용. Node 22 표준 모듈, 별도 설치 불필요.
const crypto = require('crypto');

// 2026-08-20 (2단계, getFeed/getNotifications/getPostById 공동 이전 준비): 공통 판정/
// 변환 로직(lib/feedEngine.js), Sheets 읽기 공통화(lib/sheetsClient.js), Firestore 세션
// 인증 공통화(lib/auth.js), 응답 생성(lib/feedResponses.js). FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md
// (승인됨)에서 설계한 그대로이며, pollSignalTest 리팩터링과 getFeedTest/getNotificationsTest/
// getPostByIdTest(신규, 아직 Cloud Run에는 미배포) 4개만 이 모듈들을 쓴다. whoamiTest/
// getSettingsTest/getTeamManagersTest/getThreadSeenTest는 이번 범위가 아니라 그대로 두었다.
const { authenticateSession } = require('./lib/auth');
const {
  getSheetsClient,
  batchGetValues,
  rowsToUsers,
  rowsToPosts,
  rowsToItems,
  rowsToComments,
  rowsToCustomers,
  parseSettings
} = require('./lib/sheetsClient');
const feedEngine = require('./lib/feedEngine');
const feedResponses = require('./lib/feedResponses');
// 2026-08-20 (markThreadSeen 1단계, 설계 승인 완료 — MARKTHREADSEEN_CLOUDRUN_DESIGN.md):
// Firestore 트랜잭션 기반 쓰기 idempotency 처리 공통화. markThreadSeenTest만 이번에 사용한다.
const { withIdempotency } = require('./lib/writeIdempotency');

const SPREADSHEET_ID = '1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU';
// Sheet tab name is written as a JS unicode escape (Korean debug-log tab name).
const SHEET_NAME = '\uB514\uBC84\uADF8\uB85C\uADF8';
const RANGE = encodeURIComponent(SHEET_NAME + '!A1');

function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// GET /ping : no external calls at all, respond immediately.
exports.pingTest = (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  const serverMs = Date.now() - t0;
  res.status(200).json({ok: true, serverMs, timestamp: Date.now()});
};

// GET /sheetPing : read exactly one cell from the production spreadsheet. No retry/cache/hedge.
exports.sheetPingTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const auth = new GoogleAuth({scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']});
    const client = await auth.getClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${RANGE}`;
    const resp = await client.request({url});
    const serverMs = Date.now() - t0;
    const value = (resp.data && resp.data.values && resp.data.values[0] && resp.data.values[0][0]) || null;
    res.status(200).json({ok: true, serverMs, timestamp: Date.now(), value});
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ok: false, serverMs, error: String((err && err.message) || err)});
  }
};

const SHEET_USER_NAME = '\uC0AC\uC6A9\uC790\uD300\uB9C8\uC2A4\uD130';
const TEAM_RANGE = encodeURIComponent(SHEET_USER_NAME + '!D2');

// GET /getTeams : read a data-validation dropdown list from one cell. No retry/cache/hedge.
exports.getTeamsTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const auth = new GoogleAuth({scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']});
    const client = await auth.getClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?ranges=${TEAM_RANGE}&fields=sheets.data.rowData.values.dataValidation`;
    const resp = await client.request({url});
    const serverMs = Date.now() - t0;
    let teams = [];
    try {
      const dv = resp.data.sheets[0].data[0].rowData[0].values[0].dataValidation;
      teams = (dv && dv.condition && dv.condition.values) ? dv.condition.values.map(v => v.userEnteredValue) : [];
    } catch (e) {}
    res.status(200).json({ok: true, serverMs, timestamp: Date.now(), teams});
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ok: false, serverMs, error: String((err && err.message) || err)});
  }
};

const { Firestore } = require('@google-cloud/firestore');
const firestore = new Firestore();

const SESSION_TTL_MS = 21600 * 1000; // 6시간 — Apps Script CacheService의 세션 TTL과 동일

// 세션 인증을 통과한 요청마다 Firestore 세션의 expiresAt을 지금 시각 + 6시간으로 밀어서,
// Apps Script authenticateRequest_의 슬라이딩 세션 연장과 동일하게 동작하도록 한다
// (2026-08-18, login/whoami 전환 계획 1단계). best-effort: 이 갱신이 실패해도 원래
// 요청의 응답에는 영향을 주지 않는다 — sessionSyncTest(로그인 최초 1회 기록)는 그대로 둔다.
async function touchSession_(ref) {
  try {
    await ref.update({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  } catch (e) {
    console.error('touchSession_ 실패(무시): ' + e);
  }
}

// GET /firestoreTest : write one small doc, read it back, delete it. Measures Firestore round-trip only.
exports.firestoreTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  const timings = {};
  try {
    const docId = 'test_' + t0 + '_' + Math.floor(Math.random() * 100000);
    const ref = firestore.collection('sessions_test').doc(docId);

    const w0 = Date.now();
    await ref.set({ email: 'test@nkmro.com', createdAt: Date.now() });
    timings.writeMs = Date.now() - w0;

    const r0 = Date.now();
    const snap = await ref.get();
    timings.readMs = Date.now() - r0;
    const data = snap.exists ? snap.data() : null;

    const d0 = Date.now();
    await ref.delete();
    timings.deleteMs = Date.now() - d0;

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, timestamp: Date.now(), data });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, timings, error: String((err && err.message) || err) });
  }
};



// POST /sessionSyncTest : Code.gs login success (1x) calls this. Single Firestore write, no retry/cache.
exports.sessionSyncTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, email } = req.body || {};
    if (!sessionToken || !email) {
      const serverMs = Date.now() - t0;
      res.status(400).json({ ok: false, serverMs, error: 'MISSING_FIELDS' });
      return;
    }
    const ref = firestore.collection('sessions').doc(sessionToken);
    const now = Date.now();
    await ref.set({
      email: email,
      createdAt: new Date(now),
      expiresAt: new Date(now + 21600 * 1000)
    });
    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// POST /whoamiTest : sessionToken -> Firestore   ->    (   ).
//  Firestore  +  Sheets , / .
const USER_DATA_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:I');
exports.whoamiTest = async (req, res) => {
setCors(res);
if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
const t0 = Date.now();
const timings = {};
try {
const { sessionToken } = req.body || {};
if (!sessionToken) {
const serverMs = Date.now() - t0;
res.status(400).json({ ok: false, serverMs, error: 'MISSING_SESSION_TOKEN' });
return;
}
const s0 = Date.now();
const sessionSnap = await firestore.collection('sessions').doc(sessionToken).get();
timings.sessionMs = Date.now() - s0;
if (!sessionSnap.exists) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_NOT_FOUND' });
return;
}
const session = sessionSnap.data();
const expiresAtRaw = session.expiresAt;
const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
if (!(expiresAt.getTime() > Date.now())) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_EXPIRED' });
return;
}
await touchSession_(sessionSnap.ref); // 슬라이딩 세션 연장 (1단계)
const email = session.email;
const u0 = Date.now();
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const client = await auth.getClient();
const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USER_DATA_RANGE}`;
const resp = await client.request({ url });
timings.sheetMs = Date.now() - u0;
const rows = (resp.data && resp.data.values) || [];
const row = rows.find(r => String(r[0] || '').trim().toLowerCase() === String(email).trim().toLowerCase());
if (!row) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
return;
}
const serverMs = Date.now() - t0;
res.status(200).json({ ok: true, serverMs, timings, email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] });
} catch (err) {
const serverMs = Date.now() - t0;
res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
}
};

// GET/POST /getSettingsTest : session-authenticated read of the (settings) sheet. Mirrors handleGetSettings_ in Code.gs. Single sheet read, no retry/cache/hedge.
const SHEET_SETTING_NAME = '설정';
const SETTINGS_RANGE = encodeURIComponent(SHEET_SETTING_NAME + '!A2:C');
exports.getSettingsTest = async (req, res) => {
setCors(res);
if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
const t0 = Date.now();
const timings = {};
try {
const { sessionToken } = req.body || {};
if (!sessionToken) {
const serverMs = Date.now() - t0;
res.status(400).json({ ok: false, serverMs, error: 'MISSING_SESSION_TOKEN' });
return;
}
const s0 = Date.now();
const sessionSnap = await firestore.collection('sessions').doc(sessionToken).get();
timings.sessionMs = Date.now() - s0;
if (!sessionSnap.exists) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_NOT_FOUND' });
return;
}
const session = sessionSnap.data();
const expiresAtRaw = session.expiresAt;
const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
if (!(expiresAt.getTime() > Date.now())) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_EXPIRED' });
return;
}
await touchSession_(sessionSnap.ref); // 슬라이딩 세션 연장 (1단계)
const u0 = Date.now();
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const client = await auth.getClient();
const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SETTINGS_RANGE}`;
const resp = await client.request({ url });
timings.sheetMs = Date.now() - u0;
const rows = (resp.data && resp.data.values) || [];
const settings = {};
const descriptions = {};
rows.forEach(function (row) {
const key = row[0];
if (!key) return;
settings[key] = row[1];
descriptions[key] = row[2] || '';
});
const serverMs = Date.now() - t0;
res.status(200).json({ ok: true, serverMs, timings, settings, descriptions });
} catch (err) {
const serverMs = Date.now() - t0;
res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
}
};

// GET/POST /getTeamManagersTest : session-authenticated read of team-manager rows from , restricted to team-lead role. Mirrors handleGetTeamManagers_ in Code.gs. Single sheet read, no retry/cache/hedge.
exports.getTeamManagersTest = async (req, res) => {
setCors(res);
if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
const t0 = Date.now();
const timings = {};
try {
const { sessionToken } = req.body || {};
if (!sessionToken) {
const serverMs = Date.now() - t0;
res.status(400).json({ ok: false, serverMs, error: 'MISSING_SESSION_TOKEN' });
return;
}
const s0 = Date.now();
const sessionSnap = await firestore.collection('sessions').doc(sessionToken).get();
timings.sessionMs = Date.now() - s0;
if (!sessionSnap.exists) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_NOT_FOUND' });
return;
}
const session = sessionSnap.data();
const expiresAtRaw = session.expiresAt;
const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
if (!(expiresAt.getTime() > Date.now())) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_EXPIRED' });
return;
}
await touchSession_(sessionSnap.ref); // 슬라이딩 세션 연장 (1단계)
const email = session.email;
const u0 = Date.now();
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const client = await auth.getClient();
const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${USER_DATA_RANGE}`;
const resp = await client.request({ url });
timings.sheetMs = Date.now() - u0;
const rows = (resp.data && resp.data.values) || [];
const me = rows.find(function (row) { return String(row[0] || '').trim().toLowerCase() === String(email).trim().toLowerCase(); });
if (!me) {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
return;
}
if (me[2] !== '팀장') {
const serverMs = Date.now() - t0;
res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN' });
return;
}
const myTeam = me[3];
const managers = [];
rows.forEach(function (row) {
if (!row[0]) return;
const role = row[2];
const team = row[3];
const status = row[4];
if (role === '담당' && String(team || '').trim() === String(myTeam || '').trim() && status === '활성') {
managers.push({ email: row[0], name: row[1] });
}
});
const serverMs = Date.now() - t0;
res.status(200).json({ ok: true, serverMs, timings, managers });
} catch (err) {
const serverMs = Date.now() - t0;
res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
}
};

// ---------------------------------------------------------------------------
// POST /pollSignalTest (2026-08-18, pollSignal 실제 이전 승인 단계)
//
// Code.gs의 handlePollSignal_/buildFeedEntry_/getRelatedItems_/canViewComment_를 그대로 옮긴
// 것으로, 계산 로직은 cloud-run/mro-functions/tests/pollsignal-parity/에서 12개 시나리오로
// 기존 Apps Script pollSignal과 결과가 100% 동일함을 이미 검증했다
// (POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md 참고).
//
// 기존 Apps Script의 pollSignal(handlePollSignal_)은 이 함수와 완전히 분리되어 있고
// 전혀 수정하지 않았다 — 이 함수는 시황게시물/품목마스터/댓글/설정/사용자팀마스터 5개 시트를
// 전부 읽기 전용(spreadsheets.readonly)으로만 읽고, 쓰기는 어디에서도 하지 않는다.
//
// [날짜값 처리 주의] 시황게시물.createdAt(H열)/품목마스터.registeredAt(H열)/댓글.createdAt(I열)/
// 사용자팀마스터.lastCheckedAt(F열)은 Apps Script에서 실제 Date 객체로 기록된 진짜 날짜 셀이다.
// Sheets API 기본 옵션(FORMATTED_VALUE)으로 읽으면 스프레드시트 표시 형식에 따라 사람이 보는
// 문자열(예: "2026. 8. 15 오전 10:30:00")로 돌아와 파싱이 불안정해질 수 있어(테스트 계획 문서에서
// 이미 지적한 위험), 이 함수만 valueRenderOption=UNFORMATTED_VALUE를 명시해서 날짜 셀을
// "1899-12-30 기준 일수(serial number)"로 받는다. 다른 기존 함수(whoamiTest/getSettingsTest 등)는
// 그대로 FORMATTED_VALUE를 쓰므로 이 변경은 이 함수에만 적용된다.
//
// [2026-08-18 날짜/시간대 버그 수정] 이 serial number는 UTC가 아니라 "스프레드시트에 설정된
// 시간대 기준 벽시계 값"이다(2026-08-18 스프레드시트 파일>설정>시간대에서 "(GMT+09:00) 서울"로
// 직접 확인). 예전 sheetSerialToMs_는 이 값을 그대로 UTC로 취급해서, totalNeedsAttention처럼
// "sheetSerialToMs_로 변환된 두 값끼리"만 비교하는 상대비교 결과는 문제없었지만(서울 오프셋이
// 양쪽에 똑같이 실려서 상쇄됨 — 이미 실사용자 데이터로 검증됨), signatures[].lastCommentAt로
// 그대로 노출되는 절대 시각 자체는 실제(Apps Script 기준)보다 9시간 앞서 있었다(예:
// 2026-07-28T10:52:00.109Z로 노출됐지만 실제는 2026-07-28T01:52:00.109Z). 한국은 DST가 없어
// 이 오프셋은 연중 고정이므로, 스프레드시트 시간대 설정이 서울로 유지되는 한 아래처럼 고정
// 오프셋을 빼주면 된다. 이 시간대가 바뀌면 이 상수도 같이 바꿔야 한다.
const SHEET_POST_NAME = '시황게시물';
const SHEET_ITEM_NAME = '품목마스터';
const SHEET_COMMENT_NAME = '댓글';
const POLL_USER_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:I');
const POLL_POST_RANGE = encodeURIComponent(SHEET_POST_NAME + '!A2:H');
const POLL_ITEM_RANGE = encodeURIComponent(SHEET_ITEM_NAME + '!A2:H');
const POLL_COMMENT_RANGE = encodeURIComponent(SHEET_COMMENT_NAME + '!A2:I');
const POLL_SETTINGS_RANGE = encodeURIComponent(SHEET_SETTING_NAME + '!A2:C');

// 5개 시트를 한 번에 읽는 batchGet 범위 배열 + UNFORMATTED_VALUE 옵션.
// getFeedTest/getNotificationsTest/getPostByIdTest(신규)와 pollSignalTest(리팩터링)가
// 전부 이 동일한 5개 범위를 그대로 재사용한다(기존 pollSignalTest가 이미 쓰던 것과 동일,
// 추가 Sheets API 호출 없음).
const FEED_BATCH_RANGES = [POLL_USER_RANGE, POLL_POST_RANGE, POLL_ITEM_RANGE, POLL_COMMENT_RANGE, POLL_SETTINGS_RANGE];

// 세션 인증 실패 시 기존 각 함수의 인라인 분기와 정확히 같은 응답 모양을 만든다.
// (MISSING_SESSION_TOKEN은 원래도 timings 키가 없었으므로, auth.timings가 undefined일 때는
//  timings 키를 넣지 않는다 — lib/auth.js의 authenticateSession 주석 참고.)
function authFailureResponseBody_(serverMs, auth) {
  return auth.timings
    ? { ok: false, serverMs, timings: auth.timings, error: auth.error }
    : { ok: false, serverMs, error: auth.error };
}

// 2026-08-20 (2단계) 리팩터링: 기존 teamScopeAllows_/relatedActiveItems_/
// summarizeItemForPost_/needsAttentionFor_/sheetSerialToMs_ 5개 최상위 함수는
// lib/feedEngine.js로 이동했다(index.js 전체에서 pollSignalTest 밖에는 이 5개를 쓰는
// 곳이 없음을 grep으로 재확인 완료 — 실제 구현 보고서 참고). 인증/시트읽기 블록도
// lib/auth.js·lib/sheetsClient.js로 옮겼다. 아래는 그 공통 모듈을 호출하도록 다시 쓴
// pollSignalTest이며, 응답 모양(ok/serverMs/timings/totalNeedsAttention/signatures)과
// signatures 각 원소의 필드·값 계산 방식은 리팩터링 전과 동일하다(customer/itemName/
// comments 등 lib/feedEngine.js가 추가로 계산하는 필드는 여기서 그냥 버리고 응답에 안 넣음).
exports.pollSignalTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail);

    let totalNeedsAttention = 0;
    const signatures = [];
    entries.forEach(function (entry) {
      if (entry.needsAttention) totalNeedsAttention += 1;
      entry.items.forEach(function (s) {
        signatures.push({
          postId: entry.post.id,
          itemId: s.itemId,
          commentCount: s.commentCount,
          lastCommentAt: s.lastCommentAtMs !== null ? new Date(s.lastCommentAtMs).toISOString() : null
        });
      });
    });

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, totalNeedsAttention, signatures });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /getFeedTest, /getNotificationsTest, /getPostByIdTest (2026-08-20, 2단계 — 실제 구현
// 완료, 로컬 parity 검증 대상. 아직 Cloud Run에 배포하지 않았고 프론트엔드도 연결하지 않았다.)
//
// 3개 함수 모두 공통 1~3단계(세션 인증 -> 5개 시트 batchGet -> 뷰어/leadScope/teamByEmail
// 조립 -> feedEngine.buildFeedEntries 또는 buildFeedEntry 호출) 후, 함수별로 다른 4단계
// (feedResponses의 응답 생성 함수)만 다르다. Code.gs의 handleGetFeed_/handleGetNotifications_/
// handleGetPostById_와 같은 값을 내는 것을 목표로 한다(FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md
// 5번 섹션 참고. getPostByIdTest는 설계 문서와 달리 buildFeedEntries(전체) 대신
// buildFeedEntry(단일 게시물)를 직접 쓰도록 조정했다 — NOT_FOUND/FORBIDDEN을 구분하려면
// "게시물 자체가 없음"과 "있지만 안 보임"을 나눠야 하는데, buildFeedEntries가 이미 필터링한
// entries만 보면 이 둘을 구분할 수 없기 때문이다).

exports.getFeedTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, cursor, limit } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail);

    const feedDisplayDays = Number(settings['뉴스피드출력기간']) || 14;
    const result = feedResponses.buildGetFeedResponse(entries, { cursor: cursor, limit: limit, feedDisplayDays: feedDisplayDays });

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

exports.getNotificationsTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail);
    const result = feedResponses.buildGetNotificationsResponse(entries, viewer, allUsers);

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

exports.getPostByIdTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, postId } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    if (!postId) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'MISSING_POST_ID' });
      return;
    }

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const post = allPosts.find(function (p) { return p.id === postId; });
    if (!post) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'NOT_FOUND' });
      return;
    }

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const commentsByPost = feedEngine.groupCommentsByPost(allComments);
    const entry = feedEngine.buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail);
    if (!entry) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN' });
      return;
    }

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, feedResponses.buildPostDetailResponse(entry)));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /getCommentsTest (getComments 이전 1단계 — 백엔드 구현/parity만, feed.html 연결은 별도 승인)
//
// Code.gs의 handleGetComments_/getCommentsForPost_를 그대로 옮긴 것. getPostByIdTest와
// 달리 게시물 자체가 존재하는지는 확인하지 않는다 — postId가 있으면(그 값이 실제 존재하는
// 게시물이 아니어도) 그냥 해당 postId로 걸린 댓글이 없다는 뜻이라 ok:true, comments:[]를
// 그대로 반환한다(NOT_FOUND 같은 별도 에러가 없음 — Code.gs와 동일).
exports.getCommentsTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, postId } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    if (!postId) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'MISSING_POST_ID' });
      return;
    }

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const comments = feedEngine.visibleCommentsForPost(allComments, postId, viewer.role, viewer.team, leadScope, teamByEmail);

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, feedResponses.buildGetCommentsResponse(comments)));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /getThreadSeenTest (2026-08-19, getThreadSeen 단독 이전 1단계 — 분석/설계 승인 완료)
//
// Code.gs의 handleGetThreadSeen_/getThreadSeenMap_을 그대로 옮긴 것. buildFeedEntry_ 등 피드/알림
// 쪽 공용 판정 로직과는 전혀 무관한, 완전히 독립적인 단순 조회다 — '댓글확인이력' 시트(이메일/
// postId/itemId/확인시각)에서 요청자 본인 이메일에 해당하는 행만 걸러 {postId-itemId: 확인시각}
// 맵으로 돌려준다. 쓰기 쪽(markThreadSeen)은 이번 이전 범위가 아니라 계속 Apps Script에 남는다
// (markChecked/updateSettings와 동일한 "읽기만 이전" 패턴).
//
// [parity 주의] 이메일 비교는 Code.gs의 getThreadSeenMap_과 완전히 동일하게 trim() 없이
// toLowerCase()만 적용한다 — 다른 *Test 함수들(whoamiTest 등)은 안전을 위해 trim()을 추가로
// 쓰지만, 여기서는 기존 로직과 "한 글자도 다르지 않게" 맞추는 것을 우선했다
// (cloud-run/mro-functions/tests/threadseen-parity/에서 검증).
const SHEET_THREAD_SEEN_NAME = '댓글확인이력';
const THREAD_SEEN_RANGE = encodeURIComponent(SHEET_THREAD_SEEN_NAME + '!A2:D');
exports.getThreadSeenTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  const timings = {};
  try {
    const { sessionToken } = req.body || {};
    if (!sessionToken) {
      const serverMs = Date.now() - t0;
      res.status(400).json({ ok: false, serverMs, error: 'MISSING_SESSION_TOKEN' });
      return;
    }
    const s0 = Date.now();
    const sessionSnap = await firestore.collection('sessions').doc(sessionToken).get();
    timings.sessionMs = Date.now() - s0;
    if (!sessionSnap.exists) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_NOT_FOUND' });
      return;
    }
    const session = sessionSnap.data();
    const expiresAtRaw = session.expiresAt;
    const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
    if (!(expiresAt.getTime() > Date.now())) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'SESSION_EXPIRED' });
      return;
    }
    await touchSession_(sessionSnap.ref); // 슬라이딩 세션 연장 (기존 Phase 1과 동일)
    const email = session.email;
    const u0 = Date.now();
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const client = await auth.getClient();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${THREAD_SEEN_RANGE}`;
    const resp = await client.request({ url });
    timings.sheetMs = Date.now() - u0;
    const rows = (resp.data && resp.data.values) || [];
    const seenMap = {};
    rows.forEach(function (row) {
      if (String(row[0]).toLowerCase() === String(email).toLowerCase()) {
        seenMap[row[1] + '-' + row[2]] = row[3];
      }
    });
    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, seenMap });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /markThreadSeenTest (markThreadSeen 1단계 — 코드 구현만, 아직 미배포/미연결)
// 승인 경로: WRITE_API_MIGRATION_PREP_REVIEW.md(분석) -> MARKTHREADSEEN_CLOUDRUN_DESIGN.md
// (0단계+1단계 설계 확정 승인) -> 이번 코드 구현 승인. 다음 단계(별도 승인 필요):
// GitHub 커밋 -> Firestore TTL 설정 -> parity 테스트 -> Cloud Run 배포 -> feed.html 연결.
//
// Code.gs의 handleMarkThreadSeen_(3399~3427행)을 그대로 옮긴 것. LockService(스크립트
// 전체 단일 락) 대신 lib/writeIdempotency.js의 Firestore 트랜잭션 기반 idempotencyKey
// dedup을 쓴다 — 설계 문서 2-3의 결론(markThreadSeen은 upsert라 완벽한 분산 락 없이도
// 안전하다)에 따라, "같은 논리적 요청의 재실행 방지"만 Firestore로 재현하고 진짜 동시
// 레이스는 upsert 특성(같은 email+postId+itemId 행을 찾아 갱신/추가)에 맡긴다.
//
// [권한] 이 함수만 쓰기 스코프(spreadsheets, 읽기+쓰기)를 쓴다. 다른 모든 기존 함수는
// 여전히 spreadsheets.readonly만 쓰고, lib/sheetsClient.js(공유 읽기 전용 클라이언트)도
// 이 함수 때문에 건드리지 않았다 — 최소 권한 원칙(설계 문서 1-6/3-3).
//
// [선행 조건, 2026-08-20 확인 완료] Cloud Run 실행 서비스 계정
// (771006650918-compute@developer.gserviceaccount.com)을 대상 스프레드시트에 편집자로
// 공유 완료(재홍님 직접 확인).
exports.markThreadSeenTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, postId, itemId, idempotencyKey } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const result = await withIdempotency(firestore, idempotencyKey, 'markThreadSeen', async function () {
      return markThreadSeenAction_(email, postId, itemId);
    });

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// Code.gs handleMarkThreadSeen_의 upsert 로직(3399~3427행)과 동일한 판단(이메일은
// toLowerCase()만 비교, postId/itemId는 String() 비교) + 동일한 컬럼 배치(A=이메일,
// B=postId, C=itemId, D=확인시각 ISO 문자열). 반환값은 Code.gs와 정확히 같은 모양
// ({ok:true} 또는 {ok:false, error:'MISSING_FIELDS'}) — withIdempotency()가 이 반환값을
// 그대로 Firestore에 캐시하고 재반환하므로, 여기서 serverMs/timings 같은 요청별 필드를
// 넣지 않는다(그건 바깥 exports.markThreadSeenTest가 매 요청마다 새로 붙인다).
async function markThreadSeenAction_(email, postId, itemId) {
  const postIdStr = String(postId || '');
  const itemIdStr = String(itemId || '');
  if (!postIdStr || !itemIdStr) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();

  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${THREAD_SEEN_RANGE}`;
  const getResp = await client.request({ url: getUrl });
  const rows = (getResp.data && getResp.data.values) || [];

  const nowIso = new Date().toISOString();
  let matchedRowIndex = -1; // rows는 A2:D부터 시작하는 배열 — 인덱스 0 == 시트의 2행
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[0]).toLowerCase() === String(email).toLowerCase() &&
        String(row[1]) === postIdStr && String(row[2]) === itemIdStr) {
      matchedRowIndex = i; // 2026-08-24 수정: 마지막 일치 행을 계속 갱신 (break 제거)
    }
  }

  if (matchedRowIndex !== -1) {
    const sheetRow = matchedRowIndex + 2;
    const updateRange = encodeURIComponent(SHEET_THREAD_SEEN_NAME + '!D' + sheetRow);
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${updateRange}?valueInputOption=RAW`;
    await client.request({ url: updateUrl, method: 'PUT', data: { values: [[nowIso]] } });
  } else {
    const appendRange = encodeURIComponent(SHEET_THREAD_SEEN_NAME + '!A:D');
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    await client.request({ url: appendUrl, method: 'POST', data: { values: [[email, postIdStr, itemIdStr, nowIso]] } });
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// POST /postCommentTest (postComment 1단계 — 코드 구현만, 아직 미배포/미연결)
// 승인 경로: WRITE_API_MIGRATION_PREP_REVIEW.md(분석) -> POSTCOMMENT_CLOUDRUN_DESIGN_v2.md
// (설계 확정 승인, 2026-08-21) -> 이번 코드 구현 승인. 다음 단계(별도 승인 필요):
// 로컬 parity 테스트 -> GitHub 커밋 -> Cloud Run 배포 -> feed.html 연결(3단 폴백 정책).
//
// Code.gs의 handlePostComment_(2269~2370행)을 그대로 옮긴 것. 세션 인증(lib/auth.js)·시트
// 읽기(lib/sheetsClient.js)·updatedPost 재계산(lib/feedEngine.js, lib/feedResponses.js)은
// getCommentsTest/getFeedTest/getPostByIdTest와 완전히 동일한 기존 모듈을 그대로 재사용한다
// (설계 문서 2번/9번 결론). 이번에 새로 작성한 것은 (a) 댓글 작성 권한 게이트(findPost_/
// isManagerForItem_ 대응, postCommentAction_ 내부)와 (b) Sheets API append(appendCommentRow_)
// 두 가지뿐이다.
//
// [권한] 이 함수만 쓰기 스코프(spreadsheets, 읽기+쓰기)를 쓴다(markThreadSeenTest와 동일한
// 최소 권한 원칙). 다른 모든 읽기 함수(lib/sheetsClient.js 공유 클라이언트 포함)는 건드리지
// 않았다 — grep으로 재확인: 이 함수 밖에서 'spreadsheets'(쓰기) 스코프를 쓰는 곳은
// markThreadSeenAction_뿐이다.
//
// [폴백 정책, 설계 문서 3번] 이 함수의 응답 자체에는 "사전 실패/애매한 실패" 구분 필드를
// 넣지 않는다 — 클라이언트가 "정상 JSON 응답을 받았는가"만으로 이미 구분할 수 있기 때문
// (설계 문서 3-4 결론). ok:false로 오는 에러 코드는 전부 "시트에 쓰기 전에 걸린" 사전 실패이고,
// 응답 자체를 못 받은 경우(타임아웃/5xx/네트워크 예외)만 클라이언트가 애매한 실패로 판단한다.
//
// [idempotency, 설계 문서 4번] withIdempotency()가 postCommentAction_ 전체(권한 검증 포함)를
// 감싼다 — Code.gs 디스패처가 handlePostComment_ 전체를 withIdempotency_로 감싸는 것과 동일
// (197행). 즉 같은 idempotencyKey로 재요청하면, 최초 실행이 검증 에러(MISSING_FIELDS 등)로
// 끝났어도 재검증 없이 그 에러를 그대로 캐시에서 돌려준다 — Code.gs와 동일한 동작.
exports.postCommentTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, postId, itemId, content, parentCommentId, idempotencyKey } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);

    // authenticateRequest_의 findUser_ 실패(Code.gs 187~190행, UNAUTHORIZED)에 대응 — 다른
    // *Test 함수들과 동일하게 세션 인증 자체와는 별개로, 세션의 이메일이 실제 사용자팀마스터에
    // 있는지 여기서 확인한다(withIdempotency로 감싸지 않는 부분 — Code.gs도 이 확인은
    // 디스패처의 switch 진입 전에 하고, withIdempotency_는 handlePostComment_ 호출만 감싼다).
    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const result = await withIdempotency(firestore, idempotencyKey, 'postComment', async function () {
      return postCommentAction_(viewer, allUsers, allPosts, allItems, allComments, settings, {
        postId: postId, itemId: itemId, content: content, parentCommentId: parentCommentId
      });
    });

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// Code.gs isManagerForItem_(2228~2234행) 포팅. Code.gs는 getItemById_로 품목마스터를 다시
// 읽지만, 여기서는 postCommentTest가 이미 batchGet으로 받아온 allItems 배열에서 조회한다
// (다른 *Test 함수들이 fresh read 대신 배치 결과를 재사용하는 것과 동일한 패턴). manager 이름
// 비교(trim), post.materialName이 item.materials에 포함되는지(indexOf) — Code.gs와 동일.
function isManagerForItem_(viewer, itemId, post, allItems) {
  const item = allItems.find(function (it) { return String(it.itemId).trim() === String(itemId).trim(); });
  if (!item) return false;
  if (String(item.manager).trim() !== String(viewer.name).trim()) return false;
  if (post && String(item.materials || '').indexOf(post.materialName) === -1) return false;
  return true;
}

// Code.gs appendComment_(2180~2184행) 대응. Sheets API values:append로 '댓글' 시트에 한 행
// 추가한다. markThreadSeenAction_과 동일한 최소 권한 원칙에 따라, 이 함수 안에서만 쓰기
// 스코프(spreadsheets, 읽기+쓰기)의 GoogleAuth를 새로 만든다 — 다른 모든 함수(lib/sheetsClient.js
// 공유 클라이언트 포함)는 여전히 spreadsheets.readonly만 쓴다.
async function appendCommentRow_(row) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const appendRange = encodeURIComponent(SHEET_COMMENT_NAME + '!A:I');
  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  await client.request({ url: appendUrl, method: 'POST', data: { values: [row] } });
}

// [2026-08-21 수정] Code.gs의 appendComment_는 실제 Date 객체를 시트에 써서(sheet.appendRow의
// 마지막 인자가 new Date()) 진짜 날짜형 셀이 되는데, 처음 구현에서는 이 함수가 ISO 문자열
// (new Date().toISOString())을 그대로 써서 문자(텍스트)형 셀이 되는 실수가 있었다. 이번에
// lib/feedEngine.js의 sheetSerialToMs(시트 시리얼 -> UTC ms, 25~30행)의 정확한 역함수를 만들어,
// Apps Script가 실제로 만드는 것과 같은 시트 시리얼 "숫자"를 계산해서 쓴다 — 그래야 이 셀이
// 기존 행들과 동일하게 숫자(날짜)형 셀이 되고, 이후 getCommentsTest/getFeedTest/pollSignalTest가
// UNFORMATTED_VALUE로 다시 읽었을 때도 기존 행과 같은 숫자 형태로 돌아온다.
// (feedEngine.js는 이 오프셋 상수를 export하지 않아 값(서울=UTC+9, DST 없음)만 그대로
// 복사해 둔다 — feedEngine.js의 SPREADSHEET_UTC_OFFSET_MS가 바뀌면 이 값도 함께 바꿔야 한다.
// 이 상수/함수는 postCommentAction_ 전용이며 다른 함수에는 쓰지 않는다.)
const POSTCOMMENT_SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul, DST 없음
function msToSheetSerial_(ms) {
  return (ms + POSTCOMMENT_SPREADSHEET_UTC_OFFSET_MS) / 86400000 + 25569;
}

// Code.gs handlePostComment_(2269~2370행)의 검증 + 작성 + 응답 재계산 로직 포팅.
// withIdempotency()가 이 함수 전체를 감싸므로(위 exports.postCommentTest 주석 참고), 여기서
// 반환하는 에러 응답도 그대로 idempotency 캐시에 남는다 — Code.gs와 동일한 동작.
//
// [설계 문서 2-2/2-3 결론] 권한 게이트(findPost_/isManagerForItem_ 대응)는 이번에 새로
// 포팅했고, updatedPost 재계산은 lib/feedEngine.js의 buildFeedEntry + lib/feedResponses.js의
// shapeEntryAsPost를 그대로 재사용한다(getFeedTest/getPostByIdTest가 이미 검증한 것과 동일한
// 함수) — 새 계산 로직을 따로 만들지 않았다.
async function postCommentAction_(viewer, allUsers, allPosts, allItems, allComments, settings, body) {
  if (viewer.role === '일반') {
    return { ok: false, error: 'FORBIDDEN_VIEWER' };
  }

  const postId = body.postId;
  const content = body.content;
  const itemId = body.itemId || '';
  const parentCommentId = body.parentCommentId || '';

  if (!postId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const post = allPosts.find(function (p) { return String(p.id).trim() === String(postId).trim(); });
  if (!post) {
    return { ok: false, error: 'POST_NOT_FOUND' };
  }

  const existingForPost = allComments.filter(function (c) { return String(c.postId).trim() === String(postId).trim(); });

  if (itemId) {
    const existingForItem = existingForPost.filter(function (c) { return String(c.itemId) === String(itemId); });

    if (existingForItem.length === 0) {
      if (viewer.role !== '담당') {
        return { ok: false, error: 'FIRST_COMMENT_MANAGER_ONLY' };
      }
      if (!isManagerForItem_(viewer, itemId, post, allItems)) {
        return { ok: false, error: 'NOT_ASSIGNED_MANAGER' };
      }
      if (parentCommentId) {
        return { ok: false, error: 'FIRST_COMMENT_CANNOT_HAVE_PARENT' };
      }
    } else if (parentCommentId) {
      const parentExists = existingForPost.some(function (c) { return String(c.commentId) === String(parentCommentId); });
      if (!parentExists) {
        return { ok: false, error: 'PARENT_COMMENT_NOT_FOUND' };
      }
    }
  } else {
    if (existingForPost.length === 0) {
      return { ok: false, error: 'NO_CONFIRMED_ITEM_YET' };
    }
    if (parentCommentId) {
      const parentExists = existingForPost.some(function (c) { return String(c.commentId) === String(parentCommentId); });
      if (!parentExists) {
        return { ok: false, error: 'PARENT_COMMENT_NOT_FOUND' };
      }
    }
  }

  const commentId = crypto.randomUUID();
  // [2026-08-21 수정] ISO 문자열 대신 Apps Script의 new Date()와 동일한 의미를 갖는 시트
  // 시리얼 번호로 써서, 실제 날짜형 셀이 되도록 한다(위 msToSheetSerial_ 주석 참고).
  const createdAtSerial = msToSheetSerial_(Date.now());
  await appendCommentRow_([commentId, postId, itemId, viewer.email, viewer.name, viewer.role, parentCommentId, content, createdAtSerial]);

  // Code.gs 2331~2369행과 동일한 절차: 갱신된 댓글 목록 + 이 게시물의 최신 buildFeedEntry_
  // 결과를 함께 반환. lib/feedEngine.js/lib/feedResponses.js를 그대로 재사용(신규 계산 없음).
  // createdAtRaw도 시트에서 UNFORMATTED_VALUE로 읽었을 때와 같은 "숫자" 형태(createdAtSerial)로
  // 넣는다 — sheetSerialToMs가 다른 기존 댓글(숫자)과 정확히 같은 분기(숫자 처리)를 타게 하기
  // 위함이다(ISO 문자열도 sheetSerialToMs의 문자열 분기에서 결과적으로는 올바른 UTC ms를
  // 계산해내지만, 굳이 다른 분기를 타게 두지 않고 기존 댓글과 완전히 같은 형태로 통일한다).
  const newComment = {
    commentId: commentId, postId: postId, itemId: itemId, authorEmail: viewer.email,
    authorName: viewer.name, authorRole: viewer.role, parentCommentId: parentCommentId,
    content: content, createdAtRaw: createdAtSerial
  };
  const updatedAllComments = allComments.concat([newComment]);

  const leadScope = settings['팀장_열람범위'] || null;
  const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
  const visibleComments = feedEngine.visibleCommentsForPost(updatedAllComments, postId, viewer.role, viewer.team, leadScope, teamByEmail);
  const commentsResp = feedResponses.buildGetCommentsResponse(visibleComments);

  const commentsByPost = feedEngine.groupCommentsByPost(updatedAllComments);
  const entry = feedEngine.buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail);
  const updatedPost = entry ? feedResponses.shapeEntryAsPost(entry) : null;

  return { ok: true, commentId: commentId, comments: commentsResp.comments, updatedPost: updatedPost };
}

// ---------------------------------------------------------------------------
// POST /loginTest (login 3단계 — 코드 구현만, 아직 미배포/미연결)
// 승인 경로: LOGIN_WHOAMI_MIGRATION_PLAN.md(1·2단계, 완료) -> NEXT_PHASE_ANALYSIS_2026-08-21.md
// (3단계 재검토) -> LOGIN_CLOUDRUN_DESIGN.md(설계 확정 승인) -> LOGIN_CLOUDRUN_IMPL_PLAN.md
// (파일/함수 단위 계획 승인) -> 이번 코드 구현 승인(2026-08-21). 다음 단계(별도 승인 필요):
// 로컬 parity 테스트 -> GitHub 커밋 -> Cloud Run 배포 -> feed.html/index.html 연결(이번
// 범위 아님 — 로그인 폼 배선은 3단계 설계 문서가 별도로 다룸).
//
// [권한] 이 함수만 쓰기 스코프(spreadsheets, 읽기+쓰기)를 쓴다 — markThreadSeenTest/
// postCommentTest와 동일한 최소 권한 원칙. 정확히는 updateLoginFailCountCell_ 하나만
// 이 스코프를 새로 만들고(사용자팀마스터 H열 한 칸만 쓴다), 사용자/설정 조회는 기존
// getSheetsClient()(읽기 전용, lib/sheetsClient.js — 수정 없이 재사용)를 그대로 쓴다.
//
// [세션] login은 기존 세션을 검증하는 쪽이 아니라 새로 발급하는 쪽이라, authenticateSession
// (lib/auth.js, 수정 없이 재사용 대상이지만 이 함수는 아예 호출하지 않음)을 쓰지 않는다 —
// 다른 모든 세션-소비 함수와 구조적으로 다른 지점.
//
// [Split-brain 방지, LOGIN_CLOUDRUN_DESIGN.md 4번] postComment와 달리 실패 시에도 Apps
// Script로 넘기지 않는다(실패 자체가 failCount 증가라는 부작용을 가지므로, 두 백엔드가
// 각자 처리하면 이중 카운트 위험). idempotencyKey + withIdempotency(lib/writeIdempotency.js,
// 수정 없이 재사용)로 "같은 시도의 재시도" 중복 쓰기를 막는다 — 이 함수 자체는 한 번
// 요청받으면 한 번 처리할 뿐이고, 애매한 실패 시 같은 키로 재시도할지는 호출부(이번 범위
// 아님)가 결정한다.
const LOGIN_LOCK_STALE_MS = 10000; // 10초 — 죽은 락(크래시 등으로 해제 안 됨) 자가 회수 기준
const LOGIN_LOCK_WAIT_MS = 3000;   // 최대 3초 대기
const LOGIN_LOCK_POLL_MS = 200;    // 200ms 간격으로 재확인

// LOGIN_CLOUDRUN_DESIGN.md 7-2/7-3: "이 이메일에 대한 로그인 시도"를 Firestore 문서
// loginLocks/{email}로 표현하는 분산 락. Firestore 트랜잭션은 이 락 문서 자체(Firestore
// 네이티브 데이터)에만 원자성을 보장한다 — failCount의 실제 값은 Sheets 셀에 있어서 이
// 트랜잭션이 "Sheets 읽기 -> 계산 -> 쓰기" 구간까지 원자화하지는 못한다. 대신 이 락이 그
// 구간을 "한 번에 한 요청만" 실행하도록 직렬화해서 같은 효과를 낸다(idempotencyKey/
// withIdempotency와는 다른 메커니즘 — 그건 "같은 시도의 재시도"를, 이건 "다른 시도끼리의
// 동시 실행"을 다룬다).
//
// [알려진 한계, 미리 밝혀둠] 같은 idempotencyKey의 재시도가 원본 요청이 아직 처리 중일 때
// 도착하면, withIdempotency의 IN_PROGRESS 폴링에 도달하기 전에 이 락에서 먼저 대기/실패할
// 수 있다(LOGIN_BUSY_RETRY). login 처리 시간이 보통 1초 안팎이고 클라이언트 재시도는
// 응답 타임아웃(초 단위) 이후에만 발생하므로 실제로는 드문 경합이며, 이 경우에도 이중
// 실행은 발생하지 않는다(실패로 끝날 뿐 — 안전한 방향의 트레이드오프).
async function acquireLoginLock_(email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  const deadline = Date.now() + LOGIN_LOCK_WAIT_MS;
  for (;;) {
    const acquired = await firestore.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (snap.exists) {
        const lockedAtRaw = snap.data().lockedAt;
        // 실제 Firestore는 Date를 Timestamp로 저장/반환하지만(lib/auth.js의
        // authenticateSession과 동일한 방어), 로컬 parity 테스트의 fake_firestore.js는
        // 그냥 JS Date를 그대로 돌려주므로 두 경우 모두 처리한다.
        const lockedAt = (lockedAtRaw && lockedAtRaw.toMillis) ? lockedAtRaw.toMillis() : new Date(lockedAtRaw).getTime();
        if (now - lockedAt < LOGIN_LOCK_STALE_MS) {
          return false; // 다른 요청이 아직 유효한 락을 쥐고 있음
        }
        // LOGIN_LOCK_STALE_MS보다 오래된 락은 죽은 락으로 간주하고 뺏어옴(자가 복구)
      }
      tx.set(ref, { lockedAt: new Date(now), holderId: holderId });
      return true;
    });
    if (acquired) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(function (resolve) { setTimeout(resolve, LOGIN_LOCK_POLL_MS); });
  }
}

async function releaseLoginLock_(email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  try {
    const snap = await ref.get();
    if (snap.exists && snap.data().holderId === holderId) {
      await ref.delete(); // 내가 잡은 락일 때만 해제(다른 요청의 락을 실수로 지우지 않음)
    }
  } catch (e) {
    console.error('releaseLoginLock_ 실패(무시, ' + LOGIN_LOCK_STALE_MS + 'ms 뒤 자동 회수됨): ' + e);
  }
}

// Code.gs의 hashPassword_(331~335행)를 Node 표준 crypto로 이식. 신규 npm 의존성 없음
// (crypto는 파일 상단에서 이미 require됨 — postComment의 commentId 생성용으로 먼저 추가됨).
function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

// markThreadSeenAction_/appendCommentRow_과 동일한 최소 권한 원칙: 이 함수 안에서만
// 쓰기 스코프(spreadsheets, 읽기+쓰기)의 GoogleAuth를 새로 만든다. 사용자팀마스터 시트의
// H열(로그인실패횟수) 한 칸만 쓴다 — rowIndex는 LOGIN_USER_RANGE(A2:I) 기준 0-indexed
// 행 위치이며, 실제 시트 행 번호는 rowIndex + 2이다.
async function updateLoginFailCountCell_(rowIndex, value) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const client = await auth.getClient();
  const sheetRow = rowIndex + 2;
  const cellRange = encodeURIComponent(SHEET_USER_NAME + '!H' + sheetRow);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${cellRange}?valueInputOption=RAW`;
  await client.request({ url: url, method: 'PUT', data: { values: [[value]] } });
}

// 사용자팀마스터 !A2:I — 이미 존재하는 USER_DATA_RANGE(whoamiTest 등이 씀)를 그대로 재사용.
// login에는 whoamiTest가 안 쓰는 passwordHash(G)/failCount(H)/passwordChangedAt(I)도 필요해서,
// lib/sheetsClient.js의 rowsToUsers()(6개 필드만 매핑)는 쓰지 않고 이 파일 안에서 직접
// row를 읽는다(아래 loginAction_ 참고) — lib/sheetsClient.js는 수정하지 않는다.
const LOGIN_BATCH_RANGES = [USER_DATA_RANGE, SETTINGS_RANGE];

// Code.gs handleLogin_(231~293행)의 검증 체인 포팅. withIdempotency()가 이 함수 전체를
// 감싸므로(아래 exports.loginTest 참고), 실패 응답(WRONG_PASSWORD 등)도 그대로 idempotency
// 캐시에 남는다 — 같은 idempotencyKey로 재시도하면 failCount를 다시 건드리지 않고 캐시된
// 응답을 그대로 돌려받는다(postComment/markThreadSeen과 동일한 보장).
async function loginAction_(email, password, userRows, settings) {
  if (!email || !password) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let userRowIndex = -1;
  let user = null;
  for (let i = 0; i < userRows.length; i++) {
    const row = userRows[i];
    if (String(row[0] || '').trim().toLowerCase() === normalizedEmail) {
      userRowIndex = i;
      user = {
        email: row[0], name: row[1], role: row[2], team: row[3], status: row[4],
        passwordHash: row[6] || null, failCount: Number(row[7]) || 0, passwordChangedAtRaw: row[8]
      };
      break;
    }
  }
  if (!user) {
    return { ok: false, error: 'USER_NOT_FOUND' };
  }
  if (user.status !== '활성') {
    return { ok: false, error: 'USER_INACTIVE' };
  }
  if (user.failCount >= 5) {
    return { ok: false, error: 'ACCOUNT_LOCKED' };
  }

  const computedHash = hashPassword_(password, email);
  if (!user.passwordHash || user.passwordHash !== computedHash) {
    await updateLoginFailCountCell_(userRowIndex, user.failCount + 1);
    return { ok: false, error: 'WRONG_PASSWORD' };
  }

  await updateLoginFailCountCell_(userRowIndex, 0);

  const sessionToken = crypto.randomUUID();
  const now = Date.now();
  // sessionSyncTest/Apps Script 로그인이 만드는 것과 동일한 필드 구조(email/createdAt/
  // expiresAt) — 다른 Cloud Run 함수들이 그대로 이 문서를 조회할 수 있어야 한다(2026-08-21
  // 사용자 요청으로 명시 확인됨). sessionSyncTest를 거치는 간접 경로 대신, 이미 Firestore
  // 클라이언트를 갖고 있으므로 직접 쓴다(불필요한 내부 HTTP 호출 한 단계 제거).
  await firestore.collection('sessions').doc(sessionToken).set({
    email: email,
    createdAt: new Date(now),
    expiresAt: new Date(now + SESSION_TTL_MS)
  });

  // [날짜 처리 주의] passwordChangedAt(I열)이 실제 날짜형 셀이면 UNFORMATTED_VALUE로 시트
  // 시리얼 넘버가 온다(Apps Script의 new Date(user.passwordChangedAt)은 SpreadsheetApp이
  // 이미 Date 객체로 반환해주므로 이 변환이 필요 없음 — Cloud Run만 필요). postComment 때
  // 발견된 것과 같은 종류의 함정을 피하기 위해, 새로 계산하지 않고 이미 검증된
  // lib/feedEngine.js의 sheetSerialToMs를 그대로 재사용한다(서울 UTC+9 보정 포함).
  const changedAtMs = feedEngine.sheetSerialToMs(user.passwordChangedAtRaw);
  const daysSincePwChange = changedAtMs !== null ? (now - changedAtMs) / 86400000 : Infinity;
  const expireDays = Number(settings['비밀번호만료일수']) || 90;
  const passwordExpired = daysSincePwChange > expireDays;

  return {
    ok: true,
    sessionToken: sessionToken,
    email: email,
    name: user.name,
    role: user.role,
    team: user.team,
    passwordExpired: passwordExpired
  };
}

exports.loginTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { email, password, idempotencyKey } = req.body || {};
    if (!idempotencyKey) {
      const serverMs = Date.now() - t0;
      res.status(400).json({ ok: false, serverMs, error: 'MISSING_IDEMPOTENCY_KEY' });
      return;
    }

    const timings = {};
    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, LOGIN_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;
    const userRows = (valueRanges[0] && valueRanges[0].values) || [];
    const settings = parseSettings((valueRanges[1] && valueRanges[1].values) || []);

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const holderId = crypto.randomUUID();
    let locked = true;
    const l0 = Date.now();
    if (normalizedEmail) {
      locked = await acquireLoginLock_(normalizedEmail, holderId);
    }
    timings.lockMs = Date.now() - l0;
    if (!locked) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'LOGIN_BUSY_RETRY' });
      return;
    }

    try {
      const result = await withIdempotency(firestore, idempotencyKey, 'login', async function () {
        return loginAction_(email, password, userRows, settings);
      });
      const serverMs = Date.now() - t0;
      res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
    } finally {
      if (normalizedEmail) {
        await releaseLoginLock_(normalizedEmail, holderId);
      }
    }
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /getItemsTest, POST /getCustomersTest (품목 관리 페이지 읽기 1단계 — 코드 구현만,
// 아직 미배포/미연결)
// 승인 경로: 2026-08-25 채팅에서 분석/계획 승인(읽기 2개를 먼저, 댓글 수정/삭제, upsertItem
// 순서로 진행하기로 합의). 다음 단계(별도 승인 필요): parity 테스트 -> GitHub 커밋 ->
// Cloud Run 배포 -> feed.html 연결(getComments/getFeed와 동일한 "1회 시도 실패 시 조용히
// Apps Script로 폴백" 읽기 정책).
//
// [재사용] 세션 인증은 lib/auth.js, 시트 읽기는 lib/sheetsClient.js(rowsToUsers/rowsToItems/
// parseSettings — 전부 기존 함수, 이번에 수정 없음)를 그대로 쓴다. 품목마스터 범위(POLL_ITEM_RANGE)도
// pollSignalTest/postCommentTest가 이미 쓰는 것과 동일한 상수를 그대로 재사용한다. 새로
// 추가한 건 고객사마스터 범위(CUSTOMER_DATA_RANGE)와 그 행 변환 함수(lib/sheetsClient.js의
// rowsToCustomers, 순수 추가) 하나뿐이다.
//
// [권한] 둘 다 읽기 전용(spreadsheets.readonly)만 쓴다 — 쓰기 스코프를 새로 만들지 않았다.
//
// [2026-08-26 버그 수정] 초기 구현에서 getItemsTest 안에서 ADMIN_EMAIL을 참조하면서 정작
// 이 파일에는 그 상수를 선언하지 않아, 실제로 호출하면 매번 "ADMIN_EMAIL is not defined"
// ReferenceError로 500이 나는 상태로 커밋되어 있었다(로컬 스텁 테스트로 재현 확인). parity
// 테스트는 apps_script_ref.js/cloudrun_port.js가 각자 자기 파일에 별도로 ADMIN_EMAIL을
// 선언해 두어서 이 누락을 잡아내지 못했다 — index.js 자체를 실행해보지 않은 것이 원인.
// Code.gs 33행과 값이 완전히 같다.
const ADMIN_EMAIL = 'jhjoo@nkmro.com';
const SHEET_CUSTOMER_NAME = '고객사마스터'; // 고객사마스터
const CUSTOMER_DATA_RANGE = encodeURIComponent(SHEET_CUSTOMER_NAME + '!A2:C');
const ITEMS_BATCH_RANGES = [POLL_USER_RANGE, POLL_ITEM_RANGE, POLL_SETTINGS_RANGE];

// Code.gs handleGetItems_(3455~3487행) 포팅. [패리티 주의] 첫 번째 필터(!isAdmin일 때 팀
// 불일치 행 제외)와 두 번째 필터(역할별 재필터링 — 담당은 무조건, 팀장은 팀장_열람범위 설정이
// '전체'가 아닐 때만 자기 팀으로 재필터링)가 원본처럼 이중으로 겹쳐 있다 — 겉보기엔 중복 같지만
// isAdmin이면서 role이 '담당'인 경우 등 실제로 결과가 달라지는 조합이 있어(예: isAdmin=true,
// role='담당'이면 첫 필터는 건너뛰지만 두 번째 필터가 다시 자기 팀으로 좁힘), 하나로 합치지
// 않고 원본 두 단계 구조를 그대로 옮겼다. 빈 itemId 행 제외(Code.gs의 `if (!row[0]) continue`)도
// rowsToItems가 String(row[0])으로 항상 문자열을 만들어버리는 것(빈 값도 "undefined"가 될 위험)을
// 피하기 위해, 매핑 전 원본 행 배열에서 먼저 걸러낸다.
exports.getItemsTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, ITEMS_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const rawItemRows = (valueRanges[1] && valueRanges[1].values) || [];
    const allItems = rowsToItems(rawItemRows.filter(function (row) { return !!row[0]; }));
    const settings = parseSettings((valueRanges[2] && valueRanges[2].values) || []);

    const viewer = allUsers.find(function (u) {
      return String(u.email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
    });
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }
    if (viewer.role !== '팀장' && viewer.role !== '담당') {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN' });
      return;
    }

    const isAdmin = String(viewer.email).trim().toLowerCase() === ADMIN_EMAIL;
    const items = [];
    allItems.forEach(function (it) {
      if (!isAdmin && String(it.team).trim() !== String(viewer.team).trim()) return;
      items.push({
        itemId: it.itemId, customer: it.customer, itemName: it.itemName, manager: it.manager,
        team: it.team, materials: it.materials, status: it.status
      });
    });

    let resultItems = items;
    if (viewer.role === '담당') {
      resultItems = items.filter(function (it) { return it.team === viewer.team; });
    } else if (viewer.role === '팀장') {
      const scope = settings['팀장_열람범위']; // 팀장_열람범위
      if (scope !== '전체') { // 전체
        resultItems = items.filter(function (it) { return it.team === viewer.team; });
      }
    }

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, items: resultItems });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// Code.gs handleGetCustomers_(3488~3501행) 포팅. [패리티 주의] 빈 행 제외 기준이 getItems와
// 다르다 — Code.gs가 `if (!row[1]) continue`(B열=name 기준, A열=code가 아님)를 쓰므로 여기서도
// 그대로 row[1] 기준으로 원본 행을 먼저 걸러낸다.
exports.getCustomersTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, [POLL_USER_RANGE, CUSTOMER_DATA_RANGE], { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const viewer = allUsers.find(function (u) {
      return String(u.email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
    });
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }
    if (viewer.role !== '팀장') {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN' });
      return;
    }

    const rawCustomerRows = (valueRanges[1] && valueRanges[1].values) || [];
    const customers = rowsToCustomers(rawCustomerRows.filter(function (row) { return !!row[1]; }));

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, customers: customers });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /getUsersTest (사용자 현황 페이지 읽기, Track B — 코드 구현만, 아직 미배포/미연결)
// 승인 경로: 2026-08-27 채팅에서 분석/설계 계획 승인 -> 이번 코드 구현 승인. 다음 단계
// (별도 승인 필요): parity 테스트 -> GitHub 커밋 -> Cloud Run 배포 -> feed.html 연결
// (getItems/getCustomers와 동일한 "1회 시도 실패 시 조용히 Apps Script로 폴백" 읽기 정책).
//
// [재사용] 세션 인증은 lib/auth.js, 시트 읽기는 lib/sheetsClient.js(getSheetsClient/
// batchGetValues/rowsToUsers — 전부 기존 함수, 이번에 수정 없음)를 그대로 쓴다. 새 range
// 상수도 필요 없다 — 기존 POLL_USER_RANGE(사용자팀마스터!A2:I) 하나만 읽으면 된다.
//
// [권한] Code.gs handleGetUsers_(3343~3364행) 포팅. isAdmin(ADMIN_EMAIL 본인)이거나
// role이 '담당'/'팀장'이면 호출 자체는 허용(FORBIDDEN 아님). admin이 아니면 결과가 자기
// 팀으로 좁혀진다. role이 '일반'/'임원'이면(admin 아닌 한) FORBIDDEN — settings 의존 없음
// (getItems의 팀장_열람범위 같은 2차 재필터가 원본에 없음, 그대로 옮김).
//
// [권한 범위] 읽기 전용(spreadsheets.readonly)만 쓴다 — 쓰기 스코프를 새로 만들지 않았다.
//
// [row 번호] Code.gs는 헤더 포함 배열을 i=1부터 순회하며 row: i+1을 반환한다. 여기서는
// POLL_USER_RANGE가 A2부터 시작(헤더 제외)하므로, 배열 인덱스 j에 대응하는 실제 시트 행
// 번호는 j+2다(j=0 -> 시트 2행, Code.gs의 i=1 -> row=2와 동일한 결과). rowsToUsers()는
// row 번호를 넣어주지 않으므로, viewer(호출자 본인) 조회에는 rowsToUsers()를 그대로 쓰고,
// 응답에 넣을 사용자 목록은 원본 행 배열(rawUserRows)을 직접 순회해 만든다 — rowsToUsers()
// 자체는 건드리지 않는다(다른 배포된 함수들이 그대로 쓰고 있음).
exports.getUsersTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, [POLL_USER_RANGE], { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const rawUserRows = (valueRanges[0] && valueRanges[0].values) || [];
    const allUsers = rowsToUsers(rawUserRows);
    const viewer = allUsers.find(function (u) {
      return String(u.email || '').trim().toLowerCase() === String(email).trim().toLowerCase();
    });
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const isAdmin = String(viewer.email).trim().toLowerCase() === ADMIN_EMAIL;
    const isScopedRole = (viewer.role === '담당' || viewer.role === '팀장');
    if (!isAdmin && !isScopedRole) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN' });
      return;
    }

    const users = [];
    for (let i = 0; i < rawUserRows.length; i++) {
      const row = rawUserRows[i];
      if (!row[0]) continue;
      if (!isAdmin && String(row[3]).trim() !== String(viewer.team).trim()) continue;
      users.push({ row: i + 2, email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] });
    }

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, timings, users: users });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// ---------------------------------------------------------------------------
// POST /updateCommentTest, POST /deleteCommentTest (댓글 수정/삭제 이전 2단계 — 코드 구현만,
// 아직 미배포/미연결)
// 승인 경로: 2026-08-25 채팅에서 분석/계획 승인(1순위 읽기 2개 다음으로 댓글 수정/삭제,
// upsertItem 순서로 진행하기로 합의) -> 2026-08-26 이번 코드 구현 승인. 다음 단계(별도 승인
// 필요): parity 테스트 -> GitHub 커밋 -> Cloud Run 배포 -> feed.html 연결(postComment와
// 동일한 "1회 시도 + 같은 idempotencyKey로 재시도, 그래도 애매하면 폴백 없이 에러" 쓰기 정책).
//
// [재사용] 세션 인증(lib/auth.js), 초기 조회(lib/sheetsClient.js — allUsers/allPosts/allItems/
// settings), updatedPost 재계산(lib/feedEngine.js/lib/feedResponses.js), idempotency
// (lib/writeIdempotency.js)까지 postCommentTest와 완전히 동일한 기존 모듈을 그대로 재사용한다.
//
// [parity 주의 — fresh read, 2026-08-25 채팅에서 결정] Code.gs의 handleUpdateComment_/
// handleDeleteComment_(2446~2510행)는 각자 sheet.getDataRange()/getRange().getValues()로
// "그 요청 시점의" 댓글 시트를 직접 다시 읽어서 대상 행을 찾는다 — 요청 앞부분에서 이미
// 읽어둔 배열을 재사용하지 않는다. 이 파일도 동일하게, 요청 맨 앞 batchGet(allUsers/allPosts/
// allItems/settings)과는 별도로, 댓글 시트만 withIdempotency() 안(실제 쓰기 직전)에서 매번
// 새로 GET한다 — 앞선 배치의 댓글 스냅샷은 두 함수 다 아예 쓰지 않는다.
//
// [락 없음, 2026-08-25 채팅에서 결정] Code.gs 원본에도 이 두 핸들러에는 LockService가 없다
// (upsertItem만 있음) — 패리티 우선으로 이번에도 새 락을 추가하지 않는다.
//
// [권한] 둘 다 쓰기 스코프(spreadsheets, 읽기+쓰기)를 쓴다 — postCommentTest/
// markThreadSeenTest와 동일한 최소 권한 원칙에 따라, 이 두 함수 전용 헬퍼
// (getCommentWriteClient_) 안에서만 새로 만든다. 초기 조회(getSheetsClient, allUsers/
// allPosts/allItems/settings)는 여전히 기존 읽기 전용 공유 클라이언트를 그대로 쓴다.
const UPDATE_DELETE_COMMENT_BATCH_RANGES = [POLL_USER_RANGE, POLL_POST_RANGE, POLL_ITEM_RANGE, POLL_SETTINGS_RANGE];

exports.updateCommentTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, commentId, content, idempotencyKey } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, UPDATE_DELETE_COMMENT_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const settings = parseSettings((valueRanges[3] && valueRanges[3].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const result = await withIdempotency(firestore, idempotencyKey, 'updateComment', async function () {
      return updateCommentAction_(viewer, allUsers, allPosts, allItems, settings, { commentId: commentId, content: content });
    });

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

exports.deleteCommentTest = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const t0 = Date.now();
  try {
    const { sessionToken, commentId, idempotencyKey } = req.body || {};
    const auth = await authenticateSession(firestore, sessionToken);
    if (!auth.ok) {
      const serverMs = Date.now() - t0;
      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
      return;
    }
    const timings = Object.assign({}, auth.timings);
    const email = auth.email;

    const u0 = Date.now();
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, UPDATE_DELETE_COMMENT_BATCH_RANGES, { unformatted: true });
    timings.sheetMs = Date.now() - u0;

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const settings = parseSettings((valueRanges[3] && valueRanges[3].values) || []);

    const viewer = feedEngine.findViewer(allUsers, email);
    if (!viewer) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }

    const result = await withIdempotency(firestore, idempotencyKey, 'deleteComment', async function () {
      return deleteCommentAction_(viewer, allUsers, allPosts, allItems, settings, { commentId: commentId });
    });

    const serverMs = Date.now() - t0;
    res.status(200).json(Object.assign({ serverMs: serverMs, timings: timings }, result));
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};

// updateComment/deleteComment 전용 쓰기 클라이언트. appendCommentRow_/markThreadSeenAction_과
// 동일한 최소 권한 원칙 — 이 함수 안에서만 쓰기 스코프(spreadsheets, 읽기+쓰기)의 GoogleAuth를
// 새로 만든다.
async function getCommentWriteClient_() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return auth.getClient();
}

// 댓글 시트(POLL_COMMENT_RANGE, 헤더 제외 A2:I)를 지금 이 순간 값으로 다시 읽는다 — Code.gs
// handleUpdateComment_/handleDeleteComment_가 매번 sheet.getDataRange()로 직접 다시 읽는 것과
// 동일한 "fresh read"를 재현하기 위함(요청 맨 앞의 batchGet 스냅샷을 쓰지 않음). UNFORMATTED_VALUE로
// 받아서 날짜(createdAt) 열의 시트 시리얼 숫자를 그대로 보존한다 — FORMATTED_VALUE로 받으면
// 문자열이 되어, deleteComment가 그대로 다시 써넣을 때(재기록) 날짜 셀이 텍스트 셀로 망가진다.
async function getFreshCommentRows_(client) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${POLL_COMMENT_RANGE}?valueRenderOption=UNFORMATTED_VALUE`;
  const resp = await client.request({ url });
  return (resp.data && resp.data.values) || [];
}

// updateComment/deleteComment 둘 다 마지막에 필요한 "갱신된 댓글 목록 + 최신 buildFeedEntry_"
// 응답을 만든다. postCommentAction_이 이미 검증한 lib/feedEngine.js/lib/feedResponses.js
// 조합을 그대로 재사용 — Code.gs의 buildCommentUpdateResponse_(2402~2441행)에 대응(반환 모양도
// {comments, updatedPost}로 동일하고 commentId는 넣지 않는다 — postComment 응답과 다른 점).
function buildCommentUpdateResponse_(viewer, allUsers, allPosts, allItems, settings, updatedAllComments, postId) {
  const post = allPosts.find(function (p) { return String(p.id).trim() === String(postId).trim(); });
  const leadScope = settings['팀장_열람범위'] || null;
  const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
  const visibleComments = feedEngine.visibleCommentsForPost(updatedAllComments, postId, viewer.role, viewer.team, leadScope, teamByEmail);
  const commentsResp = feedResponses.buildGetCommentsResponse(visibleComments);

  const commentsByPost = feedEngine.groupCommentsByPost(updatedAllComments);
  const entry = post ? feedEngine.buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail) : null;
  const updatedPost = entry ? feedResponses.shapeEntryAsPost(entry) : null;

  return { comments: commentsResp.comments, updatedPost: updatedPost };
}

// Code.gs handleUpdateComment_(2446~2467행) 포팅. 본인이 작성한 댓글만 수정 가능, 내용(H열)만
// 바꾸고 작성자/시각 등은 그대로 둔다. withIdempotency()가 이 함수 전체를 감싸므로(위
// exports.updateCommentTest 주석 참고), 여기서 반환하는 에러 응답도 그대로 idempotency
// 캐시에 남는다 — Code.gs와 동일한 동작.
async function updateCommentAction_(viewer, allUsers, allPosts, allItems, settings, body) {
  const commentId = body.commentId;
  const content = String(body.content || '').trim();
  if (!commentId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const client = await getCommentWriteClient_();
  const rows = await getFreshCommentRows_(client); // 헤더 제외, A2:I부터(index 0 == 시트 2행)

  let targetIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(commentId)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }
  if (String(rows[targetIndex][3]).trim().toLowerCase() !== String(viewer.email).trim().toLowerCase()) {
    return { ok: false, error: 'FORBIDDEN_NOT_AUTHOR' };
  }

  const postId = rows[targetIndex][1];
  const sheetRow = targetIndex + 2; // A2:I 기준이라 실제 시트 행 = index + 2
  const updateRange = encodeURIComponent(SHEET_COMMENT_NAME + '!H' + sheetRow);
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${updateRange}?valueInputOption=RAW`;
  await client.request({ url: updateUrl, method: 'PUT', data: { values: [[content]] } });

  // 방금 성공한 쓰기를 메모리상의 rows에도 그대로 반영해, 재조회 없이 최신 상태로
  // buildCommentUpdateResponse_에 넘긴다 — Code.gs가 invalidateSheetCache_ 후 getAllComments_()로
  // 다시 읽는 것과 최종적으로 같은 값이 된다(같은 요청 안에서 다른 동시 쓰기가 없다고 가정).
  rows[targetIndex][7] = content;

  const updatedAllComments = rowsToComments(rows);
  return Object.assign({ ok: true }, buildCommentUpdateResponse_(viewer, allUsers, allPosts, allItems, settings, updatedAllComments, postId));
}

// Code.gs handleDeleteComment_(2476~2510행) 포팅. 본인이 작성한 댓글만 삭제 가능. 원본과
// 동일하게 대상 행을 뺀 나머지를 위로 당겨 다시 쓰고(kept), 밀려서 남는 마지막 1행(항상
// 정확히 1행 — 한 번에 댓글 1개만 지운다)을 비운다(Code.gs의 setValues + clearContent 2단계에
// 대응 — 여기서는 values PUT + values:clear).
async function deleteCommentAction_(viewer, allUsers, allPosts, allItems, settings, body) {
  const commentId = body.commentId;
  if (!commentId) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const client = await getCommentWriteClient_();
  const rows = await getFreshCommentRows_(client); // 헤더 제외, A2:I부터(index 0 == 시트 2행)
  if (rows.length === 0) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }

  let targetIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(commentId)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }
  if (String(rows[targetIndex][3]).trim().toLowerCase() !== String(viewer.email).trim().toLowerCase()) {
    return { ok: false, error: 'FORBIDDEN_NOT_AUTHOR' };
  }

  const postId = rows[targetIndex][1];
  const kept = rows.filter(function (_, idx) { return idx !== targetIndex; });

  if (kept.length > 0) {
    const writeRange = encodeURIComponent(SHEET_COMMENT_NAME + '!A2:I' + (kept.length + 1));
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${writeRange}?valueInputOption=RAW`;
    await client.request({ url: writeUrl, method: 'PUT', data: { values: kept } });
  }
  const staleRow = rows.length + 1; // A2:I 기준이라 삭제 전 마지막 데이터 행 = rows.length + 1
  const clearRange = encodeURIComponent(SHEET_COMMENT_NAME + '!A' + staleRow + ':I' + staleRow);
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${clearRange}:clear`;
  await client.request({ url: clearUrl, method: 'POST', data: {} });

  const updatedAllComments = rowsToComments(kept);
  return Object.assign({ ok: true }, buildCommentUpdateResponse_(viewer, allUsers, allPosts, allItems, settings, updatedAllComments, postId));
}
