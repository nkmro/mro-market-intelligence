# upsertItem / upsertCustomer Cloud Run 이전 — 분석·설계 계획

작성일: 2026-08-27
승인 범위: **이 문서는 분석과 설계뿐입니다. 코드 작성, GitHub 커밋, Cloud Run 배포, Apps Script 배포는 전혀 하지 않았습니다.** 이 계획에 동의하시면 다음 요청 시 실제 구현(코드 작성)에 들어가고, 그 이후에도 parity 테스트/커밋/배포/프론트 배선은 각각 별도로 승인받습니다.

---

## 요약

- upsertItem/upsertCustomer는 지금까지 옮긴 getItems/getCustomers/getUsers(읽기)나 postComment/updateComment/deleteComment/markThreadSeen(upsert형 쓰기)과 달리, **"이름/코드 중복이면 안 된다"는 진짜 유일성 제약**을 가진 쓰기 작업입니다. 그래서 Apps Script의 `LockService.getScriptLock()`에 대응하는 **진짜 상호배제 락**이 Cloud Run 쪽에도 필요합니다.
- 다행히 이 저장소에는 이미 그 패턴이 구현돼 있습니다 — `loginTest`가 쓰는 `acquireLoginLock_`/`releaseLoginLock_`(Firestore 트랜잭션 기반 분산 락, 죽은 락 자가회수 포함)입니다. 이번 설계는 이 패턴을 일반화해서 재사용하는 것을 뼈대로 합니다.
- 새로 구현해야 하는 요소가 두 가지 있습니다: **(1) 분산 락 모듈**, **(2) Sheets API로 행을 삭제하는 롤백 코드**(기존 8개 Cloud Run 함수는 append/update만 해봤고, 삭제는 이번이 처음입니다). 이 두 가지는 리스크로 아래에 표시해뒀습니다.
- 현재 `feed.html`은 `upsertCustomer`를 단독으로 호출하지 않습니다(2026-08-19에 `upsertItem` 안으로 흡수됨). 이 사실이 smoke test 설계(3번, 4번)에 영향을 줍니다 — 아래에서 설명합니다.
- 품목(품목마스터)과 고객사(고객사마스터) 모두 **삭제 API가 없습니다**. 품목은 `status`를 '비활성'으로 바꿔 소프트 삭제할 수 있지만, 고객사는 그마저도 안 됩니다. smoke test에서 만든 테스트 데이터를 어떻게 정리할지가 이번 설계의 중요한 결정 포인트입니다 — 4번에서 선택지를 제시합니다.

---

## 1. Apps Script 원본 분석

### 1-1. `handleUpsertItem_` (Code.gs 3123~3247행)

**권한**: `user.role !== '팀장'` → `FORBIDDEN`. 팀장만 품목을 등록/수정할 수 있습니다.

**입력 필드**: `itemId`(있으면 수정, 없으면 신규), `customer`, `itemName`, `manager`, `materials`(배열이면 콤마로 join), `status`(기본값 `'활성'`), `materialCode`(신규 등록 시 필수), `newCustomerCode`(고객사가 아직 없을 때만).

**검증 순서** (락을 잡기 전, 순서대로):

1. `customer`/`itemName`/`manager` 중 하나라도 없으면 → `MISSING_FIELDS`
2. `findUserByName_(manager)`로 담당소장 조회 → 없으면 `MANAGER_NOT_FOUND`
3. 그 담당소장의 팀이 요청자(팀장) 팀과 다르면 → `MANAGER_NOT_IN_YOUR_TEAM`
4. `team`은 사람이 입력하는 게 아니라 **담당소장의 소속팀을 그대로 자동 할당**합니다(스크립트 전용 컬럼).
5. `findCustomerByName_(customer)`로 고객사 존재 여부 확인. 없는데 `newCustomerCode`도 없으면 → `CUSTOMER_NOT_FOUND`
6. 신규 등록(`!itemId`)인데 `materialCode`가 없으면 → `MISSING_MATERIAL_CODE`

**락 구간** (`LockService.getScriptLock().tryLock(10000)`, 실패 시 `LOCK_TIMEOUT`):

이 안에서 **신규 고객사 등록(필요 시) + 품목 등록/수정을 하나의 원자적 단위**로 처리합니다. 이 설계는 2026-08-19에 실제 장애(신규 고객사 "동양산업(주)"는 등록됐는데 뒤이은 품목 등록이 네트워크 오류로 실패해서 고객사만 영구히 남은 사고)를 계기로 도입됐습니다. 핵심 아이디어: **"이번 호출로 새로 만든 고객사"를 `createdCustomerCode`에 기록해두고, 이후 어떤 이유로든(검증 실패든 예외든) 최종 결과가 실패면 그 고객사 행만 정확히 되돌린다.**

