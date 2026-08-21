# loginTest 코드 레벨 parity/정책/락 테스트 (2026-08-21)

합성(가짜) 데이터로만 실행한다. 실제 시트/Firestore/Cloud Run에는 어떤 네트워크 호출도
하지 않는다. `postCommentTest`/`markThreadSeenTest` parity 테스트와 동일한 방법론을 따른다.

## A그룹 (시나리오 1~11) — 로그인 검증 체인 parity

`apps_script_ref.js`(Code.gs `handleLogin_`/`hashPassword_`/`findUser_` 포트) vs
`cloudrun_port.js`(index.js `loginAction_`/`hashPassword_`의 검증 로직 포트). 둘 다 실제
Sheets 조회·쓰기, Firestore 세션 쓰기를 걷어낸 순수 함수 포트다 — "실제로 배포된 그 함수"가
아니라 "그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을 비교한다.

**이 그룹의 핵심 검증 지점**: `passwordChangedAt` 컬럼을 두 런타임이 서로 다른 원시값으로
읽는다는 사실을 그대로 반영해서 시험했다 — Apps Script는 `SpreadsheetApp`이 이미 Date
객체로 돌려주고, Cloud Run은 Sheets API `UNFORMATTED_VALUE`가 돌려주는 시트 시리얼 숫자를
`lib/feedEngine.js`의 `sheetSerialToMs`로 변환한다. 그래서 이 테스트는 "같은 로우 배열"을
양쪽에 그대로 넘기지 않고, 하나의 논리적 레코드(실제 절대시각 `changedAtMs`)로부터 각
런타임이 실제로 보게 될 표현(Date 객체 / 시트 시리얼 숫자)을 각각 만들어 넘긴다
(`run_tests.js`의 `buildRows` 참고). 이 표현 차이 자체가 postComment 때 발견된 날짜 버그와
같은 종류의 함정이 있는지 확인하는 지점이다.

다룬 시나리오: 필수값 누락, 존재하지 않는 사용자, 비활성 계정, 잠긴 계정(failCount≥5),
잘못된 비밀번호(failCountAfter 증가값 확인), 정상 로그인(만료 전/후 양쪽), 비밀번호 변경
이력 없음(Infinity일 처리), 커스텀 `비밀번호만료일수` 설정값 반영 확인(30일/60일 두 값),
만료 경계값(`daysSincePwChange === expireDays`일 때 `>` 비교라 만료 아님을 확인), 이메일
대소문자/공백 정규화.

이 그룹은 사용자 조회 자체(이메일로 행을 찾는 루프)는 시험 대상이 아니다 —
`cloudrun_port.js`의 `loginAction_`은 실제 `index.js`와 달리 이미 조회된 `user` 객체를
받는 형태로 포트되어 있고, `run_tests.js`의 `findUserForCloudRun`이 실제 `index.js`의
조회 루프(row[0]~row[8] 매핑)를 그대로 복제해 이 부분을 채워준다.

## B그룹 (시나리오 12~18) — idempotency / 세션 구조 호환성 / 분산 락

**시나리오 12~14**: 포트가 아니라 `lib/writeIdempotency.js`의 `withIdempotency()`를 **실제
프로덕션 코드 그대로** require해서 `fake_firestore.js`(인메모리 스텁)로 실행한다.
- 12: 같은 `idempotencyKey`로 두 번 호출 -> `actionFn`은 1회만 실행되고, **실패 응답
  (`WRONG_PASSWORD`)도 그대로 캐시**되는지 — split-brain 방지 설계(같은 키로 1회 재시도)의
  전제가 되는 저수준 동작.
- 13-a/13-b: `IN_PROGRESS` 상태에서 (a) 폴링 중 `DONE`으로 바뀌면 그 응답을 받는지(failCount
  중복 증가 없이 재시도 안전), (b) 끝까지 안 풀리면 `DUPLICATE_IN_PROGRESS_RETRY_LATER`를
  받는지.
- 14: 애매한 실패(예외, 타임아웃 시뮬레이션) 후 같은 키로 재시도하면 선점 문서가 삭제되어
  처음부터 재실행되는지 — `LOGIN_CLOUDRUN_DESIGN.md` 4번(split-brain 방지, 1회 재시도) 설계의
  근거.

