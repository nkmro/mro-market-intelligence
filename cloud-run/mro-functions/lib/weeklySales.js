// cloud-run/mro-functions/lib/weeklySales.js
// 실적 관리 › 주간 실적 (2026-11-17 재홍님 결정). 1-가: 연결 시험(ping)용 순수 함수 — 시트 접근 없음.
// - 파일: 연도별 '{연도}_실적관리' 구글 시트. MRO 본 시트 '설정' 탭의 실적관리파일_{연도} 키로 찾는다
//   (인사평가파일_{연도}와 같은 방식, lib/competency.js findFileId).
// - 탭 5개 이름·머리글은 아래 HEADERS로 고정(템플릿 2026_실적관리.xlsx와 같음).
// - 주차 규칙(재홍님 확정): 실적이 생긴 주를 그다음 입력 요일(월)에 넣는다. 값은 그 달 1일부터 누적.
//   ① 그 달 첫 주(월~일)의 날짜 수가 첫주합침일수(기본 4) 이하이면 다음 주에 합친다.
//   ② 말일이 든 주의 월요일~말일 날짜 수가 가마감이월일수(기본 5) 이상이면 가마감은 다음 월요일(다음 달이어도),
//      아니면 그 월요일이 가마감(예상 마감 실적). 가마감 날에는 가마감만 넣는다.

const FILE_KEY_PREFIX = '실적관리파일_';
const TAB_CUSTOMERS = '실적-고객사';
const TAB_PLAN = '실적-연간계획';
const TAB_WEEKLY = '실적-주간';
const TAB_PROGRESS = '실적-진행';
const TAB_SETTINGS = '실적-설정';
const TABS = [TAB_CUSTOMERS, TAB_PLAN, TAB_WEEKLY, TAB_PROGRESS, TAB_SETTINGS];

const PLAN_HEADERS = ['연도', '팀', '구매사명'];
for (let m = 1; m <= 12; m++) PLAN_HEADERS.push(m + '월 매출', m + '월 이익', m + '월 이익률');
PLAN_HEADERS.push('연간 매출', '연간 이익');

const HEADERS = {};
HEADERS[TAB_CUSTOMERS] = ['팀', '계열', '구매사명', '발주형태', '사무소', '담당', '사용', '순서', '비고', '등록자', '등록일시', '적용월']; // 적용월: 2026-11-17 고객사 정보 이력(빈칸 = 1월부터)
HEADERS[TAB_PLAN] = PLAN_HEADERS;
HEADERS[TAB_WEEKLY] = ['연도', '월', '주차', '팀', '구매사명', '매출누적', '이익누적', '비고', '입력자', '입력일시', '담당원래매출', '담당원래이익'];
HEADERS[TAB_PROGRESS] = ['연도', '월', '주차', '팀', '단계', '담당', '처리자', '일시', '메일'];
HEADERS[TAB_SETTINGS] = ['키', '값', '설명'];

// 실적-설정 키와 기본값(시트에 줄이 없을 때만 쓴다 — 시트 우선)
const MODE_KEY_PREFIX = '입력방식_';
const MODES = ['2단계', '3단계'];
const DEFAULTS = { 입력요일: '월', 담당마감시각: 15, 팀장마감시각: 16, 메일사용: true, 첫주합침일수: 4, 가마감이월일수: 5, 결과메일대기분: 60, 입력시작일수: 3 }; // 결과메일대기분: 2026-11-17 재홍님 요청(4팀 완료 1시간 뒤)
const GAMAGAM = '가마감';

function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }

// '설정' 탭 행 배열에서 실적관리파일_{연도} 값
function findFileId(settingRows, year) {
  const key = FILE_KEY_PREFIX + year;
  for (let i = 0; i < (settingRows || []).length; i++) {
    const r = settingRows[i] || [];
    if (cell(r[0]) === key) return cell(r[1]) || null;
  }
  return null;
}

// 머리글 1행이 이름·순서 그대로인지 (lib/performance.js checkHeaders와 같은 판단)
function checkHeaders(tab, row) {
  const want = HEADERS[tab];
  const got = (row || []).map(cell);
  while (got.length && got[got.length - 1] === '') got.pop();
  const missing = want.filter(function (h) { return got.indexOf(h) < 0; });
  const ok = got.length === want.length && want.every(function (h, i) { return got[i] === h; });
  return { tab: tab, ok: ok, header: got.length > 8 ? got.slice(0, 8).concat(['…' + got.length + '칸']) : got, missing: missing };
}

// 엑셀 팀명 → 앱 팀명 ("서부지역팀" → "서부", "영업지원팀" → "영업지원", "동부" → "동부")
function normTeam(t) { return cell(t).replace(/(지역팀|팀)$/, ''); }

// ---- 고객사 정보 이력 (2026-11-17 재홍님 확정: 탭을 늘리지 않고 실적-고객사 L열 '적용월') ----
// 같은 팀 + 구매사명 줄이 여러 개면 '그 달 이하에서 가장 늦은 적용월' 줄을 쓴다(같은 적용월이면 아래쪽 줄). 빈칸 = 1월부터.
// 순서(H)는 그 고객사의 첫 줄(가장 이른 적용월) 값만 쓴다. 그 달에 아직 없는 고객사(첫 적용월 > 달)는 빠진다.
function applyMonth(r) { const s = cell(r && r[11]); return /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 12 ? Number(s) : 0; }
function customersAt(rows, month) {
  const m = Number(month) || 12, groups = {}, order = [];
  (rows || []).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name) return;
    const k = normTeam(r[0]) + '/' + name, am = applyMonth(r);
    const g = groups[k] || (groups[k] = { first: null, firstAm: 99, pick: null, pickAm: -1 });
    if (g.first === null) order.push(k);
    if (am < g.firstAm) { g.first = r; g.firstAm = am; }
    if (am <= m && am >= g.pickAm) { g.pick = r; g.pickAm = am; }
  });
  const out = [];
  order.forEach(function (k) {
    const g = groups[k]; if (!g.pick) return;
    const r = g.pick.slice(); r[7] = g.first[7]; out.push(r);
  });
  return out;
}

function intIn(v, lo, hi) { const s = cell(v); if (!/^\d+$/.test(s)) return null; const n = Number(s); return n >= lo && n <= hi ? n : null; }

// 실적-설정 A~C 행 → 설정값(없는 키는 기본값, usedDefault에 표시) + 잘못된 값 목록
function readSettings(rows) {
  const map = {}, bad = [], modes = {};
  (rows || []).forEach(function (r) {
    const k = cell(r && r[0]);
    if (!k || k === '키') return;
    if (k.indexOf(MODE_KEY_PREFIX) === 0 && k.length > MODE_KEY_PREFIX.length) {
      const v = cell(r[1]);
      if (MODES.indexOf(v) < 0) bad.push({ key: k, value: v, why: '2단계 또는 3단계' });
      else modes[k.slice(MODE_KEY_PREFIX.length)] = v;
      return;
    }
    map[k] = r[1];
  });
  const out = { modes: modes, bad: bad, usedDefault: [] };
  function take(key, parse, why) {
    if (!(key in map)) { out[key] = DEFAULTS[key]; out.usedDefault.push(key); return; }
    const v = parse(map[key]);
    if (v === null) { bad.push({ key: key, value: cell(map[key]), why: why }); out[key] = DEFAULTS[key]; }
    else out[key] = v;
  }
  take('입력요일', function (v) { return cell(v) === '월' ? '월' : null; }, '지금은 월만 가능');
  take('담당마감시각', function (v) { return intIn(v, 0, 23); }, '0~23 정수');
  take('팀장마감시각', function (v) { return intIn(v, 0, 23); }, '0~23 정수');
  take('메일사용', function (v) { const s = cell(v).toUpperCase(); return s === 'TRUE' ? true : s === 'FALSE' ? false : null; }, 'TRUE 또는 FALSE');
  take('첫주합침일수', function (v) { return intIn(v, 0, 6); }, '0~6 정수');
  take('가마감이월일수', function (v) { return intIn(v, 1, 8); }, '1~8 정수 (8 = 넘기지 않음)');
  take('결과메일대기분', function (v) { return intIn(v, 0, 1440); }, '0~1440 정수(분)');
  take('입력시작일수', function (v) { return intIn(v, 0, 6); }, '0~6 정수 (3 = 전주 금요일부터)'); // 2026-11-18 재홍님 요청: 마감 월요일 며칠 전부터 입력이 열리나
  return out;
}

