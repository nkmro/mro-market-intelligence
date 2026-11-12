// node tests/performance_view_tests.js — 성과평가 1-다 보기 응답(lib/performance.js buildView 등) 시험. 시트·네트워크 없음.
// 숫자는 모두 시험용으로 만든 예시다(실제 실적 아님 — 회사 실적은 저장소에 올리지 않는다, performance_calc_tests.js 상단 방침).
// 핵심: 숫자를 볼 수 없는 사람(공개 기간 밖 팀원)의 응답 JSON에 매출·이익·인원·비율이 "아예 없는지"를 문자열로 확인한다.
const p = require('../lib/performance');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); } }
const G4 = '110:100, 100:90, 90:80, 나머지:70', G3 = '110:100, 100:90, 나머지:80';
const CRIT = p.parseCriteria([['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'],
  ['전년 실적 대비 성장률', 0.5, 'sales', '매출액 성장', 0.3, G4], ['전년 실적 대비 성장률', 0.5, 'profit', '매출이익 성장', 0.3, G4],
  ['전년 실적 대비 성장률', 0.5, 'margin', '이익률 성장(%)', 0.1, G4], ['전년 실적 대비 성장률', 0.5, 'perHead', '인당 이익금 성장', 0.3, G4],
  ['사업부문 영업이익 성장률', 0.1, 'teamOp', '팀 경상이익 성장률', 1, G3]]);
const U = function (email, name, role, team, status, office) { return { email: email, name: name, role: role, team: team, status: status, office: office || '' }; };

// ── 사무소 단위 팀(가나다 예시 사무소). 매출은 일부러 7자리 고유 숫자(응답 JSON에서 찾기 쉽게)
const users = [U('lead@x', '팀장A', '팀장', '가팀'), U('a1@x', '김가', '일반', '가팀', '활성', '나사무소'), U('a2@x', '이가', '담당', '가팀', '활성', '나사무소'),
  U('a3@x', '박가', '일반', '가팀', '활성', '다사무소'), U('a4@x', '최가', '일반', '가팀', '활성', ''), U('a5@x', '정가', '일반', '가팀', '활성', '라사무소'),
  U('b1@x', '서가', '일반', '나팀', '활성', '')];
const rows = [
  [2026, 1, '가팀', '사무소', '나사무소', '나사무소', 1111111, 111111, 2], [2025, 1, '가팀', '사무소', '나사무소', '나사무소', 1000003, 100003, 2],
  [2026, 2, '가팀', '사무소', '나사무소', '나사무소', 1222221, 122221, 2], [2025, 2, '가팀', '사무소', '나사무소', '나사무소', 1000007, 100007, 2],
  [2026, 1, '가팀', '사무소', '다사무소', '다사무소', 2333331, 233331, 1], [2025, 1, '가팀', '사무소', '다사무소', '다사무소', 2000009, 200009, 1],
  [2026, 2, '가팀', '사무소', '다사무소', '다사무소', 2444441, 244441, 1], [2025, 2, '가팀', '사무소', '다사무소', '다사무소', 2000011, 200011, 1],
  [2026, 1, '가팀', '팀비용', '', '', '', 50013, ''], [2025, 1, '가팀', '팀비용', '', '', '', 50017, ''],
  [2026, 2, '가팀', '팀비용', '', '', '', 50019, ''], [2025, 2, '가팀', '팀비용', '', '', '', 50023, ''],
  [2026, 1, '나팀', '사무소', '나사무소', '나사무소', 9876543, 987654, 9], [2025, 1, '나팀', '사무소', '나사무소', '나사무소', 9765431, 976543, 9],
  [2026, 3, '가팀', '사무소', '나사무소', '나사무소', 7777771, 777771, 2]]; // 3월 = 마감 전 달
