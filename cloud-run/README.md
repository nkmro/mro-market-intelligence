# Cloud Run 백엔드 (cloud-run)

## 이 폴더는 무엇인가

`Code.gs`(Apps Script) 기반 백엔드의 일부 API를 더 빠르게 만들기 위해 도입한 **신규 백엔드**입니다. 전체 기능을 옮기는 것이 아니라, **실제로 트래픽이 있고 안전하게 검증한 API만 하나씩** 이곳으로 옮기고 있습니다. 여기 없는 기능은 전부 여전히 `apps-script/Code.gs`가 처리합니다.

- **GCP 프로젝트**: `mro-market-intelligence`
- **리전**: `asia-northeast3` (서울)
- **런타임**: Node.js 22 (2026-08-18 8개 함수 전체 업그레이드 완료), Cloud Functions (2nd gen), HTTP 트리거, 인증 없이 호출 가능(`--allow-unauthenticated`) — 대신 각 함수 내부에서 `sessionToken`으로 자체 인증
- ✅ **2026-08-18: Node.js 20 → Node.js 22 업그레이드 완료.** 기존 Node.js 20은 2026-04-30부터 지원 중단(deprecated) 상태였고 2026-10-30에 완전히 사용 중단(decommission)될 예정이었습니다. `@google-cloud/firestore@9.0.0`의 `package.json` engines 조건(`node >= 22`)과 맞춰 Node.js 22로 업그레이드했습니다 (근거는 이전 분석 그대로). 8개 함수 모두 pingTest 등 단순/진단용 함수부터 먼저 배포·검증한 뒤, 실제 트래픽이 있는 getTeamsTest·getSettingsTest까지 순차적으로 진행했으며, 전 함수 테스트 결과가 업그레이드 전(Node.js 20) 베이스라인과 기능적으로 동일함을 확인했습니다. **각 함수의 기존 Node.js 20 리비전은 삭제하지 않고 트래픽 0%로 보존**되어 있어 즉시 롤백 가능합니다 (`pingtest-00001-sax`, `getsettingstest-00001-zah` 등 — 콘솔의 "버전" 탭에서 직접 재확인함). 상세 내용은 저장소 루트의 `NODE22_UPGRADE_REPORT.md` 참고.

## 소스 구조

`cloud-run/mro-functions/`에 있는 **하나의 소스 디렉터리**에서 함수가 모두 배포됩니다 (`index.js` 하나에 여러 개의 `exports.함수이름`이 있고, 배포 시 `--entry-point`로 어느 함수를 쓸지 지정하는 방식). 즉 폴더가 함수마다 나뉘어 있는 게 아니라, **소스 하나 + 여러 진입점(entry point)** 구조입니다. **2026-08-18, 실제 GCP 콘솔의 `getSettingsTest` 함수 소스 보관 파일을 직접 내려받아 확인** — 그 시점에는 `index.js`에 `exports.*` 핸들러 8개가 들어있어 위 설명과 정확히 일치함을 확인했습니다. **(2026-08-21 갱신)** 이후 `pollSignalTest`, `getFeedTest`, `getNotificationsTest`, `getPostByIdTest`, `getCommentsTest`, `getThreadSeenTest`, `markThreadSeenTest`, `postCommentTest`가 차례로 추가되어 그 시점 `index.js`의 `exports.*` 핸들러는 총 16개였습니다. **(2026-09-01 갱신)** 그 사이 `loginTest`, `getItemsTest`, `getCustomersTest`, `getUsersTest`, `updateCommentTest`, `deleteCommentTest`, `upsertItemTest`, `upsertCustomerTest`, `updateUserTest`, `changePasswordTest`, `updateSettingsTest`, `registerPushSubscriptionTest`, `pushBatchTest`, `reminderBatchTest` 14개가 추가로 구현·배포되어, 현재 `index.js`의 `exports.*` 핸들러는 총 30개이고 전부 Cloud Run에 배포되어 있습니다(`grep -c "^exports\." index.js`로 직접 재확인, GCP 콘솔의 서비스 목록 29개 + 이번에 배포한 `registerPushSubscriptionTest` 1개 = 30개 일치). 아래 함수별 목록표에도 반영했습니다. 이 저장소의 `cloud-run/mro-functions/index.js`도 그 파일 그대로입니다(포맷팅 손실 없이 원본 그대로).

