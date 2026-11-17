// 주간 실적 1-가 시험 — node tests/weekly_sales_tests.js (가상의 값만 사용, 실제 금액 없음)
const ws = require('../lib/weeklySales');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); } }

// 1) 주차 달력 — 2026-11-17 재홍님과 함께 확정한 표 그대로
function sig(y, m) { return ws.weekPlan(y, m).map(function (w) { return w.inputDate.slice(5).replace('-', '/') + (w.gamagam ? '가' : w.week); }).join(' '); }
const want = {
  '2026-10': '10/121 10/192 10/263 11/02가',
  '2026-11': '11/091 11/162 11/233 11/30가',
  '2026-12': '12/071 12/142 12/213 12/28가',
  '2027-1': '01/111 01/182 01/253 02/01가',
  '2027-2': '02/081 02/152 02/223 03/01가',
  '2027-3': '03/081 03/152 03/223 03/29가',
  '2027-4': '04/121 04/192 04/263 05/03가',
  '2027-5': '05/101 05/172 05/243 05/31가',
  '2027-6': '06/071 06/142 06/213 06/28가',
  '2027-7': '07/121 07/192 07/263 08/02가',
  '2027-8': '08/091 08/162 08/233 08/30가',
  '2027-9': '09/061 09/132 09/203 09/27가',
  '2027-10': '10/111 10/182 10/253 11/01가',
  '2027-11': '11/081 11/152 11/223 11/29가',
  '2027-12': '12/061 12/132 12/203 12/274 01/03가'
};
Object.keys(want).forEach(function (k) { const p = k.split('-').map(Number); const got = sig(p[0], p[1]); t('C ' + k, got === want[k], got); });

// 누적 기간
const nov = ws.weekPlan(2026, 11);
t('P1 11월 1주차 = 11/1~11/8 (11/1 하루 합침)', nov[0].from === '2026-11-01' && nov[0].to === '2026-11-08');
t('P2 11월 가마감 = 11/30 입력, 말일까지', nov[3].gamagam && nov[3].inputDate === '2026-11-30' && nov[3].to === '2026-11-30');
const dec = ws.weekPlan(2026, 12);
t('P3 12월 1주차 = 12/1~12/6 (6일이라 안 합침)', dec[0].to === '2026-12-06' && dec[0].inputDate === '2026-12-07');
const jan = ws.weekPlan(2027, 1);
t('P4 1월 가마감은 2/1로 넘어감(1/25~31 = 7일)', jan[3].inputDate === '2027-02-01' && jan[2].label === '3주차' && jan[2].to === '2027-01-24');
// 넘어간 가마감 날이 다음 달 입력일과 겹치지 않음 (2026-01 ~ 2030-12)
let clash = [];
for (let y = 2026; y <= 2030; y++) for (let m = 1; m <= 12; m++) {
  const g = ws.weekPlan(y, m).slice(-1)[0].inputDate;
  const nx = m === 12 ? ws.weekPlan(y + 1, 1) : ws.weekPlan(y, m + 1);
  if (nx.some(function (w) { return w.inputDate === g; })) clash.push(y + '-' + m);
}
t('P5 5년간 가마감 날과 다음 달 입력일 겹침 없음', clash.length === 0, clash.join(','));
let maxN = 0; for (let y = 2026; y <= 2030; y++) for (let m = 1; m <= 12; m++) maxN = Math.max(maxN, ws.weekPlan(y, m).length);
t('P6 한 달 입력은 최대 5번(엑셀 5칸)', maxN === 5, String(maxN));
// 모든 입력일은 월요일
let notMon = 0; for (let y = 2026; y <= 2030; y++) for (let m = 1; m <= 12; m++) ws.weekPlan(y, m).forEach(function (w) { if (new Date(w.inputDate + 'T00:00:00Z').getUTCDay() !== 1) notMon++; });
t('P7 입력일은 모두 월요일', notMon === 0);
// 설정값을 바꾸면 규칙이 따라감 (시트 우선)
t('P8 가마감이월일수 8 = 안 넘김(1월 가마감 1/25)', ws.weekPlan(2027, 1, { 첫주합침일수: 4, 가마감이월일수: 8 }).slice(-1)[0].inputDate === '2027-01-25');
t('P9 첫주합침일수 0 = 안 합침(11월 1주차 = 11/1 하루, 11/2 입력)', ws.weekPlan(2026, 11, { 첫주합침일수: 0, 가마감이월일수: 5 })[0].inputDate === '2026-11-02');

