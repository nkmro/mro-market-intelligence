// postCommentTest 코드 레벨 로직 parity 테스트 (2026-08-21, 합성 데이터 — 실제 시트/
// Firestore/Cloud Run 호출 없음). markThreadSeenTest 때와 동일한 두 그룹 구조를 따른다.
//
// A. 댓글 작성 검증 로직 parity (시나리오 1~13): apps_script_ref.js(Code.gs
//    handlePostComment_/isManagerForItem_ 포트) vs cloudrun_port.js(index.js
//    postCommentAction_/isManagerForItem_의 검증 로직 포트) — 둘 다 시트 조회/Sheets API
//    append/buildFeedEntry_ 기반 응답 재계산을 걷어낸 순수 함수 포트라서, "실제로 배포된
//    그 함수"가 아니라 "그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을 비교한다
//    (tests/markthreadseen-parity와 동일한 방식·한계).
//
//    updatedPost/comments 재계산(lib/feedEngine.js, lib/feedResponses.js)은 getFeedTest/
//    getPostByIdTest/getCommentsTest parity에서 이미 검증된 공용 모듈을 그대로 재사용하는
//    부분이라 이 테스트 범위에 포함하지 않는다(POSTCOMMENT_CLOUDRUN_DESIGN_v2.md 2-3/9번 참고).
//
// B. idempotency/세션 인증 정책 테스트 (시나리오 14~17): 포트가 아니라 lib/writeIdempotency.js의
//    withIdempotency()와 lib/auth.js의 authenticateSession()을 "실제 프로덕션 코드 그대로"
//    require해서, fake_firestore.js(인메모리 스텁)를 인자로 넘겨 직접 실행한다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handlePostComment_ } = require('./apps_script_ref');
const { postCommentAction_ } = require('./cloudrun_port');
const { FakeFirestore } = require('./fake_firestore');
const { withIdempotency } = require('../../lib/writeIdempotency');
const { authenticateSession } = require('../../lib/auth');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const results = [];

// ---------------------------------------------------------------------------
// 공용 합성 데이터
// ---------------------------------------------------------------------------
const POSTS = [
  { id: 'P1', materialCode: 'MC-1', materialName: '구리' },
  { id: 'P2', materialCode: 'MC-2', materialName: '알루미늄' }
];
const ITEMS = [
  { itemId: 'IT-1', manager: '김담당', materials: '구리,알루미늄' },
  { itemId: 'IT-2', manager: '박담당', materials: '구리' }
];
const NOW = '2026-08-21T00:00:00.000Z';

function viewer(email, name, role) {
  return { email, name, role };
}

// ---------------------------------------------------------------------------
// A. 댓글 작성 검증 로직 parity — apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runCase(name, desc, { user, body, comments }) {
  const a = handlePostComment_(user, body, POSTS, ITEMS, comments, 'cmt-fixed-id', NOW);
  const b = postCommentAction_(user, POSTS, ITEMS, comments, body, 'cmt-fixed-id', NOW);
  const same = deepEqual(a, b);
  results.push({ group: 'A', name, desc, appsScript: a, cloudRun: b, same });
}

// 1. 정상 — 첫 댓글, 담당소장(IT-1의 담당인 김담당)
runCase('1', '정상 댓글 작성 — 첫 댓글, 담당소장(자기 담당 품목)', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-1', content: '첫 댓글입니다', parentCommentId: '' },
  comments: []
});

// 2. 정상 — 답글, 팀장 (이미 댓글이 있는 품목에 자유롭게 답글)
runCase('2', '정상 댓글 작성 — 답글, 팀장(이미 댓글 있는 품목에 자유 답글)', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: 'IT-1', content: '답글입니다', parentCommentId: 'C1' },
  comments: [{ commentId: 'C1', postId: 'P1', itemId: 'IT-1', authorEmail: 'kim@nkmro.com' }]
});

// 3. 필수값 누락 — content 빈 문자열
runCase('3', '필수값 누락(content 빈 문자열) -> MISSING_FIELDS', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-1', content: '', parentCommentId: '' },
  comments: []
});

// 4. 존재하지 않는 게시물
runCase('4', '존재하지 않는 게시물(P999) -> POST_NOT_FOUND', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P999', itemId: 'IT-1', content: '내용', parentCommentId: '' },
  comments: []
});

// 5. 존재하지 않는 품목 — isManagerForItem_이 item을 못 찾아 false -> NOT_ASSIGNED_MANAGER
//    (별도의 "품목 없음" 에러 코드가 원본에 없다는 것 자체를 이 케이스로 확인한다 — 설계
//    문서 7번 표 참고)
runCase('5', '존재하지 않는 품목(IT-999) -> NOT_ASSIGNED_MANAGER (원본에 별도 코드 없음)', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-999', content: '내용', parentCommentId: '' },
  comments: []
});

