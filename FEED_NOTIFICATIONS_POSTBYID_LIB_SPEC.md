# getFeed + getNotifications + getPostById 공동 이전 — lib/ 모듈·함수 명세 (2026-08-20, 2단계 준비 — 설계만, 코드/파일 변경 없음)

이 문서는 `THREADSEEN_FEED_NOTIFICATIONS_CLOUDRUN_PLAN.md`(2026-08-19, 승인됨)의 ⑨~⑩에서 개념 수준으로만 제시했던 "공통 엔진 + B안(lib/ 분리)"를, 실제 파일 경로·함수 시그니처 수준까지 구체화한 것입니다. **이번 문서 작성 과정에서 `lib/` 파일을 만들거나 `index.js`를 수정한 적은 없습니다** — 아래 근거 확인을 위해 읽기만 한 파일은 `cloud-run/mro-functions/index.js`(현재 611줄, 커밋 `f21f9ce` 기준)와 `apps-script/Code.gs`뿐입니다.

> **[2026-08-20 실제 구현 완료 후 갱신]** 이 문서는 원래 설계 전용(코드 변경 없음)이었으나, 이후 실제 승인·구현이 끝난 뒤 실제 코드와 다른 부분을 바로잡기 위해 일부 문단을 갱신했습니다(갱신 표시가 있는 문단만 해당 — 그 외는 원래 승인 당시 그대로 보존). 가장 중요한 차이는 **`getPostByIdTest`가 원안의 `buildFeedEntries` 재사용 대신, 게시물 존재 여부(`NOT_FOUND`)와 열람권한(`FORBIDDEN`)을 분리해서 판단하도록 바뀐 것**입니다 — 상세 이유는 섹션 3-4, 5, 7-6에 표시해 두었습니다. 다른 3개 함수(`getFeedTest`/`getNotificationsTest`/`pollSignalTest`)는 원안 그대로 구현되었습니다.

---

## 0. 전제와 원칙

- **기준 커밋**: `cloud-run/mro-functions/index.js`는 현재 611줄이며, `getThreadSeenTest`(1단계, 배포·검증 완료)까지 포함된 최신 상태입니다. 이 문서의 모든 줄 번호는 이 파일 기준입니다.
- **깨지면 안 되는 것**: `getThreadSeenTest`(배포됨, 실제 트래픽 있음)와 `pollSignalTest`(배포됨, 실제 트래픽 있음, 12/12 parity 검증됨)의 현재 응답이 한 글자도 바뀌면 안 됩니다.
- **범위**: `getFeedTest`/`getNotificationsTest`/`getPostByIdTest` 3개를 새로 만들고, `pollSignalTest`를 공통 모듈을 쓰도록 리팩터링합니다. `getThreadSeenTest`/`getSettingsTest`/`whoamiTest`/`getTeamManagersTest`는 이번 범위에 포함되지 않으며, 이 문서에서 제안하는 리팩터링은 이 4개를 건드리지 않습니다(원하면 나중에 별도로 검토).

---

## 1. 현재 pollSignalTest가 쓰는 함수들 [기존, 재확인]

`index.js` 안에 `exports.`가 아닌 최상위 일반 함수로 이미 존재하며, 같은 파일의 어떤 `exports.*` 함수에서도 그냥 호출 가능한 상태입니다.

| 함수 | 위치(줄) | Apps Script 대응 |
|---|---|---|
| `sheetSerialToMs_(v)` | 363 | (Apps Script는 실제 Date 객체를 쓰므로 대응 함수 없음 — Sheets API 전용 보정) |
| `teamScopeAllows_(role, viewerTeam, targetTeam, leadScope)` | 371 | `canViewComment_(user, commentTeam)`의 축약형(설정 조회를 매 호출 대신 인자로 미리 받음) |
| `relatedActiveItems_(post, allItems)` | 379 | `getRelatedItems_(post, allItems)` — 로직 100% 동일 |
| `summarizeItemForPost_(item, itemComments)` | 391 | `buildFeedEntry_` 내부의 품목별 confirmed/commentCount/lastComment 계산 부분과 동일 |
| `needsAttentionFor_(viewer, itemSummaries, lastCheckedMs)` | 409 | `buildFeedEntry_` 내부의 역할별 needsAttention 분기와 동일 |

