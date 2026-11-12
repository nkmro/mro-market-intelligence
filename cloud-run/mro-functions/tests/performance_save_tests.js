// node tests/performance_save_tests.js — 성과평가 3-가 실적 입력·월 마감·팀 설정 시험. 시트·Firestore·네트워크 없음.
// A그룹: lib/performance.js 쓰기 계획 순수 함수. B그룹: index.js savePerformanceTest·view=input을 가짜 시트(메모리)로 호출 —
// 저장하면 메모리 시트가 바뀌고 다음 요청이 그 값을 다시 읽는다(잠금 안 다시 읽기 흐름 확인).
// 숫자는 모두 시험용 예시(실제 실적 아님 — performance_calc_tests.js 상단 방침). 운영 시트에 쓰는 시험은 하지 않는다.
const path = require('path');
const p = require('../lib/performance');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra).slice(0, 500))); } }
const U = function (email, name, role, team, status, office) { return { email: email, name: name, role: role, team: team, status: status || '활성', office: office || '' }; };
const NOW = Date.UTC(2026, 10, 12, 1, 30); // 서울 2026-11-12 10:30

// ── A: 순수 함수
const users = [U('lead@x', '팀장', '팀장', '가팀'), U('a@x', '김가', '일반', '가팀', '활성', '나사무소'), U('b@x', '이가', '담당', '가팀', '활성', '나사무소'),
  U('c@x', '박가', '일반', '가팀', '활성', '다사무소'), U('d@x', '최가', '일반', '가팀', '활성', ''), U('z@x', '퇴가', '일반', '가팀', '비활성', '라사무소')];
const rows = [[2026, 9, '가팀', '사무소', '나사무소', '나사무소', 100, 10, 2, 'x', 's'], [], [2026, 9, '가팀', '팀비용', '', '', '', 5, '', 'x', 's'],
  [2026, 10, '가팀', '사무소', '나사무소', '나사무소', 110, 11, 2, 'lead@x', '2026-11-03 09:00'], [2026, 3, '가팀', '사무소', '옛사무소', '옛사무소', 1, 1, 1, '', '']];
t('A1 seoulStamp 서울 시각', p.seoulStamp(NOW) === '2026-11-12 10:30');
t('A2 다음 빈 줄 = 값 있는 마지막 줄 + 1 (중간 빈 줄 재사용 안 함)', p.nextFreeRow(p.indexRows(rows)) === 7 && p.nextFreeRow([]) === 2);
let tu = p.teamUnits(users, rows, '가팀', '사무소');
t('A3 사무소 목록 = 활성 J열(나·다) + 실적 줄에만 있는 옛사무소, 퇴사자 J(라) 제외, 가나다', tu.map(function (u) { return u.key + u.members; }).join() === '나사무소2,다사무소1,옛사무소0', tu);
let iv = p.inputView({ users: users, rows: rows, team: '가팀', mode: '사무소', year: 2026, month: 10 });
t('A4 입력 화면 10월: 나사무소 저장값, 다사무소 빈칸·기본 인원 1, 팀비용 없음, 입력된 달 9·10, 마지막 저장', iv.rows[0].saved && iv.rows[0].sales === 110 && !iv.rows[1].saved && iv.rows[1].defaultHeads === 1 && iv.teamCost === null && iv.entered.join() === '3,9,10' && iv.lastSaved.by === 'lead@x', iv);

let pl = p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, who: 'lead@x', nowMs: NOW,
  entries: [{ key: '나사무소', sales: 120, profit: 12, heads: 2 }, { key: '다사무소', sales: 50, profit: -3, heads: 1 }], teamCost: 7 });
t('A5 있는 줄(5행)은 고치고 새 줄은 7·8행에 — 줄 번호를 서버가 계산', pl.ok && pl.writes.map(function (w) { return w.row; }).join() === '5,7,8', pl);
t('A6 쓰는 값 12칸: 연도·월·팀·단위구분·단위·이름·매출·이익·인원·수정자·수정일시·비고(새 줄 = 빈칸)', JSON.stringify(pl.writes[1].values) === JSON.stringify([2026, 10, '가팀', '사무소', '다사무소', '다사무소', 50, -3, 1, 'lead@x', '2026-11-12 10:30', '']));
t('A7 팀비용 줄: 이익 칸에 총비용', JSON.stringify(pl.writes[2].values.slice(0, 9)) === JSON.stringify([2026, 10, '가팀', '팀비용', '', '', '', 7, '']));
t('A8 모르는 사무소 → UNKNOWN_UNIT (새 사무소는 팀 설정에서)', p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '새사무소', sales: 1 }] }).error === 'UNKNOWN_UNIT');
t('A9 같은 단위 두 번 → DUPLICATE_UNIT', p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '나사무소' }, { key: '나사무소' }] }).error === 'DUPLICATE_UNIT');
t('A10 숫자 검사: 소수·음수 매출·글자·인원 1000 → BAD_NUMBER, 이익 음수는 허용', ['1.5', -1, 'abc'].every(function (s) { return p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '나사무소', sales: s }] }).error === 'BAD_NUMBER'; })
  && p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '나사무소', heads: 1000 }] }).error === 'BAD_NUMBER'
  && p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '나사무소', profit: -5 }] }).ok);
