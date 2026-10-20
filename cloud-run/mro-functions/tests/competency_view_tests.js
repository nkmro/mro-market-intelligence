// node tests/competency_view_tests.js — 1단계-나 보기 권한·집계 순수 함수 시험 (시트 접근 없음)
const c = require('../lib/competency');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name); } }
const U = [
  { email: 'jhjoo@nkmro.com', name: '주재홍', role: '팀장', team: '동부', status: '활성', office: '' },
  { email: 'ceo@x.com', name: '유현', role: '임원', team: '본사', status: '활성', office: '' },
  { email: 'a@x.com', name: '박태영', role: '담당', team: '동부', status: '활성', office: '양산' },
  { email: 'b@x.com', name: '손희진', role: '일반', team: '동부', status: '활성', office: '양산' },
  { email: 'c@x.com', name: '최성광', role: '일반', team: '동부', status: '비활성', office: '' },
  { email: 'd@x.com', name: '서부팀원', role: '일반', team: '서부', status: '활성', office: '' },
  { email: 'e@x.com', name: '서부팀장', role: '팀장', team: '서부', status: '활성', office: '' },
  { email: 'f@x.com', name: '동명', role: '일반', team: '동부', status: '활성', office: '' },
  { email: 'g@x.com', name: '동 명', role: '일반', team: '동부', status: '활성', office: '' }
];
const EX = ['기록ID','작성자이메일','기록일시','수정일시','팀장한줄의견','첨부'];
const face = [['순번','이름','사무소','고객사','대면자','직급','미팅 일시','미팅 시간(분)','기대 성과','팀장 의견 (상중하)'].concat(EX),
  ['1','박태영','양산','A사','x','','','','','중 (2609)'],
  ['2','손희진','양산','B사','y','','','','',''].concat(['CE-1','b@x.com','2026-10-05 10:00']),
  ['3','최성광','포항','C사','z','','','','',''],
  ['4','최영아','포항','D사','w','','','','',''],
  ['5','동명','','E사','v','','','','',''],
  ['6','서부팀원','','F사','u','','','','',''],
  ['','','','','','','','','','']];
const add = [['사무소','담당','구분','고객사','품목'].concat(EX), ['양산','박태영','품목확대','A사','라이너']];
const R = { selfDev: [], gradeComp: [], faceSales: c.parseTab('faceSales', face), costSave: [], addSales: c.parseTab('addSales', add) };

t('parseTab 빈 이름 줄 제외', R.faceSales.length === 6);
t('parseTab 추가매출은 담당 칸으로 이름', R.addSales.length === 1 && R.addSales[0].name === '박태영');
t('parseTab 팀장 의견 (상중하) 읽기', R.faceSales[0].leaderOpinion === '중 (2609)');
t('resolve 이메일 우선', c.resolveAuthor(R.faceSales[1], U).name === '손희진');
t('resolve 미등록 → null', c.resolveAuthor(R.faceSales[3], U) === null);
t('resolve 동명이인(띄어쓰기 무시) → null', c.resolveAuthor(R.faceSales[4], U) === null);
t('monthOf', c.monthOf('2026-10-05 10:00') === 10 && c.monthOf('') === 0);

// mine — 팀원 박태영
let m = c.buildMine(U[2], U, R);
t('mine 본인 기록만(대면1+추가1)', m.records.faceSales.length === 1 && m.records.addSales.length === 1);
t('mine 남의 기록 내용 없음', JSON.stringify(m.records).indexOf('손희진') === -1);
const names = m.teamCounts.map(x => x.name).sort().join(',');
t('mine 팀 건수표 = 같은 팀 활성 일반·담당만', names === ['박태영','손희진','동명','동 명'].sort().join(','));
t('mine 건수표에 내용 없음(byTab 숫자만)', m.teamCounts.every(x => Object.values(x.byTab).every(v => typeof v === 'number')) && JSON.stringify(m.teamCounts).indexOf('B사') === -1);
t('mine 박태영 건수', m.teamCounts.find(x => x.name === '박태영').byTab.faceSales === 1);