**중요한 확인 사항 (안전성의 핵심 근거)**: `summarizeItemForPost_`가 받는 `itemComments`는 "이 품목에 달린 댓글 전체"이며, 팀 열람권한으로 걸러지지 않은 원본입니다. Apps Script의 `buildFeedEntry_`도 confirmed/commentCount/lastComment를 계산할 때 정확히 같은 방식(원본 `itemComments`, 필터링 없음)을 씁니다. 팀 열람권한 필터(`canViewComment_`)는 **품목 자체가 보이는지(item-level)** 판단할 때와, **각 댓글을 화면에 보여줄지(comment-level, `visibleComments`)** 판단할 때만 쓰이고, confirmed/commentCount/lastComment 수치 자체에는 영향을 주지 않습니다. 이 사실이 아래 4번 섹션의 `pollSignalTest` 리팩터링이 안전한 핵심 근거입니다.

---

## 2. 분리/신규 파일 목록 [신규 제안 — 승인된 B안 기준]

`THREADSEEN_FEED_NOTIFICATIONS_CLOUDRUN_PLAN.md` ⑩에서 이름만 제시했던 `lib/feedEngine.js`/`lib/sheetsClient.js`/`lib/auth.js`를 그대로 쓰고, "④ 응답 생성" 역할을 위한 `lib/feedResponses.js`를 새로 추가 제안합니다.

| 경로(제안) | 역할 | 상태 |
|---|---|---|
| `cloud-run/mro-functions/lib/auth.js` | Firestore 세션 인증 공통화 | 신규 파일 (기존 `touchSession_`을 이 파일로 이동) |
| `cloud-run/mro-functions/lib/sheetsClient.js` | Sheets 읽기 공통화(batchGet 실행 + 행→객체 변환) | 신규 파일 |
| `cloud-run/mro-functions/lib/feedEngine.js` | 공통 판정/변환 로직(품목 열람권한, 확인여부, needsAttention) | 신규 파일 (기존 5개 함수를 이 파일로 이동 + 신규 함수 추가) |
| `cloud-run/mro-functions/lib/feedResponses.js` | getFeed/getNotifications/getPostById 응답 모양 생성 | 신규 파일 |
| `cloud-run/mro-functions/index.js` | 위 4개 파일을 `require`해서 4개 `exports.*Test` 함수를 얇게 구성 | 기존 파일 수정(함수 본체를 lib로 옮기고 `require` 추가) |

배포 방식(`--source=. --entry-point=...`)은 지금과 동일합니다 — Cloud Functions 2세대는 소스 디렉터리 전체를 올리므로 `lib/` 하위 파일도 자동으로 함께 배포됩니다(`cloud-run/README.md`에 이미 있는 설명과 동일). 실제 구현 승인 시 `cloud-run/README.md`의 "소스 구조" 절도 "소스 하나"에서 "소스 디렉터리(하위 lib/ 포함)"로 갱신이 필요합니다(이번 문서에서는 문서 수정도 하지 않습니다 — 사용자가 이번 지시에서 명시적으로 막았습니다).

---

## 3. 파일별 명세

### 3-1. `lib/auth.js` — Firestore 세션 인증 공통화

```js
// lib/auth.js
// 입력: firestore 클라이언트 인스턴스, sessionToken
// 출력: 성공 시 { ok: true, email, ref }, 실패 시 { ok: false, status, error }
//   - status는 index.js가 그대로 res.status()에 쓸 HTTP 상태코드
//     (기존 관례 그대로: 토큰 누락=400, SESSION_NOT_FOUND/EXPIRED=200+ok:false)
async function authenticateSession(firestore, sessionToken) { ... }

// 기존 touchSession_를 이름만 유지해서 그대로 이동 (로직 변경 없음)
async function touchSession(ref) { ... }

module.exports = { authenticateSession, touchSession };
```

- `authenticateSession`은 현재 `pollSignalTest`/`getThreadSeenTest`/`getSettingsTest`/`whoamiTest`/`getTeamManagersTest`에 5번 복붙되어 있는 다음 블록을 그대로 옮긴 것입니다(로직 한 글자도 안 바꿈): `sessionToken` 존재 확인 → `firestore.collection('sessions').doc(sessionToken).get()` → `exists` 확인 → `expiresAt` 만료 확인 → 통과 시 `touchSession` 호출.
- **이번 범위에서는 기존 5개 함수는 그대로 두고 건드리지 않습니다.** `getFeedTest`/`getNotificationsTest`/`getPostByIdTest`(신규)와 `pollSignalTest`(리팩터링 대상)만 이 모듈을 씁니다. 기존 5개도 나중에 이 모듈로 옮기면 코드 중복이 더 줄지만, 그건 "지금 잘 동작하는 걸 굳이 건드리지 않는다"는 이번 엔진과 무관한 별도 판단이라 이번 승인 범위에는 넣지 않았습니다.

