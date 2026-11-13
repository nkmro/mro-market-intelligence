// node tests/perf_close_mail_tests.js — 성과평가 월 마감 안내 메일(2026-11-13, 설계서 4-7절) 시험. 시트·Firestore·메일 서버·네트워크 없음.
// P그룹: lib/perfCloseMail.js 순수 함수(설정 읽기·보낼 때 판단·받는 사람·문구). S그룹: lib/performance.js 설정 저장(성과마감메일시각).
// I그룹: index.js issueMailBatchTest(맨 앞 마감 메일 블록) + getPerformanceTest view=settings를 가짜 시트·Firestore·메일로 호출.
// 사람·팀·날짜는 모두 시험용 예시(실제 운영 데이터 아님). 운영 시트·운영 메일로 보내는 시험은 하지 않는다.
const path = require('path'), fs = require('fs'), vm = require('vm');
const dir = path.join(__dirname, '..');
const pc = require('../lib/perfCloseMail');
const perf = require('../lib/performance');
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (extra === undefined ? '' : ' -> ' + JSON.stringify(extra).slice(0, 700))); } }
const KST = function (y, m, d, hh, mi) { return Date.UTC(y, m - 1, d, hh - 9, mi || 0); }; // 서울 시각 → ms

// ── P: 순수 함수
const S0 = [['키', '값', '설명'], ['성과공개일수', 1, '']];
let ms = pc.readMailSettings(S0);
t('P1 줄 없음 → 꺼짐(이슈 메일 관례), 시각 기본 17(오후 5시), 시험 주소 없음', ms.enabled === false && ms.hour === 17 && ms.hourValid === false && ms.testRecipient === '', ms);
ms = pc.readMailSettings(S0.concat([['성과마감메일사용', 'true'], ['성과마감메일시각', 18], ['성과마감메일테스트수신자', ' a@nkmro.com ']]));
t('P2 사용 true(소문자도) → 켜짐, 시각 18, 시험 주소 앞뒤 공백 제거', ms.enabled && ms.hour === 18 && ms.testRecipient === 'a@nkmro.com', ms);
t('P3 시각 24·-1·9.5·"abc" → 기본 17(잘못된 값), "FALSE" → 꺼짐', [24, -1, 9.5, 'abc'].every(function (h) { return pc.readMailSettings([['성과마감메일시각', h]]).hour === 17; })
  && pc.readMailSettings([['성과마감메일사용', 'FALSE']]).enabled === false);

const CLOSE = [[2026, '동부', 9, 'lead@nkmro.com', '2026-10-14 10:05', '9월 마감'], [2026, '서부', 8, 'lead2@nkmro.com', '2026-10-13 23:30', '8월 마감'],
  [2025, '동부', 12, 'x', '2026-01-05 09:00', '작년 줄(올해 계산 아님)']];
const due = function (nowMs, hour, test) { return pc.planDue({ nowMs: nowMs, years: [{ year: 2026, closeRows: CLOSE }], hour: hour, testRecipient: test || '' }); };
t('P4 마감 당일 설정 시각 전(10/14 8:02, 9시) → 보낼 것 없음(서부 8월 10/13 마감은 다음 날이라 보냄)', due(KST(2026, 10, 14, 8, 2), 9).map(function (j) { return j.team; }).join() === '서부');
let j = due(KST(2026, 10, 14, 11, 2), 9);
t('P5 마감 당일 시각 지난 뒤(11:02) → 동부 9월(결정 ② 다음 정시) + 서부(전날 23:30 마감 → 다음 날)', j.map(function (x) { return x.team + x.month; }).join() === '동부9,서부8', j);
t('P6 기록 이름 = 연도_팀_월_마감일, 마감자·마감 시각', j[0].key === '2026_동부_9_2026-10-14' && j[0].closerEmail === 'lead@nkmro.com' && j[0].closedAt === '2026-10-14 10:05' && j[0].test === false, j[0]);
t('P7 마감일 + 2일(10/16) → 지난 마감이라 보내지 않음(배포 직후 9월 마감에 메일이 나가지 않음)', due(KST(2026, 10, 16, 9, 2), 9).length === 0);
t('P8 0시 설정: 마감 당일 0:02부터', due(KST(2026, 10, 14, 0, 2), 0).some(function (x) { return x.team === '동부'; }));
const reclose = [[2026, '동부', 9, 'l', '2026-10-14 10:05', ''], [2026, '동부', 8, 'l', '2026-10-14 10:05', '풀기'], [2026, '동부', 9, 'l', '2026-10-14 15:00', '다시 마감']];
const j1 = pc.planDue({ nowMs: KST(2026, 10, 14, 16, 2), years: [{ year: 2026, closeRows: reclose }], hour: 9 });
t('P9 같은 날 풀었다 다시 마감(결정 ④) → 기록 이름이 같다(마감일만 들어감) = 1번', j1.length === 1 && j1[0].key === '2026_동부_9_2026-10-14' && j1[0].closedAt === '2026-10-14 15:00', j1);
const j2 = pc.planDue({ nowMs: KST(2026, 10, 20, 10, 2), years: [{ year: 2026, closeRows: reclose.concat([[2026, '동부', 9, 'l', '2026-10-20 09:30', '다른 날 다시 마감']]) }], hour: 9 });
t('P10 다른 날 다시 마감 → 새 기록 이름(한 번 더)', j2.length === 1 && j2[0].key === '2026_동부_9_2026-10-20');
t('P11 마감월 0(모두 풀림)·마감일시 빈칸 줄 → 보내지 않음', pc.planDue({ nowMs: KST(2026, 10, 14, 11, 2), years: [{ year: 2026, closeRows: [[2026, '동부', 0, 'l', '2026-10-14 10:05'], [2026, '서부', 9, 'l', '']] }], hour: 9 }).length === 0);
j = due(KST(2026, 11, 13, 3, 2), 9, 'me@nkmro.com');
t('P12 시험 모드: 시각·지난 마감 제한 없이 팀마다 마지막 마감, 기록 이름 test_오늘_…', j.length === 2 && j[0].test && j[0].key === 'test_2026-11-13_2026_동부_9', j);

