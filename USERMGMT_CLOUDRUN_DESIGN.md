# 사용자 관리 페이지 쓰기 3종(updateUser/changePassword/updateSettings) Cloud Run 이전 — 분석·설계·구현 기록

작성일: 2026-08-28
승인 경로: 2026-08-28 채팅에서 분석/설계 계획 승인 → 코드 구현 승인 → parity 테스트 승인(38건 전부 PASS) → 이 문서와 함께 GitHub 커밋 승인. **Cloud Run 배포와 feed.html 배선은 아직 하지 않았습니다** — 배포는 사용자가 직접 실행하고, 배선은 배포·smoke test 완료 후 별도 승인을 받습니다.

---

## 요약

- 사용자 관리 페이지에 남아있던 쓰기 액션 3개(`updateUser`, `changePassword`, `updateSettings`)를 Cloud Run으로 포팅했습니다. `getUsers`(읽기)는 이미 전환·배선 완료된 상태입니다.
- Code.gs 원본을 직접 코드로 확인한 결과, 세 함수 모두 `LockService.getScriptLock()`을 쓰지 않습니다 — "기존 동작을 바꾸지 않는다"는 원칙에 따라 Cloud Run 포트에도 새 락을 추가하지 않았습니다(upsertItem/upsertCustomer가 공유하는 분산 락과는 무관합니다).
- 비밀번호 해싱은 새로 만들지 않고, `loginTest`가 이미 실사용·검증한 `index.js`의 `hashPassword_()`(SHA-256 + 이메일 salt)를 그대로 재사용했습니다.
- `updateSettings`는 실제 서비스 전체가 의존하는 설정 시트를 건드리므로, smoke test는 값을 실제로 바꾸지 않는 "같은 값을 그대로 다시 쓰는 no-op 왕복" 방식으로 설계했습니다(4번 참고).

---

## 1. Apps Script 원본 분석

### 1-1. `handleUpdateSettings_` (Code.gs 3311~3341행)

- **권한**: `user.email !== ADMIN_EMAIL`(jhjoo@nkmro.com) → `FORBIDDEN`. 역할(role) 기반이 아니라 이 이메일 하나만 허용됩니다.
- **입력**: `body.settings`가 object가 아니면 `MISSING_FIELDS`. 이 검사는 `typeof updates !== 'object'`만 확인하므로, **배열도 통과합니다**(JS에서 배열의 typeof도 `'object'`) — 이 느슨함은 이번에 새로 막지 않고 그대로 포팅했습니다.
- **로직**: `설정` 시트(A2:C, key/value/description)를 매 요청마다 다시 읽어, `body.settings`의 각 key에 대해 같은 key를 찾으면 B열(값)만 갱신, 못 찾으면 `unknownKeys`에만 담고 쓰지 않습니다. 새 키를 만들지 않습니다.
- **락**: 없음.
- **응답**: `{ ok:true, updatedKeys, unknownKeys }`.

### 1-2. `handleUpdateUser_` (Code.gs 3367~3396행)

- **권한**: `user.email !== ADMIN_EMAIL` → `FORBIDDEN`(담당/팀장도 불가 — updateSettings와 동일하게 이메일 하나만 허용).
- **입력 검증**: `body.row`(사용자팀마스터 시트의 실제 행 번호)가 2 미만이면 `INVALID_ROW`. `role`/`team`/`status`가 각각 전달되면 화이트리스트(`['일반','담당','팀장','임원']`/`['동부','서부','중부','영업지원','소싱','본사']`/`['활성','비활성']`)에 없으면 각각 `INVALID_ROLE`/`INVALID_TEAM`/`INVALID_STATUS`.
- **로직**: `body.name`이 전달되고 trim 후 빈 문자열이 아니면 B열만, `role`/`team`/`status`는 전달된 경우에만 각각 C/D/E열을 개별 `setValue`(부분 업데이트). **`body.row`가 실제로 존재하는 사용자 행인지 미리 확인하지 않습니다** — 존재 범위를 벗어난 큰 row 번호가 와도 그대로 `setValue`를 시도합니다(실제 시트라면 자동으로 빈 행까지 확장되며 써짐). 이 동작도 새로 고치지 않고 그대로 포팅했습니다(parity 테스트로 확인만 함).
- **락**: 없음.
- **응답**: `{ ok:true }`.

