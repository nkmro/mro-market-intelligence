// cloud-run/mro-functions/index.js의 exports.getItemsTest 안에서 실제로 items를 걸러내는
// 부분만(세션 인증/Sheets API 호출부는 제외) 그대로 옮긴 것. rowsToItems는
// lib/sheetsClient.js의 실제 구현과 동일하게 여기 다시 옮겨 적었다(그 파일을 고치지 않았음을
// 별도로 재확인).
const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function rowsToItems(rows) {
  return rows.map(function (row) {
    return {
      itemId: String(row[0]),
      customer: row[1],
      itemName: row[2],
      manager: row[3],
      team: row[4],
      materials: row[5],
      status: row[6],
      registeredAtRaw: row[7]
    };
  });
}

function getItemsTestResult_(viewer, rawItemRows, settings) {
  if (viewer.role !== '팀장' && viewer.role !== '담당') {
    return { ok: false, error: 'FORBIDDEN' };
  }

  const allItems = rowsToItems(rawItemRows.filter(function (row) { return !!row[0]; }));
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
    const scope = settings['팀장_열람범위'];
    if (scope !== '전체') {
      resultItems = items.filter(function (it) { return it.team === viewer.team; });
    }
  }

  return { ok: true, items: resultItems };
}

module.exports = { getItemsTestResult_ };
