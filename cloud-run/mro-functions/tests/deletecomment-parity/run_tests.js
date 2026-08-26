const { handleDeleteComment_ } = require('./apps_script_ref');
const { deleteCommentTestLogic_ } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// 댓글 시트 컬럼: A=commentId,B=postId,C=itemId,D=authorEmail,E=authorName,F=authorRole,
// G=parentCommentId,H=content,I=createdAt
const HEADER = ['commentId', 'postId', 'itemId', 'authorEmail', 'authorName', 'authorRole', 'parentCommentId', 'content', 'createdAt'];

const cases = [];
function addCase(name, desc, { user, rows, body }) {
  cases.push({ name, desc, user, rows, body });
}

// ---- 1: commentId 없음 -> MISSING_FIELDS ----
addCase('1', 'commentId 없음 -> MISSING_FIELDS', {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '내용', 100]],
  body: { commentId: '' }
});

// ---- 2: 댓글 시트에 데이터 행이 하나도 없음(lastRow < 2) -> COMMENT_NOT_FOUND ----
addCase('2', '댓글 시트에 데이터 행이 하나도 없음 -> COMMENT_NOT_FOUND', {
  user: { email: 'a@nkmro.com' },
  rows: [],
  body: { commentId: 'C-1' }
});

// ---- 3: 존재하지 않는 commentId -> COMMENT_NOT_FOUND ----
addCase('3', '존재하지 않는 commentId -> COMMENT_NOT_FOUND', {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '내용', 100]],
  body: { commentId: 'C-999' }
});

// ---- 4: 다른 사람이 쓴 댓글 삭제 시도 -> FORBIDDEN_NOT_AUTHOR ----
addCase('4', '다른 사람이 작성한 댓글을 삭제 시도 -> FORBIDDEN_NOT_AUTHOR', {
  user: { email: 'b@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '내용', 100]],
  body: { commentId: 'C-1' }
});

// ---- 5: 중간 행 삭제 -> 나머지 행 순서 유지 ----
addCase('5', '중간 행(C-2) 삭제 -> 나머지 행(C-1, C-3) 순서 그대로 유지', {
  user: { email: 'b@nkmro.com' },
  rows: [
    ['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '첫댓글', 100],
    ['C-2', 'P-1', 'IT-1', 'b@nkmro.com', 'B', '팀장', 'C-1', '지울댓글', 200],
    ['C-3', 'P-1', 'IT-1', 'c@nkmro.com', 'C', '담당', 'C-1', '세번째댓글', 300]
  ],
  body: { commentId: 'C-2' }
});

// ---- 6: 마지막 남은 1개 댓글 삭제 -> 빈 배열 ----
addCase('6', '마지막 남은 댓글 1개를 삭제 -> 데이터 행이 0개가 됨', {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '내용', 100]],
  body: { commentId: 'C-1' }
});

// ---- 7: 이메일 대소문자/공백 무시 매칭 ----
addCase('7', "작성자 이메일 대소문자/앞뒤 공백이 달라도(' A@NKMRO.com ') 본인으로 인정 -> 정상 삭제", {
  user: { email: ' A@NKMRO.com ' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '내용', 100]],
  body: { commentId: 'C-1' }
});

// ---- 8: 첫 번째 행 삭제 -> 두 번째 행이 첫 자리로 당겨짐 ----
addCase('8', '첫 번째 행(C-1) 삭제 -> 남은 행(C-2)이 그대로 유지됨', {
  user: { email: 'a@nkmro.com' },
  rows: [
    ['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '첫댓글', 100],
    ['C-2', 'P-1', 'IT-1', 'b@nkmro.com', 'B', '팀장', 'C-1', '답글', 200]
  ],
  body: { commentId: 'C-1' }
});

const results = [];
for (const c of cases) {
  // apps_script_ref는 헤더 포함 data(data[0]=헤더)를 받는다.
  const dataWithHeader = c.rows.length > 0 ? [HEADER].concat(JSON.parse(JSON.stringify(c.rows))) : [];
  // cloudrun_port는 헤더 없는 dataRows(A2:I)를 받는다.
  const dataRowsNoHeader = JSON.parse(JSON.stringify(c.rows));

  const appsScriptResult = handleDeleteComment_(c.user, dataWithHeader, c.body);
  const cloudRunResult = deleteCommentTestLogic_(c.user, dataRowsNoHeader, c.body);

  let same = appsScriptResult.ok === cloudRunResult.ok && appsScriptResult.error === cloudRunResult.error;
  if (same && appsScriptResult.ok) {
    // 헤더를 뺀 나머지가 최종적으로 시트에 남는 실제 데이터 — 두 표현이 논리적으로 같아야 한다.
    const asDataOnly = appsScriptResult.updatedSheetRows.slice(1);
    same = same && appsScriptResult.postId === cloudRunResult.postId
      && deepEqual(asDataOnly, cloudRunResult.updatedDataRows);
  }

  results.push({ name: c.name, desc: c.desc, input: { user: c.user, rows: c.rows, body: c.body }, appsScriptResult, cloudRunResult, same });
}

console.log(JSON.stringify(results, null, 2));

const allSame = results.every(r => r.same);
console.error('\n=== SUMMARY ===');
for (const r of results) {
  console.error(`case ${r.name}: ${r.same ? 'MATCH' : 'MISMATCH'}`);
}
console.error(allSame ? `ALL ${cases.length} CASES MATCH` : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
