# upsertItemTest/upsertCustomerTest 코드 레벨 parity/정책 테스트 (2026-08-27)

합성(가짜) 데이터로만 실행한다. 실제 시트/Firestore/Cloud Run에는 어떤 네트워크 호출도 하지 않는다.

## A그룹 (시나리오 1~12, 17 + UC1~UC5) — Sheets 쓰기 판단 로직 parity

`apps_script_ref.js`(Code.gs `handleUpsertItem_`/`handleUpsertCustomer_` 포트) vs
`cloudrun_port.js`(index.js `upsertItemAction_`/`upsertCustomerAction_`의 판단 로직 포트).
둘 다 Sheets API/Apps Script 시트 호출, `LockService`/Firestore 락 호출을 걷어낸 순수 함수
포트다 — 기존 parity 테스트들과 같은 한계를 가진다: "실제로 배포된 그 함수"가 아니라
"그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을 비교한다. 락 자체는 실제 코드로 C그룹에서,
락+판단 로직의 동시성 통합은 실제 코드로 D그룹에서 별도 검증한다.

다룬 시나리오: 정상 등록(신규 품목/신규 품목+신규 고객사 동시 생성)/정상 수정, 자재코드
중복, 고객사명·고객사코드 경합(락 밖 확인 통과 후 락 안 재확인에서 발견), 권한 없는 사용자,
필수값 누락 4종, 담당소장 검증 2종, 고객사 없음, 수정 대상 없음, 롤백 시 다른 고객사 행 보존,
그리고 아래에 별도로 설명하는 **시나리오 4b(예외 경로 롤백 — 최초 발견된 버그를 이 케이스로
검출했고, 수정 후 지금은 회귀 확인용으로 남겨둠)**. upsertCustomer는 정상 등록/이름 중복/코드
중복/권한 없음/필드 누락 5가지.

## B그룹 (시나리오 15/16-a/16-b + 세션재확인) — idempotency/세션 인증 정책 테스트

이건 포트가 아니라, `lib/writeIdempotency.js`의 `withIdempotency()`와 `lib/auth.js`의
`authenticateSession()`을 **실제 프로덕션 코드 그대로** require해서 `fake_firestore.js`
(인메모리 Firestore 스텁)를 인자로 넘겨 직접 실행한다.

- 시나리오 15: 같은 idempotencyKey로 upsertItem을 두 번 호출 -> 실제 작업(actionFn)은 1회만
  실행되고 두 응답이 동일한지.
- 시나리오 16-a/16-b: IN_PROGRESS 상태 -> (a) 폴링 중 DONE으로 바뀌면 그 응답을 받는지, (b)
  upsertCustomer 액션 태그로 끝까지 안 풀리면 `DUPLICATE_IN_PROGRESS_RETRY_LATER`를 받는지.
- 세션재확인: `sessionToken` 없음/존재하지 않음/만료/정상 4가지 -> 에러 코드가 기존
  markthreadseen-parity와 동일한 표와 일치하는지(회귀 재확인).

## C그룹 (C1~C5) — 분산 락(`lib/writeLock.js`) 정책 테스트, 실제 코드 그대로 실행

`acquireLock()`/`releaseLock()`을 실제 프로덕션 코드 그대로 require해서 `fake_firestore.js`를
인자로 넘겨 직접 실행한다.

- C1: 정상 락 획득 + 해제 — 획득 성공, 해제 후 락 문서가 실제로 삭제되는지.
- C2: 유효한 락 경합 — 다른 holder가 이미 쥐고 있으면 `waitMs`가 끝날 때까지 기다려도 획득에
  실패하는지(시간 측정으로 실제로 폴링했는지까지 확인).
- C3: 락 해제 후 재시도 성공 — 먼저 쥔 쪽이 도중에 해제하면, 대기 중이던 쪽이 다음 폴링에서
  곧바로 획득하는지.
- C4: 죽은 락 자가회수 — `staleMs`보다 오래된 락은 대기 없이 즉시 탈취하는지.
- C5: holder 불일치 시 해제 무시 — 남의 `holderId`로 `releaseLock()`을 호출해도 락 문서가
  삭제되지 않는지.

