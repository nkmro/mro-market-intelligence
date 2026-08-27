// upsertItemTest/upsertCustomerTest 코드 레벨 parity/정책 테스트 (2026-08-27, 합성 데이터 —
// 실제 시트/Firestore/Cloud Run 호출 없음). UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md
// 3번(parity 테스트 계획)의 17개 시나리오를 세 그룹으로 나눠서 확인한다.
//
// A. Sheets 쓰기 판단 로직 parity (시나리오 1/2/3/4/4b/5/6/7/8/9/10/11/12/17 + upsertCustomer
//    단독 케이스): apps_script_ref.js(Code.gs handleUpsertItem_/handleUpsertCustomer_ 포트)
//    vs cloudrun_port.js(index.js upsertItemAction_/upsertCustomerAction_의 판단 로직 포트).
//    둘 다 Sheets API/Apps Script 시트 호출·Firestore 락 호출을 걷어낸 순수 함수 포트라서,
//    "실제로 배포된 그 함수"가 아니라 "그 함수의 로직을 그대로 옮긴 거울"을 비교한다
//    (markthreadseen-parity와 동일한 방식·동일한 한계).
//
// B. idempotency/세션 인증 정책 테스트 (시나리오 15/16 + 세션 인증 재확인): 포트가 아니라
//    lib/writeIdempotency.js의 withIdempotency()와 lib/auth.js의 authenticateSession()을
//    "실제 프로덕션 코드 그대로" require해서 fake_firestore.js(인메모리 스텁)를 인자로
//    넘겨 직접 실행한다.
//
// C. 분산 락 정책 테스트(신규, 시나리오 13의 핵심 메커니즘): lib/writeLock.js의
//    acquireLock()/releaseLock()도 실제 프로덕션 코드 그대로 fake_firestore.js에 실행한다.
//
// D. 통합 테스트(시나리오 13/14 완결): C그룹에서 검증한 실제 lib/writeLock.js와 A그룹의
//    cloudrun_port.js(upsertItemAction_ 판단 로직)를 함께, 진짜 Promise.all 동시 실행으로
//    묶어서 "두 요청이 거의 동시에 upsertItem을 호출하면 실제로 무슨 일이 일어나는지"를
//    검증한다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handleUpsertItem_, handleUpsertCustomer_ } = require('./apps_script_ref');
const { upsertItemAction_, upsertCustomerAction_ } = require('./cloudrun_port');
const { FakeFirestore } = require('./fake_firestore');
const { withIdempotency } = require('../../lib/writeIdempotency');
const { authenticateSession } = require('../../lib/auth');
const { acquireLock, releaseLock } = require('../../lib/writeLock');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
function rowsToCustomerObjs(rows) {
  return rows.map(function (r) { return { code: r[0], name: r[1], manager: r[2] }; });
}

const results = [];

// ---------------------------------------------------------------------------
// 공통 픽스처
// ---------------------------------------------------------------------------
const allUsers = [
  { email: 'lead-a@nkmro.com', name: '김팀장', role: '팀장', team: '동부', status: '활성' },
  { email: 'lead-b@nkmro.com', name: '박팀장', role: '팀장', team: '본사', status: '활성' },
  { email: 'staff-a@nkmro.com', name: '이담당', role: '담당', team: '동부', status: '활성' },
  { email: 'staff-b@nkmro.com', name: '최담당', role: '담당', team: '본사', status: '활성' },
  { email: 'staff-c@nkmro.com', name: '정담당', role: '담당', team: '동부', status: '활성' }
];
const viewerLead = allUsers[0];       // 김팀장, 동부
const viewerStaff = allUsers[4];      // 정담당, 동부, role=담당 -> FORBIDDEN 케이스용

const baseCustomers = [['C001', '기존고객사', '이담당']];
const baseItems = [['MP-100', '기존고객사', '기존품목', '이담당', '동부', '원자재A', '활성', 46000]];

// ---------------------------------------------------------------------------
// A. Sheets 쓰기 판단 로직 parity — apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------
function runUpsertItemCase(name, desc, opts) {
  const preLockCustomers = opts.preLockCustomers || opts.customers;
  const freshCustomers = opts.customers;
  const items = opts.items;
  const nowValue = opts.nowValue !== undefined ? opts.nowValue : 47000;

  const a = handleUpsertItem_(opts.viewer, allUsers, opts.body, preLockCustomers, { customers: freshCustomers, items: items }, nowValue);
  const b = upsertItemAction_(opts.viewer, allUsers, rowsToCustomerObjs(preLockCustomers), opts.body, { customers: freshCustomers, items: items }, nowValue);
  const same = deepEqual(a, b);
  results.push({ group: 'A', name: name, desc: desc, appsScript: a, cloudRun: b, same: same, note: opts.note });
  return { a: a, b: b, same: same };
}

