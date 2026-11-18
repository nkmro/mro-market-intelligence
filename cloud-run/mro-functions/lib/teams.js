// 팀장 겸임 (2026-11-18 재홍님 확정 ①-가): 사용자팀마스터 D열(소속팀) + L열(겸임팀, 쉼표로 여러 팀) = 그 사람이 맡은 팀 목록.
// - 겸임이 없으면 목록은 [소속팀] 하나 → 예전과 똑같이 동작(viewTeams가 문자열 그대로 돌려줌).
// - 시트 우선: 겸임팀은 L열에만 적는다(관리자 사용자 관리 화면 또는 시트에서 직접).
const EXTRA_COL = 11; // L열(0부터 셈)
function cell(v) { return String(v === undefined || v === null ? '' : v).trim(); }
// L열 값 → 팀 이름 목록. 쉼표·가운뎃점·빗금 모두 나눔("영업지원,소싱" / "영업지원·소싱")
function splitTeams(v) { return cell(v).split(/[,，、·\/]/).map(function (s) { return s.trim(); }).filter(Boolean); }
// 소속팀 + 겸임팀(중복 없이, 소속팀이 맨 앞)
function teamsOf(team, extra) {
  const out = [];
  [cell(team)].concat(splitTeams(extra)).forEach(function (t) { if (t && out.indexOf(t) < 0) out.push(t); });
  return out;
}
// 팀 비교: 둘 다 문자열이면 예전과 같은 엄격 비교(===), 한쪽이라도 목록이면 겹치는 팀이 있는지(앞뒤 공백 무시)
function teamsMatch(a, b) {
  if (!Array.isArray(a) && !Array.isArray(b)) return a === b;
  const A = (Array.isArray(a) ? a : [a]).map(cell).filter(Boolean), B = (Array.isArray(b) ? b : [b]).map(cell).filter(Boolean);
  return A.some(function (x) { return B.indexOf(x) >= 0; });
}
// 사람(rowsToUsers 결과 등) → 비교에 쓸 팀 값. 겸임이 있으면 목록, 없으면 소속팀 문자열 그대로(예전과 같음)
function viewTeams(u) { return u && Array.isArray(u.teams) && u.teams.length > 1 ? u.teams : (u ? u.team : undefined); }
module.exports = { EXTRA_COL, splitTeams, teamsOf, teamsMatch, viewTeams };
