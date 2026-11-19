// node tests/teams2_tests.js — 팀장 겸임 2차(2026-11-18 재홍님 선택: 팀 버튼 전환): 주간 실적·성과평가·역량평가
// 가상의 이름만 사용. 시트·네트워크 없음.
const path = require('path'), fs = require('fs');
const ws = require('../lib/weeklySales'), comp = require('../lib/competency'), perf = require('../lib/performance'), teamsLib = require('../lib/teams');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); } }
const L = function (r, extra) { return r.concat(['', '', '', '', '', '', extra]); }; // L열(12번째 칸)에 겸임팀
const UR = [L(['hk@nkmro.com', '한겸임', '팀장', '중부', '활성'], '영업지원'), ['dl@nkmro.com', '동팀장', '팀장', '동부', '활성'], ['ex@nkmro.com', '임원갑', '임원', '본사', '활성'],
  ['jb@nkmro.com', '강민재', '담당', '중부', '활성'], ['yj@nkmro.com', '문태오', '일반', '영업지원', '활성'], ['db@nkmro.com', '박동부', '담당', '동부', '활성']];
// 1) 주간 실적
const WU = ws.usersOf(UR), hk = WU[0], dl = WU[1], TS = ['동부', '중부', '영업지원'];
t('K1 usersOf teams = 소속팀 + L열(팀 글자 정리)', JSON.stringify(hk.teams) === '["중부","영업지원"]' && JSON.stringify(dl.teams) === '["동부"]');
const r = ws.leadTeam(hk, false, '', TS);
t('K2 겸임 팀장: 안 고르면 소속팀(중부) + 팀 버튼 목록', r.ok && r.team === '중부' && JSON.stringify(r.myTeams) === '["중부","영업지원"]');
t('K3 겸임 팀장: 영업지원 고르면 영업지원, 동부는 FORBIDDEN_TEAM', ws.leadTeam(hk, false, '영업지원', TS).team === '영업지원' && ws.leadTeam(hk, false, '동부', TS).error === 'FORBIDDEN_TEAM');
t('K4 겸임 아님: 예전 그대로(자기 팀, 다른 팀 FORBIDDEN_TEAM, 고객사 없는 팀 NO_TEAM)', ws.leadTeam(dl, false, '', TS).team === '동부' && ws.leadTeam(dl, false, '중부', TS).error === 'FORBIDDEN_TEAM'
  && ws.leadTeam(dl, false, '', ['중부']).error === 'NO_TEAM' && ws.leadTeam({ role: '팀장', active: true, team: '동부' }, false, '', TS).team === '동부');
t('K5 관리자·담당·비활성은 예전 그대로', ws.leadTeam(hk, true, '동부', TS).team === '동부' && ws.leadTeam(hk, true, '서부', TS).error === 'BAD_TEAM'
  && ws.leadTeam(WU[3], false, '', TS).error === 'FORBIDDEN' && ws.leadTeam(Object.assign({}, hk, { active: false }), false, '', TS).error === 'FORBIDDEN');
t('K6 겸임 팀이 실적-고객사에 없으면 버튼에서 빠짐, 소속팀이 없으면 겸임팀부터', JSON.stringify(ws.leadTeam(hk, false, '', ['중부', '동부']).myTeams) === '["중부"]' && ws.leadTeam(hk, false, '', ['영업지원']).team === '영업지원');
// 16시 알림: 영업지원은 팀장이 따로 없음 → 겸임 팀장에게(관리자 대리 아님)
const C = [['중부', '', '가나상사', '', '진천', '', true, 1, ''], ['영업지원', '', '다라물산', '', '본사', '', true, 2, ''], ['동부', '', '마바산업', '', '창원', '', true, 3, '']];
const jobs = ws.reminderJobs({ nowMs: Date.parse('2026-11-23T16:02:00+09:00'), settings: ws.readSettings([]), customers: C, progressRows: [], weeklyRows: [], users: UR, adminEmail: 'dl@nkmro.com' });
const by = {}; jobs.forEach(function (j) { by[j.team] = j; });
const to = function (j) { return j ? j.recipients.map(function (u) { return u.email; }).join() : ''; };
t('K7 16시 알림: 영업지원·중부 = 한겸임(대리 아님), 동부 = 동팀장', by['영업지원'] && !by['영업지원'].proxy && to(by['영업지원']) === 'hk@nkmro.com' && to(by['중부']) === 'hk@nkmro.com' && to(by['동부']) === 'dl@nkmro.com',
  jobs.map(function (j) { return j.team + ':' + to(j); }));
const WSRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'weeklySales.js'), 'utf8');
t('K8 팀 확정 요청(3단계) 메일도 맡은 팀 기준', (WSRC.match(/u\.role === '팀장' && leadsTeam_\(u, t\) && mailable\(u\)/g) || []).length === 2 && !/u\.role === '팀장' && normTeam\(u\.team\) === t/.test(WSRC));
// 2) 역량평가: 겸임 팀장 = 두 팀 팀원
const CU = UR.map(function (x) { return { email: x[0], name: x[1], role: x[2], team: x[3], status: x[4], office: '', teams: teamsLib.teamsOf(x[3], x[11]) }; });
const names = (comp.buildTeam(CU[0], CU, {}, {}).members || []).map(function (m) { return m.name + '/' + m.team; }).sort().join();
t('C1 겸임 팀장 팀 보기 = 중부·영업지원 팀원(동부 X, 팀장 본인 X)', names === '강민재/중부,문태오/영업지원', names);
t('C2 겸임 아닌 팀장 = 예전 그대로(자기 팀만)', (comp.buildTeam(CU[1], CU, {}, {}).members || []).map(function (m) { return m.name; }).join() === '박동부');
t('C3 teams 없는 예전 모양 viewer도 그대로', (comp.buildTeam({ role: '팀장', team: '중부' }, CU, {}, {}).members || []).map(function (m) { return m.name; }).join() === '강민재');
// 3) 성과평가: 팀 목록에 겸임팀(팀원이 없어도)
const PU = CU.filter(function (u) { return u.email !== 'yj@nkmro.com'; });
t('P1 performance.teamsOf: 팀원 없는 영업지원도 겸임 팀장 덕에 목록에', JSON.stringify(perf.teamsOf(PU)) === JSON.stringify(['동부', '영업지원', '중부']), perf.teamsOf(PU));
t('P2 teams 없는 예전 모양이면 예전 그대로', JSON.stringify(perf.teamsOf(PU.map(function (u) { const x = Object.assign({}, u); delete x.teams; return x; }))) === JSON.stringify(['동부', '중부']));
// 4) index.js (정적)
const IX = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
t('I1 인사평가·성과·주간 실적 사용자 범위 A2:L + 사람 줄마다 teams(10곳)', IX.includes("COMPETENCY_USER_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:L')") && (IX.match(/status: r\[4\](, office: r\[9\] \|\| '')?, teams: teamsLib\.teamsOf\(r\[3\], r\[teamsLib\.EXTRA_COL\]\) \}/g) || []).length === 10);
t('I2 역량 평가하기: 맡은 팀 팀원이면 됨(NOT_YOUR_TEAM 기준)', IX.includes("(viewer.teams || [String(viewer.team || '').trim()]).indexOf(String(author.team || '').trim()) < 0) return { ok: false, error: 'NOT_YOUR_TEAM' }"));
t('I3 성과 보기: 겸임 팀장만 body.team(맡은 팀) + myTeams, 성과 입력·저장: 맡은 팀 밖 FORBIDDEN_TEAM', IX.includes("if (leadTeams && leadTeams.indexOf(String(body.team || '').trim()) >= 0) team = String(body.team).trim();")
  && IX.includes('if (leadTeams) base.myTeams = leadTeams;') && IX.includes("if (want && mine.indexOf(want) < 0) return { ok: false, error: 'FORBIDDEN_TEAM' };"));
