// Code.gs의 handleUpsertItem_(user, body)(3123~3247행)과 handleUpsertCustomer_(user, body)
// (3502~3537행)을 그대로 옮긴 참조 구현.
//
// LockService/getSheetObj_/getSheetValues_/invalidateSheetCache_/SpreadsheetApp.flush()(전부
// Apps Script/실제 시트 부작용)를 걷어내고, "무엇을 검증하고 시트를 어떻게 바꿀지"라는 핵심
// 판단만 순수 함수로 남겼다. 시트는 다음 두 배열로 표현한다:
//   customers: [[code, name, manager], ...]   (고객사마스터 A2:C, 헤더 제외)
//   items:     [[itemId, customer, itemName, manager, team, materials, status, registeredAt], ...]
//               (품목마스터 A2:H, 헤더 제외)
// nowValue는 등록일(H열)에 들어갈 값을 테스트 결정성을 위해 외부에서 주입한다(원본은
// new Date()를 직접 호출).
//
// [preLockCustomers vs freshState.customers] Code.gs는 락을 잡기 *전*에 한 번(3153행,
// customerExists 계산용), 락을 잡은 *후*에 다시 한 번(3182행, findCustomerByName_ 재확인)
// 고객사마스터를 읽는다 — 두 읽기 사이에 다른 요청이 끼어들 수 있기 때문에 원본이 일부러
// 두 번 확인하는 것이다(3169~3176행 주석). 이 테스트에서는 그 "두 읽기가 서로 다를 수
// 있다"는 상황(=경합)을 직접 구성할 수 있도록, 두 스냅샷을 별개의 인자로 받는다. 경합이
// 없는 보통의 시나리오에서는 두 인자에 같은 배열을 넘기면 된다.
//
// [예외 시뮬레이션] materialCode(또는 code)가 '__SIMULATE_THROW__'이면, 실제 Sheets 쓰기가
// 일어나는 지점에서 의도적으로 예외를 던진다(실제 배포 환경의 네트워크 오류 등을 흉내).
// Code.gs 원본의 롤백 검사(3227행)는 이 예외를 잡는 try/catch(3179~3225행) *바깥*에 있어서,
// 예외가 나도 롤백은 항상 실행된다 — 이 제어 흐름을 정확히 재현하는 것이 이 시뮬레이션의
// 목적이다(cloudrun_port.js와 비교해 실제 구현의 제어 흐름 차이를 검출한다).

function findCustomerByName_(customers, name) {
  return customers.find(function (c) { return String(c[1]).trim() === String(name).trim(); }) || null;
}
function findCustomerByCode_(customers, code) {
  return customers.find(function (c) { return String(c[0]).trim() === String(code).trim(); }) || null;
}
function findUserByName_(allUsers, name) {
  const u = allUsers.find(function (u) { return String(u.name).trim() === String(name).trim(); });
  return u ? { email: u.email, name: u.name, role: u.role, team: u.team, status: u.status } : null;
}
function getItemById_(items, itemId) {
  const row = items.find(function (r) { return String(r[0]).trim() === String(itemId).trim(); });
  if (!row) return null;
  return { itemId: String(row[0]), customer: row[1], itemName: row[2], manager: row[3], team: row[4], materials: row[5], status: row[6] };
}