### 3-2. `lib/sheetsClient.js` — Sheets 읽기 공통화

```js
// lib/sheetsClient.js
const { GoogleAuth } = require('google-auth-library');

// GoogleAuth 클라이언트 생성 (기존 각 함수에 반복되던 3줄을 그대로 이동)
async function getSheetsClient() { ... } // scopes 고정: spreadsheets.readonly

// values:batchGet 실행. pollSignalTest가 이미 쓰는 호출을 그대로 일반화.
// ranges: encodeURIComponent 처리된 범위 문자열 배열
// opts.unformatted: true면 valueRenderOption=UNFORMATTED_VALUE (날짜 시리얼 넘버로 받기 위함)
async function batchGetValues(client, spreadsheetId, ranges, opts) { ... }
// 반환: resp.data.valueRanges 배열 그대로(각 원소.values)

// 행 배열 -> 객체 배열 변환. Code.gs의 getAllPosts_/getAllItems_/getAllComments_와
// 동일한 열 순서를 그대로 따른다(아래 3-2-1 표 참고). 날짜 관련 필드는 원본 시리얼 값을
// 그대로 담아 반환하고(*Raw 접미사), ms/ISO 변환은 lib/feedEngine.js·lib/feedResponses.js가
// 필요한 시점에만 한다 — sheetsClient.js는 "읽기"만 책임지고 "판정/변환"은 하지 않는다.
function rowsToUsers(rows) { ... }    // -> [{email,name,role,team,status,lastCheckedAtRaw}]
function rowsToPosts(rows) { ... }    // -> [{id,materialCode,materialName,title,summary,link,pubDate,createdAtRaw}]
function rowsToItems(rows) { ... }    // -> [{itemId,customer,itemName,manager,team,materials,status,registeredAtRaw}]
function rowsToComments(rows) { ... } // -> [{commentId,postId,itemId,authorEmail,authorName,authorRole,parentCommentId,content,createdAtRaw}]
function parseSettings(rows) { ... }  // -> {} (키: 값 딕셔너리, 예: settings['팀장_열람범위'], settings['뉴스피드출력기간'])

module.exports = { getSheetsClient, batchGetValues, rowsToUsers, rowsToPosts, rowsToItems, rowsToComments, parseSettings };
```

**3-2-1. 열 매핑 (Code.gs `getAllPosts_`/`getAllItems_`/`getAllComments_`/`findUser_`와 동일해야 함 — 틀리면 바로 데이터 오염)**

| 시트 | 범위(기존 `pollSignalTest`가 이미 씀) | 열 순서(A부터) |
|---|---|---|
| 사용자팀마스터 | `POLL_USER_RANGE` = `!A2:I` | email, name, role, team, status, lastCheckedAtRaw(F), (G,H는 이번 범위에서 안 씀) |
| 시황게시물 | `POLL_POST_RANGE` = `!A2:H` | id, materialCode, materialName, title, summary, link, pubDate, createdAtRaw(H) |
| 품목마스터 | `POLL_ITEM_RANGE` = `!A2:H` | itemId(문자열 강제), customer, itemName, manager, team, materials, status, registeredAtRaw(H) |
| 댓글 | `POLL_COMMENT_RANGE` = `!A2:I` | commentId, postId, itemId, authorEmail, authorName, authorRole, parentCommentId, content, createdAtRaw(I) |
| 설정 | `POLL_SETTINGS_RANGE` = `!A2:C` | key, value, description |

기존 `pollSignalTest`의 `allItems`/`allComments` 매핑은 이번 4개 API가 필요로 하는 필드 중 일부(`customer`/`itemName`, `commentId`/`authorName`/`authorRole`/`parentCommentId`/`content`)를 빼고 읽습니다(가벼운 응답이라 필요 없었기 때문). `rowsToItems`/`rowsToComments`는 이 빠진 필드까지 전부 포함하는 **상위집합**으로 새로 씁니다 — 같은 범위(`!A2:H`, `!A2:I`)를 그대로 쓰므로 Sheets API 호출 자체는 늘지 않고, JS 쪽 매핑 필드만 늘어납니다.

