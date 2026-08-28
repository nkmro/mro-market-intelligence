// cloud-run/mro-functions/index.js의 updateSettingsAction_ 안에서 실제로 "무엇을 검증하고
// 시트를 어떻게 바꿀지"를 결정하는 판단 로직만(GoogleAuth/Sheets API 호출은 제외) 그대로
// 옮긴 것. 락을 쓰지 않으므로(2026-08-28 분석/설계에서 확정) "락을 잡은 뒤 fresh read"라는
// 단계 자체가 없다 — 이 A그룹 테스트는 동시성 없는 단일 시나리오만 다루므로 "현재 state를
// 그대로 읽는다"로 단순화했다.
//
// [중요] 이 파일은 index.js에 실제로 작성된 제어 흐름을 "있는 그대로" 옮긴 것이지, Code.gs와
// 별개로 새로 설계한 것이 아니다.

const ADMIN_EMAIL = 'jhjoo@nkmro.com';

function updateSettingsAction_(viewer, body, freshSettings) {
  if (String(viewer.email).trim().toLowerCase() !== ADMIN_EMAIL) {
    return { result: { ok: false, error: 'FORBIDDEN' }, settings: freshSettings };
  }
  const updates = body.settings;
  if (!updates || typeof updates !== 'object') {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, settings: freshSettings };
  }

  const settings = freshSettings.map(function (r) { return r.slice(); });
  const updatedKeys = [];
  const unknownKeys = [];
  const keys = Object.keys(updates);
  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
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
  }

  return { result: { ok: true, updatedKeys: updatedKeys, unknownKeys: unknownKeys }, settings: settings };
}

module.exports = { updateSettingsAction_ };
