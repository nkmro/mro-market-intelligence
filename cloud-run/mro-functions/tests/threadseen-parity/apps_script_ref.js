// Code.gs의 getThreadSeenMap_(email)을 한 글자도 다르지 않게 옮긴 참조 구현.
// 원본(apps-script/Code.gs, 3383행):
//
// function getThreadSeenMap_(email) {
//   const data = getSheetValues_(SHEET_THREAD_SEEN);
//   const map = {};
//   for (let i = 1; i < data.length; i++) {
//     if (String(data[i][0]).toLowerCase() === String(email).toLowerCase()) {
//       map[data[i][1] + '-' + data[i][2]] = data[i][3];
//     }
//   }
//   return map;
// }
//
// 여기서는 getSheetValues_(시트 읽기)를 걷어내고, 시트에서 읽어온 것과 동일한 모양의 2차원 배열
// (header 제외, data[0]부터가 첫 데이터 행 — 원본의 data[1]부터 시작하는 것과 동일하게 맞추기
// 위해 이 함수에는 헤더 행 없이 데이터 행만 넘긴다)을 그대로 입력으로 받는다.
function getThreadSeenMap_(email, rows) {
  const map = {};
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === String(email).toLowerCase()) {
      map[rows[i][1] + '-' + rows[i][2]] = rows[i][3];
    }
  }
  return map;
}

module.exports = { getThreadSeenMap_ };
