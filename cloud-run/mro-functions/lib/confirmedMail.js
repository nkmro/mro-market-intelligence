// cloud-run/mro-functions/lib/confirmedMail.js
// 확정 실적 알림 메일 (2026-11-25 재홍님 결정). 순수 함수 — 시트·Firestore·메일 서버 접근 없음(index.js runConfirmedMail_가 입출력).
// - 올림 메일: 관리자가 매출마감 엑셀을 올리면 그 팀 담당(그 달 고객사가 있는 사람) + 그 팀 팀장에게.
//   같은 달을 다시 올리면 확정이 다시 열린 담당 + 팀장에게만('바뀐 곳 없음'·다시 열린 담당 없음 = 메일 없음)
// - 모두 확정 메일: 그 팀 담당이 모두 [확정]하면 그 팀 팀장에게 '[최종 확정] 해 주세요'(팀장이 없으면 관리자)
// - 언제: 올림·모두 확정 시각부터 실적-설정 결과메일대기분(주간 실적 결과 메일과 같은 값)이 지난 뒤 첫 매시 실행(issueMailBatchTest — 회사 메일 비밀번호가 이 함수에만 연결)
//   그 사이 다시 올리면 기다림이 새로 시작. 보낼 때 시트를 다시 읽어 지금 상태로 판단(최종 확정됐거나 확정이 취소됐으면 '모두 확정' 메일은 안 보냄)
// - 끄기: 실적-설정 메일사용 = FALSE (주간 실적 메일과 같은 스위치)
// - 메일에는 금액을 넣지 않음(주간 실적 결과 메일과 같은 원칙) — 고객사 수·담당 이름·할 일만, 숫자는 앱에서
const ws = require('./weeklySales');
const cs = require('./confirmedSales');

const COLL = 'confirmedSalesMails'; // Firestore: {종류}_{연도}_{월}_{팀} 문서 1개 = 보낼(보낸) 메일 1건
const KIND_UPLOAD = 'upload', KIND_DONE = 'done';
const FOOTER = '이 메일은 MRO 워크허브에서 자동으로 보냈어요.';

function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function docId(kind, year, month, team) { return kind + '_' + year + '_' + month + '_' + team; }
function teamLabel(team) { return team === '본사' ? team : team + '팀'; }
function union(a, b) { const out = (a || []).slice(); (b || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); return out; }

// 올린 뒤 Firestore에 적을 값. prev = 그 문서(없으면 null), plan = planUpload 결과(ok). 메일이 필요 없으면 null
// - 처음 올림(first) → 그 팀 담당 모두 + 팀장 / 다시 올림 → 다시 열린 담당(reopen) + 팀장, 다시 열린 담당이 없으면 메일 없음
// - 아직 안 보낸 메일(pending)이 있으면 합침(처음 올림이었으면 계속 처음 올림, 다시 열린 담당은 더함), 기다림은 새로 시작
function uploadRecord(prev, plan, nowMs) {
  const pending = !!prev && prev.status === 'pending';
  const first = !!plan.first || (pending && !!prev.first);
  const reopen = union(pending ? prev.reopen : [], plan.reopen);
  if (!first && !reopen.length) return null;
  return { kind: KIND_UPLOAD, year: plan.year, month: plan.month, team: plan.team, first: first, reopen: first ? [] : reopen,
    finalUndone: !!plan.finalUndone || (pending && !!prev.finalUndone), atMs: nowMs, status: 'pending', sentTo: [] };
}
// [확정] 뒤: 그 팀 그 달 담당이 모두 확정이면 '모두 확정' 메일 기록(아니면 null). rows = confRowsOf, st = 확정 뒤 stateOf
function doneRecord(year, month, team, rows, st, nowMs) {
  const mgrs = cs.managersIn(rows);
  if (!mgrs.length || mgrs.some(function (m) { return !st.confirmed[m]; }) || st.final) return null;
  return { kind: KIND_DONE, year: year, month: month, team: team, atMs: nowMs, status: 'pending', sentTo: [] };
}
// 지금 보낼 때가 됐나(결과메일대기분 — weeklySales.resultDue와 같은 규칙)
function due(doc, nowMs, settings) { return ws.resultDue(Number(doc.atMs), nowMs, settings); }

// 이름 → 메일 받을 사람(그 팀 활성·@nkmro.com, 같은 이름이면 그 팀 사람 먼저)
function personByName_(people, name, team) {
  const hits = people.filter(function (u) { return u.name === name && u.active; });
  return hits.find(function (u) { return (u.teams.length ? u.teams : [u.team]).indexOf(team) >= 0; }) || hits[0] || null;
}
function mailable_(u) { return !!u && u.active && /@nkmro\.com$/.test(u.email); }
function leadsOf_(people, team) { return people.filter(function (u) { return u.active && u.role === '팀장' && (u.teams.length ? u.teams : [u.team]).indexOf(team) >= 0 && mailable_(u); }); }

