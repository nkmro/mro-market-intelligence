# 6단계 설계: 기존 3종 알림(새 게시물/댓글 필요/답변 요청)을 푸시에 연결

상태: 설계 확정 (코드 없음, 검토/승인 대기)
선행 단계: 1~5단계 완료. 이 문서는 `PUSH_NOTIFICATION_STAGE6_PLAN.md`(1차 계획 초안)에서 재홍님이 확정한 3가지 결정(주기 5분 / `notificationclick` 확장 진행 / 대상 사용자 약 40~50명)을 반영한 완성본이다.
전제: `PUSH_NOTIFICATION_STAGE3_DESIGN.md`(Firestore 스키마) / `STAGE4_DESIGN.md`(FCM 인증) / `STAGE5_DESIGN.md`(`lib/pushSender.js`)의 결론을 그대로 따른다.

---

## 0. 목표와 역할 경계

계획서 4부 6번 + 2단계 확정 원칙(카테고리 정의는 기존 화면 탭 기준 `hasUnreadReply`/`hasAwaitingReply`를 그대로 따름)을 실제로 연결한다. 이번 단계에서 하는 일:

1. `lib/feedEngine.js`에 `hasUnreadReply`/`hasAwaitingReply`를 **클라이언트 조건 그대로** 포팅(3단계 설계 문서 4번에서 이미 정한 원칙 실행).
2. 5분마다 도는 신규 배치 함수(`pushBatchTest`)가 대상 사용자 전원(약 40~50명, `role !== '일반'`)의 3개 건수를 계산해서 5단계 `pushSender.sendConsolidatedPushForUser`에 넘긴다.
3. 알림 클릭 시 "알림" 탭으로 이동하도록 `sw.js`(`notificationclick`)와 `feed.html`을 확장한다(재홍님 승인).

---

## 1. `lib/feedEngine.js` 확장 (신규 함수만, 기존 함수 무변경)

### 1-1. `hasUnreadReply(viewer, postId, item, threadSeenMap, adminEmail)`

feed.html 2508~2522행을 그대로 포팅. 조건은 한 글자도 안 바꿨다 — `session`→`viewer`, 전역 `ADMIN_EMAIL`→명시적 인자 `adminEmail`로만 이름을 바꿨다. `feedEngine.js`는 지금까지 이메일 상수를 하나도 갖고 있지 않아서, 새로 상수를 중복 선언하는 대신 호출부(index.js가 이미 갖고 있는 `ADMIN_EMAIL`, 1316행)가 그대로 넘겨주는 쪽을 택했다. **중요**: 클라이언트는 이 비교에 `trim()`/`toLowerCase()`를 쓰지 않는다(`session.email === ADMIN_EMAIL`, 대소문자·공백 그대로 비교) — index.js의 다른 관리자 체크(`getUsersTest` 등)는 `.trim().toLowerCase()`를 쓰지만, 이 함수는 **클라이언트와 정확히 같은 판단을 재현하는 게 목적**이라 서버의 다른 관례를 따르지 않고 클라이언트 그대로 둔다.

`threadSeenMapLoaded` 가드(클라이언트 원본에 있음)는 포팅하지 않는다 — 그건 "비동기로 아직 안 불러왔을 때"를 방어하는 클라이언트 전용 로딩-상태 체크였고, 서버는 같은 요청 안에서 이미 동기적으로 시트를 다 읽은 뒤에 이 함수를 호출하므로 그 상태 자체가 존재하지 않는다(1-3절 참고).

```javascript
function hasUnreadReply(viewer, postId, item, threadSeenMap, adminEmail) {
  const comments = item.comments || [];
  if (!comments.length) return false;
  const isOverseer = viewer.role === '팀장' || viewer.role === '임원' || viewer.email === adminEmail;
  const participant = comments.some(function (c) { return c.authorEmail === viewer.email; });
  if (!isOverseer && !participant) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail === viewer.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}
```

### 1-2. `hasAwaitingReply(viewer, postId, item, threadSeenMap)`

feed.html 2524~2537행 포팅, 동일 원칙(조건 무변경, `session`→`viewer`). `ADMIN_EMAIL`은 이 함수엔 등장하지 않으므로(팀장/임원 역할만 체크) 인자에 없다.

