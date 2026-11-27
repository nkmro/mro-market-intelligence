// node tests/reminder_mail_tests.js — 2026-11-27 담당자 댓글 리마인더 메일(lib/reminderMail.js + index.js runReminderMail_) 시험.
// 시트·Firestore·메일 서버 없음(가짜 객체). 이름·숫자는 시험용.
const path = require('path');
const fs = require('fs');
const rm = require(path.join(__dirname, '..', 'lib', 'reminderMail.js'));
const pc = require(path.join(__dirname, '..', 'lib', 'perfCloseMail.js'));
const feedEngine = require(path.join(__dirname, '..', 'lib', 'feedEngine.js'));
let pass = 0, fail = 0;
const t = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  → ' + JSON.stringify(info))); };
const kst = (h, m) => Date.UTC(2026, 10, 27, h - 9, m || 2); // 2026-11-27 서울 h시 m분

// ---- due
t('D1 사용 FALSE → DISABLED', rm.due({ '담당자댓글리마인더사용': 'FALSE', '담당자댓글마감시각': '13' }, kst(14)).skip === 'DISABLED');
t('D2 줄 없음 → DISABLED', rm.due({}, kst(14)).skip === 'DISABLED');
t('D3 첫 시각 전(12:02) → NO_DUE_HOUR', rm.due({ '담당자댓글리마인더사용': 'TRUE', '담당자댓글마감시각': '13,16,17' }, kst(12)).skip === 'NO_DUE_HOUR');
const d13 = rm.due({ '담당자댓글리마인더사용': 'true', '담당자댓글마감시각': '13,16,17' }, kst(13));
t('D4 13:02 → 13시, 날짜 2026-11-27', d13.targetHour === 13 && d13.today === '2026-11-27', d13);
t('D5 16:30 → 16시(지난 것 중 가장 늦은 것)', rm.due({ '담당자댓글리마인더사용': 'TRUE', '담당자댓글마감시각': '13,16,17' }, kst(16, 30)).targetHour === 16);
t('D6 23:02 → 17시', rm.due({ '담당자댓글리마인더사용': 'TRUE', '담당자댓글마감시각': '13,16,17' }, kst(23)).targetHour === 17);
t('D7 기록 이름 = 날짜_시각_이메일(소문자)', rm.docId('2026-11-27', 13, ' Kim@NKMRO.com ') === '2026-11-27_13_kim@nkmro.com');

// ---- mailParts
const parts = rm.mailParts({ email: 'kim@nkmro.com', name: '김담당' }, 3, 13, pc.APP_URL);
t('M1 제목에 건수·시각', parts.subject === '[MRO 워크허브] 아직 첫 댓글이 없는 담당 게시글 3건 (13시 알림)', parts.subject);
t('M2 받는 사람·인사·링크', parts.to === 'kim@nkmro.com' && parts.hello === '김담당님,' && parts.link === pc.APP_URL && parts.button === '시황 뉴스 열기');
const html = pc.buildHtml(parts), text = pc.buildText(parts);
t('M3 본문에 건수만(게시글 목록 없음) + 링크', /3건 있어요/.test(text) && text.indexOf(pc.APP_URL) >= 0 && html.indexOf('시황 뉴스 열기') >= 0);

// ---- plan (feedEngine 그대로 사용 — 계산은 예전 푸시와 같은 함수)
const orig = feedEngine.computeReminderItemsForManager;
feedEngine.computeReminderItemsForManager = function (viewer) { return viewer.email === 'kim@nkmro.com' ? [{}, {}, {}] : viewer.email === 'lee@nkmro.com' ? [] : [{}]; };
const users = [
  { email: 'kim@nkmro.com', name: '김담당', role: '담당', status: '활성' }, { email: 'lee@nkmro.com', name: '이담당', role: '담당', status: '활성' },
  { email: 'off@nkmro.com', name: '퇴사담당', role: '담당', status: '비활성' }, { email: 'lead@nkmro.com', name: '팀장', role: '팀장', status: '활성' },
  { email: 'park@gmail.com', name: '박담당', role: '담당', status: '활성' }];
const pl = rm.plan({ users });
t('P1 활성 담당만(비활성·팀장 제외)', pl.map(x => x.email).join(',') === 'kim@nkmro.com,lee@nkmro.com,park@gmail.com', pl);
t('P2 건수', pl.map(x => x.count).join(',') === '3,0,1', pl);

