# 댓글 고정(Pin Comment) 기능 — 개발 계획 (설계 확정 전 초안, 코드/커밋/배포 없음)

작성일: 2026-09-11
상태: **설계 전용 문서.** 코드 작성, 기존 코드 수정, 새 소스 파일 생성, GitHub 커밋, Cloud Run 배포, Sheets/Firestore 구조 변경, 권한 변경 — 전부 하지 않았습니다. 이 문서는 목업 시안(A안, `댓글 고정 기능 목업` 캔버스)에서 확정된 화면/동작을 바탕으로 실제 구현 순서와 방법을 정리한 것입니다.

기존 `postComment`/`markThreadSeen` Cloud Run 이전 설계 문서(`POSTCOMMENT_CLOUDRUN_DESIGN_v2.md`, `MARKTHREADSEEN_CLOUDRUN_DESIGN.md`)와 달리, 이번 기능은 **기존 Apps Script 함수를 옮기는 게 아니라 완전히 새로운 기능**입니다. 그래서 "기존 로직 포팅"이 아니라 "완전 신규 + 기존 모듈 재사용"이 핵심입니다.

---

## 0. 재홍님이 확정한 요구사항 요약 (변경 없이 그대로 반영)

| 항목 | 결정 |
|---|---|
| 권한 | 팀장/임원만 고정 가능. 해제는 팀장/임원 누구나 가능(고정한 사람이 아니어도 됨) |
| 개수 | **전체 피드 기준 최대 3개(전역 공유)** — 팀장 몫 3개 + 임원 몫 3개가 아니라, 역할과 무관하게 항상 합쳐서 3개 |
| 위치 | 검색 헤더 바로 아래, 피드 목록 위 |
| 표시 형식 | "작성자 : 내용" 한 줄(A안 — 3개 넘으면 말줄임 처리), 클릭 시 원본 스레드로 이동 + 강조 |
| 만료 | 자동 만료 없음, 수동 해제만 |
| 디자인 방향 | **A안(심플)** 채택. 고정 영역 아이콘은 스파크(2·5·7·10시 방향 반짝임) 장식 — 순수 CSS 애니메이션, 기능적 의미 없음 |
| 댓글 액션 버튼 구성 | 본인 댓글: `답장 · 수정 · 삭제 │ 고정`(구분선 뒤에 고정). 남의 댓글(고정 권한 있는 팀장/임원 시점): `답장 │ 고정` |

### 🚨 최우선 원칙 (재홍님 요청, 구현 전체에 걸쳐 적용)

1. 기존 기능(로그인/피드/댓글/알림/푸시)에 영향 없게 — 기존 시트·Firestore 컬렉션은 **읽기만**.
2. 저장소는 분리 — 새 기능은 별도 Firestore 컬렉션에 저장.
3. 새 기능이 실패해도 기존 피드/댓글은 정상 동작 — try/catch로 격리, 새 API 실패 시 고정 영역만 안 보이고 나머지는 정상.
4. 롤백 가능하게 — 스위치 하나(`CLOUD_RUN_..._URL = ''`)로 즉시 기능만 끌 수 있게.
5. 화면 구조도 기존 UI는 그대로 두고, 고정 영역만 추가.

이 문서의 모든 결정은 위 5원칙을 만족하는지 항목별로 확인하며 설계했습니다.

---

## 1. 기존 코드 확인 결과 (이번에 직접 재확인)

