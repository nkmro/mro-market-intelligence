// apps-script/Code.gs의 findUser_(546~566행 중 login에 필요한 필드), handleLogin_
// (231~293행), hashPassword_(331~335행)를 그대로 옮긴 참조 구현. 원본(Code.gs, 요약):
//
// function findUser_(email) {
//   const data = getSheetValues_(SHEET_USER);
//   for (let i = 1; i < data.length; i++) {
//     const row = data[i];
//     if (String(row[0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
//       return { email: row[0], name: row[1], role: row[2], team: row[3], status: row[4],
//         lastCheckedAt: row[5] || null, passwordHash: row[6] || null,
//         passwordChangedAt: row[8] || null, failCount: Number(row[7]) || 0 };
//     }
//   }
//   return null;
// }
//
// function hashPassword_(password, email) {
//   const raw = password + ':' + String(email).trim().toLowerCase();
//   const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
//   return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
// }
//
// function handleLogin_(body) {
//   const email = String(body.email || '').trim().toLowerCase();
//   const password = String(body.password || '');
//   if (!email || !password) return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
//   const user = findUser_(email);
//   if (!user) return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
//   if (user.status !== '활성') return jsonResponse_({ ok: false, error: 'USER_INACTIVE' });
//   if (user.failCount >= 5) return jsonResponse_({ ok: false, error: 'ACCOUNT_LOCKED' });
//   const computedHash = hashPassword_(password, email);
//   if (!user.passwordHash || user.passwordHash !== computedHash) {
//     incrementLoginFailCount_(email, user.failCount);
//     return jsonResponse_({ ok: false, error: 'WRONG_PASSWORD' });
//   }
//   resetLoginFailCount_(email);
//   const sessionToken = Utilities.getUuid();
//   CacheService.getScriptCache().put('session_' + sessionToken, email, 21600);
//   syncSessionToCloudRun_(sessionToken, email);
//   const expireDays = Number(getSetting_('비밀번호만료일수')) || 90;
//   const changedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt) : null;
//   const daysSincePwChange = changedAt ? (Date.now() - changedAt.getTime()) / 86400000 : Infinity;
//   const passwordExpired = daysSincePwChange > expireDays;
//   return jsonResponse_({ ok: true, sessionToken, email, name: user.name, role: user.role, team: user.team, passwordExpired });
// }
//
// [이 parity 테스트의 알려진 한계 — 미리 밝혀둠] hashPassword_는 Apps Script의
// Utilities.computeDigest(SHA-256)를 쓰지만, 이 로컬 테스트 환경에는 Apps Script 런타임이
// 없어 Node의 crypto로만 검증할 수 있다. 즉 이 파일의 hashPassword_도 Node crypto로
// 구현되어 있어, cloudrun_port.js의 hashPassword_(역시 Node crypto)와 비교해도 "같은
// 포맷으로 구현된 두 코드가 일치하는지"만 확인되고, "실제 GAS Utilities.computeDigest와
// 바이트 단위로 일치하는지"는 이 테스트로 확인할 수 없다(LOGIN_CLOUDRUN_DESIGN.md 2번
// 항목 참고 — 실제 합성 테스트 계정으로 배포 후 재확인 필요).
//
// [Apps Script vs Cloud Run 입력 표현의 차이 — 의도된 것] userRows의 passwordChangedAt
// 컬럼(9번째, index 8)은 이 파일에서는 "SpreadsheetApp이 이미 Date 객체로 돌려준 값"을
// 흉내내 JS Date 객체 또는 null을 그대로 넣는다. cloudrun_port.js는 같은 컬럼을 "Sheets
// API UNFORMATTED_VALUE가 돌려준 시트 시리얼 숫자"로 넣는다 — 이 표현 차이 자체가
// postComment 때 발견된 날짜 버그와 같은 종류의 함정이 있는지를 검증하는 지점이다.
//
// sessionToken/nowMs는 테스트 결정성을 위해 외부에서 주입한다(Utilities.getUuid()/Date.now()
// 대응 — postComment/markThreadSeen parity의 commentId/nowIso 주입과 동일한 관례).
const crypto = require('crypto');

function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

function findUser_(userRows, email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  for (let i = 0; i < userRows.length; i++) {
    const row = userRows[i];
    if (String(row[0] || '').trim().toLowerCase() === normalizedEmail) {
      return {
        email: row[0], name: row[1], role: row[2], team: row[3], status: row[4],
        passwordHash: row[6] || null, failCount: Number(row[7]) || 0,
        passwordChangedAt: row[8] || null
      };
    }
  }
  return null;
}

function handleLogin_(body, userRows, sessionToken, nowMs, settings) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!email || !password) {
    return { ok: false, error: 'MISSING_FIELDS' };
  }
  const user = findUser_(userRows, email);
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

  const expireDays = Number(settings['비밀번호만료일수']) || 90;
  const changedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt) : null;
  const daysSincePwChange = changedAt ? (nowMs - changedAt.getTime()) / 86400000 : Infinity;
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

module.exports = { handleLogin_, hashPassword_, findUser_ };