// ---- runReminderMail_ (index.js 코드를 그대로 꺼내 가짜 Firestore·메일로 실행)
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const a0 = SRC.indexOf('async function runReminderMail_('), a1 = SRC.indexOf('\n}\n', a0) + 3;
function makeRun(st) {
  const firestore = { collection: () => ({ doc: id => ({ async get() { return { exists: !!st.docs[id] }; }, async set(v) { st.docs[id] = v; st.writes.push([id, v]); } }) }) };
  const mailer = {
    isAllowedRecipient: e => /@nkmro\.com$/.test(String(e).trim().toLowerCase()),
    describeError: e => String(e),
    async verifyLogin() { st.logins++; if (st.loginFail) throw new Error('LOGIN'); },
    async sendMessages(msgs) { st.sent.push(...msgs); return { ok: true, results: msgs.map(m => ({ to: m.to, ok: !(st.failTo === m.to), messageId: 'x' })) }; }
  };
  const FieldValue = { serverTimestamp: () => 'TS' };
  return new Function('reminderMail', 'feedEngine', 'firestore', 'mailer', 'perfCloseMail', 'FieldValue', SRC.slice(a0, a1) + '\nreturn runReminderMail_;')(rm, feedEngine, firestore, mailer, pc, FieldValue);
}
const S = { '담당자댓글리마인더사용': 'TRUE', '담당자댓글마감시각': '13,16,17' };
(async function () {
  let st = { docs: {}, writes: [], sent: [], logins: 0 };
  let r = await makeRun(st)(kst(13), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: S });
  t('R1 13:02 → 김담당 1통(3건), 0건 담당은 기록만, 회사 메일 아님은 기록만', r.sent === 1 && r.none === 1 && r.notCompany === 1 && st.sent.length === 1 && st.sent[0].to === 'kim@nkmro.com' && /3건/.test(st.sent[0].subject), { r, sent: st.sent.map(m => m.to) });
  t('R2 발송 기록 3개(같은 날·시각 다시 안 감)', Object.keys(st.docs).sort().join(',') === '2026-11-27_13_kim@nkmro.com,2026-11-27_13_lee@nkmro.com,2026-11-27_13_park@gmail.com' && st.docs['2026-11-27_13_kim@nkmro.com'].channel === 'mail', Object.keys(st.docs));
  t('R3 메일 로그인 1번', st.logins === 1);
  r = await makeRun(st)(kst(13, 30), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: S });
  t('R4 같은 시각 다시 실행 → 아무도 안 보냄, 로그인 안 함', r.sent === 0 && r.already === 3 && st.sent.length === 1 && st.logins === 1, r);
  r = await makeRun(st)(kst(16), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: S });
  t('R5 16:02 → 16시 몫으로 다시 1통', r.hour === 16 && r.sent === 1 && st.sent.length === 2, r);
  const st2 = { docs: {}, writes: [], sent: [], logins: 0, loginFail: true };
  r = await makeRun(st2)(kst(13), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: S });
  t('R6 메일 로그인 실패 → 안 보냄, 김담당 기록 안 남김(다음 정시에 다시)', !!r.loginFailed && st2.sent.length === 0 && !st2.docs['2026-11-27_13_kim@nkmro.com'], r);
  const st3 = { docs: {}, writes: [], sent: [], logins: 0, failTo: 'kim@nkmro.com' };
  r = await makeRun(st3)(kst(13), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: S });
  t('R7 그 사람 발송 실패 → failed 1, 기록 안 남김', r.failed === 1 && !st3.docs['2026-11-27_13_kim@nkmro.com'], r);
  r = await makeRun({ docs: {}, writes: [], sent: [], logins: 0 })(kst(13), { allUsers: users, allPosts: [], allItems: [], allComments: [], settings: { '담당자댓글리마인더사용': 'FALSE' } });
  t('R8 사용 FALSE → 아무것도 안 함', r.skipped && r.reason === 'DISABLED', r);
  t('R9 issueMailBatchTest가 시트 읽은 뒤 이슈 메일 판단 전에 부름', /runReminderMail_\(nowMs, \{ allUsers, allPosts, allItems, allComments, settings \}\)/.test(SRC) && SRC.indexOf('[reminderMail]') < SRC.indexOf("settings['이슈댓글메일사용']"));
  feedEngine.computeReminderItemsForManager = orig;
  console.log('reminder_mail_tests: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
