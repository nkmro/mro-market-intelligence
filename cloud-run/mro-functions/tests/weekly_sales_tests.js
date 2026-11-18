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
c = ws.currentReport(at('2026-11-12T23:59:00'));
t('N3 11/12(목) 밤 → 1주차(2주차 입력은 11/13 금요일부터)', c.current.label === '1주차');
c = ws.currentReport(at('2027-02-01T09:00:00'));
t('N4 2027-02-01 → 1월 가마감', c.current.year === 2027 && c.current.month === 1 && c.current.gamagam);
c = ws.currentReport(at('2028-01-03T09:00:00'));
t('N5 2028-01-03 → 2027년 12월 가마감(해 넘김)', c.current.year === 2027 && c.current.month === 12 && c.current.gamagam);
// 금요일 입력 시작(2026-11-18 재홍님 요청): 입력은 마감 월요일 3일 전(전주 금요일 0시)부터, 마감 뒤에도 잠그지 않음
t('F1 11월 1주차: 11/6(금)부터 입력, 마감 11/9(월)', nov[0].openDate === '2026-11-06' && nov[0].inputDate === '2026-11-09' && nov[3].openDate === '2026-11-27');
c = ws.currentReport(at('2026-11-13T00:00:00'));
t('F2 11/13(금) 0시 → 2주차가 지금 보고(입력 열림)', c.current.label === '2주차' && c.next.label === '3주차' && c.next.openDate === '2026-11-20');
c = ws.currentReport(at('2026-11-10T09:00:00'));
t('F3 11/10(화) = 마감 뒤에도 1주차(잠그지 않음)', c.current.label === '1주차');
c = ws.currentReport(at('2027-01-29T09:00:00'));
t('F4 2027-01-29(금) → 1월 가마감(2/1 마감)이 열림', c.current.month === 1 && c.current.gamagam && c.current.openDate === '2027-01-29');
const s0 = ws.readSettings([['입력시작일수', 0]]);
t('F5 입력시작일수 0 = 월요일 당일만(예전과 같음), 7은 잘못된 값', ws.weekPlan(2026, 11, s0)[0].openDate === '2026-11-09' && ws.currentReport(at('2026-11-13T09:00:00'), s0).current.label === '1주차' && ws.readSettings([['입력시작일수', 7]]).bad.length === 1);
let olap = [];
for (let y = 2026; y <= 2030; y++) for (let m = 1; m <= 12; m++) { const pl = ws.weekPlan(y, m); for (let k = 1; k < pl.length; k++) if (pl[k].openDate <= pl[k - 1].inputDate) olap.push(y + '-' + m); }
t('F6 5년간 다음 주차 입력 시작이 앞 주차 마감보다 늦음(겹침 없음)', olap.length === 0, olap.join(','));

// 3) 설정 읽기
let s = ws.readSettings([['입력방식_동부', '2단계'], ['입력방식_서부', '3단계'], ['입력요일', '월'], ['담당마감시각', 15], ['팀장마감시각', 16], ['메일사용', true], ['첫주합침일수', 4], ['가마감이월일수', 5], ['결과메일대기분', 60], ['입력시작일수', 3]]);
t('S1 정상 값', s.bad.length === 0 && s.modes.동부 === '2단계' && s.modes.서부 === '3단계' && s.팀장마감시각 === 16 && s.메일사용 === true && s.usedDefault.length === 0);
s = ws.readSettings([]);
t('S2 줄 없음 → 기본값 + usedDefault 표시', s.담당마감시각 === 15 && s.팀장마감시각 === 16 && s.usedDefault.length === 8 && s.결과메일대기분 === 60 && s.입력시작일수 === 3 && s.bad.length === 0);
t('S5 결과메일대기분: 0~1440, 잘못되면 기본 60', ws.readSettings([['결과메일대기분', 0]]).결과메일대기분 === 0 && ws.readSettings([['결과메일대기분', '90']]).결과메일대기분 === 90 && ws.readSettings([['결과메일대기분', '2000']]).결과메일대기분 === 60 && ws.readSettings([['결과메일대기분', '2000']]).bad.length === 1);
const H1MS = Date.parse('2026-11-17T16:09:00+09:00');
t('S6 결과 메일 때: 완료 16:09 → 17:02 기다림, 18:02 보냄, 대기 0분이면 17:02 보냄, 완료 시각 없으면 바로', !ws.resultDue(H1MS, Date.parse('2026-11-17T17:02:00+09:00'), ws.readSettings([])) && ws.resultDue(H1MS, Date.parse('2026-11-17T18:02:00+09:00'), ws.readSettings([])) && ws.resultDue(H1MS, Date.parse('2026-11-17T17:02:00+09:00'), ws.readSettings([['결과메일대기분', 0]])) && ws.resultDue(null, H1MS, ws.readSettings([])));
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
t('F7 조회·주차 막대에 입력 시작일(openDate) — 2주차 11/13(금)', v.openDate === '2026-11-13' && v.steps[1].openDate === '2026-11-13' && v.steps[2].open === false);
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