**시나리오 15**: `loginAction_`이 실제로 Firestore에 쓸 세션 문서(`{email, createdAt,
expiresAt}`)와 동일한 모양으로 문서를 만들고, `lib/auth.js`의 `authenticateSession()`(다른
모든 Cloud Run 함수가 세션 인증에 쓰는 **실제 프로덕션 코드**)을 그대로 호출해서 정상 인증
되는지 확인한다 — 사용자가 명시적으로 요구한 "다른 Cloud Run 함수들이 그대로 세션을 조회할
수 있어야 한다"는 요건의 직접적인 근거.

**시나리오 16~18**: `cloudrun_port.js`에 포트된 `acquireLoginLock_`/`releaseLoginLock_`
시나리오. 이 두 함수는 `index.js` 안에서 `exports`되지 않는 비공개 함수라 직접 require할 수
없어서, `postcomment-parity/cloudrun_port.js`의 `isManagerForItem_` 처리와 동일한 방식으로
로직을 그대로 복제해서 시험한다 — **"포트 비교"이며, 15가 받는 "실제 프로덕션 모듈"과는
방법론이 다르다**는 점을 분명히 한다.
- 16: 아무도 안 잡고 있으면 즉시 획득 -> `holderId` 일치 시 해제하면 문서가 삭제되는지.
- 17: 이미 신선하게(10초 이내) 잡혀 있는 락에 다른 holder가 시도 -> 3초 대기 후 획득
  실패(`false`)로 이어지는지(`LOGIN_BUSY_RETRY` 분류의 근거) — 이 케이스 하나가 실제로
  약 3초 걸린다(의도된 것, `LOGIN_LOCK_WAIT_MS` 그대로 사용).
- 18: 10초 TTL이 지난 오래된 락은 대기 없이 즉시 회수되는지, 그리고 `holderId`가 다른
  요청이 해제를 시도해도 문서가 그대로 남아있는지(다른 요청의 락을 실수로 지우지 않는지).

## 실행 방법

```bash
cd cloud-run/mro-functions
npm install   # @google-cloud/firestore(FieldValue) 의존성 필요, 로컬 검증용
node tests/logintest-parity/run_tests.js
```

실행 후 `npm install`이 만든 `node_modules/`는 삭제하고, `package.json`/`package-lock.json`이
그대로인지(`git status`) 반드시 확인한다 — 다른 parity 테스트와 동일한 절차.

## 결과 (2026-08-21)

`results.json`에 20개 케이스(A그룹 12개 — 시나리오 9는 9/9b로 분리, B그룹 7개 — 시나리오
13은 13-a/13-b로 분리) 전부 `PASS`로 기록되어 있다. 시나리오 17 때문에 전체 실행 시간이
약 3초 이상 걸린다(정상 동작).

**이 결과는 코드 레벨 로직 검증이며, 실제 GCP 배포/실데이터 통합 테스트를 대체하지 않는다.**
특히 다음 항목은 이 parity 테스트가 다루지 않으므로, 별도 승인 후 다음 단계(배포 +
`LOGIN_CLOUDRUN_DESIGN.md` 8번 절차의 합성 테스트 계정을 이용한 실제 엔드포인트 smoke
test)에서 확인해야 한다:
- `hashPassword_`가 실제 Apps Script `Utilities.computeDigest(SHA-256)`와 바이트 단위로
  정확히 일치하는지(이 테스트는 Node `crypto` 구현 두 개가 서로 일치하는지만 확인한다 —
  `apps_script_ref.js` 47~53행 참고).
- `updateLoginFailCountCell_`의 실제 Sheets API 쓰기 호출(권한 스코프는 코드 레벨로 이미
  1개로 제한됨을 확인했으나, 실제 쓰기 성공 여부는 배포 후 확인).
- Firestore `loginLocks`/`sessions`/`writeIdempotency` 문서에 대한 실제 GCP 네트워크
  호출(현재는 전부 `fake_firestore.js` 인메모리 스텁).
- 같은 `idempotencyKey` 재시도가 **동시에 진행 중인 로그인 시도의 `loginLocks` 락과
  경합하는 좁은 레이스**(설계 문서/코드 주석에 이미 알려진 한계로 명시됨 — 정상 처리 시간
  대비 클라이언트 재시도 타임아웃이 훨씬 길어 실무 영향은 낮다고 판단했으나, 실측은 아직
  없음).