const users = [{ email: 'lead@nkmro.com', name: '주팀장', role: '팀장', team: '동부', status: '활성' }, { email: 'A@nkmro.com', name: '김가', role: '일반', team: '동부', status: '활성' },
  { email: 'b@nkmro.com', name: '', role: '담당', team: '동부', status: '활성' }, { email: 'c@nkmro.com', name: '퇴사', role: '일반', team: '동부', status: '비활성' },
  { email: 'd@nkmro.com', name: '서부원', role: '일반', team: '서부', status: '활성' }, { email: 'ex@nkmro.com', name: '임원일', role: '임원', team: '본사', status: '활성' },
  { email: 'ex2@gmail.com', name: '외부임원', role: '임원', team: '본사', status: '활성' }, { email: 'a@nkmro.com', name: '중복', role: '일반', team: '동부', status: '활성' }];
const job = { year: 2026, team: '동부', month: 9, closerEmail: 'lead@nkmro.com', closeDate: '2026-10-14', closedAt: '2026-10-14 10:05', test: false, key: 'k' };
let rc = pc.recipientsFor(job, users);
t('P13 받는 사람: 동부 활성 일반·담당(김가·b) + 활성 임원(ex), 팀장 본인·비활성·다른 팀 제외, 이메일 소문자·중복 1번', rc.members.map(function (x) { return x.email; }).join() === 'a@nkmro.com,b@nkmro.com' && rc.execs.map(function (x) { return x.email; }).join() === 'ex@nkmro.com', rc);
t('P14 @nkmro.com 아닌 주소는 빼고 기록(DOMAIN)', rc.excluded.some(function (x) { return x.email === 'ex2@gmail.com' && x.reason === 'DOMAIN'; }));
const closerAdmin = Object.assign({}, job, { closerEmail: 'a@nkmro.com' });
t('P15 마감한 사람이 팀원 목록에 있어도 제외(CLOSER)', pc.recipientsFor(closerAdmin, users).excluded.some(function (x) { return x.reason === 'CLOSER'; }) && pc.recipientsFor(closerAdmin, users).members.length === 1);

const NOW1 = KST(2026, 10, 14, 11, 2);
let parts = pc.mailParts(job, { name: '박태영', kind: 'member' }, { nowMs: NOW1, publishDays: 1, users: users });
const memberText = pc.buildText(parts);
t('P16 팀원 메일 제목(원문 그대로)', parts.subject === '[MRO 워크허브] 9월 성과평가 실적 마감 안내 (동부팀)', parts.subject);
t('P17 팀원 메일 본문(원문 그대로)', memberText === '박태영님, 안녕하세요.\n\n동부팀 9월 성과평가 실적이 마감되었습니다. (마감 10/14(수) 10:05)\n2026년 1~9월 누계 기준 우리 팀 점수와 순위를 지금 앱에서 확인할 수 있습니다.\n\n'
  + '📅 실적 공개 기간: 10/14(수) ~ 10/15(목) 23:59\n이 기간에는 우리 팀 매출·이익 숫자도 함께 볼 수 있습니다.\n기간이 끝나면 숫자는 가려지고, 점수와 순위는 계속 볼 수 있습니다.\n\n'
  + '성과평가 바로가기: https://nkmro.github.io/mro-market-intelligence/feed.html?view=perf\n\n이 메일은 MRO 워크허브에서 자동으로 보낸 안내입니다.', memberText);
