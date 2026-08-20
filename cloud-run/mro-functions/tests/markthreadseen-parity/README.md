# markThreadSeenTest 코드 레벨 parity/정책 테스트 (2026-08-20)

합성(가짜) 데이터로만 실행한다. 실제 시트/Firestore/Cloud Run에는 어떤 네트워크 호출도 하지 않는다.

## A그룹 (시나리오 1/2/3/6) — Sheets upsert 판단 로직 parity

`apps_script_ref.js`(Code.gs `handleMarkThreadSeen_` 포트) vs `cloudrun_port.js`(index.js
`markThreadSeenAction_`의 판단 로직 포트). 둘 다 Sheets API/Apps Script 시트 호출을 걷어낸
순수 함수 포트다 — `tests/threadseen-parity`(기존, 읽기 전용 함수)와 같은 방식과 같은 한계를
가진다: "실제로 배포된 그 함수"가 아니라 "그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을 비교한다.

## B그룹 (시나리오 4/5/7) — idempotency/세션 인증 정책 테스트

이건 포트가 아니라, `lib/writeIdempotency.js`의 `withIdempotency()`와 `lib/auth.js`의
`authenticateSession()`을 **실제 프로덕션 코드 그대로** require해서 `fake_firestore.js`
(인메모리 Firestore 스텁)를 인자로 넘겨 직접 실행한다. 두 함수 모두 `firestore`를 파라미터로
받는 구조라 모킹 없이도 실제 코드를 그대로 테스트할 수 있다.

- 시나리오 4: 같은 idempotencyKey로 두 번 호출 -> 실제 작업(actionFn)은 1회만 실행되는지.
- 시나리오 5: IN_PROGRESS 상태 -> (a) 폴링 중 DONE으로 바뀌면 그 응답을 받는지, (b) 끝까지
  안 풀리면 `DUPLICATE_IN_PROGRESS_RETRY_LATER`를 받는지.
- 시나리오 7: `sessionToken` 없음/존재하지 않음/만료/정상 4가지 -> 에러 코드가 설계 문서의
  표와 일치하는지.

## 실행 방법

```bash
cd cloud-run/mro-functions
npm install   # @google-cloud/firestore(FieldValue) 의존성 필요, 로컬 검증용
node tests/markthreadseen-parity/run_tests.js
```

## 결과 (2026-08-20)

`results.json`에 8개 케이스(A그룹 4개 + B그룹 4개, 시나리오 5는 5-a/5-b로 분리) 전부 `PASS`로
기록되어 있다. **이 결과는 코드 레벨 로직 검증이며, 실제 GCP 배포/실데이터 통합 테스트를
대체하지 않는다** — 그건 별도 승인 후 다음 단계에서 진행한다.
