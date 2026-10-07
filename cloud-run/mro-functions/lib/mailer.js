// [DELIVERY] cloud-run/mro-functions/lib/mailer.js 신규 파일 — GitHub 커밋본이 곧 gcloud 배포 소스(단일본). (2026-10-07 이슈 댓글 메일: 회사 메일 서버 직접 발송 공용 모듈)
// cloud-run/mro-functions/lib/mailer.js
//
// 회사 메일 서버(whoisworks)에 jhjoo@nkmro.com 계정으로 직접 로그인해서 메일을 보내는 공용 모듈.
// 기존 인증 메일(Code.gs GmailApp)이 Gmail 별칭 설정을 통해 쓰던 것과 같은 서버·포트·보안 방식이다
// (2026-10-07 재홍님 Gmail 설정 화면: smtp.whoisworks.com / 587 / TLS).
//
// 비밀번호는 코드에 두지 않는다. 배포 시 Secret Manager 비밀을 환경변수 SMTP_PASSWORD로 연결한다
// (--set-secrets=SMTP_PASSWORD=issue-mail-smtp-password:latest). 이 값은 로그·응답에 절대 내보내지 않는다.
//
// 안전장치(모든 발송 공통): 받는 주소는 반드시 @nkmro.com 단일 주소, 한 번 호출에 최대 MAX_MESSAGES통.

const nodemailer = require('nodemailer');

const SMTP_HOST = 'smtp.whoisworks.com';
const SMTP_PORT = 587;
// 회사 메일 로그인 아이디 — 2026-10-07 재홍님 Gmail 별칭 SMTP 설정 화면으로 확인(사용자 이름 jhjoo@nkmro.com).
// 혹시 바뀌면 배포 옵션 --set-env-vars=SMTP_USER=... 로 코드 수정 없이 바꿀 수 있다.
const SMTP_USER = process.env.SMTP_USER || 'jhjoo@nkmro.com';
const FROM_ADDRESS = 'jhjoo@nkmro.com';
const FROM_NAME = 'MRO 자재 시황';
const ALLOWED_DOMAIN = '@nkmro.com';
const MAX_MESSAGES = 100;
const BOT_ICON_URL = 'https://nkmro.github.io/mro-market-intelligence/bot-icon.png';

function createTransport_() {
  const pass = process.env.SMTP_PASSWORD;
  if (!pass) throw new Error('SMTP_PASSWORD_NOT_SET');
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,        // 587은 평문으로 연결한 뒤 STARTTLS로 암호화한다
    requireTLS: true,     // 암호화 전환이 안 되면 로그인하지 않는다(비밀번호 평문 전송 방지)
    auth: { user: SMTP_USER, pass: pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
}

// 받는 주소 검사: 쉼표 등으로 여러 주소를 끼워 넣거나, @nkmro.com이 아니면 거부.
function isAllowedRecipient(to) {
  const t = String(to || '').trim().toLowerCase();
  return /^[^\s@,;<>]+@[^\s@,;<>]+$/.test(t) && t.slice(-ALLOWED_DOMAIN.length) === ALLOWED_DOMAIN;
}

// 에러를 응답/로그에 남길 때 비밀번호 등이 섞이지 않도록 필요한 항목만 뽑는다.
function describeError(err) {
  if (!err) return null;
  return {
    message: String(err.message || err).slice(0, 300),
    code: err.code || null,
    responseCode: err.responseCode || null,
    command: err.command || null
  };
}

// 로그인만 시험(메일은 보내지 않음).
async function verifyLogin() {
  const transport = createTransport_();
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

// messages: [{ to, subject, html, text, withBotIcon }]
// 하나라도 받는 주소가 허용 범위를 벗어나면 아무 것도 보내지 않고 전체 거부한다.
// 반환: { ok, sent, failed, results: [{ to, ok, messageId?, error? }] }
async function sendMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: 'NO_MESSAGES' };
  if (messages.length > MAX_MESSAGES) return { ok: false, error: 'TOO_MANY', max: MAX_MESSAGES };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] || {};
    if (!isAllowedRecipient(m.to)) return { ok: false, error: 'RECIPIENT_NOT_ALLOWED', index: i };
    if (typeof m.subject !== 'string' || !m.subject || typeof m.html !== 'string' || typeof m.text !== 'string') {
      return { ok: false, error: 'INVALID_MESSAGE', index: i };
    }
  }

  const transport = createTransport_();
  const results = [];
  try {
    for (const m of messages) {
      const mail = {
        from: { name: FROM_NAME, address: FROM_ADDRESS },
        to: String(m.to).trim().toLowerCase(),
        subject: m.subject,
        html: m.html,
        text: m.text
      };
      // 시황봇 아이콘은 본문 삽입 이미지(cid:botIcon)로 첨부 — 회사 메일 프로그램이 외부 이미지를 막아도 보이게.
      if (m.withBotIcon) mail.attachments = [{ filename: 'bot-icon.png', path: BOT_ICON_URL, cid: 'botIcon' }];
      try {
        const info = await transport.sendMail(mail);
        results.push({ to: mail.to, ok: true, messageId: info.messageId || null });
      } catch (err) {
        results.push({ to: mail.to, ok: false, error: describeError(err) });
      }
    }
  } finally {
    transport.close();
  }
  const sent = results.filter(function (r) { return r.ok; }).length;
  return { ok: true, sent: sent, failed: results.length - sent, results: results };
}

module.exports = {
  FROM_ADDRESS,
  FROM_NAME,
  isAllowedRecipient,
  describeError,
  verifyLogin,
  sendMessages
};
