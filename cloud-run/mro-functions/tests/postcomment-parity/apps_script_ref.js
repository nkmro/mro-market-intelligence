// apps-script/Code.gs의 handlePostComment_(2269~2329행, 검증 로직만)과 isManagerForItem_
// (2228~2234행)을 그대로 옮긴 참조 구현. 원본(Code.gs):
//
// function isManagerForItem_(user, itemId, post) {
//   const item = getItemById_(itemId);
//   if (!item) return false;
//   if (String(item.manager).trim() !== String(user.name).trim()) return false;
//   if (post && String(item.materials).indexOf(post.materialName) === -1) return false;
//   return true;
// }
//
// function handlePostComment_(user, body) {
//   if (user.role === '일반') return jsonResponse_({ ok: false, error: 'FORBIDDEN_VIEWER' });
//   const postId = body.postId; const content = body.content;
//   const itemId = body.itemId || ''; const parentCommentId = body.parentCommentId || '';
//   if (!postId || !content) return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
//   const post = findPost_(postId);
//   if (!post) return jsonResponse_({ ok: false, error: 'POST_NOT_FOUND' });
//   const existingForPost = getCommentsForPost_(postId);
//   if (itemId) {
//     const existingForItem = existingForPost.filter(c => String(c.itemId) === String(itemId));
//     if (existingForItem.length === 0) {
//       if (user.role !== '담당') return jsonResponse_({ ok: false, error: 'FIRST_COMMENT_MANAGER_ONLY' });
//       if (!isManagerForItem_(user, itemId, post)) return jsonResponse_({ ok: false, error: 'NOT_ASSIGNED_MANAGER' });
//       if (parentCommentId) return jsonResponse_({ ok: false, error: 'FIRST_COMMENT_CANNOT_HAVE_PARENT' });
//     } else if (parentCommentId) {
//       const parentExists = existingForPost.some(c => String(c.commentId) === String(parentCommentId));
//       if (!parentExists) return jsonResponse_({ ok: false, error: 'PARENT_COMMENT_NOT_FOUND' });
//     }
//   } else {
//     if (existingForPost.length === 0) return jsonResponse_({ ok: false, error: 'NO_CONFIRMED_ITEM_YET' });
//     if (parentCommentId) {
//       const parentExists = existingForPost.some(c => String(c.commentId) === String(parentCommentId));
//       if (!parentExists) return jsonResponse_({ ok: false, error: 'PARENT_COMMENT_NOT_FOUND' });
//     }
//   }
//   const commentId = Utilities.getUuid(); const now = new Date();
//   appendComment_([commentId, postId, itemId, user.email, user.name, user.role, parentCommentId, content, now]);
//   // ... buildFeedEntry_ 기반 응답 재계산(이 parity 테스트 범위 밖 — lib/feedEngine.js/
//   //     lib/feedResponses.js가 getFeedTest/getPostByIdTest에서 이미 별도로 검증한 부분)
//   return jsonResponse_({ ok: true, commentId, comments: visibleComments, updatedPost });
// }
//
// 이 테스트에서는 findPost_/getCommentsForPost_(시트 조회)를 "이미 읽어온 배열(posts/items/
// comments)"로 대체하고, Utilities.getUuid()/new Date()는 테스트 결정성을 위해 외부에서
// 주입한다(commentId, nowIso — 실제 배포 코드에는 이 파라미터가 없음. markThreadSeen parity
// 테스트의 nowIso 주입과 동일한 관례). buildFeedEntry_ 기반 응답 조립은 검증 대상이 아니므로,
// 성공 시 appendComment_에 실제로 전달될 행(appendedRow)까지만 반환한다.
function isManagerForItem_(user, itemId, post, items) {
  const item = items.find(function (it) { return String(it.itemId).trim() === String(itemId).trim(); });
  if (!item) return false;
  if (String(item.manager).trim() !== String(user.name).trim()) return false;
  if (post && String(item.materials || '').indexOf(post.materialName) === -1) return false;
  return true;
}

function handlePostComment_(user, body, posts, items, comments, commentId, nowIso) {
  if (user.role === '일반') {
    return { ok: false, error: 'FORBIDDEN_VIEWER' };
  }

  const postId = body.postId;
  const content = body.content;
  const itemId = body.itemId || '';
  const parentCommentId = body.parentCommentId || '';

  if (!postId || !content) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }

  const post = posts.find(function (p) { return String(p.id).trim() === String(postId).trim(); });
  if (!post) {
    return { ok: false, error: 'POST_NOT_FOUND' };
  }

  const existingForPost = comments.filter(function (c) { return String(c.postId).trim() === String(postId).trim(); });

  if (itemId) {
    const existingForItem = existingForPost.filter(function (c) { return String(c.itemId) === String(itemId); });

    if (existingForItem.length === 0) {
      if (user.role !== '담당') {
        return { ok: false, error: 'FIRST_COMMENT_MANAGER_ONLY' };
      }
      if (!isManagerForItem_(user, itemId, post, items)) {
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
    appendedRow: [commentId, postId, itemId, user.email, user.name, user.role, parentCommentId, content, nowIso]
  };
}

module.exports = { handlePostComment_, isManagerForItem_ };
