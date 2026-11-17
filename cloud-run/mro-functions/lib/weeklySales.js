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
HEADERS[TAB_CUSTOMERS] = ['팀', '계열', '구매사명', '발주형태', '사무소', '담당', '사용', '순서', '비고', '등록자', '등록일시'];
HEADERS[TAB_PLAN] = PLAN_HEADERS;
HEADERS[TAB_WEEKLY] = ['연도', '월', '주차', '팀', '구매사명', '매출누적', '이익누적', '비고', '입력자', '입력일시', '담당원래매출', '담당원래이익'];
HEADERS[TAB_PROGRESS] = ['연도', '월', '주차', '팀', '단계', '담당', '처리자', '일시', '메일'];
HEADERS[TAB_SETTINGS] = ['키', '값', '설명'];

// 실적-설정 키와 기본값(시트에 줄이 없을 때만 쓴다 — 시트 우선)
const MODE_KEY_PREFIX = '입력방식_';
const MODES = ['2단계', '3단계'];
const DEFAULTS = { 입력요일: '월', 담당마감시각: 15, 팀장마감시각: 16, 메일사용: true, 첫주합침일수: 4, 가마감이월일수: 5 };
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
  return out;
}

// ---- 날짜 (UTC 자정 ms로 계산 — 시간대와 무관한 달력 계산) ----
const DAY = 86400000;
function ymd(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function utc(y, m, d) { return Date.UTC(y, m - 1, d); }
function monIdx(ms) { return (new Date(ms).getUTCDay() + 6) % 7; } // 월=0 … 일=6

// 한 달의 입력 일정. [{ week: 1.., label: '1주차' | '가마감', inputDate, from, to }] — to는 누적 마지막 날(가마감은 말일)
function weekPlan(year, month, s) {
  s = s || DEFAULTS;
  const merge = s.첫주합침일수 === undefined ? DEFAULTS.첫주합침일수 : s.첫주합침일수;
  const carry = s.가마감이월일수 === undefined ? DEFAULTS.가마감이월일수 : s.가마감이월일수;
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
    out.push({ week: n, label: n + '주차', inputDate: ymd(rep), from: ymd(first), to: ymd(rep - DAY), gamagam: false });
  }
  out.push({ week: n, label: GAMAGAM, inputDate: ymd(gm), from: ymd(first), to: ymd(last), gamagam: true });
  return out;
}

// 서울 기준 오늘 → 지금 보여 줄 보고(입력일이 오늘 이하인 가장 최근 보고). 지난달·이번 달 일정에서 찾는다.
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
  all.forEach(function (w) { if (w.inputDate <= today) cur = w; else if (!next) next = w; });
  return { today: today, current: cur, next: next };
}

// 실적-고객사 / 실적-연간계획 연결 점검 (키 = 팀 + 구매사명)
function crossCheck(customerRows, planRows, year) {
  const cust = {}, plan = {}, dup = [];
  (customerRows || []).forEach(function (r) {
    const name = cell(r && r[2]); if (!name) return;
    const k = normTeam(r[0]) + '/' + name;
    if (cust[k]) dup.push(k);
    cust[k] = { active: cell(r[6]).toUpperCase() !== 'FALSE' };
  });
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
    return { label: w.label, week: w.week, gamagam: w.gamagam, inputDate: w.inputDate, from: w.from, to: w.to,
      open: w.inputDate <= today, now: !!(nowEntry && nowEntry.inputDate === w.inputDate && nowEntry.label === w.label) };
  });
}

// 조회 응답 본문. p = { year, month, entry, plan, today, nowEntry, settings, customers(실적-고객사 A2:K), planRows(실적-연간계획 A2:AO),
//   weeklyRows(실적-주간 A2:L), progressRows(실적-진행 A2:I), names({이메일(소문자): 이름}), adminEmail, adminTeam }
// 관리자가 자기 팀이 아닌 팀을 완료 처리했으면 proxy = true (화면 '관리자 대리', 2026-11-17 확인 4 확정)
function buildReportView(p) {
  const year = p.year, month = p.month, wk = p.entry.gamagam ? GAMAGAM : String(p.entry.week);
  // 1) 고객사(사용 중만, 순서 칸 → 시트 줄 순서). 팀 순서 = 시트에 처음 나온 순서
  const cust = [], known = {};
  (p.customers || []).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name) return;
    known[normTeam(r[0]) + '/' + name] = true; // 사용 끔(FALSE) 고객사도 '계획에만 있는 줄'로 세지 않음
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
  const done = {};
  (p.progressRows || []).forEach(function (r) {
    if (num(r && r[0]) !== year || num(r[1]) !== month || weekKey(r[2]) !== wk) return;
    if (STAGE_DONE.indexOf(cell(r[4])) < 0) return;
    done[normTeam(r[3])] = { by: cell(r[6]).toLowerCase(), at: cell(r[7]) };
  });
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
    inputDate: p.entry.inputDate, from: p.entry.from, to: p.entry.to,
    deadline: { date: p.entry.inputDate, hour: p.settings.팀장마감시각 },
    steps: steps(p.plan, p.today, p.nowEntry),
    teams: teamStatus, doneCount: teamStatus.filter(function (t) { return t.status === 'done'; }).length,
    rows: rows, subtotals: subtotals, total: rates(Object.assign({ team: '전사' }, total)),
    warnings: { noPlan: noPlan, planOnly: planOnly }
  };
}

module.exports = {
  FILE_KEY_PREFIX, TAB_CUSTOMERS, TAB_PLAN, TAB_WEEKLY, TAB_PROGRESS, TAB_SETTINGS, TABS, HEADERS, DEFAULTS, GAMAGAM,
  findFileId, checkHeaders, normTeam, readSettings, weekPlan, currentReport, seoulToday, crossCheck,
  STAGE_DONE, yearsFromSettings, num, buildReportView
};