function runUpsertCustomerCase(name, desc, opts) {
  const a = handleUpsertCustomer_(opts.viewer, opts.body, { customers: opts.customers });
  const b = upsertCustomerAction_(opts.viewer, opts.body, { customers: opts.customers });
  const same = deepEqual(a, b);
  results.push({ group: 'A', name: name, desc: desc, appsScript: a, cloudRun: b, same: same, note: opts.note });
  return { a: a, b: b, same: same };
}

// --- upsertItem 시나리오 ---

// 1. 정상 등록(신규 품목, 기존 고객사)
runUpsertItemCase('1', '정상 등록 — 신규 품목(materialCode=MP-200), 기존 고객사', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '새품목', manager: '이담당', materials: ['원자재B'], status: '활성', materialCode: 'MP-200' }
});

// 2. 정상 수정(기존 품목) — B~G만 갱신, A(itemId)/H(등록일)는 그대로
runUpsertItemCase('2', '정상 수정 — 기존 품목(MP-100) 내용 변경, 등록일(H) 보존', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { itemId: 'MP-100', customer: '기존고객사', itemName: '수정된품목명', manager: '이담당', materials: ['원자재A', '원자재C'], status: '비활성' }
});

// 3. 정상 등록(신규 품목 + 신규 고객사) — 하나의 락 구간에서 둘 다 성공
runUpsertItemCase('3', '정상 등록 — 신규 품목(MP-300) + 신규 고객사(C002) 동시 생성', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '새고객사', itemName: '새품목2', manager: '이담당', materialCode: 'MP-300', newCustomerCode: 'C002' }
});

// 4. 원자적 롤백(일반 실패 경로) — 신규 고객사는 만들어지지만, 뒤이은 자재코드가 이미 존재해서
//    (MP-100) 품목 등록이 실패 -> 방금 만든 고객사(C003)만 정확히 롤백돼야 함.
runUpsertItemCase('4', '원자적 롤백(일반 실패) — 신규 고객사 생성 후 자재코드 중복으로 품목 등록 실패 -> 고객사 롤백', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '새고객사2', itemName: '품목X', manager: '이담당', materialCode: 'MP-100', newCustomerCode: 'C003' }
});

// 4b. 원자적 롤백(예외 경로, 회귀 확인용) — (2026-08-27 수정 반영) 이전에는 실제 구현
//    (index.js)의 롤백 검사가 try 블록 *안*, catch보다 앞에 있어 예외가 나면 롤백 자체를
//    건너뛰는 버그가 있었다(이 케이스로 최초 발견, same:false였음). Code.gs와 동일하게
//    롤백 검사를 try/catch *바깥*으로 옮기는 수정을 적용한 뒤에는, 이 케이스도 다른
//    시나리오와 마찬가지로 same:true(PASS)가 되어야 한다 — 앞으로 이 케이스가 다시
//    FAIL하면 같은 종류의 회귀가 재발했다는 뜻이다.
runUpsertItemCase('4b', '원자적 롤백(예외 경로, 수정 후 회귀 확인) — 품목 쓰기 중 예외 발생 시에도 고객사가 롤백되는가', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '새고객사3', itemName: '품목Y', manager: '이담당', materialCode: '__SIMULATE_THROW__', newCustomerCode: 'C004' }
});

// 5. 중복 등록 — 자재코드
runUpsertItemCase('5', '중복 등록 — 이미 존재하는 자재코드(MP-100)로 신규 등록 시도', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', manager: '이담당', materialCode: 'MP-100' }
});

