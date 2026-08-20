// run_tests.js
//
// getFeedTest/getNotificationsTest/getPostByIdTest 신규 parity 테스트.
// pollsignal-parity 폴더의 관례(apps_script_ref.js 대 실제 프로덕션 코드를 같은 입력으로
// 돌려 JSON.stringify 딥이퀄로 비교)를 그대로 따른다. 다만 이번엔 "직접 손으로 짠 포트"가
// 아니라 index.js가 실제로 require해서 쓰는 lib/feedEngine.js + lib/feedResponses.js를
// index.js의 getFeedTest/getNotificationsTest/getPostByIdTest와 정확히 같은 호출 순서로
// 그대로 구동한다(세션 인증/Sheets I/O 부분은 제외 — 그건 parity 대상이 아니라 이미
// lib/auth.js·lib/sheetsClient.js가 별도로 문법 검증됨).
//
// getFeedTest만 예외적으로 "현재 시각"이 결과에 영향을 준다(기간 컷오프). 실제
// lib/feedResponses.js의 buildGetFeedResponse는 Code.gs의 handleGetFeed_와 마찬가지로
// Date.now()를 직접 호출하므로(주입 불가), 이 테스트 파일 안에서만 임시로 Date.now을
// 고정값으로 바꿔치기한 뒤 원래대로 복구한다(Workflow 스크립트가 아닌 평범한 Node 테스트
// 파일이라 문제 없음).

const assert = require('assert');
const { makeAppsScriptRef } = require('./apps_script_ref');
const feedEngine = require('../../lib/feedEngine');
const feedResponses = require('../../lib/feedResponses');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// 공통 변환: 시나리오는 apps_script_ref.js가 바로 쓸 수 있는 "원본(ISO 문자열)" 모양으로
// 적고, lib/feedEngine.js용으로는 *Raw 필드로 옮겨 담는다(sheetSerialToMs가 숫자가
// 아니면 new Date(v).getTime()로 폴백하므로 ISO 문자열을 그대로 넣어도 apps_script_ref의
// new Date(...).getTime()과 동일한 값이 나온다 — pollsignal-parity와 동일한 전제).

function toEnginePost(p) { return { id: p.id, materialName: p.materialName, createdAtRaw: p.createdAt }; }
function toEngineItem(it) {
  return {
    itemId: it.itemId, customer: it.customer, itemName: it.itemName, manager: it.manager,
    team: it.team, materials: it.materials, status: it.status, registeredAtRaw: it.registeredAt
  };
}
function toEngineComment(cm) {
  return {
    commentId: cm.commentId, postId: cm.postId, itemId: cm.itemId, authorEmail: cm.authorEmail,
    authorName: cm.authorName, authorRole: cm.authorRole, parentCommentId: cm.parentCommentId,
    content: cm.content, createdAtRaw: cm.createdAt
  };
}
function toEngineViewer(user) {
  return { email: user.email, name: user.name, role: user.role, team: user.team, lastCheckedAtRaw: user.lastCheckedAt };
}

// ===========================================================================
// 1. getFeedTest: 기간 컷오프 + hasUnconfirmed 예외 + totalNeedsAttention(필터 전 집계) +
//    cursor/limit 페이지네이션.
// ===========================================================================

const NOW_MS = Date.parse('2026-08-20T00:00:00.000Z'); // 오늘(2026-08-20) 기준 고정.
const FEED_DISPLAY_DAYS = 14; // 컷오프 = 2026-08-06T00:00:00.000Z

const feedCases = [];
function addFeedCase(name, desc, { user, posts, items, comments, teamByEmail, leadScope, body }) {
  feedCases.push({
    name, desc, user, posts, items, comments,
    teamByEmail: teamByEmail || {}, leadScope: leadScope || null, body: body || {}
  });
}

addFeedCase('F1', '기간 내 게시물(확인됨)은 포함, 기간 밖 미확인 게시물은 hasUnconfirmed로 포함, 기간 밖 확인된 게시물은 제외 -> totalNeedsAttention은 필터 전 집계', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: '2026-08-01T00:00:00.000Z' },
  posts: [
    { id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }, // 기간 내
    { id: 'P2', materialName: '철', createdAt: '2026-07-01T00:00:00.000Z' },   // 기간 밖, 미확인
    { id: 'P3', materialName: '알루미늄', createdAt: '2026-07-05T00:00:00.000Z' } // 기간 밖, 확인됨(답변 불필요)
  ],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '철', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-3', customer: 'C3', itemName: 'I3', manager: '최담당', team: 'A', materials: '알루미늄', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [
    // P1/IT-1: 이팀장 본인이 마지막 댓글 -> confirmed, needsAttention false
    { commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: '', content: '확인', createdAt: '2026-08-15T01:00:00.000Z' },
    // P2/IT-2: 댓글 없음 -> 미확인, hasUnconfirmed로 기간 밖이어도 포함되고 needsAttention true
    // P3/IT-3: 다른 사람이 lastCheckedAt 이전에 댓글 -> confirmed, needsAttention false
    { commentId: 'c3', postId: 'P3', itemId: 'IT-3', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-07-31T00:00:00.000Z' }
  ],
  teamByEmail: { 'lead@t': 'A', 'staff@t': 'A' },
  leadScope: '전체',
  body: { cursor: 0, limit: 25 }
});