// 6) 2단계 — 입력·완료·취소·고객사 추가·알림·결과 메일 (가상의 값)
(async function stage2() {
const pcm = require('../lib/perfCloseMail');
const N2 = ws.weekPlan(2026, 11)[1], N1 = ws.weekPlan(2026, 11)[0], P = ws.weekPlan(2026, 11);
// 진행: 완료 → 취소 → 다시 완료 / 취소만
const PR = [[2026, 11, 2, '서부', '입력 완료', '', 'a@nkmro.com', '2026-11-16 10:00', ''], [2026, 11, 2, '서부', '완료 취소', '', 'a@nkmro.com', '2026-11-16 10:30', ''],
  [2026, 11, 2, '동부', '입력 완료', '', 'b@nkmro.com', '2026-11-16 11:00', ''], [2026, 11, 2, '동부', '완료 취소', '', 'b@nkmro.com', '2026-11-16 11:10', ''], [2026, 11, 2, '동부', '입력 완료', '', 'b@nkmro.com', '2026-11-16 11:20', ''],
  [2026, 11, 2, '전사', '결과 메일', '', '자동', '2026-11-16 12:02', '3통']];
let dm = ws.teamDoneMap(PR, 2026, 11, '2');
t('D1 완료 뒤 취소 = 미완료, 다시 완료 = 완료(마지막 시각)', !dm['서부'] && dm['동부'] && dm['동부'].at === '2026-11-16 11:20' && !dm['전사']);
t('D2 조회 화면도 취소 반영', view(W, PR).teams[0].status === 'ing' && view(W, PR).teams[1].status === 'done');
t('D3 4팀 판단 = 실적-고객사 사용 중 팀(서부·동부·중부)', ws.teamsOf(C).join() === '서부,동부,중부' && !ws.allDoneOf(C, PR, 2026, 11, N2).all);
const ALL = [[2026, 11, 2, '서부', '입력 완료', '', 'a@nkmro.com', 't', ''], [2026, 11, 2, '동부', '입력 완료', '', 'b@nkmro.com', 't', ''], [2026, 11, 2, '중부', '입력 완료', '', 'a@nkmro.com', 't', '']];
t('D4 3팀 모두 완료 = all', ws.allDoneOf(C, ALL, 2026, 11, N2).all === true && ws.allDoneOf(C, ALL, 2026, 11, N1).all === false);

// 입력 탭
const WK = [[2026, 11, 1, '동부', '한빛정밀', 90000, 5000, ''], [2026, 11, 2, '동부', '한빛정밀', 200000, 13000, '메모', 'b@nkmro.com', '2026-11-16 13:48']];
function iv(o) { return ws.inputView(Object.assign({ year: 2026, month: 11, entry: N2, plan: P, team: '동부', customers: C, weeklyRows: WK, progressRows: [], names: { 'a@nkmro.com': '관리자', 'b@nkmro.com': '팀장B' }, adminEmail: 'a@nkmro.com', adminTeam: '동부', isAdmin: false, isCurrent: true }, o)); }
let v2 = iv({});
t('I1 동부 사용 중 고객사 3곳(거래끝 제외)·지난 주차 1주차', v2.rows.map(function (r) { return r.name; }).join() === '한빛정밀,대성금속,푸른환경' && v2.prevLabel === '1주차');
t('I2 지난 주차 누적·이번 값·비고', v2.rows[0].prevSales === 90000 && v2.rows[0].sales === 200000 && v2.rows[0].note === '메모' && v2.rows[1].prevSales === null && v2.rows[1].sales === null);
t('I3 저장 1곳·마지막 저장자', v2.savedCount === 1 && v2.lastSavedBy === '팀장B' && v2.lastSavedAt === '2026-11-16 13:48');
t('I4 지금 주차·미완료 → 입력 가능', v2.canEdit && v2.canComplete && !v2.canReopen && v2.lockedReason === '');
t('I5 지난 주차·팀장 → 잠김(PAST_WEEK)', !iv({ isCurrent: false }).canEdit && iv({ isCurrent: false }).lockedReason === 'PAST_WEEK');
t('I6 지난 주차·관리자 → 입력 가능', iv({ isCurrent: false, isAdmin: true }).canEdit);
const D동 = [[2026, 11, 2, '동부', '입력 완료', '', 'b@nkmro.com', '2026-11-16 14:05', '']];
v2 = iv({ progressRows: D동 });
t('I7 완료 → 잠김 + 팀장 취소 가능(4팀 완료 전)', !v2.canEdit && v2.canReopen && v2.done.byName === '팀장B' && v2.lockedReason === 'DONE' && !v2.allDone);
v2 = iv({ progressRows: ALL });
t('I8 4팀 완료 → 팀장 취소 불가, 관리자만', !v2.canReopen && v2.allDone && iv({ progressRows: ALL, isAdmin: true }).canReopen);
v2 = iv({ team: '서부', progressRows: [[2026, 11, 2, '서부', '입력 완료', '', 'a@nkmro.com', 't', '']] });
t('I9 관리자가 남의 팀 완료 → 관리자 대리', v2.done.proxy === true && iv({ progressRows: [[2026, 11, 2, '동부', '입력 완료', '', 'a@nkmro.com', 't', '']] }).done.proxy === false);
t('I10 1주차는 지난 주차 없음', iv({ entry: N1 }).prevLabel === null && iv({ entry: N1 }).rows[0].prevSales === null);

// 저장 계획 (덮어쓰기 / 새 줄 / 빈칸)
const WR = [[2026, 11, 2, '동부', '한빛정밀', 1, 1, '', 'x', 't'], [], [2026, 11, 2, '서부', '청솔제지', 5, 5, '', 'x', 't']];
let pw = ws.planWeekWrite({ weeklyRows: WR, customers: C, year: 2026, month: 11, entry: N2, team: '동부지역팀', who: 'B@NKMRO.COM', nowMs: Date.parse('2026-11-16T13:48:00+09:00'),
  entries: [{ name: '한빛정밀', sales: '211,300', profit: '12400', note: '' }, { name: '대성금속', sales: '-500', profit: '', note: '반품' }, { name: '푸른환경', sales: '', profit: '', note: '' }] });
t('W1 같은 키 = 그 줄 덮어쓰기(2행)', pw.ok && pw.writes[0].row === 2 && pw.writes[0].values.join('|') === '2026|11|2|동부|한빛정밀|211300|12400||b@nkmro.com|2026-11-16 13:48');
t('W2 새 줄 = 값 있는 마지막 줄+1(5행, 중간 빈 줄 재사용 안 함)', pw.writes[1].row === 5 && pw.writes[1].isNew && pw.writes[1].values[5] === -500 && pw.writes[1].values[6] === '');
t('W3 처음부터 빈칸인 고객사는 줄을 만들지 않음', pw.writes.length === 2);
pw = ws.planWeekWrite({ weeklyRows: WR, customers: C, year: 2026, month: 11, entry: N2, team: '동부', who: 'b', nowMs: 0, entries: [{ name: '한빛정밀', sales: '', profit: '', note: '' }] });
t('W4 있던 줄을 빈칸으로 저장하면 그 줄 숫자를 비움(행 삭제 없음)', pw.writes.length === 1 && pw.writes[0].row === 2 && pw.writes[0].values[5] === '' && pw.writes[0].values[6] === '');
const bad = function (e) { return ws.planWeekWrite({ weeklyRows: [], customers: C, year: 2026, month: 11, entry: N2, team: '동부', who: 'b', nowMs: 0, entries: e }).error; };
t('W5 잘못된 값 거절', bad([{ name: '한빛정밀', sales: '1.5' }]) === 'BAD_NUMBER' && bad([{ name: '한빛정밀', sales: '12a' }]) === 'BAD_NUMBER' && bad([{ name: '청솔제지', sales: '1' }]) === 'UNKNOWN_CUSTOMER'
  && bad([{ name: '거래끝', sales: '1' }]) === 'UNKNOWN_CUSTOMER' && bad([{ name: '한빛정밀' }, { name: '한빛정밀' }]) === 'DUPLICATE_CUSTOMER' && bad([{ name: '한빛정밀', note: 'x'.repeat(201) }]) === 'NOTE_TOO_LONG');
pw = ws.planWeekWrite({ weeklyRows: [], customers: C, year: 2026, month: 11, entry: ws.weekPlan(2026, 11)[3], team: '동부', who: 'b', nowMs: 0, entries: [{ name: '한빛정밀', sales: '1' }] });
t('W6 가마감은 주차 칸 "가마감", 빈 시트는 2행부터', pw.writes[0].values[2] === '가마감' && pw.writes[0].row === 2);
t('W7 숫자 읽기', ws.checkNum(' 1,234 ') === 1234 && ws.checkNum('') === null && ws.checkNum(null) === null && Number.isNaN(ws.checkNum('1e3')) && Number.isNaN(ws.checkNum('1000000000000')));

// 진행 이력 · 고객사 추가
const pp = ws.planProgress({ progressRows: [[2026, 11, 1, '동부', '입력 완료']], year: 2026, month: 11, entry: N2, team: '동부', stage: '입력 완료', who: 'B@x', nowMs: Date.parse('2026-11-16T14:05:00+09:00'), mail: '' });
t('G1 진행 줄 덧붙이기(3행)', pp.row === 3 && pp.values.join('|') === '2026|11|2|동부|입력 완료||b@x|2026-11-16 14:05|');
let pa = ws.planAddCustomer({ customers: C, team: '동부지역팀', name: '새빛산업(주)', series: '미계열', orderType: '오프라인', office: '창원', note: '신규', who: 'b@x', nowMs: Date.parse('2026-11-16T15:00:00+09:00') });
t('A1 고객사 추가: 다음 줄·순서 최대+1·사용 TRUE·적용월(달 없으면 빈칸)', pa.ok && pa.row === 8 && pa.values.join('|') === '동부|미계열|새빛산업(주)|오프라인|창원||true|7|신규|b@x|2026-11-16 15:00|');
t('A2 같은 팀 같은 이름(사용 끔 포함) 거절, 다른 팀은 허용', ws.planAddCustomer({ customers: C, team: '동부', name: '거래끝' }).error === 'DUPLICATE_CUSTOMER' && ws.planAddCustomer({ customers: C, team: '서부', name: '한빛정밀' }).ok);
t('A3 이름 비었거나 61자 거절', ws.planAddCustomer({ customers: C, team: '동부', name: '' }).error === 'BAD_NAME' && ws.planAddCustomer({ customers: C, team: '동부', name: 'x'.repeat(61) }).error === 'BAD_NAME');

// 16시 알림 대상
const U = [['a@nkmro.com', '관리자', '팀장', '동부', '활성'], ['b@nkmro.com', '서부장', '팀장', '서부', '활성'], ['c@nkmro.com', '임원1', '임원', '본사', '활성'],
  ['d@gmail.com', '임원2', '임원', '본사', '활성'], ['e@nkmro.com', '퇴사', '팀장', '중부', '비활성'], ['f@nkmro.com', '담당', '담당', '동부', '활성']];
function rj(at, prog, set) { return ws.reminderJobs({ nowMs: Date.parse(at + '+09:00'), settings: set || ws.readSettings([]), customers: C, progressRows: prog || [], weeklyRows: WK, users: U, adminEmail: 'a@nkmro.com' }); }
t('M1 입력일 15:59 → 없음', rj('2026-11-16T15:59:00').length === 0);
let jobs = rj('2026-11-16T16:02:00', D동);
t('M2 입력일 16:02 → 미완료 팀(서부·중부)만, 동부 완료 제외', jobs.map(function (j) { return j.team; }).join() === '서부,중부');
t('M3 서부 = 그 팀 팀장, 중부(팀장 비활성) = 관리자 대리', jobs[0].recipients.map(function (r) { return r.email; }).join() === 'b@nkmro.com' && !jobs[0].proxy && jobs[1].proxy && jobs[1].recipients[0].email === 'a@nkmro.com');
t('M4 키 = remind_연_월_주차_팀(하루 1번 판단)', jobs[0].key === 'remind_2026_11_2_서부');
t('M5 입력일 아닌 날(화) → 없음', rj('2026-11-17T16:02:00').length === 0);
t('M6 메일사용 FALSE → 없음', rj('2026-11-16T16:02:00', [], ws.readSettings([['메일사용', 'FALSE']])).length === 0);
t('M7 시트 팀장마감시각 15 → 15시부터', rj('2026-11-16T15:02:00', [], ws.readSettings([['팀장마감시각', 15]])).length === 3);
t('M8 모두 완료면 알림 없음', rj('2026-11-16T16:02:00', ALL).length === 0);
const RR = ws.resultRecipients(U);
t('R1 결과 메일 = 활성 임원·팀장 @nkmro.com (gmail·비활성·담당 제외)', RR.map(function (r) { return r.email; }).join() === 'a@nkmro.com,b@nkmro.com,c@nkmro.com');

// 메일 본문 (승인 원문과 같은 줄)
const txt = pcm.buildText(ws.reminderParts(jobs[0], RR[1], pcm.APP_URL));
t('B1 알림 제목·본문', ws.reminderParts(jobs[0], RR[1], pcm.APP_URL).subject === '[MRO 워크허브] 11월 2주차 주간 실적 입력 마감 알림 (서부팀)'
  && txt.indexOf('서부장 팀장님,') === 0 && txt.indexOf('11월 2주차 주간 실적(11/1~11/15 누적)이 아직 [입력 완료]되지 않았어요.') > 0 && txt.indexOf('· 마감: 11/16(월) 16:00') > 0
  && txt.indexOf('· 지금 상태: 고객사 1곳 중 0곳 저장됨, 입력 완료 전') > 0 && txt.indexOf('feed.html?view=weekly') > 0);
t('B2 대리 알림 문구', pcm.buildText(ws.reminderParts(jobs[1], RR[0], pcm.APP_URL)).indexOf('팀장 계정이 아직 없어 관리자에게 보냈어요') > 0);
const vAll = view(W, ALL);
const rp = ws.resultParts({ year: 2026, month: 11, entry: N2 }, vAll, RR[2], pcm.APP_URL), rt = pcm.buildText(rp);
t('B3 결과 메일(시안 C-1) 제목·글 버전: 숫자 없이 주차 진행·팀 완료만', rp.subject === '[MRO 워크허브] 11월 2주차 주간 실적이 도착했어요 (3팀 완료)' && rt.indexOf('· 2주차 ✓ ~11/15 (이번 보고)') > 0 && rt.indexOf('400,000') < 0 && rt.indexOf('%') < 0);
t('B4 HTML도 만들어짐(버튼 주소)', pcm.buildHtml(rp).indexOf('feed.html?view=weekly') > 0);

// 팀 고르기 (확인 3)
const T4 = ['서부', '동부', '중부', '영업지원'], meA = { email: 'a', role: '팀장', team: '동부', active: true }, meB = { email: 'b', role: '팀장', team: '서부지역팀', active: true };
t('L1 관리자: 고른 팀 그대로', ws.leadTeam(meA, true, '중부', T4).team === '중부' && ws.leadTeam(meA, true, '서부지역팀', T4).team === '서부');
t('L2 관리자: 없는 팀을 보내면 BAD_TEAM(첫 팀으로 바꾸지 않음)', ws.leadTeam(meA, true, '남부', T4).error === 'BAD_TEAM');
t('L3 관리자: 안 고르면 자기 팀', ws.leadTeam(meA, true, '', T4).team === '동부');
t('L4 팀장: 자기 팀만, 다른 팀 FORBIDDEN_TEAM', ws.leadTeam(meB, false, '', T4).team === '서부' && ws.leadTeam(meB, false, '동부', T4).error === 'FORBIDDEN_TEAM');
t('L5 팀장 아님·비활성 → FORBIDDEN', ws.leadTeam({ role: '담당', team: '동부', active: true }, false, '', T4).error === 'FORBIDDEN' && ws.leadTeam({ role: '팀장', team: '동부', active: false }, false, '', T4).error === 'FORBIDDEN');

// 3단계 (2026-11-17 재홍님 확정 ①~⑨, 가상의 이름·값)
const C3 = [['동부', '', '한빛정밀', '', '창원', '김도윤', true, 1, ''], ['동부', '', '대성금속', '', '달성', '이서연', true, 2, ''], ['동부', '', '미래케미칼', '', '포항', '박지훈', true, 3, ''],
  ['동부', '', '푸른환경', '', '포항', '', true, 4, ''], ['동부', '', '동해플랜트', '', '포항', '퇴사자', true, 5, ''], ['서부', '', '청솔제지', '', '부산', '', true, 1, '']];
const U3 = [['a@nkmro.com', '관리자', '팀장', '동부', '활성'], ['k@nkmro.com', '김도윤', '담당', '동부', '활성'], ['l@nkmro.com', '이서연', '담당', '동부', '활성'],
  ['m@gmail.com', '박지훈', '담당', '동부', '활성'], ['q@nkmro.com', '퇴사자', '담당', '동부', '비활성'], ['w@nkmro.com', '서부장', '팀장', '서부', '활성']];
const MU = ws.managerUsersOf(U3, '동부지역팀');
t('T1 활성 담당만(비활성 퇴사자 빠짐)', MU.map(function (u) { return u.name; }).join() === '김도윤,이서연,박지훈');
const P3 = [[2026, 11, 2, '동부', '입력 완료', '김도윤', 'k@nkmro.com', '2026-11-16 13:52', ''], [2026, 11, 2, '동부', '입력 완료', '이서연', 'l@nkmro.com', '2026-11-16 14:20', ''],
  [2026, 11, 2, '동부', '완료 취소', '이서연', 'l@nkmro.com', '2026-11-16 14:30', ''], [2026, 11, 2, '동부', '입력 완료', '이서연', 'l@nkmro.com', '2026-11-16 14:40', '']];
t('T2 담당 줄(F열 있음)은 팀 완료가 아님', !ws.teamDoneMap(P3, 2026, 11, '2')['동부']);
const md3 = ws.managerDoneMap(P3, 2026, 11, '2', '동부');
t('T3 담당별 완료: 완료→취소→다시 완료 = 마지막 시각', md3['김도윤'].at === '2026-11-16 13:52' && md3['이서연'].at === '2026-11-16 14:40' && !md3['박지훈']);
t('T4 담당 고객사 수(활성 담당만, 빈칸·퇴사자 줄 제외)', JSON.stringify(ws.managerCounts(C3, '동부', 11, ['김도윤', '이서연', '박지훈'])) === '{"김도윤":1,"이서연":1,"박지훈":1}');
// ⑨ 방식은 다음 보고 주차부터
const S3 = ws.readSettings([['입력방식_동부', '3단계']]), N3 = P[2];
const LOGa = [[2026, 11, 2, '동부', '입력방식 2단계→3단계', '', 'a@nkmro.com', '2026-11-17 10:00', '']];
t('T5 기록 없음 = 시트 값 그대로', ws.modeAt(S3, [], '동부', N2) === '3단계' && ws.modeAt(ws.readSettings([]), [], '동부', N2) === '2단계');
t('T6 11/17(화)에 바꿈 → 2주차(11/16 입력)는 2단계, 3주차(11/23)부터 3단계', ws.modeAt(S3, LOGa, '동부', N2) === '2단계' && ws.modeAt(S3, LOGa, '동부', N3) === '3단계');
const LOGb = LOGa.concat([[2026, 11, 2, '동부', '입력방식 3단계→2단계', '', 'a@nkmro.com', '2026-11-18 09:00', '']]);
t('T7 바꿨다 되돌림 → 그 주차는 처음 값, 다음 주차는 마지막 값', ws.modeAt(ws.readSettings([]), LOGb, '동부', N2) === '2단계' && ws.modeAt(ws.readSettings([]), LOGb, '동부', N3) === '2단계'
  && ws.modeAt(S3, LOGa, '서부', N2) === '2단계');
const SR = [['입력요일', '월', ''], ['입력방식_동부', '2단계', '설명']];
let sm = ws.planSetMode({ settingRows: SR, settings: ws.readSettings(SR), team: '동부지역팀', mode: '3단계' });
t('T8 방식 바꾸기: 있는 줄은 B칸만, 진행 기록 문구', sm.ok && sm.write.range === 'B3' && sm.write.values.join() === '3단계' && sm.stage === '입력방식 2단계→3단계');
sm = ws.planSetMode({ settingRows: SR.slice(0, 1), settings: ws.readSettings([]), team: '동부', mode: '3단계' });
t('T9 줄이 없으면 새 줄 A~C', sm.ok && sm.write.range === 'A3:C3' && sm.write.values[0] === '입력방식_동부' && sm.write.values[1] === '3단계');
t('T10 같은 값·잘못된 값 거절', ws.planSetMode({ settingRows: SR, settings: ws.readSettings(SR), team: '동부', mode: '2단계' }).error === 'NO_CHANGES' && ws.planSetMode({ settingRows: SR, settings: ws.readSettings(SR), team: '동부', mode: '4단계' }).error === 'BAD_MODE');
// 입력 탭 (팀장 / 담당)
const WK3 = [[2026, 11, 2, '동부', '한빛정밀', 215000, 12400, '', 'a@nkmro.com', '2026-11-16 14:50', 211300, 12400], [2026, 11, 2, '동부', '대성금속', 176200, 9800, '', 'l@nkmro.com', '2026-11-16 14:19']];
function iv3(o) { return iv(Object.assign({ customers: C3, weeklyRows: WK3, progressRows: P3, mode: '3단계', nextMode: '3단계', managerUsers: MU, names: { 'a@nkmro.com': '관리자', 'k@nkmro.com': '김도윤', 'l@nkmro.com': '이서연' } }, o)); }
let x3 = iv3({});
t('T11 팀장: 모든 줄 + 담당·상태(빈칸·퇴사자 = 팀장 입력 줄 2곳)', x3.role === 'lead' && x3.rows.length === 5 && x3.rows[0].manager === '김도윤' && x3.rows[3].manager === '' && x3.rows[4].manager === '' && x3.rows[4].managerRaw === '퇴사자' && x3.leadRows === 2);
t('T12 담당 현황: 2/3 완료 → [팀 확정] 꺼짐, 대신 완료 가능', x3.managers.map(function (g) { return g.name + (g.done ? '✓' : '·') + g.saved + '/' + g.total; }).join() === '김도윤✓1/1,이서연✓1/1,박지훈·0/1' && !x3.managersAllDone && !x3.canComplete && x3.canProxy && x3.canEdit);
t('T13 팀장이 고친 줄 = 담당 원래 값 표시(같으면 안 보임)', x3.rows[0].orig.sales === 211300 && x3.rows[1].orig === null);
x3 = iv3({ progressRows: P3.concat([[2026, 11, 2, '동부', '입력 완료', '박지훈', 'a@nkmro.com', '2026-11-16 15:30', '']]) });
t('T14 팀장이 대신 완료 → 모두 완료, [팀 확정] 켜짐, 대신 표시', x3.managersAllDone && x3.canComplete && x3.managers[2].done.proxy === true && x3.managers[0].done.proxy === false);
x3 = iv3({ meManager: '이서연', progressRows: [] });
t('T15 담당: 자기 고객사만·입력 가능', x3.role === 'manager' && x3.rows.map(function (r) { return r.name; }).join() === '대성금속' && x3.canEdit && x3.canComplete && !x3.canReopen && x3.savedCount === 1 && x3.lastSavedBy === '이서연');
x3 = iv3({ meManager: '이서연' });
t('T16 담당 완료 뒤: 잠김(MY_DONE)·[완료 취소] 가능', !x3.canEdit && x3.canReopen && x3.lockedReason === 'MY_DONE' && x3.myDone.at === '2026-11-16 14:40');
x3 = iv3({ meManager: '이서연', progressRows: P3.concat([[2026, 11, 2, '동부', '팀 확정', '', 'a@nkmro.com', '2026-11-16 15:40', '']]) });
t('T17 팀 확정 뒤: 담당 취소 불가(DONE), 지난 주차도 잠김', !x3.canEdit && !x3.canReopen && x3.lockedReason === 'DONE' && iv3({ meManager: '이서연', progressRows: [], isCurrent: false }).lockedReason === 'PAST_WEEK');
t('T18 2단계는 예전 화면 그대로(담당 칸 없음)', iv({}).mode === '2단계' && iv({}).managers === undefined && iv({}).rows[0].manager === undefined);
// 저장 (3단계)
const sv3 = function (o) { return ws.planWeekWrite(Object.assign({ weeklyRows: WK3, customers: C3, year: 2026, month: 11, entry: N2, team: '동부', who: 'l@nkmro.com', nowMs: Date.parse('2026-11-16T14:00:00+09:00'), mode: '3단계', managerEmails: { 'k@nkmro.com': true, 'l@nkmro.com': true, 'm@gmail.com': true } }, o)); };
t('T19 담당: 남의 고객사 저장 거절', sv3({ onlyManager: '이서연', entries: [{ name: '한빛정밀', sales: '1' }] }).error === 'NOT_MY_CUSTOMER');
let w3 = sv3({ onlyManager: '이서연', entries: [{ name: '대성금속', sales: '176,200', profit: '9800', note: '' }] });
t('T20 값이 그대로면 쓰지 않음(입력자 유지)', w3.ok && w3.writes.length === 0);
w3 = sv3({ onlyManager: '이서연', entries: [{ name: '대성금속', sales: '180000', profit: '9800', note: '' }] });
t('T21 담당 저장 = A~L 12칸, K·L 비움', w3.writes[0].row === 3 && w3.writes[0].values.length === 12 && w3.writes[0].values[10] === '' && w3.writes[0].values[11] === '');
w3 = sv3({ who: 'a@nkmro.com', entries: [{ name: '대성금속', sales: '170000', profit: '9800', note: '' }] });
t('T22 팀장이 담당 값을 처음 고침 → K·L = 담당 원래 값', w3.writes[0].values.slice(5, 7).join() === '170000,9800' && w3.writes[0].values[10] === 176200 && w3.writes[0].values[11] === 9800 && w3.writes[0].values[8] === 'a@nkmro.com');
w3 = sv3({ who: 'a@nkmro.com', entries: [{ name: '한빛정밀', sales: '216000', profit: '12400', note: '' }] });
t('T23 이미 K·L이 있으면 그대로 둠', w3.writes[0].values[10] === 211300 && w3.writes[0].values[11] === 12400);
w3 = sv3({ who: 'a@nkmro.com', entries: [{ name: '푸른환경', sales: '12800', profit: '900', note: '' }] });
t('T24 팀장 입력 줄(담당 없음) 새 줄 → K·L 빈칸', w3.writes[0].isNew && w3.writes[0].row === 4 && w3.writes[0].values[10] === '' && w3.writes[0].values.length === 12);
t('T25 2단계 저장은 예전처럼 A~J 10칸', ws.planWeekWrite({ weeklyRows: [], customers: C3, year: 2026, month: 11, entry: N2, team: '동부', who: 'a', nowMs: 0, entries: [{ name: '한빛정밀', sales: '1' }] }).writes[0].values.length === 10);
const pp3 = ws.planProgress({ progressRows: [], year: 2026, month: 11, entry: N2, team: '동부', stage: '입력 완료', manager: '박지훈', who: 'a@nkmro.com', nowMs: 0, mail: '' });
t('T26 담당 한 사람 기록 = F열에 이름', pp3.values[5] === '박지훈' && pp3.values[4] === '입력 완료');
// 메일 (⑦)
const CC3 = C3.concat([['중부', '', '다온소재', '', '진천', '', true, 1, '']]);
function sj(at, prog, set) { return ws.stage3Jobs({ nowMs: Date.parse(at + '+09:00'), settings: set || S3, customers: CC3, progressRows: prog || [], weeklyRows: WK3, users: U3, adminEmail: 'a@nkmro.com' }); }
t('T27 담당마감시각 전(14:02) → 없음', sj('2026-11-16T14:02:00', P3).length === 0);
let j3 = sj('2026-11-16T15:02:00', P3);
t('T28 15:02 → 미완료 담당 본인(@nkmro.com만 — gmail 박지훈은 빠짐)', j3.length === 0);
j3 = sj('2026-11-16T15:02:00', []);
t('T29 15:02 아무도 완료 안 함 → 김도윤·이서연 각각, 키·고객사 수', j3.map(function (j) { return j.kind + ':' + j.recipients[0].name + ':' + j.savedCount + '/' + j.total; }).join() === 'mremind:김도윤:1/1,mremind:이서연:1/1' && j3[0].key === 'mremind_2026_11_2_동부_김도윤');
const P3all = P3.concat([[2026, 11, 2, '동부', '입력 완료', '박지훈', 'm@gmail.com', '2026-11-16 14:41', '']]);
j3 = sj('2026-11-16T14:02:00', P3all);
t('T30 담당 모두 완료 → 팀장 확정 요청(마감 전이라도 다음 정시)', j3.length === 1 && j3[0].kind === 'confirm' && j3[0].recipients[0].email === 'a@nkmro.com' && j3[0].done.map(function (d) { return d.name; }).join() === '김도윤,이서연,박지훈');
t('T31 팀 확정 뒤·2단계 팀·입력일 아님·메일사용 FALSE → 없음', sj('2026-11-16T15:02:00', P3all.concat([[2026, 11, 2, '동부', '팀 확정', '', 'a@nkmro.com', 't', '']])).length === 0
  && sj('2026-11-16T15:02:00', [], ws.readSettings([])).length === 0 && sj('2026-11-17T15:02:00', []).length === 0 && sj('2026-11-16T15:02:00', [], ws.readSettings([['입력방식_동부', '3단계'], ['메일사용', 'FALSE']])).length === 0);
const mrp = ws.managerRemindParts(sj('2026-11-16T15:02:00', [])[0], { email: 'k@nkmro.com', name: '김도윤' }, pcm.APP_URL), mrt = pcm.buildText(mrp);
t('T32 시안 C 담당 알림 글', mrt.indexOf('김도윤님,') === 0 && mrt.indexOf('11월 2주차 주간 실적(11/1~11/15 누적)이 아직 [입력 완료]되지 않았어요.') > 0 && mrt.indexOf('· 마감: 11/16(월) 15:00 (담당)') > 0 && mrt.indexOf('· 지금 상태: 담당 고객사 1곳 중 1곳 저장됨, 입력 완료 전') > 0);
const cfp = ws.confirmParts(sj('2026-11-16T14:02:00', P3all)[0], { email: 'a@nkmro.com', name: '주팀장' }, pcm.APP_URL), cft = pcm.buildText(cfp);
t('T33 시안 D 확정 요청 글(숫자 없음)', cfp.subject === '[MRO 워크허브] 11월 2주차 주간 실적 팀 확정 요청 (동부팀 담당 3명 완료)' && cft.indexOf('주팀장 팀장님,') === 0 && cft.indexOf('동부팀 담당 3명이 모두 11월 2주차 주간 실적을 [입력 완료]했어요.') > 0
  && cft.indexOf('· 팀장 마감: 11/16(월) 16:00') > 0 && cft.indexOf('· 박지훈 11/16 14:41') > 0 && pcm.buildHtml(cfp).indexOf('담당 입력 완료') > 0 && cfp.button === '팀 확정하러 가기');
const rj3 = ws.reminderJobs({ nowMs: Date.parse('2026-11-16T16:02:00+09:00'), settings: S3, customers: CC3, progressRows: P3, weeklyRows: WK3, users: U3, adminEmail: 'a@nkmro.com' });
const rt3 = pcm.buildText(ws.reminderParts(rj3.find(function (j) { return j.team === '동부'; }), { email: 'a@nkmro.com', name: '주팀장' }, pcm.APP_URL));
t('T34 16시 팀장 알림: 3단계 팀은 [팀 확정] 문구, 2단계 팀은 예전 그대로', rt3.indexOf('아직 [팀 확정]되지 않았어요.') > 0 && rt3.indexOf('팀 확정 전') > 0 && rj3.find(function (j) { return j.team === '서부'; }).mode === '2단계');

// 잠금 동시성 (lib/writeLock + 가짜 Firestore)
const { FakeFirestore } = require('./logintest-parity/fake_firestore');
const { acquireLock, releaseLock } = require('../lib/writeLock');
const fs2 = new FakeFirestore();
const o = { waitMs: 300, staleMs: 60000, pollMs: 50 };
const a1 = await acquireLock(fs2, 'weeklySales', 'h1', o), a2 = await acquireLock(fs2, 'weeklySales', 'h2', o), p1 = await acquireLock(fs2, 'performanceEval', 'h3', o);
await releaseLock(fs2, 'weeklySales', 'h1'); const a3 = await acquireLock(fs2, 'weeklySales', 'h2', o);
t('K1 같은 잠금은 동시에 1명, 성과평가 잠금과는 별개, 풀면 다음 사람', a1 === true && a2 === false && p1 === true && a3 === true);

// 화면: [저장]·[입력 완료]·[추가] 때 입력칸 값을 다시 그리기 전에 읽는지 (11/17 운영 시험에서 숫자가 사라진 문제)
const uiHtml = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
function uiGrab(name) {
  const i = uiHtml.indexOf('async function ' + name + '(') >= 0 ? uiHtml.indexOf('async function ' + name + '(') : uiHtml.indexOf('function ' + name + '(');
  let d = 0; const j = uiHtml.indexOf('{', i);
  for (let k = j; k < uiHtml.length; k++) { if (uiHtml[k] === '{') d++; else if (uiHtml[k] === '}') { d--; if (d === 0) return uiHtml.slice(i, k + 1); } }
}
async function uiRun(call) {
  const els = { 'wi-s-0': { value: '1,234' }, 'wi-p-0': { value: '56' }, 'wi-n-0': { value: '메모' }, 'wa-name': { value: '새고객' } };
  const posts = [];
  const ctx = {
    document: { getElementById: function (id) { return els[id] || null; } },
    wkIn_: { rows: [{ name: '가나산업' }], year: 2026, month: 11, week: 2, team: '서부' },
    wkBusy_: false, wkInMsg_: '', wkAddOpen_: true,
    wkRenderInput_: function () { Object.keys(els).forEach(function (k) { if (k.indexOf('wi-') === 0) els[k].value = ''; }); }, // 다시 그리기 = 서버 값(빈칸)으로 덮임
    wkPost_: async function (b) { posts.push(b); return { ok: true }; },
    wkErr_: function () { return ''; }, loadWeeklyPage: async function () {}
  };
  require('vm').createContext(ctx);
  require('vm').runInContext(['wkInEntries_', 'wkInBase_', 'wkAfter_', 'wkInSave_', 'wkInAdd_'].map(uiGrab).join('\n'), ctx);
  await require('vm').runInContext(call, ctx);
  return posts;
}
let up = await uiRun('wkInSave_(false)');
t('Q1 [저장] 넣은 숫자 그대로 보냄', up[0].action === 'save' && up[0].entries[0].sales === '1,234' && up[0].entries[0].profit === '56' && up[0].entries[0].note === '메모');
up = await uiRun('wkInSave_(true)');
t('Q2 [입력 완료] 저장 먼저, 숫자 그대로', up[0].action === 'save' && up[0].entries[0].sales === '1,234' && up[1].action === 'complete');
up = await uiRun('wkInAdd_()');
t('Q3 [고객사 추가] 전 저장에 숫자 그대로', up[0].action === 'save' && up[0].entries[0].sales === '1,234' && up[1].action === 'addCustomer');

// 고객사 정보 고치기 + 이력(적용월) (2026-11-17 재홍님 확정) — 가상의 값만
const CEC = [ // A 팀, B 계열, C 구매사명, D 발주형태, E 사무소, F 담당, G 사용, H 순서, I 비고, J 등록자, K 등록일시, L 적용월
  ['동부', '미계열', '가나정밀(주)', '오프라인', '창원', '김담당', true, 1, '', 'x', 'y'],
  ['동부', '다라그룹', '다라금속(주)', '온라인', '포항', '', true, 2, '', 'x', 'y'],
  ['서부', '미계열', '마바화학', '오프라인', '군산', '', true, 1, '', 'x', 'y'],
  ['동부', '미계열', '사아플랜트(주)', '오프라인', '울산', '', false, 3, '거래 종료', 'x', 'y'],
  ['동부', '미계열', '가나정밀(주)', '온라인', '달성', '이담당', true, 9, '', 'x', 'y', 11],   // 6행: 11월부터 바뀐 정보(순서 9는 무시 — 첫 줄 1)
  ['동부', '미계열', '자차신규(주)', '오프라인', '양산', '', true, 4, '', 'x', 'y', 11]           // 7행: 11월에 새로 추가된 고객사
];
const CEU = [
  ['a@nkmro.com', '김담당', '담당', '동부', '활성'], ['b@nkmro.com', '이담당', '담당', '동부지역팀', '활성'], ['c@nkmro.com', '박담당', '담당', '동부', '비활성'],
  ['d@nkmro.com', '최담당', '담당', '서부', '활성'], ['e@nkmro.com', '정팀장', '팀장', '동부', '활성']
];
const CEW = [[2026, 11, 2, '동부', '가나정밀(주)', 100, 10, '', 'a', 't']];
const CEM = ws.managersOf(CEU, '동부');
t('E1 담당 목록 = 이 팀 활성 담당만(비활성·팀장·다른 팀 빼고)', JSON.stringify(CEM) === JSON.stringify(['김담당', '이담당']));
// 이력: 그 달 이하에서 가장 늦은 적용월 줄
const at10 = ws.customersAt(CEC, 10), at11 = ws.customersAt(CEC, 11);
const ga = function (rows) { return rows.find(function (r) { return r[2] === '가나정밀(주)'; }); };
t('H4 10월 = 원래 줄(창원·김담당), 11월 = 11월 줄(달성·이담당)', ga(at10)[4] === '창원' && ga(at10)[5] === '김담당' && ga(at11)[4] === '달성' && ga(at11)[5] === '이담당');
t('H5 순서는 첫 줄 값(11월 줄의 9가 아니라 1)', ga(at11)[7] === 1 && ga(at10)[7] === 1);
t('H6 11월에 추가된 고객사는 10월에 없음, 11월부터 있음', !at10.some(function (r) { return r[2] === '자차신규(주)'; }) && at11.some(function (r) { return r[2] === '자차신규(주)'; }));
t('H7 고객사마다 한 줄(가나정밀 2줄 → 1줄)', at11.filter(function (r) { return r[2] === '가나정밀(주)'; }).length === 1 && at11.length === 5);
t('H8 같은 적용월 줄이 둘이면 아래쪽', ws.customersAt(CEC.concat([['동부', '미계열', '가나정밀(주)', '온라인', '경주', '', true, 1, '', 'x', 'y', 11]]), 11).find(function (r) { return r[2] === '가나정밀(주)'; })[4] === '경주');
t('H9 실적-고객사 머리글 12칸(L = 적용월)', ws.HEADERS[ws.TAB_CUSTOMERS].length === 12 && ws.HEADERS[ws.TAB_CUSTOMERS][11] === '적용월' && ws.CUSTOMER_COLS === 12);
const ccx = ws.crossCheck(CEC, [], 2026);
t('H10 연결 점검: 이력 줄은 중복 아님, 같은 적용월 두 줄만 중복', ccx.duplicates.length === 0 && ws.crossCheck(CEC.concat([CEC[4].slice()]), [], 2026).duplicates[0] === '동부/가나정밀(주) (11월)');
// 사용 끄기는 적용월부터만
const OFF = CEC.concat([['동부', '다라그룹', '다라금속(주)', '온라인', '포항', '', false, 2, '', 'x', 'y', 11]]);
const WOFF = [[2026, 10, '가마감', '동부', '다라금속(주)', 500, 50, '', 'a', 't'], [2026, 11, 2, '동부', '다라금속(주)', 70, 7, '', 'a', 't']];
const octG = ws.weekPlan(2026, 10).slice(-1)[0];
const vOct = ws.buildReportView({ year: 2026, month: 10, entry: octG, plan: ws.weekPlan(2026, 10), today: '2026-11-17', nowEntry: nov2, settings: ws.readSettings([]), customers: OFF, planRows: [], weeklyRows: WOFF, progressRows: [], names: {}, adminEmail: '', adminTeam: '' });
const vNov = ws.buildReportView({ year: 2026, month: 11, entry: nov2, plan: ws.weekPlan(2026, 11), today: '2026-11-17', nowEntry: nov2, settings: ws.readSettings([]), customers: OFF, planRows: [], weeklyRows: WOFF, progressRows: [], names: {}, adminEmail: '', adminTeam: '' });
t('H11 11월에 사용 끈 고객사: 10월 합계에는 그대로, 11월부터 빠짐', vOct.rows.some(function (r) { return r.name === '다라금속(주)'; }) && !vNov.rows.some(function (r) { return r.name === '다라금속(주)'; }));
t('H12 지난달 화면은 그때 사무소(10월 창원 / 11월 달성)', vOct.rows.find(function (r) { return r.name === '가나정밀(주)'; }).office === '창원' && vNov.rows.find(function (r) { return r.name === '가나정밀(주)'; }).office === '달성');
const CEL = ws.customerEditList(CEC, '동부', CEW, 2026, 11);
t('E2 고치기 목록: 11월 기준 그 팀 전체, 사용 중 먼저(순서), 사용 끔은 뒤 + 이번 달 숫자 표시',
  CEL.map(function (c) { return c.name; }).join('|') === '가나정밀(주)|다라금속(주)|자차신규(주)|사아플랜트(주)' && CEL[3].active === false && CEL[0].monthHas === true && CEL[0].office === '달성');
const NOW = Date.parse('2026-11-17T17:20:00+09:00');
function ceUp(changes, extra) { return ws.planUpdateCustomers(Object.assign({ customers: CEC, team: '동부', month: 11, changes: changes, managers: CEM, weeklyRows: CEW, year: 2026, who: 'JH@nkmro.com', nowMs: NOW }, extra || {})); }
let ce = ceUp([{ name: '다라금속(주)', fields: { series: '새그룹', orderType: '오프라인', office: '경주', manager: '이담당', note: '메모', active: false } }]);
t('E3 이번 달 줄이 없으면 새 줄(8행 A:L): 바뀐 칸 6개 + 나머지 그대로 + 고친 사람·시각 + 적용월 11, 원래 줄(3행)은 안 건드림',
  ce.ok && ce.writes.length === 1 && ce.writes[0].range === 'A8:L8' && ce.rows === 1 &&
  ce.writes[0].values.join('|') === '동부|새그룹|다라금속(주)|오프라인|경주|이담당|false|2|메모|jh@nkmro.com|2026-11-17 17:20|11');
ce = ceUp([{ name: '가나정밀(주)', fields: { office: '마산', note: '메모' } }]);
t('E3b 이번 달 줄(6행)이 있으면 그 줄의 바뀐 칸 + 등록자·등록일시만 고침(새 줄 없음)',
  ce.ok && ce.writes.map(function (w) { return w.range + '=' + w.values.join('/'); }).join(',') === 'E6=마산,I6=메모,J6:K6=jh@nkmro.com/2026-11-17 17:20');
ce = ceUp([{ name: '가나정밀(주)', fields: { office: '달성', series: '미계열', active: true, manager: '이담당' } }]);
t('E4 지금(11월) 값과 같은 칸은 안 씀(0칸)', ce.ok && ce.writes.length === 0 && ce.rows === 0);
ce = ceUp([{ name: '가나정밀(주)', fields: { active: false } }]);
t('E5 이번 달 숫자 있는 고객사 사용 끄기 → 경고(쓰기는 함)', ce.ok && ce.writes[0].range === 'G6' && ce.writes[0].values[0] === false && ce.warnings[0] === '가나정밀(주)');
ce = ceUp([{ name: '다라금속(주)', fields: { active: false } }]);
t('E6 이번 달 숫자 없는 고객사 사용 끄기 → 경고 없음', ce.ok && ce.warnings.length === 0);
ce = ceUp([{ name: '사아플랜트(주)', fields: { active: true } }]);
t('E7 사용 끔 → 다시 켜기(11월 새 줄, 사용 true)', ce.ok && ce.writes[0].range === 'A8:L8' && ce.writes[0].values[6] === true && ce.writes[0].values[11] === 11);
t('E8 담당: 목록에 없는 이름 BAD_MANAGER · 다른 팀 담당도 거절 · 빈칸(없음)은 허용',
  ceUp([{ name: '다라금속(주)', fields: { manager: '홍길동' } }]).error === 'BAD_MANAGER' && ceUp([{ name: '다라금속(주)', fields: { manager: '최담당' } }]).error === 'BAD_MANAGER' &&
  ceUp([{ name: '가나정밀(주)', fields: { manager: '' } }]).writes[0].range === 'F6');
const CEC2 = CEC.map(function (r) { return r.slice(); }); CEC2[1][5] = '퇴사담당';
ce = ws.planUpdateCustomers({ customers: CEC2, team: '동부', month: 11, changes: [{ name: '다라금속(주)', fields: { manager: '퇴사담당', office: '경주' } }], managers: CEM, weeklyRows: CEW, year: 2026, who: 'a', nowMs: NOW });
t('E9 담당을 안 바꾸면(목록에 없는 기존 이름 그대로) 다른 칸은 저장됨', ce.ok && ce.writes[0].values[4] === '경주' && ce.writes[0].values[5] === '퇴사담당');
t('E10 구매사명·팀·순서 바꾸기 시도 → LOCKED_FIELD', ceUp([{ name: '가나정밀(주)', fields: { name: '새이름' } }]).error === 'LOCKED_FIELD' && ceUp([{ name: '가나정밀(주)', fields: { team: '서부' } }]).error === 'LOCKED_FIELD' &&
  ceUp([{ name: '가나정밀(주)', fields: { ord: '5' } }]).error === 'LOCKED_FIELD');
t('E11 모르는 칸 BAD_FIELD · 사용 값이 참/거짓 아님 BAD_FIELD', ceUp([{ name: '가나정밀(주)', fields: { 등록자: 'x' } }]).error === 'BAD_FIELD' && ceUp([{ name: '가나정밀(주)', fields: { active: 'FALSE' } }]).error === 'BAD_FIELD');
t('E12 이번 보고 달이 없으면(달 0) NO_REPORT_YET', ceUp([{ name: '가나정밀(주)', fields: { office: 'x' } }], { month: 0 }).error === 'NO_REPORT_YET');
t('E13 40자 넘는 사무소 FIELD_TOO_LONG · 200자 넘는 비고 NOTE_TOO_LONG', ceUp([{ name: '가나정밀(주)', fields: { office: 'a'.repeat(41) } }]).error === 'FIELD_TOO_LONG' && ceUp([{ name: '가나정밀(주)', fields: { note: 'a'.repeat(201) } }]).error === 'NOTE_TOO_LONG');
t('E14 다른 팀 고객사·없는 고객사 → UNKNOWN_CUSTOMER, 같은 이름 두 번 → DUPLICATE_CUSTOMER, 빈 요청 → NO_CHANGES',
  ceUp([{ name: '마바화학', fields: { office: 'x' } }]).error === 'UNKNOWN_CUSTOMER' && ceUp([{ name: '없는회사', fields: { office: 'x' } }]).error === 'UNKNOWN_CUSTOMER' &&
  ceUp([{ name: '가나정밀(주)', fields: { office: 'x' } }, { name: '가나정밀(주)', fields: { note: 'y' } }]).error === 'DUPLICATE_CUSTOMER' && ceUp([]).error === 'NO_CHANGES');
ce = ceUp([{ name: '다라금속(주)', fields: { office: '마산' } }, { name: '사아플랜트(주)', fields: { note: '메모' } }]);
t('E15 두 곳 새 줄 → 8행·9행 차례로, 곳 2', ce.ok && ce.writes.length === 2 && ce.writes[0].range === 'A8:L8' && ce.writes[1].range === 'A9:L9' && ce.rows === 2);
ce = ceUp([{ name: '자차신규(주)', fields: { office: '부산' } }], { month: 10 });
t('E15b 그 달에 아직 없는 고객사(11월 추가를 10월에) → UNKNOWN_CUSTOMER', ce.error === 'UNKNOWN_CUSTOMER');
t('E16 권한: 임원 → FORBIDDEN, 팀장 다른 팀 → FORBIDDEN_TEAM, 관리자 아무 팀', ws.leadTeam({ role: '임원', team: '본사', active: true }, false, '', T4).error === 'FORBIDDEN' &&
  ws.leadTeam({ role: '팀장', team: '동부', active: true }, false, '서부', T4).error === 'FORBIDDEN_TEAM' && ws.leadTeam(meA, true, '영업지원', T4).team === '영업지원');
const pa11 = ws.planAddCustomer({ customers: CEC, team: '동부', name: '새빛산업(주)', who: 'b@x', nowMs: NOW, month: 11 });
t('E16b 고객사 추가: 적용월 = 이번 보고 달(11), 순서 = 최대+1(이력 줄 포함 최대 9 → 10)', pa11.ok && pa11.values.length === 12 && pa11.values[11] === 11 && pa11.values[7] === 10);
// index.js 배선(정적): 잠금 안 · 쓰기 1번(batchUpdate) · 팀 고르기 · 담당/임원은 앞에서 FORBIDDEN · 적용월 = 이번 보고 달
const IX = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
const sv = IX.slice(IX.indexOf('exports.saveWeeklySalesTest'), IX.indexOf('async function runWeeklySalesMail_'));
const br = sv.slice(sv.indexOf("if (b.action === 'updateCustomers')"), sv.indexOf("// 3단계 ① 입력 방식 바꾸기"));
t('E17 updateCustomers: 잠금을 잡은 뒤·푼 앞, 시트 다시 읽은 뒤에 처리', sv.indexOf('acquireLock(') < sv.indexOf("if (b.action === 'updateCustomers')") && sv.indexOf("if (b.action === 'updateCustomers')") < sv.indexOf('releaseLock(') &&
  sv.indexOf('weeklyFile_(client, mro.fileId)') < sv.indexOf("if (b.action === 'updateCustomers')"));
t('E18 updateCustomers: 쓰기 perfBatchWrite_ 1번, 팀 weeklyLeadTeam_, 담당 managersOf, 적용월 = 이번 보고 달(weeklyEntry_ 월 없이)', (br.match(/perfBatchWrite_\(/g) || []).length === 1 && br.includes('weeklyLeadTeam_(mro.me, isAdmin, b.team, teams)') &&
  br.includes('weeklySales.managersOf(mro.userRows, lead.team)') && br.includes('weeklyEntry_(year, undefined, undefined, f.settings, nowMs)') && br.includes('month: nowEn.month'));
t('E19 동작 목록에 updateCustomers, 팀장·관리자 외 FORBIDDEN이 잠금 앞', sv.includes("'addCustomer', 'updateCustomers', 'proxyComplete', 'setMode']") && sv.indexOf("return { ok: false, error: 'FORBIDDEN' }") < sv.indexOf('acquireLock('));
t('E20 실적-고객사 읽기 범위 3곳 모두 A2:L, 고객사 추가 쓰기 A:L', (IX.match(/TAB_CUSTOMERS\) \+ '!A2:L'/g) || []).length === 3 && !IX.includes("TAB_CUSTOMERS) + '!A2:K'") && IX.includes("'!A' + plan.row + ':L' + plan.row"));
// 확인 1: 16시 알림의 '고객사 N곳'은 이력 줄을 한 곳으로 셈(11월 기준 동부 사용 중 = 가나정밀·다라금속·자차신규 3곳, 원본 줄로 세면 4)
const RJ = ws.reminderJobs({ nowMs: Date.parse('2026-11-16T16:05:00+09:00'), settings: ws.readSettings([]), customers: CEC, progressRows: [], weeklyRows: [], users: CEU.concat([['e2@nkmro.com', '동팀장', '팀장', '동부', '활성']]), adminEmail: '' });
t('R12 16시 알림 고객사 수 = 그 달 기준 한 곳씩(동부 3곳)', RJ.find(function (j) { return j.team === '동부'; }).total === 3);
// 확인 3: 잠금 안내 문구에 순서 포함
t('Q8 LOCKED_FIELD 문구에 순서', uiHtml.indexOf("LOCKED_FIELD: '구매사명·팀·순서는 바꿀 수 없어요") > 0);
// 결과 메일(시안 C-1): 실적 숫자 없음
const MV = vAll;
const mj = { key: 'result_2026-11-2', kind: 'result', year: 2026, month: 11, entry: nov2 };
const mp = ws.resultParts(mj, MV, { email: 'x@nkmro.com', name: '김대표' }, 'https://app');
const allText = [mp.subject].concat(mp.lines, mp.textBlock).join('\n') + mp.bodyHtml.replace(/<[^>]*>/g, ' '); // 보이는 글자만(태그 속 width="25%" 같은 모양 값 제외)
const amounts = [MV.total.sales, MV.total.planSales, MV.total.profit].concat(MV.subtotals.map(function (s) { return s.sales; })).filter(function (n) { return n !== null && n > 999; })
  .map(function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); });
