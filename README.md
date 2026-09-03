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

> **2026-09-01 업데이트(3)**: 알림 탭에 팀장/임원 전용 "알림 전체 지우기" 버튼을 추가했습니다(커밋 `f8ad0da`) — "댓글 필요"/"답변 요청" 탭 각각에만 보이고, 클릭하면 그 탭의 알림만 기존 `markThreadSeen` 경로로 일괄 읽음 처리합니다("새 게시물" 탭·"담당" 역할에는 표시되지 않음). 또한 위 ②·③처럼 경로 하나씩 막던 인앱 알림 중복 수정 방식을 폐기하고, 근본적으로 다시 설계했습니다(커밋 `abc64bf`) — `lastNotifCount`를 계정별 `localStorage`에 영구 저장하고, 알림 표시 여부 판단을 `evaluateLocalNotification_()` 한 곳으로 통합하고, `appActivating` 플래그로 초기 로딩/백그라운드 복귀 중에는 무조건 기준선만 조용히 맞추도록 했습니다. 둘 다 자세한 내용은 아래 "Web Push / FCM 알림 구조" 절 참고. **바로 다음날(2026-09-01) 이 `abc64bf`가 `appActivating`/`lastNotifCount`를 참조하는 코드보다 그 두 변수의 `let` 선언을 아래쪽에 남겨둔 채 배포되어, TDZ(Temporal Dead Zone) `ReferenceError`로 모든 신규 로그인/세션 복귀가 무한로딩에 빠지는 사고가 있었습니다** — 커밋 `ef37c4a`로 선언 위치만 `init()` 호출 전으로 옮겨 당일 수정. 자세한 내용은 아래 "알려진 주요 버그 수정 이력" 절 참고.
>
> **2026-09-02 업데이트**: `collectMarketNews()`(뉴스 수집·게시 파이프라인) 관련 대규모 개선을 진행했습니다 — ① 6분 실행 시간 하드리밋으로 그날 게시물이 0건이 되는 사고가 있었던 것을 동적 AI 시간예산·수집로그 배치 기록·진행 체크포인트로 재발 방지(커밋 `ef27a93`), ② "AI가 관련 있다고 판단했지만 최근 게시된 시황게시물과 유사한 경우" 재게시하지 않는 유사 게시물 비게시 기능 추가(커밋 `31e3b84`/`d110a9c`), ③ 그렇게 게시되지 않은 후보(순위밀림/유사게시물스킵)를 `탈락뉴스` 시트에 보관해 나중에 조회할 수 있게 하는 기능 추가(커밋 `51820e8`/`43b92db`), ④ 모바일에서 사이드바를 열기 전에도 안 읽은 알림을 알 수 있도록 햄버거 버튼에 배지 추가(커밋 `38277a2`). 이 문서도 새 AI/개발자가 저장소만 보고 전체 시스템(Sheets/Firestore 데이터 저장 위치 구분, 뉴스 수집·게시 파이프라인, Firestore 컬렉션 전체 목록, 설정 시트 주요 키, 배포/롤백 방법)을 파악할 수 있도록 이번에 구조를 정리·보강했습니다.
>
> **2026-09-03 업데이트**: 품목 관리 탭에서 유독 자주 뜨던 "서버 연결이 지연되고 있어요" 알림의 원인을 확인해 수정했습니다(커밋 `1f40350`) — `getItems`/`getCustomers`는 이미 Cloud Run 우선 배선이었지만, 같은 화면이 담당자 드롭다운용으로 추가로 부르는 `getUsers` 호출 하나만 배선에서 빠져 있던 것을 확인, "사용자 현황" 화면에서 쓰던 `getUsersRemote_()`를 재사용하도록 통일했습니다. 자세한 내용은 아래 "알려진 주요 버그 수정 이력" 절 참고. 이 작업 중 `loginLocks`/`writeLocks`/`writeIdempotency` 3개 Firestore 컬렉션이 그동안 어느 문서에도 기록되어 있지 않았던 것도 함께 발견해 이번에 처음 문서화했습니다(아래 "Firestore 컬렉션 전체 목록" 절).

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