### 1-3. `handleChangePassword_` (Code.gs 3586~3618행)

- **권한**: 인증된 사용자 본인만(역할/관리자 제한 없음 — 로그인만 되어 있으면 누구나 자기 비밀번호 변경 가능).
- **검증 순서**(그대로 포팅 필요): `currentPassword`/`newPassword` 누락 → `MISSING_FIELDS` → `newPassword.length < 6` → `PASSWORD_TOO_SHORT` → `findUser_(user.email)`로 **매 요청마다 새로 조회**(캐시 재사용 안 함) → 없으면 `USER_NOT_FOUND` → 해시 불일치면 `WRONG_PASSWORD`.
- **해싱**: `SHA-256(password + ':' + email.trim().toLowerCase())` 16진 문자열. `index.js`의 `hashPassword_()`(1145행, loginTest가 이미 검증)를 그대로 재사용.
- **쓰기**: G열(passwordHash) 갱신 + **I열(비밀번호변경일)은 `new Date().toISOString()` — 실제 Date 셀이 아니라 텍스트(ISO 문자열)**. upsertItem의 등록일처럼 시트 시리얼 숫자로 변환하지 않습니다 — 이 차이를 그대로 지켰습니다.
- **락**: 없음.
- **응답**: `{ ok:true }`.

세 함수 모두 Code.gs 안에서 `LockService.getScriptLock()`을 쓰지 않는 것을 코드로 직접 확인했습니다(markThreadSeen 등 다른 쓰기 액션과 다른 점).

---

## 2. Cloud Run 이전 설계 및 구현 (`cloud-run/mro-functions/index.js`, 순수 추가)

**재사용한 기존 컴포넌트** — 새로 만든 것 없음:
- 세션 인증: `lib/auth.js`의 `authenticateSession()`
- 사용자 조회: `lib/sheetsClient.js`의 `rowsToUsers()` + 기존 `POLL_USER_RANGE`(사용자팀마스터!A2:I)
- 설정 조회: 기존 `SETTINGS_RANGE`/`SHEET_SETTING_NAME`(설정!A2:C)
- 비밀번호 해싱: 1145행 `hashPassword_()`
- idempotency: `lib/writeIdempotency.js`의 `withIdempotency()`

**락 판단(확정)**: Apps Script 원본 3개 모두 락이 없으므로 Cloud Run 포트에도 새 락을 추가하지 않았습니다. `changePasswordTest`만 currentPassword 검증을 위해 요청마다 사용자팀마스터를 다시 읽는데(`getFreshUserRows_`), 이는 Code.gs의 `findUser_(user.email)`가 매 요청마다 새로 조회하는 것을 그대로 포팅한 것이지 락이 아닙니다. feed.html의 `callApi()`가 쓰기 액션에는 애초에 hedge(동시 중복 요청)를 쓰지 않고 실패 시에만 같은 idempotencyKey로 순차 재시도만 하므로, "같은 사용자가 동시에 두 번 요청"하는 시나리오 자체가 없습니다.

**추가된 함수** (순서: `updateUserTest` → `changePasswordTest` → `updateSettingsTest`):

| 이름 | 역할 |
|---|---|
| `VALID_ROLES_`/`VALID_TEAMS_`/`VALID_STATUS_` | 화이트리스트 상수(Code.gs 3375~3377행과 동일) |
| `getUserWriteClient_()` | 사용자팀마스터 전용 쓰기 클라이언트(updateUserTest/changePasswordTest 공유) |
| `updateUserCell_()` | 사용자팀마스터 한 칸 쓰기(`updateLoginFailCountCell_`와 동일 패턴) |
| `updateUserAction_()` + `exports.updateUserTest` | `handleUpdateUser_` 포팅 |
| `getFreshUserRows_()` | 사용자팀마스터 fresh read(changePassword 전용) |
| `changePasswordAction_()` + `exports.changePasswordTest` | `handleChangePassword_` 포팅 |
| `getSettingsWriteClient_()` / `getFreshSettingsRows_()` | 설정 시트 전용 쓰기/fresh read |
| `updateSettingsAction_()` + `exports.updateSettingsTest` | `handleUpdateSettings_` 포팅 |