const close = [[2026, '가팀', 2, 'lead@x', '2026-03-10 09:30', '2월 마감'], [2026, '나팀', 1, 'x', '2026-02-05 10:00', '']];
const base = { criteria: CRIT, mode: '사무소', team: '가팀', year: 2026, users: users, closeRows: close, rows: rows, prevRows: null, publishDays: 1, myKey: '나사무소' };
const SECRET = ['1111111', '1222221', '2333331', '2444441', '1000003', '111111', '233331', '50013', '50019', '7777771', '9876543'];
const leaks = function (o) { const s = JSON.stringify(o); return SECRET.filter(function (n) { return s.indexOf(n) >= 0; }); };

// W: 공개 기간 (마감 3/10, N=1 → 3/11까지)
let v = p.buildView(Object.assign({}, base, { today: '2026-03-12', showAll: false }));
t('W1 공개 기간 밖 팀원: 계산 성공·마감 2월·공개 끝 3/11', v.ok && v.scored && v.closeMonth === 2 && v.publish.open === false && v.publish.until === '2026-03-11' && v.showNumbers === false, v);
t('W2 공개 기간 밖 팀원 응답 JSON에 매출·이익·비용 숫자가 하나도 없음', leaks(v).length === 0, leaks(v));
t('W3 공개 기간 밖: 단위에 P·C·인원월수 없음, 항목에 비율 없음, 팀 점수는 등급·점수만', v.units.every(function (u) { return u.P === undefined && u.C === undefined && u.prevMonths === undefined && (u.items || []).every(function (i) { return i.ratio === undefined; }); }) && Object.keys(v.teamScore).sort().join() === 'grade,pts', v.teamScore);
t('W4 공개 기간 밖에도 점수·순위는 있음', v.units.filter(function (u) { return u.total !== null; }).every(function (u) { return typeof u.total === 'number' && u.rank >= 1; }));
v = p.buildView(Object.assign({}, base, { today: '2026-03-10', showAll: false }));
t('W5 마감한 날 당일 = 공개', v.publish.open && v.showNumbers && v.units[0].P && v.teamScore.curOp !== undefined);
v = p.buildView(Object.assign({}, base, { today: '2026-03-11', showAll: false }));
t('W6 마감 + 1일(3/11) = 공개', v.publish.open === true);
v = p.buildView(Object.assign({}, base, { today: '2026-03-12', showAll: true }));
t('W7 팀장·임원(showAll): 공개 기간 밖에도 숫자 있음', v.showNumbers && v.units[0].P.sales > 0 && v.teamScore.prevOp !== undefined && v.units[0].items[0].ratio !== undefined);
v = p.buildView(Object.assign({}, base, { today: '2026-03-10', showAll: false, publishDays: 0 }));
t('W8 공개 일수 0 = 마감 당일에도 숫자 없음', v.publish.open === false && leaks(v).length === 0);

// X: 다른 팀·마감 전 달이 섞이지 않음
v = p.buildView(Object.assign({}, base, { today: '2026-03-10', showAll: true }));
const s = JSON.stringify(v);
t('X1 가팀 응답에 나팀 숫자(9876543·987654) 없음', s.indexOf('9876543') < 0 && s.indexOf('987654') < 0);
t('X2 마감 전 달(3월 7777771) 숫자 없음 — 2월 누계 1111111+1222221', s.indexOf('7777771') < 0 && v.units.filter(function (u) { return u.key === '나사무소'; })[0].C.sales === 2333332);
t('X3 팀 경상이익 = 가팀 이익 − 가팀 비용만', v.teamScore.curProfit === 111111 + 122221 + 233331 + 244441 && v.teamScore.curCost === 50013 + 50019);

// O: 사무소 행 구성
const names = v.units.map(function (u) { return u.key; }).join();
t('O1 사무소 행 = 실적 있는 사무소 + J열 사무소(라사무소, 실적 없음) 가나다순', names === '나사무소,다사무소,라사무소', names);
const ra = v.units[2];
t('O2 실적 없는 J열 사무소 → 전년 실적 없음·합계 없음·순위 없음', ra.noPrev && ra.total === null && ra.rank === null && ra.items === null);
t('O3 사무소 인원 = 활성 일반·담당 J열 수(나사무소 2, 다사무소 1, 라사무소 1)', v.units.map(function (u) { return u.members; }).join() === '2,1,1');
t('O4 사무소 미지정 활성 팀원 1명(최가)', v.unassigned === 1);
t('O5 순위 분모 2(라사무소 제외)', v.rankCount === 2);
t('O6 지난 마감(1월) 대비: prevTotal 있음', v.units[0].prevTotal !== null && typeof v.units[0].prevTotal === 'number');
t('O7 항목 만점 15/15/5/15/10, 합계 60', v.items.map(function (i) { return i.maxPts; }).join() === '15,15,5,15,10' && v.maxPoints === 60);

