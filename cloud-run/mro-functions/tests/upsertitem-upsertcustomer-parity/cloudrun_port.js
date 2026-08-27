// cloud-run/mro-functions/index.js의 upsertItemAction_/upsertCustomerAction_ 안에서 실제로
// "무엇을 검증하고 시트를 어떻게 바꿀지"를 결정하는 판단 로직만(GoogleAuth/Sheets API 호출,
// Firestore 락 획득/해제 호출은 제외) 그대로 옮긴 것. "락을 잡은 뒤 다시 읽는(fresh read)"
// 부분은, 이 A그룹 테스트가 동시성 없는 단일 시나리오만 다루므로 "현재 state를 그대로
// 읽는다"로 단순화했다(동시성/락 자체는 이 스위트의 C그룹, lib/writeLock.js 테스트에서
// 실제 코드로 별도 검증한다).
//
// [중요] 이 파일은 index.js에 실제로 작성된 제어 흐름을 "있는 그대로" 옮긴 것이지, Code.gs와
// 별개로 새로 설계한 것이 아니다. (2026-08-27 수정 반영) 롤백 검사(if (result && !result.ok
// && createdCustomerCode))는 이제 index.js와 마찬가지로 안쪽 try/catch *바깥*에 있다 —
// apps_script_ref.js(Code.gs 3227행 원본)와 동일한 위치다. 수정 전에는 이 검사가 안쪽 try
// 블록 *안*, catch보다 앞에 있어서 예외 발생 시 롤백이 실행되지 않는 버그가 있었고(parity
// 테스트 시나리오 4b로 발견), 그 버그를 index.js에서 고치면서 이 포트도 함께 갱신했다.

function findCustomerRowByName_(rows, name) {
  return rows.find(function (row) { return String(row[1] || '').trim() === String(name).trim(); }) || null;
}
function findCustomerRowByCode_(rows, code) {
  return rows.find(function (row) { return String(row[0] || '').trim() === String(code).trim(); }) || null;
}
function findItemRowIndexById_(rows, itemId) {
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(itemId).trim()) return i;
  }
  return -1;
}

// index.js upsertItemAction_ 포트(1913~2018행, 2026-08-27 롤백 위치 수정 반영). freshState =
// { customers, items } — 락을 잡은 뒤의 fresh read를 흉내(이 테스트에서는 곧 현재 state).
// 반환: { result, customers, items }.
function upsertItemAction_(viewer, allUsers, allCustomers, body, freshState, nowSerial) {
  if (viewer.role !== '팀장') {
    return { result: { ok: false, error: 'FORBIDDEN' }, customers: freshState.customers, items: freshState.items };
  }

  const itemId = body.itemId || ''; // index.js 1943행과 동일하게 여기서 trim하지 않음
  const customer = body.customer;
  const itemName = body.itemName;
  const manager = body.manager;
  const materials = Array.isArray(body.materials) ? body.materials.join(', ') : (body.materials || '');
  const status = body.status || '활성';
  const materialCode = String(body.materialCode || '').trim();
  const newCustomerCode = String(body.newCustomerCode || '').trim();

  if (!customer || !itemName || !manager) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, customers: freshState.customers, items: freshState.items };
  }

  const managerUser = allUsers.find(function (u) { return String(u.name || '').trim() === String(manager).trim(); });
  if (!managerUser) {
    return { result: { ok: false, error: 'MANAGER_NOT_FOUND' }, customers: freshState.customers, items: freshState.items };
  }
  if (String(managerUser.team).trim() !== String(viewer.team).trim()) {
    return { result: { ok: false, error: 'MANAGER_NOT_IN_YOUR_TEAM' }, customers: freshState.customers, items: freshState.items };
  }
  const team = managerUser.team;

  const customerExists = allCustomers.some(function (c) { return String(c.name || '').trim() === String(customer).trim(); });
  if (!customerExists && !newCustomerCode) {
    return { result: { ok: false, error: 'CUSTOMER_NOT_FOUND' }, customers: freshState.customers, items: freshState.items };
  }
  if (!itemId && !materialCode) {
    return { result: { ok: false, error: 'MISSING_MATERIAL_CODE' }, customers: freshState.customers, items: freshState.items };
  }

  // ---- 락 획득(가정) 이후: index.js 1963~2014행 ----
  let customers = freshState.customers.map(function (r) { return r.slice(); });
  let items = freshState.items.map(function (r) { return r.slice(); });
  let createdCustomerCode = null;
  let result;

  try {
    if (!customerExists) {
      if (findCustomerRowByName_(customers, customer)) {
        result = { ok: false, error: 'CUSTOMER_ALREADY_EXISTS' };
      } else if (findCustomerRowByCode_(customers, newCustomerCode)) {
        result = { ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' };
      } else {
        customers.push([newCustomerCode, customer, manager]);
        createdCustomerCode = newCustomerCode;
      }
    }

    if (!result) {
      if (itemId) {
        const rowIndex = findItemRowIndexById_(items, itemId);
        if (rowIndex === -1) {
          result = { ok: false, error: 'ITEM_NOT_FOUND' };
        } else {
          items[rowIndex] = [items[rowIndex][0], customer, itemName, manager, team, materials, status, items[rowIndex][7]];
          result = { ok: true, itemId: itemId, mode: 'updated' };
        }
      } else if (materialCode === '__SIMULATE_THROW__') {
        throw new Error('SIMULATED_SHEETS_ERROR');
      } else if (findItemRowIndexById_(items, materialCode) !== -1) {
        result = { ok: false, error: 'MATERIAL_CODE_ALREADY_EXISTS' };
      } else {
        items.push([materialCode, customer, itemName, manager, team, materials, status, nowSerial]);
        result = { ok: true, itemId: materialCode, mode: 'created' };
      }
    }
  } catch (err) {
    result = { ok: false, error: 'SERVER_ERROR', detail: String(err) };
  }

  // (2026-08-27 수정) index.js 2026-08-27 수정과 동일하게, 이 검사를 위 try/catch *바깥*으로
  // 옮겼다 — catch에서 SERVER_ERROR로 바뀐 경우를 포함해서, result가 실패이고
  // createdCustomerCode가 있으면 항상 롤백을 시도한다(apps_script_ref.js의 Code.gs 3227행
  // 포트와 이제 동일한 위치).
  if (result && !result.ok && createdCustomerCode) {
    const ci = customers.findIndex(function (r) { return String(r[0]).trim() === String(createdCustomerCode).trim(); });
    if (ci !== -1) customers.splice(ci, 1); // rollbackCustomerRow_(나머지를 위로 당겨 다시 쓰기)와 배열상 동일한 결과
  }

  return { result: result, customers: customers, items: items };
}

// index.js upsertCustomerAction_ 포트(2101~2131행 부근).
function upsertCustomerAction_(viewer, body, freshState) {
  if (viewer.role !== '팀장') {
    return { result: { ok: false, error: 'FORBIDDEN' }, customers: freshState.customers };
  }
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim();
  const manager = String(body.manager || '').trim();
  if (!name || !code) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, customers: freshState.customers };
  }

  const customers = freshState.customers.map(function (r) { return r.slice(); });
  if (findCustomerRowByName_(customers, name)) {
    return { result: { ok: false, error: 'CUSTOMER_ALREADY_EXISTS' }, customers: customers };
  }
  if (findCustomerRowByCode_(customers, code)) {
    return { result: { ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' }, customers: customers };
  }
  customers.push([code, name, manager]);
  return { result: { ok: true, code: code, name: name, manager: manager }, customers: customers };
}

module.exports = { upsertItemAction_, upsertCustomerAction_ };