- **댓글 식별자**: `댓글` 시트 컬럼 `commentId(UUID) / postId / itemId / authorEmail / authorName / authorRole / parentCommentId / content / createdAt` (`POSTCOMMENT_CLOUDRUN_DESIGN_v2.md` 1-2, 이번에 `feedEngine.js`로 재확인). `commentId`는 전역 UUID라 그 자체로 고정 대상 식별에 충분합니다.
- **댓글 읽기 재사용 가능 함수**: `lib/feedEngine.js`의 `visibleCommentsForPost(allComments, postId, viewerRole, viewerTeam, leadScope, teamByEmail)` — 팀 스코프에 따라 보이지 않아야 할 댓글을 걸러주는 **열람 권한 필터**입니다(103~113행, 이번에 재확인). 고정 기능도 이 필터를 반드시 통과시켜야 "다른 팀 담당자의 댓글이 전체 공지처럼 고정 영역에 노출"되는 사고를 막을 수 있습니다.
- **세션 인증**: `lib/auth.js`의 `authenticateSession(firestore, sessionToken)` — `getCommentsTest`(index.js 654행)가 쓰는 것과 동일한 패턴, 그대로 재사용.
- **역할 판정**: `사용자팀마스터` 시트를 `lib/sheetsClient.js`(읽기 전용 스코프)로 읽어 `feedEngine.findViewer(allUsers, email)`로 `role`/`team` 조회. 팀장/임원 게이트는 `feedEngine.js` 곳곳에서 쓰는 `viewer.role === '팀장' || viewer.role === '임원'` 패턴(150행, 233행에서 확인)과 동일하게 작성.
- **하이라이트 애니메이션 재사용 가능**: `feed.html` 155~157행에 이미 `.post-card.flash { animation: flash-highlight 1.6s ease; }` + `@keyframes flash-highlight`가 존재. `scrollIntoView({behavior:'smooth', block:'center'})`도 1926행/2002행에서 이미 쓰이는 패턴. **클릭→이동→강조 흐름은 새 애니메이션을 만들 필요 없이 기존 것 재사용.**
- **롤백 스위치 관례**: `CLOUD_RUN_XXX_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/xxxTest'` 형태 상수 20여 개가 이미 존재(603~704행 확인). 새 기능도 동일한 이름 규칙을 따릅니다.
- **단일 게시물 조회**: `CLOUD_RUN_GET_POST_BY_ID_URL`(`getPostByIdTest`)이 이미 존재 — 고정된 댓글의 원본 게시물이 현재 화면에 로드돼 있지 않을 때 이 함수로 그 게시물만 불러올 수 있습니다(신규 작성 불필요).

---

## 2. 데이터 모델 — 신규 Firestore 컬렉션 `pinnedComments`

기존 `댓글` 시트/Firestore 컬렉션은 전혀 건드리지 않고, 완전히 새로운 컬렉션 하나만 추가합니다(원칙 2).

```
pinnedComments/{commentId}          ← 문서 ID = commentId 그대로 사용
  postId: string
  itemId: string | null
  authorEmail: string               ← 댓글 작성자 스냅샷(고정 당시)
  authorName: string
  authorRole: string
  contentSnapshot: string           ← 고정 당시 댓글 내용(빠른 렌더링용, 매번 시트 재조회 안 해도 됨)
  pinnedByEmail: string              ← 고정한 사람
  pinnedByName: string
  pinnedAt: Timestamp
```

- **문서 ID를 `commentId`로 고정**하는 이유: "이미 고정된 댓글인지"를 별도 쿼리 없이 `pinnedComments/{commentId}` 문서 존재 여부만으로 판단할 수 있고, 같은 댓글이 중복으로 두 번 고정되는 경우도 자연스럽게 막힙니다(Firestore 문서 생성은 덮어쓰기).
- **`contentSnapshot`을 저장하는 이유**: 고정 영역은 항상 최대 3개뿐이라 렌더링 비용이 문제는 아니지만, 댓글이 나중에 수정(`updateComment`)되더라도 고정 영역에는 "고정 당시 문구"가 남는 편이 오히려 자연스럽습니다(공지의 스냅샷 성격). 다만 아래 "미결정 사항"에 이 부분을 재확인 항목으로 남겨둡니다.
- **최대 3개 제한**: 컬렉션 전체 문서 수로 판단(역할별 분리 없음, 0번 표의 결정과 일치). Firestore 트랜잭션 안에서 "현재 문서 수 조회 → 3개 미만이면 생성"을 원자적으로 처리해 동시에 두 사람이 4번째를 고정 시도해도 4개가 되는 레이스 컨디션을 막습니다.

---

## 3. Cloud Run 신규 함수 3개

기존 명명 규칙(`xxxTest`)을 그대로 따릅니다. 셋 다 `lib/auth.js`의 `authenticateSession`으로 세션 인증하고, 응답 모양은 기존 함수들과 동일하게 `{ ok, serverMs, timings, error? }` 패턴을 따릅니다.

### 3-1. `getPinnedCommentsTest` (읽기, 모든 로그인 사용자)

```
POST /getPinnedCommentsTest  { sessionToken }

1. authenticateSession → 실패 시 기존 함수들과 동일한 401/에러 포맷
2. pinnedComments 컬렉션 전체 조회 (문서 3개 이하라 부담 없음), pinnedAt asc 정렬
3. 시트 읽기(batchGetValues, 기존 FEED_BATCH_RANGES 재사용) → allUsers/allComments/settings
4. viewer = findViewer(allUsers, email); leadScope, teamByEmail 계산 (getCommentsTest와 동일)
5. 각 pinnedComments 문서에 대해:
   a. visibleCommentsForPost(allComments, doc.postId, viewer.role, viewer.team, leadScope, teamByEmail)
      결과 안에 doc.commentId가 있는지 확인
   b. 없으면(팀 스코프상 안 보이거나, 댓글이 실제로 삭제됨) → 이 항목은 응답에서 제외
      (원본이 삭제된 경우, 이 조회 김에 pinnedComments/{commentId} 문서도 함께 정리 삭제 — "자동 자가정리")
6. { ok:true, pinnedComments: [남은 항목들] } 반환
```

