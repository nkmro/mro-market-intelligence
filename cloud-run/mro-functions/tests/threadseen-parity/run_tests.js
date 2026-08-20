const { getThreadSeenMap_ } = require('./apps_script_ref');
const { getThreadSeenTestSeenMap_ } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];
function addCase(name, desc, { email, rows }) {
  cases.push({ name, desc, email, rows });
}

// ---- 1: 기본 매칭 — 여러 사용자 행이 섞여 있을 때 본인 것만 걸러지는지 ----
addCase('1', '사용자 A 2건 + 사용자 B 1건 혼재 -> A로 조회하면 A의 2건만 반환', {
  email: 'a@nkmro.com',
  rows: [
    ['a@nkmro.com', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z'],
    ['b@nkmro.com', 'P1', 'IT-2', '2026-08-19T01:05:00.000Z'],
    ['a@nkmro.com', 'P2', 'IT-3', '2026-08-19T02:00:00.000Z']
  ]
});

// ---- 2: 이메일 대소문자 다름(시트엔 대문자) -> 소문자 조회에도 매칭돼야 함 ----
addCase('2', '시트엔 대문자 이메일, 조회는 소문자 -> 대소문자 무시하고 매칭', {
  email: 'a@nkmro.com',
  rows: [
    ['A@NKMRO.COM', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z']
  ]
});

// ---- 3: 일치하는 행이 하나도 없음 -> 빈 맵 ----
addCase('3', '일치하는 이메일 행이 없음 -> 빈 맵', {
  email: 'nobody@nkmro.com',
  rows: [
    ['a@nkmro.com', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z']
  ]
});

// ---- 4: 데이터 행 자체가 없음(빈 시트) -> 빈 맵 ----
addCase('4', '데이터 행 없음(빈 시트) -> 빈 맵', {
  email: 'a@nkmro.com',
  rows: []
});

// ---- 5: 같은 postId-itemId 키가 중복으로 여러 행에 등장 -> 마지막 값으로 덮어써짐 ----
// (정상 흐름에서는 markThreadSeen이 upsert라 안 생기지만, 방어적으로 두 구현이 같은 순서로
//  덮어쓰는지 확인 — 둘 다 앞에서부터 순서대로 forEach/for로 돌며 같은 키를 마지막에 다시 쓰면
//  마지막 값이 남아야 한다.)
addCase('5', '같은 postId-itemId 키가 두 번 등장 -> 나중 행의 확인시각으로 덮어써짐', {
  email: 'a@nkmro.com',
  rows: [
    ['a@nkmro.com', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z'],
    ['a@nkmro.com', 'P1', 'IT-1', '2026-08-19T03:00:00.000Z']
  ]
});

// ---- 6: postId/itemId가 숫자로 들어온 경우(문자열 결합 결과가 동일한지) ----
addCase('6', 'postId/itemId가 숫자값 -> 문자열 결합(키) 결과가 두 구현 동일해야 함', {
  email: 'a@nkmro.com',
  rows: [
    ['a@nkmro.com', 1001, 2002, '2026-08-19T01:00:00.000Z']
  ]
});

// ---- 7: 이메일 필드에 앞뒤 공백 -> 원본이 trim()을 안 하므로 매칭 실패해야 정상(parity 확인용) ----
addCase('7', '시트 이메일에 앞뒤 공백 -> 원본처럼 trim 없이 비교하면 매칭 안 돼야 함(두 구현 동일하게 실패)', {
  email: 'a@nkmro.com',
  rows: [
    [' a@nkmro.com ', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z']
  ]
});

const results = [];
for (const c of cases) {
  const appsScriptResult = getThreadSeenMap_(c.email, c.rows);
  const cloudRunResult = getThreadSeenTestSeenMap_(c.email, c.rows);
  const same = deepEqual(appsScriptResult, cloudRunResult);
  results.push({ name: c.name, desc: c.desc, input: c, appsScriptResult, cloudRunResult, same });
}

console.log(JSON.stringify(results, null, 2));

const allSame = results.every(r => r.same);
console.error('\n=== SUMMARY ===');
for (const r of results) {
  console.error(`case ${r.name}: ${r.same ? 'MATCH' : 'MISMATCH'}`);
}
console.error(allSame ? 'ALL 7 CASES MATCH' : 'SOME CASES MISMATCH');
process.exitCode = allSame ? 0 : 1;
