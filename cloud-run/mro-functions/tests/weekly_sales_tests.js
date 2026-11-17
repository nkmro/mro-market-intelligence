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
t('A1 고객사 추가: 다음 줄·순서 최대+1·사용 TRUE', pa.ok && pa.row === 8 && pa.values.join('|') === '동부|미계열|새빛산업(주)|오프라인|창원||true|7|신규|b@x|2026-11-16 15:00');
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
t('B3 결과 메일 제목·전사·팀별', rp.subject === '[MRO 워크허브] 11월 2주차 주간 실적 보고 (3팀 입력 완료)' && rt.indexOf('· 매출 누적 400,000 / 계획 900,000 (44.4%)') > 0 && rt.indexOf('· 동부  250,000 / 400,000 / 62.5%') > 0);
t('B4 HTML도 만들어짐(버튼 주소)', pcm.buildHtml(rp).indexOf('feed.html?view=weekly') > 0);

// 팀 고르기 (확인 3)
const T4 = ['서부', '동부', '중부', '영업지원'], meA = { email: 'a', role: '팀장', team: '동부', active: true }, meB = { email: 'b', role: '팀장', team: '서부지역팀', active: true };
t('L1 관리자: 고른 팀 그대로', ws.leadTeam(meA, true, '중부', T4).team === '중부' && ws.leadTeam(meA, true, '서부지역팀', T4).team === '서부');
t('L2 관리자: 없는 팀을 보내면 BAD_TEAM(첫 팀으로 바꾸지 않음)', ws.leadTeam(meA, true, '남부', T4).error === 'BAD_TEAM');
t('L3 관리자: 안 고르면 자기 팀', ws.leadTeam(meA, true, '', T4).team === '동부');
t('L4 팀장: 자기 팀만, 다른 팀 FORBIDDEN_TEAM', ws.leadTeam(meB, false, '', T4).team === '서부' && ws.leadTeam(meB, false, '동부', T4).error === 'FORBIDDEN_TEAM');
t('L5 팀장 아님·비활성 → FORBIDDEN', ws.leadTeam({ role: '담당', team: '동부', active: true }, false, '', T4).error === 'FORBIDDEN' && ws.leadTeam({ role: '팀장', team: '동부', active: false }, false, '', T4).error === 'FORBIDDEN');

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

// 고객사 정보 고치기 (2026-11-17 재홍님 확정) — 가상의 값만
const CEC = [
  ['동부', '미계열', '가나정밀(주)', '오프라인', '창원', '김담당', true, 1, '', 'x', 'y'],
  ['동부', '다라그룹', '다라금속(주)', '온라인', '포항', '', true, 2, '', 'x', 'y'],
  ['서부', '미계열', '마바화학', '오프라인', '군산', '', true, 1, '', 'x', 'y'],
  ['동부', '미계열', '사아플랜트(주)', '오프라인', '울산', '', false, 3, '거래 종료', 'x', 'y']
];
const CEU = [
  ['a@nkmro.com', '김담당', '담당', '동부', '활성'], ['b@nkmro.com', '이담당', '담당', '동부지역팀', '활성'], ['c@nkmro.com', '박담당', '담당', '동부', '비활성'],
  ['d@nkmro.com', '최담당', '담당', '서부', '활성'], ['e@nkmro.com', '정팀장', '팀장', '동부', '활성']
];
const CEW = [[2026, 11, 2, '동부', '가나정밀(주)', 100, 10, '', 'a', 't']];
const CEM = ws.managersOf(CEU, '동부');
t('E1 담당 목록 = 이 팀 활성 담당만(비활성·팀장·다른 팀 빼고)', JSON.stringify(CEM) === JSON.stringify(['김담당', '이담당']));
const CEL = ws.customerEditList(CEC, '동부', CEW, 2026, 11);
t('E2 고치기 목록: 그 팀 전체, 사용 중 먼저(순서), 사용 끔은 뒤 + 이번 달 숫자 표시',
  CEL.map(function (c) { return c.name; }).join('|') === '가나정밀(주)|다라금속(주)|사아플랜트(주)' && CEL[2].active === false && CEL[0].monthHas === true && CEL[1].monthHas === false && CEL[0].manager === '김담당');
