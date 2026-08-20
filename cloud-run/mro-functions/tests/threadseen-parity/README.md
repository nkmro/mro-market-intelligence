# getThreadSeen 로직 비교 테스트 (2026-08-19, 1단계 — 실제 코드/배포 변경 없음)

`THREADSEEN_FEED_NOTIFICATIONS_CLOUDRUN_PLAN.md`(⑭ parity 테스트 계획)에서 승인받은 1단계(로직 단위 비교)를 실행한 결과입니다. `pollsignal-parity/`와 동일한 방식이지만, `getThreadSeen`은 역할별 분기나 팀 판단이 전혀 없는 단순 이메일 필터링이라 시나리오 수가 훨씬 적습니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 7개 시나리오 모두 직접 만든 가상의 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `getThreadSeenMap_`을, 시트 읽기 부분만 값 주입(행 배열을 직접 전달)으로 바꾸고 판단 로직(문자열 비교 한 줄까지)은 원본과 동일하게 옮긴 코드로 실행 (`apps_script_ref.js`).
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `exports.getThreadSeenTest` 안에서 `seenMap`을 만드는 부분만 그대로 옮긴 코드로 실행 (`cloudrun_port.js`).
- 두 구현에 **완전히 동일한 입력값**(이메일, 행 배열)을 넣고, 출력(JSON)을 한 글자까지 비교(`JSON.stringify` 완전 일치 검사)했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (7개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 사용자 A 2건 + 사용자 B 1건 혼재 -> A로 조회하면 A의 2건만 | MATCH |
| 2 | 시트엔 대문자 이메일, 조회는 소문자 -> 대소문자 무시하고 매칭 | MATCH |
| 3 | 일치하는 이메일 행이 없음 -> 빈 맵 | MATCH |
| 4 | 데이터 행 없음(빈 시트) -> 빈 맵 | MATCH |
| 5 | 같은 postId-itemId 키가 두 번 등장 -> 나중 행 값으로 덮어써짐 | MATCH |
| 6 | postId/itemId가 숫자값 -> 문자열 결합 결과 동일 | MATCH |
| 7 | 시트 이메일에 앞뒤 공백 -> 원본처럼 trim 없이 비교해 매칭 실패(의도된 동작, 두 구현 동일) | MATCH |

**7개 전부 Apps Script와 Cloud Run 결과가 완전히 동일했습니다.** 상세 입력/출력은 `results.json` 참고.

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API가 문자열/숫자 값을 돌려주는 형식이 Apps Script의 `getValues()`와 실제로 다른지는, 진짜 `getThreadSeenTest` 엔드포인트를 배포해서 실제 시트에 대고 호출해봐야 확인됩니다(이번 1단계는 로직 비교만, 실제 Sheets API 응답 형식까지는 검증하지 않음).
- Firestore 세션 인증 경로(sessionToken 확인, 만료 처리, 슬라이딩 연장)는 기존 `getSettingsTest`/`pollSignalTest`와 동일한 코드를 그대로 재사용했으므로 별도 로직 비교가 필요 없다고 판단했습니다 — 다만 실제 엔드포인트 통합 테스트는 별도 승인 후 진행합니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트, 실제 세션 인증 경로 확인은 2단계(합성 계정, 별도 승인) 대상입니다.

## 다음 단계

7개 전부 일치했으므로, 이 결과를 확인해 주시면 GitHub 커밋 여부와 Cloud Run 배포 여부를 별도로 여쭙겠습니다. 이번 단계에서 `feed.html`의 실제 `getThreadSeen` 호출 경로는 코드상 Cloud Run을 먼저 시도하도록 바꿔뒀지만(승인된 범위), **아직 배포는 하지 않았으므로 `getThreadSeenTest` 엔드포인트가 존재하지 않아 실제로는 항상 기존 Apps Script 경로로 폴백됩니다.** 배포 전까지는 운영 동작에 변화가 없습니다.