parts = pc.mailParts(job, { name: '임원일', kind: 'exec' }, { nowMs: NOW1, publishDays: 1, users: users });
t('P18 임원 메일: 마감자(팀장 이름)·숫자 항상 문장, 공개 기간 문단 없음, 링크에 팀(인코딩)', parts.lines[0] === '동부팀이 9월 성과평가 실적을 마감했습니다. (마감 10/14(수) 10:05 · 팀장 주팀장)'
  && parts.lines[2] === '(임원 화면은 공개 기간과 관계없이 숫자가 항상 보입니다.)' && parts.period === null && parts.link === pc.APP_URL + '?view=perf&team=' + encodeURIComponent('동부'), parts);
parts = pc.mailParts(job, { name: '', kind: 'member' }, { nowMs: NOW1, publishDays: 0, users: users });
t('P19 이름 없음 → "안녕하세요.", 공개 일수 0 → 숫자 공개 안 함 문장', parts.hello === '안녕하세요.' && parts.period.title === null && parts.period.lines[0] === '이번 마감은 매출·이익 숫자를 공개하지 않고, 점수와 순위만 볼 수 있습니다.');
parts = pc.mailParts(Object.assign({}, job, { month: 1, closeDate: '2026-02-03', closedAt: '2026-02-03 09:10' }), { name: 'x', kind: 'member' }, { nowMs: KST(2026, 2, 3, 10, 2), publishDays: 7, users: users });
t('P20 1월 마감 → "2026년 1월 누계 기준", 공개 7일 → 2/3(화) ~ 2/10(화)', parts.lines[1].indexOf('2026년 1월 누계 기준') === 0 && parts.period.title === '📅 실적 공개 기간: 2/3(화) ~ 2/10(화) 23:59', parts);
const dec = Object.assign({}, job, { year: 2026, month: 12, closeDate: '2026-12-31', closedAt: '2026-12-31 17:00' });
parts = pc.mailParts(dec, { name: 'x', kind: 'member' }, { nowMs: KST(2027, 1, 1, 0, 2), publishDays: 1, users: users });
t('P21 1월에 작년 12월 마감: 제목 "2026년 12월", 해가 섞이면 날짜 모두 연도(2026/12/31(목) ~ 2027/1/1(금))', parts.subject === '[MRO 워크허브] 2026년 12월 성과평가 실적 마감 안내 (동부팀)'
  && parts.period.title === '📅 실적 공개 기간: 2026/12/31(목) ~ 2027/1/1(금) 23:59' && parts.lines[0].indexOf('(마감 2026/12/31(목) 17:00)') > 0, parts);
parts = pc.mailParts(dec, { name: 'x', kind: 'member' }, { nowMs: KST(2026, 12, 31, 18, 2), publishDays: 1, users: users });
t('P22 12/31 당일 발송(같은 해 제목은 연도 없음)이라도 공개 끝이 다음 해면 날짜에 연도', parts.subject.indexOf('2026년') < 0 && parts.period.title.indexOf('2026/12/31') > 0);
let built = pc.buildMessages(job, { nowMs: NOW1, publishDays: 1, users: users, alreadySent: ['a@nkmro.com'] });
t('P23 정식: 이미 받은 사람 빼고 1명당 1통(b, ex), 받는 사람 이름 그대로', built.messages.map(function (m) { return m.to + m.kind; }).join() === 'b@nkmro.com' + 'member,ex@nkmro.com' + 'exec' && built.messages[0].text.indexOf('안녕하세요.') === 0, built.messages);
t('P24 HTML: 버튼 글자·주소·특수문자 escape, 숫자(점수·매출) 없음', built.messages[0].html.indexOf('성과평가 바로가기') > 0 && built.messages[0].html.indexOf('?view=perf') > 0 && !/점수 \d|\d+점/.test(built.messages[0].text));
built = pc.buildMessages(Object.assign({}, job, { test: true }), { nowMs: NOW1, publishDays: 1, users: users, testRecipient: 'Me@nkmro.com' });
t('P25 시험: 시험 주소 1곳에 팀원용·임원용 견본 2통, 제목 [시험], 안내 띠에 정식 인원(3명 = 팀원 2·임원 1)', built.messages.length === 2 && built.messages.every(function (m) { return m.to === 'me@nkmro.com' && m.subject.indexOf('[시험] ') === 0; })
  && built.messages[0].text.indexOf('정식 운영이었다면 3명(팀원 2·임원 1)') > 0, built.messages.map(function (m) { return m.subject; }));
