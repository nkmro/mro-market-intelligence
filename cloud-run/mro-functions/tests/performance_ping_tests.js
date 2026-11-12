// node tests/performance_ping_tests.js — lib/performance.js 순수 함수 시험 (시트 접근 없음, 1-가 ping용)
// 실제 값은 2026-11-11 2026_인사평가 파일을 브라우저로 읽은 0-준비 결과 그대로.
const p = require('../lib/performance');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra))); } }

// ── 머리글 (0-준비 실제 값)
let h;
t('H1 월실적 12칸 정상(L = 비고, 3-다)', p.checkHeaders(p.TAB_MONTHLY, ['연도', '월', '팀', '단위구분', '단위', '단위이름', '매출액', '이익', '인원', '수정자', '수정일시', '비고']).ok);
h = p.checkHeaders(p.TAB_MONTHLY, ['연도', '월', '팀', '단위구분', '단위', '단위이름', '매출액', '이익', '인원', '수정자', '수정일시']);
t('H1b 비고 머리글(L1) 없으면 → 실패 + 빠진 칸 비고', !h.ok && h.missing.join() === '비고', h);
t('H2 마감 6칸 정상', p.checkHeaders(p.TAB_CLOSE, ['연도', '팀', '마감월', '마감자', '마감일시', '기록']).ok);
t('H3 평가기준 6칸 정상', p.checkHeaders(p.TAB_CRITERIA, ['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표']).ok);
t('H4 앞뒤 공백·끝 빈칸은 허용', p.checkHeaders(p.TAB_CLOSE, [' 연도 ', '팀', '마감월', '마감자', '마감일시', '기록', '', '']).ok);
h = p.checkHeaders(p.TAB_CLOSE, ['연도', '팀', '마감월', '마감자', '마감일시']);
t('H5 칸 빠짐 → 실패 + 빠진 칸 이름', !h.ok && h.missing.join() === '기록', h);
t('H6 순서 바뀜 → 실패', !p.checkHeaders(p.TAB_CLOSE, ['팀', '연도', '마감월', '마감자', '마감일시', '기록']).ok);
t('H7 뒤에 다른 칸 → 실패', !p.checkHeaders(p.TAB_CLOSE, ['연도', '팀', '마감월', '마감자', '마감일시', '기록', '메모']).ok);
t('H8 빈 탭(1행 없음) → 실패', !p.checkHeaders(p.TAB_MONTHLY, undefined).ok);

// ── 인사평가설정 (0-준비 실제 줄 + 기존 줄)
const S = [['키', '값', '설명'], ['전년도입력마감일', 15, ''], ['탭이모지_위기관리', '🛡️', ''],
  ['성과공개일수', 1, '...'], ['성과평가단위_동부', '사무소', '...']];
let u = p.readUnitModes(S);
t('S1 동부 = 사무소, 다른 줄 무시', JSON.stringify(u.modes) === '{"동부":"사무소"}' && u.bad.length === 0, u);
t('S2 줄 없는 팀 = 개인', p.unitModeOf(u.modes, '서부') === '개인' && p.unitModeOf(u.modes, '동부') === '사무소');
u = p.readUnitModes([['성과평가단위_서부', '사무실', '']]);
t('S3 잘못된 값(사무실) → bad에 남김, 개인으로 봄', u.bad.length === 1 && p.unitModeOf(u.modes, '서부') === '개인', u);
t('S4 키만 있고 팀 이름 없음(성과평가단위_) → 무시', Object.keys(p.readUnitModes([['성과평가단위_', '사무소', '']]).modes).length === 0);
let d = p.readPublishDays(S);
t('S5 성과공개일수 1 (숫자 셀)', d.days === 1 && d.valid, d);
t('S6 문자 "7"도 됨', p.readPublishDays([['성과공개일수', '7']]).days === 7);
t('S7 0 = 공개 안 함(정상 값)', p.readPublishDays([['성과공개일수', 0]]).days === 0 && p.readPublishDays([['성과공개일수', 0]]).valid);
t('S8 줄 없음·빈칸·32·1.5·글자 → 0, valid=false', ['없음', '', 32, 1.5, 'abc'].every(function (v) {
  const r = v === '없음' ? p.readPublishDays([]) : p.readPublishDays([['성과공개일수', v]]); return r.days === 0 && !r.valid; }));