1. 신규 고객사가 필요하면: `findCustomerByName_`/`findCustomerByCode_`로 **락을 잡은 뒤 다시 한번** 중복확인(락 획득 전 확인과 별개로, 경합 방지를 위해 재확인) → 중복이면 `CUSTOMER_ALREADY_EXISTS`/`CUSTOMER_CODE_ALREADY_EXISTS`, 아니면 고객사마스터에 `[newCustomerCode, customer, manager]` 추가하고 `createdCustomerCode = newCustomerCode` 기록.
2. 품목 처리:
   - `itemId`가 있으면(수정): 품목마스터 전체를 다시 읽어 A열(itemId) 일치 행을 찾고, B~G(6개 컬럼: customer/itemName/manager/team/materials/status)만 갱신. 못 찾으면 `ITEM_NOT_FOUND`.
   - `itemId`가 없으면(신규): `getItemById_(materialCode)`로 중복 확인 → 있으면 `MATERIAL_CODE_ALREADY_EXISTS`, 없으면 `appendRow([materialCode, customer, itemName, manager, team, materials, status, now])` 하고 등록일(H열) 셀 서식을 `yyyy-mm-dd`로 지정.
3. 이 블록 전체가 `try/catch`로 감싸여 있어서, 예기치 못한 예외가 나도 `result = {ok:false, error:'SERVER_ERROR', detail:...}`로 잡히고 **아래 롤백 로직으로 흘러갑니다.**
4. **롤백**: `result`가 실패이고 `createdCustomerCode`가 있으면, 고객사마스터에서 그 코드의 행을 찾아 삭제(`deleteRow`). 롤백 자체가 실패해도 원래 오류는 그대로 반환(롤백 실패를 삼킴).
5. `finally`에서 `lock.releaseLock()`.

전체가 디스패처에서 `withIdempotency_(body.idempotencyKey, ...)`로 한 번 더 감싸입니다(Code.gs 204행) — 같은 `idempotencyKey`로 재시도하면 재실행 없이 캐시된 응답을 그대로 돌려받습니다.

### 1-2. `handleUpsertCustomer_` (Code.gs 3502~3537행)

**권한**: 팀장만.

**입력**: `name`, `code`(둘 다 필수 → 없으면 `MISSING_FIELDS`), `manager`(선택, 빈 문자열 허용).

**락 구간** (마찬가지로 `tryLock(10000)`, 실패 시 `LOCK_TIMEOUT`): 락을 잡은 뒤 `findCustomerByName_`/`findCustomerByCode_`로 중복확인 → 중복이면 각각 `CUSTOMER_ALREADY_EXISTS`/`CUSTOMER_CODE_ALREADY_EXISTS`, 아니면 `appendRow([code, name, manager])`.

이 함수는 2026-08-19 이전에는 "중복확인 → 락 획득 → append" 순서였는데, 그 사이 동시 요청 두 개가 모두 중복확인을 통과해 같은 이름/코드로 두 번 등록되는 race condition이 있었습니다. 지금은 "중복확인 + 등록 전체가 하나의 락 구간"으로 고쳐져 있습니다.

**중요한 확인 사항**: 지금 `feed.html`을 직접 확인한 결과, **프론트엔드는 `upsertCustomer`를 단독으로 호출하는 곳이 없습니다.** 품목 등록 폼(`saveItemForm()`)이 신규 고객사가 필요할 때 `upsertItem` 요청에 `newCustomerCode`를 실어 보내는 방식(1-1의 흐름)으로 통합됐기 때문입니다(2026-08-19 리팩터링). `upsertCustomer` 액션 자체는 디스패처에 여전히 살아있고 API로는 호출 가능하지만, **현재 UI에는 이 액션으로 가는 진입점이 없습니다.** 이 사실은 3번(parity)·4번(smoke test) 설계에 반영했습니다.

### 1-3. 동시성 제어 — `LockService.getScriptLock()`의 정확한 동작

- 이건 **Apps Script 프로젝트 전체가 공유하는 단 하나의 스크립트 락**입니다. `tryLock(ms)`은 그 시간 안에 락을 못 얻으면 `false`를 반환합니다.
- 이 락은 `handleUpsertItem_`/`handleUpsertCustomer_`뿐 아니라 `withIdempotency_`(626행), `updateSheetCacheCell_`(337행), `suggestRawMaterials`(AI 원자재 추천, 991행) 등 **서로 다른 여러 핸들러가 같은 락을 공유**합니다. 즉 한 요청이 이 락을 쥐고 있으면, 그 사이 다른 락-사용 핸들러의 실행도 대기합니다 — 상당히 거친(coarse-grained) 동시성 정책이지만, Apps Script의 실행 모델(요청당 최대 6분, 프로젝트당 동시 실행 수 제한)에서는 실용적으로 잘 동작해온 것으로 보입니다.
- 원자성은 "Firestore 트랜잭션" 같은 진짜 트랜잭션이 아니라 **"락 + 실패 시 명시적 보정(사후 롤백)"** 패턴입니다. Google Sheets API 자체가 트랜잭션을 지원하지 않기 때문에, "쓰기 도중 프로세스가 강제 종료되는" 극단적 경우까지 완벽히 막지는 못합니다(이론상 가능, 발생 확률은 낮음) — 이 한계는 Apps Script 원본도 이미 갖고 있는 것이고, 이번 이전으로 새로 생기는 위험은 아닙니다.
- 참고로 사용자가 언급하신 "Firestore 기반 글로벌 락"은 Code.gs 자체에는 없습니다(Code.gs가 쓰는 건 CacheService/LockService — Apps Script 자체 서비스입니다). 다만 로그인 시 Firestore에 세션을 미러링하는 `syncSessionToCloudRun_`(294행)이 있고, **Cloud Run 쪽(`loginTest`)에 이미 Firestore 기반 분산 락(`acquireLoginLock_`)이 구현돼 있습니다** — 아래 2-3에서 이걸 재사용하는 설계를 제안합니다.

