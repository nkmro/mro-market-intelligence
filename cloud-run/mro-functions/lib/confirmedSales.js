// cloud-run/mro-functions/lib/confirmedSales.js
// 실적 관리 › 확정 실적 (2026-11-23 재홍님 승인 · 시안 6장 2026-11-24 승인). 순수 함수 — 시트 접근 없음.
// - 파일: 그해 실적관리 파일(주간 실적과 같은 파일). 탭 3개: 실적-고객사연결 · 실적-확정 · 실적-확정진행 (재홍님이 만들고 머리줄을 붙임)
// - 달 = 매출마감일(BR)의 달. 숫자는 모두 천원 정수(주간 실적과 같음 — 화면이 원 단위 합계를 천원으로 반올림해서 보냄)
// - 올리기 = 관리자만, 팀 단위(파일 안 실적부서명으로 나눔 — 동부만 올리면 동부만 바뀜). 원본 줄은 저장하지 않고 시스템 구매사명별 합계만
// - 고객사: 시스템 구매사명 → 주간 고객사(실적-고객사연결 탭, 없으면 같은 이름이면 자동). 못 잇는 곳은 올릴 때 화면에서 골라 연결 탭에 저장
// - 담당(배정·수정 권한에만 씀, 화면·출력에는 안 나옴): 구매담당(K) → 사용자팀마스터 J열 사무소(줄 수가 가장 많은 사무소) → 그 사무소의 활성 '담당'
//   (계정 없는 구매담당은 건너뜀 = 같은 고객사 다른 구매담당을 따름) · 사무소를 못 찾거나 그 사무소 담당이 0명·2명 이상이면 팀장
// - 매출은 고칠 수 없음(계산서 기준). 이익만 고침 + 비고(확정 전 확정비고최소글자 이상, 실적-설정)
// - 다시 올리기(2026-11-23 재홍님): 시스템 구매사명별로 비교 — 그대로면 고친 이익·비고·확정 유지 / 매출·시스템 이익이 바뀌면 고친 이익 지우고
//   비고는 남기고 '다시확인' 표시, 그 담당 확정만 다시 열림 / 새로 생기면 추가 / 빠지면 지움(경고). 바뀐 곳이 있으면 최종 확정이 풀림

const ws = require('./weeklySales');
const teamsLib = require('./teams');

const TAB_LINK = '실적-고객사연결';
const TAB_CONF = '실적-확정';
const TAB_CPROG = '실적-확정진행';
const CF_TABS = [TAB_LINK, TAB_CONF, TAB_CPROG];
const CF_HEADERS = {};
CF_HEADERS[TAB_LINK] = ['시스템구매사명', '팀', '주간고객사명', '등록자', '등록일시'];
CF_HEADERS[TAB_CONF] = ['연도', '월', '팀', '시스템구매사명', '주간고객사명', '사무소', '담당', '시스템매출', '시스템이익', '이익(수정)', '비고', '매입미마감줄수', '수정자', '수정일시', '다시확인'];
CF_HEADERS[TAB_CPROG] = ['연도', '월', '팀', '단계', '담당', '처리자', '일시'];
const CONF_COLS = 15, LINK_COLS = 5, CPROG_COLS = 7; // A:O · A:E · A:G

const ST_UPLOAD = '올림', ST_REUPLOAD = '다시 올림', ST_CONFIRM = '담당 확정', ST_CANCEL = '확정 취소', ST_REOPEN = '확정 다시 열림',
  ST_FINAL = '최종 확정', ST_UNFINAL = '최종 확정 풀림';
const NOTE_MAX = 200, NAME_MAX = 100, ITEMS_MAX = 2000;

