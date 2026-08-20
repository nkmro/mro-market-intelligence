// cloud-run/mro-functions/lib/feedEngine.js
//
// 공통 판정/변환 로직. 기존 index.js에 pollSignalTest 전용으로 있던 5개 함수
// (sheetSerialToMs_/teamScopeAllows_/relatedActiveItems_/summarizeItemForPost_/
// needsAttentionFor_)를 그대로 이 파일로 옮기고(로직 변경 없음, 이름의 트레일링
// 언더스코어만 뗌), getFeed/getNotifications/getPostById가 필요로 하는
// buildFeedEntry/buildFeedEntries(및 그 하위 visibleComments/summarizeItemFull/
// buildTeamByEmail/findViewer/groupCommentsByPost)를 새로 추가했다.
//
// Apps Script 대응:
//   sheetSerialToMs        - (Apps Script는 실제 Date 객체를 쓰므로 대응 없음, Sheets API 전용 보정)
//   teamScopeAllows        - canViewComment_(user, commentTeam)의 축약형(설정 조회를 인자로 미리 받음)
//   relatedActiveItems     - getRelatedItems_(post, allItems)와 동일
//   summarizeItemFull      - buildFeedEntry_ 내부 품목별 confirmed/commentCount/lastComment 계산 +
//                            customer/itemName/team/comments[] 추가(상위집합)
//   needsAttentionFor      - buildFeedEntry_ 내부 역할별 needsAttention 분기와 동일
//   buildFeedEntry/Entries - buildFeedEntry_ / (handleGetFeed_ 등의 allPosts.forEach 루프)와 동일
//
// [2026-08-19 날짜/시간대 버그 수정, 기존 그대로 승계] 시트 시리얼 넘버는 스프레드시트에
// 설정된 시간대(서울, UTC+9, DST 없음) 기준 벽시계 값이라, UTC로 취급하면 9시간 어긋난다.
const SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul = UTC+9, DST 없음

// Google Sheets serial date(1899-12-30 기준, 스프레드시트 시간대(서울) 벽시계 값) -> 실제 UTC Unix ms.
// 값이 없으면 null. 문자열이 들어오는 예외 상황도 방어적으로 처리한다.
function sheetSerialToMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Math.round((v - 25569) * 86400000) - SPREADSHEET_UTC_OFFSET_MS;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

// Code.gs canViewComment_와 동일한 판단(팀장_열람범위 반영).
function teamScopeAllows(role, viewerTeam, targetTeam, leadScope) {
  if (role === '임원') return true;
  if (role === '팀장') return leadScope === '전체' ? true : viewerTeam === targetTeam;
  if (role === '담당' || role === '일반') return viewerTeam === targetTeam;
  return false;
}

// Code.gs getRelatedItems_와 동일한 판단(원자재명 매칭 + 활성 + 등록일 이전 게시물 제외).
function relatedActiveItems(post, allItems) {
  return allItems.filter(function (it) {
    const materialMatch = String(it.materials || '').indexOf(post.materialName) !== -1;
    const statusActive = it.status === '활성';
    if (!(materialMatch && statusActive)) return false;
    const registeredMs = sheetSerialToMs(it.registeredAtRaw);
    if (registeredMs === null) return true;
    return sheetSerialToMs(post.createdAtRaw) >= registeredMs;
  });
}

// [신규] 이메일 -> 팀 매핑. Code.gs의 getUserTeam_(캐시 + findUser_, 대소문자/공백 무시 매칭)를
// "이미 batchGet으로 다 읽어온 allUsers에서 한 번에 만든 딕셔너리"로 대체한다.
function buildTeamByEmail(allUsers) {
  const map = {};
  allUsers.forEach(function (u) {
    map[String(u.email || '').trim().toLowerCase()] = u.team;
  });
  return map;
}

// [신규] Code.gs findUser_와 동일한 방식(대소문자/공백 무시)으로 이메일로 뷰어를 찾아
// buildFeedEntry가 바로 쓸 수 있는 모양으로 돌려준다. 못 찾으면 null.
function findViewer(allUsers, email) {
  const target = String(email || '').trim().toLowerCase();
  const row = allUsers.find(function (u) { return String(u.email || '').trim().toLowerCase() === target; });
  if (!row) return null;
  return { email: row.email, name: row.name, role: row.role, team: row.team, lastCheckedAtRaw: row.lastCheckedAtRaw };
}

// [신규] 댓글을 postId별로 그룹핑 (기존 pollSignalTest/각 handle*_가 반복 구현하던 것을 공용화).
function groupCommentsByPost(allComments) {
  const map = {};
  allComments.forEach(function (c) {
    const key = String(c.postId);
    (map[key] = map[key] || []).push(c);
  });
  return map;
}

