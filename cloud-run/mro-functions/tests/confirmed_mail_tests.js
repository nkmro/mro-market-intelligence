// 확정 실적 알림 메일(2026-11-25 재홍님 승인) — lib/confirmedMail.js 순수 함수 + index.js·feed.html 배선(정적). 이름·숫자는 모두 가짜
const cs = require('../lib/confirmedSales');
const cm = require('../lib/confirmedMail');
const ws = require('../lib/weeklySales');
const pcm = require('../lib/perfCloseMail');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); } }
const NOW = Date.parse('2026-11-26T09:00:00+09:00');
const U = [['lead@nkmro.com', '한팀장', '팀장', '동부', '활성', '', '', '', '', '본사'], ['a@nkmro.com', '가담당', '담당', '동부', '활성', '', '', '', '', '포항'],
  ['b@nkmro.com', '나담당', '담당', '동부', '활성', '', '', '', '', '대구'], ['c@nkmro.com', '다담당', '담당', '동부', '활성', '', '', '', '', '창원'], ['c2@nkmro.com', '라담당', '담당', '동부', '활성', '', '', '', '', '창원'],
  ['p1@nkmro.com', '구매일', '일반', '동부', '활성', '', '', '', '', '포항'], ['p3@nkmro.com', '구매삼', '일반', '동부', '활성', '', '', '', '', '대구'], ['p4@nkmro.com', '구매사', '일반', '동부', '활성', '', '', '', '', '창원'],
  ['ext@gmail.com', '바깥담당', '담당', '동부', '활성', '', '', '', '', '울산'], ['admin@nkmro.com', '관리자', '임원', '본사', '활성', '', '', '', '', '']];
const CUST = [['동부', '', '다온계열', '', '포항', '', 'TRUE', 1], ['동부', '', '가람정밀(주)', '', '대구', '', 'TRUE', 2], ['동부', '', '바른전자계열', '', '창원', '', 'TRUE', 3], ['서부', '', '서쪽고객', '', '', '', 'TRUE', 1]];
const LINKS = [['다온스틸(주)', '동부', '다온계열', 'x', ''], ['다온강판(주)', '동부', '다온계열', 'x', '']];
const ITEMS = [{ name: '다온스틸(주)', sales: 98420, profit: 8830, unclosed: 0, buyers: { 구매일: 10 } }, { name: '다온강판(주)', sales: 63100, profit: 5480, unclosed: 1, buyers: { 구매일: 3 } },
  { name: '가람정밀(주)', sales: 88760, profit: 7320, unclosed: 0, buyers: { 구매삼: 4 } }, { name: '바른전자(주)', sales: 41200, profit: 3720, unclosed: 0, buyers: { 구매사: 2 } },
  { name: '세온테크(주)', sales: 6420, profit: 500, unclosed: 0, buyers: { 구매일: 1 } }];
function up(o) { return cs.planUpload(Object.assign({ year: 2026, month: 10, team: '동부', items: ITEMS, links: {}, customers: CUST, linkRows: LINKS, confRows: [], progRows: [], userRows: U, mgrRows: [], who: 'admin@nkmro.com', nowMs: NOW }, o)); }
const U1 = up({});
const CONF = U1.writes.map(function (w) { return w.values.slice(); });
const PROG = U1.progWrites.map(function (w) { return w.values.slice(); });
function job(doc, o) { return cm.buildJob(Object.assign({ doc: doc, confRows: CONF, progRows: PROG, userRows: U, mgrRows: [], customers: CUST, adminEmail: 'admin@nkmro.com', minNote: 10 }, o)); }
// 담당: 다온스틸·다온강판·세온테크 = 가담당(포항), 가람정밀 = 나담당(대구), 바른전자 = 창원 담당 2명 → 팀장(한팀장)
t('S0 시험 자료: 담당 배정', CONF.map(function (r) { return r[3] + '=' + r[6]; }).join() === '다온스틸(주)=가담당,다온강판(주)=가담당,가람정밀(주)=나담당,바른전자(주)=한팀장,세온테크(주)=가담당');

