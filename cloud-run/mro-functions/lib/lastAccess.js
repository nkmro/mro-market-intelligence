// 사용자 현황 "최종 접속" (2026-11-16, 재홍님 요청·승인 C안)
// - 기록 위치: 사용자팀마스터 K열 '최종접속'(시트 우선 — 재홍님이 K1 제목을 직접 넣음)
// - 기록 시점: whoamiTest(앱을 열 때·새로고침·로그인 직후·백그라운드 복귀 때 호출)
// - 같은 세션(기기)에서는 1시간에 최대 1번만 시트에 쓴다(쓰기 횟수·요금 억제).
// 이 파일은 시트·Firestore를 직접 건드리지 않는 순수 함수만 둔다(테스트용).
const LAST_ACCESS_COL = 'K';
const LAST_ACCESS_COL_INDEX = 10; // A=0 … K=10
const LAST_ACCESS_INTERVAL_MS = 60 * 60 * 1000;

// Firestore Timestamp / Date / ms 숫자 → ms. 없거나 못 읽으면 null.
function toMs_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}

// 세션 문서의 lastAccessMarkedAt 기준으로 이번에 시트에 써야 하는지.
function shouldMark(markedAtRaw, nowMs) {
  const m = toMs_(markedAtRaw);
  if (m === null) return true;
  return !(nowMs - m < LAST_ACCESS_INTERVAL_MS && nowMs >= m);
}

// 사용자팀마스터 한 행(UNFORMATTED 값)에서 K열 → ms(없으면 null).
function readFromRow(row, sheetSerialToMs) {
  if (!row || row.length <= LAST_ACCESS_COL_INDEX) return null;
  return sheetSerialToMs(row[LAST_ACCESS_COL_INDEX]);
}

module.exports = { LAST_ACCESS_COL, LAST_ACCESS_COL_INDEX, LAST_ACCESS_INTERVAL_MS, shouldMark, readFromRow };
