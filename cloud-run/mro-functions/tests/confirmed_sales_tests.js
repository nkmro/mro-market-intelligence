// 확정 실적(2026-11-23 재홍님 승인) 2단계 서버 — lib/confirmedSales.js 순수 함수 + index.js 배선(정적). 이름·숫자는 모두 가짜
const cs = require('../lib/confirmedSales');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); } }
const NOW = Date.parse('2026-11-03T10:00:00+09:00');
// 사용자팀마스터 A2:L (J = 사무소, L = 겸임팀)
const U = [
  ['lead@nkmro.com', '한팀장', '팀장', '동부', '활성', '', '', '', '', '본사'],
  ['a@nkmro.com', '가담당', '담당', '동부', '활성', '', '', '', '', '포항'],
  ['b@nkmro.com', '나담당', '담당', '동부', '활성', '', '', '', '', '대구'],
  ['c@nkmro.com', '다담당', '담당', '동부', '활성', '', '', '', '', '창원'],
  ['c2@nkmro.com', '라담당', '담당', '동부', '활성', '', '', '', '', '창원'],
  ['p1@nkmro.com', '구매일', '일반', '동부', '활성', '', '', '', '', '포항'],
  ['p2@nkmro.com', '구매이', '일반', '동부', '비활성', '', '', '', '', '포항'],
  ['p3@nkmro.com', '구매삼', '일반', '동부', '활성', '', '', '', '', '대구'],
  ['p4@nkmro.com', '구매사', '일반', '동부', '활성', '', '', '', '', '창원'],
  ['p5@nkmro.com', '구매오', '일반', '동부', '활성', '', '', '', '', '울산'],
  ['w@nkmro.com', '서팀장', '팀장', '서부', '활성', '', '', '', '', '본사'],
  ['e@nkmro.com', '임원일', '임원', '본사', '활성', '', '', '', '', '']];
const P = cs.peopleOf(U);
// 1) 담당 배정
let a = cs.assign(P, '동부', { 구매일: 21, 구매이: 3, 구매없음: 5 });
t('A1 섞인 구매담당(퇴사 포함·계정 없음) → 줄 수 많은 사무소(포항) → 그 사무소 담당', a.office === '포항' && a.manager === '가담당' && a.why === 'OK');
a = cs.assign(P, '동부', { 구매삼: 2, 구매일: 2 });
t('A2 줄 수가 같으면 먼저 나온 사무소', a.office === '대구' && a.manager === '나담당');
t('A3 사무소 담당 2명 → 팀장(OFFICE_MANY)', JSON.stringify(cs.assign(P, '동부', { 구매사: 1 })) === JSON.stringify({ office: '창원', manager: '한팀장', why: 'OFFICE_MANY' }));
t('A4 사무소 담당 0명 → 팀장(OFFICE_NONE)', cs.assign(P, '동부', { 구매오: 4 }).why === 'OFFICE_NONE' && cs.assign(P, '동부', { 구매오: 4 }).manager === '한팀장');
t('A5 계정 없는 구매담당뿐 → 팀장(NO_OFFICE), 팀장도 없으면 빈칸(NO_LEAD)', cs.assign(P, '동부', { 모름: 9 }).why === 'NO_OFFICE' && cs.assign(P, '중부', { 모름: 1 }).why === 'NO_LEAD' && cs.assign(P, '중부', { 모름: 1 }).manager === '');
t('A6 실적부서명 "동부지역" → 동부', cs.cfTeam('동부지역') === '동부' && cs.cfTeam('동부팀') === '동부' && cs.cfTeam('영업지원') === '영업지원');
// 2) 주간 고객사(실적-고객사 A2:L) · 계획
const CUST = [['동부', '', '다온계열', '', '포항', '', 'TRUE', 1], ['동부', '', '가람정밀(주)', '', '대구', '', 'TRUE', 2], ['동부', '', '바른전자계열', '', '창원', '', 'TRUE', 3],
  ['동부', '', '쉬는고객', '', '', '', 'FALSE', 4], ['서부', '', '서쪽고객', '', '', '', 'TRUE', 1]];
