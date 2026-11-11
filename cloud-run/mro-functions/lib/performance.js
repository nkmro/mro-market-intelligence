// cloud-run/mro-functions/lib/performance.js
// 성과평가(60%) — 설계서 PERFORMANCE_EVAL_DESIGN_v1.md v0.7.
// 1-가: 연결 시험(ping)에 쓰는 순수 함수. 1-나: 점수 계산(scoreTeam)·월실적 줄 묶기(buildTeamInput). 1-다: 보기 응답(buildView). 모두 시트 접근 없음.

// 5-2절: 인사평가 연도 파일 안 탭 3개 (이름·머리글 고정)
const TAB_MONTHLY = '성과-월실적';
const TAB_CLOSE = '성과-마감';
const TAB_CRITERIA = '성과-평가기준';
const HEADERS = {};
HEADERS[TAB_MONTHLY] = ['연도', '월', '팀', '단위구분', '단위', '단위이름', '매출액', '이익', '인원', '수정자', '수정일시'];
HEADERS[TAB_CLOSE] = ['연도', '팀', '마감월', '마감자', '마감일시', '기록'];
HEADERS[TAB_CRITERIA] = ['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'];

// 5-3절: 인사평가설정 탭 키
const UNIT_KEY_PREFIX = '성과평가단위_'; // 팀마다 1줄, 값 개인/사무소, 줄 없으면 개인
const PUBLISH_DAYS_KEY = '성과공개일수';  // 0~31, 0·빈칸·숫자 아님 = 공개 안 함(0)
const UNIT_MODES = ['개인', '사무소'];

// 5-2절 ③: 코드가 아는 항목키 5개와 묶음 — 숫자만 시트에서 바꿀 수 있다
const ITEM_KEYS = ['sales', 'profit', 'margin', 'perHead', 'teamOp'];
const TOTAL_WEIGHT = 0.6; // 성과평가 합계 60점 = 회사 규정 (v0.7 확정)

function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }

// 1행 머리글 점검: 정해진 칸이 이름·순서 그대로인지(뒤에 다른 칸이 더 있으면 안 됨)
function checkHeaders(tab, row) {
  const want = HEADERS[tab];
  const got = (row || []).map(cell);
  while (got.length && got[got.length - 1] === '') got.pop();
  const missing = want.filter(function (h) { return got.indexOf(h) < 0; });
  const ok = got.length === want.length && want.every(function (h, i) { return got[i] === h; });
  return { tab: tab, ok: ok, header: got, missing: missing };
}

// 인사평가설정 A~C 행 배열 → 팀별 평가 단위 { 동부: '사무소', ... } + 잘못된 값 목록
function readUnitModes(settingsRows) {
  const modes = {}, bad = [];
  (settingsRows || []).forEach(function (r) {
    const k = cell(r && r[0]);
    if (k.indexOf(UNIT_KEY_PREFIX) !== 0 || k.length === UNIT_KEY_PREFIX.length) return;
    const team = k.slice(UNIT_KEY_PREFIX.length), v = cell(r[1]);
    if (UNIT_MODES.indexOf(v) >= 0) modes[team] = v; else bad.push({ key: k, value: v });
  });
  return { modes: modes, bad: bad };
}
function unitModeOf(modes, team) { return modes[team] || '개인'; }

// 성과공개일수: 정수 0~31만, 그 밖(빈칸·숫자 아님·범위 밖·줄 없음) = 0(공개 안 함)
function readPublishDays(settingsRows) {
  const row = (settingsRows || []).find(function (r) { return cell(r && r[0]) === PUBLISH_DAYS_KEY; });
  const raw = row ? cell(row[1]) : '';
  const n = Number(raw);
  const valid = raw !== '' && Number.isInteger(n) && n >= 0 && n <= 31;
  return { days: valid ? n : 0, raw: row ? raw : null, valid: valid };
}

// 등급표 "110:100, 100:90, 90:80, 나머지:70" → [{over:1.10, pts:100}, ..., {over:null, pts:70}]
// 마지막은 반드시 '나머지'. 기준 %는 큰 것부터. 틀리면 null
function parseGrades(text) {
  const parts = cell(text).split(',').map(cell).filter(function (s) { return s; });
  if (parts.length < 2) return null;
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+(?:\.\d+)?|나머지)\s*:\s*(\d+(?:\.\d+)?)$/.exec(parts[i]);
    if (!m) return null;
    const last = i === parts.length - 1;
    if ((m[1] === '나머지') !== last) return null;
    out.push({ over: last ? null : Number(m[1]) / 100, pts: Number(m[2]) });
  }
  for (let i = 1; i < out.length - 1; i++) if (!(out[i].over < out[i - 1].over)) return null;
  return out;
}

