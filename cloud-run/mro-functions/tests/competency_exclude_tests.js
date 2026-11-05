// node tests/competency_exclude_tests.js — 2026-11-04 팀장 평가 '제외'(추가매출 달성 여부 N만, 사유 필수) 시험. 실제 접속 0건.
const path = require('path');
const c = require(path.join(__dirname, '..', 'lib', 'competency.js'));
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 500))); } }
const EX = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
const ADD_H = ['사무소', '담당', '구분', '고객사', '달성 여부 (Y/N)', '실적 반영 시점(YYMM~)', '당해년도 실적결산 (매출/이익)', '아이템키', '팀장 의견', '팀'].concat(EX, ['수정 요청']);
const FACE_H = ['순번', '이름', '고객사', '기대 성과', '팀장 의견 (상중하)', '팀'].concat(EX, ['수정 요청']);
// 추가매출 칸: E(4)=달성 여부 · I(8)=팀장 의견 · K(10)=기록ID · N(13)=수정일시 · O(14)=팀장한줄의견
const ADD = [ADD_H,
  ['김해', '이도윤', '품목확대', '세명테크', 'N', '', '', '', '', '동부', 'X-N1', 'lee@x.com', '', '2026-11-03 10:00'],          // 2행: N·미평가
  ['김해', '이도윤', '품목확대', '대한정밀', 'Y', '2610~', '매출 1,000천원 / 이익 100천원', '1234567', '', '동부', 'X-Y1', 'lee@x.com'], // 3행: Y·미평가
  ['김해', '이도윤', '품목확대', '한빛산업', ' n ', '', '', '', '하', '동부', 'X-N2', 'lee@x.com'],                                // 4행: n(소문자·공백)·평가 완료(하)
  ['김해', '이도윤', '품목확대', '가람전자', 'N', '', '', '', '제외', '동부', 'X-N3', 'lee@x.com', '', '', '고객사 본사 일괄구매'],  // 5행: 이미 제외
  ['김해', '이도윤', '품목확대', '누리기계', '', '', '', '', '', '동부', 'X-P1', 'lee@x.com']];                                   // 6행: 계획(결과 없음)
const FACE = [FACE_H, ['1', '이도윤', '가람산업', '견적', '', '동부', 'X-F1', 'lee@x.com']];
const TA = { id: 'addSales', title: '역량-개선기획역량-추가매출' }, TF = { id: 'faceSales', title: '역량-영업수행역량-대면영업' };
const NOW = Date.UTC(2026, 10, 4, 5, 0); // 서울 2026-11-04 14:00
const V = (g, l) => c.validateReview({ grade: g, line: l });
const byK = p => { const o = {}; (p.writes || []).forEach(w => { o[w.range.split('!')[1]] = w.value; }); return o; };

t('E1 등급 목록 = 상·중·하·제외', JSON.stringify(c.REVIEW_GRADES) === JSON.stringify(['상', '중', '하', '제외']));
t('E2 제외 + 사유 → 통과', V('제외', '고객사 기존 업체 유지').ok);
t('E3 제외 + 사유 없음/공백/줄바꿈만 → EXCLUDE_NEED_REASON(line)', ['', '   ', '\n\n', undefined].every(l => { const r = V('제외', l); return r.error === 'EXCLUDE_NEED_REASON' && r.field === 'line'; }));
t('E4 제외 사유 201자 → BAD_INPUT(길이 검사 먼저)', V('제외', 'x'.repeat(201)).error === 'BAD_INPUT');
t('E5 상·중·하는 사유 없어도 그대로 통과(기존 동작)', ['상', '중', '하'].every(g => V(g, '').ok));
t('E6 "제외 " 앞뒤 공백은 잘라서 인정, "제외함"·"excluded"는 BAD_GRADE', V(' 제외 ', 'x').grade === '제외' && V('제외함', 'x').error === 'BAD_GRADE' && V('excluded', 'x').error === 'BAD_GRADE');

let p = c.planReview(TA, ADD, 'X-N1', V('제외', '고객사 기존 업체 유지'), false, NOW); let k = byK(p);
t('E7 추가매출 N 미평가 → 제외 저장: I2 "제외" · O2 사유 · N2 수정일시, 평가 완료', p.ok && k.I2 === '제외' && k.O2 === '고객사 기존 업체 유지' && k.N2 === '2026-11-04 14:00' && p.record.reviewState === 'done' && p.record.leaderOpinion === '제외', p);
t('E8 추가매출 Y → EXCLUDE_NOT_ALLOWED(시트 안 씀)', c.planReview(TA, ADD, 'X-Y1', V('제외', '사유'), false, NOW).error === 'EXCLUDE_NOT_ALLOWED');
p = c.planReview(TA, ADD, 'X-N2', V('제외', '본사 일괄구매'), true, NOW); k = byK(p);
t('E9 평가 고치기 하→제외(달성 여부 " n " 소문자·공백도 N으로 봄)', p.ok && k.I4 === '제외' && k.O4 === '본사 일괄구매', p);
p = c.planReview(TA, ADD, 'X-N3', V('중', ''), true, NOW); k = byK(p);
t('E10 평가 고치기 제외→중(사유 비움) — 되돌리기 가능', p.ok && k.I5 === '중' && k.O5 === '', p);
t('E11 결과 없는 계획 줄 → NOT_REPLIED가 먼저', c.planReview(TA, ADD, 'X-P1', V('제외', '사유'), false, NOW).error === 'NOT_REPLIED');
t('E12 달성 여부 칸이 없는 탭(대면영업) → EXCLUDE_NOT_ALLOWED', c.planReview(TF, FACE, 'X-F1', V('제외', '사유'), false, NOW).error === 'EXCLUDE_NOT_ALLOWED');
t('E13 대면영업 상·중·하는 그대로', c.planReview(TF, FACE, 'X-F1', V('상', ''), false, NOW).ok);
t('E14 이미 제외인 기록의 상태 = 평가 완료(미평가 수에 안 들어감)', c.reviewState({ fields: { '달성 여부 (Y/N)': 'N' }, leaderOpinion: '제외' }) === 'done');

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