function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }
function lcs(v) { return cell(v).toLowerCase(); }
// 실적부서명 '동부지역' → '동부' (주간 실적 팀 이름과 같게)
function cfTeam(v) { return ws.normTeam(v).replace(/지역$/, ''); }
function indexRows(values) { return (values || []).map(function (r, i) { return { row: i + 2, v: r || [] }; }); }
function nextFreeRow(indexed) { let last = 1; indexed.forEach(function (x) { if (x.v.some(function (c) { return cell(c) !== ''; })) last = x.row; }); return last + 1; }
function isInt(n) { return typeof n === 'number' && Number.isInteger(n) && Math.abs(n) < 1e12; }
function noteLen(s) { return Array.from(cell(s)).length; }

// 탭 머리줄 확인(시트 우선 — 줄이 다르면 쓰지 않음)
function checkHeaders(tab, row) {
  const want = CF_HEADERS[tab], got = (row || []).map(cell);
  while (got.length && got[got.length - 1] === '') got.pop();
  return { tab: tab, ok: got.length === want.length && want.every(function (h, i) { return got[i] === h; }), header: got };
}

// 사용자팀마스터(A2:L) → 사람 목록 + J열 사무소
function peopleOf(userRows) {
  return (userRows || []).filter(function (r) { return r && cell(r[0]); }).map(function (r) {
    return { email: lcs(r[0]), name: cell(r[1]), role: cell(r[2]), team: ws.normTeam(r[3]), active: cell(r[4]) === '활성', office: cell(r[9]),
      teams: teamsLib.teamsOf(r[3], r[teamsLib.EXTRA_COL]).map(ws.normTeam) };
  });
}
// 그 팀 팀장(활성, 소속 또는 겸임). 없으면 null
function leadOf(people, team) {
  return people.find(function (u) { return u.active && u.role === '팀장' && (u.teams.length ? u.teams : [u.team]).indexOf(team) >= 0 && u.name; }) || null;
}

// 담당 배정. buyers = { 구매담당 이름: 줄 수 }. 반환 { office, manager, why }
// why: OK · NO_OFFICE(구매담당 계정·사무소를 못 찾음) · OFFICE_NONE(그 사무소 담당 0명) · OFFICE_MANY(2명 이상) — OK 말고는 팀장
//      NO_LEAD = 팀장도 없음 → 담당 빈칸(관리자만 고칠 수 있음)
function assign(people, team, buyers) {
  const offices = {}, order = [];
  Object.keys(buyers || {}).forEach(function (b) {
    const name = cell(b), n = Number(buyers[b]) || 0; if (!name || n <= 0) return;
    const hits = people.filter(function (u) { return u.name === name && u.office; });
    const u = hits.find(function (x) { return x.team === team; }) || hits[0]; // 같은 이름이면 그 팀 사람 먼저
    if (!u) return; // 계정 없음 → 건너뜀(같은 고객사 다른 구매담당을 따름)
    if (!(u.office in offices)) { offices[u.office] = 0; order.push(u.office); }
    offices[u.office] += n;
  });
  let office = '';
  order.forEach(function (o) { if (!office || offices[o] > offices[office]) office = o; }); // 같으면 먼저 나온 사무소
  const lead = leadOf(people, team), leadName = lead ? lead.name : '';
  if (!office) return { office: '', manager: leadName, why: lead ? 'NO_OFFICE' : 'NO_LEAD' };
  const mgrs = people.filter(function (u) { return u.active && u.role === '담당' && u.team === team && u.office === office && u.name; });
  if (mgrs.length === 1) return { office: office, manager: mgrs[0].name, why: 'OK' };
  return { office: office, manager: leadName, why: lead ? (mgrs.length ? 'OFFICE_MANY' : 'OFFICE_NONE') : 'NO_LEAD' };
}

