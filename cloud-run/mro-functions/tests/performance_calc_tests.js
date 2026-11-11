// node tests/performance_calc_tests.js — 성과평가 점수 계산(lib/performance.js 1-나) 시험. 시트·네트워크 없음.
//
// [방침 — 2026-11-11 재홍님 확정] 회사 실제 실적(매출·이익·인원)은 이 저장소에 올리지 않는다.
//  - 회사 회계 자료이고, 한 번 커밋하면 파일을 지워도 커밋 기록에 영구히 남기 때문.
//  - 이 파일의 G·S·T·N·L·O·P·M·E·B 그룹 숫자는 모두 손으로 검산할 수 있게 만든 예시다(실제 실적 아님).
//  - 실제 실적 대조(R1~R4: 엑셀 9월 누계 50·54·59.5·54, 순위 4·2·1·2)는 저장소 밖 로컬 파일이 있을 때만 돈다.
//    파일이 없으면 "skip 4"로 넘어가며 실패가 아니다. 실행: PERF_REAL_ROWS=/경로/real_rows.json node tests/performance_calc_tests.js
//  - 실제 숫자는 2단계(성과-월실적 이관 뒤 앱 화면)에서 다시 대조한다.
//  - 실적 파일(real_rows.json 등)을 tests/ 나 저장소 어디에도 추가하지 말 것.
const p = require('../lib/performance');
const fs = require('fs');
let pass = 0, fail = 0, skip = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); } }
const G4 = '110:100, 100:90, 90:80, 나머지:70', G3 = '110:100, 100:90, 나머지:80';
const CRIT = p.parseCriteria([['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'],
  ['전년 실적 대비 성장률', 0.5, 'sales', '매출액 성장', 0.3, G4], ['전년 실적 대비 성장률', 0.5, 'profit', '매출이익 성장', 0.3, G4],
  ['전년 실적 대비 성장률', 0.5, 'margin', '이익률 성장(%)', 0.1, G4], ['전년 실적 대비 성장률', 0.5, 'perHead', '인당 이익금 성장', 0.3, G4],
  ['사업부문 영업이익 성장률', 0.1, 'teamOp', '팀 경상이익 성장률', 1, G3]]);
const Z = function () { return new Array(12).fill(0); };
function U(key, prev, cur, opt) { // prev/cur = [[매출, 이익, 인원] 1월, 2월, ...]
  const mk = function (ms) { const o = { sales: Z(), profit: Z(), heads: Z() }; ms.forEach(function (v, i) { o.sales[i] = v[0]; o.profit[i] = v[1]; o.heads[i] = v[2]; }); return o; };
  return Object.assign({ key: key, name: key, prev: mk(prev), cur: mk(cur) }, opt || {});
}
function cost(prev, cur) { const o = { prev: Z(), cur: Z() }; prev.forEach(function (v, i) { o.prev[i] = v; }); cur.forEach(function (v, i) { o.cur[i] = v; }); return o; }
const byKey = function (r) { const o = {}; r.units.forEach(function (u) { o[u.key] = u; }); return o; };

// ── G: 등급 (2-2절 "초과", 소수 오차)
const g4 = p.parseGrades(G4);
t('G1 정확히 110% → 90 (초과가 아님)', p.gradeOf(1.10, g4) === 90);
t('G2 110.001% → 100', p.gradeOf(1.10001, g4) === 100);
t('G3 계산 오차 1.1000000000000001 → 90 (소수 10자리 반올림)', p.gradeOf(1.1000000000000001, g4) === 90 && p.gradeOf(0.33 / 0.3, g4) === 90);
t('G4 정확히 100% → 80, 90% → 70, 음수 → 70', p.gradeOf(1, g4) === 80 && p.gradeOf(0.9, g4) === 70 && p.gradeOf(-0.5, g4) === 70);
t('G5 표시 % 소수 첫째 자리 버림 (99.97% → 99.9, 100% → 100)', p.pctFloor1(0.9997) === 99.9 && p.pctFloor1(1) === 100 && p.pctFloor1(1.0279) === 102.7);