## D그룹 (시나리오 13/14, 신규) — 락 + 판단 로직 동시성 통합 테스트

C그룹의 실제 `lib/writeLock.js`와 A그룹의 `cloudrun_port.js` 판단 로직을 함께, 진짜
`Promise.all`로 동시에 실행해서 락이 실제로 두 요청을 직렬화하는지 확인한다(설계 문서
3단계 계획에 있었지만 원래 17개 시나리오 표에는 없던 그룹 — 락 자체(C그룹)와 판단
로직(A그룹)을 각각 따로 검증하는 것만으로는 "두 개를 실제로 합쳤을 때도 맞물려 동작하는가"를
보장하지 못한다고 판단해 추가했다).

- 시나리오 13: 동시에 같은 자재코드(`MP-700`)로 두 요청을 동시에 보내도, 락 덕분에 하나만
  성공하고 나머지는 `MATERIAL_CODE_ALREADY_EXISTS`를 받는지, 최종 시트에 그 코드로 행이
  정확히 1개만 남는지.
- 시나리오 14: 서로 다른 자재코드(`MP-800`/`MP-801`)로 동시에 보내면, 락 때문에 순차
  직렬화되지만 결국 둘 다 성공하고 두 행 모두 최종 시트에 남는지.

## ✅ 시나리오 4b — 예외 경로 롤백 불일치 (2026-08-27 발견 및 수정 완료)

**최초 실행(2026-08-27 오전)에서 이 케이스가 `same: false`로 실패하면서, 테스트 코드가 아니라
실제로 구현된 `index.js`의 `upsertItemAction_`에 있는 진짜 버그를 찾아냈다.** 아래는 그
원인 분석과, 그 후 적용해 재검증까지 마친 수정 내용이다.

**재현 시나리오**: 신규 고객사를 새로 만들면서(`newCustomerCode` 지정) 동시에 신규 품목도
등록하는데, 품목을 실제로 쓰는 도중 예외가 발생하는 경우(테스트에서는
`materialCode: '__SIMULATE_THROW__'`로 흉내). 즉 "고객사는 이미 만들어졌는데, 품목 쓰기는
실패한" 상황.

**Code.gs 원본(3123~3247행)의 동작(= `apps_script_ref.js`가 재현)**: 롤백 검사
(`if (result && !result.ok && createdCustomerCode) { ... }`, 3227행)가 등록/수정 로직을
감싸는 `try/catch`(3179~3225행)의 **바깥**에 있다. 그래서 품목 쓰기 도중 예외가 나서
`catch`가 `result`를 `SERVER_ERROR`로 바꿔놓아도, 그 바깥의 롤백 검사는 항상 실행된다 —
즉 예외가 나든 안 나든 실패로 끝나면 방금 만든 고객사는 반드시 롤백된다.

**수정 전 실제 구현(`index.js` `upsertItemAction_`)의 동작**: 같은 롤백 검사가 등록/수정
로직을 감싸는 `try` 블록 **안쪽**, `catch`보다 **앞**(1998행경)에 있었다. 품목 쓰기 도중
예외가 던져지면, 그 즉시 롤백 검사 줄을 건너뛰고 바로 `catch`로 점프한다 — 롤백 검사 자체가
실행되지 않는다. 결과적으로 방금 만든 고객사 행은 롤백되지 않고 시트에 그대로 남는데, 그
고객사를 참조하는 품목은 등록에 실패했으므로 **고객사만 있고 연결된 품목은 없는 고아
(orphan) 행**이 생긴다. 이번 설계에서 원자적 생성/롤백을 보장하겠다고 한 전제가 이 경로에서는
깨져 있었다.

수정 전 최초 실행 결과에서 두 결과를 나란히 보면 차이가 명확했다:
- `appsScript.customers`: `[['C001','기존고객사','이담당']]` — 롤백되어 원래 상태로 복귀.
- `cloudRun.customers`: `[['C001','기존고객사','이담당'], ['C004','새고객사3','이담당']]` —
  `C004`가 롤백되지 않고 그대로 남음(고아 행).