// 그 달 그 팀 주간 고객사(실적-고객사, 그 달 적용 줄) — 순서 칸 → 시트 줄 순서. active = 사용 끔이 아님
function weeklyCustomers(customers, team, month) {
  const out = [];
  ws.customersAt(customers, month).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name || ws.normTeam(r[0]) !== team) return;
    const ord = ws.num(r[7]);
    out.push({ name: name, active: cell(r[6]).toUpperCase() !== 'FALSE', ord: ord === null ? 1e9 : ord, i: i });
  });
  return out.sort(function (a, b) { return a.ord - b.ord || a.i - b.i; });
}
// 연결 탭 → { 시스템구매사명: 주간고객사명 } (그 팀, 아래 줄이 이김)
function linkMap(linkRows, team) {
  const m = {};
  (linkRows || []).forEach(function (r) { if (cell(r && r[0]) && cfTeam(r[1]) === team && cell(r[2])) m[cell(r[0])] = cell(r[2]); });
  return m;
}

// 진행 상태(줄 순서 = 시간 순서). { uploaded, confirmed:{ 담당: {by, at} }, final:{by, at}|null, lastUpload }
function stateOf(progRows, year, month, team) {
  const st = { uploaded: false, confirmed: {}, final: null, lastUpload: null };
  (progRows || []).forEach(function (r) {
    if (ws.num(r && r[0]) !== year || ws.num(r[1]) !== month || cfTeam(r[2]) !== team) return;
    const stage = cell(r[3]), who = cell(r[4]), info = { by: lcs(r[5]), at: cell(r[6]) };
    if (stage === ST_UPLOAD || stage === ST_REUPLOAD) { st.uploaded = true; st.lastUpload = info; }
    else if (stage === ST_CONFIRM && who) st.confirmed[who] = info;
    else if ((stage === ST_CANCEL || stage === ST_REOPEN) && who) delete st.confirmed[who];
    else if (stage === ST_FINAL) st.final = info;
    else if (stage === ST_UNFINAL) st.final = null;
  });
  return st;
}

// 실적-확정 줄 → 그 연·월·팀 줄 목록 { row, name, weekly, office, manager, sales, sysProfit, profit(고친 값|null), note, unclosed, by, at, recheck }
function confRowsOf(confRows, year, month, team) {
  const out = [];
  indexRows(confRows).forEach(function (x) {
    const r = x.v;
    if (ws.num(r[0]) !== year || ws.num(r[1]) !== month || cfTeam(r[2]) !== team || !cell(r[3])) return;
    out.push({ row: x.row, name: cell(r[3]), weekly: cell(r[4]), office: cell(r[5]), manager: cell(r[6]), sales: ws.num(r[7]) || 0, sysProfit: ws.num(r[8]) || 0,
      profit: ws.num(r[9]), note: cell(r[10]), unclosed: ws.num(r[11]) || 0, by: lcs(r[12]), at: cell(r[13]), recheck: cell(r[14]) });
  });
  return out;
}
// 그 팀 그 달 담당 목록(줄 순서, 빈 이름 제외)
function managersIn(rows) { const out = []; rows.forEach(function (r) { if (r.manager && out.indexOf(r.manager) < 0) out.push(r.manager); }); return out; }
function confRowValues(year, month, team, it, a, profit, note, who, at, recheck) {
  return [year, month, team, it.name, it.weekly, a.office, a.manager, it.sales, it.profit, profit === null ? '' : profit, note, it.unclosed, who, at, recheck];
}

