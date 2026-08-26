# deleteComment 로직 비교 테스트 (2026-08-26, 1단계 — 실제 코드/배포 변경 없음)

2026-08-25 채팅에서 승인된 분석/계획(2순위, 댓글 수정/삭제 이전)의 `deleteComment`에 대한
1단계(로직 단위 비교) 결과입니다. `updatecomment-parity`와 짝을 이루는 함수로, 비교 방법과
범위는 동일합니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 8개 시나리오 모두 직접
만든 가상의 댓글 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법 및 범위

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `handleDeleteComment_`(2476~2510행)를,
  시트 읽기 부분만 값 주입으로 바꾼 코드로 실행(`apps_script_ref.js`). 원본이
  `setValues(kept)` + `clearContent(나머지)` 2단계로 재기록하는 것의 최종 논리적 결과(=시트에
  최종적으로 남는 데이터)는 `kept` 배열과 같으므로, 참조 구현은 `kept`를 최종 상태로 돌려줍니다.
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `deleteCommentAction_` 안에서
  "대상 댓글 행을 찾아 권한을 검사하고 나머지 행을 유지하는" 부분만 그대로 옮긴 코드로 실행
  (`cloudrun_port.js`).
- **이 테스트의 범위 밖**: `updatecomment-parity`와 동일한 이유로 `buildCommentUpdateResponse_`
  (댓글 목록 재조회 + `updatedPost` 재계산, `lib/feedEngine.js`/`lib/feedResponses.js` 재사용
  부분)는 비교 대상에서 뺐습니다. 대신 삭제 후 "실제로 시트에 남는 데이터"까지 비교합니다.
- Sheets API 호출(GET/PUT/clear) 자체는 배제하고, 순수 로직만 완전히 동일한 입력값(user, 댓글
  행 데이터, body)을 넣어 비교했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (8개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | commentId 없음 -> MISSING_FIELDS | MATCH |
| 2 | 댓글 시트에 데이터 행이 하나도 없음 -> COMMENT_NOT_FOUND | MATCH |
| 3 | 존재하지 않는 commentId -> COMMENT_NOT_FOUND | MATCH |
| 4 | 다른 사람이 쓴 댓글 삭제 시도 -> FORBIDDEN_NOT_AUTHOR | MATCH |
| 5 | 중간 행 삭제 -> 나머지 행 순서 그대로 유지 | MATCH |
| 6 | 마지막 남은 댓글 1개 삭제 -> 데이터 행 0개(경계 케이스) | MATCH |
| 7 | 작성자 이메일 대소문자/앞뒤 공백 달라도 본인으로 인정 | MATCH |
| 8 | 첫 번째 행 삭제 -> 남은 행이 그대로 유지 | MATCH |

**8개 전부 Apps Script와 Cloud Run 결과(에러 코드 + 실제 남는 데이터)가 완전히 동일했습니다.**
상세 입력/출력은 `results.json` 참고.

## 이번 1단계 이후 추가로 확인한 것

`updatecomment-parity`와 동일하게, 실제 `exports.deleteCommentTest` 함수를 Firestore/Sheets
API를 흉내낸 스텁으로 감싸 end-to-end 호출까지 해봤습니다. 3개 댓글 중 중간 1개를 지우는
경우(PUT으로 나머지 2개를 A2:I3에 다시 쓰고 A4:I4를 clear) 및 마지막 남은 댓글 1개를 지우는
경계 케이스(PUT 없이 A2:I2만 clear)를 실행해, 실제 PUT/clear 호출의 범위와 내용이 설계한
그대로(항상 정확히 1행만 clear) 나오는 것을 확인했습니다.

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API 응답 형식이 Apps Script의 `getValues()`/`setValues()`/
  `clearContent()`와 실제로 다른지는, 진짜 엔드포인트를 배포해서 실제 시트로 확인해야 합니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트는 2단계(별도 승인) 대상입니다.

## 다음 단계

8개 전부 일치했으므로(`updateComment` 결과는 `tests/updatecomment-parity/` 참고), 이 결과를
확인해 주시면 GitHub 커밋 여부와 Cloud Run 배포 여부를 별도로 여쭙겠습니다. 아직
`feed.html`에 연결되지 않았고 Cloud Run에도 배포되지 않았으므로 이 단계까지는 운영 동작에
변화가 없습니다.