const PLAN = [[2026, '동부', '다온계열'].concat(new Array(27).fill(0)).concat([182000, 16400, 0]), [2026, '동부', '가람정밀(주)'].concat(new Array(27).fill(0)).concat([95000, 8100, 0])];
const ITEMS = [{ name: '다온스틸(주)', sales: 98420, profit: 8830, unclosed: 0, buyers: { 구매일: 10 } }, { name: '다온강판(주)', sales: 63100, profit: 5480, unclosed: 1, buyers: { 구매일: 3, 구매이: 1 } },
  { name: '가람정밀(주)', sales: 88760, profit: 7320, unclosed: 0, buyers: { 구매삼: 4 } }, { name: '세온테크(주)', sales: 6420, profit: 500, unclosed: 0, buyers: { 구매일: 1 } }];
const LINKS = [['다온스틸(주)', '동부', '다온계열', 'x', ''], ['다온강판(주)', '동부지역', '다온계열', 'x', '']];
function up(o) { return cs.planUpload(Object.assign({ year: 2026, month: 10, team: '동부지역', items: ITEMS, links: {}, customers: CUST, linkRows: LINKS, confRows: [], progRows: [], userRows: U, who: 'Admin@nkmro.com', nowMs: NOW }, o)); }
let u = up({});
t('U1 못 이은 시스템 고객사 → UNLINKED(목록·주간 고객사 이름 같이)', !u.ok && u.error === 'UNLINKED' && u.unlinked.length === 1 && u.unlinked[0].name === '세온테크(주)' && u.weeklyNames.join() === '다온계열,가람정밀(주),바른전자계열,쉬는고객');
t('U2 같은 이름(가람정밀) 자동 연결, 연결 탭(팀 "동부지역"도) 사용', u.diff.added.length === 4 || u.unlinked.length === 1);
t('U3 없는 주간 고객사로 연결 → BAD_LINK', up({ links: { '세온테크(주)': '없는고객' } }).error === 'BAD_LINK');
u = up({ links: { '세온테크(주)': '다온계열' } });
t('U4 처음 올리기: 4곳 추가, 실적-확정 2~5행 A:O 15칸, 진행 "올림" 1줄, 연결 새 줄 3행', u.ok && u.first && u.diff.added.length === 4 && u.writes.length === 4 && u.writes[0].range === 'A2:O2' && u.writes[3].range === 'A5:O5' &&
  u.writes[0].values.length === 15 && u.progWrites.length === 1 && u.progWrites[0].values[3] === '올림' && u.linkWrites.length === 1 && u.linkWrites[0].range === 'A4:E4' && u.linkWrites[0].values.slice(0, 3).join() === '세온테크(주),동부,다온계열');
t('U5 줄 값: 연·월·팀·시스템명·주간명·사무소·담당·매출·시스템이익·(고친 이익 빈칸)·(비고 빈칸)·미마감·수정자(소문자)', u.writes[1].values.slice(0, 13).join('|') === '2026|10|동부|다온강판(주)|다온계열|포항|가담당|63100|5480|||1|admin@nkmro.com');
t('U6 (새 고객사로 따로) = 자기 이름으로 연결 가능', up({ links: { '세온테크(주)': '세온테크(주)' } }).ok);
t('U7 검사: 같은 이름 두 번·숫자 아님·빈 목록·잘못된 달', up({ items: [ITEMS[0], ITEMS[0]] }).error === 'DUPLICATE_CUSTOMER' && up({ items: [{ name: 'x', sales: 1.5, profit: 1, unclosed: 0 }] }).error === 'BAD_NUMBER' &&
  up({ items: [] }).error === 'NO_ROWS' && up({ month: 13 }).error === 'BAD_MONTH');