// 올리기 검사·계획(미리보기와 적용이 같은 함수). p = { year, month, team, items:[{ name, sales, profit, unclosed, buyers }], links:{ 시스템: 주간 },
//   customers, linkRows, confRows, progRows, userRows, who, nowMs }
// 반환 { ok, error?, unlinked:[{name,sales}], weeklyNames, diff:{same,changed,added,removed}, reopen:[담당], finalUndone, first, warnings:[], writes, linkWrites, progWrites }
function planUpload(p) {
  const year = Number(p.year), month = Number(p.month), team = cfTeam(p.team);
  if (!Number.isInteger(year) || year < 2000 || !Number.isInteger(month) || month < 1 || month > 12) return { ok: false, error: 'BAD_MONTH' };
  const items = Array.isArray(p.items) ? p.items : null;
  if (!items || !items.length) return { ok: false, error: 'NO_ROWS' };
  if (items.length > ITEMS_MAX) return { ok: false, error: 'TOO_MANY' };
  const seen = {};
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}, name = cell(it.name);
    if (!name || name.length > NAME_MAX) return { ok: false, error: 'BAD_NAME', field: name.slice(0, 30) };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    if (!isInt(it.sales) || !isInt(it.profit) || !(Number.isInteger(it.unclosed) && it.unclosed >= 0)) return { ok: false, error: 'BAD_NUMBER', field: name };
    if (it.buyers !== undefined && (typeof it.buyers !== 'object' || it.buyers === null || Array.isArray(it.buyers))) return { ok: false, error: 'BAD_FIELD', field: name };
  }
  const wc = weeklyCustomers(p.customers, team, month), weeklyNames = wc.map(function (c) { return c.name; });
  if (!wc.length) return { ok: false, error: 'NO_TEAM', field: team };
  const lm = linkMap(p.linkRows, team), chosen = p.links || {}, people = peopleOf(p.userRows);
  const unlinked = [], linkNew = [];
  const list = items.map(function (it) {
    const name = cell(it.name);
    let weekly = lm[name] || (weeklyNames.indexOf(name) >= 0 ? name : '');
    if (!weekly && cell(chosen[name])) {
      const w = cell(chosen[name]);
      if (w !== name && weeklyNames.indexOf(w) < 0) return { bad: name };
      weekly = w; linkNew.push([name, team, w]); // w === name = (새 고객사로 따로)
    }
    if (!weekly) unlinked.push({ name: name, sales: it.sales });
    return { name: name, weekly: weekly, sales: it.sales, profit: it.profit, unclosed: it.unclosed, buyers: it.buyers || {} };
  });
  const bad = list.find(function (x) { return x.bad; });
  if (bad) return { ok: false, error: 'BAD_LINK', field: bad.bad };
  const old = confRowsOf(p.confRows, year, month, team), oldBy = {};
  old.forEach(function (r) { oldBy[r.name] = r; });
  const st = stateOf(p.progRows, year, month, team);
  const who = lcs(p.who), at = ws.seoulStamp(p.nowMs);
  const diff = { same: [], changed: [], added: [], removed: [] }, reopenSet = {}, warnings = [], writes = [];
  const confIdx = indexRows(p.confRows);
  let next = nextFreeRow(confIdx);
  list.forEach(function (it) {
    const o = oldBy[it.name];
    if (o && o.sales === it.sales && o.sysProfit === it.profit) {
      diff.same.push(it.name);
      if (o.unclosed !== it.unclosed) writes.push({ range: 'L' + o.row, values: [it.unclosed] }); // 매입 미마감 줄 수만 새 값
      return;
    }
    const a = assign(people, team, it.buyers);
    if (a.why !== 'OK') warnings.push({ name: it.name, why: a.why, office: a.office, manager: a.manager });
    if (o) {
      const re = (o.sales !== it.sales ? '매출 ' + o.sales + '→' + it.sales : '') + (o.sysProfit !== it.profit ? (o.sales !== it.sales ? ' · ' : '') + '이익 ' + o.sysProfit + '→' + it.profit : '');
      diff.changed.push({ name: it.name, from: { sales: o.sales, profit: o.sysProfit }, to: { sales: it.sales, profit: it.profit }, manager: a.manager });
      writes.push({ range: 'A' + o.row + ':O' + o.row, values: confRowValues(year, month, team, it, a, null, o.note, who, at, re) }); // 고친 이익 지움, 비고 남김
      if (o.manager) reopenSet[o.manager] = true;
      if (a.manager) reopenSet[a.manager] = true;
    } else {
      diff.added.push({ name: it.name, sales: it.sales, profit: it.profit, manager: a.manager });
      writes.push({ range: 'A' + next + ':O' + next, values: confRowValues(year, month, team, it, a, null, '', who, at, '') });
      next++;
      if (a.manager) reopenSet[a.manager] = true;
    }
  });
  old.forEach(function (o) {
    if (seen[o.name]) return;
    diff.removed.push({ name: o.name, sales: o.sales, manager: o.manager });
    writes.push({ range: 'A' + o.row + ':O' + o.row, values: new Array(CONF_COLS).fill('') }); // 줄 비움(줄 삭제 API 없이)
    if (o.manager) reopenSet[o.manager] = true;
  });
  const first = !st.uploaded && !old.length;
  const changedAny = diff.changed.length + diff.added.length + diff.removed.length > 0;
  const reopen = Object.keys(reopenSet).filter(function (m) { return !!st.confirmed[m]; }); // 확정했던 담당만 다시 열림
  const finalUndone = !first && !!st.final && changedAny;
  const progIdx = indexRows(p.progRows);
  let pn = nextFreeRow(progIdx);
  const progWrites = [];
  const prog = function (stage, mgr) { progWrites.push({ range: 'A' + pn + ':G' + pn, values: [year, month, team, stage, mgr || '', who, at] }); pn++; };
  if (first || changedAny) prog(first ? ST_UPLOAD : ST_REUPLOAD, '');
  reopen.forEach(function (m) { prog(ST_REOPEN, m); });
  if (finalUndone) prog(ST_UNFINAL, '');
  const linkIdx = indexRows(p.linkRows);
  let ln = nextFreeRow(linkIdx);
  const linkWrites = linkNew.map(function (l) { const w = { range: 'A' + ln + ':E' + ln, values: [l[0], l[1], l[2], who, at] }; ln++; return w; });
  const base = { year: year, month: month, team: team, unlinked: unlinked, weeklyNames: weeklyNames, diff: diff, reopen: reopen, finalUndone: finalUndone, first: first,
    changedAny: changedAny, warnings: warnings, unclosedTotal: items.reduce(function (s, it) { return s + it.unclosed; }, 0) };
  if (unlinked.length) return Object.assign({ ok: false, error: 'UNLINKED' }, base);
  return Object.assign({ ok: true, writes: writes, linkWrites: linkWrites, progWrites: progWrites }, base);
}

