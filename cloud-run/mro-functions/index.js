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