function ceUp(changes, extra) { return ws.planUpdateCustomers(Object.assign({ customers: CEC, team: '동부', changes: changes, managers: CEM, weeklyRows: CEW, year: 2026, month: 11 }, extra || {})); }
let ce = ceUp([{ name: '다라금속(주)', fields: { ord: '5', series: '새그룹', orderType: '오프라인', office: '경주', manager: '이담당', note: '메모', active: false } }]);
t('E3 칸 7개 모두 바꾸기 → 줄 3(다라금속)의 H·B·D·E·F·I·G 칸, 값 그대로', ce.ok && ce.writes.length === 7 && ce.rows === 1 &&
  ce.writes.map(function (w) { return w.cell + '=' + w.value; }).sort().join(',') === ['B3=새그룹', 'D3=오프라인', 'E3=경주', 'F3=이담당', 'G3=false', 'H3=5', 'I3=메모'].sort().join(','));
ce = ceUp([{ name: '가나정밀(주)', fields: { office: '창원', series: '미계열', ord: '1', active: true, manager: '김담당' } }]);
t('E4 지금 값과 같은 칸은 안 씀(0칸)', ce.ok && ce.writes.length === 0 && ce.rows === 0);
ce = ceUp([{ name: '가나정밀(주)', fields: { active: false } }]);
t('E5 이번 달 숫자 있는 고객사 사용 끄기 → 경고(쓰기는 함)', ce.ok && ce.writes.length === 1 && ce.writes[0].cell === 'G2' && ce.warnings[0] === '가나정밀(주)');
ce = ceUp([{ name: '다라금속(주)', fields: { active: false } }]);
t('E6 이번 달 숫자 없는 고객사 사용 끄기 → 경고 없음', ce.ok && ce.warnings.length === 0);
ce = ceUp([{ name: '사아플랜트(주)', fields: { active: true } }]);
t('E7 사용 끔 → 다시 켜기', ce.ok && ce.writes[0].cell === 'G5' && ce.writes[0].value === true);
t('E8 담당: 목록에 없는 이름 BAD_MANAGER · 다른 팀 담당도 거절 · 빈칸(없음)은 허용',
  ceUp([{ name: '다라금속(주)', fields: { manager: '홍길동' } }]).error === 'BAD_MANAGER' && ceUp([{ name: '다라금속(주)', fields: { manager: '최담당' } }]).error === 'BAD_MANAGER' &&
  ceUp([{ name: '가나정밀(주)', fields: { manager: '' } }]).writes[0].cell === 'F2');
const CEC2 = CEC.map(function (r) { return r.slice(); }); CEC2[1][5] = '퇴사담당';
ce = ws.planUpdateCustomers({ customers: CEC2, team: '동부', changes: [{ name: '다라금속(주)', fields: { manager: '퇴사담당', office: '경주' } }], managers: CEM, weeklyRows: CEW, year: 2026, month: 11 });
t('E9 담당을 안 바꾸면(목록에 없는 기존 이름 그대로) 다른 칸은 저장됨', ce.ok && ce.writes.length === 1 && ce.writes[0].cell === 'E3');
t('E10 구매사명·팀 바꾸기 시도 → LOCKED_FIELD', ceUp([{ name: '가나정밀(주)', fields: { name: '새이름' } }]).error === 'LOCKED_FIELD' && ceUp([{ name: '가나정밀(주)', fields: { team: '서부' } }]).error === 'LOCKED_FIELD');
t('E11 모르는 칸 BAD_FIELD · 사용 값이 참/거짓 아님 BAD_FIELD', ceUp([{ name: '가나정밀(주)', fields: { 등록자: 'x' } }]).error === 'BAD_FIELD' && ceUp([{ name: '가나정밀(주)', fields: { active: 'FALSE' } }]).error === 'BAD_FIELD');
t('E12 순서 0·글자·10000 → BAD_ORDER, 빈칸 허용', ceUp([{ name: '가나정밀(주)', fields: { ord: '0' } }]).error === 'BAD_ORDER' && ceUp([{ name: '가나정밀(주)', fields: { ord: '가' } }]).error === 'BAD_ORDER' &&
  ceUp([{ name: '가나정밀(주)', fields: { ord: '10000' } }]).error === 'BAD_ORDER' && ceUp([{ name: '가나정밀(주)', fields: { ord: '' } }]).writes[0].value === '');