t('A11 빈칸(null) 저장 허용 — 칸은 빈 글자로', (function () { const x = p.planMonthWrite({ rows: [], users: users, team: '가팀', mode: '사무소', year: 2026, month: 11, entries: [{ key: '나사무소', sales: 5, profit: null, heads: null }] }); return x.ok && x.writes[0].values[7] === '' && x.writes[0].values[8] === ''; })());
t('A12b 팀비용 null = 지움(줄이 있으면 이익 칸 비움), undefined = 그대로', (function () { const a = p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [], teamCost: null }); const b = p.planMonthWrite({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '나사무소', sales: 1 }] }); return a.ok && a.writes.length === 1 && a.writes[0].row === 4 && a.writes[0].values[7] === '' && b.ok && b.writes.length === 1 && b.writes[0].row === 2; })());
t('A12 저장할 것이 없으면 NOTHING_TO_SAVE', p.planMonthWrite({ rows: [], users: users, team: '가팀', mode: '사무소', year: 2026, month: 11, entries: [] }).error === 'NOTHING_TO_SAVE');

// 개인 단위(결정 ②: 근무 해제 = 칸 비우기)
const iu = [U('lead2@x', '팀장2', '팀장', '마팀'), U('kim@x', '김하나', '일반', '마팀'), U('Lee@X', '이두리', '담당', '마팀'), U('old@x', '박세찌', '일반', '마팀', '비활성')];
const ir = [[2026, 10, '마팀', '개인', 'lee@x', '이두리', 30, 3, 1, '', '']];
const iv2 = p.inputView({ users: iu, rows: ir, team: '마팀', mode: '개인', year: 2026, month: 10 });
t('A13 개인 입력 화면: 팀원 가나다(김하나·박세찌·이두리), 이메일 대소문자 무시(Lee@X ↔ lee@x), 이미 저장된 달이라 줄 있는 이두리만 체크', iv2.rows.map(function (r) { return r.name + (r.work ? 'Y' : 'N'); }).join() === '김하나N,박세찌N,이두리Y' && iv2.rows[2].saved && iv2.monthSaved, iv2.rows);
pl = p.planMonthWrite({ rows: ir, users: iu, team: '마팀', mode: '개인', year: 2026, month: 10, who: 'lead2@x', nowMs: NOW,
  entries: [{ key: 'kim@x', work: true, sales: 10, profit: 1 }, { key: 'lee@x', work: false }, { key: 'old@x', work: false }], teamCost: 2 });
t('A14 근무 해제한 이두리 줄(2행)은 12칸(비고 포함) 비우기, 줄이 없던 박세찌는 아무것도 안 함, 인원 칸 = 1', pl.ok && pl.writes.length === 3 && pl.writes[1].row === 2 && pl.writes[1].values.length === 12 && pl.writes[1].values.every(function (v) { return v === ''; }) && pl.writes[0].values[8] === 1 && pl.writes[0].values[4] === 'kim@x', pl.writes);

// A13b: 근무 해제 → 칸 비움 → 다시 열기: 그 달을 이미 저장했으므로 줄이 없는 사람은 체크 해제로 보임(확인 1). 한 번도 저장 안 한 달은 활성 = 체크
(function () {
  const rr = [[2026, 10, '마팀', '개인', 'kim@x', '김하나', 10, 1, 1, '', ''], [2026, 10, '마팀', '개인', 'lee@x', '이두리', 20, 2, 1, '', ''], [2026, 10, '마팀', '팀비용', '', '', '', 5, '', '', '']];
  const w = p.planMonthWrite({ rows: rr, users: iu, team: '마팀', mode: '개인', year: 2026, month: 10, who: 'x', nowMs: NOW, entries: [{ key: 'lee@x', work: false }] });
  w.writes.forEach(function (x) { rr[x.row - 2] = x.values; });
  const back = p.inputView({ users: iu, rows: rr, team: '마팀', mode: '개인', year: 2026, month: 10 });
  const fresh = p.inputView({ users: iu, rows: rr, team: '마팀', mode: '개인', year: 2026, month: 11 });
  t('A13b 근무 해제 후 다시 열기: 이두리 체크 해제 유지, 김하나 체크 / 저장 안 한 11월은 활성 팀원 기본 체크', back.monthSaved && back.rows.map(function (r) { return r.name + (r.work ? 'Y' : 'N'); }).join() === '김하나Y,박세찌N,이두리N'
    && !fresh.monthSaved && fresh.rows.map(function (r) { return r.name + (r.work ? 'Y' : 'N'); }).join() === '김하나Y,박세찌N,이두리Y', [back.rows, fresh.rows]);
})();