// C: 마감 없음·기준 오류
v = p.buildView(Object.assign({}, base, { year: 2026, team: '다팀', today: '2026-03-12', showAll: false }));
t('C1 마감 줄 없는 팀 → scored false, 단위 없음, 숫자 없음', v.ok && v.scored === false && v.units.length === 0 && v.closeMonth === null && leaks(v).length === 0);
v = p.buildView(Object.assign({}, base, { criteria: p.parseCriteria([['h'], ['성장', 0.5, 'sales', '매출', 0.4, G4]]), today: '2026-03-12' }));
t('C2 기준표 오류 → PERF_CRITERIA_INVALID, 점수 없음', v.ok === false && v.error === 'PERF_CRITERIA_INVALID' && v.units === undefined);
t('C3 마감 월이 숫자가 아니면 마감 없음', p.readClose([[2026, '가팀', '구월', '', '', '']], '가팀', 2026).month === null);
t('C4 같은 팀·연도 줄이 여럿이면 아래 줄', p.readClose([[2026, '가팀', 1, '', '2026-02-01', ''], [2026, '가팀', 3, '', '2026-04-02', '']], '가팀', 2026).month === 3);

// D: 마감일시 칸 모양
const serial = (Date.UTC(2026, 9, 14, 10, 5) - Date.UTC(1899, 11, 30)) / 86400000;
t('D1 시리얼 숫자 → 2026-10-14 10:05', p.closeStamp(serial).text === '2026-10-14 10:05', p.closeStamp(serial));
t('D2 글자 "2026. 10. 4 9:05" → 2026-10-04 09:05', p.closeStamp('2026. 10. 4 9:05').text === '2026-10-04 09:05');
t('D3 공개 끝 날짜 월말 넘김(10/31 + 1 = 11/01)', p.publishWindow('2026-10-31', 1, '2026-11-01').open && p.publishWindow('2026-10-31', 1, '2026-11-02').open === false);
t('D4 마감일을 모르면 공개 안 함', p.publishWindow('', 7, '2026-10-01').open === false);

// P: 전년 줄 출처(5-1)
const cur = [[2026, 1, '가팀', '사무소', '나사무소', '', 10, 1, 1], [2025, 1, '가팀', '사무소', '나사무소', '', 999, 99, 1]];
const prevFile = [[2025, 1, '가팀', '사무소', '나사무소', '', 8, 1, 1], [2026, 1, '가팀', '사무소', '나사무소', '', 555, 5, 1]];
t('P1 전년도 파일이 있으면 전년은 거기서만(이 파일 2025 줄 무시)', JSON.stringify(p.pickRows(cur, prevFile, 2026)) === JSON.stringify([cur[0], prevFile[0]]));
t('P2 전년도 파일이 없으면 이 파일의 전년 줄', JSON.stringify(p.pickRows(cur, null, 2026)) === JSON.stringify([cur[0], cur[1]]));

// I: 개인 단위 팀(가짜 데이터) — 퇴사자·실적 없는 팀원·이메일 대소문자
const iu = [U('lead2@x', '팀장B', '팀장', '마팀'), U('kim@x', '김하나', '일반', '마팀', '활성'), U('Lee@X', '이두리', '담당', '마팀', '활성'),
  U('park@x', '박세찌', '일반', '마팀', '비활성'), U('new@x', '최새로', '일반', '마팀', '활성')];
