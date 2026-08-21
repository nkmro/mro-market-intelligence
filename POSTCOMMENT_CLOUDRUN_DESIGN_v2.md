# postComment Cloud Run 이전 — 상세 설계 (승인 범위: 설계 확정까지, 코드/커밋/배포 없음)

작성일: 2026-08-21 (2026-08-21 최종 확정 반영)
상태: **분석·설계 전용 문서. 코드 작성, 기존 코드 수정, 새 소스 파일 생성, GitHub 커밋, Cloud Run 배포, Apps Script 배포, Sheets/Firestore 구조 변경, 권한 변경, README 수정 — 전부 하지 않았습니다.**
승인된 폴백 정책(3-1/3-2/3-3)을 그대로 반영해 설계를 구체화했습니다.

> **2026-08-21 확정**: 이 문서 전체(2번 함수 설계, 3번 폴백 정책, 4번 idempotency, 5번 Firestore, 6번 권한)가 승인되었습니다. 실제 코드 작성/커밋/배포는 이번 승인 범위에 포함되지 않으며, 다음 세션에서 별도 승인 후 진행합니다. 11번의 "아직 결정 안 된 것" 5개 항목에 대한 최종 결정은 11번 섹션에 반영했습니다.
근거: `apps-script/Code.gs`(197행 디스패처, 588~677행 canViewComment_/jsonResponse_/withIdempotency_, 2134~2650행 findPost_~buildFeedEntry_ 일대, 308~326행 authenticateRequest_, 546~566행 findUser_), `feed.html`(560~731행 IDEMPOTENT_WRITE_ACTIONS/callApi/hedgedFetch_, 1881~1942행 submitComment, 2321~2359행 markThreadSeenRemote_ — 참고 패턴), `cloud-run/mro-functions/index.js`(전체, 특히 642~801행 getCommentsTest/getThreadSeenTest/markThreadSeenTest), `cloud-run/mro-functions/lib/{auth,sheetsClient,feedEngine,writeIdempotency}.js` 전부 이번에 직접 다시 읽고 대조했습니다.

---

## 1. 현재 Apps Script `postComment` 구조 (요청하신 항목별 확인)

### 1-1. 전체 흐름 (`handlePostComment_`, Code.gs 2269~2370행)

1. `user.role === '일반'` → `FORBIDDEN_VIEWER`.
2. `postId`/`content` 필수 → 없으면 `MISSING_FIELDS`.
3. `findPost_(postId)`로 게시물 존재 확인 → 없으면 `POST_NOT_FOUND`.
4. `itemId`가 있으면:
   - 그 품목에 첫 댓글이면, 작성자가 `담당` 역할 + `isManagerForItem_`(그 품목의 담당소장) 확인 → 아니면 `FIRST_COMMENT_MANAGER_ONLY` / `NOT_ASSIGNED_MANAGER`. 첫 댓글은 답글일 수 없음 → `FIRST_COMMENT_CANNOT_HAVE_PARENT`.
   - 이미 댓글이 있으면 자유롭게 답글 가능. `parentCommentId`가 있으면 존재 확인 → `PARENT_COMMENT_NOT_FOUND`.
5. `itemId`가 없는 일반 댓글은, 이 게시물에 확인된 품목이 하나도 없으면 → `NO_CONFIRMED_ITEM_YET`.
6. `commentId = Utilities.getUuid()`, `now = new Date()`로 `appendComment_([commentId, postId, itemId, user.email, user.name, user.role, parentCommentId, content, now])` — `댓글` 시트에 새 행 추가, 캐시 무효화.
7. 갱신된 댓글 목록(`visibleComments`, 열람권한 필터+정렬)과 이 게시물의 최신 `buildFeedEntry_` 결과(`updatedPost`)를 함께 반환 — 프론트가 등록 후 별도 재조회를 안 해도 되게 하는 성능 최적화.
8. 이 전체가 디스패처 197행에서 `withIdempotency_(body.idempotencyKey, ...)`로 감싸져 있음 — 같은 키 재요청은 1~7을 다시 실행하지 않고 캐시된 응답을 그대로 반환.

### 1-2. 항목별 확인

| 확인 항목 | 현재 Apps Script 동작 |
|---|---|
| **댓글 작성 권한** | `역할` 기준: `일반`은 전면 금지. `담당`은 자기 담당 품목의 첫 댓글만 가능(다른 품목 첫 댓글은 금지). 첫 댓글 이후엔 `담당`/`팀장`/`임원` 모두 자유롭게 답글. |
| **세션 인증** | `authenticateRequest_`(Code.gs 308행): `body.sessionToken` → `CacheService`의 `session_<token>` 키로 이메일 조회 → 있으면 슬라이딩 연장(21600초) → `findUser_`(또는 캐시)로 사용자 레코드 조회 → `status !== '활성'`이면 거부. **Apps Script의 세션 소스는 CacheService이고, Cloud Run 쪽 세션 소스는 Firestore `sessions` 컬렉션입니다 — 이 둘은 로그인 시 `sessionSyncTest`로 한쪽(Apps Script)에서 다른 쪽(Firestore)으로 미러링되는 관계이며, 이미 getSettingsTest/getCommentsTest 등 여러 함수가 이 Firestore 세션을 신뢰하고 있으므로 postComment도 동일하게 신뢰할 수 있습니다.** |
| **사용자 식별** | `findUser_(email)`로 `사용자팀마스터` 시트에서 `email/name/role/team/status` 조회(대소문자/공백 무시 매칭). |
| **게시물/품목 식별** | `findPost_(postId)`(시황게시물 시트), `getItemById_(itemId)`(품목마스터 시트, `isManagerForItem_`가 사용). |
| **댓글 시트 쓰기** | `appendComment_`(2180행) — `SpreadsheetApp`으로 `댓글` 시트에 `sheet.appendRow(row)` 한 줄 추가 + `invalidateSheetCache_`. |
| **작성일시 처리** | `now = new Date()`(Apps Script 서버 시각, 스프레드시트 시간대 기준 Date 셀에 그대로 저장). |
| **작성자 정보 처리** | `user.email`, `user.name`, `user.role`을 댓글 행에 그대로 저장(당시 세션의 이름/역할을 "스냅샷"으로 남김 — 나중에 사용자 이름/역할이 바뀌어도 과거 댓글에는 작성 당시 값이 남음). |
| **기존 댓글 구조** | `댓글` 시트 컬럼: `commentId(A), postId(B), itemId(C), authorEmail(D), authorName(E), authorRole(F), parentCommentId(G), content(H), createdAt(I)`. |
| **후속 처리** | 응답에 갱신된 댓글 목록 + `updatedPost`(품목별 confirmed/commentCount/lastComment, `needsAttention`)를 함께 포함 — 프론트가 이걸로 피드/알림 배지를 즉시 갱신, 추가 API 호출 없음. |
| **다른 기능에 미치는 영향** | (a) `getFeed`/`pollSignal`의 `needsAttention`/`confirmedCount` 계산이 이 시트를 읽으므로, 새 댓글이 즉시 그 계산에 반영됨. (b) `updateComment`/`deleteComment`도 같은 `buildCommentUpdateResponse_` 헬퍼를 공유하므로 응답 모양이 동일. (c) `markThreadSeen`과는 직접적인 데이터 의존은 없지만, "답변 필요" 배지 로직(`hasAwaitingReply`, feed.html 2317행)이 댓글의 `authorEmail`/`createdAt`을 참조함. |

