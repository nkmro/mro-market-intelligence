// cloud-run/mro-functions/index.js의 exports.getCustomersTest 안에서 실제로 customers를
// 걸러내는 부분만(세션 인증/Sheets API 호출부는 제외) 그대로 옮긴 것. rowsToCustomers는
// lib/sheetsClient.js의 실제 구현과 동일하게 여기 다시 옮겨 적었다.
function rowsToCustomers(rows) {
  return rows.map(function (row) {
    return { code: row[0], name: row[1], manager: row[2] };
  });
}

function getCustomersTestResult_(viewer, rawCustomerRows) {
  if (viewer.role !== '팀장') {
    return { ok: false, error: 'FORBIDDEN' };
  }
  const customers = rowsToCustomers(rawCustomerRows.filter(function (row) { return !!row[1]; }));
  return { ok: true, customers: customers };
}

module.exports = { getCustomersTestResult_ };
