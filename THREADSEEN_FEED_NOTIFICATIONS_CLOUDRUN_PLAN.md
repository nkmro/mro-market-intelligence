# getThreadSeen 단독 이전 + getFeed·getNotifications·getPostById 공동 이전 — 분석 및 설계 (2026-08-19, 분석/설계 단계 — 코드 변경 없음)

이 문서는 오늘(8/19) 확인된 "서버 연결 지연" 실측 데이터를 근거로, 다음 순서의 Cloud Run 이전을 검토한 결과입니다.

1단계: `getThreadSeen` 단독 이전
2단계: `getFeed` + `getNotifications` + `getPostById` 공동 이전 (기존 `pollSignal`과 판정 로직 통일)
3단계: 나머지 Apps Script 전용 읽기 API 후순위 검토

**이 문서 작성 시점까지 코드 수정, GitHub 커밋, Cloud Run 배포, Apps Script 배포, Firestore/Sheets 운영 데이터 변경은 전혀 하지 않았습니다.** 승인 후에만 실제 구현에 들어갑니다.

모든 항목은 다음 세 가지를 구분해서 표기합니다: **[기존]** 실제 저장소/운영에 존재, **[신규 제안]** 새로 만들 것을 제안, **[추정]** 검증되지 않은 예상치.

---

## ① 현재 실제 Cloud Run 구조 [기존]

GitHub 저장소(`cloud-run/mro-functions/`)를 직접 열어 확인했습니다. 챗지피티가 언급한 `lib/dates.js`, `lib/feedRules.js`, `lib/buildFeedEntry.js`, `lib/auth.js`, `lib/sheetRows.js` 같은 파일/폴더는 **저장소에 존재하지 않습니다.**

실제 구조는 다음과 같습니다.

- `cloud-run/mro-functions/index.js` (545줄) 하나의 파일에 `exports.함수이름` 9개가 전부 들어있습니다: `pingTest`, `sheetPingTest`, `getTeamsTest`, `firestoreTest`, `sessionSyncTest`, `whoamiTest`, `getSettingsTest`, `getTeamManagersTest`, `pollSignalTest`.
- 배포는 폴더 분리가 아니라 "소스 하나 + `--entry-point` 8~9개" 방식입니다 (`gcloud functions deploy <이름> --source=. --entry-point=<이름>`).
- `cloud-run/mro-functions/package.json`: `@google-cloud/firestore@9.0.0`, `google-auth-library@9.15.1`. 환경변수/Secret은 앱 코드에서 참조하지 않음(서비스 계정 IAM 권한만 사용).
- `cloud-run/mro-functions/fix.py`, `fix2.py`: 한글 시트 탭 이름을 유니코드 이스케이프로 안전하게 넣기 위한 배포 전 보조 스크립트(실행 코드 아님).
- 인증 없이 호출 가능(`--allow-unauthenticated`)하지만, 각 함수 내부에서 `sessionToken`으로 자체 인증합니다.
- 참고 문서: `cloud-run/README.md`, `README.md`(API 매핑표), `FEED_NOTIFICATIONS_CLOUDRUN_ANALYSIS.md`, `POLLSIGNAL_CLOUDRUN_TEST_PLAN.md`, `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md` — 전부 실제 존재하는 문서이며, 이번 설계는 이 문서들의 내용을 그대로 근거로 삼았습니다.

**[문서 오차 발견, 기존]**: `cloud-run/README.md`는 "8개 함수"라고 적혀 있지만 실제 `index.js`에는 `pollSignalTest`까지 9개가 있습니다. `pollSignalTest`가 나중에 추가되면서 이 문서 갱신이 빠진 것으로 보입니다(⑲에서 다시 언급).

## ② 현재 pollSignal 이전 상태 [기존 + 문서 오차 발견]