---

## 2. Cloud Run `postCommentTest` 함수 설계

### 2-1. 인증/사용자 식별 — 기존 것 재사용

- `lib/auth.js`의 `authenticateSession(firestore, sessionToken)`를 그대로 재사용(getCommentsTest/markThreadSeenTest와 동일 패턴). 별도 인증 로직을 새로 만들지 않습니다.
- 사용자의 `role`/`team`/`name`은 세션(이메일)만으로는 부족하므로, `lib/sheetsClient.js`의 `getSheetsClient()` + `batchGetValues()` + `rowsToUsers()`로 `사용자팀마스터`를 읽고, `lib/feedEngine.js`의 `findViewer(allUsers, email)`로 조회 — **getCommentsTest가 이미 쓰고 있는 것과 완전히 동일한 조합**이라 새로 만들 필요가 없습니다.

### 2-2. 게시물/품목 식별, 권한 로직 — 포팅 필요(신규 작성 대상)하지만 재료는 이미 있음

- `findPost_` 대응: `rowsToPosts()`로 이미 읽어온 `시황게시물` 배열에서 `postId`로 찾는 순수 함수 — `getPostByIdTest`가 이미 유사한 조회를 하고 있어 그 패턴을 그대로 가져다 쓸 수 있습니다.
- `isManagerForItem_` 대응: `rowsToItems()`로 읽은 `품목마스터`에서 `itemId`로 찾아 `manager === user.name` && `post.materialName`이 `item.materials`에 포함되는지 확인 — Apps Script와 동일한 순수 비교 로직이라 신규 작성이지만 로직 자체는 이미 문서화되어 있어 그대로 옮기면 됩니다.
- **이 부분(권한 게이트: `FIRST_COMMENT_MANAGER_ONLY`/`NOT_ASSIGNED_MANAGER`/`FIRST_COMMENT_CANNOT_HAVE_PARENT`/`PARENT_COMMENT_NOT_FOUND`/`NO_CONFIRMED_ITEM_YET`)는 `lib/feedEngine.js`에 아직 없는 postComment 전용 로직입니다.** 재사용 가능한 것은 데이터 읽기(시트 파싱)뿐이고, 권한 판단 자체는 새로 포팅해야 합니다 — 다만 이건 "새 모듈 설계"가 아니라 "이미 Code.gs에 있는 판단을 그대로 옮기는 것"이라 설계 리스크는 낮습니다.

### 2-3. `updatedPost` 재계산 — 완전히 재사용 가능

- `buildFeedEntry_`는 이미 `lib/feedEngine.js`의 `buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail)`로 포팅되어 있고, getFeedTest/getNotificationsTest/pollSignalTest가 이미 실전에서 검증한 함수입니다. **postComment의 `updatedPost` 계산은 이 함수를 그대로 호출하면 됩니다 — 새로 만들 필요가 전혀 없습니다.**
- 댓글 목록(`visibleComments`) 응답도 `lib/feedEngine.js`의 `visibleCommentsForPost(...)`(getCommentsTest가 이미 사용 중)를 그대로 재사용 가능합니다.

### 2-4. 시트 쓰기 — 신규 작성 필요 (기존에 append 패턴이 없음)

- 지금까지 배포된 Cloud Run 함수 중 시트에 **쓰는** 함수는 `markThreadSeenTest` 하나뿐이고, 그 함수는 "찾아서 update 또는 없으면 append"(upsert)입니다. `values.append`(Sheets API `POST .../values/{range}:append`) 자체를 쓰는 코드는 아직 없어서, 이 부분만큼은 이번에 **신규로 작성**해야 합니다.
- 방식: `markThreadSeenAction_`과 동일하게 이 함수 안에서만 `new GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']})`(쓰기 스코프)를 만들고, `POST https://sheets.googleapis.com/v4/spreadsheets/{SPREADSHEET_ID}/values/댓글!A:I:append?valueInputOption=RAW`로 한 행을 추가하는 방식을 제안합니다. `commentId`는 Node.js `crypto.randomUUID()`(Apps Script `Utilities.getUuid()`와 동등한 v4 UUID)로 생성.

### 2-5. 전체 흐름 초안 (구현 시 이 순서를 따를 것을 제안 — 아직 작성 안 함)

