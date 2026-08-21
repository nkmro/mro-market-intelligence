// cloud-run/mro-functions/index.js의 loginAction_/hashPassword_ 안에서 실제로 "이 요청을
// 통과시킬지, 어떤 에러로 거부할지, failCount/session/passwordExpired를 어떻게 계산할지"를
// 결정하는 부분만(updateLoginFailCountCell_의 실제 Sheets API 호출과 firestore.collection
// ('sessions').doc(...).set(...)의 실제 Firestore 호출은 제외) 그대로 옮긴 것. 검증을
// 통과하면 실제로 세션에 쓰일 필드까지만 반환해서, apps_script_ref.js와 완전히 같은
// 입출력 모양으로 비교할 수 있게 맞췄다(postcomment-parity/cloudrun_port.js와 동일한
// 원칙 — appendedRow 대신 이 경우엔 세션 응답 객체 자체를 비교 대상으로 삼는다).
//
// 날짜 처리(passwordChangedAtRaw -> ms)는 실제 loginAction_이 쓰는 lib/feedEngine.js의
// sheetSerialToMs를 그대로 재사용한다 — 이 부분을 새로 만들지 않고 이미 getFeedTest 등에서
// 검증된 함수를 그대로 쓴다는 원칙은 postComment 때와 동일하다.
const crypto = require('crypto');
const feedEngine = require('../../lib/feedEngine');

function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function loginAction_(body, user, sessionToken, nowMs, settings) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  if (!user) {
    return { ok: false, error: 'USER_NOT_FOUND' };
  }
  if (user.status !== '활성') {
    return { ok: false, error: 'USER_INACTIVE' };
  }
  if (user.failCount >= 5) {
    return { ok: false, error: 'ACCOUNT_LOCKED' };
  }

  const computedHash = hashPassword_(password, email);
  if (!user.passwordHash || user.passwordHash !== computedHash) {
    return { ok: false, error: 'WRONG_PASSWORD', failCountAfter: (user.failCount || 0) + 1 };
  }

  const changedAtMs = feedEngine.sheetSerialToMs(user.passwordChangedAtRaw);
  const daysSincePwChange = changedAtMs !== null ? (nowMs - changedAtMs) / 86400000 : Infinity;
  const expireDays = Number(settings['비밀번호만료일수']) || 90;
  const passwordExpired = daysSincePwChange > expireDays;

  return {
    ok: true,
    sessionToken: sessionToken,
    email: email,
    name: user.name,
    role: user.role,
    team: user.team,
    passwordExpired: passwordExpired,
    failCountAfter: 0
  };
}

// ---------------------------------------------------------------------------
// index.js의 acquireLoginLock_/releaseLoginLock_ 사본(포트). 이 두 함수는 index.js 안에서
// exports되지 않는 비공개 함수라 직접 require할 수 없어서, isManagerForItem_(postcomment-
// parity)와 동일한 방식으로 로직을 그대로 복제해서 테스트한다 — "실제 프로덕션 모듈을 그대로
// require"하는 Group B(withIdempotency/authenticateSession)와는 다르게, 이 부분은 여전히
// "포트 비교"라는 점을 분명히 한다(run_tests.js의 그룹 설명 참고).
const LOGIN_LOCK_STALE_MS = 10000;
const LOGIN_LOCK_WAIT_MS = 3000;
const LOGIN_LOCK_POLL_MS = 200;

async function acquireLoginLock_(firestore, email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  const deadline = Date.now() + LOGIN_LOCK_WAIT_MS;
  for (;;) {
    const acquired = await firestore.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (snap.exists) {
        const lockedAtRaw = snap.data().lockedAt;
        const lockedAt = (lockedAtRaw && lockedAtRaw.toMillis) ? lockedAtRaw.toMillis() : new Date(lockedAtRaw).getTime();
        if (now - lockedAt < LOGIN_LOCK_STALE_MS) {
          return false;
        }
      }
      tx.set(ref, { lockedAt: new Date(now), holderId: holderId });
      return true;
    });
    if (acquired) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(function (resolve) { setTimeout(resolve, LOGIN_LOCK_POLL_MS); });
  }
}

async function releaseLoginLock_(firestore, email, holderId) {
  const ref = firestore.collection('loginLocks').doc(email);
  try {
    const snap = await ref.get();
    if (snap.exists && snap.data().holderId === holderId) {
      await ref.delete();
    }
  } catch (e) {
    console.error('releaseLoginLock_ 실패(무시): ' + e);
  }
}

module.exports = { loginAction_, hashPassword_, acquireLoginLock_, releaseLoginLock_, LOGIN_LOCK_STALE_MS, LOGIN_LOCK_WAIT_MS };