---

## 2. Cloud Run 이전 설계

### 2-1. 함수 시그니처(제안)

- `upsertItemTest`: `POST { sessionToken, itemId, customer, itemName, manager, materials, status, materialCode, newCustomerCode, idempotencyKey }`
- `upsertCustomerTest`: `POST { sessionToken, name, code, manager, idempotencyKey }`
- 응답 모양은 `handleUpsertItem_`/`handleUpsertCustomer_`와 정확히 동일하게 유지(`{ok:true, ...}` 또는 `{ok:false, error:'<코드>'}`, 에러 코드 표는 2-8 참고). 기존 함수들처럼 `serverMs`/`timings`도 응답에 함께 붙입니다.

### 2-2. 인증/세션/사용자 조회 — 기존 패턴 재사용

- 세션 인증: `lib/auth.js`의 `authenticateSession(firestore, sessionToken)` 재사용(`getFeedTest`/`getItemsTest`/`getCustomersTest` 등 최신 함수들과 동일한 방식). 이 모듈은 새로 만드는 함수만 쓰기로 한 기존 원칙(`lib/auth.js` 주석)에 그대로 부합합니다.
- 호출자 role/team 조회: `getItemsTest`/`getCustomersTest`가 이미 쓰는 패턴(`lib/sheetsClient.js`의 `getSheetsClient`/`batchGetValues`/`rowsToUsers`로 사용자팀마스터를 읽고, `email`로 `find`) 그대로 재사용. `viewer.role !== '팀장'`이면 `upsertItemTest`/`upsertCustomerTest` 둘 다 `FORBIDDEN`.

### 2-3. 동시성 제어 설계 — 이번 설계의 핵심

Cloud Run 함수는 여러 인스턴스가 동시에 뜰 수 있고 프로세스 내 락(`LockService`)이 없으므로, Apps Script의 스크립트 락에 대응하는 **Firestore 기반 분산 락**이 필요합니다. 이미 `loginTest`가 정확히 이 문제를 풀어놓은 코드가 있습니다 — `acquireLoginLock_`/`releaseLoginLock_`(index.js 1099~1136행): Firestore 트랜잭션으로 락 문서를 선점하고, 일정 시간(`LOGIN_LOCK_STALE_MS`, 현재 10초)이 지난 락은 죽은 락으로 간주해 자가회수하며, 최대 대기시간(`LOGIN_LOCK_WAIT_MS`, 현재 3초)을 넘기면 포기하는 방식입니다.

**제안**: 이 패턴을 `lib/writeLock.js`라는 새 공용 모듈로 일반화합니다(로그인 코드 자체는 건드리지 않고, 새 모듈만 추가 — "잘 동작하는 코드는 이번에 건드리지 않는다"는 기존 원칙 유지).

```js
// lib/writeLock.js (제안 — 의사코드)
async function acquireLock(firestore, lockName, holderId, opts) {
  const ref = firestore.collection('writeLocks').doc(lockName);
  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    const acquired = await firestore.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const lockedAtRaw = snap.data().lockedAt;
        const lockedAt = (lockedAtRaw && lockedAtRaw.toMillis) ? lockedAtRaw.toMillis() : new Date(lockedAtRaw).getTime();
        if (Date.now() - lockedAt < opts.staleMs) return false; // 다른 요청이 유효한 락을 쥐고 있음
        // staleMs보다 오래된 락 → 죽은 락으로 간주하고 뺏어옴(자가 복구)
      }
      tx.set(ref, { lockedAt: new Date(), holderId: holderId });
      return true;
    });
    if (acquired) return true;
    if (Date.now() >= deadline) return false;
    await sleep(opts.pollMs);
  }
}

async function releaseLock(firestore, lockName, holderId) {
  const ref = firestore.collection('writeLocks').doc(lockName);
  const snap = await ref.get();
  if (snap.exists && snap.data().holderId === holderId) {
    await ref.delete(); // 내가 잡은 락일 때만 해제
  }
}
```

이건 `acquireLoginLock_`/`releaseLoginLock_`와 정책상 한 글자도 다르지 않습니다 — 차이는 락 이름을 이메일 하나로 고정하는 대신 인자로 받아 재사용 가능하게 만든 것뿐입니다.

**락 이름(scope) 결정 — 재홍님 의견이 필요한 지점**:

- Apps Script는 스크립트 전체가 공유하는 락 하나를 씁니다(1-3 참고). Cloud Run에서 그 정도로 넓은 범위(로그인, 댓글 등 무관한 액션까지)를 그대로 복제할 필요는 없습니다 — 그 액션들은 이미 각자 안전한 방식(idempotency-key 중복 방지, 또는 upsert라 자연히 수렴하는 구조)을 갖고 있기 때문입니다.
- 실제로 정합성이 깨질 수 있는 범위는 **품목마스터에 materialCode 중복 검사+쓰기**와 **고객사마스터에 이름/코드 중복 검사+쓰기**뿐이고, 이 두 시트에 동시에 쓸 수 있는 액션은 `upsertItem`(품목 쓰기 + 조건부 고객사 쓰기)과 `upsertCustomer`(고객사 쓰기) 둘뿐입니다.
- **제안**: 고정된 락 이름 하나(`upsertItemAndCustomer`)를 `upsertItemTest`와 `upsertCustomerTest`가 공유합니다. 이렇게 하면 두 함수가 동시에 실행돼도(예: 한 팀장이 새 고객사+품목을 등록하는 동안 다른 팀장이 같은 고객사명으로 별도 등록을 시도) Apps Script와 동일하게 순차 처리됩니다. 팀장 몇 명이 가끔 등록하는 정도의 실사용 빈도를 생각하면 경합은 거의 없을 것으로 예상되어, 이렇게 넓게 잡아도 성능 문제는 없을 것으로 판단합니다.
- 대안(품목코드별/고객사명별로 더 세밀하게 락을 쪼개는 방식)도 가능하지만, Apps Script 원본이 이미 "전체 하나의 락"이라 굳이 더 세밀하게 나눌 이유가 크지 않다고 봅니다. 다른 의견 있으시면 말씀해주세요 — 이 부분만 결정되면 나머지 설계에는 영향이 없습니다.
- 타임아웃 값(제안): `waitMs=10000`(Apps Script `tryLock(10000)`과 동일), `staleMs=15000`(Cloud Run 함수 실행시간이 login보다 조금 더 걸릴 수 있어 10초보다 여유 있게), `pollMs=200`(login과 동일). 락을 못 얻으면 `{ok:false, error:'LOCK_TIMEOUT'}`(Apps Script와 동일 에러 코드).

### 2-4. idempotency — 기존 모듈 그대로 재사용

`lib/writeIdempotency.js`의 `withIdempotency(firestore, idempotencyKey, action, actionFn)`을 그대로 씁니다. `action` 태그만 `'upsertItem'`/`'upsertCustomer'`로 구분합니다. Code.gs 디스패처가 `handleUpsertItem_` 전체를 `withIdempotency_`로 감싸는 것과 동일하게, **idempotency가 가장 바깥쪽이고 그 안에서 락을 획득**하는 순서를 유지합니다(같은 요청이 재시도되면 락 경합 자체가 생기지 않고 캐시된 응답을 즉시 반환).

### 2-5. 쓰기 흐름 — `upsertItemAction_`(제안, 의사코드)

```
1. 필드 파싱/검증 (MISSING_FIELDS 등 — 락 밖, Apps Script와 동일 순서)
2. 사용자팀마스터 fresh read → manager 조회 (MANAGER_NOT_FOUND / MANAGER_NOT_IN_YOUR_TEAM)
3. 고객사마스터 fresh read → customerExists 확인 (CUSTOMER_NOT_FOUND / MISSING_MATERIAL_CODE)
4. acquireLock(firestore, 'upsertItemAndCustomer', holderId, {waitMs:10000, staleMs:15000, pollMs:200})
   실패 시 → { ok:false, error:'LOCK_TIMEOUT' }
5. try {
     락 안에서 다시 한번 fresh read로 재확인(경합 방지, Apps Script와 동일):
       - 신규 고객사 필요하면 재확인 후 append, createdCustomerCode 기록
       - 품목 수정/신규 처리, 실패 시 result = 에러
     result가 실패이고 createdCustomerCode가 있으면 → 방금 만든 고객사 행 롤백(삭제)
   } finally {
     releaseLock(firestore, 'upsertItemAndCustomer', holderId)
   }
6. result 반환
```

`upsertCustomerAction_`도 동일한 락(`'upsertItemAndCustomer'`)을 공유하되, 흐름은 더 단순합니다(락 안에서 재확인 후 append만).

### 2-6. 시트 쓰기 방식(Sheets API 세부)

- 품목 신규: `values:append`(`품목마스터!A:H`) — Code.gs `appendRow`와 동일한 8개 컬럼 순서.
- 품목 수정: `values.update`로 B~G(6개 컬럼: customer/itemName/manager/team/materials/status)만 — A열(itemId)/H열(등록일)은 건드리지 않음.
- 고객사 신규: `values:append`(`고객사마스터!A:C`).
- 고객사 롤백(삭제): Sheets API에는 "행 삭제" 전용 `values` API가 없어서 `spreadsheets.batchUpdate`의 `deleteDimension` 요청을 새로 써야 합니다 — **기존 8개 Cloud Run 함수 중 이 오퍼레이션을 써본 함수가 없습니다.** 새로운 API 표면이라 구현/테스트에 더 신경 써야 하는 부분입니다(2-7 참고).
- 캐시 무효화(`invalidateSheetCache_`)는 Cloud Run에 대응 개념이 없습니다(매 요청 fresh read이므로 신경 쓸 필요 없음).