- **Google Sheets가 실제 데이터베이스입니다.** 사용자 계정(사용자팀마스터), 설정값(설정), 시황 게시물, 품목, 고객, 댓글, 수집로그, 탈락뉴스, 삭제이력 등 모든 "업무 데이터"가 스프레드시트에 저장됩니다.
- **Google Apps Script(Code.gs)가 원래이자 지금도 대부분의 쓰기 기능을 담당하는 백엔드입니다.** 로그인(세션 발급), 뉴스 수집·게시(`collectMarketNews()`, 아래 "뉴스 수집·게시 파이프라인" 절 참고), 항목/고객/사용자 관리, 설정 변경 등을 처리합니다. **(2026-09-02 기준)** `doPost` action 중 `markChecked`/`suggestMaterials`/`getAttentionPosts`/`clientDebugLog` 4개만 아직 Apps Script 전용으로 남아 있고, 나머지 실사용 action(약 21개)은 아래 "Cloud Run 전환 상태"대로 전부 Cloud Run으로 전환·연동 완료된 상태입니다 — 다만 Apps Script 코드 자체는 폴백 대상으로 그대로 남아 있습니다(아래 전환 원칙 참고).
- **Google Cloud Run은 Apps Script의 느린 응답(특히 CacheService 기반 세션 조회)을 개선하기 위해 도입된 신규 백엔드입니다.** 전체 기능을 옮기는 게 아니라, **실제로 트래픽이 있고 안전하게 검증 가능한 API부터 하나씩** Cloud Run으로 옮기고 있습니다. **(2026-09-02 기준)** 읽기·쓰기 합쳐 약 21개 action이 전환·실서비스 연동 완료됐고(`getTeamManagers`/`upsertCustomer`는 배포·검증만 되고 프론트 단독 연동은 없음 — 아래 API 매핑표 참고), 여기에 Apps Script에는 대응 기능 자체가 없는 신규 기능(FCM 푸시 토큰 등록, 5분 주기 통합 푸시, 매시 리마인더 배치) 3개까지 Cloud Run에서만 서비스합니다. Cloud Run은 세션을 Apps Script의 캐시가 아니라 Firestore에서 조회합니다 (Apps Script 로그인 시 Firestore에도 세션을 같이 기록하는 "이중 쓰기" 방식으로 동기화, 세션 조회마다 슬라이딩 연장도 동일하게 적용).
- **전환 원칙(중요): 기존 Apps Script 코드는 절대 삭제하지 않습니다.** 프론트엔드에는 `CLOUD_RUN_..._URL`이라는 이름의 상수가 있고, 이 상수가 채워져 있으면 Cloud Run을 먼저 시도하고, 비어 있으면(혹은 실패하면) 기존 Apps Script로 자동/수동 롤백됩니다.

## 데이터 저장 위치: Google Sheets vs Firestore

이 시스템은 데이터 저장소가 하나가 아니라 **역할이 분리된 두 곳**입니다. 새로 합류하는 개발자/AI가 "이 값은 어디에 저장돼 있지?"를 헷갈리지 않도록 명확히 구분합니다.

- **Google Sheets = 사람이 보고 고치는 "진짜" 업무 데이터.** 사용자 계정·설정값·시황게시물·품목·고객·댓글·수집로그·탈락뉴스·삭제이력 등, 재홍님이나 팀원이 직접 열어서 확인하거나 손으로 고칠 수 있어야 하는 데이터는 전부 Sheets에 있습니다. Apps Script(`Code.gs`)와 Cloud Run 함수 양쪽 다 이 Sheets를 읽고 씁니다(Cloud Run은 서비스 계정 IAM 권한으로 접근).
- **Firestore = 사람이 직접 볼 필요 없는 "인프라성" 상태.** 세션, 락(동시 실행 방지), 중복 실행 방지 키, 푸시 구독/발송 상태처럼 애플리케이션 내부적으로만 쓰이고 사람이 시트처럼 열람·수정할 일이 없는 데이터는 Firestore에 있습니다. Cloud Run 함수들만 Firestore를 사용하고(Apps Script는 세션 이중 기록 때만 예외적으로 접근), 컬렉션 7개의 전체 목록은 아래 "Firestore 컬렉션 전체 목록" 절 참고.
- **판단 기준**: "사람이 직접 열람/수정해야 하는가?"가 갈림길입니다. 그렇다면 Sheets, 아니라면(휘발성이거나 순수 동시성 제어용이라면) Firestore입니다. 이 기준 때문에 예를 들어 알림 자체의 원본 판정 데이터(게시물/댓글)는 Sheets에 있지만, "이 사용자에게 마지막으로 어떤 상태를 보냈는지"(중복 발송 방지 signature) 같은 부가 상태는 Firestore(`pushNotifyState` 등)에 있습니다.

## 뉴스 수집·게시 파이프라인 (`collectMarketNews()`)

매일 새벽(설정 `트리거시각`) 시간 기반 트리거로 실행되는 `Code.gs`의 `collectMarketNews()`가 이 시스템의 핵심 배치 작업입니다. Apps Script 6분 실행 시간 하드리밋 안에서 아래 단계를 순서대로 처리합니다.