// 화면 자료. p = { year, month, team, customers, planRows, confRows, progRows, minNote, me(이름), scope:'all'|'mine' }
// 묶음 = 주간 고객사 순서(사용 끔이어도 실적이 있으면 보임) + 주간 고객사에 없는 묶음(새 고객사로 따로)은 뒤. 담당·사무소는 돌려주지 않음(mine 표시만)
function buildView(p) {
  const year = p.year, month = p.month, team = p.team;
  const rows = confRowsOf(p.confRows, year, month, team), st = stateOf(p.progRows, year, month, team);
  const plan = {};
  (p.planRows || []).forEach(function (r) {
    if (ws.num(r && r[0]) !== year || ws.normTeam(r[1]) !== team) return;
    plan[cell(r[2])] = { sales: ws.num(r[3 + (month - 1) * 3]), profit: ws.num(r[4 + (month - 1) * 3]) };
  });
  const groups = [], byName = {};
  function group(name, active) {
    if (byName[name]) return byName[name];
    const pl = plan[name] || { sales: null, profit: null };
    const g = { name: name, planSales: pl.sales, planProfit: pl.profit, sales: 0, profit: 0, subs: [], active: active };
    byName[name] = g; groups.push(g); return g;
  }
  weeklyCustomers(p.customers, team, month).forEach(function (c) { group(c.name, c.active); });
  const me = cell(p.me);
  rows.forEach(function (r) {
    const g = group(r.weekly || r.name, true);
    const profit = r.profit === null ? r.sysProfit : r.profit;
    g.subs.push({ name: r.name, sales: r.sales, sysProfit: r.sysProfit, profit: profit, edited: r.profit !== null && r.profit !== r.sysProfit, note: r.note,
      unclosed: r.unclosed, recheck: r.recheck, mine: !!me && r.manager === me, done: !!st.confirmed[r.manager] });
    g.sales += r.sales; g.profit += profit;
  });
  let out = groups.filter(function (g) { return g.subs.length || g.active; });
  if (p.scope === 'mine') out = out.filter(function (g) { return g.subs.some(function (s) { return s.mine; }); }).map(function (g) {
    const subs = g.subs.filter(function (s) { return s.mine; });
    return Object.assign({}, g, { subs: subs, sales: subs.reduce(function (a, s) { return a + s.sales; }, 0), profit: subs.reduce(function (a, s) { return a + s.profit; }, 0) });
  });
  out.forEach(function (g) { delete g.active; });
  const total = { planSales: 0, planProfit: 0, sales: 0, profit: 0 };
  out.forEach(function (g) { total.planSales += g.planSales || 0; total.planProfit += g.planProfit || 0; total.sales += g.sales; total.profit += g.profit; });
  const managers = managersIn(rows).map(function (m) { const c = st.confirmed[m]; return { name: m, done: !!c, at: c ? c.at : '' }; });
  return { year: year, month: month, team: team, uploaded: st.uploaded || rows.length > 0, final: st.final ? { at: st.final.at } : null,
    lastUpload: st.lastUpload ? { at: st.lastUpload.at } : null, groups: out, total: total, managers: managers, minNote: p.minNote,
    myDone: !!me && !!st.confirmed[me], unclosedTotal: rows.reduce(function (a, r) { return a + r.unclosed; }, 0) };
}
// 그 연도·팀에 올린 달 목록(작은 달부터)
function monthsOf(confRows, year, team) {
  const out = [];
  (confRows || []).forEach(function (r) { const m = ws.num(r && r[1]); if (ws.num(r && r[0]) === year && cfTeam(r && r[2]) === team && cell(r[3]) && m >= 1 && m <= 12 && out.indexOf(m) < 0) out.push(m); });
  return out.sort(function (a, b) { return a - b; });
}

