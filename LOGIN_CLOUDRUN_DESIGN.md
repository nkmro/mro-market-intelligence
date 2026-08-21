# login(세션 발급) Cloud Run 전환 — 3단계 상세 설계 (2026-08-21, 작성 착수)

**이 문서는 설계 문서입니다. 어떤 코드도 아직 작성하지 않았습니다.** 실제 `loginTest` Cloud Run 함수 구현은 이 설계에 대한 별도 승인을 받은 뒤에만 진행합니다. `LOGIN_WHOAMI_MIGRATION_PLAN.md`(2026-08-18)의 3단계("login 발급 자체의 Cloud Run 이전")에 대한 상세 설계이며, 그 문서가 전제로 삼은 조건("세션 인증이 필요한 주요 action 다수가 먼저 Cloud Run으로 옮겨진 상태")은 2026-08-21 기준 충족되었습니다(읽기 9개 + 쓰기 2개 전환 완료 — 루트 `README.md` API 매핑표 참고).

`NEXT_PHASE_ANALYSIS_2026-08-21.md`에서 정리한 7가지 준비사항을 이 문서에서 각각 구체적인 설계로 다룹니다.

---

## 0. 왜 login이 다른 전환보다 어려운가 (전제)

지금까지 옮긴 모든 API(`getFeed`, `markThreadSeen`, `postComment` 등)는 **이미 발급된 세션을 소비**하는 쪽입니다. `login`은 반대로 **세션을 발급하는 쪽 그 자체**입니다. 이 차이가 두 가지 구조적 위험을 만듭니다.

1. **세션의 "진짜 주인" 문제**: 지금 Apps Script의 CacheService가 세션의 유일한 원본이고, Firestore는 그 사본입니다. `login`을 Cloud Run으로 옮기면 이 관계가 역전되어야 하는데, 두 저장소가 동시에 "내가 방금 로그인시켰다"고 각자 판단하면 안 됩니다.
2. **`사용자팀마스터` 시트 쓰기(부작용) 문제**: `login`은 순수 조회가 아니라 `failCount`(로그인실패횟수) 컬럼에 매번 쓰기가 일어나는 액션입니다. 실패든 성공이든 시트에 쓰기가 발생하고, 이 쓰기가 계정 잠금(`ACCOUNT_LOCKED`)이라는 보안 기능과 직결됩니다. 이 컬럼이 두 백엔드에서 각자 다른 값을 보고 있으면(split-brain) 계정이 실제보다 더 쉽게 잠기거나, 반대로 잠금이 무력화될 수 있습니다.

이 문서의 설계는 이 두 가지를 어떻게 피하는지에 집중합니다.

---

## 1. 함수 시그니처 (제안)

```
POST /loginTest
body: { email, password, platform? }
→ 200 { ok: true, sessionToken, email, name, role, team, passwordExpired }
→ 200 { ok: false, error: 'MISSING_FIELDS' | 'USER_NOT_FOUND' | 'USER_INACTIVE' | 'ACCOUNT_LOCKED' | 'WRONG_PASSWORD' }
```

`Code.gs`의 `handleLogin_`(231~293행) 응답 형태를 한 글자도 바꾸지 않습니다 — 프론트가 이 객체를 그대로 `localStorage.mro_session`에 저장하기 때문입니다(준비사항 5).

**(2026-08-21 수정)** 처음 초안에는 `idempotencyKey`를 받지 않는 것으로 썼으나, 아래 4번의 최종 제안에서 **받는 것으로 뒤집었습니다.** `login`은 postComment/markThreadSeen과 달리 "같은 시도를 재시도해도 안전"한 액션이 아니지만, 바로 그 이유 때문에 오히려 `idempotencyKey`가 필요합니다 — 이게 없으면 "같은 시도의 재시도"와 "다른 시도"를 서버가 구분할 방법이 없습니다. 4번 항목 참고.

```
body: { email, password, platform?, idempotencyKey }
```

---

## 2. 비밀번호 해시 로직 이식 (준비사항 1)

`Code.gs`의 `hashPassword_`(331~335행):

```js
function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}
```

Node.js 동등 구현(제안, 표준 `crypto` 모듈만 사용 — 신규 npm 의존성 불필요):