// ── N: 3-다 비고(성과-월실적 L열). 예시 문장은 시험용
(function () {
  const s200 = new Array(201).join('가'), s201 = s200 + '나';
  t('N1 200자 허용·201자 → NOTE_TOO_LONG, 이모지 1개 = 1자로 셈', p.checkNote(s200).ok && p.checkNote(s201).error === 'NOTE_TOO_LONG' && p.checkNote(new Array(200).join('가') + '😀').ok);
  t('N2 줄바꿈·제어문자 → 공백, 앞뒤 공백 제거, null·빈 글자 = 지움(빈칸), 글자 아님 → BAD_NOTE', p.checkNote('  거래처\n계약\t종료 ').text === '거래처 계약 종료' && p.checkNote(null).text === '' && p.checkNote('').text === '' && p.checkNote(12).error === 'BAD_NOTE' && p.checkNote({}).error === 'BAD_NOTE');
  const nr = [[2026, 10, '가팀', '사무소', '나사무소', '나사무소', 110, 11, 2, 'lead@x', '2026-11-03 09:00', '기존 비고'], [2026, 10, '가팀', '팀비용', '', '', '', 5, '', 'x', 's', '']];
  let w = p.planMonthWrite({ rows: nr, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, who: 'lead@x', nowMs: NOW, entries: [{ key: '나사무소', sales: 120, profit: 12, heads: 2 }] });
  t('N3 숫자만 저장(note 없음) → 시트에 있던 비고 그대로 다시 씀', w.ok && w.writes[0].row === 2 && w.writes[0].values[11] === '기존 비고', w);
  w = p.planMonthWrite({ rows: nr, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, who: 'lead@x', nowMs: NOW, entries: [{ key: '나사무소', sales: 120, profit: 12, heads: 2, note: ' 새 비고 ' }, { key: '다사무소', sales: 1, profit: 1, heads: 1, note: '' }], teamCost: 6 });
  t('N4 note 보내면 L열 = 정리한 값, 빈 글자 = 빈칸, 팀비용 줄은 L열 그대로', w.ok && w.writes[0].values[11] === '새 비고' && w.writes[1].values[11] === '' && w.writes[2].values.length === 12 && w.writes[2].values[11] === '', w);
  t('N5 비고 201자 → NOTE_TOO_LONG(줄 이름 함께), 전년 기준 실적(noNote)에 비고 → NO_NOTE_FOR_BASELINE', (function () { const a = p.planMonthWrite({ rows: nr, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10, entries: [{ key: '나사무소', note: s201 }] }); const b = p.planMonthWrite({ rows: [], users: users, team: '가팀', mode: '사무소', year: 2025, month: 3, noNote: true, entries: [{ key: '나사무소', sales: 1, note: '' }] }); const c = p.planMonthWrite({ rows: [], users: users, team: '가팀', mode: '사무소', year: 2025, month: 3, noNote: true, entries: [{ key: '나사무소', sales: 1 }] }); return a.error === 'NOTE_TOO_LONG' && a.field === '나사무소' && b.error === 'NO_NOTE_FOR_BASELINE' && c.ok; })());
  const iv3 = p.inputView({ users: users, rows: nr, team: '가팀', mode: '사무소', year: 2026, month: 10 });
  t('N6 입력 화면에 비고(줄 없는 사무소 = 빈 글자)', iv3.rows[0].note === '기존 비고' && iv3.rows[1].note === '', iv3.rows);
  const ir2 = [[2026, 10, '마팀', '개인', 'lee@x', '이두리', 30, 3, 1, '', '', '휴가 1주']];
  w = p.planMonthWrite({ rows: ir2, users: iu, team: '마팀', mode: '개인', year: 2026, month: 10, who: 'x', nowMs: NOW, entries: [{ key: 'lee@x', work: false }] });
  t('N7 개인 근무 해제 = 비고까지 12칸 비우기', w.ok && w.writes[0].values.length === 12 && w.writes[0].values.every(function (v) { return v === ''; }));
  // 마감한 달 비고만 저장
  const cl = [[2026, 9, '가팀', '사무소', '나사무소', '나사무소', 100, 10, 2, 'x', 's', ''], [2026, 9, '가팀', '사무소', '다사무소', '다사무소', 50, 5, 1, 'x', 's', '그대로'], [2026, 9, '가팀', '팀비용', '', '', '', 5, '', 'x', 's']];
  w = p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, who: 'lead@x', nowMs: NOW, entries: [{ key: '나사무소', note: '9월 설비 교체 건 일회성 매출 포함' }, { key: '다사무소', note: '그대로' }] });
  t('N8 마감 달 비고 저장: 바뀐 줄만(2행), 쓰는 값 = 수정자·수정일시·비고 3칸, 숫자 칸은 안 씀', w.ok && w.writes.length === 1 && w.writes[0].row === 2 && JSON.stringify(w.writes[0].values) === JSON.stringify(['lead@x', '2026-11-12 10:30', '9월 설비 교체 건 일회성 매출 포함']), w);
  t('N9 비고 지우기(빈 글자) 허용, 안 바뀌면 NOTHING_TO_SAVE', p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '다사무소', note: '' }] }).writes[0].values[2] === '' && p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '다사무소', note: ' 그대로 ' }] }).error === 'NOTHING_TO_SAVE');
  t('N10 줄 없는 단위 → NOTE_NO_ROW, 모르는 단위 → UNKNOWN_UNIT, note 없음 → BAD_NOTE, 201자 → NOTE_TOO_LONG', p.planNoteWrite({ rows: [], users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '나사무소', note: 'a' }] }).error === 'NOTE_NO_ROW'
    && p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '없는곳', note: 'a' }] }).error === 'UNKNOWN_UNIT'
    && p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '나사무소' }] }).error === 'BAD_NOTE'
    && p.planNoteWrite({ rows: cl, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9, entries: [{ key: '나사무소', note: s201 }] }).error === 'NOTE_TOO_LONG');
})();

