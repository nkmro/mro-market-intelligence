// cloud-run/mro-functions/lib/perfCloseMail.js
//
// 성과평가 월 마감 안내 메일(2026-11-13 재홍님 결정 — 설계서 PERFORMANCE_EVAL_DESIGN_v1.md 4-7절)의 "계산" 부분만 모은 모듈.
// 시트·Firestore·메일 서버에 직접 접근하지 않는 순수 함수만 둔다(입출력은 index.js runPerfCloseMail_가 담당) —
// 그래서 가짜 데이터로 그대로 시험할 수 있다(tests/perf_close_mail_tests.js). lib/issueMail.js와 같은 나눔.
//
// 결정 ①~④ (2026-11-13 확정)
//  ① 보내는 시각 = 인사평가설정 '성과마감메일시각'(0~23, 기본 17 = 오후 5시)
//  ② 그 시각이 지난 뒤에 마감하면 다음 정시(매시 2분 일괄 실행)에 바로 보낸다
//  ③ 받는 사람 = 그 팀 활성 일반·담당 + 활성 임원 전원, 마감한 사람 본인 제외
//  ④ 다시 마감하면 한 번 더(마감일시가 새로 찍힘) — 같은 날 같은 달은 1번(발송 기록 이름에 마감일이 들어감)
// 켜기·시험(시트에서만): '성과마감메일사용' = TRUE일 때만 보냄(줄 없음 = 꺼짐 — 이슈 메일 '이슈댓글메일사용'과 같은 관례).
//   '성과마감메일테스트수신자'에 주소가 있으면 그 한 곳에만 [시험]으로 보낸다(시각·지난 마감 제한 없이 팀마다 하루 1번).
// 메일에는 점수·매출·이익 숫자를 넣지 않는다(메일은 공개 기간이 끝나도 남으므로).

const performance = require('./performance');

const APP_URL = 'https://nkmro.github.io/mro-market-intelligence/feed.html';
const ENABLED_KEY = '성과마감메일사용';
const TEST_KEY = '성과마감메일테스트수신자';
const ALLOWED_DOMAIN = '@nkmro.com'; // lib/mailer.js와 같은 제한(회사 메일 서버)
const MEMBER_ROLES = ['일반', '담당'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
// 색·글꼴·버튼은 이슈 댓글 메일(lib/issueMail.js 17~19·41~43행)과 같은 값
const C = { accent: '#3a2f6e', headerEnd: '#7c5aa8', blue: '#2f5fd0', bg: '#f6f5f2', border: '#e2e0da', text: '#1f2320', muted: '#6b6f6a', danger: '#b3413a', dangerSoft: '#f6e2de', greenSoft: '#e3f3ea', green: '#1d6b43' };
const FONT = "'Malgun Gothic','맑은 고딕',Apple SD Gothic Neo,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";

function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function lc(v) { return cell(v).toLowerCase(); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }

// 서울 날짜·시
function seoul(nowMs) {
  const d = new Date(nowMs + 9 * 3600 * 1000);
  return { iso: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()), year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, hour: d.getUTCHours() };
}
function addDays(iso, n) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
// 'YYYY-MM-DD' → '10/14(수)' 또는 연도 포함 '2026/12/31(목)'
function fmtDay(iso, withYear) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return (withYear ? y + '/' : '') + m + '/' + d + '(' + dow + ')';
}
function teamLabel(team) { return team === '본사' ? team : team + '팀'; } // 앱 feed.html teamLabel과 같은 규칙

// 인사평가설정 A1:C → 메일 설정. 사용 = TRUE일 때만(대소문자 무시), 시각 = performance.readCloseMailHour(기본 17)
function readMailSettings(settingsRows) {
  const find = function (k) { const r = (settingsRows || []).find(function (x) { return cell(x && x[0]) === k; }); return r ? cell(r[1]) : ''; };
  const h = performance.readCloseMailHour(settingsRows);
  return { enabled: find(ENABLED_KEY).toUpperCase() === 'TRUE', hour: h.hour, hourValid: h.valid, testRecipient: find(TEST_KEY) };
}

