# login / whoami Cloud Run 전환 상세 계획 (2026-08-18, 분석·계획 단계 — 승인 전까지 실제 코드 변경 없음)

이 문서는 최상위 `README.md`의 API 매핑표에서 `login`이 "⏳ 미착수 (다음 후보, 별도 계획 예정)"으로 표시된 항목에 대한 상세 전환 계획입니다. 지금까지 합의한 순서("분석 → 계획 → 승인 → 실제 수정")에 따라, **이 문서는 계획 단계이며 어떤 코드도 아직 변경하지 않았습니다.** 실제 수정은 이 계획에 대한 승인을 받은 뒤에만 진행합니다.

## 1. 현재 상태 요약 (Code.gs 실제 소스 기준)

### 1-1. login (`handleLogin_`, Code.gs 231~293행)

- 입력: `email`, `password`
- 비밀번호 검증: `SHA-256(password + ':' + email)` 해시를 `사용자팀마스터` 시트의 `passwordHash`와 비교 (`hashPassword_`)
- 계정 잠금: `failCount >= 5`이면 `ACCOUNT_LOCKED` 반환. 실패 시 `incrementLoginFailCount_`, 성공 시 `resetLoginFailCount_` — **시트에 직접 쓰기(write)** 발생
- 세션 발급: `Utilities.getUuid()`로 `sessionToken` 생성 → `CacheService.getScriptCache()`에 `session_<token>` = email, TTL **21600초(6시간)**로 저장
- Cloud Run 동기화: `syncSessionToCloudRun_(sessionToken, email)`이 Firestore용 `sessionSyncTest`를 best-effort로 호출 (실패해도 로그인 자체엔 영향 없음)
- 비밀번호 만료: `설정` 시트의 `비밀번호만료일수`(기본 90일)와 `passwordChangedAt`을 비교해 `passwordExpired` 계산
- 응답 형태(프론트가 그대로 `localStorage.mro_session`에 저장): `{ ok, sessionToken, email, name, role, team, passwordExpired }`

### 1-2. 세션 재인증 (`authenticateRequest_`, Code.gs 308~326행) — login 이외 모든 action이 사용

- `body.sessionToken`으로 CacheService에서 email 조회
- **조회 성공 시마다 TTL을 21600초로 다시 연장(슬라이딩 세션)** — 즉 계속 활동 중인 사용자는 세션이 사실상 끊기지 않음
- 이후 시트에서 사용자 정보를 가져와(캐시 우선) 활성 상태 확인

### 1-3. Firestore `sessions` 컬렉션 (Cloud Run이 보는 세션 사본)

- `sessionSyncTest`가 로그인 "그 순간 한 번만" `{email, createdAt, expiresAt = now + 6시간}`을 기록
- **`expiresAt`은 이후 어떤 요청에서도 갱신되지 않습니다.** Apps Script 쪽(CacheService)은 활동이 있을 때마다 6시간씩 슬라이딩 연장되는데, Firestore 쪽은 로그인 시점 기준 고정 6시간 후 무조건 만료로 취급됩니다.

### 1-4. whoami — 사실 지금 "정식 기능"이 아님

- Code.gs의 `doPost` 라우팅(126~225행)에는 `whoami`라는 action이 아예 존재하지 않습니다. 로그인 후 사용자 정보(name/role/team)는 로그인 응답을 그대로 `localStorage`에 저장해두고 **재검증 없이 그대로 신뢰**해서 화면에 씁니다 (`feed.html` 893행 등).
- 페이지를 새로고침/재시작했을 때 세션이 살아있는지 확인하는 절차는 별도로 없고, **처음 실제로 호출하는 `getFeed` action의 응답이 `UNAUTHORIZED`/`SESSION_EXPIRED`이면 그때 `doLogout()`으로 로그아웃 처리**됩니다 (`feed.html` 1118행, 1151행).
- Cloud Run의 `whoamiTest`는 이미 만들어져 검증까지 됐지만(`cloud-run/README.md` 참고), **프론트엔드 어디에서도 호출되지 않는 실험용 함수**입니다. 즉 "whoami 전환"은 기존 기능을 옮기는 게 아니라, **지금 없는 "빠른 세션 확인" 기능을 새로 도입하는 것**에 가깝습니다.

## 2. 핵심 문제: login을 지금 당장 통째로 옮기면 안 되는 이유

`doPost`의 action 스위치(Code.gs 193~219행)를 보면 `getFeed`, `postComment`, `getComments`, `getItems`, `getUsers`, `changePassword` 등 **압도적으로 많은 기능이 여전히 Apps Script(CacheService 기반 인증)만으로 동작**합니다. `getTeams`, `getSettings` 단 2개만 Cloud Run으로 옮겨졌습니다.

만약 `login`(세션 발급) 자체를 Cloud Run으로 완전히 옮기면:

- Cloud Run이 Firestore에만 세션을 기록하게 되고, **Apps Script의 CacheService에는 그 세션이 존재하지 않게 됩니다.**
- CacheService는 Apps Script 실행 컨텍스트 안에서만 쓸 수 있는 저장소라서, **Cloud Run이 외부에서 직접 채워 넣을 방법이 없습니다.**
- 그 결과 로그인은 성공하지만, `getFeed`를 포함한 나머지 거의 모든 기능이 전부 `UNAUTHORIZED`로 실패하게 됩니다 — **로그인은 되는데 아무것도 못 하는 상태**가 됩니다.

