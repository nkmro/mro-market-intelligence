# MRO 알림/푸시/리마인더 — 3단계 설계: Firestore 컬렉션 + sw.js push 리스너

상태: **설계 문서 — 코드 작성/GitHub 커밋(이 문서 자체 제외)/Cloud Run·Apps Script 배포/Firestore 구조 변경 전혀 하지 않음.** `NOTIFICATION_PUSH_REMINDER_ANALYSIS_AND_PLAN.md`(1~2부, 전체 분석/계획)의 후속 문서이며, 10단계 계획 중 3단계에 해당한다.

## 확정된 결정 사항 (2단계에서 승인됨)

1. 새 카테고리 "댓글 필요"/"답변 요청"은 요청서 문구가 아니라 **기존 화면 탭의 실제 판단 기준**(`hasUnreadReply`/`hasAwaitingReply`, feed.html 2397~2415행)을 그대로 따른다 — 화면에서 보는 의미와 푸시의 의미가 달라지지 않도록 하기 위함.
2. README(`cloud-run/README.md`, `apps-script/README.md`) 최신화는 이번 기능 개발과 함께 진행한다(10단계 중 10단계 "통합 테스트 + README 갱신"에서 반영).

이 두 결정에 따라, 아래 3가지 판단 로직을 **클라이언트 코드를 그대로 복사하지 않고, 서버(Cloud Run)에서 같은 조건으로 새로 구현**해야 한다(현재 두 함수는 100% 클라이언트 전용이라 서버에 대응물이 없음).

```javascript
// feed.html 2397~2411행 원본 (참고용, 이번 문서에서 수정하지 않음)
function hasUnreadReply(postId, item) {
  if (!threadSeenMapLoaded) return false;
  const comments = item.comments || [];
  if (!comments.length) return false;
  const isOverseer = session.role === '팀장' || session.role === '임원' || session.email === ADMIN_EMAIL;
  const participant = comments.some(function (c) { return c.authorEmail === session.email; });
  if (!isOverseer && !participant) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail === session.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}

// feed.html 2413~2415행 원본
function hasAwaitingReply(postId, item) {
  if (!threadSeenMapLoaded) return false;
  if (session.role !== '팀장' && session.role !== '임원') return false;
  const comments = item.comments || [];
  if (!comments.length) return false;
  const sorted = comments.slice().sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  const last = sorted[sorted.length - 1];
  if (last.authorEmail !== session.email) return false;
  const key = postId + '-' + item.itemId;
  const seenAt = threadSeenMap[key];
  if (!seenAt) return true;
  return new Date(last.createdAt) > new Date(seenAt);
}
```

---

## 1. Firestore 컬렉션 설계

### 1.1 `pushSubscriptions` — 문서 ID: `{email}_{deviceId}`

| 필드 | 타입 | 설명 |
|---|---|---|
| email | string | 사용자 이메일 |
| deviceId | string | 기기별 고유값(클라이언트가 최초 1회 생성해 localStorage에 보관 — 한 사람이 폰+PC 등 여러 기기를 쓸 수 있으므로 이메일만으로는 부족) |
| fcmToken | string | FCM 발급 토큰 |
| userAgent | string | 참고/디버깅용(선택) |
| createdAt / updatedAt | Timestamp | 등록/갱신 시각 |
| active | boolean | true=발송 대상. 삭제 대신 비활성화로 관리(아래 4장 참고) |

### 1.2 `reminderDeliveries` — 문서 ID: `{date:YYYYMMDD}_{email}` (7~8단계에서 사용, 스키마만 확정)

| 필드 | 설명 |
|---|---|
| email, date | 누구에게, 언제 |
| itemIds | 그날 리마인더에 포함된 품목 목록 |
| sentAt | 발송 시각(중복 발송 방지 — 문서 존재 여부로 판단) |

### 1.3 `pushNotifyState` — 문서 ID: `{email}` (5~6단계에서 사용, 스키마 확정)

| 필드 | 설명 |
|---|---|
| lastPushSentAt | 마지막으로 통합 푸시를 보낸 시각 |
| lastNotifiedKeys | 그 푸시에 포함됐던 항목 키 목록(`postId-itemId` 등, 중복 재발송 방지용) |

---

## 2. `pushNotifyState`의 역할 경계 (보완 1)

이 컬렉션이 기존 알림 시스템과 **완전히 분리된, 별개의 목적**을 갖도록 명확히 선을 긋는다.

