// cloud-run/mro-functions/index.js의 markThreadSeenAction_ 안에서 실제로 "갱신 대상 행을
// 찾을지, 새 행을 추가할지"를 결정하는 부분만(GoogleAuth/Sheets API 호출부는 제외) 그대로
// 옮긴 것. 원본(index.js, markThreadSeenAction_):
//
//   let matchedRowIndex = -1;
//   for (let i = 0; i < rows.length; i++) {
//     const row = rows[i];
//     if (String(row[0]).toLowerCase() === String(email).toLowerCase() &&
//         String(row[1]) === postIdStr && String(row[2]) === itemIdStr) {
//       matchedRowIndex = i;
//       break;
//     }
//   }
//   if (matchedRowIndex !== -1) { ... PUT D{sheetRow} ... } else { ... append ... }
//
// 이 테스트에서는 Sheets API 호출(client.request PUT/append)을 걷어내고, 실제로 어떤 행이
// 갱신/추가되는지를 in-memory rows 배열에 그대로 반영해서 반환한다 — apps_script_ref.js와
// 완전히 같은 입출력 모양으로 비교할 수 있게 맞췄다. MISSING_FIELDS 분기도 markThreadSeenAction_
// 원본과 동일한 조건(!postIdStr || !itemIdStr)을 그대로 옮겼다.
function markThreadSeenAction_(email, postId, itemId, rows, nowIso) {
  const postIdStr = String(postId || '');
  const itemIdStr = String(itemId || '');
  if (!postIdStr || !itemIdStr) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, rows: rows.map(function (r) { return r.slice(); }) };
  }

  const outRows = rows.map(function (r) { return r.slice(); });
  let matchedRowIndex = -1;
  for (let i = 0; i < outRows.length; i++) {
    const row = outRows[i];
    if (String(row[0]).toLowerCase() === String(email).toLowerCase() &&
        String(row[1]) === postIdStr && String(row[2]) === itemIdStr) {
      matchedRowIndex = i;
      break;
    }
  }

  if (matchedRowIndex !== -1) {
    outRows[matchedRowIndex][3] = nowIso;
  } else {
    outRows.push([email, postIdStr, itemIdStr, nowIso]);
  }

  return { result: { ok: true }, rows: outRows };
}

module.exports = { markThreadSeenAction_ };