### 2-7. 신규로 구현해야 하는 요소 — 리스크로 표시

1. **행 삭제(롤백) API**: 위에서 설명한 `deleteDimension` — 기존 함수 어디에도 선례가 없는 첫 사례입니다. 구현 시 parity 테스트에서 특히 꼼꼼히 검증이 필요합니다(엉뚱한 행을 지우면 실제 운영 데이터 손실로 이어지는 만큼, 가장 리스크가 큰 부분입니다).
2. **분산 락 모듈(`lib/writeLock.js`)**: `acquireLoginLock_` 패턴의 일반화. 로직 자체는 이미 실전 검증됐지만(login에서 사용 중), 새 모듈로 추출하면서 실수가 없는지 확인 필요.
3. **품목마스터 등록일(H열) 신규 작성 시 날짜 포맷**: Code.gs는 `appendRow`로 `new Date()`를 쓰고 이후 `setNumberFormat('yyyy-mm-dd')`로 표시 형식을 지정합니다. Sheets API로 같은 결과를 내려면 (a) ISO 문자열을 `valueInputOption=USER_ENTERED`로 써서 Sheets가 날짜로 인식하게 하거나 (b) 별도로 셀 서식 지정 API를 호출해야 합니다. 기존 함수들(`loginTest` 등)은 이런 요구가 없었던 첫 사례라, 실제 구현 단계에서 재홍님 시트를 열어 등록일 컬럼이 실제로 날짜로 인식되는지 직접 확인이 필요합니다.

### 2-8. 에러 코드 매핑(Apps Script와 동일하게 유지)

| 상황 | `upsertItemTest` | `upsertCustomerTest` |
|---|---|---|
| `sessionToken` 없음/무효/만료 | `MISSING_SESSION_TOKEN` / `SESSION_NOT_FOUND` / `SESSION_EXPIRED` | 동일 |
| 팀장이 아님 | `FORBIDDEN` | `FORBIDDEN` |
| 필수 필드 누락 | `MISSING_FIELDS` | `MISSING_FIELDS` |
| 담당소장 없음 | `MANAGER_NOT_FOUND` | — |
| 담당소장이 다른 팀 | `MANAGER_NOT_IN_YOUR_TEAM` | — |
| 고객사 없고 신규코드도 없음 | `CUSTOMER_NOT_FOUND` | — |
| 신규 등록인데 자재코드 없음 | `MISSING_MATERIAL_CODE` | — |
| 고객사명 중복 | `CUSTOMER_ALREADY_EXISTS` | `CUSTOMER_ALREADY_EXISTS` |
| 고객사코드 중복 | `CUSTOMER_CODE_ALREADY_EXISTS` | `CUSTOMER_CODE_ALREADY_EXISTS` |
| 자재코드 중복(신규) | `MATERIAL_CODE_ALREADY_EXISTS` | — |
| 수정 대상 품목 없음 | `ITEM_NOT_FOUND` | — |
| 락 획득 실패 | `LOCK_TIMEOUT` | `LOCK_TIMEOUT` |
| 같은 idempotencyKey 처리 중 | `DUPLICATE_IN_PROGRESS_RETRY_LATER` | 동일 |
| 정상 | `{ok:true, itemId, mode:'created'|'updated'}` | `{ok:true, code, name, manager}` |

### 2-9. 쓰기 권한(스코프)

`postCommentTest`/`markThreadSeenTest`/`loginTest`와 동일한 최소 권한 원칙: `upsertItemTest`/`upsertCustomerTest` 안에서만 쓰기 스코프(`https://www.googleapis.com/auth/spreadsheets`, 읽기+쓰기)의 `GoogleAuth`를 새로 만들고, 다른 기존 읽기 전용 함수들은 지금처럼 `spreadsheets.readonly`를 그대로 유지합니다. **선행 조건(기존 markThreadSeen 설계 때와 동일)**: Cloud Run 실행 서비스 계정이 실제 스프레드시트에 편집자로 공유돼 있어야 하며, 이미 postComment/updateComment/deleteComment/markThreadSeen이 배포돼 정상 동작 중이므로 이 조건은 이미 충족돼 있을 것으로 추정됩니다(실제 구현 단계에서 재확인).

### 2-10. 프론트엔드 배선 설계(이번엔 구현하지 않음, 설계만)

- 상수 제안: `CLOUD_RUN_UPSERT_ITEM_URL`, `CLOUD_RUN_UPSERT_CUSTOMER_URL`(빈 문자열 = 롤백 스위치, 기존 패턴과 동일).
- **쓰기 작업이므로 읽기 함수(getItems 등)와는 폴백 정책이 달라야 합니다.** 읽기는 "Cloud Run 실패 시 조용히 Apps Script로 재시도"가 안전하지만(같은 조회를 두 번 해도 부작용 없음), 쓰기는 "Cloud Run 요청이 타임아웃됐지만 실제로는 서버에서 성공했을 수 있는" 애매한 상황에서 무작정 Apps Script로 재시도하면 이중 등록 위험이 있습니다. 이미 postComment 설계 문서(`POSTCOMMENT_CLOUDRUN_DESIGN_v2.md`)가 이 문제를 다룬 적이 있으므로, 실제 배선 설계 단계에서 그 결론(정상 JSON 응답을 받았는지로 "사전 실패"와 "애매한 실패"를 구분하고, `idempotencyKey`를 폴백 요청에도 동일하게 실어 보내는 방식)을 그대로 따르는 것을 제안합니다. 이번 설계 문서 범위에서는 방향만 제시하고, 구체적인 프론트 코드는 별도 승인 단계(5번 참고)에서 다시 상세 설계하겠습니다.
- `console.log('[upsertItem] source=cloud-run|apps-script ...')` 로그(기존 컨벤션)도 동일하게 추가 제안.