// ---- 날짜 (UTC 자정 ms로 계산 — 시간대와 무관한 달력 계산) ----
const DAY = 86400000;
function ymd(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
function monIdx(ms) { return (new Date(ms).getUTCDay() + 6) % 7; } // 월=0 … 일=6

// 한 달의 입력 일정. [{ week: 1.., label: '1주차' | '가마감', inputDate, openDate, from, to }] — to는 누적 마지막 날(가마감은 말일)
// inputDate = 마감 월요일(16시 알림·마감 표시 기준), openDate = 입력이 열리는 날(inputDate − 입력시작일수, 기본 3 = 전주 금요일)
function weekPlan(year, month, s) {
  s = s || DEFAULTS;
  const merge = s.첫주합침일수 === undefined ? DEFAULTS.첫주합침일수 : s.첫주합침일수;
  const carry = s.가마감이월일수 === undefined ? DEFAULTS.가마감이월일수 : s.가마감이월일수;
  const lead = (s.입력시작일수 === undefined ? DEFAULTS.입력시작일수 : s.입력시작일수) * DAY;
  const first = utc(year, month, 1);
  const last = utc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - DAY;
  const mon0 = first - monIdx(first) * DAY;
  const firstWeekDays = 7 - monIdx(first);
  let weekStart = firstWeekDays <= merge ? mon0 + 7 * DAY : mon0;
  const lastMon = last - monIdx(last) * DAY;
  const tailDays = monIdx(last) + 1;
  const gm = tailDays >= carry ? lastMon + 7 * DAY : lastMon;
  const out = [];
  let n = 1;
  for (let rep = weekStart + 7 * DAY; rep < gm; rep += 7 * DAY, n++) {
    out.push({ week: n, label: n + '주차', inputDate: ymd(rep), openDate: ymd(rep - lead), from: ymd(first), to: ymd(rep - DAY), gamagam: false });
  }
  out.push({ week: n, label: GAMAGAM, inputDate: ymd(gm), openDate: ymd(gm - lead), from: ymd(first), to: ymd(last), gamagam: true });
  return out;
}

// 서울 기준 오늘 → 지금 보여 줄 보고(입력이 열린 날(openDate)이 오늘 이하인 가장 최근 보고). 지난달·이번 달 일정에서 찾는다.
// 마감(월요일 16시)이 지나도 다음 주차 입력이 열리기 전까지는 그 주차가 '지금 보고'(잠그지 않음 — 2026-11-18 재홍님 확정)
function seoulToday(nowMs) { return ymd(Math.floor(((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000) / DAY) * DAY); }
function currentReport(nowMs, s) {
  const today = seoulToday(nowMs);
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
  const all = [];
  [prev, [y, m]].forEach(function (ym) {
    weekPlan(ym[0], ym[1], s).forEach(function (w) { all.push(Object.assign({ year: ym[0], month: ym[1] }, w)); });
  });
  all.sort(function (a, b) { return a.inputDate < b.inputDate ? -1 : a.inputDate > b.inputDate ? 1 : 0; });
  let cur = null, next = null;
  all.forEach(function (w) { if (w.openDate <= today) cur = w; else if (!next) next = w; });
  return { today: today, current: cur, next: next };
}

// 실적-고객사 / 실적-연간계획 연결 점검 (키 = 팀 + 구매사명)
function crossCheck(customerRows, planRows, year) {
  const cust = {}, plan = {}, dup = [], seenM = {};
  (customerRows || []).forEach(function (r) {
    const name = cell(r && r[2]); if (!name) return;
    const k = normTeam(r[0]) + '/' + name, km = k + '@' + applyMonth(r);
    if (seenM[km]) dup.push(k + (applyMonth(r) ? ' (' + applyMonth(r) + '월)' : '')); // 같은 고객사·같은 적용월 줄이 두 개면 중복(이력 줄은 중복 아님)
    seenM[km] = true;
  });
  customersAt(customerRows, 12).forEach(function (r) { cust[normTeam(r[0]) + '/' + cell(r[2])] = { active: cell(r[6]).toUpperCase() !== 'FALSE' }; }); // 사용 여부 = 12월 기준(가장 최근 줄)
  (planRows || []).forEach(function (r) {
    const name = cell(r && r[2]); if (!name || Number(cell(r[0])) !== year) return;
    plan[normTeam(r[1]) + '/' + name] = true;
  });
  return {
    customers: Object.keys(cust).length,
    activeCustomers: Object.keys(cust).filter(function (k) { return cust[k].active; }).length,
    planRows: Object.keys(plan).length,
    noPlan: Object.keys(cust).filter(function (k) { return !plan[k]; }),
    planOnly: Object.keys(plan).filter(function (k) { return !cust[k]; }),
    duplicates: dup
  };
}

// =====================================================================
// 1-나 (2026-11-17 재홍님 승인): 조회 화면용 순수 함수. 계산은 여기서, 화면은 그리기만(성과평가 buildView와 같은 원칙).
// =====================================================================
const STAGE_DONE = ['입력 완료', '팀 확정']; // 실적-진행 '단계' 값 중 "그 팀 끝남"으로 보는 것(2단계에서 씀)

// '설정' 탭에서 실적관리파일_{연도}가 있는 해(maxYear 이하, 큰 해부터) — 화면 연도 칸
function yearsFromSettings(settingRows, maxYear) {
  const out = [];
  (settingRows || []).forEach(function (r) {
    const k = cell(r && r[0]), v = cell(r && r[1]);
    if (k.indexOf(FILE_KEY_PREFIX) !== 0 || !v) return;
    const y = Number(k.slice(FILE_KEY_PREFIX.length));
    if (Number.isInteger(y) && y <= maxYear && out.indexOf(y) < 0) out.push(y);
  });
  return out.sort(function (a, b) { return b - a; });
}

// 칸 값 → 숫자(빈칸·글자는 null). 시트 서식 없는 값(숫자) 또는 "1,234" 글자 모두 처리
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = cell(v).replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function weekKey(v) { const s = cell(v); return s === GAMAGAM ? GAMAGAM : (/^\d+$/.test(s) ? String(Number(s)) : s); }
function ratio(a, b) { return (a === null || b === null || !(b > 0)) ? null : a / b; }

// 고른 달의 주차 막대: 오늘 이전·오늘 입력일은 고를 수 있음(open), 뒤는 예정(future). now = 오늘 기준 '지금 보고'
function steps(plan, today, nowEntry) {
  return plan.map(function (w) {
    return { label: w.label, week: w.week, gamagam: w.gamagam, inputDate: w.inputDate, openDate: w.openDate, from: w.from, to: w.to,
      open: w.openDate <= today, now: !!(nowEntry && nowEntry.inputDate === w.inputDate && nowEntry.label === w.label) };
  });
}

// 조회 응답 본문. p = { year, month, entry, plan, today, nowEntry, settings, customers(실적-고객사 A2:K), planRows(실적-연간계획 A2:AO),
//   weeklyRows(실적-주간 A2:L), progressRows(실적-진행 A2:I), names({이메일(소문자): 이름}), adminEmail, adminTeam }
// 관리자가 자기 팀이 아닌 팀을 완료 처리했으면 proxy = true (화면 '관리자 대리', 2026-11-17 확인 4 확정)
function buildReportView(p) {
  const year = p.year, month = p.month, wk = p.entry.gamagam ? GAMAGAM : String(p.entry.week);
  // 1) 고객사(사용 중만, 순서 칸 → 시트 줄 순서). 팀 순서 = 시트에 처음 나온 순서
  const cust = [], known = {};
  (p.customers || []).forEach(function (r) { const name = cell(r && r[2]); if (name) known[normTeam(r[0]) + '/' + name] = true; }); // 사용 끔·다른 달 줄도 '계획에만 있는 줄'로 세지 않음
  customersAt(p.customers, month).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name) return;
    if (cell(r[6]).toUpperCase() === 'FALSE') return;
    const ord = num(r[7]);
    cust.push({ team: normTeam(r[0]), series: cell(r[1]), name: name, orderType: cell(r[3]), office: cell(r[4]), custNote: cell(r[8]), ord: ord === null ? 1e9 : ord, i: i });
  });
  cust.sort(function (a, b) { return a.ord - b.ord || a.i - b.i; });
  const teams = [];
  cust.forEach(function (c) { if (teams.indexOf(c.team) < 0) teams.push(c.team); });
  // 2) 그 달 계획 (연도 일치 줄만, 키 = 팀/구매사명)
  const plan = {};
  (p.planRows || []).forEach(function (r) {
    if (num(r && r[0]) !== year) return;
    const k = normTeam(r[1]) + '/' + cell(r[2]);
    plan[k] = { sales: num(r[3 + (month - 1) * 3]), profit: num(r[4 + (month - 1) * 3]) };
  });
  // 3) 그 주차 실적 (같은 고객사가 여러 줄이면 아래 줄 = 나중 저장이 이김)
  const wkly = {}, teamTouched = {};
  (p.weeklyRows || []).forEach(function (r) {
    if (num(r && r[0]) !== year || num(r[1]) !== month || weekKey(r[2]) !== wk) return;
    const team = normTeam(r[3]), k = team + '/' + cell(r[4]);
    wkly[k] = { sales: num(r[5]), profit: num(r[6]), note: cell(r[7]) };
    teamTouched[team] = true;
  });
  // 4) 팀 진행 상태 (실적-진행: 같은 연·월·주차·팀의 마지막 '입력 완료'/'팀 확정' 줄)
  // 2단계: '완료 취소' 줄이 뒤에 있으면 그 팀은 다시 미완료(아래 teamDoneMap — 줄 순서 = 시간 순서)
  const done = teamDoneMap(p.progressRows, year, month, wk);
  const names = p.names || {}, admin = cell(p.adminEmail).toLowerCase();
  const teamStatus = teams.map(function (t) {
    const d = done[t];
    if (d) return { team: t, status: 'done', at: d.at, byName: names[d.by] || d.by, proxy: !!admin && d.by === admin && cell(p.adminTeam) !== t };
    return { team: t, status: teamTouched[t] ? 'ing' : 'none' };
  });
  // 5) 줄 + 팀 소계 + 전사 합계
  function blank() { return { planSales: null, planProfit: null, sales: 0, profit: 0 }; }
  function addTo(s, r) {
    if (r.planSales !== null) s.planSales = (s.planSales || 0) + r.planSales;
    if (r.planProfit !== null) s.planProfit = (s.planProfit || 0) + r.planProfit;
    s.sales += r.sales || 0; s.profit += r.profit || 0;
  }
  function rates(o) {
    o.salesRate = ratio(o.sales, o.planSales); o.profitRate = ratio(o.profit, o.planProfit);
    o.marginPlan = ratio(o.planProfit, o.planSales); o.marginActual = ratio(o.profit, o.sales);
    o.marginDiff = (o.marginPlan === null || o.marginActual === null) ? null : o.marginActual - o.marginPlan;
    return o;
  }
  const sub = {}, total = blank(); let noPlan = 0;
  teams.forEach(function (t) { sub[t] = blank(); });
  const rows = cust.map(function (c) {
    const k = c.team + '/' + c.name, pl = plan[k], w = wkly[k];
    if (!pl) noPlan++;
    const r = { team: c.team, series: c.series, name: c.name, orderType: c.orderType, office: c.office,
      note: (w && w.note) || c.custNote, hasPlan: !!pl,
      planSales: pl ? pl.sales : null, planProfit: pl ? pl.profit : null,
      entered: !!w, sales: w ? w.sales : null, profit: w ? w.profit : null };
    addTo(sub[c.team], r); addTo(total, r);
    return rates(r);
  });
  const subtotals = teams.map(function (t) { return rates(Object.assign({ team: t, entered: !!teamTouched[t] || !!done[t] }, sub[t])); });
  const planOnly = Object.keys(plan).filter(function (k) { return !known[k]; });
  return {
    year: year, month: month, label: p.entry.label, gamagam: p.entry.gamagam,
    inputDate: p.entry.inputDate, openDate: p.entry.openDate, from: p.entry.from, to: p.entry.to,
    deadline: { date: p.entry.inputDate, hour: p.settings.팀장마감시각 },
    steps: steps(p.plan, p.today, p.nowEntry),
    teams: teamStatus, doneCount: teamStatus.filter(function (t) { return t.status === 'done'; }).length,
    rows: rows, subtotals: subtotals, total: rates(Object.assign({ team: '전사' }, total)),
    warnings: { noPlan: noPlan, planOnly: planOnly }
  };
}