**날짜 처리(중요, 기존 주석 그대로 승계)**: `시황게시물.createdAt`(H열)/`품목마스터.registeredAt`(H열)/`댓글.createdAt`(I열)/`사용자팀마스터.lastCheckedAt`(F열) **이 4개만** 실제 Date 셀이라 `sheetSerialToMs_` 보정이 필요합니다. `pubDate`/`title`/`summary`/`link`/`materialCode`/`materialName`/`customer`/`itemName`/`manager`/`team`/`authorName`/`authorRole`/`content`는 전부 텍스트라 변환이 필요 없습니다. `batchGetValues`는 반드시 `valueRenderOption=UNFORMATTED_VALUE`로 호출해야 하며(현재 `pollSignalTest`가 이미 그렇게 함), `rowsTo*` 함수들은 날짜 필드를 가공하지 않고 원본 그대로(`*Raw`) 넘깁니다.

### 3-3. `lib/feedEngine.js` — 공통 판정/변환 로직

```js
// lib/feedEngine.js
function sheetSerialToMs(v) { ... }               // 기존 sheetSerialToMs_ 그대로 이동
function teamScopeAllows(role, viewerTeam, targetTeam, leadScope) { ... } // 기존 teamScopeAllows_ 그대로 이동
function relatedActiveItems(post, allItems) { ... }                      // 기존 relatedActiveItems_ 그대로 이동

// [신규 작성] 이메일 -> 팀 매핑. Code.gs의 getUserTeam_(캐시+findUser_)를
// "이미 batchGet으로 다 읽어온 allUsers에서 한 번에 만든 딕셔너리"로 대체.
// findUser_와 동일하게 대소문자/공백 무시 매칭이 되도록 키를 정규화한다.
function buildTeamByEmail(allUsers) {
  const map = {};
  allUsers.forEach(u => { map[String(u.email || '').trim().toLowerCase()] = u.team; });
  return map;
}

// [신규 작성] Code.gs canViewComment_와 동일한 판단을, 이미 계산해 둔 teamByEmail로 수행.
// (품목 자체의 열람권한은 teamScopeAllows로 이미 판단하므로, 이 함수는 "개별 댓글"의
//  작성자 팀 기준으로 canViewComment_를 다시 적용해 comments[] 배열만 필터링한다.)
function visibleComments(itemComments, viewerRole, viewerTeam, leadScope, teamByEmail) {
  return itemComments
    .filter(c => teamScopeAllows(viewerRole, viewerTeam, teamByEmail[String(c.authorEmail || '').trim().toLowerCase()], leadScope))
    .slice()
    .sort((a, b) => sheetSerialToMs(a.createdAtRaw) - sheetSerialToMs(b.createdAtRaw));
}

// [신규 작성, summarizeItemForPost_의 상위집합] confirmed/commentCount/lastComment는
// summarizeItemForPost_와 완전히 동일한 계산이며, 여기에 customer/itemName/team과
// (표시용) visibleComments만 추가한다.
function summarizeItemFull(item, itemComments, viewerRole, viewerTeam, leadScope, teamByEmail) { ... }
// 반환: { itemId, customer, itemName, manager, team, confirmed, commentCount,
//         lastCommentAuthorEmail, lastCommentAtMs, comments: [...] }
// (comments[]의 createdAt은 이 단계에서는 아직 Raw 그대로 두고, ISO 변환은
//  lib/feedResponses.js가 최종 응답을 만들 때 한다 — feedEngine은 순수 판정만 담당)

function needsAttentionFor(viewer, itemSummaries, lastCheckedMs) { ... } // 기존 needsAttentionFor_ 그대로 이동

// [신규 작성] Apps Script buildFeedEntry_ 1개 게시물 버전과 동일한 결과를 만든다.
// 반환 null 조건도 동일: 뷰어가 볼 수 있는 품목이 하나도 없으면 null.
function buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail) {
  const candidateItems = relatedActiveItems(post, allItems);
  const viewableItems = candidateItems.filter(it => teamScopeAllows(viewer.role, viewer.team, it.team, leadScope));
  if (viewableItems.length === 0) return null;
  const postComments = commentsByPost[String(post.id)] || [];
  const byItemId = {};
  postComments.forEach(c => { (byItemId[String(c.itemId)] = byItemId[String(c.itemId)] || []).push(c); });
  const items = viewableItems.map(it =>
    summarizeItemFull(it, byItemId[String(it.itemId)] || [], viewer.role, viewer.team, leadScope, teamByEmail));
  const confirmedCount = items.filter(s => s.confirmed).length;
  const lastCheckedMs = sheetSerialToMs(viewer.lastCheckedAtRaw) || 0;
  const needsAttention = needsAttentionFor(viewer, items, lastCheckedMs);
  return { post, items, confirmedCount, totalCount: items.length, needsAttention };
}

// [신규 작성] 전체 게시물 버전 (getFeed/getNotifications/getPostById가 공통으로 호출).
function buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope) {
  const teamByEmail = buildTeamByEmail(/* allUsers, 호출부에서 주입 */);
  const commentsByPost = {};
  allComments.forEach(c => { (commentsByPost[String(c.postId)] = commentsByPost[String(c.postId)] || []).push(c); });
  return allPosts
    .map(post => buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail))
    .filter(Boolean);
}

module.exports = {
  sheetSerialToMs, teamScopeAllows, relatedActiveItems, buildTeamByEmail,
  visibleComments, summarizeItemFull, needsAttentionFor, buildFeedEntry, buildFeedEntries
};
```