// 마감 빈칸 검사
t('A15 사무소 마감 빈칸: 활성 팀원이 있는 사무소만(옛사무소 제외) + 팀 총비용', JSON.stringify(p.closeMissing({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 10 })) === JSON.stringify(['다사무소 매출액', '다사무소 이익', '다사무소 인원', '팀 총비용']));
t('A16 9월은 다사무소 빈칸만', JSON.stringify(p.closeMissing({ rows: rows, users: users, team: '가팀', mode: '사무소', year: 2026, month: 9 })) === JSON.stringify(['다사무소 매출액', '다사무소 이익', '다사무소 인원']));
t('A17 개인 마감: 저장된 줄 없으면 알림', p.closeMissing({ rows: [], users: iu, team: '마팀', mode: '개인', year: 2026, month: 11 }).join() === '근무한 팀원 줄(저장 안 됨),팀 총비용');

// 마감·풀기(결정 ①: 한 달씩)
const cr = [[2026, '나팀', 4, 'q', '2026-05-02 09:00', ''], [2026, '가팀', 9, 'jh', '2026-10-14 10:00', '9월 마감']];
let pc = p.planClose({ closeRows: cr, team: '가팀', year: 2026, action: 'close', month: 10, who: 'lead@x', nowMs: NOW, maxMonth: 11 });
t('A18 9월 마감 상태에서 10월 마감: 그 팀 줄(3행)을 고침, 마감자·일시 새로, 기록 이어 붙임', pc.ok && pc.write.row === 3 && JSON.stringify(pc.write.values) === JSON.stringify([2026, '가팀', 10, 'lead@x', '2026-11-12 10:30', '9월 마감 / 10월 마감 2026-11-12 10:30 lead@x']), pc);
t('A19 건너뛰어 11월 마감 → CLOSE_ORDER, 이미 마감한 9월 → CLOSE_ORDER', p.planClose({ closeRows: cr, team: '가팀', year: 2026, action: 'close', month: 11, maxMonth: 11 }).error === 'CLOSE_ORDER' && p.planClose({ closeRows: cr, team: '가팀', year: 2026, action: 'close', month: 9, maxMonth: 11 }).error === 'CLOSE_ORDER');
t('A20 이번 달보다 뒤 → MONTH_FUTURE', p.planClose({ closeRows: [[2026, '가팀', 11, '', '', '']], team: '가팀', year: 2026, action: 'close', month: 12, maxMonth: 11 }).error === 'MONTH_FUTURE');
pc = p.planClose({ closeRows: cr, team: '가팀', year: 2026, action: 'reopen', month: 9, who: 'lead@x', nowMs: NOW });
t('A21 9월 풀기 → 8월 마감 상태, 마감자·마감일시는 그대로(공개 기간 기준 유지), 기록 남음', pc.ok && pc.closeMonth === 8 && pc.write.values[3] === 'jh' && pc.write.values[4] === '2026-10-14 10:00' && /9월 풀기 2026-11-12 10:30 lead@x$/.test(pc.write.values[5]), pc);
t('A22 마지막 마감 달이 아닌 달 풀기 → REOPEN_ORDER, 마감 없는 팀 풀기 → REOPEN_ORDER', p.planClose({ closeRows: cr, team: '가팀', year: 2026, action: 'reopen', month: 8 }).error === 'REOPEN_ORDER' && p.planClose({ closeRows: cr, team: '다팀', year: 2026, action: 'reopen', month: 1 }).error === 'REOPEN_ORDER');
pc = p.planClose({ closeRows: cr, team: '다팀', year: 2026, action: 'close', month: 1, who: 'w', nowMs: NOW, maxMonth: 11 });
t('A23 마감 줄 없는 팀의 1월 마감: 마지막 줄 다음(4행)에 새 줄', pc.ok && pc.write.row === 4 && pc.write.values[2] === 1);

