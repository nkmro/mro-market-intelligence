// Code.gs의 handleMarkThreadSeen_(user, body)을 그대로 옮긴 참조 구현.
// 원본(apps-script/Code.gs, 3399~3427행):
//
// function handleMarkThreadSeen_(user, body) {
//   const postId = String(body.postId || '');
//   const itemId = String(body.itemId || '');
//   if (!postId || !itemId) return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
//   const lock = LockService.getScriptLock();
//   lock.waitLock(5000);
//   try {
//     const sheet = getSheetObj_(SHEET_THREAD_SEEN);
//     const data = getSheetValues_(SHEET_THREAD_SEEN);
//     const now = new Date().toISOString();
//     let found = false;
//     for (let i = 1; i < data.length; i++) {
//       if (String(data[i][0]).toLowerCase() === String(user.email).toLowerCase() && String(data[i][1]) === postId && String(data[i][2]) === itemId) {
//         sheet.getRange(i + 1, 4).setValue(now);
//         found = true;
//         break;
//       }
//     }
//     if (!found) {
//       sheet.appendRow([user.email, postId, itemId, now]);
//     }
//     invalidateSheetCache_(SHEET_THREAD_SEEN);
//   } finally {
//     lock.releaseLock();
//   }
//   return jsonResponse_({ ok: true });
// }
//
// 이 테스트에서는 LockService/getSheetObj_/invalidateSheetCache_(전부 Apps Script/실제 시트
// 부작용)를 걷어내고, "찾아서 갱신할지 새 행을 추가할지"라는 핵심 판단만 순수 함수로 남긴다.
// rows는 헤더 없이 데이터 행만 받는다(원본이 data[1]부터 도는 것과 동일하게 맞춘 것 — 여기서는
// 인덱스가 0부터 시작). nowIso는 테스트 결정성을 위해 외부에서 주입한다(원본은 함수 내부에서
// new Date().toISOString()을 직접 호출하므로 실제 배포 코드에는 이 파라미터가 없다).
function handleMarkThreadSeen_(email, postId, itemId, rows, nowIso) {
  const postIdStr = String(postId || '');
  const itemIdStr = String(itemId || '');
  if (!postIdStr || !itemIdStr) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, rows: rows.map(function (r) { return r.slice(); }) };
  }

  const outRows = rows.map(function (r) { return r.slice(); });
  let found = false;
  for (let i = 0; i < outRows.length; i++) {
    if (String(outRows[i][0]).toLowerCase() === String(email).toLowerCase() &&
        String(outRows[i][1]) === postIdStr && String(outRows[i][2]) === itemIdStr) {
      outRows[i][3] = nowIso;
      found = true;
      break;
    }
  }
  if (!found) {
    outRows.push([email, postIdStr, itemIdStr, nowIso]);
  }

  return { result: { ok: true }, rows: outRows };
}

module.exports = { handleMarkThreadSeen_ };