- `cloud-run/mro-functions/index.js`에 `exports.pollSignalTest`가 **실제로 구현되어 있고**, Firestore 세션 인증 → `touchSession_` 슬라이딩 연장 → `values:batchGet`으로 사용자팀마스터/시황게시물/품목마스터/댓글/설정 5개 시트를 한 번에 읽어 → `teamScopeAllows_`/`relatedActiveItems_`/`summarizeItemForPost_`/`needsAttentionFor_` 함수로 Apps Script의 `canViewComment_`/`getRelatedItems_`/`buildFeedEntry_`와 동일한 로직을 재현합니다.
- `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`에 12개 시나리오(역할별 분기·팀장 열람범위·등록일 역전 등) 전부 Apps Script와 완전히 일치한다는 검증 결과가 이미 남아 있습니다.
- `feed.html`에는 실제로 `CLOUD_RUN_POLLSIGNAL_URL` 상수가 있고(git 확인: 커밋 `2c8aa1a`, 2026-08-18), pollSignal 호출 시 이 URL을 먼저 시도하고 실패하면 기존 Apps Script `pollSignal`로 자동 폴백합니다. 오늘 Cloud Run 콘솔에서 `pollsignaltest` 서비스가 실제로 요청을 받고 있는 것도 직접 확인했습니다(초당 0.2~0.4건, 30초 폴링 특성과 일치).
- **문서 오차**: `README.md`의 API 매핑표와 `cloud-run/README.md`의 함수 목록표는 아직 pollSignal을 "📋 이전 후보로 확정, 승인 대기"로만 표시하고 있어, **실제로 이미 실서비스에 연동되어 있다는 사실이 반영되지 않았습니다.** 코드는 문제없이 동작 중이고, 문서만 갱신이 안 된 상태로 판단됩니다(수정은 이번 단계에서 하지 않음, ⑲에서 별도 제안).

## ③ getThreadSeen 현재 구조 [기존]

- 시트: `댓글확인이력`(컬럼: 이메일/postId/itemId/확인시각). `SHEET_THREAD_SEEN` 상수로 참조.
- `handleGetThreadSeen_(user, body)` (Code.gs 3394행): `getThreadSeenMap_(user.email)`을 호출해 해당 사용자 이메일의 행만 필터링, `{postId}-{itemId}` 키 → 확인시각 문자열로 된 맵을 반환. **다른 시트를 읽지 않고, 다른 헬퍼 함수(`buildFeedEntry_` 등)에 전혀 의존하지 않는 완전히 독립적인 함수입니다.**
- 쓰기 대응 함수 `handleMarkThreadSeen_`(3399행)은 같은 시트에 `LockService`로 보호된 upsert(있으면 확인시각 갱신, 없으면 새 행 추가)를 수행하고 `invalidateSheetCache_`로 캐시를 지웁니다 — 이번 이전 범위에는 포함하지 않고 계속 Apps Script에 둡니다(쓰기이므로 `markChecked`/`updateSettings`와 동일 패턴).
- 캐시: `getSheetValues_`가 Apps Script `CacheService`에 5분간 캐시합니다(요청 간 공유). Cloud Run으로 옮기면 이 5분 캐시가 그대로 따라오지 않으므로 ⑫에서 별도로 다룹니다.
- **프론트엔드 호출**: `feed.html`의 `loadThreadSeenMap()`(2079행)이 **세션(로그인/재로그인) 시점에 딱 한 번**, `proceedAfterAuth()`의 `seenPromise`로 다른 3개 로드(`loadFeed`/`loadIdleTimeoutSetting`/`loadNotifNewPosts`)와 동시에 호출됩니다. 응답의 `seenMap`은 전역 변수 `threadSeenMap`에 저장되고, 이후 화면이 열려 있는 동안은 **서버를 다시 부르지 않고** `hasUnreadReply()`/`hasAwaitingReply()`가 클라이언트에서 이 맵을 참조해 "댓글 필요"/"답변 대기" 표시를 계산합니다. `getSettings`/`whoami`와 같은 "세션당 1회성 조회" 성격입니다.
- 쓰기 반영: `markThreadSeenLocal()`이 스레드를 열거나 알림 클릭으로 이동할 때 로컬 `threadSeenMap`을 먼저 낙관적으로 갱신하고, `callApi('markThreadSeen', ...)`을 fire-and-forget으로 보냅니다. 즉 **읽기(getThreadSeen)와 쓰기(markThreadSeen)가 완전히 분리**되어 있어, 읽기만 Cloud Run으로 옮겨도 쓰기 쪽 로직/시점에 영향이 없습니다.
- **오늘 실측 지연 데이터와의 연결**: 디버그로그에서 `getThreadSeen`이 `getNotifications`에 이어 두 번째로 많이 "delayed/failed" 이벤트를 낸 액션이었습니다(예: `round:0, delayed, elapsedMs:20005`, `round:2, recovered, elapsedMs:50742`). `getThreadSeen`은 세션당 1회만 불리므로 발생 빈도 자체는 `getNotifications`보다 낮지만, 걸리면 로그인/새로고침 직후 화면 전체 로딩(`proceedAfterAuth`)의 일부라서 사용자에게는 "로그인하자마자 느리다"로 느껴질 가능성이 큽니다.

## ④ getThreadSeen Cloud Run 이전 설계 [신규 제안]

**[신규 제안]** `cloud-run/mro-functions/index.js`에 `exports.getThreadSeenTest`를 `getSettingsTest`와 완전히 같은 패턴으로 추가합니다.