// 팀 설정(J열)
const ur = [['lead@x', '팀장', '팀장', '가팀', '활성', '', '', '', '', ''], ['a@x', '김가', '일반', '가팀', '활성', '', '', '', '', '나사무소'],
  ['d@x', '최가', '일반', '가팀', '활성'], ['n@x', '서나', '일반', '나팀', '활성', '', '', '', '', '나사무소'], ['z@x', '퇴가', '일반', '가팀', '비활성']];
let po = p.planOffices({ userRows: ur, team: '가팀', changes: [{ email: 'D@X', office: ' 새사무소 ' }, { email: 'a@x', office: '나사무소' }] });
t('A24 팀 설정: 바뀐 사람만 J{줄}(최가 4행), 이름 앞뒤 공백 제거, 그대로인 김가는 안 씀', po.ok && po.writes.length === 1 && po.writes[0].row === 4 && po.writes[0].value === '새사무소', po);
t('A25 다른 팀·비활성·팀장 → FORBIDDEN_TEAM', ['n@x', 'z@x', 'lead@x'].every(function (e) { return p.planOffices({ userRows: ur, team: '가팀', changes: [{ email: e, office: '나사무소' }] }).error === 'FORBIDDEN_TEAM'; }));
t('A26 사무소 이름 규칙: 빈칸·11자·쉼표 → BAD_OFFICE_NAME', ['', '열한글자넘는사무소이름', '가,나'].every(function (n) { return p.planOffices({ userRows: ur, team: '가팀', changes: [{ email: 'a@x', office: n }] }).error === 'BAD_OFFICE_NAME'; }));
t('A27 명단에 없는 사람 → USER_NOT_FOUND', p.planOffices({ userRows: ur, team: '가팀', changes: [{ email: 'q@x', office: '나' }] }).error === 'USER_NOT_FOUND');