t('M10 결과 메일: 금액·달성률(%)이 제목·본문·카드 어디에도 없음', amounts.length > 0 && amounts.every(function (a) { return allText.indexOf(a) < 0; }) && allText.indexOf('%') < 0);
t('M11 결과 메일: 제목 "11월 2주차 주간 실적이 도착했어요 (4팀 완료)", 주차 막대(이번 보고)·팀 칩 4개', mp.subject === '[MRO 워크허브] 11월 2주차 주간 실적이 도착했어요 (' + MV.teams.length + '팀 완료)' &&
  mp.bodyHtml.includes('2주차 보고 완료') && mp.bodyHtml.includes('이번 보고') && (mp.bodyHtml.match(/ 완료<\/div><\/td>/g) || []).length === MV.teams.length && mp.textBlock.some(function (l) { return l.includes('(이번 보고)'); }));
const pcm2 = pcm;
t('M12 메일 틀: bodyHtml은 HTML에, textBlock은 글 버전에 들어감(없으면 예전 그대로)', pcm2.buildHtml(mp).includes('2주차 보고 완료') && pcm2.buildText(mp).includes('■ 팀 입력 현황') &&
  pcm2.buildHtml({ hello: 'a', lines: ['b'], button: 'c', link: 'd', footer: 'e' }).indexOf('undefined') < 0 && pcm2.buildText({ hello: 'a', lines: ['b'], button: 'c', link: 'd', footer: 'e' }).indexOf('undefined') < 0);