- 두 경우 모두 `result`는 동일하게 `{ ok:false, error:'SERVER_ERROR', detail:'Error:
  SIMULATED_SHEETS_ERROR' }`를 반환했다 — 즉 **호출자 입장에서는 실패 응답을 똑같이
  받지만, 시트 상태는 서로 다르게 남는다**는 점이 이 버그를 더 위험하게 만들었다(실패
  응답만 보고는 고아 행이 생겼는지 알 수 없다).

**발생 가능성에 대한 참고**: 이 경로를 실제로 타려면 "고객사는 새로 만들어야 하고 + 품목
쓰기 자체가 예외를 던져야" 한다 — 자재코드 중복처럼 판단 로직이 잡아내는 실패(시나리오 4,
이건 수정 전에도 두 구현 모두 정상적으로 롤백됨, `results.json`의 `4` 케이스 PASS 참고)가
아니라, Sheets API 네트워크 오류/타임아웃처럼 진짜 예외적인 상황에서만 발생한다. 흔한
경로는 아니지만, 발생하면 데이터 정합성이 조용히 깨진다는 점에서 배포 전에 반드시 고쳐야
한다고 판단해 아래와 같이 수정했다.

**적용한 수정**: `index.js`의 `upsertItemAction_`에서 롤백 검사를 안쪽 `try` 블록 밖,
`catch` 이후(같은 레벨)로 옮겨 Code.gs 3227행과 동일한 위치로 맞췄다. 이 검사가 롤백에
필요로 하는 `client`(`getItemCustomerWriteClient_()`로 얻은 Sheets 쓰기 클라이언트,
`rollbackCustomerRow_(client, ...)` 호출에 필요) 변수는 원래 안쪽 `try` 안에서
`const client = ...`로 선언돼 있었는데, 바깥 스코프(catch 이후)에서도 접근할 수 있도록
`let client;`를 두 번째 `try` 시작 전으로 끌어올리고, 안쪽에서는 `client = await
getItemCustomerWriteClient_();`로 대입만 하도록 바꿨다(선언과 대입 분리). 다른 로직은
전혀 건드리지 않았다 — `cloud-run/mro-functions/tests/upsertitem-upsertcustomer-parity/`
디렉터리에 함께 전달한 `UPSERTITEM_ROLLBACK_BUGFIX_2026-08-27.diff`가 이 변경만 담은
diff다.

수정 후 이 4b 케이스는 `note` 없이 일반 케이스로 전환했고, 스위트를 재실행해
`same: true`(PASS)로 바뀐 것을 확인했다 — 아래 "결과" 절 참고.

## 실행 방법

```bash
cd cloud-run/mro-functions
npm install   # @google-cloud/firestore(FieldValue) 의존성 필요, 로컬 검증용
node tests/upsertitem-upsertcustomer-parity/run_tests.js
```

## 결과

### 1차 실행 (2026-08-27, 수정 전)

`results.json`에 총 34개 케이스(A그룹 23개 + B그룹 4개 + C그룹 5개 + D그룹 2개) 중 33건
PASS, 1건은 알려진 실패(시나리오 4b, 위에서 설명한 롤백 위치 버그를 그대로 검출), 그 외
예상 밖 실패는 0건이었다. `run_tests.js`는 `note` 필드가 있는 실패(=알려진 실패)는 스위트
실패로 세지 않으므로 `process.exitCode`는 `0`으로 종료됐다.

### 2차 실행 (2026-08-27, 수정 후 — 현재 `results.json`에 기록된 결과)

`index.js`의 롤백 검사 위치를 수정한 뒤 `node --check`로 문법을 확인하고 스위트를 다시
실행했다. **34건 전부 PASS(알려진 실패 0건, 예상 밖 실패 0건)로 바뀌었다.** 시나리오 4b도
이제 `same: true`다 — `cloudRun.customers`가 `appsScript.customers`와 동일하게
`[['C001','기존고객사','이담당']]`로, 고아 행 없이 정확히 롤백된다.

**이 결과는 코드 레벨 로직 검증이며, 실제 GCP 배포/실데이터 통합 테스트를 대체하지 않는다**
— 그건 별도 승인 후 다음 단계(3단계 smoke test)에서 진행한다.
