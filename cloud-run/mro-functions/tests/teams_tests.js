// node tests/teams_tests.js — 팀장 겸임 1차(2026-11-18 재홍님 시안 승인): 사용자팀마스터 L열 겸임팀 → 시황·품목·담당·사용자·이슈 메일·관리자 편집
// 가상의 이름만 사용. 시트·네트워크 없음.
const path = require('path'), fs = require('fs');
const T = require('../lib/teams'), fe = require('../lib/feedEngine'), im = require('../lib/issueMail'), sc = require('../lib/sheetsClient');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); } }
// 1) 팀 목록
t('T1 L열 없음 = 소속팀 하나', JSON.stringify(T.teamsOf('중부', '')) === '["중부"]' && JSON.stringify(T.teamsOf('중부')) === '["중부"]');
t('T2 쉼표·가운뎃점·빗금·공백, 중복·소속팀 반복 제거', JSON.stringify(T.teamsOf(' 중부 ', '영업지원, 소싱·중부/영업지원')) === '["중부","영업지원","소싱"]');
t('T3 비교: 문자열끼리는 예전과 같은 ===(공백 다르면 다름), 목록이면 겹침',
  T.teamsMatch('동부', '동부') && !T.teamsMatch('동부', '동부 ') && T.teamsMatch(['중부', '영업지원'], '영업지원') && T.teamsMatch('영업지원', ['중부', '영업지원']) && !T.teamsMatch(['중부', '영업지원'], '동부') && !T.teamsMatch([], ''));
t('T4 viewTeams: 겸임 없으면 문자열 그대로, 있으면 목록', T.viewTeams({ team: '동부', teams: ['동부'] }) === '동부' && JSON.stringify(T.viewTeams({ team: '중부', teams: ['중부', '영업지원'] })) === '["중부","영업지원"]' && T.viewTeams({ team: '서부' }) === '서부');
// 2) 시트 줄 → 사용자
const ROWS = [['hk@nkmro.com', '한겸임', '팀장', '중부', '활성', '', '', '', '', '', '', '영업지원'], ['jb@nkmro.com', '강민재', '담당', '중부', '활성'],
  ['yj@nkmro.com', '문태오', '담당', '영업지원', '활성'], ['db@nkmro.com', '박동부', '담당', '동부', '활성'], ['ex@nkmro.com', '임원갑', '임원', '본사', '활성'],
  ['dl@nkmro.com', '동팀장', '팀장', '동부', '활성'], ['yg@nkmro.com', '신예린', '일반', '영업지원', '활성']];
const U = sc.rowsToUsers(ROWS);
t('U1 rowsToUsers teams(L열)', JSON.stringify(U[0].teams) === '["중부","영업지원"]' && JSON.stringify(U[1].teams) === '["중부"]' && U[0].team === '중부');
// 3) 시황 피드 열람(팀장_열람범위 = 자기팀)
const hk = fe.findViewer(U, 'HK@nkmro.com'), dl = fe.findViewer(U, 'dl@nkmro.com'), yj = fe.findViewer(U, 'yj@nkmro.com');
t('F1 findViewer에 teams', JSON.stringify(hk.teams) === '["중부","영업지원"]');
t('F2 겸임 팀장은 두 팀 품목, 다른 팀 X / 일반 팀장은 예전 그대로',
  fe.teamScopeAllows('팀장', T.viewTeams(hk), '영업지원', '자기팀') && fe.teamScopeAllows('팀장', T.viewTeams(hk), '중부', '자기팀') && !fe.teamScopeAllows('팀장', T.viewTeams(hk), '동부', '자기팀')
  && fe.teamScopeAllows('팀장', T.viewTeams(dl), '동부', '자기팀') && !fe.teamScopeAllows('팀장', T.viewTeams(dl), '중부', '자기팀'));
const tbe = fe.buildTeamByEmail(U);
t('F3 작성자 팀: 겸임 팀장 댓글은 영업지원 담당에게도 보임, 동부 담당에게는 안 보임',
  fe.teamScopeAllows('담당', T.viewTeams(yj), tbe['hk@nkmro.com'], '자기팀', '팀장') && !fe.teamScopeAllows('담당', '동부', tbe['hk@nkmro.com'], '자기팀', '팀장') && tbe['jb@nkmro.com'] === '중부');