// 6. 중복 등록 — 고객사명 (락 안 재확인이 실제로 걸리는지: preLock 스냅샷엔 없지만, 락 안에서
//    다시 읽은 fresh 스냅샷엔 이미 같은 이름의 고객사가 있는 "경합" 상황을 직접 구성)
runUpsertItemCase('6', '중복 등록 — 고객사명(경합: 락 밖 확인 통과 후 락 안 재확인에서 발견)', {
  viewer: viewerLead,
  preLockCustomers: baseCustomers, // '경쟁고객사'가 아직 없다고 보고 통과
  customers: baseCustomers.concat([['C900', '경쟁고객사', '이담당']]), // 그 사이 다른 요청이 만들어 둠
  items: baseItems,
  body: { customer: '경쟁고객사', itemName: '품목', manager: '이담당', materialCode: 'MP-400', newCustomerCode: 'C901' }
});

// 7. 중복 등록 — 고객사코드 (동일한 경합 구성, 코드만 충돌)
runUpsertItemCase('7', '중복 등록 — 고객사코드(경합: 락 안 재확인에서 코드 중복 발견)', {
  viewer: viewerLead,
  preLockCustomers: baseCustomers,
  customers: baseCustomers.concat([['C902', '이미있는고객사', '이담당']]),
  items: baseItems,
  body: { customer: '새고객사4', itemName: '품목', manager: '이담당', materialCode: 'MP-401', newCustomerCode: 'C902' }
});

// 8a. 권한 없는 사용자 — role=담당
runUpsertItemCase('8a', '권한 없는 사용자(role=담당) -> FORBIDDEN', {
  viewer: viewerStaff, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', manager: '이담당', materialCode: 'MP-500' }
});

// 9a~9d. 잘못된 입력
runUpsertItemCase('9a', '잘못된 입력 — customer 누락 -> MISSING_FIELDS', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { itemName: '품목', manager: '이담당', materialCode: 'MP-501' }
});
runUpsertItemCase('9b', '잘못된 입력 — itemName 누락 -> MISSING_FIELDS', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', manager: '이담당', materialCode: 'MP-502' }
});
runUpsertItemCase('9c', '잘못된 입력 — manager 누락 -> MISSING_FIELDS', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', materialCode: 'MP-503' }
});
runUpsertItemCase('9d', '잘못된 입력 — 신규 등록인데 materialCode 누락 -> MISSING_MATERIAL_CODE', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', manager: '이담당' }
});

// 10a/10b. 담당소장 검증
runUpsertItemCase('10a', '담당소장 검증 — 존재하지 않는 이름 -> MANAGER_NOT_FOUND', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', manager: '없는사람', materialCode: 'MP-504' }
});
runUpsertItemCase('10b', '담당소장 검증 — 다른 팀 소속 담당소장 -> MANAGER_NOT_IN_YOUR_TEAM', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '기존고객사', itemName: '품목', manager: '최담당', materialCode: 'MP-505' } // 최담당은 본사 소속
});

// 11. 고객사 없음 — newCustomerCode도 없이 존재하지 않는 고객사명
runUpsertItemCase('11', '고객사 없음 — 존재하지 않는 고객사명 + newCustomerCode 없음 -> CUSTOMER_NOT_FOUND', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { customer: '없는고객사', itemName: '품목', manager: '이담당', materialCode: 'MP-506' }
});

// 12. 수정 대상 없음
runUpsertItemCase('12', '수정 대상 없음 — 존재하지 않는 itemId로 수정 시도 -> ITEM_NOT_FOUND', {
  viewer: viewerLead, customers: baseCustomers, items: baseItems,
  body: { itemId: 'MP-NOPE', customer: '기존고객사', itemName: '품목', manager: '이담당' }
});

// 17. 롤백이 다른 고객사 행을 건드리지 않는지(여러 고객사가 있는 상태에서 순서/누락 없이
//     정확히 방금 만든 것만 제거되는지) — deleteDimension 대신 재사용한 배열 필터링 로직의
//     정확성 검증(설계 문서 2-7-1의 리스크가 "기존 검증된 패턴 재사용"으로 해소됐음을 재확인).
runUpsertItemCase('17', '롤백 시 다른 고객사 행 보존 — 여러 고객사가 있을 때 방금 만든 것만 정확히 제거', {
  viewer: viewerLead,
  customers: [['C001', '기존고객사', '이담당'], ['C010', '고객사A', '이담당'], ['C011', '고객사B', '이담당']],
  items: baseItems,
  body: { customer: '새고객사5', itemName: '품목Z', manager: '이담당', materialCode: 'MP-100', newCustomerCode: 'C020' }
});

