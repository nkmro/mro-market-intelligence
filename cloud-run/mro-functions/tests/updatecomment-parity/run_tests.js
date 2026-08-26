const { handleUpdateComment_ } = require('./apps_script_ref');
const { updateCommentTestLogic_ } = require('./cloudrun_port');

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
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: '', content: '새 내용' }
});

// ---- 2: content가 공백만 -> trim 후 빈 문자열 -> MISSING_FIELDS ----
addCase('2', "content가 공백만('   ') -> trim 후 빈 문자열 -> MISSING_FIELDS", {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: 'C-1', content: '   ' }
});

// ---- 3: 존재하지 않는 commentId -> COMMENT_NOT_FOUND ----
addCase('3', '존재하지 않는 commentId -> COMMENT_NOT_FOUND', {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: 'C-999', content: '새 내용' }
});

// ---- 4: 다른 사람이 쓴 댓글 수정 시도 -> FORBIDDEN_NOT_AUTHOR ----
addCase('4', '다른 사람이 작성한 댓글을 수정 시도 -> FORBIDDEN_NOT_AUTHOR', {
  user: { email: 'b@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: 'C-1', content: '새 내용' }
});

// ---- 5: 정상 수정 -> H열만 바뀌고 나머지 열은 그대로, postId 반환 ----
addCase('5', '본인 댓글 정상 수정 -> content(H열)만 바뀌고 나머지 열은 그대로', {
  user: { email: 'a@nkmro.com' },
  rows: [
    ['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100],
    ['C-2', 'P-1', 'IT-1', 'b@nkmro.com', 'B', '팀장', 'C-1', '다른댓글', 200]
  ],
  body: { commentId: 'C-1', content: '수정된 내용' }
});

// ---- 6: 이메일 대소문자/공백 무시 매칭 ----
addCase('6', "작성자 이메일 대소문자/앞뒤 공백이 달라도(' A@NKMRO.com ') 본인으로 인정 -> 정상 수정", {
  user: { email: ' A@NKMRO.com ' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: 'C-1', content: '수정된 내용' }
});

// ---- 7: content 앞뒤 공백은 trim되어 저장 ----
addCase('7', "content 앞뒤 공백('  새 내용  ')은 trim되어 저장됨", {
  user: { email: 'a@nkmro.com' },
  rows: [['C-1', 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: 'C-1', content: '  새 내용  ' }
});

// ---- 8: commentId가 숫자로 들어와도 String() 비교로 매칭 ----
addCase('8', 'commentId가 문자열이 아니어도(느슨한 타입) String() 비교로 매칭됨', {
  user: { email: 'a@nkmro.com' },
  rows: [[123, 'P-1', 'IT-1', 'a@nkmro.com', 'A', '담당', '', '원래내용', 100]],
  body: { commentId: '123', content: '수정된 내용' }
});

const results = [];
for (const c of cases) {
  // apps_script_ref는 헤더 포함 data(data[0]=헤더)를 받는다.
  const dataWithHeader = [HEADER].concat(JSON.parse(JSON.stringify(c.rows)));
  // cloudrun_port는 헤더 없는 dataRows(A2:I)를 받는다.
  const dataRowsNoHeader = JSON.parse(JSON.stringify(c.rows));

  const appsScriptResult = handleUpdateComment_(c.user, dataWithHeader, c.body);
  const cloudRunResult = updateCommentTestLogic_(c.user, dataRowsNoHeader, c.body);

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