- **팀 스코프 재검증이 필요한 이유**: 고정 당시엔 보이던 댓글이라도, 열람 권한 로직(`visibleCommentsForPost`)은 "지금 요청하는 사람" 기준으로 다시 걸러야 합니다. 그렇지 않으면 다른 팀 담당자 댓글이 전체 공지처럼 새어나갈 수 있습니다 — 이 재검증이 이번 설계에서 가장 중요한 보안 포인트입니다.
- Sheets 읽기는 전부 기존 `lib/sheetsClient.js`(읽기 전용 스코프)만 사용 — 이 함수 때문에 쓰기 스코프가 새로 생기지 않습니다.

### 3-2. `pinCommentTest` (쓰기, 팀장/임원만)

```
POST /pinCommentTest  { sessionToken, postId, itemId, commentId }

1. authenticateSession
2. viewer 조회 → role이 '팀장'/'임원'이 아니면 { ok:false, error:'FORBIDDEN_NOT_LEAD_OR_EXEC' }
3. allComments에서 commentId 존재 확인 → 없으면 'COMMENT_NOT_FOUND'
   + visibleCommentsForPost로 이 viewer가 볼 수 있는 댓글인지 확인(본인이 못 보는 댓글은 고정도 못 함)
4. Firestore 트랜잭션:
   a. pinnedComments/{commentId} 이미 존재? → { ok:false, error:'ALREADY_PINNED' } (또는 그냥 ok:true로 멱등 처리 — 미결정, 아래 참고)
   b. 컬렉션 전체 문서 수 >= 3 → { ok:false, error:'PIN_LIMIT_REACHED' }
   c. 문서 생성(2번 데이터 모델대로, contentSnapshot은 3번에서 찾은 댓글의 content)
5. { ok:true, pinnedComments: [갱신된 전체 목록] } 반환 (postComment처럼 갱신된 상태를 함께 돌려줘서 프론트 재조회 안 해도 되게)
```

### 3-3. `unpinCommentTest` (쓰기, 팀장/임원 누구나)

```
POST /unpinCommentTest  { sessionToken, commentId }

1. authenticateSession
2. viewer.role이 '팀장'/'임원' 아니면 FORBIDDEN
3. pinnedComments/{commentId} 삭제 (존재하지 않아도 성공 처리 — 이미 해제된 상태와 동일하게 멱등)
4. { ok:true, pinnedComments: [갱신된 전체 목록] } 반환
```

- 쓰기 두 함수(`pinCommentTest`/`unpinCommentTest`)만 Firestore 쓰기 권한이 필요하고, 이는 이미 `sessions`/`pushSubscriptions` 컬렉션에 쓰고 있는 기존 서비스 계정 권한 범위 안입니다(Firestore는 컬렉션 단위 사전 스키마가 없어 별도 권한 신청 불필요 — Sheets처럼 문서 단위 공유 설정이 필요 없음).
- idempotency: postComment처럼 재시도로 인한 중복 우려가 크지 않은 단순 set/delete라, `lib/writeIdempotency.js`를 반드시 쓸 필요는 없어 보입니다 — 다만 프론트에서 버튼 연타를 막는 것으로 충분한지, 아니면 markThreadSeen 수준으로 idempotencyKey를 붙일지는 "미결정 사항"에 남겨둡니다.

---

## 4. feed.html 프론트엔드 변경 (원칙 5: 기존 UI 구조는 그대로, 영역만 추가)

### 4-1. 신규 상수 (기존 패턴 그대로)

```js
const CLOUD_RUN_GET_PINNED_COMMENTS_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getPinnedCommentsTest';
const CLOUD_RUN_PIN_COMMENT_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/pinCommentTest';
const CLOUD_RUN_UNPIN_COMMENT_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/unpinCommentTest';
```

이 중 하나라도 빈 문자열(`''`)이면 그 기능만 즉시 꺼집니다(원칙 4).

### 4-2. 렌더링 위치 및 격리

