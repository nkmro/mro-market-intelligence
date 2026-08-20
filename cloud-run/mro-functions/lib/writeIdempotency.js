// cloud-run/mro-functions/lib/writeIdempotency.js
//
// Firestore 기반 쓰기 idempotency 처리 공통화. 0단계 설계(MARKTHREADSEEN_CLOUDRUN_DESIGN.md,
// 승인됨)에서 확정한 대로, Apps Script Code.gs의 withIdempotency_(CacheService + LockService
// 조합, Code.gs 626~677행)와 정책을 한 글자도 다르지 않게 재현한다 — 저장소만 Firestore
// 트랜잭션으로 대체했다:
//   - idempotencyKey가 없으면 그냥 실행한다(Code.gs와 동일 — dedup 대상이 아님).
//   - writeIdempotency/{idempotencyKey} 문서가 없으면 IN_PROGRESS로 선점하고 실제 작업을 실행한다.
//   - 문서가 이미 DONE이면 저장된 응답을 그대로 반환한다(재실행하지 않음).
//   - 문서가 IN_PROGRESS면(다른 요청이 처리 중) 짧게 몇 번 재확인하고, 그래도 안 끝났으면
//     Code.gs와 동일하게 DUPLICATE_IN_PROGRESS_RETRY_LATER를 반환한다.
//   - 실행 중 예외가 나면 선점 문서를 지워서, 같은 키로 온 다음 재시도가 처음부터 다시
//     시도할 수 있게 한다(Code.gs의 catch { cache.remove(cacheKey); throw err; }와 동일).
//
// 컬렉션: writeIdempotency, 문서 ID = idempotencyKey (feed.html의 generateIdempotencyKey_()가
// 만든 값 그대로). expiresAt 필드에 대한 Firestore TTL 정책 설정은 이번 코드 구현 범위가
// 아니다 — 실제 구현 승인 시 별도로(gcloud/console에서 1회) 설정한다
// (MARKTHREADSEEN_CLOUDRUN_DESIGN.md 0단계 참고).

const { FieldValue } = require('@google-cloud/firestore');

const IDEMPOTENCY_COLLECTION = 'writeIdempotency';
const TTL_MS = 6 * 60 * 60 * 1000; // 6시간 — Code.gs withIdempotency_의 TTL_SEC(21600)과 동일
const POLL_INTERVAL_MS = 500;
const POLL_ATTEMPTS = 4; // Code.gs withIdempotency_의 재확인 루프(4회 * 500ms)와 동일

function sleep_(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// firestore: Firestore 인스턴스
// idempotencyKey: 클라이언트가 보낸 값(없을 수 있음 — 그 경우 dedup 없이 바로 실행)
// action: 'markThreadSeen' 등, 저장되는 문서에 남기는 구분용 문자열(로깅/디버깅용)
// actionFn: 실제 쓰기 작업 async () => 응답 객체(예: {ok:true} 또는 {ok:false, error:'...'})
//
// 반환값: actionFn()의 결과(최초 실행이든, 이미 DONE인 캐시된 응답이든 동일한 모양) 또는
//         { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' }.
async function withIdempotency(firestore, idempotencyKey, action, actionFn) {
  if (!idempotencyKey) return actionFn();

  const docRef = firestore.collection(IDEMPOTENCY_COLLECTION).doc(idempotencyKey);

  const claim = await firestore.runTransaction(async function (tx) {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      tx.set(docRef, {
        action: action,
        status: 'IN_PROGRESS',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + TTL_MS)
      });
      return { claimed: true };
    }
    const data = snap.data();
    if (data.status === 'DONE') return { claimed: false, response: data.response };
    return { claimed: false, inProgress: true };
  });

  if (!claim.claimed) {
    if (claim.response) return claim.response;
    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await sleep_(POLL_INTERVAL_MS);
      const polled = await docRef.get();
      if (polled.exists && polled.data().status === 'DONE') return polled.data().response;
    }
    return { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' };
  }

  try {
    const result = await actionFn();
    await docRef.update({ status: 'DONE', response: result });
    return result;
  } catch (err) {
    await docRef.delete().catch(function () {});
    throw err;
  }
}

module.exports = { withIdempotency, IDEMPOTENCY_COLLECTION };
