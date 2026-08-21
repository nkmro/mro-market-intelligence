# loginTest 실제 코드 작성 전 파일/함수 단위 계획 (2026-08-21)

`LOGIN_CLOUDRUN_DESIGN.md`(승인 완료)를 실제 코드로 옮길 때 **정확히 어떤 파일이 바뀌고, 어떤 함수가 새로 생기는지**를 먼저 보여드리는 문서입니다. **이 문서 자체에는 실제 구현 코드가 없습니다** — 함수 시그니처와 "무엇을 하는지"만 정리했습니다. 이 계획에 대한 승인을 받은 뒤에, 실제 함수 본문(diff)을 작성해서 다시 보여드리겠습니다.

이번 단계의 범위는 **Cloud Run 함수(`loginTest`)와 그 로컬 parity 테스트뿐입니다.** `feed.html`/`index.html`의 로그인 폼 연동(`loginRemote_()` 배선)은 이번 범위가 아니고, postComment/markThreadSeen 때와 동일하게 "Cloud Run 함수 작성 → parity 테스트 → 커밋 → 배포 → (별도 승인 후) 프론트 연동"의 앞 두 단계만 다룹니다.

---

## 1. 바뀌는 파일 목록

| 파일 | 변경 종류 | 비고 |
|---|---|---|
| `cloud-run/mro-functions/index.js` | 수정(함수 추가만, 기존 함수는 안 건드림) | 아래 2번 참고 |
| `cloud-run/mro-functions/tests/logintest-parity/` | 신규 폴더 6개 파일 | 아래 3번 참고 |
| `LOGIN_CLOUDRUN_DESIGN.md` | 없음(이미 로컬에 있으나 아직 GitHub에 커밋 안 됨) | 코드와 함께 커밋할지는 별도로 여쭙겠습니다 |

**건드리지 않는 것(명시적 확인)**: `feed.html`, `index.html`, `apps-script/Code.gs`, `cloud-run/mro-functions/lib/auth.js`, `lib/feedEngine.js`, `lib/feedResponses.js`, `lib/writeIdempotency.js`(수정 없이 그대로 재사용만), 다른 모든 `exports.*` 함수(기존 16개)와 그 권한 스코프.

---

## 2. `index.js`에 추가되는 것

### 2-1. `exports.loginTest` (신규 HTTP 핸들러)

```
POST /loginTest
body: { email, password, platform?, idempotencyKey }
```

내부에서 `withIdempotency(firestore, idempotencyKey, 'login', () => loginAction_(...))`로 감싸는 구조 — `postCommentTest`가 `postCommentAction_`을 감싸는 것과 동일한 패턴입니다. `idempotencyKey`가 없으면 `{ ok:false, status:400, error:'MISSING_IDEMPOTENCY_KEY' }`로 즉시 반환(다른 쓰기 함수들과 동일한 방어).

### 2-2. `hashPassword_(password, email)` (신규, Node `crypto` 표준 모듈만 사용)

`Code.gs`의 `hashPassword_`를 그대로 이식. 신규 npm 의존성 없음.

### 2-3. `acquireLoginLock_(firestore, email, holderId)` / `releaseLoginLock_(firestore, email, holderId)` (신규)

`LOGIN_CLOUDRUN_DESIGN.md` 7-2/7-3의 설계 그대로. 최대 3초 폴링 대기, 10초 TTL로 죽은 락 자가 회수.

**(이 계획을 정리하며 발견해 설계 문서에 반영한 사소한 수정)** `lockedAt` 필드를 읽을 때 `lib/auth.js`의 `authenticateSession`과 동일하게 `toMillis`가 있으면 그걸 쓰고 없으면 `new Date(...)`로 변환하는 방어 코드가 필요합니다 — 실제 Firestore는 Date를 Timestamp로 저장/반환하지만, 로컬 parity 테스트의 `fake_firestore.js`는 그냥 JS Date를 그대로 돌려주기 때문입니다. 이 방어가 없으면 로컬 parity 테스트에서 `.toMillis is not a function` 에러가 납니다.

### 2-4. `updateLoginFailCountCell_(rowIndex, value)` (신규, 이 함수만 쓰기 스코프)

`markThreadSeenAction_`/`appendCommentRow_`와 동일한 최소 권한 원칙 — 이 함수 하나만 `GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']})`를 새로 만듭니다. `사용자팀마스터` 시트의 H열(로그인실패횟수) 딱 한 칸만 씁니다.

### 2-5. `loginAction_(email, password, allUsers, settings, firestore)` (신규)