```
exports.postCommentTest = async (req, res) => {
  1. authenticateSession(firestore, sessionToken)  // lib/auth.js 재사용
  2. postId/content 필수 체크 -> MISSING_FIELDS
  3. withIdempotency(firestore, idempotencyKey, 'postComment', async () => {
       a. batchGetValues로 사용자/게시물/품목/댓글/설정 한 번에 읽기 (getCommentsTest와 동일 패턴)
       b. findViewer, role==='일반' 체크 -> FORBIDDEN_VIEWER
       c. findPost_ 대응 -> POST_NOT_FOUND
       d. 첫 댓글/답글 권한 게이트 (2-2) -> 각 에러 코드
       e. Sheets API append (2-4)
       f. feedEngine.buildFeedEntry + visibleCommentsForPost로 응답 재계산 (2-3)
       g. { ok:true, commentId, comments, updatedPost } 반환
     })
  4. 위 result를 그대로 res.status(200).json(...)
}
```

---

## 3. 폴백 정책 (승인된 3-1/3-2/3-3을 응답 구조로 구체화)

### 3-1. 명확한 사전 실패 → Apps Script 폴백 허용

Cloud Run이 **시트에 쓰기 시도를 하지 않았다는 것이 확실한** 경우만 포함합니다.

- 클라이언트가 `fetch` 자체를 실패(DNS/연결 거부/CORS) — `catch` 블록에서 응답을 아예 못 받은 경우.
- Cloud Run이 **즉시(권한/입력 검증 단계에서) 4xx 계열 에러**를 반환한 경우 — `MISSING_FIELDS`, `FORBIDDEN_VIEWER`, `POST_NOT_FOUND`, `FIRST_COMMENT_MANAGER_ONLY`, `NOT_ASSIGNED_MANAGER`, `FIRST_COMMENT_CANNOT_HAVE_PARENT`, `PARENT_COMMENT_NOT_FOUND`, `NO_CONFIRMED_ITEM_YET`, 인증 실패(`SESSION_NOT_FOUND`/`SESSION_EXPIRED`/`MISSING_SESSION_TOKEN`). 이 응답들은 2-5의 (e) append 단계 **이전**에만 발생할 수 있는 코드이므로, 이 코드가 왔다는 것 자체가 "시트에 쓰지 않았다"는 증거입니다.
  - **주의**: 이 경우도 "그대로 Apps Script로 재요청"이 아니라, **그 에러를 그대로 사용자에게 보여주는 것**을 우선 제안합니다(설계 문서 초안 2-3의 원래 취지와 동일). Cloud Run이 정확히 판단해서 거부한 요청을 Apps Script가 혹시 다르게 판단해 통과시키면 오히려 불일치가 생길 수 있기 때문입니다. 다만 "Cloud Run 자체 배포/네트워크 문제로 이 4xx를 못 믿을 수 있는 경우"(예: 아주 드문 서버 자체 버그)에 대한 안전망으로 Apps Script 재확인을 허용할지는 4xx 에러 코드별로 나눠 다음 단계에서 결정할 수 있습니다.

### 3-2. 애매한 실패 → 조용히 폴백하지 않음

타임아웃, 응답 유실, connection reset, 5xx, "Cloud Run이 처리했을 수도 있는데 클라이언트가 확인 못 한" 모든 경우입니다.

- **1차 대응**: 같은 `idempotencyKey`로 **Cloud Run 자신에게 재시도**(`postCommentTest`를 다시 호출). `withIdempotency`가 이미 `DONE` 문서를 찾으면 시트에 다시 쓰지 않고 캐시된 성공 응답을 그대로 돌려주므로, 먼저 보낸 요청이 실제로는 성공했던 경우 이 재시도로 "정상 등록됨"을 안전하게 확인할 수 있습니다.
- 재시도 횟수는 markThreadSeen 때와 다르게(그쪽은 자동 재시도가 없었음) **명시적으로 1~2회** 정도로 제한할 것을 제안합니다(무한 재시도는 사용자를 오래 기다리게 함).
- 재시도까지 계속 애매하게 실패하면 3-3으로 넘어갑니다.

### 3-3. 최종 실패 → 사용자에게 확인/재시도 유도, 자동 재전송 금지

- Apps Script로 자동으로 넘기지 않습니다(핵심 변경점).
- 화면에는 (제안) "댓글 등록 여부를 확인할 수 없습니다. 새로고침 후 댓글이 등록됐는지 확인해주세요. 등록되지 않았다면 다시 시도해주세요." 같은 안내와 함께, **낙관적으로 추가해둔 임시 댓글(현재 `submitComment`의 `optimisticComment`/`tempId` 패턴)을 "확인 필요" 상태로 표시**(삭제하지 않고 회색 처리 등)하는 것을 제안합니다 — 지금처럼 실패 시 임시 댓글을 지워버리면, 실제로는 등록된 댓글이 사용자 눈에는 사라진 것처럼 보여 다시 시도해 중복을 유발할 수 있기 때문입니다(이 UI 변경은 feed.html 구현 단계에서 다룰 사항이며 이번엔 설계만).
- 사용자가 "다시 시도"를 누르면 **같은 `idempotencyKey`로 다시 Cloud Run에 요청**(새 키를 만들지 않음)해야 진짜 중복을 막을 수 있습니다 — 이 부분이 구현 시 가장 실수하기 쉬운 지점이라 명시해둡니다.

### 3-4. 오류 코드/응답 구조 분류 (10번 항목 "오류 코드 체계"/"응답 구조" 관련)

Cloud Run 응답에 **fallback 판단용 최상위 필드**를 추가하는 것을 제안합니다(Apps Script 응답 모양은 그대로 유지하고, 그 위에 몇 개 필드만 덧붙이는 방식 — 프론트가 이미 `res.comments`/`res.updatedPost`를 그대로 쓰므로 기존 필드는 손대지 않음):