`index.js` 외에 `cloud-run/mro-functions/lib/` 아래에 여러 함수가 공유하는 모듈이 있습니다: `auth.js`(Firestore 세션 인증 공통화 — `getFeedTest`/`getNotificationsTest`/`getPostByIdTest`가 사용, 다른 함수들은 아직 각자 인라인된 동일 로직을 씀), `sheetsClient.js`(Sheets 읽기 공통 클라이언트), `feedEngine.js`(피드/댓글 판정 공용 로직 — Apps Script의 `buildFeedEntry_` 대응), `feedResponses.js`(응답 형태 조립), `writeIdempotency.js`(idempotencyKey 기반 쓰기 중복 방지 — `markThreadSeenTest`/`postCommentTest`가 사용).

의존 패키지(`package.json`): `@google-cloud/firestore@9.0.0`, `google-auth-library`(`package-lock.json` 기준 실제 설치 버전 `9.15.1`). Google Sheets 접근은 `google-auth-library`의 `GoogleAuth`가 Cloud Functions 실행 서비스 계정의 권한을 그대로 사용하고, Firestore도 마찬가지로 서비스 계정 IAM 권한만으로 동작합니다 (코드에 `process.env` 참조가 전혀 없음 — 직접 확인함). **다만 앱 코드가 직접 쓰는 환경변수/Secret은 없지만, Cloud Run/Functions 배포판이 자동으로 붙이는 `LOG_EXECUTION_ID=true` 라는 플랫폼 관리 환경변수 1개는 존재합니다** (2026-08-18 콘솔의 "변수 및 보안 비밀" 탭에서 직접 확인 — 이건 로그에 실행 ID를 남기는 GCF 표준 옵션이고, 개발자가 넣은 값이 아니며 Secret도 아닙니다).

`fix.py`, `fix2.py`는 실행 시 호출되는 코드가 아니라, **배포 전 로컬에서 한 번 돌리는 보조 스크립트**입니다. 한글 시트 탭 이름을 `index.js` 안에 유니코드 이스케이프(`\uXXXX`)로 안전하게 박아 넣기 위한 것으로 보입니다(추정: `gcloud functions deploy` 업로드 과정에서 한글이 깨지는 문제를 피하려는 용도). 배포 파이프라인의 일부이므로 참고용으로 이 저장소에도 그대로 보관합니다.

## 함수별 목록