1. `req.body.sessionToken` 필수 확인 → 없으면 `400 MISSING_SESSION_TOKEN`.
2. `firestore.collection('sessions').doc(sessionToken).get()` — 없으면 `SESSION_NOT_FOUND`, 만료면 `SESSION_EXPIRED` (기존 `getSettingsTest`/`pollSignalTest`와 동일 로직, **새 인증 체계를 만들지 않음**).
3. `touchSession_(sessionSnap.ref)`로 슬라이딩 연장(기존 함수 그대로 재사용).
4. `session.email`로 `Sheets API values.get`(댓글확인이력 시트, 예: `!A2:D`, `spreadsheets.readonly` 스코프)을 호출.
5. 응답 행 중 이메일이 일치하는 행만 필터링해 `{postId}-{itemId} → 확인시각}` 맵 생성 (Code.gs `getThreadSeenMap_`과 동일 로직).
6. `res.json({ ok: true, serverMs, timings, seenMap })` 반환.

**[신규 제안] 프론트엔드(`feed.html`) 변경**: `CLOUD_RUN_GET_THREADSEEN_URL` 상수를 `getSettings`/`pollSignal`과 동일한 방식으로 추가하고, `loadThreadSeenMap()` 안에서 이 상수가 채워져 있으면 먼저 시도하고, 실패/타임아웃/예외 시 기존 `callApi('getThreadSeen', {})` 경로로 자동 폴백합니다. `callApi`의 `RETRYABLE_API_ACTIONS`에서 `getThreadSeen`을 빼지는 않습니다(폴백 경로 자체의 안전망은 유지).

**주의점(설계 시 반영 필요)**:
- 이메일 대소문자 비교: 기존 `getThreadSeenMap_`은 `.toLowerCase()`로 비교합니다. Cloud Run 포팅 시 동일하게 처리해야 합니다.
- 시트 캐시 없음: Apps Script는 5분 `CacheService` 캐시가 있지만 Cloud Run 함수는 지금까지 전부 "no retry/cache/hedge" 원칙으로 매번 Sheets API를 직접 호출합니다(②의 `pollSignalTest`도 동일). `markThreadSeen`은 Apps Script에 남으므로, 사용자가 스레드를 열자마자(같은 화면 세션 내에서) `getThreadSeen`을 다시 부르는 경우는 없어(세션당 1회 로드) 캐시 없이도 신선도 문제는 생기지 않습니다.
- 응답 필드명(`seenMap`)과 키 형식(`postId-itemId` 문자열)을 Apps Script와 한 글자도 다르지 않게 맞춰야 합니다 — 프론트 `hasUnreadReply`/`hasAwaitingReply`가 이 키 형식에 그대로 의존합니다.

**[추정] 예상 효과**: `getThreadSeen`은 `buildFeedEntry_`처럼 복잡한 판정이 없는 단순 필터링이라 포팅 난이도가 가장 낮고, `getSettingsTest`와 거의 동일한 코드량으로 끝날 것으로 보입니다. 다만 오늘 실측된 지연의 근본 원인(⑧에서 다시 설명하듯 Apps Script Web App 프론트 게이트웨이 구간의 간헐적 지연으로 추정)이 서버 실행 시간이 아니라 네트워크/전달 구간에 있다면, Cloud Run으로 옮겨도 **완전히 사라지지는 않고 빈도만 줄어들 가능성**이 있습니다 — 이는 실제 검증(⑮) 전까지는 추정입니다.

## ⑤ getFeed 현재 구조 [기존]

- `handleGetFeed_(user, body)` (Code.gs 2702행). `body.cursor`(기본 0), `body.limit`(기본 25) — 숫자 오프셋 페이지네이션.
- 설정 시트의 `뉴스피드출력기간`(기본 14일)을 읽어 컷오프 날짜 계산.
- `getAllPosts_`/`getAllItems_`/`getAllComments_`로 시황게시물/품목마스터/댓글 3개 시트를 전부 읽고, 댓글을 postId별로 그룹핑, 각 댓글 작성자의 팀을 `getUserTeam_`으로 (중복 제거 후) 조회.
- 게시물마다 `buildFeedEntry_` 호출 → `null`이면 제외(볼 수 있는 품목이 하나도 없음) → 담당이 아직 미확인인 품목이 있으면(`hasUnconfirmed`) 기간 무관 노출, 아니면 `뉴스피드출력기간` 이내만 노출.
- 최신순 정렬 후 `cursor`~`cursor+limit` 슬라이스, `nextCursor` 계산.
- 응답: `posts`(제목/요약/링크/발행일/작성일/확인건수/전체건수/needsAttention/items), `nextCursor`, `totalNeedsAttention`.
- **프론트 호출**: `feed.html`의 `loadFeed()`/`loadMoreFeed()`. `loadFeed()`는 로그인/세션 복원 시점에 `feedPromise`로 다른 3개 로드와 동시에 실행되고, "무한스크롤 더보기" 시 `loadMoreFeed()`가 추가 호출됩니다.