```
성공:        { ok: true, commentId, comments, updatedPost }
사전 실패:    { ok: false, error: '<코드>' }              // 3-1 — Apps Script 폴백 또는 그대로 표시
애매한 실패:  (HTTP 레벨 타임아웃/5xx/네트워크 예외 — JSON 자체가 안 옴)  // 3-2 — 클라이언트가 판단
```

Cloud Run이 "명확한 사전 실패"와 "애매한 실패"를 구분해서 알려줄 필요는 없습니다 — 클라이언트가 **정상적인 JSON 응답을 받았는지 여부**로 이미 구분되기 때문입니다(JSON 응답을 받았다면 그 자체로 "서버가 최소한 검증 단계까지는 도달했다"는 뜻이라 사전 실패 범주, 응답을 못 받았다면 애매한 실패 범주). 별도의 오류 코드 체계를 새로 만들 필요가 없다는 것이 이번 설계의 결론입니다.

---

## 4. 댓글 중복 등록 방지(idempotency) — 8개 항목 분석

### 4-1. 현재 사용 가능한 고유 식별값이 있는가

있습니다. `feed.html`의 `IDEMPOTENT_WRITE_ACTIONS`(605행)에 `postComment`가 이미 포함되어 있어, `callApi('postComment', ...)`가 매 요청에 클라이언트 생성 `idempotencyKey`(UUID)를 자동으로 붙입니다(691행). **재요청 라운드 안에서는 같은 키를 재사용**합니다(`callApi` 내부에서 `requestBody`를 한 번만 만들고 재시도 루프에서 그대로 다시 씀, 698~715행).

### 4-2. 기존 댓글 데이터에 댓글 ID가 있는가

있습니다. `commentId`(`Utilities.getUuid()`)가 매 댓글마다 서버에서 생성되어 시트 A열에 저장됩니다. 다만 이 `commentId`는 **요청의 idempotencyKey가 아니라 "그 요청이 성공하면 만들어지는 결과물"**입니다 — 같은 논리적 요청이 두 번 성공하면 서로 다른 두 개의 `commentId`가 생기므로, `commentId`만으로는 중복을 막을 수 없습니다(이게 바로 "dedup 키가 없다"고 옛 문서가 잘못 판단했던 지점이기도 합니다 — `commentId`는 dedup 키가 아니라 그냥 각 댓글의 고유 ID).

### 4-3. 기존 데이터 구조로 중복 판단이 가능한가

`댓글` 시트 자체(9개 컬럼: commentId/postId/itemId/authorEmail/authorName/authorRole/parentCommentId/content/createdAt)에는 "이 idempotencyKey로 이미 기록됐는지"를 판단할 컬럼이 없습니다. 이론적으로는 "같은 이메일+같은 postId+같은 itemId+같은 content가 아주 짧은 시간 안에 또 들어오면 중복으로 간주" 같은 휴리스틱을 시트 데이터만으로 만들 수는 있지만, 정상적으로 같은 내용의 댓글을 의도적으로 두 번 쓰는 경우(예: 오타 수정 후 다시 같은 말을 반복)와 구분이 애매해 **신뢰할 수 없는 방법**입니다. → 기존 데이터 구조만으로는 부족합니다.

### 4-4. 별도의 idempotency key가 필요한가

네, 필요합니다. 다만 "새로 추가"가 아니라 **이미 있는 것(4-1의 `idempotencyKey`)을 Cloud Run 쪽 저장소(Firestore)에 기록하는 것**만 필요합니다 — 즉 클라이언트/프로토콜 레벨 변경은 없고, 서버(Cloud Run) 내부 구현만 필요합니다.

### 4-5. idempotency key를 어디서 생성하는 게 적절한가

**지금처럼 `feed.html`에서 생성하는 것을 그대로 유지**하는 것을 제안합니다.
- Cloud Run에서 생성: 클라이언트가 재시도할 때마다 새 키를 만들게 되면 dedup 자체가 무의미해집니다(애초에 재시도 간 같은 키 유지가 핵심).
- Apps Script에서 생성: 마찬가지로 클라이언트가 "이번 논리적 요청"을 대표하는 키를 쥐고 있어야 Cloud Run 시도와 Apps Script 시도(3-1의 사전 실패 폴백) 양쪽에 같은 키를 실어 보낼 수 있으므로, 서버가 생성하는 방식은 이 요구를 못 만족시킵니다.
- **결론**: 현재 구조(클라이언트 생성, 요청 전체에 걸쳐 재사용)가 이미 정답이고, 바꿀 필요가 없습니다.

### 4-6. 동일 요청이 두 번 도착했을 때 한 번만 저장하는 방법

`lib/writeIdempotency.js`의 `withIdempotency(firestore, idempotencyKey, action, actionFn)`를 그대로 재사용합니다(1번 검토에서 이미 확인 — 수정 없이 재사용 가능). Firestore 트랜잭션으로 "문서 없음 → IN_PROGRESS 선점 → 실행 → DONE" 흐름을 원자적으로 보장하므로, 동시에 두 요청이 도착해도 한쪽만 실제로 `appendComment_` 상당 로직을 실행하고 다른 쪽은 첫 번째 결과를 기다렸다가 그대로 받습니다.

### 4-7. Cloud Run 저장 성공 후 응답 유실 시 안전한 재조회/확인 방법

3-2에서 설명한 대로, **같은 idempotencyKey로 Cloud Run에 재요청**하면 `withIdempotency`가 `writeIdempotency/{key}` 문서를 조회해 이미 `DONE`이면 실제 시트에 다시 쓰지 않고 캐시된 응답(성공 시의 `commentId`/`comments`/`updatedPost` 포함)을 그대로 돌려줍니다 — 이것이 "안전한 재조회"의 실체입니다. 별도의 "시트를 다시 스캔해서 내가 쓴 댓글이 있는지 찾는" 로직은 필요 없습니다(그런 스캔은 오히려 판단 기준이 모호해서 더 위험합니다).