// ── B: index.js 경로 — 가짜 시트(메모리). 쓰기는 메모리에 반영.
const ADMIN = 'jhjoo@nkmro.com';
let me = null;
const SHEET = {
  mroUsers: [[ADMIN, '관리자', '팀장', '가팀', '활성'], ['lead@x', '팀장가', '팀장', '가팀', '활성'], ['a@x', '김가', '일반', '가팀', '활성', '', '', '', '', '나사무소'],
    ['c@x', '박가', '일반', '가팀', '활성', '', '', '', '', '다사무소'], ['lead2@x', '팀장마', '팀장', '마팀', '활성'], ['k@x', '김마', '일반', '마팀', '활성'], ['ex@x', '임원', '임원', '본사', '활성']],
  mroSettings: [['인사평가파일_2026', 'F26']],
  F26: { '인사평가설정': [['키', '값'], ['성과평가단위_가팀', '사무소'], ['성과공개일수', 1]], '성과-월실적': [['h']], '성과-마감': [['h'], [2026, '가팀', 9, 'jh', '2026-10-14 10:00', '9월 마감']],
    '성과-평가기준': [['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'], ['성장', 0.5, 'sales', '매출', 0.3, '110:100, 100:90, 90:80, 나머지:70'],
      ['성장', 0.5, 'profit', '이익', 0.3, '110:100, 100:90, 90:80, 나머지:70'], ['성장', 0.5, 'margin', '이익률', 0.1, '110:100, 100:90, 90:80, 나머지:70'],
      ['성장', 0.5, 'perHead', '인당', 0.3, '110:100, 100:90, 90:80, 나머지:70'], ['영업이익', 0.1, 'teamOp', '경상이익', 1, '110:100, 100:90, 나머지:80']] }
};
function colIdx(c) { return c.charCodeAt(0) - 65; }
function readRange(file, r) { // 'tab'!A2:K 꼴만
  const m = /^'?(.+?)'?!([A-Z])(\d+):([A-Z])(\d*)$/.exec(r); const tab = m[1]; const all = file[tab] || [];
  if (m[2] === 'A' && m[3] === '1') return all.map(function (x) { return x.slice(); });
  return all.slice(Number(m[3]) - 1).map(function (x) { return x.slice(); });
}
let writes = [];
function stub(rel, exp) { const f = require.resolve(path.join(__dirname, '..', rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; }
stub('lib/auth.js', { authenticateSession: async function () { return { ok: true, email: me, timings: {} }; } });
stub('lib/writeLock.js', { acquireLock: async function () { return true; }, releaseLock: async function () {} });
const idem = {};
stub('lib/writeIdempotency.js', { IDEMPOTENCY_COLLECTION: 'x', withIdempotency: async function (fs, key, action, fn) { if (idem[key]) return idem[key]; idem[key] = await fn(); return idem[key]; } });
const real = require('../lib/sheetsClient');
stub('lib/sheetsClient.js', Object.assign({}, real, { getSheetsClient: async function () { return {}; },
  batchGetValues: async function (c, id, ranges) {
    return ranges.map(decodeURIComponent).map(function (r) {
      if (id !== 'F26') return { values: r.indexOf('!A2:J') > 0 ? SHEET.mroUsers.map(function (x) { return x.slice(); }) : SHEET.mroSettings };
      return { values: readRange(SHEET.F26, r) };
    });
  } }));
const gal = require.resolve('google-auth-library', { paths: [path.join(__dirname, '..')] });
const realGal = require(gal);
require.cache[gal] = { id: gal, filename: gal, loaded: true, exports: Object.assign({}, realGal, { GoogleAuth: function () { this.getClient = async function () { return { request: async function (o) {
  let n = 0; const fileKey = o.url.indexOf('/F26/') > 0 ? 'F26' : 'MRO';
  o.data.data.forEach(function (d) {
    writes.push({ file: fileKey, range: d.range, values: d.values[0] });
    const m = /^'?(.+?)'?!([A-Z])(\d+)(?::([A-Z])\d+)?$/.exec(d.range); const row = Number(m[3]) - 1;
    const arr = fileKey === 'F26' ? (SHEET.F26[m[1]] = SHEET.F26[m[1]] || []) : null;
    if (fileKey === 'MRO') { const u = SHEET.mroUsers[row - 1]; while (u.length < 10) u.push(''); u[colIdx(m[2])] = d.values[0][0]; n++; return; }
    while (arr.length <= row) arr.push([]);
    d.values[0].forEach(function (v, i) { arr[row][colIdx(m[2]) + i] = v; n++; });
  });
  return { data: { totalUpdatedCells: n } }; } }; }; } }) };
const idx = require('../index.js');
let kseq = 0;
async function call(fn, email, body) {
  me = email; let out = null;
  const res = { set: function () { return res; }, setHeader: function () {}, status: function () { return res; }, json: function (o) { out = o; }, send: function () {} };
  await idx[fn]({ method: 'POST', body: Object.assign({ sessionToken: 't' }, body), headers: {} }, res);
  return out;
}
const save = function (email, body) { return call('savePerformanceTest', email, Object.assign({ idempotencyKey: 'k' + (++kseq) }, body)); };
const realNow = Date.now; Date.now = function () { return NOW; }; // 서울 2026-11-12 고정

(async function () {
  let r = await call('getPerformanceTest', 'lead@x', { view: 'input' });
  t('B1 팀장 view=input: 기본 달 = 마감 다음 달(10월), 연도 칸 2026 + 2025(전년 기준 실적, 결정 ③), 이번 달까지(11)', r.ok && r.month === 10 && r.closeMonth === 9 && r.maxMonth === 11 && r.years.map(function (y) { return y.year + y.kind; }).join() === '2026current,2025baseline' && r.nextClose.month === 10, r);
  t('B2 입력 화면 행: 나사무소·다사무소, 마감 빈칸 목록', r.rows.map(function (x) { return x.key; }).join() === '나사무소,다사무소' && r.nextClose.missing.length === 7);
  r = await call('getPerformanceTest', 'a@x', { view: 'input' });
  t('B3 팀원 view=input → FORBIDDEN', r.error === 'FORBIDDEN');
  r = await save('a@x', { action: 'saveMonth', year: 2026, month: 10, entries: [] });
  t('B4 팀원 저장 → FORBIDDEN, 시트 안 바뀜', r.error === 'FORBIDDEN' && writes.length === 0);
  r = await save('lead@x', { action: 'saveMonth', team: '마팀', year: 2026, month: 10, entries: [] });
  t('B5 팀장이 다른 팀 저장 → FORBIDDEN_TEAM', r.error === 'FORBIDDEN_TEAM' && writes.length === 0);
  r = await save('ex@x', { action: 'close', year: 2026, month: 10 });
  t('B6 임원 마감 → FORBIDDEN', r.error === 'FORBIDDEN');
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 9, entries: [{ key: '나사무소', sales: 1, profit: 1, heads: 1 }] });
  t('B7 마감한 9월 저장 → MONTH_CLOSED', r.error === 'MONTH_CLOSED' && writes.length === 0);
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 12, entries: [{ key: '나사무소', sales: 1 }] });
  t('B8 이번 달(11월) 뒤 12월 → MONTH_FUTURE (결정 ④)', r.error === 'MONTH_FUTURE');
  r = await save('lead@x', { action: 'close', year: 2026, month: 10 });
  t('B9 빈칸 있는 10월 마감 → MONTH_INCOMPLETE + 빈칸 목록, 시트 안 바뀜', r.error === 'MONTH_INCOMPLETE' && r.missing.indexOf('팀 총비용') >= 0 && writes.length === 0, r);
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '나사무소', sales: 1200, profit: 120, heads: 2 }, { key: '다사무소', sales: 800, profit: 64, heads: 1 }], teamCost: 90 });
  t('B10 10월 저장: 3줄 × 12칸 = 36칸, 성과-월실적 2·3·4행 A~L', r.ok && r.updatedCells === 36 && writes.map(function (w) { return w.range; }).join() === "'성과-월실적'!A2:L2,'성과-월실적'!A3:L3,'성과-월실적'!A4:L4", writes.map(function (w) { return w.range; }));
  r = await call('getPerformanceTest', 'lead@x', { view: 'input', month: 10 });
  t('B11 다시 읽으면 저장값·마지막 저장 표시·마감 빈칸 없음', r.rows[0].sales === 1200 && r.teamCost === 90 && r.lastSaved.by === 'lead@x' && r.nextClose.missing.length === 0, r);
  writes = [];
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '나사무소', sales: 1300, profit: 130, heads: 2 }] });
  t('B12 같은 달 다시 저장(팀비용 안 보냄): 새 줄이 아니라 2행만 고침, 팀비용 줄은 그대로(90)', r.ok && writes.length === 1 && writes[0].range === "'성과-월실적'!A2:L2" && SHEET.F26['성과-월실적'].length === 4 && SHEET.F26['성과-월실적'][3][7] === 90);
  writes = [];
  const key = 'same-key';
  r = await call('savePerformanceTest', 'lead@x', { idempotencyKey: key, action: 'close', year: 2026, month: 10 });
  const r2 = await call('savePerformanceTest', 'lead@x', { idempotencyKey: key, action: 'close', year: 2026, month: 10 });
  t('B13 10월 마감: 성과-마감 2행(가팀 줄) 고침, 같은 키로 두 번 눌러도 1번만 씀', r.ok && r.closeMonth === 10 && r2.ok && writes.length === 1 && writes[0].range === "'성과-마감'!A2:F2" && writes[0].values[2] === 10 && writes[0].values[4] === '2026-11-12 10:30', writes);
  r = await call('getPerformanceTest', 'a@x', { view: 'mine' });
  t('B14 마감 직후 팀원 보기: 10월 누계·공개 기간(오늘~내일)·숫자 공개', r.ok && r.closeMonth === 10 && r.publish.open === true && r.publish.until === '2026-11-13' && r.showNumbers === true, { c: r.closeMonth, p: r.publish });
  writes = [];
  r = await save('lead@x', { action: 'reopen', year: 2026, month: 9 });
  t('B15 마지막 마감(10월)이 아닌 9월 풀기 → REOPEN_ORDER', r.error === 'REOPEN_ORDER' && writes.length === 0);
  r = await save('lead@x', { action: 'reopen', year: 2026, month: 10 });
  t('B16 10월 풀기 → 9월 마감 상태, 마감일시는 그대로', r.ok && r.closeMonth === 9 && writes[0].values[4] === '2026-11-12 10:30');
  r = await save('lead@x', { action: 'saveMonth', year: 2025, month: 12, entries: [{ key: '나사무소', sales: 900, profit: 90, heads: 2 }] });
  t('B17 2025(전년 기준 실적): 2026 파일에 연도 2025로 저장, 마감과 상관없음', r.ok && SHEET.F26['성과-월실적'][4][0] === 2025 && SHEET.F26['성과-월실적'][4][1] === 12);
  r = await save('lead@x', { action: 'close', year: 2025, month: 1 });
  t('B18 2025 마감 → NO_CLOSE_FOR_BASELINE', r.error === 'NO_CLOSE_FOR_BASELINE');
  r = await save('lead@x', { action: 'saveMonth', year: 2024, month: 1, entries: [] });
  t('B19 2024 → YEAR_CLOSED, 2027 → BAD_YEAR', r.error === 'YEAR_CLOSED' && (await save('lead@x', { action: 'saveMonth', year: 2027, month: 1, entries: [] })).error === 'BAD_YEAR');
  writes = [];
  r = await save('lead@x', { action: 'saveOffices', changes: [{ email: 'c@x', office: '나사무소' }] });
  t('B20 팀 설정: 박가 J열만(사용자팀마스터 5행 — A2부터라 4번째 사람) 바꿈', r.ok && r.updatedCells === 1 && writes.length === 1 && writes[0].file === 'MRO' && writes[0].range === "'사용자팀마스터'!J5" && SHEET.mroUsers[3][9] === '나사무소', writes);
  r = await save('lead2@x', { action: 'saveOffices', changes: [{ email: 'k@x', office: '가' }] });
  t('B21 개인 단위 팀의 팀 설정 → NOT_OFFICE_TEAM', r.error === 'NOT_OFFICE_TEAM');
  r = await save('lead@x', { action: 'saveOffices', changes: [{ email: 'k@x', office: '가' }] });
  t('B22 다른 팀 사람 J열 → FORBIDDEN_TEAM', r.error === 'FORBIDDEN_TEAM');
  r = await save(ADMIN, { action: 'saveMonth', team: '마팀', year: 2026, month: 11, entries: [{ key: 'k@x', work: true, sales: 10, profit: 1 }], teamCost: 3 });
  t('B23 관리자는 다른 팀(마팀, 개인 단위) 저장 가능', r.ok && r.rows === 2);
  r = await save('lead@x', { action: 'deleteAll' });
  t('B24 모르는 action → NOT_IMPLEMENTED, 키 없으면 MISSING_FIELDS', r.error === 'NOT_IMPLEMENTED' && (await call('savePerformanceTest', 'lead@x', { action: 'close' })).error === 'MISSING_FIELDS');
  // ── 3-다 비고 경로 (이 시점 가팀: 9월 마감, 10월 3줄 저장됨)
  writes = [];
  r = await save('lead@x', { action: 'saveNote', year: 2026, month: 10, entries: [{ key: '나사무소', note: 'a' }] });
  t('B25 마감 안 된 10월에 saveNote → MONTH_NOT_CLOSED(열린 달은 [저장]에 함께)', r.error === 'MONTH_NOT_CLOSED' && writes.length === 0);
  r = await save('lead@x', { action: 'saveNote', year: 2026, month: 9, entries: [{ key: '나사무소', note: 'a' }] });
  t('B26 마감한 9월인데 그 사무소 줄이 없음 → NOTE_NO_ROW', r.error === 'NOTE_NO_ROW' && writes.length === 0);
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '다사무소', sales: 800, profit: 64, heads: 1, note: '10월 15일부 거래처 1곳 계약 종료' }] });
  t('B27 열린 10월 [저장]에 비고 함께: 다사무소 줄(3행) L열', r.ok && writes[0].range === "'성과-월실적'!A3:L3" && SHEET.F26['성과-월실적'][2][11] === '10월 15일부 거래처 1곳 계약 종료', writes);
  r = await save('lead@x', { action: 'close', year: 2026, month: 10 });
  t('B28 10월 마감', r.ok && r.closeMonth === 10);
  writes = [];
  const before = JSON.stringify(SHEET.F26['성과-월실적'][1].slice(0, 9));
  r = await save('lead@x', { action: 'saveNote', year: 2026, month: 10, entries: [{ key: '나사무소', note: '신규 거래처 2곳 계약' }] });
  t('B29 마감한 10월 비고만 저장: 2행 J~L 3칸만, 숫자 칸 그대로, 마감 상태 그대로', r.ok && r.updatedCells === 3 && writes.length === 1 && writes[0].range === "'성과-월실적'!J2:L2" && JSON.stringify(SHEET.F26['성과-월실적'][1].slice(0, 9)) === before && SHEET.F26['성과-월실적'][1][6] === 1300 && SHEET.F26['성과-월실적'][1][11] === '신규 거래처 2곳 계약' && SHEET.F26['성과-마감'][1][2] === 10, writes);
  r = await save('lead@x', { action: 'saveMonth', year: 2026, month: 10, entries: [{ key: '나사무소', sales: 1, profit: 1, heads: 1 }] });
  t('B30 마감한 달 숫자 저장은 여전히 MONTH_CLOSED', r.error === 'MONTH_CLOSED');
  r = await save('lead@x', { action: 'saveNote', year: 2026, month: 10, entries: [{ key: '나사무소', note: new Array(202).join('가') }] });
  t('B31 비고 201자 → NOTE_TOO_LONG, 시트 안 바뀜', r.error === 'NOTE_TOO_LONG' && writes.length === 1);
  r = await save('a@x', { action: 'saveNote', year: 2026, month: 10, entries: [{ key: '나사무소', note: 'x' }] });
  t('B32 팀원 saveNote → FORBIDDEN', r.error === 'FORBIDDEN' && writes.length === 1);
  r = await save('lead@x', { action: 'saveNote', year: 2025, month: 12, entries: [{ key: '나사무소', note: 'x' }] });
  const r3 = await save('lead@x', { action: 'saveMonth', year: 2025, month: 12, entries: [{ key: '나사무소', sales: 900, profit: 90, heads: 2, note: 'x' }] });
  t('B33 2025(전년 기준 실적): saveNote·saveMonth 비고 → NO_NOTE_FOR_BASELINE', r.error === 'NO_NOTE_FOR_BASELINE' && r3.error === 'NO_NOTE_FOR_BASELINE' && writes.length === 1);
  r = await call('getPerformanceTest', 'a@x', { view: 'mine' });
  t('B34 팀원 점수 보기: 마감한 10월 비고 2개(최신 달 먼저·가나다), 빈 비고 없음', r.ok && JSON.stringify(r.notes) === JSON.stringify([{ month: 10, key: '나사무소', name: '나사무소', text: '신규 거래처 2곳 계약' }, { month: 10, key: '다사무소', name: '다사무소', text: '10월 15일부 거래처 1곳 계약 종료' }]), r.notes);
  r = await call('getPerformanceTest', 'lead@x', { view: 'input', month: 10 });
  t('B35 입력 화면 다시 읽기: 비고 보임', r.rows[0].note === '신규 거래처 2곳 계약' && r.rows[1].note === '10월 15일부 거래처 1곳 계약 종료');
  r = await call('getPerformanceTest', 'ex@x', { view: 'team', team: '가팀' });
  t('B36 임원 팀 보기에도 비고', r.ok && (r.notes || []).length === 2);
  Date.now = realNow;
  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { Date.now = realNow; console.log('ERROR ' + (e && e.stack)); process.exit(1); });
