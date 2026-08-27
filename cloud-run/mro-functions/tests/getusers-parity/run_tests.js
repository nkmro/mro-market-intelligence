const { handleGetUsers_ } = require('./apps_script_ref');
const { getUsersTestResult_ } = require('./cloudrun_port');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const cases = [];
function addCase(name, desc, { user, rows }) {
  cases.push({ name, desc, user, rows });
}

// ---- 1: role='일반', admin 아님 -> FORBIDDEN ----
addCase('1', "role='일반', admin 아님 -> FORBIDDEN", {
  user: { email: 'gen@nkmro.com', role: '일반', team: '동부' },
  rows: [
    ['gen@nkmro.com', '일반사원', '일반', '동부', '활성'],
    ['dept@nkmro.com', '담당자', '담당', '동부', '활성']
  ]
});

// ---- 2: role='임원', admin 아님 -> FORBIDDEN (임원은 자동 승인 대상이 아님) ----
addCase('2', "role='임원', admin 아님 -> FORBIDDEN(임원은 담당/팀장이 아니므로 자동 승인 안 됨)", {
  user: { email: 'exec@nkmro.com', role: '임원', team: '동부' },
  rows: [
    ['exec@nkmro.com', '임원', '임원', '동부', '활성'],
    ['dept@nkmro.com', '담당자', '담당', '동부', '활성']
  ]
});

// ---- 3: role='담당', admin 아님 -> 자기 팀만 ----
addCase('3', "role='담당'(admin 아님) -> 자기 팀(동부)만, 다른 팀(서부) 제외", {
  user: { email: 'dept@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['dept@nkmro.com', '담당자', '담당', '동부', '활성'],
    ['other@nkmro.com', '다른팀원', '일반', '서부', '활성']
  ]
});

// ---- 4: role='팀장', admin 아님 -> 자기 팀만 ----
addCase('4', "role='팀장'(admin 아님) -> 자기 팀(동부)만, 다른 팀(서부) 제외", {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['lead@nkmro.com', '팀장', '팀장', '동부', '활성'],
    ['other@nkmro.com', '다른팀원', '일반', '서부', '활성']
  ]
});

// ---- 5: role='일반'이지만 admin 이메일 -> role 게이트를 우회하고 전체 팀 노출 ----
addCase('5', "role='일반'이지만 이메일이 ADMIN_EMAIL -> FORBIDDEN 아니고 전체 팀 노출", {
  user: { email: 'jhjoo@nkmro.com', role: '일반', team: '동부' },
  rows: [
    ['jhjoo@nkmro.com', '관리자', '일반', '동부', '활성'],
    ['other@nkmro.com', '다른팀원', '일반', '서부', '활성']
  ]
});

// ---- 6: role='담당' + admin 이메일 -> 전체 팀 노출 (getItems와 달리 2차 재필터가 없음) ----
addCase('6', "role='담당' + admin 이메일 -> 전체 팀 노출(getItems와 달리 2차 재필터 없음)", {
  user: { email: 'jhjoo@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['jhjoo@nkmro.com', '관리자', '담당', '동부', '활성'],
    ['other@nkmro.com', '다른팀원', '일반', '서부', '활성']
  ]
});

// ---- 7: 관리자 이메일 대소문자 다름 -> trim+lowercase 비교로 정상 매칭 ----
addCase('7', "관리자 이메일 대소문자 다름(JHJoo@NKMRO.com) -> 정상적으로 admin 판정, 전체 팀 노출", {
  user: { email: 'JHJoo@NKMRO.com', role: '팀장', team: '동부' },
  rows: [
    ['JHJoo@NKMRO.com', '관리자', '팀장', '동부', '활성'],
    ['other@nkmro.com', '다른팀원', '일반', '서부', '활성']
  ]
});

// ---- 8: 이메일(A열) 빈 행 제외 ----
addCase('8', "이메일(A열)이 빈 행은 결과에서 제외", {
  user: { email: 'dept@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['dept@nkmro.com', '담당자', '담당', '동부', '활성'],
    ['', '유령행', '일반', '동부', '활성']
  ]
});

// ---- 9: team 값에 앞뒤 공백 -> 양쪽 다 trim 비교이므로 정상 포함 ----
addCase('9', "team 값에 앞뒤 공백('동부 ') -> trim 비교로 정상 포함(getItems 2차 필터처럼 미trim 배제가 없음)", {
  user: { email: 'dept@nkmro.com', role: '담당', team: '동부' },
  rows: [
    ['dept@nkmro.com', '담당자', '담당', '동부', '활성'],
    ['spaced@nkmro.com', '공백팀원', '일반', '동부 ', '활성']
  ]
});

// ---- 10: 사용자 행이 하나도 없음 -> 빈 배열 ----
addCase('10', "사용자 행이 하나도 없음 -> 빈 배열", {
  user: { email: 'jhjoo@nkmro.com', role: '팀장', team: '동부' },
  rows: []
});

// ---- 11: row 번호 계산 검증 -> 3번째 데이터 행(인덱스 2)의 row가 4(=2+2) ----
addCase('11', "row 번호 계산: 3번째 데이터 행(인덱스 2)의 row 값이 4(=2+2)로 정확히 나오는지", {
  user: { email: 'jhjoo@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['u1@nkmro.com', '사용자1', '일반', '동부', '활성'],
    ['u2@nkmro.com', '사용자2', '일반', '동부', '활성'],
    ['u3@nkmro.com', '사용자3', '일반', '동부', '활성']
  ]
});

// ---- 12: 여러 사용자 중 일부는 자기 팀, 일부는 다른 팀 -> 정확히 필터링, 원본 순서 유지 ----
addCase('12', "자기 팀/다른 팀 섞여 있음 -> 자기 팀만, 원본 행 순서 그대로 유지", {
  user: { email: 'lead@nkmro.com', role: '팀장', team: '동부' },
  rows: [
    ['a@nkmro.com', 'A', '일반', '서부', '활성'],
    ['lead@nkmro.com', '팀장', '팀장', '동부', '활성'],
    ['b@nkmro.com', 'B', '일반', '동부', '활성'],
    ['c@nkmro.com', 'C', '일반', '중부', '활성'],
    ['d@nkmro.com', 'D', '일반', '동부', '비활성']
  ]
});

const results = [];
let matchCount = 0;
for (const c of cases) {
  const asResult = handleGetUsers_(c.user, c.rows);
  const crResult = getUsersTestResult_(c.user, c.rows);
  const match = deepEqual(asResult, crResult);
  if (match) matchCount++;
  results.push({
    name: c.name,
    desc: c.desc,
    input: { user: c.user, rows: c.rows },
    appsScriptResult: asResult,
    cloudRunResult: crResult,
    match: match
  });
  console.log(`[${match ? 'MATCH' : 'MISMATCH'}] #${c.name}: ${c.desc}`);
  if (!match) {
    console.log('  apps-script:', JSON.stringify(asResult));
    console.log('  cloud-run  :', JSON.stringify(crResult));
  }
}

console.log(`\n${matchCount}/${cases.length} MATCH`);

const fs = require('fs');
fs.writeFileSync(
  require('path').join(__dirname, 'results.json'),
  JSON.stringify(results, null, 2),
  'utf-8'
);

if (matchCount !== cases.length) {
  process.exitCode = 1;
}
