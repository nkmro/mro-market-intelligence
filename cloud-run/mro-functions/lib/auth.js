// cloud-run/mro-functions/lib/auth.js
//
// Firestore 세션 인증 공통화. 기존 whoamiTest/getSettingsTest/getTeamManagersTest/
// pollSignalTest/getThreadSeenTest에 5번 복붙되어 있던 다음 블록을 그대로 옮긴 것으로,
// 로직은 한 글자도 바꾸지 않았다:
//   sessionToken 존재 확인 -> firestore.collection('sessions').doc(sessionToken).get()
//   -> exists 확인 -> expiresAt 만료 확인 -> 통과 시 touchSession (슬라이딩 세션 연장)
//
// 2026-08-20 (2단계): 이번에 새로 만드는 getFeedTest/getNotificationsTest/getPostByIdTest와,
// 이 모듈을 쓰도록 리팩터링하는 pollSignalTest만 이 모듈을 사용한다. 기존 whoamiTest/
// getSettingsTest/getTeamManagersTest/getThreadSeenTest는 이번 범위가 아니라 그대로 두었고,
// 각자 인라인된 동일 로직을 계속 쓴다(중복이지만 "잘 동작하는 걸 이번에 건드리지 않는다"는
// 승인된 원칙에 따른 것 — FEED_NOTIFICATIONS_POSTBYID_LIB_SPEC.md 3-1 참고).

const SESSION_TTL_MS = 21600 * 1000; // 6시간 — Apps Script CacheService의 세션 TTL과 동일

// 세션 인증을 통과한 요청마다 Firestore 세션의 expiresAt을 지금 시각 + 6시간으로 밀어서,
// Apps Script authenticateRequest_의 슬라이딩 세션 연장과 동일하게 동작하도록 한다.
// best-effort: 이 갱신이 실패해도 원래 요청의 응답에는 영향을 주지 않는다.
// [2026-11-25 요금 절감 B, 재홍님 승인] 마지막 연장(= expiresAt - 6시간)이 50초 안이면 다시 쓰지 않는다.
// 화면을 열 때 함수 여러 개가 몇 초 사이에 같이 불려 매번 1번씩 쓰던 것을 1번으로 줄임(Firestore 쓰기 절약).
// 50초인 이유: lib/pushSender.js가 'expiresAt - 6시간'을 마지막 요청 시각으로 보고 2분 안이면 "앱 열림"으로
// 판단한다(SESSION_ACTIVE_WINDOW_MS). 앱이 열려 있으면 1분마다 pollSignal이 오므로 기록은 늦어도 약 110초 전
// (50초 + 60초)이라 2분 안 — 그 판단은 그대로다. 세션 만료는 '마지막 사용 + 6시간'에서 최대 50초 빨라질 수 있다.
const SESSION_TOUCH_MIN_GAP_MS = 50 * 1000;
function needsTouch(expiresAtMs, nowMs) {
  if (!(expiresAtMs > 0)) return true; // 모르면 예전처럼 씀
  return nowMs - (expiresAtMs - SESSION_TTL_MS) >= SESSION_TOUCH_MIN_GAP_MS;
}
async function touchSession(ref, expiresAtMs) {
  if (expiresAtMs !== undefined && !needsTouch(expiresAtMs, Date.now())) return;
  try {
    await ref.update({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  } catch (e) {
    console.error('touchSession 실패(무시): ' + e);
  }
}

// 반환 형태(기존 5개 함수의 인라인 분기와 정확히 같은 상태코드/에러코드를 유지하기 위한 설계):
//   토큰 누락:      { ok: false, status: 400, error: 'MISSING_SESSION_TOKEN' }               (timings 키 없음)
//   세션 없음:      { ok: false, status: 200, error: 'SESSION_NOT_FOUND', timings }
//   세션 만료:      { ok: false, status: 200, error: 'SESSION_EXPIRED', timings }
//   인증 성공:      { ok: true, email, ref, timings }
// 호출부는 auth.timings가 undefined일 때는 응답 JSON에 timings 키를 넣지 않아야
// (기존 MISSING_SESSION_TOKEN 응답에 timings 키가 전혀 없던 것과) 모양이 정확히 같아진다.
async function authenticateSession(firestore, sessionToken) {
  if (!sessionToken) {
    return { ok: false, status: 400, error: 'MISSING_SESSION_TOKEN' };
  }
  const timings = {};
  const s0 = Date.now();
  const sessionSnap = await firestore.collection('sessions').doc(sessionToken).get();
  timings.sessionMs = Date.now() - s0;
  if (!sessionSnap.exists) {
    return { ok: false, status: 200, error: 'SESSION_NOT_FOUND', timings };
  }
  const session = sessionSnap.data();
  const expiresAtRaw = session.expiresAt;
  const expiresAt = (expiresAtRaw && expiresAtRaw.toDate) ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
  if (!(expiresAt.getTime() > Date.now())) {
    return { ok: false, status: 200, error: 'SESSION_EXPIRED', timings };
  }
  await touchSession(sessionSnap.ref, expiresAt.getTime()); // 슬라이딩 세션 연장 (2026-11-25: 50초 안이면 건너뜀)
  return { ok: true, email: session.email, ref: sessionSnap.ref, timings };
}

module.exports = { authenticateSession, touchSession, needsTouch, SESSION_TTL_MS, SESSION_TOUCH_MIN_GAP_MS };