// 6. 댓글 작성 권한 없음 — 일반 역할
runCase('6', '댓글 작성 권한 없음(일반 역할) -> FORBIDDEN_VIEWER', {
  user: viewer('user@nkmro.com', '일반사용자', '일반'),
  body: { postId: 'P1', itemId: 'IT-1', content: '내용', parentCommentId: '' },
  comments: []
});

// 7. 담당이지만 다른 사람 담당 품목의 첫 댓글 시도
runCase('7', '담당이지만 다른 담당자 품목의 첫 댓글 -> NOT_ASSIGNED_MANAGER', {
  user: viewer('other@nkmro.com', '최담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-1', content: '내용', parentCommentId: '' },
  comments: []
});

// 8. 첫 댓글인데 담당이 아닌 팀장이 시도
runCase('8', '첫 댓글에 팀장(비담당)이 시도 -> FIRST_COMMENT_MANAGER_ONLY', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: 'IT-1', content: '내용', parentCommentId: '' },
  comments: []
});

// 9. 첫 댓글에 parentCommentId 지정
runCase('9', '첫 댓글에 parentCommentId 지정 -> FIRST_COMMENT_CANNOT_HAVE_PARENT', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-1', content: '내용', parentCommentId: 'C-nonexistent' },
  comments: []
});

// 10. 답글인데 parentCommentId가 존재하지 않는 댓글을 가리킴 (itemId 있는 분기)
runCase('10', '답글의 parentCommentId가 존재하지 않음(itemId 분기) -> PARENT_COMMENT_NOT_FOUND', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: 'IT-1', content: '내용', parentCommentId: 'C-nonexistent' },
  comments: [{ commentId: 'C1', postId: 'P1', itemId: 'IT-1', authorEmail: 'kim@nkmro.com' }]
});

// 10b. 같은 케이스를 itemId 없는 분기에서도 확인
runCase('10b', '답글의 parentCommentId가 존재하지 않음(itemId 없는 분기) -> PARENT_COMMENT_NOT_FOUND', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: '', content: '내용', parentCommentId: 'C-nonexistent' },
  comments: [{ commentId: 'C1', postId: 'P1', itemId: 'IT-1', authorEmail: 'kim@nkmro.com' }]
});

// 11. itemId 없는 일반 댓글, 확인된 품목이 하나도 없음
runCase('11', 'itemId 없는 일반 댓글 + 확인된 품목 없음 -> NO_CONFIRMED_ITEM_YET', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: '', content: '내용', parentCommentId: '' },
  comments: []
});

// 12. itemId 없는 일반 댓글, 이미 확인된 품목이 있음 -> 성공
runCase('12', 'itemId 없는 일반 댓글 + 확인된 품목 있음 -> 성공(appendedRow)', {
  user: viewer('lead@nkmro.com', '이팀장', '팀장'),
  body: { postId: 'P1', itemId: '', content: '일반 댓글', parentCommentId: '' },
  comments: [{ commentId: 'C1', postId: 'P1', itemId: 'IT-1', authorEmail: 'kim@nkmro.com' }]
});

// 13. 댓글 내용 경계값 — 이모지/특수문자/긴 문자열도 길이 제한 없이 그대로 통과
runCase('13', '댓글 내용 경계값(이모지/특수문자/장문) -> 길이 제한 없이 성공', {
  user: viewer('kim@nkmro.com', '김담당', '담당'),
  body: { postId: 'P1', itemId: 'IT-1', content: '🙂'.repeat(50) + ' <script>"\'특수문자테스트' + 'x'.repeat(2000), parentCommentId: '' },
  comments: []
});

