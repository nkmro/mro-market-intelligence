// markThreadSeenTest 코드 레벨 로직 parity 테스트 (2026-08-20, 합성 데이터 — 실제 시트/
// Firestore/Cloud Run 호출 없음). 두 그룹으로 나눠서 확인한다.
//
// A. Sheets upsert 판단 로직 parity (시나리오 1/2/3/6): apps_script_ref.js(Code.gs
//    handleMarkThreadSeen_ 포트) vs cloudrun_port.js(index.js markThreadSeenAction_의
//    판단 로직 포트) — 둘 다 Sheets API/Apps Script 시트 호출을 걷어낸 순수 함수 포트라서,
//    "실제로 배포된 그 함수"가 아니라 "그 함수의 로직을 그대로 옮긴 거울"을 비교한다
//    (tests/threadseen-parity의 기존 방식과 동일한 한계).
//
// B. idempotency/세션 인증 정책 테스트 (시나리오 4/5/7): 이건 포트가 아니라
//    lib/writeIdempotency.js의 withIdempotency()와 lib/auth.js의 authenticateSession()을
//    "실제 프로덕션 코드 그대로" require해서, fake_firestore.js(인메모리 스텁)를 인자로
//    넘겨 직접 실행한다. 두 함수 모두 firestore를 파라미터로 받는 구조라 모킹 없이도
//    실제 코드를 그대로 테스트할 수 있다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handleMarkThreadSeen_ } = require('./apps_script_ref');
const { markThreadSeenAction_ } = require('./cloudrun_port');
const { FakeFirestore } = require('./fake_firestore');
const { withIdempotency } = require('../../lib/writeIdempotency');
const { authenticateSession } = require('../../lib/auth');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

const results = [];

// ---------------------------------------------------------------------------
// A. Sheets upsert 판단 로직 parity — apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runUpsertCase(name, desc, { email, postId, itemId, rows, nowIso }) {
  const a = handleMarkThreadSeen_(email, postId, itemId, rows, nowIso);
  const b = markThreadSeenAction_(email, postId, itemId, rows, nowIso);
  const same = deepEqual(a, b);
  results.push({ group: 'A', name, desc, appsScript: a, cloudRun: b, same });
}

// 1. 신규 행 생성 — 일치하는 행이 없어 새 행이 추가돼야 함
runUpsertCase('1', '신규 행 생성 — 기존 행 없음 -> 두 구현 모두 새 행 append',
  { email: 'a@nkmro.com', postId: 'P1', itemId: 'IT-1', rows: [], nowIso: '2026-08-20T00:00:00.000Z' });