t('E13 40자 넘는 사무소 FIELD_TOO_LONG · 200자 넘는 비고 NOTE_TOO_LONG', ceUp([{ name: '가나정밀(주)', fields: { office: 'a'.repeat(41) } }]).error === 'FIELD_TOO_LONG' && ceUp([{ name: '가나정밀(주)', fields: { note: 'a'.repeat(201) } }]).error === 'NOTE_TOO_LONG');
t('E14 다른 팀 고객사·없는 고객사 → UNKNOWN_CUSTOMER, 같은 이름 두 번 → DUPLICATE_CUSTOMER, 빈 요청 → NO_CHANGES',
  ceUp([{ name: '마바화학', fields: { office: 'x' } }]).error === 'UNKNOWN_CUSTOMER' && ceUp([{ name: '없는회사', fields: { office: 'x' } }]).error === 'UNKNOWN_CUSTOMER' &&
  ceUp([{ name: '가나정밀(주)', fields: { office: 'x' } }, { name: '가나정밀(주)', fields: { note: 'y' } }]).error === 'DUPLICATE_CUSTOMER' && ceUp([]).error === 'NO_CHANGES');
ce = ceUp([{ name: '가나정밀(주)', fields: { office: '마산' } }, { name: '다라금속(주)', fields: { note: '메모' } }]);
t('E15 두 곳 바꾸기 → 칸 2개, 곳 2', ce.ok && ce.writes.length === 2 && ce.rows === 2);
t('E16 권한: 임원 → FORBIDDEN, 팀장 다른 팀 → FORBIDDEN_TEAM, 관리자 아무 팀', ws.leadTeam({ role: '임원', team: '본사', active: true }, false, '', T4).error === 'FORBIDDEN' &&
  ws.leadTeam({ role: '팀장', team: '동부', active: true }, false, '서부', T4).error === 'FORBIDDEN_TEAM' && ws.leadTeam(meA, true, '영업지원', T4).team === '영업지원');
// index.js 배선(정적): 잠금 안 · 쓰기 1번(batchUpdate) · 팀 고르기 · 담당/임원은 앞에서 FORBIDDEN
const IX = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
const sv = IX.slice(IX.indexOf('exports.saveWeeklySalesTest'), IX.indexOf('async function runWeeklySalesMail_'));
const br = sv.slice(sv.indexOf("if (b.action === 'updateCustomers')"), sv.indexOf("const en = weeklyEntry_(year, b.month, b.week"));
t('E17 updateCustomers: 잠금을 잡은 뒤·푼 앞, 시트 다시 읽은 뒤에 처리', sv.indexOf('acquireLock(') < sv.indexOf("if (b.action === 'updateCustomers')") && sv.indexOf("if (b.action === 'updateCustomers')") < sv.indexOf('releaseLock(') &&
  sv.indexOf('weeklyFile_(client, mro.fileId)') < sv.indexOf("if (b.action === 'updateCustomers')"));
t('E18 updateCustomers: 쓰기는 perfBatchWrite_ 1번(바뀐 칸만), 팀은 weeklyLeadTeam_, 담당 목록은 managersOf', (br.match(/perfBatchWrite_\(/g) || []).length === 1 && br.includes('weeklyLeadTeam_(mro.me, isAdmin, b.team, teams)') && br.includes('weeklySales.managersOf(mro.userRows, lead.team)') && br.includes("'!' + w.cell"));
t('E19 동작 목록에 updateCustomers, 팀장·관리자 외 FORBIDDEN이 잠금 앞', sv.includes("'addCustomer', 'updateCustomers']") && sv.indexOf("return { ok: false, error: 'FORBIDDEN' }") < sv.indexOf('acquireLock('));
// 화면: 고치기 창 상태(바꾼 칸 모으기 · 되돌리면 빠짐 · [변경 저장]은 숫자 저장 먼저)
async function ceRun(fn) {
  const posts = [];
  const ctx = { wkIn_: { year: 2026, month: 11, week: 2, team: '동부', canEdit: true, rows: [{ name: '가나정밀(주)' }], edit: { customers: CEL.map(function (c) { return Object.assign({}, c); }), managers: CEM } },
    wkCe_: {}, wkBusy_: false, wkInMsg_: '', wkEditOpen_: true, document: { getElementById: function (id) { return { 'wi-s-0': { value: '1,000' }, 'wi-p-0': { value: '50' }, 'wi-n-0': { value: '' } }[id] || null; } },
    wkRenderInput_: function () {}, wkPost_: async function (b) { posts.push(b); return { ok: true, rows: 1, warnings: [] }; }, wkErr_: function () { return ''; }, loadWeeklyPage: async function () {} };
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
  t('Q5 [변경 저장] 숫자 저장 먼저 → updateCustomers(팀·바꾼 칸) 순서', posts[0].action === 'save' && posts[0].entries[0].sales === '1,000' && posts[1].action === 'updateCustomers' && posts[1].team === '동부' && posts[1].changes.length === 2);
});

console.log(`weekly_sales_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
})();
