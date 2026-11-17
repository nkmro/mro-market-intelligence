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
    inputDate: p.entry.inputDate, from: p.entry.from, to: p.entry.to,
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
const CUSTOMER_COLS = 11;      // 실적-고객사 A~K
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
  const teams = teamsOf(customers), done = teamDoneMap(progressRows, year, month, weekKeyOf(entry));
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

// 입력 탭 응답. p = { year, month, entry, plan, team, customers, weeklyRows, progressRows, names, adminEmail, adminTeam, isAdmin, isCurrent }
function inputView(p) {
  const wk = weekKeyOf(p.entry), team = normTeam(p.team);
  const idx = p.plan.findIndex(function (w) { return w.inputDate === p.entry.inputDate && w.label === p.entry.label; });
  const prevEntry = idx > 0 ? p.plan[idx - 1] : null, pk = prevEntry ? weekKeyOf(prevEntry) : null;
  const cur = {}, prev = {};
  let lastAt = '', lastBy = '';
  (p.weeklyRows || []).forEach(function (r) {
    if (num(r && r[0]) !== p.year || num(r[1]) !== p.month || normTeam(r[3]) !== team) return;
    const k = cell(r[4]), w = weekKey(r[2]);
    if (w === wk) { cur[k] = { sales: num(r[5]), profit: num(r[6]), note: cell(r[7]) }; if (cell(r[9]) > lastAt) { lastAt = cell(r[9]); lastBy = lcs(r[8]); } }
    else if (pk !== null && w === pk) prev[k] = { sales: num(r[5]), profit: num(r[6]) };
  });
  const rows = [];
  (p.customers || []).map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
    return cell(x.r && x.r[2]) && normTeam(x.r[0]) === team && cell(x.r[6]).toUpperCase() !== 'FALSE';
  }).sort(function (a, b) { const oa = num(a.r[7]), ob = num(b.r[7]); return (oa === null ? 1e9 : oa) - (ob === null ? 1e9 : ob) || a.i - b.i; }).forEach(function (x) {
    const name = cell(x.r[2]), c = cur[name], pv = prev[name];
    rows.push({ name: name, office: cell(x.r[4]), series: cell(x.r[1]), orderType: cell(x.r[3]),
      prevSales: pv ? pv.sales : null, prevProfit: pv ? pv.profit : null,
      sales: c ? c.sales : null, profit: c ? c.profit : null, note: c ? c.note : '', saved: !!c });
  });
  const st = allDoneOf(p.customers, p.progressRows, p.year, p.month, p.entry);
  const d = st.done[team] || null, admin = lcs(p.adminEmail), names = p.names || {};
  const proxyOf = function (by) { return !!admin && by === admin && cell(p.adminTeam) !== team; };
  const canEdit = !d && (p.isAdmin || p.isCurrent);
  return {
    team: team, teams: st.teams, isAdmin: !!p.isAdmin, gamagam: p.entry.gamagam, label: p.entry.label,
    from: p.entry.from, to: p.entry.to, inputDate: p.entry.inputDate, prevLabel: prevEntry ? prevEntry.label : null,
    rows: rows, savedCount: rows.filter(function (r) { return r.saved; }).length,
    lastSavedAt: lastAt, lastSavedBy: lastBy ? (names[lastBy] || lastBy) : '', lastSavedProxy: proxyOf(lastBy),
    done: d ? { at: d.at, byName: names[d.by] || d.by, proxy: proxyOf(d.by) } : null, allDone: st.all,
    canEdit: canEdit, canComplete: canEdit,
    canReopen: !!d && (p.isAdmin || (p.isCurrent && !st.all)),
    lockedReason: d ? 'DONE' : (canEdit ? '' : 'PAST_WEEK')
  };
}

