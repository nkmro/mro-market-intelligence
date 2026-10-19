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
t('팀장: 확인 대기 = 팀장 의견 빈 기록(손희진1+박태영 추가매출1)', tm.members.reduce((a, x) => a + x.pendingReview, 0) === 2);
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
console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
