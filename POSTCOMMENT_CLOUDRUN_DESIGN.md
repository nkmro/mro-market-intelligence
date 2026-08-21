# postComment Cloud Run 이전 — 준비 재확인 + 설계 제안

작성일: 2026-08-21
상태: **분석·설계 전용 문서 — 코드 수정/GitHub 커밋/Cloud Run 배포/Apps Script 배포 전혀 하지 않음**
근거: `/tmp/repo`를 `origin/main`(최신 커밋 `9139f0dd16a2182f2cb4d5d71ea0df92a2be702f`) 기준으로 재확인, `README.md`, `cloud-run/README.md`, `cloud-run/mro-functions/index.js`, `cloud-run/mro-functions/lib/writeIdempotency.js`, `WRITE_API_CLOUDRUN_PREREQ_NOTES.md`, `WRITE_API_MIGRATION_PREP_REVIEW.md`, `POSTCOMMENT_CLOUDRUN_ANALYSIS.md`를 이번에 다시 대조.

---

## 0. 현재 GitHub 상태 재확인 결과

### 0-1. 소스 코드 자체는 최신 상태와 일치함

- `git fetch origin main` 기준 로컬 클론이 이미 `origin/main` HEAD(`9139f0dd16a2182f2cb4d5d71ea0df92a2be702f`, "Add markThreadSeen Cloud Run transition in feed.html")와 완전히 일치. drift 없음.
- `markThreadSeen` 관련 4개 커밋(index.js, lib/writeIdempotency.js, 파리티 테스트, 설계 문서) + feed.html 커밋 전부 origin에 정상 반영되어 있음.

### 0-2. 문서(README) 두 곳이 실제 상태보다 뒤처져 있음 — 발견된 불일치

이번에 다시 대조하면서, **소스/배포 상태는 맞는데 문서만 갱신이 안 된 부분**을 발견했습니다. 아직 아무것도 고치지 않았고, 보고만 드립니다.

**`/tmp/repo/README.md` (루트) — API 매핑표 (44~56행 부근)**

| 표에 적힌 상태 | 실제 상태 | 비고 |
|---|---|---|
| `getFeed`/`getNotifications`/`getPostById`: "이전 후보로 확정, 공동 이전 설계 진행 중 — 승인 대기" | ✅ 이미 전환 완료, `feed.html`에 연동됨 | 재홍님 상태 요약에서도 "전환 완료"로 확인 |
| `getComments`: "🚫 작성·수정·삭제는 이전 보류, 조회만 향후 후보"에 묶여 있음 | ✅ `getComments`는 이미 전환 완료(커밋 `56892c9`) | `postComment`/`updateComment`/`deleteComment` "보류"는 여전히 맞음(고칠 필요 없음) |
| `getThreadSeen`, `markThreadSeen`이 "그 외 모든 action... ⏳ 미착수" 항목에 포함 | ✅ 둘 다 전환 완료 (`markThreadSeen`은 이번 라운드에 완료) | 가장 눈에 띄는 불일치 |
| 하단 각주: "이 표는 postComment 이전 가능성 분석 완료 시점(2026-08-18) 기준" | 그 이후로 여러 API가 추가로 전환됐는데 표가 그 시점에 멈춰 있음 | |

**`/tmp/repo/cloud-run/README.md` — 함수별 목록표 (20~32행)**

- 표에는 9개 함수만 있음: `getTeamsTest`, `getSettingsTest`, `pollSignalTest`, `getTeamManagersTest`, `whoamiTest`, `sessionSyncTest`, `firestoreTest`, `sheetPingTest`, `pingTest`.
- 실제 `index.js`에는 이 외에도 `getFeedTest`, `getNotificationsTest`, `getPostByIdTest`, `getCommentsTest`, `getThreadSeenTest`, `markThreadSeenTest`가 있음 — 즉 최소 15개 함수가 존재하는데 표에는 6개가 빠져 있습니다.
- 12행 "소스 구조" 설명도 "9개 함수가 모두 배포됩니다"라고 되어 있어 같은 이유로 낡음.
- "함수별 목록" 표 외의 다른 섹션(Firestore 구조, 배포 방법, 롤백 방법, 앞으로 지켜야 할 원칙)은 이번에 전체를 다시 읽어본 결과 여전히 정확합니다 — 함수 개수/표만 낡았습니다.

