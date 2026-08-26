const { handleGetItems_ } = require('./apps_script_ref');
const { getItemsTestResult_ } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];
function addCase(name, desc, { user, rows, settings }) {
  cases.push({ name, desc, user, rows, settings: settings || {} });
}

// ---- 1: 역할이 일반 -> FORBIDDEN ----
addCase('1', "role='일반' -> FORBIDDEN(팀장/담당만 허용)", {
  user: { email: 'x@nkmro.com', role: '일반', team: '동부' },
  rows: [['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성']]
});

// ---- 2: 담당, admin 아님, 자기 팀만 보임 ----
addCase('2', "role='담당'(admin 아님) -> 자기 팀(동부) 항목만, 다른 팀(서부) 제외", {
  user: { email: 'dept@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ]
});

// ---- 3: 담당인데 email이 ADMIN_EMAIL -> 1차 필터는 건너뛰지만 2차 재필터가 다시 자기 팀으로 좁힘 ----
addCase('3', "role='담당'이면서 admin 이메일 -> 1차 필터(isAdmin) 건너뜀 + 2차 재필터가 다시 자기 팀으로 좁힌 결과는 자기 팀만", {
  user: { email: 'jhjoo@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ]
});

// ---- 4: 팀장, admin 아님, 팀장_열람범위='전체' -> 1차 필터가 이미 자기 팀으로 좁혀놓서 scope와 무관하게 자기 팀만 ----
addCase('4', "role='팀장'(admin 아님), 팀장_열람범위='전체' -> 1차 필터에서 이미 자기 팀만 남아 scope와 무관하게 자기 팀만", {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ],
  settings: { '팀장_열람범위': '전체' }
});

// ---- 5: 팀장, admin O, 팀장_열람범위='전체' -> 전체 팀 다 보임(핵심 케이스) ----
addCase('5', "role='팀장' + admin 이메일, 팀장_열람범위='전체' -> 1차/2차 필터 둘 다 건너뛰어 모든 팀이 보임", {
  user: { email: 'jhjoo@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ],
  settings: { '팀장_열람범위': '전체' }
});

// ---- 6: 팀장, admin O, 팀장_열람범위='부분' -> 1차 필터는 건너뛰지만 2차가 다시 자기 팀으로 좁힘 ----
addCase('6', "role='팀장' + admin 이메일, 팀장_열람범위가 '전체'가 아님 -> 1차는 건너뛰지만 2차 재필터로 자기 팀만 남음", {
  user: { email: 'jhjoo@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ],
  settings: { '팀장_열람범위': '부분' }
});

// ---- 7: 팀장_열람범위 설정 자체가 없음(undefined) -> '전체'가 아니므로 자기 팀만 ----
addCase('7', "팀장_열람범위 설정 키 자체가 없음 -> undefined !== '전체' -> 자기 팀만", {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '서부', '원자재B', '활성']
  ],
  settings: {}
});

// ---- 8: itemId(A열)가 빈 값인 행 제외 ----
addCase('8', 'A열(itemId)이 빈 값인 행은 제외', {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['', '고객A', '품목A', '담당자A', '동부', '원자재A', '활성'],
    ['IT-2', '고객B', '품목B', '담당자B', '동부', '원자재B', '활성']
  ],
  settings: { '팀장_열람범위': '전체' }
});

// ---- 9: 팀 이름에 앞뒤 공백 -> 1차 필터(trim 비교)는 통과하지만 2차 재필터(trim 없는 ===)에서 제외됨 ----
// (Code.gs 원본이 실제로 가진 동작 — 겉보기엔 버그 같지만 두 구현이 동일하게 재현해야 패리티)
addCase('9', "시트 팀 값에 앞뒤 공백('동부 ') -> 1차 필터(trim 비교)는 통과하지만 2차 재필터(공백 없는 === 비교)에서 제외됨", {
  user: { email: 'dept@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['IT-1', '고객A', '품목A', '담당자A', '동부 ', '원자재A', '활성']
  ]
});

// ---- 10: itemId가 숫자로 들어온 경우 -> String()으로 변환되어 두 구현 동일 ----
addCase('10', 'A열(itemId)이 숫자값 -> String() 변환 결과가 두 구현 동일해야 함', {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    [12345, '고객A', '품목A', '담당자A', '동부', '원자재A', '활성']
  ],
  settings: { '팀장_열람범위': '전체' }
});

// ---- 11: 데이터 행 자체가 없음 ----
addCase('11', '품목 행이 하나도 없음 -> 빈 배열', {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [],
  settings: { '팀장_열람범위': '전체' }
});

const results = [];
for (const c of cases) {
  const appsScriptResult = handleGetItems_(c.user, c.rows, c.settings);
  const cloudRunResult = getItemsTestResult_(c.user, c.rows, c.settings);
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
