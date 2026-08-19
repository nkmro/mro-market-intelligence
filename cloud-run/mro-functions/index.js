const {GoogleAuth} = require('google-auth-library');

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
const SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul = UTC+9, DST 없음
const SHEET_POST_NAME = '시황게시물';
const SHEET_ITEM_NAME = '품목마스터';
const SHEET_COMMENT_NAME = '댓글';
const POLL_USER_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:I');
const POLL_POST_RANGE = encodeURIComponent(SHEET_POST_NAME + '!A2:H');
const POLL_ITEM_RANGE = encodeURIComponent(SHEET_ITEM_NAME + '!A2:H');
const POLL_COMMENT_RANGE = encodeURIComponent(SHEET_COMMENT_NAME + '!A2:I');
const POLL_SETTINGS_RANGE = encodeURIComponent(SHEET_SETTING_NAME + '!A2:C');

// Google Sheets serial date(1899-12-30 기준, 스프레드시트 시간대(서울) 벽시계 값) -> 실제 UTC Unix ms.
// 값이 없으면 null. 문자열이 들어오는 예외 상황(혹시 셀이 텍스트로 바뀐 경우)도 방어적으로 처리한다.
function sheetSerialToMs_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round((v - 25569) * 86400000) - SPREADSHEET_UTC_OFFSET_MS;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

// Code.gs canViewComment_와 동일한 판단(팀장_열람범위 반영).
function teamScopeAllows_(role, viewerTeam, targetTeam, leadScope) {
  if (role === '임원') return true;
  if (role === '팀장') return leadScope === '전체' ? true : viewerTeam === targetTeam;
  if (role === '담당' || role === '일반') return viewerTeam === targetTeam;
  return false;
}

// Code.gs getRelatedItems_와 동일한 판단(원자재명 매칭 + 활성 + 등록일 이전 게시물 제외).
function relatedActiveItems_(post, allItems) {
  return allItems.filter(function (it) {
    const materialMatch = String(it.materials || '').indexOf(post.materialName) !== -1;
    const statusActive = it.status === '활성';
    if (!(materialMatch && statusActive)) return false;
    const registeredMs = sheetSerialToMs_(it.registeredAt);
    if (registeredMs === null) return true;
    return sheetSerialToMs_(post.createdAt) >= registeredMs;
  });
}

// Code.gs buildFeedEntry_의 품목별 요약(confirmed/commentCount/lastComment) 부분과 동일.
function summarizeItemForPost_(item, itemComments) {
  let lastComment = null;
  itemComments.forEach(function (c) {
    const cMs = sheetSerialToMs_(c.createdAt);
    const lastMs = lastComment ? sheetSerialToMs_(lastComment.createdAt) : null;
    if (!lastComment || (cMs !== null && lastMs !== null && cMs > lastMs)) lastComment = c;
  });
  return {
    itemId: item.itemId,
    manager: item.manager,
    confirmed: itemComments.length > 0,
    commentCount: itemComments.length,
    lastCommentAuthorEmail: lastComment ? lastComment.authorEmail : null,
    lastCommentAtMs: lastComment ? sheetSerialToMs_(lastComment.createdAt) : null
  };
}

// Code.gs buildFeedEntry_의 needsAttention 판단(역할별 분기)과 동일.
function needsAttentionFor_(viewer, itemSummaries, lastCheckedMs) {
  if (viewer.role === '담당') {
    return itemSummaries.some(function (s) {
      if (String(s.manager || '').trim() !== String(viewer.name || '').trim()) return false;
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && s.lastCommentAtMs !== null && s.lastCommentAtMs > lastCheckedMs;
    });
  }
  if (viewer.role === '팀장' || viewer.role === '임원') {
    return itemSummaries.some(function (s) {
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && s.lastCommentAtMs !== null && s.lastCommentAtMs > lastCheckedMs;
    });
  }
  return false;
}

exports.pollSignalTest = async (req, res) => {
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
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet` +
      `?ranges=${POLL_USER_RANGE}&ranges=${POLL_POST_RANGE}&ranges=${POLL_ITEM_RANGE}` +
      `&ranges=${POLL_COMMENT_RANGE}&ranges=${POLL_SETTINGS_RANGE}&valueRenderOption=UNFORMATTED_VALUE`;
    const resp = await client.request({ url });
    timings.sheetMs = Date.now() - u0;

    const valueRanges = (resp.data && resp.data.valueRanges) || [];
    const userRows = (valueRanges[0] && valueRanges[0].values) || [];
    const postRows = (valueRanges[1] && valueRanges[1].values) || [];
    const itemRows = (valueRanges[2] && valueRanges[2].values) || [];
    const commentRows = (valueRanges[3] && valueRanges[3].values) || [];
    const settingRows = (valueRanges[4] && valueRanges[4].values) || [];

    const meRow = userRows.find(function (r) {
      return String(r[0] || '').trim().toLowerCase() === String(email).trim().toLowerCase();
    });
    if (!meRow) {
      const serverMs = Date.now() - t0;
      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
      return;
    }
    const viewer = { email: meRow[0], name: meRow[1], role: meRow[2], team: meRow[3] };
    const lastCheckedMs = sheetSerialToMs_(meRow[5]) || 0;

    let leadScope = null;
    settingRows.forEach(function (row) {
      if (row[0] === '팀장_열람범위') leadScope = row[1];
    });

    const allPosts = postRows.map(function (row) {
      return { id: row[0], materialName: row[2], createdAt: row[7] };
    });
    const allItems = itemRows.map(function (row) {
      return { itemId: String(row[0]), manager: row[3], team: row[4], materials: row[5], status: row[6], registeredAt: row[7] };
    });
    const allComments = commentRows.map(function (row) {
      return { postId: row[1], itemId: row[2], authorEmail: row[3], createdAt: row[8] };
    });

    const commentsByPost = {};
    allComments.forEach(function (c) {
      const key = String(c.postId);
      (commentsByPost[key] = commentsByPost[key] || []).push(c);
    });

    let totalNeedsAttention = 0;
    const signatures = [];
    allPosts.forEach(function (post) {
      const candidateItems = relatedActiveItems_(post, allItems);
      const viewableItems = candidateItems.filter(function (it) {
        return teamScopeAllows_(viewer.role, viewer.team, it.team, leadScope);
      });
      if (viewableItems.length === 0) return;

      const postComments = commentsByPost[String(post.id)] || [];
      const byItemId = {};
      postComments.forEach(function (c) {
        const k = String(c.itemId);
        (byItemId[k] = byItemId[k] || []).push(c);
      });

      const itemSummaries = viewableItems.map(function (it) {
        return summarizeItemForPost_(it, byItemId[String(it.itemId)] || []);
      });

      if (needsAttentionFor_(viewer, itemSummaries, lastCheckedMs)) totalNeedsAttention += 1;

      itemSummaries.forEach(function (s) {
        signatures.push({
          postId: post.id,
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