t('I4 주간 실적 입력 응답에 myTeams(겸임 팀장만)', IX.includes('myTeams: !isAdmin && lead.myTeams && lead.myTeams.length > 1 ? lead.myTeams : undefined'));
// 5) 화면(feed.html)
const FH = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
const grab = function (name) { const i = FH.indexOf('function ' + name + '('); let d = 0; const j = FH.indexOf('{', i); for (let k = j; k < FH.length; k++) { if (FH[k] === '{') d++; else if (FH[k] === '}') { d--; if (d === 0) return FH.slice(i, k + 1); } } return ''; };
const mkBar = function (pending) { return new Function('wkRes_', 'wkBusy_', 'wkPending_', 'escapeHtml', grab('wkTeamBarHtml_') + '; return wkTeamBarHtml_;')({ teams: [{ team: '중부', status: 'done' }, { team: '영업지원', status: 'none' }] }, false, pending, function (s) { return String(s); }); };
const bar = mkBar(null);
const h1 = bar({ isAdmin: false, team: '중부', myTeams: ['중부', '영업지원'] });
t('S1 주간 실적 팀 버튼: 고른 팀 on·잠김, 다른 팀 누르면 wkPickTeam_, 팀 상태 글자', /class="on" disabled onclick="wkPickTeam_\('중부'\)"><b>중부<\/b><small class="done">✓ 완료<\/small>/.test(h1) && /class="" {2}onclick="wkPickTeam_\('영업지원'\)"><b>영업지원<\/b><small class="none">— 미입력<\/small>/.test(h1), h1);
t('S1b 입력 방식은 기본 접힘(한 줄 + [바꾸기 ▾]), 팀 버튼은 입력 방식 줄 아래', grab('wkRenderInput_').includes("x += wkModeOpen_") && grab('wkRenderInput_').indexOf('x += wkTeamBarHtml_(d);') > grab('wkRenderInput_').indexOf('x += wkModeOpen_') && /let wkModeOpen_ = false;/.test(FH));
t('S2 겸임 아닌 팀장 = 팀 버튼 없음, 관리자 = [입력할 팀] 전 팀 버튼(예전 드롭다운 대신, 팀 하나면 없음)', bar({ isAdmin: false, team: '동부', myTeams: undefined }) === ''
  && /<span class="lbl">입력할 팀<\/span>/.test(bar({ isAdmin: true, team: '동부', teams: ['동부', '서부', '중부', '영업지원'] })) && (bar({ isAdmin: true, team: '동부', teams: ['동부', '서부', '중부', '영업지원'] }).match(/onclick="wkPickTeam_\(/g) || []).length === 4
  && bar({ isAdmin: true, team: '동부', teams: ['동부'] }) === '' && !FH.includes('aria-label="입력할 팀" onchange='));
t('S3 팀 바꾸기 전에 고친 숫자 있으면 그 팀에 먼저 저장', /entries = wkInDirty_\(\) \? wkInEntries_\(\) : null/.test(grab('wkPickTeam_')) && grab('wkPickTeam_').includes("action: 'save', entries: entries }, wkInBase_()"));
t('S4 성과: 겸임 팀장 고른 팀을 보기·입력·저장에 실어 보냄', FH.includes("if (perfLeadTeam_ && body.team === undefined && (body.view === 'mine' || body.view === 'input')) body.team = perfLeadTeam_;") && FH.includes('if (perfLeadTeam_ && body.team === undefined) body.team = perfLeadTeam_;')
  && FH.includes("if (res.view === 'mine') perfLeadTeam_ = Array.isArray(res.myTeams) && res.myTeams.length > 1 ? res.team : '';"));
t('S5 성과: 팀 칩 + 저장 안 한 값 있으면 한 번 더 눌러야 바뀜', FH.includes('onclick="perfPickLeadTeam_(') && grab('perfPickLeadTeam_').includes('leaveTeamOk'));
const multi = new Function(grab('compLeadMulti_') + '; return compLeadMulti_;')();
t('S6 역량: 겸임 팀장만 팀 구분 줄(임원 화면과 같은 묶음)', multi({ viewer: { role: '팀장', teams: ['중부', '영업지원'] } }) && !multi({ viewer: { role: '팀장', team: '동부' } }) && !multi({ viewer: { role: '팀장', teams: ['동부'] } })
  && FH.includes("if ((res.viewer || {}).role !== '임원' && !compLeadMulti_(res)) return members.map(rowFn).join('');"));
const hb = mkBar({ kind: 'team', value: '영업지원' })({ isAdmin: false, team: '중부', myTeams: ['중부', '영업지원'] });
t('S7 누른 팀 버튼 = busy + "불러오는 중…"(다른 버튼은 잠김), 끝나면 그 자리 아래 초록 안내(6초)', /class=" busy" disabled onclick="wkPickTeam_\('영업지원'\)"><b>영업지원<\/b><small class=""><span class="wi-spin"><\/span>불러오는 중…/.test(hb)
  && grab('wkRenderInput_').includes("if (wkNote_ && wkNote_.where === 'team') x += ") && grab('wkRenderInput_').includes("if (wkNote_ && wkNote_.where === 'mode') x += ") && grab('wkSetMode_').includes("wkPending_ = { kind: 'mode', value: m }") && grab('wkPickTeam_').includes("wkPending_ = { kind: 'team', value: t }"), hb);
t('S8 입력 방식 기본 접기(모든 팀): 화면을 새로 그릴 때마다 접힘, 선언은 loadWeeklyPage보다 위', grab('loadWeeklyPage').includes('wkModeOpen_ = false;') && FH.indexOf('let wkModeOpen_ = false;') < FH.indexOf('async function loadWeeklyPage('));
console.log(`teams2_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