### 4-8. Apps Script fallback을 허용할 수 있는 정확한 조건

3-1/3-4에서 정리한 대로: **Cloud Run으로부터 정상적인 JSON 응답을 받았고, 그 응답이 `appendComment_` 상당 로직(2-5의 (e) 단계) 이전에 결정된 에러 코드인 경우만.** 그 외(응답을 못 받음, 5xx, 타임아웃)는 전부 Apps Script로 넘기지 않고 3-2/3-3의 Cloud Run 자체 재시도 → 사용자 확인 유도로 처리합니다.

### 4-9. 기존 데이터 구조 변경 여부 — 변경 불필요

이번 설계는 `댓글` 시트에 새 컬럼을 추가하지 않고, Firestore에도 `writeIdempotency`(markThreadSeen 때 이미 만든 컬렉션, 스키마 변경 없음) 하나만 그대로 재사용합니다. **Firestore 신규 컬렉션이나 Sheets 컬럼 추가가 필요 없다는 것이 이번 검토의 결론입니다.**

---

## 5. Firestore 1MiB 제한 관련 확인 (직접 확인한 결과)

### 5-1. postComment 응답이 실제로 Firestore에 저장되는가 — 예, 저장됩니다

2-5/4-6에서 제안한 대로 `postCommentTest`를 `withIdempotency(...)`로 감싸면, 이 모듈의 실제 구현(`lib/writeIdempotency.js` 69~72행)이 `actionFn()`의 반환값 전체를 `docRef.update({status:'DONE', response: result})`로 Firestore 문서 필드에 그대로 저장합니다. **즉 "Firestore에 저장되는 구조인지"에 대한 답은 명확히 "예"이고, 1MiB 제한은 실제로 고려 대상입니다.** (markThreadSeenTest는 응답이 `{ok:true}` 하나뿐이라 이 제한이 사실상 무의미했지만, postComment는 `comments`/`updatedPost`를 포함하므로 사정이 다릅니다.)

### 5-2. 실제 크기 추정

- 댓글 1건의 필드 크기: `commentId`(UUID, 36자) + `postId`/`itemId`(짧은 문자열) + `authorEmail`/`authorName`/`authorRole` + `parentCommentId` + `content`(한글 텍스트, 대부분 수십~수백 자로 추정) + `createdAt`. JSON으로 직렬화 시 댓글 1건당 대략 300~800바이트 정도로 추정됩니다(content 길이에 따라 변동).
- `comments` 배열은 "그 게시물 전체의 열람 가능한 댓글"이므로, 게시물당 댓글 수에 비례합니다. 지금까지 확인한 실제 운영 데이터 패턴(markThreadSeen parity 테스트 때 읽어본 실제 시트 스냅샷 기준)으로 보면 게시물 하나에 댓글이 수십 건을 넘는 경우는 드물어 보이지만, **이번 세션에서 실제 `댓글` 시트 전체 건수/게시물별 최대 건수를 정확히 재확인하지는 않았습니다** — 실제 구현 승인 시 `getCommentsTest`로 몇 개 게시물을 조회해 실측하는 것을 권장합니다.
- `updatedPost`는 그 게시물의 "열람 가능한 품목들" 요약(품목별 confirmed/commentCount/lastComment + 댓글 배열 포함, `feedEngine.summarizeItemFull` 참고)이라 `comments`와 상당 부분 중복된 정보를 담습니다.
- 결론(추정): 일반적인 게시물이라면 전체 응답이 1MiB에 크게 못 미칠 것으로 보이나(수십 KB 수준 추정), 댓글이 매우 많이 쌓이는 예외적인 게시물이 있다면 이론적으로 커질 수 있어 **치명적 문제는 아니지만 "확인해볼 가치가 있는" 항목**으로 남겨둡니다.

### 5-3. 응답에 불필요한 전체 목록이 포함되는가

Apps Script 원본과 동일하게 "이 게시물 하나"의 댓글/피드 정보만 포함하며, 전체 게시물 목록이나 다른 게시물의 댓글은 포함하지 않습니다 — 불필요하게 큰 데이터를 담고 있지는 않습니다(원본 설계 자체가 이미 "이 요청과 관련된 것만" 최소화되어 있음).

### 5-4. 기존 설계의 Firestore 역할과 충돌 여부

충돌 없습니다. `writeIdempotency` 컬렉션은 원래도 "actionFn의 반환값을 그대로 캐시"하는 범용 목적으로 설계됐고(1번 검토), `sessions` 컬렉션과는 별개의 컬렉션이라 역할이 겹치지 않습니다.

### 5-5. 완화 방안(필요시, 이번엔 결정하지 않음)

만약 실측 결과 특정 게시물의 응답이 크다고 판단되면: (a) `writeIdempotency` 캐시에는 `commentId`만 저장하고, 재조회 시(4-7) `comments`/`updatedPost`는 캐시가 아니라 그 시점에 다시 계산해서 반환하는 방식으로 캐시 크기를 줄일 수 있습니다. 다만 이렇게 하면 "캐시된 응답 = 최초 실행 결과와 100% 동일"이라는 단순한 보장이 깨지므로(재계산 시점에 다른 댓글이 더 추가돼 있으면 값이 달라짐), 신중히 결정해야 하는 트레이드오프입니다. 이번엔 채택 여부를 결정하지 않고 대안으로만 기록합니다.

---

## 6. Google Sheets 쓰기 권한 확인 (실제 코드/구조 기준, 변경 없이 확인만)

