# MRO 자재 시황 관리 시스템 (mro-market-intelligence)

원자재/자재 시황 뉴스를 수집·정리해 팀원들에게 보여주는 사내 시스템입니다. 이 문서는 **새로운 AI 어시스턴트나 개발자가 이 저장소만 보고도 전체 구조를 이해할 수 있도록** 작성되었습니다.

## 한눈에 보는 구조

```
mro-market-intelligence/
├── index.html, feed.html, sw.js, manifest.json, icon-*.png   ← 프론트엔드 (GitHub Pages, 저장소 루트)
├── apps-script/        ← Google Apps Script 백엔드 소스 (Code.gs, 미러 사본)
├── cloud-run/          ← Google Cloud Run 백엔드 소스 (신규, 일부 API만 이전 중)
└── README.md           ← 이 문서
```

> **2026-08-18 업데이트**: `apps-script/Code.gs`, `apps-script/appsscript.json`, `cloud-run/mro-functions/*`(index.js·package.json·package-lock.json·fix.py·fix2.py) 실제 소스 파일을 이 저장소에 처음으로 커밋했습니다. 지금까지는 README만 있고 실제 코드는 Apps Script 편집기/GCP 콘솔에만 있었는데, 이제 GitHub에서도 실제 코드를 볼 수 있습니다. (세부 사항은 각 하위 README 참고.)

> **2026-08-21 업데이트**: 아래 API 매핑표를 실제 `feed.html`/`index.html`/`cloud-run/mro-functions/index.js` 코드를 직접 대조해 갱신했습니다. `getFeed`·`getNotifications`·`getPostById`·`getComments`·`getThreadSeen`·`markThreadSeen`·`postComment`가 그 사이 실제로 Cloud Run 전환·실서비스 연동까지 완료되어 있었는데 표에는 반영되지 않고 있었습니다.

> **2026-09-01 업데이트**: 아래 API 매핑표를 다시 한번 실제 코드와 GCP 콘솔의 배포 목록을 직접 대조해 갱신했습니다. `login`·`updateComment`/`deleteComment`·`getUsers`·`updateUser`·`getItems`·`getCustomers`·`upsertCustomer`·`upsertItem`·`changePassword`·`updateSettings`가 그 사이 전부 Cloud Run 전환·실서비스 연동까지 완료되어 있었는데("⏳ 미착수"로 잘못 표시된 채) 표에는 반영되지 않고 있었습니다. 또한 Code.gs에는 없는 신규 기능인 푸시 알림(새 게시물/댓글 필요/답변 요청 통합 푸시, 담당자 댓글 마감 리마인더)도 표에 새로 추가했습니다 — 이 중 `registerPushSubscription` 엔드포인트는 코드가 8/28에 커밋된 뒤에도 실제 Cloud Run 배포가 누락된 채로 방치되어 있었고, 이번에 배포를 완료해 정상화했습니다.

> **2026-09-01 업데이트(2)**: Web Push/FCM 알림 구조를 이 문서에 새로 정리했습니다(아래 "Web Push / FCM 알림 구조" 절). 운영 중 발견되어 수정한 버그 3건도 함께 기록합니다 — ① 서버(`pushBatchTest`)가 이미 읽음 처리된 스레드의 새 답글을 영원히 감지 못하던 버그(`lib/feedEngine.js`, 커밋 `be8d6fa`), ② FCM 푸시를 탭해 앱이 포그라운드로 복귀할 때 같은 사건에 대해 인앱 알림이 한 번 더 뜨던 중복 표시 버그(`feed.html`, 커밋 `2d142b6`), ③ 탭이 완전히 닫혀 있다가 FCM 알림 클릭으로 새로 열리는 콜드 스타트에서, 초기 로딩 중 일부 데이터가 덜 갖춰진 상태로 기준값이 잘못 잡혀 인앱 알림이 스스로 발동하던 버그(`feed.html`, 커밋 `f214df0`).

