// cloud-run/mro-functions/index.js의 exports.getThreadSeenTest 안에서 실제로 seenMap을 만드는
// 부분만(세션 인증/Sheets API 호출부는 제외) 그대로 옮긴 것. 원본:
//
// const rows = (resp.data && resp.data.values) || [];
// const seenMap = {};
// rows.forEach(function (row) {
//   if (String(row[0]).toLowerCase() === String(email).toLowerCase()) {
//     seenMap[row[1] + '-' + row[2]] = row[3];
//   }
// });
//
// Sheets API values.get이 돌려주는 rows 모양(헤더 제외, A2:D부터 시작하는 2차원 배열)과
// apps_script_ref.js에 넘기는 rows 모양이 동일하므로 같은 입력으로 비교할 수 있다.
function getThreadSeenTestSeenMap_(email, rows) {
  const seenMap = {};
  rows.forEach(function (row) {
    if (String(row[0]).toLowerCase() === String(email).toLowerCase()) {
      seenMap[row[1] + '-' + row[2]] = row[3];
    }
  });
  return seenMap;
}

module.exports = { getThreadSeenTestSeenMap_ };
