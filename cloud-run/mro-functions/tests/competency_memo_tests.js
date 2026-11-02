// node tests/competency_memo_tests.js — 추가매출 '비고'(2026-11-02) 시험: validateReply·planReply·planReplyEdit (순수 함수, 접속 0건)
const path = require('path');
const c = require(path.join(__dirname, '..', 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 500))); } }
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const H = ['사무소', '담당', '구분', '고객사', '품목', '예상이익', '추진계획', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '비고', '팀장 의견', '팀'].concat(EX);
const H0 = H.filter(h => h !== '비고'); // 비고 칸 추가 전 시트
const tab = { id: 'addSales', title: '역량-개선기획역량-추가매출' };
const row = (h, o) => h.map(k => (o && k in o) ? o[k] : ({ '담당': '손희진', '구분': '품목확대', '고객사': '반도코리아', '추진계획': '대상 공급사: 삼화프라스틱', '팀': '동부', '기록ID': 'CE-A1', '작성자이메일': 'son@x.com' })[k] || '');
const Y = { achieved: 'Y', reflectFrom: '2611', reflectTo: '', reflectOpen: true, settleSales: '3,200', settleProfit: '410', itemKeys: '1234567' };
const NOW = Date.UTC(2026, 10, 2, 1, 0);
const col = (h, name) => String.fromCharCode(65 + h.indexOf(name));
const wrote = (r, h, name) => (r.writes || []).find(w => w.range.endsWith('!' + col(h, name) + '2'));

// validateReply
let v = c.validateReply(Object.assign({}, Y, { memo: '  실제 공급사는 대한산업으로 변경\r\n단가는 계획과 같음  ' }));
t('V1 비고: 앞뒤 공백 정리, 줄바꿈 \\r\\n → \\n 유지', v.ok && v.memo === '실제 공급사는 대한산업으로 변경\n단가는 계획과 같음', v);
t('V2 요청에 memo 없음 → null(옛 화면), 빈 문자열 → 빈칸', c.validateReply(Y).memo === null && c.validateReply(Object.assign({}, Y, { memo: '  ' })).memo === '');
t('V3 500자 통과 / 501자 BAD_INPUT memo', c.validateReply(Object.assign({}, Y, { memo: '가'.repeat(500) })).ok && c.validateReply(Object.assign({}, Y, { memo: '가'.repeat(501) })).field === 'memo');
t('V4 N 미달성도 비고 받음', c.validateReply({ achieved: 'N', memo: '고객사 예산 동결' }).memo === '고객사 예산 동결');
t('V5 문자열이 아니면 BAD_INPUT memo', c.validateReply(Object.assign({}, Y, { memo: 123 })).field === 'memo');

// planReply
let r = c.planReply(tab, [H, row(H)], 'CE-A1', 'son@x.com', c.validateReply(Object.assign({}, Y, { memo: '실제 공급사 대한산업' })), NOW);
t('P1 Y + 비고 → 비고 칸에 씀(결과 4칸·수정일시와 함께)', r.ok && wrote(r, H, '비고') && wrote(r, H, '비고').value === '실제 공급사 대한산업' && r.writes.length === 6 && r.record.fields['비고'] === '실제 공급사 대한산업', r);
r = c.planReply(tab, [H, row(H)], 'CE-A1', 'son@x.com', c.validateReply(Y), NOW);
t('P2 비고 빈칸 → 비고 칸 안 씀(예전과 같은 5칸)', r.ok && !wrote(r, H, '비고') && r.writes.length === 5, r);
r = c.planReply(tab, [H0, row(H0)], 'CE-A1', 'son@x.com', c.validateReply(Y), NOW);
t('P3 비고 칸 없는 시트 + 비고 빈칸 → 예전처럼 저장', r.ok && r.writes.length === 5, r);
r = c.planReply(tab, [H0, row(H0)], 'CE-A1', 'son@x.com', c.validateReply(Object.assign({}, Y, { memo: '메모' })), NOW);
t('P4 비고 칸 없는 시트 + 비고 있음 → HEADER_NOT_READY', r.error === 'HEADER_NOT_READY', r);
r = c.planReply(tab, [H, row(H, { '비고': '시트에 먼저 적음' })], 'CE-A1', 'son@x.com', c.validateReply(Object.assign({}, Y, { memo: '새 비고' })), NOW);
t('P5 시트에 비고가 이미 있음 → CELL_NOT_EMPTY(덮어쓰지 않음)', r.error === 'CELL_NOT_EMPTY', r);
r = c.planReply(tab, [H, row(H)], 'CE-A1', 'son@x.com', c.validateReply({ achieved: 'N', memo: '고객사 예산 동결' }), NOW);
t('P6 N + 비고 → 달성 여부·비고·수정일시', r.ok && r.writes.length === 3 && wrote(r, H, '비고').value === '고객사 예산 동결', r);

