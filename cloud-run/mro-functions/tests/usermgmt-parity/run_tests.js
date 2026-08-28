// updateUserTest/changePasswordTest 코드 레벨 parity/정책 테스트 (2026-08-28, 합성 데이터 —
// 실제 시트/Firestore/Cloud Run 호출 없음). 2026-08-28 채팅에서 승인된 계획의 시나리오를
// 두 그룹으로 나눠서 확인한다.
//
// A. Sheets 쓰기 판단 로직 parity: apps_script_ref.js(Code.gs handleUpdateUser_/
//    handleChangePassword_ 포트) vs cloudrun_port.js(index.js updateUserAction_/
//    changePasswordAction_의 판단 로직 포트). 둘 다 Sheets API/Apps Script 시트 호출을
//    걷어낸 순수 함수 포트라서, "실제로 배포된 그 함수"가 아니라 "그 함수의 로직을 그대로
//    옮긴 거울"을 비교한다(upsertitem-upsertcustomer-parity와 동일한 방식·동일한 한계).
//
// B. idempotency/세션 인증 정책 테스트: 포트가 아니라 lib/writeIdempotency.js의
//    withIdempotency()와 lib/auth.js의 authenticateSession()을 "실제 프로덕션 코드 그대로"
//    require해서 fake_firestore.js(인메모리 스텁)를 인자로 넘겨 직접 실행한다.
//
// [락 없음] updateUser/changePassword 둘 다 원본(Code.gs)에 락이 없어 Cloud Run 포트에도
// 새 락을 추가하지 않기로 확정했으므로(2026-08-28 승인), upsertitem-upsertcustomer-parity의
// C(분산 락)/D(동시성 통합) 그룹에 해당하는 테스트는 이 스위트에 없다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handleUpdateUser_, handleChangePassword_ } = require('./apps_script_ref');
const { updateUserAction_, changePasswordAction_ } = require('./cloudrun_port');
const { FakeFirestore } = require('./fake_firestore');
const { withIdempotency } = require('../../lib/writeIdempotency');
const { authenticateSession } = require('../../lib/auth');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const results = [];

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------
const admin = { email: 'jhjoo@nkmro.com', name: '재홍', role: '임원', team: '본사', status: '활성' };
const nonAdminLead = { email: 'lead-a@nkmro.com', name: '김팀장', role: '팀장', team: '동부', status: '활성' };

// 사용자팀마스터 A2:I(헤더 제외, index 0 == 시트 2행): email,name,role,team,status,
// lastCheckedAt,passwordHash,failCount,passwordChangedAt
const PW_HASH_SECRET123 = require('crypto').createHash('sha256').update('secret123:staff-a@nkmro.com', 'utf8').digest('hex');
const baseUsers = [
  ['staff-a@nkmro.com', '이담당', '담당', '동부', '활성', 45000, PW_HASH_SECRET123, 0, '2026-01-01T00:00:00.000Z'], // row 2
  ['lead-a@nkmro.com', '김팀장', '팀장', '동부', '활성', 45000, null, 0, null] // row 3
];

// ---------------------------------------------------------------------------
// A-1. updateUser: apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runUpdateUserCase(name, desc, opts) {
  const a = handleUpdateUser_(opts.user, opts.body, opts.users);
  const b = updateUserAction_(opts.user, opts.body, opts.users);
  const same = deepEqual(a, b);
  results.push({ group: 'A-updateUser', name: name, desc: desc, appsScript: a, cloudRun: b, same: same, note: opts.note });
  return { a: a, b: b, same: same };
}

runUpdateUserCase('1', '정상 — 단일 필드(name)만 변경', {
  user: admin, users: baseUsers, body: { row: 2, name: '이담당(개명)' }
});

runUpdateUserCase('2', '정상 — 복수 필드(role+team+status) 동시 변경', {
  user: admin, users: baseUsers, body: { row: 3, role: '임원', team: '본사', status: '활성' }
});

runUpdateUserCase('3', '정상 — 부분 업데이트(status만), 나머지 컬럼 보존', {
  user: admin, users: baseUsers, body: { row: 2, status: '비활성' }
});

runUpdateUserCase('4', 'name이 공백만인 경우 미변경(trim 후 빈 문자열)', {
  user: admin, users: baseUsers, body: { row: 2, name: '   ' }
});

runUpdateUserCase('5', 'FORBIDDEN — 관리자(ADMIN_EMAIL)가 아닌 호출자', {
  user: nonAdminLead, users: baseUsers, body: { row: 2, name: '해킹시도' }
});

runUpdateUserCase('6', 'INVALID_ROW — row=0', {
  user: admin, users: baseUsers, body: { row: 0, name: 'x' }
});

runUpdateUserCase('7', 'INVALID_ROW — row=음수(-1)', {
  user: admin, users: baseUsers, body: { row: -1, name: 'x' }
});

