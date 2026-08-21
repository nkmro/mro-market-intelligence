# postCommentTest 코드 레벨 parity/정책 테스트 (2026-08-21)

합성(가짜) 데이터로만 실행한다. 실제 시트/Firestore/Cloud Run에는 어떤 네트워크 호출도 하지 않는다.
`markThreadSeenTest` parity 테스트(`tests/markthreadseen-parity/`)와 동일한 방법론을 따른다.

## A그룹 (시나리오 1~13) — 댓글 작성 검증 로직 parity

`apps_script_ref.js`(Code.gs `handlePostComment_`/`isManagerForItem_` 포트) vs
`cloudrun_port.js`(index.js `postCommentAction_`/`isManagerForItem_`의 검증 로직 포트). 둘 다
시트 조회, Sheets API append, `buildFeedEntry_` 기반 응답 재계산을 걷어낸 순수 함수 포트다 —
"실제로 배포된 그 함수"가 아니라 "그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을 비교한다.

`updatedPost`/`comments` 재계산(`lib/feedEngine.js`, `lib/feedResponses.js`)은 이 테스트
범위에 포함하지 않는다 — `getFeedTest`/`getPostByIdTest`/`getCommentsTest` parity에서 이미
검증된 공용 모듈을 그대로 재사용하는 부분이라 새 로직이 없기 때문이다
(`POSTCOMMENT_CLOUDRUN_DESIGN_v2.md` 2-3/9번 참고).

다룬 시나리오: 정상(첫 댓글/답글), 필수값 누락, 존재하지 않는 게시물, 존재하지 않는 품목,
권한 없음(일반), 다른 담당자 품목 첫 댓글, 첫 댓글에 비담당자, 첫 댓글에 parentCommentId,
답글의 parentCommentId 없음(itemId 있는/없는 분기 둘 다), 확인된 품목 없는 일반 댓글,
확인된 품목 있는 일반 댓글, 댓글 내용 경계값(이모지/특수문자/장문).

## B그룹 (시나리오 14~17) — idempotency/세션 인증 정책 테스트

포트가 아니라, `lib/writeIdempotency.js`의 `withIdempotency()`와 `lib/auth.js`의
`authenticateSession()`을 **실제 프로덕션 코드 그대로** require해서 `fake_firestore.js`
(인메모리 Firestore 스텁)를 인자로 넘겨 직접 실행한다.

- 시나리오 14: 같은 idempotencyKey로 두 번 호출 -> 실제 작업(actionFn)은 1회만 실행되고,
  **에러 응답이어도** 그대로 캐시되어 재검증 없이 반환되는지(설계 문서 "검증 에러도 캐시됨" 결론).
- 시나리오 15: IN_PROGRESS 상태 -> (a) 폴링 중 DONE으로 바뀌면 그 응답을 받는지(중복 append
  방지 확인), (b) 끝까지 안 풀리면 `DUPLICATE_IN_PROGRESS_RETRY_LATER`를 받는지.
- 시나리오 16: 설계 문서 3-2(애매한 실패 시 정책) 검증 — actionFn이 예외(타임아웃 등 시뮬레이션)를
  던지면 선점 문서가 삭제되고, 같은 idempotencyKey로 다시 요청하면 처음부터 재실행되어
  성공할 수 있는지.
- 시나리오 17: `sessionToken` 없음/존재하지 않음/만료/정상 4가지 -> 에러 코드가 설계 문서의
  표와 일치하는지.

## 실행 방법

```bash
cd cloud-run/mro-functions
npm install   # @google-cloud/firestore(FieldValue) 의존성 필요, 로컬 검증용
node tests/postcomment-parity/run_tests.js
```

## 결과 (2026-08-21)

`results.json`에 17개 케이스(A그룹 13개 + B그룹 4개, 시나리오 15는 15-a/15-b로 분리) 전부
`PASS`로 기록되어 있다. **이 결과는 코드 레벨 로직 검증이며, 실제 GCP 배포/실데이터 통합
테스트를 대체하지 않는다** — 그건 별도 승인 후 다음 단계에서 진행한다. 특히 `updatedPost`/
`comments` 응답 조립(`lib/feedEngine.js`/`lib/feedResponses.js` 재사용 부분)은 이 parity
테스트가 다루지 않으므로, 실제 프로덕션 데이터로 그 계산까지 확인하는 것도 다음 단계 대상이다.
