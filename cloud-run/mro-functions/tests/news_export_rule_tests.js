// cloud-run/mro-functions/tests/news_export_rule_tests.js
// 2026-10-23 시황 뉴스 수출입 기준 — apps-script/Code.gs의 buildSummarizePrompt_를 그대로 잘라 실행(네트워크 0건, AI 호출 없음).
//   P: 새 기준 3문장(수출입 통계만→관련 없음, 수출입 중심·가격 수치 없음→최대 2점, 나라 밝히기)이 지시문에 들어갔는지
//   K: 기존 기준 문장이 그대로인지(바뀐 줄 0)
//   T: 수동 시험 함수 testExportNewsRule가 있고 트리거·다른 함수에서 부르지 않는지
// 실행: (cloud-run/mro-functions 폴더에서) node tests/news_export_rule_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
let passes = 0, failures = 0;
function check(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (cond) passes++; else failures++; }
function extractFn(name) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(/\nfunction [\w$]+\s*\(|\n\/\*\*/);
  return rest.slice(0, m + 1);
}
const ctx = {};
vm.runInNewContext(extractFn('buildSummarizePrompt_'), ctx);
const p = ctx.buildSummarizePrompt_('프로필렌', '제목', '본문');
const pDup = ctx.buildSummarizePrompt_('PP', '제목', '본문', { title: '기존 제목', summary: '기존 요약' });

console.log('── P: 새 기준 ──');
check('P1 수출입 통계만 → 관련 없음', p.indexOf('수출액·수입액·수출량·수입량 같은 수출입 통계만 있고, 그 변화가 [프로필렌]의 가격(오름·내림)이나 공급 부족·과잉에 미친 영향이 기사에 없으면 관련 없음으로 판단해.') >= 0);
check('P2 수출입 숫자는 가격·공급과 연결될 때만 시황 수치', p.indexOf('수출입 숫자는 [프로필렌]의 가격이나 공급 부족·과잉과 연결해 설명될 때만 시황 수치로 인정해.') >= 0);
check('P3 수출입 중심·가격 수치 없음 → 최대 2점', p.indexOf('[프로필렌]의 가격 변화 수치(오름·내림 금액이나 %)가 없으면') >= 0 && p.indexOf('relevanceScore는 최대 2로 줘') >= 0);
check('P4 가격 수치·수출입 단가는 제한 제외', p.indexOf('수출입 단가(가격)의 오름·내림을 다루면 이 제한에 해당하지 않아.') >= 0);
check('P5 나라 밝히기', p.indexOf('기사의 수치가 어느 나라(예: 중국, 미국) 통계인지 기사에 적혀 있으면 요약에도 그 나라를 반드시 밝혀. 다른 나라의 수출입·생산 통계를 우리나라 수치처럼 쓰지 마.') >= 0);
check('P6 원자재 이름이 들어감(다른 원자재)', ctx.buildSummarizePrompt_('구리', 't', 'd').indexOf('[구리]의 가격(오름·내림)이나 공급 부족·과잉') >= 0);
check('P7 순서: 새 기준이 JSON 형식 안내·본문보다 앞', p.indexOf('최대 2로 줘') < p.indexOf('반드시 아래 JSON 형식') && p.indexOf('반드시 그 나라를') < p.indexOf('[제목]'));
check('P8 중복 참고 문단은 그대로 붙음', pDup.indexOf('[이미 게시된 유사 기사 제목] 기존 제목') >= 0 && pDup.indexOf('최대 2로 줘') >= 0);

console.log('── K: 기존 기준 그대로 ──');
const keep = [
  '아래 기사가 산업 원자재 [프로필렌]의 실제 가격/시황과 관련이 있는지 먼저 판단해.',
  '기사 안에 [프로필렌]의 가격, 수급, 물량, 생산량, 수출입 등 시황과 관련된 구체적인 숫자나 퍼센트(%)가 없으면 관련 없음으로 판단해.',
  '기술·비교 기사(예: ○배 저렴하다, ○배 가볍다, ○배 오래간다)에 나오는 비교 수치는 시황 수치가 아니야.',
  '요약에 \'시황 수치가 없다\'',
  '반드시 [프로필렌] 바로 옆에 명시된 숫자와 방향(상승/하락/%)만 근거로 판단하고',
  '1(약함)~5(매우 강함) 정수로 평가해 relevanceScore에 담고, 관련 없으면 relevanceScore는 0으로 둬.',
  'summary는 반드시 한국어(한글)로만 작성해.',
  '{"relevant": true 또는 false, "summary": "요약 또는 빈 문자열", "relevanceScore": 관련 있으면 1~5 정수, 관련 없으면 0}'
];
keep.forEach(function (k, i) { check('K' + (i + 1) + ' ' + k.slice(0, 24), p.indexOf(k) >= 0); });

console.log('── T: 수동 시험 함수 ──');
check('T1 testExportNewsRule 있음', code.indexOf('\nfunction testExportNewsRule() {') >= 0);
check('T2 다른 곳에서 부르지 않음(정의 1번만)', (code.match(/testExportNewsRule/g) || []).length === 1);
check('T3 트리거 등록 대상 아님', !/newTrigger\('testExportNewsRule'\)/.test(code));
check('T4 백업 함수 runDailyBackup_·dailyBackupCheck_ 그대로 존재', code.indexOf('\nfunction runDailyBackup_(') >= 0 && code.indexOf('\nfunction dailyBackupCheck_(') >= 0);

console.log('\n결과: PASS ' + passes + ' / FAIL ' + failures);
if (failures) process.exit(1);