// 올린 뒤 상태 만들기
const CONF = u.writes.map(function (w) { return w.values.slice(); });
CONF[0][9] = 9000; CONF[0][10] = '신규 설비 교체 수요로 증가'; CONF[1][10] = '매입 미마감 1건 이익 차감 반영'; CONF[2][10] = '공구류 단가 인하 영향'; CONF[3][10] = '짧음';
let PROG = [[2026, 10, '동부', '올림', '', 'admin@nkmro.com', '2026-11-03 10:00']];
// 3) 화면
let v = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF, progRows: PROG, minNote: 10, me: '가담당', scope: 'all' });
t('V1 묶음 = 주간 고객사 순서, 사용 끔·실적 없는 고객사는 빠짐, 계획은 그 달 칸', v.groups.map(function (g) { return g.name; }).join() === '다온계열,가람정밀(주),바른전자계열' && v.groups[0].planSales === 182000 && v.groups[0].planProfit === 16400);
t('V2 다온계열 = 3곳 합(고친 이익 9000 반영), 고친 칸 표시·시스템 값 남김', v.groups[0].sales === 98420 + 63100 + 6420 && v.groups[0].profit === 9000 + 5480 + 500 && v.groups[0].subs[0].edited && v.groups[0].subs[0].sysProfit === 8830);
t('V3 화면 자료에 담당·사무소 없음(mine 표시만)', !JSON.stringify(v.groups).includes('포항') && !JSON.stringify(v.groups).includes('manager') && v.groups[0].subs[0].mine === true && v.groups[1].subs[0].mine === false);
t('V4 담당 확정 현황 = 담당 이름·확정 여부(칩용)', v.managers.map(function (m) { return m.name + (m.done ? '✓' : ''); }).join() === '가담당,나담당');
const vm = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF, progRows: PROG, minNote: 10, me: '나담당', scope: 'mine' });
t('V5 담당(mine) = 자기 줄만, 합계도 자기 줄', vm.groups.length === 1 && vm.groups[0].name === '가람정밀(주)' && vm.total.sales === 88760);
t('V6 올린 달 목록', cs.monthsOf(CONF.concat([[2026, 9, '동부', 'x']]), 2026, '동부').join() === '9,10');
// 4) 담당 저장
function ed(o) { return cs.planEdit(Object.assign({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, me: '가담당', isAdmin: false, who: 'a@nkmro.com', nowMs: NOW }, o)); }
let e = ed({ edits: [{ name: '다온강판(주)', profit: '5,210', note: '매입 미마감 1건 이익 차감 반영, 소폭 미달' }] });
t('E1 이익·비고 저장 → J:K + M:O(다시확인 지움), 3행', e.ok && e.writes[0].range === 'J3:K3' && e.writes[0].values[0] === 5210 && e.writes[1].range === 'M3:O3' && e.writes[1].values[2] === '');
t('E2 매출을 보내면 SALES_LOCKED', ed({ edits: [{ name: '다온강판(주)', sales: 1 }] }).error === 'SALES_LOCKED');
t('E3 남의 고객사 → NOT_MY_CUSTOMER, 관리자는 가능', ed({ edits: [{ name: '가람정밀(주)', note: '관리자 고침 테스트' }] }).error === 'NOT_MY_CUSTOMER' && ed({ isAdmin: true, me: '', edits: [{ name: '가람정밀(주)', note: '관리자 고침 테스트' }] }).ok);
t('E4 시스템 값과 같은 이익·빈칸 → 고친 값 지움', ed({ edits: [{ name: '다온스틸(주)', profit: '8830' }] }).writes[0].values[0] === '' && ed({ edits: [{ name: '다온스틸(주)', profit: '' }] }).writes[0].values[0] === '');
t('E5 숫자 아님·비고 201자·없는 고객사', ed({ edits: [{ name: '다온스틸(주)', profit: 'abc' }] }).error === 'BAD_NUMBER' && ed({ edits: [{ name: '다온스틸(주)', note: 'x'.repeat(201) }] }).error === 'NOTE_TOO_LONG' &&
  ed({ edits: [{ name: '없음', note: 'x' }] }).error === 'UNKNOWN_CUSTOMER');
t('E6 바뀐 것 없으면 쓰기 0', ed({ edits: [{ name: '다온스틸(주)', profit: '9000', note: '신규 설비 교체 수요로 증가' }] }).writes.length === 0);
// 5) 확정·취소·최종
function cf(fn, o) { return cs[fn](Object.assign({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, minNote: 10, who: 'a@nkmro.com', nowMs: NOW }, o)); }
let c = cf('planConfirm', { manager: '가담당' });
t('C1 비고가 10자 미만인 곳이 있으면 NOTE_SHORT(이름 목록)', !c.ok && c.error === 'NOTE_SHORT' && c.names.join() === '세온테크(주)' && c.min === 10);
t('C2 최소 글자 0이면 확정 → 실적-확정진행 다음 줄(3행) "담당 확정"', cf('planConfirm', { manager: '가담당', minNote: 0 }).write.range === 'A3:G3' && cf('planConfirm', { manager: '가담당', minNote: 0 }).write.values[3] === '담당 확정');
t('C3 줄 없는 사람 → NO_ROWS', cf('planConfirm', { manager: '모름' }).error === 'NO_ROWS');
PROG = PROG.concat([[2026, 10, '동부', '담당 확정', '나담당', 'b@nkmro.com', '2026-11-03 11:00']]);
t('C4 확정한 담당은 저장 불가(MY_DONE)·다시 확정 불가', cs.planEdit({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, me: '나담당', edits: [{ name: '가람정밀(주)', note: '공구류 단가 인하 영향 확인' }] }).error === 'MY_DONE' &&
  cf('planConfirm', { manager: '나담당', progRows: PROG }).error === 'ALREADY_DONE');
