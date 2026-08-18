const assert = require('assert');
const { makeAppsScriptRef } = require('./apps_script_ref');
const { pollSignalTest } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];

function addCase(name, desc, { user, posts, items, comments, teamByEmail, leadScope }) {
  cases.push({ name, desc, user, posts, items, comments, teamByEmail: teamByEmail || {}, leadScope: leadScope || null });
}

// ---- 1: 담당, 본인 담당 품목 미확인 ----
addCase('1', '담당, 본인 담당 품목 중 미확인 품목 있음', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

// ---- 2: 담당, 확인됨 + 마지막 댓글 본인 ----
addCase('2', '담당, 본인 담당 품목 확인됨 + 마지막 댓글도 본인이 씀', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [{ commentId: 'c1', postId: 'P1', itemId: 'IT-1', authorEmail: 'u1@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-08-02T00:00:00.000Z' }]
});

// ---- 3: 담당, 확인됐지만 팀장이 마지막확인 이후 새 답글 ----
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

// ---- 4: 담당, 본인 담당 아닌 품목만 있는 게시물 ----
addCase('4', '담당, 본인 담당이 아닌 품목만 있는 게시물(같은 팀이라 보이긴 함)', {
  user: { email: 'u1@t', role: '담당', team: 'A', name: '김담당', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '박담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

// ---- 5: 팀장, 자기팀 범위, 다른 팀 미확인 품목 -> 전체 제외 ----
addCase('5', '팀장, 팀장_열람범위=자기팀, 다른 팀(B) 미확인 품목 -> 게시물 자체가 제외', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '자기팀'
});

// ---- 6: 팀장, 전체 범위, 같은 B팀 미확인 품목 -> 보이고 needsAttention true ----
addCase('6', '팀장, 팀장_열람범위=전체, 다른 팀(B) 미확인 품목 -> 보이고 답변 필요', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '최담당', team: 'B', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '전체'
});

// ---- 7: 임원, 여러 팀 걸친 여러 게시물 ----
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

// ---- 8: 일반, 본인 팀 미확인 품목 -> 보이지만 needsAttention 항상 false ----
addCase('8', '일반, 본인 팀에 미확인 품목 있음 -> 보이지만 답변 필요는 항상 false', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

// ---- 9: lastCheckedAt 없음(한 번도 확인 안 함) ----
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

// ---- 10: 품목 등록일이 게시물 작성일보다 나중 -> 후보 제외 ----
addCase('10', '품목 등록일이 게시물 작성일보다 나중 -> getRelatedItems_ 단계에서 제외', {
  user: { email: 'lead@t', role: '팀장', team: 'A', name: '이팀장', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-09-01T00:00:00.000Z' }],
  comments: [],
  leadScope: '자기팀'
});

// ---- 11: 게시물 여러 개, 일부만 needsAttention true -> 합계 확인 ----
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
    // P2: 확인됨, 마지막 댓글이 팀장 본인
    { commentId: 'c2', postId: 'P2', itemId: 'IT-2', authorEmail: 'lead@t', authorRole: '팀장', parentCommentId: '', content: '확인', createdAt: '2026-08-01T00:10:00.000Z' },
    // P3: 확인됨(첫 댓글은 마지막확인 이전), 이후 타인이 새 답글(마지막확인 이후)
    { commentId: 'c3a', postId: 'P3', itemId: 'IT-3', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: '', content: '확인', createdAt: '2026-07-31T00:00:00.000Z' },
    { commentId: 'c3b', postId: 'P3', itemId: 'IT-3', authorEmail: 'staff@t', authorRole: '담당', parentCommentId: 'c3a', content: '추가', createdAt: '2026-08-01T05:00:00.000Z' }
  ],
  teamByEmail: { 'lead@t': 'A', 'staff@t': 'A' },
  leadScope: '자기팀'
});

// ---- 12: 댓글이 없는 품목(완전 미확인) ----
addCase('12', '댓글이 없는 품목 -> commentCount 0, lastCommentAt null, confirmed false', {
  user: { email: 'viewer@t', role: '일반', team: 'A', name: '최일반', lastCheckedAt: null },
  posts: [{ id: 'P1', materialName: '구리', createdAt: '2026-08-01T00:00:00.000Z' }],
  items: [{ itemId: 'IT-1', customer: 'C1', itemName: 'I1', manager: '김담당', team: 'A', materials: '구리', status: '활성', registeredAt: '2026-01-01T00:00:00.000Z' }],
  comments: []
});

const results = [];
for (const c of cases) {
  const ref = makeAppsScriptRef(c.leadScope);
  const appsScriptResult = ref.handlePollSignal_(c.user, c.posts, c.items, c.comments, c.teamByEmail);
  const cloudRunResult = pollSignalTest(c.user, c.posts, c.items, c.comments, c.teamByEmail, c.leadScope);
  const same = deepEqual(appsScriptResult, cloudRunResult);
  results.push({ name: c.name, desc: c.desc, input: c, appsScriptResult, cloudRunResult, same });
}

console.log(JSON.stringify(results, null, 2));

const allSame = results.every(r => r.same);
console.error('\n=== SUMMARY ===');
for (const r of results) {
  console.error(`case ${r.name}: ${r.same ? 'MATCH' : 'MISMATCH'}`);
}
console.error(allSame ? 'ALL 12 CASES MATCH' : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