## ⑥ getNotifications 현재 구조 [기존]

- `handleGetNotifications_(user, body)` (Code.gs 2932행). `getFeed`와 거의 동일하게 3개 시트를 읽고 `buildFeedEntry_`를 게시물마다 호출하지만, **기간 필터가 없고** 전체 게시물을 대상으로 계산합니다.
- 역할이 `담당`이면, 활성 상태인 매니저 목록을 사용자팀마스터에서 미리 뽑아, 각 게시물의 `items`를 "본인이 담당인 품목만" 필터링하고 `confirmedCount`/`totalCount`를 그 필터링된 목록 기준으로 재계산합니다(팀장/임원은 이 필터가 적용되지 않음).
- 최신순 정렬 후 `{postId, materialName, title, summary, createdAt, items, confirmedCount, totalCount, needsAttention}` 배열 반환 — 페이지네이션 없음(전체 반환).
- **프론트 호출**: `feed.html`의 `loadNotifNewPosts()`(2063행). 역시 로그인 시점에 동시 로드(`notifPromise`)되고, `notifNewPostsCache`에 저장되어 알림 배지(`updateNotifBadge`)와 알림함 탭 UI가 이 캐시를 그대로 씁니다. `notifFetchSeq`로 오래된 응답이 최신 응답을 덮어쓰지 않도록 방어합니다.
- **오늘 실측 지연의 핵심 대상**: 디버그로그상 `apiDelay` 이벤트의 압도적 다수가 이 액션이었습니다(20~25초 지연, 최대 70초대 완전 실패).

## ⑦ getPostById 현재 구조 [기존]

- `handleGetPostById_(user, body)` (Code.gs 3033행). `body.postId`로 게시물 하나만 찾아 `buildFeedEntry_` 한 번 호출 → `getFeed`와 동일한 모양(`materialCode`/`link`/`pubDate`/`confirmedCount`/`totalCount`/`needsAttention`/`items`)으로 반환.
- **프론트 호출**: `feed.html` 1524행, 알림함에서 아직 메인 피드에 로드되지 않은 게시물을 클릭해 상세로 이동할 때만 호출됩니다(그 외에는 이미 로드된 `feedState.posts`를 그대로 사용). 호출 빈도가 셋 중 가장 낮습니다(사용자 클릭 이벤트 기반, 폴링성 호출 아님).

## ⑧ 세 API와 pollSignal의 실제 공통 로직 관계 [기존]

`getFeed`/`getNotifications`/`getPostById`/`pollSignal` 4개는 전부 `buildFeedEntry_` 하나를 공유합니다(`getRelatedItems_`로 후보 품목 추리기 → `canViewComment_`로 팀 열람권한 필터링 → 확인여부/댓글수/마지막댓글 계산 → 역할별 `needsAttention` 판단). 차이는 **이 결과를 어떻게 자르느냐**뿐입니다.

- `getFeed`: 기간 필터 + 페이지네이션 + 무거운 필드(제목/요약/링크) 포함
- `getNotifications`: 기간 필터 없음 + 담당 역할 품목 필터 추가 + 무거운 필드 포함
- `getPostById`: 게시물 1개만 + 무거운 필드 포함
- `pollSignal`: 무거운 필드 제외, `{postId,itemId,commentCount,lastCommentAt}` + `totalNeedsAttention`만

`FEED_NOTIFICATIONS_CLOUDRUN_ANALYSIS.md`는 이 4개를 따로따로 옮기면 "배지엔 답변 필요라고 나오는데 피드엔 안 보인다" 같은 불일치가 생길 위험이 있다고 명시적으로 경고하며, 판정 로직(`buildFeedEntry_`)을 한 번만 제대로 포팅해 4개가 재사용하는 방식을 권장합니다. **`pollSignalTest`가 이미 이 판정 로직의 절반(간단 버전: `teamScopeAllows_`/`relatedActiveItems_`/`summarizeItemForPost_`/`needsAttentionFor_`)을 포팅해 12/12 검증까지 마쳤으므로, 이번 2단계는 완전히 새로 시작하는 게 아니라 이 기존 포팅 결과를 확장하는 작업입니다.**