(위 `buildFeedEntries`의 `teamByEmail` 계산 부분은 실제 구현 시 인자로 `allUsers`를 받도록 시그니처를 다듭니다 — 여기서는 설계 의도를 보이기 위해 간단히 적었습니다. 실제 구현 승인 시 정확한 인자 목록을 다시 확정합니다.)

### 3-4. `lib/feedResponses.js` — getFeed/getNotifications/getPostById 응답 생성

```js
// lib/feedResponses.js
const { sheetSerialToMs } = require('./feedEngine');

function toIso(raw) { const ms = sheetSerialToMs(raw); return ms === null ? null : new Date(ms).toISOString(); }

// entry.items[].comments[].createdAtRaw, lastCommentAtMs, post.createdAtRaw 등을
// 여기서 전부 ISO 문자열로 바꿔서 프론트가 기대하는 모양(Apps Script의 Date -> JSON
// 자동 직렬화 결과)과 동일하게 맞춘다. items[].registeredAt은 애초에 응답에 노출되지
// 않으므로(Code.gs도 노출 안 함) 변환 대상이 아니다.
function shapeItem(s) { ... }      // -> {itemId, customer, itemName, manager, team, confirmed, commentCount, lastCommentAuthorEmail, lastCommentAt(ISO), comments:[{...,createdAt(ISO)}]}
function shapeEntryAsPost(e) { ... } // getFeed/getPostById 공통: {id, materialCode, materialName, title, summary, link, pubDate, createdAt(ISO), confirmedCount, totalCount, needsAttention, items:[shapeItem...]}

// getFeedTest: 기간 컷오프 + hasUnconfirmed 예외 + 최신순 정렬 + cursor/limit 페이지네이션.
// Code.gs handleGetFeed_(2702행)와 동일한 규칙.
function buildGetFeedResponse(entries, { cursor, limit, feedDisplayDays }) { ... }
// -> { ok:true, posts:[shapeEntryAsPost...], nextCursor, totalNeedsAttention }

// getNotificationsTest: 기간 필터 없음 + 담당 역할이면 "비활성 담당은 그대로 노출,
// 활성 담당은 본인 것만" 필터 재적용(Code.gs 2956~2971행) + 알림 전용 필드로 축약.
function buildGetNotificationsResponse(entries, viewer, allUsers) { ... }
// -> { ok:true, count, items:[{postId, materialName, title, summary, createdAt(ISO), items, confirmedCount, totalCount, needsAttention}...] }

// getPostByIdTest: postId 하나만 찾아 getFeed와 동일한 모양으로 반환.
function buildGetPostByIdResponse(entries, postId) { ... }
// -> { ok:true, post: shapeEntryAsPost(entry) } 또는 못 찾으면 { ok:false, error:'NOT_FOUND' }

module.exports = { buildGetFeedResponse, buildGetNotificationsResponse, buildGetPostByIdResponse };
```

> **[2026-08-20 실제 구현 후 갱신]** 위 `buildGetPostByIdResponse(entries, postId)` 설계는 실제 구현 단계에서 그대로 쓰지 않았습니다. 이유는 섹션 5의 getPostByIdTest 항목과 섹션 7-6의 갱신 내용을 참고하세요. 실제 `lib/feedResponses.js`는 이 함수 대신 `buildPostDetailResponse(entry)`(이미 확보된, null이 아닌 entry 하나만 받아 `{ok:true, post:...}` 모양으로 바꾸는 함수)를 내보내고, NOT_FOUND/FORBIDDEN 판단은 `index.js`(`getPostByIdTest`)가 `lib/feedEngine.js`의 `buildFeedEntry`를 직접 호출해서 처리합니다. 그 밖에 `module.exports`에는 `toIso`/`shapeItem`/`shapeEntryAsPost`도 함께 노출됩니다(내부 헬퍼를 다른 호출부·테스트에서도 재사용할 수 있도록).
>
> 또한 `lib/auth.js`의 `authenticateSession` 실제 구현은 성공 시 `{ok:true, email, ref, timings}`(3-1의 `{ok:true, email, ref}`에 `timings` 추가 — 기존 `pollSignalTest`가 이미 갖고 있던 소요시간 측정 관례를 그대로 유지하기 위함)를 반환하고, `module.exports`에 `SESSION_TTL_MS` 상수도 함께 내보냅니다. 동작 로직 자체는 설계 그대로이며, 이 두 가지는 응답 필드 추가일 뿐 판정 로직에는 영향이 없습니다.