**이번엔 문서를 고치지 않았습니다.** 코드/배포는 문제 없으니 급한 건 아니지만, 원하시면 다음번에 "이 두 README만" 별도로 갱신하는 작업으로 분리해서 진행할 수 있습니다(문서 수정도 "한 번에 여러 기능 건드리지 말 것" 원칙에 맞춰 postComment 작업과는 별개 건으로 처리하는 게 맞다고 생각합니다).

---

## 1. `lib/writeIdempotency.js` — postComment 재사용 가능성 검토

### 결론: 수정 없이 그대로 재사용 가능

`withIdempotency(firestore, idempotencyKey, action, actionFn)`의 실제 구현(파일 전체 재확인)을 보면:

- `firestore`, `idempotencyKey`, `action`(문자열), `actionFn`(비동기 함수) 네 개 모두 **markThreadSeen에 종속된 부분이 하나도 없는 범용 파라미터**입니다. `action` 인자는 저장되는 문서에 `'markThreadSeen'`이라는 문자열을 넣는 용도일 뿐이라, `postComment`를 호출할 때는 그냥 `'postComment'` 문자열만 넘기면 됩니다.
- 캐시되는 `response` 필드는 `actionFn()`의 반환값을 **그대로(JSON으로 직렬화 가능하면 뭐든)** 저장합니다 — markThreadSeen은 `{ok:true}`처럼 단순하지만, postComment의 실제 Apps Script 응답은 `{ok:true, comments:[...], updatedPost:{...}}`처럼 더 크고 복잡합니다(1-1 참고). 코드 상 이 크기/구조 차이를 문제 삼는 로직이 전혀 없으므로(단순히 객체를 통째로 Firestore 문서 필드에 넣음), **그대로 재사용 가능**합니다. 다만 Firestore 문서 최대 크기(1MiB)를 감안하면, 댓글이 매우 많은 게시물의 `updatedPost`/`comments` 전체를 캐시에 넣는 게 과한 건 아닌지는 실제 데이터 크기로 한 번 확인해볼 가치는 있습니다(치명적 문제로 보이진 않음 — 참고 사항으로만 기록).
- TTL(6시간), 재시도 정책(4회 × 500ms), IN_PROGRESS 처리 등은 Code.gs의 `withIdempotency_`와 동일한 정책을 재현한 것이라, postComment도 원래 `withIdempotency_`로 감싸여 있으므로 정책 자체가 그대로 맞아떨어집니다.

**즉 "새 모듈을 만들 필요 없이, `postCommentTest` 구현 시 `withIdempotency(firestore, idempotencyKey, 'postComment', postCommentAction_)` 형태로 markThreadSeenTest와 동일하게 감싸면 된다"**는 것이 이번 검토 결론입니다.

### 재사용은 되지만, 모듈 밖에서 별도로 설계해야 하는 것 (이 모듈이 대신 해주지 않는 부분)

`withIdempotency`는 "같은 idempotencyKey로 온 요청을 두 번 실행하지 않는다"는 것만 보장합니다. 아래는 이 모듈이 **해결하지 못하는**, postComment 고유의 문제이며 2번(설계 제안)에서 다룹니다.

- Cloud Run의 `writeIdempotency` 컬렉션과 Apps Script의 `CacheService`는 서로 다른 저장소입니다. 같은 `idempotencyKey`라도 "Cloud Run에서 실행됨"과 "Apps Script에서 실행됨"은 서로의 기록을 모릅니다.
- markThreadSeen은 upsert라 이 문제가 데이터 구조 덕분에 무해했지만, postComment는 append-only라서 두 백엔드가 각각 한 번씩 성공하면 **댓글이 실제로 두 번 등록**됩니다. 이건 `withIdempotency` 모듈이 아니라 "Cloud Run ↔ Apps Script 사이의 폴백 정책"에서 막아야 하는 문제입니다.