// 보낼 때의 한 건. p = { doc, confRows, progRows, userRows, mgrRows, customers, adminEmail, minNote }
// 반환 { skip?: 이유, recipients: [{ email, name, kind:'mgr'|'lead'|'admin', mine?: {...} }], info }
function buildJob(p) {
  const d = p.doc, year = Number(d.year), month = Number(d.month), team = cs.cfTeam(d.team);
  const rows = cs.confRowsOf(p.confRows, year, month, team), st = cs.stateOf(p.progRows, year, month, team);
  const people = cs.peopleOf(p.userRows), leads = leadsOf_(people, team);
  const admin = people.find(function (u) { return u.email === cell(p.adminEmail).toLowerCase(); });
  const mgrs = cs.managersIn(rows);
  const info = { year: year, month: month, team: team, kind: d.kind, first: !!d.first, finalUndone: !!d.finalUndone,
    managers: mgrs, unlinked: rows.filter(function (r) { return !r.weekly; }).length, minNote: Number(p.minNote) || 0,
    confirmed: mgrs.map(function (m) { return { name: m, at: st.confirmed[m] ? st.confirmed[m].at : '' }; }) };
  if (!rows.length) return { skip: 'NO_DATA', recipients: [], info: info };
  if (st.final && d.kind === KIND_DONE) return { skip: 'ALREADY_FINAL', recipients: [], info: info };
  const out = [], seen = {};
  const add = function (u, kind, extra) { if (!mailable_(u) || seen[u.email]) return; seen[u.email] = true; out.push(Object.assign({ email: u.email, name: u.name, kind: kind }, extra || {})); };
  const mineOf = function (name) {
    const my = rows.filter(function (r) { return r.manager === name; });
    const groups = []; my.forEach(function (r) { if (r.weekly && groups.indexOf(r.weekly) < 0) groups.push(r.weekly); });
    return { customers: my.length, groups: groups.length, recheck: my.filter(function (r) { return r.recheck; }).length };
  };
  if (d.kind === KIND_DONE) {
    if (mgrs.some(function (m) { return !st.confirmed[m]; })) return { skip: 'NOT_ALL_DONE', recipients: [], info: info };
    leads.forEach(function (u) { add(u, 'lead'); });
    if (!out.length && admin) add(admin, 'admin'); // 팀장 없음 → 관리자(주간 실적 알림과 같은 규칙)
    return { recipients: out, info: info };
  }
  // 올림 메일: 담당(처음 = 그 달 담당 모두, 다시 = 다시 열린 담당 중 아직 확정 전인 사람) → 팀장(담당을 겸해도 팀장용 한 통)
  const lp = cs.leadOf(people, team);
  const names = d.first ? mgrs : (d.reopen || []).filter(function (m) { return mgrs.indexOf(m) >= 0 && !st.confirmed[m]; });
  const leadEmails = {}; leads.forEach(function (u) { leadEmails[u.email] = true; });
  names.forEach(function (m) { const u = personByName_(people, m, team); if (u && !leadEmails[u.email]) add(u, 'mgr', { mine: mineOf(m) }); });
  const choices = cs.buildView({ year: year, month: month, team: team, customers: p.customers, planRows: [], confRows: p.confRows, progRows: p.progRows, minNote: info.minNote,
    me: '', scope: 'all', withNames: true, userRows: p.userRows, mgrRows: p.mgrRows }).mgrChoices || [];
  info.mgrChoices = choices.length;
  info.reopened = d.first ? [] : names;
  leads.forEach(function (u) { add(u, 'lead', { mine: lp && u.name ? mineOf(u.name) : null }); });
  if (!leads.length && admin) add(admin, 'admin');
  if (!d.first && !names.length && !info.finalUndone) return { skip: 'NOTHING_REOPENED', recipients: [], info: info }; // 그 사이 다시 확정했으면 보낼 것 없음
  return { recipients: out, info: info };
}