**왜 프론트엔드 파일이 `frontend/` 폴더가 아니라 저장소 최상위에 있나요?**
GitHub Pages가 이 저장소를 "main 브랜치 / 루트(`/`) 폴더" 설정으로 서비스하고 있습니다 (Settings → Pages에서 확인). 즉 `index.html`이 반드시 루트에 있어야만 `https://nkmro.github.io/mro-market-intelligence/`가 정상 동작합니다. 만약 이 파일들을 `frontend/`로 옮기면 실제 서비스 URL이 전부 깨집니다. 그래서 구조 정리 단계에서는 **실제 파일을 옮기지 않고, 문서로만 "프론트엔드 영역"을 표시**했습니다 (`frontend/README.md` 참고). 나중에 GitHub Actions 기반 Pages 배포로 전환하면 실제로 옮길 수 있습니다 — 이건 별도의, 더 큰 작업입니다.

## 전체 아키텍처

```
[사용자 브라우저]
      │  (index.html: 로그인/회원가입, feed.html: 시황 피드/설정/관리)
      ▼
[callApi()]  ┸  프론트 공용 함수]
      │
      ├── 기존 경로 (아직 Cloud Run으로 안 옮긴 API의 기본 경로) ──► [Google Apps Script Web App] ─┐
      │                                                              (Code.gs, doPost)              │
      └── 신규 경로 (읽기 9개 + 쓰기 2개, 상수로 켜짐, 실패 시 자동 폴백) ─► [Google Cloud Run 함수들] │
                                                                      (cloud-run/mro-functions)       │
                                                                     │                        │
                                                                     ▼                        ▼
                                                          [Firestore: sessions]      [Google Sheets — 실제 DB]
                                                          (Cloud Run용 세션 미러)      (사용자팀마스터, 설정,
                                                                                        시황게시물, 품목마스터 등)
```

- **Google Sheets가 실제 데이터베이스입니다.** 사용자 계정(사용자팀마스터), 설정값(설정), 시황 게시물, 품목, 고객, 댓글 등 모든 데이터가 스프레드시트에 저장됩니다.
- **Google Apps Script(Code.gs)가 지금까지의 유일한 백엔드였고, 지금도 로그인(세션 발급)과 항목/고객/사용자 관리, 설정 변경 등 나머지 기능을 담당합니다.** (2026-08-21 기준: `doPost` action 15개가 아직 Apps Script만 처리 — `login`, `updateComment`, `deleteComment`, `markChecked`, `upsertItem`, `suggestMaterials`, `updateSettings`, `getUsers`, `updateUser`, `getItems`, `getCustomers`, `upsertCustomer`, `changePassword`, `getAttentionPosts`, `clientDebugLog`.)
- **Google Cloud Run은 Apps Script의 느린 응답(특히 CacheService 기반 세션 조회)을 개선하기 위해 최근 도입된 신규 백엔드입니다.** 전체 기능을 옮기는 게 아니라, **실제로 트래픽이 있고 안전하게 검증 가능한 API부터 하나씩** Cloud Run으로 옮기고 있습니다. 2026-08-21 기준 읽기 9개(`getTeams`(세션 불필요), `getSettings`, `whoami`, `pollSignal`, `getThreadSeen`, `getPostById`, `getFeed`, `getNotifications`, `getComments`)와 쓰기 2개(`markThreadSeen`, `postComment`)가 전환·실서비스 연동되어 있습니다. Cloud Run은 세션을 Apps Script의 캐시가 아니라 Firestore에서 조회합니다 (Apps Script 로그인 시 Firestore에도 세션을 같이 기록하는 "이중 쓰기" 방식으로 동기화, 세션 조회마다 슬라이딩 연장도 동일하게 적용).
- **전환 원칙(중요): 기존 Apps Script 코드는 절대 삭제하지 않습니다.** 프론트엔드에는 `CLOUD_RUN_..._URL`이라는 이름의 상수가 있고, 이 상수가 채워져 있으면 Cloud Run을 먼저 시도하고, 비어 있으면(혹은 실패하면) 기존 Apps Script로 자동/수동 롤백됩니다.

## API 매핑표 (프론트 호출 → 백엔드 대응)