// Code.gs handleUpsertItem_ 포트.
// preLockCustomers: 락을 잡기 전 customerExists 판단에만 쓰는 스냅샷(배열, 읽기 전용).
// freshState: { customers, items } — 락을 잡은 뒤 실제로 재확인+수정하는 대상(원본 배열은
//              변경하지 않고 복사본을 만들어 반환한다).
// 반환: { result, customers, items }.
function handleUpsertItem_(user, allUsers, body, preLockCustomers, freshState, nowValue) {
  if (user.role !== '팀장') {
    return { result: { ok: false, error: 'FORBIDDEN' }, customers: freshState.customers, items: freshState.items };
  }

  const itemId = body.itemId || ''; // Code.gs 3128행과 동일하게 여기서 trim하지 않음
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

  const managerUser = findUserByName_(allUsers, manager);
  if (!managerUser) {
    return { result: { ok: false, error: 'MANAGER_NOT_FOUND' }, customers: freshState.customers, items: freshState.items };
  }
  if (String(managerUser.team).trim() !== String(user.team).trim()) {
    return { result: { ok: false, error: 'MANAGER_NOT_IN_YOUR_TEAM' }, customers: freshState.customers, items: freshState.items };
  }
  const team = managerUser.team;

  const customerExists = !!findCustomerByName_(preLockCustomers, customer); // 락 밖(3153행)
  if (!customerExists && !newCustomerCode) {
    return { result: { ok: false, error: 'CUSTOMER_NOT_FOUND' }, customers: freshState.customers, items: freshState.items };
  }
  if (!itemId && !materialCode) {
    return { result: { ok: false, error: 'MISSING_MATERIAL_CODE' }, customers: freshState.customers, items: freshState.items };
  }

  // ---- Code.gs 3163행: lock.tryLock(10000) 이후 구간 (락 자체는 이 스위트의 C그룹에서
  // lib/writeLock.js를 실제 코드로 별도 검증하므로, 여기서는 "락을 이미 획득했다"고 가정하고
  // 원본 3178~3246행의 제어 흐름을 그대로 재현한다) ----
  let customers = freshState.customers.map(function (r) { return r.slice(); });
  let items = freshState.items.map(function (r) { return r.slice(); });
  let createdCustomerCode = null;
  let result;

  try {
    if (!customerExists) {
      if (findCustomerByName_(customers, customer)) { // 3182행: 락 안 재확인
        result = { ok: false, error: 'CUSTOMER_ALREADY_EXISTS' };
      } else if (findCustomerByCode_(customers, newCustomerCode)) {
        result = { ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' };
      } else {
        customers.push([newCustomerCode, customer, manager]);
        createdCustomerCode = newCustomerCode;
      }
    }

    if (!result) {
      if (itemId) {
        const idx = items.findIndex(function (r) { return String(r[0]).trim() === String(itemId).trim(); });
        if (idx === -1) {
          result = { ok: false, error: 'ITEM_NOT_FOUND' };
        } else {
          items[idx] = [items[idx][0], customer, itemName, manager, team, materials, status, items[idx][7]];
          result = { ok: true, itemId: itemId, mode: 'updated' };
        }
      } else if (materialCode === '__SIMULATE_THROW__') {
        throw new Error('SIMULATED_SHEETS_ERROR');
      } else if (getItemById_(items, materialCode)) {
        result = { ok: false, error: 'MATERIAL_CODE_ALREADY_EXISTS' };
      } else {
        items.push([materialCode, customer, itemName, manager, team, materials, status, nowValue]);
        result = { ok: true, itemId: materialCode, mode: 'created' };
      }
    }
  } catch (err) {
    // Code.gs 3222~3225행: 등록/수정 로직 중 예기치 못한 예외가 나도 여기서 삼키고, 아래
    // 롤백 로직(이 catch 블록 바깥, try 블록과 같은 레벨)으로 흘러가게 한다.
    result = { ok: false, error: 'SERVER_ERROR', detail: String(err) };
  }

  // Code.gs 3227~3241행: 이 검사는 위 try/catch *바깥*에 있다 — 즉 catch에서 SERVER_ERROR로
  // 바뀐 경우도 포함해서, result가 실패이고 createdCustomerCode가 있으면 항상 롤백을 시도한다.
  if (result && !result.ok && createdCustomerCode) {
    const ci = customers.findIndex(function (r) { return String(r[0]).trim() === String(createdCustomerCode).trim(); });
    if (ci !== -1) customers.splice(ci, 1);
  }

  return { result: result, customers: customers, items: items };
}

// Code.gs handleUpsertCustomer_ 포트. freshState = { customers }. 반환: { result, customers }.
function handleUpsertCustomer_(user, body, freshState) {
  if (user.role !== '팀장') {
    return { result: { ok: false, error: 'FORBIDDEN' }, customers: freshState.customers };
  }
  const name = String(body.name || '').trim();
  const code = String(body.code || '').trim();
  const manager = String(body.manager || '').trim();
  if (!name || !code) {
    return { result: { ok: false, error: 'MISSING_FIELDS' }, customers: freshState.customers };
  }

  const customers = freshState.customers.map(function (r) { return r.slice(); });
  if (findCustomerByName_(customers, name)) {
    return { result: { ok: false, error: 'CUSTOMER_ALREADY_EXISTS' }, customers: customers };
  }
  if (findCustomerByCode_(customers, code)) {
    return { result: { ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' }, customers: customers };
  }
  customers.push([code, name, manager]);
  return { result: { ok: true, code: code, name: name, manager: manager }, customers: customers };
}

module.exports = { handleUpsertItem_, handleUpsertCustomer_ };