// 메일 한 통의 글자(perfCloseMail.buildText·buildHtml 틀). r = buildJob().recipients 한 사람, appUrl = 앱 주소
function mailParts(info, r, appUrl) {
  const label = teamLabel(info.team), title = info.month + '월 확정 실적';
  const link = appUrl + '?view=confirmed&team=' + encodeURIComponent(info.team) + '&month=' + info.month + '&year=' + info.year;
  const isLead = r.kind === 'lead' || r.kind === 'admin';
  const hello = r.kind === 'lead' ? (r.name ? r.name + ' 팀장님,' : '팀장님,') : (r.name ? r.name + '님,' : '');
  const proxy = r.kind === 'admin' ? ['(' + label + '은 팀장 계정이 없어 관리자에게 보냈어요.)'] : [];
  const note = info.minNote ? '묶음(취합 고객사) 비고 ' + info.minNote + '자 이상' : '묶음(취합 고객사) 비고';
  if (info.kind === KIND_DONE) {
    const left = info.unlinked ? ['· 연결 안 된 고객사 ' + info.unlinked + '곳 — 연결해야 [최종 확정]을 누를 수 있어요.'] : [];
    return { to: r.email, subject: '[MRO 워크허브] ' + title + ' 담당 모두 확정 — 최종 확정해 주세요 (' + label + ')', hello: hello,
      lines: [label + ' 담당 ' + info.managers.length + '명이 ' + title + '을 모두 [확정]했어요.'].concat(proxy),
      period: { title: null, lines: info.confirmed.map(function (c) { return '· ✓ ' + c.name + (c.at ? ' · ' + c.at.slice(5).replace('-', '/') + ' 확정' : ''); })
        .concat(left, ['', '숫자와 묶음 비고를 확인하고 [최종 확정]을 눌러 주세요. 최종 확정하면 임원 화면에 보여요.']) },
      button: '확정 실적 열기', link: link, footer: FOOTER };
  }
  const mine = r.mine && r.mine.customers ? r.mine : null;
  if (!info.first) { // 다시 올림
    if (!isLead) return { to: r.email, subject: '[MRO 워크허브] ' + title + '을 다시 올려 내 확정이 다시 열렸어요 (' + label + ')', hello: hello,
      lines: [title + '(' + label + ')을 관리자가 다시 올려, 바뀐 고객사가 있는 내 [확정]이 다시 열렸어요.'],
      period: { title: null, lines: ['· 다시 확인할 고객사: ' + (mine ? mine.recheck : 0) + '곳 (화면에 "다시 확인" 표시)', '· 매출·시스템 이익이 바뀐 곳은 이익이 새 시스템 값으로 돌아갔어요.', '', '이익과 ' + note + '를 확인하고 다시 [확정]해 주세요.'] },
      button: '확정 실적 열기', link: link, footer: FOOTER };
    return { to: r.email, subject: '[MRO 워크허브] ' + title + ' 다시 올림 — 확정이 다시 열린 담당이 있어요 (' + label + ')', hello: hello,
      lines: [title + '(' + label + ')을 관리자가 다시 올렸어요.'].concat(proxy),
      period: { title: null, lines: (info.reopened.length ? ['· 확정이 다시 열린 담당: ' + info.reopened.join('·')] : [])
        .concat(info.finalUndone ? ['· 바뀐 고객사가 있어 [최종 확정]이 풀렸어요.'] : [], ['', '담당이 다시 [확정]하면 [최종 확정]을 눌러 주세요.']) },
      button: '확정 실적 열기', link: link, footer: FOOTER };
  }
  const todo = '① 이익 확인(매입 마감 차이만 고침) ② ' + note + ' ③ [확정]';
  if (!isLead) return { to: r.email, subject: '[MRO 워크허브] ' + title + '이 올라왔어요 — 확인 후 [확정]해 주세요 (' + label + ')', hello: hello,
    lines: [info.month + '월 매출마감 기준 확정 실적(' + label + ')이 올라왔어요.'],
    period: { title: null, lines: ['· 내 고객사: ' + (mine ? mine.customers : 0) + '곳' + (mine && mine.groups ? ' (묶음 ' + mine.groups + '곳)' : ''), '· 할 일: ' + todo, '· 매출은 계산서 기준이라 고칠 수 없어요.'] },
    button: '확정 실적 열기', link: link, footer: FOOTER };
  return { to: r.email, subject: '[MRO 워크허브] ' + title + '이 올라왔어요 (' + label + ')', hello: hello,
    lines: [info.month + '월 매출마감 기준 확정 실적(' + label + ')이 올라와 담당에게 알림을 보냈어요.'].concat(proxy),
    period: { title: null, lines: ['· 담당 ' + info.managers.length + '명: ' + (info.managers.join('·') || '없음')]
      .concat(mine ? ['· 팀장님이 맡은 고객사: ' + mine.customers + '곳 — ' + todo] : [],
        info.unlinked ? ['· 연결 안 된 고객사: ' + info.unlinked + '곳 → 화면에서 주간 고객사에 연결해 주세요.'] : [],
        info.mgrChoices ? ['· 담당을 골라야 할 고객사: ' + info.mgrChoices + '곳 → 화면 "담당을 골라 주세요"'] : [],
        ['', '담당이 모두 [확정]하면 [최종 확정]을 눌러 주세요.']) },
    button: '확정 실적 열기', link: link, footer: FOOTER };
}

module.exports = { COLL, KIND_UPLOAD, KIND_DONE, docId, uploadRecord, doneRecord, due, buildJob, mailParts, teamLabel };
