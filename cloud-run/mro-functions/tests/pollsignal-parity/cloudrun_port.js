// cloudrun_port.js
// pollSignalTest(Cloud Run)에 실제로 들어갈 계산 로직의 초안(포팅본).
// apps_script_ref.js와 "같은 것을 보고 베낀" 게 아니라, 독립적으로 다시 짠 버전이다
// (스타일이 다르지만 결과가 같아야 한다 — 다르면 포팅 실수를 잡아내는 게 이 테스트의 목적).
// Sheets 값(문자열/숫자/날짜 표현 차이)에 대한 캐스팅 이슈는 별도 caveat로 문서에 남기고,
// 이 비교에서는 "동일한 입력값"을 넣는다는 지시에 따라 입력 형태는 참조 구현과 동일하게 둔다.

function teamScopeAllows(role, viewerTeam, targetTeam, leadScope) {
  if (role === '임원') return true;
  if (role === '팀장') return leadScope === '전체' ? true : viewerTeam === targetTeam;
  if (role === '담당' || role === '일반') return viewerTeam === targetTeam;
  return false;
}

function relatedActiveItems(post, items) {
  return items.filter(function (it) {
    const nameMatches = String(it.materials || '').indexOf(post.materialName) !== -1;
    const isActive = it.status === '활성';
    if (!(nameMatches && isActive)) return false;
    if (!it.registeredAt) return true;
    return new Date(post.createdAt).getTime() >= new Date(it.registeredAt).getTime();
  });
}

function summarizeItemForPost(item, itemComments, viewer, leadScope, teamByEmail) {
  let latest = null;
  for (const c of itemComments) {
    if (!latest || new Date(c.createdAt).getTime() > new Date(latest.createdAt).getTime()) latest = c;
  }
  const commentsViewerCanSee = itemComments
    .filter(function (c) {
      const team = teamByEmail[c.authorEmail || ''];
      return teamScopeAllows(viewer.role, viewer.team, team, leadScope);
    })
    .slice()
    .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });

  return {
    itemId: item.itemId,
    customer: item.customer,
    itemName: item.itemName,
    manager: item.manager,
    team: item.team,
    confirmed: itemComments.length > 0,
    commentCount: itemComments.length,
    lastCommentAuthorEmail: latest ? latest.authorEmail : null,
    lastCommentAt: latest ? latest.createdAt : null,
    comments: commentsViewerCanSee
  };
}

function needsAttentionFor(viewer, itemSummaries, lastCheckedMs) {
  if (viewer.role === '담당') {
    return itemSummaries.some(function (s) {
      if (String(s.manager || '').trim() !== String(viewer.name || '').trim()) return false;
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && new Date(s.lastCommentAt).getTime() > lastCheckedMs;
    });
  }
  if (viewer.role === '팀장' || viewer.role === '임원') {
    return itemSummaries.some(function (s) {
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && new Date(s.lastCommentAt).getTime() > lastCheckedMs;
    });
  }
  return false;
}

function buildEntryForPost(viewer, post, allItems, commentsByPost, teamByEmail, leadScope) {
  const candidateItems = relatedActiveItems(post, allItems);
  const viewableItems = candidateItems.filter(function (it) {
    return teamScopeAllows(viewer.role, viewer.team, it.team, leadScope);
  });
  if (viewableItems.length === 0) return null;

  const postComments = commentsByPost[String(post.id)] || [];
  const byItemId = {};
  for (const c of postComments) {
    const k = String(c.itemId);
    (byItemId[k] = byItemId[k] || []).push(c);
  }

  const itemSummaries = viewableItems.map(function (it) {
    const itemComments = byItemId[String(it.itemId)] || [];
    return summarizeItemForPost(it, itemComments, viewer, leadScope, teamByEmail);
  });

  const lastCheckedMs = viewer.lastCheckedAt ? new Date(viewer.lastCheckedAt).getTime() : 0;

  return {
    post: post,
    items: itemSummaries,
    confirmedCount: itemSummaries.filter(function (s) { return s.confirmed; }).length,
    totalCount: itemSummaries.length,
    needsAttention: needsAttentionFor(viewer, itemSummaries, lastCheckedMs)
  };
}

function pollSignalTest(viewer, allPosts, allItems, allComments, teamByEmail, leadScope) {
  const commentsByPost = {};
  for (const c of allComments) {
    const k = String(c.postId);
    (commentsByPost[k] = commentsByPost[k] || []).push(c);
  }

  let totalNeedsAttention = 0;
  const signatures = [];
  for (const post of allPosts) {
    const entry = buildEntryForPost(viewer, post, allItems, commentsByPost, teamByEmail, leadScope);
    if (!entry) continue;
    if (entry.needsAttention) totalNeedsAttention += 1;
    for (const it of entry.items) {
      signatures.push({
        postId: post.id,
        itemId: it.itemId,
        commentCount: it.commentCount,
        lastCommentAt: it.lastCommentAt
      });
    }
  }

  return { ok: true, totalNeedsAttention, signatures };
}

module.exports = { pollSignalTest };
