// Code.gs의 handleUpdateComment_(2446~2467행)를 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본:
//
// function handleUpdateComment_(user, body) {
//   const commentId = body.commentId;
//   const content = String(body.content || '').trim();
//   if (!commentId || !content) {
//     return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
//   }
//
//   const sheet = getSheetObj_(SHEET_COMMENT);
//   const data = sheet.getDataRange().getValues();
//   for (let i = 1; i < data.length; i++) {
//     if (String(data[i][0]) === String(commentId)) {
//       if (String(data[i][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
//         return jsonResponse_({ ok: false, error: 'FORBIDDEN_NOT_AUTHOR' });
//       }
//       const postId = data[i][1];
//       sheet.getRange(i + 1, 8).setValue(content); // H열: content
//       invalidateSheetCache_(SHEET_COMMENT);
//       return jsonResponse_(Object.assign({ ok: true }, buildCommentUpdateResponse_(user, postId)));
//     }
//   }
//   return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });
// }
//
// [이 parity 테스트의 범위] buildCommentUpdateResponse_(댓글 목록 재조회 + buildFeedEntry_
// 기반 updatedPost 재계산)는 이미 getFeedTest/getPostByIdTest/getCommentsTest parity에서
// 검증된 lib/feedEngine.js/lib/feedResponses.js를 postComment와 동일하게 그대로 재사용하는
// 부분이라 새 로직이 없다(postcomment-parity와 동일한 관례) — 여기서는 그 대신 "실제로
// 시트에 어떤 값이 남는가"(updatedSheetRows)까지 확인한다. sheet.getDataRange().getValues()는
// 헤더를 포함한 2차원 배열을 돌려주므로(data[0]=헤더), 이 참조 구현도 동일하게 헤더 포함
// data를 그대로 받는다(Cloud Run 포팅본은 헤더 없이 A2:I만 받는 것과 다름 — run_tests.js가
// 헤더를 뺀 부분만 비교해서 이 차이를 흡수한다).
function handleUpdateComment_(user, data, body) {
  const commentId = body.commentId;
  const content = String(body.content || '').trim();
  if (!commentId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(commentId)) {
      if (String(data[i][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
        return { ok: false, error: 'FORBIDDEN_NOT_AUTHOR' };
      }
      const postId = data[i][1];
      data[i][7] = content; // H열(0-based index 7): content — sheet.getRange(i+1,8).setValue(content)에 대응
      return { ok: true, postId: postId, updatedSheetRows: data };
    }
  }
  return { ok: false, error: 'COMMENT_NOT_FOUND' };
}

module.exports = { handleUpdateComment_ };