1. **수집**: 활성 원자재 × 가격 키워드 조합으로 네이버 뉴스 검색 API를 배치 호출(`UrlFetchApp.fetchAll`, 10건씩·1.1초 간격 — 네이버 초당 10건 제한 준수). 한 배치가 실패해도 그 배치만 건너뛰고 나머지는 계속 진행(2026-08-31, 커밋 `3726e18`).
2. **사전 중복 제거**: 이번 실행의 신규 후보끼리, 그리고 최근(설정 `기사최대경과일`) 게시된 기존 시황게시물 제목과도 제목 단어 겹침(`titleOverlap_`)으로 비교해 재보도 중복을 AI 호출 전에 걸러냅니다(토큰 절약).
3. **AI 판단**: 남은 후보 전부에 대해 AI(Gemini/DeepSeek, `AI_PROVIDER`로 전환 가능)를 배치 호출해 `{relevant, summary, relevanceScore(1~5)}`를 받습니다. **동적 AI 시간예산**(2026-09-02, 커밋 `ef27a93`): `아이데드라인 = 스크립트시작 + 6분 − 60초(후처리 예약)` — 수집 단계가 오래 걸린 날은 AI에 쓸 수 있는 시간이 자동으로 줄어들어, 어떤 경우에도 뒤쪽 기록/게시 단계에 쓸 최소 시간이 보장됩니다. 이 예산을 넘겨 처리 못한 후보는 로그에 남기지 않고 다음 실행(1시간 뒤 자동 재실행 트리거)에서 재시도됩니다.
4. **수집로그 배치 기록**: AI가 판단을 마친 후보는 (게시 여부와 무관하게) 전부 `수집로그` 시트에 중복 방지용으로 기록됩니다. 2026-09-02 이전에는 후보마다 `appendRow()`를 1회씩 호출해 후보가 많은 날 이 구간에서만 시간을 다 써버려 타임아웃으로 이어진 사고가 있었는데, 지금은 판단만 메모리에서 끝내고 루프 종료 후 `setValues()` 1회로 배치 기록합니다.
5. **원자재별 순위 산정 + 유사 게시물 비게시**: `relevant:true`인 후보를 원자재(code)별로 모아 `relevanceScore` 높은 순(동점이면 발행일 최신순)으로 정렬한 뒤, 설정 `원자재별시황게시물출력건수`(기본 1)만큼만 게시 후보로 남깁니다. 게시 직전, 최근(설정 `유사게시물비교기간`, 기본 3일) 게시된 시황게시물과 제목/AI요약이 유사(`isSimilarToRecentPost_`, 겹침 ≥0.5)하면 게시하지 않습니다(2026-09-01, 커밋 `31e3b84`) — 사전 중복 제거(2단계, 원문 제목 기반)가 놓치는 "제목은 다르지만 AI 요약은 사실상 같은 내용" 케이스까지 잡기 위함입니다.
6. **탈락뉴스 보관 (그룹B)**: `relevant:true`였지만 위 5단계에서 실제로는 게시되지 않은 후보 — 순위 경쟁에서 밀린 경우(사유 `순위밀림`)와 유사 게시물로 스킵된 경우(사유 `유사게시물스킵`) — 를 `탈락뉴스` 시트에 배치 기록합니다(2026-09-02, 커밋 `51820e8`). 본문 전체가 아니라 AI 요약만 저장하고, 원문 링크 저장 여부는 `Code.gs`의 `REJECTED_NEWS_STORE_LINK` 상수(기본 `true`)로 제어합니다. 컬럼: `수집일 / 원자재코드 / 원자재명 / 제목 / AI요약 / relevanceScore / 링크 / 탈락사유`. 시트는 기록할 게 실제로 생겼을 때만 자동 생성됩니다(기록이 한 번도 없으면 시트 자체가 없는 것이 정상).
7. **진행 체크포인트**: 6분 하드리밋으로 강제 종료되면 그 이후 코드는 전혀 실행되지 않아(catch 불가능) 원인 파악이 어려웠던 점을 보완하기 위해, 각 단계 완료 시점마다 스크립트 속성 `CMN_LAST_STAGE`에 `단계명@시작시각/경과초` 형태로 기록합니다(수집완료 → AI판단완료 → 수집로그기록완료 → 게시완료 → 정리완료/정리건너뜀). 다음 실행 시작 시 "지난번에 어디까지 갔었는지" 바로 확인 가능(사후 진단용, 로직에는 영향 없음).
8. **정리(purge)**: 게시까지 끝난 뒤 남은 시간이 15초 미만이면 이번 실행은 정리를 건너뛰고 다음 실행에 맡깁니다(정리를 하루 미뤄도 데이터 유실은 없지만, 게시 직후 얼마 안 남은 시간에 정리까지 욕심내다 하드리밋에 걸리는 것보다 안전). 여유가 있으면 `purgeOldRecords_()`가 `시황게시물`(설정 `시황게시물보관기간`)·`수집로그`(설정 `수집로그보관기간`)·`탈락뉴스`(설정 `탈락뉴스보관기간`)를 각각의 보관기간 기준으로 배치 삭제하고, 삭제된 게시물에 딸린 고아 댓글도 함께 정리하며, 삭제 건수를 `삭제이력` 시트에 감사 기록으로 남깁니다.