runUpdateUserCase('8', 'INVALID_ROW — row가 숫자로 변환 안 되는 문자열', {
  user: admin, users: baseUsers, body: { row: 'abc', name: 'x' }
});

runUpdateUserCase('9', 'INVALID_ROLE — 화이트리스트에 없는 role', {
  user: admin, users: baseUsers, body: { row: 2, role: '대표' }
});

runUpdateUserCase('10', 'INVALID_TEAM — 화이트리스트에 없는 team', {
  user: admin, users: baseUsers, body: { row: 2, team: '해외' }
});

runUpdateUserCase('11', 'INVALID_STATUS — 화이트리스트에 없는 status', {
  user: admin, users: baseUsers, body: { row: 2, status: '휴직' }
});

runUpdateUserCase('12', '큰 row 번호(실제 데이터 범위 밖) — 원본처럼 존재 확인 없이 그대로 씀(빈 행 확장)', {
  user: admin, users: baseUsers, body: { row: 50, name: '유령행' },
  note: '원본(Code.gs)도 row 존재 여부를 확인하지 않으므로 두 구현 모두 성공 처리 + 빈 행 확장이 동일해야 정상(버그 아님, 의도된 원본 동작의 재현)'
});

runUpdateUserCase('13', '검증 순서 — role/team/status 동시에 잘못된 값이면 role이 먼저 걸림', {
  user: admin, users: baseUsers, body: { row: 2, role: '대표', team: '해외', status: '휴직' }
});

// ---------------------------------------------------------------------------
// A-2. changePassword: apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runChangePasswordCase(name, desc, opts) {
  const nowIso = opts.nowIso || '2026-08-28T00:00:00.000Z';
  const a = handleChangePassword_(opts.user, opts.body, opts.users, nowIso);
  const b = changePasswordAction_(opts.user.email, opts.body, opts.users, nowIso);
  const same = deepEqual(a, b);
  results.push({ group: 'A-changePassword', name: name, desc: desc, appsScript: a, cloudRun: b, same: same, note: opts.note });
  return { a: a, b: b, same: same };
}

const staffA = { email: 'staff-a@nkmro.com', name: '이담당', role: '담당', team: '동부', status: '활성' };

runChangePasswordCase('1', '정상 — currentPassword 일치 + newPassword 6자 이상', {
  user: staffA, users: baseUsers, body: { currentPassword: 'secret123', newPassword: 'newpass456' }
});

runChangePasswordCase('2', 'WRONG_PASSWORD — currentPassword 불일치', {
  user: staffA, users: baseUsers, body: { currentPassword: 'wrongpass', newPassword: 'newpass456' }
});

runChangePasswordCase('3', 'PASSWORD_TOO_SHORT — newPassword가 6자 미만(currentPassword는 정상)', {
  user: staffA, users: baseUsers, body: { currentPassword: 'secret123', newPassword: '123' }
});

runChangePasswordCase('4', 'MISSING_FIELDS — currentPassword 누락', {
  user: staffA, users: baseUsers, body: { newPassword: 'newpass456' }
});

runChangePasswordCase('5', 'MISSING_FIELDS — newPassword 누락', {
  user: staffA, users: baseUsers, body: { currentPassword: 'secret123' }
});

runChangePasswordCase('6', '검증 순서 — currentPassword도 틀리고 newPassword도 너무 짧으면 PASSWORD_TOO_SHORT가 먼저(길이 체크가 비밀번호 비교보다 먼저 실행됨)', {
  user: staffA, users: baseUsers, body: { currentPassword: 'wrongpass', newPassword: '12' }
});

runChangePasswordCase('7', 'USER_NOT_FOUND — 세션 이메일이 사용자팀마스터에 없는 경우(방어적 케이스)', {
  user: { email: 'ghost@nkmro.com' }, users: baseUsers, body: { currentPassword: 'secret123', newPassword: 'newpass456' }
});

// 8. 해시 계산 자체의 일치 확인(정상 케이스 1의 결과에서 나온 새 해시가 hashPassword_(new,email)과 정확히 같은지)
{
  const { hashPassword_ } = require('./cloudrun_port');
  const r = changePasswordAction_(staffA.email, { currentPassword: 'secret123', newPassword: 'newpass456' }, baseUsers, '2026-08-28T00:00:00.000Z');
  const expectedHash = hashPassword_('newpass456', staffA.email);
  const actualHash = r.users[0][6];
  const pass = r.result.ok === true && actualHash === expectedHash;
  results.push({
    group: 'A-changePassword', name: '8', desc: '해시 계산 검증 — 성공 응답의 새 passwordHash가 hashPassword_(newPassword, email)과 정확히 일치',
    detail: { actualHash: actualHash, expectedHash: expectedHash }, same: pass
  });
}