| 함수(entry point) | URL | 대응 Apps Script 함수 | 상태 | 설명 |
|---|---|---|---|---|
| `getTeamsTest` | `.../getTeamsTest` | (팀 목록 조회 로직) | ✅ **프로덕션에 실제 연동됨** (`index.html`) | 인증 불필요. 회원가입 화면 팀 선택 드롭다운에 사용 중 |
| `getSettingsTest` | `.../getSettingsTest` | `handleGetSettings_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 실패 시 프론트에서 자동으로 Apps Script로 폴백 |
| `pollSignalTest` | `.../pollSignalTest` | `handlePollSignal_`(및 `buildFeedEntry_`/`getRelatedItems_`/`canViewComment_`) | ✅ **프로덕션에 실제 연동됨** (`feed.html`, 30초 폴링) | POST + `sessionToken` 필요. `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`에서 역할별 12개 시나리오 100% 일치 검증 후 연동. 실패 시 프론트에서 자동으로 Apps Script `pollSignal`로 폴백 **(2026-08-19 갱신: 기존에 이 표에 빠져 있던 것을 반영)** |
| `getTeamManagersTest` | `.../getTeamManagersTest` | `handleGetTeamManagers_` | ⏸ 검증만 완료, 미연동 | 프론트에 이 기능을 호출하는 곳이 없음 (최상위 `README.md`의 "getTeamManagers 분석" 참고) |
| `whoamiTest` | `.../whoamiTest` | (로그인/세션 확인 로직) | ✅ **프로덕션에 실제 연동됨** (`feed.html`, `CLOUD_RUN_WHOAMI_URL`) | 로그인/whoami 전환 계획 2단계(`LOGIN_WHOAMI_MIGRATION_PLAN.md`) — 새로고침/재실행 시 세션을 가볍게 재확인. 실패 시 기존 `getFeed`의 `UNAUTHORIZED` 처리로 폴백 **(2026-08-21 정정: 이전에는 "실험/성능 측정용, 프로덕션 미연동"으로 표시되어 있었으나 실제로는 연동되어 있었음)** |
| `sessionSyncTest` | `.../sessionSyncTest` | `syncSessionToCloudRun_`가 호출하는 대상 | ⚙️ 내부 동기화용 | Apps Script 로그인 성공 시 이 함수를 호출해 Firestore `sessions/{sessionToken}`에 세션을 미러링(이중 쓰기). 실패해도 로그인 자체에는 영향 없음 |
| `getFeedTest` | `.../getFeedTest` | `handleGetFeed_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. `lib/auth.js`+`lib/feedEngine.js` 사용. 실패 시 자동으로 Apps Script `getFeed`로 폴백 |
| `getNotificationsTest` | `.../getNotificationsTest` | `handleGetNotifications_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 실패 시 자동으로 Apps Script `getNotifications`로 폴백 |
| `getPostByIdTest` | `.../getPostByIdTest` | `handleGetPostById_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 실패 시 자동으로 Apps Script `getPostById`로 폴백 |
| `getCommentsTest` | `.../getCommentsTest` | `handleGetComments_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 순수 읽기. 실패 시 자동으로 Apps Script `getComments`로 폴백 |
| `getThreadSeenTest` | `.../getThreadSeenTest` | `handleGetThreadSeen_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 순수 읽기. 실패 시 자동으로 Apps Script `getThreadSeen`으로 폴백 |
| `markThreadSeenTest` | `.../markThreadSeenTest` | `handleMarkThreadSeen_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(Sheets `spreadsheets` 스코프, 이 함수와 `postCommentTest`만 최소 권한으로 부여). upsert라 Apps Script와 각자 성공해도 안전하게 수렴 — 실패 시 자동으로 Apps Script `markThreadSeen`으로 폴백. `MARKTHREADSEEN_CLOUDRUN_DESIGN.md` 참고 |
| `postCommentTest` | `.../postCommentTest` | `handlePostComment_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(Sheets `spreadsheets` 스코프). append 전용이라 markThreadSeen과 다른 3단 폴백 정책(명확한 사전 실패/애매한 실패/최종 실패) 적용 — 애매한 실패가 재시도까지 실패하면 Apps Script로 넘기지 않고 사용자에게 확인을 요청. `POSTCOMMENT_CLOUDRUN_DESIGN_v2.md` 참고 |
| `loginTest` | `.../loginTest` | `handleLogin_` | ✅ **프로덕션에 실제 연동됨** (`index.html`) | POST. 세션 발급 자체 — 가장 민감한 기능이라 postComment와 동일한 3단 폴백 정책(명확한 사전 실패/애매한 실패/최종 실패) 적용, 실패 시 자동으로 Apps Script `login`으로 폴백 (2026-08-24 설계 승인) |
| `getItemsTest` | `.../getItemsTest` | `handleGetItems_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 순수 읽기, `getComments`와 동일한 읽기 폴백 패턴(Track A) |
| `getCustomersTest` | `.../getCustomersTest` | `handleGetCustomers_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 순수 읽기, `getItems`와 동일한 읽기 폴백 패턴(Track A) |
| `getUsersTest` | `.../getUsersTest` | `handleGetUsers_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 순수 읽기, `getItems`/`getCustomers`와 동일한 읽기 폴백 패턴(Track B) |
| `updateCommentTest` | `.../updateCommentTest` | `handleUpdateComment_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(본인이 작성한 댓글만 수정 가능). `postComment`와 동일한 3단 폴백 정책(Track A) |
| `deleteCommentTest` | `.../deleteCommentTest` | `handleDeleteComment_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**. `updateComment`와 동일한 3단 폴백 정책(Track A) |
| `upsertItemTest` | `.../upsertItemTest` | `handleUpsertItem_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(품목 등록/수정, 필요 시 신규 고객사도 함께 생성). `postComment`/`updateComment`와 동일한 3단 폴백 정책. `UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md` 참고 |
| `upsertCustomerTest` | `.../upsertCustomerTest` | `handleUpsertCustomer_` | ⏸ 배포·검증 완료, 프론트 단독 연동 없음 | 고객사만 단독으로 등록하는 화면 진입점이 없어 프론트가 이 URL을 직접 부르지 않음 — 품목 등록 화면에서 `upsertItemTest`에 신규 고객사 정보를 함께 실어 보내는 방식으로만 간접 사용됨 |
| `updateUserTest` | `.../updateUserTest` | `handleUpdateUser_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(관리자 전용, `ADMIN_EMAIL`만 허용 — 서버가 판정). 3단 폴백 정책. `USERMGMT_CLOUDRUN_DESIGN.md` 참고 |
| `changePasswordTest` | `.../changePasswordTest` | `handleChangePassword_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(본인 전용). 3단 폴백 정책. `USERMGMT_CLOUDRUN_DESIGN.md` 참고 |
| `updateSettingsTest` | `.../updateSettingsTest` | `handleUpdateSettings_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. **쓰기**(관리자 전용). 3단 폴백 정책. `USERMGMT_CLOUDRUN_DESIGN.md` 참고 |
| `registerPushSubscriptionTest` | `.../registerPushSubscriptionTest` | 없음(신규 기능, Apps Script 대응 없음) | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. FCM 푸시 토큰을 Firestore `pushSubscriptions/{email}_{deviceId}`에 upsert 저장. 로그인 시 자동 호출(`initPushOnLogin_`). 코드는 8/28에 커밋됐지만 Cloud Run 배포가 누락되어 있었고, **2026-09-01에 배포 완료**(그 전까지는 프론트가 정상 동작하는 것처럼 보여도 실제로는 아무 기기도 푸시를 등록하지 못하는 상태였음) |
| `pushBatchTest` | `.../pushBatchTest` | 없음(신규 기능) | ✅ **프로덕션에 실제 연동됨** (Cloud Scheduler `push-batch-5min`, 5분마다) | 사람이 직접 호출하는 API가 아님 — Cloud Scheduler 전용 배치. `role !== '일반'`인 사용자 전원에게 새 게시물/댓글 필요/답변 요청을 통합 푸시 1건으로 발송(0건 카테고리 제외, 전부 0건이면 미발송). `PUSH_NOTIFICATION_STAGE6_DESIGN.md` 참고 |
| `reminderBatchTest` | `.../reminderBatchTest` | 없음(신규 기능) | ✅ **프로덕션에 실제 연동됨** (Cloud Scheduler `reminder-batch-hourly`, 매시 정각) | 사람이 직접 호출하는 API가 아님 — Cloud Scheduler 전용 배치. 설정 시트 `담당자댓글마감시각`(쉼표로 여러 시각 지정 가능, 예: `13,17`)에 맞춰 담당자에게 리마인더 푸시 발송. Firestore `reminderDeliveries`(`날짜_시각_이메일`)로 시각별 중복 발송 방지 |
| `firestoreTest` | `.../firestoreTest` | 없음 | 🧪 진단용 | Firestore 연결 확인용 스캐폴딩. 공개 API가 아님 |
| `sheetPingTest` | `.../sheetPingTest` | 없음 | 🧪 진단용 | Google Sheets API 연결 확인용 스캐폴딩. 공개 API가 아님 |
| `pingTest` | `.../pingTest` | 없음 | 🧪 진단용 | 가장 단순한 헬스체크. 공개 API가 아님 |

> URL 전체 형식: `https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/<함수이름>`
> 이 표는 2026-09-01 기준입니다(GCP 콘솔의 실제 서비스 목록 및 `feed.html`/`index.html`/`cloud-run/mro-functions/index.js` 코드를 직접 대조해 갱신). 2026-08-21 버전 이후 `loginTest`/`getItemsTest`/`getCustomersTest`/`getUsersTest`/`updateCommentTest`/`deleteCommentTest`/`upsertItemTest`/`upsertCustomerTest`/`updateUserTest`/`changePasswordTest`/`updateSettingsTest`/`registerPushSubscriptionTest`/`pushBatchTest`/`reminderBatchTest` 14개 행이 추가됐습니다. 이전 버전에는 `getFeedTest`/`getNotificationsTest`/`getPostByIdTest`/`getCommentsTest`/`getThreadSeenTest`/`markThreadSeenTest`/`postCommentTest` 7개 함수가 통째로 빠져 있었고(추가된 시점에 표 갱신이 누락됨), `whoamiTest`도 실제로는 연동되어 있는데 "실험용"으로 잘못 표시되어 있었습니다.

## Firestore 구조

- 컬렉션 `sessions`, 문서 ID = `sessionToken`
- 필드: `email`(string), `createdAt`(Timestamp), `expiresAt`(Timestamp — 6시간 후 만료)
- Apps Script가 로그인 시 이 컬렉션에 세션을 기록하고(`sessionSyncTest` 경유), Cloud Run 함수들은 요청받은 `sessionToken`으로 이 컬렉션을 조회해 로그인 여부/만료 여부를 확인합니다.

## 배포 방법

```bash
cd cloud-run/mro-functions
gcloud functions deploy <함수이름> \
  --gen2 --runtime=nodejs22 --region=asia-northeast3 \
  --source=. --entry-point=<함수이름> \
  --trigger-http --allow-unauthenticated \
  --project=mro-market-intelligence --quiet