단, `pollSignalTest`의 현재 포팅본은 pollSignal 전용으로 축약되어 있어(제목/요약/링크/발행일 등 무거운 필드 없음, 기간 필터 없음, 페이지네이션 없음, 담당 역할 품목 필터 없음) `getFeed`/`getNotifications`/`getPostById`가 필요로 하는 나머지 부분은 **[신규 제안]**으로 추가해야 합니다.

## ⑨ getFeed+getNotifications+getPostById 공동 이전 아키텍처 [신규 제안]

**설계 원칙**: 판정 로직(누가 이 품목을 볼 수 있는지, 확인/미확인, needsAttention)은 딱 한 곳(공통 엔진)에만 있고, `getFeed`/`getNotifications`/`getPostById`/`pollSignal` 4개 Cloud Run 함수는 이 공통 엔진을 호출해 결과를 다르게 잘라내기만 합니다. Apps Script의 "`buildFeedEntry_` 하나를 4곳이 공유" 구조를 Cloud Run 쪽에도 그대로 재현합니다.

**[신규 제안] 처리 흐름(4개 함수 공통)**:
1. sessionToken → Firestore 세션 인증 → `touchSession_` (기존 패턴 재사용)
2. `values:batchGet`으로 사용자팀마스터/시황게시물/품목마스터/댓글/설정 5개 시트를 한 번에 읽기(이미 `pollSignalTest`가 이 패턴을 씀 — 그대로 재사용)
3. 공통 엔진 `buildFeedEntries_(viewer, allPosts, allItems, allComments, leadScope)` 호출 → 사용자가 볼 수 있는 모든 게시물의 `{post, items, confirmedCount, totalCount, needsAttention}` 배열을 반환
4. 각 함수가 이 배열을 자신의 응답 모양대로 자름:
   - `getFeedTest`: 기간 필터 + `cursor`/`limit` 페이지네이션 적용
   - `getNotificationsTest`: 기간 필터 없음 + (담당이면) 품목 필터 재적용
   - `getPostByIdTest`: `postId` 하나만 찾아서 반환
   - `pollSignalTest`(기존): 무거운 필드 제거 버전 — **가능하면 지금의 축약 로직도 이 공통 엔진 결과에서 필요한 필드만 뽑는 방식으로 다시 정리**(현재는 별도 함수 4개로 로직이 중복 구현되어 있어, 나중에 둘 중 하나만 고치고 다른 쪽을 안 고치는 사고가 날 위험이 있음)

## ⑩ 공통 모듈/파일 구조 제안 [신규 제안, A안/B안 비교]

**현재 존재하는 파일**: `cloud-run/mro-functions/index.js` 하나뿐입니다(①). 이 안에 `teamScopeAllows_`/`relatedActiveItems_`/`summarizeItemForPost_`/`needsAttentionFor_`/`sheetSerialToMs_`가 이미 최상위 함수로 있고(pollSignalTest 전용으로 작성됐지만 `exports.`가 아니라 같은 파일 안의 일반 함수라 다른 `exports.*` 함수도 그냥 호출해서 재사용 가능합니다).

**A안 — index.js 내부에서 공통 함수 확장(파일 구조 변경 없음)**
- 기존 `teamScopeAllows_` 등을 이름은 유지한 채 기능을 넓히거나, 그 옆에 `buildFeedEntries_`(공통 엔진), `paginateFeed_`, `shapeNotification_`, `shapePostDetail_` 같은 새 최상위 함수를 추가.
- 장점: `cloud-run/README.md`에 적힌 "소스 하나 + entry point" 배포 방식과 100% 그대로 맞음. 새 파일을 추가·배포 스크립트를 바꿀 필요가 없음. 지금도 545줄 정도라 4개 함수분 추가해도 크게 부담스러운 크기는 아님.
- 단점: 파일이 계속 길어지면(예: 800줄 이상) 특정 함수를 찾기 어려워짐.

**B안 — `cloud-run/mro-functions/lib/` 신규 모듈 분리**
- 예: `lib/feedEngine.js`(공통 엔진), `lib/sheetsClient.js`(Sheets API 호출 공통화), `lib/auth.js`(Firestore 세션 인증 공통화) 등을 새로 만들고 `index.js`에서 `require`.
- 장점: 역할별로 파일이 나뉘어 있어 "공통 로직이 어디 있는지" 찾기 쉬움 — 특히 비개발자가 나중에 다른 AI에게 이 프로젝트를 맡길 때 파일명만 보고 구조를 짐작하기 좋음(사용자가 원했던 방향).
- 단점: `require`가 걸린 파일들도 배포 시 같이 올라가는지 확인 필요(2nd gen Cloud Functions는 `--source=.` 디렉터리 전체를 업로드하므로 기술적으로는 문제없음). 기존 "소스 하나" 관례에서 벗어나므로 `cloud-run/README.md` 설명도 같이 갱신해야 함.