| | 기존 인앱 알림(배지/알림함 3탭) | 신규 `pushNotifyState` 기반 푸시 |
|---|---|---|
| 언제 동작하나 | **앱이 열려 있을 때만.** `pollTimer`(30초 간격)가 매번 서버에 물어서 "지금 상태"를 그대로 다시 계산해 보여줌 | **앱이 백그라운드/종료 상태일 때를 위한 것.** 앱이 열려 있지 않으면 pollTimer 자체가 없으므로 이 경로가 유일한 통지 수단 |
| 상태를 기억하나 | **아니다.** 매번 서버 데이터를 다시 읽어서 "지금 조건에 맞는 것"만 새로 계산 — 과거에 뭘 보여줬는지 별도로 기록하지 않음(그때그때 실시간 상태 그대로) | **그렇다.** "이미 푸시로 알린 항목"을 기억해뒀다가, 다음에 또 조건이 참이어도 재발송하지 않기 위한 목적의 상태 저장소 |
| 왜 다르게 만들었나 | 앱이 열려 있으면 화면 자체가 항상 최신 상태를 보여주므로 "중복 알림"이라는 개념이 필요 없음 | 푸시는 한 번 사용자 눈에 띄면 그걸로 역할이 끝나는 "이벤트"이기 때문에, 같은 이벤트를 반복해서 푸시로 또 보내면 스팸처럼 느껴짐 — 그래서 "보낸 적 있는지" 기억이 반드시 필요함 |
| 알림 배지 개수(종류별)에 영향을 주나 | 그 자체가 배지 개수의 원천(요청 [10] "알림 배지는 종류별 유지") | **주지 않는다.** `pushNotifyState`는 오직 "푸시를 보낼지 말지" 판단에만 쓰이고, 인앱 배지 숫자 계산 로직(`updateNotifBadge` 등)은 지금처럼 실시간 재계산 방식을 그대로 유지 — 이 컬렉션을 참조하지 않는다 |

**한 줄 요약 원칙**: *`pushNotifyState`는 "푸시 발송 여부"만 결정하는 별도 장부이며, 인앱 알림(배지/알림함)의 계산 방식·데이터에는 관여하지 않는다. 인앱 알림은 지금처럼 항상 실시간으로 다시 계산된다.*

**앱이 "열려 있는 동안"에도 푸시를 보낼지에 대한 추가 제안**: 사용자가 지금 화면을 보고 있는데 동시에 휴대폰이 울리면 오히려 방해가 될 수 있다. Firestore `sessions` 컬렉션은 이미 요청마다 `expiresAt`을 갱신하는 방식으로 "최근 활동 시각"을 들고 있으므로(슬라이딩 세션), 이를 재사용해 **세션이 최근 2분 이내에 갱신된 경우("앱이 지금 열려서 폴링 중"으로 간주)는 푸시를 생략**하고 인앱 배지 갱신에만 맡기는 방식을 제안한다. 이 판단 하나를 위해 별도 컬렉션/필드를 새로 만들 필요 없이 기존 세션 데이터를 그대로 활용한다.

---

## 3. FCM 토큰 갱신/만료 처리 (보완 2 — 4단계 설계에 포함될 내용)

FCM 토큰은 브라우저가 임의로 재발급하거나(장기 미사용, 브라우저 데이터 초기화 등), 사용자가 알림 권한을 껐다 켜는 경우 등으로 바뀔 수 있다. 웹 환경에서는 네이티브 앱과 달리 "토큰이 바뀌었다"는 이벤트를 브라우저가 알아서 push해주지 않으므로, 클라이언트가 스스로 확인하는 방식을 쓴다.

**클라이언트 흐름 (4단계에서 구현)**:
1. `feed.html` 로드 시(로그인 직후), 알림 권한이 이미 허용된 상태라면 `getToken()`을 호출해 현재 유효한 FCM 토큰을 가져온다.
2. 이 값을 `localStorage`에 저장해둔 이전 토큰과 비교한다.
3. **다르면(최초 등록 포함) `registerPushSubscriptionTest`(신규 Cloud Run 함수)를 다시 호출**해서 `pushSubscriptions` 문서를 갱신(upsert)한다. 같으면 아무것도 안 함(불필요한 쓰기 방지).
4. 서버 쪽 `registerPushSubscriptionTest`는 `pushSubscriptions/{email}_{deviceId}` 문서를 **merge 방식으로 upsert**(`fcmToken`, `updatedAt`, `active:true` 갱신) — 기존 `withIdempotency`/`writeLock` 패턴처럼 존재 여부를 먼저 확인 후 처리.

