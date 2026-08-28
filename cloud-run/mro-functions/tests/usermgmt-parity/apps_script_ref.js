// Code.gs의 handleUpdateUser_(user, body)(3367~3396행)과 handleChangePassword_(user, body)
// (3586~3618행)을 그대로 옮긴 참조 구현.
//
// getSheetObj_/getSheetValues_/invalidateSheetCache_/findUser_(전부 Apps Script/실제 시트
// 부작용)를 걷어내고, "무엇을 검증하고 시트를 어떻게 바꿀지"라는 핵심 판단만 순수 함수로
// 남겼다. 시트는 다음 배열로 표현한다:
//   users: [[email, name, role, team, status, lastCheckedAt, passwordHash, failCount,
//            passwordChangedAt], ...]  (사용자팀마스터 A2:I, 헤더 제외, index 0 == 시트 2행)
//
// updateUser의 body.row는 "실제 시트 행 번호"(헤더=1행, 첫 데이터 행=2행)이므로, 배열
// index로 변환하면 row-2다. changePassword의 nowIso는 등록/변경 시각을 테스트 결정성을
// 위해 외부에서 주입한다(원본은 new Date().toISOString()을 직접 호출).

const crypto = require('crypto');

const VALID_ROLES = ['일반', '담당', '팀장', '임원'];
const VALID_TEAMS = ['동부', '서부', '중부', '영업지원', '소싱', '본사'];
const VALID_STATUS = ['활성', '비활성'];
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

// Code.gs 331~335행과 완전히 동일한 공식(SHA-256 + 이메일 salt).
function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

// freshUsers를 rowNum(=idx+2)까지 필요하면 빈 행으로 늘린다. Code.gs는 rowNum이 실제
// 데이터 범위를 벗어나도(=존재하지 않는 큰 row 번호) 이를 막는 코드가 없이 그대로
// sheet.getRange(rowNum, col).setValue(...)를 호출한다 — 실제 시트라면 Sheets가 그 행까지
// 자동으로 확장하며 써지는 것과 동등하게, 이 순수 함수 표현에서도 배열을 그 인덱스까지
// 늘려서(빈 칸은 undefined) 흉내낸다. 이 동작을 이번에 새로 막지 않는다(parity 테스트로
// 확인만 한다).
function ensureRow_(arr, idx) {
  while (arr.length <= idx) {
    arr.push([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  }
}

// Code.gs handleUpdateUser_ 포트. 반환: { result, users } (users는 변경 반영된 복사본).
function handleUpdateUser_(user, body, freshUsers) {
  if (String(user.email).trim().toLowerCase() !== ADMIN_EMAIL) {
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

  // Code.gs 3388~3393행과 동일한 순서(name -> role -> team -> status)로, 전달된 필드만
  // 개별 갱신한다(부분 업데이트). name은 trim 후 빈 문자열이면 건드리지 않는다.
  if (body.name !== undefined && String(body.name).trim() !== '') {
    users[idx][1] = String(body.name).trim();
  }
  if (body.role !== undefined) users[idx][2] = body.role;
  if (body.team !== undefined) users[idx][3] = body.team;
  if (body.status !== undefined) users[idx][4] = body.status;

  return { result: { ok: true }, users: users };
}

// Code.gs handleChangePassword_ 포트. freshUsers에서 매 호출마다 user.email로 다시 찾는다
// (Code.gs가 findUser_(user.email)로 매 요청마다 시트를 다시 조회하는 것과 동일한 원칙).
// 반환: { result, users }.
function handleChangePassword_(user, body, freshUsers, nowIso) {
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  if (!currentPassword || !newPassword) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, users: freshUsers };
  }
  if (newPassword.length < 6) {
    return { result: { ok: false, error: 'PASSWORD_TOO_SHORT' }, users: freshUsers };
  }

  const idx = freshUsers.findIndex(function (row) {
    return String(row[0] || '').trim().toLowerCase() === String(user.email).trim().toLowerCase();
  });
  if (idx === -1) {
    return { result: { ok: false, error: 'USER_NOT_FOUND' }, users: freshUsers };
  }
  const currentHash = freshUsers[idx][6] || null; // G열(0-indexed 6) = passwordHash
  if (currentHash !== hashPassword_(currentPassword, user.email)) {
    return { result: { ok: false, error: 'WRONG_PASSWORD' }, users: freshUsers };
  }

  const users = freshUsers.map(function (r) { return r.slice(); });
  users[idx][6] = hashPassword_(newPassword, user.email);
  users[idx][8] = nowIso; // I열(비밀번호변경일) — 실제 Date 셀이 아니라 텍스트(ISO 문자열) 그대로
  return { result: { ok: true }, users: users };
}

module.exports = { handleUpdateUser_, handleChangePassword_, hashPassword_ };
