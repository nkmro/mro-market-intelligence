# postComment / markThreadSeen 쓰기 API Cloud Run 이전 준비 검토

작성일: 2026-08-20
상태: **분석·검토 전용 문서 — 코드 수정/GitHub 커밋/Cloud Run 배포/Apps Script 배포 전혀 하지 않음**
근거: `apps-script/Code.gs`, `feed.html`, `cloud-run/mro-functions/index.js`, `cloud-run/mro-functions/lib/*.js`, `cloud-run/README.md`, 기존 문서(`WRITE_API_CLOUDRUN_PREREQ_NOTES.md`, `POSTCOMMENT_CLOUDRUN_ANALYSIS.md`)를 이번에 다시 실제 소스와 대조해서 확인함.

---

## 먼저 밝혀둘 것: 기존 문서와 실제 코드가 다른 부분을 발견했습니다

`WRITE_API_CLOUDRUN_PREREQ_NOTES.md`와 `POSTCOMMENT_CLOUDRUN_ANALYSIS.md`는 "`postComment`에 중복 방지(dedup) 장치가 전혀 없다"고 적어뒀습니다. 이번에 `Code.gs`를 다시 직접 읽어본 결과, **이건 지금 코드 기준으로 사실이 아닙니다.**

- `feed.html` 587~597행: `IDEMPOTENT_WRITE_ACTIONS`(2026-08-07부터 존재하는 주석 기준)에 `postComment`, `markThreadSeen`이 이미 포함되어 있습니다.
- `callApi()`(feed.html 676~684행)는 이 목록에 있는 액션이면 `generateIdempotencyKey_()`로 UUID를 만들어 매 요청에 `idempotencyKey`를 실어 보내고, 같은 논리적 요청의 재시도 라운드 안에서는 **같은 키를 재사용**합니다.
- `Code.gs` 디스패처(197행, 211행)는 `postComment`/`markThreadSeen`을 각각 `withIdempotency_(body.idempotencyKey, ...)`로 감싸서 호출합니다. `withIdempotency_`(626~677행)는 `CacheService`에 `idem_<key>` 형태로 결과를 6시간(21600초) 캐시하고, `LockService`로 짧게(5초) 잠가서 "이미 처리 중/이미 처리됨"인 요청은 실제 핸들러를 다시 실행하지 않고 캐시된 응답을 그대로 돌려줍니다.

즉 **`postComment`/`markThreadSeen`은 이미 클라이언트가 만든 idempotencyKey + 서버(Apps Script) 캐시 기반 dedup을 갖추고 있습니다.** 두 기존 문서가 이 부분을 놓친 것으로 보입니다(작성일이 08-18/08-20인데, 이 메커니즘 자체는 08-07부터 있었던 것으로 보이므로 조사 당시 `appendComment_` 함수 하나만 보고 디스패처 레벨의 래핑을 못 본 것 같습니다).

이 정정은 이번 검토의 결론에 실제로 영향을 줍니다 — "dedup 키를 새로 설계해야 한다"가 아니라 "**이미 있는 dedup 키 체계를 Cloud Run 쪽에서 어떻게 재현/공유하느냐**"가 진짜 과제입니다. 아래 1번 항목에서 이어서 설명합니다.

---

## 1. postComment

### 1-1. 현재 Apps Script 전체 흐름 (`handlePostComment_`, Code.gs 2269~2360행대)

1. `user.role === '일반'`이면 즉시 `FORBIDDEN_VIEWER`로 거부.
2. `postId`/`content` 필수 체크 → 없으면 `MISSING_FIELDS`.
3. `findPost_(postId)`로 게시물 존재 확인 → 없으면 `POST_NOT_FOUND`.
4. `itemId`가 있는 경우:
   - 그 품목에 아직 댓글이 하나도 없으면(최초 댓글) 작성자가 `담당` 역할이면서 `isManagerForItem_`(그 품목의 담당소장)인지 확인 — 아니면 `FIRST_COMMENT_MANAGER_ONLY`/`NOT_ASSIGNED_MANAGER`. 최초 댓글은 답글(`parentCommentId`)일 수 없음(`FIRST_COMMENT_CANNOT_HAVE_PARENT`).
   - 이미 댓글이 있으면 담당소장/팀장/임원이 자유롭게 답글 가능. `parentCommentId`가 있으면 그 댓글이 실제 존재하는지 확인(`PARENT_COMMENT_NOT_FOUND`).
