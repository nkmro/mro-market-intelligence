# 5단계 설계: 통합 푸시 발송 공통 모듈 (`lib/pushSender.js`)

상태: 설계 초안 (코드 없음, 검토/승인 대기)
선행 단계: 1~4단계 완료(로그아웃 배지 `79e2a6b`, Firestore 스키마+역할경계 `127510f`, FCM 연결+구독등록 `beb4e56`/`18ed431`/`08c06d5`/`bdae10e`)
전제: 이 문서는 `PUSH_NOTIFICATION_STAGE3_DESIGN.md`(Firestore 스키마·역할 경계)와 `PUSH_NOTIFICATION_STAGE4_DESIGN.md`(FCM 인증 방식)를 그대로 따른다. 두 문서의 결론을 다시 바꾸지 않는다.

---

## 0. 이 모듈의 역할 경계 (무엇을 하고, 무엇을 안 하나)

`NOTIFICATION_PUSH_REMINDER_ANALYSIS_AND_PLAN.md` 3.1-4번의 "통합 푸시 발송 로직" — 한 사용자에게 보낼 알림이 여러 개여도 푸시는 1개로 합쳐서 발송(0건 항목 제외) — 를 구현하는 공통 모듈이다.

| 이 모듈이 하는 일 | 이 모듈이 하지 않는 일 (다음 단계 몫) |
|---|---|
| "새 게시물 N건 / 댓글 필요 N건 / 답변 요청 N건" 같은 **이미 계산된 건수**를 받아서, 문구를 만들고, 중복 발송을 걸러내고, 실제로 FCM에 발송 | 새 게시물/댓글 필요/답변 요청이 각각 몇 건인지 **계산하는 로직** — 이건 6단계에서 `lib/feedEngine.js`의 기존 `needsAttentionFor`/`buildFeedEntries`(이미 있는 함수, 2단계에서 확정한 화면 탭 기준과 동일)를 그대로 재사용해서 호출부가 넘겨준다. 여기서 그 판단 기준을 다시 만들지 않는다. |
| 사용자별 `pushSubscriptions`(활성 기기 전체)에 발송 | 담당자 댓글 리마인더의 "누구에게 보낼지" 계산 — 그건 7~8단계 몫 |
| `pushNotifyState/{email}`로 "마지막으로 보낸 상태"를 기억해서 상태 안 바뀌면 재발송 안 함 | Cloud Scheduler 연결 — 8단계 몫 |

이번 5단계는 **모듈만 만든다** — 아직 기존 3종 알림(새 게시물/댓글 필요/답변 요청)의 실제 계산 결과와 연결하지 않는다(그건 6단계). 즉 이 모듈이 만들어져도, 6단계가 끝나기 전까지는 실제로 아무 데서도 호출되지 않는다 — 기존 시스템에 어떤 영향도 없는 순수 추가 상태가 이번 단계에서도 유지된다.

---

## 1. 핵심 함수 설계

파일: `cloud-run/mro-functions/lib/pushSender.js` (신규 모듈, `lib/feedEngine.js`/`lib/writeIdempotency.js`와 같은 위치·스타일)

### 1-1. `buildConsolidatedMessage_(counts, title)` — 문구 생성 (순수 함수)

```javascript
// counts: { newPosts, needsReply, awaitingReply } (전부 0 이상 정수, 6단계 호출부가 계산해서 넘김)
// title: 선택 인자. 생략하면 'MRO 시황관리'(6단계, 기존 3종 알림용 기본값). 7~8단계 담당자
// 댓글 리마인더처럼 다른 문구가 필요한 호출부는 이 인자로 넘기면 된다(재홍님 보완 1번,
// 2026-08-28 — "리마인더는 '담당 게시글 확인 필요' 같은 다른 제목이 필요할 수 있다").
// 반환: { title, body } 또는 null(전부 0건이면 보낼 내용이 없다는 뜻)
function buildConsolidatedMessage_(counts, title) {
  const parts = [];
  if (counts.newPosts > 0) parts.push('새 게시물 ' + counts.newPosts + '건');
  if (counts.needsReply > 0) parts.push('댓글 필요 ' + counts.needsReply + '건');
  if (counts.awaitingReply > 0) parts.push('답변 요청 ' + counts.awaitingReply + '건');
  if (parts.length === 0) return null;
  return { title: title || 'MRO 시황관리', body: parts.join(' · ') };
}
```