// 성과-평가기준 A~F(1행 머리글 포함) → { ok, items, sum, errors }
// 멈춤 조건(PERF_CRITERIA_INVALID): 항목키 5개가 정확히 1번씩이 아님, 숫자·등급표 형식 오류,
// 같은 묶음의 묶음가중치가 다름, 묶음가중치×배점비율 합 ≠ 0.6
function parseCriteria(rows) {
  const errors = [], items = [];
  (rows || []).slice(1).forEach(function (r, i) {
    const line = i + 2;
    if (!r || r.every(function (v) { return cell(v) === ''; })) return;
    const it = { line: line, group: cell(r[0]), groupWeight: Number(cell(r[1])), key: cell(r[2]), name: cell(r[3]),
      ratio: Number(cell(r[4])), gradesText: cell(r[5]), grades: parseGrades(r[5]) };
    if (ITEM_KEYS.indexOf(it.key) < 0) errors.push(line + '행: 모르는 항목키 "' + it.key + '"');
    if (!it.group) errors.push(line + '행: 묶음 이름 없음');
    if (!(it.groupWeight > 0)) errors.push(line + '행: 묶음가중치가 0보다 큰 숫자가 아님');
    if (!(it.ratio > 0)) errors.push(line + '행: 배점비율이 0보다 큰 숫자가 아님');
    if (!it.grades) errors.push(line + '행: 등급표 형식 오류(예: 110:100, 100:90, 나머지:80)');
    items.push(it);
  });
  ITEM_KEYS.forEach(function (k) {
    const n = items.filter(function (it) { return it.key === k; }).length;
    if (n !== 1) errors.push('항목키 ' + k + ' 가 ' + n + '번 있음(1번이어야 함)');
  });
  const gw = {};
  items.forEach(function (it) {
    if (gw[it.group] === undefined) gw[it.group] = it.groupWeight;
    else if (gw[it.group] !== it.groupWeight) errors.push(it.line + '행: 같은 묶음 "' + it.group + '"의 묶음가중치가 다름');
  });
  const sum = Math.round(items.reduce(function (a, it) { return a + (it.groupWeight * it.ratio || 0); }, 0) * 1e9) / 1e9;
  if (Math.abs(sum - TOTAL_WEIGHT) > 1e-9) errors.push('묶음가중치×배점비율 합이 ' + sum + ' (회사 규정 0.6 = 60점이어야 함)');
  return { ok: errors.length === 0, items: items, sum: sum, maxPoints: Math.round(sum * 1000) / 10, errors: errors };
}

// ping 보고용: 사무소 단위 팀마다 활성 팀원(일반·담당)의 J열 사무소별 인원과 미지정 이름(가나다순)
function officeSummary(users, modes) {
  const out = {};
  Object.keys(modes).filter(function (t) { return modes[t] === '사무소'; }).forEach(function (team) {
    const members = (users || []).filter(function (u) {
      return cell(u.team) === team && cell(u.status) === '활성' && ['일반', '담당'].indexOf(cell(u.role)) >= 0;
    });
    const counts = {}, unassigned = [];
    members.forEach(function (u) {
      const o = cell(u.office);
      if (o) counts[o] = (counts[o] || 0) + 1; else unassigned.push(cell(u.name));
    });
    out[team] = {
      members: members.length,
      offices: Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).map(function (o) { return { office: o, count: counts[o] }; }),
      unassigned: unassigned.sort(function (a, b) { return a.localeCompare(b, 'ko'); })
    };
  });
  return out;
}

// =====================================================================
// 1-나: 점수 계산 (설계서 2장 — 엑셀 '사무소평가' 시트 J9·J13·J17·J18 수식 그대로)
// 순수 함수만. 시트 읽기·권한·화면은 1-다에서. 금액 단위 천원.
// =====================================================================