5. `itemId`가 없는 일반 댓글은, 이 게시물에 확인된(댓글이 하나라도 있는) 품목이 없으면 `NO_CONFIRMED_ITEM_YET`으로 거부.
6. `commentId = Utilities.getUuid()`, `now = new Date()`로 `appendComment_([...])` 호출 — 시트(`댓글`)에 **새 행 추가**, 캐시 무효화.
7. 성능 최적화: 프론트가 등록 후 `getComments`/`getFeed`를 또 부르지 않도록, 갱신된 댓글 목록 + 이 게시물의 최신 `buildFeedEntry_` 결과(`updatedPost`)를 응답에 함께 담아 반환.
8. 위 전체가 디스패처 레벨의 `withIdempotency_(body.idempotencyKey, ...)`로 감싸져 있음(위 정정 사항 참고) — 같은 `idempotencyKey`로 재요청되면 실제로는 1~7을 다시 실행하지 않고 최초 실행 결과를 그대로 돌려줌.

### 1-2. 중복 방지(dedup) 키 — 있음, 단 "어디에" 있는지가 문제

- **[기존, 정정]** dedup 키 자체는 이미 있습니다: 클라이언트가 만든 `idempotencyKey`(UUID) + Apps Script `CacheService`(6시간 TTL) + `LockService`(짧은 잠금, 동시에 같은 키가 들어와도 한 번만 실행) 조합.
- **[신규 확인]** `appendComment_` 함수 자체(시트에 실제로 쓰는 부분)에는 dedup 로직이 없는 것도 맞습니다 — dedup은 그 앞단(디스패처의 `withIdempotency_`)에서 걸러지는 구조라, "시트에 중복 행이 쌓이지 않는 이유"는 `appendComment_`가 똑똑해서가 아니라 `withIdempotency_`가 같은 키의 재실행 자체를 막아주기 때문입니다. 이 구분이 Cloud Run 이전 설계에서 중요합니다(아래 1-3, 1-4).

### 1-3. Cloud Run으로 옮기는 방식

Apps Script의 `CacheService`/`LockService`는 Cloud Run(Node.js)에는 없으므로, 같은 역할을 Firestore로 대체해야 합니다. 이미 `cloud-run/mro-functions/package.json`에 `@google-cloud/firestore`가 있고, 세션 저장(`sessions` 컬렉션)에도 쓰고 있으므로 인프라 자체는 이미 갖춰져 있습니다.

가능한 방식:
- **[신규 제안] Firestore 트랜잭션 기반 idempotency 저장소**: 새 컬렉션(예: `writeIdempotency`)에 문서ID = `idempotencyKey`. `firestore.runTransaction()` 안에서 "문서가 없으면 `{status:'IN_PROGRESS', createdAt}`으로 생성하고 계속 진행 / 문서가 `DONE`이면 저장된 응답을 그대로 반환 / `IN_PROGRESS`면 Apps Script처럼 짧게 재시도 후 `DUPLICATE_IN_PROGRESS_RETRY_LATER` 반환"하는 로직으로, `withIdempotency_`의 캐시+락 조합을 트랜잭션 하나로 대체합니다(Firestore 트랜잭션 자체가 원자적 read-then-write를 보장하므로 별도 락이 필요 없다는 점이 Apps Script 방식보다 오히려 더 단순합니다).
- 실제 시트 append는 Sheets API가 트랜잭션을 지원하지 않으므로, "Firestore 트랜잭션으로 `IN_PROGRESS` 확정 → 시트에 append → Firestore 문서를 `DONE`+응답으로 갱신"의 순서를 지켜야 하고, 중간에 append는 성공했는데 `DONE` 갱신 전에 함수가 죽는 경우(콜드 스타트 타임아웃 등)의 처리 방침을 미리 정해야 합니다 — 이 경우 재시도가 오면 `IN_PROGRESS` 상태만 보고 또 append할 위험이 있어, TTL을 짧게 잡고 "재시도 온 요청은 일단 시트를 다시 조회해 같은 `idempotencyKey`가 이미 기록돼 있는지 확인" 같은 보강이 필요할 수 있습니다(1-4에서 이어서 다룸).

### 1-4. Firestore로 dedup 키를 관리하는 방안 (구체 스키마 제안)

