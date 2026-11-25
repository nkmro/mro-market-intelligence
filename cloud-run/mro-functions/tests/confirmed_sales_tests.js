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
t('A3 사무소 담당 2명 → 우선 팀장(OFFICE_MANY) + 후보 = 그 사무소 담당', JSON.stringify(cs.assign(P, '동부', { 구매사: 1 })) === JSON.stringify({ office: '창원', manager: '한팀장', why: 'OFFICE_MANY', candidates: ['다담당', '라담당'] }));
t('A7 2026-11-25: 구매담당 본인이 그 팀 담당이면 본인(SELF), 팀장이 고른 담당(FIXED)이 가장 먼저', cs.assign(P, '동부', { 라담당: 2, 구매사: 5 }).manager === '라담당' && cs.assign(P, '동부', { 라담당: 2, 구매사: 5 }).why === 'SELF' &&
  cs.assign(P, '동부', { 구매사: 5 }, '다담당').manager === '다담당' && cs.assign(P, '동부', { 구매사: 5 }, '다담당').why === 'FIXED' && cs.assign(P, '동부', { 구매사: 5 }, '없는사람').why === 'OFFICE_MANY');
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
t('U1 못 이은 시스템 고객사가 있어도 올라감(2026-11-25) — 목록·주간 고객사 이름은 같이, 그 줄 주간고객사명 빈칸', u.ok && u.writes.find(function (w) { return w.values[3] === '세온테크(주)'; }).values[4] === '' && u.unlinked.length === 1 && u.unlinked[0].name === '세온테크(주)' && u.weeklyNames.join() === '다온계열,가람정밀(주),바른전자계열,쉬는고객');
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
// 2026-11-25 재홍님: 비고 = 묶음마다 1줄(실적-확정비고 A:G). 실적-확정 K칸(옛 고객사별 비고)은 화면·확정에 안 씀
const NOTES = [[2026, 10, '동부', '다온계열', '짧음', 'a@nkmro.com', ''], [2026, 9, '동부', '가람정밀(주)', '9월 비고는 10월에 안 보임', 'x', ''], [2026, 10, '동부', '가람정밀(주)', '공구류 단가 인하 영향 반영', 'b@nkmro.com', '']];
// 3) 화면
let v = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF, progRows: PROG, noteRows: NOTES, minNote: 10, me: '가담당', scope: 'all' });
t('V1 묶음 = 주간 고객사 순서, 사용 끔·실적 없는 고객사는 빠짐, 계획은 그 달 칸', v.groups.map(function (g) { return g.name; }).join() === '다온계열,가람정밀(주),바른전자계열' && v.groups[0].planSales === 182000 && v.groups[0].planProfit === 16400);
t('V2 다온계열 = 3곳 합(고친 이익 9000 반영), 고친 칸 표시·시스템 값 남김', v.groups[0].sales === 98420 + 63100 + 6420 && v.groups[0].profit === 9000 + 5480 + 500 && v.groups[0].subs[0].edited && v.groups[0].subs[0].sysProfit === 8830);
t('V3 화면 자료: 사무소는 보임(2026-11-25 재홍님), 담당 이름은 팀장·관리자 화면(withNames)에만', v.groups[0].subs[0].office === '포항' && v.groups[0].subs[0].manager === undefined && v.groups[0].subs[0].mine === true && v.groups[1].subs[0].mine === false);
t('V4 담당 확정 현황 = 담당 이름·확정 여부(칩용)', v.managers.map(function (m) { return m.name + (m.done ? '✓' : ''); }).join() === '가담당,나담당');
const vm = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF, progRows: PROG, minNote: 10, me: '나담당', scope: 'mine' });
t('V5 담당(mine) = 자기 줄만, 합계도 자기 줄', vm.groups.length === 1 && vm.groups[0].name === '가람정밀(주)' && vm.total.sales === 88760);
t('V6 올린 달 목록', cs.monthsOf(CONF.concat([[2026, 9, '동부', 'x']]), 2026, '동부').join() === '9,10');
// 4) 담당 저장
function ed(o) { return cs.planEdit(Object.assign({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, noteRows: NOTES, me: '가담당', isAdmin: false, who: 'a@nkmro.com', nowMs: NOW }, o)); }
let e = ed({ edits: [{ name: '다온강판(주)', profit: '5,210' }] });
t('E1 이익 저장 → J칸(K칸 비고는 안 건드림) + M:O(다시확인 지움), 3행', e.ok && e.writes.length === 2 && e.writes[0].range === 'J3' && e.writes[0].values[0] === 5210 && e.writes[1].range === 'M3:O3' && e.writes[1].values[2] === '' && e.noteWrites.length === 0 && e.rows === 1);
t('E2 매출을 보내면 SALES_LOCKED', ed({ edits: [{ name: '다온강판(주)', sales: 1 }] }).error === 'SALES_LOCKED');
t('E3 남의 고객사 이익 → NOT_MY_CUSTOMER, 관리자는 가능', ed({ edits: [{ name: '가람정밀(주)', profit: '7000' }] }).error === 'NOT_MY_CUSTOMER' && ed({ isAdmin: true, me: '', edits: [{ name: '가람정밀(주)', profit: '7000' }] }).ok);
t('E4 시스템 값과 같은 이익·빈칸 → 고친 값 지움', ed({ edits: [{ name: '다온스틸(주)', profit: '8830' }] }).writes[0].values[0] === '' && ed({ edits: [{ name: '다온스틸(주)', profit: '' }] }).writes[0].values[0] === '');
t('E5 숫자 아님·묶음 비고 201자·없는 고객사·없는 묶음·고객사별 비고는 거절', ed({ edits: [{ name: '다온스틸(주)', profit: 'abc' }] }).error === 'BAD_NUMBER' && ed({ notes: [{ group: '다온계열', note: 'x'.repeat(201) }] }).error === 'NOTE_TOO_LONG' &&
  ed({ edits: [{ name: '없음', profit: '1' }] }).error === 'UNKNOWN_CUSTOMER' && ed({ notes: [{ group: '바른전자계열', note: '실적 없는 묶음' }] }).error === 'UNKNOWN_GROUP' && ed({ notes: [{ group: '', note: 'x' }] }).error === 'UNKNOWN_GROUP' &&
  ed({ edits: [{ name: '다온스틸(주)', note: '고객사별 비고' }] }).error === 'NOTE_PER_GROUP' && ed({}).error === 'NO_CHANGES');