t('C5 최종 확정: 남은 담당 있으면 MANAGERS_NOT_DONE', cf('planFinal', { progRows: PROG }).error === 'MANAGERS_NOT_DONE' && cf('planFinal', { progRows: PROG }).names.join() === '가담당');
t('C6 확정 취소: 확정 안 한 사람 NOT_DONE, 한 사람은 "확정 취소"', cf('planCancel', { manager: '가담당', progRows: PROG }).error === 'NOT_DONE' && cf('planCancel', { manager: '나담당', progRows: PROG }).write.values[3] === '확정 취소');
PROG = PROG.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a@nkmro.com', '2026-11-03 12:00']]);
t('C7 모두 확정 → 최종 확정 가능', cf('planFinal', { progRows: PROG }).ok && cf('planFinal', { progRows: PROG }).write.values[3] === '최종 확정');
PROG = PROG.concat([[2026, 10, '동부', '최종 확정', '', 'admin@nkmro.com', '2026-11-05 09:00']]);
t('C8 최종 확정 뒤 저장·확정 취소·최종 다시 → FINAL_DONE', ed({ progRows: PROG, edits: [{ name: '다온스틸(주)', note: '바꿈 시험 메모' }] }).error === 'FINAL_DONE' && cf('planCancel', { manager: '가담당', progRows: PROG }).error === 'FINAL_DONE' &&
  cf('planFinal', { progRows: PROG }).error === 'FINAL_DONE');
const st = cs.stateOf(PROG, 2026, 10, '동부');
t('C9 상태: 올림·담당 2명 확정·최종 확정', st.uploaded && Object.keys(st.confirmed).sort().join() === '가담당,나담당' && st.final && st.final.at === '2026-11-05 09:00');
// 6) 다시 올리기
const I2 = [{ name: '다온스틸(주)', sales: 98420, profit: 8830, unclosed: 0, buyers: { 구매일: 10 } }, { name: '다온강판(주)', sales: 64850, profit: 5630, unclosed: 0, buyers: { 구매일: 3 } },
  { name: '가람정밀(주)', sales: 88760, profit: 7320, unclosed: 2, buyers: { 구매삼: 4 } }, { name: '바른전자 부산(주)', sales: 4280, profit: 390, unclosed: 0, buyers: { 구매일: 1 } }];