// team — 팀장(동부)
let tm = c.buildTeam(U[0], U, R, {});
t('팀장: 자기 팀 활성 일반·담당 기록만', tm.records.map(r => r.name).sort().join(',') === ['박태영','박태영','손희진'].sort().join(','));
t('팀장: 다른 팀 기록 없음', tm.records.every(r => r.name !== '서부팀원'));
t('팀장: 퇴사 기본 숨김', tm.records.every(r => r.name !== '최성광') && tm.members.every(x => x.status === 'active'));
t('팀장: 판정 불가 기본 숨김', tm.unresolved.length === 0);
t('팀장: 확인 대기 = 팀장 의견 빈 기록(손희진1). v1.7 ⑳: 박태영 추가매출(달성 여부 없음)은 회신 대기로', tm.members.reduce((a, x) => a + x.pendingReview, 0) === 1 && tm.members.find(x => x.name === '박태영').awaitingReply === 1);
t('팀장: 월별 0=기록일시 없음, 10월 1', tm.members.find(x => x.name === '손희진').byMonth[10] === 1 && tm.members.find(x => x.name === '박태영').byMonth[0] === 2);
tm = c.buildTeam(U[0], U, R, { includeLeft: true });
t('팀장+퇴사 포함: 최성광 보임', tm.records.some(r => r.name === '최성광' && r.authorStatus === 'left'));
t('팀장(관리자 아님)+퇴사 포함: 판정 불가는 여전히 숨김', tm.unresolved.length === 0);
tm = c.buildTeam(U[0], U, R, { includeLeft: true, isAdmin: true });
t('관리자+퇴사 포함: 판정 불가(최영아·동명) 보임', tm.unresolved.map(r => r.name).sort().join(',') === ['동명','최영아'].sort().join(','));
// team — 다른 팀 팀장
tm = c.buildTeam(U[6], U, R, {});
t('서부 팀장: 서부팀원만', tm.records.length === 1 && tm.records[0].name === '서부팀원');
// team — 임원
tm = c.buildTeam(U[1], U, R, {});
t('임원: 모든 팀 활성 일반·담당', tm.records.map(r => r.name).sort().join(',') === ['박태영','박태영','손희진','서부팀원'].sort().join(','));
tm = c.buildTeam(U[1], U, R, { includeLeft: true });
t('임원+퇴사 포함: 판정 불가 보임', tm.unresolved.length === 2);
t('criteriaRows 빈 줄 제외', c.criteriaRows([[], ['', '■ 역량평가 기준 (40%)'], ['']]).length === 1);

// v1.6 팀별 기준 탭(선택)
const TT = ['역량-직무별전문성-자기개발', 'CRM-역량평가-기준', 'CRM-역량평가-기준_서부', '인사평가설정'];
t('기준 탭: 팀별 탭 없으면 기본(동부)', c.pickCriteriaTab(TT, '동부') === 'CRM-역량평가-기준');
t('기준 탭: 팀별 탭 있으면 그 탭(서부)', c.pickCriteriaTab(TT, '서부') === 'CRM-역량평가-기준_서부');
t('기준 탭: 임원(본사)은 기본', c.pickCriteriaTab(TT, '본사') === 'CRM-역량평가-기준');
t('기준 탭: 팀 빈칸·탭 목록 없음은 기본', c.pickCriteriaTab(TT, '') === 'CRM-역량평가-기준' && c.pickCriteriaTab(null, '서부') === 'CRM-역량평가-기준');
t('기준 탭: 팀 앞뒤 공백 무시', c.pickCriteriaTab(TT, ' 서부 ') === 'CRM-역량평가-기준_서부');
// v1.7 ⑳ 추가매출 확인 대기·회신 대기
const AS = [['사무소','담당','구분','고객사','품목','달성 여부 (Y/N)','실적 반영 시점(YYMM~)','팀장 의견'].concat(EX),
  ['양산','박태영','품목확대','A사','라이너','','',''],        // 회신 대기
  ['양산','박태영','품목확대','B사','대차',' ','',''],        // 공백만 → 회신 대기
  ['양산','박태영','품목확대','C사','케이블','Y','2607',''],  // 확인 대기
  ['양산','박태영','품목확대','D사','팔레트','N','',''],      // N도 회신 → 확인 대기
  ['양산','박태영','품목확대','E사','실린더','Y','2608','중'], // 완료
  ['양산','손희진','품목확대','F사','박스','',''],             // 손희진 회신 대기
  ['포항','최성광','품목확대','G사','x','','','']];            // 퇴사 — 세지 않음
