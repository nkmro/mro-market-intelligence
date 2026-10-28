// node tests/competency_create_tests.js — 2-다 대면영업 기록 추가(action create) 시험 (실제 Google·Firestore 접속 0건)
// A: lib/competency.js 순수 함수(validateCreate·checkRecordDate·planCreate·createFormFor)  B: index.js saveCompetencyTest action=create 그대로 실행
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const c = require(path.join(dir, 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }
const J = JSON.stringify;
const clone = o => JSON.parse(J(o));
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const U = (email, name, role, team, status, office) => [email, name, role, team, status, '', '', '', '', office];
let USERS = [
  U('jhjoo@nkmro.com', '주재홍', '팀장', '동부', '활성', '양산'),
  U('ceo@x.com', '유대표', '임원', '본사', '활성', '본사'),
  U('kim@x.com', '김하늘', '담당', '동부', '활성', '양산'),
  U('lee@x.com', '이도윤', '일반', '동부', '활성', '김해'),
  U('park@x.com', '박서준', '일반', '동부', '비활성', '양산')
];
let SETTING_WINDOW = '14';
const GIDS = { '역량-영업수행역량-대면영업': 1204504857, '역량-개선기획역량-추가매출': 772700407, '역량-개선기획역량-원가개선': 1981522387, '역량-직무별전문성-자기개발': 0, '역량-직급별업무역량-직급역량': 1406147068 }; // 지금 파일의 gid → 기존 키 faceSales·addSales·costSave
const ADD = '역량-개선기획역량-추가매출', FACE = '역량-영업수행역량-대면영업', COST = '역량-개선기획역량-원가개선';
const FACE_H = ['순번', '이름', '사무소', '고객사', '대면자', '직급', '미팅 일시(YYMMDD-HH)', '미팅 시간(분)', '기대 성과', '팀장 의견 (상중하)', '팀'].concat(EX);
const SELF = '역량-직무별전문성-자기개발', GRADE = '역량-직급별업무역량-직급역량';
const SELF_H = ['순번', '이름', '사무소', '자기개발 항목', '자기개발 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '자기 성취 평가 요약', '팀장 의견', '팀'].concat(EX);
const GRADE_H = ['순번', '이름', '사무소', '개선 직급 역량 항목', '직급 역량 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '자기 성취 평가', '팀장 의견', '팀'].concat(EX);
const COST_H = ['순번', '이름', '사무소', '고객사', '공급사', '원가 개선 항목', '원가 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '기대 성과', '아이템키', '팀장 의견', '팀'].concat(EX);
const F = (no, who, cust, id, email) => [String(no), who, '양산', cust, '홍길동', '과장', '999999-99', '30', '수주', '', '동부', id, email, '2026-10-01 09:00'];
function baseTabs() {
  return {
    [FACE]: [FACE_H, F(1, '김하늘', '가람산업', 'CE-F1', 'kim@x.com'), F(7, '이도윤', '나래기공', 'CE-F2', 'lee@x.com'), F(3, '김하늘', '다온화학', 'CE-F3', 'kim@x.com')],
    [ADD]: [['사무소', '담당', '고객사', '달성 여부 (Y/N)', '팀장 의견', '팀'].concat(EX), ['양산', '김하늘', '아라전자', '', '', '동부', 'CE-A1', 'kim@x.com']],
    [SELF]: [SELF_H, ['1']], // 2행: 순번 '1'만 있는 빈 줄(실제 시트와 같음)
    [GRADE]: [GRADE_H, ['1']],
    [COST]: [COST_H, ['1', '김하늘', '양산', '아라전자', '한빛상사', '포장 변경', '규격 표준화', '26년4월~', 'Y', '연 120만원', '', '중', '동부', 'CE-C1', 'kim@x.com'], ['12', '이도윤', '김해', '가람산업', '대한안전', '장갑 변경', '단가 인하', '26년 06~08월', 'Y', '연 60만원', '', '상', '동부', 'CE-C2', 'lee@x.com']]
  };
}
const TODAY = c.seoulIsoDate(Date.now());
const daysAgo = n => new Date(Date.UTC(+TODAY.slice(0, 4), +TODAY.slice(5, 7) - 1, +TODAY.slice(8, 10)) - n * 86400000).toISOString().slice(0, 10);
const GOOD = { customer: ' 마루산업 ', people: [{ name: '최민수', rank: '부장' }, { name: '정다은', rank: '대리' }], meetDate: '2026-10-20', meetHour: 9, minutes: 40, expected: '하반기 공구 단가 계약 논의' };

// ── A. 순수 함수 ──
let v = c.validateCreate('faceSales', GOOD);
t('A1 정상: 고객사 앞뒤 공백 제거, 대면자·직급 쉼표로 합침, 미팅 일시 261020-09, 시간 "40"', v.ok && v.form === 'faceSales' && v.date === '2026-10-20' && J(v.cells) === J({ '고객사': '마루산업', '대면자': '최민수,정다은', '직급': '부장,대리', '미팅 일시(YYMMDD-HH)': '261020-09', '미팅 시간(분)': '40', '기대 성과': '하반기 공구 단가 계약 논의' }), v);
const bf = o => c.validateCreate('faceSales', Object.assign({}, GOOD, o)).field;
t('A2 고객사 빈칸·공백만·101자 → customer', bf({ customer: '' }) === 'customer' && bf({ customer: '   ' }) === 'customer' && bf({ customer: 'x'.repeat(101) }) === 'customer' && !bf({ customer: 'x'.repeat(100) }));
t('A3 대면자: 없음·빈 배열·11명·이름 빈칸·직급 빈칸·쉼표·줄바꿈 → people', bf({ people: undefined }) === 'people' && bf({ people: [] }) === 'people' && bf({ people: Array(11).fill({ name: 'a', rank: 'b' }) }) === 'people' && bf({ people: [{ name: '', rank: '과장' }] }) === 'people' && bf({ people: [{ name: '김', rank: ' ' }] }) === 'people' && bf({ people: [{ name: '김,이', rank: '과장' }] }) === 'people' && bf({ people: [{ name: '김', rank: '과\n장' }] }) === 'people' && !bf({ people: Array(10).fill({ name: 'a', rank: 'b' }) }));
t('A4 날짜: 없음·형식 틀림·없는 날(2026-02-30) → meetDate', bf({ meetDate: '' }) === 'meetDate' && bf({ meetDate: '261020' }) === 'meetDate' && bf({ meetDate: '2026-02-30' }) === 'meetDate');
t('A5 시: 없음·빈칸·24·-1·9.5·글자 → meetHour / 0·23·"7" 허용(0 → "-00")', bf({ meetHour: undefined }) === 'meetHour' && bf({ meetHour: '' }) === 'meetHour' && bf({ meetHour: null }) === 'meetHour' && bf({ meetHour: 24 }) === 'meetHour' && bf({ meetHour: -1 }) === 'meetHour' && bf({ meetHour: 9.5 }) === 'meetHour' && bf({ meetHour: '아침' }) === 'meetHour' && c.validateCreate('faceSales', Object.assign({}, GOOD, { meetHour: 0 })).cells['미팅 일시(YYMMDD-HH)'] === '261020-00' && c.validateCreate('faceSales', Object.assign({}, GOOD, { meetHour: '7' })).cells['미팅 일시(YYMMDD-HH)'] === '261020-07' && !bf({ meetHour: 23 }));
t('A6 분: 없음·0·601·소수 → minutes / 1·600·"20" 허용(기타 직접 입력)', bf({ minutes: undefined }) === 'minutes' && bf({ minutes: 0 }) === 'minutes' && bf({ minutes: 601 }) === 'minutes' && bf({ minutes: 12.5 }) === 'minutes' && !bf({ minutes: 1 }) && !bf({ minutes: 600 }) && c.validateCreate('faceSales', Object.assign({}, GOOD, { minutes: '20' })).cells['미팅 시간(분)'] === '20');
t('A7 기대 성과: 빈칸·2001자 → expected / 줄바꿈(\\r\\n)은 \\n으로 저장', bf({ expected: '' }) === 'expected' && bf({ expected: 'x'.repeat(2001) }) === 'expected' && c.validateCreate('faceSales', Object.assign({}, GOOD, { expected: '가\r\n나' })).cells['기대 성과'] === '가\n나');
t('A8 규칙 없는 입력 칸(addSales·toString·빈값) → TAB_NOT_SUPPORTED', c.validateCreate('addSales', GOOD).error === 'TAB_NOT_SUPPORTED' && c.validateCreate('toString', GOOD).error === 'TAB_NOT_SUPPORTED' && c.validateCreate('', GOOD).error === 'TAB_NOT_SUPPORTED');
t('A9 createFormFor: 기존 키 faceSales, 새 gid라도 이름이 대면영업이면 faceSales, 그 밖은 ""', c.createFormFor({ id: 'faceSales', label: '대면영업' }) === 'faceSales' && c.createFormFor({ id: 'g555', label: '대면영업' }) === 'faceSales' && c.createFormFor({ id: 'addSales', label: '추가매출' }) === '' && c.createFormFor(null) === '');
t('A10 날짜 검사(14일): 오늘~13일 전 허용, 14일 전 DATE_TOO_OLD, 내일 DATE_FUTURE', c.checkRecordDate('2026-10-27', '2026-10-27', 14, 2026) === '' && c.checkRecordDate('2026-10-14', '2026-10-27', 14, 2026) === '' && c.checkRecordDate('2026-10-13', '2026-10-27', 14, 2026) === 'DATE_TOO_OLD' && c.checkRecordDate('2026-10-28', '2026-10-27', 14, 2026) === 'DATE_FUTURE');
t('A11 연초: 1월 3일에 작년 12월 30일 → DATE_OTHER_YEAR(1월 유예 없음), 1일 기간이면 오늘만', c.checkRecordDate('2025-12-30', '2026-01-03', 14, 2026) === 'DATE_OTHER_YEAR' && c.checkRecordDate('2026-10-26', '2026-10-27', 1, 2026) === 'DATE_TOO_OLD' && c.checkRecordDate('2026-10-27', '2026-10-27', 1, 2026) === '');
t('A12 기록 가능 기간: 없음·0·61·글자 → 14, "30" → 30', c.recordWindowDays([]) === 14 && c.recordWindowDays([['기록가능기간일', '0']]) === 14 && c.recordWindowDays([['기록가능기간일', '61']]) === 14 && c.recordWindowDays([['기록가능기간일', '열흘']]) === 14 && c.recordWindowDays([['기록가능기간일', ' 30 ']]) === 30 && c.recordWindowDays([['기록가능기간일', '1']]) === 1);
t('A13 seoulIsoDate 서울 날짜(UTC 15시 = 다음 날)', c.seoulIsoDate(Date.UTC(2026, 9, 26, 15, 0)) === '2026-10-27' && c.seoulIsoDate(Date.UTC(2026, 9, 26, 14, 59)) === '2026-10-26');
{
  const tabs = baseTabs(); const before = J(tabs);
  const ids = new Set(['CE-F1', 'CE-F2', 'CE-F3', 'CE-A1']);
  let k = 0; const rand = () => [0.1, 0.1, 0.5][k++] || 0.9; // 첫 번째 후보를 겹치게 만들어 다시 뽑는지 본다
  ids.add('CE-20261027-1999');
  const now = Date.UTC(2026, 9, 27, 3, 30);
  const p = c.planCreate({ id: 'faceSales', title: FACE }, tabs[FACE], ids, { name: '김하늘', email: ' KIM@x.com', office: '양산' }, c.validateCreate('faceSales', GOOD), { team: '동부', nowMs: now, rand });
  const byH = {}; (p.writes || []).forEach(w => { byH[w.range] = w.value; });
  t('A14 새 줄 = 5행(값 있는 마지막 줄 다음), 쓰는 칸 13개(빈 칸은 안 씀)', p.ok && p.writes.length === 13 && p.writes.every(w => /!([A-Z]+)5$/.test(w.range)) && p.record.row === 5, p.writes);
  const q = "'역량-영업수행역량-대면영업'!";
  t('A15 순번 = 가장 큰 순번(7)+1 = "8", 이름·사무소·팀·작성자이메일(소문자)·기록일시', byH[q + 'A5'] === '8' && byH[q + 'B5'] === '김하늘' && byH[q + 'C5'] === '양산' && byH[q + 'K5'] === '동부' && byH[q + 'M5'] === 'kim@x.com' && byH[q + 'N5'] === '2026-10-27 12:30', byH);
  t('A16 내용 칸 D~I, 팀장 의견(J)·수정일시(O)·한줄의견·첨부는 비움', byH[q + 'D5'] === '마루산업' && byH[q + 'E5'] === '최민수,정다은' && byH[q + 'F5'] === '부장,대리' && byH[q + 'G5'] === '261020-09' && byH[q + 'H5'] === '40' && byH[q + 'I5'] === '하반기 공구 단가 계약 논의' && !(q + 'J5' in byH) && !(q + 'O5' in byH) && !(q + 'P5' in byH) && !(q + 'Q5' in byH));
  t('A17 기록ID: 파일 안 기존 ID와 겹치면 다시 뽑음(CE-20261027-…)', /^CE-20261027-[0-9a-f]{4}$/.test(byH[q + 'L5']) && byH[q + 'L5'] !== 'CE-20261027-1999' && p.record.recordId === byH[q + 'L5'], byH[q + 'L5']);
  t('A18 돌려주는 기록: 미평가(pendingReview), 작성자 active, 사무소', p.record.reviewState === 'pendingReview' && p.record.authorStatus === 'active' && p.record.authorEmail === 'kim@x.com' && p.record.office === '양산' && p.record.tab === 'faceSales' && p.record.fields['고객사'] === '마루산업' && p.record.fields['팀장 의견 (상중하)'] === '', p.record);
  t('A19 원본 값 배열은 바꾸지 않음', J(tabs) === before);
  const p2 = c.planCreate({ id: 'faceSales', title: FACE }, [FACE_H], new Set(), { name: '김하늘', email: 'kim@x.com', office: '' }, c.validateCreate('faceSales', GOOD), { team: '동부', nowMs: now });
  t('A20 빈 탭(머리글만): 2행, 순번 "1", 사무소 빈 값이면 그 칸은 안 씀(12칸)', p2.ok && p2.record.row === 2 && p2.writes.find(w => w.range === q + 'A2').value === '1' && p2.writes.length === 12 && !p2.writes.some(w => w.range === q + 'C2'), p2.writes);
  const hdr = h => c.planCreate({ id: 'faceSales', title: FACE }, [FACE_H.filter(x => x !== h)], new Set(), { name: '김', email: 'k@x', office: '' }, c.validateCreate('faceSales', GOOD), { team: '동부', nowMs: now }).error;
  t('A21 필요한 머리글(이름·대면자·미팅 일시·팀·기록ID·작성자이메일·기록일시) 없으면 HEADER_NOT_READY / 순번·사무소는 없어도 됨', ['이름', '대면자', '미팅 일시(YYMMDD-HH)', '팀', '기록ID', '작성자이메일', '기록일시'].every(h => hdr(h) === 'HEADER_NOT_READY') && !hdr('순번') && !hdr('사무소'));
  const p3 = c.planCreate({ id: 'faceSales', title: FACE }, tabs[FACE].concat([[], ['', '', '메모']]), new Set(), { name: '김', email: 'k@x', office: '' }, c.validateCreate('faceSales', GOOD), { team: '동부', nowMs: now });
  t('A22 아래쪽에 이름 없는 줄(메모 등)이 있으면 그 다음 줄(7행)에 — 기존 칸을 덮지 않음', p3.ok && p3.record.row === 7, p3.record && p3.record.row);
}


// ── A-원가개선 (2026-10-27 재홍님 결정: Y 완료 / N 미완료, 원가 개선액 천원, 수행 기간 달 단위) ──
const CG = { customer: ' 나래기공 ', supplier: '대한안전', item: '안전장갑 공급사 변경', reason: '동일 사양 단가 12% 인하', done: 'Y', periodFrom: '2608', periodTo: '2610', amount: '2,400', itemKeys: '1234567, 2345678,1234567' };
v = c.validateCreate('costSave', CG);
t('AC1 Y 완료: 기간 2608~2610, "개선 2,400천원", 아이템키 합침, 검사 달 = 끝 달 2026-10, 시작 달 2026-08', v.ok && v.cells['수행 기간 (YYMMDD~YYMMDD)'] === '2608~2610' && v.cells['기대 성과'] === '개선 2,400천원' && v.cells['아이템키'] === '1234567,2345678' && v.cells['완료 여부 (Y/N)'] === 'Y' && v.cells['고객사'] === '나래기공' && v.month === '2026-10' && v.startMonth === '2026-08' && !v.date, v);
v = c.validateCreate('costSave', Object.assign({}, CG, { periodTo: '', periodOpen: true }));
t('AC2 Y + 끝 없음(계속) → "2608~", 개선액 "개선 2,400천원 / 월 평균", 검사 달 = 시작 달', v.ok && v.cells['수행 기간 (YYMMDD~YYMMDD)'] === '2608~' && v.cells['기대 성과'] === '개선 2,400천원 / 월 평균' && v.month === '2026-08', v);
v = c.validateCreate('costSave', Object.assign({}, CG, { done: 'n', periodFrom: 'x', amount: '', itemKeys: '' }));
t('AC3 N 미완료(소문자도): 완료 여부만 — 기간·개선액·아이템키 안 봄·안 씀, 날짜 검사 없음', v.ok && v.cells['완료 여부 (Y/N)'] === 'N' && !('수행 기간 (YYMMDD~YYMMDD)' in v.cells) && !('기대 성과' in v.cells) && !('아이템키' in v.cells) && !v.month && !v.date, v);
const bc = o => c.validateCreate('costSave', Object.assign({}, CG, o)).field;
t('AC4 필수 글자 칸: 고객사·공급사·항목(100자)·사유 빈칸 → 각 field', bc({ customer: '' }) === 'customer' && bc({ supplier: ' ' }) === 'supplier' && bc({ item: 'x'.repeat(101) }) === 'item' && bc({ reason: '' }) === 'reason');
t('AC5 완료 여부 없음·다른 글자 → done', bc({ done: '' }) === 'done' && bc({ done: '완료' }) === 'done');
t('AC6 기간: 시작 없음·월 13 → periodFrom / 끝도 끝없음도 없음·둘 다·끝<시작 → periodTo / 같은 달 허용', bc({ periodFrom: '' }) === 'periodFrom' && bc({ periodFrom: '2613' }) === 'periodFrom' && bc({ periodTo: '' }) === 'periodTo' && bc({ periodOpen: true }) === 'periodTo' && bc({ periodTo: '2607' }) === 'periodTo' && !bc({ periodTo: '2608' }));
t('AC7 개선액: 빈칸·음수·소수·글자 → amount / 0 허용 "개선 0천원"', bc({ amount: '' }) === 'amount' && bc({ amount: '-1' }) === 'amount' && bc({ amount: '1.5' }) === 'amount' && bc({ amount: '천' }) === 'amount' && c.validateCreate('costSave', Object.assign({}, CG, { amount: 0 })).cells['기대 성과'] === '개선 0천원');
t('AC8 Y인데 아이템키 없음·글자 → itemKeys', bc({ itemKeys: '' }) === 'itemKeys' && bc({ itemKeys: '12a' }) === 'itemKeys');
t('AC9 createFormFor: costSave 키·이름 "원가개선"(새 gid) → costSave', c.createFormFor({ id: 'costSave', label: '원가개선' }) === 'costSave' && c.createFormFor({ id: 'g777', label: '원가개선' }) === 'costSave');
t('AC10 달 검사(14일): 10/27에 10월 허용·9월 DATE_TOO_OLD·11월 DATE_FUTURE / 10/5에는 9월 허용(14일 전 9/22) / 시작 달 작년 → DATE_OTHER_YEAR',
  c.checkRecordMonth('2026-10', '2026-08', '2026-10-27', 14, 2026) === '' && c.checkRecordMonth('2026-09', '2026-08', '2026-10-27', 14, 2026) === 'DATE_TOO_OLD' && c.checkRecordMonth('2026-11', '2026-10', '2026-10-27', 14, 2026) === 'DATE_FUTURE' && c.checkRecordMonth('2026-09', '2026-09', '2026-10-05', 14, 2026) === '' && c.checkRecordMonth('2026-01', '2025-12', '2026-01-05', 14, 2026) === 'DATE_OTHER_YEAR');
{
  const now = Date.UTC(2026, 9, 27, 3, 30);
  const tb = baseTabs();
  const p = c.planCreate({ id: 'costSave', title: COST }, tb[COST], new Set(), { name: '김하늘', email: 'kim@x.com', office: '양산' }, c.validateCreate('costSave', CG), { team: '동부', nowMs: now });
  const q = "'역량-개선기획역량-원가개선'!"; const byH = {}; p.writes.forEach(w => { byH[w.range] = w.value; });
  t('AC11 planCreate Y: 4행, 순번 13(가장 큰 12 + 1), 내용 8칸 H·I·J·K 포함, 팀장 의견(L) 비움, 쓰는 칸 15개', p.ok && p.record.row === 4 && byH[q + 'A4'] === '13' && byH[q + 'H4'] === '2608~2610' && byH[q + 'I4'] === 'Y' && byH[q + 'J4'] === '개선 2,400천원' && byH[q + 'K4'] === '1234567,2345678' && !(q + 'L4' in byH) && p.writes.length === 15 && p.record.reviewState === 'pendingReview', byH);
  const pN = c.planCreate({ id: 'costSave', title: COST }, tb[COST], new Set(), { name: '김하늘', email: 'kim@x.com', office: '양산' }, c.validateCreate('costSave', Object.assign({}, CG, { done: 'N' })), { team: '동부', nowMs: now });
  t('AC12 planCreate N: 기간·개선액·아이템키 칸은 안 씀(쓰는 칸 12개)', pN.ok && pN.writes.length === 12 && !pN.writes.some(w => /![HJK]4$/.test(w.range)) && pN.record.fields['완료 여부 (Y/N)'] === 'N', pN.writes.map(w => w.range));
  const tb2 = baseTabs(); tb2[COST][0] = COST_H.filter(h => h !== '아이템키');
  t('AC13 아이템키 칸 없는 원가개선 탭 → HEADER_NOT_READY', c.planCreate({ id: 'costSave', title: COST }, tb2[COST], new Set(), { name: '김', email: 'k@x', office: '' }, c.validateCreate('costSave', CG), { team: '동부', nowMs: now }).error === 'HEADER_NOT_READY');
}


// ── A-자기개발·직급역량 (2026-10-28 재홍님: 원가개선 틀, Y 완료는 끝 없음 불가, N 미완료는 항목·사유만) ──
const SG = { item: ' 산업안전기사 자격 취득 ', reason: '법규 근거 설명', done: 'Y', periodFrom: '2607', periodTo: '2610', evaluation: '필기·실기 합격' };
v = c.validateCreate('selfDev', SG);
t('AS1 자기개발 Y: 항목·사유·완료·기간 2607~2610·자기 성취 평가 요약, 검사 달 = 끝 달', v.ok && J(v.cells) === J({ '자기개발 항목': '산업안전기사 자격 취득', '자기개발 사유': '법규 근거 설명', '완료 여부 (Y/N)': 'Y', '수행 기간 (YYMMDD~YYMMDD)': '2607~2610', '자기 성취 평가 요약': '필기·실기 합격' }) && v.month === '2026-10' && v.startMonth === '2026-07', v);
v = c.validateCreate('gradeComp', SG);
t('AS2 직급역량 Y: 칸 이름 개선 직급 역량 항목·직급 역량 개선 사유·자기 성취 평가', v.ok && v.cells['개선 직급 역량 항목'] === '산업안전기사 자격 취득' && v.cells['직급 역량 개선 사유'] === '법규 근거 설명' && v.cells['자기 성취 평가'] === '필기·실기 합격', v);
const bs = (f, o) => c.validateCreate(f, Object.assign({}, SG, o)).field;
t('AS3 Y + 끝 없음 → periodTo(허용 안 함) / 끝 달 없음·끝<시작 → periodTo / 시작 없음 → periodFrom', bs('selfDev', { periodTo: '', periodOpen: true }) === 'periodTo' && bs('selfDev', { periodTo: '' }) === 'periodTo' && bs('gradeComp', { periodTo: '2606' }) === 'periodTo' && bs('gradeComp', { periodFrom: '' }) === 'periodFrom' && bs('selfDev', { periodOpen: true }) === 'periodTo');
t('AS4 Y인데 자기 성취 평가 빈칸 → evaluation / 항목·사유·완료 여부 빈칸 → 각 field', bs('selfDev', { evaluation: ' ' }) === 'evaluation' && bs('gradeComp', { item: '' }) === 'item' && bs('selfDev', { reason: '' }) === 'reason' && bs('selfDev', { done: '' }) === 'done');
v = c.validateCreate('selfDev', Object.assign({}, SG, { done: 'N', periodFrom: '', periodTo: '', evaluation: '' }));
t('AS5 N 미완료: 항목·사유·완료 여부만, 날짜 검사 없음', v.ok && J(Object.keys(v.cells)) === J(['자기개발 항목', '자기개발 사유', '완료 여부 (Y/N)']) && !v.month, v);
t('AS6 createFormFor: 자기개발(gid 0 = selfDev)·직급역량(gradeComp), 새 gid라도 이름으로', c.createFormFor({ id: 'selfDev', label: '자기개발' }) === 'selfDev' && c.createFormFor({ id: 'gradeComp', label: '직급역량' }) === 'gradeComp' && c.createFormFor({ id: 'g9', label: '자기개발' }) === 'selfDev');
{
  const now = Date.UTC(2026, 9, 28, 3, 30); const tb = baseTabs();
  const ps = c.planCreate({ id: 'selfDev', title: SELF }, tb[SELF], new Set(), { name: '김하늘', email: 'kim@x.com', office: '양산' }, c.validateCreate('selfDev', SG), { team: '동부', nowMs: now });
  const q = "'역량-직무별전문성-자기개발'!"; const byH = {}; ps.writes.forEach(w => { byH[w.range] = w.value; });
  t('AS7 planCreate: 순번만 있는 2행은 그대로 두고 3행에, 순번 2, D~H 내용, 팀장 의견(I) 비움', ps.ok && ps.record.row === 3 && byH[q + 'A3'] === '2' && byH[q + 'D3'] === '산업안전기사 자격 취득' && byH[q + 'F3'] === '2607~2610' && byH[q + 'G3'] === 'Y' && byH[q + 'H3'] === '필기·실기 합격' && !(q + 'I3' in byH) && byH[q + 'J3'] === '동부' && !Object.keys(byH).some(k => /2$/.test(k)), byH);
}

// ── B. index.js 그대로 실행 (가짜 시트·가짜 Firestore — competency_backfill_tests.js와 같은 시험 장치) ──
function makeFakeFirestore() {
  const store = {}; let chain = Promise.resolve();
  function docRef(col, id) {
    const key = col + '/' + id;
    const ref = {
      _key: key,
      get: async () => ({ exists: key in store, ref: ref, data: () => store[key] && JSON.parse(J(store[key])) }),
      set: async d => { store[key] = JSON.parse(J(d)); },
      update: async d => { store[key] = Object.assign({}, store[key], JSON.parse(J(d))); },
      delete: async () => { delete store[key]; }
    };
    return ref;
  }
  return {
    store,
    collection: n => ({ doc: id => docRef(n, id) }),
    // 실제 Firestore처럼 트랜잭션끼리 겹치지 않게 한 줄로 세운다(동시 요청 시험용)
    runTransaction: fn => {
      const run = chain.then(async () => {
        const ops = [];
        const tx = { get: r => r.get(), set: (r, d) => ops.push(() => r.set(d)), delete: r => ops.push(() => r.delete()), update: (r, d) => ops.push(() => r.update(d)) };
        const out = await fn(tx);
        for (const op of ops) await op();
        return out;
      });
      chain = run.catch(() => {});
      return run;
    }
  };
}
const MRO_ID = '1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU';
const FILE_ID = 'FILE2026';
function makeFakeSheets(tabs, opts) {
  opts = opts || {};
  const st = { tabs: tabs, requests: [], writes: [], failFileRead: false };
  const titles = Object.keys(tabs);
  const trim = rows => rows.map(r => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] === undefined)) x.pop(); return x; });
  function readRange(a1) {
    const i = a1.lastIndexOf('!'); const tab = a1.slice(0, i).replace(/^'|'$/g, '').replace(/''/g, "'"); const rg = a1.slice(i + 1);
    if (tab === '인사평가설정') return [['키', '값', '설명'], ['기록가능기간일', SETTING_WINDOW, '']];
    if (tab === 'CRM-역량평가-기준') return [];
    const rows = st.tabs[tab]; if (!rows) { const e = new Error('Unable to parse range'); e.response = { status: 400 }; throw e; }
    if (rg === '1:1') return trim([rows[0]]);
    return trim(clone(rows));
  }
  st.client = {
    request: async ({ url, method, data }) => {
      st.requests.push({ url, method: method || 'GET', data });
      if (url.includes('/values:batchUpdate')) {
        if (opts.beforeWrite) opts.beforeWrite(st);
        data.data.forEach(d => {
          const i = d.range.lastIndexOf('!'); const tab = d.range.slice(0, i).replace(/^'|'$/g, ''); const m = d.range.slice(i + 1).match(/^([A-Z]+)(\d+)$/);
          let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); col -= 1;
          while (st.tabs[tab].length < Number(m[2])) st.tabs[tab].push([]);
          const row = st.tabs[tab][Number(m[2]) - 1]; while (row.length <= col) row.push(''); row[col] = d.values[0][0];
          st.writes.push(d);
        });
        return { data: { totalUpdatedCells: data.data.length } };
      }
      if (url.includes(FILE_ID + '?fields=')) {
        if (st.failFileRead) { const e = new Error('403'); e.response = { status: 403 }; throw e; }
        return { data: { sheets: titles.map((tt, i) => ({ properties: { sheetId: (tt in GIDS) ? GIDS[tt] : 100 + i, title: tt, hidden: false, index: i } })).concat([{ properties: { sheetId: 9, title: '인사평가설정', index: 50 } }, { properties: { sheetId: 8, title: 'CRM-역량평가-기준', index: 51 } }]) } };
      }
      const q = url.split('?')[1].split('&').filter(s => s.startsWith('ranges=')).map(s => decodeURIComponent(s.slice(7)));
      if (url.includes(MRO_ID)) {
        return { data: { valueRanges: q.map(a1 => ({ values: a1.includes('설정') ? [['인사평가파일_2026', FILE_ID, '']] : USERS })) } };
      }
      if (url.includes(FILE_ID)) {
        if (st.failFileRead) { const e = new Error('403'); e.response = { status: 403 }; throw e; }
        return { data: { valueRanges: q.map(a1 => ({ values: readRange(a1) })) } };
      }
      throw new Error('모르는 요청 ' + url);
    }
  };
  return st;
}
function makeEnv(tabs, opts) {
  const fs_ = makeFakeFirestore();
  const sh = makeFakeSheets(tabs || baseTabs(), opts);
  const exp = new Date(Date.now() + 3600000).toISOString();
  fs_.store['sessions/TOK_ADMIN'] = { email: 'jhjoo@nkmro.com', expiresAt: exp };
  fs_.store['sessions/TOK_STAFF'] = { email: 'kim@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_LEE'] = { email: 'lee@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_EXEC'] = { email: 'ceo@x.com', expiresAt: exp };
  fs_.store['sessions/TOK_PARK'] = { email: 'park@x.com', expiresAt: exp };
  const stubs = {
    '@google-cloud/firestore': { Firestore: class { constructor() { return fs_; } }, FieldValue: { serverTimestamp: () => 'TS' } },
    'google-auth-library': { GoogleAuth: class { async getClient() { return sh.client; } } }
  };
  const req = n => stubs[n] || require(n.startsWith('.') ? path.join(dir, n) : n);
  const gal = require.resolve('google-auth-library', { paths: [dir] });
  require.cache[gal] = { id: gal, filename: gal, loaded: true, exports: stubs['google-auth-library'] };
  delete require.cache[path.join(dir, 'lib', 'sheetsClient.js')];
  const mod = { exports: {} };
  const ctx = { require: req, module: mod, exports: mod.exports, console: { log() {}, error() {} }, process: { env: {} }, Buffer, setTimeout, clearTimeout, Date, URL, TextEncoder, fetch: async () => { throw new Error('fetch 금지'); }, AbortController };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
  const call = (fn) => async (body, method) => {
    const out = {};
    await mod.exports[fn]({ method: method || 'POST', body }, { set() {}, status: code => ({ json: o => { out.httpStatus = code; Object.assign(out, o); }, send() { out.httpStatus = code; } }) });
    return out;
  };
  return { fs: fs_, sh, save: call('saveCompetencyTest'), get: call('getCompetencyTest') };
}
const fileWrites = sh => sh.requests.filter(r => r.method !== 'GET');
const callCreate = (e, tok, extra) => e.save(Object.assign({ sessionToken: tok, action: 'create', form: 'faceSales', idempotencyKey: 'K' + Math.random(), tab: 'faceSales' }, GOOD, { meetDate: daysAgo(2) }, extra || {}));