// 화면: 고치기 창 상태(바꾼 칸 모으기 · 되돌리면 빠짐 · [변경 저장]은 숫자 저장 먼저)
async function ceRun(fn) {
  const posts = [];
  const ctx = { wkIn_: { year: 2026, month: 11, week: 2, team: '동부', canEdit: true, rows: [{ name: '가나정밀(주)' }], edit: { month: 11, customers: CEL.map(function (c) { return Object.assign({}, c); }), managers: CEM } },
    wkCe_: {}, wkBusy_: false, wkInMsg_: '', wkEditOpen_: true, document: { getElementById: function (id) { return { 'wi-s-0': { value: '1,000' }, 'wi-p-0': { value: '50' }, 'wi-n-0': { value: '' } }[id] || null; } },
    wkRenderInput_: function () {}, wkPost_: async function (b) { posts.push(b); return { ok: true, rows: 1, warnings: [], month: 11 }; }, wkErr_: function () { return ''; }, loadWeeklyPage: async function () {} };
  require('vm').createContext(ctx);
  require('vm').runInContext(['wkInEntries_', 'wkInBase_', 'wkAfter_', 'wkCeVal_', 'wkCeIsChg_', 'wkCeSet_', 'wkCeChanges_', 'wkCeStatus_', 'wkCeSave_'].map(uiGrab).join('\n') + '\nvar WK_CE_LABEL_ = {};', ctx);
  return fn(ctx, posts);
}
const fakeEl = function (n, f, v) { return { dataset: { n: String(n), f: f }, value: v, checked: v, classList: { toggle: function () {} }, parentNode: { classList: { toggle: function () {} }, querySelector: function () { return {}; } } }; };
await ceRun(async function (ctx, posts) {
  ctx.wkCeSet_(fakeEl(1, 'office', '경주')); ctx.wkCeSet_(fakeEl(0, 'active', false)); ctx.wkCeSet_(fakeEl(1, 'manager', '이담당'));
  const ch1 = JSON.stringify(ctx.wkCeChanges_());
  ctx.wkCeSet_(fakeEl(1, 'manager', '')); // 원래 값(빈칸)으로 되돌림
  const ch2 = ctx.wkCeChanges_();
  t('Q4 [고치기] 바꾼 칸만 모으고, 원래 값으로 되돌리면 빠짐', ch1.includes('"office":"경주"') && ch1.includes('"manager":"이담당"') && ch2.length === 2 && !('manager' in ch2.find(function (x) { return x.name === '다라금속(주)'; }).fields));
  await ctx.wkCeSave_();
  t('Q5 [변경 저장] 숫자 저장 먼저 → updateCustomers(팀·바꾼 칸) 순서, 결과 문구에 적용월', posts[0].action === 'save' && posts[0].entries[0].sales === '1,000' && posts[1].action === 'updateCustomers' && posts[1].team === '동부' && posts[1].changes.length === 2 &&
    ctx.wkInMsg_.includes('11월부터 적용'));
});
// 화면: 순서 잠금 · 모바일 정렬(정적)
const FH = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
const ceh = uiGrab('wkCeHtml_');
t('Q6 고치기 창: 순서는 글자만(입력칸 없음)·🔒, "이번 보고 달부터 적용" 안내', !ceh.includes("'ord'") && ceh.includes('순서 🔒') && ceh.includes('월(이번 보고 달)부터 적용돼요'));
t('Q7 모바일 정렬: 제목 줄 wk-meta, 주차 "~끝날 누적", 요약 wk-sum', FH.includes('<div class="wk-meta">') && uiGrab('wkHeader_').includes("'~' + wkMd2_(s.to) + ' 누적'") && uiGrab('wkSummary_').includes('pf-mycard wk-sum') &&
  FH.includes('.wk-meta { display: contents; }'));

