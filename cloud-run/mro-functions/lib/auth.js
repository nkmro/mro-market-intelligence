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
async function touchSession(ref) {
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
  await touchSession(sessionSnap.ref); // 슬라이딩 세션 연장 (기존 Phase 1과 동일)
  return { ok: true, email: session.email, ref: sessionSnap.ref, timings };
}

module.exports = { authenticateSession, touchSession, SESSION_TTL_MS };