// [저장] 쓰기 계획. 같은 키(연도·월·주차·팀·구매사명) 줄이 있으면 그 줄 A~J 덮어쓰기, 없으면 다음 빈 줄(planMonthWrite 관례)
// p = { weeklyRows, customers, year, month, entry, team, entries:[{name, sales, profit, note}], who, nowMs }
function planWeekWrite(p) {
  const team = normTeam(p.team), wk = weekKeyOf(p.entry);
  const active = {};
  (p.customers || []).forEach(function (r) { if (cell(r && r[2]) && normTeam(r[0]) === team && cell(r[6]).toUpperCase() !== 'FALSE') active[cell(r[2])] = true; });
  const seen = {}, clean = [];
  for (let i = 0; i < (p.entries || []).length; i++) {
    const e = p.entries[i] || {}, name = cell(e.name);
    if (!active[name]) return { ok: false, error: 'UNKNOWN_CUSTOMER', field: name };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    const sales = checkNum(e.sales), profit = checkNum(e.profit), note = cell(e.note);
    if (Number.isNaN(sales) || Number.isNaN(profit)) return { ok: false, error: 'BAD_NUMBER', field: name };
    if (note.length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG', field: name };
    clean.push({ name: name, sales: sales, profit: profit, note: note });
  }
  const indexed = indexRows(p.weeklyRows), found = {};
  indexed.forEach(function (x) {
    if (num(x.v[0]) === p.year && num(x.v[1]) === p.month && weekKey(x.v[2]) === wk && normTeam(x.v[3]) === team) found[cell(x.v[4])] = x.row;
  });
  let next = nextFreeRow(indexed);
  const stamp = seoulStamp(p.nowMs), who = lcs(p.who), writes = [];
  clean.forEach(function (e) {
    const row = found[e.name];
    const empty = e.sales === null && e.profit === null && e.note === '';
    if (!row && empty) return; // 처음부터 빈칸이면 줄을 만들지 않음
    const values = [p.year, p.month, weekCellOf(p.entry), team, e.name, e.sales === null ? '' : e.sales, e.profit === null ? '' : e.profit, e.note, who, stamp];
    writes.push({ row: row || next++, values: values, isNew: !row });
  });
  return { ok: true, writes: writes };
}

// 실적-진행에 이력 한 줄 덧붙이기 (입력 완료 / 완료 취소 / 16시 알림 / 결과 메일)
function planProgress(p) {
  const row = nextFreeRow(indexRows(p.progressRows));
  return { row: row, values: [p.year, p.month, weekCellOf(p.entry), cell(p.team), p.stage, '', lcs(p.who), seoulStamp(p.nowMs), cell(p.mail)] };
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
  return { ok: true, row: row, values: [team, fields[0], name, fields[1], fields[2], '', true, maxOrd + 1, cell(p.note), lcs(p.who), seoulStamp(p.nowMs)] };
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
    const total = (p.customers || []).filter(function (r) { return cell(r && r[2]) && normTeam(r[0]) === t && cell(r[6]).toUpperCase() !== 'FALSE'; }).length;
    const saved = {};
    (p.weeklyRows || []).forEach(function (r) { if (num(r && r[0]) === cur.year && num(r[1]) === cur.month && weekKey(r[2]) === weekKeyOf(cur) && normTeam(r[3]) === t) saved[cell(r[4])] = true; });
    jobs.push({ key: 'remind_' + cur.year + '_' + cur.month + '_' + weekKeyOf(cur) + '_' + t, kind: 'remind', team: t, year: cur.year, month: cur.month, entry: cur,
      hour: s.팀장마감시각, total: total, savedCount: Object.keys(saved).length, proxy: !leaders.length, recipients: to });
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
    lines: [title + ' 주간 실적(' + rangeText(job.year, job.month, job.entry) + ')이 아직 [입력 완료]되지 않았어요.'].concat(job.proxy ? ['(' + label + '은 팀장 계정이 아직 없어 관리자에게 보냈어요 — 대리 입력이 필요해요.)'] : []),
    period: { title: null, lines: ['· 마감: ' + fmtMd(job.entry.inputDate) + ' ' + pad2s(job.hour) + ':00', '· 지금 상태: 고객사 ' + job.total + '곳 중 ' + job.savedCount + '곳 저장됨, 입력 완료 전', '', '아래 버튼을 눌러 숫자를 확인하고 [입력 완료]를 눌러 주세요.'] },
    button: '주간 실적 열기', link: appUrl + '?view=weekly', footer: FOOTER
  };
}
// 결과 메일 본문 parts. view = buildReportView 결과(4팀 완료 상태)
function resultParts(job, view, r, appUrl) {
  const title = job.month + '월 ' + job.entry.label, t = view.total;
  const teamLines = view.subtotals.map(function (s) { return '· ' + s.team + '  ' + fmtNum(s.sales) + ' / ' + fmtNum(s.planSales) + ' / ' + fmtPct(s.salesRate); });
  const doneLines = view.teams.map(function (x) { return '· ' + x.team + ' ' + String(x.at || '').slice(5).replace('-', '/') + ' ' + (x.proxy ? '(관리자 대리)' : (x.byName || '')); });
  return {
    to: r.email,
    subject: '[MRO 워크허브] ' + title + ' 주간 실적 보고 (' + view.teams.length + '팀 입력 완료)',
    hello: r.name ? r.name + '님,' : '',
    lines: [title + ' 주간 실적(' + rangeText(job.year, job.month, job.entry) + ')이 ' + view.teams.length + '팀 모두 입력 완료됐어요.', '',
      '■ 전사',
      '· 매출 누적 ' + fmtNum(t.sales) + ' / 계획 ' + fmtNum(t.planSales) + ' (' + fmtPct(t.salesRate) + ')',
      '· 매출이익 누적 ' + fmtNum(t.profit) + ' / 계획 ' + fmtNum(t.planProfit) + ' (' + fmtPct(t.profitRate) + ') · 이익률 ' + fmtPct(t.marginActual), '',
      '■ 팀별 (매출 누적 / 계획 / 달성률)'].concat(teamLines),
    period: { title: '■ 입력 완료', lines: doneLines.concat(['', '고객사별 자세한 숫자는 앱에서 볼 수 있어요.']) },
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

// ---- 고객사 정보 고치기 (2026-11-17 재홍님 확정: 담당 = 활성 '담당' 이름, 사용 끄기 = 경고만, 수정 기록 없음, 구매사명·팀 변경 없음) ----
// 고칠 수 있는 칸 → 실적-고객사 열 (A 팀 · B 계열 · C 구매사명 · D 발주형태 · E 사무소 · F 담당 · G 사용 · H 순서 · I 비고)
const CUSTOMER_EDIT_COLS = { series: 'B', orderType: 'D', office: 'E', manager: 'F', active: 'G', ord: 'H', note: 'I' };
const CUSTOMER_LOCKED = ['name', 'team']; // 🔒 주간 실적·연간계획과 '팀 + 구매사명'으로 이어져 있어 바꾸지 않음
const ORD_MAX = 9999;
function isOff(v) { return cell(v).toUpperCase() === 'FALSE'; }

// 그 팀 활성 '담당' 이름 목록(사용자팀마스터 줄 순서, 같은 이름은 한 번)
function managersOf(userRows, team) {
  const t = normTeam(team), out = [];
  usersOf(userRows).forEach(function (u) { if (u.active && u.role === '담당' && normTeam(u.team) === t && u.name && out.indexOf(u.name) < 0) out.push(u.name); });
  return out;
}

// 고치기 창 목록: 그 팀 고객사 전체(사용 끔 포함). 사용 중 먼저(순서 칸 → 시트 줄 순서), 사용 끔은 뒤.
// monthHas = 그 연·월에 실적-주간 숫자 줄이 있는지(사용 끌 때 경고용)
function customerEditList(customers, team, weeklyRows, year, month) {
  const t = normTeam(team), has = {};
  (weeklyRows || []).forEach(function (r) { if (num(r && r[0]) === year && num(r[1]) === month && normTeam(r[3]) === t) has[cell(r[4])] = true; });
  const list = [];
  (customers || []).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name || normTeam(r[0]) !== t) return;
    const o = num(r[7]);
    list.push({ name: name, series: cell(r[1]), orderType: cell(r[3]), office: cell(r[4]), manager: cell(r[5]), active: !isOff(r[6]),
      ord: o === null ? '' : o, note: cell(r[8]), monthHas: !!has[name], i: i });
  });
  list.sort(function (a, b) { return (b.active - a.active) || ((a.ord === '' ? 1e9 : a.ord) - (b.ord === '' ? 1e9 : b.ord)) || a.i - b.i; });
  return list.map(function (x) { delete x.i; return x; });
}