const ITEMS = [{ itemId: 'I1', materials: '구리', status: '활성', team: '영업지원', customer: '가', itemName: '나' }, { itemId: 'I2', materials: '구리', status: '활성', team: '동부', customer: '다', itemName: '라' }];
const POST = { id: 'P1', materialName: '구리', createdAtRaw: 46000 };
const e1 = fe.buildFeedEntry(hk, POST, ITEMS, {}, '자기팀', tbe), e2 = fe.buildFeedEntry(Object.assign({}, dl), POST, ITEMS, {}, '자기팀', tbe);
t('F4 피드: 겸임 팀장은 영업지원 품목 보임(동부 품목 X), 동부 팀장은 동부만', e1 && JSON.stringify(e1).indexOf('I1') >= 0 && JSON.stringify(e1).indexOf('I2') < 0 && e2 && JSON.stringify(e2).indexOf('I2') >= 0 && JSON.stringify(e2).indexOf('I1') < 0);
// 4) 이슈 댓글 고정 메일(②-나): 겸임 팀장 고정 → 두 팀 담당·일반 + 본인 + 임원
const now = Date.parse('2026-11-18T10:00:00+09:00');
const pin = (email) => ({ commentId: 'C1', postId: 'P1', itemId: 'I1', contentSnapshot: '단가 인상 예정', pinnedByEmail: email, pinnedByName: '', pinnedAtMs: now - 3600000 });
const COMMENTS = [{ commentId: 'C1', postId: 'P1', itemId: 'I1', content: '단가 인상 예정', authorEmail: 'hk@nkmro.com', authorName: '한겸임', authorRole: '팀장', createdAtRaw: 46000 }];
const plan = im.planIssueMail({ nowMs: now, pins: [pin('hk@nkmro.com')], allUsers: U, allPosts: [Object.assign({ title: 't', link: '' }, POST)], allItems: ITEMS, allComments: COMMENTS });
const got = plan.recipients.map(r => r.email).sort().join();
t('M1 겸임 팀장 고정 메일 = 중부·영업지원 담당·일반 + 본인 + 임원(동부·다른 팀장 제외)', got === 'ex@nkmro.com,hk@nkmro.com,jb@nkmro.com,yg@nkmro.com,yj@nkmro.com', got);
const plan2 = im.planIssueMail({ nowMs: now, pins: [pin('dl@nkmro.com')], allUsers: U, allPosts: [Object.assign({ title: 't', link: '' }, POST)], allItems: ITEMS, allComments: COMMENTS.map(c => Object.assign({}, c, { authorEmail: 'dl@nkmro.com' })) });
t('M2 일반 팀장 고정 메일은 예전 그대로(동부 담당 + 본인 + 임원)', plan2.recipients.map(r => r.email).sort().join() === 'db@nkmro.com,dl@nkmro.com,ex@nkmro.com', plan2.recipients.map(r => r.email));
// 5) index.js(정적): 읽기 범위 L열, 담당 목록·품목·사용자·품목 등록·관리자 편집
const IX = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
t('I1 사용자 읽기 범위 3곳 A2:L', ["USER_DATA_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:L')", "POLL_USER_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:L')", "USERS_LIST_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:L')"].every(x => IX.includes(x)));
t('I2 시황 댓글 열람 5곳 모두 viewTeams', (IX.match(/viewer\.role, teamsLib\.viewTeams\(viewer\), leadScope, teamByEmail\)/g) || []).length === 5 && !/visibleCommentsForPost\([^)]*viewer\.team,/.test(IX));
t('I3 담당 목록·품목·사용자 현황·품목 등록이 맡은 팀 전부', IX.includes("myTeams.indexOf(String(team || '').trim()) >= 0") && IX.includes('teamsLib.teamsMatch(viewer.teams || [viewer.team], [it.team])') &&
  IX.includes('(viewer.teams || [viewer.team]).indexOf(String(row[3]).trim()) < 0') && IX.includes('(viewer.teams || [String(viewer.team).trim()]).indexOf(String(managerUser.team).trim()) < 0'));
t('I4 관리자 편집: extraTeams → L열, 팀 목록 밖이면 INVALID_TEAM, 로그인·whoami 응답에 teams', IX.includes("await updateUserCell_(client, rowNum, 'L', extraTeams);") && IX.includes("if (list.some(function (t) { return VALID_TEAMS_.indexOf(t) === -1; })) return { ok: false, error: 'INVALID_TEAM' };") &&
  IX.includes('teams: user.teams,') && IX.includes('teams: teamsLib.teamsOf(row[3], row[teamsLib.EXTRA_COL]), status: row[4] });'));
// 6) 화면(정적): 세션 teams, 사이드바 표시, 품목 담당·필터, 관리자 겸임팀 칸
const FH = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'feed.html'), 'utf8'), IH = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
t('W1 로그인 세션·whoami에 teams, 사이드바 meLabel_ 3곳', IH.includes('teams: res.teams || [res.team]') && FH.includes('session.teams = res.teams || session.teams || [session.team];') && (FH.match(/textContent = meLabel_\(\);/g) || []).length === 3);
const mt = new Function('session', FH.slice(FH.indexOf('function myTeams_()'), FH.indexOf('async function updateUserRemote_(')) + '; return [myTeams_(), meLabel_()];');
const r1 = mt({ name: '한겸임', role: '팀장', team: '중부', teams: ['중부', '영업지원'] }), r2 = mt({ name: '박동부', role: '팀장', team: '동부' });
t('W2 myTeams_·meLabel_: 겸임 "· 중부·영업지원", 예전 세션(teams 없음)은 예전 그대로', JSON.stringify(r1[0]) === '["중부","영업지원"]' && r1[1] === '👤 한겸임 팀장 · 중부·영업지원' && JSON.stringify(r2[0]) === '["동부"]' && r2[1] === '👤 박동부 팀장');
t('W3 품목: 담당 목록·첫 필터·필터 이름이 맡은 팀 전체', FH.includes("return myTeams_().indexOf(String(u.team || '').trim()) >= 0") && FH.includes("itemsState.filterTeam = myTeams_().length > 1 ? '' : (session.team || '');") && FH.includes("' (내 팀 전체)'"));
t('W4 관리자 사용자 관리: 겸임팀 칸 → extraTeams 저장', FH.includes('id="extra-${rk}"') && FH.includes('await updateUserRemote_({ row, name, role, team, status, extraTeams })'));
console.log(`teams_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