**[권장, 추정 아님 — 근거 있는 판단]**: B안을 권장합니다. 이유는 (1) 사용자가 명시한 요구사항("비개발자가 나중에 다른 AI에게 맡길 것을 고려해 공통 로직 위치를 명확히")에 A안보다 직접적으로 부합하고, (2) 지금부터 4개 함수(getFeed/getNotifications/getPostById/pollSignal 재정리)가 공통 엔진을 쓰게 되면 index.js가 꽤 커지므로 지금 나누는 비용이 나중에 나누는 비용보다 쌉니다. 다만 이건 **설계 제안이며 최종 결정은 승인 시 다시 확인**받겠습니다.

## ⑪ 인증/Firestore 세션 구조 재사용 방법 [기존 그대로 재사용, 신규 설계 없음]

- Firestore `sessions` 컬렉션(문서ID=sessionToken, 필드 `email`/`createdAt`/`expiresAt`), 6시간 만료 — `cloud-run/README.md`에 이미 문서화되어 있고 `whoamiTest`/`getSettingsTest`/`getTeamManagersTest`/`pollSignalTest`가 전부 이 패턴을 그대로 씁니다.
- Apps Script 로그인 성공 시 `sessionSyncTest`를 호출해 Firestore에도 세션을 이중 쓰기(미러링)합니다.
- `touchSession_(ref)`가 Cloud Run 인증 통과 요청마다 `expiresAt`을 지금+6시간으로 밀어 슬라이딩 연장합니다.
- **getThreadSeen/getFeed/getNotifications/getPostById 전부 이 패턴을 그대로 재사용하면 되고, 새로운 인증 체계는 필요 없습니다.**

## ⑫ Google Sheets 접근 구조 [기존 패턴 재사용 + 신규 설계 일부]

- **[기존]** 모든 Cloud Run 함수는 `GoogleAuth({scopes:['...spreadsheets.readonly']})` → `client.request({url})`로 Sheets API `values.get` 또는 `values:batchGet`을 직접 호출합니다. 캐시/재시도/hedge 없음(주석에 명시).
- **[기존]** `pollSignalTest`는 날짜 셀을 `valueRenderOption=UNFORMATTED_VALUE`로 받아 시리얼 넘버로 처리하고, 스프레드시트 시간대(서울, UTC+9, DST 없음)를 고정 오프셋으로 빼서 실제 UTC ms로 변환합니다(`sheetSerialToMs_`). **getFeed/getNotifications/getPostById도 날짜 비교·정렬(`createdAt`, `lastCommentAt` 등)이 많으므로 이 방식을 그대로 따라야 합니다.** Apps Script의 `getValues()`는 실제 `Date` 객체를 주지만 Sheets API는 그렇지 않다는 차이를 놓치면 정렬/기간 필터가 미묘하게 틀어질 수 있습니다(`POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`가 이미 이 위험을 지적함).
- **[신규 제안, 주의사항]** `getSheetValues_`의 5분 캐시(Apps Script `CacheService`)는 Cloud Run에는 없습니다. `getFeed`/`getNotifications`는 로그인마다 동시에 불리는 무거운 조회라, 캐시 없이 매번 5개 시트를 batchGet하면 Sheets API 호출량이 늘어날 수 있습니다(⑱에서 비용 영향 추정). 캐시를 Cloud Run 쪽에 새로 두려면(예: Firestore에 짧은 TTL로 캐시, 또는 Cloud Run 인메모리 캐시) 이번 설계 범위를 벗어나는 별도 검토가 필요합니다 — 이번 문서에서는 "캐시 없이 우선 이전 후, 실제 API 호출량을 보고 필요시 추가 검토"를 제안합니다.

## ⑬ API endpoint 및 프론트엔드 호출 구조 [신규 제안]

| 함수 | Cloud Run entry point(제안) | 프론트 상수(제안) | 인증 | 메서드 |
|---|---|---|---|---|
| getThreadSeen | `getThreadSeenTest` | `CLOUD_RUN_GET_THREADSEEN_URL` | sessionToken | POST |
| getFeed | `getFeedTest` | `CLOUD_RUN_GET_FEED_URL` | sessionToken | POST (cursor/limit 포함) |
| getNotifications | `getNotificationsTest` | `CLOUD_RUN_GET_NOTIFICATIONS_URL` | sessionToken | POST |
| getPostById | `getPostByIdTest` | `CLOUD_RUN_GET_POSTBYID_URL` | sessionToken | POST (postId 포함) |