// 담당 [저장]: 이익(수정)·비고. p = { year, month, team, edits:[{ name, profit, note }], confRows, progRows, me, isAdmin, who, nowMs }
// profit: 빈칸 = 시스템 값으로 되돌림(고친 값 지움), 시스템 값과 같아도 지움. 매출 칸을 보내면 거절(SALES_LOCKED)
function planEdit(p) {
  const year = Number(p.year), month = Number(p.month), team = cfTeam(p.team);
  const rows = confRowsOf(p.confRows, year, month, team), st = stateOf(p.progRows, year, month, team);
  if (!rows.length) return { ok: false, error: 'NO_DATA' };
  if (st.final) return { ok: false, error: 'FINAL_DONE' };
  const edits = Array.isArray(p.edits) ? p.edits : [];
  if (!edits.length) return { ok: false, error: 'NO_CHANGES' };
  const by = {}; rows.forEach(function (r) { by[r.name] = r; });
  const writes = [], seen = {}, who = lcs(p.who), at = ws.seoulStamp(p.nowMs);
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i] || {}, name = cell(e.name), r = by[name];
    if (!r) return { ok: false, error: 'UNKNOWN_CUSTOMER', field: name };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    if ('sales' in e) return { ok: false, error: 'SALES_LOCKED', field: name };
    if (!p.isAdmin && r.manager !== cell(p.me)) return { ok: false, error: 'NOT_MY_CUSTOMER', field: name };
    if (st.confirmed[r.manager]) return { ok: false, error: 'MY_DONE', field: name };
    let profit = r.profit;
    if ('profit' in e) {
      const n = ws.checkNum(e.profit);
      if (Number.isNaN(n)) return { ok: false, error: 'BAD_NUMBER', field: name };
      profit = n === null || n === r.sysProfit ? null : n;
    }
    const note = 'note' in e ? cell(e.note) : r.note;
    if (note.length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG', field: name };
    if (profit === r.profit && note === r.note && !r.recheck) continue;
    writes.push({ range: 'J' + r.row + ':K' + r.row, values: [profit === null ? '' : profit, note] }, { range: 'M' + r.row + ':O' + r.row, values: [who, at, ''] }); // 저장하면 '다시확인' 표시 지움
  }
  return { ok: true, writes: writes, rows: writes.length / 2 };
}