// ── 등급표
const g = p.parseGrades('110:100, 100:90, 90:80, 나머지:70');
t('G1 등급표 4단', g && g.length === 4 && g[0].over === 1.1 && g[0].pts === 100 && g[3].over === null && g[3].pts === 70, g);
t('G2 팀 경상이익 3단', JSON.stringify(p.parseGrades('110:100, 100:90, 나머지:80')) === JSON.stringify([{ over: 1.1, pts: 100 }, { over: 1, pts: 90 }, { over: null, pts: 80 }]));
t('G3 옛 형식 0:70 → 오류(나머지 필수)', p.parseGrades('110:100, 100:90, 90:80, 0:70') === null);
t('G4 나머지가 중간 → 오류', p.parseGrades('110:100, 나머지:90, 90:80') === null);
t('G5 기준 %가 작아지지 않음 → 오류', p.parseGrades('100:100, 110:90, 나머지:80') === null);
t('G6 빈칸·한 단 → 오류', p.parseGrades('') === null && p.parseGrades('나머지:70') === null);

// ── 평가 기준 (0-준비 실제 5줄, 숫자 셀)
const G4 = '110:100, 100:90, 90:80, 나머지:70', G3 = '110:100, 100:90, 나머지:80';
const C = [['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'],
  ['전년 실적 대비 성장률', 0.5, 'sales', '매출액 성장', 0.3, G4],
  ['전년 실적 대비 성장률', 0.5, 'profit', '매출이익 성장', 0.3, G4],
  ['전년 실적 대비 성장률', 0.5, 'margin', '이익률 성장(%)', 0.1, G4],
  ['전년 실적 대비 성장률', 0.5, 'perHead', '인당 이익금 성장', 0.3, G4],
  ['사업부문 영업이익 성장률', 0.1, 'teamOp', '팀 경상이익 성장률', 1, G3]];
let c = p.parseCriteria(C);
t('C1 실제 기준 = 정상, 합 0.6, 60점', c.ok && c.sum === 0.6 && c.maxPoints === 60 && c.items.length === 5, c.errors);
t('C2 문자 숫자("0.5")도 됨', p.parseCriteria(C.map(function (r, i) { return i ? [r[0], String(r[1]), r[2], r[3], String(r[4]), r[5]] : r; })).ok);
const C9 = JSON.parse(JSON.stringify(C)); C9[1][4] = 0.4;
c = p.parseCriteria(C9);
t('C3 매출 배점 0.3→0.4(합 0.65) → 멈춤(회사 규정 60점)', !c.ok && c.sum === 0.65 && c.errors.some(function (e) { return e.indexOf('0.6') >= 0; }), c.errors);
const CA = JSON.parse(JSON.stringify(C)); CA[1][4] = 0.4; CA[4][4] = 0.2;
t('C4 비율을 옮겨도 합 0.6이면 정상', p.parseCriteria(CA).ok);
const CK = JSON.parse(JSON.stringify(C)); CK[3][2] = 'marg';
c = p.parseCriteria(CK);
t('C5 모르는 항목키 → 멈춤(+ margin 0번)', !c.ok && c.errors.length >= 2, c.errors);
const CD = C.concat([C[1]]);
t('C6 같은 항목키 2번 → 멈춤', !p.parseCriteria(CD).ok);
const CW = JSON.parse(JSON.stringify(C)); CW[2][1] = 0.4; CW[1][1] = 0.6;
t('C7 같은 묶음 가중치가 다름 → 멈춤', p.parseCriteria(CW).errors.some(function (e) { return e.indexOf('묶음가중치가 다름') >= 0; }));
const CG = JSON.parse(JSON.stringify(C)); CG[5][5] = '110:100, 100:90, 0:80';
t('C8 등급표 형식 오류(행 번호 포함) → 멈춤', p.parseCriteria(CG).errors.some(function (e) { return e.indexOf('6행: 등급표') === 0; }));
t('C9 빈 줄은 건너뜀', p.parseCriteria(C.concat([['', '', '', '', '', '']])).ok);