t('E6 바뀐 것 없으면 쓰기 0', (function () { const x = ed({ edits: [{ name: '다온스틸(주)', profit: '9000' }], notes: [{ group: '다온계열', note: ' 짧음 ' }] }); return x.ok && x.writes.length === 0 && x.noteWrites.length === 0; })());
// 5) 확정·취소·최종
function cf(fn, o) { return cs[fn](Object.assign({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, noteRows: NOTES, minNote: 10, who: 'a@nkmro.com', nowMs: NOW }, o)); }
let c = cf('planConfirm', { manager: '가담당' });
t('C1 내 고객사가 든 묶음 비고가 10자 미만이면 NOTE_SHORT(묶음 이름 목록), 나담당은 가람정밀 묶음 비고 14자로 통과', !c.ok && c.error === 'NOTE_SHORT' && c.names.join() === '다온계열' && c.min === 10 && cf('planConfirm', { manager: '나담당' }).ok);
t('C2 최소 글자 0이면 확정 → 실적-확정진행 다음 줄(3행) "담당 확정"', cf('planConfirm', { manager: '가담당', minNote: 0 }).write.range === 'A3:G3' && cf('planConfirm', { manager: '가담당', minNote: 0 }).write.values[3] === '담당 확정');
t('C3 줄 없는 사람 → NO_ROWS', cf('planConfirm', { manager: '모름' }).error === 'NO_ROWS');
PROG = PROG.concat([[2026, 10, '동부', '담당 확정', '나담당', 'b@nkmro.com', '2026-11-03 11:00']]);
t('C4 확정한 담당은 저장 불가(이익 MY_DONE·묶음 비고 GROUP_DONE — 팀장·관리자도)·다시 확정 불가', cs.planEdit({ year: 2026, month: 10, team: '동부', confRows: CONF, progRows: PROG, noteRows: NOTES, me: '나담당', edits: [{ name: '가람정밀(주)', profit: '7000' }] }).error === 'MY_DONE' &&
  ed({ progRows: PROG, me: '나담당', notes: [{ group: '가람정밀(주)', note: '공구류 단가 인하 영향 확인' }] }).error === 'GROUP_DONE' && ed({ progRows: PROG, me: '', isAdmin: true, notes: [{ group: '가람정밀(주)', note: '공구류 단가 인하 영향 확인' }] }).error === 'GROUP_DONE' &&
  cf('planConfirm', { manager: '나담당', progRows: PROG }).error === 'ALREADY_DONE');
