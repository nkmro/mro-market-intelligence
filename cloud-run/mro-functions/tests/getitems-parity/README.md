# getItems 로직 비교 테스트 (2026-08-26, 1단계 — 실제 코드/배포 변경 없음)

2026-08-25 채팅에서 승인된 분석/계획(품목 관리 페이지 읽기 2개 → 댓글 수정/삭제 → upsertItem 순서로 진행)의 1순위, `getItems` 이전에 대한 1단계(로직 단위 비교) 결과입니다. `threadseen-parity`/`pollsignal-parity`와 동일한 방식입니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 11개 시나리오 모두 직접 만든 가상의 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `handleGetItems_`를, 시트 읽기 부분만 값 주입(행 배열을 직접 전달)으로 바꾸고 판단 로직(이중 필터 구조 포함)은 원본과 동일하게 옮긴 코드로 실행(`apps_script_ref.js`).
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `exports.getItemsTest` 안에서 items를 걸러내는 부분만 그대로 옮긴 코드로 실행(`cloudrun_port.js`).
- 두 구현에 **완전히 동일한 입력값**(user, 행 배열, settings)을 넣고, 출력(JSON)을 한 글자까지 비교(`JSON.stringify` 완전 일치 검사)했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (11개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | role='일반' -> FORBIDDEN | MATCH |
| 2 | role='담당'(admin 아님) -> 자기 팀만 | MATCH |
| 3 | role='담당' + admin 이메일 -> 1차 필터 건너뜀 + 2차 재필터로 결국 자기 팀만 | MATCH |
| 4 | role='팀장'(admin 아님), 팀장_열람범위='전체' -> 1차 필터가 이미 자기 팀으로 좁혀서 scope와 무관하게 자기 팀만 | MATCH |
| 5 | role='팀장' + admin, 팀장_열람범위='전체' -> 모든 팀 노출(핵심 케이스) | MATCH |
| 6 | role='팀장' + admin, 팀장_열람범위≠'전체' -> 2차 재필터로 자기 팀만 | MATCH |
| 7 | 팀장_열람범위 설정 자체가 없음 -> undefined≠'전체' -> 자기 팀만 | MATCH |
| 8 | A열(itemId) 빈 값 행 제외 | MATCH |
| 9 | 팀 값에 앞뒤 공백('동부 ') -> 1차(trim 비교)는 통과, 2차(trim 없는 ===)에서 제외 | MATCH |
| 10 | A열(itemId)이 숫자값 -> String() 변환 결과 동일 | MATCH |
| 11 | 품목 행이 하나도 없음 -> 빈 배열 | MATCH |

**11개 전부 Apps Script와 Cloud Run 결과가 완전히 동일했습니다.** 상세 입력/출력은 `results.json` 참고.

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API가 문자열/숫자 값을 돌려주는 형식이 Apps Script의 `getValues()`와 실제로 다른지는, 진짜 `getItemsTest` 엔드포인트를 배포해서 실제 시트에 대고 호출해봐야 확인됩니다.
- Firestore 세션 인증 경로(sessionToken 확인, 만료 처리, 슬라이딩 연장)는 기존 `getCommentsTest`/`postCommentTest`와 동일하게 `lib/auth.js`의 `authenticateSession`을 그대로 재사용했으므로 별도 로직 비교가 필요 없다고 판단했습니다 — 다만 실제 엔드포인트 통합 테스트는 별도 승인 후 진행합니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트는 2단계(별도 승인) 대상입니다.

## 다음 단계

11개 전부 일치했으므로, 이 결과를 확인해 주시면 GitHub 커밋 여부와 Cloud Run 배포 여부를 별도로 여쭙겠습니다. `getCustomers`도 같은 방식으로 검증했습니다(`tests/getcustomers-parity/`). 두 함수 모두 아직 `feed.html`에 연결되지 않았고 Cloud Run에도 배포되지 않았으므로, 이 단계까지는 운영 동작에 변화가 없습니다.