const ir = [];
[['kim@x', 100, 10], ['lee@x', 200, 30], ['PARK@X', 150, 20]].forEach(function (a) {
  ir.push([2026, 1, '마팀', '개인', a[0], '', a[1] * 1.2, a[2] * 1.2, '']); ir.push([2025, 1, '마팀', '개인', a[0], '', a[1], a[2], '']);
});
ir.push([2026, 1, '마팀', '팀비용', '', '', '', 20, '']); ir.push([2025, 1, '마팀', '팀비용', '', '', '', 20, '']);
v = p.buildView({ criteria: CRIT, mode: '개인', team: '마팀', year: 2026, users: iu, closeRows: [[2026, '마팀', 1, '', '2026-02-03', '']], rows: ir, prevRows: null, publishDays: 1, today: '2026-02-20', showAll: false, myKey: 'kim@x' });
const ik = {}; v.units.forEach(function (u) { ik[u.key] = u; });
t('I1 행 = 팀원 이름 가나다(김하나·박세찌·이두리·최새로)', v.units.map(function (u) { return u.name; }).join() === '김하나,박세찌,이두리,최새로', v.units.map(function (u) { return u.name; }));
t('I2 이메일 대소문자 무시(Lee@X 명단 ↔ lee@x 실적)', ik['lee@x'] && !ik['lee@x'].noPrev && ik['lee@x'].left === false);
t('I3 퇴사자(비활성): 합계는 있고 순위 없음·left', ik['park@x'].left === true && ik['park@x'].total !== null && ik['park@x'].rank === null);
t('I4 실적 없는 신규 팀원: 전년 실적 없음', ik['new@x'].noPrev && ik['new@x'].rank === null);
t('I5 순위 분모 2(김하나·이두리), 모두 120% → 동점 1위', v.rankCount === 2 && ik['kim@x'].rank === 1 && ik['lee@x'].rank === 1);
t('I6 개인 팀 공개 기간 밖: 숫자 없음', v.showNumbers === false && JSON.stringify(v).indexOf('"P"') < 0 && v.units.every(function (u) { return u.members === undefined; }));
t('I7 팀 이익에 퇴사자 이익 포함(10+30+20)×1.2 = 72', p.buildView({ criteria: CRIT, mode: '개인', team: '마팀', year: 2026, users: iu, closeRows: [[2026, '마팀', 1, '', '2026-02-03', '']], rows: ir, prevRows: null, publishDays: 1, today: '2026-02-20', showAll: true }).teamScore.curProfit === 72);

// C_order: scoreTeam 출력 순서 = 입력 순서(가나다가 아닌 순서로 넣어도) + buildView는 키로 members·left를 붙임(1-다 커밋 전 확인 1)
const z = function () { return new Array(12).fill(0); };
const mkU = function (k, s) { const o = { key: k, name: k, cur: { sales: z(), profit: z(), heads: z() }, prev: { sales: z(), profit: z(), heads: z() } }; o.cur.sales[0] = s; o.cur.profit[0] = s / 10; o.cur.heads[0] = 1; o.prev.sales[0] = 100; o.prev.profit[0] = 10; o.prev.heads[0] = 1; return o; };
const so = p.scoreTeam({ criteria: CRIT, closeMonth: 1, teamCost: { cur: z(), prev: z() }, units: [mkU('하', 90), mkU('가', 130), mkU('마', 100), mkU('나', 50)] });
t('C_order1 scoreTeam 출력 순서 = 입력 순서(하·가·마·나)', so.units.map(function (u) { return u.key; }).join() === '하,가,마,나');
v = p.buildView(Object.assign({}, base, { today: '2026-03-12', showAll: true }));
const mem = {}; users.forEach(function (u) { if (u.team === '가팀' && u.status === '활성' && u.office) mem[u.office] = (mem[u.office] || 0) + 1; });
t('C_order2 buildView 단위마다 members = 그 사무소 J열 인원(키로 맞춤)', v.units.every(function (u) { return u.members === (mem[u.key] || 0); }), v.units.map(function (u) { return [u.key, u.members]; }));
v = p.buildView({ criteria: CRIT, mode: '개인', team: '마팀', year: 2026, users: iu, closeRows: [[2026, '마팀', 1, '', '2026-02-03', '']], rows: ir, prevRows: null, publishDays: 1, today: '2026-02-20', showAll: true });
t('C_order3 개인 팀: left는 비활성 박세찌에게만(키로 맞춤)', v.units.filter(function (u) { return u.left; }).map(function (u) { return u.name; }).join() === '박세찌');