// 1) 올림 예약
let r = cm.uploadRecord(null, U1, NOW);
t('R1 처음 올림 → pending·first, 기다림 시작 = 올린 시각, 문서 id = upload_연도_월_팀', r && r.status === 'pending' && r.first === true && r.atMs === NOW && r.reopen.length === 0 && cm.docId(cm.KIND_UPLOAD, 2026, 10, '동부') === 'upload_2026_10_동부');
t('R2 다시 올림: 바뀐 곳 없음·다시 열린 담당 없음 → 메일 없음(null)', cm.uploadRecord({ status: 'done' }, { year: 2026, month: 10, team: '동부', first: false, changedAny: false, reopen: [] }, NOW) === null);
t('R3 다시 올림: 다시 열린 담당만(reopen), 보낸 기록은 새로', (function () { const x = cm.uploadRecord({ status: 'done', sentTo: ['a@nkmro.com'] }, { year: 2026, month: 10, team: '동부', first: false, reopen: ['가담당'] }, NOW + 1); return x.first === false && x.reopen.join() === '가담당' && x.sentTo.length === 0 && x.atMs === NOW + 1; })());
t('R4 아직 안 보낸 처음 올림이 있으면 계속 처음 올림(모두에게), 기다림은 새로 시작', (function () { const x = cm.uploadRecord({ status: 'pending', first: true, reopen: [] }, { year: 2026, month: 10, team: '동부', first: false, reopen: ['나담당'] }, NOW + 5); return x.first === true && x.reopen.length === 0 && x.atMs === NOW + 5; })());
t('R5 안 보낸 다시 올림 둘 → 다시 열린 담당 합침', cm.uploadRecord({ status: 'pending', first: false, reopen: ['가담당'] }, { year: 2026, month: 10, team: '동부', first: false, reopen: ['나담당'] }, NOW).reopen.join() === '가담당,나담당');

// 2) 기다림(결과메일대기분)
t('W1 결과메일대기분 60 → 59분 뒤 아직, 60분 뒤 보냄 · 0이면 바로', !cm.due({ atMs: NOW }, NOW + 59 * 60000, { 결과메일대기분: 60 }) && cm.due({ atMs: NOW }, NOW + 60 * 60000, { 결과메일대기분: 60 }) && cm.due({ atMs: NOW }, NOW, { 결과메일대기분: 0 }));