```js
const crypto = require('crypto');
function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}
```

**검증 방법**: 실제 계정이 아닌 합성 테스트 계정(준비사항 7)의 알려진 평문 비밀번호로 두 구현의 해시 결과가 정확히 일치하는지 로컬 parity 테스트에서 직접 비교합니다. `Utilities.computeDigest`가 반환하는 부호 있는 바이트(-128~127)를 `b < 0 ? b + 256 : b`로 보정하는 부분이 Node의 `Buffer`/`Hash` 출력과 정확히 같은 16진수 문자열이 되는지가 핵심 확인 지점입니다(이론적으로는 SHA-256 표준이라 동일해야 하지만, 실제 값으로 재확인 필요).

---

## 3. 쓰기 권한 확장 (준비사항 2)

현재 Cloud Run 서비스 계정은 `spreadsheets`(읽기+쓰기) 스코프를 `markThreadSeenAction_`과 `appendCommentRow_` 두 곳에서만 최소 권한으로 쓰고 있습니다(다른 모든 함수는 `spreadsheets.readonly`).

`login`이 쓰는 컬럼은 두 가지뿐입니다:

- 로그인 실패 시: `사용자팀마스터` 시트 H열(`로그인실패횟수`)에 `failCount + 1`
- 로그인 성공 시: 같은 H열을 `0`으로 리셋

**제안**: 이 두 쓰기를 처리하는 `updateLoginFailCount_(rowIndex, value)` 같은 헬퍼 하나만 쓰기 스코프(`spreadsheets`)를 쓰고, 나머지 로그인 로직(사용자 조회, 세션 발급)은 기존 `lib/sheetsClient.js`의 읽기 전용 클라이언트를 그대로 재사용합니다 — `markThreadSeenAction_`/`appendCommentRow_`와 동일한 최소 권한 원칙.

**주의**: `사용자팀마스터` 시트는 계정 전체(이메일, 비밀번호 해시, 역할, 팀, 활성 상태)의 원본입니다. 쓰기 스코프를 부여하는 순간 이 함수는 **이론적으로 이 시트의 다른 모든 셀도 쓸 수 있는 권한**을 갖게 됩니다(Google Sheets API는 셀 단위 권한 분리를 지원하지 않음). 코드 리뷰에서 이 헬퍼가 정확히 H열 한 칸만 쓰는지 확인하는 것이 특히 중요합니다 — 다른 쓰기 함수(`markThreadSeenAction_`)보다 한 단계 더 신중해야 할 지점입니다.

---

## 4. Split-brain 방지 설계 (준비사항 3) — 최종 제안 (2026-08-21)

postComment/markThreadSeen의 "실패 시 Apps Script로 폴백" 패턴을 login에 그대로 쓸 수 없습니다. 이유:

- postComment는 실패해도 "아무것도 안 쓰여진 상태"에서 재시도하는 것이므로 Apps Script로 넘겨도 최악의 경우 중복 댓글 하나가 더 생길 뿐입니다.
- login은 **실패 자체가 부작용(`failCount` 증가)을 가집니다.** Cloud Run에서 비밀번호를 틀려 `failCount`를 4 → 5로 올렸는데, 그 응답이 유실되어 프론트가 "애매한 실패"로 판단하고 Apps Script로 다시 시도하면, Apps Script가 다시 한 번 `failCount`를 5 → 6으로 올립니다. 실제로는 1번 틀렸는데 시트에는 2번 틀린 것으로 기록되고, 계정이 실제보다 빨리 잠깁니다.

### 4-1. Cloud Run 로그인 실패 시 사용자에게 보여줄 메시지

세 가지 상황을 구분합니다 — 이 구분 자체는 postComment와 동일한 판단 기준("정상 JSON 응답을 받았는가")을 씁니다.