// 성과-마감 A2:F → 팀마다 마지막 줄(performance.readClose와 같은 규칙: 같은 팀·연도 줄이 여럿이면 아래 줄)
function lastCloseByTeam(closeRows, year) {
  const hit = {};
  (closeRows || []).forEach(function (r) { if (r && Number(r[0]) === Number(year) && cell(r[1])) hit[cell(r[1])] = r; });
  return Object.keys(hit).map(function (team) {
    const r = hit[team], m = Number(r[2]), st = performance.closeStamp(r[4]);
    return { team: team, month: m, closerEmail: lc(r[3]), closeDate: st.date, closedAt: st.text };
  }).filter(function (x) { return Number.isInteger(x.month) && x.month >= 1 && x.month <= 12 && /^\d{4}-\d{2}-\d{2}$/.test(x.closeDate); });
}

// 보낼 마감 목록. p = { nowMs, years:[{ year, closeRows }], hour, testRecipient }
// 정식: 마감일 당일 hour시 이후 또는 마감일 다음 날(②의 늦은 마감 — 예 23:30 마감 → 다음 날 0시 2분)만. 그보다 지난 마감은 보내지 않음.
// 시험: 시각·날짜 제한 없이 팀마다 마지막 마감을 하루 1번(기록 이름 test_오늘_…)
function planDue(p) {
  const now = seoul(p.nowMs), test = cell(p.testRecipient) !== '';
  const out = [];
  (p.years || []).forEach(function (y) {
    lastCloseByTeam(y.closeRows, y.year).forEach(function (c) {
      const base = y.year + '_' + c.team + '_' + c.month;
      if (test) { out.push(Object.assign({ year: Number(y.year), test: true, key: 'test_' + now.iso + '_' + base }, c)); return; }
      const due = (now.iso === c.closeDate && now.hour >= Number(p.hour)) || now.iso === addDays(c.closeDate, 1);
      if (due) out.push(Object.assign({ year: Number(y.year), test: false, key: base + '_' + c.closeDate }, c));
    });
  });
  return out;
}

// 받는 사람(③). users = [{ email, name, role, team, status }]. 반환 { members, execs, excluded:[{ email, reason }] }
function recipientsFor(job, users) {
  const seen = {}, members = [], execs = [], excluded = [];
  (users || []).forEach(function (u) {
    const e = lc(u.email);
    if (!e || seen[e]) return;
    const role = cell(u.role), active = cell(u.status) === '활성';
    const isMember = active && MEMBER_ROLES.indexOf(role) >= 0 && cell(u.team) === job.team, isExec = active && role === '임원';
    if (!isMember && !isExec) return;
    seen[e] = true;
    if (e === job.closerEmail) { excluded.push({ email: e, reason: 'CLOSER' }); return; }
    if (e.slice(-ALLOWED_DOMAIN.length) !== ALLOWED_DOMAIN) { excluded.push({ email: e, reason: 'DOMAIN' }); return; }
    (isMember ? members : execs).push({ email: e, name: cell(u.name), kind: isMember ? 'member' : 'exec' });
  });
  return { members: members, execs: execs, excluded: excluded };
}

