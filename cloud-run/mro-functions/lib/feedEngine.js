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

// [신규, getComments 이전 1단계] Code.gs handleGetComments_/getCommentsForPost_와 동일.
// visibleComments()는 이미 "특정 품목(item)에 그룹핑된" 댓글 목록을 입력으로 받는데,
// getComments는 품목 구분 없이 "게시물(postId) 전체"의 평면 댓글 목록이 필요해서 별도로
// 둔다(입력 형태가 다를 뿐, 팀 열람권한 판정 자체는 teamScopeAllows를 그대로 재사용).
// Code.gs와 동일하게 postId가 존재하지 않는 게시물이어도 에러 없이 빈 배열을 반환한다
// (NOT_FOUND 같은 개념이 없음 — getPostById와 다른 점).
function visibleCommentsForPost(allComments, postId, viewerRole, viewerTeam, leadScope, teamByEmail) {
  return allComments
    .filter(function (c) { return String(c.postId) === String(postId); })
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

// ---------------------------------------------------------------------------
// push 6단계 (PUSH_NOTIFICATION_STAGE6_DESIGN.md 1절) — feed.html의 hasUnreadReply/
// hasAwaitingReply(2508~2537행)를 조건 그대로 포팅한 것. session -> viewer, 전역
// ADMIN_EMAIL -> 명시적 인자 adminEmail로만 이름을 바꿨다. 클라이언트는 이 비교에
// trim()/toLowerCase()를 쓰지 않으므로(session.email === ADMIN_EMAIL) 여기서도 그대로
// 둔다 — 이 파일의 다른 함수가 아니라 "클라이언트와 정확히 같은 판단"이 이 두 함수의
// 목적이다. threadSeenMapLoaded 가드(클라이언트 전용 비동기 로딩 상태 체크)는 포팅하지
// 않는다 — 서버는 같은 요청 안에서 이미 동기적으로 시트를 다 읽은 뒤 호출되므로 그 상태
// 자체가 없다.
function hasUnreadReply(viewer, postId, item, threadSeenMap, adminEmail) {
  const comments = item.comments || [];
  if (!comments.length) return false;
  const isOverseer = viewer.role === '팀장' || viewer.role === '임원' || viewer.email === adminEmail;
  const participant = comments.some(function (c) { return c.authorEmail === viewer.email; });
  if (!isOverseer && !participant) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail === viewer.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}

// feed.html hasAwaitingReply(2524~2537행) 포팅, 위와 동일 원칙. ADMIN_EMAIL은 이 함수엔
// 등장하지 않으므로(팀장/임원 역할만 체크) 인자에 없다.
function hasAwaitingReply(viewer, postId, item, threadSeenMap) {
  if (viewer.role !== '팀장' && viewer.role !== '임원') return false;
  const comments = item.comments || [];
  if (!comments.length) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail !== viewer.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}

// feed.html의 updateNotifBadge()(1419~1429행)가 하던 3개 건수 계산을 한 번에 묶은 신규
// 진입점(설계 문서 1-3절). entries는 getNotificationsTest가 이미 만드는 것과 정확히 같은
// 소스(buildFeedEntries)를 그대로 받는다 — 별도의 날짜 필터나 다른 계산을 새로 만들지 않는다.
function countNotificationsForViewer(viewer, entries, threadSeenMap, adminEmail) {
  let newPosts = 0, needsReply = 0, awaitingReply = 0;
  entries.forEach(function (entry) {
    if (entry.needsAttention) {
      newPosts += entry.items.filter(function (it) { return !it.confirmed; }).length;
    }
    entry.items.forEach(function (it) {
      if (hasUnreadReply(viewer, entry.post.id, it, threadSeenMap, adminEmail)) needsReply++;
      if (hasAwaitingReply(viewer, entry.post.id, it, threadSeenMap)) awaitingReply++;
    });
  });
  return { newPosts: newPosts, needsReply: needsReply, awaitingReply: awaitingReply };
}

// [신규, 배치 전용] getThreadSeenTest(index.js)는 한 사람의 threadSeenMap만 만든다(요청자
// 이메일로 필터링). pushBatchTest는 대상 사용자 전원의 threadSeenMap이 한 번에 필요하므로,
// 시트를 한 번만 읽고 이메일별로 미리 인덱싱해두는 함수(설계 문서 1-4절). rows는
// getThreadSeenTest와 동일한 THREAD_SEEN_RANGE에서 읽은 원본 행.
function buildThreadSeenIndex_(rows) {
  const index = {};
  rows.forEach(function (row) {
    const emailLower = String(row[0]).toLowerCase();
    const key = row[1] + '-' + row[2];
    (index[emailLower] = index[emailLower] || {})[key] = row[3];
  });
  return index;
}

// ---------------------------------------------------------------------------
// 담당자 댓글 리마인더 (push 7단계 — 계산 로직만, 아직 어디서도 호출되지 않음/미배포).
// NOTIFICATION_PUSH_REMINDER_ANALYSIS_AND_PLAN.md 3.1-5번.

// 설정값 "담당자댓글마감시각"을 시(0~23) 배열로 파싱한다. 쉼표로 여러 시각 지원(예: "13,16")
// — 재홍님 확정 요구사항(2026-08-28, 7~8단계에서 실제 구현하기로 미리 메모해둔 것). 숫자로
// 못 바꾸는 조각은 버리고, 유효한 시(0~23)만 남긴다.
function parseReminderHours(raw) {
  return String(raw == null ? '' : raw).split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; }) // Number('')는 0이라, 빈 조각을 먼저 걸러내지
    // 않으면 "값이 아예 없음"이 "0시(자정)에 리마인더"로 잘못 파싱된다 — 실제 코드 작성
    // 단계에서 발견해 수정.
    .map(function (s) { return Number(s); })
    .filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 23; });
}