// 2. 기존 행 갱신 — 일치하는 행의 D열(확인시각)만 갱신, 다른 행은 그대로
runUpsertCase('2', '기존 행 갱신 — 일치 행의 확인시각만 갱신, 다른 행 영향 없음', {
  email: 'a@nkmro.com', postId: 'P1', itemId: 'IT-1',
  rows: [
    ['a@nkmro.com', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z'],
    ['b@nkmro.com', 'P2', 'IT-2', '2026-08-19T02:00:00.000Z']
  ],
  nowIso: '2026-08-20T00:00:00.000Z'
});

// 3. 이메일 대소문자 — 시트엔 대문자, 요청은 소문자 -> 대소문자 무시하고 매칭돼서 갱신(append 아님)
runUpsertCase('3', '이메일 대소문자 다름 -> 대소문자 무시 매칭 -> 갱신(신규 append 아님)', {
  email: 'a@nkmro.com', postId: 'P1', itemId: 'IT-1',
  rows: [['A@NKMRO.COM', 'P1', 'IT-1', '2026-08-19T01:00:00.000Z']],
  nowIso: '2026-08-20T00:00:00.000Z'
});

// 6. 필수값 누락 — itemId 없음 -> 두 구현 모두 MISSING_FIELDS, rows 변경 없음
runUpsertCase('6', '필수값 누락(itemId 없음) -> 두 구현 모두 MISSING_FIELDS, rows 변경 없음', {
  email: 'a@nkmro.com', postId: 'P1', itemId: '',
  rows: [['a@nkmro.com', 'P9', 'IT-9', '2026-08-19T01:00:00.000Z']],
  nowIso: '2026-08-20T00:00:00.000Z'
});

// ---------------------------------------------------------------------------
// B. idempotency/세션 인증 — 실제 lib/writeIdempotency.js, lib/auth.js를 그대로 실행
// ---------------------------------------------------------------------------
async function runIdempotencyCases() {
  // 4. idempotencyKey 중복 — 같은 키로 두 번 호출 시, 실제 작업(actionFn)은 한 번만 실행되고
  //    두 번째 호출은 캐시된 응답을 그대로 반환해야 함.
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () { callCount += 1; return { ok: true, calledWith: callCount }; };
    const r1 = await withIdempotency(fs, 'dup-key-1', 'markThreadSeen', actionFn);
    const r2 = await withIdempotency(fs, 'dup-key-1', 'markThreadSeen', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && r1.ok === true;
    results.push({
      group: 'B', name: '4', desc: 'idempotencyKey 중복 -> actionFn은 1회만 실행, 두 응답 동일',
      detail: { callCount, r1, r2 }, same: pass
    });
  }

  // 5-a. IN_PROGRESS 상태에서 짧게 폴링하는 중 DONE으로 바뀌면 그 결과를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('inprogress-key-a');
    await docRef.set({ action: 'markThreadSeen', status: 'IN_PROGRESS', createdAt: new Date() });
    // 700ms 후 다른 프로세스가 완료했다고 가정하고 DONE으로 바꿔둠(폴링 간격 500ms*4=2000ms 안에 들어옴)
    setTimeout(function () { docRef.update({ status: 'DONE', response: { ok: true, from: 'other-process' } }); }, 700);
    const r = await withIdempotency(fs, 'inprogress-key-a', 'markThreadSeen', async function () {
      throw new Error('actionFn이 호출되면 안 됨(이미 다른 프로세스가 선점 중)');
    });
    const pass = deepEqual(r, { ok: true, from: 'other-process' });
    results.push({
      group: 'B', name: '5-a', desc: 'IN_PROGRESS -> 폴링 중 DONE으로 전환 -> 그 응답을 그대로 받음',
      detail: { r }, same: pass
    });
  }

  // 5-b. IN_PROGRESS 상태가 끝까지 안 풀리면 DUPLICATE_IN_PROGRESS_RETRY_LATER를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('inprogress-key-b');
    await docRef.set({ action: 'markThreadSeen', status: 'IN_PROGRESS', createdAt: new Date() });
    const r = await withIdempotency(fs, 'inprogress-key-b', 'markThreadSeen', async function () {
      throw new Error('actionFn이 호출되면 안 됨');
    });
    const pass = deepEqual(r, { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' });
    results.push({
      group: 'B', name: '5-b', desc: 'IN_PROGRESS가 끝까지 안 풀림 -> DUPLICATE_IN_PROGRESS_RETRY_LATER',
      detail: { r }, same: pass
    });
  }

  // 7. 세션 오류 — authenticateSession(lib/auth.js, 실제 코드)을 fake_firestore로 직접 실행
  {
    const fs = new FakeFirestore();
    const now = Date.now();
    await fs.collection('sessions').doc('expired-token').set({ email: 'a@nkmro.com', expiresAt: new Date(now - 1000) });
    await fs.collection('sessions').doc('valid-token').set({ email: 'a@nkmro.com', expiresAt: new Date(now + 3600 * 1000) });

    const noToken = await authenticateSession(fs, null);
    const notFound = await authenticateSession(fs, 'no-such-token');
    const expired = await authenticateSession(fs, 'expired-token');
    const valid = await authenticateSession(fs, 'valid-token');

    const pass =
      noToken.ok === false && noToken.status === 400 && noToken.error === 'MISSING_SESSION_TOKEN' &&
      notFound.ok === false && notFound.status === 200 && notFound.error === 'SESSION_NOT_FOUND' &&
      expired.ok === false && expired.status === 200 && expired.error === 'SESSION_EXPIRED' &&
      valid.ok === true && valid.email === 'a@nkmro.com';

    results.push({
      group: 'B', name: '7', desc: '세션 오류 4종(토큰없음/세션없음/만료/정상) -> 에러 코드 표와 일치',
      detail: { noToken, notFound, expired, valid }, same: pass
    });
  }
}

(async function main() {
  await runIdempotencyCases();

  console.log(JSON.stringify(results, null, 2));

  console.error('\n=== SUMMARY (markThreadSeenTest 코드 레벨 parity/정책 테스트) ===');
  for (const r of results) {
    console.error(`[${r.group}] case ${r.name}: ${r.same ? 'PASS' : 'FAIL'} - ${r.desc}`);
  }
  const allPass = results.every(function (r) { return r.same; });
  console.error(allPass ? '\nALL CASES PASS' : '\nSOME CASES FAIL');
  process.exitCode = allPass ? 0 : 1;
})();