- 0건인 카테고리는 문구에서 빠진다(계획서 3.1-4번 그대로).
- 셋 다 0건이면 `null` — 호출부는 이 경우 "보낼 게 없음"으로 처리한다(아래 2절).
- `title`을 생략(또는 falsy 값)하면 기본값 `'MRO 시황관리'`를 쓴다 — 기존 호출부(6단계)는 아무것도 안 바꿔도 그대로 동작한다.

### 1-2. `buildStateSignature_(counts)` — 중복 발송 판단용 서명

```javascript
// 상태가 바뀌었는지 비교하기 위한 간단한 문자열 서명. 세 숫자만 반영 — 게시물/댓글의 실제
// 내용까지 비교하지 않는다(설계 의도: "건수가 그대로면 이미 알고 있는 상태"로 간주).
function buildStateSignature_(counts) {
  return counts.newPosts + '-' + counts.needsReply + '-' + counts.awaitingReply;
}
```

### 1-3. `isSessionRecentlyActive_(firestore, email)` — "앱이 지금 열려 있나" 판단

PUSH_NOTIFICATION_STAGE3_DESIGN.md 2절에서 제안한 휴리스틱을 실제 함수로 옮긴 것 — 새 필드를 추가하지 않고, `sessions` 컬렉션의 기존 슬라이딩 TTL(`authenticateSession`이 매 요청마다 `expiresAt = now + 6시간`으로 갱신하는 것, `lib/auth.js`)을 거꾸로 이용한다: `expiresAt - 6시간`이 곧 "마지막으로 서버에 요청을 보낸 시각"이다.

**[재홍님 보완 2번 확인 완료, 2026-08-28]** `lib/auth.js`가 실제로 `SESSION_TTL_MS`를 export하는지 지금 이 시점에 직접 코드로 재확인했다 — `module.exports = { authenticateSession, touchSession, SESSION_TTL_MS };` (56행), **export되어 있음을 확인**. 그래서 별도 상수를 새로 정의하거나 `lib/auth.js`를 수정할 필요 없이, 그냥 `require('./auth')`로 가져다 쓰면 된다(아래 코드에 반영).

```javascript
const { SESSION_TTL_MS } = require('./auth'); // lib/auth.js가 이미 export 중임을 확인 완료(위 메모)
const SESSION_ACTIVE_WINDOW_MS = 2 * 60 * 1000; // 2분 — 폴링 주기(수 초~수십 초 단위)보다 넉넉하게
async function isSessionRecentlyActive_(firestore, email) {
  const snap = await firestore.collection('sessions').where('email', '==', email).get();
  const now = Date.now();
  let recentlyActive = false;
  snap.forEach(function (doc) {
    const expiresAtRaw = doc.data().expiresAt;
    const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate().getTime() : new Date(expiresAtRaw).getTime();
    const lastTouchedAt = expiresAt - SESSION_TTL_MS; // 위에서 require('./auth')로 가져온 바로 그 상수
    if (now - lastTouchedAt < SESSION_ACTIVE_WINDOW_MS) recentlyActive = true;
  });
  return recentlyActive;
}
```

- 여러 기기에서 로그인해 있으면 세션 문서가 여러 개일 수 있다 — **그중 하나라도** 최근 2분 이내에 활동했으면 "앱 열려 있음"으로 간주한다.
- `sessions` 컬렉션에 `email` 필드 단일 조건 쿼리는 Firestore가 기본 자동 색인하는 형태라 별도 복합 색인 설정이 필요 없다.

### 1-4. `getActiveSubscriptions_(firestore, email)` — 발송 대상 기기 조회

```javascript
async function getActiveSubscriptions_(firestore, email) {
  const snap = await firestore.collection('pushSubscriptions')
    .where('email', '==', email)
    .where('active', '==', true)
    .get();
  return snap.docs; // 각 doc.data().fcmToken, doc.ref(비활성화 처리용)
}
```

- `email` + `active` 복합 조건 쿼리라 Firestore 콘솔에서 복합 색인을 한 번 만들어야 할 수 있다(실제 배포 시 첫 호출에서 색인 안내 링크가 에러로 뜨면 그 링크로 생성 — 신규 컬렉션 첫 복합쿼리에서 흔한 1회성 작업).

### 1-5. `sendFcmMessage_(authClient, fcmProjectId, token, message)` — 개별 기기 발송