// 3) 받는 사람
let j = job(r);
t('J1 처음 올림: 그 달 담당(가담당·나담당) + 팀장(한팀장, 바른전자를 맡아 팀장용 1통), 이메일 중복 없음', !j.skip && j.recipients.map(function (x) { return x.kind + ':' + x.name; }).join() === 'mgr:가담당,mgr:나담당,lead:한팀장');
t('J2 담당 내 고객사 수·묶음 수(연결 안 된 세온테크·바른전자는 묶음 없음)', j.recipients[0].mine.customers === 3 && j.recipients[0].mine.groups === 1 && j.info.unlinked === 2 && j.info.mgrChoices === 1);
t('J3 @nkmro.com이 아니거나 비활성이면 안 보냄', (function () { const C2 = CONF.map(function (x) { const y = x.slice(); if (y[3] === '가람정밀(주)') y[6] = '바깥담당'; return y; }); return job(r, { confRows: C2 }).recipients.map(function (x) { return x.name; }).indexOf('바깥담당') < 0; })());
const P2 = PROG.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a@nkmro.com', '2026-11-26 10:00']]);
const U2 = up({ items: ITEMS.map(function (x) { return x.name === '다온강판(주)' ? Object.assign({}, x, { sales: 64850, profit: 5630 }) : x; }), confRows: CONF, progRows: P2 });
const C2 = CONF.map(function (x) { return x.slice(); }); U2.writes.forEach(function (w) { const m = /^A(\d+)/.exec(w.range); if (m) C2[+m[1] - 2] = w.values.slice(); });
const P3 = P2.concat(U2.progWrites.map(function (w) { return w.values; }));
const r2 = cm.uploadRecord({ status: 'done' }, U2, NOW);
j = job(r2, { confRows: C2, progRows: P3 });
t('J4 다시 올림: 다시 열린 담당(가담당) + 팀장, 다시 확인 1곳', r2.reopen.join() === '가담당' && j.recipients.map(function (x) { return x.kind + ':' + x.name; }).join() === 'mgr:가담당,lead:한팀장' && j.recipients[0].mine.recheck === 1);
t('J5 보내기 전에 그 담당이 다시 확정했으면 보낼 것 없음(NOTHING_REOPENED)', job(r2, { confRows: C2, progRows: P3.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a', '']]) }).skip === 'NOTHING_REOPENED');
// 모두 확정
const PA = PROG.concat([[2026, 10, '동부', '담당 확정', '가담당', 'a', '2026-11-26 10:00'], [2026, 10, '동부', '담당 확정', '나담당', 'b', '2026-11-26 11:00']]);
t('D1 한 명이라도 확정 전이면 모두 확정 예약 없음', cm.doneRecord(2026, 10, '동부', cs.confRowsOf(CONF, 2026, 10, '동부'), cs.stateOf(PA, 2026, 10, '동부'), NOW) === null);
const PB = PA.concat([[2026, 10, '동부', '담당 확정', '한팀장', 'lead', '2026-11-26 12:00']]);
const d = cm.doneRecord(2026, 10, '동부', cs.confRowsOf(CONF, 2026, 10, '동부'), cs.stateOf(PB, 2026, 10, '동부'), NOW);
t('D2 모두 확정 → done 예약, 받는 사람 = 팀장', d && d.kind === 'done' && job(d, { progRows: PB }).recipients.map(function (x) { return x.kind + ':' + x.name; }).join() === 'lead:한팀장');
t('D3 보내기 전에 확정 취소 → NOT_ALL_DONE, 최종 확정됨 → ALREADY_FINAL', job(d, { progRows: PB.concat([[2026, 10, '동부', '확정 취소', '나담당', 'b', '']]) }).skip === 'NOT_ALL_DONE' &&
  job(d, { progRows: PB.concat([[2026, 10, '동부', '최종 확정', '', 'lead', '']]) }).skip === 'ALREADY_FINAL');
t('D4 팀장이 없으면 관리자에게(대리)', (function () { const UL = U.filter(function (x) { return x[1] !== '한팀장'; }); const x = job(d, { progRows: PB, userRows: UL }); return x.recipients.length === 1 && x.recipients[0].kind === 'admin' && x.recipients[0].email === 'admin@nkmro.com'; })());

// 4) 메일 글자
j = job(r);
const m1 = cm.mailParts(j.info, j.recipients[0], pcm.APP_URL), m3 = cm.mailParts(j.info, j.recipients[2], pcm.APP_URL);
t('M1 담당 메일: 제목·내 고객사·할 일(비고 10자)·금액 없음', m1.subject === '[MRO 워크허브] 10월 확정 실적이 올라왔어요 — 확인 후 [확정]해 주세요 (동부팀)' && m1.hello === '가담당님,' && m1.period.lines[0] === '· 내 고객사: 3곳 (묶음 1곳)' &&
  m1.period.lines[1].indexOf('비고 10자 이상') >= 0 && !/98,420|98420/.test(JSON.stringify(m1)));
t('M2 팀장 메일: 담당 명단·연결 안 된 곳·담당 고를 곳·팀장 몫', m3.hello === '한팀장 팀장님,' && m3.period.lines.some(function (l) { return l === '· 연결 안 된 고객사: 2곳 → 화면에서 주간 고객사에 연결해 주세요.'; }) &&
  m3.period.lines.some(function (l) { return l.indexOf('담당을 골라야 할 고객사: 1곳') >= 0; }) && m3.period.lines.some(function (l) { return l.indexOf('팀장님이 맡은 고객사: 1곳') === 2; }));
t('M3 버튼 = 그 팀·그 달 확정 실적(feed.html?view=confirmed&team=&month=&year=)', m1.link === pcm.APP_URL + '?view=confirmed&team=' + encodeURIComponent('동부') + '&month=10&year=2026' && m1.button === '확정 실적 열기');
j = job(r2, { confRows: C2, progRows: P3 });
t('M4 다시 올림 메일(담당·팀장)', cm.mailParts(j.info, j.recipients[0], pcm.APP_URL).subject.indexOf('다시 열렸어요') > 0 && cm.mailParts(j.info, j.recipients[1], pcm.APP_URL).period.lines[0] === '· 확정이 다시 열린 담당: 가담당');
j = job(d, { progRows: PB });
const m5 = cm.mailParts(j.info, j.recipients[0], pcm.APP_URL);
t('M5 모두 확정 메일: 확정한 담당·시각, 연결 안 된 곳 경고', m5.subject === '[MRO 워크허브] 10월 확정 실적 담당 모두 확정 — 최종 확정해 주세요 (동부팀)' && m5.period.lines[0] === '· ✓ 가담당 · 11/26 10:00 확정' &&
  m5.period.lines.some(function (l) { return l.indexOf('연결 안 된 고객사 2곳') >= 0; }));
t('M6 본문 만들기(perfCloseMail 틀)에서 오류 없음', pcm.buildHtml(m5).indexOf('최종 확정') > 0 && pcm.buildText(m1).indexOf('확정 실적 열기') >= 0);

// 5) 배선(정적)
const IX = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const FH = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
const ca = IX.slice(IX.indexOf('async function confirmedAction_'), IX.indexOf('// POST /saveWeeklySalesTest'));
t('X1 올리기 성공 뒤 올림 예약, [확정] 뒤 모두 확정 예약(실패해도 올리기·확정은 성공 — cfMailMark_ 안 try/catch)', ca.includes('if (r.ok) summary.mail = await cfMailMark_(confirmedMail.KIND_UPLOAD') && ca.includes("if (r.ok && b.action === 'cfConfirm') {") &&
  IX.includes("console.error('[confirmedMail] 예약 실패("));
const run = IX.slice(IX.indexOf('async function runConfirmedMail_'), IX.indexOf('async function runWeeklySalesMail_'));
t('X2 발송: pending만 읽고 없으면 시트 안 읽음, 메일사용 FALSE면 끔, 대기분, 로그인 1번, 실패한 사람만 3번까지, 진행 탭 기록', run.indexOf(".where('status', '==', 'pending')") < run.indexOf('getSheetsClient()') && run.includes('f.settings.메일사용 === false') &&
  run.includes('confirmedMail.due(d, nowMs, f.settings)') && run.includes('mailer.verifyLogin()') && run.includes('tries < 3') && run.includes("'알림 메일(올림)'") && run.includes('releaseLock(firestore, WEEKLY_LOCK_NAME, holderId)'));
const bt = IX.slice(IX.indexOf('exports.issueMailBatchTest'), IX.indexOf('exports.issueMailBatchTest') + 3000);
t('X3 issueMailBatchTest 안에서 자체 try/catch로 실행(이슈 메일 앞)', bt.includes("console.log('[confirmedMail] ' + JSON.stringify(await runConfirmedMail_(nowMs)));") && bt.indexOf('runConfirmedMail_') < bt.indexOf('getSheetsClient()'));
t('X4 화면: ?view=confirmed&team=&month=&year= 바로가기(로그인 전이면 맡겨 둠)', FH.includes("q.get('view') === 'confirmed') sessionStorage.setItem('mro_pending_view'") && FH.includes("['perf', 'weekly', 'confirmed'].indexOf(") &&
  FH.includes("if (__pv.get('view') === 'confirmed' && document.getElementById('nav-confirmed').style.display !== 'none') {"));
t('X5 실적-설정 설명: 메일사용·결과메일대기분이 확정 실적에도 쓰임', ws.SETTING_RULES.find(function (x) { return x.key === '메일사용'; }).desc.indexOf('확정 실적') >= 0 && ws.SETTING_RULES.find(function (x) { return x.key === '결과메일대기분'; }).desc.indexOf('확정 실적') >= 0);
console.log(`confirmed_mail_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
