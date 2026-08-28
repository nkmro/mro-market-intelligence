// Code.gs의 handleUpdateSettings_(user, body)(3311~3341행)을 그대로 옮긴 참조 구현.
//
// getSheetObj_/getSheetValues_/invalidateSheetCache_(전부 Apps Script/실제 시트 부작용)를
// 걷어내고, "무엇을 검증하고 시트를 어떻게 바꿀지"라는 핵심 판단만 순수 함수로 남겼다.
// 시트는 다음 배열로 표현한다(설정 A2:C, 헤더 제외, index 0 == 시트 2행):
//   settings: [[key, value, description], ...]
// 반환: { result, settings } (settings는 변경 반영된 복사본).

const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function handleUpdateSettings_(user, body, freshSettings) {
  if (String(user.email).trim().toLowerCase() !== ADMIN_EMAIL) {
    return { result: { ok: false, error: 'FORBIDDEN' }, settings: freshSettings };
  }
  const updates = body.settings;
  // Code.gs 3316~3318행과 동일하게 typeof만 확인한다 — 배열도 JS에서는 typeof가 'object'라서
  // 여기서 걸러지지 않고 그대로 통과한다(아래 Object.keys 루프에서 인덱스 키들이 전부
  // unknownKeys로 빠질 뿐, 에러로 처리되지 않는다). 이 느슨함을 이번에 새로 막지 않는다.
  if (!updates || typeof updates !== 'object') {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, settings: freshSettings };
  }

  const settings = freshSettings.map(function (r) { return r.slice(); });
  const updatedKeys = [];
  const unknownKeys = [];
  Object.keys(updates).forEach(function (key) {
    let found = false;
    for (let i = 0; i < settings.length; i++) {
      if (settings[i][0] === key) {
        settings[i][1] = updates[key];
        updatedKeys.push(key);
        found = true;
        break;
      }
    }
    if (!found) unknownKeys.push(key);
  });

  return { result: { ok: true, updatedKeys: updatedKeys, unknownKeys: unknownKeys }, settings: settings };
}

module.exports = { handleUpdateSettings_ };