- 검색 헤더(topbar) 바로 아래, 피드 목록(`.post-card` 리스트) 바로 위에 `<div id="pinned-area">`를 새로 추가 — 목업(Main.dc.html)과 동일한 위치.
- `renderPinnedArea()` 함수를 통째로 `try { ... } catch (e) { console.error(...); /* pinned-area를 비우고 숨김 */ }`로 감쌉니다. 실패해도 `#pinned-area`가 `display:none` 처리될 뿐, 아래 피드 렌더링(`renderFeed()` 등 기존 함수)에는 어떤 영향도 주지 않습니다.
- 페이지 최초 로드 시 `getPinnedCommentsTest` 호출 1회, 이후 pin/unpin 액션의 응답에 포함된 최신 목록으로 로컬 갱신(재조회 없이) — `postComment`가 `updatedPost`를 함께 돌려주는 것과 같은 패턴.

### 4-3. 댓글 스레드 안 "고정" 버튼

- 댓글 렌더링 함수(`renderThread`, 기존 2255~2309행 부근)의 액션 버튼 목록에 조건부로 추가:
  - `(viewer.role === '팀장' || viewer.role === '임원')`이면, 기존 답장/수정/삭제 버튼 뒤에 얇은 구분선(`<span style="...">`) + "고정"/"고정됨" 버튼을 추가.
  - 이미 고정된 댓글(`pinnedCommentIds.has(c.commentId)`)이면 "고정됨" + "해제", 아니면 "고정".
  - 오늘 확정한 목업 그대로: 본인 댓글이면 `답장·수정·삭제 │ 고정`, 남의 댓글이면 `답장 │ 고정`.
- 이 부분은 **기존 `renderThread` 함수 안에 조건 추가**이지 새 함수가 아니므로 "기존 코드 수정은 최소화, 추가 위주로" 원칙에 살짝 어긋납니다 — 다만 버튼 하나 조건부 추가는 불가피한 최소 수정이라 판단합니다. 이 함수 자체가 실패해도 감싸는 try/catch로 pin 버튼만 안 보이게 하는 방식(예: 버튼 생성 부분만 별도 try/catch)으로 안전망을 이중으로 둘 수 있습니다.

### 4-4. 클릭 → 원본 스레드 이동 + 강조

```
1. 고정 영역의 항목 클릭 → postId로 해당 post-card가 현재 DOM에 있는지 확인
   a. 있으면: 바로 4-4-2로
   b. 없으면(피드에 아직 로드 안 됨/스크롤 밖): CLOUD_RUN_GET_POST_BY_ID_URL(getPostByIdTest, 기존 함수 재사용)로
      그 게시물 하나만 가져와 피드 맨 위(또는 지정 위치)에 임시 삽입
2. el.scrollIntoView({behavior:'smooth', block:'center'}) (1926행/2002행과 동일 패턴)
3. 해당 댓글 wrapper에 기존 .flash 클래스를 붙였다가 애니메이션 종료 후 제거
   (지금은 .post-card.flash만 있으므로, 댓글 개별 wrapper에도 이 클래스를 적용할 수 있게
   최소 CSS 선택자 확장이 필요 — 기존 keyframes는 그대로 재사용)
```

- 댓글 wrapper에 `id="comment-${commentId}"`를 붙이는 것도 최소 추가 필요(현재는 `id="text-${commentId}"`만 있어 텍스트 요소만 특정 가능, 강조 대상은 텍스트만이 아니라 댓글 한 줄 전체가 자연스러움).

---

## 5. 테스트 계획

기존 기능 포팅이 아니라 신규 기능이라 Apps Script parity 테스트는 필요 없습니다. 대신:

| 시나리오 | 확인 방법 |
|---|---|
| 팀장/임원이 고정 → 목록에 반영 | 합성 데이터, 정상 흐름 |
| 담당/일반이 고정 시도 → FORBIDDEN | 합성 데이터 |
| 이미 3개 고정된 상태에서 4번째 고정 시도 → PIN_LIMIT_REACHED | 합성 데이터 |
| 동시에 2명이 3번째 슬롯을 두고 고정 시도(레이스) → 한쪽만 성공 | Firestore 트랜잭션 검증(fake_firestore.js 재사용 가능) |
| 팀 스코프상 안 보이는 댓글이 고정된 상태에서, 그 팀이 아닌 팀장이 조회 → 응답에서 제외 | 합성 데이터, `visibleCommentsForPost` 재검증 로직 확인 |
| 고정된 댓글의 원본이 나중에 삭제됨 → 조회 시 자동 제외(+ 자가정리) | 합성 데이터 |
| 임원이 고정, 팀장이 해제(다른 사람이 고정한 것 해제) → 정상 | 합성 데이터, "해제는 누구나" 규칙 확인 |
| `CLOUD_RUN_PIN_COMMENT_URL`을 빈 값으로 설정 → 고정 버튼 자체가 안 뜨거나 눌러도 아무 일 없음, 나머지 피드/댓글은 100% 정상 | 수동 확인(스모크 테스트) |
| 신규 API 3개가 전부 500 에러를 내도 피드 로딩 자체는 영향 없음 | 수동 확인 — `getPinnedCommentsTest` 강제 실패 상태로 feed.html 로드 |

