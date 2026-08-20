// apps_script_ref.js
//
// Code.gs의 canViewComment_ / getRelatedItems_ / buildFeedEntry_ / handleGetFeed_ /
// handleGetNotifications_ / handleGetPostById_ 를 최대한 그대로(변수명·분기 순서·조건까지)
// 옮긴 "기준(reference)" 구현. 시트 읽기(getSheetValues_, getUserTeam_, getSetting_)만
// 바깥에서 값을 주입받는 형태로 바꿨을 뿐, 실제 분기/계산 로직은 Code.gs 원본 그대로다
// (2026-08-20, apps-script/Code.gs 2548~3075행과 라인 단위로 대조함).
//
// pollsignal-parity/apps_script_ref.js와 같은 스타일(makeAppsScriptRef 팩토리로 leadScope를
// 클로저에 담는 방식)을 그대로 따랐다.

function makeAppsScriptRef(settingScope) {
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
    return allItems.filter(function (it) {
      const materialMatch = String(it.materials).indexOf(post.materialName) !== -1;
      const statusActive = it.status === '활성';
      return materialMatch && statusActive;
    }).filter(function (it) {
      return !it.registeredAt || new Date(post.createdAt) >= new Date(it.registeredAt);
    });
  }

  function buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail) {
    const related = getRelatedItems_(post, allItems);
    const visibleItems = related.filter(function (it) { return canViewComment_(user, it.team); });
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
      }).sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
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

    return { post: post, items: itemStatuses, confirmedCount: confirmedCount, totalCount: itemStatuses.length, needsAttention: needsAttention };
  }

  function shapePost_(e) {
    return {
      id: e.post.id,
      materialCode: e.post.materialCode,
      materialName: e.post.materialName,
      title: e.post.title,
      summary: e.post.summary,
      link: e.post.link,
      pubDate: e.post.pubDate,
      createdAt: e.post.createdAt,
      confirmedCount: e.confirmedCount,
      totalCount: e.totalCount,
      needsAttention: e.needsAttention,
      items: e.items
    };
  }

  // handleGetFeed_(2702행). nowMs를 주입받아 테스트에서 "현재 시각"을 고정할 수 있게 했다
  // (Code.gs는 Date.now()를 직접 쓰지만, 판단 로직 자체는 동일).
  function handleGetFeed_(user, allPosts, allItems, allComments, teamByEmail, feedDisplayDays, body, nowMs) {
    const cursor = Number(body.cursor) || 0;
    const limit = Number(body.limit) || 25;
    const feedCutoff = new Date(nowMs - feedDisplayDays * 24 * 60 * 60 * 1000);

    const commentsByPost = {};
    allComments.forEach(function (c) {
      const key = String(c.postId);
      if (!commentsByPost[key]) commentsByPost[key] = [];
      commentsByPost[key].push(c);
    });

    const entries = [];
    let totalNeedsAttentionCount = 0;
    allPosts.forEach(function (post) {
      const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
      if (!entry) return;
      if (entry.needsAttention) totalNeedsAttentionCount++;
      const hasUnconfirmed = entry.items.some(function (it) { return !it.confirmed; });
      if (hasUnconfirmed || new Date(post.createdAt) >= feedCutoff) {
        entries.push(entry);
      }
    });

    entries.sort(function (a, b) { return new Date(b.post.createdAt) - new Date(a.post.createdAt); });

    const page = entries.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < entries.length ? cursor + limit : null;

    return {
      ok: true,
      posts: page.map(shapePost_),
      nextCursor: nextCursor,
      totalNeedsAttention: totalNeedsAttentionCount
    };
  }

  // handleGetNotifications_(2932행). allUsersRaw는 사용자팀마스터 원본 행 배열
  // (row[1]=name, row[4]=status)로, Code.gs가 getSheetValues_(SHEET_USER)를 다시 읽는 부분과 대응.
  function handleGetNotifications_(user, allPosts, allItems, allComments, teamByEmail, allUsersRaw) {
    const commentsByPost = {};
    allComments.forEach(function (c) {
      const key = String(c.postId);
      if (!commentsByPost[key]) commentsByPost[key] = [];
      commentsByPost[key].push(c);
    });

    const entries = [];
    allPosts.forEach(function (post) {
      const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
      if (entry) entries.push(entry);
    });

    entries.sort(function (a, b) { return new Date(b.post.createdAt) - new Date(a.post.createdAt); });
    if (user.role === '담당') {
      const activeManagersByName = {};
      allUsersRaw.forEach(function (row) {
        const name = String(row[1] || '').trim();
        if (name && !(name in activeManagersByName)) activeManagersByName[name] = String(row[4] || '').trim() === '활성';
      });
      entries.forEach(function (e) {
        e.items = e.items.filter(function (it) {
          const managerName = String(it.manager || '').trim();
          if (!activeManagersByName[managerName]) return true;
          return managerName === String(user.name || '').trim();
        });
        e.confirmedCount = e.items.filter(function (s) { return s.confirmed; }).length;
        e.totalCount = e.items.length;
      });
    }

    function toNotification(e) {
      return {
        postId: e.post.id,
        materialName: e.post.materialName,
        title: e.post.title,
        summary: e.post.summary,
        createdAt: e.post.createdAt,
        items: e.items,
        confirmedCount: e.confirmedCount,
        totalCount: e.totalCount,
        needsAttention: e.needsAttention
      };
    }

    return { ok: true, count: entries.length, items: entries.map(toNotification) };
  }

  // handleGetPostById_(3033행).
  function handleGetPostById_(user, allPosts, allItems, allComments, teamByEmail, postId) {
    if (!postId) return { ok: false, error: 'MISSING_POST_ID' };
    const post = allPosts.find(function (p) { return p.id === postId; });
    if (!post) return { ok: false, error: 'NOT_FOUND' };
    const commentsByPost = {};
    allComments.forEach(function (c) {
      const key = String(c.postId);
      if (!commentsByPost[key]) commentsByPost[key] = [];
      commentsByPost[key].push(c);
    });
    const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
    if (!entry) return { ok: false, error: 'FORBIDDEN' };
    return { ok: true, post: shapePost_(entry) };
  }

  return { handleGetFeed_, handleGetNotifications_, handleGetPostById_, buildFeedEntry_, getRelatedItems_, canViewComment_ };
}

module.exports = { makeAppsScriptRef };