// --- upsertCustomer 단독 시나리오 (설계 문서 1-2 참고: 현재 feed.html은 이 액션을 단독
//     호출하지 않지만, API 자체는 그대로 포팅했으므로 판단 로직은 동일하게 검증한다) ---
runUpsertCustomerCase('UC1', 'upsertCustomer 정상 등록', {
  viewer: viewerLead, customers: baseCustomers, body: { name: '새고객사', code: 'C100', manager: '이담당' }
});
runUpsertCustomerCase('UC2', 'upsertCustomer 중복 — 이름', {
  viewer: viewerLead, customers: baseCustomers, body: { name: '기존고객사', code: 'C101', manager: '이담당' }
});
runUpsertCustomerCase('UC3', 'upsertCustomer 중복 — 코드', {
  viewer: viewerLead, customers: baseCustomers, body: { name: '또다른고객사', code: 'C001', manager: '이담당' }
});
runUpsertCustomerCase('UC4', 'upsertCustomer 권한 없는 사용자 -> FORBIDDEN', {
  viewer: viewerStaff, customers: baseCustomers, body: { name: '새고객사', code: 'C102', manager: '이담당' }
});
runUpsertCustomerCase('UC5', 'upsertCustomer 필드 누락(code 없음) -> MISSING_FIELDS', {
  viewer: viewerLead, customers: baseCustomers, body: { name: '새고객사', manager: '이담당' }
});

// ---------------------------------------------------------------------------
// B. idempotency/세션 인증 — 실제 lib/writeIdempotency.js, lib/auth.js를 그대로 실행
// ---------------------------------------------------------------------------
async function runIdempotencyCases() {
  // 15. 같은 idempotencyKey로 재시도 — actionFn(업서트 실제 작업)은 1회만 실행되고, 두 번째
  //     호출은 캐시된 응답을 그대로 반환해야 함(시트에 중복 반영 안 됨을 의미).
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () {
      callCount += 1;
      return { ok: true, itemId: 'MP-900', mode: 'created', calledWith: callCount };
    };
    const r1 = await withIdempotency(fs, 'upsert-dup-key-1', 'upsertItem', actionFn);
    const r2 = await withIdempotency(fs, 'upsert-dup-key-1', 'upsertItem', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && r1.ok === true;
    results.push({
      group: 'B', name: '15', desc: 'idempotencyKey 중복(upsertItem) -> actionFn은 1회만 실행, 두 응답 동일',
      detail: { callCount: callCount, r1: r1, r2: r2 }, same: pass
    });
  }

  // 16-a. IN_PROGRESS 상태에서 짧게 폴링하는 중 DONE으로 바뀌면 그 결과를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('upsert-inprogress-a');
    await docRef.set({ action: 'upsertItem', status: 'IN_PROGRESS', createdAt: new Date() });
    setTimeout(function () {
      docRef.update({ status: 'DONE', response: { ok: true, itemId: 'MP-901', mode: 'created' } });
    }, 700);
    const r = await withIdempotency(fs, 'upsert-inprogress-a', 'upsertItem', async function () {
      throw new Error('actionFn이 호출되면 안 됨(이미 다른 프로세스가 선점 중)');
    });
    const pass = deepEqual(r, { ok: true, itemId: 'MP-901', mode: 'created' });
    results.push({
      group: 'B', name: '16-a', desc: 'IN_PROGRESS -> 폴링 중 DONE으로 전환 -> 그 응답을 그대로 받음',
      detail: { r: r }, same: pass
    });
  }

  // 16-b. IN_PROGRESS 상태가 끝까지 안 풀리면 DUPLICATE_IN_PROGRESS_RETRY_LATER를 받아야 함
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('upsert-inprogress-b');
    await docRef.set({ action: 'upsertCustomer', status: 'IN_PROGRESS', createdAt: new Date() });
    const r = await withIdempotency(fs, 'upsert-inprogress-b', 'upsertCustomer', async function () {
      throw new Error('actionFn이 호출되면 안 됨');
    });
    const pass = deepEqual(r, { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' });
    results.push({
      group: 'B', name: '16-b', desc: 'IN_PROGRESS가 끝까지 안 풀림(upsertCustomer) -> DUPLICATE_IN_PROGRESS_RETRY_LATER',
      detail: { r: r }, same: pass
    });
  }

  // 세션 인증 재확인 — lib/auth.js는 이번에 새로 만들지 않고 기존 모듈을 그대로 재사용하므로
  // (설계 문서 2-2), markthreadseen-parity B그룹 시나리오 7과 동일한 4종 확인을 이 스위트
  // 안에서도 간단히 재확인한다(회귀 방지 — 다른 스위트가 실수로 lib/auth.js를 건드려도
  // 이 스위트만 실행해서 바로 알 수 있게).
  {
    const fs = new FakeFirestore();
    const now = Date.now();
    await fs.collection('sessions').doc('expired-token').set({ email: 'lead-a@nkmro.com', expiresAt: new Date(now - 1000) });
    await fs.collection('sessions').doc('valid-token').set({ email: 'lead-a@nkmro.com', expiresAt: new Date(now + 3600 * 1000) });

    const noToken = await authenticateSession(fs, null);
    const notFound = await authenticateSession(fs, 'no-such-token');
    const expired = await authenticateSession(fs, 'expired-token');
    const valid = await authenticateSession(fs, 'valid-token');

    const pass =
      noToken.ok === false && noToken.status === 400 && noToken.error === 'MISSING_SESSION_TOKEN' &&
      notFound.ok === false && notFound.status === 200 && notFound.error === 'SESSION_NOT_FOUND' &&
      expired.ok === false && expired.status === 200 && expired.error === 'SESSION_EXPIRED' &&
      valid.ok === true && valid.email === 'lead-a@nkmro.com';

    results.push({
      group: 'B', name: '세션재확인', desc: '세션 오류 4종(토큰없음/세션없음/만료/정상) -> 에러 코드 표와 일치(회귀 재확인)',
      detail: { noToken: noToken, notFound: notFound, expired: expired, valid: valid }, same: pass
    });
  }
}