const evil = pc.mailParts(Object.assign({}, job, { team: '<b>팀' }), { name: '<script>', kind: 'member' }, { nowMs: NOW1, publishDays: 1, users: users });
t('P26 이름·팀 이름의 <> 는 HTML에서 escape', pc.buildHtml(evil).indexOf('<script>') < 0 && pc.buildHtml(evil).indexOf('&lt;script&gt;') > 0);

const dh = pc.readMailSettings([['성과마감메일사용', 'TRUE']]).hour;
const pd = function (h, mi) { return pc.planDue({ nowMs: KST(2026, 10, 14, h, mi), years: [{ year: 2026, closeRows: [CLOSE[0]] }], hour: dh }).length; };
t('P27 기본 17시(시각 줄 없음): 10:05 마감 → 11:02·16:02엔 안 보냄, 17:02에 보냄', dh === 17 && pd(11, 2) === 0 && pd(16, 2) === 0 && pd(17, 2) === 1);

// ── S: 설정 저장(성과마감메일시각)
const SU = [{ email: 'a', name: 'a', role: '일반', team: '동부', status: '활성' }];
const SS = [['키', '값', '설명'], ['성과공개일수', 1, '']];
let w = perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailHour: 9 });
t('S1 줄 없음 + 9 저장 → 마지막 줄 다음(3행)에 A~C 새 줄(키·값·설명)', w.ok && w.writes.length === 1 && w.writes[0].row === 3 && w.writes[0].col === 'A:C' && w.writes[0].values[0] === '성과마감메일시각' && w.writes[0].values[1] === 9, w);
w = perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일시각', 9, '']]), users: SU, monthlyRows: [], closeMailHour: '18' });
t('S2 줄 있음 9 → 18: 그 줄(3행) B열만, 바뀐 내용 9 → 18', w.ok && w.writes[0].row === 3 && w.writes[0].col === 'B' && w.writes[0].values[0] === 18 && w.changed[0].from === 9 && w.changed[0].to === 18, w);
t('S3 같은 값(9 → 9) → NOTHING_TO_SAVE', perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일시각', 9, '']]), users: SU, monthlyRows: [], closeMailHour: 9 }).error === 'NOTHING_TO_SAVE');
t('S4 24·-1·9.5·"abc"·빈칸 → BAD_CLOSE_MAIL_HOUR, 0·23 허용', [24, -1, 9.5, 'abc', ''].every(function (h) { return perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailHour: h }).error === 'BAD_CLOSE_MAIL_HOUR'; })
  && perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailHour: 0 }).ok && perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailHour: 23 }).ok);
w = perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], publishDays: 2, closeMailHour: 10 });
t('S5 공개 일수 + 메일 시각 한 번에: 2행 B + 3행 새 줄', w.ok && w.writes.map(function (x) { return x.row + x.col; }).join() === '2B,3A:C');
t('S6 같은 키 줄 둘 → DUPLICATE_SETTING_KEY', perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일시각', 9], ['성과마감메일시각', 10]]), users: SU, monthlyRows: [], closeMailHour: 11 }).error === 'DUPLICATE_SETTING_KEY');
const sv = perf.settingsView({ settingsRows: SS.concat([['성과마감메일시각', 'x']]), users: SU, monthlyRows: [] });
t('S7 화면용: 잘못된 값 "x" → 값 17·raw "x"·valid false', sv.closeMailHour.value === 17 && sv.closeMailHour.raw === 'x' && sv.closeMailHour.valid === false, sv.closeMailHour);

// S8~: 마감 안내 메일 켜기/끄기(성과마감메일사용, 2026-11-13 앱·시트 통일)
const en = function (rows) { return perf.readCloseMailEnabled(rows); };
t('S8 읽기 규칙이 메일 쪽(perfCloseMail.readMailSettings)과 같다: TRUE·true·불리언 true → 켜짐, FALSE·빈칸·"예"·줄 없음 → 꺼짐', [['TRUE', true], ['true', true], [true, true], ['FALSE', false], ['', false], ['예', false]].every(function (c) {
  const rows = [['성과마감메일사용', c[0]]]; return en(rows).enabled === c[1] && pc.readMailSettings(rows).enabled === c[1]; }) && en([]).enabled === false && en([]).raw === null && pc.readMailSettings([]).enabled === false);
w = perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일사용', 'TRUE', '']]), users: SU, monthlyRows: [], closeMailEnabled: false });
t('S9 켜짐(시트 TRUE) → 끄기: 그 줄(3행) B열만 불리언 false, 바뀐 내용 true → false', w.ok && w.writes.length === 1 && w.writes[0].row === 3 && w.writes[0].col === 'B' && w.writes[0].values[0] === false && w.changed[0].from === true && w.changed[0].to === false, w);
w = perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailEnabled: true });
t('S10 줄 없음 → 켜기: 새 줄 A~C(키·true·설명)', w.ok && w.writes[0].col === 'A:C' && w.writes[0].values[0] === '성과마감메일사용' && w.writes[0].values[1] === true, w);
t('S11 줄 없음 + 끄기 = 이미 꺼짐 → NOTHING_TO_SAVE(줄을 새로 만들지 않음), 시트 TRUE + 켜기 → NOTHING_TO_SAVE',
  perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailEnabled: false }).error === 'NOTHING_TO_SAVE'
  && perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일사용', true]]), users: SU, monthlyRows: [], closeMailEnabled: true }).error === 'NOTHING_TO_SAVE');
