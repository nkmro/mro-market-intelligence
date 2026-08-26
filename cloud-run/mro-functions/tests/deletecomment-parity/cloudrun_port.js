// cloud-run/mro-functions/index.js의 deleteCommentAction_ 안에서 실제로 "대상 댓글 행을
// 찾아 권한을 검사하고 나머지 행을 유지하는" 부분만(Sheets API GET/PUT/clear 호출과
// lib/feedEngine.js/lib/feedResponses.js 기반 buildCommentUpdateResponse_ 재계산은 제외)
// 그대로 옮긴 것 — postcomment-parity/updatecomment-parity의 cloudrun_port.js와 동일한
// 관례. 원본은 getFreshCommentRows_()로 POLL_COMMENT_RANGE(헤더 제외 A2:I)를 매번 새로
// 읽어 dataRows로 쓰는데, 여기서는 그 결과를 그대로 인자로 받는다.
function deleteCommentTestLogic_(viewer, dataRows, body) {
  const commentId = body.commentId;
  if (!commentId) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  if (dataRows.length === 0) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }

  let targetIndex = -1;
  for (let i = 0; i < dataRows.length; i++) {
    if (String(dataRows[i][0]) === String(commentId)) { targetIndex = i; break; }
  }
  if (targetIndex === -1) {
    return { ok: false, error: 'COMMENT_NOT_FOUND' };
  }
  if (String(dataRows[targetIndex][3]).trim().toLowerCase() !== String(viewer.email).trim().toLowerCase()) {
    return { ok: false, error: 'FORBIDDEN_NOT_AUTHOR' };
  }

  const postId = dataRows[targetIndex][1];
  const kept = dataRows.filter(function (_, idx) { return idx !== targetIndex; });
  return { ok: true, postId: postId, updatedDataRows: kept };
}

module.exports = { deleteCommentTestLogic_ };
