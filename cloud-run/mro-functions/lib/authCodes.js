// [DELIVERY] cloud-run/mro-functions/lib/authCodes.js 신규 파일 — GitHub 커밋본이 곧 gcloud 배포 소스(단일본). (2026-10-08 회원가입·비밀번호 찾기 Cloud Run 이전)
// cloud-run/mro-functions/lib/authCodes.js
//
// 로그인 화면의 "회원가입"과 "비밀번호 찾기"(인증코드 메일 방식)를 Apps Script(Code.gs)에서
// Cloud Run으로 옮긴 것. Code.gs의 4개 처리 함수를 같은 순서·같은 오류 코드로 옮겼다.
//   handleRequestSignup_       -> requestSignup
//   handleVerifySignup_        -> verifySignup
//   handleRequestPasswordReset_  -> requestPasswordReset
//   handleConfirmPasswordReset_  -> confirmPasswordReset
//
// Apps Script와 달라진 점(재홍님 승인 2026-10-08)
//  1) 인증코드 메일을 팀장님 개인 지메일(GmailApp)이 아니라 회사 메일 서버(lib/mailer.js,
//     jhjoo@nkmro.com)로 직접 보낸다 — 이슈 댓글 메일과 같은 방식.
//  2) 인증코드·요청 횟수 임시 보관을 Apps Script 캐시 대신 Firestore에 둔다(10분/1시간 동일).
//  3) 회사 메일 서버가 "그런 메일함 없음"으로 바로 거절하면 MAILBOX_NOT_FOUND를 돌려준다
//     (예전에는 지메일이 일단 보낸 뒤 반송돼서, 화면은 "보냈어요"인데 메일이 오지 않았다).
//  4) 메일 발송 실패는 MAIL_SEND_FAILED — 화면(index.html)이 이걸 받으면 기존 Apps Script로
//     자동 전환한다(안전장치).
//  5) 처리 결과를 Cloud Run 로그에 남긴다(오류 원인을 나중에 확인할 수 있게).
//
// 이 파일은 시트/Firestore/메일 서버에 직접 접근하지 않는다. 바깥 기능은 deps로 받는다
// (index.js의 authCodeTest가 실제 기능을 넘겨주고, 시험 때는 가짜 기능을 넘긴다).
//   deps.now()                          -> 현재 ms
//   deps.randomCode()                   -> '123456' 같은 6자리 문자열
//   deps.hashPassword(password, email)  -> Code.gs hashPassword_와 같은 해시
//   deps.codes.get(id) / set(id, data) / remove(id)
//   deps.codes.consume(id, code, nowMs) -> { status: 'none'|'mismatch'|'too_many'|'ok', remaining?, data? }
//        (코드 비교·시도 횟수 증가·성공 시 삭제를 한 번에 — 동시에 두 번 눌러도 한 번만 성공)
//   deps.rate.tryIncrement(id, nowMs)   -> true(허용) / false(1시간 5회 초과)
//   deps.users.find(email)              -> { rowNum, email, name, ... } | null  (항상 시트 최신값)
//   deps.users.append(rowValues)
//   deps.users.updateCells(rowNum, { G: ..., H: ... })
//   deps.sendMail({ to, subject, html, text }) -> { ok:true } | { ok:false, reason:'MAILBOX_NOT_FOUND'|'INVALID_EMAIL'|'SEND_FAILED', detail }

const SIGNUP_DOMAIN = 'nkmro.com';            // Code.gs SIGNUP_DOMAIN과 동일
const CODE_TTL_MS = 10 * 60 * 1000;           // Code.gs cache.put(..., 600)과 동일
const RATE_TTL_MS = 60 * 60 * 1000;           // Code.gs checkAndIncrementRequestRate_ 3600초와 동일
const RATE_MAX = 5;                           // 1시간에 5회
const MAX_ATTEMPTS = 5;                       // 코드 5회 틀리면 무효