---

## 3. Parity 테스트 계획

기존 방식(예: `markthreadseen-parity`)을 그대로 따릅니다 — **합성(가짜) 데이터로만 실행, 실제 시트/Firestore/Cloud Run에는 어떤 네트워크 호출도 하지 않습니다.**

**A그룹 — Sheets 쓰기 판단 로직 parity**: `apps_script_ref.js`(Code.gs `handleUpsertItem_`/`handleUpsertCustomer_` 포트) vs `cloudrun_port.js`(`upsertItemAction_`/`upsertCustomerAction_`의 판단 로직 포트). Sheets API 호출 자체는 걷어내고, "이 입력에 대해 어떤 결정을 내리는가"만 비교합니다.

**B그룹 — idempotency/세션 인증 정책**: `withIdempotency()`/`authenticateSession()`을 실제 프로덕션 코드 그대로 `fake_firestore.js`에 실행 — 기존 markThreadSeen parity와 동일한 방식.

**C그룹(신규) — 분산 락 정책**: `lib/writeLock.js`의 `acquireLock`/`releaseLock`도 실제 프로덕션 코드 그대로 `fake_firestore.js`에 실행 — 락 선점, 동시 요청 경합, 죽은 락 자가회수, holder가 아니면 해제 안 되는지 등을 검증.

### 시나리오 목록(제안)

1. **정상 등록(신규 품목, 기존 고객사)** — materialCode 신규 → `{ok:true, mode:'created'}`, 품목마스터에 정확한 8개 컬럼으로 추가되는지.
2. **정상 수정(기존 품목)** — itemId 지정 → B~G만 갱신되고 A/H는 그대로인지.
3. **정상 등록(신규 품목 + 신규 고객사)** — `newCustomerCode` 포함 → 고객사마스터에 먼저 추가되고, 이어서 품목이 추가되는지(둘 다 성공).
4. **원자적 롤백** — 신규 고객사 추가는 성공했지만 이어지는 품목 등록이 실패(예: 다른 요청이 그새 같은 materialCode를 선점)하는 상황을 흉내 내어, 방금 만든 고객사 행이 정확히 롤백(삭제)되는지, 원래 있던 다른 고객사 행은 건드리지 않는지.
5. **중복 등록 시도 — 자재코드** — 이미 존재하는 materialCode로 신규 등록 → `MATERIAL_CODE_ALREADY_EXISTS`.
6. **중복 등록 시도 — 고객사명** → `CUSTOMER_ALREADY_EXISTS`.
7. **중복 등록 시도 — 고객사코드** → `CUSTOMER_CODE_ALREADY_EXISTS`.
8. **권한 없는 사용자** — role이 '담당'/'일반'/'임원'인 계정으로 호출 → `FORBIDDEN`(upsertItem/upsertCustomer 둘 다).
9. **잘못된 입력** — customer/itemName/manager 중 하나 누락, 또는 신규 등록인데 materialCode 누락 → 각각 정확한 에러 코드.
10. **담당소장 검증** — 존재하지 않는 이름 → `MANAGER_NOT_FOUND`; 다른 팀 소속 담당소장 → `MANAGER_NOT_IN_YOUR_TEAM`.
11. **고객사 없음** — 존재하지 않는 고객사명이고 `newCustomerCode`도 없음 → `CUSTOMER_NOT_FOUND`.
12. **수정 대상 없음** — 존재하지 않는 itemId로 수정 시도 → `ITEM_NOT_FOUND`.
13. **동시 등록(락 경합)** — 같은 materialCode로 거의 동시에 두 요청을 보내는 상황을 흉내(C그룹 락 테스트로 검증) → 하나만 성공하고 다른 하나는 정상적으로 `MATERIAL_CODE_ALREADY_EXISTS`(락을 기다렸다가 재확인에서 걸림)를 받는지, 또는 락 자체를 못 얻으면 `LOCK_TIMEOUT`을 받는지.
14. **동시 등록(다른 자재코드, 경합 없음)** — 서로 다른 materialCode로 동시에 등록 시도 → 락 때문에 순차적으로 처리되지만 **둘 다 성공**하는지(락이 불필요하게 실패를 만들지 않는지 확인).
15. **같은 idempotencyKey로 재시도** — 정상 등록 응답을 캐시에서 그대로 재반환하는지(시트에 중복 반영 안 되는지).
16. **동일 idempotencyKey, IN_PROGRESS 상태에서 재호출** — 짧은 폴링 후 완료 응답을 받거나, 끝까지 안 풀리면 `DUPLICATE_IN_PROGRESS_RETRY_LATER`.
17. **행 삭제(롤백) API 자체의 정확성** — `deleteDimension` 요청이 정확히 의도한 행 번호만 지우는지(오프바이원 오류 등 방지) — 신규 구현 요소(2-7)라 별도로 집중 검증.

