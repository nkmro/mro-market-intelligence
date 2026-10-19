// cloud-run/mro-functions/tests/news_quality_tests.js
// 시황 뉴스 품질 개선(2026-10-19) 가짜 데이터 시험 — apps-script/Code.gs의 해당 함수를 그대로 잘라 실행(네트워크 0건).
//   P그룹: AI 지시문(buildSummarizePrompt_)에 새 기준 2문장이 들어갔는지, 기존 문장은 그대로인지
//   M그룹: 요약 자기모순 감지(isSelfContradictorySummary_) — 10/19 시트 실제 요약으로 확인
//   R그룹: parseSummarizeResult_ — 모순이면 관련 없음(재시도 안 함, contradiction 표시), 기존 처리 그대로
//   S그룹: 최저 점수(readMinPostScore_ · splitByMinPostScore_)
//   C그룹: collectMarketNews가 '점수미달'·'자기모순'을 탈락뉴스에 남기는지(코드 확인)
// 실행: (cloud-run/mro-functions 폴더에서) node tests/news_quality_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');

let passes = 0, failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 500)));
  if (cond) passes++; else failures++;
}
function extractFn(name) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(/\nfunction [\w$]+\s*\(|\n\/\*\*/);
  return rest.slice(0, m + 1);
}
const errors = [];
const ctx = { console: { error: m => errors.push(String(m)), log: () => {} }, JSON, Number, String, Math, isFinite };
vm.runInNewContext(['buildSummarizePrompt_', 'parseSummarizeResult_', 'isSelfContradictorySummary_', 'isSummaryLanguageSafe_',
  'readMinPostScore_', 'splitByMinPostScore_'].map(extractFn).join('\n'), ctx);

console.log('── P그룹: AI 지시문 ──');
const pr = ctx.buildSummarizePrompt_('철', '제목', '본문');
check('P1 비교 수치(○배 저렴 등)는 시황 수치가 아니라는 문장 포함', pr.includes('비교 수치는 시황 수치가 아니야') && pr.includes('○배 저렴하다'));
check('P2 "수치가 없다고 쓰면서 relevant를 true로 답하지 마" 문장 포함', pr.includes('relevant는 반드시 false') && pr.includes('수치가 없다고 쓰면서 relevant를 true로 답하지 마'));
check('P3 기존 핵심 문장(숫자·% 없으면 관련 없음, 주가 기사 제외, 한국어 요약, JSON 형식)은 그대로', pr.includes('구체적인 숫자나 퍼센트(%)가 없으면 관련 없음으로 판단해') && pr.includes('주가·증시') && pr.includes('summary는 반드시 한국어') && pr.includes('"relevanceScore": 관련 있으면 1~5 정수'));
check('P4 원자재 이름이 새 문장에도 들어감([철])', (pr.match(/\[철\]/g) || []).length >= 8);

console.log('── M그룹: 자기모순 감지 (10/19 시트 실제 요약) ──');
const f = ctx.isSelfContradictorySummary_;
const real = {
  철: '철 흐름전지 기술 기사에서 철 원료 가격이 리튬보다 약 80배 낮다는 비교가 제시됐다. 다만 철의 가격 등락이나 수급·물량 동향을 직접 보여주는 시황 수치는 없다.',
  황: '호르무즈 해협 인접국이 유황 수출의 약 50%를 담당한다는 점이 언급되며, 해협 통항 차질 시 유황 공급 리스크가 부각될 수 있다는 내용이다. 다만 유황 가격이나 물량의 구체적 증감 수치는 제시되지 않았다.',
  펄프: '기사는 펄프를 약 93% 수입한다는 수입 의존 구조를 언급했다. 다만 펄프 자체의 가격 등락이나 수급 변화를 나타내는 구체적 수치는 제시되지 않았다.',
  알루미늄: '런던금속거래소에서 알루미늄 가격이 0.5% 하락했다. 중동산 관련 언급이 있으나 구체적인 수급 수치는 제시되지 않았다.'
};
check('M1 [실제] 철 흐름전지 요약 → 모순', f(real.철) === true);
check('M2 [실제] 황 요약(50% 담당 + 증감 수치 제시 안 됨) → 모순', f(real.황) === true);
check('M3 [실제] 펄프 요약(93% 수입 + 수치 제시 안 됨) → 모순', f(real.펄프) === true);
check('M4 [실제] 알루미늄 요약(가격 0.5% 하락 있음 + 수급 수치는 없음) → 모순 아님(정상 게시)', f(real.알루미늄) === false);
check('M5 정상 요약들 → 모순 아님', [
  '10월 중량A 철스크랩 매입가격이 kg당 335원으로 전월 355원 대비 5.63% 하락했다.',
  '컬러강판 단가가 톤당 952달러에서 730달러로 23.3% 하락했다.',
  '재고 없이 출하가 이어지며 가격이 3% 올랐다.',
  '하락 폭은 크지 않았다. 가격은 1.2% 내렸다.',
  ''
].every(s => f(s) === false));
check('M6 "데이터가 확인되지 않았다"·"숫자는 나오지 않는다"(변화 수치 없음) → 모순', f('시황 데이터가 확인되지 않았다.') && f('관련 숫자는 나오지 않는다.'));
check('M7 다른 문장의 "없다"는 잡지 않음("수치 10% 상승. 재고는 없다")', f('구리 가격 수치가 10% 상승했다. 재고는 없다.') === false);
check('M8 시트 전체(게시물 163건·탈락뉴스 34건, 10/19 확인)에서 걸린 것은 위 3건뿐 — 개수는 브라우저로 확인한 값이라 여기선 표본만 재확인', [real.철, real.황, real.펄프].every(f) && !f(real.알루미늄));