---

## 4. pollSignalTest 리팩터링 방안 (기존 동작을 절대 안 깨는 것이 목표)

**Before(현재, 428~545행)**: 인증 블록 인라인 + `values:batchGet` 인라인 + `allPosts.forEach`로 직접 순회하며 `relatedActiveItems_`/`teamScopeAllows_`/`summarizeItemForPost_`/`needsAttentionFor_`를 호출 + `signatures` 배열 직접 조립.

**After(제안)**:
1. 인증: `const auth = await require('./lib/auth').authenticateSession(firestore, sessionToken);` — 실패 시 지금과 동일한 상태코드/에러코드로 즉시 응답(로직 이동만, 분기 결과는 동일).
2. 시트 읽기: `require('./lib/sheetsClient').getSheetsClient()` + `batchGetValues(...)` + `rowsToUsers/rowsToPosts/rowsToItems/rowsToComments/parseSettings`로 5개 배열/딕셔너리 획득(지금과 정확히 같은 5개 범위, 같은 `UNFORMATTED_VALUE` 옵션).
3. 공통 엔진: `const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope);`
4. **압축(pollSignal 전용 슬라이스)**: `entries`를 순회하며 `entry.needsAttention`이면 `totalNeedsAttention++`, `entry.items`를 순회하며 `{postId: entry.post.id, itemId: s.itemId, commentCount: s.commentCount, lastCommentAt: toIso(s.lastCommentAtMs)}`만 뽑아 `signatures`에 push. **`customer`/`itemName`/`comments` 등 무거운 필드는 여기서 그냥 버린다(응답에 안 넣음)** — 지금 응답 모양과 100% 동일해짐.

**동일성 근거(1번 섹션에서 이미 확인한 내용의 재확인)**: `summarizeItemFull`이 계산하는 `confirmed`/`commentCount`/`lastCommentAuthorEmail`/`lastCommentAtMs`는 `summarizeItemForPost_`와 입력(같은 `itemComments`, 필터링 안 된 원본)과 계산식이 완전히 같습니다. `teamScopeAllows`(품목 단위)도 인자 4개가 완전히 같은 방식으로 채워집니다. 따라서 `buildFeedEntries`를 거친 뒤 pollSignal이 필요한 필드만 뽑아내도 **오늘의 12/12 parity 결과가 그대로 유지되어야 합니다.**

**검증 방법(실제 구현 승인 이후 단계, 지금은 안 함)**:
1. `cloud-run/mro-functions/tests/pollsignal-parity/`의 기존 12개 시나리오를 리팩터링 전/후 코드에 그대로 다시 돌려 결과가 바이트 단위로 같은지 확인.
2. 리팩터링된 `pollSignalTest`를 실제로 재배포하기 전에, 로컬(Cloud Shell 등)에서 실제 세션 토큰으로 호출해 리팩터링 전 배포본과 응답을 diff.
3. 문제가 있으면 `git revert` + 기존 리비전으로 즉시 롤백(기존 `cloud-run/README.md`의 "함수 자체 롤백"/"소스 롤백" 방법 그대로 사용, 새로운 롤백 방법이 필요하지 않음).

---

## 5. getFeedTest / getNotificationsTest / getPostByIdTest 호출 순서

4개 함수(pollSignalTest 포함) 공통 1~3단계, 이후 함수별로 다릅니다.

**공통 (1~3단계)**
1. `sessionToken` 추출 → `lib/auth.authenticateSession()` → 실패 시 즉시 응답.
2. `lib/sheetsClient`로 사용자팀마스터/시황게시물/품목마스터/댓글/설정 5개 시트 `batchGet` (기존 `pollSignalTest`와 동일한 5개 범위 재사용, 추가 API 호출 없음) → `rowsToUsers`/`rowsToPosts`/`rowsToItems`/`rowsToComments`/`parseSettings`로 변환.
3. `viewer` 조립(이메일로 `allUsers`에서 본인 행 찾기 — 기존 `pollSignalTest`의 `meRow` 찾기 로직과 동일) + `leadScope = settings['팀장_열람범위']` + `feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope)` 호출.