```javascript
function hasAwaitingReply(viewer, postId, item, threadSeenMap) {
  if (viewer.role !== '팀장' && viewer.role !== '임원') return false;
  const comments = item.comments || [];
  if (!comments.length) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail !== viewer.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}
```

### 1-3. `countNotificationsForViewer(viewer, entries, threadSeenMap, adminEmail)`

feed.html의 `updateNotifBadge()`(1419~1429행)가 하던 3개 건수 계산을 한 번에 묶은 신규 진입점. `entries`는 `getNotificationsTest`가 이미 만드는 것과 **정확히 같은 소스**(`feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail)`) — 별도의 날짜 필터나 다른 계산을 새로 만들지 않는다(재사용, index.js의 `getNotificationsTest` 714~750행 참고).

```javascript
function countNotificationsForViewer(viewer, entries, threadSeenMap, adminEmail) {
  let newPosts = 0, needsReply = 0, awaitingReply = 0;
  entries.forEach(function (entry) {
    if (entry.needsAttention) {
      newPosts += entry.items.filter(function (it) { return !it.confirmed; }).length;
    }
    entry.items.forEach(function (it) {
      if (hasUnreadReply(viewer, entry.post.id, it, threadSeenMap, adminEmail)) needsReply++;
      if (hasAwaitingReply(viewer, entry.post.id, it, threadSeenMap)) awaitingReply++;
    });
  });
  return { newPosts, needsReply, awaitingReply };
}
```

- `hasAwaitingReply`는 함수 안에서 이미 역할을 체크하므로(1-2절), `일반`/`담당` 뷰어에 대해선 자연히 0으로 나온다 — 클라이언트의 `if (showAwaiting) count += ...`처럼 바깥에서 미리 걸러낼 필요가 없다(결과는 같고, 코드는 더 단순해짐).

### 1-4. `buildThreadSeenIndex_(rows)` — 전체 사용자용 threadSeenMap 인덱스 (신규, 배치 전용)

`getThreadSeenTest`(index.js 715~763행)는 **한 사람**의 threadSeenMap만 만든다(요청자 이메일로 필터링). 배치 작업은 **40~50명 전원**의 threadSeenMap이 한 번에 필요하므로, 시트를 한 번만 읽고 이메일별로 미리 인덱싱해두는 함수가 새로 필요하다 — `getThreadSeenTest`의 시트 읽기 자체(`THREAD_SEEN_RANGE`)는 그대로 재사용하고, 필터링 부분만 "한 이메일"에서 "전체를 이메일별로 묶기"로 바꾼 것이다.

```javascript
// rows: 댓글확인이력 시트 원본 행(getThreadSeenTest와 동일한 THREAD_SEEN_RANGE에서 읽은 것).
// 반환: { [emailLower]: { 'postId-itemId': seenAtIso } } — 사용자 40~50명 전원 분을 한 번에.
function buildThreadSeenIndex_(rows) {
  const index = {};
  rows.forEach(function (row) {
    const emailLower = String(row[0]).toLowerCase();
    const key = row[1] + '-' + row[2];
    (index[emailLower] = index[emailLower] || {})[key] = row[3];
  });
  return index;
}
```

---

## 2. `pushBatchTest` — 신규 Cloud Run 함수 (5분 주기, Cloud Scheduler)