`Code.gs`의 `handleLogin_` 검증 체인을 그대로 포트: 사용자 조회 → 활성 상태 확인 → 잠금(`failCount >= 5`) 확인 → 비밀번호 해시 비교 → 실패 시 `updateLoginFailCountCell_`로 +1 → 성공 시 같은 함수로 `0` 리셋 → `sessionToken` 발급(`crypto.randomUUID()`, 다른 함수들과 동일) → **Firestore `sessions/{sessionToken}` 문서를 직접 기록**(기존처럼 Apps Script가 `sessionSyncTest`를 호출하는 간접 경로가 아니라, `loginTest`가 이미 Firestore 클라이언트를 갖고 있으므로 직접 씀 — 결과는 같지만 불필요한 내부 HTTP 호출 한 단계를 없앰) → 비밀번호 만료 계산(`설정` 시트의 `비밀번호만료일수`) → 최종 응답 조립.

사용자 조회(`allUsers`)와 설정값(`settings`)은 `getSettingsTest`/`postCommentTest`와 동일하게 `lib/sheetsClient.js`의 기존 읽기 전용 클라이언트로 미리 읽어서 넘겨받습니다 — 이 함수 자체는 읽기 Sheets 호출을 새로 만들지 않습니다.

### 2-6. 응답 에러 코드 (신규 코드 1개 추가)

기존 `MISSING_FIELDS` / `USER_NOT_FOUND` / `USER_INACTIVE` / `ACCOUNT_LOCKED` / `WRONG_PASSWORD`에 더해, **`LOGIN_BUSY_RETRY`**(락 획득 실패, 명확한 사전 실패로 분류)를 추가합니다.

---

## 3. `tests/logintest-parity/` (신규 폴더, 6개 파일 — 기존 두 parity 폴더와 동일 구조)

| 파일 | 내용 |
|---|---|
| `apps_script_ref.js` | `Code.gs`의 `handleLogin_`+`hashPassword_` 결정 로직을 그대로 포트(순수 함수, `now`/`sessionToken` 등은 외부 주입) |
| `cloudrun_port.js` | `loginAction_`의 검증 로직을 동일한 형태로 포트(Sheets/Firestore 실호출 제외) |
| `fake_firestore.js` | 기존 `tests/markthreadseen-parity/fake_firestore.js`를 그대로 재사용(수정 없음) — `collection().doc().get()/set()/update()/delete()`, `runTransaction()`이 이미 구현되어 있어 `loginLocks` 컬렉션도 그대로 커버됩니다 |
| `run_tests.js` | Group A(검증 로직: `MISSING_FIELDS`/`USER_NOT_FOUND`/`USER_INACTIVE`/`ACCOUNT_LOCKED`/`WRONG_PASSWORD`+failCount 증가값/정상 로그인+failCount 리셋/passwordExpired 양쪽) + Group B(`withIdempotency` 재시도, `acquireLoginLock_`/`releaseLoginLock_` 락 시나리오 — 정상 획득/이미 잠김/TTL 만료 후 회수) |
| `results.json` | 실행 결과 캡처 |
| `README.md` | A/B 그룹 방법론 설명(기존 두 폴더와 동일 형식) |

이 단계는 **실제 Sheets/GCP/Firestore 호출이 전혀 없는 로컬 테스트**입니다 — 테스트 계정도 필요 없습니다.

---

## 4. 테스트 계정 2개를 시트에 추가할 정확한 타이밍

**코드 작성 + 위 3번의 로컬 parity 테스트까지는 계정이 전혀 필요 없습니다** — 전부 합성 데이터로 진행됩니다. 계정이 실제로 필요해지는 시점은 그 다음 단계인 **"GitHub 커밋 → `gcloud functions deploy loginTest` → 실제 배포된 엔드포인트로 smoke test"** 바로 직전입니다. 즉:

1. (지금 이 문서 승인) → 2. 코드 작성 → 3. 로컬 parity 테스트 → 4. **결과 보고, 커밋/배포 승인 요청** → 5. 재홍님 배포 실행 → **6. 이 시점에 `LOGIN_CLOUDRUN_DESIGN.md` 8-3 절차대로 계정 2개 추가 요청** → 7. 실제 엔드포인트 smoke test

6번 시점이 되면 별도로 말씀드리겠습니다. 지금은 아무 계정도 만들 필요가 없습니다.

---

## 5. 이번 문서에 대한 승인 요청

이 파일/함수 단위 계획에 동의하시면, 다음 산출물은 **실제 `index.js` diff(2번 항목의 5개 함수 본문 + `exports.loginTest`)와 `tests/logintest-parity/` 전체 파일**입니다. 코드 작성 자체는 로컬에서만 하고, 여전히 GitHub 커밋/배포는 각각 별도 승인 후에만 진행합니다.