```javascript
// FCM HTTP v1 API는 한 번의 요청으로 토큰 여러 개에 보낼 수 없다(멀티캐스트 미지원 —
// Admin SDK의 sendEachForMulticast()도 내부적으로 토큰마다 개별 요청을 반복하는 것일 뿐,
// REST API 자체에 그런 기능이 없음. 공식 확인 완료). 그래서 기기(토큰)마다 한 번씩 호출한다
// — 한 사용자가 보통 1~3개 기기로 로그인하는 정도라 문제 되는 양이 아니다.
async function sendFcmMessage_(authClient, fcmProjectId, token, message) {
  const url = `https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`;
  try {
    await authClient.request({
      url,
      method: 'POST',
      data: {
        message: {
          token: token,
          // "notification"이 아니라 "data"만 보낸다 — sw.js가 onBackgroundMessage에서 직접
          // showNotification()을 호출하도록(설계 문서 4-5절, 이미 커밋된 sw.js와 일치).
          data: { title: message.title, body: message.body }
        }
      }
    });
    return { ok: true };
  } catch (err) {
    const errorCode = err && err.response && err.response.data && err.response.data.error &&
      err.response.data.error.details && err.response.data.error.details[0] && err.response.data.error.details[0].errorCode;
    // UNREGISTERED: 토큰이 더 이상 유효하지 않음(기기에서 로그아웃/앱 삭제/토큰 회전 등).
    // INVALID_ARGUMENT: 토큰 형식 자체가 잘못됨. 둘 다 "이 토큰은 이제 못 쓴다"는 뜻이라
    // 구독을 비활성화해야 하는 케이스로 묶는다(설계 문서 4-3절에서 이미 정한 기준).
    const invalidToken = errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT';
    return { ok: false, invalidToken, error: errorCode || String((err && err.message) || err) };
  }
}
```

### 1-6. `sendConsolidatedPushForUser(firestore, authClient, fcmProjectId, email, counts, title)` — 진입점

```javascript
// title: 선택 인자, buildConsolidatedMessage_로 그대로 전달(재홍님 보완 1번). 생략하면
// 'MRO 시황관리' — 6단계(기존 3종 알림)는 이 인자를 아예 안 넘겨도 그대로 동작한다.
async function sendConsolidatedPushForUser(firestore, authClient, fcmProjectId, email, counts, title) {
  const message = buildConsolidatedMessage_(counts, title);
  const signature = buildStateSignature_(counts);
  const stateRef = firestore.collection('pushNotifyState').doc(email);

  if (!message) {
    // 보낼 내용이 없다 — 상태만 "빈 상태"로 기록해두고 끝낸다(다음에 다시 건수가 생기면
    // 새 서명과 비교되어 정상적으로 발송된다).
    await stateRef.set({ lastSignature: '', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { sent: false, reason: 'NO_CONTENT' };
  }

  const stateSnap = await stateRef.get();
  if (stateSnap.exists && stateSnap.data().lastSignature === signature) {
    return { sent: false, reason: 'UNCHANGED_STATE' };
  }

  if (await isSessionRecentlyActive_(firestore, email)) {
    // 앱이 지금 열려 있으면 이미 화면에서 실시간으로 보고 있다 — 푸시는 안 보내지만, "이 상태를
    // 봤다"는 사실은 기록해서 앱을 닫는 순간 같은 내용으로 또 푸시가 나가지 않게 한다
    // (설계 문서 2절의 역할 경계: pushNotifyState는 발송 중복 방지 전용, 인앱 표시와 무관).
    await stateRef.set({ lastSignature: signature, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { sent: false, reason: 'APP_OPEN' };
  }

  const subscriptions = await getActiveSubscriptions_(firestore, email);
  let sentCount = 0;
  let deactivatedCount = 0;
  for (const doc of subscriptions) {
    const result = await sendFcmMessage_(authClient, fcmProjectId, doc.data().fcmToken, message);
    if (result.ok) {
      sentCount++;
    } else if (result.invalidToken) {
      await doc.ref.set({ active: false, deactivatedAt: FieldValue.serverTimestamp(), deactivatedReason: result.error }, { merge: true });
      deactivatedCount++;
    }
    // invalidToken이 아닌 실패(일시적 오류 등)는 그냥 넘어간다 — 다음 발송 주기에 다시 시도된다.
  }

  await stateRef.set({
    lastSignature: signature,
    lastMessage: message,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  return { sent: sentCount > 0, sentCount, deactivatedCount, subscriptionCount: subscriptions.length };
}

module.exports = { sendConsolidatedPushForUser, buildConsolidatedMessage_, buildStateSignature_ };
```

