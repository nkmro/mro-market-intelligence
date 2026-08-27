// Code.gs의 handleGetUsers_(3343~3364행)를 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본:
//
// function handleGetUsers_(user, body) {
//   var isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
//   var isScopedRole = (user.role === '담당' || user.role === '팀장');
//   if (!isAdmin && !isScopedRole) {
//     return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
//   }
//   const rows = getSheetValues_('사용자팀마스터');
//   const users = [];
//   for (let i = 1; i < rows.length; i++) {
//     const row = rows[i];
//     if (!row[0]) continue;
//     if (!isAdmin && String(row[3]).trim() !== String(user.team).trim()) continue;
//     users.push({ row: i + 1, email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] });
//   }
//   return jsonResponse_({ ok: true, users: users });
// }
//
// getSheetValues_('사용자팀마스터')는 헤더 포함 2차원 배열을 돌려주므로 원본은 rows[1]부터
// 순회하며 row: i+1(헤더 포함 배열 기준 인덱스+1)을 반환한다. 여기서는 헤더를 뺀 데이터
// 행 배열(rows)을 받아 rows[0]부터 순회한다 — getitems-parity/apps_script_ref.js와 동일한
// 방식. 헤더 포함 배열에서 데이터 첫 행은 인덱스 1(시트 2행)이었고, 그 행이 헤더 제외
// 배열에서는 인덱스 0이 된다 — 즉 헤더 제외 인덱스 j = 헤더 포함 인덱스 i - 1. 원본의
// row: i+1을 j로 다시 쓰면 row: (j+1)+1 = j+2. 아래 for문의 i가 바로 이 j이므로
// row: i+2로 계산하면 원본과 동일한 시트 행 번호가 나온다.
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function handleGetUsers_(user, rows) {
  const isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
  const isScopedRole = (user.role === '담당' || user.role === '팀장');
  if (!isAdmin && !isScopedRole) {
    return { ok: false, error: 'FORBIDDEN' };
  }
  const users = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    if (!isAdmin && String(row[3]).trim() !== String(user.team).trim()) continue;
    users.push({ row: i + 2, email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] });
  }
  return { ok: true, users: users };
}

module.exports = { handleGetUsers_ };
