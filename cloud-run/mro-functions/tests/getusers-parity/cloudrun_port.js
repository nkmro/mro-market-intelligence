// cloud-run/mro-functions/index.js의 exports.getUsersTest 안에서 실제로 users를 걸러내는
// 부분만(세션 인증/Sheets API 호출/viewer 조회부는 제외) 그대로 옮긴 것 — getitems-parity/
// cloudrun_port.js와 동일한 범위 설정이다(README 참고: viewer 조회는 email->role/team을
// 가져오는 배관일 뿐이고, 실제 필터링 로직과는 무관하므로 이미 role/team이 확정된 viewer를
// 그대로 받는다). 실제 구현의 viewer 조회 자체(USER_NOT_FOUND 분기 포함)는 getItemsTest/
// getCustomersTest와 완전히 동일한 패턴을 그대로 재사용한 것이라 별도 로직 비교가 필요
// 없다고 판단했다 — getitems-parity README의 판단을 그대로 따른다.
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function getUsersTestResult_(viewer, rawUserRows) {
  const isAdmin = String(viewer.email).trim().toLowerCase() === ADMIN_EMAIL;
  const isScopedRole = (viewer.role === '담당' || viewer.role === '팀장');
  if (!isAdmin && !isScopedRole) {
    return { ok: false, error: 'FORBIDDEN' };
  }

  const users = [];
  for (let i = 0; i < rawUserRows.length; i++) {
    const row = rawUserRows[i];
    if (!row[0]) continue;
    if (!isAdmin && String(row[3]).trim() !== String(viewer.team).trim()) continue;
    users.push({ row: i + 2, email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] });
  }

  return { ok: true, users: users };
}

module.exports = { getUsersTestResult_ };
