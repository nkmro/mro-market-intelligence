// run_tests_against_feedEngine.js
//
// 2026-08-20 (2단계 구현 직후 검증). 기존 apps_script_ref.js/cloudrun_port.js/run_tests.js는
// 그대로 두고(원래 12/12 결과를 그대로 재현 가능하게 보존), 같은 12개 시나리오 데이터를
// "실제로 index.js가 require해서 쓰는" cloud-run/mro-functions/lib/feedEngine.js에
// 그대로 넣어 다시 비교한다. 목적은 손으로 다시 짠 cloudrun_port.js(기존 파일)가 아니라
// 실제 프로덕션 코드(lib/feedEngine.js)가 Apps Script 기준과 여전히 100% 일치하는지
// 확인하는 것 — pollSignalTest 리팩터링이 결과를 바꾸지 않았다는 직접적인 증거.
//
// 12개 시나리오 입력 데이터는 run_tests.js의 12개 addCase 호출과 값 하나까지 동일하게
// 옮겼다(다른 파일이라 require로 공유하지 않았을 뿐, 데이터는 그대로 복사).
//
// 필드 매핑: lib/feedEngine.js는 시트에서 막 읽은 "원본(시리얼 넘버 또는 문자열)"을
// *Raw 필드로 받는다는 전제이고, sheetSerialToMs()는 숫자가 아니면 new Date(v).getTime()로
// 폴백한다 — 이 테스트의 입력값은 전부 ISO 문자열이므로 기존 cloudrun_port.js/apps_script_ref.js가
// 쓰던 new Date(...).getTime()과 완전히 같은 경로를 타서, 시리얼 넘버 보정(9시간 오프셋)이
// 적용되지 않는다(원본 테스트도 마찬가지였음 — 서울 오프셋은 실제 시트 데이터일 때만 관여).

const assert = require('assert');
const { makeAppsScriptRef } = require('./apps_script_ref');
const feedEngine = require('../../lib/feedEngine');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];
function addCase(name, desc, { user, posts, items, comments, teamByEmail, leadScope }) {
  cases.push({ name, desc, user, posts, items, comments, teamByEmail: teamByEmail || {}, leadScope: leadScope || null });
}

addCase('1', '담당, 본인 담당 품목 중 미확인 품목 있음', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

addCase('2', '담당, 본인 담당 품목 확인됨 + 마지막 댓글도 본인이 씀', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [{ commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'u1@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-08-02T00:00:00.000Z' }]
});

addCase('3', '담당, 확인됨 + 마지막확인 이후 팀장이 새 답글', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: '2026-08-01T01:00:00.000Z' },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [
    { commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'u1@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-08-01T00:30:00.000Z' },
    { commentId: 'c2', postId: 'P1', itemId: 'IT-1', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: 'c1', content: '답장', createdAt: '2026-08-01T02:00:00.000Z' }
  ],
  teamByEmail: { 'u1@t': 'A', 'lead@t': 'A' }
});

addCase('4', '담당, 본인 담당이 아닌 품목만 있는 게시물(같은 팀이라 보이긴 함)', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '박담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

addCase('5', '팀장, 팀장_열람범위=자기팀, 다른 팀(B) 미확인 품목 -> 게시물 자체가 제외', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '자기팀'
});

addCase('6', '팀장, 팀장_열람범위=전체, 다른 팀(B) 미확인 품목 -> 보이고 답변 필요', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '전체'
});

addCase('7', '임원, 여러 팀(A,B)에 걸친 게시물 2개 -> 팀 구분 없이 다 보이고 정확히 판단', {
  user: { email: 'exec@t', role: '임원', team: 'A', name: '정임원', lastCheckedAt: '2026-08-01T00:00:00.000Z' },
  posts: [
    { id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'P2', materialName: '알루미늄', createdAt: '2026-08-01T00:00:00.000Z' }
  ],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '박담당', team: 'A', materials: '알루미늄', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [
    { commentId: 'c1', postId: 'P2', itemId: 'IT-2', authorEmail: 'exec@t', authorRole: '임원', parentCommentId: '', content: '확인', createdAt: '2026-08-01T00:30:00.000Z' }
  ],
  teamByEmail: { 'exec@t': 'A' },
  leadScope: '자기팀'
});

addCase('8', '일반, 본인 팀에 미확인 품목 있음 -> 보이지만 답변 필요는 항상 false', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

addCase('9', '팀장, lastCheckedAt 없음(0으로 취급) + 남이 쓴 댓글 존재 -> 답변 필요', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [
    { commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-08-01T00:30:00.000Z' }
  ],
  teamByEmail: { 'staff@t': 'A' },
  leadScope: '자기팀'
});

addCase('10', '품목 등록일이 게시물 작성일보다 나중 -> getRelatedItems_ 단계에서 제외', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-09-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '자기팀'
});