addFeedCase('F2', '동일 데이터를 cursor=0,limit=1로 페이지네이션 -> 최신순 1건 + nextCursor=1', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: '2026-08-01T00:00:00.000Z' },
  posts: [
    { id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' },
    { id: 'P2', materialName: '철', createdAt: '2026-07-01T00:00:00.000Z' }
  ],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '철', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [
    { commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: '', content: '확인', createdAt: '2026-08-15T01:00:00.000Z' }
    // P2/IT-2: 댓글 없음 -> hasUnconfirmed로 기간 밖이어도 포함
  ],
  teamByEmail: { 'lead@t': 'A' },
  leadScope: '전체',
  body: { cursor: 0, limit: 1 }
});

addFeedCase('F3', 'cursor=1,limit=1 -> 다음 페이지(P2), nextCursor=null', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: '2026-08-01T00:00:00.000Z' },
  posts: [
    { id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' },
    { id: 'P2', materialName: '철', createdAt: '2026-07-01T00:00:00.000Z' }
  ],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '철', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [
    { commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: '', content: '확인', createdAt: '2026-08-15T01:00:00.000Z' }
  ],
  teamByEmail: { 'lead@t': 'A' },
  leadScope: '전체',
  body: { cursor: 1, limit: 1 }
});

addFeedCase('F4', '팀 스코프 밖 품목만 있는 게시물은 애초에 entries에서 빠져 결과에도, totalNeedsAttention에도 잡히지 않음', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '자기팀',
  body: { cursor: 0, limit: 25 }
});

function runGetFeedViaAppsScriptRef(c) {
  const ref = makeAppsScriptRef(c.leadScope);
  return ref.handleGetFeed_(c.user, c.posts, c.items, c.comments, c.teamByEmail, FEED_DISPLAY_DAYS, c.body, NOW_MS);
}

function runGetFeedViaRealPort(c) {
  const viewer = toEngineViewer(c.user);
  const allPosts = c.posts.map(toEnginePost);
  const allItems = c.items.map(toEngineItem);
  const allComments = c.comments.map(toEngineComment);

  const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, c.leadScope, c.teamByEmail);

  const realDateNow = Date.now;
  Date.now = function () { return NOW_MS; };
  try {
    return feedResponses.buildGetFeedResponse(entries, { cursor: c.body.cursor, limit: c.body.limit, feedDisplayDays: FEED_DISPLAY_DAYS });
  } finally {
    Date.now = realDateNow;
  }
}

// ===========================================================================
// 2. getNotificationsTest: 담당 역할일 때만 비활성 담당 품목은 그대로, 활성 담당 품목은
//    본인 것만 남기는 재필터 + 알림 전용 필드로 축약. 비담당 역할은 필터 없음.
// ===========================================================================

const notifCases = [];
function addNotifCase(name, desc, { user, posts, items, comments, teamByEmail, leadScope, allUsers }) {
  notifCases.push({ name, desc, user, posts, items, comments, teamByEmail: teamByEmail || {}, leadScope: leadScope || null, allUsers });
}

addNotifCase('N1', '담당 역할: 본인 담당(활성) 유지 / 비활성 담당은 남 것이어도 유지 / 활성인 남의 담당은 제거', {
  user: { email: 'kim@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-3', customer: 'C3', itemName: 'I3', manager: '최담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [],
  teamByEmail: {},
  leadScope: null,
  allUsers: [
    { email: 'kim@t', name: '김담당', role: '담당', team: 'A', status: '활성' },
    { email: 'park@t', name: '박담당', role: '담당', team: 'A', status: '비활성' },
    { email: 'choi@t', name: '최담당', role: '담당', team: 'A', status: '활성' }
  ]
});

addNotifCase('N2', '비담당(팀장) 역할: 담당 활성/비활성 관계없이 필터 없음(모든 품목 유지)', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [],
  teamByEmail: {},
  leadScope: '전체',
  allUsers: [
    { email: 'kim@t', name: '김담당', role: '담당', team: 'A', status: '활성' },
    { email: 'park@t', name: '박담당', role: '담당', team: 'A', status: '활성' }
  ]
});

function toAppsScriptUsersRaw(allUsers) {
  // Code.gs가 getSheetValues_(SHEET_USER)로 다시 읽는 원본 행(email,name,role,team,status,...)과
  // 대응. handleGetNotifications_은 row[1]=name, row[4]=status만 쓴다.
  return allUsers.map(function (u) { return [u.email, u.name, u.role, u.team, u.status]; });
}

function runGetNotificationsViaAppsScriptRef(c) {
  const ref = makeAppsScriptRef(c.leadScope);
  return ref.handleGetNotifications_(c.user, c.posts, c.items, c.comments, c.teamByEmail, toAppsScriptUsersRaw(c.allUsers));
}

