// Code.gs의 handleGetItems_(3455~3487행)를 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본:
//
// function handleGetItems_(user, body) {
//   if (user.role !== '팀장' && user.role !== '담당') {
//     return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
//   }
//   const isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
//   const data = getSheetValues_(SHEET_ITEM);
//   const items = [];
//   for (let i = 1; i < data.length; i++) {
//     const row = data[i];
//     if (!row[0]) continue;
//     if (!isAdmin && String(row[4]).trim() !== String(user.team).trim()) continue;
//     items.push({
//       itemId: String(row[0]), customer: row[1], itemName: row[2], manager: row[3],
//       team: row[4], materials: row[5], status: row[6]
//     });
//   }
//   var resultItems = items;
//   if (user.role === '담당') {
//     resultItems = items.filter(function (it) { return it.team === user.team; });
//   } else if (user.role === '팀장') {
//     var scope = getSetting_('팀장_열람범위');
//     if (scope !== '전체') {
//       resultItems = items.filter(function (it) { return it.team === user.team; });
//     }
//   }
//   return jsonResponse_({ ok: true, items: resultItems });
// }
//
// getSheetValues_(SHEET_ITEM)는 헤더 포함 2차원 배열을 돌려주므로 원본은 data[1]부터 순회한다.
// 여기서는 헤더를 뺀 데이터 행 배열(rows)을 받아 rows[0]부터 순회한다 — threadseen-parity와
// 동일한 방식. getSetting_('팀장_열람범위') 자리는 settings 딕셔너리의 같은 키로 대체한다.
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function handleGetItems_(user, rows, settings) {
  if (user.role !== '팀장' && user.role !== '담당') {
    return { ok: false, error: 'FORBIDDEN' };
  }
  const isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
  const items = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;
    if (!isAdmin && String(row[4]).trim() !== String(user.team).trim()) continue;
    items.push({
      itemId: String(row[0]), customer: row[1], itemName: row[2], manager: row[3],
      team: row[4], materials: row[5], status: row[6]
    });
  }
  let resultItems = items;
  if (user.role === '담당') {
    resultItems = items.filter(function (it) { return it.team === user.team; });
  } else if (user.role === '팀장') {
    const scope = settings['팀장_열람범위'];
    if (scope !== '전체') {
      resultItems = items.filter(function (it) { return it.team === user.team; });
    }
  }
  return { ok: true, items: resultItems };
}

module.exports = { handleGetItems_ };