| 상황 | 판단 기준 | 사용자에게 보여줄 메시지 |
|---|---|---|
| 명확한 사전 실패 | 정상 JSON 응답, `ok:false` + 알려진 에러 코드 | 기존 Apps Script `login`이 지금 보여주는 것과 동일한 문구(`WRONG_PASSWORD` → "이메일 또는 비밀번호가 올바르지 않습니다" 등, 프론트 기존 문구 그대로 유지) |
| 애매한 실패(1차) | 응답 자체를 못 받음(타임아웃/네트워크 예외/JSON 파싱 실패) | 화면에는 아무것도 보여주지 않고 **같은 `idempotencyKey`로 즉시 1회 재시도** (postComment와 동일) |
| 애매한 실패(재시도까지) | 재시도도 응답을 못 받음 | "로그인 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요." — postComment의 "등록 여부를 확인해주세요" 같은 **확인 요청형 문구는 쓰지 않습니다.** login에는 postComment의 "낙관적 댓글" 같은 화면에 남겨진 상태가 없고(로그인 폼에는 지울 낙관적 UI가 없음), 사용자가 취할 행동은 결국 "다시 로그인 시도"뿐이라 확인을 요청할 대상이 없기 때문입니다. |

### 4-2. 같은 `idempotencyKey`로 몇 번까지 재시도할지

**postComment와 동일하게 최대 2회(최초 1회 + 재시도 1회)로 제한합니다.** 3회 이상 재시도하지 않는 이유는 postComment 설계 때와 같습니다 — 재시도를 늘려도 "애매함"이 근본적으로 해소되지 않고, 사용자가 로그인 버튼 앞에서 대기하는 시간만 늘어납니다. 재시도까지 실패하면 4-1의 세 번째 메시지를 보여주고 **끝냅니다** — Apps Script로 넘기지 않고, 3번째 자동 재시도도 하지 않습니다.

사용자가 안내 메시지를 보고 로그인 버튼을 다시 누르면, 그건 "재시도"가 아니라 **완전히 새로운 시도**로 취급합니다(새 `idempotencyKey` 발급). 이 구분이 중요한 이유는 4-3에서 설명합니다.

### 4-3. 재시도 사이에 `failCount`가 중복 증가하지 않는 정확한 조건

두 가지 서로 다른 메커니즘이 함께 작동해야 합니다 — 혼동하기 쉬운 지점이라 명확히 구분합니다.

1. **같은 `idempotencyKey`로의 재시도(4-2의 "1회 재시도")는 `withIdempotency`가 막습니다.** `login`의 전체 처리(사용자 조회 → 비밀번호 검증 → `failCount` 쓰기 → 세션 발급)를 `withIdempotency(firestore, idempotencyKey, 'login', actionFn)`로 감쌉니다 — postComment가 `postCommentAction_` 전체를 감싸는 것과 정확히 같은 방식입니다. 이렇게 하면: 1차 시도가 실제로 서버에서 끝까지 실행됐다면(응답만 유실됐다면), 재시도는 `actionFn`을 다시 실행하지 않고 **캐시된 결과를 그대로 반환**합니다. 즉 `failCount` 쓰기는 실제로 몇 번을 재시도해도 **최대 한 번만** 일어납니다. 이건 이미 존재하는 `lib/writeIdempotency.js`의 동작이고, login에 새로 만들 게 없습니다 — `actionFn` 안에 `failCount` 쓰기까지 포함시키기만 하면 됩니다.
2. **"완전히 새로운 시도"(다른 `idempotencyKey`)가 중복 증가를 만드는 것은 애초에 정상 동작입니다.** 사용자가 정말로 비밀번호를 두 번 틀리게 입력하면 `failCount`가 두 번 올라가는 게 맞습니다. 여기서 막아야 하는 것은 "같은 한 번의 시도가 서버 쪽에서는 성공적으로 처리됐는데 클라이언트가 응답을 못 받아서, 그 하나의 시도가 두 번 계산되는 것"뿐입니다. 1번의 idempotencyKey 메커니즘이 정확히 이걸 막습니다.
3. **Apps Script로의 자동 폴백을 아예 없앤 것**(4-1)이 마지막 방어선입니다. `CLOUD_RUN_LOGIN_URL`이 채워져 있는 동안은 로그인 폼이 Apps Script `login` 액션을 절대 직접 호출하지 않습니다. 다른 API들의 "실패 시 조용히 폴백"과 다르게, **login은 상수가 켜져 있으면 그 요청 전체의 생애 동안 Cloud Run만 씁니다.** Cloud Run에 구조적 장애가 있다면 사람이 `CLOUD_RUN_LOGIN_URL`을 비워서 전체를 롤백하는 것이 맞는 대응이고, 개별 요청 단위로 자동으로 반대편 백엔드로 새는 경로는 없습니다.

