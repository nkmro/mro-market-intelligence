// node tests/competency_crisis_tests.js — 2026-11-10 위기관리 탭 앱 입력(CREATE_RULES.crisis) 시험. 실제 접속 0건.
// 시트 1행은 2026-11-10 재홍님이 만든 '역량-문제해결및위기관리능력-위기관리' 탭을 그대로 읽은 이름.
const path = require('path');
const c = require(path.join(__dirname, '..', 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }
const J = JSON.stringify;
const TITLE = '역량-문제해결및위기관리능력-위기관리';
const H = ['순번', '이름', '사무소', '고객사', '공급사', '대처 기간 (YYMMDD~YYMMDD)', '위기 규모', '위기 발생 원인', '대처 결과', '팀장 의견', '수정 요청', '팀',
  '기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const GOOD = { customer: ' 대한정밀 ', supplier: ' 삼화프라스틱 ', periodFrom: '2026-11-03', periodTo: '2026-11-07', sales: '12,000', profit: '1800',
  cause: '주력 공급사 공장 화재로 원료 공급 중단 위기', result: '대체 공급사 2곳 확보, 납기 지연 없이 출하 유지' };
const V = o => c.validateCreate('crisis', Object.assign({}, GOOD, o));
const F = o => V(o).field;
const NOW = Date.UTC(2026, 10, 10, 3, 0); // 서울 2026-11-10 12:00

// ── 입력 검사 ──
let v = V({});
t('K1 정상: 시트 6칸 모양(앞뒤 공백 제거, 대처 기간 YYMMDD~YYMMDD, 위기 규모 매출/이익 천원)', v.ok && v.form === 'crisis' && J(v.cells) === J({ '고객사': '대한정밀', '공급사': '삼화프라스틱',
  '대처 기간 (YYMMDD~YYMMDD)': '261103~261107', '위기 규모': '매출 12,000천원 / 이익 1,800천원', '위기 발생 원인': GOOD.cause, '대처 결과': GOOD.result }), v);
t('K2 날짜 검사 값: month = 끝 날짜(YYYY-MM-DD), startMonth = 시작 달', v.month === '2026-11-07' && v.startMonth === '2026-11');
t('K3 공급사 선택: 빈칸·공백만·없음 → 빈 글자로 통과 / 101자 → supplier', V({ supplier: '' }).ok && V({ supplier: '   ' }).cells['공급사'] === '' && V({ supplier: undefined }).ok && F({ supplier: 'x'.repeat(101) }) === 'supplier');
t('K4 고객사 필수: 빈칸·공백만·101자 → customer', F({ customer: '' }) === 'customer' && F({ customer: '  ' }) === 'customer' && F({ customer: 'x'.repeat(101) }) === 'customer');
t('K5 대처 기간: 시작 없음·형식 틀림·없는 날 → periodFrom / 끝 없음(빈칸)·끝 < 시작 → periodTo (끝 없음 허용 안 함)',
  F({ periodFrom: '' }) === 'periodFrom' && F({ periodFrom: '261103' }) === 'periodFrom' && F({ periodFrom: '2026-02-30' }) === 'periodFrom' &&
  F({ periodTo: '' }) === 'periodTo' && F({ periodTo: '2026-11-02' }) === 'periodTo' && V({ periodTo: '2026-11-03' }).ok);
t('K6 위기 규모: 0 허용 / 마이너스·빈칸·글자·소수 → sales·profit', V({ sales: '0', profit: 0 }).cells['위기 규모'] === '매출 0천원 / 이익 0천원' &&
  F({ sales: '-1' }) === 'sales' && F({ sales: '' }) === 'sales' && F({ sales: 'abc' }) === 'sales' && F({ sales: '1.5' }) === 'sales' &&
  F({ profit: '-500' }) === 'profit' && F({ profit: '' }) === 'profit');
t('K7 원인·결과 필수: 빈칸·2001자 → cause·result', F({ cause: '' }) === 'cause' && F({ cause: 'x'.repeat(2001) }) === 'cause' && F({ result: '' }) === 'result' && F({ result: 'x'.repeat(2001) }) === 'result');

// ── 날짜 검사(원가개선과 같은 달 단위 + 끝 날짜가 오늘 이후면 막음) ──
const M = (to, from, today, close) => c.checkRecordMonth(to, (from || to).slice(0, 7), today, close || 10, 2026);
t('K8 끝 날짜 오늘·이번 달 → 통과 / 내일 → DATE_FUTURE', M('2026-11-10', '2026-11-03', '2026-11-10') === '' && M('2026-11-01', '', '2026-11-10') === '' && M('2026-11-11', '2026-11-03', '2026-11-10') === 'DATE_FUTURE');
t('K9 끝 날짜 지난달: 이번 달 10일까지 통과, 11일부터 DATE_TOO_OLD / 두 달 전 DATE_TOO_OLD', M('2026-10-31', '2026-10-20', '2026-11-10') === '' && M('2026-10-31', '2026-10-20', '2026-11-11') === 'DATE_TOO_OLD' && M('2026-09-30', '', '2026-11-05') === 'DATE_TOO_OLD');
t('K10 시작 날짜가 작년 → DATE_OTHER_YEAR', c.checkRecordMonth('2026-01-05', '2025-12', '2026-01-08', 10, 2026) === 'DATE_OTHER_YEAR');
t('K11 기존 달 단위 호출(YYYY-MM)은 그대로', M('2026-11', '2026-10', '2026-11-10') === '' && M('2026-12', '2026-11', '2026-11-10') === 'DATE_FUTURE' && M('2026-10', '', '2026-11-11') === 'DATE_TOO_OLD');

// ── 탭 인식·연결 ──
const tabs = c.recordTabsFromSheets([{ properties: { sheetId: 827457867, title: TITLE, index: 8, hidden: false } }]);
const tab = tabs[0];
t('K12 탭 인식: 항목 이름 위기관리, 키 g827457867', tab && tab.label === '위기관리' && tab.group === '문제해결및위기관리능력' && tab.id === 'g827457867', tabs);
t('K13 createFormFor → crisis (이름으로 찾음 — 내년 파일 gid가 바뀌어도 됨)', c.createFormFor(tab) === 'crisis' && c.createFormFor({ id: 'g1', label: '위기관리' }) === 'crisis');
const groups = c.criteriaGroups([['', '- 문제해결 및 위기관리 능력', '4%', '문제해결 능력'], ['', '', '', '위기관리 대처'], ['', '', '', '원가 방어 판단'], ['', '- 팀워크 기여도', '6%', '팀워크 기여']]);
const link = c.linkCriteria(tab, groups);
t('K14 기준표 연결: 위기관리 대처 1개', link.count === 1 && link.criteriaItem === '위기관리 대처', link);
t('K15 카드 제목 칸 = 고객사', c.titleFieldOf(tab.id, H) === '고객사');

// ── 새 줄·고치기·평가 ──
const tb = { id: tab.id, title: TITLE };
const viewer = { name: '이도윤', email: 'lee@x.com', office: '김해' };
let p = c.planCreate(tb, [H], new Set(), viewer, V({}), { team: '동부', nowMs: NOW });
const byCol = {}; (p.writes || []).forEach(w => { byCol[w.range.split('!')[1].replace(/\d+$/, '')] = w.value; });
t('K16 새 줄: 2행에 내용 6칸 + 순번·이름·사무소·팀·기록ID·작성자·기록일시', p.ok && p.writes.every(w => /!\D+2$/.test(w.range)) && byCol.A === '1' && byCol.B === '이도윤' && byCol.C === '김해' &&
  byCol.D === '대한정밀' && byCol.E === '삼화프라스틱' && byCol.F === '261103~261107' && byCol.G === '매출 12,000천원 / 이익 1,800천원' && byCol.L === '동부' && /^CE-/.test(byCol.M) && byCol.N === 'lee@x.com', p);
t('K17 머리글에 내용 칸이 하나라도 없으면 HEADER_NOT_READY', c.planCreate(tb, [H.filter(x => x !== '위기 규모')], new Set(), viewer, V({}), { team: '동부', nowMs: NOW }).error === 'HEADER_NOT_READY');
const row = ['1', '이도윤', '김해', '대한정밀', '', '261103~261107', '매출 12,000천원 / 이익 1,800천원', GOOD.cause, GOOD.result, '', '', '동부', 'CE-X1', 'lee@x.com', '2026-11-10 12:00'];
let u = c.planUpdate(tb, [H, row.slice()], 'CE-X1', 'lee@x.com', V({ supplier: '' , result: '고친 결과' }), NOW);
t('K18 고치기: 대처 기간 그대로면 날짜 검사 안 함(바뀐 칸 + 수정일시만)', u.ok && u.needDateCheck === false && u.writes.length === 2 && u.writes[0].value === '고친 결과', u);
u = c.planUpdate(tb, [H, row.slice()], 'CE-X1', 'lee@x.com', V({ supplier: '', periodTo: '2026-11-08' }), NOW);
t('K19 고치기: 대처 기간이 바뀌면 날짜 검사', u.ok && u.needDateCheck === true, u);
t('K20 남의 기록 고치기 → NOT_YOUR_RECORD', c.planUpdate(tb, [H, row.slice()], 'CE-X1', 'kim@x.com', V({}), NOW).error === 'NOT_YOUR_RECORD');
const rv = c.planReview(tb, [H, row.slice()], 'CE-X1', c.validateReview({ grade: '상', line: '빠른 대처' }), false, NOW);
t('K21 팀장 평가(상·중·하)도 이 탭에서 그대로 됨(팀장 의견·팀장한줄의견·수정일시)', rv.ok && rv.writes.some(w => /!J2$/.test(w.range) && w.value === '상') && rv.writes.some(w => /!Q2$/.test(w.range) && w.value === '빠른 대처'), rv);
t('K22 "제외"는 이 탭에서 안 됨(달성 여부 칸 없음)', c.planReview(tb, [H, row.slice()], 'CE-X1', c.validateReview({ grade: '제외', line: '사유' }), false, NOW).error === 'EXCLUDE_NOT_ALLOWED');

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