// 2) 지금 보고 (서울 기준)
function at(s) { return Date.parse(s + '+09:00'); }
let c = ws.currentReport(at('2026-11-17T10:00:00'));
t('N1 11/17(화) → 11월 2주차(11/16 입력)', c.current.month === 11 && c.current.label === '2주차' && c.next.inputDate === '2026-11-23');
c = ws.currentReport(at('2026-11-16T00:30:00'));
t('N2 11/16 00:30 서울 → 이미 2주차', c.current.label === '2주차');
c = ws.currentReport(at('2026-11-15T23:59:00'));
t('N3 11/15 밤 → 1주차', c.current.label === '1주차');
c = ws.currentReport(at('2027-02-01T09:00:00'));
t('N4 2027-02-01 → 1월 가마감', c.current.year === 2027 && c.current.month === 1 && c.current.gamagam);
c = ws.currentReport(at('2028-01-03T09:00:00'));
t('N5 2028-01-03 → 2027년 12월 가마감(해 넘김)', c.current.year === 2027 && c.current.month === 12 && c.current.gamagam);

// 3) 설정 읽기
let s = ws.readSettings([['입력방식_동부', '2단계'], ['입력방식_서부', '3단계'], ['입력요일', '월'], ['담당마감시각', 15], ['팀장마감시각', 16], ['메일사용', true], ['첫주합침일수', 4], ['가마감이월일수', 5]]);
t('S1 정상 값', s.bad.length === 0 && s.modes.동부 === '2단계' && s.modes.서부 === '3단계' && s.팀장마감시각 === 16 && s.메일사용 === true && s.usedDefault.length === 0);
s = ws.readSettings([]);
t('S2 줄 없음 → 기본값 + usedDefault 표시', s.담당마감시각 === 15 && s.팀장마감시각 === 16 && s.usedDefault.length === 6 && s.bad.length === 0);
s = ws.readSettings([['입력방식_중부', '4단계'], ['팀장마감시각', '25'], ['메일사용', '네'], ['입력요일', '화']]);
t('S3 잘못된 값 4개 잡힘', s.bad.length === 4 && s.팀장마감시각 === 16);
s = ws.readSettings([['메일사용', 'FALSE']]);
t('S4 메일사용 FALSE(글자)', s.메일사용 === false);

// 4) 머리글 / 팀 이름 / 연결 점검
t('H1 템플릿 머리글 통과', ws.TABS.every(function (tab) { return ws.checkHeaders(tab, ws.HEADERS[tab]).ok; }));
t('H2 칸 하나 빠지면 실패', !ws.checkHeaders(ws.TAB_WEEKLY, ws.HEADERS[ws.TAB_WEEKLY].slice(1)).ok);
t('H3 연간계획 41칸', ws.HEADERS[ws.TAB_PLAN].length === 41 && ws.HEADERS[ws.TAB_PLAN][3] === '1월 매출' && ws.HEADERS[ws.TAB_PLAN][40] === '연간 이익');
t('T1 팀 이름 맞추기', ws.normTeam('서부지역팀') === '서부' && ws.normTeam('영업지원팀') === '영업지원' && ws.normTeam('동부') === '동부' && ws.normTeam(' 중부지역팀 ') === '중부');
const lk = ws.crossCheck(
  [['동부', '미계열', '가나산업(주)', '', '창원', '', true], ['동부', '미계열', '다라정밀', '', '포항', '', false], ['서부', '', '마바화학', '', '군산', '', true]],
  [[2026, '동부지역팀', '가나산업(주)'], [2026, '서부지역팀', '사아제지'], [2025, '서부지역팀', '마바화학']], 2026);
t('L1 연결 점검', lk.customers === 3 && lk.activeCustomers === 2 && lk.planRows === 2 && lk.noPlan.length === 2 && lk.planOnly[0] === '서부/사아제지');
t('F1 파일 ID 찾기', ws.findFileId([['인사평가파일_2026', 'a'], ['실적관리파일_2026', ' b1 ']], 2026) === 'b1' && ws.findFileId([], 2026) === null);