t('C5 최종 확정: 남은 담당 있으면 MANAGERS_NOT_DONE', cf('planFinal', { progRows: PROG }).error === 'MANAGERS_NOT_DONE' && cf('planFinal', { progRows: PROG }).names.join() === '가담당');
t('C6 확정 취소: 확정 안 한 사람 NOT_DONE, 한 사람은 "확정 취소"', cf('planCancel', { manager: '가담당', progRows: PROG }).error === 'NOT_DONE' && cf('planCancel', { manager: '나담당', progRows: PROG }).write.values[3] === '확정 취소');
PROG = PROG.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a@nkmro.com', '2026-11-03 12:00']]);
t('C7 모두 확정 → 최종 확정 가능', cf('planFinal', { progRows: PROG }).ok && cf('planFinal', { progRows: PROG }).write.values[3] === '최종 확정');
PROG = PROG.concat([[2026, 10, '동부', '최종 확정', '', 'admin@nkmro.com', '2026-11-05 09:00']]);
t('C8 최종 확정 뒤 저장·확정 취소·최종 다시 → FINAL_DONE', ed({ progRows: PROG, notes: [{ group: '다온계열', note: '바꿈 시험 메모입니다' }] }).error === 'FINAL_DONE' && cf('planCancel', { manager: '가담당', progRows: PROG }).error === 'FINAL_DONE' &&
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
t('X2 confirmedAction_: 올리기·미리보기는 관리자만(잠금 앞), 잠금 안에서 시트 다시 읽기, 쓰기는 perfBatchWrite_ 한 곳', ca.indexOf("['cfPreview', 'cfUpload'].indexOf(b.action) >= 0 && !isAdmin") < ca.indexOf('acquireLock(') &&
  ca.indexOf('acquireLock(') < ca.indexOf('cfFile_(client') && (ca.match(/perfBatchWrite_\(/g) || []).length === 1 && ca.includes('releaseLock(firestore, WEEKLY_LOCK_NAME, holderId)'));
t('X7 최종 확정·고객사 연결 = 그 팀 팀장 + 관리자: 팀장·관리자 외 FORBIDDEN(잠금 앞), 팀장은 cfTeam_으로 맡은 팀만, 화면에 canFinal', ca.indexOf("if (['cfFinal', 'cfLink', 'cfAssign'].indexOf(b.action) >= 0 && !isAdmin && me.role !== '팀장') return { ok: false, error: 'FORBIDDEN' };") >= 0 &&
  ca.indexOf("if (['cfFinal', 'cfLink', 'cfAssign'].indexOf(b.action) >= 0 && !isAdmin") < ca.indexOf('acquireLock(') && ca.indexOf('cfTeam_(me, isAdmin,') > ca.indexOf('acquireLock(') && IX.includes("canFinal: isAdmin || me.role === '팀장'"));
t('X3 확정 = 자기 이름만, 취소 = 관리자만 다른 담당', ca.includes("planConfirm(Object.assign({}, common, { manager: myName,") && ca.includes('manager: isAdmin && b.manager ? b.manager : myName'));
const gv = IX.slice(IX.indexOf('async function confirmedView_'), IX.indexOf('async function confirmedAction_'));
t('X4 보기: 임원 = 최종 확정된 달만, 담당 = mine, 관리자·임원·팀장·담당 외 FORBIDDEN', gv.includes("months.filter(function (m) { return !!confirmedSales.stateOf(f.progRows, year, m, lead.team).final; })") && gv.includes("scope: !isAdmin && me.role === '담당' ? 'mine' : 'all'") &&
  gv.includes("['임원', '팀장', '담당'].indexOf(me.role) >= 0"));
t('X5 탭이 없으면 CF_TAB_MISSING, 머리줄 다르면 CF_HEADER', IX.includes("'CF_TAB_MISSING'") && IX.includes("error: 'CF_HEADER'"));
t('X6 getWeeklySalesTest view=confirmed 배선', IX.includes("if (view === 'confirmed') {\n      await confirmedView_(req, res, auth, t0, timings);"));
// 9) 화면(feed.html, 2026-11-24 3단계) — 엑셀 합계·바뀐 값·배선
const FH = require('fs').readFileSync(require('path').join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
function uiGrab(name) { const i = FH.indexOf('function ' + name + '('); const st = FH.lastIndexOf('\n', i) + 1; let d = 0; const j = FH.indexOf('{', i); for (let k = j; k < FH.length; k++) { if (FH[k] === '{') d++; else if (FH[k] === '}') { d--; if (!d) return FH.slice(st, k + 1); } } }
const colsLine = FH.slice(FH.indexOf('const CF_COLS_'), FH.indexOf('\n', FH.indexOf('const CF_COLS_')));
const agg = new Function(colsLine + ';' + uiGrab('cfCell_') + ';' + uiGrab('cfAggregate_') + '; return cfAggregate_;')();
const HEAD = ['상태명', '구매담당', '실적부서명', '매출금액_원화', '매입금액_원화', '구매사명', '매출마감일', '매입마감일'];
let g = agg([HEAD, ['x', '구매일', '동부지역', '1,000,400', '900,000', '가사', '2026/10/16', '2026/11/03'], ['x', '구매이', '동부지역', '500000', '0', '가사 ', '2026/10/31', ''], ['x', '', '서부지역', '2000', '1000', '나사', '2026/10/02', '2026/11/01']]);
t('F1 엑셀 합계: 팀(동부지역→동부)·구매사명별(앞뒤 빈칸 합침)·천원 반올림·이익=매출-매입·미마감 줄·구매담당 줄 수', g.rows === 3 && g.year === 2026 && g.month === 10 && Object.keys(g.teams).join() === '동부,서부' &&
  JSON.stringify(g.teams['동부']) === JSON.stringify([{ name: '가사', sales: 1500, profit: 600, unclosed: 1, buyers: { 구매일: 1, 구매이: 1 } }]) && g.teams['서부'][0].sales === 2);
t('F2 매출마감월이 둘 이상이면 거절, 머리줄 칸이 없으면 칸 이름을 알려 줌, 엑셀 날짜 숫자도 읽음', /여러 개/.test(agg([HEAD, ['x', 'a', '동부', '1', '1', '가', '2026/10/01', ''], ['x', 'a', '동부', '1', '1', '가', '2026/11/01', '']]).error) &&
  /매입마감일/.test(agg([HEAD.slice(0, 7), ['x']]).error) && agg([HEAD, ['x', 'a', '동부', '1000', '0', '가', '46310', '']]).month === 10);
t('F3 엑셀 읽기: 외부 도구 없이 zip(deflate-raw)·inlineStr·공유 글자', FH.includes("new DecompressionStream('deflate-raw')") && FH.includes("if (t === 'inlineStr')") && FH.includes("if (t === 's') v = shared[Number(v)]") && !FH.includes('exceljs.min.js'));
t('F4 메뉴: 주간 실적 다음·실적 설정 앞, 관리자·임원·팀장·담당(주간 실적과 같은 조건), 확정·주간 실적 화면만 넓힘(2026-11-25 같은 폭)', FH.indexOf('id="nav-weekly"') < FH.indexOf('id="nav-confirmed"') && FH.indexOf('id="nav-confirmed"') < FH.indexOf('id="nav-sales-settings"') &&
  FH.includes("document.getElementById('nav-confirmed').style.display = 'flex';") && FH.includes("if (view === 'confirmed') {\nloadConfirmedPage();") && FH.includes("classList.toggle('main-wide', view === 'confirmed' || view === 'weekly')") && FH.includes('#weekly-view .pf-wrap { max-width: none; }'));
t('F5 화면에 담당·사무소 칸 없음(표 머리), 매출은 입력 칸 없음', !uiGrab('cfTable_').includes('사무소') && !/<th[^>]*>담당/.test(uiGrab('cfTable_')) && (uiGrab('cfTable_').match(/class="cf-in/g) || []).length === 1);
const chg = new Function('cf_', uiGrab('cfChanges_') + '; return cfChanges_();');
const RES = { data: { groups: [{ subs: [{ name: 'A', edited: false, profit: 100, sysProfit: 100, note: '메모' }, { name: 'B', edited: true, profit: 90, sysProfit: 100, note: '' }] }] } };
t('F6 바뀐 값: 쉼표 무시·시스템 값 그대로는 안 보냄·고친 값을 시스템 값으로 되돌리면 보냄(고객사별 비고는 안 보냄)', JSON.stringify(chg({ res: RES, edits: { A: { profit: '100' }, B: { profit: '1,00' } } })) === JSON.stringify([{ name: 'B', profit: '100' }]) &&
  JSON.stringify(chg({ res: RES, edits: { A: { profit: '1,234', note: ' 새 메모 ' } } })) === JSON.stringify([{ name: 'A', profit: '1234' }]));
t('F7 [최종 확정] 버튼 = canFinal(팀장·관리자), 단계 이름 "③ 팀장 최종 확정"', uiGrab('cfBar_').includes('if (r.canFinal && !d.final) {') && uiGrab('cfSteps_').includes('③ 팀장 최종 확정') && !FH.includes('관리자 최종 확정'));
// 10) 2026-11-25 재홍님: 연결 안 돼도 올라감 · 팀장이 화면에서 연결 · 연결 안 된 곳이 있으면 최종 확정 막힘 · 파일 안 팀을 한 번에(관리자만)
{
const UP = up({});
const CONF3 = UP.writes.map(function (w) { return w.values.slice(); });
const PROG3 = [[2026, 10, '동부', '올림', '', 'admin@nkmro.com', '']];
const v3 = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF3, progRows: PROG3, minNote: 10, me: '', scope: 'all', withNames: true });
const lg = v3.groups[v3.groups.length - 1];
t('L1 연결 안 된 곳 = 맨 아래 "연결 안 된 고객사" 묶음(계획 없음), unlinked 목록·고르기 이름(팀장·관리자 화면만)', lg.unlinked === true && lg.name === cs.UNLINKED_GROUP && lg.planSales === null && lg.subs[0].name === '세온테크(주)' &&
  v3.unlinked.length === 1 && v3.unlinked[0].name === '세온테크(주)' && v3.weeklyNames.indexOf('다온계열') === 0 &&
  cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF3, progRows: PROG3, minNote: 10, me: '', scope: 'all' }).weeklyNames === undefined);
function lk(o) { return cs.planLink(Object.assign({ year: 2026, month: 10, team: '동부', confRows: CONF3, linkRows: LINKS, progRows: PROG3, customers: CUST, who: 'Lead@nkmro.com', nowMs: NOW }, o)); }
const L = lk({ links: { '세온테크(주)': '다온계열' } });
t('L2 연결: 그 달 실적-확정 E칸 + 연결 탭 새 줄(다음 달부터 자동)', L.ok && L.writes.length === 1 && L.writes[0].range === 'E5' && L.writes[0].values[0] === '다온계열' && L.linkWrites[0].range === 'A4:E4' && L.linkWrites[0].values.slice(0, 4).join() === '세온테크(주),동부,다온계열,lead@nkmro.com' && L.months.join() === '10');
t('L3 연결 검사: 없는 주간 고객사 BAD_LINK, 어느 달에도 없는 고객사 UNKNOWN_CUSTOMER, 빈 목록 NO_CHANGES, 새 고객사로 따로 = 자기 이름, 올린 달이 아니면 NO_DATA',
  lk({ links: { '세온테크(주)': '없음' } }).error === 'BAD_LINK' && lk({ links: { '없는회사': '다온계열' } }).error === 'UNKNOWN_CUSTOMER' && lk({ links: {} }).error === 'NO_CHANGES' &&
  lk({ links: { '세온테크(주)': '세온테크(주)' } }).ok && lk({ month: 11, links: { '세온테크(주)': '다온계열' } }).error === 'NO_DATA');
// 9월(최종 확정)·10월(확정 전)·11월(확정 전)에 같은 고객사 — 11월에서 고치면 10·11월만, 9월은 그대로
const C9 = CONF3.map(function (r) { const x = r.slice(); x[1] = 9; return x; }), C11 = CONF3.map(function (r) { const x = r.slice(); x[1] = 11; return x; });
const MULTI = C9.concat(CONF3).concat(C11), PM = PROG3.concat([[2026, 9, '동부', '올림', '', 'x', ''], [2026, 9, '동부', '최종 확정', '', 'x', ''], [2026, 11, '동부', '올림', '', 'x', '']]);
const LM = lk({ month: 11, confRows: MULTI, progRows: PM, links: { '세온테크(주)': '다온계열', '다온스틸(주)': '가람정밀(주)' } });
t('L2b 2026-11-25 재홍님: 연결·연결 고치기는 최종 확정 전인 모든 달(10·11월)에 적용, 최종 확정된 9월은 그대로', LM.ok && LM.months.join() === '10,11' && LM.kept.join() === '9' &&
  LM.writes.length === 4 && LM.writes.every(function (w) { const row = Number(w.range.slice(1)); return row > 5; }) &&
  LM.linkWrites.length === 2 && LM.linkWrites[1].values[2] === '가람정밀(주)');
t('L2c 최종 확정된 달에서 고쳐도 됨 — 그 달 줄은 안 바꾸고 연결 탭·확정 전인 달만', (function () { const x = lk({ month: 9, confRows: MULTI, progRows: PM, links: { '세온테크(주)': '다온계열' } }); return x.ok && x.months.join() === '10,11' && x.writes.length === 2 && x.linkWrites.length === 1; })());
const PROG4 = PROG3.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a', ''], [2026, 10, '동부', '담당 확정', '나담당', 'b', '']]);
t('L4 담당이 모두 확정해도 연결 안 된 곳이 있으면 최종 확정 막힘(UNLINKED_LEFT 이름 목록), 연결하면 됨', cf('planFinal', { confRows: CONF3, progRows: PROG4 }).error === 'UNLINKED_LEFT' && cf('planFinal', { confRows: CONF3, progRows: PROG4 }).names.join() === '세온테크(주)' &&
  cf('planFinal', { confRows: CONF3.map(function (r) { const x = r.slice(); if (!x[4]) x[4] = '다온계열'; return x; }), progRows: PROG4 }).ok);
t('L5 index: cfLink 동작·연결 탭·E칸 쓰기 1번, 보기에 canLink·withNames(팀장·관리자)', IX.includes("'cfFinal', 'cfLink', 'cfAssign']") && IX.includes('confirmedSales.planLink(') && IX.includes("canLink: isAdmin || me.role === '팀장'") && IX.includes("withNames: isAdmin || me.role === '팀장'"));
t('L6 화면: 올리기는 관리자만(버튼은 isAdmin일 때만), 파일 안 팀 한 번에, 팀마다 고른 연결 기억, 연결 저장·최종 확정 막힘 안내', FH.includes('if (r.isAdmin) h += cfUpHtml_(d);') && uiGrab('cfUpApply_').includes("action: 'cfUpload'") && uiGrab('cfUpApply_').includes('for (let i = 0; i < teams.length; i++)') &&
  uiGrab('cfUpTeam_').indexOf('links = {}') < 0 && uiGrab('cfLinkSave_').includes("action: 'cfLink'") && uiGrab('cfBar_').includes('연결해야 누를 수 있어요'));
}
t('L7 미리보기에서는 연결을 고르지 않음(팀장이 화면에서), 연결 고치기 = 전체 목록·주간 고객사와 같은 이름이면 "새 고객사로 따로" 중복 없음', !uiGrab('cfUpHtml_').includes('<select') && uiGrab('cfLinkHtml_').includes('cfRelink_(true)') && uiGrab('cfLinkHtml_').includes("(d.weeklyNames || []).indexOf(n) >= 0 ? ''"));
// 11) 2026-11-25 재홍님: 사무소 담당 2명 이상이면 팀장이 고름(기억)
{
const U2 = U.concat([['k2@nkmro.com', '카담당', '담당', '동부', '활성', '', '', '', '', '대구']]);
const UPa = up({ userRows: U2, links: { '세온테크(주)': '다온계열' } });
const CA = UPa.writes.map(function (w) { return w.values.slice(); }), PA = [[2026, 10, '동부', '올림', '', 'x', '']];
const va = cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CA, progRows: PA, minNote: 10, me: '', scope: 'all', withNames: true, userRows: U2, mgrRows: [] });
t('M1 대구 담당 2명(나담당·카담당) → 가람정밀은 우선 팀장, 담당 정하기 목록에 후보 2명 · 팀 담당 목록(+팀장)', CA.find(function (r) { return r[3] === '가람정밀(주)'; })[6] === '한팀장' &&
  va.mgrChoices.length === 1 && va.mgrChoices[0].name === '가람정밀(주)' && va.mgrChoices[0].candidates.join() === '나담당,카담당' && va.teamManagers.indexOf('한팀장') >= 0 && va.groups[1].subs[0].manager === '한팀장');
function as(o) { return cs.planAssign(Object.assign({ year: 2026, month: 10, team: '동부', confRows: CA, progRows: PA, mgrRows: [], userRows: U2, who: 'L@nkmro.com', nowMs: NOW }, o)); }
const A1 = as({ picks: { '가람정밀(주)': '카담당' } });
t('M2 담당 저장: 실적-담당지정 새 줄(기억) + 확정 전인 달 G칸', A1.ok && A1.mgrWrites[0].range === 'A2:E2' && A1.mgrWrites[0].values.slice(0, 3).join() === '가람정밀(주),동부,카담당' && A1.writes[0].range === 'G4' && A1.writes[0].values[0] === '카담당' && A1.months.join() === '10');
t('M3 검사: 팀 담당·팀장이 아니면 BAD_MANAGER, 없는 고객사 UNKNOWN_CUSTOMER, 빈 목록 NO_CHANGES', as({ picks: { '가람정밀(주)': '임원일' } }).error === 'BAD_MANAGER' && as({ picks: { '없음': '카담당' } }).error === 'UNKNOWN_CUSTOMER' && as({ picks: {} }).error === 'NO_CHANGES');
t('M4 새 담당이 이미 확정했으면 그 담당 확정 다시 열림', (function () { const x = as({ progRows: PA.concat([[2026, 10, '동부', '담당 확정', '카담당', 'k', '']]), picks: { '가람정밀(주)': '카담당' } }); return x.ok && x.progWrites.length === 1 && x.progWrites[0].values[3] === '확정 다시 열림' && x.progWrites[0].values[4] === '카담당'; })());
const MG = [['가람정밀(주)', '동부', '카담당', 'x', '']];
t('M5 기억한 담당 → 다음 달 올릴 때 바로 그 담당(담당 정하기 목록에서도 빠짐)', (function () { const u = up({ month: 11, userRows: U2, mgrRows: MG, links: { '세온테크(주)': '다온계열' } }); return u.writes.find(function (w) { return w.values[3] === '가람정밀(주)'; }).values[6] === '카담당'; })() &&
  cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CA, progRows: PA, minNote: 10, me: '', scope: 'all', withNames: true, userRows: U2, mgrRows: MG }).mgrChoices.length === 0);