w = perf.planSettingsWrite({ settingsRows: SS.concat([['성과마감메일사용', '예']]), users: SU, monthlyRows: [], closeMailEnabled: false });
t('S12 시트 값이 "예"(잘못됨, 꺼짐으로 읽힘) + 끄기 → FALSE로 고쳐 씀', w.ok && w.writes[0].values[0] === false, w);
t('S13 true/false 말고 "TRUE"·1·null → BAD_CLOSE_MAIL_ENABLED', ['TRUE', 1, null].every(function (v) { return perf.planSettingsWrite({ settingsRows: SS, users: SU, monthlyRows: [], closeMailEnabled: v }).error === 'BAD_CLOSE_MAIL_ENABLED'; }));
t('S14 화면용 settingsView에 closeMailEnabled {enabled, raw}', JSON.stringify(perf.settingsView({ settingsRows: SS.concat([['성과마감메일사용', 'TRUE']]), users: SU, monthlyRows: [] }).closeMailEnabled) === '{"enabled":true,"raw":"TRUE"}');

// ── I: index.js — 가짜 시트·Firestore·메일
const env = { me: 'jhjoo@nkmro.com', sent: [], logs: [], loginFail: false, sendFailTo: {}, throwSheets: false, store: {} };
const SHEET = {
  users: [['jhjoo@nkmro.com', '주팀장', '팀장', '동부', '활성'], ['a@nkmro.com', '김가', '일반', '동부', '활성'], ['b@nkmro.com', '이가', '담당', '동부', '활성'],
    ['c@nkmro.com', '퇴사', '일반', '동부', '비활성'], ['d@nkmro.com', '서부원', '일반', '서부', '활성'], ['ex@nkmro.com', '임원일', '임원', '본사', '활성']],
  mroSettings: [['인사평가파일_2026', 'F26'], ['인사평가파일_2027', 'F27']],
  F26: { '인사평가설정': [['키', '값', '설명'], ['성과공개일수', 1, ''], ['성과마감메일시각', 9, '']], '성과-마감': [[2026, '동부', 9, 'jhjoo@nkmro.com', '2026-10-14 10:05', '9월 마감']], '성과-월실적': [] },
  F27: { '인사평가설정': [['키', '값', '설명'], ['성과공개일수', 1, ''], ['성과마감메일사용', 'TRUE', '']], '성과-마감': [], '성과-월실적': [] }
};
function rows(file, r) { const m = /^'?(.+?)'?!([A-Z])(\d+):/.exec(r); const all = (file[m[1]] || []).map(function (x) { return x.slice(); }); return m[3] === '1' ? all : all; }
const realSheets = require('../lib/sheetsClient');
function fsDoc(col, id) {
  return { get: async function () { const d = (env.store[col] || {})[id]; return { exists: !!d, data: function () { return d; } }; },
    set: async function (v) { env.store[col] = env.store[col] || {}; env.store[col][id] = JSON.parse(JSON.stringify(v)); env.store[col][id].__seq = ++env.seq; } };
}
env.seq = 0;
const fakeFirestore = { collection: function (col) { return { doc: function (id) { return fsDoc(col, id); },
  orderBy: function () { return { limit: function () { return { get: async function () {
    const docs = Object.values(env.store[col] || {}).sort(function (a, b) { return b.__seq - a.__seq; }).slice(0, 1);
    return { empty: docs.length === 0, docs: docs.map(function (d) { return { data: function () { return Object.assign({}, d, { updatedAt: { toMillis: function () { return KST(2026, 10, 14, 11, 2); } } }); } }; }) }; } }; } }; } }; } };