세 함수 모두 `withIdempotency()`로 감싸서 FORBIDDEN 등 에러 응답도 idempotency 캐시에 남습니다(upsertItem과 동일한 설계). `cloud-run/mro-functions/index.js` 325줄 순수 추가(기존 코드 삭제/수정 없음), `node --check` 및 `require()` 런타임 로드 확인 완료.

---

## 3. Parity 테스트 (2026-08-28 실행, 38건 전부 PASS)

`tests/usermgmt-parity/`(updateUser+changePassword, 25건)와 `tests/updatesettings-parity/`(updateSettings, 13건)로 분리. 각 폴더는 `apps_script_ref.js`(Code.gs 판단 로직 포트) vs `cloudrun_port.js`(index.js 판단 로직 포트) 비교(A그룹) + `lib/writeIdempotency.js`/`lib/auth.js` 실제 프로덕션 코드를 `fake_firestore.js` 인메모리 스텁으로 직접 실행하는 정책 테스트(B그룹)로 구성. 상세 시나리오는 각 `run_tests.js` 참고. `cloudrun_port.js`의 판단 로직은 실제 `index.js`의 해당 함수와 한 줄씩 대조해 일치를 재확인했습니다.

---

## 4. Smoke Test 계획 (다음 단계 — 배포 후 사용자가 직접 실행)

- **updateSettings**: 실제 값을 읽어서(`getSettingsTest`) **같은 값을 그대로 다시 쓰는 no-op 왕복**으로 성공 경로 검증(진짜 값 변경 없음). 존재하지 않는 키로 `unknownKeys` 처리만 별도 확인(역시 아무것도 안 씀).
- **updateUser**: 테스트 계정(`TEST_EMAIL`)의 row를 `getUsersTest`로 조회해 현재 값을 먼저 백업 → `name`을 `SMOKETEST_`로 임시 변경 → 확인 → 즉시 원래 값으로 되돌림 → 확인. 실제 팀원 계정은 건드리지 않음.
- **changePassword**: `TEST_EMAIL`/`TEST_PASSWORD` 테스트 계정으로 새 임시 비밀번호로 변경 → 로그인으로 확인 → 즉시 원래 `TEST_PASSWORD`로 되돌림 → 재확인. 스크립트 종료 시점엔 테스트 계정 비밀번호가 원래대로 남음.

---

## 5. 단계별 진행 현황

1. ✅ 분석/설계 계획 승인 (2026-08-28)
2. ✅ 코드 구현(`index.js` 순수 추가) — `node --check` 통과, diff 요약 보고 완료
3. ✅ Parity 테스트 작성·실행 — 38건 전부 PASS
4. ⏳ GitHub 커밋(이 문서 포함) — 진행 중
5. 다음: Cloud Run 배포 가이드 제공 → 사용자 직접 배포 → 승인
6. 다음: Smoke test 스크립트 실행(사용자 직접) → 결과 확인
7. 다음: feed.html 배선(각 액션별 `CLOUD_RUN_*_URL` 상수 + `*Remote_()` 함수 + 3단 폴백) → diff 승인 → 커밋

## 6. 기존 원칙 준수

- Apps Script(Code.gs) 코드는 이번에도 전혀 수정하지 않음(포트만, 원본은 계속 폴백 경로로 유지)
- Cloud Run 배포는 사용자 승인 및 실행 전까지 하지 않음(이번 커밋에도 배포 없음)
- feed.html 등 프론트는 이번 구현/parity/커밋 단계에서 건드리지 않음
- 쓰기 스코프(`spreadsheets`, 읽기+쓰기)는 이 3개 함수 전용 클라이언트 안에서만 새로 만듦(다른 함수의 공유 클라이언트를 넓히지 않음) — 최소 권한 원칙 유지
