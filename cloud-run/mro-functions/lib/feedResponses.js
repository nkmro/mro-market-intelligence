// cloud-run/mro-functions/lib/feedResponses.js
//
// getFeed/getNotifications/getPostById 응답 생성. lib/feedEngine.js가 만든 entry
// (post/items 원시 계산 결과, 날짜는 아직 시트 시리얼 원본)를 실제 HTTP 응답 모양으로
// 바꾼다 — Apps Script가 Date 객체를 JSON.stringify할 때 자동으로 ISO 문자열이 되는
// 것과 같은 결과가 나오도록, 날짜 필드(post.createdAt/item.lastCommentAt/comment.createdAt)
// 를 여기서 ISO 문자열로 변환한다. 판정(feedEngine)과 응답 모양(여기)을 분리해서,
// pollSignalTest처럼 ISO 변환이 다른 시점에 필요한 호출부도 feedEngine의 ms 값을
// 그대로 쓸 수 있게 한다.

const { sheetSerialToMs } = require('./feedEngine');

function toIso(raw) {
  const ms = sheetSerialToMs(raw);
  return ms === null ? null : new Date(ms).toISOString();
}

function shapeComment(c) {
  return {
    commentId: c.commentId,
    postId: c.postId,
    itemId: c.itemId,
    authorEmail: c.authorEmail,
    authorName: c.authorName,
    authorRole: c.authorRole,
    parentCommentId: c.parentCommentId,
    content: c.content,
    createdAt: toIso(c.createdAtRaw)
  };
}

function shapeItem(s) {
  return {
    itemId: s.itemId,
    customer: s.customer,
    itemName: s.itemName,
    manager: s.manager,
    team: s.team,
    confirmed: s.confirmed,
    commentCount: s.commentCount,
    lastCommentAuthorEmail: s.lastCommentAuthorEmail,
    lastCommentAt: s.lastCommentAtMs !== null ? new Date(s.lastCommentAtMs).toISOString() : null,
    comments: s.comments.map(shapeComment)
  };
}

// getFeed/getPostById 공통 게시물 모양. Code.gs의 handleGetFeed_ 응답 posts[]와
// handleGetPostById_ 응답 post가 정확히 같은 필드 집합을 쓰는 것과 동일하게 맞췄다.
function shapeEntryAsPost(e) {
  return {
    id: e.post.id,
    materialCode: e.post.materialCode,
    materialName: e.post.materialName,
    title: e.post.title,
    summary: e.post.summary,
    link: e.post.link,
    pubDate: e.post.pubDate,
    createdAt: toIso(e.post.createdAtRaw),
    confirmedCount: e.confirmedCount,
    totalCount: e.totalCount,
    needsAttention: e.needsAttention,
    items: e.items.map(shapeItem)
  };
}

// getFeedTest: 기간 컷오프 + hasUnconfirmed 예외 + 최신순 정렬 + cursor/limit 페이지네이션.
// Code.gs handleGetFeed_(2702행)와 동일한 규칙.
// - totalNeedsAttention은 컷오프 필터링 "전" entries 전체를 기준으로 센다(원본과 동일 —
//   handleGetFeed_도 entries.push 여부와 무관하게 매 게시물마다 needsAttention을 센다).
function buildGetFeedResponse(entries, opts) {
  opts = opts || {};
  const cursor = Number(opts.cursor) || 0;
  const limit = Number(opts.limit) || 25;
  const feedDisplayDays = Number(opts.feedDisplayDays) || 14;
  const feedCutoffMs = Date.now() - feedDisplayDays * 24 * 60 * 60 * 1000;

  const totalNeedsAttention = entries.filter(function (e) { return e.needsAttention; }).length;

  const filtered = entries.filter(function (e) {
    const hasUnconfirmed = e.items.some(function (it) { return !it.confirmed; });
    const createdMs = sheetSerialToMs(e.post.createdAtRaw);
    return hasUnconfirmed || (createdMs !== null && createdMs >= feedCutoffMs);
  });

  filtered.sort(function (a, b) {
    return sheetSerialToMs(b.post.createdAtRaw) - sheetSerialToMs(a.post.createdAtRaw);
  });

  const page = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < filtered.length ? cursor + limit : null;

  return {
    ok: true,
    posts: page.map(shapeEntryAsPost),
    nextCursor: nextCursor,
    totalNeedsAttention: totalNeedsAttention
  };
}

// getNotificationsTest: 기간 필터 없음 + (담당 역할이면) 비활성 담당은 그대로 노출,
// 활성 담당은 본인 것만 남기는 품목 필터 재적용(Code.gs 2956~2971행) + 알림 전용 필드로 축약.
// needsAttention은 품목 필터 재적용 후에도 다시 계산하지 않는다(원본과 동일).
function buildGetNotificationsResponse(entries, viewer, allUsers) {
  let workingEntries = entries;

  if (viewer.role === '담당') {
    const activeManagersByName = {};
    allUsers.forEach(function (u) {
      const name = String(u.name || '').trim();
      if (name && !(name in activeManagersByName)) {
        activeManagersByName[name] = String(u.status || '').trim() === '활성';
      }
    });
    workingEntries = entries.map(function (e) {
      const items = e.items.filter(function (it) {
        const managerName = String(it.manager || '').trim();
        if (!activeManagersByName[managerName]) return true;
        return managerName === String(viewer.name || '').trim();
      });
      const confirmedCount = items.filter(function (s) { return s.confirmed; }).length;
      return Object.assign({}, e, { items: items, confirmedCount: confirmedCount, totalCount: items.length });
    });
  }

  const sorted = workingEntries.slice().sort(function (a, b) {
    return sheetSerialToMs(b.post.createdAtRaw) - sheetSerialToMs(a.post.createdAtRaw);
  });

  function toNotification(e) {
    return {
      postId: e.post.id,
      materialName: e.post.materialName,
      title: e.post.title,
      summary: e.post.summary,
      createdAt: toIso(e.post.createdAtRaw),
      items: e.items.map(shapeItem),
      confirmedCount: e.confirmedCount,
      totalCount: e.totalCount,
      needsAttention: e.needsAttention
    };
  }

  return {
    ok: true,
    count: sorted.length,
    items: sorted.map(toNotification)
  };
}

// getPostByIdTest 성공 응답 모양. NOT_FOUND(게시물 자체가 없음)/FORBIDDEN(게시물은 있으나
// 뷰어가 볼 수 있는 품목이 없음) 판단은 entry가 null인지 여부로 index.js에서 먼저 갈라야
// 하므로(둘 다 "entries에 없음"으로만 보면 구분이 안 됨) 여기서는 하지 않는다 — 이 함수는
// entry가 이미 확보된(null이 아닌) 성공 케이스만 받는다.
function buildPostDetailResponse(entry) {
  return { ok: true, post: shapeEntryAsPost(entry) };
}

// getCommentsTest 성공 응답 모양. Code.gs handleGetComments_와 동일하게 postId 자체가
// 없는 게시물이어도(댓글이 하나도 안 걸러져 빈 배열이어도) ok:true, comments:[] — 에러가
// 아니다. comments는 lib/feedEngine.js의 visibleCommentsForPost가 이미 필터+정렬해서
// 넘겨준 것을 그대로 shapeComment로 모양만 바꾼다.
function buildGetCommentsResponse(comments) {
  return { ok: true, comments: comments.map(shapeComment) };
}

module.exports = {
  toIso,
  shapeComment,
  shapeItem,
  shapeEntryAsPost,
  buildGetFeedResponse,
  buildGetNotificationsResponse,
  buildPostDetailResponse,
  buildGetCommentsResponse
};