**결과**: `results.json`에 전체 케이스 PASS 여부 기록, README.md에 방법론 설명 — 기존 파일들과 동일한 형식. **이 결과는 코드 레벨 로직 검증이며, 실제 GCP 배포/실데이터 통합 테스트를 대체하지 않습니다** — 그건 4번(smoke test)에서 별도로 진행합니다.

---

## 4. Smoke 테스트 계획

### 중요한 제약 — 삭제 API가 없음

`postComment`/`updateComment`/`deleteComment`의 smoke test는 "더미 댓글을 만들고 → 검증하고 → `deleteCommentTest`로 정리"하는 깔끔한 순환이 가능했습니다. **품목/고객사는 그게 안 됩니다:**

- 품목마스터에는 `status`를 `'비활성'`으로 바꾸는 소프트 삭제만 가능(진짜 삭제는 API에 없음, 행이 시트에 영구히 남음).
- 고객사마스터에는 `status` 컬럼 자체가 없어서, **한번 만든 테스트 고객사는 API로 되돌릴 방법이 전혀 없습니다.**

**제안하는 절충안**:

1. 품목명/고객사명/자재코드에 명확한 접두사(예: `SMOKETEST_`, 자재코드는 `ZZTEST-` 등 실제 코드 체계와 절대 겹치지 않을 접두사)를 붙여, 실제 운영 데이터와 절대 혼동되지 않고 나중에 찾기 쉽게 만듭니다.
2. 품목 smoke test는 (a) 정상 등록 → (b) 응답 검증 → (c) **곧바로 같은 itemId로 `status:'비활성'`으로 수정 호출**(소프트 삭제) 순으로 진행합니다. 완전히 지워지진 않지만, 목록 화면에서는 비활성으로 표시되어 실사용에 지장이 없습니다.
3. `upsertCustomer` 단독 호출은 **가급적 smoke test에서 실제 쓰기까지 하지 않는 것을 제안합니다.** 이유: (a) 되돌릴 방법이 없고, (b) 1-2에서 확인했듯 현재 UI에 이 액션을 호출하는 진입점이 없어 실사용 시나리오와 무관합니다. 대신:
   - `upsertCustomer`의 **에러 경로**(세션 없음, 권한 없음, 필드 누락, 이미 존재하는 이름/코드로 시도)는 실제 쓰기가 없으므로 안전하게 smoke test할 수 있습니다.
   - `upsertCustomer`의 **정상 등록 경로**는 (품목 smoke test의 3번 시나리오, 즉 `upsertItem` + `newCustomerCode`를 통해) 간접적으로 이미 검증됩니다 — 다만 이 경우도 고객사 행 자체는 영구히 남습니다(품목처럼 비활성화할 수단이 없음).
   - 이 판단에 동의하시는지, 아니면 정말 신규 고객사 API 자체를 별도로 한 번 실행해서 확인하고 싶으신지는 **재홍님 결정이 필요한 지점입니다.** 실행하고 싶으시다면, smoke test 이후 재홍님이 직접 스프레드시트에서 해당 테스트 행을 수동으로 지우는 것을 전제로 진행하겠습니다.
4. 롤백(4번 시나리오, 원자적 취소) smoke test는 실제로 "품목 등록을 일부러 실패시키는" 상황을 운영 데이터로 재현하기 어렵습니다(예: 동시에 같은 자재코드를 다른 경로로 선점해야 함) — 이건 parity 테스트(3번 문서의 4번 시나리오)에서 이미 합성 데이터로 검증하고, smoke test에서는 **실제 배포 환경에서 정상 경로(등록 성공 + 소프트 삭제)만** 확인하는 것을 제안합니다.

### 필요한 테스트 계정

- `TEST_EMAIL`/`TEST_PASSWORD`: role이 '팀장'인 실제 로그인 가능한 계정(권한 있는 정상 케이스용).
- (선택) `TEST_EMAIL_2`/`TEST_PASSWORD_2`: role이 '팀장'이 아닌 계정(FORBIDDEN 케이스 확인용) — 지정 안 하면 이 케이스는 SKIPPED.
- 담당소장 검증 케이스를 실행하려면, `TEST_EMAIL` 계정과 같은 팀에 소속된 실제 '담당' role 사용자 이름이 하나 필요합니다(`manager` 필드용).

### 주의사항