const stubs = {
  '@google-cloud/firestore': { Firestore: class { constructor() { return fakeFirestore; } }, FieldValue: { serverTimestamp: function () { return 'TS'; }, delete: function () { return 'DEL'; } } },
  './lib/writeLock': { acquireLock: async function () { return true; }, releaseLock: async function () {} },
  './lib/writeIdempotency': { IDEMPOTENCY_COLLECTION: 'x', withIdempotency: async function (fs, key, action, fn) { return fn(); } },
  'google-auth-library': { GoogleAuth: class { constructor() {} async getClient() { return { request: async function (o) {
    let n = 0; o.data.data.forEach(function (d) { env.writes = (env.writes || []).concat([{ range: d.range, values: d.values[0] }]);
      const m = /^'?(.+?)'?!([A-Z])(\d+)(?::([A-Z])\d+)?$/.exec(d.range); const row = Number(m[3]) - 1; const arr = SHEET.F26[m[1]];
      while (arr.length <= row) arr.push([]); d.values[0].forEach(function (v, i) { arr[row][m[2].charCodeAt(0) - 65 + i] = v; n++; }); });
    return { data: { totalUpdatedCells: n } }; } }; } } },
  './lib/auth': { authenticateSession: async function () { return { ok: true, email: env.me, timings: {} }; } },
  './lib/sheetsClient': Object.assign({}, realSheets, { getSheetsClient: async function () { if (env.throwSheets) throw new Error('SHEETS_DOWN'); return {}; },
    batchGetValues: async function (c, id, ranges) {
      return ranges.map(decodeURIComponent).map(function (r) {
        if (id === 'F26' || id === 'F27') return { values: rows(SHEET[id], r) };
        if (r.indexOf('설정!') === 0) return { values: SHEET.mroSettings };
        if (r.indexOf('사용자팀마스터!') === 0) return { values: SHEET.users };
        return { values: [] };
      });
    } }),
  './lib/mailer': { FROM_ADDRESS: 'jhjoo@nkmro.com', describeError: function (e) { return { message: String(e && e.message || e) }; },
    verifyLogin: async function () { env.logins = (env.logins || 0) + 1; if (env.loginFail) throw new Error('535 login'); },
    sendMessages: async function (msgs) { return { ok: true, sent: msgs.filter(function (m) { return !env.sendFailTo[m.to]; }).length, failed: msgs.filter(function (m) { return env.sendFailTo[m.to]; }).length,
      results: msgs.map(function (m) { if (env.sendFailTo[m.to]) return { to: m.to, ok: false, error: { message: 'x' } }; env.sent.push(m); return { to: m.to, ok: true }; }) }; } }
};
const req = function (n) { return stubs[n] || require(n.charAt(0) === '.' ? path.join(dir, n) : n); };
const mod = { exports: {} };
let fakeNow = KST(2026, 10, 14, 11, 2);
const FakeDate = function () { return arguments.length ? new (Function.prototype.bind.apply(Date, [null].concat(Array.prototype.slice.call(arguments))))() : new Date(fakeNow); };
FakeDate.now = function () { return fakeNow; }; FakeDate.UTC = Date.UTC; FakeDate.parse = Date.parse; FakeDate.prototype = Date.prototype;
const ctx = { require: req, module: mod, exports: mod.exports, console: { log: function (s) { env.logs.push(String(s)); }, error: function (s) { env.logs.push(String(s)); } },
  process: process, Buffer: Buffer, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: FakeDate, URL: URL, TextEncoder: TextEncoder };
vm.runInNewContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx);
const fns = mod.exports;
async function run(fn, body) { let out = null; await fns[fn]({ method: 'POST', body: body || {}, headers: {} }, { set: function () {}, setHeader: function () {}, status: function () { return { json: function (o) { out = o; }, send: function () {} }; } }); return out; }
const lastLog = function () { const l = env.logs.filter(function (x) { return x.indexOf('[perfCloseMail]') === 0; }); return l[l.length - 1] || ''; };
const reset = function () { env.sent = []; env.logs = []; };