프론트엔드 변경은 기존 `getSettings`/`pollSignal` 패턴과 동일합니다 — 상수가 채워져 있으면 먼저 시도, 실패/타임아웃/예외 시 기존 `callApi('getThreadSeen'|'getFeed'|'getNotifications'|'getPostById', ...)` 경로로 자동 폴백. `RETRYABLE_API_ACTIONS`/`showConnDelayNotice_` 등 기존 안전장치는 손대지 않습니다(폴백 경로가 여전히 그 경로를 타므로).

## ⑭ parity 테스트 계획 [신규 제안, 기존 방식 재사용]

`POLLSIGNAL_CLOUDRUN_TEST_PLAN.md`/`POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`의 방식을 그대로 따릅니다.

- **1단계(로직 단위 비교, 실제 데이터 변경 없음)**: 실제 시트 데이터를 읽기만 해서 스냅샷으로 뜨고, Apps Script 편집기에서 `buildFeedEntry_`/`handleGetFeed_`/`handleGetNotifications_`/`handleGetPostById_`/`getThreadSeenMap_`을 직접 함수 호출로 실행 → 같은 스냅샷·같은 `user` 값으로 Cloud Run(JS) 포팅본을 로컬에서 돌려 JSON을 완전히 일치하는지 비교. `pollSignal` 검증 때 만든 12개 시나리오에, `getFeed`의 기간 필터·페이지네이션, `getNotifications`의 담당 품목 필터, `getPostById`의 단건 조회 케이스를 추가합니다.
- **2단계(실제 엔드포인트 통합 테스트, 별도 승인 필요)**: 역할별(담당/팀장/임원/일반) 합성 테스트 계정으로 실제 Cloud Run 엔드포인트까지 end-to-end 확인.
- getThreadSeen은 로직이 단순해 1단계 시나리오가 훨씬 적을 것으로 예상됩니다(이메일 필터링뿐이라 역할 분기 없음).

## ⑮ 실제 운영 데이터 검증 계획 [신규 제안]

- ⑭의 1단계가 끝나면, `getSettings`/`getTeams` 전환 때처럼 **실패 시 자동 폴백**을 켜 둔 채로 먼저 소수 사용자(또는 전체) 트래픽에 노출하고, 프론트 콘솔 로그(`[getSettings] source=cloud-run clientMs=...` 같은 기존 패턴)와 오늘 만든 디버그로그(`apiDelay`) 지표를 함께 관찰합니다.
- 관찰 기준(제안): (1) `source=cloud-run` 비율이 얼마나 되는지(즉 Apps Script로 폴백되는 비율), (2) Cloud Run 경로일 때 `getNotifications`/`getThreadSeen`의 `apiDelay` "delayed/failed" 이벤트가 실제로 줄어드는지. **이건 실제로 배포한 뒤에만 확인 가능한 사항이라 지금은 추정입니다.**

## ⑯ fallback 계획 [기존 패턴 재사용]

기존 `getSettings`/`pollSignal`과 동일: Cloud Run 호출이 실패/타임아웃/예외이면 그 즉시 기존 `callApi('getThreadSeen'|'getFeed'|'getNotifications'|'getPostById', ...)`로 자동 전환합니다. 사용자가 별도로 뭘 할 필요 없이 항상 동작은 보장됩니다.

## ⑰ 장애 발생 시 롤백 방법 [기존 패턴 재사용]

`cloud-run/README.md`에 이미 정리된 방법 그대로 재사용합니다.

- **즉시 롤백(가장 흔함)**: `feed.html`의 해당 `CLOUD_RUN_..._URL` 상수를 빈 문자열로 바꾸면 그 즉시 100% Apps Script 경로로 돌아갑니다.
- **리비전 롤백**: Cloud Run 콘솔 "리비전" 탭에서 이전 리비전으로 트래픽 이동.
- **소스 롤백**: 저장소의 이전 커밋 `index.js`로 되돌려 재배포.

## ⑱ 예상 비용 및 Cloud Run/Firestore 사용량 영향 [추정 — 검증되지 않음]

저장소에 비용 관련 기존 문서가 없어 이 항목은 전부 추정입니다.

