// cloud-run/mro-functions/lib/writeLock.js
//
// Firestore 기반 분산 락(상호배제) 공통화. index.js의 acquireLoginLock_/releaseLoginLock_
// (loginTest 전용, 1099~1136행)가 이미 쓰고 있는 정책 — Firestore 트랜잭션으로 락 문서를
// 선점하고, staleMs보다 오래된 락은 죽은 락(크래시 등으로 해제 안 됨)으로 간주해 자가회수하며,
// waitMs를 넘기면 포기하는 방식 — 을 그대로 재사용 가능한 모듈로 일반화한 것이다.
// loginTest 코드 자체(acquireLoginLock_/releaseLoginLock_)는 이번에 건드리지 않는다("잘
// 동작하는 코드는 이번에 건드리지 않는다"는 기존 원칙) — 이 모듈은 upsertItemTest/
// upsertCustomerTest처럼 새로 만드는 함수만 사용한다.
//
// Apps Script Code.gs의 LockService.getScriptLock()에 대응한다. Code.gs는 스크립트
// 전체가 공유하는 단일 락을 쓰지만(UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md 1-3),
// Cloud Run에서는 실제로 정합성이 걸리는 범위(품목마스터/고객사마스터에 동시에 쓸 수 있는
// upsertItem/upsertCustomer)로 좁혀, 두 함수가 락 이름 하나("upsertItemAndCustomer")를
// 공유하는 것으로 설계했다(같은 문서 2-3, 2026-08-27 승인).
//
// 컬렉션: writeLocks, 문서 ID = lockName.

// lockedAt은 실제 Firestore에서는 Timestamp로 저장/반환되지만(lib/auth.js의
// authenticateSession과 동일한 방어), 로컬 parity 테스트의 fake_firestore.js는 그냥 JS
// Date를 그대로 돌려주므로 두 경우 모두 처리한다(acquireLoginLock_과 동일한 방어).
function lockedAtMillis_(lockedAtRaw) {
  return (lockedAtRaw && lockedAtRaw.toMillis) ? lockedAtRaw.toMillis() : new Date(lockedAtRaw).getTime();
}

function sleep_(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// firestore: Firestore 인스턴스.
// lockName: 락 문서 ID(예: 'upsertItemAndCustomer') — 이 이름을 공유하는 모든 호출자끼리
//           상호배제된다.
// holderId: 이 락을 시도하는 실행을 식별하는 값(호출부가 매 요청마다 새로 만들어 넘긴다 —
//           예: crypto.randomUUID()). releaseLock이 "내가 잡은 락만" 지우기 위해 필요하다.
// opts: { waitMs, staleMs, pollMs } — 세 값 모두 호출부가 명시한다(이 모듈 안에 기본값을
//       숨기지 않음 — 락마다 적절한 값이 다를 수 있으므로 호출부가 명시적으로 정하게 한다).
//
// 반환값: 락을 획득하면 true, waitMs 안에 못 얻으면 false.
async function acquireLock(firestore, lockName, holderId, opts) {
  const ref = firestore.collection('writeLocks').doc(lockName);
  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    const acquired = await firestore.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const lockedAt = lockedAtMillis_(snap.data().lockedAt);
        if (Date.now() - lockedAt < opts.staleMs) {
          return false; // 다른 요청이 아직 유효한 락을 쥐고 있음
        }
        // opts.staleMs보다 오래된 락은 죽은 락으로 간주하고 뺏어옴(자가 복구)
      }
      tx.set(ref, { lockedAt: new Date(), holderId: holderId });
      return true;
    });
    if (acquired) return true;
    if (Date.now() >= deadline) return false;
    await sleep_(opts.pollMs);
  }
}

// 내가 잡은 락일 때만 해제한다 — 이미 staleMs가 지나 다른 요청이 뺏어간 락을 실수로
// 지우지 않기 위함(acquireLoginLock_과 동일한 방어).
async function releaseLock(firestore, lockName, holderId) {
  const ref = firestore.collection('writeLocks').doc(lockName);
  try {
    const snap = await ref.get();
    if (snap.exists && snap.data().holderId === holderId) {
      await ref.delete();
    }
  } catch (e) {
    console.error('releaseLock(' + lockName + ') 실패(무시, 곧 죽은 락으로 자동 회수됨): ' + e);
  }
}

module.exports = { acquireLock, releaseLock };