1. **댓글 시트가 markThreadSeen과 같은 문서인가**: 예, 같습니다. `cloud-run/mro-functions/index.js`의 `SPREADSHEET_ID`(25행, `'1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU'`)는 모든 Cloud Run 함수(getThreadSeenTest, markThreadSeenTest, getCommentsTest 등)가 공유하는 **하나의 스프레드시트 ID**이며, `댓글확인이력`(markThreadSeen 대상)과 `댓글`(postComment 대상)은 같은 문서 안의 서로 다른 탭(시트)입니다. Google Sheets의 "공유" 권한은 **문서 단위**로 적용되므로, markThreadSeen 이전 때 편집자로 공유 완료한 서비스 계정(`771006650918-compute@developer.gserviceaccount.com`)이 **이미 `댓글` 탭에도 쓰기 권한을 갖고 있습니다.**
2. **서비스 계정이 실제 쓰기 권한을 가지고 있는가**: 위 1의 결론에 따라, 문서 레벨 공유는 이미 충족되어 있습니다. 코드 레벨에서는 `markThreadSeenAction_`이 이미 `spreadsheets`(읽기+쓰기) 스코프로 실제 쓰기(`values.update` 상당)에 성공했음이 스모크 테스트로 확인된 상태라, 같은 서비스 계정·같은 스코프로 `댓글` 탭에 append도 가능할 것으로 판단됩니다(다만 append 자체는 이번에 처음 시도하는 호출 형태라, 실제 구현 시 최소 트래픽으로 한 번 더 확인하는 것을 권장).
3. **기존 getSettings/getThreadSeen과 접근 방식이 같은가**: 읽기 부분은 동일합니다(`GoogleAuth` + Sheets API `values`/`values:batchGet`, 캐시 없음). 다만 postComment는 **쓰기**가 추가되므로, 그 부분만 `markThreadSeenTest`와 같은 방식(별도 쓰기 스코프 `GoogleAuth` 인스턴스)을 새로 씁니다.
4. **기존 서비스 계정/인증 방식을 그대로 재사용할 수 있는가**: 예. 별도 서비스 계정을 새로 만들 필요 없이, 지금 markThreadSeenTest가 쓰는 것과 동일한 서비스 계정(이미 편집자 권한 보유)을 그대로 씁니다.
5. **별도 권한 추가가 필요한가**: 문서 공유 권한 레벨에서는 **필요 없음**(위 1 참고). 코드 레벨에서는 `postCommentTest` 함수 안에서만 `spreadsheets`(쓰기) 스코프의 `GoogleAuth`를 새로 만들어야 하지만, 이건 "권한 추가"가 아니라 "이미 있는 편집자 권한을 그 함수 코드가 실제로 요청하는 것"입니다.
6. **다른 기능에 영향을 주는가**: 주지 않습니다. `markThreadSeenTest`와 동일한 원칙으로, `postCommentTest` 함수 안에서만 쓰기 스코프의 `GoogleAuth` 인스턴스를 새로 만들고 `lib/sheetsClient.js`(다른 모든 읽기 전용 함수가 공유하는 클라이언트)는 건드리지 않습니다 — 최소 권한 원칙 유지.

---

## 7. parity 테스트 계획

`markThreadSeen`보다 분기가 훨씬 많아 시나리오를 역할×상황 조합으로 넓게 잡습니다. 방법론은 markThreadSeen 때와 동일한 계층(로컬 합성 데이터 → 실제 프로덕션 데이터 읽기 전용 비교 → 스모크 테스트 → feed.html 검증)을 따릅니다 — **실제 데이터를 변경하는 테스트는 하지 않고**, 합성 데이터/읽기 전용 비교/명백히 구분되는 테스트 계정+테스트 게시물(SMOKETEST- 접두사 패턴 재사용)만 씁니다.

**요청하신 11개 시나리오 + 역할/상황 조합:**

| 시나리오 | 확인 방법 |
|---|---|
| 정상 댓글 작성(첫 댓글, 담당소장) | 합성 데이터 — 담당 역할 + 해당 품목 담당소장으로 첫 댓글 |
| 정상 댓글 작성(답글, 팀장/임원) | 합성 데이터 — 이미 댓글 있는 품목에 팀장/임원 답글 |
| 필수값 누락(`postId`/`content` 없음) | 합성 데이터 — `MISSING_FIELDS` 코드 일치 확인 |
| 잘못된 세션(`sessionToken` 불일치) | 합성 데이터 — `SESSION_NOT_FOUND` |
| 세션 만료 | 합성 데이터 — `expiresAt`을 과거로 둔 가짜 세션 문서 |
| 존재하지 않는 게시물 | 합성 데이터 — `POST_NOT_FOUND` |
| 존재하지 않는 품목(`itemId`가 실제 품목마스터에 없음) | 합성 데이터 — `isManagerForItem_` 대응 로직이 `item` 없음 처리하는지 |
| 댓글 작성 권한 없음(`일반` 역할, 또는 `담당`인데 다른 품목) | 합성 데이터 — `FORBIDDEN_VIEWER`/`NOT_ASSIGNED_MANAGER` |
| 댓글 내용 경계값(빈 문자열/매우 긴 문자열/특수문자·이모지) | 합성 데이터 — Apps Script가 별도 길이 제한을 두지 않는 것으로 확인됨(코드에 길이 체크 없음), Cloud Run도 동일하게 제한 없이 그대로 저장하는지 확인 |
| 기존 댓글이 있는 게시물(다중 품목/다중 댓글) | 실제 프로덕션 데이터 읽기 전용 스냅샷으로 `updatedPost`/`comments` 계산 결과가 Apps Script와 한 글자도 다르지 않은지 비교(이미 getCommentsTest/getFeedTest parity에서 이 계산 자체는 검증된 부분과 상당히 겹침) |
| 동일 요청 재전송(같은 idempotencyKey) | 합성 데이터 + Fake Firestore(markThreadSeen parity 테스트의 `fake_firestore.js` 재사용) — 두 번째 요청이 시트에 다시 쓰지 않고 캐시된 응답을 반환하는지 |
| 네트워크 응답 유실 상황(3-2/4-7 정책) | Fake Firestore로 "IN_PROGRESS 상태에서 재조회" 시나리오 + 클라이언트 측 강제 타임아웃(마크스레드신 검증 B/E와 동일한 monkey-patch 기법)으로 재시도 시 중복 append가 없는지 |