// [변경 저장] 쓰기 계획. p = { customers(A2:K), team, changes:[{ name, fields:{ series, orderType, office, manager, active, ord, note } }], managers, weeklyRows, year, month }
// 바뀐 칸만(시트 지금 값과 다른 칸만) 한 칸씩. 담당은 바꿀 때만 활성 담당 목록과 대조(빈칸 = 담당 없음 허용).
function planUpdateCustomers(p) {
  const team = normTeam(p.team), rows = {}, dup = {};
  (p.customers || []).forEach(function (r, i) {
    const name = cell(r && r[2]); if (!name || normTeam(r[0]) !== team) return;
    if (rows[name]) dup[name] = true;
    rows[name] = { row: i + 2, r: r || [] };
  });
  const changes = p.changes || [];
  if (!changes.length) return { ok: false, error: 'NO_CHANGES' };
  const managers = p.managers || [];
  const list = customerEditList(p.customers, team, p.weeklyRows, p.year, p.month), monthHas = {};
  list.forEach(function (c) { monthHas[c.name] = c.monthHas; });
  const seen = {}, writes = [], warnings = [];
  for (let k = 0; k < changes.length; k++) {
    const ch = changes[k] || {}, name = cell(ch.name), f = ch.fields || {};
    const keys = Object.keys(f);
    for (let j = 0; j < keys.length; j++) {
      if (CUSTOMER_LOCKED.indexOf(keys[j]) >= 0) return { ok: false, error: 'LOCKED_FIELD', field: name + ' ' + keys[j] };
      if (!CUSTOMER_EDIT_COLS[keys[j]]) return { ok: false, error: 'BAD_FIELD', field: keys[j] };
    }
    if (!rows[name]) return { ok: false, error: 'UNKNOWN_CUSTOMER', field: name };
    if (dup[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    if (seen[name]) return { ok: false, error: 'DUPLICATE_CUSTOMER', field: name };
    seen[name] = true;
    const at = rows[name], cur = at.r;
    const want = {};
    if ('series' in f) want.series = cell(f.series);
    if ('orderType' in f) want.orderType = cell(f.orderType);
    if ('office' in f) want.office = cell(f.office);
    if (['series', 'orderType', 'office'].some(function (x) { return (want[x] || '').length > FIELD_MAX; })) return { ok: false, error: 'FIELD_TOO_LONG', field: name };
    if ('note' in f) { want.note = cell(f.note); if (want.note.length > NOTE_MAX) return { ok: false, error: 'NOTE_TOO_LONG', field: name }; }
    if ('manager' in f) want.manager = cell(f.manager);
    if ('active' in f) { if (typeof f.active !== 'boolean') return { ok: false, error: 'BAD_FIELD', field: name + ' active' }; want.active = f.active; }
    if ('ord' in f) {
      const s = cell(f.ord);
      if (s === '') want.ord = '';
      else if (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= ORD_MAX) want.ord = Number(s);
      else return { ok: false, error: 'BAD_ORDER', field: name };
    }
    const now = { series: cell(cur[1]), orderType: cell(cur[3]), office: cell(cur[4]), manager: cell(cur[5]), active: !isOff(cur[6]), ord: num(cur[7]) === null ? '' : num(cur[7]), note: cell(cur[8]) };
    Object.keys(want).forEach(function (x) {
      if (want[x] === now[x]) return; // 같은 값은 쓰지 않음
      writes.push({ name: name, field: x, cell: CUSTOMER_EDIT_COLS[x] + at.row, value: want[x] });
    });
    if ('manager' in want && want.manager !== now.manager && want.manager !== '' && managers.indexOf(want.manager) < 0) return { ok: false, error: 'BAD_MANAGER', field: name + ' ' + want.manager };
    if (want.active === false && now.active && monthHas[name]) warnings.push(name);
  }
  return { ok: true, writes: writes, rows: Object.keys(seen).filter(function (n) { return writes.some(function (w) { return w.name === n; }); }).length, warnings: warnings };
}

module.exports = {
  FILE_KEY_PREFIX, TAB_CUSTOMERS, TAB_PLAN, TAB_WEEKLY, TAB_PROGRESS, TAB_SETTINGS, TABS, HEADERS, DEFAULTS, GAMAGAM,
  findFileId, checkHeaders, normTeam, readSettings, weekPlan, currentReport, seoulToday, crossCheck,
  STAGE_DONE, yearsFromSettings, num, buildReportView,
  STAGE_REOPEN, STAGE_MAIL_REMIND, STAGE_MAIL_RESULT, WEEKLY_WRITE_COLS, PROGRESS_COLS, CUSTOMER_COLS,
  seoulStamp, seoulHour, weekCellOf, weekKeyOf, reportKey, teamDoneMap, teamsOf, allDoneOf, checkNum,
  inputView, planWeekWrite, planProgress, planAddCustomer, usersOf, reminderJobs, resultRecipients, reminderParts, resultParts, leadTeam,
  CUSTOMER_EDIT_COLS, managersOf, customerEditList, planUpdateCustomers
};
