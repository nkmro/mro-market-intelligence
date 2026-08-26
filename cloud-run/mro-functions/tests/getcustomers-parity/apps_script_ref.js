// Code.gs의 handleGetCustomers_(3488~3501행)를 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본:
//
// function handleGetCustomers_(user, body) {
//   if (user.role !== '팀장') {
//     return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
//   }
//   const data = getSheetValues_('고객사마스터');
//   const customers = [];
//   for (let i = 1; i < data.length; i++) {
//     const row = data[i];
//     if (!row[1]) continue;
//     customers.push({ code: row[0], name: row[1], manager: row[2] });
//   }
//   return jsonResponse_({ ok: true, customers: customers });
// }
//
// [패리티 주의] 빈 행 제외 기준이 row[1](B열=name)이다 — row[0](A열=code)이 아니다.
// getSheetValues_는 헤더 포함 배열을 돌려줘 원본은 data[1]부터 순회하지만, 여기서는
// (getitems-parity와 동일하게) 헤더를 뺀 데이터 행 배열을 받아 rows[0]부터 순회한다.
function handleGetCustomers_(user, rows) {
  if (user.role !== '팀장') {
    return { ok: false, error: 'FORBIDDEN' };
  }
  const customers = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[1]) continue;
    customers.push({ code: row[0], name: row[1], manager: row[2] });
  }
  return { ok: true, customers: customers };
}

module.exports = { handleGetCustomers_ };