```
컬렉션: writeIdempotency
문서 ID: idempotencyKey (클라이언트가 보낸 값 그대로)
필드:
  action: 'postComment' | 'markThreadSeen' 등
  status: 'IN_PROGRESS' | 'DONE'
  response: {...} (DONE일 때만, 그대로 재반환할 JSON)
  createdAt: Timestamp
  expiresAt: Timestamp (createdAt + 6시간 — Apps Script TTL과 동일하게 맞춤)
```

- Firestore의 **TTL 정책(native TTL)**을 `expiresAt` 필드에 걸어두면, Apps Script `CacheService`의 자동 만료와 동일한 효과를 별도 정리(cron) 없이 얻을 수 있습니다.
- **중요한 한계**: 이 Firestore 컬렉션은 **Cloud Run 쪽 실행만** 알고 있는 저장소입니다. Apps Script의 `CacheService` 캐시와는 완전히 별개입니다. 즉, 같은 `idempotencyKey`로 "Cloud Run에 먼저 보냄 → 애매하게 실패/타임아웃 → 기존 Apps Script `callApi('postComment', ...)`로 폴백"이 일어나면, **Apps Script는 이 요청이 Cloud Run에서 이미 처리됐는지 전혀 알 방법이 없습니다.** 읽기 API에서 써온 "Cloud Run 우선 + 실패 시 조용히 폴백" 패턴을 postComment에 그대로 적용하면, "타임아웃났지만 사실 Cloud Run에서는 append까지 끝난" 상황에서 Apps Script가 또 append해 **댓글이 실제로 두 번 등록되는** 사고가 날 수 있습니다. 이건 getFeed/getComments 같은 순수 조회 API에는 없던, 쓰기 API 고유의 위험입니다. (4번 이전 시나리오에서 이 문제에 대한 대응 방안을 제안합니다.)

### 1-5. 기존 `IDEMPOTENT_WRITE_ACTIONS`와의 관계

- 이미 `postComment`가 이 목록에 있고, `feed.html`이 이미 매 쓰기 요청에 `idempotencyKey`를 붙여 보내고 있습니다. **Cloud Run 버전을 만들 때 프론트엔드를 추가로 바꿀 필요 없이, 지금 보내고 있는 같은 `idempotencyKey` 필드를 Cloud Run 함수가 그대로 받아서 위 1-4의 Firestore 저장소 키로 재사용하면 됩니다.**
- 다만 위에서 지적한 "Cloud Run과 Apps Script가 서로의 idempotency 기록을 모른다"는 문제는 이 목록·메커니즘을 그대로 재사용하는 것만으로는 해결되지 않습니다 — 두 백엔드가 같은 `idempotencyKey`를 각자 다른 저장소(Firestore vs CacheService)에 기록하기 때문입니다.

---

## 2. markThreadSeen

### 2-1. 현재 `LockService` 기반 upsert 구조 (`handleMarkThreadSeen_`, Code.gs 3399~3427행)

```js
function handleMarkThreadSeen_(user, body) {
  const postId = String(body.postId || '');
  const itemId = String(body.itemId || '');
  if (!postId || !itemId) return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    // 댓글확인이력 시트에서 (email, postId, itemId) 일치하는 행을 찾아
    // 있으면 확인시각(4번째 열)만 갱신, 없으면 새 행 추가
  } finally {
    lock.releaseLock();
  }
  return jsonResponse_({ ok: true });
}
```

- `email`+`postId`+`itemId` 조합을 키로 하는 **upsert**라, 같은 요청이 두 번 들어와도 결과적으로 "그 행의 확인시각이 갱신"되는 것뿐이라 데이터 구조상 자연스럽게 멱등적입니다.
- `LockService`는 "같은 (email,postId,itemId) 행을 찾는 스캔~쓰기 사이에 다른 요청이 끼어들어 행을 두 개 만드는" 레이스를 막기 위한 것입니다.
- **[신규 확인]** `markThreadSeen`도 디스패처에서 `withIdempotency_(body.idempotencyKey, ...)`로 한 번 더 감싸져 있습니다(211행) — 즉 지금은 "락(레이스 방지)"과 "idempotencyKey 캐시(재실행 방지)"가 이중으로 걸려 있는 상태입니다. `WRITE_API_CLOUDRUN_PREREQ_NOTES.md`가 이 이중 보호 중 락 쪽만 언급하고 idempotencyKey 래핑을 놓친 것으로 보입니다(1번과 같은 종류의 누락).

