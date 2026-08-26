// cloud-run/mro-functions/index.js의 updateCommentAction_ 안에서 실제로 "대상 댓글 행을
// 찾아 권한을 검사하고 H열(content)을 바꾸는" 부분만(Sheets API GET/PUT 호출과
// lib/feedEngine.js/lib/feedResponses.js 기반 buildCommentUpdateResponse_ 재계산은 제외)
// 그대로 옮긴 것 — postcomment-parity의 cloudrun_port.js와 동일한 관례. 원본은
// getFreshCommentRows_()로 POLL_COMMENT_RANGE(헤더 제외 A2:I)를 매번 새로 읽어 dataRows로
// 쓰는데, 여기서는 그 결과를 그대로 인자로 받는다.
function updateCommentTestLogic_(viewer, dataRows, body) {
  const commentId = body.commentId;
  const content = String(body.content || '').trim();
  if (!commentId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
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
  dataRows[targetIndex][7] = content; // updateCommentAction_이 성공 후 실제 PUT과 함께 메모리에도 반영하는 것과 동일
  return { ok: true, postId: postId, updatedDataRows: dataRows };
}

module.exports = { updateCommentTestLogic_ };