function runGetNotificationsViaRealPort(c) {
  const viewer = toEngineViewer(c.user);
  const allPosts = c.posts.map(toEnginePost);
  const allItems = c.items.map(toEngineItem);
  const allComments = c.comments.map(toEngineComment);
  const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, c.leadScope, c.teamByEmail);
  return feedResponses.buildGetNotificationsResponse(entries, viewer, c.allUsers);
}

// ===========================================================================
// 3. getPostByIdTest: 성공 / NOT_FOUND(게시물 없음) / FORBIDDEN(게시물은 있으나 뷰어에게
//    보이는 품목이 하나도 없음) 세 가지 결과.
// ===========================================================================

const postByIdCases = [];
function addPostByIdCase(name, desc, { user, posts, items, comments, teamByEmail, leadScope, postId }) {
  postByIdCases.push({ name, desc, user, posts, items, comments, teamByEmail: teamByEmail || {}, leadScope: leadScope || null, postId });
}

addPostByIdCase('B1', '성공: 게시물 존재 + 뷰어에게 보이는 품목 있음', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [{ commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'viewer@t', authorRole: '일반', parentCommentId: '', content: '확인', createdAt: '2026-08-15T01:00:00.000Z' }],
  teamByEmail: { 'viewer@t': 'A' },
  postId: 'P1'
});

addPostByIdCase('B2', 'NOT_FOUND: postId가 어떤 게시물과도 일치하지 않음', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  postId: 'P-DOES-NOT-EXIST'
});

addPostByIdCase('B3', 'FORBIDDEN: 게시물은 있으나 뷰어 팀(B) 기준으로 보이는 품목이 하나도 없음', {
  user: { email: 'viewer@t', role: '일반', team: 'B', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-15T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  postId: 'P1'
});

function runGetPostByIdViaAppsScriptRef(c) {
  const ref = makeAppsScriptRef(c.leadScope);
  return ref.handleGetPostById_(c.user, c.posts, c.items, c.comments, c.teamByEmail, c.postId);
}

// index.js의 getPostByIdTest와 정확히 같은 순서: allPosts.find(===) -> 없으면 NOT_FOUND ->
// buildFeedEntry -> null이면 FORBIDDEN -> 있으면 buildPostDetailResponse.
function runGetPostByIdViaRealPort(c) {
  const viewer = toEngineViewer(c.user);
  const allPosts = c.posts.map(toEnginePost);
  const allItems = c.items.map(toEngineItem);
  const allComments = c.comments.map(toEngineComment);

  const post = allPosts.find(function (p) { return p.id === c.postId; });
  if (!post) return { ok: false, error: 'NOT_FOUND' };

  const commentsByPost = feedEngine.groupCommentsByPost(allComments);
  const entry = feedEngine.buildFeedEntry(viewer, post, allItems, commentsByPost, c.leadScope, c.teamByEmail);
  if (!entry) return { ok: false, error: 'FORBIDDEN' };

  return feedResponses.buildPostDetailResponse(entry);
}

// ===========================================================================
// 실행 + 비교
// ===========================================================================

assert.strictEqual(feedCases.length, 4, 'getFeed 시나리오는 4개여야 함');
assert.strictEqual(notifCases.length, 2, 'getNotifications 시나리오는 2개여야 함');
assert.strictEqual(postByIdCases.length, 3, 'getPostById 시나리오는 3개여야 함');

const allResults = [];

for (const c of feedCases) {
  const appsScriptResult = runGetFeedViaAppsScriptRef(c);
  const realPortResult = runGetFeedViaRealPort(c);
  allResults.push({ group: 'getFeed', name: c.name, desc: c.desc, appsScriptResult, realPortResult, same: deepEqual(appsScriptResult, realPortResult) });
}

for (const c of notifCases) {
  const appsScriptResult = runGetNotificationsViaAppsScriptRef(c);
  const realPortResult = runGetNotificationsViaRealPort(c);
  allResults.push({ group: 'getNotifications', name: c.name, desc: c.desc, appsScriptResult, realPortResult, same: deepEqual(appsScriptResult, realPortResult) });
}

for (const c of postByIdCases) {
  const appsScriptResult = runGetPostByIdViaAppsScriptRef(c);
  const realPortResult = runGetPostByIdViaRealPort(c);
  allResults.push({ group: 'getPostById', name: c.name, desc: c.desc, appsScriptResult, realPortResult, same: deepEqual(appsScriptResult, realPortResult) });
}

console.log(JSON.stringify(allResults, null, 2));

const allSame = allResults.every(function (r) { return r.same; });
console.error('\n=== SUMMARY (getFeedTest/getNotificationsTest/getPostByIdTest vs Apps Script 기준) ===');
for (const r of allResults) {
  console.error('[' + r.group + '] case ' + r.name + ': ' + (r.same ? 'MATCH' : 'MISMATCH'));
}
console.error(allSame ? ('ALL ' + allResults.length + ' CASES MATCH') : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