### 2-2. Cloud Run에서 `LockService`를 대체할 방법

- Apps Script `LockService`는 "이 Apps Script 프로젝트 전체에 대한 단일 락"이라, Cloud Run으로 옮기면 여러 인스턴스가 동시에 뜰 수 있어 이 보장이 사라집니다.
- **[신규 제안]** Firestore 트랜잭션으로 "락 문서"를 흉내내는 방법(`firestore.doc('threadSeenLocks/' + email + '_' + postId + '_' + itemId)`를 트랜잭션 안에서 읽고 판단)도 가능하지만, 진짜 쓰기 대상(시트의 행)은 Firestore가 아니라 Sheets API이므로 **Firestore 트랜잭션은 "언제 시트에 쓸지"를 순서대로 정리해줄 뿐, 실제 시트 쓰기 자체를 원자적으로 보장하지는 못합니다.** (Sheets API에는 트랜잭션이 없습니다.)

### 2-3. Firestore 트랜잭션 vs Sheets API 낙관적 동시성 — 어느 쪽이 적합한가

- **Firestore 트랜잭션(추천)**: idempotencyKey 기반 dedup(1-4와 동일한 스키마 재사용)으로 "같은 논리적 요청의 재실행"은 확실히 막을 수 있습니다. 다만 "완전히 다른 두 요청(다른 idempotencyKey)이 거의 동시에 같은 (email,postId,itemId) 행을 upsert하려는" 진짜 레이스는 여전히 남습니다.
- **Sheets API 낙관적 동시성**: Sheets API `values.update`는 ETag/버전 비교 같은 조건부 쓰기 기능이 없어서, "먼저 읽고 값이 그대로면 쓴다" 방식을 직접 구현해야 하고, 그래도 읽기~쓰기 사이의 경쟁 자체(TOCTOU)를 완전히 막지는 못합니다. 구현 비용 대비 이득이 낮습니다.
- **[권장]** `markThreadSeen`은 "언제 확인했는지"를 기록하는 낮은 위험도의 작업이고, upsert 특성상 레이스가 일어나도 최악의 경우 "행이 중복 생성"되거나 "확인시각이 약간 오래된 값으로 덮어써지는" 정도입니다(재무/재고 데이터가 아님). 완벽한 분산 락을 새로 설계하기보다는, **idempotencyKey 기반 dedup(Firestore 트랜잭션)만 postComment와 동일하게 두고, 진짜 동시 upsert 레이스는 낮은 위험으로 받아들이는** 실용적 접근을 제안합니다. 다만 이렇게 하면 시트에 중복 행이 생겼을 때 `getThreadSeenMap_`(읽기 쪽)이 이를 올바르게 처리하는지(예: 마지막 행 우선 등) 먼저 확인이 필요합니다 — 이번 문서에서는 조사만 하고 결론은 실제 구현 승인 시 다시 확인받겠습니다.
- **markThreadSeen이 postComment보다 유리한 지점**: postComment는 "새 행 추가"만 가능해서 중복 실행이 곧바로 "중복 댓글"로 사용자에게 보이지만, markThreadSeen은 upsert라 **Cloud Run 경로가 애매하게 실패해 Apps Script로 폴백하더라도(즉 두 백엔드가 각각 실행되더라도) 최종 결과는 여전히 "그 행의 확인시각이 갱신됨" 하나로 수렴**합니다. 즉 1-4에서 지적한 "두 백엔드가 서로의 idempotency 기록을 모른다"는 문제가 markThreadSeen에서는 데이터 구조 자체(upsert) 덕분에 심각한 사고로 이어지지 않습니다 — 이 차이가 4번의 이전 순서 제안에 직접 반영됩니다.

---

## 3. 시트 쓰기 권한

### 3-1. 현재 상태 (실제 코드 확인)

`cloud-run/mro-functions/index.js`와 `lib/sheetsClient.js`를 grep한 결과, **현재 존재하는 모든 `GoogleAuth` 인스턴스(index.js 6곳 + sheetsClient.js 1곳, 총 7곳)가 예외 없이 아래 스코프만 사용합니다.**

```js
new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
```

`index.js` 351행 주석에도 "전부 읽기 전용(spreadsheets.readonly)으로만 읽고, 쓰기는 어디에서도 하지 않는다"고 명시되어 있습니다. `WRITE_API_CLOUDRUN_PREREQ_NOTES.md`의 "현재 읽기 전용"이라는 서술은 실제 코드와 일치합니다(이 부분은 기존 문서가 맞았습니다).