**서버 쪽 만료 감지 (5~6단계 발송 로직에 포함)**: FCM 발송 API가 "이 토큰은 더 이상 유효하지 않다"(`messaging/registration-token-not-registered` 등)는 응답을 주면, 그 발송 시도 코드가 **해당 구독 문서를 즉시 `active:false`로 갱신**한다(발송 실패해도 나머지 사용자 발송은 계속 진행 — 기존 `withIdempotency`의 "하나 실패해도 전체를 막지 않는다" 원칙과 동일). 별도의 정기 점검 배치는 이번 단계에서는 만들지 않고, 필요성이 확인되면 10단계 이후 추가 제안한다.

---

## 4. 클라이언트-서버 판단 기준 동기화 원칙 (보완 3)

`hasUnreadReply`/`hasAwaitingReply`는 feed.html(브라우저)과 새로 만들 서버 함수, 두 군데에 코드가 존재하게 된다. 시간이 지나며 한쪽만 수정되어 둘이 어긋나는 것(client-server drift)을 막기 위해 아래 3가지를 원칙으로 못박는다.

1. **데이터 소스 고정**: 서버 함수도 클라이언트와 완전히 동일한 원본 데이터(`댓글확인이력`/`SHEET_THREAD_SEEN` 시트)를 사용한다. 별도의 사본을 만들지 않고, 이미 있는 `getThreadSeenTest`/`getThreadSeenMap_` 조회 로직을 그대로 통해서 읽는다.
2. **동일한 이름·동일한 파라미터 구조로 이식**: `cloud-run/mro-functions/lib/feedEngine.js`에 `hasUnreadReply(viewer, item, threadSeenMap)` / `hasAwaitingReply(viewer, item, threadSeenMap)`라는 이름으로(클라이언트와 함수명 동일, 전역변수 대신 인자로 받는 것만 다름) 조건문을 한 글자도 바꾸지 않고 그대로 옮긴다. 각 함수 위에 "feed.html 2397행 대응, 조건 변경 금지"라는 주석을 남긴다(기존 `feedEngine.js`의 다른 함수들이 이미 이렇게 "Code.gs 대응:" 주석을 남기는 관례를 따름).
3. **패리티 테스트로 검증**: 이 저장소가 지금까지의 모든 Cloud Run 이전 작업(`getusers-parity`, `postcomment-parity`, `upsertitem-upsertcustomer-parity` 등)에 적용해온 것과 동일한 방식으로, 다양한 시나리오(참여자/비참여자, 팀장/임원/일반, 마지막 댓글 작성자가 나인 경우/아닌 경우, 확인 기록 없음/있음 등)에 대해 클라이언트 로직과 서버 로직의 출력이 한 글자도 다르지 않은지 비교하는 패리티 테스트를 먼저 만들고 통과를 확인한 뒤에만 실제 발송 로직에 연결한다(5~6단계에서 수행). 또한 `cloud-run/README.md`의 "앞으로 지켜야 할 원칙"에 "feed.html의 hasUnreadReply/hasAwaitingReply를 수정하면 반드시 lib/feedEngine.js의 대응 함수도 함께 갱신하고 패리티 테스트를 다시 실행할 것"이라는 항목을 추가한다(10단계 README 갱신에 포함).

---

## 5. sw.js 설계 (push 수신 + 알림 클릭 시 이동, 발송 인프라는 4단계 이후)

```javascript
self.addEventListener('push', function (event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {}
  const title = payload.title || 'MRO 시황';
  const body = payload.body || '새 알림이 있습니다';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: './icon-192.png',
      data: { target: 'notif' } // 특정 게시글이 아니라 "알림" 탭으로만 이동(요청 [4])
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'GO_TO_NOTIF_TAB' }); // 이미 열려있으면 새 창 없이 탭만 전환(중복 화면 방지)
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./feed.html#notif');
    })
  );
});
```

feed.html 쪽(6단계에서 구현 예정, 이번 문서에서는 코드 작성 안 함): 로드 시 `location.hash === '#notif'`면 알림 탭 전환 + `navigator.serviceWorker`의 `message` 이벤트로 `GO_TO_NOTIF_TAB` 수신 시 동일 처리. 기존 `fetch` 핸들러(캐싱 전략 금지 원칙)는 그대로 유지, 건드리지 않는다.

---

## 다음 단계

이 문서 승인 후: (1) 이 문서를 저장소에 커밋(문서만, 코드 없음), (2) 4단계(FCM 프로젝트 연결 + `registerPushSubscriptionTest` + 클라이언트 등록/토큰갱신 흐름) 설계로 진행.
