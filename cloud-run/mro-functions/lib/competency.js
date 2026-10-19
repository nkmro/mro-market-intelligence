// cloud-run/mro-functions/lib/competency.js
//
// 역량평가(인사평가) 공용 정의·순수 함수. 설계서 COMPETENCY_EVAL_CLOUDRUN_DESIGN_v1.md(v1.5) 기준.
// 1단계-가(ping)에서는 "인사평가 파일 주소 찾기 + 탭 머리글 점검"에만 쓴다.
// 시트를 직접 읽거나 쓰지 않는다(입출력은 index.js의 getCompetencyTest가 담당).

// 4-2절: 기록 탭 5개 (탭 이름은 시트 그대로)
const RECORD_TABS = [
  { key: 'selfDev',   tab: '역량-직무별전문성-자기개발' },
  { key: 'gradeComp', tab: '역량-직급별업무역량-직급역량개선노력' },
  { key: 'faceSales', tab: '역량-영업수행역량-대면영업' },
  { key: 'costSave',  tab: '역량-개선기획역량-원가개선제안' },
  { key: 'addSales',  tab: '역량-개선기획역량-추가매출계획이행' }
];
const CRITERIA_TAB = 'CRM-역량평가-기준';      // 4-4절
const SETTINGS_TAB = '인사평가설정';            // 4-5절 (인사평가 파일 안)
// 4-3절: 각 기록 탭 끝에 붙인 6칸 (이름·순서 고정)
const EXTRA_HEADERS = ['기록ID', '작성자이메일', '기록일시', '수정일시', '팀장한줄의견', '첨부'];
// MRO 본 시트 '설정' 탭의 인사평가 파일 주소 키 (4-5절): 인사평가파일_{연도}
const FILE_KEY_PREFIX = '인사평가파일_';

// 서울 시간 기준 연도 (6-3절: 기본 연도 = 오늘 날짜의 연도)
function seoulYear(nowMs) {
  return new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000).getUTCFullYear();
}

// '설정' 탭 행 배열(A2:C)에서 해당 연도 파일 ID를 찾는다. 없으면 null (추측하지 않음).
function findFileId(settingRows, year) {
  const key = FILE_KEY_PREFIX + year;
  for (let i = 0; i < settingRows.length; i++) {
    const r = settingRows[i] || [];
    if (String(r[0] || '').trim() === key) {
      const v = String(r[1] || '').trim();
      return v || null;
    }
  }
  return null;
}

// 시트 이름에 '-' 등이 있어 A1 표기에서 항상 작은따옴표로 감싼다.
function quoteTab(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

// 머리글 1행 점검: 6칸이 이름·순서 그대로 연속해 있는지
function checkHeaderRow(headerRow) {
  const h = (headerRow || []).map(function (v) { return String(v === undefined ? '' : v).trim(); });
  let last = -1;
  h.forEach(function (v, i) { if (v) last = i; });
  const start = h.indexOf(EXTRA_HEADERS[0]);
  const tail = start >= 0 ? h.slice(start, start + EXTRA_HEADERS.length) : [];
  const ok = start >= 0 && JSON.stringify(tail) === JSON.stringify(EXTRA_HEADERS) && start + EXTRA_HEADERS.length - 1 === last;
  const missing = EXTRA_HEADERS.filter(function (n) { return h.indexOf(n) === -1; });
  return { ok: ok, headerCount: last + 1, extraStartIndex: start, missing: missing };
}

module.exports = {
  RECORD_TABS, CRITERIA_TAB, SETTINGS_TAB, EXTRA_HEADERS, FILE_KEY_PREFIX,
  seoulYear, findFileId, quoteTab, checkHeaderRow
};