// =====================================================================
// 2단계 (2026-11-17 재홍님 승인): 입력·입력 완료·완료 취소·고객사 추가·16시 알림·결과 메일. 순수 함수만(시트·메일 접근 없음).
// 확정: ① 결과 메일 = 다음 정시 2분(issueMailBatchTest) ② 입력은 '지금 보고' 주차만(지난 주차는 관리자만, 예정 주차는 잠김)
//       ③ 4팀 완료 전 = 팀장 [완료 취소] 가능, 4팀 완료 후 = 관리자만(결과 메일 다시 안 보냄) ④ NEW = 그 주차를 한 번 열면 해제(기기별)
//       ⑤ 16시 알림 = 그 팀 활성 팀장, 팀장 계정이 없는 팀은 관리자에게(대리 입력 필요)
// =====================================================================
const STAGE_REOPEN = '완료 취소';
const STAGE_MAIL_REMIND = '16시 알림';
const STAGE_MAIL_RESULT = '결과 메일';
const WEEKLY_WRITE_COLS = 10;  // 실적-주간 A~J (K·L 담당원래값은 3단계용 — 2단계 저장은 건드리지 않음)
const PROGRESS_COLS = 9;       // 실적-진행 A~I
const CUSTOMER_COLS = 12;      // 실적-고객사 A~L (L = 적용월)
const NOTE_MAX = 200, NAME_MAX = 60, FIELD_MAX = 40;
const INPUT_MAX = 1e12;        // 천원 단위 숫자 상한(오타 방지, 성과평가와 같음)
const MAIL_DOMAIN = '@nkmro.com'; // lib/mailer.js와 같은 제한(회사 메일 서버)

function pad2s(n) { return (n < 10 ? '0' : '') + n; }
function seoulStamp(nowMs) { const d = new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000); return d.getUTCFullYear() + '-' + pad2s(d.getUTCMonth() + 1) + '-' + pad2s(d.getUTCDate()) + ' ' + pad2s(d.getUTCHours()) + ':' + pad2s(d.getUTCMinutes()); }
function seoulHour(nowMs) { return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).getUTCHours(); }
function weekCellOf(entry) { return entry.gamagam ? GAMAGAM : entry.week; }          // 시트에 적는 주차 값
function weekKeyOf(entry) { return entry.gamagam ? GAMAGAM : String(entry.week); }   // 비교용
function reportKey(year, month, entry) { return year + '-' + month + '-' + weekKeyOf(entry); } // NEW·결과 메일 문서 키
function indexRows(values) { return (values || []).map(function (r, i) { return { row: i + 2, v: r || [] }; }); }
// 다음 새 줄 = 값이 있는 마지막 줄 + 1 (lib/performance.js nextFreeRow와 같은 규칙 — 중간 빈 줄은 다시 쓰지 않음)
function nextFreeRow(indexed) { let last = 1; indexed.forEach(function (x) { if (x.v.some(function (c) { return cell(c) !== ''; })) last = x.row; }); return last + 1; }
function lcs(v) { return cell(v).toLowerCase(); }

// 그 연·월·주차의 팀별 완료 상태. 실적-진행 줄 순서대로 '입력 완료'/'팀 확정'이면 완료, '완료 취소'면 지움
function teamDoneMap(progressRows, year, month, wk) {
  const done = {};
  (progressRows || []).forEach(function (r) {
    if (num(r && r[0]) !== year || num(r[1]) !== month || weekKey(r[2]) !== wk) return;
    if (cell(r[5])) return; // 3단계: 담당 칸이 있는 줄 = 담당 한 사람의 완료·취소(팀 완료와 따로 — managerDoneMap)
    const st = cell(r[4]), t = normTeam(r[3]);
    if (STAGE_DONE.indexOf(st) >= 0) done[t] = { by: cell(r[6]).toLowerCase(), at: cell(r[7]) };
    else if (st === STAGE_REOPEN) delete done[t];
  });
  return done;
}
// 사용 중인 고객사가 있는 팀(시트 줄 순서) — "4팀" 기준(확정 ④: 사용자 계정이 아니라 실적-고객사)
function teamsOf(customers) {
  const out = [];
  (customers || []).forEach(function (r) { const n = cell(r && r[2]); if (!n || cell(r[6]).toUpperCase() === 'FALSE') return; const t = normTeam(r[0]); if (out.indexOf(t) < 0) out.push(t); });
  return out;
}
function allDoneOf(customers, progressRows, year, month, entry) {
  const teams = teamsOf(customersAt(customers, month)), done = teamDoneMap(progressRows, year, month, weekKeyOf(entry));
  return { teams: teams, done: done, all: teams.length > 0 && teams.every(function (t) { return !!done[t]; }) };
}

// 칸 값 → 정수(천원). 빈칸 = null. 쉼표 허용, 음수 허용(반품), 소수·글자 = NaN
function checkNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '') return null;
  if (!/^-?\d+$/.test(s)) return NaN;
  const n = Number(s);
  return Math.abs(n) < INPUT_MAX ? n : NaN;
}