---

## 2. postComment Cloud Run 이전 설계 제안

(1번/0번과 마찬가지로 `WRITE_API_MIGRATION_PREP_REVIEW.md`의 "1. postComment"와 "4. 이전 시나리오 제안 — 2단계" 분석을 그대로 이어받아, 이번 세션 요청에 맞춰 구체화한 것입니다. 이번에도 코드는 작성하지 않습니다.)

### 2-1. 전제 확인 (재확인)

- `handlePostComment_`는 현재 이미 `withIdempotency_(body.idempotencyKey, ...)`로 감싸여 있고, `feed.html`의 `IDEMPOTENT_WRITE_ACTIONS`에 `postComment`가 이미 포함되어 있어 클라이언트가 매 요청에 `idempotencyKey`를 붙여 보내고 있습니다. → **프론트에서 새로 바꿔야 할 부분 없음**, Cloud Run 쪽이 같은 필드를 받아서 쓰면 됨.
- 시트 편집자 권한: markThreadSeen 이전 때 이미 서비스 계정(`771006650918-compute@developer.gserviceaccount.com`)을 대상 스프레드시트에 **편집자로 공유 완료**했습니다. `postComment`가 쓰는 시트(`댓글`)가 같은 스프레드시트 문서 안에 있다면(현재 구조상 그런 것으로 보임), **이 선행조건은 이미 충족되어 있어 추가 공유 작업이 필요 없을 가능성이 높습니다** — 다만 실제 구현 승인 시, `댓글` 시트가 정확히 같은 문서인지 한 번 더 확인이 필요합니다.
- 코드 레벨 권한: markThreadSeenTest가 이미 "그 함수만 `spreadsheets`(쓰기) 스코프, 나머지 읽기 함수는 여전히 `spreadsheets.readonly`"로 분리되어 있는 것을 실제 `index.js`에서 확인했습니다(816행). `postCommentTest`도 동일하게 **자기 함수 안에서만** 쓰기 스코프를 쓰고, 다른 읽기 전용 함수들의 스코프는 건드리지 않는 동일한 패턴을 그대로 따르면 됩니다.

### 2-2. `postCommentTest` 함수 설계 (구현 시 이렇게 만들 것을 제안 — 아직 작성 안 함)

1. 세션 인증: `lib/auth.js` 재사용(다른 함수들과 동일).
2. 입력 검증: `postId`/`content` 필수, 없으면 `MISSING_FIELDS` — Code.gs와 동일한 에러 코드 유지(프론트가 에러 코드로 분기하므로 한 글자도 다르면 안 됨).
3. 권한/유효성 로직을 Apps Script와 동일하게 포팅:
   - `role === '일반'` → `FORBIDDEN_VIEWER`
   - 게시물 존재 확인 → `POST_NOT_FOUND`
   - 품목의 첫 댓글 여부 판단 → `FIRST_COMMENT_MANAGER_ONLY` / `NOT_ASSIGNED_MANAGER` / `FIRST_COMMENT_CANNOT_HAVE_PARENT`
   - 답글의 부모 댓글 존재 확인 → `PARENT_COMMENT_NOT_FOUND`
   - 미확인 품목의 일반 댓글 금지 → `NO_CONFIRMED_ITEM_YET`
   - (이 로직 자체는 이미 `getCommentsTest`/`getFeedTest`에서 읽기용으로 포팅해본 필터링 로직과 상당 부분 겹칠 것으로 예상 — 재사용 가능한 부분은 별도로 뽑아둘 수 있음, 실제 구현 시 확인)