// ---------------------------------------------------------------------------
// C. 분산 락(lib/writeLock.js) — 실제 프로덕션 코드를 fake_firestore.js에 실행
// ---------------------------------------------------------------------------
async function runLockCases() {
  const LOCK_OPTS = { waitMs: 1000, staleMs: 800, pollMs: 100 };

  // C1. 정상 획득 + 해제 — 락이 없으면 즉시 획득되고, releaseLock 후 문서가 사라져야 함
  {
    const fs = new FakeFirestore();
    const got = await acquireLock(fs, 'lock-c1', 'holder-1', LOCK_OPTS);
    const beforeRelease = await fs.collection('writeLocks').doc('lock-c1').get();
    await releaseLock(fs, 'lock-c1', 'holder-1');
    const afterRelease = await fs.collection('writeLocks').doc('lock-c1').get();
    const pass = got === true && beforeRelease.exists === true && afterRelease.exists === false;
    results.push({
      group: 'C', name: 'C1', desc: '정상 락 획득 + 해제 — 획득 성공, 해제 후 락 문서 삭제',
      detail: { got: got, beforeExists: beforeRelease.exists, afterExists: afterRelease.exists }, same: pass
    });
  }

  // C2. 유효한 락이 있으면 절대 못 뺏음 — waitMs 안에 계속 폴링해도 결국 false (시나리오 13의
  //     핵심 메커니즘: 락을 쥔 요청이 살아있는 한 다른 요청은 절대 동시에 못 들어간다)
  {
    const fs = new FakeFirestore();
    await acquireLock(fs, 'lock-c2', 'holder-A', LOCK_OPTS); // holder-A가 먼저 잡고 계속 쥐고 있음(해제 안 함)
    const t0 = Date.now();
    const got = await acquireLock(fs, 'lock-c2', 'holder-B', { waitMs: 400, staleMs: 800, pollMs: 100 });
    const elapsedMs = Date.now() - t0;
    const pass = got === false && elapsedMs >= 350; // waitMs(400ms)를 실제로 다 기다렸는지 확인
    results.push({
      group: 'C', name: 'C2', desc: '유효한 락 경합 — 다른 holder가 쥐고 있으면 waitMs 끝까지 기다려도 획득 실패',
      detail: { got: got, elapsedMs: elapsedMs }, same: pass
    });
  }

  // C3. 락 해제 후 재시도 성공 — holder-A가 폴링 도중 해제하면, holder-B가 다음 폴링에서 획득
  {
    const fs = new FakeFirestore();
    await acquireLock(fs, 'lock-c3', 'holder-A', LOCK_OPTS);
    setTimeout(function () { releaseLock(fs, 'lock-c3', 'holder-A'); }, 250); // 폴링 간격(100ms) 안에 들어오도록
    const t0 = Date.now();
    const got = await acquireLock(fs, 'lock-c3', 'holder-B', LOCK_OPTS);
    const elapsedMs = Date.now() - t0;
    const pass = got === true && elapsedMs >= 200 && elapsedMs < LOCK_OPTS.waitMs;
    results.push({
      group: 'C', name: 'C3', desc: '락 해제 후 재시도 성공 — 먼저 쥔 쪽이 해제하면 대기 중이던 쪽이 곧바로 획득',
      detail: { got: got, elapsedMs: elapsedMs }, same: pass
    });
  }

  // C4. 죽은 락 자가회수 — lockedAt이 staleMs보다 오래된 경우, 새 요청이 대기 없이 즉시 획득
  {
    const fs = new FakeFirestore();
    const ref = fs.collection('writeLocks').doc('lock-c4');
    await ref.set({ lockedAt: new Date(Date.now() - 5000), holderId: 'dead-holder' }); // 5초 전(죽은 락)
    const t0 = Date.now();
    const got = await acquireLock(fs, 'lock-c4', 'holder-new', { waitMs: 1000, staleMs: 800, pollMs: 100 });
    const elapsedMs = Date.now() - t0;
    const pass = got === true && elapsedMs < 100; // 폴링 한 번도 없이 첫 트랜잭션에서 즉시 성공해야 함
    results.push({
      group: 'C', name: 'C4', desc: '죽은 락 자가회수 — staleMs보다 오래된 락은 대기 없이 즉시 탈취',
      detail: { got: got, elapsedMs: elapsedMs }, same: pass
    });
  }

  // C5. holder가 아니면 해제 안 됨 — 다른 요청이 실수로 남의 락을 지우지 않는지
  {
    const fs = new FakeFirestore();
    await acquireLock(fs, 'lock-c5', 'holder-real', LOCK_OPTS);
    await releaseLock(fs, 'lock-c5', 'holder-imposter'); // 남의 holderId로 해제 시도
    const stillThere = await fs.collection('writeLocks').doc('lock-c5').get();
    const pass = stillThere.exists === true && stillThere.data().holderId === 'holder-real';
    results.push({
      group: 'C', name: 'C5', desc: 'holder 불일치 시 해제 무시 — 남의 락을 실수로 지우지 않음',
      detail: { stillExists: stillThere.exists, holderId: stillThere.exists ? stillThere.data().holderId : null }, same: pass
    });
    await releaseLock(fs, 'lock-c5', 'holder-real'); // 정리
  }
}