### 3-2. 쓰기 이전 시 필요한 권한 범위

두 가지가 **별도로** 필요합니다.

1. **코드 레벨**: 쓰기가 필요한 함수(`postCommentTest`, `markThreadSeenTest` 등)의 `GoogleAuth` 스코프를 `https://www.googleapis.com/auth/spreadsheets`(읽기+쓰기)로 바꿔야 합니다. 기존 읽기 전용 함수들의 스코프까지 한꺼번에 바꿀 필요는 없습니다 — 함수별로 스코프를 분리하면, 읽기 전용 함수의 코드에 실수가 있어도 시트를 고칠 수 없는 지금의 안전장치가 그대로 유지됩니다(최소 권한 원칙).
2. **GCP/Google Sheets 공유 설정 레벨(코드 밖)**: Sheets API는 GCP IAM 롤과 별개로, 대상 스프레드시트 문서 자체에 "이 서비스 계정 이메일을 편집자로 공유"해야 합니다. 지금은 (문서상) 뷰어 권한만 공유돼 있는 것으로 보이므로, 실제 쓰기 이전 전에 **스프레드시트의 "공유" 설정에서 Cloud Run 실행 서비스 계정을 편집자로 추가**하는 작업이 필요합니다. 이건 Google Sheets/GCP 콘솔에서 사용자가 직접 확인·처리해야 하는 부분이라, 실제 코드 작업 전에 재홍님께 "이 서비스 계정이 지금 편집자로 공유돼 있는지" 먼저 확인을 요청드려야 합니다(제가 직접 GCP 콘솔에 접근할 수 없습니다).

### 3-3. 권한 확대에 따른 추가 고려사항 (신규 제안)

- 스코프를 `spreadsheets`(전체 읽기+쓰기)로 넓히면, 그 함수 코드에 버그가 있을 경우 "의도한 셀이 아닌 다른 곳"에 쓸 수 있는 범위도 함께 넓어집니다. 쓰기 함수는 `values.append`/`values.update` 호출 시 대상 범위(A1 표기)를 최대한 좁고 명시적으로 지정하는 것을 권장합니다.
- 가능하다면 읽기 전용 함수들이 쓰는 서비스 계정과, 쓰기 함수가 쓰는 서비스 계정을 분리하는 것도 검토할 수 있습니다(계정을 분리하면 편집자 공유 대상도 분리되어 "읽기 전용 함수는 절대 못 씀"이 코드 실수와 무관하게 보장됨). 다만 이건 지금 규모에는 다소 무거운 조치일 수 있어, 우선 스코프 분리(함수별로 다른 스코프)만으로도 충분하다고 판단합니다 — 최종 결정은 승인 시 다시 확인.

---

## 4. 이전 시나리오 제안 (단계별 + 검증)

읽기 API(getFeed/getNotifications/getComments 등)는 "Cloud Run 우선 → 실패 시 조용히 Apps Script 폴백"이 항상 안전했습니다 — 조회는 실패해도 다시 조회하면 그만이기 때문입니다. **쓰기는 다릅니다.** 1-4/2-3에서 확인했듯, postComment는 "두 백엔드가 각각 성공하면 중복 등록"이 실제로 가능한 위험이 있고, markThreadSeen은 upsert 특성상 그 위험이 낮습니다. 이 차이를 반영해 순서와 검증 방식을 다르게 제안합니다.

**0단계 (설계 확정, 코드 없음)**
Firestore `writeIdempotency` 컬렉션 스키마(1-4)와 TTL 정책, 함수별 스코프 분리 방침(3-3)을 먼저 승인받습니다. 이 단계에서 시트 편집자 공유 여부도 재홍님께 확인 요청.

**1단계 — markThreadSeen 먼저 (위험이 낮은 쪽)**
- `markThreadSeenTest` Cloud Run 함수 신규 작성: Firestore 세션 인증(`lib/auth.js` 재사용) → idempotencyKey 기반 dedup(Firestore 트랜잭션) → Sheets API로 upsert(먼저 조회 후 update 또는 append) → 응답 반환.
- upsert 특성상 Cloud Run 실패 시 Apps Script로 그대로 폴백해도 안전(2-3의 결론)하므로, 읽기 API와 동일한 "우선 시도 + 실패 시 폴백" 패턴을 이번엔 써도 됩니다.
- parity 검증: 기존 `POLLSIGNAL_CLOUDRUN_TEST_PLAN.md` 방식대로, 실제 시트에 영향 없는 스냅샷 비교(1단계) → 소수 계정으로 실제 엔드포인트 통합 테스트(2단계, 별도 승인) → `feed.html` 배선 → 소수 트래픽 관찰.