const R2 = { selfDev: [], gradeComp: [], faceSales: [], costSave: [], addSales: c.parseTab('addSales', AS) };
const st = R2.addSales.map(r => c.reviewState(r));
t('⑳ 상태: 빈칸/공백만=회신 대기, Y·N=확인 대기, 팀장 의견 있음=완료', st.join(',') === 'awaitingReply,awaitingReply,pendingReview,pendingReview,done,awaitingReply,awaitingReply');
t('⑳ 다른 탭은 기존 규칙(팀장 의견 비면 확인 대기)', c.reviewState(R.faceSales[1]) === 'pendingReview' && c.reviewState(R.faceSales[0]) === 'done');
let t2 = c.buildTeam(U[0], U, R2, {});
const pty = t2.members.find(x => x.name === '박태영'), shj = t2.members.find(x => x.name === '손희진');
t('⑳ team 박태영: 확인 대기 2, 회신 대기 2', pty.pendingReview === 2 && pty.awaitingReply === 2);
t('⑳ team 손희진: 회신 대기 1', shj.awaitingReply === 1 && shj.pendingReview === 0);
t2 = c.buildTeam(U[0], U, R2, { includeLeft: true });
t('⑳ 퇴사자(최성광)는 둘 다 0', t2.members.find(x => x.name === '최성광').awaitingReply === 0 && t2.members.find(x => x.name === '최성광').pendingReview === 0);
t('⑳ 기록마다 reviewState 포함', t2.records.every(r => ['awaitingReply','pendingReview','done'].indexOf(r.reviewState) >= 0));
let m2 = c.buildMine(U[2], U, R2);
t('⑳ mine 박태영 awaitingReply = 본인 2', m2.awaitingReply === 2);
t('⑳ mine 팀 건수표에는 회신 대기 없음', m2.teamCounts.every(x => !('awaitingReply' in x)));
t('⑳ mine 손희진 = 1', c.buildMine(U[3], U, R2).awaitingReply === 1);

// ① recordItems: '역량-' 탭만, 마지막 부분, 기준 탭·팀별 기준 탭·설정 탭은 제외
const TITLES = ['역량-직무별전문성-자기개발', '역량-직급별업무역량-직급역량개선노력', '역량-영업수행역량-대면영업',
  '역량-개선기획역량-원가개선제안', '역량-개선기획역량-추가매출계획이행', 'CRM-역량평가-기준', 'CRM-역량평가-기준_서부', '인사평가설정', '직급별_요구역량'];
t('① recordItems = 역량- 탭 5개의 마지막 부분', c.recordItemsFromTabs(TITLES).join(',') === '자기개발,직급역량개선노력,대면영업,원가개선제안,추가매출계획이행');
t('① 팀별 기준 탭이 있어도 recordItems 그대로(기준 탭은 별개)', c.recordItemsFromTabs(TITLES).indexOf('기준_서부') === -1 && c.pickCriteriaTab(TITLES, '서부') === 'CRM-역량평가-기준_서부');
t('① 새 탭 추가 시 자동 포함', c.recordItemsFromTabs(TITLES.concat(['역량-팀워크기여도-팀워크기여'])).slice(-1)[0] === '팀워크기여');
t('① 빈 목록·null·공백 이름 안전', c.recordItemsFromTabs(null).length === 0 && c.recordItemsFromTabs([' 역량-a-b ', '역량-', '']).join(',') === 'b');
t('① 배열이 아닌 값(문자열·객체)도 빈 목록, 하이픈 없는 "역량"은 제외', c.recordItemsFromTabs('역량-a-b').length === 0 && c.recordItemsFromTabs({}).length === 0 && c.recordItemsFromTabs(['역량', '역량-x']).join(',') === 'x');

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
