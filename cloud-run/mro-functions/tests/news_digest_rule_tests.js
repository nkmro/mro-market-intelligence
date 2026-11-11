// cloud-run/mro-functions/tests/news_digest_rule_tests.js
// 2026-11-11 시황 뉴스 기준 B단계 — 뉴스 모음 기사 제목 사전 제외(isDigestNewsTitle_) + 지시문 B안 3문장.
// apps-script/Code.gs를 그대로 잘라 실행(네트워크 0건, AI 호출 없음, 시트 없음 — 가짜 데이터).
//   D/N그룹: 제목 필터(좁힌 안) — 걸러야 할 제목 / 통과해야 할 정상 제목
//   S그룹: collectMarketNews 2단계를 그대로 잘라 가짜 기사로 실행 → 모음 기사는 후보에서 빠지고 digestRows_에 담김
//   W그룹: 수집로그·탈락뉴스 기록 줄을 그대로 잘라 실행 → 행 모양(3칸·9칸) 확인
//   P그룹: buildSummarizePrompt_ B안 3문장 전문·위치, A안 문장 없음
//   C그룹: 로그 문구·시험 함수가 다른 곳에서 불리지 않음
// 실행: (cloud-run/mro-functions 폴더에서) node tests/news_digest_rule_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
let passes = 0, failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400)));
  if (cond) passes++; else failures++;
}
function extractFn(name, stopAtComment) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(stopAtComment ? /\nfunction [\w$]+\s*\(|\n\/\*\*|\n\/\/ / : /\nfunction [\w$]+\s*\(|\n\/\*\*/);
  return rest.slice(0, m + 1);
}
function between(a, b) {
  const i = code.indexOf(a); if (i < 0) throw new Error('못 찾음: ' + a);
  const j = code.indexOf(b, i); if (j < 0) throw new Error('못 찾음: ' + b);
  return code.slice(i, j);
}
const words = /const DIGEST_TITLE_WORDS_ = (\[[^\]]*\]);/.exec(code);
const ctx = { DIGEST_TITLE_WORDS_: words ? JSON.parse(words[1].replace(/'/g, '"')) : [] };
vm.runInNewContext([extractFn('isDigestNewsTitle_', true), extractFn('decodeHtmlEntities_'), extractFn('buildSummarizePrompt_')].join('\n'), ctx);
const D = t => ctx.isDigestNewsTitle_(t);

console.log('── D/N그룹: 제목 필터 ──');
check('D0 DIGEST_TITLE_WORDS_ = 좁힌 안 6낱말', !!words && JSON.stringify(ctx.DIGEST_TITLE_WORDS_) === JSON.stringify(['손바닥뉴스', '모닝브리핑', '모닝 브리핑', '뉴스 모음', '뉴스모음', '뉴스 다이제스트']));
['페로타임즈 손바닥뉴스 11월9일(월)', '페로타임즈 손바닥뉴스 9월22일(화)', '철강 뉴스 11월 9일 (월)', '[모닝브리핑] 원자재 동향', '철강 뉴스 모음', '금속 뉴스 다이제스트'].forEach(function (t, i) {
  check('D' + (i + 1) + ' 뉴스 모음 → 거름: ' + t, D(t) === true);
});
['철근 유통가 톤당 68만원…한 달 새 6만원 떨어져', '구리 가격 사상 최고…공급 차질 우려', '정부 브리핑 "철강 수입 규제 검토"', '[주간 시황] 알루미늄 3% 하락',
  '11월 9일 LME 구리 1.2% 상승', '철강 감산 12월 5일(금) 발표 예정', "새로'는 잘 팔리는데…롯데칠성, 본업인 음료에 발목", '', null].forEach(function (t, i) {
  check('N' + (i + 1) + ' 정상 기사 → 통과: ' + t, D(t) === false);
});

console.log('── S그룹: collectMarketNews 2단계 그대로 실행(가짜 기사) ──');
const stage2 = between('// 2단계: 원자재별 중복 제거 후 AI 판단 대상 후보 생성', '// 3시간 이상 경과한 재시도 대기 항목을');
const now = new Date();
const it = (title, desc, link, daysAgo) => ({ title: title, description: desc, link: link, pubDate: new Date(now.getTime() - (daysAgo || 0) * 86400000).toUTCString() });
const sctx = Object.assign({}, ctx, {
  existingLinks: new Set(['L-old']), retryPendingMap: {}, RETRY_DELAY_MS: 3 * 3600000, settings: { maxArticleAgeDays: 7 },
  materials: [['RM001', '철'], ['RM002', '알루미늄']],
  itemsByMaterial: [
    [it('<b>페로타임즈 손바닥뉴스</b> 11월9일(월)', '철근 11월 하락 출발 고점서 6만 원 뚝', 'L-digest'),
     it('철근 유통가 톤당 68만원', '한 달 새 6만원 떨어졌다', 'L-ok1'),
     it('철강 뉴스 모음', '숫자 없음', 'L-digest-nonum'),
     it('페로타임즈 손바닥뉴스 10월1일(목)', '열연 3% 상승', 'L-digest-old', 20),
     it('철강 뉴스 모음', '후판 2% 인상', 'L-old')],
    [it('알루미늄 3% 하락', 'LME 알루미늄 3% 하락', 'L-ok2'),
     it('<b>페로타임즈 손바닥뉴스</b> 11월9일(월)', '철근 6만 원', 'L-digest')]
  ]
});
vm.runInNewContext('(function(){' + stage2 + '; this.__out = { candidates: candidates, digestRows_: digestRows_ }; }).call(this);', sctx);
const out = sctx.__out;
check('S1 정상 기사 2건만 AI 후보(L-ok1·L-ok2)', JSON.stringify(out.candidates.map(c => c.link)) === '["L-ok1","L-ok2"]', out.candidates.map(c => c.link));
check('S2 모음 기사 1건만 digestRows_(원자재·제목·링크, HTML 태그 제거)', out.digestRows_.length === 1 && JSON.stringify(out.digestRows_[0]) === JSON.stringify({ code: 'RM001', korean: '철', title: '페로타임즈 손바닥뉴스 11월9일(월)', link: 'L-digest' }), out.digestRows_);
check('S3 [기존 순서 유지] 숫자 없는 모음 기사·오래된 모음 기사는 기존 필터에서 먼저 빠짐(기록 안 함)', !out.digestRows_.some(d => d.link === 'L-digest-nonum' || d.link === 'L-digest-old'));
check('S4 [기존] 이미 수집로그에 있는 링크(L-old)는 처음부터 건너뜀', !out.digestRows_.some(d => d.link === 'L-old') && !out.candidates.some(c => c.link === 'L-old'));
check('S5 같은 모음 기사가 다른 원자재에서 또 나와도 1번만(원자재 간 교차 중복 방지 그대로)', out.digestRows_.filter(d => d.link === 'L-digest').length === 1);

console.log('── W그룹: 수집로그·탈락뉴스 기록 줄 그대로 실행 ──');
const logLine = /\ndigestRows_\.forEach\(d => \{ logRowsToAppend_\.push\(\[d\.code, d\.link, new Date\(\)\]\); \}\);\n/.exec(code);
const rejBlock = /\ndigestRows_\.forEach\(d => \{\nrejectedNewsRows_\.push\([^\n]+\);\n\}\);\n/.exec(code);
check('W0 기록 줄 2곳이 있음', !!logLine && !!rejBlock);
const wctx = { digestRows_: out.digestRows_, logRowsToAppend_: [], rejectedNewsRows_: [], rejectedAt_: 'T', REJECTED_NEWS_STORE_LINK: true };
vm.runInNewContext((logLine ? logLine[0] : '') + (rejBlock ? rejBlock[0] : ''), wctx);
check('W1 수집로그 행 = [원자재코드, 링크, 수집일시] 3칸', wctx.logRowsToAppend_.length === 1 && wctx.logRowsToAppend_[0].length === 3 && wctx.logRowsToAppend_[0][0] === 'RM001' && wctx.logRowsToAppend_[0][1] === 'L-digest' && Object.prototype.toString.call(wctx.logRowsToAppend_[0][2]) === '[object Date]');
check('W2 탈락뉴스 행 = 9칸, AI요약·점수 빈칸, 탈락사유 뉴스모음제목, 관련게시물ID 빈칸', JSON.stringify(wctx.rejectedNewsRows_) === JSON.stringify([['T', 'RM001', '철', '페로타임즈 손바닥뉴스 11월9일(월)', '', '', 'L-digest', '뉴스모음제목', '']]), wctx.rejectedNewsRows_);
const w2 = { digestRows_: out.digestRows_, rejectedNewsRows_: [], rejectedAt_: 'T', REJECTED_NEWS_STORE_LINK: false };
vm.runInNewContext(rejBlock ? rejBlock[0] : '', w2);
check('W3 REJECTED_NEWS_STORE_LINK=false면 링크 칸 빈칸(기존 사유들과 같은 규칙)', w2.rejectedNewsRows_[0] && w2.rejectedNewsRows_[0][6] === '');
const cm = code.slice(code.indexOf('\nfunction collectMarketNews('), code.indexOf('\nfunction collectMarketNews(') + 40000);
check('W4 수집로그 줄은 logRowsToAppend_ 선언 뒤·setValues 앞, 탈락뉴스 줄은 rejectedNewsRows_ 선언 뒤·setValues 앞',
  cm.indexOf('const logRowsToAppend_ = [];') < cm.indexOf(logLine && logLine[0].trim()) && cm.indexOf(logLine && logLine[0].trim()) < cm.indexOf('logSheet.getRange(logLastRow_ + 1') &&
  cm.indexOf('const rejectedNewsRows_ = [];') < cm.indexOf(rejBlock && rejBlock[0].trim()) && cm.indexOf(rejBlock && rejBlock[0].trim()) < cm.indexOf('rejectedSheet_.getRange(rejectedLastRow_ + 1'));

console.log('── P그룹: AI 지시문 ──');
const p = ctx.buildSummarizePrompt_('알루미늄', '제목', '본문');
const B1 = '기업 실적 기사에서 [알루미늄]의 가격 변화 수치(오름·내림 금액이나 %) 없이 원가 부담만 언급하면, 관련 있음으로 판단하더라도 relevanceScore는 최대 2로 줘. [알루미늄]의 가격 변화 수치가 있으면 이 제한에 해당하지 않아.\n';
const B2 = '요약의 주어는 [알루미늄] 시황이어야 해. 기업 실적 문장을 요약에 쓰지 말고, 기업을 꼭 언급해야 하면 기업 이름을 생략하지 마.\n';
const B3 = "여러 기사의 제목이나 한 줄 소식을 모아 놓은 뉴스 모음·브리핑 기사(예: '○○뉴스 11월9일(월)', '오늘의 주요 뉴스')면 관련 없음으로 판단해.\n";
check('P1 B안 3문장이 A단계 시험과 같은 자리(“관련 없으면 요약은 빈 문자열로 둬.” 바로 뒤)에 순서대로', p.includes('관련 없으면 요약은 빈 문자열로 둬.\n' + B1 + B2 + B3 + '관련 있으면 이 기사가 [알루미늄]의 시황'));
check('P2 A안 문장(“기사의 중심이 특정 기업의 실적…”)은 없음', !p.includes('기사의 중심이 특정 기업의 실적'));
check('P3 각 문장 1번씩만', p.split(B1).length === 2 && p.split(B2).length === 2 && p.split(B3).length === 2);
check('P4 [기존] 수출입 최대 2점·주가 기사 제외·한국어 요약·JSON 형식 그대로', p.includes('기사의 중심이 수출입 금액·물량') && p.includes('주가·증시') && p.includes('summary는 반드시 한국어') && p.includes('"relevanceScore": 관련 있으면 1~5 정수'));

console.log('── C그룹: 로그·시험 함수 ──');
check('C1 수집 로그 끝에 "뉴스 모음 제목 제외: N건"', code.includes("Logger.log('신규 게시된 기사 수: ' + posted + ' / 탈락뉴스 기록: ' + rejectedNewsRows_.length + ' / 뉴스 모음 제목 제외: ' + digestRows_.length);"));
check('C2 isDigestNewsTitle_는 collectMarketNews 2단계 1곳 + 시험 함수에서만 부름', (cm.match(/isDigestNewsTitle_\(/g) || []).length === 1);
check('C3 시험 함수 testDigestTitleScan·testNewsRule1111·testNewsRule1111b는 다른 곳에서 부르지 않음', ['testDigestTitleScan', 'testNewsRule1111', 'testNewsRule1111b'].every(n => (code.match(new RegExp('\\b' + n + '\\(', 'g')) || []).length === 1));
check('C4 TEST1111_REAL_TITLES_ 상수는 A단계 그대로', code.includes("const TEST1111_REAL_TITLES_ = { '알루미늄': '', '철': '' };"));
check('C5 testNewsRule1111b 재현 문구 = 재홍님 캡처 문구 그대로', code.includes("'LME 알루미늄 가격은 6월 고점 대비 19.1% 하락했고, 원화 강세까지 더해져 4분기 연결 영업이익이 240억원으로 흑자전환할 전망이라고 분석했다.'"));
check('C6 testNewsRule1111(A단계 전용)은 운영 지시문에 B단계 문장이 있으면 네이버·AI 호출 전에 멈춤(지시문 두 번 들어가는 것 방지)', (function () {
  const g = { buildSummarizePrompt_: ctx.buildSummarizePrompt_, calls: 0, PropertiesService: { getScriptProperties: function () { g.calls++; return {}; } } };
  vm.runInNewContext(extractFn('testNewsRule1111'), g);
  try { g.testNewsRule1111(); return false; } catch (e) { return String(e.message).indexOf('A단계 전용 시험') >= 0 && g.calls === 0; }
})());
check('C7 testNewsRule1111b 회차 로그에 판정 보조 3가지(흑자전환·롯데칠성·요약 수치)', code.includes("' [흑자전환 ' + (sm.indexOf('흑자') >= 0") && code.includes("' · 롯데칠성 '") && code.includes("' · 요약 수치 '"));
console.log('결과: PASS ' + passes + ' / FAIL ' + failures);
process.exit(failures ? 1 : 0);