**안전한 검증 방법**: markThreadSeen 때와 동일하게, (1) 순수 함수 포팅 비교는 합성 데이터로, (2) 응답 계산(feedEngine) parity는 실제 시트를 **읽기만** 해서 로컬 비교, (3) 실제 쓰기가 필요한 검증(스모크 테스트, idempotency 재시도)은 `SMOKETEST-POST`/`SMOKETEST-ITEM` 같은 명백히 가짜인 postId/itemId로만 수행 — 다만 postComment는 `findPost_`가 실제 게시물 존재를 확인하므로 markThreadSeen과 달리 완전히 가짜인 postId로는 `POST_NOT_FOUND`만 확인 가능합니다. **실제 append까지 검증하려면 테스트용으로 명백히 구분되는 게시물/품목 데이터가 필요하며, 이건 실제 구현 승인 시 재홍님과 "테스트용 게시물을 하나 만들어도 되는지" 별도로 확인이 필요합니다** — 이번 설계 문서에서는 결정하지 않습니다.

---

## 8. 기존 기능과의 관계 (구조도)

```
프론트(feed.html, submitComment)
 ↓
Cloud Run postCommentTest
 ↓
 ├─ 성공(ok:true) → 완료, comments/updatedPost로 화면 갱신
 ├─ 명확한 사전 실패(3-1의 에러 코드 목록) → 그 에러를 그대로 표시
 │                                          (필요시 향후 결정: Apps Script 재확인 허용 여부)
 └─ 애매한 실패(3-2: timeout/5xx/응답유실)
      → 같은 idempotencyKey로 Cloud Run 재시도(1~2회)
           ├─ 성공/DONE 캐시 응답 → 완료
           └─ 계속 실패(3-3) → 자동 재전송 금지, 사용자에게 확인/재시도 유도
```

- **기존 Apps Script `handlePostComment_`는 삭제하지 않고 유지**(이전 후에도 즉시 롤백 가능성 보존 — 원칙 그대로).
- `updateComment`/`deleteComment`는 이번 범위에 포함하지 않으며, `handlePostComment_`와 `buildCommentUpdateResponse_`를 공유하지만 이번 postComment 이전이 그 두 액션에 영향을 주지 않습니다(그대로 Apps Script에 남음).
- **오류 분류(어느 단계까지 진행됐는지)**: 3-4에서 설명한 대로, "정상 JSON 응답을 받았는가"만으로 이미 사전 실패/애매한 실패가 구분되므로, 별도의 "진행 단계 추적 필드"를 응답에 추가할 필요는 없다고 판단합니다.

---

## 9. 기존/이전 예정 API와의 역할 관계

| 함수 | postComment와의 관계 |
|---|---|
| `whoamiTest` | 세션 검증 방식 참고용(실험/성능 측정 목적이라 직접 재사용 대상은 아님) |
| `getSettingsTest` | 무관(설정 조회) |
| `getTeamManagersTest` | 무관 |
| `getThreadSeenTest`/`markThreadSeenTest` | 세션 인증은 별개 인라인 구현(아직 `lib/auth.js`로 리팩터링되지 않음, auth.js 주석 참고) — postComment는 `lib/auth.js`를 쓰는 새 계열(getFeedTest/getNotificationsTest/getPostByIdTest/getCommentsTest)과 같은 패턴을 따릅니다. `writeIdempotency.js`는 markThreadSeenTest와 완전히 동일하게 재사용. |
| `pollSignalTest` | `lib/feedEngine.js`의 `buildFeedEntry`/`teamScopeAllows` 등을 postComment의 `updatedPost` 계산에 그대로 재사용 — 직접적인 공용 모듈 관계 |
| `getPostByIdTest` | `findPost_` 대응 로직 작성 시 참고할 가장 가까운 선례 |
| `getFeedTest`/`getNotificationsTest` | `buildFeedEntry`/`buildTeamByEmail` 등 같은 모듈을 공유 |
| `getCommentsTest` | 인증(`lib/auth.js`) + 데이터 읽기(`lib/sheetsClient.js`) + 댓글 필터링(`visibleCommentsForPost`)까지 postComment가 그대로 재사용할 수 있는 가장 가까운 선례 — **거의 모든 "읽기" 부분을 이 함수의 패턴을 복사해서 시작할 수 있습니다.** |

**결론**: 새로 작성해야 하는 부분은 (a) 권한 게이트 로직(2-2), (b) Sheets API append(2-4) 두 가지뿐이고, 나머지(인증, 데이터 읽기, 응답 재계산)는 기존 모듈을 그대로 재사용합니다.

---

## 10. 요청하신 20개 항목 — 요약 인덱스

이번 문서에서 각 항목을 다룬 위치를 정리합니다(모든 항목을 이 문서 안에서 다뤘습니다).