이 세 가지가 함께 있으면, `failCount`가 실제 발생한 "진짜 로그인 시도 횟수"보다 더 많이 증가하는 경우는 없습니다(동시성으로 인한 레이스 컨디션은 별개 문제 — 7번 항목에서 다룸).

---

## 5. 비밀번호 만료 계산 이식 (준비사항 4)

`Code.gs` 279~282행:

```js
const expireDays = Number(getSetting_('비밀번호만료일수')) || 90;
const changedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt) : null;
const daysSincePwChange = changedAt ? (Date.now() - changedAt.getTime()) / 86400000 : Infinity;
const passwordExpired = daysSincePwChange > expireDays;
```

`설정` 시트 값은 이미 `lib/sheetsClient.js`의 `parseSettings`로 읽고 있으므로(다른 함수들이 이미 재사용 중), `getSettingsTest`와 동일한 방식으로 재사용합니다. `passwordChangedAt`이 시트에서 어떤 타입(날짜 셀 vs 문자열)으로 오는지는 실제 시트 값을 확인해야 합니다 — postComment 때 발견된 "날짜 직렬화" 이슈와 같은 종류의 함정이 여기에도 있을 수 있어, parity 테스트에 **날짜 타입 그대로 읽어서 `daysSincePwChange` 계산이 Apps Script와 정확히 같은 결과를 내는지**를 반드시 포함합니다.

---

## 6. 응답 형태 동일성 (준비사항 5)

```
{ ok: true, sessionToken, email, name, role, team, passwordExpired }
```

필드 이름, 순서 무관하지만 **존재 여부와 타입**은 완전히 같아야 합니다. `feed.html`/`index.html`이 이 객체를 그대로 `JSON.stringify`해서 `localStorage.mro_session`에 저장하고, 이후 여러 화면에서 `session.name`/`session.role`/`session.team`을 직접 참조합니다. parity 테스트에서 이 객체를 `JSON.stringify`한 결과를 Apps Script 쪽과 바이트 단위로 비교하는 것을 제안합니다.

---

## 7. 계정 잠금 동시성 보호 (준비사항 6) — 최종 제안 (2026-08-21)

`failCount >= 5`면 `ACCOUNT_LOCKED`. 동시성 위험 시나리오: 같은 계정으로 거의 동시에 두 번 로그인 요청이 들어오면(사용자가 빠르게 두 번 클릭, 또는 다른 두 기기에서 동시에 로그인 시도), 두 요청이 모두 "Sheets에서 `failCount` 읽기 → 계산 → Sheets에 쓰기" 3단계를 거치면서 서로의 쓰기를 못 보고 덮어써서(레이스 컨디션) 증가가 누락될 수 있습니다.

**중요한 전제 정정**: `failCount`의 실제 값은 **Google Sheets 셀**에 있고, Firestore가 아닙니다. Firestore `runTransaction`은 Firestore 문서에만 원자성을 보장하므로, "Sheets 읽기-계산-쓰기"를 그 자체로 원자화할 수는 없습니다. 대신 Firestore 문서를 **분산 락(mutex)의 손잡이로만 사용**해서, 두 요청이 "Sheets 읽기-계산-쓰기" 구간을 절대 동시에 실행하지 않도록 직렬화하는 방식을 제안합니다. (4번의 `idempotencyKey`/`withIdempotency`와는 다른 메커니즘입니다 — 그건 "같은 시도의 재시도"를 다루고, 이건 "다른 시도끼리의 동시 실행"을 다룹니다.)

### 7-1. 락의 단위 — "이 이메일에 대한 로그인 시도"를 어떻게 표현할지

- 컬렉션 `loginLocks`, 문서 ID = `String(email).trim().toLowerCase()` (다른 곳과 동일한 이메일 정규화 규칙 — `hashPassword_`/`findUser_`와 일치시켜야 서로 다른 대소문자 표기가 서로 다른 락으로 갈라지는 실수를 막습니다).
- 문서 필드: `{ lockedAt: Timestamp, holderId: string }` — `holderId`는 이 요청의 임의 식별자(예: 요청마다 생성하는 UUID). 락을 "내가 잡은 게 맞는지" 확인하고 해제할 때 다른 요청의 락을 실수로 지우지 않기 위한 안전장치입니다.