// 고객사별 실적 표 머리글 고정(2026-11-17): 표 상자 안 세로 스크롤 + 제목 2줄 위 고정 + 구매사명 칸 왼쪽 고정
const wt = uiGrab('wkTable_');
t('Q9 고객사별 실적 표: wk-scroll 상자 · 제목 줄 wk-h1/wk-h2 · CSS 고정(top 0 / 32px)', wt.includes('pf-tablewrap wk-scroll') && wt.includes('<tr class="wk-h1">') && wt.includes('<tr class="wk-h2">') &&
  uiHtml.includes('.wk-scroll tr.wk-h1 th { position: sticky; top: 0;') && uiHtml.includes('.wk-scroll tr.wk-h2 th { position: sticky; top: 32px;'));
// 위쪽 가로 스크롤 막대(2026-11-17): 표 위 wk-topscroll + 두 막대가 서로 따라 움직임
const wts = uiGrab('wkTopScroll_'), wrn = uiGrab('wkRender_');
t('Q10 위쪽 가로 막대: 표 위 상자, 서로 따라 움직임(값이 같으면 멈춤), 전사 보기를 그린 뒤 맞춤', uiGrab('wkTable_').includes('<div class="wk-topscroll" id="wk-topscroll"><div></div></div><div class="pf-tablewrap wk-scroll" id="wk-scroll">') &&
  wts.includes('box.scrollLeft = top.scrollLeft') && wts.includes('top.scrollLeft = box.scrollLeft') && wrn.indexOf("if (wkTab_ !== 'in') wkTopScroll_();") > wrn.indexOf('root.innerHTML = h'));