// 메일 한 통의 글자들(제목·본문 문장). job + 받는 사람 + publishDays + nowMs + users(마감자 이름) → 문장 묶음
function mailParts(job, r, o) {
  const now = seoul(o.nowMs);
  const pub = performance.publishWindow(job.closeDate, o.publishDays, now.iso); // until = 마감일 + N일(N ≥ 1일 때)
  const days = [job.closeDate].concat(pub.until ? [pub.until] : []);
  const withYear = days.some(function (d) { return Number(d.slice(0, 4)) !== now.year; }); // 해가 하나라도 다르면 모든 날짜에 연도
  const closeText = fmtDay(job.closeDate, withYear) + (job.closedAt.length > 10 ? ' ' + job.closedAt.slice(11) : '');
  const label = teamLabel(job.team);
  const range = job.year + '년 ' + (job.month === 1 ? '1월 누계' : '1~' + job.month + '월 누계') + ' 기준';
  const subject = (job.test ? '[시험] ' : '') + '[MRO 워크허브] ' + (job.year !== now.year ? job.year + '년 ' : '') + job.month + '월 성과평가 실적 마감 안내 (' + label + ')';
  const closer = (o.users || []).find(function (u) { return lc(u.email) === job.closerEmail; });
  const closerText = closer && cell(closer.name) ? ' · ' + (cell(closer.role) === '팀장' ? '팀장 ' : '') + cell(closer.name) : '';
  const hello = r.name ? r.name + '님, 안녕하세요.' : '안녕하세요.';
  const link = r.kind === 'exec' ? APP_URL + '?view=perf&team=' + encodeURIComponent(job.team) : APP_URL + '?view=perf';
  let lines;
  if (r.kind === 'exec') {
    lines = [label + '이 ' + job.month + '월 성과평가 실적을 마감했습니다. (마감 ' + closeText + closerText + ')',
      range + ' ' + label + '의 점수·순위와 매출·이익 숫자를 앱에서 확인할 수 있습니다.',
      '(임원 화면은 공개 기간과 관계없이 숫자가 항상 보입니다.)'];
  } else {
    lines = [label + ' ' + job.month + '월 성과평가 실적이 마감되었습니다. (마감 ' + closeText + ')',
      range + ' 우리 팀 점수와 순위를 지금 앱에서 확인할 수 있습니다.'];
  }
  const period = r.kind === 'exec' ? null : (pub.until
    ? { title: '📅 실적 공개 기간: ' + fmtDay(job.closeDate, withYear) + ' ~ ' + fmtDay(pub.until, withYear) + ' 23:59',
      lines: ['이 기간에는 우리 팀 매출·이익 숫자도 함께 볼 수 있습니다.', '기간이 끝나면 숫자는 가려지고, 점수와 순위는 계속 볼 수 있습니다.'] }
    : { title: null, lines: ['이번 마감은 매출·이익 숫자를 공개하지 않고, 점수와 순위만 볼 수 있습니다.'] });
  return { subject: subject, hello: hello, lines: lines, period: period, link: link, button: '성과평가 바로가기',
    footer: '이 메일은 MRO 워크허브에서 자동으로 보낸 안내입니다.' };
}