// 입력 탭 응답. p = { year, month, entry, plan, team, customers, weeklyRows, progressRows, names, adminEmail, adminTeam, isAdmin, isCurrent,
//   mode('2단계'|'3단계' — 그 주차에 적용되는 방식, modeAt), nextMode(시트 값이 다르면 = 다음 보고부터), managerUsers(managerUsersOf), meManager(담당이 볼 때 자기 이름) }
function inputView(p) {
  const wk = weekKeyOf(p.entry), team = normTeam(p.team), three = p.mode === '3단계';
  const idx = p.plan.findIndex(function (w) { return w.inputDate === p.entry.inputDate && w.label === p.entry.label; });
  const prevEntry = idx > 0 ? p.plan[idx - 1] : null, pk = prevEntry ? weekKeyOf(prevEntry) : null;
  const cur = {}, prev = {};
  (p.weeklyRows || []).forEach(function (r) {
    if (num(r && r[0]) !== p.year || num(r[1]) !== p.month || normTeam(r[3]) !== team) return;
    const k = cell(r[4]), w = weekKey(r[2]);
    if (w === wk) cur[k] = { sales: num(r[5]), profit: num(r[6]), note: cell(r[7]), by: lcs(r[8]), at: cell(r[9]),
      orig: (cell(r[10]) !== '' || cell(r[11]) !== '') ? { sales: num(r[10]), profit: num(r[11]) } : null };
    else if (pk !== null && w === pk) prev[k] = { sales: num(r[5]), profit: num(r[6]) };
  });
  const mgrNames = (p.managerUsers || []).map(function (u) { return u.name; });
  const all = [];
  customersAt(p.customers, p.month).map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
    return cell(x.r && x.r[2]) && normTeam(x.r[0]) === team && cell(x.r[6]).toUpperCase() !== 'FALSE';
  }).sort(function (a, b) { const oa = num(a.r[7]), ob = num(b.r[7]); return (oa === null ? 1e9 : oa) - (ob === null ? 1e9 : ob) || a.i - b.i; }).forEach(function (x) {
    const name = cell(x.r[2]), c = cur[name], pv = prev[name], f = cell(x.r[5]);
    const row = { name: name, office: cell(x.r[4]), series: cell(x.r[1]), orderType: cell(x.r[3]),
      prevSales: pv ? pv.sales : null, prevProfit: pv ? pv.profit : null,
      sales: c ? c.sales : null, profit: c ? c.profit : null, note: c ? c.note : '', saved: !!c };
    if (three) {
      row.manager = mgrNames.indexOf(f) >= 0 ? f : ''; // 활성 '담당'이 아니면(빈칸·퇴사 등) 팀장 입력 줄
      row.managerRaw = f;
      row.orig = c && c.orig && (c.orig.sales !== c.sales || c.orig.profit !== c.profit) ? c.orig : null; // 팀장이 고친 줄: 담당이 넣은 원래 값
    }
    all.push({ row: row, at: c ? c.at : '', by: c ? c.by : '' });
  });
  const st = allDoneOf(p.customers, p.progressRows, p.year, p.month, p.entry);
  const d = st.done[team] || null, admin = lcs(p.adminEmail), names = p.names || {};
  const proxyOf = function (by) { return !!admin && by === admin && cell(p.adminTeam) !== team; };
  const asManager = three && !!p.meManager;
  const vis = asManager ? all.filter(function (x) { return x.row.manager === p.meManager; }) : all;
  let lastAt = '', lastBy = '';
  (asManager ? vis : Object.keys(cur).map(function (k) { return cur[k]; })).forEach(function (x) { if (x.at > lastAt) { lastAt = x.at; lastBy = x.by; } }); // 팀장 = 그 팀 전체(예전과 같음), 담당 = 자기 줄만
  const rows = vis.map(function (x) { return x.row; });
  const out = {
    team: team, teams: st.teams, isAdmin: !!p.isAdmin, gamagam: p.entry.gamagam, label: p.entry.label,
    from: p.entry.from, to: p.entry.to, inputDate: p.entry.inputDate, openDate: p.entry.openDate, prevLabel: prevEntry ? prevEntry.label : null,
    rows: rows, savedCount: rows.filter(function (r) { return r.saved; }).length,
    lastSavedAt: lastAt, lastSavedBy: lastBy ? (names[lastBy] || lastBy) : '', lastSavedProxy: proxyOf(lastBy),
    done: d ? { at: d.at, byName: names[d.by] || d.by, proxy: proxyOf(d.by) } : null, allDone: st.all,
    canEdit: !d && (p.isAdmin || p.isCurrent), canComplete: !d && (p.isAdmin || p.isCurrent),
    canReopen: !!d && (p.isAdmin || (p.isCurrent && !st.all)),
    lockedReason: d ? 'DONE' : ((p.isAdmin || p.isCurrent) ? '' : 'PAST_WEEK'),
    mode: three ? '3단계' : '2단계', nextMode: p.nextMode && p.nextMode !== p.mode ? p.nextMode : null
  };
  if (!three) return out;
  // ---- 3단계: 담당별 현황(시안 B) · 담당은 자기 줄만(시안 A) ----
  const mdone = managerDoneMap(p.progressRows, p.year, p.month, wk, team);
  const byEmail = {}; (p.managerUsers || []).forEach(function (u) { byEmail[u.name] = u.email; });
  const mgr = [];
  all.forEach(function (x) {
    const m = x.row.manager; if (!m) return;
    let g = mgr.find(function (z) { return z.name === m; });
    if (!g) { const md = mdone[m]; g = { name: m, total: 0, saved: 0, done: md ? { at: md.at, byName: names[md.by] || md.by, proxy: md.by !== lcs(byEmail[m]) } : null }; mgr.push(g); }
    g.total++; if (x.row.saved) g.saved++;
  });
  out.managers = mgr;
  out.managersAllDone = mgr.every(function (g) { return !!g.done; });
  out.leadRows = all.filter(function (x) { return !x.row.manager; }).length; // 담당 없는 줄(팀장 입력)
  if (asManager) {
    const mine = mgr.find(function (g) { return g.name === p.meManager; }) || null;
    out.role = 'manager'; out.me = p.meManager; out.myDone = mine ? mine.done : null;
    out.canEdit = !d && !!p.isCurrent && !out.myDone && rows.length > 0;
    out.canComplete = out.canEdit;
    out.canReopen = !d && !!p.isCurrent && !!out.myDone; // 팀 확정 전까지만
    out.lockedReason = d ? 'DONE' : (!p.isCurrent ? 'PAST_WEEK' : (out.myDone ? 'MY_DONE' : (rows.length ? '' : 'NO_ROWS')));
  } else {
    out.role = 'lead';
    out.canComplete = out.canEdit && out.managersAllDone; // [팀 확정]: 담당이 모두 [입력 완료](대신 완료 포함)해야
    out.canProxy = out.canEdit; // [대신 입력 완료]: 2026-11-17 재홍님 확정 ⑧
  }
  return out;
}