// [확정] / [확정 취소] / [최종 확정]. p = { year, month, team, confRows, progRows, manager(누구의 확정인지), minNote, isAdmin, who, nowMs }
function progRow_(p, team, stage, mgr) {
  const row = nextFreeRow(indexRows(p.progRows));
  return { range: 'A' + row + ':G' + row, values: [Number(p.year), Number(p.month), team, stage, mgr || '', lcs(p.who), ws.seoulStamp(p.nowMs)] };
}
function planConfirm(p) {
  const year = Number(p.year), month = Number(p.month), team = cfTeam(p.team), mgr = cell(p.manager);
  const rows = confRowsOf(p.confRows, year, month, team), st = stateOf(p.progRows, year, month, team);
  if (!rows.length) return { ok: false, error: 'NO_DATA' };
  if (st.final) return { ok: false, error: 'FINAL_DONE' };
  const mine = rows.filter(function (r) { return r.manager === mgr; });
  if (!mgr || !mine.length) return { ok: false, error: 'NO_ROWS' };
  if (st.confirmed[mgr]) return { ok: false, error: 'ALREADY_DONE' };
  const min = Number(p.minNote) || 0;
  const short = mine.filter(function (r) { return noteLen(r.note) < min; }).map(function (r) { return r.name; });
  if (short.length) return { ok: false, error: 'NOTE_SHORT', min: min, names: short };
  return { ok: true, write: progRow_(p, team, ST_CONFIRM, mgr) };
}
function planCancel(p) {
  const year = Number(p.year), month = Number(p.month), team = cfTeam(p.team), mgr = cell(p.manager);
  const st = stateOf(p.progRows, year, month, team);
  if (st.final) return { ok: false, error: 'FINAL_DONE' };
  if (!mgr || !st.confirmed[mgr]) return { ok: false, error: 'NOT_DONE' };
  return { ok: true, write: progRow_(p, team, ST_CANCEL, mgr) };
}
function planFinal(p) {
  const year = Number(p.year), month = Number(p.month), team = cfTeam(p.team);
  const rows = confRowsOf(p.confRows, year, month, team), st = stateOf(p.progRows, year, month, team);
  if (!rows.length) return { ok: false, error: 'NO_DATA' };
  if (st.final) return { ok: false, error: 'FINAL_DONE' };
  const left = managersIn(rows).filter(function (m) { return !st.confirmed[m]; });
  if (left.length) return { ok: false, error: 'MANAGERS_NOT_DONE', names: left };
  if (rows.some(function (r) { return !r.manager; })) return { ok: false, error: 'NO_MANAGER', names: rows.filter(function (r) { return !r.manager; }).map(function (r) { return r.name; }) };
  return { ok: true, write: progRow_(p, team, ST_FINAL, '') };
}

module.exports = {
  TAB_LINK, TAB_CONF, TAB_CPROG, CF_TABS, CF_HEADERS, CONF_COLS, LINK_COLS, CPROG_COLS,
  ST_UPLOAD, ST_REUPLOAD, ST_CONFIRM, ST_CANCEL, ST_REOPEN, ST_FINAL, ST_UNFINAL,
  cfTeam, checkHeaders, peopleOf, leadOf, assign, weeklyCustomers, linkMap, stateOf, confRowsOf, managersIn,
  planUpload, buildView, monthsOf, planEdit, planConfirm, planCancel, planFinal, noteLen
};