// 3단계 화면(정적): 담당 메뉴·담당 흐름 · 방식 고르기 · 대신 완료 · 팀 확정
t('Q11 담당도 메뉴가 보이고 NEW는 안 부름, 담당은 view=input만', FH.includes("['임원', '팀장', '담당'].indexOf(session.role) >= 0") && FH.includes('if (!wkMgrOnly_()) loadWeeklyBadge_();') &&
  uiGrab('loadWeeklyPage').indexOf('if (wkMgrOnly_())') < uiGrab('loadWeeklyPage').indexOf("view: 'report'") && uiGrab('loadWeeklyInput_').includes("wkMgrOnly_() ? { view: 'input' }"));
const ri3 = uiGrab('wkRenderInput_');
t('Q12 입력 탭: 방식 고르기(wkSetMode_)·담당 현황·대신 입력 완료(wkProxy_)·[팀 확정]·담당 원래 값', ri3.includes("wkSetMode_('${m}')") && ri3.includes('담당 입력 현황') && ri3.includes('wkProxy_(${gi})') && ri3.includes('>팀 확정</button>') && ri3.includes('담당 원래 '));
const sm3 = uiGrab('wkSetMode_'), px3 = uiGrab('wkProxy_');
t('Q13 방식 바꾸기·대신 완료도 입력칸을 다시 그리기 전에 읽고 먼저 저장', sm3.indexOf('wkInEntries_()') < sm3.indexOf('wkRenderInput_()') && sm3.indexOf("action: 'save'") < sm3.indexOf("action: 'setMode'") &&
  px3.indexOf('wkInEntries_()') < px3.indexOf('wkRenderInput_()') && px3.indexOf("action: 'save'") < px3.indexOf("action: 'proxyComplete'"));