```javascript
// GET/POST /pushBatchTest — Cloud Scheduler가 5분마다 호출(재홍님 승인, 2026-08-28). 세션
// 인증 없음(사람이 직접 호출하는 API가 아니라 스케줄러 전용 — pingTest처럼 공개 API로
// 취급하지 않는다는 cloud-run/README.md 원칙과 동일선상). 대상: role !== '일반'인 사용자
// 전원(약 40~50명). 시트는 사용자당 다시 읽지 않고 딱 1번(+댓글확인이력 1번) 읽어서 메모리
// 에서 전원 계산 — 기존 getFeedTest 등과 동일한 "batchGet 1번" 패턴.
exports.pushBatchTest = async (req, res) => {
  const t0 = Date.now();
  try {
    const client = await getSheetsClient();
    const valueRanges = await batchGetValues(client, SPREADSHEET_ID,
      FEED_BATCH_RANGES.concat([THREAD_SEEN_RANGE]), { unformatted: true });

    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
    const allPosts = rowsToPosts((valueRanges[1] && valueRanges[1].values) || []);
    const allItems = rowsToItems((valueRanges[2] && valueRanges[2].values) || []);
    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);
    const threadSeenRows = (valueRanges[5] && valueRanges[5].values) || [];

    const leadScope = settings['팀장_열람범위'] || null;
    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
    const threadSeenIndex = feedEngine.buildThreadSeenIndex_(threadSeenRows);

    const authClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] }).getClient();
    const fcmProjectId = 'mro-market-intelligence'; // 실 배포 전 GCP 콘솔에서 재확인(4/5단계에서 이미 남긴 메모와 동일)

    const eligibleUsers = allUsers.filter(function (u) { return u.role !== '일반'; });
    let processed = 0;
    for (const userRow of eligibleUsers) {
      const viewer = feedEngine.findViewer(allUsers, userRow.email);
      if (!viewer) continue;
      const entries = feedEngine.buildFeedEntries(viewer, allPosts, allItems, allComments, leadScope, teamByEmail);
      const threadSeenMap = threadSeenIndex[String(viewer.email).toLowerCase()] || {};
      const counts = feedEngine.countNotificationsForViewer(viewer, entries, threadSeenMap, ADMIN_EMAIL);
      await pushSender.sendConsolidatedPushForUser(firestore, authClient, fcmProjectId, viewer.email, counts);
      processed++;
    }

    const serverMs = Date.now() - t0;
    res.status(200).json({ ok: true, serverMs, processed, totalUsers: allUsers.length });
  } catch (err) {
    const serverMs = Date.now() - t0;
    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
  }
};
```

- `authClient`는 **루프 시작 전 1번만** 만든다(5단계 설계 문서 2절에서 이미 정한 원칙 — 사용자마다 새로 만들지 않음).
- `title` 인자는 안 넘긴다 → 5단계 기본값 `'MRO 시황관리'` 그대로 사용(6단계는 커스텀 제목 불필요, 7~8단계 리마인더에서만 다른 제목 사용 예정).
- 규모(약 40~50명) 기준: 시트 batchGet 1회(6개 range) + 사용자 40~50명 순회(각자 메모리 계산, API 호출 없음) + 필요한 사람만 Firestore 조회/FCM 발송(5단계 상태 비교 덕분에 대부분 스킵) — 5분마다 이 정도 부하는 기존 `getFeedTest` 단일 호출 수준과 비슷하거나 더 가볍다. 별도 최적화 불필요.

### Cloud Scheduler 설정 (GCP 콘솔, 코드 아님)

- 새 스케줄 잡 1개 생성: `*/5 * * * *`(5분마다), 대상 `pushBatchTest` URL, HTTP GET 또는 POST.
- 인증 없이 호출 가능한 상태로 둘지, Scheduler 전용 서비스 계정으로 OIDC 인증을 걸지는 배포 시점에 결정(다른 `*Test` 함수들과 동일한 현재 공개 상태를 따르되, 필요시 Scheduler만 호출 가능하게 좁히는 것도 고려 가능 — 실제 배포 단계에서 재확인 권장).

---

## 3. 클릭 시 "알림" 탭 이동 (재홍님 승인 — `notificationclick` 확장 진행)

### 3-1. `sw.js`의 `notificationclick` 확장

기존 로직(4단계까지 전혀 안 건드림) 위에 **분기만 추가**한다 — 기존 `focus()`/`openWindow('./feed.html')` 자체는 그대로 두고, 그 앞뒤에 "알림 탭으로 가라"는 신호만 얹는다.

```javascript
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) {
          // push 6단계 — 이미 열려 있는 탭은 focus()만으로는 화면(탭)이 안 바뀌므로, 그 탭에
          // postMessage로 "알림 탭으로 가라"는 신호를 보낸다(3-2절의 feed.html 리스너가 받음).
          client.postMessage({ type: 'mro-push-click', view: 'notif' });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./feed.html?view=notif');
    })
  );
});
```

### 3-2. `feed.html`에 메시지/쿼리스트링 처리 추가 (신규 함수, 기존 함수 무변경)

```javascript
// push 6단계 — 알림 클릭으로 새로 열렸을 때(?view=notif) 또는 이미 열려 있던 탭이
// notificationclick의 postMessage를 받았을 때, "알림" 탭으로 전환한다. switchView는
// 기존 함수(수정 없음) 그대로 호출만 한다.
if (new URLSearchParams(location.search).get('view') === 'notif') {
  window.addEventListener('load', function () { switchView('notif'); });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'mro-push-click' && event.data.view === 'notif') {
      switchView('notif');
    }
  });
}
```