즉, **`login`은 아직 "안전하게 옮길 수 있는" 상태가 아닙니다.** 다른 대부분의 action들이 Cloud Run으로 옮겨지기 전까지는, 세션의 "진짜 주인"은 계속 Apps Script(CacheService)여야 합니다.

## 3. 권장 진행 순서 (3단계)

### 3단계 중 지금 승인을 요청하는 범위: 1단계 + 2단계

#### 1단계 — Firestore 세션 만료시간 슬라이딩 처리 (선행 작업, 위험도 낮음)

지금 Cloud Run 인증이 필요한 함수(`getSettingsTest` 등)가 세션을 조회할 때, Apps Script의 `authenticateRequest_`와 동일하게 **`expiresAt`을 현재 시각 + 6시간으로 다시 늘려 쓰는(sliding) 로직을 추가**합니다. 이렇게 하면:

- 사용자가 6시간 넘게 계속 활동 중이어도, Apps Script 세션은 살아있는데 Cloud Run만 "세션 만료"로 잘못 판단하는 지금의 불일치가 사라집니다.
- `login` 자체는 전혀 건드리지 않으므로 위험도가 낮습니다.
- 실패해도 지금처럼 프론트가 자동으로 Apps Script 경로로 폴백하므로 사용자에게 노출되는 위험이 없습니다.

#### 2단계 — 프론트엔드용 whoami 엔드포인트 신설 (새 기능, 위험도 낮음·애디티브)

이미 만들어져 검증된 `whoamiTest`를 **정식 엔드포인트로 승격**하고, 프론트엔드에 `CLOUD_RUN_WHOAMI_URL` 상수를 추가해:

- 새로고침/재실행으로 `feed.html`이 열릴 때, 무거운 `getFeed` 호출 전에 whoami로 세션을 먼저 가볍게 확인 → localStorage에 저장된 낡은 name/role/team 대신 항상 서버의 최신 값을 반영할 수 있음 (예: 관리자가 다른 사용자의 역할을 바꾼 직후에도 곧바로 반영됨)
- 이 호출이 실패/타임아웃 나더라도 **기존처럼 `getFeed`의 `UNAUTHORIZED` 처리로 그대로 폴백** — whoami는 어디까지나 "빠른 확인"이지 유일한 인증 경로가 되지 않도록 설계
- `getTeams`/`getSettings`와 동일한 안전 패턴(상수를 비우면 즉시 롤백)을 그대로 적용

#### 3단계 — login 발급 자체의 Cloud Run 이전 (지금은 착수하지 않음, 별도 승인 필요)

아래 조건이 충족된 뒤에만 고려합니다.

- `getFeed`를 포함해 세션 인증이 필요한 주요 action 다수가 먼저 Cloud Run(Firestore 인증)으로 옮겨져, CacheService에 대한 의존이 크게 줄어든 상태
- 그 시점에 아래 세부 사항을 포함한 별도의 상세 계획을 다시 세우고 승인받은 뒤 진행:
  - 비밀번호 해시 로직(`SHA-256(password:email)`)을 Cloud Run에 동일하게 이식
  - `failCount` 증가/초기화를 위한 시트 **쓰기 권한**을 Cloud Run 서비스 계정에 부여 (현재 Cloud Run 함수들은 전부 읽기 전용)
  - 로그인이 Apps Script와 Cloud Run 양쪽에서 동시에 시도될 경우 `failCount`가 이중으로 바뀌는 문제(split-brain) 방지 — 반드시 한쪽만 "진짜 로그인 처리자"가 되도록 `CLOUD_RUN_LOGIN_URL` 상수로 온/오프
  - `비밀번호만료일수` 설정과 `passwordExpired` 계산 로직 동일 이식
  - 응답 형태(`ok, sessionToken, email, name, role, team, passwordExpired`)를 한 글자도 다르지 않게 유지 — 프론트가 이 객체를 그대로 `localStorage`에 저장해 여러 곳에서 그대로 읽기 때문
  - 실제 계정이 아닌 합성 테스트 계정으로만 먼저 검증 (지금까지의 다른 모든 전환·업그레이드 작업과 동일한 원칙)

## 4. 이번에 요청하는 승인 범위

이 문서에서 실제로 진행 승인을 요청하는 것은 **1단계(Firestore 세션 슬라이딩 처리)와 2단계(whoami 엔드포인트 신설)** 두 가지입니다. 두 가지 모두:

- `login` 자체의 로직·권한·시트 쓰기 방식은 전혀 바꾸지 않습니다.
- 실패 시 기존 Apps Script 경로로 자동 폴백되는 지금까지의 안전 패턴을 그대로 따릅니다.
- 실제 사용자 계정이 아닌 합성 테스트 계정으로 먼저 검증한 뒤에만 실서비스에 연동합니다.

3단계(login 발급 자체의 이전)는 지금 진행하지 않으며, 나중에 조건이 충족되면 별도로 다시 분석·계획·승인 절차를 거치겠습니다.

## 5. "댓글 기능(postComment) 분석"과의 관계

이 계획은 `postComment` 댓글 기능 분석과 무관하며, 합의하신 대로 이 login/whoami 계획이 승인·실행된 뒤에 댓글 기능 분석을 시작하겠습니다.