### 7-2. 락을 잡는/해제하는 절차

```js
async function acquireLoginLock_(firestore, email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  const LOCK_STALE_MS = 10000; // 10초 — 크래시로 해제 안 된 락도 이 시간 뒤엔 스스로 풀림
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const lockedAtRaw = snap.data().lockedAt;
      // 실제 Firestore는 Date를 쓰면 Timestamp로 저장/반환하지만(lib/auth.js의
      // authenticateSession과 동일한 방어), 로컬 parity 테스트의 fake_firestore.js는
      // 그냥 JS Date를 그대로 돌려주므로 두 경우 모두 처리한다.
      const lockedAt = (lockedAtRaw && lockedAtRaw.toMillis) ? lockedAtRaw.toMillis() : new Date(lockedAtRaw).getTime();
      if (now - lockedAt < LOCK_STALE_MS) {
        return false; // 다른 요청이 아직 락을 쥐고 있음(유효한 락)
      }
      // LOCK_STALE_MS보다 오래된 락은 죽은 락으로 간주하고 뺏어옴(자가 복구)
    }
    tx.set(ref, { lockedAt: new Date(now), holderId });
    return true;
  });
}

async function releaseLoginLock_(firestore, email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  try {
    const snap = await ref.get();
    if (snap.exists && snap.data().holderId === holderId) {
      await ref.delete(); // 내가 잡은 락일 때만 해제(다른 요청 락 실수 삭제 방지)
    }
  } catch (e) {
    console.error('releaseLoginLock_ 실패(무시, 10초 뒤 자동 해제됨): ' + e);
  }
}
```

### 7-3. 락을 잡는 시간 / 실패 시 처리

- **대기 방식**: 락을 못 잡으면 곧바로 실패시키지 않고, `200ms` 간격으로 최대 `3초`(약 15회) 짧게 폴링합니다 — Apps Script의 `LockService.getScriptLock(); lock.waitLock(5000)` 패턴(최대 5초 대기)과 같은 사상이며, login 자체의 처리 시간(사용자 조회 + 해시 계산 + Sheets 쓰기)이 보통 1초 안팎이라 3초면 정상적인 "거의 동시" 충돌은 대부분 해소됩니다.
- **3초 안에도 못 잡으면**: 새로운 명확한 에러 코드 `LOGIN_BUSY_RETRY`를 돌려줍니다. 이건 "애매한 실패"가 아니라 **명확한 사전 실패**로 분류합니다 — 서버가 "지금 처리하지 않았다"는 걸 확실히 알기 때문입니다(4-1의 표에서 "명확한 사전 실패" 줄과 동일하게 처리 — Apps Script로 넘기지 않고 그대로 표시). 사용자에게는 "잠시 후 다시 시도해주세요" 정도로 노출합니다.
- **락 유효시간(TTL)**: 10초. 정상 처리는 보통 1초 안팎이므로 10초는 넉넉한 여유입니다. Cloud Run 함수가 Sheets 쓰기 도중 크래시하거나 타임아웃돼서 `releaseLoginLock_`이 아예 호출되지 못하는 최악의 경우에도, **다음 요청은 최대 10초만 기다리면** 스스로 락을 뺏어올 수 있어 영구 잠김(deadlock)이 생기지 않습니다.
- 락 획득/해제는 `try { acquire → 본 처리 } finally { release }` 형태로 감싸서, 본 처리 중 어떤 예외가 나도 반드시 해제를 시도합니다(해제 자체가 실패해도 위에서 설명한 10초 TTL이 최종 안전장치).

### 7-4. Parity 테스트 반영

"거의 동시에 두 번 틀림 → 세 번째는 잠김" 같은 시나리오는 순차 실행으로 `failCount` 계산 로직 자체는 검증하되, **진짜 동시 요청(레이스 컨디션) 테스트는 로컬 parity 테스트의 한계를 벗어납니다.** 이 부분은 실제 배포 후 별도로(예: 두 개의 병렬 curl 요청을 동시에 쏘아보는 수동 확인) 검증하는 것을 제안하며, 이 한계를 미리 밝혀둡니다.