```

`<함수이름>`을 위 표의 entry point 중 하나로 바꿔서 실행합니다. `index.js`를 수정한 뒤에는, 그 코드를 실제로 사용하는 **모든** entry point를 각각 다시 배포해야 합니다 (하나의 파일을 여러 함수가 공유하기 때문).

## 롤백 방법

- **개별 API 트래픽 롤백**: 프론트엔드(`index.html`/`feed.html`)의 `CLOUD_RUN_..._URL` 상수를 빈 문자열로 바꾸면, 그 즉시 해당 API는 기존 Apps Script 경로로 되돌아갑니다. (가장 흔히 쓰는 방법)
- **함수 자체 롤백**: `gcloud functions deploy`는 매번 새 리비전을 만듭니다. Cloud Console → Cloud Functions → 해당 함수 → "리비전" 탭에서 이전 리비전으로 트래픽을 이동할 수 있습니다.
- **소스 롤백**: 이 저장소의 이전 커밋에 있는 `cloud-run/mro-functions/index.js`로 되돌린 뒤 다시 배포하면 됩니다.

## 앞으로 지켜야 할 원칙

1. **새 Cloud Run 함수를 만들거나 기존 함수를 수정하면, 반드시 이 저장소의 `cloud-run/mro-functions/index.js`도 함께 갱신해서 커밋합니다.** Cloud Run 콘솔에만 존재하고 GitHub에는 없는 코드가 생기지 않도록 합니다.
2. 실제 서비스에 연동하기 전에는 반드시: (1) 결과가 Apps Script와 동일한지 확인, (2) 인증/권한 체크가 정확한지 확인(관리자/일반 계정 등 여러 케이스), (3) 실패 시 자동으로 Apps Script로 되돌아가는 폴백 구조를 갖추기.
3. 진단용 함수(`pingTest`, `sheetPingTest`, `firestoreTest`)는 공개 API로 취급하지 않습니다 — 필요 없어지면 정리해도 됩니다.
