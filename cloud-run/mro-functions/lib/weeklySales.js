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

module.exports = {
  FILE_KEY_PREFIX, TAB_CUSTOMERS, TAB_PLAN, TAB_WEEKLY, TAB_PROGRESS, TAB_SETTINGS, TABS, HEADERS, DEFAULTS, GAMAGAM,
  findFileId, checkHeaders, normTeam, readSettings, weekPlan, currentReport, seoulToday, crossCheck
};