// T: 임원 팀 칩
t('T1 팀 칩 = 활성 일반·담당·팀장이 있는 팀 가나다순', p.teamsOf(users.concat(iu, [U('e@x', '임원', '임원', '본사', '활성'), U('z@x', '퇴', '일반', '하팀', '비활성')])).join() === '가팀,나팀,마팀');

// V: 3-다 비고(성과-월실적 L열) — 마감한 달·내용 있는 줄만, 숫자 공개 기간과 상관없이(예시 문장은 시험용)
const nrows = rows.concat([
  [2026, 1, '가팀', '사무소', '다사무소', '다사무소', '', '', '', '', '', '1월 다사무소 비고'], [2026, 2, '가팀', '사무소', '나사무소', '나사무소', '', '', '', '', '', '2월 나사무소 비고'],
  [2026, 2, '가팀', '사무소', '다사무소', '다사무소', '', '', '', '', '', '   '], [2026, 3, '가팀', '사무소', '나사무소', '나사무소', '', '', '', '', '', '마감 전 3월 비고'],
  [2025, 1, '가팀', '사무소', '나사무소', '나사무소', '', '', '', '', '', '2025 기준 실적 비고'], [2026, 1, '나팀', '사무소', '나사무소', '나사무소', '', '', '', '', '', '다른 팀 비고'],
  [2026, 2, '가팀', '팀비용', '', '', '', '', '', '', '', '팀비용 줄 비고'], [2026, 1, '가팀', '사무소', '나사무소', '나사무소', '', '', '', '', '', new Array(231).join('가')]]);
v = p.buildView(Object.assign({}, base, { rows: nrows, today: '2026-03-12', showAll: false }));
t('V1 공개 기간 밖 팀원(숫자 없음)에도 비고는 있음', v.showNumbers === false && Array.isArray(v.notes) && v.notes.length === 3, v.notes);
t('V2 순서 = 최신 달 먼저, 같은 달은 가나다(2월 나 → 1월 나 → 1월 다)', v.notes.map(function (n) { return n.month + n.key; }).join() === '2나사무소,1나사무소,1다사무소', v.notes);
const nt = JSON.stringify(v.notes);
t('V3 빈 비고(공백뿐)·마감 전 3월·2025 기준 실적·다른 팀·팀비용 줄 비고는 없음', ['마감 전 3월', '2025 기준', '다른 팀', '팀비용 줄'].every(function (x) { return nt.indexOf(x) < 0; }) && v.notes.every(function (n) { return n.text.trim() !== ''; }));
t('V4 시트에서 직접 230자로 적은 비고도 200자까지만', v.notes[1].text.length === 200);
t('V5 비고 응답에도 매출·이익 숫자 없음', leaks(v).length === 0, leaks(v));
v = p.buildView(Object.assign({}, base, { rows: nrows, team: '다팀', today: '2026-03-12', showAll: false }));
t('V6 마감 없는 팀 → 비고 없음', v.notes === undefined || v.notes.length === 0);
t('V7 notesView 직접: 마감월 0 → 빈 목록', p.notesView({ rows: nrows, users: users, team: '가팀', mode: '사무소', year: 2026, closeMonth: 0 }).length === 0);
const pn = p.notesView({ rows: [[2026, 1, '마팀', '개인', 'Lee@X', '옛이름', '', '', '', '', '', '1월 연차 1주']], users: [U('lee@x', '이두리', '일반', '마팀', '활성')], team: '마팀', mode: '개인', year: 2026, closeMonth: 1 });
t('V8 개인 팀 비고 이름 = 사용자팀마스터 이름(이메일 대소문자 무시)', pn.length === 1 && pn[0].name === '이두리' && pn[0].key === 'lee@x', pn);

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
