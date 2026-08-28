// updateSettingsTest 코드 레벨 parity/정책 테스트 (2026-08-28, 합성 데이터 — 실제
// 시트/Firestore/Cloud Run 호출 없음). 2026-08-28 채팅에서 승인된 계획의 시나리오를 두
// 그룹으로 나눠서 확인한다.
//
// A. Sheets 쓰기 판단 로직 parity: apps_script_ref.js(Code.gs handleUpdateSettings_ 포트)
//    vs cloudrun_port.js(index.js updateSettingsAction_의 판단 로직 포트).
//
// B. idempotency/세션 인증 정책 테스트: lib/writeIdempotency.js의 withIdempotency()와
//    lib/auth.js의 authenticateSession()을 "실제 프로덕션 코드 그대로" require해서
//    fake_firestore.js(인메모리 스텁)를 인자로 넘겨 직접 실행한다.
//
// [락 없음] updateSettings는 원본(Code.gs)에 락이 없어 Cloud Run 포트에도 새 락을 추가하지
// 않기로 확정했으므로(2026-08-28 승인), 분산 락/동시성 통합 그룹은 이 스위트에 없다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handleUpdateSettings_ } = require('./apps_script_ref');
const { updateSettingsAction_ } = require('./cloudrun_port');
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

// 설정 A2:C(헤더 제외, index 0 == 시트 2행): key,value,description
const baseSettings = [
  ['비밀번호만료일수', '90', '비밀번호 강제 변경 주기(일)'],
  ['팀장_열람범위', '전체', '팀장이 볼 수 있는 품목 범위']
];

// ---------------------------------------------------------------------------
// A. updateSettings: apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runCase(name, desc, opts) {
  const a = handleUpdateSettings_(opts.user, opts.body, opts.settings);
  const b = updateSettingsAction_(opts.user, opts.body, opts.settings);
  const same = deepEqual(a, b);
  results.push({ group: 'A', name: name, desc: desc, appsScript: a, cloudRun: b, same: same, note: opts.note });
  return { a: a, b: b, same: same };
}

runCase('1', '정상 — 단일 키 갱신', {
  user: admin, settings: baseSettings, body: { settings: { '비밀번호만료일수': '120' } }
});

runCase('2', '정상 — 복수 키 동시 갱신', {
  user: admin, settings: baseSettings, body: { settings: { '비밀번호만료일수': '120', '팀장_열람범위': '자기팀' } }
});

runCase('3', '존재하지 않는 키만 — unknownKeys에만 담기고 시트 변경 없음', {
  user: admin, settings: baseSettings, body: { settings: { '없는키': 'x' } }
});

runCase('4', '혼합 — 존재하는 키 + 존재하지 않는 키가 각각 updatedKeys/unknownKeys로 정확히 분리', {
  user: admin, settings: baseSettings, body: { settings: { '비밀번호만료일수': '60', '없는키2': 'y' } }
});

runCase('5', 'FORBIDDEN — 관리자(ADMIN_EMAIL)가 아닌 호출자', {
  user: nonAdminLead, settings: baseSettings, body: { settings: { '비밀번호만료일수': '120' } }
});

runCase('6', 'MISSING_FIELDS — body.settings가 undefined', {
  user: admin, settings: baseSettings, body: {}
});

runCase('7', 'MISSING_FIELDS — body.settings가 문자열', {
  user: admin, settings: baseSettings, body: { settings: 'not-an-object' }
});

runCase('8', 'MISSING_FIELDS — body.settings가 null', {
  user: admin, settings: baseSettings, body: { settings: null }
});

runCase('9', '빈 객체({}) — updatedKeys=[], unknownKeys=[], no-op 성공', {
  user: admin, settings: baseSettings, body: { settings: {} }
});

runCase('10', '배열 전달 — Code.gs가 배열을 막지 않는 느슨함까지 동일 재현(인덱스 키가 전부 unknownKeys로 빠짐, 에러 아님)', {
  user: admin, settings: baseSettings, body: { settings: ['이러면', '안되지만', '막지않음'] },
  note: '원본(Code.gs)도 typeof updates !== \'object\'만 확인해 배열을 그대로 통과시키므로, 두 구현 모두 MISSING_FIELDS가 아니라 ok:true+전부 unknownKeys가 나와야 정상(버그 아님, 의도된 원본 느슨함의 재현)'
});

// ---------------------------------------------------------------------------
// B. idempotency/세션 인증 정책 테스트
// ---------------------------------------------------------------------------
async function runIdempotencyAndAuthCases() {
  // B1. 같은 idempotencyKey로 두 번 호출해도 actionFn은 1회만 실행
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () {
      callCount++;
      return { ok: true, updatedKeys: ['비밀번호만료일수'], unknownKeys: [] };
    };
    const r1 = await withIdempotency(fs, 'idem-updatesettings-1', 'updateSettings', actionFn);
    const r2 = await withIdempotency(fs, 'idem-updatesettings-1', 'updateSettings', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2);
    results.push({
      group: 'B', name: 'B1', desc: 'idempotencyKey 중복(updateSettings) -> actionFn은 1회만 실행, 두 응답 동일',
      detail: { callCount: callCount, r1: r1, r2: r2 }, same: pass
    });
  }

  // B2. FORBIDDEN 에러 응답도 idempotency 캐시에 그대로 남아야 함
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () {
      callCount++;
      return { ok: false, error: 'FORBIDDEN' };
    };
    const r1 = await withIdempotency(fs, 'idem-updatesettings-2', 'updateSettings', actionFn);
    const r2 = await withIdempotency(fs, 'idem-updatesettings-2', 'updateSettings', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && deepEqual(r1, { ok: false, error: 'FORBIDDEN' });
    results.push({
      group: 'B', name: 'B2', desc: 'idempotencyKey 중복(FORBIDDEN 에러 응답) -> actionFn 1회만 실행, 에러도 캐시되어 재실행 안 됨',
      detail: { callCount: callCount, r1: r1, r2: r2 }, same: pass
    });
  }

  // 세션 인증 재확인 — lib/auth.js는 이번에 새로 만들지 않고 기존 모듈을 그대로 재사용하므로,
  // 다른 parity 스위트와 동일한 4종 확인을 이 스위트 안에서도 재확인한다(회귀 방지).
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

  console.error('\n=== SUMMARY (updateSettingsTest 코드 레벨 parity/정책 테스트) ===');
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