// [저장] 쓰기 계획. 같은 키(연도·월·주차·팀·구매사명) 줄이 있으면 그 줄 A~J 덮어쓰기, 없으면 다음 빈 줄(planMonthWrite 관례)
// p = { weeklyRows, customers, year, month, entry, team, entries:[{name, sales, profit, note}], who, nowMs,
//       mode, onlyManager(3단계 담당이 저장할 때 자기 이름), managerEmails({담당 이메일: true}) }
// 3단계: A~L(12칸)을 쓰고, 값이 그대로인 줄은 쓰지 않는다(입력자가 바뀌지 않게).
//   담당 저장 → K·L 비움. 팀장 저장 → 담당이 넣은 줄(입력자 = 담당)을 처음 고칠 때 그 값을 K·L(담당원래매출·이익)에 남기고, 이미 있으면 그대로.
function planWeekWrite(p) {
  const team = normTeam(p.team), wk = weekKeyOf(p.entry), three = p.mode === '3단계';
  const active = {};
  customersAt(p.customers, p.month).forEach(function (r) {
    if (!cell(r && r[2]) || normTeam(r[0]) !== team || cell(r[6]).toUpperCase() === 'FALSE') return;
    active[cell(r[2])] = cell(r[5]);
  });
  const seen = {}, clean = [];
  for (let i = 0; i < (p.entries || []).length; i++) {
    const e = p.entries[i] || {}, name = cell(e.name);
    if (!(name in active)) return { ok: false, error: 'UNKNOWN_CUSTOMER', field: name };
    if (three && p.onlyManager && active[name] !== p.onlyManager) return { ok: false, error: 'NOT_MY_CUSTOMER', field: name };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    const sales = checkNum(e.sales), profit = checkNum(e.profit), note = cell(e.note);
    if (Number.isNaN(sales) || Number.isNaN(profit)) return { ok: false, error: 'BAD_NUMBER', field: name };
    if (note.length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG', field: name };
    clean.push({ name: name, sales: sales, profit: profit, note: note });
  }
  const indexed = indexRows(p.weeklyRows), found = {};
  indexed.forEach(function (x) {
    if (num(x.v[0]) === p.year && num(x.v[1]) === p.month && weekKey(x.v[2]) === wk && normTeam(x.v[3]) === team) found[cell(x.v[4])] = x;
  });
  let next = nextFreeRow(indexed);
  const stamp = seoulStamp(p.nowMs), who = lcs(p.who), writes = [], memails = p.managerEmails || {};
  clean.forEach(function (e) {
    const x = found[e.name], row = x ? x.row : 0;
    const empty = e.sales === null && e.profit === null && e.note === '';
    if (!row && empty) return; // 처음부터 빈칸이면 줄을 만들지 않음
    const values = [p.year, p.month, weekCellOf(p.entry), team, e.name, e.sales === null ? '' : e.sales, e.profit === null ? '' : e.profit, e.note, who, stamp];
    if (three) {
      if (x && num(x.v[5]) === e.sales && num(x.v[6]) === e.profit && cell(x.v[7]) === e.note) return; // 그대로면 쓰지 않음
      let k = '', l = '';
      if (!p.onlyManager && x) {
        if (cell(x.v[10]) !== '' || cell(x.v[11]) !== '') { k = cell(x.v[10]) === '' ? '' : num(x.v[10]); l = cell(x.v[11]) === '' ? '' : num(x.v[11]); }
        else if (memails[lcs(x.v[8])] && (num(x.v[5]) !== e.sales || num(x.v[6]) !== e.profit)) { k = cell(x.v[5]) === '' ? '' : num(x.v[5]); l = cell(x.v[6]) === '' ? '' : num(x.v[6]); }
      }
      values.push(k, l);
    }
    writes.push({ row: row || next++, values: values, isNew: !row });
  });
  return { ok: true, writes: writes };
}

// 실적-진행에 이력 한 줄 덧붙이기 (입력 완료 / 완료 취소 / 16시 알림 / 결과 메일)
function planProgress(p) {
  const row = nextFreeRow(indexRows(p.progressRows));
  return { row: row, values: [p.year, p.month, weekCellOf(p.entry), cell(p.team), p.stage, cell(p.manager), lcs(p.who), seoulStamp(p.nowMs), cell(p.mail)] }; // 담당 = 3단계 담당 한 사람 기록일 때만
}

// [+ 고객사 추가] 쓰기 계획. 같은 팀에 같은 이름(사용 끔 포함)이 있으면 거절. 순서 = 지금 가장 큰 순서 + 1
function planAddCustomer(p) {
  const team = normTeam(p.team), name = cell(p.name);
  if (!team) return { ok: false, error: 'BAD_TEAM' };
  if (!name || name.length > NAME_MAX) return { ok: false, error: 'BAD_NAME' };
  const fields = [cell(p.series), cell(p.orderType), cell(p.office)];
  if (fields.some(function (f) { return f.length > FIELD_MAX; })) return { ok: false, error: 'FIELD_TOO_LONG' };
  if (cell(p.note).length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG' };
  let maxOrd = 0, dup = false;
  (p.customers || []).forEach(function (r) {
    if (!cell(r && r[2])) return;
    if (normTeam(r[0]) === team && cell(r[2]) === name) dup = true;
    const o = num(r[7]); if (o !== null && o > maxOrd) maxOrd = o;
  });
  if (dup) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
  const row = nextFreeRow(indexRows(p.customers));
  return { ok: true, row: row, values: [team, fields[0], name, fields[1], fields[2], '', true, maxOrd + 1, cell(p.note), lcs(p.who), seoulStamp(p.nowMs), Number(p.month) || ''] }; // 적용월 = 이번 보고 달(지난달 표에는 안 나옴)
}

// 사용자팀마스터 A2:J 줄 → [{email, name, role, team, active}]
function usersOf(userRows) {
  return (userRows || []).filter(function (r) { return r && cell(r[0]); }).map(function (r) {
    return { email: lcs(r[0]), name: cell(r[1]), role: cell(r[2]), team: cell(r[3]), active: cell(r[4]) === '활성' };
  });
}
function mailable(u) { return u && u.active && u.email.slice(-MAIL_DOMAIN.length) === MAIL_DOMAIN; }

// 16시 알림 대상. p = { nowMs, settings, customers, progressRows, weeklyRows, users, adminEmail }
// 오늘이 '지금 보고' 입력일이고 서울 시각 ≥ 팀장마감시각일 때, 미완료 팀마다 1건. 팀장이 없으면 관리자(proxy)
function reminderJobs(p) {
  const s = p.settings || DEFAULTS;
  if (s.메일사용 === false) return [];
  const rep = currentReport(p.nowMs, s), cur = rep.current;
  if (!cur || cur.inputDate !== rep.today || seoulHour(p.nowMs) < s.팀장마감시각) return [];
  const st = allDoneOf(p.customers, p.progressRows, cur.year, cur.month, cur);
  const users = usersOf(p.users), admin = users.find(function (u) { return u.email === lcs(p.adminEmail); });
  const jobs = [];
  st.teams.forEach(function (t) {
    if (st.done[t]) return;
    const leaders = users.filter(function (u) { return u.role === '팀장' && normTeam(u.team) === t && mailable(u); });
    const to = leaders.length ? leaders : (mailable(admin) ? [admin] : []);
    const total = customersAt(p.customers, cur.month).filter(function (r) { return cell(r && r[2]) && normTeam(r[0]) === t && cell(r[6]).toUpperCase() !== 'FALSE'; }).length; // 확인 1: 이력 줄은 한 곳으로(그 달 기준)
    const saved = {};
    (p.weeklyRows || []).forEach(function (r) { if (num(r && r[0]) === cur.year && num(r[1]) === cur.month && weekKey(r[2]) === weekKeyOf(cur) && normTeam(r[3]) === t) saved[cell(r[4])] = true; });
    jobs.push({ key: 'remind_' + cur.year + '_' + cur.month + '_' + weekKeyOf(cur) + '_' + t, kind: 'remind', team: t, year: cur.year, month: cur.month, entry: cur,
      hour: s.팀장마감시각, total: total, savedCount: Object.keys(saved).length, proxy: !leaders.length, recipients: to, mode: modeAt(s, p.progressRows, t, cur) });
  });
  return jobs;
}
// 결과 메일 받는 사람: 활성 임원 + 활성 팀장(@nkmro.com, 이메일 중복 없이)
function resultRecipients(userRows) {
  const seen = {};
  return usersOf(userRows).filter(function (u) { if (!mailable(u) || (u.role !== '임원' && u.role !== '팀장') || seen[u.email]) return false; seen[u.email] = true; return true; });
}

function fmtNum(n) { if (n === null || n === undefined || !isFinite(n)) return '—'; const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (n < 0 ? '-' : '') + s; }
function fmtPct(r) { return (r === null || r === undefined || !isFinite(r)) ? '—' : (Math.floor(Math.round(r * 1e10) / 1e10 * 1000) / 10).toFixed(1) + '%'; }
function fmtMd(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); if (!m) return ''; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return Number(m[2]) + '/' + Number(m[3]) + '(' + '일월화수목금토'[d.getUTCDay()] + ')'; }
function fmtMd2(iso) { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
function rangeText(year, month, entry) { return entry.gamagam ? month + '월 예상 마감' : fmtMd2(entry.from) + '~' + fmtMd2(entry.to) + ' 누적'; }
const FOOTER = '이 메일은 MRO 워크허브에서 자동으로 보냈어요.';

// 16시 알림 본문 parts (lib/perfCloseMail.js buildText·buildHtml 틀 그대로)
function reminderParts(job, r, appUrl) {
  const label = job.team + '팀', title = job.month + '월 ' + job.entry.label;
  return {
    to: r.email,
    subject: '[MRO 워크허브] ' + title + ' 주간 실적 입력 마감 알림 (' + label + ')',
    hello: job.proxy ? (r.name ? r.name + '님,' : '') : (r.name ? r.name + ' 팀장님,' : '팀장님,'),
    lines: [title + ' 주간 실적(' + rangeText(job.year, job.month, job.entry) + ')이 아직 ' + (job.mode === '3단계' ? '[팀 확정]' : '[입력 완료]') + '되지 않았어요.'].concat(job.proxy ? ['(' + label + '은 팀장 계정이 아직 없어 관리자에게 보냈어요 — 대리 입력이 필요해요.)'] : []),
    period: { title: null, lines: ['· 마감: ' + fmtMd(job.entry.inputDate) + ' ' + pad2s(job.hour) + ':00', '· 지금 상태: 고객사 ' + job.total + '곳 중 ' + job.savedCount + '곳 저장됨, ' + (job.mode === '3단계' ? '팀 확정 전' : '입력 완료 전'), '', '아래 버튼을 눌러 숫자를 확인하고 ' + (job.mode === '3단계' ? '[팀 확정]' : '[입력 완료]') + '을 눌러 주세요.'] },
    button: '주간 실적 열기', link: appUrl + '?view=weekly', footer: FOOTER
  };
}
// 결과 메일을 지금 보내도 되나: 4팀 완료 시각(atMs)부터 결과메일대기분(기본 60분)이 지났는지. 시각이 없으면(예전 문서) 바로 보냄.
// 확인은 issueMailBatchTest(매시 2분)에서만 하므로 실제 발송 = 완료 + 대기분이 지난 뒤 첫 정시 2분(1시간이면 1~2시간 사이)
function resultDue(atMs, nowMs, s) {
  const wait = (s && s.결과메일대기분 !== undefined ? s.결과메일대기분 : DEFAULTS.결과메일대기분) * 60000;
  return !(typeof atMs === 'number' && isFinite(atMs)) || nowMs - atMs >= wait;
}
// 결과 메일 본문 parts. view = buildReportView 결과(4팀 완료 상태)
// 2026-11-17 재홍님 확정(시안 C-1): 실적 숫자(금액·달성률)는 메일에 넣지 않음 → 주차 진행 막대 + 팀 입력 현황만, 상세는 앱에서
function escH(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function resultSteps(view, entry) {
  return (view.steps || []).map(function (s) {
    const st = s.inputDate < entry.inputDate ? 'done' : (s.inputDate === entry.inputDate && s.label === entry.label ? 'cur' : 'fut');
    return { label: s.label, state: st, sub: st === 'fut' ? fmtMd2(s.openDate) + '~' + fmtMd2(s.inputDate) + ' 입력' : (s.gamagam ? '예상 마감' : '~' + fmtMd2(s.to)) };
  });
}
function resultCardHtml(job, view) {
  const MC = { accent: '#3a2f6e', past: '#7a6bb0', fut: '#d9d5e6', muted: '#6b6f6a', light: '#a9a6a0', green: '#1d6b43', greenSoft: '#e3f3ea', line: '#eeece6', border: '#e2e0da' };
  const F = "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;";
  const steps = resultSteps(view, job.entry).map(function (s) {
    const cur = s.state === 'cur', size = cur ? 22 : 16, dot = cur ? MC.accent : (s.state === 'done' ? MC.past : MC.fut);
    const col = cur ? MC.accent : (s.state === 'done' ? '#444' : MC.light);
    return '<td width="25%" align="center" valign="top" style="padding:0 2px;' + F + '">' +
      '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + dot + ';margin:0 auto 6px;' + (cur ? 'box-shadow:0 0 0 4px #e6e1f2;' : '') + '"></div>' +
      '<div style="font-size:14px;font-weight:700;color:' + col + ';">' + escH(s.label) + (s.state === 'fut' ? '' : ' ✓') + '</div>' +
      '<div style="font-size:11.5px;color:' + MC.muted + ';">' + escH(s.sub) + '</div>' +
      (cur ? '<div style="display:inline-block;margin-top:3px;background:' + MC.accent + ';color:#ffffff;font-size:11px;padding:1px 8px;">이번 보고</div>' : '') + '</td>';
  }).join('');
  const chips = view.teams.map(function (x) {
    return '<td align="center" bgcolor="' + MC.greenSoft + '" style="background:' + MC.greenSoft + ';padding:10px 4px;' + F + '">' +
      '<div style="font-size:16px;font-weight:800;color:#2e8b57;">✓</div><div style="font-size:14px;font-weight:700;color:' + MC.green + ';">' + escH(x.team) + '</div>' +
      '<div style="font-size:11px;color:#5b8a6e;">' + escH(String(x.at || '').slice(5).replace('-', '/')) + ' 완료</div></td>';
  }).join('');
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ' + MC.border + ';margin:0 0 16px;"><tr><td style="padding:18px 14px 14px;' + F + '">' +
    '<div style="text-align:center;font-size:12px;color:#888;letter-spacing:1px;">' + job.month + '월 주간 실적</div>' +
    '<div style="text-align:center;font-size:22px;font-weight:800;color:' + MC.accent + ';margin:2px 0 16px;">' + escH(job.entry.label) + ' 보고 완료</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + steps + '</tr></table>' +
    '<div style="border-top:1px solid ' + MC.line + ';margin:16px 0 8px;"></div>' +
    '<div style="font-size:12.5px;color:' + MC.muted + ';margin:0 6px;">팀 입력 현황</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="table-layout:fixed;"><tr>' + chips + '</tr></table>' +
    '<div style="text-align:center;font-size:12.5px;color:' + MC.muted + ';margin-top:8px;">고객사별 숫자·팀별 상세는 앱에서만 볼 수 있어요.</div>' +
    '</td></tr></table>';
}
function resultParts(job, view, r, appUrl) {
  const title = job.month + '월 ' + job.entry.label;
  const stepLines = resultSteps(view, job.entry).map(function (s) { return '· ' + s.label + (s.state === 'fut' ? ' ' : ' ✓ ') + s.sub + (s.state === 'cur' ? ' (이번 보고)' : ''); });
  const doneLines = view.teams.map(function (x) { return '· ' + x.team + ' ✓ ' + String(x.at || '').slice(5).replace('-', '/') + ' 완료'; });
  return {
    to: r.email,
    subject: '[MRO 워크허브] ' + title + ' 주간 실적이 도착했어요 (' + view.teams.length + '팀 완료)',
    hello: r.name ? r.name + '님,' : '',
    lines: [title + ' 주간 실적 보고가 ' + view.teams.length + '팀 모두 입력 완료됐어요.'],
    bodyHtml: resultCardHtml(job, view), // perfCloseMail.buildHtml: lines 아래에 그대로 넣음(숫자 없음)
    textBlock: ['■ ' + job.month + '월 주간 실적 · ' + job.entry.label + ' 보고 완료'].concat(stepLines, ['', '■ 팀 입력 현황'], doneLines, ['', '고객사별 숫자·팀별 상세는 앱에서만 볼 수 있어요.']),
    button: '주간 실적 열기', link: appUrl + '?view=weekly', footer: FOOTER
  };
}

// 누가 어느 팀을 입력하나. 관리자 = 고른 팀(안 고르면 자기 팀 → 첫 팀, 없는 팀을 고르면 BAD_TEAM), 활성 팀장 = 자기 팀만(다른 팀은 FORBIDDEN_TEAM)
// me = usersOf() 한 줄 또는 null, teams = teamsOf(실적-고객사)
function leadTeam(me, isAdmin, reqTeam, teams) {
  const want = reqTeam ? normTeam(reqTeam) : '';
  if (isAdmin) {
    if (want) return teams.indexOf(want) >= 0 ? { ok: true, team: want } : { ok: false, error: 'BAD_TEAM', field: want };
    const own = me ? normTeam(me.team) : '';
    const team = teams.indexOf(own) >= 0 ? own : teams[0];
    return team ? { ok: true, team: team } : { ok: false, error: 'NO_TEAM' };
  }
  if (!me || !me.active || me.role !== '팀장') return { ok: false, error: 'FORBIDDEN' };
  const own = normTeam(me.team);
  if (want && want !== own) return { ok: false, error: 'FORBIDDEN_TEAM' };
  if (teams.indexOf(own) < 0) return { ok: false, error: 'NO_TEAM' };
  return { ok: true, team: own };
}

// ---- 고객사 정보 고치기 (2026-11-17 재홍님 확정: 담당 = 활성 '담당' 이름, 사용 끄기 = 경고만, 구매사명·팀·순서 잠금,
//      이력 = 실적-고객사 L열 '적용월'(탭 추가 없음), 적용 = 이번 보고 달부터만) ----
// 고칠 수 있는 칸 → 실적-고객사 열 (A 팀 · B 계열 · C 구매사명 · D 발주형태 · E 사무소 · F 담당 · G 사용 · H 순서 · I 비고 · J 등록자 · K 등록일시 · L 적용월)
const CUSTOMER_EDIT_COLS = { series: 'B', orderType: 'D', office: 'E', manager: 'F', active: 'G', note: 'I' };
const CUSTOMER_LOCKED = ['name', 'team', 'ord']; // 🔒 구매사명·팀 = 주간 실적·연간계획과 이어진 이름, 순서 = 엑셀 보고서 순서(관리자가 시트에서)
function isOff(v) { return cell(v).toUpperCase() === 'FALSE'; }

// 그 팀 활성 '담당' 이름 목록(사용자팀마스터 줄 순서, 같은 이름은 한 번)
function managersOf(userRows, team) {
  const t = normTeam(team), out = [];
  usersOf(userRows).forEach(function (u) { if (u.active && u.role === '담당' && normTeam(u.team) === t && u.name && out.indexOf(u.name) < 0) out.push(u.name); });
  return out;
}

// 고치기 창 목록: 그 달(이번 보고 달) 기준 그 팀 고객사 전체(사용 끔 포함). 사용 중 먼저(순서 → 시트 줄 순서), 사용 끔은 뒤.
// monthHas = 그 연·월에 실적-주간 숫자 줄이 있는지(사용 끌 때 경고용)
function customerEditList(customers, team, weeklyRows, year, month) {
  const t = normTeam(team), has = {};
  (weeklyRows || []).forEach(function (r) { if (num(r && r[0]) === year && num(r[1]) === month && normTeam(r[3]) === t) has[cell(r[4])] = true; });
  const list = [];
  customersAt(customers, month).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name || normTeam(r[0]) !== t) return;
    const o = num(r[7]);
    list.push({ name: name, series: cell(r[1]), orderType: cell(r[3]), office: cell(r[4]), manager: cell(r[5]), active: !isOff(r[6]),
      ord: o === null ? '' : o, note: cell(r[8]), monthHas: !!has[name], i: i });
  });
  list.sort(function (a, b) { return (b.active - a.active) || ((a.ord === '' ? 1e9 : a.ord) - (b.ord === '' ? 1e9 : b.ord)) || a.i - b.i; });
  return list.map(function (x) { delete x.i; return x; });
}