---

## 8. 합성 테스트 계정 (준비사항 7) — 최종 제안 (2026-08-21)

### 8-1. 언제 만들지

지금 만들지 않습니다. **이 설계 문서 전체(4/7번 포함)가 승인된 뒤, "실제 코드 작성" 승인 요청과 함께 그 첫 단계로** 만듭니다 — 계정을 시트에 추가하는 것 자체가 실 데이터(사용자팀마스터 시트)에 손을 대는 일이라, 코드 작성 승인과 별개로 이 계정 추가만 먼저 명시적으로 승인받는 것을 제안합니다.

### 8-2. 어떤 이메일로, 어떤 권한으로

- 이메일: `logintest.cloudrun@nkmro.com` (Gmail/Workspace의 `+` 서브어드레싱은 시트가 문자열을 그대로 비교하므로 기술적으로는 되지만, 다른 코드에서 이메일을 정규식/도메인으로 다루는 곳이 있을 가능성을 배제하기 어려워 `+` 없는 완전히 별도의 계정명을 제안합니다). 실제 메일함이 필요하진 않습니다 — 시트의 이메일 컬럼 값과 로그인 요청의 `email`이 문자열로 일치하기만 하면 되고, 실제 수신 가능한 메일박스일 필요는 없습니다.
- 역할: `일반`(가장 낮은 권한) — 로그인 자체 검증에는 역할이 응답에 그대로 실리는지만 확인하면 되므로, 혹시라도 이 계정이 잘못 쓰이는 상황을 가정해도 피해 범위를 최소화합니다.
- 팀: 기존에 있는 팀 중 하나를 그대로 사용(예: 지금 로그인해 계신 팀과 같은 팀) — 테스트만을 위한 새 팀을 만들 필요는 없습니다.
- 상태: `활성`. `USER_INACTIVE` 경로까지 검증하려면, 이 계정 하나를 테스트 중간에 `비활성`으로 바꿨다가 다시 `활성`으로 되돌리기보다는 **`logintest.cloudrun.inactive@nkmro.com` 같은 두 번째 테스트 계정을 처음부터 `비활성`으로 만들어 분리**하는 것을 제안합니다 — 상태를 왔다 갔다 바꾸는 것보다 사고 위험이 적습니다.
- `passwordHash`: 알려진 임의의 테스트 비밀번호(예: 이번 테스트 전용으로 새로 정한 문자열)를 `Code.gs`의 `hashPassword_(password, email)` 공식(`SHA-256(password + ':' + email)`)으로 **오프라인에서 미리 계산한 해시값만** 시트 셀에 직접 입력합니다. 평문 비밀번호는 어떤 시트/문서/커밋에도 남기지 않습니다.

### 8-3. 시트에 추가하는 절차

이 부분은 Claude가 직접 할 수 없습니다 — 이 환경에는 `사용자팀마스터` 시트에 대한 편집 권한이 없고(Cloud Run 서비스 계정의 쓰기 권한은 이 설계가 실제 구현된 뒤에나 생기며, 그 권한도 이 세션에서 직접 쓸 수 있는 게 아닙니다), 지금까지도 시트 자체는 항상 재홍님이 직접 편집해오셨습니다. 제안하는 절차:

1. 재홍님이 Google Sheets에서 `사용자팀마스터` 시트를 열고, 8-2의 값으로 새 행 2개(정상 계정 1개 + 비활성 계정 1개)를 직접 추가합니다. 정확한 컬럼 순서는 `apps-script/README.md`의 시트 스키마 표를 참고합니다.
2. `passwordHash` 컬럼에는 8-2에서 미리 계산해둔 해시값을 붙여넣습니다(제가 계산 방법과 함께 실행 가능한 스니펫을 드리면, 재홍님 로컬에서 실행해 나온 해시값만 시트에 옮기면 됩니다 — 평문이 저와의 대화나 어떤 로그에도 남지 않도록).
3. `로그인실패횟수`(H열)는 `0`으로 시작합니다.

### 8-4. 테스트 후 `failCount`를 0으로 되돌리는 방법

