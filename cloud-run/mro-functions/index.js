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
      matchedRowIndex = i;
      break;
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
