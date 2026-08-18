// apps_script_ref.js
// Code.gs의 getRelatedItems_ / canViewComment_ / buildFeedEntry_ / handlePollSignal_ 를
// 최대한 그대로(변수명·분기 순서·조건까지) 옮긴 "기준(reference)" 구현.
// 시트 읽기(getSheetValues_, getUserTeam_, getSetting_)만 바깥에서 값을 주입받는 형태로 바꿨을 뿐,
// 실제 분기/계산 로직은 Code.gs 원본 그대로다 (2026-08-18 기준 원본과 라인 단위로 대조함).

function makeAppsScriptRef(settingScope) {
  const _materialItemsCache_ = {};

  function getSetting_(key) {
    if (key === '팀장_열람범위') return settingScope || null;
    return null;
  }

  function canViewComment_(user, commentTeam) {
    switch (user.role) {
      case '임원':
        return true;
      case '팀장': {
        const scope = getSetting_('팀장_열람범위');
        return scope === '전체' || user.team === commentTeam;
      }
      case '담당':
      case '일반':
        return user.team === commentTeam;
      default:
        return false;
    }
  }

  function getRelatedItems_(post, allItems) {
    const materialName = post.materialName;
    let candidates = _materialItemsCache_[materialName];
    if (!candidates) {
      candidates = allItems.filter(function (it) {
        const materialMatch = String(it.materials).indexOf(materialName) !== -1;
        const statusActive = it.status === '활성';
        return materialMatch && statusActive;
      });
      _materialItemsCache_[materialName] = candidates;
    }
    return candidates.filter(function (it) {
      return !it.registeredAt || new Date(post.createdAt) >= new Date(it.registeredAt);
    });
  }

  function buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail) {
    const related = getRelatedItems_(post, allItems);
    const visibleItems = related.filter(function (it) {
      return canViewComment_(user, it.team);
    });
    if (visibleItems.length === 0) return null;

    const postComments = commentsByPost[String(post.id)] || [];
    const commentsByItem = {};
    postComments.forEach(function (c) {
      const key = String(c.itemId);
      if (!commentsByItem[key]) commentsByItem[key] = [];
      commentsByItem[key].push(c);
    });

    const itemStatuses = visibleItems.map(function (it) {
      const itemComments = commentsByItem[String(it.itemId)] || [];
      let lastComment = null;
      itemComments.forEach(function (c) {
        if (!lastComment || new Date(c.createdAt) > new Date(lastComment.createdAt)) lastComment = c;
      });
      const visibleComments = itemComments.filter(function (c) {
        const authorTeam = teamByEmail[String(c.authorEmail || '')];
        return canViewComment_(user, authorTeam);
      }).sort(function (a, b) {
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      return {
        itemId: it.itemId,
        customer: it.customer,
        itemName: it.itemName,
        manager: it.manager,
        team: it.team,
        confirmed: itemComments.length > 0,
        commentCount: itemComments.length,
        lastCommentAuthorEmail: lastComment ? lastComment.authorEmail : null,
        lastCommentAt: lastComment ? lastComment.createdAt : null,
        comments: visibleComments
      };
    });

    const confirmedCount = itemStatuses.filter(function (s) { return s.confirmed; }).length;

    const lastCheckedMs = user.lastCheckedAt ? new Date(user.lastCheckedAt).getTime() : 0;
    let needsAttention = false;
    if (user.role === '담당') {
      needsAttention = itemStatuses.some(function (s) {
        const isMine = String(s.manager).trim() === String(user.name).trim();
        if (!isMine) return false;
        if (!s.confirmed) return true;
        return !!s.lastCommentAuthorEmail && s.lastCommentAuthorEmail !== user.email &&
          new Date(s.lastCommentAt).getTime() > lastCheckedMs;
      });
    } else if (user.role === '팀장' || user.role === '임원') {
      needsAttention = itemStatuses.some(function (s) {
        if (!s.confirmed) return true;
        return !!s.lastCommentAuthorEmail && s.lastCommentAuthorEmail !== user.email &&
          new Date(s.lastCommentAt).getTime() > lastCheckedMs;
      });
    }

    return {
      post: post,
      items: itemStatuses,
      confirmedCount: confirmedCount,
      totalCount: itemStatuses.length,
      needsAttention: needsAttention
    };
  }

  function handlePollSignal_(user, allPosts, allItems, allComments, teamByEmail) {
    const commentsByPost = {};
    allComments.forEach(function (c) {
      const key = String(c.postId);
      if (!commentsByPost[key]) commentsByPost[key] = [];
      commentsByPost[key].push(c);
    });

    let totalNeedsAttentionCount = 0;
    const signatures = [];
    allPosts.forEach(function (post) {
      const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
      if (!entry) return;
      if (entry.needsAttention) totalNeedsAttentionCount++;
      entry.items.forEach(function (it) {
        signatures.push({
          postId: post.id,
          itemId: it.itemId,
          commentCount: it.commentCount,
          lastCommentAt: it.lastCommentAt
        });
      });
    });

    return { ok: true, totalNeedsAttention: totalNeedsAttentionCount, signatures: signatures };
  }

  return { handlePollSignal_, buildFeedEntry_, getRelatedItems_, canViewComment_ };
}

module.exports = { makeAppsScriptRef };