// 담당(역할) 뷰어 1명 기준으로 "본인이 담당이면서 아직 확인 안 한(댓글 하나도 없는) 품목"
// 목록을 계산한다. 새 판단 로직을 만들지 않고 buildFeedEntries가 이미 계산하는 것(같은 데이터
// 소스, summarizeItemFull의 confirmed/manager 필드)을 그대로 재사용한다 — updateNotifBadge()의
// "새 게시물" 배지 계산(newItemsCount, feed.html 1419~1424행)과 근본적으로 같은 재료를 쓰되,
// "이 사람이 담당인 품목"으로 한 번 더 좁힌 것이다. 매니저 이름 비교는 품목 관리 팝업의
// 담당 드롭다운 버그 수정(52ae8c1) 때와 동일하게 trim()으로 공백을 방어한다.
function computeReminderItemsForManager(viewer, allPosts, allItems, allComments, leadScope, teamByEmail) {
  if (viewer.role !== '담당') return [];
  const entries = buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail);
  const result = [];
  const viewerName = String(viewer.name || '').trim();
  entries.forEach(function (entry) {
    entry.items.forEach(function (it) {
      if (String(it.manager || '').trim() === viewerName && !it.confirmed) {
        result.push({ postId: entry.post.id, itemId: it.itemId, itemName: it.itemName });
      }
    });
  });
  return result;
}

module.exports = {
  sheetSerialToMs,
  teamScopeAllows,
  relatedActiveItems,
  buildTeamByEmail,
  findViewer,
  groupCommentsByPost,
  visibleComments,
  visibleCommentsForPost,
  summarizeItemFull,
  needsAttentionFor,
  buildFeedEntry,
  buildFeedEntries,
  hasUnreadReply,
  hasAwaitingReply,
  countNotificationsForViewer,
  buildThreadSeenIndex_,
  parseReminderHours,
  computeReminderItemsForManager
};