**getFeedTest (4단계)**
4. `body.cursor`/`body.limit` 추출 → `feedDisplayDays = Number(settings['뉴스피드출력기간']) || 14` → `lib/feedResponses.buildGetFeedResponse(entries, {cursor, limit, feedDisplayDays})` → 결과 그대로 `res.json()`.

**getNotificationsTest (4단계)**
4. `lib/feedResponses.buildGetNotificationsResponse(entries, viewer, allUsers)` 호출(내부에서 담당 역할 품목 재필터 처리) → 결과 그대로 `res.json()`. (기간 필터·페이지네이션 없음 — Code.gs `handleGetNotifications_`와 동일)

**getPostByIdTest (4단계)** — **[2026-08-20 실제 구현 후 갱신, 아래 3~4단계가 원안과 다름]**
3'. (공통 3단계의 `buildFeedEntries` 호출 전에) `body.postId`가 없으면 즉시 `{ok:false, error:'MISSING_POST_ID'}`. 있으면 `allPosts.find(p => p.id === postId)`로 게시물 자체를 먼저 찾고, 없으면 즉시 `{ok:false, error:'NOT_FOUND'}` — 이 단계는 뷰어의 열람권한과 무관하게 "게시물이 존재하는가"만 본다.
4. 게시물을 찾았으면 `feedEngine.groupCommentsByPost(allComments)` + `feedEngine.buildFeedEntry(viewer, post, allItems, commentsByPost, leadScope, teamByEmail)`(전체 목록용 `buildFeedEntries`가 아니라 **단일 게시물용 `buildFeedEntry`를 직접 호출**)를 호출 → `null`이면 `{ok:false, error:'FORBIDDEN'}`(게시물은 있으나 뷰어에게 보이는 품목이 없음), 있으면 `feedResponses.buildPostDetailResponse(entry)` → `{ok:true, post:...}`.

**왜 원안(공통 3단계의 `buildFeedEntries` 결과에서 `postId`로 찾기)을 그대로 안 썼는가**: 공통 `buildFeedEntries`는 이미 "뷰어에게 안 보이는 게시물"을 걸러낸 배열만 반환합니다. 이 필터링된 배열에서 `postId`를 못 찾으면, 그게 "게시물 자체가 없어서(`NOT_FOUND`)"인지 "게시물은 있지만 이 뷰어에게 안 보여서(`FORBIDDEN`)"인지 구분할 방법이 없습니다. Code.gs의 `handleGetPostById_`는 이 둘을 서로 다른 에러 코드로 명확히 구분하므로, Cloud Run 쪽도 parity를 지키려면 "게시물 존재 여부"와 "열람권한 여부"를 분리된 두 단계로 확인해야 합니다 — 그래서 `buildFeedEntries`(전체, 미리 필터링됨) 대신 `allPosts.find()` + `buildFeedEntry`(단일 게시물, 필터링 전 원본에서 시작) 조합으로 바꿨습니다. (섹션 7-6에 있던 "별도 처리가 필요 없다"는 가정은 이 이유로 수정이 필요했습니다 — 아래 갱신 참고.)

---

## 6. index.js에서의 구조 변화 (실제 구현 시 모습 — 지금 작성한 코드 아님, 구조 설명용)

```js
// index.js 맨 위에 추가될 require (실제 구현 승인 후)
const { authenticateSession } = require('./lib/auth');
const { getSheetsClient, batchGetValues, rowsToUsers, rowsToPosts, rowsToItems, rowsToComments, parseSettings } = require('./lib/sheetsClient');
const feedEngine = require('./lib/feedEngine');
const feedResponses = require('./lib/feedResponses');

// pollSignalTest, getFeedTest, getNotificationsTest, getPostByIdTest 4개 exports 함수는
// 전부 "인증 → 시트 읽기 → 엔진 호출 → (함수별) 응답 조립" 4줄짜리 얇은 함수가 된다.
// 기존 teamScopeAllows_/relatedActiveItems_/summarizeItemForPost_/needsAttentionFor_/
// sheetSerialToMs_ 5개 최상위 함수는 index.js에서 제거되고 lib/feedEngine.js로 이동한다
// (다른 exports 함수는 이 5개를 쓰지 않으므로 이동해도 영향 없음 — 실제로 grep해서 재확인 필요,
//  7번 체크리스트에 포함).
```

---

## 7. 검증/승인 전 체크리스트 (실제 구현 시작 전 반드시 재확인할 것)