t('M6 탭 4개(실적-담당지정 머리줄 5칸), index cfAssign·담당지정 읽기, 화면 담당 정하기·사무소 표시', cs.CF_TABS.length === 5 && cs.CF_HEADERS[cs.TAB_MGR].join() === '시스템구매사명,팀,담당,등록자,등록일시' &&
  IX.includes('confirmedSales.planAssign(') && IX.includes("q(confirmedSales.TAB_MGR) + '!A2:E'") && IX.includes('v(8 + i)') && uiGrab('cfMgrSave_').includes("action: 'cfAssign'") && uiGrab('cfTable_').includes('cf-off'));
}
// 12) 2026-11-25 재홍님: 비고는 묶음(취합 고객사)마다 1칸 — 탭 실적-확정비고, 출력 때 묶음 줄에 나옴
{
t('N1 탭 5개 — 실적-확정비고 머리줄 7칸', cs.CF_TABS.indexOf(cs.TAB_NOTE) === 4 && cs.CF_HEADERS[cs.TAB_NOTE].join() === '연도,월,팀,주간고객사명,비고,수정자,수정일시');
t('N2 화면: 묶음마다 비고(그 연·월·팀만, 아래 줄이 이김), 고객사 줄에는 비고 없음, 연결 안 된 묶음도 없음', v.groups[0].note === '짧음' && v.groups[1].note === '공구류 단가 인하 영향 반영' && v.groups[2].note === '' && !('note' in v.groups[0].subs[0]) &&
  cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF, progRows: PROG, noteRows: NOTES.concat([[2026, 10, '동부지역', '다온계열', '아래 줄이 이겨요 비고', 'x', '']]), minNote: 10, me: '', scope: 'all' }).groups[0].note === '아래 줄이 이겨요 비고');
