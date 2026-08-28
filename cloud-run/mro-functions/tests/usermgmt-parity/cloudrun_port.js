// cloud-run/mro-functions/index.js의 updateUserAction_/changePasswordAction_ 안에서 실제로
// "무엇을 검증하고 시트를 어떻게 바꿀지"를 결정하는 판단 로직만(GoogleAuth/Sheets API 호출은
// 제외) 그대로 옮긴 것. 두 함수 모두 락을 쓰지 않으므로(2026-08-28 분석/설계에서 확정) "락을
// 잡은 뒤 fresh read"라는 단계 자체가 없다 — updateUserAction_은 body.row를 그대로 믿고
// 쓰고, changePasswordAction_만 매 호출마다 getFreshUserRows_로 다시 읽는데, 이 A그룹
// 테스트는 동시성 없는 단일 시나리오만 다루므로 "현재 state를 그대로 읽는다"로 단순화했다.
//
// [중요] 이 파일은 index.js에 실제로 작성된 제어 흐름을 "있는 그대로" 옮긴 것이지, Code.gs와
// 별개로 새로 설계한 것이 아니다.

const crypto = require('crypto');

const VALID_ROLES = ['일반', '담당', '팀장', '임원'];
const VALID_TEAMS = ['동부', '서부', '중부', '영업지원', '소싱', '본사'];
const VALID_STATUS = ['활성', '비활성'];
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

// index.js 1145행과 완전히 동일한 공식 — 신규 구현이 아니라 그대로 재사용한 함수를 그대로 옮김.
function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function ensureRow_(arr, idx) {
  while (arr.length <= idx) {
    arr.push([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  }
}

// index.js updateUserAction_ 포트.
function updateUserAction_(viewer, body, freshUsers) {
  if (String(viewer.email).trim().toLowerCase() !== ADMIN_EMAIL) {
    return { result: { ok: false, error: 'FORBIDDEN' }, users: freshUsers };
  }
  const rowNum = Number(body.row);
  if (!rowNum || rowNum < 2) {
    return { result: { ok: false, error: 'INVALID_ROW' }, users: freshUsers };
  }
  if (body.role !== undefined && VALID_ROLES.indexOf(body.role) === -1) {
    return { result: { ok: false, error: 'INVALID_ROLE' }, users: freshUsers };
  }
  if (body.team !== undefined && VALID_TEAMS.indexOf(body.team) === -1) {
    return { result: { ok: false, error: 'INVALID_TEAM' }, users: freshUsers };
  }
  if (body.status !== undefined && VALID_STATUS.indexOf(body.status) === -1) {
    return { result: { ok: false, error: 'INVALID_STATUS' }, users: freshUsers };
  }

  const users = freshUsers.map(function (r) { return r.slice(); });
  const idx = rowNum - 2;
  ensureRow_(users, idx);

  if (body.name !== undefined && String(body.name).trim() !== '') {
    users[idx][1] = String(body.name).trim();
  }
  if (body.role !== undefined) users[idx][2] = body.role;
  if (body.team !== undefined) users[idx][3] = body.team;
  if (body.status !== undefined) users[idx][4] = body.status;

  return { result: { ok: true }, users: users };
}

// index.js changePasswordAction_ 포트.
function changePasswordAction_(email, body, freshUsers, nowIso) {
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword || !newPassword) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, users: freshUsers };
  }
  if (newPassword.length < 6) {
    return { result: { ok: false, error: 'PASSWORD_TOO_SHORT' }, users: freshUsers };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  let rowIndex = -1;
  for (let i = 0; i < freshUsers.length; i++) {
    if (String(freshUsers[i][0] || '').trim().toLowerCase() === normalizedEmail) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex === -1) {
    return { result: { ok: false, error: 'USER_NOT_FOUND' }, users: freshUsers };
  }
  const currentHash = freshUsers[rowIndex][6] || null;
  if (currentHash !== hashPassword_(currentPassword, email)) {
    return { result: { ok: false, error: 'WRONG_PASSWORD' }, users: freshUsers };
  }

  const users = freshUsers.map(function (r) { return r.slice(); });
  users[rowIndex][6] = hashPassword_(newPassword, email);
  users[rowIndex][8] = nowIso;
  return { result: { ok: true }, users: users };
}

module.exports = { updateUserAction_, changePasswordAction_, hashPassword_ };
