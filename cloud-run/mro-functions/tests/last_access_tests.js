// 사용자 현황 "최종 접속"(K열) 테스트 — node tests/last_access_tests.js
// 가상의 값만 사용(실제 사용자·시트 데이터 없음).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const la = require('../lib/lastAccess');
const { sheetSerialToMs } = require('../lib/feedEngine');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL ' + name); } }

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 16, 0, 41); // 2026-11-16 09:41 KST

// 1) shouldMark — 1시간에 1번
t('L1 기록 없음 → 씀', la.shouldMark(undefined, NOW) === true);
t('L2 null → 씀', la.shouldMark(null, NOW) === true);
t('L3 30분 전 → 안 씀', la.shouldMark(new Date(NOW - 30 * 60 * 1000), NOW) === false);
t('L4 59분59초 전 → 안 씀', la.shouldMark(NOW - H + 1000, NOW) === false);
t('L5 정확히 1시간 전 → 씀', la.shouldMark(NOW - H, NOW) === true);
t('L6 3시간 전 → 씀', la.shouldMark(NOW - 3 * H, NOW) === true);
t('L7 Firestore Timestamp 모양(toDate) 30분 전 → 안 씀', la.shouldMark({ toDate: () => new Date(NOW - 30 * 60 * 1000) }, NOW) === false);
t('L8 미래 시각(시계 오차) → 씀', la.shouldMark(NOW + 10 * 60 * 1000, NOW) === true);
t('L9 이상한 문자열 → 씀', la.shouldMark('abc', NOW) === true);

// 2) readFromRow — K열(index 10)
const serial = (NOW + 9 * H) / 86400000 + 25569; // index.js msToSheetSerial_와 같은 식
const base = ['a@x.com', '홍길동', '일반', '동부', '활성', '', 'h', 0, '', '사무소'];
t('R1 K열 시리얼 → 원래 ms', Math.abs(la.readFromRow(base.concat([serial]), sheetSerialToMs) - NOW) < 1000);
t('R2 K열 없음(행이 J까지) → null', la.readFromRow(base, sheetSerialToMs) === null);
t('R3 K열 빈칸 → null', la.readFromRow(base.concat(['']), sheetSerialToMs) === null);
t('R4 K열 이상한 글자 → null', la.readFromRow(base.concat(['모름']), sheetSerialToMs) === null);
t('R5 행 자체가 없음 → null', la.readFromRow(undefined, sheetSerialToMs) === null);
t('R6 열 상수 K / 10', la.LAST_ACCESS_COL === 'K' && la.LAST_ACCESS_COL_INDEX === 10);

// 3) index.js 배선(정적 확인)
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const gu = idx.slice(idx.indexOf('exports.getUsersTest'), idx.indexOf('exports.getUsersTest') + 2500);
t('I1 getUsersTest는 A2:L 범위 사용(K 최종접속 + 2026-11-18 L 겸임팀)', /USERS_LIST_RANGE = encodeURIComponent\(SHEET_USER_NAME \+ '!A2:L'\)/.test(idx) && gu.includes('[USERS_LIST_RANGE]'));
t('I2 POLL_USER_RANGE는 A2:L(2026-11-18 겸임팀 L열까지 — K 최종접속은 읽기만, 쓰기 없음)', idx.includes("const POLL_USER_RANGE = encodeURIComponent(SHEET_USER_NAME + '!A2:L');"));
t('I3 getUsersTest 응답에 lastAccessMs', gu.includes('lastAccessMs: lastAccess.readFromRow(row, feedEngine.sheetSerialToMs)'));
const wh = idx.slice(idx.indexOf('exports.whoamiTest'), idx.indexOf('exports.getSettingsTest'));
t('I4 whoami: shouldMark 확인 후 K열 쓰기', wh.includes('lastAccess.shouldMark(session.lastAccessMarkedAt') && wh.includes('lastAccess.LAST_ACCESS_COL, msToSheetSerial_(nowMs)'));
t('I5 whoami: 기록 실패는 try/catch로 무시', /try \{\s*const nowMs[\s\S]*?\} catch \(e\) \{\s*console\.error\('\[lastAccess\]/.test(wh));
t('I6 whoami: 행 번호 = rowIdx + 2', wh.includes('rowIdx + 2'));

// 4) feed.html 화면(renderUserRow + 기존 fmtTime 그대로 실행)
const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'feed.html'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  let d = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) { if (html[k] === '{') d++; else if (html[k] === '}') { d--; if (d === 0) return html.slice(i, k + 1); } }
}
const ctx = { ROLE_OPTIONS: ['일반'], TEAM_OPTIONS: ['동부'], STATUS_OPTIONS: ['활성'], escapeHtml: (s) => String(s) };
vm.createContext(ctx);
vm.runInContext(grab('fmtTime') + '\n' + grab('renderUserRow'), ctx);
const u = { row: 2, email: 'hong@nkmro.com', name: '홍길동', role: '일반', team: '동부', status: '활성' };
const two = new Date(2026, 9, 3, 17, 5).getTime();
const r1 = ctx.renderUserRow(Object.assign({}, u, { lastAccessMs: two }));
t('F1 기록 있음 → "최종 접속 10.3 17:05"', r1.includes('<span class="user-last-access">최종 접속 10.3 17:05</span>'));
const r2 = ctx.renderUserRow(Object.assign({}, u, { lastAccessMs: null }));
t('F2 기록 없음 → "접속 기록 없음"', r2.includes('>접속 기록 없음<'));
const r3 = ctx.renderUserRow(u);
t('F3 옛 서버 응답(필드 없음) → 아무것도 안 보임', !r3.includes('user-last-access'));
const r4 = ctx.renderUserRow(Object.assign({}, u, { lastAccessMs: Date.now() }));
t('F4 오늘 → "최종 접속 오늘 HH:MM"', /최종 접속 오늘 \d\d:\d\d/.test(r4));
t('F7 최종 접속은 이메일 줄(top-line) 안, 입력 줄(user-row)에는 없음(2026-11-18 줄 넘김 방지)', /<div class="top-line">hong@nkmro\.com <span class="user-last-access">최종 접속 10\.3 17:05<\/span><\/div>/.test(r1) && !/user-row">[\s\S]*user-last-access/.test(r1));
t('F5 저장 버튼·메시지 칸은 그대로', r1.includes('id="btn-u2"') && r1.includes('id="msg-u2"'));
const ro = html.slice(html.indexOf('function refreshOnResume'), html.indexOf("document.addEventListener('visibilitychange'"));
t('F6 백그라운드 복귀 때도 whoami 호출', ro.includes('refreshSessionViaWhoami_();'));

console.log(`last_access_tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
