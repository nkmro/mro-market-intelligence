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

// =====================================================================
// 1단계-나 (보기 기능) — 순수 함수. 설계서 v1.5 2-2(보기 권한)·4-3(백필 매칭)·⑫(퇴사자) 기준.
// =====================================================================
// 탭별 "작성자 이름" 칸 (추가매출만 '담당', 나머지는 '이름') — 2026-10-19 머리글 [확인]
const NAME_HEADER = { addSales: '담당' };
const MEMBER_ROLES = ['일반', '담당'];

function normName(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ''); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

// 시트 한 탭(1행=머리글)을 기록 객체 배열로. 이름 칸이 빈 줄은 건너뜀(4-2절).
function parseTab(tabKey, values) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  const nameCol = header.indexOf(NAME_HEADER[tabKey] || '이름');
  const col = function (n) { return header.indexOf(n); };
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = nameCol >= 0 ? String(row[nameCol] === undefined ? '' : row[nameCol]).trim() : '';
    if (!name) continue;
    const fields = {};
    header.forEach(function (h, i) { if (h) fields[h] = row[i] === undefined ? '' : row[i]; });
    out.push({
      tab: tabKey, row: r + 1, name: name,
      recordId: String(fields['기록ID'] || ''), authorEmail: normEmail(fields['작성자이메일']),
      recordedAt: String(fields['기록일시'] || ''), office: String(fields['사무소'] || ''),
      leaderOpinion: String(fields['팀장 의견'] || fields['팀장 의견 (상중하)'] || ''),
      fields: fields
    });
  }
  return out;
}

// 작성자 판정: 작성자이메일이 있으면 그것으로, 없으면 이름(띄어쓰기 무시)이 정확히 1명일 때만.
// 반환 user 또는 null. 동명이인(2명 이상)·미등록은 null → "판정 불가"(퇴사 처리 대상과 같이 취급하지 않고 별도 표시).
function resolveAuthor(rec, users) {
  if (rec.authorEmail) {
    return users.find(function (u) { return normEmail(u.email) === rec.authorEmail; }) || null;
  }
  const hits = users.filter(function (u) { return normName(u.name) && normName(u.name) === normName(rec.name); });
  return hits.length === 1 ? hits[0] : null;
}
function authorStatus(user) { return !user ? 'unresolved' : (user.status === '활성' ? 'active' : 'left'); }

// v1.7 ⑳: 기록 하나의 처리 상태.
// - 추가매출(addSales): '달성 여부 (Y/N)' 칸이 비면(공백 제거 후) 'awaitingReply'(팀원 회신 대기),
//   채워졌고(Y·N 모두 회신) '팀장 의견'이 비면 'pendingReview'(팀장 확인 대기), 둘 다 있으면 'done'.
// - 나머지 4개 탭: 기존 규칙 그대로 — '팀장 의견'이 비면 'pendingReview', 있으면 'done'.
const ADD_SALES_REPLY_HEADER = '달성 여부 (Y/N)'; // 2026-10-19 1행 직접 확인 [설계서 ⑳]
function reviewState(rec) {
  if (rec.tab === 'addSales') {
    const reply = String((rec.fields || {})[ADD_SALES_REPLY_HEADER] === undefined ? '' : rec.fields[ADD_SALES_REPLY_HEADER]).trim();
    if (!reply) return 'awaitingReply';
  }
  return rec.leaderOpinion ? 'done' : 'pendingReview';
}

function publicRecord(rec, user) {
  return { tab: rec.tab, row: rec.row, recordId: rec.recordId, name: rec.name,
    authorEmail: user ? normEmail(user.email) : (rec.authorEmail || ''), authorStatus: authorStatus(user),
    office: rec.office, recordedAt: rec.recordedAt, leaderOpinion: rec.leaderOpinion, reviewState: reviewState(rec), fields: rec.fields };
}

function monthOf(recordedAt) {
  const m = String(recordedAt || '').match(/^\d{4}-(\d{2})/);
  return m ? Number(m[1]) : 0; // 0 = 기록일시 없음(기존 기록, ⑤)
}

// view=mine: 본인 기록 전체 + 우리 팀 건수표(활성 일반·담당, 건수만 — 내용·팀장 의견 없음)
// v1.7 ⑳: awaitingReply = 본인 추가매출 중 회신 대기 개수(본인 숫자만, 팀 건수표에는 넣지 않음)
function buildMine(viewer, users, recordsByTab) {
  const mine = {}; const counts = {}; let awaitingReply = 0;
  const team = users.filter(function (u) { return u.status === '활성' && MEMBER_ROLES.indexOf(u.role) >= 0 && String(u.team || '').trim() === String(viewer.team || '').trim(); });
  team.forEach(function (u) { counts[normEmail(u.email)] = { name: u.name, office: u.office || '', byTab: {} }; });
  Object.keys(recordsByTab).forEach(function (tab) {
    mine[tab] = [];
    recordsByTab[tab].forEach(function (rec) {
      const user = resolveAuthor(rec, users);
      if (user && normEmail(user.email) === normEmail(viewer.email)) {
        mine[tab].push(publicRecord(rec, user));
        if (reviewState(rec) === 'awaitingReply') awaitingReply++;
      }
      if (user && counts[normEmail(user.email)]) {
        const c = counts[normEmail(user.email)].byTab; c[tab] = (c[tab] || 0) + 1;
      }
    });
  });
  return { records: mine, teamCounts: Object.keys(counts).map(function (k) { return counts[k]; }), awaitingReply: awaitingReply };
}