// ── S: 손 검산 예시 (1월 마감)
// A: 매출 100→115(115%→100), 이익 10→12(120%→100), 이익률 10%→10.43%(104.3%→90), 인당 10→12(120%→100) = 15+15+4.5+15 = 49.5
// B: 전부 그대로(100%→80) = 12+12+4+12 = 40
// C: 매출 200→180(90%→70), 이익 20→16(80%→70), 이익률 10%→8.89%(88.9%→70), 인당 10→16(160%→100) = 10.5+10.5+3.5+15 = 39.5
// 팀: 이익 40→38, 비용 30→20 → 경상이익 10→18(180%→100) = 10점
let r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([30], [20]),
  units: [U('A', [[100, 10, 1]], [[115, 12, 1]]), U('B', [[100, 10, 2]], [[100, 10, 2]]), U('C', [[200, 20, 2]], [[180, 16, 1]])] });
let k = byKey(r);
t('S1 계산 성공, 만점 60', r.ok && r.maxPoints === 60, r);
t('S2 A 항목 등급 100/100/90/100, 점수 15/15/4.5/15, 소계 49.5', k.A.items.map(function (i) { return i.grade; }).join() === '100,100,90,100' && k.A.items.map(function (i) { return i.pts; }).join() === '15,15,4.5,15' && k.A.growth === 49.5, k.A.items);
t('S3 B 소계 40, C 소계 39.5', k.B.growth === 40 && k.C.growth === 39.5, [k.B.growth, k.C.growth]);
t('S4 팀 경상이익 10→18, 등급 100, 10점 (모든 단위 같음)', r.team.prevOp === 10 && r.team.curOp === 18 && r.team.pts === 10 && r.units.every(function (u) { return u.team === 10; }), r.team);
t('S5 합계 59.5 / 50 / 49.5, 순위 1·2·3', [k.A.total, k.B.total, k.C.total].join() === '59.5,50,49.5' && [k.A.rank, k.B.rank, k.C.rank].join() === '1,2,3');

// ── T: 동점 순위 (엑셀 RANK: 1, 2, 2, 4)
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([30], [20]),
  units: [U('A', [[100, 10, 1]], [[115, 12, 1]]), U('B', [[100, 10, 2]], [[100, 10, 2]]), U('B2', [[50, 5, 1]], [[50, 5, 1]]), U('C', [[200, 20, 2]], [[180, 16, 1]])] });
k = byKey(r);
t('T1 동점 같은 순위, 다음 순위 건너뜀', [k.A.rank, k.B.rank, k.B2.rank, k.C.rank].join() === '1,2,2,4' && r.rankCount === 4);

// ── N: 전년 실적 없음 (2-5절 확정) — ① 없음, 합계 없음, 순위 제외, ② 점수는 표시, 팀 이익에는 들어감
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([30], [20]),
  units: [U('A', [[100, 10, 1]], [[115, 12, 1]]), U('NEW', [[0, 0, 0]], [[40, 5, 1]])] });
k = byKey(r);
t('N1 신규: noPrev, 항목·소계·합계·순위 없음', k.NEW.noPrev && k.NEW.items === null && k.NEW.growth === null && k.NEW.total === null && k.NEW.rank === null);
t('N2 신규에도 ② 팀 점수는 표시', k.NEW.team === r.team.pts);
t('N3 신규 이익도 팀 경상이익에 들어감(당해 이익 12+5=17)', r.team.curProfit === 17);
t('N4 순위 분모에서 빠짐 (A 1위 / 1)', k.A.rank === 1 && r.rankCount === 1);
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([0], [0]), units: [U('P0', [[100, 0, 1]], [[100, 5, 1]])] });
t('N5 전년 이익 0만 있어도 전년 실적 없음', r.units[0].noPrev);

