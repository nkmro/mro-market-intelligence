// cloud-run/mro-functions/lib/sheetsClient.js
//
// Sheets 읽기 공통화. pollSignalTest가 이미 쓰던 GoogleAuth 클라이언트 생성 +
// values:batchGet 호출 패턴을 일반화하고, 시트 행 배열 -> 객체 배열 변환(사용자팀마스터/
// 시황게시물/품목마스터/댓글/설정)을 한 곳에 모았다. 캐시/재시도/hedge는 두지 않는다
// (기존 모든 Cloud Run 함수와 동일한 설계 원칙 — cloud-run/README.md 참고).
//
// 날짜 처리 원칙(중요): 이 파일은 "읽기"만 책임진다. 시황게시물.createdAt/품목마스터.
// registeredAt/댓글.createdAt/사용자팀마스터.lastCheckedAt 4개 열은 실제 Date 셀이라
// Sheets API가 UNFORMATTED_VALUE로 시리얼 넘버를 돌려주지만, 이 파일은 그 값을 그대로
// (*Raw 접미사로) 넘기기만 하고 ms/ISO 변환은 하지 않는다 — 변환은 lib/feedEngine.js
// (판정 시 비교용 ms)와 lib/feedResponses.js(응답 노출용 ISO 문자열)가 각자 필요한
// 시점에 한다.

const { GoogleAuth } = require('google-auth-library');

async function getSheetsClient() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  return auth.getClient();
}

// ranges: encodeURIComponent 처리된 A1 범위 문자열 배열 (예: ['시트!A2:I', ...])
// opts.unformatted: true면 valueRenderOption=UNFORMATTED_VALUE (날짜를 시리얼 넘버로 받기 위함).
// 반환: resp.data.valueRanges 배열 그대로 (각 원소.values가 행 배열).
async function batchGetValues(client, spreadsheetId, ranges, opts) {
  opts = opts || {};
  let url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?` +
    ranges.map(function (r) { return 'ranges=' + r; }).join('&');
  if (opts.unformatted) url += '&valueRenderOption=UNFORMATTED_VALUE';
  const resp = await client.request({ url });
  return (resp.data && resp.data.valueRanges) || [];
}

// 사용자팀마스터 (!A2:I) : email,name,role,team,status,lastCheckedAt(F),... (G/H는 이번 범위에서 안 씀)
function rowsToUsers(rows) {
  return rows.map(function (row) {
    return {
      email: row[0],
      name: row[1],
      role: row[2],
      team: row[3],
      status: row[4],
      lastCheckedAtRaw: row[5]
    };
  });
}

// 시황게시물 (!A2:H) : id,materialCode,materialName,title,summary,link,pubDate,createdAt(H)
function rowsToPosts(rows) {
  return rows.map(function (row) {
    return {
      id: row[0],
      materialCode: row[1],
      materialName: row[2],
      title: row[3],
      summary: row[4],
      link: row[5],
      pubDate: row[6],
      createdAtRaw: row[7]
    };
  });
}

// 품목마스터 (!A2:H) : itemId,customer,itemName,manager,team,materials,status,registeredAt(H)
function rowsToItems(rows) {
  return rows.map(function (row) {
    return {
      itemId: String(row[0]),
      customer: row[1],
      itemName: row[2],
      manager: row[3],
      team: row[4],
      materials: row[5],
      status: row[6],
      registeredAtRaw: row[7]
    };
  });
}

// 댓글 (!A2:I) : commentId,postId,itemId,authorEmail,authorName,authorRole,parentCommentId,content,createdAt(I)
function rowsToComments(rows) {
  return rows.map(function (row) {
    return {
      commentId: row[0],
      postId: row[1],
      itemId: row[2],
      authorEmail: row[3],
      authorName: row[4],
      authorRole: row[5],
      parentCommentId: row[6],
      content: row[7],
      createdAtRaw: row[8]
    };
  });
}

// 설정 (!A2:C) : key,value,description -> { key: value } 딕셔너리 (description은 이번 4개
// 함수가 쓰지 않으므로 담지 않음 — getSettingsTest는 이번 범위 밖이라 그대로 둠).
function parseSettings(rows) {
  const settings = {};
  rows.forEach(function (row) {
    if (!row[0]) return;
    settings[row[0]] = row[1];
  });
  return settings;
}

module.exports = {
  getSheetsClient,
  batchGetValues,
  rowsToUsers,
  rowsToPosts,
  rowsToItems,
  rowsToComments,
  parseSettings
};