// ---------------------------------------------------------------------------
// B. idempotency/세션 인증 — 실제 lib/writeIdempotency.js, lib/auth.js를 그대로 실행
// ---------------------------------------------------------------------------
async function runIdempotencyCases() {
  // 14. idempotencyKey 중복 — 같은 키로 두 번 호출 시, 실제 작업(actionFn)은 한 번만 실행되고
  //     두 번째 호출은 캐시된 응답을 그대로 반환해야 함(에러 응답이어도 동일하게 캐시되는지
  //     함께 확인 — 설계 문서 2-5/idempotency 섹션의 "검증 에러도 캐시됨" 결론).
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () { callCount += 1; return { ok: false, error: 'MISSING_FIELDS', calledWith: callCount }; };
    const r1 = await withIdempotency(fs, 'dup-key-1', 'postComment', actionFn);
    const r2 = await withIdempotency(fs, 'dup-key-1', 'postComment', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && r1.error === 'MISSING_FIELDS';
    results.push({
      group: 'B', name: '14', desc: 'idempotencyKey 중복 -> actionFn 1회만 실행, 에러 응답도 그대로 캐시',
      detail: { callCount, r1, r2 }, same: pass
    });
  }

  // 15-a. IN_PROGRESS 상태에서 짧게 폴링하는 중 DONE으로 바뀌면 그 결과를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('inprogress-key-a');
    await docRef.set({ action: 'postComment', status: 'IN_PROGRESS', createdAt: new Date() });
    setTimeout(function () { docRef.update({ status: 'DONE', response: { ok: true, commentId: 'from-other-process' } }); }, 700);
    const r = await withIdempotency(fs, 'inprogress-key-a', 'postComment', async function () {
      throw new Error('actionFn이 호출되면 안 됨(이미 다른 프로세스가 선점 중)');
    });
    const pass = deepEqual(r, { ok: true, commentId: 'from-other-process' });
    results.push({
      group: 'B', name: '15-a', desc: 'IN_PROGRESS -> 폴링 중 DONE으로 전환 -> 그 응답을 그대로 받음(중복 append 방지)',
      detail: { r }, same: pass
    });
  }

  // 15-b. IN_PROGRESS 상태가 끝까지 안 풀리면 DUPLICATE_IN_PROGRESS_RETRY_LATER를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('inprogress-key-b');
    await docRef.set({ action: 'postComment', status: 'IN_PROGRESS', createdAt: new Date() });
    const r = await withIdempotency(fs, 'inprogress-key-b', 'postComment', async function () {
      throw new Error('actionFn이 호출되면 안 됨');
    });
    const pass = deepEqual(r, { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' });
    results.push({
      group: 'B', name: '15-b', desc: 'IN_PROGRESS가 끝까지 안 풀림 -> DUPLICATE_IN_PROGRESS_RETRY_LATER',
      detail: { r }, same: pass
    });
  }

  // 16. 애매한 실패 후 같은 키로 재시도 시나리오(설계 문서 3-2) — actionFn이 예외를 던지면
  //     선점 문서가 삭제되어, 같은 키로 다시 요청하면 처음부터 재시도(재실행)되어야 함.
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const flakyActionFn = async function () {
      callCount += 1;
      if (callCount === 1) throw new Error('시뮬레이션된 애매한 실패(타임아웃 등)');
      return { ok: true, commentId: 'succeeded-on-retry' };
    };
    let firstErr = null;
    try {
      await withIdempotency(fs, 'retry-key-1', 'postComment', flakyActionFn);
    } catch (e) {
      firstErr = e;
    }
    const r2 = await withIdempotency(fs, 'retry-key-1', 'postComment', flakyActionFn);
    const pass = firstErr !== null && callCount === 2 && r2.ok === true && r2.commentId === 'succeeded-on-retry';
    results.push({
      group: 'B', name: '16', desc: '애매한 실패(예외) 후 같은 키로 재시도 -> 선점 해제되어 재실행 성공(3-2 정책 검증)',
      detail: { callCount, r2 }, same: pass
    });
  }

  // 17. 세션 오류 — authenticateSession(lib/auth.js, 실제 코드)을 fake_firestore로 직접 실행
  {
    const fs = new FakeFirestore();
    const now = Date.now();
    await fs.collection('sessions').doc('expired-token').set({ email: 'kim@nkmro.com', expiresAt: new Date(now - 1000) });
    await fs.collection('sessions').doc('valid-token').set({ email: 'kim@nkmro.com', expiresAt: new Date(now + 3600 * 1000) });

    const noToken = await authenticateSession(fs, null);
    const notFound = await authenticateSession(fs, 'no-such-token');
    const expired = await authenticateSession(fs, 'expired-token');
    const valid = await authenticateSession(fs, 'valid-token');

    const pass =
      noToken.ok === false && noToken.status === 400 && noToken.error === 'MISSING_SESSION_TOKEN' &&
      notFound.ok === false && notFound.status === 200 && notFound.error === 'SESSION_NOT_FOUND' &&
      expired.ok === false && expired.status === 200 && expired.error === 'SESSION_EXPIRED' &&
      valid.ok === true && valid.email === 'kim@nkmro.com';

    results.push({
      group: 'B', name: '17', desc: '세션 오류 4종(토큰없음/세션없음/만료/정상) -> 에러 코드 표와 일치',
      detail: { noToken, notFound, expired, valid }, same: pass
    });
  }
}

(async function main() {
  await runIdempotencyCases();

  console.log(JSON.stringify(results, null, 2));

  console.error('\n=== SUMMARY (postCommentTest 코드 레벨 parity/정책 테스트) ===');
  for (const r of results) {
    console.error(`[${r.group}] case ${r.name}: ${r.same ? 'PASS' : 'FAIL'} - ${r.desc}`);
  }
  const allPass = results.every(function (r) { return r.same; });
  console.error(allPass ? '\nALL CASES PASS' : '\nSOME CASES FAIL');
  process.exitCode = allPass ? 0 : 1;
})();