// [신규] Code.gs buildFeedEntry_의 개별 댓글 열람권한 필터(comments[] 표시용)와 동일.
// 품목 자체의 열람권한(teamScopeAllows, item.team 기준)과는 별개로, "이 댓글을 작성한
// 사람의 팀" 기준으로 canViewComment_를 다시 적용한다(댓글 작성자가 다른 팀일 수 있음).
function visibleComments(itemComments, viewerRole, viewerTeam, leadScope, teamByEmail) {
  return itemComments
    .filter(function (c) {
      const authorTeam = teamByEmail[String(c.authorEmail || '').trim().toLowerCase()];
      return teamScopeAllows(viewerRole, viewerTeam, authorTeam, leadScope);
    })
    .slice()
    .sort(function (a, b) {
      return sheetSerialToMs(a.createdAtRaw) - sheetSerialToMs(b.createdAtRaw);
    });
}

// Code.gs buildFeedEntry_의 품목별 요약(confirmed/commentCount/lastComment) 부분과 동일한
// 계산 + customer/itemName/team/comments[]를 추가한 상위집합.
// (confirmed/commentCount/lastComment는 itemComments 원본 전체 기준 — 팀 필터링 없음.
//  summarizeItemForPost_와 입력·계산식이 완전히 같다.)
function summarizeItemFull(item, itemComments, viewerRole, viewerTeam, leadScope, teamByEmail) {
  let lastComment = null;
  itemComments.forEach(function (c) {
    const cMs = sheetSerialToMs(c.createdAtRaw);
    const lastMs = lastComment ? sheetSerialToMs(lastComment.createdAtRaw) : null;
    if (!lastComment || (cMs !== null && lastMs !== null && cMs > lastMs)) lastComment = c;
  });
  return {
    itemId: item.itemId,
    customer: item.customer,
    itemName: item.itemName,
    manager: item.manager,
    team: item.team,
    confirmed: itemComments.length > 0,
    commentCount: itemComments.length,
    lastCommentAuthorEmail: lastComment ? lastComment.authorEmail : null,
    lastCommentAtMs: lastComment ? sheetSerialToMs(lastComment.createdAtRaw) : null,
    comments: visibleComments(itemComments, viewerRole, viewerTeam, leadScope, teamByEmail)
  };
}

// Code.gs buildFeedEntry_의 needsAttention 판단(역할별 분기)과 동일.
function needsAttentionFor(viewer, itemSummaries, lastCheckedMs) {
  if (viewer.role === '담당') {
    return itemSummaries.some(function (s) {
      if (String(s.manager || '').trim() !== String(viewer.name || '').trim()) return false;
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && s.lastCommentAtMs !== null && s.lastCommentAtMs > lastCheckedMs;
    });
  }
  if (viewer.role === '팀장' || viewer.role === '임원') {
    return itemSummaries.some(function (s) {
      if (!s.confirmed) return true;
      if (!s.lastCommentAuthorEmail) return false;
      return s.lastCommentAuthorEmail !== viewer.email && s.lastCommentAtMs !== null && s.lastCommentAtMs > lastCheckedMs;
    });
  }
  return false;
}

// [신규] Apps Script buildFeedEntry_의 게시물 1개 버전과 동일. 뷰어가 볼 수 있는 품목이
// 하나도 없으면 null(품목 자체가 안 보이면 이 게시물은 통째로 안 보인다 — 원본과 동일).
function buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail) {
  const candidateItems = relatedActiveItems(post, allItems);
  const viewableItems = candidateItems.filter(function (it) {
    return teamScopeAllows(viewer.role, viewer.team, it.team, leadScope);
  });
  if (viewableItems.length === 0) return null;

  const postComments = commentsByPost[String(post.id)] || [];
  const byItemId = {};
  postComments.forEach(function (c) {
    const k = String(c.itemId);
    (byItemId[k] = byItemId[k] || []).push(c);
  });

  const items = viewableItems.map(function (it) {
    return summarizeItemFull(it, byItemId[String(it.itemId)] || [], viewer.role, viewer.team, leadScope, teamByEmail);
  });

  const confirmedCount = items.filter(function (s) { return s.confirmed; }).length;
  const lastCheckedMs = sheetSerialToMs(viewer.lastCheckedAtRaw) || 0;
  const needsAttention = needsAttentionFor(viewer, items, lastCheckedMs);

  return { post: post, items: items, confirmedCount: confirmedCount, totalCount: items.length, needsAttention: needsAttention };
}

// [신규] 전체 게시물 버전. getFeedTest/getNotificationsTest/pollSignalTest(리팩터링)가
// 공통으로 호출한다. getPostByIdTest는 게시물 1개만 필요하므로 buildFeedEntry를 직접
// 호출한다(NOT_FOUND/FORBIDDEN을 구분해야 해서 — index.js 쪽 설명 참고).
function buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail) {
  const commentsByPost = groupCommentsByPost(allComments);
  const entries = [];
  allPosts.forEach(function (post) {
    const entry = buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail);
    if (entry) entries.push(entry);
  });
  return entries;
}

module.exports = {
  sheetSerialToMs,
  teamScopeAllows,
  relatedActiveItems,
  buildTeamByEmail,
  findViewer,
  groupCommentsByPost,
  visibleComments,
  summarizeItemFull,
  needsAttentionFor,
  buildFeedEntry,
  buildFeedEntries
};
