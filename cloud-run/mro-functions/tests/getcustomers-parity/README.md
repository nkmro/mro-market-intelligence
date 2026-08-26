# getCustomers 로직 비교 테스트 (2026-08-26, 1단계 — 실제 코드/배포 변경 없음)

2026-08-25 채팅에서 승인된 분석/계획의 1순위, `getCustomers` 이전에 대한 1단계(로직 단위 비교) 결과입니다. `getItems`와 짝을 이루는 함수지만, 역할 검사(팀장만 허용)와 빈 행 제외 기준(B열=name)만 있는 단순한 조회라 `getitems-parity`보다 시나리오 수가 적습니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 6개 시나리오 모두 직접 만든 가상의 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `handleGetCustomers_`를, 시트 읽기 부분만 값 주입으로 바꾼 코드로 실행(`apps_script_ref.js`).
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `exports.getCustomersTest` 안에서 customers를 걸러내는 부분만 그대로 옮긴 코드로 실행(`cloudrun_port.js`).
- 두 구현에 **완전히 동일한 입력값**(user, 행 배열)을 넣고, 출력(JSON)을 한 글자까지 비교했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (6개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | role='담당' -> FORBIDDEN(팀장만 허용) | MATCH |
| 2 | 팀장 정상 조회 -> 전체 고객사 목록 | MATCH |
| 3 | B열(name)이 빈 값인 행 제외 | MATCH |
| 4 | A열(code)이 빈 값이어도 B열(name)만 있으면 포함(제외 기준은 A열이 아니라 B열) | MATCH |
| 5 | C열(manager)이 없는 행 -> manager는 undefined 그대로(기본값 없음) | MATCH |
| 6 | 고객사 행이 하나도 없음 -> 빈 배열 | MATCH |

**6개 전부 Apps Script와 Cloud Run 결과가 완전히 동일했습니다.** 상세 입력/출력은 `results.json` 참고.

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API 응답 형식이 Apps Script의 `getValues()`와 실제로 다른지는 배포 후 실제 시트로 확인해야 합니다.
- Firestore 세션 인증 경로는 `getItemsTest`와 동일하게 `lib/auth.js`의 `authenticateSession`을 재사용했으므로 별도 로직 비교가 필요 없다고 판단했습니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트는 2단계(별도 승인) 대상입니다.

## 다음 단계

6개 전부 일치했으므로, `getItems` 결과(`tests/getitems-parity/`)와 함께 확인해 주시면 GitHub 커밋 여부와 Cloud Run 배포 여부를 별도로 여쭙겠습니다. 아직 `feed.html`에 연결되지 않았고 Cloud Run에도 배포되지 않았으므로 이 단계까지는 운영 동작에 변화가 없습니다.