// 5) 1-나 조회 (가상의 고객사·숫자)
const C = [ // 팀, 계열, 구매사명, 발주형태, 사무소, 담당, 사용, 순서, 비고
  ['서부', '미계열', '청솔제지', '오프라인', '군산', '', true, 1, ''],
  ['동부', '미계열', '한빛정밀', '오프라인', '창원', '', true, 2, ''],
  ['동부', '대성그룹', '대성금속', '시스템연동', '포항', '', true, 3, '공장 2곳'],
  ['동부', '미계열', '푸른환경', '오프라인', '양산', '', true, 4, ''],
  ['동부', '미계열', '거래끝', '오프라인', '양산', '', false, 5, ''],
  ['중부', '미계열', '다온소재', '오프라인', '진천', '', true, 6, '']
];
function planRow(team, name, novSales, novProfit) { const r = [2026, team, name]; for (let m = 1; m <= 12; m++) r.push(m === 11 ? novSales : 1, m === 11 ? novProfit : 1, ''); return r; }
const PL = [planRow('서부지역팀', '청솔제지', 300000, 15000), planRow('동부지역팀', '한빛정밀', 400000, 24000), planRow('동부지역팀', '대성금속', 0, 0),
  planRow('중부지역팀', '다온소재', 200000, 12000), planRow('영업지원팀', '계획만', 100, 1), [2025, '동부', '한빛정밀', 999]];
