// cloud-run/mro-functions/index.js의 isManagerForItem_/postCommentAction_ 안에서 실제로
// "이 요청을 검증 통과시킬지, 어떤 에러로 거부할지"를 결정하는 부분만(Sheets API append 호출과
// lib/feedEngine.js/lib/feedResponses.js 기반 응답 재계산은 제외) 그대로 옮긴 것. 원본
// (index.js, postCommentAction_)은 검증 통과 시 appendCommentRow_()로 실제 Sheets API append를
// 호출하고 이어서 feedEngine.buildFeedEntry 등으로 comments/updatedPost를 재계산하는데,
// 그 두 부분은 이 parity 테스트의 범위가 아니다(전자는 실제 GCP 호출이라 이 테스트에서 배제
// 대상이고, 후자는 getFeedTest/getPostByIdTest parity에서 이미 별도로 검증된 lib/feedEngine.js/
// lib/feedResponses.js를 그대로 재사용하는 부분이라 새 로직이 없다). 여기서는 검증을 통과하면
// 실제로 append될 행(appendedRow)까지만 반환해서, apps_script_ref.js와 완전히 같은 입출력
// 모양으로 비교할 수 있게 맞췄다.
function isManagerForItem_(viewer, itemId, post, allItems) {
  const item = allItems.find(function (it) { return String(it.itemId).trim() === String(itemId).trim(); });
  if (!item) return false;
  if (String(item.manager).trim() !== String(viewer.name).trim()) return false;
  if (post && String(item.materials || '').indexOf(post.materialName) === -1) return false;
  return true;
}

function postCommentAction_(viewer, allPosts, allItems, allComments, body, commentId, nowIso) {
  if (viewer.role === '일반') {
    return { ok: false, error: 'FORBIDDEN_VIEWER' };
  }

  const postId = body.postId;
  const content = body.content;
  const itemId = body.itemId || '';
  const parentCommentId = body.parentCommentId || '';

  if (!postId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const post = allPosts.find(function (p) { return String(p.id).trim() === String(postId).trim(); });
  if (!post) {
    return { ok: false, error: 'POST_NOT_FOUND' };
  }

  const existingForPost = allComments.filter(function (c) { return String(c.postId).trim() === String(postId).trim(); });

  if (itemId) {
    const existingForItem = existingForPost.filter(function (c) { return String(c.itemId) === String(itemId); });

    if (existingForItem.length === 0) {
      if (viewer.role !== '담당') {
        return { ok: false, error: 'FIRST_COMMENT_MANAGER_ONLY' };
      }
      if (!isManagerForItem_(viewer, itemId, post, allItems)) {
        return { ok: false, error: 'NOT_ASSIGNED_MANAGER' };
      }
      if (parentCommentId) {
        return { ok: false, error: 'FIRST_COMMENT_CANNOT_HAVE_PARENT' };
      }
    } else if (parentCommentId) {
      const parentExists = existingForPost.some(function (c) { return String(c.commentId) === String(parentCommentId); });
      if (!parentExists) {
        return { ok: false, error: 'PARENT_COMMENT_NOT_FOUND' };
      }
    }
  } else {
    if (existingForPost.length === 0) {
      return { ok: false, error: 'NO_CONFIRMED_ITEM_YET' };
    }
    if (parentCommentId) {
      const parentExists = existingForPost.some(function (c) { return String(c.commentId) === String(parentCommentId); });
      if (!parentExists) {
        return { ok: false, error: 'PARENT_COMMENT_NOT_FOUND' };
      }
    }
  }

  return {
    ok: true,
    appendedRow: [commentId, postId, itemId, viewer.email, viewer.name, viewer.role, parentCommentId, content, nowIso]
  };
}

module.exports = { postCommentAction_, isManagerForItem_ };