// view=team: 팀장=자기 팀 일반·담당 / 임원=전체 일반·담당. 그 외 역할은 호출부에서 FORBIDDEN.
// 퇴사(비활성)·판정 불가 기록은 includeLeft=true일 때만. 판정 불가(팀을 알 수 없음)는 임원·관리자에게만.
function buildTeam(viewer, users, recordsByTab, opts) {
  opts = opts || {};
  const isExec = viewer.role === '임원';
  const inScope = function (u) {
    return MEMBER_ROLES.indexOf(u.role) >= 0 && (isExec || String(u.team || '').trim() === String(viewer.team || '').trim());
  };
  const members = {};
  users.filter(function (u) { return inScope(u) && (u.status === '활성' || opts.includeLeft); }).forEach(function (u) {
    members[normEmail(u.email)] = { name: u.name, email: normEmail(u.email), team: u.team, office: u.office || '', status: u.status === '활성' ? 'active' : 'left', byTab: {}, byMonth: {}, pendingReview: 0, awaitingReply: 0 };
  });
  const records = []; const unresolved = [];
  Object.keys(recordsByTab).forEach(function (tab) {
    recordsByTab[tab].forEach(function (rec) {
      const user = resolveAuthor(rec, users);
      if (!user) { if (opts.includeLeft && (isExec || opts.isAdmin)) unresolved.push(publicRecord(rec, null)); return; }
      const m = members[normEmail(user.email)];
      if (!m) return;
      records.push(publicRecord(rec, user));
      m.byTab[tab] = (m.byTab[tab] || 0) + 1;
      const mo = monthOf(rec.recordedAt); m.byMonth[mo] = (m.byMonth[mo] || 0) + 1;
      if (m.status === 'active') { // 퇴사자 기록은 보기 전용 — 둘 다 세지 않음(⑫)
        const st = reviewState(rec);
        if (st === 'pendingReview') m.pendingReview++;
        else if (st === 'awaitingReply') m.awaitingReply++;
      }
    });
  });
  return { members: Object.keys(members).map(function (k) { return members[k]; }), records: records, unresolved: unresolved };
}

// 기준 탭: 값이 있는 줄만 원본 그대로(화면에서 그림). 시트 구조 해석은 화면 단계에서.
// v1.6 (설계서 4-4·⑱): 팀별 기준 탭(선택). 'CRM-역량평가-기준_서부'처럼 기본 탭 이름 + '_' + 팀 이름 탭이
// 파일에 있으면 그 탭, 없으면 기본 탭. tabTitles = 파일의 탭 이름 배열.
function pickCriteriaTab(tabTitles, team) {
  const t = String(team || '').trim();
  const special = CRITERIA_TAB + '_' + t;
  return (t && (tabTitles || []).indexOf(special) >= 0) ? special : CRITERIA_TAB;
}

// ① (2026-10-20 재홍님 결정): 평가 기준 화면 "기록 있음" 자동 인식.
// 파일의 탭 이름 중 '역량-'으로 시작하는 탭을 기록 탭으로 보고, 마지막 '-' 뒤(세부 항목 이름)만 돌려준다.
// 예: '역량-직무별전문성-자기개발' → '자기개발'. 기준 탭(CRM-…)·설정 탭은 '역량-'으로 시작하지 않아 빠진다.
function recordItemsFromTabs(tabTitles) {
  return (Array.isArray(tabTitles) ? tabTitles : []).map(function (t) { return String(t || '').trim(); })
    .filter(function (t) { return t.indexOf('역량-') === 0; })
    .map(function (t) { return t.slice(t.lastIndexOf('-') + 1).trim(); })
    .filter(function (x) { return x !== ''; });
}

function criteriaRows(values) {
  return (values || []).map(function (r) { return (r || []).map(function (v) { return String(v === undefined ? '' : v).trim(); }); })
    .filter(function (r) { return r.join('') !== ''; });
}

module.exports.NAME_HEADER = NAME_HEADER;
module.exports.MEMBER_ROLES = MEMBER_ROLES;
module.exports.parseTab = parseTab;
module.exports.resolveAuthor = resolveAuthor;
module.exports.buildMine = buildMine;
module.exports.buildTeam = buildTeam;
module.exports.criteriaRows = criteriaRows;
module.exports.monthOf = monthOf;
module.exports.pickCriteriaTab = pickCriteriaTab;
module.exports.reviewState = reviewState;
module.exports.ADD_SALES_REPLY_HEADER = ADD_SALES_REPLY_HEADER;
module.exports.recordItemsFromTabs = recordItemsFromTabs;