Sheets 셀을 손으로 직접 고치는 것보다, **이미 존재하는 Apps Script 함수를 그대로 재사용**하는 방법을 제안합니다:

- Apps Script 편집기에서 `resetLoginFailCount_('logintest.cloudrun@nkmro.com')`을 인자로 채운 임시 실행용 함수(예: `function __resetLoginTestAccount() { resetLoginFailCount_('logintest.cloudrun@nkmro.com'); }`)를 하나 추가해 "실행" 버튼으로 한 번 돌리는 방법 — 기존 코드를 그대로 호출만 하는 것이라 새로운 버그가 들어갈 여지가 없고, 시트 셀을 손으로 잘못 고칠 위험(다른 열을 건드리는 등)도 없습니다.
- 이 임시 함수는 테스트가 끝나면 지웁니다(영구히 `Code.gs`에 남기지 않음).
- parity 테스트를 여러 차례 반복해야 한다면, 매 라운드가 끝날 때마다 이 실행을 반복합니다 — 자동화하지 않고 수동으로 두는 이유는, 이 계정 자체가 자주 쓰이는 게 아니라 가끔 한 번씩 검증할 때만 쓰이는 일회성 성격이라 별도 자동화 도구를 만드는 비용이 더 크다고 판단했기 때문입니다.

### 8-5. 그 외 원칙

실제 팀원 계정으로는 절대 "일부러 틀린 비밀번호" 테스트를 하지 않습니다(계정 잠금 위험). 테스트는 항상 8-2의 합성 계정으로만 진행합니다.

---

## 9. Parity 테스트 계획 (구현 승인 후 진행 — 이번 문서 범위 아님)

`tests/markthreadseen-parity/`, `tests/postcomment-parity/`와 동일한 A/B 그룹 구조를 제안합니다.

- Group A(순수 로직 포트 비교): `MISSING_FIELDS`, `USER_NOT_FOUND`, `USER_INACTIVE`, `ACCOUNT_LOCKED`, `WRONG_PASSWORD`(+`failCount` 증가값), 정상 로그인(+`failCount` 리셋, `passwordExpired` true/false 양쪽)
- Group B(실제 모듈 대상): `withIdempotency`(같은 키 재시도), Firestore 트랜잭션 기반 잠금(설계 확정 시), 세션 발급 후 `sessionSyncTest`와 동등한 Firestore 세션 기록이 실제로 조회 가능한지

이 계획은 실제 구현이 승인된 뒤, 코드와 함께 구체화합니다.

---

## 10. 요약 — 최종 제안 반영 완료 (2026-08-21), 승인 대기 중인 3가지

이전 버전에서 결론을 내지 못했던 3가지에 대해 구체적인 최종 제안을 확정했습니다:

1. **Split-brain 방지(4번)**: `idempotencyKey` + `withIdempotency`로 "같은 시도 재시도"의 중복 쓰기를 막고, Apps Script로의 자동 폴백을 아예 없애 "다른 백엔드가 몰래 같은 시도를 또 처리"하는 경로를 원천 차단. 애매한 실패는 같은 키로 1회만 재시도, 그래도 애매하면 일반적인 재시도 안내만 표시(postComment의 "등록 확인" 문구는 쓰지 않음).
2. **`failCount` 동시성 보호(7번)**: `failCount`는 Sheets 셀이라 Firestore 트랜잭션이 직접 원자화할 수 없다는 점을 정정하고, Firestore 문서(`loginLocks/{email}`)를 분산 락의 손잡이로만 써서 "다른 시도끼리의 동시 실행"을 직렬화. 최대 3초 대기, 10초 TTL로 자가 복구, 락 실패는 명확한 사전 실패(`LOGIN_BUSY_RETRY`)로 분류.
3. **테스트 계정(8번)**: 계정 2개(정상/비활성) 생성 절차, 해시 계산 방법, 시트 추가는 재홍님이 직접 수행, `failCount` 리셋은 기존 `resetLoginFailCount_`를 임시 함수로 한 번 호출.

**이 세 제안에 대한 승인 여부를 확인해주시면, 그 다음이 "실제 `loginTest` 코드 작성" 승인 요청입니다.** 코드는 이번에도 전혀 작성하지 않았습니다.