1. **다른 함수가 이 5개 함수를 안 쓰는지 재확인**: `teamScopeAllows_`/`relatedActiveItems_`/`summarizeItemForPost_`/`needsAttentionFor_`/`sheetSerialToMs_`를 `pollSignalTest` 밖에서 참조하는 곳이 있는지 `index.js` 전체에서 다시 grep(현재 611줄 기준으로는 없는 것으로 보이나, 실제 lib 이동 직전에 재확인).
2. **`getFeedTest`의 `feedDisplayDays` 기본값(14)과 `settings` 키가 없을 때의 동작이 Code.gs와 정확히 같은지** — `Number(undefined) || 14` = `14`로 동일하게 떨어지는지 실제 값으로 재확인.
3. **`getNotificationsTest`의 담당 역할 필터(Code.gs 2956~2971행)를 옮길 때 `activeManagersByName` 계산이 `allUsers`(이미 batchGet으로 읽음)에서 만들 수 있는지** — 현재 Code.gs는 이걸 위해 `getSheetValues_(SHEET_USER)`를 **다시** 읽는데, Cloud Run 쪽은 이미 읽은 `allUsers`를 재사용하면 되므로 오히려 호출이 하나 줄어듭니다. 이 재사용이 결과에 차이를 안 만드는지(같은 스냅샷 시점 데이터인지) 확인.
4. **이메일 대소문자 처리**: `buildTeamByEmail`이 `findUser_`(대소문자·공백 무시)와 동일하게 동작하는지 실제 데이터(대문자 이메일이 섞인 경우)로 parity 테스트에 시나리오 추가.
5. **날짜 변환 대상 필드 목록(3-2-1)이 실제 시트 데이터로도 맞는지** — 특히 `pubDate`가 정말 텍스트인지(실제 셀 서식 확인, `getThreadSeen`/`pollSignal` 때처럼 스프레드시트 파일 설정을 직접 열어 재확인).
6. **`getPostByIdTest`가 컷오프(기간)에 걸려 있는 오래된 게시물도 찾아야 하는지** — Code.gs `handleGetPostById_`는 기간 필터를 안 걸므로(`getFeed`와 달리 `feedCutoff` 없음), 이 부분은 원안대로 맞습니다(컷오프 자체는 문제 없음). **다만 [2026-08-20 실제 구현 후 갱신] "`buildFeedEntries`가 반환한 전체 목록에서 찾으면 되고 별도 처리가 필요 없다"는 가정은 틀린 것으로 확인되었습니다** — `buildFeedEntries`는 뷰어에게 안 보이는 게시물을 이미 걸러낸 배열이라, 그 배열에서 `postId`를 못 찾았을 때 "게시물이 아예 없음(`NOT_FOUND`)"과 "게시물은 있지만 안 보임(`FORBIDDEN`)"을 구분할 수 없습니다. 실제 구현에서는 `allPosts.find()`로 게시물 존재 여부를 먼저 확인하고, 그 다음에만 `buildFeedEntry`(단일 게시물)를 호출해 열람권한을 판단하는 2단계 구조로 바꿨습니다(섹션 5의 갱신 내용 참고). 이 변경은 `getFeed`/`getNotifications`/`pollSignalTest`(모두 `buildFeedEntries` 그대로 사용)에는 영향이 없습니다.

---

## 8. 이번에 하지 않는 것 (범위 밖, 명시적 확인)

- `lib/` 실제 파일 생성, `index.js` 실제 수정 — 전부 안 함(이번 지시대로 설계만).
- `getThreadSeenTest`/`getSettingsTest`/`whoamiTest`/`getTeamManagersTest`를 `lib/auth.js`·`lib/sheetsClient.js`로 옮기는 것 — 이번 범위 아님, 건드리지 않음.
- `README.md`/`cloud-run/README.md` 수정 — 이번 지시대로 안 함.
- `getComments`(3단계 후보) 관련 작업 — 이번 범위 아님.
- 캐시 도입(⑫에서 이미 "이번 설계 범위 밖"으로 표시된 사항) — 여전히 범위 밖, 판단 보류.

---

이 문서는 검토용 명세이며, 승인해 주시면 그 다음에 실제로 `lib/` 4개 파일을 만들고 `index.js`를 수정하는 작업(디프 전체를 먼저 보여드리고, 그 다음 `pollsignal-parity` 재검증 → 신규 3개 API용 parity 테스트 신규 작성 → 승인 후 GitHub 커밋 → 별도 승인 후 Cloud Run 배포)으로 진행하겠습니다.