// planReplyEdit
const done = { '달성 여부 (Y/N)': 'Y', '실적 반영 시점(YYMM~)': '2611~', '당해년도 실적결산 (매출/이익)': '매출 3,200천원 / 이익 410천원 / 월 평균', '아이템키': '1234567' };
const same = c.validateReply(Object.assign({}, Y, { memo: '' }));
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고' }, done))], 'CE-A1', 'son@x.com', Object.assign({}, same, { memo: '처음 비고' }), NOW, false);
t('E1 아무것도 안 바꿈 → NO_CHANGE', r.error === 'NO_CHANGE', r);
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고' }, done))], 'CE-A1', 'son@x.com', Object.assign({}, same, { memo: '고친 비고' }), NOW, false);
t('E2 비고만 고침 → 비고 + 수정일시 2칸', r.ok && r.writes.length === 2 && wrote(r, H, '비고').value === '고친 비고', r);
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고' }, done))], 'CE-A1', 'son@x.com', Object.assign({}, same, { memo: '' }), NOW, false);
t('E3 비고 지움 → 비고 빈칸으로', r.ok && wrote(r, H, '비고').value === '', r);
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고' }, done))], 'CE-A1', 'son@x.com', null, NOW, true);
t('E4 결과 지우기(replyClear) → 결과 4칸 + 비고도 비움', r.ok && wrote(r, H, '비고').value === '' && wrote(r, H, '달성 여부 (Y/N)').value === '', r);
r = c.planReplyEdit(tab, [H0, row(H0, done)], 'CE-A1', 'son@x.com', null, NOW, true);
t('E5 비고 칸 없는 시트 결과 지우기 → 예전처럼(비고 안 건드림)', r.ok && r.writes.length === 5, r);
r = c.planReplyEdit(tab, [H0, row(H0, done)], 'CE-A1', 'son@x.com', Object.assign({}, same, { memo: '메모' }), NOW, false);
t('E6 비고 칸 없는 시트 + 비고 있음 → HEADER_NOT_READY', r.error === 'HEADER_NOT_READY', r);
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고', '팀장 의견': '중' }, done))], 'CE-A1', 'son@x.com', Object.assign({}, same, { memo: '고친 비고' }), NOW, false);
t('E7 평가 완료 기록은 비고도 못 고침(ALREADY_REVIEWED, 예전 규칙)', r.error === 'ALREADY_REVIEWED', r);
r = c.planReplyEdit(tab, [H, row(H, Object.assign({ '비고': '처음 비고' }, done))], 'CE-A1', 'son@x.com', Object.assign({}, c.validateReply(Y), { itemKeys: '7654321' }), NOW, false);
t('E8 옛 화면(요청에 memo 없음)으로 결과를 고쳐도 비고는 그대로', r.ok && !wrote(r, H, '비고') && wrote(r, H, '아이템키').value === '7654321', r);
// 머리글 점검: 비고는 끝 6칸 앞이라 통과
t('H1 비고 칸 추가 시트 머리글 점검 통과', c.checkHeaderRow(H).ok === true, c.checkHeaderRow(H));
console.log('pass ' + pass + ' / fail ' + fail);
