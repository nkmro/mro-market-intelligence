// cloud-run/mro-functions/lib/reminderMail.js
// 담당자 댓글 리마인더 — 메일(2026-11-27 재홍님 결정). 순수 함수 — 시트·Firestore·메일 서버 접근 없음(index.js runReminderMail_가 입출력).
// - 왜: 앱 푸시는 로그인 세션이 살아 있을 때만 나가서(lib/pushSender.js sendReminderPushForUser), 앱을 오래 안 쓴 담당에게는 닿지 않았다.
// - 무엇: 설정 '담당자댓글마감시각'(쉼표로 여러 시각)마다, 담당(역할)별로 "내가 담당인 품목 중 아직 첫 댓글이 없는 게시글" 건수만 메일로.
//   받는 사람 = 그 담당 본인만. 건수가 0이면 안 보냄. 본문 = 건수 + 앱 링크(게시글 목록은 넣지 않음 — 재홍님 결정).
// - 켜고 끄기: 설정 '담당자댓글리마인더사용' TRUE/FALSE(예전 앱 푸시와 같은 스위치). 앱 푸시 리마인더는 이 메일로 대체(dispatch에서 reminder 호출 뺌).
// - 같은 날 같은 시각에 두 번 안 감: Firestore reminderDeliveries/{날짜}_{시각}_{이메일}(예전 푸시와 같은 문서 — 바꾸는 날 겹쳐도 한 번만).
const feedEngine = require('./feedEngine');

const COLL = 'reminderDeliveries';
const FOOTER = '이 메일은 MRO 워크허브에서 자동으로 보냈어요.'; // 다른 알림 메일(lib/confirmedMail.js)과 같은 문구

// 지금 보낼 시각인지. 반환: { skip: 'DISABLED'|'NO_DUE_HOUR' } 또는 { targetHour, today, hours }
// 하루 중 이미 지난 시각들 중 가장 늦은 시각 하나만(예전 reminderBatchTest와 같은 규칙 — index.js 2853~2861줄)
function due(settings, nowMs) {
  const on = String((settings || {})['담당자댓글리마인더사용'] || '').trim().toUpperCase() === 'TRUE';
  if (!on) return { skip: 'DISABLED' };
  const hours = feedEngine.parseReminderHours((settings || {})['담당자댓글마감시각']);
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const past = hours.filter(function (h) { return hour >= h; });
  if (!past.length) return { skip: 'NO_DUE_HOUR', hours: hours, hour: hour };
  return { targetHour: Math.max.apply(null, past), today: kst.toISOString().slice(0, 10), hours: hours };
}

function docId(today, hour, email) { return today + '_' + hour + '_' + String(email || '').trim().toLowerCase(); }

// 메일 한 통(perfCloseMail.buildText/buildHtml 모양). r = { email, name }, count = 건수, hour = 기준 시각
function mailParts(r, count, hour, appUrl) {
  return {
    to: r.email,
    subject: '[MRO 워크허브] 아직 첫 댓글이 없는 담당 게시글 ' + count + '건 (' + hour + '시 알림)',
    hello: r.name ? r.name + '님,' : '',
    lines: ['내가 담당인 품목의 시황 게시글 중 아직 첫 댓글을 달지 않은 것이 ' + count + '건 있어요.', '앱에서 확인하고 댓글을 남겨 주세요.'],
    period: null,
    button: '시황 뉴스 열기', link: appUrl, footer: FOOTER
  };
}

// 이번 시각에 보낼 담당 목록. o = { users, posts, items, comments, leadScope, teamByEmail }
// 반환: [{ email, name, count }] — 건수 0인 담당은 { …, count: 0 }(호출부가 '보낼 것 없음'으로 기록). 대상 = 활성 '담당'만(비활성은 메일 안 감)
function plan(o) {
  return (o.users || []).filter(function (u) { return String(u.role || '').trim() === '담당' && String(u.status || '').trim() === '활성' && u.email; }).map(function (u) {
    const viewer = feedEngine.findViewer(o.users, u.email);
    const items = viewer ? feedEngine.computeReminderItemsForManager(viewer, o.posts, o.items, o.comments, o.leadScope, o.teamByEmail) : [];
    return { email: u.email, name: u.name || '', count: items.length };
  });
}

module.exports = { COLL, FOOTER, due, docId, mailParts, plan };