> **2026-09-02 사고 이력**: 위 4·7·8단계는 전부 이 날 발생한 실제 사고(수집이 평소보다 오래 걸린 날, 6분 하드리밋에 걸려 그날 게시물이 0건이 된 사고)를 Executions 로그·Cloud 로그로 직접 진단한 뒤 만든 재발 방지 장치입니다. 자세한 원인 분석은 이 세션에서 다뤘고 별도 설계 문서로는 남기지 않았습니다 — 코드 안 주석(`collectMarketNews()` 상단 및 각 단계)에 근거와 함께 기록되어 있습니다.

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
| 사용자/품목/고객사 조회 (`feed.html` 관리 화면) | `getUsers`, `getItems`, `getCustomers` | ✅ 3개 전부 전환됨 (`CLOUD_RUN_GET_USERS_URL`/`CLOUD_RUN_GET_ITEMS_URL`/`CLOUD_RUN_GET_CUSTOMERS_URL`) **(2026-09-01 갱신: 이전에는 "미착수" 그룹에 포함되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleGetUsers_`, `handleGetItems_`, `handleGetCustomers_` | 순수 읽기, `getComments`와 동일한 읽기 폴백 패턴. **(2026-09-03 갱신: `getUsers`는 "사용자 현황" 화면 호출부만 이 배선을 타고 있었고, 품목 관리 탭(`loadItems()`) 내부의 별도 `getUsers` 호출은 Apps Script로 직행하고 있던 것을 이번에 통일함 — 커밋 `1f40350`)** |
| 사용자 관리·비밀번호 변경·설정 저장 (`feed.html` 관리자 화면) | `updateUser`, `changePassword`, `updateSettings` | ✅ 3개 전부 전환됨 (`CLOUD_RUN_UPDATE_USER_URL`/`CLOUD_RUN_CHANGE_PASSWORD_URL`/`CLOUD_RUN_UPDATE_SETTINGS_URL`) **(2026-09-01 갱신: 이전에는 "미착수" 그룹에 포함되어 있었으나 실제로는 전환·연동 완료 상태였음)** | `handleUpdateUser_`, `handleChangePassword_`, `handleUpdateSettings_` | `updateUser`/`updateSettings`는 관리자 전용(`ADMIN_EMAIL`), `changePassword`는 본인 전용 — 서버가 그대로 판정. 3단 폴백 정책. `USERMGMT_CLOUDRUN_DESIGN.md` 참고 |
| 품목 등록/수정 (신규 고객사 포함) (`feed.html` 품목 관리 화면) | `upsertItem`, `upsertCustomer` | `upsertItem`: ✅ 전환됨 (`CLOUD_RUN_UPSERT_ITEM_URL`) / `upsertCustomer`: ⏸ Cloud Run에 `upsertCustomerTest`는 배포·검증되어 있으나 프론트에서 단독으로 부르는 곳이 없음(신규 고객사는 `upsertItem` 호출에 함께 실려 감) **(2026-09-01 갱신: 이전에는 둘 다 "미착수"로 표시되어 있었으나 `upsertItem`은 실제로 전환·연동 완료 상태였음)** | `handleUpsertItem_`, `handleUpsertCustomer_` | 3단 폴백 정책. `UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md` 참고 |
| 새 게시물/댓글 필요/답변 요청 통합 푸시, 담당자 댓글 마감 리마인더 푸시 (Code.gs에는 없는 신규 기능) | (Cloud Run 전용 신규 API, action 이름 없음) | ✅ 전부 배포·연동 완료 — FCM 토큰 등록(`registerPushSubscriptionTest`, 로그인 시 자동 호출), 5분 주기 통합 푸시(`pushBatchTest`, Cloud Scheduler `push-batch-5min`), 매시 정각 리마인더(`reminderBatchTest`, Cloud Scheduler `reminder-batch-hourly`) | 없음 (Apps Script에 대응 기능 자체가 없는 신규 기능) | `registerPushSubscriptionTest`는 코드가 8/28에 커밋된 뒤 Cloud Run 배포가 누락된 채 방치되어 있다가 **2026-09-01에 배포 완료**됨(그 전까지는 로그인해도 어떤 기기도 실제로 푸시를 등록하지 못하는 상태였음). `PUSH_NOTIFICATION_STAGE3~STAGE6_DESIGN.md` 참고. 전체 구조·Firestore 스키마·Cloud Scheduler 설정·버그 수정 이력(`be8d6fa`, `2d142b6`, `f214df0`, `f8ad0da`, `abc64bf`)은 아래 "Web Push / FCM 알림 구조" 절 참고 |
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

**알림 탭 일괄 삭제** (커밋 `f8ad0da`)
`renderNotif()`는 현재 탭이 "댓글 필요" 또는 "답변 요청"이고 `session.role`이 `팀장`/`임원`일 때만 탭 목록 바로 아래에 "알림 전체 지우기" 버튼을 렌더링합니다 — "새 게시물" 탭과 "담당" 역할에는 버튼 자체가 렌더링되지 않습니다. 버튼을 누르면 `clearAllNotifInActiveTab()`이 현재 활성 탭 기준으로 일치하는 스레드를 `hasUnreadReply`/`hasAwaitingReply`로 다시 계산한 뒤, 새 서버 API 없이 기존 `markThreadSeenLocal()`(→`markThreadSeenRemote_()`) 경로를 스레드마다 호출해 일괄 읽음 처리합니다. 다른 탭의 알림에는 영향이 없습니다.

**"댓글 필요" 읽음 처리 규칙 — 담당은 읽기만으로 안 사라짐 (의도된 설계, 버그 아님)**
`goToItem()`/`toggleThread()`가 스레드를 열 때 `markThreadSeenLocal()`을 호출하는 조건에 `session.role !== '담당'`이 걸려 있습니다 — 즉 **담당 역할로 로그인해서 "댓글 필요" 알림을 열어봐도, 그것만으로는 읽음 처리가 되지 않고 배지가 그대로 남습니다.** 팀장/임원이 열어보면 즉시 읽음 처리되는 것과 다릅니다. 이건 버그가 아니라 재홍님이 정한 규칙입니다: 담당이 단순히 읽기만 해도 알림이 사라지면, 나중에 그 품목에 문제가 생겨 원인을 찾으려 할 때 "댓글 필요" 목록에서 해당 스레드를 다시 찾을 수 없게 됩니다 — 그래서 담당은 **실제로 답글을 남겨야만**(그 순간부터 자신이 마지막 작성자가 되어 `hasUnreadReply()`가 자연히 false를 반환) 알림이 사라지도록 의도적으로 막아둔 것입니다(2026-09-02, 세션 대화로 확인 — 별도 커밋 없음, 기존 동작 그대로). **새 AI/개발자에게: 이 조건을 "역할 체크가 잘못됐다"고 보고 지우지 마세요** — 지우면 이 안전장치가 깨집니다.

**모바일 햄버거 메뉴 알림 배지** (2026-09-02, 커밋 `38277a2`)
모바일 폭(`@media (max-width:768px)`)에서는 사이드바가 화면 밖에 숨어 있다가 햄버거 버튼(`☰`)을 눌러야 나타나므로, 열어보기 전에도 안 읽은 알림이 있는지 알 수 있도록 그 버튼 모서리에 배지를 추가했습니다. `updateNotifBadge()`가 이미 계산해 두는 `count`(사이드바 `#notif-badge`/PWA 앱 아이콘 배지와 동일한 값)를 그대로 재사용하며, 새 계산 로직이나 API 호출은 추가되지 않았습니다. 표시 형식은 사이드바 배지와 통일: `count`가 0이면 숨김, 1~99는 숫자 그대로, 100 이상은 `99+`. 데스크톱에서는 `.hamburger` 자체가 `display:none`이라 이 배지도 자연히 표시되지 않습니다(별도 분기 불필요).

**클라이언트 인앱 알림 중복 방지 구조** (커밋 `abc64bf`)
아래 ②(`2d142b6`)·③(`f214df0`) 수정은 각각 개별 경로(포그라운드 복귀, 콜드 스타트) 하나씩을 막는 방식이었는데, 이후 백그라운드→포그라운드 복귀 시 `refreshOnResume()`이 `loadFeed()`/`pollForUpdates()`/(알림 탭이면) `loadNotifNewPosts()` 등 여러 비동기 경로를 동시에 실행하면서, 이 중 가장 먼저 끝나는 경로만 1회성 억제 플래그(`suppressNextLocalNotif`)를 소비해버려 나머지 경로가 이미 낡은 캐시값 기준으로 계산해버리는 4번째 중복 알림 버그가 발견되었습니다. 매번 "그 경로만 막는" 패치를 반복하면 같은 문제가 또 다른 경로에서 재발할 수 있다는 판단에 따라, 이번에는 구조 자체를 다시 설계했습니다:
- **영구 기준선**: `lastNotifCount`를 메모리 변수 대신 계정별 `localStorage` 키(`mro_last_notif_count::{email}`)에 저장해, 새로고침/재로그인/기기 전환 후에도 기준선이 유지됩니다.
- **단일 판단 지점**: 알림을 실제로 띄울지 여부를 판단하는 로직을 `evaluateLocalNotification_(count)` 한 함수로 통합했습니다. `updateNotifBadge()`를 포함한 모든 호출부는 이제 이 함수만 호출합니다.
- **활성화 플래그**: 기존 1회성 `suppressNextLocalNotif`를 범위가 넓은 `appActivating` 플래그로 대체했습니다. `beginAppActivating_()`/`endAppActivating_()`으로 켜고 끄며, 콜드 스타트(`proceedAfterAuth()`)와 백그라운드 복귀(`refreshOnResume()`) 양쪽 모두 관련 비동기 작업 전체를 `Promise.all(...).finally(endAppActivating_)`로 감싸, "가장 먼저 끝나는 경로"가 아니라 "모든 경로가 끝날 때까지" 억제 상태를 유지합니다. `appActivating`이 켜져 있는 동안에는 `evaluateLocalNotification_()`이 알림 없이 기준선만 조용히 갱신합니다.
- **기존 수정과의 관계**: `suppressNextLocalNotif`는 코드에서 완전히 제거되었습니다(설명용 주석 한 곳에만 이름이 남음). `f214df0`가 추가한 `notifNewPostsCache.loaded && threadSeenMapLoaded` 콜드 스타트 게이트는 그대로 유지했습니다 — 위 새 구조와 겹치는 방어이지만 제거할 이유가 없는 안전장치로 판단해 남겨두었습니다.

**배포 방법**: 이 기능 중 `pushBatchTest`/`reminderBatchTest`/`registerPushSubscriptionTest`(Cloud Run 함수)를 고치면 `cloud-run/README.md`의 "배포 방법"대로 해당 함수를 `gcloud functions deploy`로 재배포해야 합니다. 반면 `feed.html`/`sw.js`(프론트엔드) 수정은 **GitHub 커밋만으로 충분**합니다 — GitHub Pages가 커밋을 감지해 자동으로 재배포하고, `sw.js`의 `fetch` 리스너가 항상 `cache:'no-store'`로 최신 파일을 강제 조회하므로 별도 캐시 무효화가 필요 없습니다.

**알려진 버그 수정 이력**
- **커밋 `be8d6fa`** (`cloud-run/mro-functions/lib/feedEngine.js`): `hasUnreadReply`/`hasAwaitingReply`가 서버 원시 댓글 객체에 없는 `comment.createdAt`(실제로는 `createdAtRaw`만 존재)을 참조해 `new Date(undefined)` 비교가 항상 거짓이 되고, 스레드가 한 번이라도 읽음 처리되면 그 이후 새 답글을 서버가 영원히 감지하지 못하던 버그. `sheetSerialToMs(createdAtRaw)` 기준 비교로 수정하고 `pushBatchTest` 재배포로 반영.
- **커밋 `2d142b6`** (`feed.html`): FCM 푸시를 탭해 백그라운드에 살아있던 앱이 포그라운드로 복귀할 때, 서버가 이미 FCM으로 알려준 것과 같은 사건을 클라이언트의 자체 카운트 비교 로직(`updateNotifBadge()`)이 다시 감지해 인앱 알림을 한 번 더 띄우던 중복 표시 문제. 포그라운드 복귀 직후 첫 카운트 계산은 알림 없이 기준값만 맞추도록 억제 플래그(`suppressNextLocalNotif`)를 추가해 수정.
- **커밋 `f214df0`** (`feed.html`): 탭이 완전히 닫혀 있다가 FCM 알림 클릭으로 새로 열리는 콜드 스타트에서, `loadFeed()`가 `notifNewPostsCache`만 로드됐는지 확인하고 `threadSeenMap`은 확인하지 않은 채 배지 카운트를 계산하는 바람에 "댓글 필요"/"답변 요청" 건수가 빠진 낮은 값으로 기준값(`lastNotifCount`)이 먼저 잡히고, 곧이어 `threadSeenMap`까지 로드된 뒤의 정상 계산과 비교되면서 카운트가 오른 것처럼 보여 인앱 알림이 스스로 발동하던 문제. `notifNewPostsCache.loaded && threadSeenMapLoaded`가 모두 준비된 뒤에만 계산하도록 수정 — 위 ②(`2d142b6`)와는 별개의, 백그라운드 복귀와 무관한 경로였음.
- **커밋 `abc64bf`** (`feed.html`): 위 ②·③이 각각 막았던 개별 경로 외에, `refreshOnResume()`이 여러 비동기 경로를 동시 실행하면서 1회성 억제 플래그를 가장 먼저 끝난 경로만 소비해버려 나머지 경로가 낡은 캐시 기준으로 알림을 다시 띄우던 4번째 중복 알림 버그. "경로 하나씩 막는" 방식 대신 영구 `localStorage` 기준선 + 단일 판단 함수(`evaluateLocalNotification_()`) + 범위를 넓힌 `appActivating` 플래그로 구조 자체를 다시 설계 — 자세한 내용은 위 "클라이언트 인앱 알림 중복 방지 구조" 참고. `suppressNextLocalNotif`는 완전히 대체·제거되었고, `f214df0`의 `threadSeenMapLoaded` 게이트는 그대로 유지됨.

## Firestore 컬렉션 전체 목록

Cloud Run 함수들이 쓰는 Firestore 컬렉션 7개입니다(전부 `mro-market-intelligence` 프로젝트, 기본 데이터베이스). 각 컬렉션의 문서 ID/필드 상세는 [`cloud-run/README.md`](./cloud-run/README.md)의 "Firestore 구조" 절 참고 — 여기서는 전체 목록과 용도만 한눈에 볼 수 있게 정리합니다.

| 컬렉션 | 문서 ID | 쓰는 함수 | 용도 |
|---|---|---|---|
| `sessions` | `sessionToken` | `sessionSyncTest`(기록), 나머지 대부분(조회) | 로그인 세션(Apps Script 로그인 시 이중 쓰기로 동기화, 6시간 만료) |
| `loginLocks` | `email` | `loginTest`(`acquireLoginLock_`/`releaseLoginLock_`) | 같은 이메일로 동시에 들어오는 로그인 시도를 직렬화하는 분산 락(죽은 락은 10초 후 자가 회수) |
| `writeLocks` | `lockName`(예: `upsertItemAndCustomer`) | `upsertItemTest`/`upsertCustomerTest`(`lib/writeLock.js`) | 품목·고객사마스터에 동시에 쓸 수 있는 두 함수가 공유하는 분산 락. `loginLocks`와 같은 정책(트랜잭션 선점 + 죽은 락 자가 회수)을 재사용 가능한 모듈로 일반화한 것 |
| `writeIdempotency` | `idempotencyKey`(`feed.html`의 `generateIdempotencyKey_()`가 생성) | `markThreadSeenTest`/`postCommentTest`/`loginTest`/`updateCommentTest`/`deleteCommentTest`/`upsertItemTest`/`upsertCustomerTest`/`updateUserTest`/`changePasswordTest`/`updateSettingsTest` (총 10개 쓰기 함수, `lib/writeIdempotency.js`) | "같은 요청이 재시도로 두 번 도착해도 실제 쓰기는 한 번만" 보장. `Code.gs`의 `withIdempotency_`(CacheService+LockService)와 동일한 정책을 Firestore 트랜잭션으로 재현(TTL 6시간) |
| `pushSubscriptions` | `{email}_{deviceId}` | `registerPushSubscriptionTest` | 기기별 FCM 푸시 토큰 |
| `pushNotifyState` | `email` | `pushBatchTest` | 5분 주기 통합 푸시의 중복 발송 방지(직전 집계값 signature 비교) |
| `reminderDeliveries` | `{날짜}_{targetHour}_{email}` | `reminderBatchTest` | 담당자 댓글 마감 리마인더의 시각별 하루 1회 발송 보장 |

> `loginLocks`/`writeLocks`/`writeIdempotency` 3개는 2026-09-02 이 문서 정리 작업 중 코드(`cloud-run/mro-functions/index.js`, `lib/writeLock.js`, `lib/writeIdempotency.js`)를 직접 확인해 처음으로 문서화했습니다 — 이전까지는 `cloud-run/README.md`의 "Firestore 구조" 절에도 빠져 있었습니다. 상세 필드 구성 등은 `cloud-run/README.md`도 함께 갱신해 두었습니다.

## Cloud Scheduler 작업

`pushBatchTest`/`reminderBatchTest`는 사람이 호출하는 API가 아니라 Cloud Scheduler(리전 `asia-northeast3`)가 정해진 주기로 트리거합니다.

| 작업 이름 | 주기 | 대상 함수 |
|---|---|---|
| `push-batch-5min` | 5분마다 | `pushBatchTest` — 새 게시물/댓글 필요/답변 요청을 통합 푸시 1건으로 발송 |
| `reminder-batch-hourly` | 매시 정각 | `reminderBatchTest` — 설정 `담당자댓글마감시각`(복수 시각 지원)에 맞춰 리마인더 발송 |

cron 표현식, 복수 시각(`13,17`) 처리 방식 등 상세는 [`cloud-run/README.md`](./cloud-run/README.md)의 "Cloud Scheduler 작업" 절 참고.

## 설정 시트 주요 키

'설정' 시트(키/값/설명 3열 구조)에서 코드가 실제로 읽는 주요 키입니다. 라벨·설명 문구는 `feed.html`의 `SETTINGS_META`에 등록돼 있어야 설정 화면에도 노출됩니다 — 새 설정 키를 추가할 때는 시트 행 + `SETTINGS_META` 항목을 항상 함께 추가해야 합니다.

| 키 | 기본값 | 읽는 곳 | 용도 |
|---|---|---|---|
| `뉴스수집건수` | 5 | `getSettings_().display` | 네이버 뉴스 검색 1회 호출당 수집 건수 |
| `트리거시각` | 1 | `getSettings_().triggerHour` | `collectMarketNews()` 자동 실행 시각(0~23시) |
| `시황게시물보관기간` | 60(일) | `getSettings_().postRetentionDays` | `시황게시물` 시트 자동 삭제 기준(게시일 기준) |
| `수집로그보관기간` | 30(일) | `getSettings_().logRetentionDays` | `수집로그` 시트 자동 삭제 기준(수집일시 기준) |
| `기사최대경과일` | 7(일) | `getSettings_().maxArticleAgeDays` | 발행일 기준 이보다 오래된 원문 기사는 AI 호출 전에 사전 배제 |
| `원자재별시황게시물출력건수` | 1 | `getSettings_().maxPostsPerMaterial` | `collectMarketNews()` 1회 실행당 원자재(code)별 게시 상한(초과분은 `탈락뉴스`에 사유 `순위밀림`으로 기록) |
| `유사게시물비교기간` | 3(일) | `getSettings_().similarPostCompareDays` | 오늘 선정된 대표 뉴스가 최근 이 기간 내 게시된 시황게시물과 유사하면 재게시하지 않음(값이 없거나 0/음수/숫자가 아니면 로그에 경고 남기고 기본값 3 사용) |
| `탈락뉴스보관기간` | 30(일) | `getSettings_().rejectedNewsRetentionDays` | `탈락뉴스` 시트 자동 삭제 기준(수집일 기준) |
| `뉴스피드출력기간` | (프론트 전용) | `feed.html` | 피드에 표시되는 최근 게시물 기간(일). 담당이 확인 안 한 게시물은 예외적으로 계속 노출 |
| `담당자댓글리마인더사용` | — | `reminderBatchTest`(Cloud Run) | `TRUE`일 때만 담당자 댓글 마감 리마인더 배치 동작 |
| `담당자댓글마감시각` | — | `reminderBatchTest`(Cloud Run) | 리마인더 발송 기준 시각. 쉼표로 복수 시각 지정 가능(예 `13,17`) — 각 시각마다 독립적으로 하루 1회 발송 |

> 이 외에도 `가격키워드`(뉴스 판단 키워드), `팀장_열람범위`, `무활동로그아웃분`, `비밀번호만료일수`, `백업시각` 등이 있습니다 — 전체 최신 목록과 설명 문구는 `feed.html`의 `SETTINGS_META` 객체가 항상 최신 소스입니다.

## 알려진 주요 버그 수정 이력

Web Push/알림 관련 버그 4건(중복 표시 3건 + 구조 재설계 1건)은 위 "Web Push / FCM 알림 구조" 절에 커밋별로 상세히 정리되어 있습니다(`be8d6fa`, `2d142b6`, `f214df0`, `abc64bf`). 여기서는 그 외 알려진 주요 사고 2건을 정리합니다.

- **뉴스 수집 6분 실행 타임아웃** (2026-09-02 사고, 커밋 `ef27a93`): `collectMarketNews()`의 네이버 수집 단계가 평소보다 오래 걸린 날, 뒤이은 AI 판단 단계가 고정된 시간예산(4.5분)을 그대로 쓰면서 수집+AI를 마친 시점에 후처리(수집로그 기록·게시·정리)에 쓸 시간이 실제로는 부족해져 Apps Script 6분 하드리밋에 걸려 강제 종료 — 그날 게시물이 0건이 됐습니다. Executions 로그·Cloud 로그로 정확한 타임스탬프를 직접 확인해 원인을 특정했습니다. 동적 AI 시간예산(`6분 − 60초 후처리 예약`) + 수집로그 배치 기록(건별 `appendRow` → `setValues` 1회) + 진행 체크포인트(`CMN_LAST_STAGE`) + 정리(purge) 건너뛰기 가드로 재발 방지. 자세한 내용은 위 "뉴스 수집·게시 파이프라인" 절 참고.
- **로그인 TDZ(Temporal Dead Zone) 오류로 인한 전체 로그인 장애** (2026-09-01, 커밋 `ef37c4a`): 알림 중복 방지 구조 재설계(`abc64bf`)가 `proceedAfterAuth()`/`refreshOnResume()`에서 `appActivating`/`lastNotifCount` 변수를 참조하도록 바뀌었는데, 그 두 변수의 `let` 선언이 참조 지점보다 아래(파일 뒤쪽, `init()` 실행 이후)에 그대로 남아 있어 "Cannot access 'appActivating' before initialization" 오류가 발생 — **Apps Script든 Cloud Run이든 경로와 무관하게, 이 커밋이 배포된 직후 모든 신규 로그인/세션 복귀가 무한로딩에 빠지는 전체 장애**였습니다. `notifFetchSeq`와 동일한 방식으로 두 변수의 선언 위치만 `init()` 호출 전으로 옮겨 당일 수정, 로직 변경은 없음.
- **품목 관리 탭의 "서버 연결이 지연되고 있어요" 알림이 유독 잦았던 원인** (2026-09-03, 커밋 `1f40350`): `getItems`/`getCustomers`는 이미 Cloud Run 우선 시도(실패 시 Apps Script 폴백)로 배선되어 있었지만, 같은 화면(`loadItems()`)이 담당자 드롭다운을 채우려고 내부적으로 추가로 부르는 `getUsers` 호출 하나만 배선에서 제외되어 처음부터 Apps Script로 직행하고 있었습니다(코드 주석에 "이번 배선 대상이 아니라 그대로 둔다"고 의도적으로 남겨져 있었음). `loadItems()`가 3개 API를 `Promise.allSettled`로 동시에 부르는 구조라, 이 하나만 늦어져도 화면 하단에 지연 알림이 떴던 것 — "사용자 현황" 화면(`loadUsers()`)에서 이미 쓰고 있던 `getUsersRemote_()`(Cloud Run 우선 + Apps Script 폴백)를 `loadItems()`에도 그대로 재사용하도록 호출부 1줄만 교체해 해결. 버그가 아니라 예전 마이그레이션 작업에서 이 호출 하나만 배선 대상에서 빠뜨린 누락이었습니다.

## 배포/롤백 방법

세 영역(프론트엔드/Apps Script/Cloud Run)이 배포 방식이 전부 다릅니다 — 무엇을 고쳤는지에 따라 아래 중 해당하는 방법만 따르면 됩니다. 상세 절차·롤백 방법은 각 하위 문서에 있습니다.

| 고친 파일 | 배포 방법 | 상세 |
|---|---|---|
| `index.html`/`feed.html`/`sw.js`/`manifest.json` 등 (저장소 루트) | GitHub에 커밋만 하면 끝 — GitHub Pages가 자동 재배포. `sw.js`가 `cache:'no-store'`를 쓰므로 별도 캐시 무효화도 불필요 | [`frontend/README.md`](./frontend/README.md) |
| `apps-script/Code.gs` | ① Apps Script 편집기에서 `Code.gs` 전체 내용을 실제로 교체하고 저장(시간 기반 트리거로 실행되는 `collectMarketNews()` 등은 저장만 하면 다음 실행부터 반영 — 재배포 불필요). ② `doPost` Web App 자체(요청 URL)를 바꿔야 하면 "새 배포"로 Web App을 다시 배포. ③ 이 저장소의 `apps-script/Code.gs`도 같은 내용으로 다시 커밋해 동기화(GitHub 커밋 → 라이브 Sheet가 자동으로 바뀌는 게 아니라, 그 반대 방향입니다 — 편집기가 원본, GitHub는 미러) | [`apps-script/README.md`](./apps-script/README.md) |
| `cloud-run/mro-functions/index.js`(및 `lib/*`) | `gcloud functions deploy <함수이름> --gen2 --runtime=nodejs22 --region=asia-northeast3 --source=. --entry-point=<함수이름> --trigger-http --allow-unauthenticated`. 한 소스를 여러 entry point가 공유하므로, 고친 코드를 실제로 쓰는 **모든** entry point를 각각 재배포해야 함 | [`cloud-run/README.md`](./cloud-run/README.md) |

**롤백 요약**: 프론트/Apps Script는 이전 커밋 내용으로 되돌려 다시 커밋(또는 편집기에 다시 붙여넣기)하면 됩니다. Cloud Run 개별 함수는 Cloud Console → Cloud Functions → 해당 함수 → "리비전" 탭에서 이전 리비전으로 트래픽을 옮기거나, 프론트의 `CLOUD_RUN_..._URL` 상수를 비워 즉시 Apps Script 경로로 되돌릴 수 있습니다(가장 흔히 쓰는 방법 — Apps Script 코드는 항상 그대로 남아있으므로).

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
