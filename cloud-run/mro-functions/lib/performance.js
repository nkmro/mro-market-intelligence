// cloud-run/mro-functions/lib/performance.js
// 성과평가(60%) — 설계서 PERFORMANCE_EVAL_DESIGN_v1.md v0.7.
// 1-가: 연결 시험(ping)에 쓰는 순수 함수만 (시트 접근 없음). 점수 계산은 1-나에서 이 파일에 추가한다.

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

module.exports = {
  TAB_MONTHLY, TAB_CLOSE, TAB_CRITERIA, HEADERS, UNIT_KEY_PREFIX, PUBLISH_DAYS_KEY, ITEM_KEYS, TOTAL_WEIGHT,
  checkHeaders, readUnitModes, unitModeOf, readPublishDays, parseGrades, parseCriteria, officeSummary
};
