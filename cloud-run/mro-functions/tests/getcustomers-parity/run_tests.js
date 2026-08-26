const { handleGetCustomers_ } = require('./apps_script_ref');
const { getCustomersTestResult_ } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];
function addCase(name, desc, { user, rows }) {
  cases.push({ name, desc, user, rows });
}

// ---- 1: 팀장이 아니면 FORBIDDEN(담당/일반/임원 모두) ----
addCase('1', "role='담당' -> FORBIDDEN(팀장만 허용)", {
  user: { email: 'dept@nkmro.com', role: '담당' },
  rows: [['C-1', '고객A', '담당자A']]
});

// ---- 2: 정상 목록 조회 ----
addCase('2', '팀장 정상 조회 -> 전체 고객사 목록', {
  user: { email: 'lead@nkmro.com', role: '팀장' },
  rows: [
    ['C-1', '고객A', '담당자A'],
    ['C-2', '고객B', '담당자B']
  ]
});

// ---- 3: name(B열)이 빈 값인 행 제외 ----
addCase('3', 'B열(name)이 빈 값인 행은 제외', {
  user: { email: 'lead@nkmro.com', role: '팀장' },
  rows: [
    ['C-1', '', '담당자A'],
    ['C-2', '고객B', '담당자B']
  ]
});

// ---- 4: code(A열)가 빈 값이어도 name만 있으면 포함(제외 기준이 B열이지 A열이 아님을 확인) ----
addCase('4', 'A열(code)이 빈 값이어도 B열(name)만 있으면 포함됨(제외 기준은 A열이 아니라 B열)', {
  user: { email: 'lead@nkmro.com', role: '팀장' },
  rows: [
    ['', '고객A', '담당자A']
  ]
});

// ---- 5: manager(C열)가 비어 있어도 그대로 undefined로 유지(기본값 채우지 않음) ----
addCase('5', 'C열(manager)이 없는 행 -> manager는 undefined 그대로(기본값 없음)', {
  user: { email: 'lead@nkmro.com', role: '팀장' },
  rows: [
    ['C-1', '고객A']
  ]
});

// ---- 6: 고객사 행이 하나도 없음 ----
addCase('6', '고객사 행이 하나도 없음 -> 빈 배열', {
  user: { email: 'lead@nkmro.com', role: '팀장' },
  rows: []
});

const results = [];
for (const c of cases) {
  const appsScriptResult = handleGetCustomers_(c.user, c.rows);
  const cloudRunResult = getCustomersTestResult_(c.user, c.rows);
  const same = deepEqual(appsScriptResult, cloudRunResult);
  results.push({ name: c.name, desc: c.desc, input: c, appsScriptResult, cloudRunResult, same });
}

console.log(JSON.stringify(results, null, 2));

const allSame = results.every(r => r.same);
console.error('\n=== SUMMARY ===');
for (const r of results) {
  console.error(`case ${r.name}: ${r.same ? 'MATCH' : 'MISMATCH'}`);
}
console.error(allSame ? `ALL ${cases.length} CASES MATCH` : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