function buildText(parts, testNote) {
  return (testNote ? testNote + '\n\n' : '') + parts.hello + '\n\n' + parts.lines.join('\n') + '\n\n' +
    (parts.period ? (parts.period.title ? parts.period.title + '\n' : '') + parts.period.lines.join('\n') + '\n\n' : '') +
    parts.button + ': ' + parts.link + '\n\n' + parts.footer;
}
// 이슈 댓글 메일과 같은 틀(600px 표·보라 머리·버튼 표 칸 — Outlook 대응, lib/issueMail.js 108~125행)
function buildHtml(parts, testNote) {
  const btn = '<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td bgcolor="' + C.accent + '" style="background:' + C.accent + ';border-radius:20px;padding:10px 22px;">' +
    '<a href="' + esc(parts.link) + '" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;font-family:' + FONT + ';"><span style="color:#ffffff;">' + esc(parts.button) + '</span></a></td></tr></table>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#ffffff;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:' + FONT + ';background:' + C.bg + ';" bgcolor="' + C.bg + '"><tr><td>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="' + C.accent + '" style="background:' + C.accent + ';background-image:linear-gradient(90deg,' + C.accent + ',' + C.headerEnd + ');padding:14px 22px;border-radius:10px 10px 0 0;">' +
    '<span style="color:#ffffff;font-weight:800;font-size:16px;letter-spacing:.2px;">MRO 워크허브</span>&nbsp;&nbsp;<span style="color:#cfc8e6;font-size:12px;letter-spacing:.3px;">WORK HUB</span></td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + C.border + ';border-top:none;"><tr><td style="padding:18px 18px 20px;">' +
    (testNote ? '<div style="font-size:12px;color:' + C.danger + ';background:' + C.dangerSoft + ';padding:8px 10px;margin:0 0 12px;">' + esc(testNote) + '</div>' : '') +
    '<div style="font-size:14px;color:' + C.text + ';margin:0 0 10px;line-height:1.6;">' + esc(parts.hello) + '</div>' +
    '<div style="font-size:14px;color:' + C.text + ';line-height:1.7;margin:0 0 14px;">' + parts.lines.map(esc).join('<br>') + '</div>' +
    (parts.period ? '<div style="font-size:13px;color:' + C.green + ';background:' + C.greenSoft + ';line-height:1.7;padding:10px 12px;margin:0 0 16px;">' +
      (parts.period.title ? '<b>' + esc(parts.period.title) + '</b><br>' : '') + parts.period.lines.map(esc).join('<br>') + '</div>' : '') +
    btn +
    '<div style="font-size:12px;color:' + C.muted + ';line-height:1.6;margin:14px 0 0;text-align:center;">버튼이 열리지 않으면 이 주소를 눌러 주세요:<br><a href="' + esc(parts.link) + '" style="color:' + C.blue + ';word-break:break-all;">' + esc(parts.link) + '</a></div>' +
    '<div style="border-top:1px solid ' + C.border + ';margin:18px 0 0;padding-top:12px;font-size:11px;color:#9a9891;line-height:1.6;">' + esc(parts.footer) + '</div>' +
    '</td></tr></table></td></tr></table></td></tr></table></body></html>';
}

// 한 마감(job)의 메일 목록. o = { nowMs, publishDays, users, testRecipient, alreadySent:[이메일] }
// 정식: 받는 사람마다 1통(이미 받은 사람 제외). 시험: 시험 주소 1곳에 팀원용·임원용 견본 2통(받는 사람이 그 종류에 없으면 그 견본은 생략)
function buildMessages(job, o) {
  const rc = recipientsFor(job, o.users);
  const all = rc.members.concat(rc.execs);
  if (job.test) {
    const to = lc(o.testRecipient);
    const note = '[시험 발송] 인사평가설정 \'' + TEST_KEY + '\'로 이 주소에만 보냈습니다. 정식 운영이었다면 ' + all.length + '명(팀원 ' + rc.members.length + '·임원 ' + rc.execs.length + ')에게 각자 이름으로 발송됩니다.';
    const msgs = [];
    [['member', rc.members[0]], ['exec', rc.execs[0]]].forEach(function (k) {
      if (!k[1]) return;
      const parts = mailParts(job, k[1], o);
      msgs.push({ to: to, kind: k[0], subject: parts.subject + (k[0] === 'exec' ? ' — 임원용 견본' : ' — 팀원용 견본'), html: buildHtml(parts, note), text: buildText(parts, note) });
    });
    return { messages: msgs, recipients: rc };
  }
  const done = {};
  (o.alreadySent || []).forEach(function (e) { done[lc(e)] = true; });
  return { recipients: rc, messages: all.filter(function (r) { return !done[r.email]; }).map(function (r) {
    const parts = mailParts(job, r, o);
    return { to: r.email, kind: r.kind, subject: parts.subject, html: buildHtml(parts), text: buildText(parts) };
  }) };
}

module.exports = { APP_URL, ENABLED_KEY, TEST_KEY, readMailSettings, lastCloseByTeam, planDue, recipientsFor, mailParts, buildMessages, buildText, buildHtml, fmtDay, teamLabel };