const P0 = [[2026, 10, '동부', '올림', '', 'x', '']];
const n1 = ed({ progRows: P0, notes: [{ group: '다온계열', note: '설비 교체 수요 증가, 미마감 1건 반영' }] });
t('N3 있던 묶음 비고 고침 → 실적-확정비고 그 줄(2행) A:G, 실적-확정은 안 씀', n1.ok && n1.noteWrites.length === 1 && n1.noteWrites[0].range === 'A2:G2' && n1.noteWrites[0].values.join('|') === '2026|10|동부|다온계열|설비 교체 수요 증가, 미마감 1건 반영|a@nkmro.com|2026-11-03 10:00' && n1.writes.length === 0 && n1.notes === 1);
const CONFb = CONF.map(function (r) { return r.slice(); }); CONFb[2][4] = '바른전자계열';
const n2 = ed({ progRows: P0, confRows: CONFb, isAdmin: true, me: '', notes: [{ group: '바른전자계열', note: '신규 묶음 비고 테스트입니다' }] });
t('N4 처음 쓰는 묶음 → 실적-확정비고 다음 빈 줄(5행)', n2.ok && n2.noteWrites[0].range === 'A5:G5' && n2.noteWrites[0].values[3] === '바른전자계열');
t('N5 쓰는 사람: 그 묶음에 내 고객사가 있는 담당·그 팀 팀장(isLead)·관리자 — 다른 담당은 NOT_MY_CUSTOMER', ed({ progRows: P0, notes: [{ group: '가람정밀(주)', note: '남의 묶음 비고 시험' }] }).error === 'NOT_MY_CUSTOMER' &&
  ed({ progRows: P0, me: '한팀장', isLead: true, notes: [{ group: '가람정밀(주)', note: '팀장이 쓴 묶음 비고' }] }).ok && ed({ progRows: P0, me: '', isAdmin: true, notes: [{ group: '가람정밀(주)', note: '관리자가 쓴 묶음 비고' }] }).ok);