---

## 6. 변경 예상 파일

| 파일 | 변경 내용 |
|---|---|
| `cloud-run/mro-functions/index.js` | `exports.getPinnedCommentsTest`, `exports.pinCommentTest`, `exports.unpinCommentTest` 3개 신규 추가만(기존 함수 무변경) |
| `cloud-run/mro-functions/lib/feedEngine.js` | 변경 없음(기존 `visibleCommentsForPost`/`findViewer`/`buildTeamByEmail` 그대로 재사용) |
| `feed.html` | (1) `CLOUD_RUN_*_URL` 상수 3개 추가 (2) `#pinned-area` 렌더링 함수 신규 추가 (3) `renderThread`에 "고정" 버튼 조건부 추가 — 최소 수정 (4) 댓글 wrapper에 `id` 속성 1개 추가 |
| `apps-script/Code.gs` | 변경 없음 |
| 신규 Firestore 컬렉션 | `pinnedComments` (스키마는 2번 참고) |

---

## 7. 롤백 방법

- **1단계(가장 흔함)**: `feed.html`의 `CLOUD_RUN_GET_PINNED_COMMENTS_URL`/`CLOUD_RUN_PIN_COMMENT_URL`/`CLOUD_RUN_UNPIN_COMMENT_URL` 셋 다(또는 문제되는 것만) 빈 문자열로 — 고정 영역 자체가 안 보이거나 버튼이 비활성화, 기존 피드/댓글은 무관.
- **2단계**: Cloud Run 함수 자체를 이전 리비전으로 롤백(신규 함수라 "이전 리비전"은 사실상 "존재하지 않던 상태" — 필요하면 함수 자체를 삭제).
- **3단계**: 저장소를 이전 커밋으로 되돌리기.
- `pinnedComments` 컬렉션은 기존 컬렉션과 완전히 분리돼 있어, 롤백 시 이 컬렉션을 지우든 남겨두든 다른 기능에 영향 없습니다.

---

## 8. 아직 결정 안 된 것 (구현 착수 전 재홍님 확인 필요)

1. **`contentSnapshot` 방식 확정**: 고정 당시 내용을 스냅샷으로 고정(위 2번 제안)할지, 매번 최신 댓글 내용을 실시간으로 보여줄지. 스냅샷 쪽을 제안하지만, "댓글을 수정하면 고정 영역도 바뀌어야 한다"고 보시면 `getPinnedCommentsTest`에서 매번 `allComments`로 최신 content를 덮어써서 응답하는 방식으로 바꿀 수 있습니다(구현 난이도 차이는 거의 없음).
2. **중복 고정 시도 응답**: 이미 고정된 댓글을 다시 "고정" 요청하면 에러(`ALREADY_PINNED`)로 할지, 그냥 성공으로 조용히 처리(멱등)할지.
3. **pin/unpin에도 idempotencyKey(재시도 안전장치)를 붙일지**: markThreadSeen/postComment 수준으로 `lib/writeIdempotency.js`를 쓸지, 아니면 단순 버튼 비활성화로 충분하다고 볼지.
4. **삭제된 원본 댓글의 자동 정리**: `getPinnedCommentsTest` 조회 시점에 자동으로 `pinnedComments` 문서를 지우는 "자가정리"를 할지, 아니면 그냥 응답에서만 제외하고 문서는 남겨뒀다가 팀장/임원이 수동으로 인지하고 해제하게 할지.
5. **테스트용 게시물/댓글 필요 여부**: 실제 Cloud Run 배포 후 스모크 테스트에 쓸 "명백히 테스트임을 알 수 있는" 게시물/댓글을 하나 만들어도 될지(기존 `postComment` 설계 때와 동일한 절차).

이 5개 항목에 대한 답을 주시면 바로 다음 단계(실제 코드 diff 작성 — 여전히 커밋/배포 전 리뷰용)로 넘어가겠습니다.