// ── L: 순위 제외(퇴사) — 합계는 계산, 순위 없음
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([30], [20]),
  units: [U('A', [[100, 10, 1]], [[115, 12, 1]]), U('LEFT', [[100, 10, 1]], [[200, 30, 1]], { rank: false })] });
k = byKey(r);
t('L1 퇴사자 합계는 있고 순위·분모 제외 → A 1위 / 1', k.LEFT.total !== null && k.LEFT.rank === null && k.A.rank === 1 && r.rankCount === 1);

// ── O: 팀 경상이익 전년 0 이하 (엑셀 J13)
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([50], [20]), units: [U('A', [[100, 10, 1]], [[100, 10, 1]])] });
t('O1 전년 −40 → 당해 −10(커짐) → 100등급 10점', r.team.prevOp === -40 && r.team.curOp === -10 && r.team.grade === 100 && r.team.pts === 10, r.team);
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([50], [60]), units: [U('A', [[100, 10, 1]], [[100, 10, 1]])] });
t('O2 전년 −40 → 당해 −50(작아짐) → 80등급 8점', r.team.grade === 80 && r.team.pts === 8);
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([0], [0]), units: [U('A', [[100, 10, 1]], [[105, 10.5, 1]])] });
t('O3 전년 10 → 당해 10.5 (105%) → 90등급 9점', r.team.grade === 90 && r.team.pts === 9);

// ── P: 전년 이익 음수 단위 (엑셀과 같게 비율 음수 → 70)
r = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: cost([0], [0]), units: [U('NEG', [[100, -10, 1]], [[100, 5, 1]])] });
t('P1 전년 이익 −10 → 이익 비율 −0.5 → 70등급', !r.units[0].noPrev && r.units[0].items[1].grade === 70);

// ── M: 누계 — 마감 월까지만 더함
r = p.scoreTeam({ criteria: CRIT, closeMonth: 2, teamCost: cost([0, 0, 0], [0, 0, 0]),
  units: [U('A', [[100, 10, 1], [100, 10, 1], [100, 10, 1]], [[100, 10, 1], [120, 12, 1], [999, 999, 1]])] });
t('M1 2월 마감: 1~2월만 (매출 200→220), 3월 숫자는 안 씀', r.units[0].P.sales === 200 && r.units[0].C.sales === 220 && r.units[0].C.profit === 22);
t('M2 전년 근무 달 수(prevMonths) = 2', r.units[0].prevMonths === 2);
t('M3 인당 이익 = 이익 누계 ÷ 인원 누계(사람·월)', (function () {
  const x = p.scoreTeam({ criteria: CRIT, closeMonth: 2, teamCost: cost([0, 0], [0, 0]), units: [U('A', [[100, 30, 3], [100, 30, 3]], [[100, 30, 3], [100, 30, 2]])] });
  return x.units[0].items[3].ratio === (60 / 5) / (60 / 6); })());

// ── E: 멈춤
const bad = p.parseCriteria([['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'], ['성장', 0.5, 'sales', '매출', 0.4, G4]]);
t('E1 기준 오류면 계산 안 함(PERF_CRITERIA_INVALID)', p.scoreTeam({ criteria: bad, closeMonth: 9, units: [] }).error === 'PERF_CRITERIA_INVALID');
t('E2 마감 월 0·13·빈칸 → BAD_CLOSE_MONTH', [0, 13, ''].every(function (m) { return p.scoreTeam({ criteria: CRIT, closeMonth: m, units: [] }).error === 'BAD_CLOSE_MONTH'; }));