// 2-2절: 비율을 소수 10자리에서 반올림한 뒤 "초과" 비교(엑셀 15자리 비교와 같게 — 1.1000000000000001 같은 오차로 등급이 바뀌지 않게)
function r10(x) { return Math.round(x * 1e10) / 1e10; }
// grades = parseGrades 결과. 비율이 over 초과인 첫 단의 점수, 없으면 '나머지'
function gradeOf(ratio, grades) {
  const r = r10(ratio);
  for (let i = 0; i < grades.length - 1; i++) if (r > grades[i].over) return grades[i].pts;
  return grades[grades.length - 1].pts;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
// 1월~m월 누계 (arr[0] = 1월)
function sumTo(arr, m) { let s = 0; for (let i = 0; i < m; i++) s += num((arr || [])[i]); return s; }
function round2(x) { return Math.round(x * 100) / 100; }

// 2-2절 ① 세부 비율. 당해 매출·인원이 0이면 그 비율은 0(최저 등급)으로 본다(마감 전 빈칸은 마감 검사가 막음).
function growthRatios(P, C) {
  const mP = P.sales ? P.profit / P.sales : 0, mC = C.sales ? C.profit / C.sales : 0;
  const hP = P.heads ? P.profit / P.heads : 0, hC = C.heads ? C.profit / C.heads : 0;
  return { sales: C.sales / P.sales, profit: C.profit / P.profit, margin: mP ? mC / mP : 0, perHead: hP ? hC / hP : 0 };
}

// 팀 점수 계산.
// input = { criteria: parseCriteria 결과(ok여야 함), closeMonth: 1~12,
//   units: [{ key, name, rank?: false면 순위 제외(퇴사 등),
//             cur: { sales:[12], profit:[12], heads:[12] }, prev: { 같은 모양 } }],
//   teamCost: { cur:[12], prev:[12] } }
// 결과 = { ok, error?, closeMonth, maxPoints, team: {...}, units: [{ key, name, P, C, noPrev, items:[{key,ratio,grade,pts}], growth, team, total, rank }] }
function scoreTeam(input) {
  const crit = input && input.criteria;
  if (!crit || !crit.ok) return { ok: false, error: 'PERF_CRITERIA_INVALID', errors: (crit && crit.errors) || [] };
  const m = Number(input.closeMonth);
  if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, error: 'BAD_CLOSE_MONTH' };
  const byKey = {}; crit.items.forEach(function (it) { byKey[it.key] = it; });
  const growthKeys = ['sales', 'profit', 'margin', 'perHead'];
  const units = (input.units || []).map(function (u) {
    const P = { sales: sumTo(u.prev && u.prev.sales, m), profit: sumTo(u.prev && u.prev.profit, m), heads: sumTo(u.prev && u.prev.heads, m) };
    const C = { sales: sumTo(u.cur && u.cur.sales, m), profit: sumTo(u.cur && u.cur.profit, m), heads: sumTo(u.cur && u.cur.heads, m) };
    // 2-5절 (확정 v0.6): 전년 같은 기간 매출·이익·인원 누계 중 하나라도 0이면 "전년 실적 없음"
    const noPrev = P.sales === 0 || P.profit === 0 || P.heads === 0;
    const prevMonths = ((u.prev && u.prev.heads) || []).slice(0, m).filter(function (h) { return num(h) > 0; }).length;
    let items = null, growth = null;
    if (!noPrev) {
      const R = growthRatios(P, C);
      items = growthKeys.map(function (k) {
        const it = byKey[k], g = gradeOf(R[k], it.grades);
        return { key: k, ratio: R[k], grade: g, pts: round2(it.groupWeight * it.ratio * g) };
      });
      growth = round2(items.reduce(function (a, x) { return a + x.pts; }, 0));
    }
    return { key: u.key, name: u.name, rankable: u.rank !== false, P: P, C: C, noPrev: noPrev, prevMonths: prevMonths, items: items, growth: growth };
  });
  // 2-3절: 팀 경상이익 = 단위 이익 합 − 팀 총비용 (팀 공통 실적 줄 없음, 결정 ⑥)
  const prevProfit = units.reduce(function (a, u) { return a + u.P.profit; }, 0);
  const curProfit = units.reduce(function (a, u) { return a + u.C.profit; }, 0);
  const prevCost = sumTo(input.teamCost && input.teamCost.prev, m), curCost = sumTo(input.teamCost && input.teamCost.cur, m);
  const prevOp = prevProfit - prevCost, curOp = curProfit - curCost;
  const T = byKey.teamOp, tg = T.grades;
  let teamGrade;
  if (prevOp <= 0) teamGrade = curOp > prevOp ? tg[0].pts : tg[tg.length - 1].pts; // 엑셀 J13: 전년 0 이하면 커졌는지만
  else teamGrade = gradeOf(curOp / prevOp, tg);
  const teamPts = round2(T.groupWeight * T.ratio * teamGrade);
  units.forEach(function (u) {
    u.team = teamPts;
    u.total = u.noPrev ? null : round2(u.growth + teamPts);
  });
  // 2-4절: 순위 = 팀 안 합계 높은 순, 동점 같은 순위·다음 순위 건너뜀(엑셀 RANK). 전년 실적 없음·순위 제외 단위는 빠짐
  const eligible = units.filter(function (u) { return u.rankable && u.total !== null; });
  units.forEach(function (u) {
    u.rank = (u.rankable && u.total !== null) ? 1 + eligible.filter(function (x) { return x.total > u.total; }).length : null;
  });
  return { ok: true, closeMonth: m, maxPoints: crit.maxPoints, rankCount: eligible.length,
    team: { prevProfit: prevProfit, curProfit: curProfit, prevCost: prevCost, curCost: curCost, prevOp: prevOp, curOp: curOp,
      ratio: prevOp > 0 ? curOp / prevOp : null, grade: teamGrade, pts: teamPts },
    units: units };
}