// ---------------------------------------------------------------------------
// D. 통합 테스트 — 실제 lib/writeLock.js + cloudrun_port.js를 Promise.all로 진짜 동시 실행
//    (시나리오 13/14 완결)
// ---------------------------------------------------------------------------
async function runConcurrencyIntegrationCases() {
  const LOCK_NAME = 'upsertItemAndCustomer';
  const LOCK_OPTS = { waitMs: 2000, staleMs: 1500, pollMs: 50 };

  // 공유 "시트" 상태 — 두 동시 요청이 실제로 같은 배열을 두고 경쟁한다(락으로 순차 직렬화됨).
  function makeSharedState() {
    return { customers: baseCustomers.map(function (r) { return r.slice(); }), items: baseItems.map(function (r) { return r.slice(); }) };
  }

  async function simulateUpsertItemCall(fs, holderId, body) {
    const got = await acquireLock(fs, LOCK_NAME, holderId, LOCK_OPTS);
    if (!got) return { result: { ok: false, error: 'LOCK_TIMEOUT' } };
    try {
      // 락 획득 후 "fresh read" — 공유 상태를 그 시점 그대로 다시 읽는다(실제 index.js와
      // 동일하게, 다른 쪽이 먼저 커밋한 변경을 반영한 최신 상태를 봄).
      const freshState = { customers: sharedState.customers, items: sharedState.items };
      const preLockCustomers = sharedState.customers; // 이 테스트는 사전확인도 락 시점 상태로 단순화
      const r = upsertItemAction_(viewerLead, allUsers, rowsToCustomerObjs(preLockCustomers), body, freshState, 47100);
      if (r.result && r.result.ok) {
        // 실제 쓰기가 성공했다고 가정하고 공유 상태에 반영(실제 index.js가 Sheets에 반영하는 것에 대응)
        sharedState.customers = r.customers;
        sharedState.items = r.items;
      }
      return r;
    } finally {
      await releaseLock(fs, LOCK_NAME, holderId);
    }
  }

  var sharedState;

  // D1(시나리오 13) — 같은 materialCode로 두 요청을 진짜 동시에(Promise.all) 보냄. 락 때문에
  // 순차 처리되고, 먼저 처리된 쪽만 성공 -> 최종 items에는 정확히 1개만 추가돼야 한다.
  {
    const fs = new FakeFirestore();
    sharedState = makeSharedState();
    const body = { customer: '기존고객사', itemName: '동시등록품목', manager: '이담당', materialCode: 'MP-700' };
    const [r1, r2] = await Promise.all([
      simulateUpsertItemCall(fs, 'req-1', body),
      simulateUpsertItemCall(fs, 'req-2', body)
    ]);
    const oks = [r1, r2].filter(function (r) { return r.result && r.result.ok; });
    const dupErrors = [r1, r2].filter(function (r) { return r.result && !r.result.ok && r.result.error === 'MATERIAL_CODE_ALREADY_EXISTS'; });
    const mp700Count = sharedState.items.filter(function (row) { return row[0] === 'MP-700'; }).length;
    const pass = oks.length === 1 && dupErrors.length === 1 && mp700Count === 1;
    results.push({
      group: 'D', name: '13', desc: '동시 등록(락 경합, 같은 자재코드) — 둘 다 동시에 보내도 하나만 성공, 나머지는 MATERIAL_CODE_ALREADY_EXISTS',
      detail: { r1: r1.result, r2: r2.result, mp700CountInFinalItems: mp700Count }, same: pass
    });
  }

  // D2(시나리오 14) — 서로 다른 materialCode로 두 요청을 진짜 동시에 보냄. 락 때문에 순차
  // 처리되지만(경합 자체는 있음), 서로 충돌하지 않으므로 둘 다 성공해야 한다(락이 불필요하게
  // 실패를 만들지 않는지 확인).
  {
    const fs = new FakeFirestore();
    sharedState = makeSharedState();
    const bodyA = { customer: '기존고객사', itemName: '품목A', manager: '이담당', materialCode: 'MP-800' };
    const bodyB = { customer: '기존고객사', itemName: '품목B', manager: '이담당', materialCode: 'MP-801' };
    const [r1, r2] = await Promise.all([
      simulateUpsertItemCall(fs, 'req-1', bodyA),
      simulateUpsertItemCall(fs, 'req-2', bodyB)
    ]);
    const bothOk = !!(r1.result && r1.result.ok && r2.result && r2.result.ok);
    const has800 = sharedState.items.some(function (row) { return row[0] === 'MP-800'; });
    const has801 = sharedState.items.some(function (row) { return row[0] === 'MP-801'; });
    const pass = bothOk && has800 && has801;
    results.push({
      group: 'D', name: '14', desc: '동시 등록(락 경합, 다른 자재코드) — 둘 다 동시에 보내도 순차 직렬화되어 둘 다 성공',
      detail: { r1: r1.result, r2: r2.result, has800: has800, has801: has801 }, same: pass
    });
  }
}