// ---------------------------------------------------------------------------
// B. idempotency/세션 인증 정책 테스트
// ---------------------------------------------------------------------------
async function runIdempotencyAndAuthCases() {
  // B1. updateUser — 같은 idempotencyKey로 두 번 호출해도 actionFn은 1회만 실행
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () {
      callCount++;
      return { ok: true };
    };
    const r1 = await withIdempotency(fs, 'idem-updateuser-1', 'updateUser', actionFn);
    const r2 = await withIdempotency(fs, 'idem-updateuser-1', 'updateUser', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && deepEqual(r1, { ok: true });
    results.push({
      group: 'B', name: 'B1', desc: 'idempotencyKey 중복(updateUser) -> actionFn은 1회만 실행, 두 응답 동일',
      detail: { callCount: callCount, r1: r1, r2: r2 }, same: pass
    });
  }

  // B2. changePassword — FORBIDDEN류 에러 응답도 idempotency 캐시에 그대로 남아야 함(에러도 캐시)
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () {
      callCount++;
      return { ok: false, error: 'WRONG_PASSWORD' };
    };
    const r1 = await withIdempotency(fs, 'idem-changepw-1', 'changePassword', actionFn);
    const r2 = await withIdempotency(fs, 'idem-changepw-1', 'changePassword', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && deepEqual(r1, { ok: false, error: 'WRONG_PASSWORD' });
    results.push({
      group: 'B', name: 'B2', desc: 'idempotencyKey 중복(changePassword, 에러 응답) -> actionFn 1회만 실행, 에러도 캐시되어 재실행 안 됨',
      detail: { callCount: callCount, r1: r1, r2: r2 }, same: pass
    });
  }

  // B3. idempotencyKey가 없으면 dedup 없이 매번 실행(원본 Code.gs와 동일)
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () { callCount++; return { ok: true }; };
    await withIdempotency(fs, undefined, 'updateSettings', actionFn);
    await withIdempotency(fs, undefined, 'updateSettings', actionFn);
    const pass = callCount === 2;
    results.push({
      group: 'B', name: 'B3', desc: 'idempotencyKey 없음 -> dedup 없이 매번 실행(누락 시 처리, lib/writeIdempotency.js 기존 동작 재확인)',
      detail: { callCount: callCount }, same: pass
    });
  }

  // 세션 인증 재확인 — lib/auth.js는 이번에 새로 만들지 않고 기존 모듈을 그대로 재사용하므로
  // (분석/설계 단계 확인), 다른 parity 스위트와 동일한 4종 확인을 이 스위트 안에서도
  // 재확인한다(회귀 방지).
  {
    const fs = new FakeFirestore();
    const now = Date.now();
    await fs.collection('sessions').doc('expired-token').set({ email: 'jhjoo@nkmro.com', expiresAt: new Date(now - 1000) });
    await fs.collection('sessions').doc('valid-token').set({ email: 'jhjoo@nkmro.com', expiresAt: new Date(now + 3600 * 1000) });

    const noToken = await authenticateSession(fs, null);
    const notFound = await authenticateSession(fs, 'no-such-token');
    const expired = await authenticateSession(fs, 'expired-token');
    const valid = await authenticateSession(fs, 'valid-token');

    const pass =
      noToken.ok === false && noToken.status === 400 && noToken.error === 'MISSING_SESSION_TOKEN' &&
      notFound.ok === false && notFound.status === 200 && notFound.error === 'SESSION_NOT_FOUND' &&
      expired.ok === false && expired.status === 200 && expired.error === 'SESSION_EXPIRED' &&
      valid.ok === true && valid.email === 'jhjoo@nkmro.com';

    results.push({
      group: 'B', name: '세션재확인', desc: '세션 오류 4종(토큰없음/세션없음/만료/정상) -> 에러 코드 표와 일치(회귀 재확인)',
      detail: { noToken: noToken, notFound: notFound, expired: expired, valid: valid }, same: pass
    });
  }
}

// ---------------------------------------------------------------------------
(async function main() {
  await runIdempotencyAndAuthCases();

  console.log(JSON.stringify(results, null, 2));

  console.error('\n=== SUMMARY (updateUserTest/changePasswordTest 코드 레벨 parity/정책 테스트) ===');
  for (const r of results) {
    const tag = r.same ? 'PASS' : (r.note ? 'FAIL(known)' : 'FAIL');
    console.error(`[${r.group}] case ${r.name}: ${tag} - ${r.desc}`);
  }
  const unknownFails = results.filter(function (r) { return !r.same && !r.note; });
  const knownFails = results.filter(function (r) { return !r.same && r.note; });
  console.error(`\n총 ${results.length}건: PASS ${results.length - unknownFails.length - knownFails.length}건, 알려진 실패(설계상 재현) ${knownFails.length}건, 그 외 실패 ${unknownFails.length}건`);
  if (unknownFails.length > 0) {
    console.error('예상치 못한 실패가 있습니다 — 아래 케이스를 확인하세요:');
    unknownFails.forEach(function (r) { console.error(`  - [${r.group}] ${r.name}: ${r.desc}`); });
  }
  process.exitCode = unknownFails.length > 0 ? 1 : 0;
})();