// 3단계 서버(정적): 담당은 save·complete·reopen만, 잠금 앞에서 권한 확인
t('E21 담당 권한은 save·complete·reopen만, FORBIDDEN이 잠금 앞', sv.includes("['save', 'complete', 'reopen'].indexOf(b.action) >= 0") && sv.indexOf("if (!isAdmin && !asMgr && !(mro.me") < sv.indexOf('acquireLock('));
// 금요일 입력 시작 화면(정적): 상단·주차 막대 기간 표시, 예상치 안내, 마감 뒤 재촉(2안, 잠금 없음), 담당 '이번 주 2단계' 안내
const hd = uiGrab('wkHeader_'), due = uiGrab('wkDue_'), ri4 = uiGrab('wkRenderInput_'), li4 = uiGrab('loadWeeklyInput_');
t('Q14 상단 "입력 금~월 16:00"·막대 "11/20~11/23"', hd.includes('입력 ${wkMd_(res.openDate || res.inputDate)}~${wkMd_(res.inputDate)}') && hd.includes('${wkMd2_(s.openDate || s.inputDate)}~${wkMd2_(s.inputDate)}'));
t('Q15 마감 뒤 재촉 문구(2안)·하루 넘으면 "N일 남음"', due.includes('⏰ 늦었어요! 지금 입력해 주시면 바로 결과가 모여요') && due.includes("dd + '일'") && ri4.includes('늦었어요! 지금 입력해 주시면 바로 결과가 모여요.'));
t('Q16 예상치 안내(누적 기간 끝나기 전, 가마감 제외)·담당 2단계 주차 안내', ri4.includes('<b>예상치</b>로 넣어 두고') && ri4.includes('!d.gamagam && wkTodayIso_() <= d.to') && li4.includes("res.error === 'MODE_2STEP' && res.nextMode === '3단계' && res.next"));
console.log(`weekly_sales_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
})();
