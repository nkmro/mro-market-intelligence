// cloud-run/mro-functions/tests/authcode_run_tests.js
// 회원가입·비밀번호 찾기(authCodeTest, 2026-10-08) 시험. 실제 시트·Firestore·메일 서버는 쓰지 않고
// 가짜로 바꿔 끼워서 index.js의 authCodeTest를 그대로 실행한다.
// 실행: (cloud-run/mro-functions 폴더에서) node tests/authcode_run_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const dir = path.resolve(__dirname, '..');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
  if (!cond) failures++;
}

// Code.gs hashPassword_와 같은 계산(SHA-256(password + ':' + email 소문자), 16진수)
function gasHash(pw, email) { return crypto.createHash('sha256').update(pw + ':' + String(email).trim().toLowerCase(), 'utf8').digest('hex'); }

function makeEnv(opts) {
  opts = opts || {};
  const store = {};
  const env = { store: store, sent: [], sheetRows: (opts.users || []).map(r => r.slice()), appended: [], updates: [], mailMode: opts.mailMode || 'ok', logs: [] };
  function docRef(col, id) {
    const key = col + '/' + id;
    return {
      _key: key,
      get: async () => ({ exists: key in store, data: () => JSON.parse(JSON.stringify(store[key])) }),
      set: async d => { store[key] = JSON.parse(JSON.stringify(d)); },
      update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(JSON.stringify(d))); },
      delete: async () => { delete store[key]; }
    };
  }
  const fakeFirestore = {
    collection: n => ({ doc: id => docRef(n, id) }),
    runTransaction: async fn => {
      const ops = [];
      const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.update(d)) };
      const out = await fn(tx);
      for (const op of ops) await op();
      return out;
    }
  };
  const fakeClient = {
    request: async ({ url, method, data }) => {
      const u = decodeURIComponent(url);
      if (!method || method === 'GET') return { data: { values: env.sheetRows.map(r => r.slice()) } };
      if (method === 'POST' && u.includes(':append')) { env.appended.push(data.values[0]); env.sheetRows.push(data.values[0].slice()); return { data: {} }; }
      if (method === 'PUT') {
        const m = u.match(/!([A-Z])(\d+)\?/);
        env.updates.push({ col: m[1], row: +m[2], value: data.values[0][0] });
        const row = env.sheetRows[+m[2] - 2]; row[m[1].charCodeAt(0) - 65] = data.values[0][0];
        return { data: {} };
      }
      throw new Error('unexpected request ' + method + ' ' + u);
    }
  };
  const stubs = {
    '@google-cloud/firestore': { Firestore: class { constructor() { return fakeFirestore; } }, FieldValue: { serverTimestamp: () => 'TS' } },
    'google-auth-library': { GoogleAuth: class { async getClient() { return fakeClient; } } },
    './lib/mailer': {
      FROM_ADDRESS: 'jhjoo@nkmro.com',
      describeError: e => ({ message: String(e) }),
      verifyLogin: async () => {},
      sendMessages: async ms => {
        const m = ms[0];
        if (!/^[^\s@,;<>]+@[^\s@,;<>]+$/.test(m.to) || !m.to.endsWith('@nkmro.com')) return { ok: false, error: 'RECIPIENT_NOT_ALLOWED', index: 0 };
        if (env.mailMode === 'nomailbox') return { ok: true, sent: 0, failed: 1, results: [{ to: m.to, ok: false, error: { message: "Can't send mail - all recipients were rejected: 550 5.1.1", code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO' } }] };
        if (env.mailMode === 'down') return { ok: true, sent: 0, failed: 1, results: [{ to: m.to, ok: false, error: { message: 'Invalid login: 535', code: 'EAUTH', responseCode: 535, command: 'AUTH PLAIN' } }] };
        if (env.mailMode === 'throw') throw new Error('SMTP_PASSWORD_NOT_SET');
        env.sent.push(m); return { ok: true, sent: 1, failed: 0, results: [{ to: m.to, ok: true, messageId: 'x' }] };
      }
    }
  };
  const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
  const mod = { exports: {} };
  const ctx = { require: req, module: mod, exports: mod.exports, console: { log: s => env.logs.push(String(s)), error: s => env.logs.push(String(s)) }, process, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
  env.fn = mod.exports.authCodeTest;
  env.call = async body => {
    const out = {};
    await env.fn({ method: 'POST', body: body }, { set() {}, status: c => ({ json: o => { out.httpStatus = c; Object.assign(out, o); }, send() {} }) });
    return out;
  };
  env.lastCode = () => { const m = env.sent[env.sent.length - 1]; return m && m.text.match(/\[(\d{6})\]/)[1]; };
  return env;
}

const USERS = [
  ['jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성', '', gasHash('oldpass1', 'jhjoo@nkmro.com'), 3, '2026-01-01T00:00:00.000Z'],
  ['kim@nkmro.com', '김담당', '담당', '동부', '활성', '', gasHash('kimpass', 'kim@nkmro.com'), 0, '']
];

(async () => {
  // ── 회원가입 ──
  let e = makeEnv({ users: USERS });
  check('S1 빈 항목 -> MISSING_FIELDS', (await e.call({ action: 'requestSignup', email: 'new@nkmro.com', name: '신입', team: '', password: 'abcdef' })).error === 'MISSING_FIELDS');
  check('S2 회사 메일 아님 -> INVALID_DOMAIN', (await e.call({ action: 'requestSignup', email: 'new@gmail.com', name: '신입', team: '동부', password: 'abcdef' })).error === 'INVALID_DOMAIN');
  check('S3 비밀번호 5자 -> PASSWORD_TOO_SHORT', (await e.call({ action: 'requestSignup', email: 'new@nkmro.com', name: '신입', team: '동부', password: 'abcde' })).error === 'PASSWORD_TOO_SHORT');
  check('S4 이미 가입(대소문자 무시) -> ALREADY_REGISTERED', (await e.call({ action: 'requestSignup', email: 'KIM@nkmro.com', name: '김', team: '동부', password: 'abcdef' })).error === 'ALREADY_REGISTERED');
  let r = await e.call({ action: 'requestSignup', email: ' New@NKMRO.com ', name: '신입<b>', team: '동부', password: 'secret1' });
  check('S5 정상 요청 -> ok, 메일 1통', r.ok === true && e.sent.length === 1 && e.sent[0].to === 'new@nkmro.com', r);
  check('S6 메일 제목·본문 = Apps Script와 같은 문구', e.sent[0].subject === '[MRO 시황] 회원가입 인증코드' && /신입<b>님, 회원가입 인증코드는 \[\d{6}\] 입니다\. 10분 이내에 입력해주세요\./.test(e.sent[0].text));
  check('S7 메일 HTML에서 이름이 안전하게 바뀜(<b> 그대로 안 들어감)', e.sent[0].html.includes('신입&lt;b&gt;님') && !e.sent[0].html.includes('신입<b>님'));
  const code1 = e.lastCode();
  const wrong = code1 === '111111' ? '222222' : '111111';
  r = await e.call({ action: 'verifySignup', email: 'new@nkmro.com', code: wrong });
  check('S8 코드 틀림 -> CODE_MISMATCH, 4회 남음', r.error === 'CODE_MISMATCH' && r.remainingAttempts === 4, r);
  r = await e.call({ action: 'verifySignup', email: 'new@nkmro.com', code: code1 });
  check('S9 코드 맞음 -> 가입 완료', r.ok === true, r);
  const row = e.appended[0] || [];
  check('S10 시트에 추가된 행 = Code.gs appendRow와 같은 9칸', row.length === 9 && row[0] === 'new@nkmro.com' && row[1] === '신입<b>' && row[2] === '일반' && row[3] === '동부' && row[4] === '활성' && row[5] === '' && row[7] === 0 && /^\d{4}-\d\d-\d\dT/.test(row[8]), row);
  check('S11 저장된 비밀번호 해시 = Apps Script 계산과 동일(로그인 가능)', row[6] === gasHash('secret1', 'new@nkmro.com'));
  r = await e.call({ action: 'verifySignup', email: 'new@nkmro.com', code: code1 });
  check('S12 같은 코드 재사용 -> CODE_EXPIRED_OR_NOT_FOUND(한 번만 사용)', r.error === 'CODE_EXPIRED_OR_NOT_FOUND', r);
  check('S13 Firestore에 인증코드가 남지 않음', !Object.keys(e.store).some(k => k.startsWith('authCodes/')));

  // 5회 틀리면 무효
  e = makeEnv({ users: USERS });
  await e.call({ action: 'requestSignup', email: 'x@nkmro.com', name: '엑스', team: '서부', password: 'abcdef' });
  const cx = e.lastCode(), wx = cx === '111111' ? '222222' : '111111';
  const rems = [];
  for (let i = 0; i < 4; i++) rems.push((await e.call({ action: 'verifySignup', email: 'x@nkmro.com', code: wx })).remainingAttempts);
  r = await e.call({ action: 'verifySignup', email: 'x@nkmro.com', code: wx });
  check('S14 남은 횟수 4,3,2,1 후 5번째 -> TOO_MANY_ATTEMPTS', JSON.stringify(rems) === '[4,3,2,1]' && r.error === 'TOO_MANY_ATTEMPTS', { rems, r });
  r = await e.call({ action: 'verifySignup', email: 'x@nkmro.com', code: cx });
  check('S15 그 뒤엔 맞는 코드도 무효(다시 요청해야 함)', r.error === 'CODE_EXPIRED_OR_NOT_FOUND', r);

  // 10분 만료
  e = makeEnv({ users: USERS });
  await e.call({ action: 'requestSignup', email: 'late@nkmro.com', name: '늦음', team: '동부', password: 'abcdef' });
  const k = Object.keys(e.store).find(x => x.startsWith('authCodes/'));
  e.store[k].expiresAtMs = Date.now() - 1;
  r = await e.call({ action: 'verifySignup', email: 'late@nkmro.com', code: e.lastCode() });
  check('S16 10분 지나면 -> CODE_EXPIRED_OR_NOT_FOUND', r.error === 'CODE_EXPIRED_OR_NOT_FOUND', r);

  // 1시간 5회 제한
  e = makeEnv({ users: USERS });
  const outs = [];
  for (let i = 0; i < 6; i++) outs.push((await e.call({ action: 'requestSignup', email: 'rate@nkmro.com', name: '횟수', team: '동부', password: 'abcdef' })).error || 'ok');
  check('S17 같은 주소 6번째 요청 -> TOO_MANY_REQUESTS', outs.slice(0, 5).every(x => x === 'ok') && outs[5] === 'TOO_MANY_REQUESTS', outs);
  r = await e.call({ action: 'verifySignup', email: 'rate@nkmro.com', code: e.lastCode() });
  check('S18 여러 번 요청했으면 마지막 메일의 코드가 유효', r.ok === true, r);

  // 메일함 없음 / 메일 서버 장애
  e = makeEnv({ users: USERS, mailMode: 'nomailbox' });
  r = await e.call({ action: 'requestSignup', email: 'nobody@nkmro.com', name: '없음', team: '동부', password: 'abcdef' });
  check('S19 회사 메일 서버가 "그런 메일함 없음" -> MAILBOX_NOT_FOUND, 코드 안 남김', r.error === 'MAILBOX_NOT_FOUND' && !Object.keys(e.store).some(x => x.startsWith('authCodes/')), r);
  check('S20 로그에 원인이 남음', e.logs.some(l => l.includes('[authCode]') && l.includes('MAILBOX_NOT_FOUND') && l.includes('nobody@nkmro.com')));
  e = makeEnv({ users: USERS, mailMode: 'down' });
  r = await e.call({ action: 'requestSignup', email: 'new@nkmro.com', name: '신입', team: '동부', password: 'abcdef' });
  check('S21 메일 서버 로그인 실패 -> MAIL_SEND_FAILED(화면이 Apps Script로 전환)', r.error === 'MAIL_SEND_FAILED', r);
  e = makeEnv({ users: USERS, mailMode: 'throw' });
  r = await e.call({ action: 'requestSignup', email: 'new@nkmro.com', name: '신입', team: '동부', password: 'abcdef' });
  check('S22 예상 못한 오류 -> 500 SERVER_ERROR(화면이 Apps Script로 전환)', r.httpStatus === 500 && r.error === 'SERVER_ERROR', r);
  check('S23 오류 로그에 비밀번호가 남지 않음', !e.logs.some(l => l.includes('abcdef')));
  e = makeEnv({ users: USERS });
  r = await e.call({ action: 'requestSignup', email: 'a b@nkmro.com', name: '공백', team: '동부', password: 'abcdef' });
  check('S24 주소 형식 이상 -> INVALID_EMAIL', r.error === 'INVALID_EMAIL', r);

  // 같은 요청 재전송(응답 유실 대비)
  e = makeEnv({ users: USERS });
  await e.call({ action: 'requestSignup', email: 'dup@nkmro.com', name: '중복', team: '동부', password: 'abcdef', idempotencyKey: 'K1' });
  await e.call({ action: 'requestSignup', email: 'dup@nkmro.com', name: '중복', team: '동부', password: 'abcdef', idempotencyKey: 'K1' });
  check('S25 같은 요청 번호로 다시 와도 메일은 1통', e.sent.length === 1, e.sent.length);
  // 가입 직전에 다른 경로로 가입돼 있으면
  e = makeEnv({ users: USERS });
  await e.call({ action: 'requestSignup', email: 'race@nkmro.com', name: '경합', team: '동부', password: 'abcdef' });
  e.sheetRows.push(['race@nkmro.com', '경합', '일반', '동부', '활성', '', 'h', 0, '']);
  r = await e.call({ action: 'verifySignup', email: 'race@nkmro.com', code: e.lastCode() });
  check('S26 확인 시점에 이미 가입돼 있으면 -> ALREADY_REGISTERED, 행 추가 안 함', r.error === 'ALREADY_REGISTERED' && e.appended.length === 0, r);

  // ── 비밀번호 찾기 ──
  e = makeEnv({ users: USERS });
  check('P1 빈 이메일 -> MISSING_FIELDS', (await e.call({ action: 'requestPasswordReset', email: '' })).error === 'MISSING_FIELDS');
  check('P2 없는 사용자 -> USER_NOT_FOUND', (await e.call({ action: 'requestPasswordReset', email: 'ghost@nkmro.com' })).error === 'USER_NOT_FOUND');
  r = await e.call({ action: 'requestPasswordReset', email: 'JHJOO@nkmro.com' });
  check('P3 정상 요청 -> ok, 메일 제목·이름 = Apps Script와 동일', r.ok && e.sent[0].subject === '[MRO 시황] 비밀번호 재설정 인증코드' && e.sent[0].text.startsWith('주재홍님, 비밀번호 재설정 인증코드는 ['), r);
  const pc = e.lastCode(), pw = pc === '111111' ? '222222' : '111111';
  check('P4 새 비밀번호 5자 -> PASSWORD_TOO_SHORT', (await e.call({ action: 'confirmPasswordReset', email: 'jhjoo@nkmro.com', code: pc, newPassword: 'abc' })).error === 'PASSWORD_TOO_SHORT');
  r = await e.call({ action: 'confirmPasswordReset', email: 'jhjoo@nkmro.com', code: pw, newPassword: 'newpass1' });
  check('P5 코드 틀림 -> CODE_MISMATCH_OR_EXPIRED, 4회 남음', r.error === 'CODE_MISMATCH_OR_EXPIRED' && r.remainingAttempts === 4, r);
  r = await e.call({ action: 'confirmPasswordReset', email: 'jhjoo@nkmro.com', code: pc, newPassword: 'newpass1' });
  check('P6 코드 맞음 -> 변경 완료', r.ok === true, r);
  check('P7 시트 G열 = 새 비밀번호 해시(Apps Script 계산과 동일), H열 = 0(잠금 해제)', e.sheetRows[0][6] === gasHash('newpass1', 'jhjoo@nkmro.com') && e.sheetRows[0][7] === 0 && e.updates.length === 2 && e.updates.every(u => u.row === 2), e.updates);
  check('P8 다른 사람 행은 그대로', e.sheetRows[1][6] === gasHash('kimpass', 'kim@nkmro.com'));
  r = await e.call({ action: 'confirmPasswordReset', email: 'jhjoo@nkmro.com', code: pc, newPassword: 'again11' });
  check('P9 같은 코드 재사용 -> CODE_MISMATCH_OR_EXPIRED', r.error === 'CODE_MISMATCH_OR_EXPIRED' && r.remainingAttempts === undefined, r);
  e = makeEnv({ users: USERS, mailMode: 'nomailbox' });
  r = await e.call({ action: 'requestPasswordReset', email: 'kim@nkmro.com' });
  check('P10 시트엔 있지만 메일함 없음 -> MAILBOX_NOT_FOUND', r.error === 'MAILBOX_NOT_FOUND', r);
  e = makeEnv({ users: USERS });
  r = await e.call({ action: 'nope', email: 'kim@nkmro.com' });
  check('X1 모르는 요청 -> 400 UNKNOWN_ACTION', r.httpStatus === 400 && r.error === 'UNKNOWN_ACTION', r);

  console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL AUTHCODE TESTS PASSED');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
