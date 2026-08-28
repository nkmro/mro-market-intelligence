// cloud-run/mro-functions/lib/pushSender.js
//
// 통합 푸시 발송 공통 모듈 (push 5단계 — 코드 구현만, 아직 어디서도 호출되지 않음/미배포).
// 승인 경로: NOTIFICATION_PUSH_REMINDER_ANALYSIS_AND_PLAN.md(분석) ->
// PUSH_NOTIFICATION_STAGE3_DESIGN.md(Firestore 스키마/역할 경계 승인) ->
// PUSH_NOTIFICATION_STAGE4_DESIGN.md(FCM 인증 방식 승인) ->
// PUSH_NOTIFICATION_STAGE5_DESIGN.md(이 모듈 설계 승인, 재홍님 보완 2건 반영) -> 이번 코드
// 구현 승인. 다음 단계(별도 승인 필요): 6단계에서 기존 3종 알림(새 게시물/댓글 필요/답변
// 요청)의 lib/feedEngine.js 계산 결과를 이 모듈에 실제로 연결.
//
// 여러 알림(새 게시물/댓글 필요/답변 요청)이 동시에 있어도 사용자당 푸시 1개로 합쳐서
// 보낸다(0건 카테고리는 문구에서 제외, 전부 0건이면 아예 보내지 않는다) —
// NOTIFICATION_PUSH_REMINDER_ANALYSIS_AND_PLAN.md 3.1-4번, 재홍님 승인.
//
// 이 모듈은 "발송" 자체만 담당한다. 각 알림 종류가 몇 건인지 계산하는 로직(새 게시물/댓글
// 필요/답변 요청 각각의 판단 기준)은 여기서 다시 만들지 않는다 — 6단계에서 기존
// lib/feedEngine.js의 계산 결과를 그대로 받아서 이 모듈에 넘기는 방식으로 연결한다
// (재사용 우선 원칙, 설계 문서 0절).

const { FieldValue } = require('@google-cloud/firestore');
// [재홍님 보완 2번, 2026-08-28] lib/auth.js가 SESSION_TTL_MS를 export하는지 코드로 직접
// 재확인 완료 — 56행: module.exports = { authenticateSession, touchSession, SESSION_TTL_MS };
// export되어 있으므로 별도 상수를 새로 만들거나 lib/auth.js를 수정할 필요 없이 그대로 가져다
// 쓴다(PUSH_NOTIFICATION_STAGE5_DESIGN.md 1-3절).
const { SESSION_TTL_MS } = require('./auth');

// 앱이 지금 열려 있는지 판단하는 허용 오차. 폴링 주기(수 초~수십 초 단위)보다 넉넉하게 잡았다.
const SESSION_ACTIVE_WINDOW_MS = 2 * 60 * 1000; // 2분

// counts: { newPosts, needsReply, awaitingReply } (전부 0 이상 정수, 호출부가 계산해서 넘김).
// title: 선택 인자 [재홍님 보완 1번, 2026-08-28] — 생략(또는 falsy)하면 'MRO 시황관리'
// (6단계, 기존 3종 알림용 기본값). 7~8단계 담당자 댓글 리마인더처럼 다른 문구가 필요한
// 호출부는 이 인자로 넘기면 된다(예: '담당 게시글 확인 필요').
// 반환: { title, body } 또는 null(전부 0건이면 보낼 내용이 없다는 뜻).
function buildConsolidatedMessage_(counts, title) {
  const parts = [];
  if (counts.newPosts > 0) parts.push('새 게시물 ' + counts.newPosts + '건');
  if (counts.needsReply > 0) parts.push('댓글 필요 ' + counts.needsReply + '건');
  if (counts.awaitingReply > 0) parts.push('답변 요청 ' + counts.awaitingReply + '건');
  if (parts.length === 0) return null;
  return { title: title || 'MRO 시황관리', body: parts.join(' · ') };
}

// 상태가 바뀌었는지 비교하기 위한 간단한 문자열 서명. 세 숫자만 반영 — 게시물/댓글의 실제
// 내용까지 비교하지 않는다(설계 의도: "건수가 그대로면 이미 알고 있는 상태"로 간주).
function buildStateSignature_(counts) {
  return counts.newPosts + '-' + counts.needsReply + '-' + counts.awaitingReply;
}

// PUSH_NOTIFICATION_STAGE3_DESIGN.md 2절에서 제안한 휴리스틱을 실제 함수로 옮긴 것 — 새
// 필드를 추가하지 않고, sessions 컬렉션의 기존 슬라이딩 TTL(authenticateSession이 매 요청마다
// expiresAt = now + 6시간으로 갱신하는 것, lib/auth.js)을 거꾸로 이용한다: expiresAt - 6시간이
// 곧 "마지막으로 서버에 요청을 보낸 시각"이다. 여러 기기에서 로그인해 있으면 세션 문서가
// 여러 개일 수 있다 — 그중 하나라도 최근 2분 이내에 활동했으면 "앱 열려 있음"으로 간주한다.
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

// email + active 복합 조건 쿼리라 Firestore 콘솔에서 복합 색인을 한 번 만들어야 할 수 있다
// (실제 배포 시 첫 호출에서 색인 안내 링크가 에러로 뜨면 그 링크로 생성 — 신규 컬렉션 첫
// 복합쿼리에서 흔한 1회성 작업, 설계 문서 1-4절).
async function getActiveSubscriptions_(firestore, email) {
  const snap = await firestore.collection('pushSubscriptions')
    .where('email', '==', email)
    .where('active', '==', true)
    .get();
  return snap.docs; // 각 doc.data().fcmToken, doc.ref(비활성화 처리용)
}

// FCM HTTP v1 API는 한 번의 요청으로 토큰 여러 개에 보낼 수 없다(멀티캐스트 미지원 — Admin
// SDK의 sendEachForMulticast()도 내부적으로 토큰마다 개별 요청을 반복하는 것일 뿐, REST API
// 자체에 그런 기능이 없음. 공식 확인 완료, 설계 문서 1-5절). 그래서 기기(토큰)마다 한 번씩
// 호출한다 — 한 사용자가 보통 1~3개 기기로 로그인하는 정도라 문제 되는 양이 아니다.
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
          // showNotification()을 호출하도록(이미 커밋된 sw.js(08c06d5)와 일치).
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
    // 구독을 비활성화해야 하는 케이스로 묶는다(설계 문서 1-5/3절에서 이미 정한 기준).
    const invalidToken = errorCode === 'UNREGISTERED' || errorCode === 'INVALID_ARGUMENT';
    return { ok: false, invalidToken, error: errorCode || String((err && err.message) || err) };
  }
}

// 진입점. authClient/fcmProjectId는 이 모듈이 직접 만들지 않고 호출부(6단계 이후 실제 트리거
// 함수)에서 주입받는다 — 여러 사용자에게 순차 발송할 때 매번 새로 GoogleAuth를 만들지 않아도
// 되게 하기 위함(설계 문서 2절).
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
    // 봤다"는 사실은 기록해서 앱을 닫는 순간 같은 내용으로 또 푸시가 나가지 않게 한다(설계
    // 문서 0절의 역할 경계: pushNotifyState는 발송 중복 방지 전용, 인앱 표시와 무관).
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