// 성과-월실적 줄 → scoreTeam 입력의 units·teamCost (한 팀).
// rows = A~K 값 배열(1행 머리글 제외). curYear·prevYear 줄을 함께 받는다(전년 줄은 호출하는 쪽이 전년도 파일 또는 이 파일에서 골라 넘김 — 설계서 5-1).
// mode '사무소': 단위구분 '사무소' 줄, 인원 = 인원 칸 / mode '개인': 단위구분 '개인' 줄, 인원 = 줄이 있으면 1(근무, 2-2절).
// 팀비용 = 단위구분 '팀비용' 줄의 이익 칸. 단위 순서 = 사무소는 가나다, 개인은 단위이름 가나다.
function buildTeamInput(rows, team, curYear, mode) {
  const unitType = mode === '사무소' ? '사무소' : '개인';
  const units = {}, cost = { cur: new Array(12).fill(0), prev: new Array(12).fill(0) };
  const empty = function () { return { sales: new Array(12).fill(0), profit: new Array(12).fill(0), heads: new Array(12).fill(0) }; };
  (rows || []).forEach(function (r) {
    const y = num(r[0]), mo = num(r[1]);
    if (cell(r[2]) !== team || !(mo >= 1 && mo <= 12) || (y !== curYear && y !== curYear - 1)) return;
    const side = y === curYear ? 'cur' : 'prev', kind = cell(r[3]);
    if (kind === '팀비용') { cost[side][mo - 1] += num(r[7]); return; }
    if (kind !== unitType) return;
    const key = cell(r[4]); if (!key) return;
    const u = units[key] = units[key] || { key: key, name: cell(r[5]) || key, cur: empty(), prev: empty() };
    if (cell(r[5])) u.name = cell(r[5]);
    u[side].sales[mo - 1] += num(r[6]); u[side].profit[mo - 1] += num(r[7]);
    u[side].heads[mo - 1] += unitType === '개인' ? 1 : num(r[8]);
  });
  const list = Object.keys(units).map(function (k) { return units[k]; });
  list.sort(function (a, b) { return (unitType === '사무소' ? a.key : a.name).localeCompare(unitType === '사무소' ? b.key : b.name, 'ko'); });
  return { units: list, teamCost: cost };
}

// 화면 표시용 %: 소수 첫째 자리 버림(2-2절 — 99.97%를 100.0%로 보이지 않게)
function pctFloor1(ratio) { return Math.floor(r10(ratio) * 1000) / 10; }

// =====================================================================
// 1-다: 보기 화면용 (설계서 3-2 보기 권한·4장 화면·4-3 마감). 순수 함수만 — 시트 읽기는 index.js getPerformanceTest.
// 서버가 권한대로 걸러 응답을 만든다: 숫자를 볼 수 없는 사람에게는 매출·이익·인원·비율을 응답에 아예 넣지 않는다.
// =====================================================================
const MEMBER_ROLES = ['일반', '담당']; // 평가 단위가 되는 역할(팀장은 실적 없음, 결정 ⑥)