- Cloud Run 2nd gen은 요청 수·CPU/메모리 사용 시간 기준 과금이며, 이미 운영 중인 `getTeamsTest`/`getSettingsTest`/`pollSignalTest`가 무료 티어(월 200만 요청 등) 안에서 큰 비용 없이 동작하고 있다고 추정됩니다(실제 청구서를 확인한 것은 아님).
- `getFeed`/`getNotifications`는 로그인마다 5개 시트 batchGet을 새로 호출하게 되므로, **Sheets API 호출 횟수가 늘어날 가능성**이 있습니다 — Sheets API 자체는 무료(할당량 기반)이지만 분당 요청 제한(기본 300회/분/프로젝트)에 근접할 가능성은 실제 동시 접속자 수를 보고 판단해야 합니다(추정, 검증 필요).
- Firestore는 세션 조회(`get`)만 발생하고 쓰기는 로그인 1회뿐이라 이번 4개 API 추가로 인한 증가분은 미미할 것으로 추정됩니다.
- **결론(추정)**: 비용 영향은 크지 않을 것으로 보이나, 실제 수치는 배포 후 Cloud Run/Firestore 콘솔의 사용량 대시보드로 확인해야 확정할 수 있습니다.

## ⑲ 3단계 이후 남은 API와 우선순위 [기존 자료 기반 + 신규 우선순위 제안]

`README.md` API 매핑표 기준, 이번 1·2단계 이후에도 Apps Script에 남는 읽기 API:

| API | 호출 빈도(체감) | 오늘 지연 문제 확인됨? | 이전 난이도 | 공통 로직 의존 | 기대 효과 |
|---|---|---|---|---|---|
| `getComments` | 스레드를 열 때마다 | 확인 안 됨(오늘 디버그로그엔 없었음) | 낮음(순수 읽기, `canViewComment_`만 의존) | 낮음 | 중간 — README에 "향후 후보"로 이미 언급됨(`POSTCOMMENT_CLOUDRUN_ANALYSIS.md`) |
| `getCustomers`, `getItems`, `getUsers` | 품목/고객사 관리 화면 진입 시 | 확인 안 됨 | 낮음(단순 시트 읽기) | 없음 | 낮음(관리 화면 전용, 트래픽 낮음) |
| `suggestMaterials` | 품목 등록 폼 입력 시 | 확인 안 됨 | 낮음 | 없음 | 낮음 |
| `getUsers` 등 나머지 조회성 action | 다양 | 확인 안 됨 | 낮음 | 없음 | 낮음 |

**우선순위 제안(추정 포함)**: `getComments`가 다음 후보로 적절해 보입니다 — 이미 별도 분석 문서(`POSTCOMMENT_CLOUDRUN_ANALYSIS.md`)에서 "조회만은 이전 가능성 있음"으로 언급돼 있고, `canViewComment_` 하나에만 의존해 포팅 부담이 적습니다. 나머지(고객사/품목/사용자 관리 화면 조회)는 오늘 지연 데이터에도 등장하지 않았고 트래픽도 낮아 후순위로 판단합니다.

**[별도 제안, 문서 갱신]**: ①·②에서 발견한 문서 오차(cloud-run/README.md의 "8개 함수" 표기, README.md API 매핑표의 pollSignal 상태)는 이번 코드 작업과 무관하게 낮은 리스크로 바로 고칠 수 있는 항목입니다. 다만 지시대로 이번 단계에서는 문서도 수정하지 않았고, 필요하면 별도로 승인받아 진행하겠습니다.

## ⑳ 최종 권장 작업 순서 [제안]

1. **(승인 대기) 1단계**: `getThreadSeenTest` 구현 → ⑭ 1단계 로직 비교(가상 데이터, 실제 데이터 변경 없음) → 통과 시 2단계 통합 테스트 별도 승인 요청 → `feed.html` 폴백 배선 → 소수 트래픽 관찰.
2. **(1단계 안정화 후) 2단계**: 공통 엔진(⑨) 설계를 B안(⑩) 구조로 먼저 만들고, `pollSignalTest`를 이 엔진을 쓰도록 리팩터링(기존 12/12 검증 결과가 깨지지 않는지 재확인) → 이 엔진 위에 `getFeedTest`/`getNotificationsTest`/`getPostByIdTest` 순서로 얹기 → 4개 API 결과가 서로 불일치하지 않는지(⑧의 우려) 집중 검증.
3. **3단계**: `getComments` 조회 전용 이전을 다음 분석 대상으로 검토(이번엔 실제 구현 아님, 검토만).
4. 매 단계 실제 코드 작업 전, 이 문서와 같은 형식의 분석·설계를 다시 보여드리고 승인받습니다.

---

**요약**: 챗지피티가 언급한 구체 파일 경로는 실제로 존재하지 않지만, 방향 자체(getThreadSeen 먼저, getFeed+getNotifications+getPostById는 함께)는 이번에 확인한 실제 코드·기존 분석 문서·오늘 실측 지연 데이터와 잘 맞습니다. 이번 문서에서 코드/배포/커밋은 전혀 진행하지 않았습니다. 검토 후 알려주시면, 승인된 범위만 실제 구현에 들어가겠습니다.