addCase('11', '게시물 3개(팀장), P1 미확인(true)/P2 확인+본인마지막(false)/P3 확인+타인 새답글(true) -> totalNeedsAttention=2', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: '2026-08-01T00:00:00.000Z' },
  posts: [
    { id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'P2', materialName: '철', createdAt: '2026-08-01T00:00:00.000Z' },
    { id: 'P3', materialName: '알루미늄', createdAt: '2026-08-01T00:00:00.000Z' }
  ],
  items: [
    { itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-2', customer: 'C2', itemName: 'I2', manager: '김담당', team: 'A', materials: '철', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' },
    { itemId: 'IT-3', customer: 'C3', itemName: 'I3', manager: '김담당', team: 'A', materials: '알루미늄', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }
  ],
  comments: [
    { commentId: 'c2', postId: 'P2', itemId: 'IT-2', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: '', content: '확인', createdAt: '2026-08-01T00:10:00.000Z' },
    { commentId: 'c3a', postId: 'P3', itemId: 'IT-3', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-07-31T00:00:00.000Z' },
    { commentId: 'c3b', postId: 'P3', itemId: 'IT-3', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: 'c3a', content: '추가', createdAt: '2026-08-01T05:00:00.000Z' }
  ],
  teamByEmail: { 'lead@t': 'A', 'staff@t': 'A' },
  leadScope: '자기팀'
});

addCase('12', '댓글이 없는 품목 -> commentCount 0, lastCommentAt null, confirmed false', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

assert.strictEqual(cases.length, 12, '12개 시나리오여야 함');

// index.js의 실제 pollSignalTest(리팩터링본)가 하는 것과 정확히 동일한 방식으로
// feedEngine을 호출하고, 정확히 같은 방식으로 signatures를 조립한다.
function runViaFeedEngine(c) {
  const viewer = {
    email: c.user.email,
    name: c.user.name,
    role: c.user.role,
    team: c.user.team,
    lastCheckedAtRaw: c.user.lastCheckedAt
  };
  const allPosts = c.posts.map(function (p) {
    return { id: p.id, materialName: p.materialName, createdAtRaw: p.createdAt };
  });
  const allItems = c.items.map(function (it) {
    return {
      itemId: it.itemId, customer: it.customer, itemName: it.itemName, manager: it.manager,
      team: it.team, materials: it.materials, status: it.status, registeredAtRaw: it.registeredAt
    };
  });
  const allComments = c.comments.map(function (cm) {
    return {
      commentId: cm.commentId, postId: cm.postId, itemId: cm.itemId, authorEmail: cm.authorEmail,
      authorName: cm.authorName, authorRole: cm.authorRole, parentCommentId: cm.parentCommentId,
      content: cm.content, createdAtRaw: cm.createdAt
    };
  });

  const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, c.leadScope, c.teamByEmail);

  let totalNeedsAttention = 0;
  const signatures = [];
  entries.forEach(function (entry) {
    if (entry.needsAttention) totalNeedsAttention += 1;
    entry.items.forEach(function (s) {
      signatures.push({
        postId: entry.post.id,
        itemId: s.itemId,
        commentCount: s.commentCount,
        lastCommentAt: s.lastCommentAtMs !== null ? new Date(s.lastCommentAtMs).toISOString() : null
      });
    });
  });

  return { ok: true, totalNeedsAttention: totalNeedsAttention, signatures: signatures };
}

function deepEqual2(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const results = [];
for (const c of cases) {
  const ref = makeAppsScriptRef(c.leadScope);
  const appsScriptResult = ref.handlePollSignal_(c.user, c.posts, c.items, c.comments, c.teamByEmail);
  const feedEngineResult = runViaFeedEngine(c);
  const same = deepEqual2(appsScriptResult, feedEngineResult);
  results.push({ name: c.name, desc: c.desc, appsScriptResult, feedEngineResult, same });
}

console.log(JSON.stringify(results, null, 2));

const allSame = results.every(function (r) { return r.same; });
console.error('\n=== SUMMARY (vs. real lib/feedEngine.js) ===');
for (const r of results) {
  console.error('case ' + r.name + ': ' + (r.same ? 'MATCH' : 'MISMATCH'));
}
console.error(allSame ? 'ALL 12 CASES MATCH (real lib/feedEngine.js)' : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