1. Apps Script postComment 구조 → 1번
2. Cloud Run postCommentTest 구조 → 2번
3. 기존 인증 방식 재사용 여부 → 2-1, 9번
4. Google Sheets 쓰기 방식 → 2-4, 6번
5. 댓글 시트 권한 상태 → 6번
6. Firestore 사용 필요성 → 4번(재사용, 신규 컬렉션 불필요), 5번
7. idempotency 설계 → 4번
8. 정확한 Apps Script fallback 조건 → 3-1, 4-8
9. fallback하면 안 되는 조건 → 3-2, 3-3
10. 오류 코드 체계 → 3-4
11. 응답 구조 → 2-5, 3-4
12. parity 테스트 계획 → 7번
13. 실제 운영 데이터에 영향 없는 테스트 방법 → 7번 하단
14. 변경 예상 파일 → 아래 표
15. 신규 API → `postCommentTest`(Cloud Run) 1개만 신규. 프론트(`feed.html`)는 기존 `IDEMPOTENT_WRITE_ACTIONS`/`generateIdempotencyKey_` 재사용, 새 액션명 추가 없음.
16. 기존 API와의 관계 → 9번
17. 보안 영향 → 아래 별도 설명
18. 롤백 방법 → 아래 별도 설명
19. 향후 feed.html 연결 방법 → 아래 별도 설명
20. 구현 순서 → 아래 별도 설명

**14. 변경 예상 파일 (실제 구현 승인 시)**

| 파일 | 변경 내용 |
|---|---|
| `cloud-run/mro-functions/index.js` | `exports.postCommentTest` 신규 추가(다른 함수는 건드리지 않음) |
| `cloud-run/mro-functions/lib/feedEngine.js` | (선택) 권한 게이트 로직을 이 파일에 함수로 추가할지, index.js 안에 인라인할지는 구현 시 결정 — markThreadSeenAction_이 index.js에 인라인된 선례를 따르면 이 파일은 건드리지 않을 수도 있음 |
| `cloud-run/mro-functions/lib/writeIdempotency.js` | **변경 없음**(1번 검토 결론) |
| `feed.html` | (다음 단계, 이번 승인 범위 아님) `CLOUD_RUN_POSTCOMMENT_URL` 상수 + `submitComment` 함수 내 Cloud Run 우선 시도 로직 — markThreadSeenRemote_와 유사하지만 3번의 3단 폴백 정책 반영 필요 |
| `apps-script/Code.gs` | **변경 없음**(기존 `handlePostComment_` 그대로 유지) |
| 신규 parity 테스트 디렉터리(`tests/postcomment-parity/`) | markThreadSeen 때와 동일한 구조로 신규 |

**17. 보안 영향**: `postCommentTest` 함수 하나에만 쓰기 스코프(`spreadsheets`)가 새로 부여되지만, 이건 이미 markThreadSeenTest로 검증된 패턴을 반복하는 것이라 추가적인 새 위험 유형은 없습니다. 다만 "쓰기가 가능한 함수가 하나 더 늘어난다"는 점에서 전체 공격 표면은 markThreadSeen 때와 마찬가지로 소폭 늘어납니다 — `sessionToken` 검증(Firestore `sessions` 컬렉션, 만료 확인)이 여전히 유일한 게이트라는 점은 기존과 동일합니다.

**18. 롤백 방법**: 기존 원칙과 동일 — (a) `feed.html`의 `CLOUD_RUN_POSTCOMMENT_URL`을 빈 문자열로 바꾸면 즉시 Apps Script 경로로 복귀(가장 흔한 방법), (b) Cloud Run 함수 자체를 이전 리비전으로 롤백, (c) 이 저장소의 이전 커밋으로 소스 되돌리기.

**19. 향후 feed.html 연결 방법(다음 단계, 이번엔 미착수)**: markThreadSeenRemote_ 패턴을 뼈대로 하되, "ok:true만 성공 인정 → 실패 시 조용히 Apps Script"이던 부분을 3번의 3단 분기(사전 실패/애매한 실패/최종 실패)로 대체. `submitComment`의 낙관적 UI(`optimisticComment`/`tempId`) 실패 처리 부분도 3-3의 "확인 필요" 상태 표시를 반영해야 함.

**20. 구현 순서(제안, 실제 착수는 별도 승인 후)**:
1. `postCommentTest` 코드 작성(2번) — 코드 리뷰용 diff만, 배포 전.
2. 로컬 합성 데이터 parity(7번 표의 앞부분) — 네트워크/배포 없이.
3. 실제 프로덕션 데이터 읽기 전용 비교(updatedPost/comments 계산 parity).
4. GitHub 커밋(별도 승인).
5. Cloud Run 배포(별도 승인, 재홍님이 직접 실행).
6. 스모크 테스트(테스트용 게시물 필요 여부 먼저 확인).
7. feed.html 연결 설계(3단 폴백 반영) — 별도 diff 승인.
8. 검증 A~E(마크스레드신과 유사하되 3-2/3-3 재시도·확인유도 시나리오 추가).
9. feed.html 커밋.

---

## 11. 이번 세션에서 결정된 것 / 아직 결정 안 된 것

**결정됨(승인 반영)**: 3번의 폴백 정책 전체(3-1/3-2/3-3), `lib/writeIdempotency.js` 그대로 재사용(4-9), 새 Firestore 컬렉션/Sheets 컬럼 추가 없음(4-9).

**2026-08-21 최종 확정 — 5개 항목 결정 내용**:
1. 3-1 "명확한 사전 실패" 시 4xx 에러 코드가 왔을 때 **Apps Script 재확인은 하지 않음** — "그대로 표시" 방식으로 확정.
2. 5번 Firestore 1MiB 관련 실제 게시물별 댓글 수 실측 — **지금은 하지 않고, 실제 구현 승인 전에 확인**.
3. 7번 parity 테스트용 게시물 생성 여부 — **실제 구현 승인 시점에 재홍님이 별도로 결정**.
4. 3-3 "확인 필요" UI — **feed.html 구현 단계에서 diff로 확인 후 승인**.
5. 실제 구현 착수 — **다음 세션에서 별도 승인**.

이 문서(설계 확정 범위)는 여기서 마무리합니다. 코드/배포/커밋은 전혀 진행하지 않았고, 다음 세션에서 "실제 코드 작성" 승인이 있을 때 2번(함수 설계)부터 구현에 착수합니다.