4. `withIdempotency(firestore, idempotencyKey, 'postComment', postCommentAction_)`로 감싸기(1번 결론).
5. `postCommentAction_` 내부에서: `commentId` 생성 → Sheets API로 `댓글` 시트에 append(쓰기 스코프) → 갱신된 댓글 목록 + `updatedPost` 재계산 → `{ok:true, comments:[...], updatedPost:{...}}` 형태로 반환(Code.gs 응답과 동일한 모양 유지).
6. 쓰기 함수 전용 `GoogleAuth({scopes:['.../spreadsheets']})`를 이 함수 안에서만 생성 — 다른 읽기 함수들의 `GoogleAuth` 인스턴스는 그대로 둠.

### 2-3. 폴백 정책 — markThreadSeen과 다르게, 더 신중하게 (이번 요청의 핵심)

읽기 API와 markThreadSeen은 "Cloud Run 우선 → 실패하면 조용히 Apps Script로" 패턴이 안전했습니다. **postComment는 이 패턴을 그대로 쓰면 안 됩니다** — append 전용이라 두 백엔드가 각각 한 번씩 실행되면 실제로 댓글이 두 번 등록되기 때문입니다. 실패 유형을 나눠서 다르게 처리하는 것을 제안합니다.

**(a) 명확한 사전 실패 — Apps Script로 조용히 폴백해도 안전**
Cloud Run 요청이 서버에 도달하지도 못한 게 확실한 경우만 여기 포함합니다.
- 네트워크 자체가 안 됨(DNS 실패, 연결 거부 등 — 요청이 나가지도 못함)
- Cloud Run이 즉시 4xx로 응답(예: `MISSING_FIELDS`, `FORBIDDEN_VIEWER` 같은 검증 에러 — 이런 응답이 왔다는 것 자체가 "서버가 요청을 받았고 시트에 쓰지 않고 즉시 거부했다"는 확실한 신호이므로, 이 경우는 폴백하지 말고 **그 에러를 그대로 사용자에게 보여줘야** 함 — Apps Script로 폴백해서 같은 에러를 또 받는 건 의미가 없고, 오히려 Cloud Run이 정확히 거부한 요청을 Apps Script가 다르게 판단해 통과시키는 불일치 위험도 있음)
- 이 경우들은 "서버가 시트에 쓴 적이 없다"는 것이 확실하므로, 기존 읽기 API 패턴처럼 폴백해도 중복 등록 위험이 없습니다.

**(b) 애매한 실패 — 조용히 폴백하지 않음 (이번 설계의 핵심 변경점)**
- 타임아웃(20초 등), 응답이 끊김, 5xx, 연결이 중간에 끊어짐처럼 "Cloud Run이 실제로 시트에 append까지 끝냈는지 알 수 없는" 경우.
- 이때는 Apps Script로 넘기지 않고, **같은 `idempotencyKey`로 Cloud Run 자신에게 한 번 더 재시도**합니다. `writeIdempotency` 문서가 이미 `DONE`이면(먼저 보낸 요청이 실제로는 성공했던 경우) 그 캐시된 응답을 그대로 받아서 "정상 등록됨"으로 처리하면 됩니다. 즉 진짜 위험한 것은 "중복 등록"이 아니라 "재시도해도 계속 애매하게 실패하는 것"뿐입니다.
- 재시도(예: 1~2회)까지도 계속 애매하게 실패하면, 화면에 **"등록 여부를 확인할 수 없습니다. 새로고침 후 댓글이 실제로 등록됐는지 확인해주세요" 같은 안내를 보여주고, 사용자가 직접 확인/재확인하도록 유도**합니다(자동으로 Apps Script에 또 보내지 않음). 이건 Apps Script 폴백 없이도 사용자가 "정말 다시 눌러야 하는지"를 스스로 판단할 수 있게 하는, 조용한 이중 실행보다 안전한 선택입니다.
- (참고: 이 정책은 사용자 경험상 markThreadSeen/읽기 API보다 약간 불편할 수 있습니다 — "실패하면 그냥 자동으로 되던" 것이 "가끔 재확인해달라고 뜨는" 것으로 바뀌기 때문입니다. 이건 append 전용 쓰기의 구조적 위험을 감수하지 않기 위한 의도적인 트레이드오프이며, 실제 발생 빈도는 "Cloud Run이 애매하게 실패하는 비율"에 달려 있어 배포 후 관찰이 필요합니다.)