const CONFr = CONF.map(function (r) { return r.slice(); }); CONFr[1][14] = '매출 1→2';
const n3 = ed({ progRows: P0, confRows: CONFr, notes: [{ group: '다온계열', note: '다시 확인 뒤 비고 저장' }], edits: [{ name: '다온스틸(주)', profit: '9100' }] });
t('N6 이익+묶음 비고 같이 저장, 묶음 비고 저장 = 그 묶음 "다시확인" 지움(O3)', n3.ok && n3.writes.some(function (w) { return w.range === 'J2' && w.values[0] === 9100; }) && n3.writes.some(function (w) { return w.range === 'O3' && w.values[0] === ''; }) && n3.noteWrites.length === 1 && n3.rows === 2);
t('N7 다시 올리기·연결 고치기는 묶음 비고를 안 건드림(묶음 이름으로 붙어 있음) — 연결 고치면 옮겨 간 묶음 비고를 따름', !('noteWrites' in up({})) && (function () { const x = cs.planLink({ year: 2026, month: 10, team: '동부', confRows: CONF, linkRows: LINKS, progRows: P0, customers: CUST, links: { '세온테크(주)': '가람정밀(주)' }, who: 'x', nowMs: NOW }); return x.ok && x.writes.length === 1 && x.writes[0].range === 'E5'; })() &&
  cs.buildView({ year: 2026, month: 10, team: '동부', customers: CUST, planRows: PLAN, confRows: CONF.map(function (r, i) { const x = r.slice(); if (i === 3) x[4] = '가람정밀(주)'; return x; }), progRows: P0, noteRows: NOTES, minNote: 10, me: '', scope: 'all' }).groups[1].note === '공구류 단가 인하 영향 반영');