function b64url_(s) {
  return Buffer.from(String(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}
// Code.gs의 캐시 키('signup_' + base64EncodeWebSafe(email))와 같은 모양
function codeId(prefix, email) { return prefix + '_' + b64url_(email); }
function rateId(prefix, email) { return prefix + '_rate_' + b64url_(email); }

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Code.gs buildBrandedEmailHtml_과 같은 디자인. 글꼴만 Outlook에서 깨지지 않게 맑은 고딕을
// 맨 앞에 두었다(이슈 댓글 메일과 같은 이유). 이름은 사용자가 입력한 값이라 HTML로 안전하게 바꾼다.
function buildCodeEmailHtml(greetLine, descLine, code, footerLine) {
  return '<div style="font-family:\'Malgun Gothic\',\'맑은 고딕\',-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#1a6b52" style="background:#1a6b52;color:#ffffff;padding:18px 24px;font-size:15px;font-weight:700;">MRO 자재 시황 관리 시스템</td></tr></table>' +
    '<div style="border:1px solid #e2e0da;border-top:none;padding:28px 24px;">' +
    '<div style="font-size:14px;color:#1f2320;margin-bottom:8px;line-height:1.6;">' + greetLine + '</div>' +
    '<div style="font-size:13px;color:#6b6f6a;line-height:1.6;margin-bottom:22px;">' + descLine + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;"><tr><td bgcolor="#f6f5f2" style="background:#f6f5f2;border:1px dashed #c8c4b8;padding:20px;text-align:center;">' +
    '<div style="font-size:11px;color:#9a9891;margin-bottom:8px;">인증코드</div>' +
    '<div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1a6b52;">' + esc_(code) + '</div>' +
    '</td></tr></table>' +
    '<div style="text-align:center;font-size:12px;color:#b3413a;margin-bottom:4px;">이 코드는 10분간만 유효합니다.</div>' +
    '<hr style="border:none;border-top:1px solid #e2e0da;margin:22px 0 14px;">' +
    '<div style="font-size:11px;color:#9a9891;line-height:1.6;">' + footerLine + '</div>' +
    '</div></div>';
}

function signupMail(email, name, code) {
  return {
    to: email,
    subject: '[MRO 시황] 회원가입 인증코드',
    text: name + '님, 회원가입 인증코드는 [' + code + '] 입니다. 10분 이내에 입력해주세요.',
    html: buildCodeEmailHtml(esc_(name) + '님, 안녕하세요.', '회원가입을 위해 아래 인증코드를 화면에 입력해주세요.', code, '이 메일은 MRO 자재 시황 관리 시스템에서 자동으로 발송했어요.')
  };
}
function resetMail(email, name, code) {
  return {
    to: email,
    subject: '[MRO 시황] 비밀번호 재설정 인증코드',
    text: name + '님, 비밀번호 재설정 인증코드는 [' + code + '] 입니다. 10분 이내에 입력해주세요.',
    html: buildCodeEmailHtml(esc_(name) + '님, 안녕하세요.', '비밀번호 재설정을 요청하셨습니다. 아래 인증코드를 화면에 입력해주세요.', code, '본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 비밀번호는 변경되지 않습니다.')
  };
}

// 메일 발송 결과를 화면용 오류 코드로 바꾼다. 실패하면 방금 저장한 코드는 지운다(쓸 수 없는 코드).
async function sendOrFail_(deps, id, mail) {
  const r = await deps.sendMail(mail);
  if (r && r.ok) return null;
  await deps.codes.remove(id);
  const reason = r && r.reason;
  if (reason === 'MAILBOX_NOT_FOUND') return { ok: false, error: 'MAILBOX_NOT_FOUND' };
  if (reason === 'INVALID_EMAIL') return { ok: false, error: 'INVALID_EMAIL' };
  return { ok: false, error: 'MAIL_SEND_FAILED' };
}

// ── 회원가입 1단계 (Code.gs handleRequestSignup_) ──
async function requestSignup(deps, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const team = String(body.team || '').trim();
  const password = String(body.password || '');

  if (!email || !name || !team || !password) return { ok: false, error: 'MISSING_FIELDS' };
  if (!email.endsWith('@' + SIGNUP_DOMAIN)) return { ok: false, error: 'INVALID_DOMAIN' };
  if (password.length < 6) return { ok: false, error: 'PASSWORD_TOO_SHORT' };
  if (await deps.users.find(email)) return { ok: false, error: 'ALREADY_REGISTERED' };
  const nowMs = deps.now();
  if (!(await deps.rate.tryIncrement(rateId('signup', email), nowMs))) return { ok: false, error: 'TOO_MANY_REQUESTS' };

  const code = deps.randomCode();
  const id = codeId('signup', email);
  await deps.codes.set(id, {
    kind: 'signup', email: email, code: code, name: name, team: team,
    passwordHash: deps.hashPassword(password, email), attempts: 0, expiresAtMs: nowMs + CODE_TTL_MS
  });
  const fail = await sendOrFail_(deps, id, signupMail(email, name, code));
  if (fail) return fail;
  return { ok: true };
}

// ── 회원가입 2단계 (Code.gs handleVerifySignup_) ──
async function verifySignup(deps, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  const id = codeId('signup', email);

  const c = await deps.codes.consume(id, code, deps.now());
  if (c.status === 'none') return { ok: false, error: 'CODE_EXPIRED_OR_NOT_FOUND' };
  if (c.status === 'too_many') return { ok: false, error: 'TOO_MANY_ATTEMPTS' };
  if (c.status === 'mismatch') return { ok: false, error: 'CODE_MISMATCH', remainingAttempts: c.remaining };

  // 코드는 이미 사용 처리(삭제)됨 — Code.gs도 ALREADY_REGISTERED/성공 모두 코드를 지운다
  if (await deps.users.find(email)) return { ok: false, error: 'ALREADY_REGISTERED' };
  const d = c.data;
  // Code.gs appendRow와 같은 열 순서: 이메일, 이름, 역할(일반), 소속팀, 상태(활성), 최근확인(빈칸),
  // 비밀번호해시, 로그인실패횟수(0), 비밀번호변경일(ISO 문자열)
  await deps.users.append([email, d.name, '일반', d.team, '활성', '', d.passwordHash, 0, new Date(deps.now()).toISOString()]);
  return { ok: true };
}

// ── 비밀번호 찾기 1단계 (Code.gs handleRequestPasswordReset_) ──
async function requestPasswordReset(deps, body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'MISSING_FIELDS' };
  const user = await deps.users.find(email);
  if (!user) return { ok: false, error: 'USER_NOT_FOUND' };
  const nowMs = deps.now();
  if (!(await deps.rate.tryIncrement(rateId('pwreset', email), nowMs))) return { ok: false, error: 'TOO_MANY_REQUESTS' };

  const code = deps.randomCode();
  const id = codeId('pwreset', email);
  await deps.codes.set(id, { kind: 'pwreset', email: email, code: code, attempts: 0, expiresAtMs: nowMs + CODE_TTL_MS });
  const fail = await sendOrFail_(deps, id, resetMail(email, user.name, code));
  if (fail) return fail;
  return { ok: true };
}

// ── 비밀번호 찾기 2단계 (Code.gs handleConfirmPasswordReset_) ──
async function confirmPasswordReset(deps, body) {
  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  const newPassword = String(body.newPassword || '');
  if (!email || !code || !newPassword) return { ok: false, error: 'MISSING_FIELDS' };
  if (newPassword.length < 6) return { ok: false, error: 'PASSWORD_TOO_SHORT' };

  const c = await deps.codes.consume(codeId('pwreset', email), code, deps.now());
  if (c.status === 'none') return { ok: false, error: 'CODE_MISMATCH_OR_EXPIRED' };
  if (c.status === 'too_many') return { ok: false, error: 'TOO_MANY_ATTEMPTS' };
  if (c.status === 'mismatch') return { ok: false, error: 'CODE_MISMATCH_OR_EXPIRED', remainingAttempts: c.remaining };

  const user = await deps.users.find(email);
  if (!user) return { ok: false, error: 'USER_NOT_FOUND' };
  // Code.gs와 동일: G열(비밀번호해시) 새 값, H열(로그인실패횟수) 0 = 잠금 해제
  await deps.users.updateCells(user.rowNum, { G: deps.hashPassword(newPassword, email), H: 0 });
  return { ok: true };
}

// consume()의 판정 규칙(Firestore 트랜잭션 안에서도, 가짜 저장소에서도 똑같이 쓰도록 분리).
// 반환: { status, remaining?, next? } — next가 'delete'면 문서 삭제, 객체면 그 값으로 저장.
function judgeCode(stored, code, nowMs) {
  if (!stored || !(stored.expiresAtMs > nowMs)) return { status: 'none', next: stored ? 'delete' : null };
  if (stored.code !== code) {
    const attempts = (stored.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) return { status: 'too_many', next: 'delete' };
    // Code.gs는 틀릴 때마다 cache.put(..., 600)으로 유효시간이 다시 10분이 된다 — 동일하게
    return { status: 'mismatch', remaining: MAX_ATTEMPTS - attempts, next: Object.assign({}, stored, { attempts: attempts, expiresAtMs: nowMs + CODE_TTL_MS }) };
  }
  return { status: 'ok', data: stored, next: 'delete' };
}

// 요청 횟수 판정(Code.gs checkAndIncrementRequestRate_: 5회 이상이면 거절, 아니면 +1 하고
// 유효시간을 다시 1시간으로).
function judgeRate(stored, nowMs) {
  const current = (stored && stored.expiresAtMs > nowMs) ? (Number(stored.count) || 0) : 0;
  if (current >= RATE_MAX) return { allowed: false, next: null };
  return { allowed: true, next: { count: current + 1, expiresAtMs: nowMs + RATE_TTL_MS } };
}

const ACTIONS = {
  requestSignup: requestSignup,
  verifySignup: verifySignup,
  requestPasswordReset: requestPasswordReset,
  confirmPasswordReset: confirmPasswordReset
};

module.exports = {
  ACTIONS, requestSignup, verifySignup, requestPasswordReset, confirmPasswordReset,
  judgeCode, judgeRate, codeId, rateId, buildCodeEmailHtml, signupMail, resetMail,
  CODE_TTL_MS, RATE_TTL_MS, RATE_MAX, MAX_ATTEMPTS
};