// [변경 저장] 쓰기 계획. p = { customers(A2:L 전체), team, month(= 이번 보고 달 = 적용월), changes:[{ name, fields:{ series, orderType, office, manager, active, note } }],
//   managers, weeklyRows, year, who, nowMs }
// 그 고객사에 이미 '적용월 = 이번 달' 줄이 있으면 그 줄의 바뀐 칸 + 등록자·등록일시만 고친다.
// 없으면 그 달 기준 줄을 복사해 바뀐 값을 넣은 새 줄(적용월 = 이번 달, 등록자·등록일시 = 고친 사람·시각)을 맨 아래에 붙인다 → 지난달 줄은 그대로.
function planUpdateCustomers(p) {
  const team = normTeam(p.team), month = Number(p.month);
  if (!(month >= 1 && month <= 12)) return { ok: false, error: 'NO_REPORT_YET' };
  const changes = p.changes || [];
  if (!changes.length) return { ok: false, error: 'NO_CHANGES' };
  const indexed = indexRows(p.customers), byKey = {};
  indexed.forEach(function (x) {
    const name = cell(x.v[2]); if (!name || normTeam(x.v[0]) !== team) return;
    (byKey[name] || (byKey[name] = [])).push(x);
  });
  const at = {}; customersAt(p.customers, month).forEach(function (r) { if (normTeam(r[0]) === team) at[cell(r[2])] = r; });
  const managers = p.managers || [], monthHas = {};
  customerEditList(p.customers, team, p.weeklyRows, p.year, month).forEach(function (c) { monthHas[c.name] = c.monthHas; });
  let next = nextFreeRow(indexed);
  const stamp = seoulStamp(p.nowMs), who = lcs(p.who), seen = {}, writes = [], warnings = [];
  let rows = 0;
  for (let k = 0; k < changes.length; k++) {
    const ch = changes[k] || {}, name = cell(ch.name), f = ch.fields || {};
    const keys = Object.keys(f);
    for (let j = 0; j < keys.length; j++) {
      if (CUSTOMER_LOCKED.indexOf(keys[j]) >= 0) return { ok: false, error: 'LOCKED_FIELD', field: name + ' ' + keys[j] };
      if (!CUSTOMER_EDIT_COLS[keys[j]]) return { ok: false, error: 'BAD_FIELD', field: keys[j] };
    }
    if (!byKey[name] || !at[name]) return { ok: false, error: 'UNKNOWN_CUSTOMER', field: name };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    const cur = at[name], want = {};
    if ('series' in f) want.series = cell(f.series);
    if ('orderType' in f) want.orderType = cell(f.orderType);
    if ('office' in f) want.office = cell(f.office);
    if (['series', 'orderType', 'office'].some(function (x) { return (want[x] || '').length > FIELD_MAX; })) return { ok: false, error: 'FIELD_TOO_LONG', field: name };
    if ('note' in f) { want.note = cell(f.note); if (want.note.length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG', field: name }; }
    if ('manager' in f) want.manager = cell(f.manager);
    if ('active' in f) { if (typeof f.active !== 'boolean') return { ok: false, error: 'BAD_FIELD', field: name + ' active' }; want.active = f.active; }
    const now = { series: cell(cur[1]), orderType: cell(cur[3]), office: cell(cur[4]), manager: cell(cur[5]), active: !isOff(cur[6]), note: cell(cur[8]) };
    const diff = Object.keys(want).filter(function (x) { return want[x] !== now[x]; }); // 같은 값은 쓰지 않음
    if ('manager' in want && want.manager !== now.manager && want.manager !== '' && managers.indexOf(want.manager) < 0) return { ok: false, error: 'BAD_MANAGER', field: name + ' ' + want.manager };
    if (!diff.length) continue;
    rows++;
    if (want.active === false && now.active && monthHas[name]) warnings.push(name);
    // 이번 달 줄(적용월 = 이번 달, 같은 달 줄이 둘이면 아래쪽 — customersAt과 같은 규칙)
    const mine = byKey[name].filter(function (x) { return applyMonth(x.v) === month; }).pop();
    if (mine) {
      diff.forEach(function (x) { writes.push({ name: name, field: x, range: CUSTOMER_EDIT_COLS[x] + mine.row, values: [want[x]] }); });
      writes.push({ name: name, field: 'by', range: 'J' + mine.row + ':K' + mine.row, values: [who, stamp] });
    } else {
      const v = [cell(cur[0]), now.series, name, now.orderType, now.office, now.manager, now.active, num(cur[7]) === null ? '' : num(cur[7]), now.note, who, stamp, month];
      const pos = { series: 1, orderType: 3, office: 4, manager: 5, active: 6, note: 8 };
      diff.forEach(function (x) { v[pos[x]] = want[x]; });
      writes.push({ name: name, field: 'new', range: 'A' + next + ':L' + next, values: v, isNew: true });
      next++;
    }
  }
  return { ok: true, writes: writes, rows: rows, warnings: warnings, month: month };
}

// =====================================================================
// 3단계 (2026-11-17 재홍님 확정 ①~⑨): 담당 입력 → 팀장 확정 → 임원·팀장 열람
// ① 입력 방식은 팀장이 화면에서 고름 → 실적-설정 '입력방식_{팀}' 값을 바꿈(시트 우선)
// ② 담당 = 실적-고객사 F열(그 달 기준)이 자기 이름인 고객사만 보고 입력, 마감 = 담당마감시각
// ③ 담당 [입력 완료] 뒤에도 팀 확정 전이면 [완료 취소] 가능
// ④ 팀장은 모든 줄을 고칠 수 있고, 담당 값을 고치면 원래 값은 실적-주간 K·L열에 남김(planWeekWrite)
// ⑤ F열이 활성 '담당'이 아닌 줄(빈칸 등)은 팀장이 입력
// ⑥ 담당이 모두 [입력 완료]해야 [팀 확정]   ⑦ 담당 마감 알림 메일 · 팀장 확정 요청 메일
// ⑧ 팀장 [대신 입력 완료]   ⑨ 방식을 바꾸면 다음 보고 주차부터(그 주차 입력일 0시 이후에 바꾼 기록이 있으면 그 주차는 바꾸기 전 방식)
// 실적-진행: 담당 한 사람 기록 = F열(담당)에 이름, 팀 기록 = F열 빈칸. 방식 변경 = 단계 '입력방식 2단계→3단계'
// =====================================================================
const STAGE_CONFIRM = '팀 확정';
const STAGE_MODE = '입력방식 ';
const STAGE_MAIL_MREMIND = '담당 마감 알림', STAGE_MAIL_CONFIRM = '확정 요청 메일';
const MODE_NOTE = '팀 입력 방식(2단계 = 팀장 입력, 3단계 = 담당 입력 → 팀장 확정). 앱에서 바꾸면 다음 보고 주차부터 적용';

// 그 팀 활성 '담당' [{name, email}] (사용자팀마스터 줄 순서, 같은 이름은 처음 한 명)
function managerUsersOf(userRows, team) {
  const t = normTeam(team), out = [];
  usersOf(userRows).forEach(function (u) { if (u.active && u.role === '담당' && normTeam(u.team) === t && u.name && !out.some(function (z) { return z.name === u.name; })) out.push({ name: u.name, email: u.email }); });
  return out;
}
// 그 연·월·주차·팀의 담당별 완료(줄 순서대로 '입력 완료' → 완료, '완료 취소' → 지움). { 이름: { by, at } }
function managerDoneMap(progressRows, year, month, wk, team) {
  const done = {}, t = normTeam(team);
  (progressRows || []).forEach(function (r) {
    if (num(r && r[0]) !== year || num(r[1]) !== month || weekKey(r[2]) !== wk || normTeam(r[3]) !== t) return;
    const m = cell(r[5]); if (!m) return;
    const st = cell(r[4]);
    if (st === '입력 완료') done[m] = { by: lcs(r[6]), at: cell(r[7]) };
    else if (st === STAGE_REOPEN) delete done[m];
  });
  return done;
}
// 그 담당들의 고객사 수(그 달 기준 사용 중 줄의 F열). 고객사가 하나도 없는 담당은 빠짐 → [팀 확정] 조건에도 안 들어감
function managerCounts(customers, team, month, names) {
  const t = normTeam(team), out = {};
  customersAt(customers, month).forEach(function (r) {
    if (!cell(r && r[2]) || normTeam(r[0]) !== t || cell(r[6]).toUpperCase() === 'FALSE') return;
    const f = cell(r[5]); if (names.indexOf(f) >= 0) out[f] = (out[f] || 0) + 1;
  });
  return out;
}
function parseModeStage(st) {
  const m = /^입력방식 (2단계|3단계)→(2단계|3단계)$/.exec(cell(st));
  return m ? { from: m[1], to: m[2] } : null;
}
// ⑨ 그 주차에 적용되는 방식. 시트 값이 기본, 그 주차 입력이 열린 날(openDate, 서울) 0시 이후에 앱에서 바꾼 기록이 있으면 그중 가장 이른 기록의 '바꾸기 전' 값
// (시트에서 직접 바꾸면 기록이 없으므로 바로 적용 — 시트 우선)
function modeAt(settings, progressRows, team, entry) {
  const t = normTeam(team), sheet = (settings && settings.modes && settings.modes[t]) || '2단계';
  if (!entry) return sheet;
  const hit = (progressRows || []).find(function (r) { return r && normTeam(r[3]) === t && parseModeStage(r[4]) && cell(r[7]).slice(0, 10) >= (entry.openDate || entry.inputDate); });
  return hit ? parseModeStage(hit[4]).from : sheet;
}
// ① 방식 바꾸기 쓰기 계획. settingRows = 실적-설정 A2:C 그대로(줄 번호용). 같은 키 줄이 있으면 B칸만, 없으면 새 줄 A~C
function planSetMode(p) {
  const team = normTeam(p.team), mode = cell(p.mode);
  if (MODES.indexOf(mode) < 0) return { ok: false, error: 'BAD_MODE' };
  const key = MODE_KEY_PREFIX + team, indexed = indexRows(p.settingRows);
  const hit = indexed.filter(function (x) { return cell(x.v[0]) === key; }).pop(); // readSettings와 같이 아래 줄이 이김
  const from = (p.settings && p.settings.modes && p.settings.modes[team]) || '2단계';
  if (from === mode) return { ok: false, error: 'NO_CHANGES' };
  const write = hit ? { range: 'B' + hit.row, values: [mode] } : { range: 'A' + nextFreeRow(indexed) + ':C' + nextFreeRow(indexed), values: [key, mode, MODE_NOTE] };
  return { ok: true, from: from, to: mode, write: write, stage: STAGE_MODE + from + '→' + mode };
}

// ⑦ 3단계 메일 일. p = reminderJobs와 같음. 오늘이 '지금 보고' 입력일일 때, 팀 확정 전인 3단계 팀마다:
//   담당이 모두 완료 → 팀장 확정 요청 1건(팀장 없으면 관리자) / 아니면 서울 시각 ≥ 담당마감시각일 때 미완료 담당 본인에게 1건씩
function stage3Jobs(p) {
  const s = p.settings || DEFAULTS;
  if (s.메일사용 === false) return [];
  const rep = currentReport(p.nowMs, s), cur = rep.current;
  if (!cur || cur.inputDate !== rep.today) return [];
  const st = allDoneOf(p.customers, p.progressRows, cur.year, cur.month, cur), wk = weekKeyOf(cur);
  const users = usersOf(p.users), admin = users.find(function (u) { return u.email === lcs(p.adminEmail); });
  const hour = seoulHour(p.nowMs), jobs = [];
  st.teams.forEach(function (t) {
    if (st.done[t] || modeAt(s, p.progressRows, t, cur) !== '3단계') return;
    const mus = managerUsersOf(p.users, t), counts = managerCounts(p.customers, t, cur.month, mus.map(function (u) { return u.name; }));
    const names = mus.map(function (u) { return u.name; }).filter(function (n) { return counts[n]; });
    if (!names.length) return; // 담당 줄이 없으면 2단계와 같음(16시 팀장 알림만)
    const md = managerDoneMap(p.progressRows, cur.year, cur.month, wk, t);
    const base = { team: t, year: cur.year, month: cur.month, entry: cur };
    if (names.every(function (n) { return md[n]; })) {
      const leaders = users.filter(function (u) { return u.role === '팀장' && normTeam(u.team) === t && mailable(u); });
      const to = leaders.length ? leaders : (mailable(admin) ? [admin] : []);
      jobs.push(Object.assign({ key: 'confirm_' + cur.year + '_' + cur.month + '_' + wk + '_' + t, kind: 'confirm', hour: s.팀장마감시각, proxy: !leaders.length, recipients: to,
        done: names.map(function (n) { return { name: n, at: md[n].at }; }) }, base));
      return;
    }
    if (hour < s.담당마감시각) return;
    const saved = {};
    (p.weeklyRows || []).forEach(function (r) { if (num(r && r[0]) === cur.year && num(r[1]) === cur.month && weekKey(r[2]) === wk && normTeam(r[3]) === t) saved[cell(r[4])] = true; });
    names.forEach(function (n) {
      if (md[n]) return;
      const u = users.find(function (x) { return x.email === lcs((mus.find(function (z) { return z.name === n; }) || {}).email); });
      if (!mailable(u)) return;
      let sv = 0;
      customersAt(p.customers, cur.month).forEach(function (r) { if (cell(r && r[2]) && normTeam(r[0]) === t && cell(r[6]).toUpperCase() !== 'FALSE' && cell(r[5]) === n && saved[cell(r[2])]) sv++; });
      jobs.push(Object.assign({ key: 'mremind_' + cur.year + '_' + cur.month + '_' + wk + '_' + t + '_' + n, kind: 'mremind', hour: s.담당마감시각, total: counts[n], savedCount: sv, recipients: [u] }, base));
    });
  });
  return jobs;
}
// 시안 C: 담당 마감 알림
function managerRemindParts(job, r, appUrl) {
  const title = job.month + '월 ' + job.entry.label;
  return {
    to: r.email,
    subject: '[MRO 워크허브] ' + title + ' 주간 실적 입력 마감 알림 (' + (r.name || '') + '님 담당)',
    hello: r.name ? r.name + '님,' : '',
    lines: [title + ' 주간 실적(' + rangeText(job.year, job.month, job.entry) + ')이 아직 [입력 완료]되지 않았어요.'],
    period: { title: null, lines: ['· 마감: ' + fmtMd(job.entry.inputDate) + ' ' + pad2s(job.hour) + ':00 (담당)', '· 지금 상태: 담당 고객사 ' + job.total + '곳 중 ' + job.savedCount + '곳 저장됨, 입력 완료 전'] },
    button: '주간 실적 열기', link: appUrl + '?view=weekly', footer: FOOTER
  };
}
// 시안 D: 팀장 확정 요청 (숫자 없음 — 담당 이름·완료 시각만)
function confirmParts(job, r, appUrl) {
  const title = job.month + '월 ' + job.entry.label, n = job.done.length;
  const at = function (x) { return String(x.at || '').slice(5).replace('-', '/'); };
  const F = "font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;";
  const box = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td bgcolor="#e3f3ea" style="background:#e3f3ea;padding:14px 18px;' + F + 'font-size:14px;color:#1d6b43;line-height:1.8;">' +
    '<b>■ 담당 입력 완료</b><br>' + job.done.map(function (x) { return '· ' + escH(x.name) + ' ' + escH(at(x)); }).join('<br>') + '</td></tr></table>';
  return {
    to: r.email,
    subject: '[MRO 워크허브] ' + title + ' 주간 실적 팀 확정 요청 (' + job.team + '팀 담당 ' + n + '명 완료)',
    hello: job.proxy ? (r.name ? r.name + '님,' : '') : (r.name ? r.name + ' 팀장님,' : '팀장님,'),
    lines: [job.team + '팀 담당 ' + n + '명이 모두 ' + title + ' 주간 실적을 [입력 완료]했어요.', '숫자를 확인하고 [팀 확정]을 눌러 주세요.'].concat(job.proxy ? ['(' + job.team + '팀은 팀장 계정이 아직 없어 관리자에게 보냈어요.)'] : []),
    period: { title: null, lines: ['· 팀장 마감: ' + fmtMd(job.entry.inputDate) + ' ' + pad2s(job.hour) + ':00'] },
    bodyHtml: box,
    textBlock: ['■ 담당 입력 완료'].concat(job.done.map(function (x) { return '· ' + x.name + ' ' + at(x); })),
    button: '팀 확정하러 가기', link: appUrl + '?view=weekly', footer: FOOTER
  };
}

module.exports = {
  FILE_KEY_PREFIX, TAB_CUSTOMERS, TAB_PLAN, TAB_WEEKLY, TAB_PROGRESS, TAB_SETTINGS, TABS, HEADERS, DEFAULTS, GAMAGAM,
  findFileId, checkHeaders, normTeam, readSettings, weekPlan, currentReport, seoulToday, crossCheck,
  STAGE_DONE, yearsFromSettings, num, buildReportView,
  STAGE_REOPEN, STAGE_MAIL_REMIND, STAGE_MAIL_RESULT, WEEKLY_WRITE_COLS, PROGRESS_COLS, CUSTOMER_COLS,
  seoulStamp, seoulHour, weekCellOf, weekKeyOf, reportKey, teamDoneMap, teamsOf, allDoneOf, checkNum,
  inputView, planWeekWrite, planProgress, planAddCustomer, usersOf, reminderJobs, resultRecipients, reminderParts, resultParts, leadTeam,
  CUSTOMER_EDIT_COLS, managersOf, customerEditList, planUpdateCustomers, customersAt, resultDue,
  STAGE_CONFIRM, STAGE_MAIL_MREMIND, STAGE_MAIL_CONFIRM, managerUsersOf, managerDoneMap, managerCounts, modeAt, planSetMode, stage3Jobs, managerRemindParts, confirmParts
};