u = up({ items: I2, confRows: CONF, progRows: PROG, links: { '바른전자 부산(주)': '바른전자계열' }, linkRows: LINKS.concat([['세온테크(주)', '동부', '다온계열', 'x', '']]) });
t('R1 그대로 2·바뀜 1·새로 1·빠짐 1', u.ok && u.diff.same.join() === '다온스틸(주),가람정밀(주)' && u.diff.changed.length === 1 && u.diff.changed[0].name === '다온강판(주)' && u.diff.added[0].name === '바른전자 부산(주)' && u.diff.removed[0].name === '세온테크(주)');
const wr = function (r) { return u.writes.find(function (w) { return w.range.indexOf(r) === 0 || w.range === r; }); };
t('R2 그대로인 곳: 고친 이익·비고 그대로(쓰지 않음), 미마감만 새 값(L4)', !u.writes.some(function (w) { return w.range === 'A2:O2'; }) && wr('L4').values[0] === 2);
t('R3 바뀐 곳(3행): 고친 이익 지움, 비고 남김, 다시확인 = "매출 63100→64850 · 이익 5480→5630"', wr('A3:O3').values[9] === '' && wr('A3:O3').values[10] === '매입 미마감 1건 이익 차감 반영' && wr('A3:O3').values[14] === '매출 63100→64850 · 이익 5480→5630');
t('R4 빠진 곳(5행) 줄 비움, 새 곳은 다음 빈 줄(6행)', wr('A5:O5').values.every(function (x) { return x === ''; }) && wr('A6:O6').values[3] === '바른전자 부산(주)');
t('R5 다시 열림 = 확정했던 담당 중 바뀐 곳의 담당(가담당)만, 최종 확정 풀림', u.reopen.join() === '가담당' && u.finalUndone && u.progWrites.map(function (w) { return w.values[3] + (w.values[4] ? ':' + w.values[4] : ''); }).join() === '다시 올림,확정 다시 열림:가담당,최종 확정 풀림');
const CONF2 = CONF.map(function (r) { return r.slice(); }); CONF2[1][7] = 64850; CONF2[1][8] = 5630; CONF2[1][9] = ''; CONF2[3] = new Array(15).fill('');
u = up({ items: I2.slice(0, 3).concat([]), confRows: CONF2, progRows: PROG });
t('R6 바뀐 곳이 없으면(빠짐만 이미 반영) 진행 줄 없음·최종 확정 유지', u.ok && !u.changedAny && u.progWrites.length === 0 && !u.finalUndone);
const st2 = cs.stateOf(PROG.concat([[2026, 10, '동부', '확정 다시 열림', '가담당', 'admin@nkmro.com', ''], [2026, 10, '동부', '최종 확정 풀림', '', 'admin@nkmro.com', '']]), 2026, 10, '동부');
t('R7 다시 열림·최종 확정 풀림 반영된 상태', !st2.final && Object.keys(st2.confirmed).join() === '나담당');
// 7) 머리줄
t('H1 탭 3개 머리줄 확인(시트 우선)', cs.checkHeaders(cs.TAB_CONF, cs.CF_HEADERS[cs.TAB_CONF]).ok && !cs.checkHeaders(cs.TAB_CONF, ['연도', '월']).ok && cs.CF_HEADERS[cs.TAB_CONF].length === 15 && cs.CF_HEADERS[cs.TAB_LINK].length === 5 && cs.CF_HEADERS[cs.TAB_CPROG].length === 7);
// 8) index.js 배선(정적)
const IX = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
const sv = IX.slice(IX.indexOf('exports.saveWeeklySalesTest'), IX.indexOf('async function runWeeklySalesMail_'));
const ca = IX.slice(IX.indexOf('async function confirmedAction_'), IX.indexOf('// POST /saveWeeklySalesTest'));
t('X1 저장: CF 동작은 기존 권한 확인 앞에서 confirmedAction_으로(담당도 들어올 수 있게)', sv.includes('CF_ACTIONS.indexOf(b.action) < 0) {') && sv.indexOf('return await confirmedAction_(') < sv.indexOf("const asMgr = !isAdmin && !!(mro.me"));
t('X2 confirmedAction_: 올리기·미리보기·최종 확정은 관리자만(잠금 앞), 잠금 안에서 시트 다시 읽기, 쓰기는 perfBatchWrite_ 한 곳', ca.indexOf("['cfPreview', 'cfUpload', 'cfFinal'].indexOf(b.action) >= 0 && !isAdmin") < ca.indexOf('acquireLock(') &&
  ca.indexOf('acquireLock(') < ca.indexOf('cfFile_(client') && (ca.match(/perfBatchWrite_\(/g) || []).length === 1 && ca.includes('releaseLock(firestore, WEEKLY_LOCK_NAME, holderId)'));
t('X3 확정 = 자기 이름만, 취소 = 관리자만 다른 담당', ca.includes("planConfirm(Object.assign({}, common, { manager: myName,") && ca.includes('manager: isAdmin && b.manager ? b.manager : myName'));
const gv = IX.slice(IX.indexOf('async function confirmedView_'), IX.indexOf('async function confirmedAction_'));
t('X4 보기: 임원 = 최종 확정된 달만, 담당 = mine, 관리자·임원·팀장·담당 외 FORBIDDEN', gv.includes("months.filter(function (m) { return !!confirmedSales.stateOf(f.progRows, year, m, lead.team).final; })") && gv.includes("scope: !isAdmin && me.role === '담당' ? 'mine' : 'all'") &&
  gv.includes("['임원', '팀장', '담당'].indexOf(me.role) >= 0"));
t('X5 탭이 없으면 CF_TAB_MISSING, 머리줄 다르면 CF_HEADER', IX.includes("'CF_TAB_MISSING'") && IX.includes("error: 'CF_HEADER'"));
t('X6 getWeeklySalesTest view=confirmed 배선', IX.includes("if (view === 'confirmed') {\n      await confirmedView_(req, res, auth, t0, timings);"));
console.log(`confirmed_sales_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