- 마지막 3개(`buildConsolidatedMessage_`/`buildStateSignature_`도 함께 export)는 6단계에서 "발송 전에 미리 문구만 확인해보고 싶을 때"나 parity 테스트 작성 시 재사용하기 위함이다(기존 lib/ 모듈들도 순수 함수는 개별 export해서 테스트하기 쉽게 해둔 것과 같은 패턴).

---

## 2. FCM 인증/프로젝트 ID

- `authClient`/`fcmProjectId`는 이 모듈이 직접 만들지 않고 **호출부(6단계 이후 실제 트리거 함수)에서 주입받는다** — 이 모듈을 매번 호출할 때마다 새로 `GoogleAuth`를 만들지 않아도 되게 하기 위함(트리거 함수 하나가 여러 사용자에게 순차 발송할 때 매번 토큰을 새로 받지 않도록).
- `fcmProjectId`는 기존 Cloud Run 함수 URL 패턴(`https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/...`)에서 프로젝트 ID가 `mro-market-intelligence`로 추정된다 — **실제 배포 전에 GCP 콘솔에서 정확한 프로젝트 ID를 한 번 더 확인 필요**(URL의 리전 접두사와 프로젝트 ID가 붙어 있어 정확히 분리했는지 확인 차원).
- 인증 스코프(`https://www.googleapis.com/auth/firebase.messaging`)와 ADC 사용 방식은 4단계 설계 문서 0절/1-2절에서 이미 확인 완료한 그대로 재사용한다 — 여기서 다시 검증하지 않는다.

---

## 3. 에러 처리 요약 (표)

| 상황 | 처리 |
|---|---|
| FCM 발송 성공 | `sentCount` 증가 |
| 토큰 무효(`UNREGISTERED`/`INVALID_ARGUMENT`) | 해당 `pushSubscriptions` 문서를 `active:false`로 전환(3-4단계 설계에서 이미 정한 기준) |
| 그 외 실패(일시적 오류, 네트워크 등) | 그냥 넘어감 — 재시도는 다음 발송 주기(폴링/스케줄러)가 자연히 담당, 이 모듈 안에서 재시도 로직을 따로 만들지 않는다(과도한 안전장치 지양 원칙) |
| 활성 구독이 0개인 사용자 | `subscriptions.length === 0`이라 for 루프가 그냥 안 돌고 `sentCount:0`으로 끝남 — 별도 예외 처리 불필요 |
| `pushNotifyState` 문서가 아직 없는 최초 호출 | `stateSnap.exists`가 false라 "상태 다름"으로 자연히 처리되어 정상 발송 |

---

## 4. 기존 시스템과의 관계 / rollback

| 건드리는 것 | 변경 성격 | 기존 로직 영향 |
|---|---|---|
| `cloud-run/mro-functions/lib/pushSender.js` | **신규 파일** | 없음 — 새 파일이라 기존 코드 자체를 건드릴 게 없음 |
| Firestore `pushNotifyState` | 신규 컬렉션(3단계 설계에서 이미 스키마 확정, 이번에 실제로 쓰기 시작) | 없음 |
| Firestore `pushSubscriptions` | 기존 문서에 `active:false`/`deactivatedAt`/`deactivatedReason` 필드 추가(토큰 무효 시) | `email`/`fcmToken`/`deviceId` 등 4단계에서 쓴 기존 필드는 안 건드림 — 새 필드 추가뿐 |
| `sessions` 컬렉션 | **읽기만** 한다(조회 전용, `where` 쿼리) | 전혀 안 건드림 |

이 모듈은 아직 어디에서도 호출되지 않으므로(0절 참고), rollback은 사실상 "이 파일과 이 파일만 참조하는 `require`문을 지우면 끝"이다. 6단계에서 실제로 연결한 뒤에는, 그 연결 지점만 되돌리면 이 모듈 자체는 그대로 둬도 아무 영향이 없다.

---

## 다음 단계

이 문서가 승인되면 설계 문서 커밋까지만 진행(3~4단계와 동일한 방식, 코드 없음). 그다음 실제 코드는 이번에도 나눠서 보여드릴 계획인데, 이번엔 파일이 하나(`lib/pushSender.js` 신규)뿐이라 diff를 1개로 준비할지, 아니면 "핵심 발송 로직"과 "에러/비활성화 처리"로 나눌지 여쭤보고 진행하겠습니다. 6단계(기존 3종 알림을 이 모듈에 실제로 연결)는 그 다음입니다.