// ── B: 성과-월실적 줄 → 입력 (buildTeamInput)
const rows = [
  [2026, 1, '동부', '사무소', '양산', '양산', 120, 12, 2, '', ''], [2025, 1, '동부', '사무소', '양산', '양산', 100, 10, 1, '', ''],
  [2026, 1, '동부', '사무소', '대구달성', '대구달성', 300, 30, 3, '', ''], [2026, 1, '동부', '팀비용', '', '', '', 25, '', '', ''],
  [2025, 1, '동부', '팀비용', '', '', '', 20, '', '', ''], [2026, 2, '서부', '사무소', '양산', '양산', 999, 99, 9, '', ''],
  [2024, 1, '동부', '사무소', '양산', '양산', 777, 77, 7, '', ''], [2026, 1, '동부', '개인', 'x@n', '김OO', 50, 5, '', '', ''],
  [2026, 13, '동부', '사무소', '양산', '양산', 1, 1, 1, '', '']];
let bi = p.buildTeamInput(rows, '동부', 2026, '사무소');
t('B1 사무소 모드: 사무소 줄만, 가나다순(대구달성·양산)', bi.units.map(function (u) { return u.key; }).join() === '대구달성,양산');
const ys = bi.units[1];
t('B2 양산 당해 1월 120/12/2, 전년 1월 100/10/1', ys.cur.sales[0] === 120 && ys.cur.heads[0] === 2 && ys.prev.sales[0] === 100 && ys.prev.heads[0] === 1);
t('B3 다른 팀·2024년·13월 줄은 무시', ys.cur.sales[1] === 0 && ys.prev.sales.reduce(function (a, b) { return a + b; }, 0) === 100);
t('B4 팀비용 = 팀비용 줄 이익 칸 (당해 25, 전년 20)', bi.teamCost.cur[0] === 25 && bi.teamCost.prev[0] === 20);
bi = p.buildTeamInput(rows, '동부', 2026, '개인');
t('B5 개인 모드: 개인 줄만, 이름 표시, 인원 = 1 (인원 칸 빈칸이어도)', bi.units.length === 1 && bi.units[0].name === '김OO' && bi.units[0].cur.heads[0] === 1);

// ── R: 재홍님 엑셀 실제 실적 대조 (로컬 전용 — 회계 숫자는 저장소에 올리지 않음)
if (process.env.PERF_REAL_ROWS && fs.existsSync(process.env.PERF_REAL_ROWS)) {
  const real = JSON.parse(fs.readFileSync(process.env.PERF_REAL_ROWS, 'utf8'));
  const x = p.scoreTeam(Object.assign({ criteria: CRIT, closeMonth: 9 }, p.buildTeamInput(real, '동부', 2026, '사무소')));
  const kk = byKey(x);
  t('R1 엑셀 9월 누계 합계 = 50 · 54 · 59.5 · 54', [kk['대구달성'].total, kk['양산'].total, kk['창원'].total, kk['포항'].total].join() === '50,54,59.5,54', x.units.map(function (u) { return [u.key, u.total]; }));
  t('R2 엑셀 순위 = 4 · 2 · 1 · 2', [kk['대구달성'].rank, kk['양산'].rank, kk['창원'].rank, kk['포항'].rank].join() === '4,2,1,2');
  t('R3 엑셀 등급 대구달성 80/80/80/80 · 양산 100/100/70/70 · 창원 100/100/90/100 · 포항 70/90/100/100', ['대구달성', '양산', '창원', '포항'].map(function (n) { return kk[n].items.map(function (i) { return i.grade; }).join('/'); }).join(' ') === '80/80/80/80 100/100/70/70 100/100/90/100 70/90/100/100');
  t('R4 팀 경상이익 전년 0 이하 → 당해가 커짐 → 10점 (엑셀 J13)', x.team.prevOp <= 0 && x.team.curOp > x.team.prevOp && x.team.pts === 10);
} else { skip += 4; }

console.log('pass ' + pass + ' / fail ' + fail + (skip ? ' / skip ' + skip + ' (실제 실적 대조는 로컬 파일이 있을 때만)' : ''));
process.exit(fail ? 1 : 0);