**(c) 검토했지만 이번엔 채택하지 않는 대안**
- `Code.gs`/시트에 `idempotencyKey` 컬럼을 추가해서 Apps Script도 append 전에 "이 키로 이미 기록된 행이 있는지" 확인하게 하면, 두 백엔드가 진짜로 dedup을 공유할 수 있습니다. 다만 이건 `Code.gs` 수정 + 시트 스키마 변경이 필요해 "한 번에 여러 기능 건드리지 말 것" 원칙과 "기존 읽기 전용 스코프/경로 유지" 범위를 넘어서므로, 이번 설계에는 포함하지 않고 별도 검토 대상으로만 기록해둡니다.

### 2-4. parity 테스트 계획 (markThreadSeen 방식을 확장)

markThreadSeen 때 썼던 계층 구조(로컬 합성 데이터 → 실제 프로덕션 데이터 읽기 전용 비교 → 실 배포 스모크 테스트 → feed.html 검증 A~E)를 그대로 따르되, postComment는 분기 로직이 훨씬 많아 시나리오를 더 넓게 잡아야 합니다.

- 역할별(임원/팀장/담당/일반) × 상황별(품목 첫 댓글/이후 댓글/답글/일반 댓글/미확인 품목) 조합 — `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`가 썼던 "역할별 시나리오 표" 형식을 그대로 재사용.
- 에러 코드별 정확한 문자열 일치 확인(`FORBIDDEN_VIEWER`, `FIRST_COMMENT_MANAGER_ONLY`, `NOT_ASSIGNED_MANAGER`, `FIRST_COMMENT_CANNOT_HAVE_PARENT`, `PARENT_COMMENT_NOT_FOUND`, `NO_CONFIRMED_ITEM_YET`, `POST_NOT_FOUND`, `MISSING_FIELDS`).
- idempotency 관련 시나리오(markThreadSeen 때와 동일한 틀): 신규 등록, 같은 키 재요청(캐시 응답 반환), IN_PROGRESS 동시 요청, TTL 만료 후 같은 키 재사용.
- **신규로 추가해야 하는 시나리오(2-3의 폴백 정책 검증용)**: 강제 타임아웃 상황에서 (i) 같은 키로 Cloud Run 재시도 시 중복 append 없이 캐시된 응답만 오는지, (ii) 재시도까지 실패했을 때 Apps Script로 자동 전달되지 않고 사용자 확인 유도 상태로 남는지, (iii) 사용자가 새로고침했을 때 실제 시트에 중복 행이 없는지.

---

## 3. 이번 설계에서 결정이 필요한 사항 (아직 결정 안 함)

1. 위 2-3의 폴백 정책("애매한 실패 → Cloud Run 자체 재시도 → 그래도 안 되면 사용자 재확인 유도, Apps Script로 조용히 넘기지 않음")을 이대로 채택할지.
2. `postCommentTest`의 정확한 응답 스키마(캐시에 들어갈 `updatedPost`/`comments` 크기)를 실제 데이터로 한 번 확인해볼지(Firestore 문서 크기 제한 관련, 치명적이진 않지만 확인 권장).
3. `댓글` 시트가 markThreadSeen 때 편집자 공유를 완료한 스프레드시트와 정확히 같은 문서인지 재확인(다르면 별도 공유 필요).
4. 이번 세션에서 발견된 `README.md`/`cloud-run/README.md`의 문서 갱신을 postComment 작업과 별개 건으로 진행할지, 나중에 할지.
5. 실제 구현 착수 시점 — 이번 문서는 설계까지만이며, 코드 작성은 별도 승인 후 진행.

이 문서에서는 코드/배포/커밋을 전혀 진행하지 않았습니다. 검토 후 승인 범위를 알려주시면(예: "2-2 함수 설계 + 2-3 폴백 정책까지 승인, 코드는 다음에" 등) 그 범위만 다음 단계로 진행하겠습니다.