// ---------------------------------------------------------------------------
(async function main() {
  await runIdempotencyCases();
  await runLockCases();
  await runConcurrencyIntegrationCases();

  console.log(JSON.stringify(results, null, 2));

  console.error('\n=== SUMMARY (upsertItemTest/upsertCustomerTest 코드 레벨 parity/정책 테스트) ===');
  for (const r of results) {
    const tag = r.same ? 'PASS' : (r.note ? 'FAIL(known)' : 'FAIL');
    console.error(`[${r.group}] case ${r.name}: ${tag} - ${r.desc}`);
  }
  const unknownFails = results.filter(function (r) { return !r.same && !r.note; });
  const knownFails = results.filter(function (r) { return !r.same && r.note; });
  console.error(`\n총 ${results.length}건: PASS ${results.length - unknownFails.length - knownFails.length}건, 알려진 실패(버그 검출용) ${knownFails.length}건, 그 외 실패 ${unknownFails.length}건`);
  if (unknownFails.length > 0) {
    console.error('예상치 못한 실패가 있습니다 — 아래 케이스를 확인하세요:');
    unknownFails.forEach(function (r) { console.error(`  - [${r.group}] ${r.name}: ${r.desc}`); });
  }
  process.exitCode = unknownFails.length > 0 ? 1 : 0;
})();