(async () => {
  let e = makeEnv(); let res;
  const before = clone(e.sh.tabs);
  res = await callCreate(e, 'TOK_ADMIN');
  t('B1 팀장 → FORBIDDEN, 인사평가 파일 접근 0', res.error === 'FORBIDDEN' && !e.sh.requests.some(r => r.url.includes(FILE_ID)), res);
  res = await callCreate(e, 'TOK_EXEC');
  t('B2 임원 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  res = await callCreate(e, 'TOK_PARK');
  t('B3 비활성(퇴사) → FORBIDDEN, 잠금 문서 없음', res.error === 'FORBIDDEN' && !('writeLocks/competencyEval' in e.fs.store), res);
  res = await e.save(Object.assign({ sessionToken: 'TOK_STAFF', action: 'create', tab: 'faceSales', form: 'faceSales' }, GOOD));
  t('B4 중복 방지 키 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  res = await callCreate(e, 'TOK_STAFF', { form: undefined });
  t('B5 form 없음 → MISSING_FIELDS', res.error === 'MISSING_FIELDS', res);
  let nReq = e.sh.requests.length;
  res = await callCreate(e, 'TOK_STAFF', { form: 'addSales' });
  t('B6 규칙 없는 form → TAB_NOT_SUPPORTED, 시트 접근 0', res.error === 'TAB_NOT_SUPPORTED' && e.sh.requests.length === nReq, res);
  res = await callCreate(e, 'TOK_STAFF', { meetHour: '' });
  t('B7 시 빈칸 → BAD_INPUT(meetHour), 시트 접근 0', res.error === 'BAD_INPUT' && res.field === 'meetHour' && e.sh.requests.length === nReq, res);
  res = await callCreate(e, 'TOK_STAFF', { people: [{ name: '최민수', rank: '' }] });
  t('B8 직급 빈칸 → BAD_INPUT(people)', res.error === 'BAD_INPUT' && res.field === 'people', res);
  res = await callCreate(e, 'TOK_STAFF', { meetDate: daysAgo(14) });
  t('B9 14일 전 → DATE_TOO_OLD(field meetDate, windowDays 14), 쓰기 0, 잠금 풀림', res.error === 'DATE_TOO_OLD' && res.field === 'meetDate' && res.windowDays === 14 && !fileWrites(e.sh).length && !('writeLocks/competencyEval' in e.fs.store), res);
  res = await callCreate(e, 'TOK_STAFF', { meetDate: daysAgo(-1) });
  t('B10 내일 → DATE_FUTURE', res.error === 'DATE_FUTURE', res);
  res = await callCreate(e, 'TOK_STAFF', { tab: 'addSales' });
  t('B11 대면영업 입력으로 추가매출 탭에 → TAB_NOT_SUPPORTED, 쓰기 0', res.error === 'TAB_NOT_SUPPORTED' && !fileWrites(e.sh).length, res);
  res = await callCreate(e, 'TOK_STAFF', { tab: 'g999' });
  t('B12 없는 탭 → TAB_NOT_FOUND', res.error === 'TAB_NOT_FOUND', res);
  t('B13 여기까지 시트 내용 그대로', J(e.sh.tabs) === J(before));

  res = await callCreate(e, 'TOK_STAFF', { idempotencyKey: 'OK1', meetDate: daysAgo(13) });
  const w = fileWrites(e.sh);
  t('B14 담당(김하늘) 13일 전 → ok, 13칸, 쓰기 요청 1번(values:batchUpdate RAW)', res.ok && res.updatedCells === 13 && w.length === 1 && w[0].url.endsWith('/' + FILE_ID + '/values:batchUpdate') && w[0].data.valueInputOption === 'RAW', res);
  const row5 = e.sh.tabs[FACE][4];
  t('B15 시트 5행: 순번 8 · 김하늘 · 양산(사용자 J열) · 내용 · 동부 · 기록ID · kim@x.com · 기록일시, 기존 줄 그대로', row5[0] === '8' && row5[1] === '김하늘' && row5[2] === '양산' && row5[3] === '마루산업' && row5[4] === '최민수,정다은' && row5[5] === '부장,대리' && row5[6] === daysAgo(13).slice(2).replace(/-/g, '') + '-09' && row5[7] === '40' && row5[9] === '' && row5[10] === '동부' && /^CE-\d{8}-[0-9a-f]{4}$/.test(row5[11]) && row5[12] === 'kim@x.com' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(row5[13]) && J(e.sh.tabs[FACE].slice(0, 4)) === J(before[FACE]) && J(e.sh.tabs[ADD]) === J(before[ADD]), row5);
  t('B16 응답 기록: 미평가, 기록ID = 시트 값, 5행', res.record.reviewState === 'pendingReview' && res.record.recordId === row5[11] && res.record.row === 5 && res.record.tab === 'faceSales', res.record);
  t('B17 잠금 풀림, 중복 방지 문서 DONE', !('writeLocks/competencyEval' in e.fs.store) && e.fs.store['writeIdempotency/OK1'].status === 'DONE');
  let r2 = await callCreate(e, 'TOK_STAFF', { idempotencyKey: 'OK1', meetDate: daysAgo(13) });
  t('B18 같은 키로 다시(두 번 누름) → 같은 응답, 줄 추가 0', r2.ok && r2.record.recordId === res.record.recordId && fileWrites(e.sh).length === 1 && e.sh.tabs[FACE].length === 5, r2);
  const mine = await e.get({ sessionToken: 'TOK_STAFF', view: 'mine' });
  const inMine = mine.records && mine.records.faceSales && mine.records.faceSales.find(r => r.recordId === res.record.recordId);
  t('B19 내 기록 보기(mine)에 같은 기록이 그대로(저장 응답 기록 = 다시 읽은 기록)', inMine && J(inMine) === J(res.record), { inMine, rec: res.record });
  t('B20 mine 응답: recordWindowDays 14, createForms {selfDev, gradeComp, faceSales, costSave}', mine.recordWindowDays === 14 && J(Object.entries(mine.createForms || {}).sort()) === J(Object.entries({ selfDev: 'selfDev', gradeComp: 'gradeComp', faceSales: 'faceSales', costSave: 'costSave' }).sort()), { w: mine.recordWindowDays, f: mine.createForms });
  const team = await e.get({ sessionToken: 'TOK_ADMIN', view: 'team' });
  t('B21 팀 보기(team)에는 recordWindowDays·createForms 없음', team.ok && !('recordWindowDays' in team) && !('createForms' in team), Object.keys(team));
  res = await callCreate(e, 'TOK_LEE', { idempotencyKey: 'OK2', meetDate: TODAY, meetHour: 0, minutes: 75 });
  const row6 = e.sh.tabs[FACE][5];
  t('B22 일반(이도윤) 오늘 → 6행, 순번 9, 사무소 김해, 0시 "-00", 기타 75분', res.ok && row6[0] === '9' && row6[1] === '이도윤' && row6[2] === '김해' && row6[6] === TODAY.slice(2).replace(/-/g, '') + '-00' && row6[7] === '75' && row6[12] === 'lee@x.com' && row6[11] !== row5[11], row6);

  // 기록 가능 기간 설정 30일 → 20일 전 허용
  SETTING_WINDOW = '30'; e = makeEnv();
  res = await callCreate(e, 'TOK_STAFF', { meetDate: daysAgo(20) });
  t('B23 기록가능기간일 30 → 20일 전 허용', res.ok, res);
  const m30 = await e.get({ sessionToken: 'TOK_STAFF', view: 'mine' });
  t('B24 mine recordWindowDays 30', m30.recordWindowDays === 30, m30.recordWindowDays);
  SETTING_WINDOW = '14';
  // 새 gid 탭이라도 이름이 대면영업이면 입력 가능(내년 파일)
  GIDS['역량-영업수행역량-대면영업'] = 555; e = makeEnv();
  const mNew = await e.get({ sessionToken: 'TOK_STAFF', view: 'mine' });
  res = await callCreate(e, 'TOK_STAFF', { tab: 'g555' });
  t('B24b 내년 파일처럼 gid가 바뀐 대면영업 탭(g555) → createForms {g555:faceSales}, 저장 ok', J(Object.entries(mNew.createForms || {}).sort()) === J(Object.entries({ selfDev: 'selfDev', gradeComp: 'gradeComp', g555: 'faceSales', costSave: 'costSave' }).sort()) && res.ok && res.record.tab === 'g555', { f: mNew.createForms, res });
  GIDS['역량-영업수행역량-대면영업'] = 1204504857;
  e = makeEnv(); e.sh.tabs[FACE][0] = FACE_H.filter(h => h !== '작성자이메일');
  res = await callCreate(e, 'TOK_STAFF');
  t('B25 작성자이메일 칸 없는 탭 → HEADER_NOT_READY, 쓰기 0, 잠금 풀림', res.error === 'HEADER_NOT_READY' && !fileWrites(e.sh).length && !('writeLocks/competencyEval' in e.fs.store), res);

  // 잠금
  e = makeEnv();
  e.fs.store['writeLocks/competencyEval'] = { lockedAt: new Date().toISOString(), holderId: 'other' };
  res = await callCreate(e, 'TOK_STAFF');
  t('B26 잠금을 못 잡으면 LOCK_TIMEOUT, 인사평가 파일 읽기·쓰기 0', res.error === 'LOCK_TIMEOUT' && !e.sh.requests.some(r => r.url.includes(FILE_ID)) && e.fs.store['writeLocks/competencyEval'].holderId === 'other', res);
  // 동시에 두 명이 추가 → 서로 다른 줄(5·6행), 순번 8·9, 기록ID 다름(잠금 안에서 다시 읽기)
  e = makeEnv();
  const [p1, p2] = await Promise.all([callCreate(e, 'TOK_STAFF', { idempotencyKey: 'C1' }), callCreate(e, 'TOK_LEE', { idempotencyKey: 'C2' })]);
  const rows = e.sh.tabs[FACE];
  t('B27 동시에 두 명 → 둘 다 ok, 5·6행에 하나씩, 순번 8·9, 기록ID 다름', p1.ok && p2.ok && rows.length === 6 && J([p1.record.row, p2.record.row].sort()) === J([5, 6]) && J([rows[4][0], rows[5][0]].sort()) === J(['8', '9']) && rows[4][11] !== rows[5][11], [p1.error || p1.record.row, p2.error || p2.record.row]);
  // 읽기 실패·쓰기 오류
  e = makeEnv(); e.sh.failFileRead = true;
  res = await callCreate(e, 'TOK_STAFF');
  t('B28 파일 읽기 실패 → SHEET_ACCESS_FAILED, 잠금 풀림', res.error === 'SHEET_ACCESS_FAILED' && !('writeLocks/competencyEval' in e.fs.store), res);
  e = makeEnv(null, { beforeWrite: () => { throw new Error('backendError'); } });
  res = await callCreate(e, 'TOK_STAFF', { idempotencyKey: 'E1' });
  t('B29 쓰기 오류 → 500, 잠금 풀림, 중복 방지 문서 지워짐(다시 시도 가능)', res.httpStatus === 500 && !('writeLocks/competencyEval' in e.fs.store) && !('writeIdempotency/E1' in e.fs.store), res);
  // 2-가·2-나 그대로
  e = makeEnv();
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'backfill', mode: 'preview' });
  t('B30 2-가 backfill: 관리자 아니면 FORBIDDEN 그대로', res.error === 'FORBIDDEN', res);
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'reply', idempotencyKey: 'R1', tab: 'addSales', recordId: 'CE-A1', achieved: 'N' });
  t('B31 2-나 reply 경로 그대로(이 시험 탭엔 결과 칸이 없어 HEADER_NOT_READY — reply 상세는 competency_reply_tests)', res.error === 'HEADER_NOT_READY', res);
  res = await e.save({ sessionToken: 'TOK_STAFF', action: 'review' });
  t('B32 아직 없는 action(review) → NOT_IMPLEMENTED', res.error === 'NOT_IMPLEMENTED', res);


  // ── 원가개선 서버 (오늘 기준 달로 시험) ──
  const ymOf = iso => iso.slice(2, 4) + iso.slice(5, 7);
  const thisYm = ymOf(TODAY), oldYm = ymOf(daysAgo(70)), nextYm = ymOf(daysAgo(-40));
  const callCost = (e, tok, extra) => e.save(Object.assign({ sessionToken: tok, action: 'create', form: 'costSave', idempotencyKey: 'K' + Math.random(), tab: 'costSave' }, CG, { periodFrom: TODAY.slice(5, 7) === '01' ? thisYm : ymOf(daysAgo(40)), periodTo: thisYm }, extra || {}));
  e = makeEnv();
  res = await callCost(e, 'TOK_LEE', { idempotencyKey: 'CS1' });
  const crow = e.sh.tabs[COST][3];
  t('BC1 원가개선 Y 완료(끝 달 = 이번 달) → ok 15칸, 4행: 순번 13·이도윤·김해·기간·Y·"개선 2,400천원"·아이템키·팀장 의견 빈칸', res.ok && res.updatedCells === 15 && crow[0] === '13' && crow[1] === '이도윤' && crow[2] === '김해' && crow[7].endsWith('~' + thisYm) && crow[8] === 'Y' && crow[9] === '개선 2,400천원' && crow[10] === '1234567,2345678' && (crow[11] || '') === '' && crow[14] === 'lee@x.com', { res, crow });
  res = await callCost(e, 'TOK_LEE', { periodFrom: thisYm, periodTo: '', periodOpen: true });
  t('BC2 Y + 끝 없음, 시작 달 = 이번 달 → ok, "YYMM~", "… / 월 평균"', res.ok && e.sh.tabs[COST][4][7] === thisYm + '~' && e.sh.tabs[COST][4][9] === '개선 2,400천원 / 월 평균', res);
  res = await callCost(e, 'TOK_LEE', { periodFrom: oldYm, periodTo: oldYm });
  t('BC3 끝 달이 두 달 전 → DATE_TOO_OLD(field periodTo), 쓰기 없음', res.error === 'DATE_TOO_OLD' && res.field === 'periodTo' && e.sh.tabs[COST].length === 5, res);
  res = await callCost(e, 'TOK_LEE', { periodFrom: oldYm, periodTo: '', periodOpen: true });
  t('BC4 끝 없음인데 시작 달이 두 달 전 → DATE_TOO_OLD', res.error === 'DATE_TOO_OLD', res);
  res = await callCost(e, 'TOK_LEE', { periodFrom: thisYm, periodTo: nextYm });
  t('BC5 끝 달이 앞으로의 달 → DATE_FUTURE', res.error === 'DATE_FUTURE', res);
  res = await callCost(e, 'TOK_LEE', { done: 'N', periodFrom: '', periodTo: '', amount: '', itemKeys: '' });
  const nrow = e.sh.tabs[COST][5];
  t('BC6 N 미완료 → ok 12칸, 기간·개선액·아이템키 빈칸, 날짜 검사 없음', res.ok && res.updatedCells === 12 && nrow[8] === 'N' && !nrow[7] && !nrow[9] && !nrow[10], { res, nrow });
  res = await callCost(e, 'TOK_LEE', { amount: '' });
  t('BC7 Y인데 개선액 빈칸 → BAD_INPUT(amount)', res.error === 'BAD_INPUT' && res.field === 'amount', res);
  res = await callCost(e, 'TOK_LEE', { tab: 'faceSales' });
  t('BC8 원가개선 입력으로 대면영업 탭에 → TAB_NOT_SUPPORTED', res.error === 'TAB_NOT_SUPPORTED', res);
  res = await callCost(e, 'TOK_ADMIN');
  t('BC9 팀장 → FORBIDDEN', res.error === 'FORBIDDEN', res);
  const mc = await e.get({ sessionToken: 'TOK_LEE', view: 'mine' });
  const inMc = (mc.records.costSave || []).find(r => r.row === 4);
  t('BC10 내 기록 보기에 원가개선 새 줄(미평가)', inMc && inMc.reviewState === 'pendingReview' && inMc.fields['기대 성과'] === '개선 2,400천원', inMc);


  // ── 자기개발·직급역량 서버 ──
  e = makeEnv();
  res = await e.save(Object.assign({ sessionToken: 'TOK_LEE', action: 'create', form: 'selfDev', tab: 'selfDev', idempotencyKey: 'SD1' }, SG, { periodFrom: ymOf(daysAgo(40)), periodTo: thisYm }));
  const srow = e.sh.tabs[SELF][2];
  t('BS1 자기개발 Y(끝 달 이번 달) → ok, 3행: 순번 2·이도윤·김해·내용·Y·평가, 2행 그대로', res.ok && srow[0] === '2' && srow[1] === '이도윤' && srow[2] === '김해' && srow[5] === ymOf(daysAgo(40)) + '~' + thisYm && srow[6] === 'Y' && srow[7] === '필기·실기 합격' && J(e.sh.tabs[SELF][1]) === J(['1']), { res, srow });
  res = await e.save(Object.assign({ sessionToken: 'TOK_LEE', action: 'create', form: 'gradeComp', tab: 'gradeComp', idempotencyKey: 'GC1' }, SG, { done: 'N', periodFrom: '', periodTo: '', evaluation: '' }));
  const grow = e.sh.tabs[GRADE][2];
  t('BS2 직급역량 N 미완료 → ok, 기간·평가 빈칸', res.ok && grow[6] === 'N' && !grow[5] && !grow[7] && grow[3] === '산업안전기사 자격 취득', { res, grow });
  res = await e.save(Object.assign({ sessionToken: 'TOK_LEE', action: 'create', form: 'selfDev', tab: 'selfDev', idempotencyKey: 'SD2' }, SG, { periodFrom: oldYm, periodTo: oldYm }));
  t('BS3 자기개발 끝 달 두 달 전 → DATE_TOO_OLD(periodTo)', res.error === 'DATE_TOO_OLD' && res.field === 'periodTo', res);
  res = await e.save(Object.assign({ sessionToken: 'TOK_LEE', action: 'create', form: 'selfDev', tab: 'selfDev', idempotencyKey: 'SD3' }, SG, { periodFrom: thisYm, periodTo: '', periodOpen: true }));
  t('BS4 자기개발 Y + 끝 없음 → BAD_INPUT(periodTo), 시트 접근 전', res.error === 'BAD_INPUT' && res.field === 'periodTo', res);
  res = await e.save(Object.assign({ sessionToken: 'TOK_LEE', action: 'create', form: 'gradeComp', tab: 'selfDev', idempotencyKey: 'GC2' }, SG, { periodFrom: thisYm, periodTo: thisYm }));
  t('BS5 직급역량 입력으로 자기개발 탭에 → TAB_NOT_SUPPORTED', res.error === 'TAB_NOT_SUPPORTED', res);

  console.log('pass ' + pass + ' / fail ' + fail);
  process.exit(fail ? 1 : 0);
})();