- `switchView('notif')`는 기존 함수를 그대로 호출만 하는 것이라 새로 정의하지 않는다(재사용).
- 세션이 아직 로딩 중일 때(`?view=notif`로 새로 연 직후) `switchView`가 바로 먹지 않을 수 있는 타이밍 문제는 실제 코드 diff 단계에서 `proceedAfterAuth()` 완료 이후로 미루는 처리를 추가할지 확인하겠다(설계 단계에서는 방향만 확정).

---

## 4. 에러 처리 요약

| 상황 | 처리 |
|---|---|
| `pushBatchTest` 실행 중 특정 사용자 계산에서 예외 발생 | 이번 설계엔 사용자별 try/catch가 없다 — **실제 코드 diff에서 사용자 1명 실패가 전체 루프를 중단시키지 않도록 사용자별 try/catch를 추가할지 여부를 diff에서 명시적으로 보여드리겠다**(지금 설계 문서에선 방향만 표시, 코드 세부는 diff 검토 시 확정). |
| 시트 batchGet 자체가 실패(네트워크 등) | 함수 전체가 500 반환, 이번 주기는 스킵 — 5분 뒤 다음 주기에 다시 시도되므로 별도 재시도 로직 불필요. |
| FCM 발송/토큰 무효화 | 5단계 `pushSender`가 이미 처리(변경 없음). |
| `pushBatchTest`가 예상보다 오래 걸림(예: 40~50명 계산이 5분보다 오래 걸림) | 이번 규모(40~50명)에서는 발생 가능성이 매우 낮다고 판단 — 실제 배포 후 `serverMs` 응답값으로 모니터링, 문제 생기면 그때 최적화(예: 배치 분할) 검토. |

---

## 5. 기존 시스템과의 관계 / rollback

| 건드리는 것 | 변경 성격 | 기존 로직 영향 |
|---|---|---|
| `lib/feedEngine.js` | 신규 함수 4개 추가(`hasUnreadReply`/`hasAwaitingReply`/`countNotificationsForViewer`/`buildThreadSeenIndex_`) | 없음 — 기존 12개 export 함수 전혀 안 건드림 |
| `index.js` | `pushBatchTest` 신규 함수 추가 | 없음 — 기존 함수 무변경 |
| `sw.js`의 `notificationclick` | 기존 `focus()`/`openWindow()` 로직 유지, `postMessage`/쿼리스트링 분기만 추가 | 클릭 시 동작이 "그냥 포커스/열기"에서 "알림 탭까지 전환"으로 **바뀜**(이게 이번 요청의 목적) — 로직 삭제는 없음 |
| `feed.html` | 신규 리스너 2개 추가(쿼리스트링 체크 + `message` 이벤트) | 없음 — `switchView` 등 기존 함수 호출만 함 |
| Cloud Scheduler | 신규 스케줄 1개 생성 | 없음 — 새 리소스 |
| `getNotificationsTest`/클라이언트 폴링 | 무영향 — 계속 그대로 동작 | 없음 |

rollback: Cloud Scheduler 스케줄을 끄면 배치 발송이 즉시 멈춘다(가장 빠른 되돌리기). `notificationclick`/`feed.html`의 추가분만 되돌리고 싶으면 그 두 곳의 diff만 git revert하면 되고, 클릭 시 동작이 4단계 상태(그냥 포커스/열기)로 돌아간다. `pushBatchTest`/`feedEngine.js` 신규 함수는 지우면 끝 — 다른 어떤 것도 참조하지 않는다.

---

## 다음 단계

이 문서가 승인되면 설계 문서 커밋까지만 진행(코드 없음, 지금까지와 동일한 방식). 그 다음 실제 코드는 이번에도 나눠서 보여드릴 계획인데, 이번엔 성격이 다른 3덩어리라 다음과 같이 나누는 걸 제안한다: (1) `lib/feedEngine.js` 확장 4개 함수, (2) `index.js`의 `pushBatchTest` 신규 함수, (3) `sw.js`+`feed.html`의 클릭-탭전환 연결. 순서나 분할 방식에 이견 있으면 diff 준비 전에 말씀해달라.