- 비밀번호는 스크립트나 커밋에 절대 하드코딩하지 않고 환경변수로만 전달(기존 원칙 동일).
- 스크립트 실행 전, 사용할 `SMOKETEST_` 접두사 품목명/자재코드가 실제로 아직 존재하지 않는지 먼저 확인(스크립트 자체가 타임스탬프를 이름에 섞어 매번 고유하게 만드는 방식을 제안 — 기존 `smoke_test_updatecomment_deletecomment.sh`의 `DUMMY_STAMP` 방식과 동일).
- 스크립트가 중간에 실패해서 조기 종료되면(품목이 비활성화되지 않은 채 남는 등) 출력에 찍힌 itemId/materialCode를 기록해뒀다가 직접 확인/정리할 것 — 기존 스크립트들과 동일한 안내를 포함하겠습니다.
- 실행 전 선행 조건: `loginTest`, `upsertItemTest`, `upsertCustomerTest`가 모두 Cloud Run에 배포돼 있어야 함(스크립트 자체는 배포를 수행하지 않음).

---

## 5. 단계별 작업 계획

| 단계 | 목표 | 검증 방법 | 승인 필요 여부 |
|---|---|---|---|
| **0. 이 설계 문서 승인** | 지금 이 문서에 대한 동의 | 재홍님 확인 | **필요** (지금 요청드리는 것) |
| **1. 구현** | `lib/writeLock.js` 신설, `upsertItemTest`/`upsertCustomerTest`를 index.js에 작성, 프론트(`feed.html`)는 전혀 건드리지 않음 | `node --check` 문법 검증 | 별도 승인 필요 |
| **2. Parity 테스트** | 3번 계획대로 합성 데이터 기반 로직 검증(A/B/C그룹, results.json) | 전체 케이스 PASS 확인, 재홍님께 결과 보고 | 결과 보고 후 다음 단계 진행에 대한 승인 필요 |
| **3. GitHub 커밋** | 구현 코드 + parity 테스트 파일 커밋 | 커밋 전 diff 제시, 커밋 후 해시/변경 요약 보고 | 필요 |
| **4. Cloud Run 배포 + Smoke 테스트** | 4번 계획대로 실제 배포 환경에서 소수 테스트 계정으로 확인 | 재홍님이 직접 Cloud Shell에서 배포·실행(기존 방식과 동일하게 상세 가이드 제공), 결과 공유받아 확인 | 필요 (배포 자체 승인 + 가이드 실행은 재홍님이 직접) |
| **5. 프론트 배선(feed.html 연결)** | 2-10에서 제시한 방향대로 `CLOUD_RUN_UPSERT_ITEM_URL`/`CLOUD_RUN_UPSERT_CUSTOMER_URL` 배선 상세 설계 → diff 제시 → 적용 → 커밋 | 배선 후 콘솔 로그(`source=cloud-run`)로 확인 | **별도 승인 필요 — 이번 계획 범위에 포함하지 않음.** 4단계까지 안정성이 확인된 뒤 재홍님이 원하실 때 별도로 요청해주시면 그때 상세 설계부터 다시 시작하겠습니다. |

각 단계는 이전 단계 완료·보고 후 다음 단계로 넘어가며, 특히 3(커밋)과 4(배포)는 지금까지와 마찬가지로 반드시 개별 승인을 받습니다.

---

## 6. 기존 원칙 준수 확인

- **Apps Script(`Code.gs`) 코드는 이번 계획에서 전혀 수정하지 않습니다** — 기존 `handleUpsertItem_`/`handleUpsertCustomer_`는 그대로 fallback 경로로 유지됩니다.
- **Cloud Run 배포는 승인 전까지 하지 않습니다.**
- **`feed.html`/`index.html` 등 프론트엔드 파일은 이번 단계(0~4단계)에서 전혀 건드리지 않습니다** — 프론트 배선은 5단계로 명확히 분리했습니다.
- **쓰기 스코프는 최소 권한 원칙을 따릅니다** — `upsertItemTest`/`upsertCustomerTest` 함수 내부에서만 쓰기 스코프(`spreadsheets`, 읽기+쓰기)의 `GoogleAuth`를 새로 만들고, 다른 모든 읽기 함수는 지금처럼 `spreadsheets.readonly`를 유지합니다.
- **이 문서 자체로는 코드 작성/GitHub 커밋/Cloud Run 배포/Apps Script 배포를 전혀 하지 않았습니다.**

---

## 결정이 필요한 지점 (요약)

이 계획을 승인하시기 전에, 아래 3가지에 대한 의견을 들려주시면 실제 구현 단계에 바로 반영하겠습니다(정하지 않으셔도 제안대로 진행할 수 있고, 구현 중 다시 한번 확인받겠습니다):

1. **락 범위(2-3)**: `upsertItem`/`upsertCustomer` 두 함수가 락 이름 하나(`upsertItemAndCustomer`)를 공유하는 제안에 동의하시는지, 아니면 더 세밀하게 나누길 원하시는지.
2. **`upsertCustomer` 단독 smoke test(4번 3항)**: 에러 경로만 확인하고 정상 등록 경로는 실제 쓰기를 생략하는 제안에 동의하시는지, 아니면 실제로 한 번 등록해보고(되돌릴 수 없음을 감수하고) 나중에 직접 정리하실 것인지.
3. **등록일(H열) 날짜 포맷(2-7-3)**: 구현 단계에서 실제 시트를 열어 확인이 필요한 항목이라는 점 참고 부탁드립니다.

이 계획에 동의하시면 말씀해주세요 — 그때부터 1단계(구현)에 들어가겠습니다.
