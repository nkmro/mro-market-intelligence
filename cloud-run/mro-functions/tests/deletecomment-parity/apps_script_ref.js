// Code.gs의 handleDeleteComment_(2476~2510행)를 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본:
//
// function handleDeleteComment_(user, body) {
//   const commentId = body.commentId;
//   if (!commentId) {
//     return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
//   }
//
//   const sheet = getSheetObj_(SHEET_COMMENT);
//   const lastRow = sheet.getLastRow();
//   const lastCol = sheet.getLastColumn();
//   if (lastRow < 2) return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });
//
//   const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
//   const header = data[0];
//   let targetIndex = -1;
//   for (let i = 1; i < data.length; i++) {
//     if (String(data[i][0]) === String(commentId)) { targetIndex = i; break; }
//   }
//   if (targetIndex === -1) {
//     return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });
//   }
//   if (String(data[targetIndex][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
//     return jsonResponse_({ ok: false, error: 'FORBIDDEN_NOT_AUTHOR' });
//   }
//
//   const postId = data[targetIndex][1];
//   const kept = [header];
//   for (let i = 1; i < data.length; i++) {
//     if (i !== targetIndex) kept.push(data[i]);
//   }
//   sheet.getRange(1, 1, kept.length, header.length).setValues(kept);
//   sheet.getRange(kept.length + 1, 1, lastRow - kept.length, lastCol).clearContent();
//   invalidateSheetCache_(SHEET_COMMENT);
//
//   return jsonResponse_(Object.assign({ ok: true }, buildCommentUpdateResponse_(user, postId)));
// }
//
// [이 parity 테스트의 범위] updatecomment-parity와 동일한 이유로 buildCommentUpdateResponse_는
// 범위 밖이다 — 대신 "실제로 시트에 남는 최종 데이터"(kept, 헤더 포함)까지 확인한다.
// setValues(kept) + clearContent(나머지)의 최종 결과는 논리적으로 "kept만 남는다"와 같으므로,
// 이 참조 구현은 kept를 그대로 최종 상태로 돌려준다.
function handleDeleteComment_(user, data, body) {
  const commentId = body.commentId;
  if (!commentId) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const lastRow = data.length;
  if (lastRow < 2) return { ok: false, error: 'COMMENT_NOT_FOUND' };

  const header = data[0];
  let targetIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(commentId)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }
  if (String(data[targetIndex][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
    return { ok: false, error: 'FORBIDDEN_NOT_AUTHOR' };
  }

  const postId = data[targetIndex][1];
  const kept = [header];
  for (let i = 1; i < data.length; i++) {
    if (i !== targetIndex) kept.push(data[i]);
  }
  return { ok: true, postId: postId, updatedSheetRows: kept };
}

module.exports = { handleDeleteComment_ };
