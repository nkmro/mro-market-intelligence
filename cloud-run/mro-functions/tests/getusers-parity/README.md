# getUsers 로직 비교 테스트 (2026-08-27, Track B 1단계 — 실제 코드/배포 변경 없음)

2026-08-27 채팅에서 승인된 Track B(`getUsers` 신규 Cloud Run 이전) 분석/설계 계획의 구현 1단계(로직 단위 비교) 결과입니다. `getitems-parity`/`getcustomers-parity`와 동일한 방식입니다.

**실제 사용자 계정·세션·시트 데이터는 전혀 건드리지 않았습니다.** 12개 시나리오 모두 직접 만든 가상의 행 데이터(실제 업무 데이터 아님)만 사용했습니다.

## 비교 방법

- **기준(Apps Script) 구현**: `apps-script/Code.gs`의 `handleGetUsers_`(3343~3364행)를, 시트 읽기 부분만 값 주입(행 배열을 직접 전달)으로 바꾸고 판단 로직은 원본과 동일하게 옮긴 코드로 실행(`apps_script_ref.js`).
- **Cloud Run 포팅본**: `cloud-run/mro-functions/index.js`의 `exports.getUsersTest` 안에서 users를 걸러내는 부분만 그대로 옮긴 코드로 실행(`cloudrun_port.js`). 세션 인증(`lib/auth.js`)과 viewer 조회(email → role/team) 배관 부분은 `getitems-parity`와 동일한 판단으로 비교 범위에서 제외했습니다 — 이미 role/team이 확정된 `viewer`를 직접 받아 필터링 로직만 비교합니다.
- 두 구현에 **완전히 동일한 입력값**(user, 행 배열)을 넣고, 출력(JSON)을 한 글자까지 비교(`JSON.stringify` 완전 일치 검사)했습니다.
- 테스트 코드는 재실행 가능합니다: `node run_tests.js`

## 결과 (12개 전부 일치)

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | role='일반', admin 아님 → FORBIDDEN | MATCH |
| 2 | role='임원', admin 아님 → FORBIDDEN (임원은 담당/팀장이 아니므로 자동 승인 안 됨) | MATCH |
| 3 | role='담당'(admin 아님) → 자기 팀만, 다른 팀 제외 | MATCH |
| 4 | role='팀장'(admin 아님) → 자기 팀만, 다른 팀 제외 | MATCH |
| 5 | role='일반'이지만 이메일이 ADMIN_EMAIL → FORBIDDEN 아니고 전체 팀 노출 | MATCH |
| 6 | role='담당' + admin 이메일 → 전체 팀 노출 (getItems와 달리 2차 재필터가 없어 정말 전체가 나옴) | MATCH |
| 7 | 관리자 이메일 대소문자 다름(JHJoo@NKMRO.com) → trim+lowercase 비교로 정상 매칭, 전체 팀 노출 | MATCH |
| 8 | 이메일(A열)이 빈 행 → 결과에서 제외 | MATCH |
| 9 | team 값에 앞뒤 공백('동부 ') → 양쪽 다 trim 비교라 정상 포함 (getItems 2차 필터의 미trim 배제와 다른 결과) | MATCH |
| 10 | 사용자 행이 하나도 없음 → 빈 배열 | MATCH |
| 11 | row 번호 계산: 3번째 데이터 행(인덱스 2)의 row 값이 4(=2+2)로 정확히 나옴 | MATCH |
| 12 | 자기 팀/다른 팀 섞여 있음 → 자기 팀만, 원본 행 순서 그대로 유지 | MATCH |

**12개 전부 Apps Script와 Cloud Run 결과가 완전히 동일했습니다.** 실패한 케이스는 없었습니다. 상세 입력/출력은 `results.json` 참고.

## 코드 검증

- `node --check cloud-run/mro-functions/index.js` — 문법 오류 없음.
- `ADMIN_EMAIL` 상수는 `index.js`에 기존에 이미 선언되어 있던 것(1311행)을 그대로 참조만 했고, `getUsersTest` 안에서 새로 선언하지 않았습니다(2026-08-26에 `getItemsTest`에서 있었던 "ADMIN_EMAIL is not defined" 재발 방지 확인).

## 이번 1단계에서 아직 확인되지 않은 것 (2단계에서 다룰 예정)

- 실제 Google Sheets API가 문자열/숫자 값을 돌려주는 형식이 Apps Script의 `getValues()`와 실제로 다른지는, 진짜 `getUsersTest` 엔드포인트를 배포해서 실제 시트에 대고 호출해봐야 확인됩니다.
- Firestore 세션 인증 경로와 viewer 조회(email → role/team) 배관은 기존 `getItemsTest`/`getCustomersTest`와 동일한 패턴을 그대로 재사용했으므로 별도 로직 비교가 필요 없다고 판단했습니다 — 다만 실제 엔드포인트 통합 테스트는 별도 승인 후 진행합니다.
- 실제 운영 데이터로의 종단(end-to-end) 테스트는 배포 후 smoke test(별도 승인) 대상입니다.

## 다음 단계

12개 전부 일치했으므로, 이 결과를 확인해 주시면 Cloud Run 배포 여부를 별도로 여쭙겠습니다. `getUsersTest`는 아직 `feed.html`에 연결되지 않았고 Cloud Run에도 배포되지 않았으므로, 이 단계까지는 운영 동작에 변화가 없습니다.