const nov2 = ws.weekPlan(2026, 11)[1];
function view(weekly, progress) {
  return ws.buildReportView({ year: 2026, month: 11, entry: nov2, plan: ws.weekPlan(2026, 11), today: '2026-11-17', nowEntry: nov2, settings: ws.readSettings([]),
    customers: C, planRows: PL, weeklyRows: weekly || [], progressRows: progress || [], names: { 'a@nkmro.com': '관리자', 'b@nkmro.com': '팀장B' },
    adminEmail: 'a@nkmro.com', adminTeam: '동부' });
}
let v = view();
t('R1 빈 실적-주간 → 계획만, 실적 0', v.rows.length === 5 && v.rows.every(function (r) { return !r.entered && r.sales === null; }) && v.total.sales === 0 && v.total.planSales === 900000);
t('R2 사용 FALSE 고객사 빠짐', !v.rows.some(function (r) { return r.name === '거래끝'; }));
t('R3 팀 순서 = 시트 순서', v.subtotals.map(function (s) { return s.team; }).join() === '서부,동부,중부');
t('R4 모든 팀 미입력', v.teams.every(function (s) { return s.status === 'none'; }) && v.doneCount === 0 && v.subtotals.every(function (s) { return !s.entered; }));
t('R5 계획 없는 고객사 1(푸른환경) · 계획에만 1(영업지원/계획만) · 2025 줄 무시', v.warnings.noPlan === 1 && v.warnings.planOnly.join() === '영업지원/계획만' && v.rows[1].planSales === 400000);
t('R6 미입력 줄 → 달성률 null(화면 —), 팀 소계는 0%', v.rows[1].salesRate === null && v.rows[1].marginActual === null && v.subtotals[1].salesRate === 0 && v.total.salesRate === 0);
t('R7 계획 0 → 달성률 null(나누기 0 없음)', v.rows[2].planSales === 0 && v.rows[2].salesRate === null && v.rows[2].marginPlan === null);
t('R8 계획 없음 → 계획 null·달성률 null', v.rows[3].hasPlan === false && v.rows[3].planSales === null && v.rows[3].salesRate === null);
t('R9 주차 막대: 1·2주차 열림, 2주차 now, 3주차·가마감 예정', v.steps.map(function (s) { return (s.open ? 'o' : 'f') + (s.now ? '*' : ''); }).join() === 'o,o*,f,f');
t('R10 마감 = 11/16 16시', v.deadline.date === '2026-11-16' && v.deadline.hour === 16);
const W = [ // 연도, 월, 주차, 팀, 구매사명, 매출누적, 이익누적, 비고
  [2026, 11, 2, '동부', '한빛정밀', 200000, 13000, ''],
  [2026, 11, '2', '동부지역팀', '대성금속', 50000, 2500, '첫 납품'],
  [2026, 11, 1, '동부', '한빛정밀', 90000, 5000, ''],        // 다른 주차 → 무시
  [2026, 11, 2, '서부', '청솔제지', 120000, 6600, ''],
  [2026, 11, 2, '서부', '청솔제지', 150000, 8100, '고침'],    // 같은 고객사 아래 줄이 이김
  [2026, 10, 2, '중부', '다온소재', 1, 1, '']                  // 다른 달 → 무시
];
v = view(W, [[2026, 11, 2, '서부', '입력 완료', '', 'a@nkmro.com', '2026-11-16 15:10', ''], [2026, 11, 2, '동부', '입력 완료', '', 'b@nkmro.com', '2026-11-16 14:05', ''], [2026, 11, 2, '중부', '메모', '', 'b@nkmro.com', '', '']]);
const dong = v.subtotals[1], seo = v.subtotals[0];
t('S5 동부 소계: 계획 400000(+0), 실적 250000, 달성률 62.5%', dong.planSales === 400000 && dong.sales === 250000 && Math.abs(dong.salesRate - 0.625) < 1e-12);
t('S6 서부: 아래 줄이 이김(150000)·비고 "고침"', seo.sales === 150000 && v.rows[0].note === '고침');
t('S7 전사 합계 = 팀 소계 합', v.total.sales === 400000 && v.total.planSales === 900000 && Math.abs(v.total.salesRate - 400000 / 900000) < 1e-12);
t('S8 이익률 계획/실적/차이', Math.abs(v.rows[1].marginPlan - 0.06) < 1e-12 && Math.abs(v.rows[1].marginActual - 0.065) < 1e-12 && Math.abs(v.rows[1].marginDiff - 0.005) < 1e-12);
t('S9 팀 상태: 서부 완료(관리자 대리)·동부 완료(팀장B)·중부 미입력', v.teams[0].status === 'done' && v.teams[0].proxy === true && v.teams[1].status === 'done' && v.teams[1].proxy === false && v.teams[1].byName === '팀장B' && v.teams[2].status === 'none' && v.doneCount === 2);
t('S10 주간 비고가 없으면 고객사 비고', view([]).rows[2].note === '공장 2곳' && v.rows[2].note === '첫 납품');
v = view([[2026, 11, 2, '중부', '다온소재', 10, 1, '']]);
t('S11 저장만 있고 완료 없으면 입력 중', v.teams[2].status === 'ing' && v.subtotals[2].entered === true);
v = ws.buildReportView({ year: 2026, month: 11, entry: ws.weekPlan(2026, 11)[3], plan: ws.weekPlan(2026, 11), today: '2026-11-30', nowEntry: ws.weekPlan(2026, 11)[3], settings: ws.readSettings([]),
  customers: C, planRows: PL, weeklyRows: [[2026, 11, '가마감', '동부', '한빛정밀', 410000, 25000, '']], progressRows: [], names: {}, adminEmail: 'a@nkmro.com', adminTeam: '동부' });
t('S12 가마감 줄은 주차 칸 "가마감"으로 연결', v.gamagam === true && v.rows[1].sales === 410000 && v.rows[0].sales === null);
t('R11 사용 끔 고객사의 계획은 계획에만 있는 줄로 안 셈', ws.buildReportView({ year: 2026, month: 11, entry: nov2, plan: ws.weekPlan(2026, 11), today: '2026-11-17', nowEntry: nov2, settings: ws.readSettings([]), customers: C, planRows: PL.concat([planRow('동부', '거래끝', 5, 1)]), weeklyRows: [], progressRows: [], names: {}, adminEmail: '', adminTeam: '' }).warnings.planOnly.join() === '영업지원/계획만');
t('Y1 연도 목록', ws.yearsFromSettings([['실적관리파일_2026', 'x'], ['실적관리파일_2027', 'y'], ['인사평가파일_2025', 'z'], ['실적관리파일_2025', '']], 2026).join() === '2026');
t('U1 숫자 읽기', ws.num('1,234') === 1234 && ws.num('') === null && ws.num('가') === null && ws.num(5) === 5);

console.log(`weekly_sales_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
