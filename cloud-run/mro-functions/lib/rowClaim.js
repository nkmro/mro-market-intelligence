// [DELIVERY] cloud-run/mro-functions/lib/rowClaim.js 신규 — GitHub 커밋본이 곧 gcloud 배포 소스(단일본). (2026-10-14 AI 원자재 추천 단계 3: 품목 행 처리권)
// cloud-run/mro-functions/lib/rowClaim.js
//
// 품목마스터 "행 처리권" (MATERIAL_SUGGEST_CLOUDRUN_DESIGN_v2.md 2-6, 단계 3 계획서 변경 #1).
// 같은 품목 행의 F(원자재)를 두 요청이 동시에 처리하지 않게 하는 표시다. 원자재마스터 잠금
// (lib/writeLock.js, writeLocks/rawMaterialMaster)과는 별개이며, 행마다 문서가 따로 있다
// (행 A의 처리권과 행 B의 처리권은 서로 영향이 없다).
//
// 컬렉션: materialRowClaims, 문서 ID = claimKey(row)
//   { holder, mode('take'|'try'), reason, itemName, claimedAt(Date), takenFrom(이전 holder|null) }
//
// 규칙
//   - try  (fill_empty·점검): 문서가 없거나 만료(90초)면 잡는다. 살아 있는 처리권이 있으면 못 잡음(busy).
//   - take (single_edit = 사람이 품목명을 직접 고침): 살아 있는 처리권이 있어도 넘겨받는다(설계 2-6의
//          "60초 대기"를 대체 — Apps Script가 응답을 약 60초밖에 못 기다리기 때문, 계획서 변경 #1).
//          넘겨받은 사실은 takenFrom에 남는다.
//   - 이전 처리자는 시트에 쓰기 직전 isMine()으로 "아직 내 처리권인지"를 확인하고, 아니면 쓰지 않는다
//     (index.js writeSheetRowResult_ 2단계).
//   - release()는 내 처리권일 때만 지운다(넘겨받은 새 처리자의 문서를 지우지 않음).

const CLAIM_COLLECTION = 'materialRowClaims';
const CLAIM_STALE_MS = 90000; // 행당 최대 예상 50초 + 여유(설계 2-6)

// 행을 가리키는 키. A열(품목코드)이 있으면 그것으로, 없으면 행 번호로(계획서 변경 #4).
// Firestore 문서 ID에는 '/'를 쓸 수 없어 encodeURIComponent로 감싼다.
function claimKey(row) {
  const id = String(row.itemId === undefined || row.itemId === null ? '' : row.itemId).trim();
  if (id) return 'id:' + encodeURIComponent(id).slice(0, 400);
  return 'row:' + String(parseInt(row.rowNumber, 10));
}

function millis_(v) { return (v && v.toMillis) ? v.toMillis() : new Date(v).getTime(); }

// 반환: { ok:true, tookOver: 이전holder|null } | { ok:false, holder: 지금holder }
async function claim(firestore, key, holder, mode, meta, nowFn) {
  const now = nowFn || Date.now;
  const ref = firestore.collection(CLAIM_COLLECTION).doc(key);
  return firestore.runTransaction(async function (tx) {
    const snap = await tx.get(ref);
    let prev = null;
    if (snap.exists) {
      const d = snap.data();
      const alive = now() - millis_(d.claimedAt) < CLAIM_STALE_MS;
      if (alive && mode !== 'take') return { ok: false, holder: d.holder };
      if (alive) prev = d.holder; // take: 살아 있는 처리권을 넘겨받음
    }
    tx.set(ref, Object.assign({}, meta || {}, { holder: holder, mode: mode, claimedAt: new Date(now()), takenFrom: prev }));
    return { ok: true, tookOver: prev };
  });
}

// 쓰기 직전 확인: 문서가 있고 holder가 나일 때만 true.
// (만료됐더라도 아무도 넘겨받지 않았다면 여전히 내 것 — 늦게 끝난 처리도 다른 쪽과 겹치지 않으면 쓴다.)
async function isMine(firestore, key, holder) {
  const snap = await firestore.collection(CLAIM_COLLECTION).doc(key).get();
  return !!(snap.exists && snap.data().holder === holder);
}

async function release(firestore, key, holder) {
  const ref = firestore.collection(CLAIM_COLLECTION).doc(key);
  try {
    await firestore.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().holder === holder) tx.delete(ref);
    });
  } catch (e) {
    console.error('rowClaim.release(' + key + ') 실패(무시, 90초 뒤 만료): ' + e);
  }
}

module.exports = { CLAIM_COLLECTION, CLAIM_STALE_MS, claimKey, claim, isMine, release };