t('N8 index: 실적-확정비고 A2:G 읽기·planEdit에 notes·noteRows·isLead(팀장), 확정에 noteRows, 쓰기는 같은 batch 1번', IX.includes("q(confirmedSales.TAB_NOTE) + '!A2:G'") && IX.includes('noteRows: v(7)') && IX.includes("notes: b.notes, noteRows: f.noteRows, me: myName, isAdmin: isAdmin, isLead: !isAdmin && me.role === '팀장'") &&
  IX.includes("minNote: f.settings.확정비고최소글자, noteRows: f.noteRows }") && IX.includes("q(confirmedSales.TAB_NOTE) + '!' + w.range") && IX.includes('mgrRows: f.mgrRows, noteRows: f.noteRows });'));
t('N9 화면: 비고 칸은 묶음 줄에만(고객사 줄 입력 없음), 확정 조건 = 내 고객사 든 묶음, 저장에 notes', !uiGrab('cfTable_').includes('class="cf-note ') && uiGrab('cfGroupNote_').includes('cfNoteEdit_(') && uiGrab('cfBar_').includes('myGroups') && uiGrab('cfSaveEdits_').includes("edits: ch, notes: nch") &&
  uiGrab('cfCanNote_').includes('!g.unlinked') && uiGrab('cfCanNote_').includes("session.role === '팀장'") && uiGrab('cfCanNote_').includes('!g.subs.some(function (s) { return s.done; })'));
}
console.log(`confirmed_sales_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
