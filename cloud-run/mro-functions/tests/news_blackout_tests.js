// cloud-run/mro-functions/tests/news_blackout_tests.js
// 시황 뉴스 수집 중단 설정('시황수집중단기간')에 요일·8자리 날짜를 더한 변경(2026-10-19)의 가짜 데이터 시험.
// apps-script/Code.gs의 isInNewsBlackout_ 관련 부분을 그대로 잘라 실행한다(네트워크 0건).
//   A그룹: 기존 날짜 규칙이 그대로인지(예전 동작과 같은 결과)
//   B그룹: 요일(한글·영어, 대소문자), 혼합, 잘못된 값
//   C그룹: 8자리 날짜
//   D그룹: collectMarketNews가 오늘 요일을 넘기는지(코드 확인)
// 실행: (cloud-run/mro-functions 폴더에서) node tests/news_blackout_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');

let passes = 0, failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
  if (cond) passes++; else failures++;
}

// Code.gs에서 판정 부분(요일 표 ~ isInNewsBlackout_ 끝)을 그대로 잘라 온다
const s0 = code.indexOf('var NEWS_BLACKOUT_DOW_');
const s1 = code.indexOf('// 네이버 뉴스검색 API가');
if (s0 < 0 || s1 < 0) throw new Error('Code.gs에서 판정 코드를 못 찾음');
const logs = [];
const ctx = { Logger: { log: m => logs.push(String(m)) }, Object };
vm.runInNewContext(code.slice(s0, s1), ctx);
const f = ctx.isInNewsBlackout_;

// 예전(2026-09-22) 판정 함수 — 기존 동작과 같은지 비교용(변경 전 코드 그대로)
function oldF(todayYYMMDD, settingValue) {
  var entries = String(settingValue || '').split(',');
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i].trim(); if (!entry) continue;
    var parts = entry.split('~').map(function (s) { return s.trim(); });
    if (parts.length === 1) { if (!/^\d{6}$/.test(parts[0])) continue; if (todayYYMMDD === parts[0]) return true; }
    else if (parts.length === 2) {
      var a = parts[0], b = parts[1];
      if (!/^\d{6}$/.test(a) || !/^\d{6}$/.test(b)) continue; if (a > b) continue;
      if (todayYYMMDD >= a && todayYYMMDD <= b) return true;
    }
  }
  return false;
}

console.log('── A그룹: 기존 날짜 규칙 ──');
const oldCases = ['', '261019', '261019~261021', '260923~260927', ' 261018 , 261020~261022 ', '261001,,261019', '261021~261019',
  '26101', 'abc', '261019~', '~261019', '261001~261003~261005', '261225~261226, 261019', '261020'];
const days = ['261018', '261019', '261020', '261021', '261022', '260925', '261225'];
let same = true; const diffs = [];
for (const c of oldCases) for (const d of days) for (const dow of [undefined, 0, 1, 6]) {
  const a = f(d, c, dow), b = oldF(d, c);
  if (a !== b) { same = false; diffs.push([c, d, dow, a, b]); }
}
check('A1 날짜만 쓴 값(14가지 × 날짜 7개 × 요일 4가지)은 예전과 결과가 모두 같음', same, diffs.slice(0, 5));
check('A2 지금 설정값 260923~260927: 260925 차단, 261019 통과', f('260925', '260923~260927', 1) && !f('261019', '260923~260927', 1));
check('A3 빈 값 → 차단 안 함', !f('261019', '', 1) && !f('261019', null, 1));
check('A4 시작>종료 범위는 무시하고 기록 남김', !f('261020', '261021~261019', 2) && logs.some(l => l.includes('261021~261019')));

console.log('── B그룹: 요일 ──');
// 2026-10-17(토)=6, 2026-10-18(일)=0, 2026-10-19(월)=1
check('B1 "토" → 토요일(6)만 차단, 일·월은 통과', f('261017', '토', 6) && !f('261018', '토', 0) && !f('261019', '토', 1));
check('B2 "토, 일" → 토·일 차단, 월 통과', f('261017', '토, 일', 6) && f('261018', '토, 일', 0) && !f('261019', '토, 일', 1));
check('B3 영어 SAT, sun(소문자), Saturday, SUNDAY 모두 인정', f('261017', 'SAT', 6) && f('261018', 'sun', 0) && f('261017', 'Saturday', 6) && f('261018', 'SUNDAY', 0));
check('B4 "토요일", "일요일" 인정', f('261017', '토요일', 6) && f('261018', '일요일', 0));
check('B5 월~금 각각 맞는 요일만', ['월', '화', '수', '목', '금'].every((k, i) => f('261019', k, i + 1) && !f('261019', k, ((i + 2) % 7))));
check('B6 날짜·요일 섞어 쓰기: "261001~261003, 261225, 토, 일"', (() => { const v = '261001~261003, 261225, 토, 일';
  return f('261002', v, 5) && f('261225', v, 5) && f('261017', v, 6) && f('261018', v, 0) && !f('261019', v, 1); })());
check('B7 요일 범위 "토~일"은 받지 않음(무시 → 차단 안 함)', !f('261017', '토~일', 6) && !f('261018', '토~일', 0));
check('B8 모르는 이름("토욜", "SA", "주말")은 무시, 나머지 항목은 그대로 적용', !f('261017', '토욜, SA, 주말', 6) && f('261017', '토욜, 토', 6));
check('B9 요일을 넘기지 않으면(예전 방식 호출) 요일 항목은 무시', !f('261017', '토', undefined));
check('B10 앞뒤 공백은 무시(" 토 ")', f('261017', ' 토 ,일', 6));

console.log('── C그룹: 8자리 날짜 ──');
check('C1 "20261019" → 261019 차단', f('261019', '20261019', 1) && !f('261020', '20261019', 2));
check('C2 "20261019~20261021" 범위', f('261020', '20261019~20261021', 2) && !f('261022', '20261019~20261021', 4));
check('C3 6자리·8자리 섞은 범위 "261019~20261021"', f('261021', '261019~20261021', 3));
check('C4 20으로 시작하지 않는 8자리("19261019")·7자리는 무시', !f('261019', '19261019', 1) && !f('261019', '2610190', 1));

console.log('── D그룹: collectMarketNews 호출부 ──');
const cm = code.slice(code.indexOf('\nfunction collectMarketNews('), code.indexOf('\nfunction collectMarketNews(') + 2500);
check('D1 오늘 요일을 서울 기준(UTC+9)으로 구해 isInNewsBlackout_에 넘김', /todayDow_ = new Date\(new Date\(\)\.getTime\(\) \+ 9 \* 60 \* 60 \* 1000\)\.getUTCDay\(\)/.test(cm) && cm.includes('isInNewsBlackout_(todayYYMMDD_, newsBlackoutSetting_, todayDow_)'));
// 서울 기준 요일 계산이 날짜 경계에서 맞는지: UTC 2026-10-17 15:00 = 서울 10/18(일) 00:00
const dowAt = ms => new Date(ms + 9 * 60 * 60 * 1000).getUTCDay();
check('D2 요일 계산 경계: 서울 10/17(토) 23:59 → 6, 10/18(일) 00:00 → 0', dowAt(Date.UTC(2026, 9, 17, 14, 59)) === 6 && dowAt(Date.UTC(2026, 9, 17, 15, 0)) === 0);

console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
process.exitCode = failures ? 1 : 0;