console.log('── R그룹: parseSummarizeResult_ ──');
const P = (o) => ctx.parseSummarizeResult_(JSON.stringify(o), '제목');
let r = P({ relevant: true, summary: real.철, relevanceScore: 2 });
check('R1 모순 → relevant:false, aiFailed:false(재시도 안 함), contradiction:true, 요약·점수는 남김(탈락뉴스 기록용)', r.relevant === false && r.aiFailed === false && r.contradiction === true && r.summary === real.철 && r.relevanceScore === 2, r);
check('R2 모순 시 기록 1줄(console.error)', errors.some(e => e.includes('자기모순')));
r = P({ relevant: true, summary: real.알루미늄, relevanceScore: 3 });
check('R3 정상(알루미늄) → relevant:true 그대로, contradiction 없음', r.relevant === true && !r.contradiction && r.relevanceScore === 3);
r = P({ relevant: false, summary: '', relevanceScore: 0 });
check('R4 관련 없음 → 그대로(모순 검사 안 함)', r.relevant === false && !r.contradiction && r.relevanceScore === null);
r = P({ relevant: true, summary: '国际铜价创历史新高', relevanceScore: 5 });
check('R5 [기존] 중국어 요약 → aiFailed:true(재시도) 그대로', r.aiFailed === true && r.relevant === false);
r = ctx.parseSummarizeResult_('not json', '제목');
check('R6 [기존] 파싱 실패 → aiFailed:true 그대로', r.aiFailed === true);
r = ctx.parseSummarizeResult_('', '제목');
check('R7 [기존] 응답 없음 → aiFailed:true 그대로', r.aiFailed === true);
r = P({ relevant: true, summary: '구리 가격이 3% 상승했다.', relevanceScore: 9 });
check('R8 [기존] 점수 범위 밖(9) → null', r.relevant === true && r.relevanceScore === null);

console.log('── S그룹: 최저 점수 ──');
const rd = ctx.readMinPostScore_;
check('S1 설정 없음·빈칸·글자 → 3', rd(undefined) === 3 && rd('') === 3 && rd('  ') === 3 && rd('abc') === 3);
check('S2 정상 값 1~5 그대로(숫자·문자 모두)', [1, 2, 3, 4, 5].every(n => rd(n) === n && rd(String(n)) === n));
check('S3 범위 밖은 1~5로(0→1, -2→1, 7→5), 소수는 버림(3.9→3)', rd(0) === 1 && rd(-2) === 1 && rd(7) === 5 && rd(3.9) === 3);
const g = (sc) => ({ c: { title: 't' + sc }, result: { relevanceScore: sc } });
let sp = ctx.splitByMinPostScore_([g(5), g(3), g(2), g(null), g(1)], 3);
check('S4 최소 3: 5·3·null 통과(순서 유지), 2·1 미달', JSON.stringify(sp.pass.map(x => x.result.relevanceScore)) === '[5,3,null]' && JSON.stringify(sp.below.map(x => x.result.relevanceScore)) === '[2,1]', sp);
sp = ctx.splitByMinPostScore_([g(1), g(2)], 1);
check('S5 최소 1 → 전부 통과(사실상 끄기)', sp.pass.length === 2 && sp.below.length === 0);
sp = ctx.splitByMinPostScore_([g(4)], 5);
check('S6 최소 5 → 5점만 통과', sp.pass.length === 0 && sp.below.length === 1);
sp = ctx.splitByMinPostScore_([g(null)], 5);
check('S7 점수 없음(null)은 최소 5여도 통과(AI가 점수를 빠뜨린 경우 예전처럼 게시)', sp.pass.length === 1);

console.log('── C그룹: collectMarketNews 연결 ──');
const cm = code.slice(code.indexOf('\nfunction collectMarketNews('), code.indexOf('\nfunction collectMarketNews(') + 30000);
check('C1 getSettings_가 minPostScore를 돌려줌(readMinPostScore_(map[\'시황게시최소점수\']))', code.includes("readMinPostScore_(map['시황게시최소점수'])") && /newsBlackoutPeriods, minPostScore \}/.test(code));
check('C2 원자재별로 정렬 후 splitByMinPostScore_(…, settings.minPostScore) → 통과한 것만 순위·출력 건수 적용', cm.includes('splitByMinPostScore_(allGroup_, settings.minPostScore)') && cm.includes('const group = scoreSplit_.pass;') && cm.indexOf('allGroup_.sort(compareByRelevanceThenDate_)') < cm.indexOf('splitByMinPostScore_('));
check('C3 미달 후보는 탈락뉴스 사유 \'점수미달\' + 점수 기록', /rejectedNewsRows_\.push\(\[rejectedAt_, c\.code, c\.korean, c\.title, result\.summary, result\.relevanceScore, [^\]]*'점수미달'/.test(cm));
check('C4 자기모순 후보는 탈락뉴스 사유 \'자기모순\'으로 기록(9칸 형식 유지)', cm.includes("if (result.contradiction) {") && /'자기모순', ''\]\)/.test(cm));
check('C5 [기존] 순위밀림·유사게시물스킵 기록은 그대로', cm.includes("'순위밀림'") && cm.includes("'유사게시물스킵'"));

console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
process.exitCode = failures ? 1 : 0;
