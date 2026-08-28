# 4단계 설계: FCM 프로젝트 연결 + registerPushSubscriptionTest + 클라이언트 등록/토큰 갱신

상태: 설계 초안 (코드 없음, 검토/승인 대기)
선행 단계: 1단계(로그아웃 배지, 커밋 `79e2a6b`), 2단계(카테고리 정의 확정), 3단계(Firestore 스키마 + 역할 경계, 커밋 `127510f`) 완료
전제: 이 문서의 모든 내용은 3단계 설계 문서(`PUSH_NOTIFICATION_STAGE3_DESIGN.md`)의 `pushSubscriptions` 컬렉션 스키마를 그대로 따른다. 여기서 스키마를 다시 바꾸지 않는다.

---

## 0. 사실 확인 (설계 근거)

아래 3가지는 이번 설계를 실제로 구현했을 때 틀리면 안 되는 부분이라, 코드를 쓰기 전에 공식 문서로 확인했다.

| 확인 항목 | 결과 | 출처 |
|---|---|---|
| 서버가 FCM 메시지를 보낼 때 필요한 OAuth 스코프 | `https://www.googleapis.com/auth/firebase.messaging` | [FCM 서버 인증 문서](https://firebase.google.com/docs/cloud-messaging/auth-server) |
| 서비스 계정 키 파일 없이(ADC만으로) 인증 가능한가 | 가능 — Cloud Run에 붙은 서비스 계정 자격으로 ADC가 자동 동작 | 위 문서 |
| 기존 sw.js가 아닌 별도의 `firebase-messaging-sw.js`가 반드시 필요한가 | 아니다 — 기존 서비스워커에 `importScripts`로 Firebase 스크립트를 불러오고, `getToken()`에 기존 서비스워커 등록을 넘기는 방식이 공식 지원됨 | [FCM 메시지 수신 문서](https://firebase.google.com/docs/cloud-messaging/web/receive-messages) |

현재 `cloud-run/mro-functions/package.json`을 확인한 결과, 이미 `google-auth-library`(`GoogleAuth`)와 `@google-cloud/firestore`가 의존성으로 들어있고, `index.js`의 기존 모든 함수(Sheets 접근)가 `new GoogleAuth({ scopes: [...] })` 패턴으로 ADC를 쓰고 있다. **이번 설계는 이 패턴을 FCM에도 그대로 재사용한다 — `firebase-admin` 같은 새 패키지를 추가하지 않는다.**

---

## 1. FCM 프로젝트 연결 방식

### 1-1. Firebase ↔ GCP 프로젝트 연동

- 새 프로젝트를 만드는 게 아니라, **Firebase 콘솔에서 "프로젝트 추가" 시 기존에 쓰고 있는 GCP 프로젝트(Cloud Run/Firestore가 이미 올라가 있는 그 프로젝트)를 선택**해서 Firebase 기능만 얹는다. 이 작업은 콘솔에서 클릭 몇 번으로 끝나는 1회성 설정이고, 코드 변경이 아니다.
- Firestore는 이미 Native 모드로 사용 중(트랜잭션 기반 `writeLock.js`/`writeIdempotency.js`가 이미 동작 중이므로)이라, Firebase를 추가해도 Firestore 자체는 그대로 유지된다. FCM은 Firestore와 독립된 별개 서비스라 서로 영향을 주지 않는다.
- 비용: FCM 메시지 발송 자체는 무료 플랜(Spark)에서도 제공되는 기능이라, 이번 연동으로 새로운 청구 항목이 생기지 않는다(3단계 문서에서 확인한 Firestore 무료 한도와 별개로, FCM은 별도로 무료).

### 1-2. 서비스 계정 권한

- 새 서비스 계정을 만들지 않는다. Cloud Run 함수들이 이미 사용 중인 **기존 런타임 서비스 계정**에 IAM 역할 하나만 추가로 부여한다: **"Firebase Cloud Messaging API 관리자"(`roles/firebasecloudmessaging.admin`)**.
  - 이 부여는 GCP 콘솔 IAM 화면에서 체크박스 하나 추가하는 1회성 작업이며, 코드나 커밋에 전혀 나타나지 않는다.
- 서버 코드에서는 `new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })`로 토큰을 받아 FCM HTTP v1 REST 엔드포인트(`https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`)를 직접 호출한다. 기존 Sheets 접근 코드와 완전히 동일한 모양이라, 다른 개발자가 봐도 낯설지 않다.

### 1-3. 새 Secret/API Key 필요 여부

| 값 | 성격 | 어디에 두나 |
|---|---|---|
| 서버 측 인증 | 불필요 (ADC 재사용) | 없음 — 새 시크릿 없음 |
| Firebase 웹 설정값(`apiKey`, `projectId`, `messagingSenderId`, `appId`) | **공개값** — Firebase 자체 문서상 웹 API 키는 비밀정보가 아니며, 보안은 Firestore 보안 규칙/서버 측 세션 검증으로 함 | `feed.html`에 상수로 포함, GitHub 커밋 가능 |
| VAPID 공개키(Web Push 인증서의 공개키) | **공개값** — 이름 그대로 "공개"키, 클라이언트가 `getToken()` 호출 시 넘기는 용도 | `feed.html`에 상수로 포함, GitHub 커밋 가능 |

이 표의 핵심은: **이번 4단계에서 "진짜 지켜야 하는 비밀"은 하나도 새로 생기지 않는다.** 기존 Apps Script Script Properties에 있는 DEEPSEEK/GEMINI/NAVER API 키 같은 진짜 시크릿과는 성격이 다르다 — 저것들은 절대 코드에 넣으면 안 되지만, Firebase 웹 설정값과 VAPID 공개키는 애초에 클라이언트(브라우저)에 노출되는 것을 전제로 설계된 값이다. "불필요한 새 시크릿을 만들지 않는다"는 기존 원칙을 그대로 지킨다.

---

## 2. `registerPushSubscriptionTest` Cloud Run 함수 설계

### 2-1. 요청/응답

```
POST /registerPushSubscriptionTest
Request:
{
  "sessionToken": "...",   // 기존 세션 토큰, 그대로
  "fcmToken": "...",       // 클라이언트가 getToken()으로 받은 값
  "deviceId": "..."        // 클라이언트가 생성해 localStorage에 저장하는 안정적 랜덤 ID
}

Response (성공):
{ "ok": true }

Response (실패, 기존 함수들과 동일한 에러 형태):
{ "ok": false, "error": "MISSING_SESSION_TOKEN" | "SESSION_NOT_FOUND" | "SESSION_EXPIRED" | "MISSING_FCM_TOKEN" }
```

- `deviceId`는 같은 브라우저/기기에서 여러 번 등록해도 매번 새 문서가 쌓이지 않도록 하기 위한 값이다. `crypto.randomUUID()`로 한 번 생성해서 localStorage에 저장해두고 계속 재사용한다(로그아웃해도 유지 — 기기 식별용이지 세션이 아니므로).

### 2-2. 인증 재사용

- 새 인증 로직을 만들지 않는다. `lib/auth.js`의 `authenticateSession(firestore, sessionToken)`을 그대로 호출해서 `email`을 얻는다. 2단계에서 이미 `getFeedTest`/`getNotificationsTest`/`getPostByIdTest`/`pollSignalTest`가 쓰고 있는 것과 완전히 같은 방식이다.
- 인증 실패 시 반환되는 에러 코드(`MISSING_SESSION_TOKEN`/`SESSION_NOT_FOUND`/`SESSION_EXPIRED`)도 그대로 재사용해서, 클라이언트가 이미 알고 있는 에러 처리 로직을 그대로 쓸 수 있게 한다.

### 2-3. Firestore 저장 (`pushSubscriptions`)

```javascript
async function registerPushSubscriptionAction_(firestore, email, fcmToken, deviceId) {
  const docId = email + '_' + deviceId;
  const ref = firestore.collection('pushSubscriptions').doc(docId);
  const snap = await ref.get();
  await ref.set({
    email: email,
    fcmToken: fcmToken,
    deviceId: deviceId,
    active: true,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: snap.exists ? snap.data().createdAt : FieldValue.serverTimestamp()
  }, { merge: true });
}
```

- 문서 ID를 `{email}_{deviceId}`로 고정했으므로 이 저장은 **완전한 upsert(멱등)** 다 — 같은 요청이 두 번 와도 결과가 같다. 그래서 `writeIdempotency` 모듈(락/중복방지)은 이 함수에는 적용하지 않는다(그 모듈은 "중복 실행되면 안 되는 부수효과"를 위한 것인데, 여기는 몇 번을 실행해도 최종 상태가 같아서 필요 없음 — 과도한 안전장치를 넣지 않는다는 원칙).

---

## 3. 클라이언트 등록/토큰 갱신 흐름

### 3-1. 토큰을 언제 발급받나

- 로그인 성공 직후, 브라우저가 알림을 지원하고(`'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window`) **이미 권한이 허용된 상태**(`Notification.permission === 'granted'`)라면 자동으로 `getToken()` 호출.
- 아직 권한을 묻지 않은 상태(`'default'`)라면 자동으로 브라우저 팝업을 띄우지 않는다 — 설정 화면에 "알림 받기" 토글을 두고, 사용자가 그 토글을 켤 때만 `Notification.requestPermission()`을 호출한다(권한 요청은 명확한 사용자 행동에 응답해서만 하는 게 원칙 — 로그인하자마자 다짜고짜 팝업이 뜨면 사용자가 거부할 확률이 높아짐).

### 3-2. 토큰 갱신 감지

FCM 토큰은 브라우저가 내부적으로 만료/교체할 수 있다(문서에 공식 "만료 이벤트"가 따로 없어서, 매번 다시 확인하는 방식이 표준 패턴이다):

```javascript
async function syncPushTokenIfNeeded() {
  if (!pushSupported()) return;
  if (Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const token = await messaging.getToken({ vapidKey: FCM_VAPID_PUBLIC_KEY, serviceWorkerRegistration: reg });
  const prev = localStorage.getItem('mro_fcm_token');
  if (token && token !== prev) {
    const ok = await callApi('registerPushSubscription', { fcmToken: token, deviceId: getOrCreateDeviceId() });
    if (ok && ok.ok) localStorage.setItem('mro_fcm_token', token);
  }
}
```

- 앱 로드마다(로그인 직후, 그리고 이미 로그인된 상태로 feed.html을 열 때마다) 호출한다. `getToken()`은 토큰이 바뀌지 않았으면 같은 값을 반환하므로, 매번 불러도 서버에 불필요한 요청을 거의 만들지 않는다(localStorage 비교로 실제 변경 시에만 서버 호출).
- 서버 쪽 보완: FCM 발송(5단계 이후) 시 응답이 "토큰이 더 이상 유효하지 않음"(예: `UNREGISTERED`/`INVALID_ARGUMENT`) 에러면, 해당 `pushSubscriptions` 문서를 `active:false`로 표시해서 다음부터 발송 대상에서 제외한다(3단계 설계 문서에 이미 명시된 내용, 여기서 재확인만).

### 3-3. 미지원/거부 처리

| 상황 | 처리 |
|---|---|
| 브라우저가 Push API 자체를 지원 안 함(예: 구형 브라우저) | 기능을 아예 노출하지 않음(설정 화면에 토글도 안 보임). 에러 던지지 않고 조용히 스킵. |
| 사용자가 권한을 거부함(`Notification.permission === 'denied'`) | 조용히 스킵 + 설정 화면에 "브라우저 알림이 꺼져 있습니다" 안내 텍스트만 표시. 브라우저 정책상 거부 후에는 JS로 재요청 팝업을 강제로 띄울 수 없으므로, "브라우저 설정에서 직접 허용해주세요" 안내만 하고 강제하지 않는다. |
| iOS Safari인데 홈 화면에 설치 안 됨 | (이전 분석 보고서에서 확인된 내용 재확인) iOS는 PWA를 홈 화면에 추가해야만 푸시가 동작. 이 조건이 아니면 토글 자체를 비활성화하고 "홈 화면에 추가 후 이용 가능" 안내. |

---

## 4. 보안

- **새로 생기는 시크릿은 없다.** 서버는 ADC(Cloud Run에 이미 연결된 서비스 계정)로 인증하고, 그 서비스 계정에 IAM 역할 하나만 추가 부여한다 — 이 부여는 GCP 콘솔에서 1회 수행하며 코드/커밋 어디에도 나타나지 않는다.
- 클라이언트에 들어가는 Firebase 웹 설정값과 VAPID 공개키는 설계상 공개값이다(위 1-3절 표 참고) — GitHub에 올라가도 문제가 되는 종류의 값이 아니다. 이 부분이 헷갈릴 수 있어서 명확히 구분해뒀다: **Script Properties의 실제 API 시크릿(DEEPSEEK/GEMINI/NAVER) ≠ Firebase 웹 설정값/VAPID 공개키.** 전자는 절대 코드에 넣으면 안 되고, 후자는 원래 공개가 전제된 값이다.
- 서버는 `authenticateSession`을 통과한 이메일로만 `pushSubscriptions` 문서를 쓴다 — 클라이언트가 임의의 다른 사람 이메일로 등록을 시도할 수 없다(요청에 이메일을 안 받고, 세션에서만 이메일을 가져온다).

---

## 5. 기존 시스템과의 관계 / rollback

| 건드리는 파일 | 변경 성격 | 기존 로직 영향 |
|---|---|---|
| `sw.js` | 파일 맨 위에 `importScripts(...)` 2줄 + 파일 끝에 `onBackgroundMessage` 핸들러 블록만 **추가** | 없음 — 기존 `install`/`activate`/`fetch`/`notificationclick` 리스너는 한 글자도 안 바꿈. 특히 `fetch` 핸들러의 "캐싱 전략으로 바꾸지 말 것" 원칙 그대로 유지(`importScripts`는 SW 자체 로딩 메커니즘이라 `fetch` 이벤트 리스너를 거치지 않으므로 서로 간섭 없음). 새로 오는 푸시는 서버가 "data-only" 메시지로 보내고 `onBackgroundMessage` 안에서 직접 `showNotification()`을 호출하는 방식으로 설계해서(6단계 이후 실제 발송 설계에서 확정), 브라우저가 자동으로 알림을 두 번 띄우는 문제도 피한다. 클릭 처리는 기존 `notificationclick` 리스너가 그대로 담당(새로 안 만듦). |
| `cloud-run/mro-functions/index.js` | `registerPushSubscriptionTest` 함수 **신규 추가**만 | 없음 — 기존 함수 어느 것도 수정하지 않음 |
| Firestore | `pushSubscriptions` 컬렉션 **신규** | 없음 — `sessions`/`writeLocks`/`writeIdempotency`/`loginLocks` 스키마·데이터 무영향 |
| `feed.html` | Firebase 웹 설정값 상수 + `syncPushTokenIfNeeded()` 등 신규 함수 추가, 설정 화면에 토글 UI 추가 | 기존 `hasUnreadReply`/`hasAwaitingReply` 등 어떤 기존 함수도 수정하지 않음 |

### rollback

각 단계가 서로 독립적이라, 문제가 생기면 아래 중 필요한 것만 되돌리면 된다(전부 되돌려도 로그인/세션/시트 연동 등 기존 서비스는 전혀 영향받지 않는다):

1. GCP IAM에서 추가했던 "Firebase Cloud Messaging API 관리자" 역할만 제거 → 서버가 더 이상 FCM을 보낼 수 없게 됨(즉시 발송 중단)
2. `sw.js`에서 추가한 `importScripts`/`onBackgroundMessage` 블록만 git revert → 클라이언트가 더 이상 백그라운드 푸시를 처리하지 않음
3. `index.js`에서 `registerPushSubscriptionTest` export만 제거 → 신규 등록 API 자체가 사라짐
4. (선택) `pushSubscriptions` 컬렉션 삭제 → 저장된 토큰 전부 폐기

---

## 다음 단계

이 문서가 승인되면, 4단계는 **설계 문서 커밋**까지만 진행(이번에도 코드는 아직 없음 — 3단계와 동일한 방식). 그 다음 5단계에서 실제 코드(diff)를 보여드리고 승인받은 뒤 구현합니다: (a) `registerPushSubscriptionTest` 실제 함수 코드, (b) `sw.js`에 추가할 `importScripts`+`onBackgroundMessage` 코드, (c) `feed.html`의 토큰 발급/갱신/설정 토글 UI 코드 — 이 3개를 한 번에 묶을지, 서버/클라이언트로 나눠서 각각 diff 승인받을지는 다음 단계에서 여쭤보겠습니다.