(async function () {
  // 2026 파일: 사용 줄 없음 → 꺼짐
  let r = await run('issueMailBatchTest');
  t('I1 사용 줄 없음 → 마감 메일 DISABLED(보냄 0), 이슈 메일은 그대로 자기 판단(DISABLED 응답)', lastLog().indexOf('"reason":"DISABLED"') > 0 && env.sent.length === 0 && r.skipped === true && r.reason === 'DISABLED', { log: lastLog(), r: r });
  SHEET.F26['인사평가설정'].push(['성과마감메일사용', 'TRUE', '']);
  reset(); r = await run('issueMailBatchTest');
  t('I2 켜짐 + 10/14 11:02 → 동부 9월 메일: 김가·이가(팀원)·임원일, 팀장 본인·비활성·서부 제외 = 3통', env.sent.map(function (m) { return m.to; }).sort().join() === 'a@nkmro.com,b@nkmro.com,ex@nkmro.com' && r.reason === 'DISABLED', env.sent.map(function (m) { return m.to; }));
  const doc = env.store.perfCloseMails && env.store.perfCloseMails['2026_동부_9_2026-10-14'];
  t('I3 Firestore perfCloseMails 기록: done·받은 3명·받을 사람 3·제외 없음(마감자 팀장은 범위 밖)', doc && doc.status === 'done' && doc.sentTo.length === 3 && doc.recipientCount === 3 && doc.excluded.length === 0, doc); // 마감자(팀장)는 애초에 받는 사람 범위(일반·담당·임원) 밖
  t('I4 메일 제목·팀원 본문 공개 기간', env.sent[0].subject === '[MRO 워크허브] 9월 성과평가 실적 마감 안내 (동부팀)' && env.sent.find(function (m) { return m.to === 'a@nkmro.com'; }).text.indexOf('10/14(수) ~ 10/15(목) 23:59') > 0);
  reset(); await run('issueMailBatchTest');
  t('I5 같은 시각 다시 실행 → ALREADY_DONE, 보냄 0', env.sent.length === 0 && lastLog().indexOf('ALREADY_DONE') > 0, lastLog());
  // 같은 날 풀었다 다시 마감(15:00) → 같은 기록 이름 → 1번만
  SHEET.F26['성과-마감'].push([2026, '동부', 9, 'jhjoo@nkmro.com', '2026-10-14 15:00', '다시 마감']);
  fakeNow = KST(2026, 10, 14, 16, 2); reset(); await run('issueMailBatchTest');
  t('I6 같은 날 같은 달 다시 마감 → 보내지 않음(결정 ④)', env.sent.length === 0);
  // 다른 날 다시 마감 + 일부 실패 → partial, 관리자 알림 1번, 다음 정시에 남은 사람만
  SHEET.F26['성과-마감'].push([2026, '동부', 9, 'jhjoo@nkmro.com', '2026-10-20 09:30', '다른 날 다시 마감']);
  fakeNow = KST(2026, 10, 20, 10, 2); env.sendFailTo = { 'b@nkmro.com': true }; reset(); await run('issueMailBatchTest');
  const d2 = env.store.perfCloseMails['2026_동부_9_2026-10-20'];
  t('I7 다른 날 다시 마감 → 새로 보냄, b 실패 → partial + 관리자 알림 1통(실패 제목)', d2.status === 'partial' && d2.sentTo.length === 2 && d2.failNotified === true
    && env.sent.some(function (m) { return m.to === 'jhjoo@nkmro.com' && m.subject.indexOf('성과평가 마감 메일 일부 발송 실패') > 0; }), { d2: d2, sent: env.sent.map(function (m) { return m.to; }) });
  env.sendFailTo = {}; fakeNow = KST(2026, 10, 20, 11, 2); reset(); await run('issueMailBatchTest');
  t('I8 다음 정시: 남은 b만 보내고 done, 관리자 알림 다시 안 보냄', env.sent.map(function (m) { return m.to; }).join() === 'b@nkmro.com' && env.store.perfCloseMails['2026_동부_9_2026-10-20'].status === 'done');
  // 로그인 실패 → 아무에게도 안 보냄, login_failed, 이슈 메일은 계속
  SHEET.F26['성과-마감'].push([2026, '서부', 9, 'x@nkmro.com', '2026-10-21 08:00', '서부 마감']);
  fakeNow = KST(2026, 10, 21, 9, 2); env.loginFail = true; reset(); r = await run('issueMailBatchTest');
  t('I9 회사 메일 로그인 실패 → 보냄 0, login_failed 기록, 이슈 메일 응답은 그대로', env.sent.length === 0 && env.store.perfCloseMails['2026_서부_9_2026-10-21'].status === 'login_failed' && r.reason === 'DISABLED');
  env.loginFail = false; fakeNow = KST(2026, 10, 21, 10, 2); reset(); await run('issueMailBatchTest');
  t('I10 다음 정시 로그인 성공 → 서부원·임원 2통, done', env.sent.map(function (m) { return m.to; }).sort().join() === 'd@nkmro.com,ex@nkmro.com' && env.store.perfCloseMails['2026_서부_9_2026-10-21'].status === 'done');
  // 시트 오류 → 마감 메일 블록만 실패 로그, 이슈 메일은 진행(여기서는 이슈 메일도 시트를 읽으므로 500이지만 마감 메일 오류가 먼저 막지 않는지 = 로그 순서로 확인)
  env.throwSheets = true; reset(); r = await run('issueMailBatchTest');
  t('I11 마감 메일 쪽 오류는 자체 try/catch로 로그만 남기고 이슈 메일 처리로 넘어감', env.logs[0].indexOf('[perfCloseMail] 오류: SHEETS_DOWN') === 0 && env.logs.some(function (x) { return x.indexOf('[issueMailBatchTest] 오류') === 0; }), env.logs);
  env.throwSheets = false;
  // 시험 모드
  SHEET.F26['인사평가설정'].push(['성과마감메일테스트수신자', 'jhjoo@nkmro.com', '']);
  fakeNow = KST(2026, 11, 13, 12, 2); reset(); await run('issueMailBatchTest');
  t('I12 시험 모드: 시험 주소에만, 팀마다 견본(동부 팀원·임원 2 + 서부 팀원·임원 2 = 4통), 지난 마감도 보냄, test_ 기록', env.sent.length === 4 && env.sent.every(function (m) { return m.to === 'jhjoo@nkmro.com' && m.subject.indexOf('[시험] ') === 0; })
    && !!env.store.perfCloseMails['test_2026-11-13_2026_동부_9'], env.sent.map(function (m) { return m.subject; }));
  reset(); await run('issueMailBatchTest');
  t('I13 시험 모드 같은 날 다시 → 보내지 않음(팀마다 하루 1번)', env.sent.length === 0);
  // view=settings: 켜짐·시험 모드·최근 기록, 시험 주소는 응답에 없음
  r = await run('getPerformanceTest', { sessionToken: 't', view: 'settings' });
  t('I14 view=settings: closeMail 켜짐·시험 모드·최근 기록(시험, 동부 9월), 시각 9, 시험 주소 문자열은 응답에 없음', r.ok && r.closeMail.enabled === true && r.closeMail.testMode === true && r.closeMail.last && r.closeMail.last.test === true
    && r.closeMailHour.value === 9 && JSON.stringify(r).indexOf('성과마감메일테스트수신자') < 0 && JSON.stringify(r.closeMail).indexOf('jhjoo@') < 0, r && r.closeMail);
  // 앱에서 끄기 → 시트 B열 false → 다음 실행은 DISABLED (시트 우선: 서버는 요청마다 시트를 다시 읽음)
  r = await run('savePerformanceTest', { sessionToken: 't', action: 'saveSettings', idempotencyKey: 'k1', closeMailEnabled: false });
  const useRow = SHEET.F26['인사평가설정'].findIndex(function (x) { return x[0] === '성과마감메일사용'; });
  t('I17 앱에서 끄기 저장 → 인사평가설정 성과마감메일사용 줄 B열만 false(1칸)', r.ok && r.updatedCells === 1 && SHEET.F26['인사평가설정'][useRow][1] === false && env.writes.length === 1 && env.writes[0].range === "'인사평가설정'!B" + (useRow + 1), { r: r, w: env.writes });
  r = await run('getPerformanceTest', { sessionToken: 't', view: 'settings' });
  t('I18 다시 읽으면 closeMailEnabled {enabled:false, raw:"FALSE"(시트 화면과 같은 표기)}, 메일 쪽도 꺼짐', r.closeMailEnabled.enabled === false && r.closeMailEnabled.raw === 'FALSE' && r.closeMail.enabled === false, r.closeMailEnabled);
  reset(); fakeNow = KST(2026, 11, 13, 18, 2); await run('issueMailBatchTest');
  t('I19 꺼진 뒤 일괄 실행 → DISABLED, 보냄 0', lastLog().indexOf('"reason":"DISABLED"') > 0 && env.sent.length === 0, lastLog());
  r = await run('savePerformanceTest', { sessionToken: 't', action: 'saveSettings', idempotencyKey: 'k2', closeMailEnabled: true });
  t('I20 다시 켜기 → 같은 줄 B열 true', r.ok && SHEET.F26['인사평가설정'][useRow][1] === true);
  // 1월: 작년 파일 12월 마감
  SHEET.F26['인사평가설정'] = SHEET.F26['인사평가설정'].filter(function (x) { return x[0] !== '성과마감메일테스트수신자'; });
  SHEET.F26['성과-마감'].push([2026, '동부', 12, 'jhjoo@nkmro.com', '2027-01-05 09:30', '12월 마감(1월 유예)']);
  fakeNow = KST(2027, 1, 5, 17, 2); reset(); await run('issueMailBatchTest');
  t('I15 1월(17:02, 2027 파일엔 시각 줄 없음 → 기본 17): 올해(2027) 파일 설정으로 켜짐 + 작년(2026) 파일 12월 마감도 읽어 보냄, 제목 "2026년 12월"', env.sent.length === 3 && env.sent[0].subject === '[MRO 워크허브] 2026년 12월 성과평가 실적 마감 안내 (동부팀)', env.sent.map(function (m) { return m.subject; }));
  fakeNow = KST(2027, 2, 5, 10, 2); SHEET.F26['성과-마감'].push([2026, '서부', 12, 'x', '2027-02-05 09:00', '2월인데 작년 줄']); reset(); await run('issueMailBatchTest');
  t('I16 2월에는 작년 파일을 읽지 않음', env.sent.length === 0);
  console.log('pass ' + pass + ' / fail ' + fail);
  if (fail) process.exitCode = 1;
})().catch(function (e) { console.log('ERROR ' + (e && e.stack || e)); process.exitCode = 1; });
