# updateComment 로직 비교 테스트 (2026-08-26, 1단계 — 실제 코드/배포 변경 없음)

2026-08-25 채팅에서 승인된 분석/계획(2순위, 댓글 수정/삭제 이전)의 `updateComment`에 대한
1단계(로직 단위 비교) 결과입니다. `postcomment-parity`와 동일한 관례를 따릅니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 8개 시나리오 모두 직접
만든 가상의 댓글 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법 및 범위

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `handleUpdateComment_`(2446~2467행)를,
  시트 읽기 부분만 값 주입(헤더 포함 data 배열을 직접 전달)으로 바꾼 코드로 실행
  (`apps_script_ref.js`).
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `updateCommentAction_` 안에서
  "대상 댓글 행을 찾아 권한을 검사하고 content(H열)를 바꾸는" 부분만 그대로 옮긴 코드로 실행
  (`cloudrun_port.js`).
- **이 테스트의 범위 밖(postcomment-parity와 동일한 이유)**: `buildCommentUpdateResponse_`
  (댓글 목록 재조회 + `buildFeedEntry_` 기반 `updatedPost` 재계산)는 `getFeedTest`/
  `getPostByIdTest`/`getCommentsTest` parity에서 이미 검증된 `lib/feedEngine.js`/
  `lib/feedResponses.js`를 postComment와 동일하게 그대로 재사용하는 부분이라 새 로직이 없어
  이번 비교 대상에서 뺐습니다. 대신 "실제로 시트에 어떤 값이 남는가"(`updatedSheetRows`/
  `updatedDataRows`)까지 비교해서, 응답 모양뿐 아니라 실제 쓰기 결과의 논리적 동일성까지
  확인합니다.
- Sheets API 호출(GET/PUT) 자체는 배제하고, 순수 로직만 완전히 동일한 입력값(user, 댓글 행
  데이터, body)을 넣어 비교했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (8개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | commentId 없음 -> MISSING_FIELDS | MATCH |
| 2 | content가 공백만 -> trim 후 빈 문자열 -> MISSING_FIELDS | MATCH |
| 3 | 존재하지 않는 commentId -> COMMENT_NOT_FOUND | MATCH |
| 4 | 다른 사람이 쓴 댓글 수정 시도 -> FORBIDDEN_NOT_AUTHOR | MATCH |
| 5 | 본인 댓글 정상 수정 -> content(H열)만 바뀌고 나머지 열은 그대로 | MATCH |
| 6 | 작성자 이메일 대소문자/앞뒤 공백 달라도 본인으로 인정 | MATCH |
| 7 | content 앞뒤 공백은 trim되어 저장 | MATCH |
| 8 | commentId가 느슨한 타입이어도 String() 비교로 매칭 | MATCH |

**8개 전부 Apps Script와 Cloud Run 결과(에러 코드 + 실제 남는 데이터)가 완전히 동일했습니다.**
상세 입력/출력은 `results.json` 참고.

## 이번 1단계 이후 추가로 확인한 것

이 디렉터리의 순수 로직 비교와는 별도로, 실제 `exports.updateCommentTest`/
`exports.deleteCommentTest` 함수 자체를 Firestore/Sheets API를 흉내낸 스텁으로 감싸 end-to-end
호출까지 해봤습니다(1순위에서 `ADMIN_EMAIL` 미선언 버그를 뒤늦게 발견한 것을 계기로 이번엔
로직 parity뿐 아니라 실제 wiring도 함께 확인). 정상 수정/삭제, 다른 사람 댓글 시도, 존재하지
않는 댓글, 마지막 남은 댓글 삭제(빈 배열이 되는 경계 케이스) 등을 실행해 실제 PUT/clear 호출
내용과 응답이 기대한 그대로 나오는 것을 확인했습니다.

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API 응답 형식이 Apps Script의 `getValues()`/`setValues()`와 실제로
  다른지는, 진짜 엔드포인트를 배포해서 실제 시트로 확인해야 합니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트는 2단계(별도 승인) 대상입니다.

## 다음 단계

8개 전부 일치했으므로(`deleteComment` 결과는 `tests/deletecomment-parity/` 참고), 이 결과를
확인해 주시면 GitHub 커밋 여부와 Cloud Run 배포 여부를 별도로 여쭙겠습니다. 아직
`feed.html`에 연결되지 않았고 Cloud Run에도 배포되지 않았으므로 이 단계까지는 운영 동작에
변화가 앆습니다.