| 프론트 함수(파일) | action 이름 | Cloud Run 전환 상태 | Apps Script 대응 함수 | 비고 |
|---|---|---|---|---|
| `loadTeamOptions()` (index.html, 회원가입 팀 선택) | `getTeams` | ✅ 전환됨 (`CLOUD_RUN_GET_TEAMS_URL`) | `handleGetTeams_` (또는 동일 로직) | 인증 불필요, 실서비스 검증 완료 (결과 100% 동일, clientMs 개선 확인) |
| `loadIdleTimeoutSetting()`, `loadSettingsPage()` (feed.html) | `getSettings` | ✅ 전환됨 (`CLOUD_RUN_GET_SETTINGS_URL`), 실패 시 자동 Apps Script 폴백 | `handleGetSettings_` | 세션 인증 필요 (Firestore 세션 조회 → Sheets 읽기). ok:false·오류·타임아웃 등 모든 실패 시 자동 폴백 |
| (프론트 호출 지점 없음) | `getTeamManagers` | ⏸ 보류 (Cloud Run에 `getTeamManagersTest`는 배포·검증되어 있으나 프론트에서 부르는 곳이 없음) | `handleGetTeamManagers_` | 아래 "getTeamManagers 분석" 참고 — 사실상 미사용/대체된 기능으로 판단됨 |
| `handleLogin_()` / 로그인 폼, 새로고침 시 세션 재확인 | `login`, `whoami` | ✅ 둘 다 전환·연동 완료 (`whoami`: `CLOUD_RUN_WHOAMI_URL` / `login`: `CLOUD_RUN_LOGIN_URL`, 2026-08-24 설계 승인) **(2026-09-01 갱신: `login`은 이전에 "설계 문서 작성 착수, 코드 변경 없음"으로 표시되어 있었으나 실제로는 이미 배포·연동 완료 상태였음)** | `handleLogin_` | 가장 민감한 기능이라 `postComment`와 동일한 3단 폴백 정책(명확한 사전 실패/애매한 실패/최종 실패) 적용. 실패 시 자동으로 기존 Apps Script `login`으로 폴백 |
| 시황 피드 조회·알림·실시간 배지 | `getFeed`, `getNotifications`, `getPostById`, `pollSignal` | ✅ 4개 전부 전환됨 (`CLOUD_RUN_GET_FEED_URL`/`CLOUD_RUN_GET_NOTIFICATIONS_URL`/`CLOUD_RUN_GET_POST_BY_ID_URL`/`CLOUD_RUN_POLLSIGNAL_URL`), 실패 시 자동 Apps Script 폴백 **(2026-08-21 갱신: 이전에는 3개가 "승인 대기"로 표시되어 있었으나 실제로는 이미 전환·연동 완료 상태였음)** | `handleGetFeed_`, `handleGetNotifications_`, `handleGetPostById_`, `handlePollSignal_` | 4개 모두 순수 읽기, 공용 판정 로직(`buildFeedEntry_`→`lib/feedEngine.js`) 공유. 상세 설계는 `FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md`, 검증은 `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md` 참고 |
| 댓글 조회/작성 (`feed.html` 댓글 UI) | `getComments`, `postComment` | ✅ 2개 전부 전환됨 (`CLOUD_RUN_GET_COMMENTS_URL`/`CLOUD_RUN_POSTCOMMENT_URL`) **(2026-08-21 갱신: 이전에는 "이전 보류/향후 후보"로 표시되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleGetComments_`, `handlePostComment_` | `getComments`는 순수 읽기. `postComment`는 append 전용 쓰기라 markThreadSeen과 다른 3단 폴백 정책(명확한 사전 실패/애매한 실패/최종 실패) 적용 — `POSTCOMMENT_CLOUDRUN_DESIGN_v2.md` 참고 |
| 댓글 수정/삭제 (`feed.html` 댓글 UI) | `updateComment`, `deleteComment` | ✅ 2개 전부 전환됨 (`CLOUD_RUN_UPDATE_COMMENT_URL`/`CLOUD_RUN_DELETE_COMMENT_URL`) **(2026-09-01 갱신: 이전에는 "미착수"로 표시되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleUpdateComment_`, `handleDeleteComment_` | `postComment`와 동일한 3단 폴백 정책(Track A) |
| 스레드 확인 처리(알림함 '댓글 필요' 정확도) | `getThreadSeen`, `markThreadSeen` | ✅ 2개 전부 전환됨 (`CLOUD_RUN_GET_THREADSEEN_URL`/`CLOUD_RUN_MARKTHREADSEEN_URL`) **(2026-08-21 갱신: 마지막 "미착수" 그룹에 잘못 포함되어 있던 것을 반영)** | `handleGetThreadSeen_`, `handleMarkThreadSeen_` | `markThreadSeen`은 upsert라 markThreadSeenAction_/Apps Script 양쪽이 각자 성공해도 안전하게 수렴 — postComment(append 전용)와 다른, 더 단순한 폴백 정책. `MARKTHREADSEEN_CLOUDRUN_DESIGN.md` 참고 |
| 사용자/품목/고객사 조회 (`feed.html` 관리 화면) | `getUsers`, `getItems`, `getCustomers` | ✅ 3개 전부 전환됨 (`CLOUD_RUN_GET_USERS_URL`/`CLOUD_RUN_GET_ITEMS_URL`/`CLOUD_RUN_GET_CUSTOMERS_URL`) **(2026-09-01 갱신: 이전에는 "미착수" 그룹에 포함되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleGetUsers_`, `handleGetItems_`, `handleGetCustomers_` | 순수 읽기, `getComments`와 동일한 읽기 폴백 패턴 |
| 사용자 관리·비밀번호 변경·설정 저장 (`feed.html` 관리자 화면) | `updateUser`, `changePassword`, `updateSettings` | ✅ 3개 전부 전환됨 (`CLOUD_RUN_UPDATE_USER_URL`/`CLOUD_RUN_CHANGE_PASSWORD_URL`/`CLOUD_RUN_UPDATE_SETTINGS_URL`) **(2026-09-01 갱신: 이전에는 "미착수" 그룹에 포함되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleUpdateUser_`, `handleChangePassword_`, `handleUpdateSettings_` | `updateUser`/`updateSettings`는 관리자 전용(`ADMIN_EMAIL`), `changePassword`는 본인 전용 — 서버가 그대로 판정. 3단 폴백 정책. `USERMGMT_CLOUDRUN_DESIGN.md` 참고 |
| 품목 등록/수정 (신규 고객사 포함) (`feed.html` 품목 관리 화면) | `upsertItem`, `upsertCustomer` | `upsertItem`: ✅ 전환됨 (`CLOUD_RUN_UPSERT_ITEM_URL`) / `upsertCustomer`: ⏸ Cloud Run에 `upsertCustomerTest`는 배포·검증되어 있으나 프론트에서 단독으로 부르는 곳이 없음(신규 고객사는 `upsertItem` 호출에 함께 실려 감) **(2026-09-01 갱신: 이전에는 둘 다 "미착수"로 표시되어 있었으나 `upsertItem`은 실제로 전환·연동 완료 상태였음)** | `handleUpsertItem_`, `handleUpsertCustomer_` | 3단 폴백 정책. `UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md` 참고 |
| 새 게시물/댓글 필요/답변 요청 통합 푸시, 담당자 댓글 마감 리마인더 푸시 (Code.gs에는 없는 신규 기능) | (Cloud Run 전용 신규 API, action 이름 없음) | ✅ 전부 배포·연동 완료 — FCM 토큰 등록(`registerPushSubscriptionTest`, 로그인 시 자동 호출), 5분 주기 통합 푸시(`pushBatchTest`, Cloud Scheduler `push-batch-5min`), 매시 정각 리마인더(`reminderBatchTest`, Cloud Scheduler `reminder-batch-hourly`) | 없음 (Apps Script에 대응 기능 자체가 없는 신규 기능) | `registerPushSubscriptionTest`는 코드가 8/28에 커밋된 뒤 Cloud Run 배포가 누락된 채 방치되어 있다가 **2026-09-01에 배포 완료**됨(그 전까지는 로그인해도 어떤 기기도 실제로 푸시를 등록하지 못하는 상태였음). `PUSH_NOTIFICATION_STAGE3~STAGE6_DESIGN.md` 참고. 전체 구조·Firestore 스키마·Cloud Scheduler 설정·버그 수정 이력(`be8d6fa`, `2d142b6`, `f214df0`)은 아래 "Web Push / FCM 알림 구조" 절 참고 |
| 그 외 나머지 action (`markChecked`, `suggestMaterials`, `getAttentionPosts`, `clientDebugLog`) | 다수 | ⏳ 미착수 | `Code.gs`의 각 `handle*_` 함수 | 아직 전부 Apps Script 경로만 사용. 각각 별도 분석·설계 필요 |

> 이 표는 2026-09-01 기준입니다(실제 `feed.html`/`index.html`/`cloud-run/mro-functions/index.js` 코드와 GCP 콘솔의 실제 배포 목록을 직접 대조해 갱신). 새로운 API를 전환/분석할 때마다 이 표를 함께 갱신해 주세요.

## getTeamManagers 분석 (2026-08-14)

`getTeamManagers`는 Code.gs에도 있고 Cloud Run(`getTeamManagersTest`)에도 이미 만들어져 검증까지 되어 있지만, **실제 프론트엔드(`index.html`, `feed.html`) 어디에서도 호출되지 않습니다.**

조사 결과, 이 기능이 하려던 일(팀장이 자기 팀의 "담당" 역할 사용자 목록을 보는 것)은 **이미 다른 방식으로 살아서 동작하고 있습니다.** `feed.html`의 품목 관리 화면(담당자 배정 드롭다운)은 `getUsers` API를 호출한 뒤, 그 결과를 프론트엔드에서 `team === 내팀 && status === '활성' && role === '담당'` 조건으로 직접 필터링해서 씁니다 — 이는 `handleGetTeamManagers_`가 서버에서 하는 필터링과 완전히 동일한 로직입니다. 즉 `getTeamManagers`는 **중복 구현이며, 지금은 죽은 코드(dead code)**로 보입니다.

결론: 실사용 기능은 이미 `getUsers` 경로로 정상 동작 중이므로, `getTeamManagers`를 위해 새 화면을 만들 필요는 없어 보입니다. 다만 최종 판단은 실제 업무 담당자가 하는 것이 안전합니다.

## Web Push / FCM 알림 구조

Code.gs(Apps Script)에는 대응 기능이 전혀 없는 완전 신규 기능입니다. 화면을 보고 있지 않아도(브라우저/PWA가 백그라운드이거나 완전히 종료돼 있어도) 새 게시물·댓글 필요·답변 요청·담당자 댓글 마감 리마인더를 OS 알림으로 받을 수 있게 합니다.

**등록 흐름** (기기당 1회 생성, 로그인마다 토큰 재확인)
1. `feed.html`이 로그인 성공마다 `initPushOnLogin_()`을 호출 — 브라우저 알림 권한이 `default`면 요청하고, 이미 `granted`면 토큰만 재확인(`syncPushTokenIfNeeded()`), `denied`면 아무 것도 하지 않음(사이드바 "🔔 알림 켜기" 버튼이 재활성화 통로).
2. 기기 식별자는 `getOrCreateDeviceId()`가 기기당 한 번만 랜덤 생성해 `localStorage`(`mro_device_id`)에 저장·재사용.
3. `firebase.messaging().getToken()`으로 FCM 토큰을 받아, 이전 값(`localStorage`의 `mro_fcm_token`)과 다를 때만 `registerPushSubscriptionTest`를 호출해 Firestore `pushSubscriptions/{email}_{deviceId}`에 upsert.

**발송 흐름** (사람이 호출하지 않음, Cloud Scheduler가 트리거)
- `push-batch-5min`(5분마다) → `pushBatchTest`: `role !== '일반'`인 사용자 전원의 새 게시물/댓글 필요/답변 요청 건수를 집계해 통합 푸시 1건으로 발송. Firestore `pushNotifyState/{email}`에 저장한 이전 집계값(signature)과 같으면 재발송하지 않음.
- `reminder-batch-hourly`(매시 정각) → `reminderBatchTest`: 설정 `담당자댓글리마인더사용=TRUE`일 때, `담당자댓글마감시각`(복수 시각 지원, 예 `13,17`)에 도달한 담당자에게 댓글 0건인 배정 품목이 있으면 리마인더 발송. Firestore `reminderDeliveries`로 시각별 하루 1회 발송 보장.
- 두 함수 모두 실제 발송은 `lib/pushSender.js`(`sendConsolidatedPushForUser`/`sendReminderPushForUser`)가 FCM으로 보내고, 서버는 `notification` 페이로드가 아니라 `data` 페이로드만 보냅니다(브라우저 자동 표시 + `sw.js` 수동 표시가 겹쳐 중복되는 것을 막기 위함) — 실제 알림 표시는 클라이언트 쪽 `sw.js`의 `onBackgroundMessage`가 `showNotification()`으로 담당합니다.
- Firestore 컬렉션 3개(`pushSubscriptions`/`pushNotifyState`/`reminderDeliveries`)의 정확한 문서 ID·필드 구성과 Cloud Scheduler 2개 작업의 cron·설명은 [`cloud-run/README.md`](./cloud-run/README.md)에 상세히 정리했습니다.

**알림 클릭 동작** (`sw.js`)
`notificationclick` 리스너는 이미 열려 있는 창이 있으면 `postMessage({type:'mro-push-click', view:'notif'})`로 신호만 보내고 `focus()`(리로드 없음), 열려 있는 창이 없으면 `feed.html?view=notif`로 새 창을 엽니다(해시 `#notif`가 아니라 쿼리스트링). `feed.html`은 이 메시지/쿼리스트링을 받아 `switchView('notif')`로 알림 탭을 열어줍니다.

**배포 방법**: 이 기능 중 `pushBatchTest`/`reminderBatchTest`/`registerPushSubscriptionTest`(Cloud Run 함수)를 고치면 `cloud-run/README.md`의 "배포 방법"대로 해당 함수를 `gcloud functions deploy`로 재배포해야 합니다. 반면 `feed.html`/`sw.js`(프론트엔드) 수정은 **GitHub 커밋만으로 충분**합니다 — GitHub Pages가 커밋을 감지해 자동으로 재배포하고, `sw.js`의 `fetch` 리스너가 항상 `cache:'no-store'`로 최신 파일을 강제 조회하므로 별도 캐시 무효화가 필요 없습니다.

**알려진 버그 수정 이력**
- **커밋 `be8d6fa`** (`cloud-run/mro-functions/lib/feedEngine.js`): `hasUnreadReply`/`hasAwaitingReply`가 서버 원시 댓글 객체에 없는 `comment.createdAt`(실제로는 `createdAtRaw`만 존재)을 참조해 `new Date(undefined)` 비교가 항상 거짓이 되고, 스레드가 한 번이라도 읽음 처리되면 그 이후 새 답글을 서버가 영원히 감지하지 못하던 버그. `sheetSerialToMs(createdAtRaw)` 기준 비교로 수정하고 `pushBatchTest` 재배포로 반영.
- **커밋 `2d142b6`** (`feed.html`): FCM 푸시를 탭해 백그라운드에 살아있던 앱이 포그라운드로 복귀할 때, 서버가 이미 FCM으로 알려준 것과 같은 사건을 클라이언트의 자체 카운트 비교 로직(`updateNotifBadge()`)이 다시 감지해 인앱 알림을 한 번 더 띄우던 중복 표시 문제. 포그라운드 복귀 직후 첫 카운트 계산은 알림 없이 기준값만 맞추도록 억제 플래그(`suppressNextLocalNotif`)를 추가해 수정.
- **커밋 `f214df0`** (`feed.html`): 탭이 완전히 닫혀 있다가 FCM 알림 클릭으로 새로 열리는 콜드 스타트에서, `loadFeed()`가 `notifNewPostsCache`만 로드됐는지 확인하고 `threadSeenMap`은 확인하지 않은 채 배지 카운트를 계산하는 바람에 "댓글 필요"/"답변 요청" 건수가 빠진 낮은 값으로 기준값(`lastNotifCount`)이 먼저 잡히고, 곧이어 `threadSeenMap`까지 로드된 뒤의 정상 계산과 비교되면서 카운트가 오른 것처럼 보여 인앱 알림이 스스로 발동하던 문제. `notifNewPostsCache.loaded && threadSeenMapLoaded`가 모두 준비된 뒤에만 계산하도록 수정 — 위 ②(`2d142b6`)와는 별개의, 백그라운드 복귀와 무관한 경로였음.

## 보안 정책 (반드시 지킬 것)

**API Key, 비밀번호, 실제 Secret 값 등 민감한 정보는 절대 GitHub에 저장하지 않습니다.** 이 저장소의 모든 README에는 Secret의 **이름**만 적혀 있고, 실제 값은 각 서비스의 안전한 저장소(Apps Script Script Properties / Cloud Run 서비스 계정 IAM 권한)에만 존재합니다.

## 하위 문서

- [`frontend/README.md`](./frontend/README.md) — 프론트엔드 파일 목록과 역할, 실제 위치에 대한 설명
- [`apps-script/README.md`](./apps-script/README.md) — Apps Script 백엔드: 배포 방법, Script Properties 목록(이름만), 롤백 방법
- [`cloud-run/README.md`](./cloud-run/README.md) — Cloud Run 함수별 URL, 프로젝트/리전, 상태, 배포/롤백 방법
- [`NODE22_UPGRADE_REPORT.md`](./NODE22_UPGRADE_REPORT.md) — Node.js 20→22 업그레이드 함수별 결과 보고 (2026-08-18)
- [`LOGIN_WHOAMI_MIGRATION_PLAN.md`](./LOGIN_WHOAMI_MIGRATION_PLAN.md) — login/whoami Cloud Run 전환 상세 계획 (1·2단계 실행·검증·반영 완료)
- [`LOGIN_CLOUDRUN_DESIGN.md`](./LOGIN_CLOUDRUN_DESIGN.md) — login(세션 발급 자체) Cloud Run 전환 3단계 상세 설계 (2026-08-21 작성 착수, 코드 변경 없음 — 별도 승인 필요)
- [`FEED_NOTIFICATIONS_CLOUDRUN_ANALYSIS.md`](./FEED_NOTIFICATIONS_CLOUDRUN_ANALYSIS.md) — 피드·알림·실시간 배지(getFeed/getNotifications/getPostById/pollSignal) Cloud Run 이전 가능성 분석 (최초 분석 — 실제 상세 설계는 아래 두 문서로 이어짐)
- [`FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md`](./FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md) — getFeed/getNotifications/getPostById 공용 판정 로직(`lib/feedEngine.js`) 설계
- [`THREADSEEN_FEED_NOTIFICATIONS_CLOUDRUN_PLAN.md`](./THREADSEEN_FEED_NOTIFICATIONS_CLOUDRUN_PLAN.md) — getThreadSeen/getFeed/getNotifications 공동 이전 계획
- [`POLLSIGNAL_CLOUDRUN_TEST_PLAN.md`](./POLLSIGNAL_CLOUDRUN_TEST_PLAN.md) — pollSignal Cloud Run 이전 검증 테스트 계획
- [`POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`](./POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md) — 위 계획의 1단계(로직 비교 테스트) 결과 — 12개 시나리오 전부 일치 확인
- [`WRITE_API_CLOUDRUN_PREREQ_NOTES.md`](./WRITE_API_CLOUDRUN_PREREQ_NOTES.md) — 쓰기 API Cloud Run 이전 사전 조사 (초안 — 아래 문서로 이어짐)
- [`WRITE_API_MIGRATION_PREP_REVIEW.md`](./WRITE_API_MIGRATION_PREP_REVIEW.md) — 쓰기 API(markThreadSeen/postComment) Cloud Run 이전 준비 검토 (최신)
- [`MARKTHREADSEEN_CLOUDRUN_DESIGN.md`](./MARKTHREADSEEN_CLOUDRUN_DESIGN.md) — markThreadSeen Cloud Run 전환 설계·구현·연동 (완료)
- [`POSTCOMMENT_CLOUDRUN_ANALYSIS.md`](./POSTCOMMENT_CLOUDRUN_ANALYSIS.md) — 댓글 기능 Cloud Run 이전 가능성 최초 분석 (초안 — 아래 `_v2` 문서로 대체됨)
- [`POSTCOMMENT_CLOUDRUN_DESIGN.md`](./POSTCOMMENT_CLOUDRUN_DESIGN.md) — postComment 전환 설계 초안 (`_v2`로 대체됨)
- [`POSTCOMMENT_CLOUDRUN_DESIGN_v2.md`](./POSTCOMMENT_CLOUDRUN_DESIGN_v2.md) — postComment 전환 최종 설계(3단 폴백 정책 등, 승인·구현·연동 완료) — 최신