function pad2(n) { return (n < 10 ? '0' : '') + n; }
// 마감일시 칸 → { date: 'YYYY-MM-DD', text: 'YYYY-MM-DD HH:mm' }. 서식 없이 읽으면 날짜가 시리얼 숫자로 올 수 있다(시트 날짜 0 = 1899-12-30).
function closeStamp(v) {
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    const date = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    return { date: date, text: date + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) };
  }
  const s = cell(v);
  const m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return { date: '', text: s };
  const date = m[1] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[3]));
  return { date: date, text: date + (m[4] ? ' ' + pad2(Number(m[4])) + ':' + m[5] : '') };
}
// 성과-마감 A2:F 줄 → 그 팀·그해 마감 월. 같은 팀·연도 줄이 여럿이면 아래 줄(나중 기록)을 쓴다. 월이 1~12 정수가 아니면 마감 없음.
function readClose(closeRows, team, year) {
  let hit = null;
  (closeRows || []).forEach(function (r) { if (r && Number(r[0]) === Number(year) && cell(r[1]) === team) hit = r; });
  const m = hit ? Number(hit[2]) : NaN;
  if (!hit || !Number.isInteger(m) || m < 1 || m > 12) return { month: null, date: '', closedAt: '' };
  const st = closeStamp(hit[4]);
  return { month: m, date: st.date, closedAt: st.text };
}
function addDays(iso, n) {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
// 3-2절 실적 공개 기간 = 마감한 날 ~ 마감한 날 + N일(23:59, 서울). N이 0이거나 마감일을 모르면 공개 안 함.
function publishWindow(closeDate, days, today) {
  if (!closeDate || !(Number(days) >= 1)) return { open: false, until: null };
  const until = addDays(closeDate, Number(days));
  return { open: today >= closeDate && today <= until, until: until };
}
// 5-1절: 그해 줄 + 전년 줄. 전년도 파일 줄(prevRows)이 있으면 전년은 거기서만, 없으면(2026 → 2025 파일 없음) 이 파일의 전년 줄.
function pickRows(curRows, prevRows, year) {
  const y = Number(year);
  const cur = (curRows || []).filter(function (r) { return r && Number(r[0]) === y; });
  const prev = (prevRows || curRows || []).filter(function (r) { return r && Number(r[0]) === y - 1; });
  return cur.concat(prev);
}
// 임원 팀 칩: 활성 일반·담당·팀장이 있는 팀(가나다순)
function teamsOf(users) {
  const s = {};
  (users || []).forEach(function (u) {
    if (cell(u.status) === '활성' && ['일반', '담당', '팀장'].indexOf(cell(u.role)) >= 0 && cell(u.team)) s[cell(u.team)] = true;
  });
  return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
}
function emptyMonths() { return { sales: new Array(12).fill(0), profit: new Array(12).fill(0), heads: new Array(12).fill(0) }; }

// 한 팀 보기 응답 본문. p = { criteria, mode, team, year, users, closeRows, rows(그해 파일 성과-월실적 A2:K), prevRows(전년도 파일, 없으면 null),
//   publishDays, today('YYYY-MM-DD' 서울), showAll(팀장 자기 팀·임원·관리자 = 숫자 항상), myKey(내 사무소 또는 내 이메일, 없으면 '') }
function buildView(p) {
  const team = cell(p.team), mode = p.mode === '사무소' ? '사무소' : '개인';
  const close = readClose(p.closeRows, team, p.year);
  const pub = publishWindow(close.date, p.publishDays, p.today);
  const showNumbers = p.showAll === true || pub.open;
  const members = (p.users || []).filter(function (u) { return cell(u.team) === team && MEMBER_ROLES.indexOf(cell(u.role)) >= 0; });
  const active = members.filter(function (u) { return cell(u.status) === '활성'; });
  const out = { team: team, mode: mode, closeMonth: close.month, closedAt: close.closedAt,
    publish: { days: Number(p.publishDays) || 0, open: pub.open, until: pub.until }, showNumbers: showNumbers, myKey: p.myKey || '',
    unassigned: mode === '사무소' ? active.filter(function (u) { return !cell(u.office); }).length : 0 };
  if (!p.criteria || !p.criteria.ok) return Object.assign(out, { ok: false, error: 'PERF_CRITERIA_INVALID' });
  out.maxPoints = p.criteria.maxPoints;
  out.items = p.criteria.items.map(function (it) { return { key: it.key, name: it.name, group: it.group, maxPts: Math.round(it.groupWeight * it.ratio * 1000) / 10 }; });
  if (!close.month) return Object.assign(out, { ok: true, scored: false, units: [] });

  const input = buildTeamInput(pickRows(p.rows, p.prevRows, p.year), team, Number(p.year), mode);
  const byKey = {};
  input.units.forEach(function (u) { if (mode === '개인') u.key = u.key.toLowerCase(); byKey[u.key] = u; });
  // 4-1절: 점수표 행 = 사무소(J열) 또는 활성 팀원 전원 — 실적 줄이 없어도 행을 만든다(→ 전년 실적 없음)
  active.forEach(function (u) {
    const k = mode === '사무소' ? cell(u.office) : cell(u.email).toLowerCase();
    if (k && !byKey[k]) byKey[k] = { key: k, name: mode === '사무소' ? k : cell(u.name), cur: emptyMonths(), prev: emptyMonths() };
  });
  const userByEmail = {};
  members.forEach(function (u) { userByEmail[cell(u.email).toLowerCase()] = u; });
  const units = Object.keys(byKey).map(function (k) {
    const u = byKey[k];
    if (mode === '개인') {
      const usr = userByEmail[k];
      if (usr) u.name = cell(usr.name);
      u.left = !usr || cell(usr.status) !== '활성'; // 퇴사(비활성)·명단에 없는 사람: 팀 합계에는 들어가고 순위에서는 빠짐(4-2)
      u.rank = !u.left;
    } else {
      u.members = active.filter(function (x) { return cell(x.office) === k; }).length;
    }
    return u;
  });
  units.sort(function (a, b) { return (mode === '사무소' ? a.key : a.name).localeCompare(mode === '사무소' ? b.key : b.name, 'ko'); });
  const sc = scoreTeam({ criteria: p.criteria, closeMonth: close.month, units: units, teamCost: input.teamCost });
  if (!sc.ok) return Object.assign(out, { ok: false, error: sc.error });
  // 4-1절 ②: 지난 마감(한 달 전 누계) 대비 합계 변화 — 점수만
  const before = close.month > 1 ? scoreTeam({ criteria: p.criteria, closeMonth: close.month - 1, units: units, teamCost: input.teamCost }) : null;
  const beforeTotal = {};
  if (before && before.ok) before.units.forEach(function (u) { beforeTotal[u.key] = u.total; });
  out.ok = true; out.scored = true; out.rankCount = sc.rankCount;
  out.teamScore = { grade: sc.team.grade, pts: sc.team.pts };
  if (showNumbers) Object.assign(out.teamScore, { prevProfit: sc.team.prevProfit, curProfit: sc.team.curProfit, prevCost: sc.team.prevCost,
    curCost: sc.team.curCost, prevOp: sc.team.prevOp, curOp: sc.team.curOp, ratio: sc.team.ratio });
  // 표시용 members·left는 키로 찾는다(scoreTeam 출력 순서에 기대지 않음 — 1-다 커밋 전 확인 1)
  const srcByKey = {};
  units.forEach(function (u) { srcByKey[u.key] = u; });
  out.units = sc.units.map(function (u) {
    const src = srcByKey[u.key];
    const o = { key: u.key, name: u.name, noPrev: u.noPrev, growth: u.growth, team: u.team, total: u.total, rank: u.rank,
      prevTotal: (before && beforeTotal[u.key] !== undefined) ? beforeTotal[u.key] : null,
      items: u.items ? u.items.map(function (it) { return showNumbers ? { key: it.key, grade: it.grade, pts: it.pts, ratio: it.ratio } : { key: it.key, grade: it.grade, pts: it.pts }; }) : null };
    if (mode === '개인') o.left = src.left === true; else o.members = src.members;
    if (showNumbers) { o.P = u.P; o.C = u.C; o.prevMonths = u.prevMonths; }
    return o;
  });
  return out;
}

module.exports = {
  TAB_MONTHLY, TAB_CLOSE, TAB_CRITERIA, HEADERS, UNIT_KEY_PREFIX, PUBLISH_DAYS_KEY, ITEM_KEYS, TOTAL_WEIGHT,
  checkHeaders, readUnitModes, unitModeOf, readPublishDays, parseGrades, parseCriteria, officeSummary,
  gradeOf, sumTo, scoreTeam, buildTeamInput, pctFloor1,
  closeStamp, readClose, publishWindow, pickRows, teamsOf, buildView
};