// ── 사무소 요약 (예시 사용자 — 실제 이름 아님)
const U = [{ name: '김민준', role: '담당', team: '동부', status: '활성', office: '대구달성' },
  { name: '정하늘', role: '일반', team: '동부', status: '활성', office: '양산' },
  { name: '이지은', role: '담당', team: '동부', status: '활성', office: '대구달성' },
  { name: '한지우', role: '담당', team: '동부', status: '활성', office: '' },
  { name: '팀장', role: '팀장', team: '동부', status: '활성', office: '' },
  { name: '퇴사', role: '담당', team: '동부', status: '비활성', office: '창원' },
  { name: '서부사람', role: '담당', team: '서부', status: '활성', office: '' }];
const o = p.officeSummary(U, { '동부': '사무소' });
t('O1 사무소 팀만, 활성 일반·담당만, 가나다순, 미지정 이름', JSON.stringify(o) === JSON.stringify({ '동부': { members: 4,
  offices: [{ office: '대구달성', count: 2 }, { office: '양산', count: 1 }], unassigned: ['한지우'] } }), o);
t('O2 개인 팀은 요약 없음', Object.keys(p.officeSummary(U, { '동부': '개인' })).length === 0);

// ── index.js 연결 (코드 확인)
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const pStart = src.indexOf('exports.getPerformanceTest');
// 1-다: 보기 함수(performanceView_)가 이 진입점 뒤에 붙으므로 진입점 함수 끝(첫 '\n};\n')까지만 본다
const pEnd = src.indexOf('\n};\n', pStart);
if (pStart < 0 || pEnd < 0) throw new Error('getPerformanceTest 시작·끝을 찾지 못함');
const blk = src.slice(pStart, pEnd + 3);
// 잘린 끝 바로 뒤가 다음 함수 머리 주석(1-다 performanceView_)이어야 한다 — 함수 중간에서 잘리지 않았는지 확인
t('I0 진입점 끝 = 첫 "\\n};\\n" 바로 뒤가 1-다 머리 주석', /^\s*\/\/ =+\n\/\/ 성과평가 1-다/.test(src.slice(pEnd + 3)));
t('I1 getPerformanceTest 진입점 있음 + view=ping 외 NOT_IMPLEMENTED', blk.indexOf("if (view !== 'ping')") > 0 && blk.indexOf("'NOT_IMPLEMENTED'") > 0);
t('I2 관리자만(FORBIDDEN)', blk.indexOf("!== ADMIN_EMAIL") > 0 && blk.indexOf("error: 'FORBIDDEN'") > 0);
t('I3 읽기 전용 클라이언트(getSheetsClient)만 — 쓰기 클라이언트·PUT·append 없음', blk.indexOf('getSheetsClient()') > 0 && !/getUserWriteClient_|method: 'PUT'|:append|values:batchUpdate/.test(blk));
t('I4 MRO 쪽은 인코딩된 상수 그대로, 인사평가 파일 쪽은 map(encodeURIComponent) 1번', blk.indexOf('[COMPETENCY_USER_RANGE, POLL_SETTINGS_RANGE]') > 0 && (blk.match(/\.map\(encodeURIComponent\)/g) || []).length === 1);
t('I5 탭 이름은 quoteTab으로 감쌈(4곳)', (blk.match(/competency\.quoteTab\(/g) || []).length === 4);

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