**2단계 — postComment (위험이 높은 쪽, 신중하게)**
- 1단계에서 Firestore idempotency 트랜잭션 패턴이 실전에서 검증된 뒤에 진행합니다.
- **폴백 정책을 읽기/markThreadSeen과 다르게 설계**: "애매한 실패(타임아웃/네트워크 예외 — 서버 실행 여부를 알 수 없는 경우)"에는 조용히 Apps Script로 폴백하지 않는 것을 제안합니다. 대신:
  - 명확한 사전 실패(요청 자체가 안 나감, 즉시 4xx 등)만 Apps Script로 폴백.
  - 타임아웃/응답 유실처럼 "서버에서 실제로 처리됐을 수도 있는" 경우는, 같은 `idempotencyKey`로 **Cloud Run에 한 번 더(자기 자신에게) 재시도**해서 Cloud Run의 Firestore 기록으로 dedup되게 하고, 그래도 실패하면 사용자에게 "등록 확인이 필요합니다"류의 안내와 함께 재시도를 유도하는 쪽이, 서로 모르는 두 백엔드에 각각 걸어서 중복 등록 위험을 감수하는 것보다 안전합니다.
  - (대안으로 검토할 수 있는 안, 이번엔 채택하지 않음) `Code.gs`의 `appendComment_`/댓글 시트에 `idempotencyKey` 컬럼을 추가해 Apps Script 쪽도 append 전에 "이 키로 이미 등록된 행이 있는지" 확인하게 하면 두 백엔드가 진짜로 dedup을 공유할 수 있습니다. 다만 이는 `Code.gs` 수정(현재 승인 범위 밖)과 시트 스키마 변경이 필요해 범위가 커지므로, 별도 검토·승인 없이는 진행하지 않습니다.
- parity 검증은 markThreadSeen보다 케이스가 많습니다(최초 댓글/담당소장 게이트, 답글 유효성, 팀별 열람 필터, `updatedPost` 재계산 등) — `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`처럼 역할별·시나리오별 표를 만들어 Apps Script 결과와 한 글자도 다르지 않은지 확인하는 절차를 그대로 적용합니다.

**3단계 — 공통 원칙**
- 두 API 모두, Cloud Run 함수가 쓰기 권한을 갖기 전까지는 3-2의 "편집자 공유" 확인이 선행 조건입니다.
- Apps Script의 기존 `handlePostComment_`/`handleMarkThreadSeen_`은 이전 후에도 삭제하지 않고 계속 남겨(기존 원칙과 동일 — 즉시 롤백 가능성 유지).
- 실제 구현은 이번 단계별 순서 중 "다음 한 걸음"만 승인받고 진행하며, 매 단계 코드 변경 전 이 문서와 같은 형식의 분석을 다시 보여드립니다.

---

## 결정이 필요한 사항 (이번엔 결정하지 않음)

1. Firestore `writeIdempotency` 컬렉션 스키마·TTL을 위 1-4 제안대로 확정할지.
2. 쓰기 함수 전용 서비스 계정을 분리할지, 기존 계정의 스코프만 함수별로 나눌지(3-3).
3. 대상 스프레드시트에 Cloud Run 서비스 계정이 편집자로 공유돼 있는지 — 재홍님 쪽 GCP/Sheets 콘솔 확인 필요.
4. postComment의 "애매한 실패 시 폴백 안 함" 정책(4번 2단계)을 그대로 채택할지, 아니면 `Code.gs`에 idempotencyKey 컬럼을 추가해 두 백엔드가 dedup을 공유하는 더 큰 작업을 별도로 진행할지.
5. 이전 순서(markThreadSeen → postComment)에 동의하는지.

이 문서에서는 코드/배포/커밋을 전혀 진행하지 않았습니다. 검토 후 알려주시면, 승인된 범위(예: "0단계+1단계만 진행" 등)만 실제 구현에 들어가겠습니다.
