// cloud-run/mro-functions/lib/competency.js
//
// 역량평가(인사평가) 공용 정의·순수 함수. 설계서 COMPETENCY_EVAL_CLOUDRUN_DESIGN_v1.md(v1.5) 기준.
// 1단계-가(ping)에서는 "인사평가 파일 주소 찾기 + 탭 머리글 점검"에만 쓴다.
// 시트를 직접 읽거나 쓰지 않는다(입출력은 index.js의 getCompetencyTest가 담당).

// v1.11 (설계서 4-2-1, ㉒): 기록 탭은 고정 목록이 아니라 인사평가 파일에서 '역량-'으로 시작하는 탭을 자동으로 읽는다.
// 아래는 배포 전환 호환용: 지금 5개 탭의 gid(4-2 표 [확인]) → 기존 응답 키. 그 밖의 탭은 'g' + gid.
const LEGACY_TAB_KEYS = { '0': 'selfDev', '1406147068': 'gradeComp', '1204504857': 'faceSales', '1981522387': 'costSave', '772700407': 'addSales' };
// 지금 5개 탭의 카드 제목 칸(4-2 표). 새 탭은 사무소·이름·담당·순번·앱 관리 칸 다음 첫 번째 칸.
const LEGACY_TITLE_FIELD = { selfDev: '자기개발 항목', gradeComp: '개선 직급 역량 항목', faceSales: '고객사', costSave: '원가 개선 항목', addSales: '고객사' };
const RECORD_TAB_PREFIX = '역량-';
const TAB_EMOJI_PREFIX = '탭이모지_';   // 인사평가설정 키: 탭이모지_<항목 이름>
const DEFAULT_TAB_EMOJI = '📝';
const TAB_LABEL_MAX = 4;               // 탭 끝 이름 권장 길이(넘으면 ping 경고만)
const TAB_META_TTL_MS = 5 * 60 * 1000; // 시트 정보(탭 이름·gid·숨김·순서) 서버 메모리 저장 시간
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
  CRITERIA_TAB, SETTINGS_TAB, EXTRA_HEADERS, FILE_KEY_PREFIX,
  LEGACY_TAB_KEYS, LEGACY_TITLE_FIELD, RECORD_TAB_PREFIX, TAB_EMOJI_PREFIX, DEFAULT_TAB_EMOJI, TAB_LABEL_MAX, TAB_META_TTL_MS,
  seoulYear, findFileId, quoteTab, checkHeaderRow
};

// =====================================================================
// 1단계-나 (보기 기능) — 순수 함수. 설계서 v1.5 2-2(보기 권한)·4-3(백필 매칭)·⑫(퇴사자) 기준.
// =====================================================================
const MEMBER_ROLES = ['일반', '담당'];

function normName(s) { return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ''); }
function normEmail(s) { return String(s || '').trim().toLowerCase(); }

// 시트 한 탭(1행=머리글)을 기록 객체 배열로. 이름 칸이 빈 줄은 건너뜀(4-2절).
function parseTab(tabKey, values) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  // v1.11: 작성자 이름 칸 = '이름', 없으면 '담당'(추가매출 탭) — 탭 이름이 아니라 머리글로 정한다
  const nameCol = header.indexOf('이름') >= 0 ? header.indexOf('이름') : header.indexOf('담당');
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
// v1.11: 회신 대기 규칙은 탭 이름이 아니라 '달성 여부 (Y/N)' 칸이 있는 탭에 적용(4-2-1).
function reviewState(rec) {
  if (Object.prototype.hasOwnProperty.call(rec.fields || {}, ADD_SALES_REPLY_HEADER)) {
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
      // v1.15: 건수는 '한 일'만 — 달성 여부 칸이 빈 줄(계획만 있는 줄, awaitingReply)은 세지 않는다(2026-10-26 재홍님 결정).
      if (user && counts[normEmail(user.email)] && reviewState(rec) !== 'awaitingReply') {
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
      const st = reviewState(rec);
      // v1.15: 종류별·월별 건수는 '한 일'만 — 계획만 있는 줄(awaitingReply)은 빼고, 미이행(awaitingReply) 개수로만 센다. 기록 목록(records)은 그대로.
      if (st !== 'awaitingReply') {
        m.byTab[tab] = (m.byTab[tab] || 0) + 1;
        const mo = monthOf(rec.recordedAt); m.byMonth[mo] = (m.byMonth[mo] || 0) + 1;
      }
      if (m.status === 'active') { // 퇴사자 기록은 보기 전용 — 둘 다 세지 않음(⑫)
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

// =====================================================================
// 1단계-라-마 (설계서 v1.11 4-2-1·㉒): 기록 탭 자동 인식 — 순수 함수
// =====================================================================
// '역량-<역량 이름>-<항목 이름>' → { group, label }. 형식이 아니면 null. 항목 이름 = 마지막 '-' 뒤.
function splitRecordTabTitle(title) {
  const s = String(title === undefined || title === null ? '' : title).trim();
  if (s.indexOf(RECORD_TAB_PREFIX) !== 0) return null;
  const rest = s.slice(RECORD_TAB_PREFIX.length);
  const i = rest.lastIndexOf('-');
  const label = (i >= 0 ? rest.slice(i + 1) : rest).trim();
  if (!label) return null;
  return { group: i >= 0 ? rest.slice(0, i).trim() : '', label: label };
}
// 시트 정보(spreadsheets.get fields=sheets.properties(sheetId,title,hidden,index))의 sheets 배열 →
// 기록 탭 목록. 숨긴 탭 제외, 시트 탭 순서(index). title은 A1 범위에 쓰는 원래 이름 그대로.
function recordTabsFromSheets(sheets) {
  return (Array.isArray(sheets) ? sheets : []).map(function (sh) { return (sh && sh.properties) || {}; })
    .filter(function (p) { return !p.hidden && splitRecordTabTitle(p.title); })
    .sort(function (a, b) { return (Number(a.index) || 0) - (Number(b.index) || 0); })
    .map(function (p) {
      const parts = splitRecordTabTitle(p.title);
      const gid = String(p.sheetId === undefined || p.sheetId === null ? '' : p.sheetId);
      return { id: LEGACY_TAB_KEYS[gid] || ('g' + gid), gid: gid, title: String(p.title), group: parts.group, label: parts.label };
    });
}
// 인사평가설정 탭 행([키, 값, 설명]) → { 항목 이름: 이모지 }. 키 '탭이모지_<항목 이름>'.
function tabEmojis(settingsRows) {
  const out = {};
  (settingsRows || []).forEach(function (r) {
    const k = String((r && r[0]) || '').trim();
    const v = String((r && r[1]) || '').trim();
    if (k.indexOf(TAB_EMOJI_PREFIX) === 0 && k.length > TAB_EMOJI_PREFIX.length && v) out[k.slice(TAB_EMOJI_PREFIX.length).trim()] = v;
  });
  return out;
}
function normCriteria(s) { return String(s || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ''); }
// 기준 탭 줄(criteriaRows 결과) → [{ name: 역량 이름, items: [세부 항목 이름…] }]. B열 '- '가 역량, D열이 세부 항목.
// (화면 feed.html parseCompCriteria_와 같은 읽기 규칙)
function criteriaGroups(rows) {
  const out = []; let cur = null;
  (rows || []).forEach(function (r) {
    const c = function (i) { return String((r && r[i]) || '').trim(); };
    const b = c(1);
    if (b.charAt(0) === '■' || b.charAt(0) === '▶' || b === '계') { cur = null; return; }
    if (b.indexOf('- ') === 0) { cur = { name: b.slice(2).trim(), items: [] }; out.push(cur); }
    if (cur && c(3)) cur.items.push(c(3));
  });
  return out;
}
// 기준표 연결: 역량 이름이 같은 묶음(띄어쓰기·괄호 무시)에서 세부 항목 이름이 탭 항목 이름으로 시작하는 것이 딱 1개일 때만.
function linkCriteria(tab, groups) {
  const gs = (groups || []).filter(function (g) { return normCriteria(g.name) === normCriteria(tab && tab.group); });
  if (gs.length !== 1) return { count: 0, group: null, criteriaItem: null };
  const key = normCriteria(tab.label);
  const hits = key ? gs[0].items.filter(function (it) { return normCriteria(it).indexOf(key) === 0; }) : [];
  return { count: hits.length, group: gs[0].name, criteriaItem: hits.length === 1 ? hits[0] : null };
}
// 카드 제목 칸: 지금 5개는 4-2 표, 새 탭은 사람·관리 칸 다음 첫 번째 칸
function titleFieldOf(id, headerRow) {
  const h = (headerRow || []).map(function (v) { return String(v === undefined ? '' : v).trim(); });
  const legacy = LEGACY_TITLE_FIELD[id];
  if (legacy && h.indexOf(legacy) >= 0) return legacy;
  const skip = ['순번', '이름', '담당', '사무소'].concat(EXTRA_HEADERS);
  return h.filter(function (x) { return x && skip.indexOf(x) < 0; })[0] || '';
}
// 응답 tabs 배열: [{ id, gid, title, label, emoji, item, criteriaItem, hasReply, titleField }]
function describeTabs(recTabs, headerRowsById, settingsRows, criteriaRowsArr) {
  const emojis = tabEmojis(settingsRows);
  const groups = criteriaGroups(criteriaRowsArr);
  return (recTabs || []).map(function (t) {
    const header = (headerRowsById && headerRowsById[t.id]) || [];
    const link = linkCriteria(t, groups);
    return {
      id: t.id, gid: t.gid, title: t.title, label: t.label,
      emoji: emojis[t.label] || DEFAULT_TAB_EMOJI,
      item: link.criteriaItem ? link.group + ' › ' + link.criteriaItem : (t.group ? t.group + ' › ' + t.label : t.label),
      criteriaItem: link.criteriaItem,
      hasReply: header.map(function (v) { return String(v === undefined ? '' : v).trim(); }).indexOf(ADD_SALES_REPLY_HEADER) >= 0,
      titleField: titleFieldOf(t.id, header)
    };
  });
}
// 시트 정보 메모리 저장(키 = 파일 ID). now는 시험에서 바꿔 넣을 수 있게.
function makeTtlCache(ttlMs, now) {
  const m = new Map(); const clock = now || Date.now;
  return {
    get: function (k) { const e = m.get(k); if (!e) return null; if (clock() - e.at > ttlMs) { m.delete(k); return null; } return e.v; },
    set: function (k, v) { m.set(k, { v: v, at: clock() }); },
    del: function (k) { m.delete(k); }
  };
}

function criteriaRows(values) {
  return (values || []).map(function (r) { return (r || []).map(function (v) { return String(v === undefined ? '' : v).trim(); }); })
    .filter(function (r) { return r.join('') !== ''; });
}

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
// 인사평가 파일 읽기 순서(index.js에서 입출력 함수를 넣어 부른다 — 시험에서 가짜로 바꿔 넣을 수 있게).
// deps.meta(useCache) → { sheets, cached }, deps.batchGet(날 문자열 범위 배열) → valueRanges 배열,
// deps.invalidate() → 메모리 저장 지우기, deps.log(문자열).
// 저장해 둔 시트 정보로 읽다가 실패하면(탭 이름 변경·삭제 직후) 저장을 지우고 새로 읽어 1번만 다시 시도.
// 새로 읽은 시트 정보로도 실패하면 그대로 던진다(호출부가 SHEET_ACCESS_FAILED).
async function loadCompetencyFile(deps, opts) {
  const view = opts.view; const timings = opts.timings || {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const k0 = Date.now();
    let meta = null;
    try {
      meta = await deps.meta(attempt === 0);
    } catch (e) {
      if (view !== 'criteria') throw e;
      // 기준 보기는 예전처럼 시트 정보 없이 기본 기준 탭으로 진행("기록 있음"은 화면 고정 목록)
      if (deps.log) deps.log('시트 정보 읽기 실패(무시, 기본 기준 탭 사용): ' + String((e && e.message) || e).slice(0, 200));
    }
    timings.tabListMs = (timings.tabListMs || 0) + (Date.now() - k0);
    timings.tabListCached = !!(meta && meta.cached);
    const sheets = meta ? meta.sheets : [];
    const titles = sheets.map(function (sh) { return sh && sh.properties && sh.properties.title; });
    const recTabs = recordTabsFromSheets(sheets);
    const criteriaTab = pickCriteriaTab(titles, opts.team);
    // 읽을 범위: 기준 보기 = 기준 탭만(예전과 같음). 내 기록·팀 = 인사평가설정·기준 탭(파일에 있을 때만) + 기록 탭 전부.
    const wants = [];
    if (view === 'criteria') {
      wants.push({ name: 'criteria', range: quoteTab(criteriaTab) + '!A1:H60' });
    } else {
      if (titles.indexOf(SETTINGS_TAB) >= 0) wants.push({ name: 'settings', range: quoteTab(SETTINGS_TAB) + '!A1:C' });
      if (titles.indexOf(criteriaTab) >= 0) wants.push({ name: 'criteria', range: quoteTab(criteriaTab) + '!A1:H60' });
      recTabs.forEach(function (t) { wants.push({ name: 'tab:' + t.id, range: quoteTab(t.title) + '!A1:Z' }); });
    }
    try {
      const vr = wants.length ? await deps.batchGet(wants.map(function (w) { return w.range; })) : [];
      const byName = {};
      wants.forEach(function (w, i) { byName[w.name] = (vr[i] && vr[i].values) || []; });
      if (attempt === 1) timings.tabListRetried = true;
      return { recTabs: recTabs, criteriaTab: criteriaTab, metaOk: !!meta, ranges: wants.map(function (w) { return w.range; }), get: function (n) { return byName[n] || null; } };
    } catch (e) {
      if (attempt === 0 && meta && meta.cached) { deps.invalidate(); continue; }
      throw e;
    }
  }
}

module.exports.splitRecordTabTitle = splitRecordTabTitle;
module.exports.loadCompetencyFile = loadCompetencyFile;
module.exports.recordTabsFromSheets = recordTabsFromSheets;
module.exports.tabEmojis = tabEmojis;
module.exports.criteriaGroups = criteriaGroups;
module.exports.linkCriteria = linkCriteria;
module.exports.titleFieldOf = titleFieldOf;
module.exports.describeTabs = describeTabs;
module.exports.makeTtlCache = makeTtlCache;

// =====================================================================
// 2-가 (설계서 v1.19 4-3): 기존 기록 정리(backfill) — 순수 함수. 시트 입출력은 index.js saveCompetencyTest.
// 빈 칸만 채운다(이미 값이 있는 칸은 절대 덮어쓰지 않음). 기록일시는 비워 둔다(⑤ — 월별 표 '기존' 칸).
//   정상(이름이 사용자팀마스터에 딱 1명·활성, 또는 작성자이메일이 활성 사용자) → 기록ID·작성자이메일·팀
//   퇴사(비활성)·미등록·모르는 이메일 → 기록ID·팀만(작성자이메일 비움, 2-2 퇴사자 기록)
//   동명이인(같은 이름 2명 이상) → 채우지 않음, 따로 알림
// 팀 칸 = 기록할 때의 소속팀(v1.6). 기존 기록은 모두 동부(지금까지 동부 전용 파일, 2026-10-27 재홍님 확인).
// =====================================================================
const TEAM_HEADER = '팀';
const BACKFILL_TEAM = '동부';
const RECORD_ID_PREFIX = 'CE-';

// v1.19: '팀' 칸은 '기록ID' 바로 왼쪽(끝 6칸은 맨 끝 그대로 — checkHeaderRow). ping 경고·채우기 전 점검에 쓴다.
function checkTeamColumn(headerRow) {
  const h = (headerRow || []).map(function (v) { return String(v === undefined ? '' : v).trim(); });
  const teamIndex = h.indexOf(TEAM_HEADER); const idIndex = h.indexOf(EXTRA_HEADERS[0]);
  let warning = '';
  if (teamIndex < 0) warning = "'팀' 칸 없음('기록ID' 바로 왼쪽에 추가)";
  else if (h.lastIndexOf(TEAM_HEADER) !== teamIndex) warning = "'팀' 칸이 2개";
  else if (idIndex < 0 || teamIndex !== idIndex - 1) warning = "'팀' 칸 위치: '기록ID' 바로 왼쪽이 아님";
  return { ok: !warning, teamIndex: teamIndex, idIndex: idIndex, warning: warning };
}
// 0 → A, 25 → Z, 26 → AA
function colLetter(i) {
  let n = Number(i) + 1; let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// 서울 날짜 'YYYYMMDD'
function seoulDateStr(nowMs) {
  const d = new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000);
  return String(d.getUTCFullYear()) + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
}
// 기록ID: CE-YYYYMMDD-xxxx(4-3 표의 모양). taken(Set)에 없는 값이 나올 때까지 다시 뽑는다 — 파일 안에서 겹치지 않게.
// rand() → 0 이상 1 미만(시험에서 바꿔 넣음). 64번 안에 못 찾으면 8자리로 늘린다.
function makeRecordId(dateStr, taken, rand) {
  const r = rand || Math.random;
  for (let k = 0; k < 64; k++) {
    const id = RECORD_ID_PREFIX + dateStr + '-' + Math.floor(r() * 0x10000).toString(16).padStart(4, '0');
    if (!taken.has(id)) { taken.add(id); return id; }
  }
  for (;;) {
    const id = RECORD_ID_PREFIX + dateStr + '-' + Math.floor(r() * 0x100000000).toString(16).padStart(8, '0');
    if (!taken.has(id)) { taken.add(id); return id; }
  }
}
// 작성자 찾기(채우기용): resolveAuthor와 같은 규칙이지만 동명이인·미등록을 나눠서 돌려준다.
function backfillAuthor(rec, users) {
  if (rec.authorEmail) {
    const u = users.find(function (x) { return normEmail(x.email) === rec.authorEmail; });
    return u ? { status: u.status === '활성' ? 'ok' : 'left', user: u } : { status: 'unknownEmail', user: null };
  }
  const hits = users.filter(function (u) { return normName(u.name) && normName(u.name) === normName(rec.name); });
  if (hits.length === 0) return { status: 'unregistered', user: null, count: 0 };
  if (hits.length > 1) return { status: 'duplicate', user: null, count: hits.length };
  return { status: hits[0].status === '활성' ? 'ok' : 'left', user: hits[0] };
}
// tabs = [{ id, title, values }] (values = 'A1:Z' 그대로, 1행 머리글). users = 사용자팀마스터.
// 반환: headerProblems(있으면 채우기 금지) · writes([{ range, value, tab, row, col }]) · people · summary · duplicates.
function planBackfill(tabs, users, opts) {
  opts = opts || {};
  const team = opts.team || BACKFILL_TEAM;
  const dateStr = seoulDateStr(opts.nowMs);
  const headerProblems = []; const parsed = [];
  const taken = new Set();
  (tabs || []).forEach(function (t) {
    const header = ((t.values || [])[0]) || [];
    const hc = checkHeaderRow(header); const tc = checkTeamColumn(header);
    if (!hc.ok) headerProblems.push({ tab: t.title, problem: '끝 6칸(기록ID~첨부) 이름·순서가 맞지 않음' + (hc.missing.length ? ' — 없음: ' + hc.missing.join(', ') : '') });
    if (!tc.ok) headerProblems.push({ tab: t.title, problem: tc.warning });
    const recs = parseTab(t.id, t.values || []);
    recs.forEach(function (rec) { if (rec.recordId.trim()) taken.add(rec.recordId.trim()); });
    parsed.push({ t: t, header: header.map(function (v) { return String(v === undefined ? '' : v).trim(); }), recs: recs });
  });
  const writes = []; const people = {}; const duplicates = {};
  const summary = { rows: 0, ok: 0, left: 0, unregistered: 0, unknownEmail: 0, duplicate: 0, complete: 0, cells: { '기록ID': 0, '작성자이메일': 0, '팀': 0 } };
  parsed.forEach(function (p) {
    p.recs.forEach(function (rec) {
      summary.rows++;
      const a = backfillAuthor(rec, users);
      summary[a.status]++;
      const key = rec.name + '|' + a.status;
      if (!people[key]) people[key] = { name: rec.name, status: a.status, rows: 0, cells: 0 };
      people[key].rows++;
      if (a.status === 'duplicate') { duplicates[rec.name] = { name: rec.name, users: a.count, rows: (duplicates[rec.name] ? duplicates[rec.name].rows : 0) + 1 }; return; }
      const fill = [];
      const empty = function (h) { return !String(rec.fields[h] === undefined ? '' : rec.fields[h]).trim(); };
      if (empty('기록ID')) fill.push(['기록ID', function () { return makeRecordId(dateStr, taken, opts.rand); }]);
      if (a.status === 'ok' && empty('작성자이메일')) fill.push(['작성자이메일', function () { return normEmail(a.user.email); }]);
      if (empty(TEAM_HEADER)) fill.push([TEAM_HEADER, function () { return team; }]);
      if (!fill.length) { summary.complete++; return; }
      fill.forEach(function (f) {
        const col = p.header.indexOf(f[0]);
        if (col < 0) return; // 머리글 문제 → headerProblems에 이미 있음(채우기 금지)
        writes.push({ range: quoteTab(p.t.title) + '!' + colLetter(col) + rec.row, value: f[1](), tab: p.t.title, row: rec.row, col: f[0] });
        summary.cells[f[0]]++; people[key].cells++;
      });
    });
  });
  return {
    headerProblems: headerProblems, writes: writes, summary: summary,
    people: Object.keys(people).map(function (k) { return people[k]; }),
    duplicates: Object.keys(duplicates).map(function (k) { return duplicates[k]; }),
    canApply: headerProblems.length === 0
  };
}

module.exports.TEAM_HEADER = TEAM_HEADER;
module.exports.BACKFILL_TEAM = BACKFILL_TEAM;
module.exports.checkTeamColumn = checkTeamColumn;
module.exports.colLetter = colLetter;
module.exports.seoulDateStr = seoulDateStr;
module.exports.makeRecordId = makeRecordId;
module.exports.backfillAuthor = backfillAuthor;
module.exports.planBackfill = planBackfill;

// =====================================================================
// 2-나 (설계서 v1.20 ⑳·4-3): 추가매출 결과 적기(action reply) — 순수 함수. 시트 입출력은 index.js saveCompetencyTest.
// 팀원(일반·담당)이 본인 '계획' 줄(달성 여부 칸이 빈 줄)에 결과를 적는다. 빈 칸만 쓴다 — 이미 결과가 있으면 거부(고치기는 2-라).
//   Y 달성 : 달성 여부 · 실적 반영 시점(기간, 필수) · 당해년도 실적결산(매출·이익 천원, 필수) · 아이템키(숫자, 쉼표로 여러 개, 필수) · 수정일시
//   N 미달성: 달성 여부 · 수정일시 (시점·결산 칸은 건드리지 않음)
// 실적 반영 시점 = 'YYMM~YYMM'(끝 달까지) 또는 'YYMM~'(끝 없음, 계속) — 시트 머리글 '(YYMM~)' 모양 그대로(2026-10-27 재홍님 결정).
// ㉑ 날짜 검사는 하지 않는다(계획 줄이 이미 있음).
// =====================================================================
const REPLY_PERIOD_HEADER = '실적 반영 시점(YYMM~)';         // 2026-10-27 실제 1행 확인
const REPLY_SETTLE_HEADER = '당해년도 실적결산 (매출/이익)'; // 2026-10-27 실제 1행 확인
const MODIFIED_AT_HEADER = '수정일시';
const ITEM_KEY_HEADER = '아이템키';                         // 2026-10-27 재홍님이 추가매출·원가개선 탭 '팀장 의견' 앞에 추가(회사 시스템 키로 실적 추적)
const ITEM_KEY_MAX = 50;                                   // 한 줄에 키 50개·키 하나 30자리 넘으면 잘못 친 것으로 봄
const SETTLE_MAX = 1000000000; // 천원 단위 10억(= 1조원) 넘는 값은 잘못 친 것으로 봄

function validYymm(s) {
  const m = String(s === undefined || s === null ? '' : s).trim().match(/^(\d{2})(\d{2})$/);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}
// '3,200' · 3200 · ' 3200 ' → 3200. 정수가 아니면 null. allowNegative = 이익(손해일 수 있음)
function parseThousand(v, allowNegative) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[,\s]/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || Math.abs(n) > SETTLE_MAX) return null;
  if (n < 0 && !allowNegative) return null;
  return n;
}
// '1234567, 2345678 ,1234567' → '1234567,2345678' (숫자만 — 자릿수는 보지 않음, 같은 키는 하나로). 잘못되면 null.
function parseItemKeys(v) {
  const parts = String(v === undefined || v === null ? '' : v).split(',').map(function (x) { return x.trim(); });
  if (!parts.length || parts.some(function (x) { return !/^\d{1,30}$/.test(x); })) return null;
  const out = [];
  parts.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
  return out.length <= ITEM_KEY_MAX ? out.join(',') : null;
}
function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// 서울 시각 'YYYY-MM-DD HH:mm' (기록일시·수정일시 모양 — monthOf와 같은 앞부분)
function seoulDateTimeStr(nowMs) {
  const d = new Date((nowMs === undefined ? Date.now() : nowMs) + 9 * 3600 * 1000);
  const p = function (x) { return String(x).padStart(2, '0'); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
// 화면 입력 → 시트에 쓸 값. 반환 { ok:true, achieved, period, settle } 또는 { ok:false, error:'BAD_INPUT', field }
function validateReply(b) {
  b = b || {};
  const bad = function (field) { return { ok: false, error: 'BAD_INPUT', field: field }; };
  const achieved = String(b.achieved === undefined || b.achieved === null ? '' : b.achieved).trim().toUpperCase();
  if (achieved !== 'Y' && achieved !== 'N') return bad('achieved');
  if (achieved === 'N') return { ok: true, achieved: 'N', period: '', settle: '', itemKeys: '' };
  const from = String(b.reflectFrom || '').trim();
  const to = String(b.reflectTo || '').trim();
  const open = b.reflectOpen === true;
  if (!validYymm(from)) return bad('reflectFrom');
  if (open && to) return bad('reflectTo');
  if (!open && !to) return bad('reflectTo');
  if (to && (!validYymm(to) || to < from)) return bad('reflectTo');
  // 매출은 빈칸이면 null — 그 줄의 구분이 '이익개선'이면 매출 칸 없이 이익만(planReply가 시트의 구분을 보고 정함, 2026-10-27 재홍님)
  const salesBlank = String(b.settleSales === undefined || b.settleSales === null ? '' : b.settleSales).trim() === '';
  const sales = salesBlank ? null : parseThousand(b.settleSales, false);
  if (!salesBlank && sales === null) return bad('settleSales');
  const profit = parseThousand(b.settleProfit, true);
  if (profit === null) return bad('settleProfit');
  const itemKeys = parseItemKeys(b.itemKeys);
  if (itemKeys === null) return bad('itemKeys');
  return { ok: true, achieved: 'Y', period: from + '~' + to, itemKeys: itemKeys, sales: sales, profit: profit, open: open,
    settle: sales === null ? '' : settleText(sales, profit, open) };
}
// 당해년도 실적결산 글자. sales === null = 이익만(이익개선).
// 끝 없음(계속) = 한 달 평균 → '… / 월 평균', 끝 달 있음 = 기간 총액 (2026-10-27 재홍님, 원가개선과 같은 규칙)
function settleText(sales, profit, open) {
  const p = (profit < 0 ? '-' + comma(-profit) : comma(profit)) + '천원';
  return (sales === null ? '이익 ' + p : '매출 ' + comma(sales) + '천원 / 이익 ' + p) + (open ? ' / 월 평균' : '');
}
const PROFIT_ONLY_KIND = '이익개선'; // 추가매출 '구분' 값 — 매출이 늘지 않으므로 결산은 이익만
// 탭 값(A1:Z, 1행 머리글)에서 기록ID 줄을 찾아 쓸 칸을 정한다.
// 반환 { ok:true, writes:[{range,value}], record } 또는 { ok:false, error }
//   HEADER_NOT_READY  필요한 칸(기록ID·작성자이메일·수정일시·달성 여부·시점·결산, Y면 아이템키도) 중 없는 칸이 있음
//   RECORD_NOT_FOUND  그 기록ID 줄이 없음(지워졌거나 바뀜) · DUPLICATE_RECORD_ID 같은 기록ID가 2줄 이상
//   NOT_YOUR_RECORD   작성자이메일이 본인이 아님(비어 있는 줄 포함)
//   ALREADY_REPLIED   달성 여부가 이미 있음 · CELL_NOT_EMPTY Y인데 시점·결산·아이템키 칸에 이미 값이 있음(덮어쓰지 않음)
function planReply(tab, values, recordId, viewerEmail, v, nowMs) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  const need = [EXTRA_HEADERS[0], EXTRA_HEADERS[1], MODIFIED_AT_HEADER, ADD_SALES_REPLY_HEADER, REPLY_PERIOD_HEADER, REPLY_SETTLE_HEADER];
  if (v.achieved === 'Y') need.push(ITEM_KEY_HEADER);
  if (need.some(function (h) { return header.indexOf(h) < 0; })) return { ok: false, error: 'HEADER_NOT_READY' };
  const col = function (h) { return header.indexOf(h); };
  const cell = function (row, h) { const x = row[col(h)]; return String(x === undefined || x === null ? '' : x).trim(); };
  const rid = String(recordId || '').trim();
  const hits = [];
  for (let r = 1; r < rows.length; r++) { if (rid && cell(rows[r] || [], EXTRA_HEADERS[0]) === rid) hits.push(r); }
  if (!hits.length) return { ok: false, error: 'RECORD_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, error: 'DUPLICATE_RECORD_ID' };
  const r = hits[0]; const row = (rows[r] || []).slice();
  if (normEmail(cell(row, EXTRA_HEADERS[1])) !== normEmail(viewerEmail) || !normEmail(viewerEmail)) return { ok: false, error: 'NOT_YOUR_RECORD' };
  if (cell(row, ADD_SALES_REPLY_HEADER)) return { ok: false, error: 'ALREADY_REPLIED' };
  if (v.achieved === 'Y' && (cell(row, REPLY_PERIOD_HEADER) || cell(row, REPLY_SETTLE_HEADER) || cell(row, ITEM_KEY_HEADER))) return { ok: false, error: 'CELL_NOT_EMPTY' };
  // 결산: 구분이 이익개선이면 이익만, 그 밖(신규매출·품목확대 등)은 매출·이익 둘 다 필수
  let settle = v.settle;
  if (v.achieved === 'Y') {
    const profitOnly = col('구분') >= 0 && cell(row, '구분') === PROFIT_ONLY_KIND;
    if (profitOnly) settle = settleText(null, v.profit, v.open);
    else if (v.sales === null || v.sales === undefined) return { ok: false, error: 'BAD_INPUT', field: 'settleSales' };
  }
  const set = [[ADD_SALES_REPLY_HEADER, v.achieved]];
  if (v.achieved === 'Y') set.push([REPLY_PERIOD_HEADER, v.period], [REPLY_SETTLE_HEADER, settle], [ITEM_KEY_HEADER, v.itemKeys]);
  set.push([MODIFIED_AT_HEADER, seoulDateTimeStr(nowMs)]);
  const writes = set.map(function (s) {
    while (row.length <= col(s[0])) row.push('');
    row[col(s[0])] = s[1];
    return { range: quoteTab(tab.title) + '!' + colLetter(col(s[0])) + (r + 1), value: s[1] };
  });
  // 화면이 다시 불러오지 않고 카드를 고칠 수 있게 바뀐 기록을 돌려준다(보기 응답과 같은 모양)
  // (parseTab과 같은 칸 읽기 — 이름 칸이 비어 있어도 돌려줄 수 있게 직접 만든다)
  const fields = {};
  header.forEach(function (h, i) { if (h) fields[h] = row[i] === undefined ? '' : row[i]; });
  const leaderOpinion = String(fields['팀장 의견'] || fields['팀장 의견 (상중하)'] || '');
  return { ok: true, writes: writes,
    record: { tab: tab.id, row: r + 1, recordId: rid, leaderOpinion: leaderOpinion, reviewState: reviewState({ fields: fields, leaderOpinion: leaderOpinion }),
      recordedAt: String(fields['기록일시'] || ''), fields: fields } };
}

module.exports.REPLY_PERIOD_HEADER = REPLY_PERIOD_HEADER;
module.exports.REPLY_SETTLE_HEADER = REPLY_SETTLE_HEADER;
module.exports.validYymm = validYymm;
module.exports.parseThousand = parseThousand;
module.exports.ITEM_KEY_HEADER = ITEM_KEY_HEADER;
module.exports.parseItemKeys = parseItemKeys;
module.exports.seoulDateTimeStr = seoulDateTimeStr;
module.exports.validateReply = validateReply;
module.exports.planReply = planReply;

// =====================================================================
// 2-다 (설계서 v1.21 ⑳-3·㉑): 새 기록 추가(action create) — 순수 함수. 시트 입출력은 index.js saveCompetencyTest.
// 탭마다 '내용 칸' 규칙(CREATE_RULES)을 하나씩 더한다(2026-10-27 재홍님: 탭은 개발할 때 하나씩). 지금은 대면영업만.
// 팀원은 내용 칸만 적고, 이름(이름/담당)·사무소·순번·팀·기록ID·작성자이메일·기록일시는 서버가 채운다(공통 규칙).
// 날짜 검사(㉑): 오늘 포함 최근 N일(인사평가설정 '기록가능기간일', 1~60, 없으면 14) · 미래 불가 · 그 파일의 연도 안.
// 1월 유예(전년도 파일 저장)는 이번 범위 밖(연말 전 별도) — 올해 파일·올해 날짜만.
// =====================================================================
const RECORD_WINDOW_KEY = '기록가능기간일';
const RECORD_WINDOW_DEFAULT = 14;
const TEXT_MAX = 2000;
// 인사평가설정 행([키, 값, 설명]) → 기록 가능 기간(일). 값이 없거나 1~60 정수가 아니면 14(설계서 4-5).
function recordWindowDays(settingsRows) {
  const row = (settingsRows || []).find(function (r) { return String((r && r[0]) || '').trim() === RECORD_WINDOW_KEY; });
  const n = Number(String((row && row[1]) || '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : RECORD_WINDOW_DEFAULT;
}
// 서울 날짜 'YYYY-MM-DD'
function seoulIsoDate(nowMs) {
  const s = seoulDateStr(nowMs);
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}
function validIsoDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}
// ㉑ 날짜 검사. date·today = 'YYYY-MM-DD'. 반환 '' 또는 DATE_FUTURE / DATE_TOO_OLD / DATE_OTHER_YEAR
function checkRecordDate(date, today, windowDays, fileYear) {
  if (date > today) return 'DATE_FUTURE';
  if (Number(date.slice(0, 4)) !== Number(fileYear)) return 'DATE_OTHER_YEAR';
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const oldest = new Date(t - (windowDays - 1) * 86400000).toISOString().slice(0, 10);
  if (date < oldest) return 'DATE_TOO_OLD';
  return '';
}
function cleanText(v, max) {
  const s = String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').trim();
  return s && s.length <= (max || TEXT_MAX) ? s : null;
}
// 탭별 내용 칸 규칙: validate(b) → { ok:true, date:'YYYY-MM-DD', cells:{ 머리글: 값 } } 또는 { ok:false, error:'BAD_INPUT', field }
const CREATE_RULES = {
  // 대면영업(2026-10-27 재홍님 결정): 고객사 · 대면자·직급(한 쌍씩, 시트에는 쉼표로 합침) · 미팅 일시(날짜 + 시 필수 → YYMMDD-HH)
  // · 미팅 시간(분, 20/30/40/60 또는 기타 1~600) · 기대 성과. 모두 필수.
  faceSales: {
    label: '대면영업', // 이 이름의 탭(또는 기존 키 faceSales 탭)에 이 입력 칸을 쓴다 — 내년 파일에서 gid가 바뀌어도 이름으로 찾음
    headers: ['고객사', '대면자', '직급', '미팅 일시(YYMMDD-HH)', '미팅 시간(분)', '기대 성과'],
    validate: function (b) {
      const bad = function (field) { return { ok: false, error: 'BAD_INPUT', field: field }; };
      const customer = cleanText(b.customer, 100);
      if (!customer) return bad('customer');
      const people = Array.isArray(b.people) ? b.people : [];
      if (!people.length || people.length > 10) return bad('people');
      const names = [], ranks = [];
      for (let i = 0; i < people.length; i++) {
        const n = cleanText(people[i] && people[i].name, 30), r = cleanText(people[i] && people[i].rank, 30);
        // 시트에 쉼표로 합쳐 저장하므로 한 사람 값 안에는 쉼표·줄바꿈을 받지 않는다
        if (!n || !r || /[,\n]/.test(n) || /[,\n]/.test(r)) return bad('people');
        names.push(n); ranks.push(r);
      }
      const date = String(b.meetDate || '').trim();
      if (!validIsoDate(date)) return bad('meetDate');
      const hour = Number(b.meetHour);
      if (String(b.meetHour === undefined || b.meetHour === null ? '' : b.meetHour).trim() === '' || !Number.isInteger(hour) || hour < 0 || hour > 23) return bad('meetHour');
      const min = Number(b.minutes);
      if (!Number.isInteger(min) || min < 1 || min > 600) return bad('minutes');
      const expected = cleanText(b.expected, TEXT_MAX);
      if (!expected) return bad('expected');
      return { ok: true, date: date, cells: {
        '고객사': customer, '대면자': names.join(','), '직급': ranks.join(','),
        '미팅 일시(YYMMDD-HH)': date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10) + '-' + String(hour).padStart(2, '0'),
        '미팅 시간(분)': String(min), '기대 성과': expected } };
    }
  }
};
// 원가개선(2026-10-27 재홍님 결정): 고객사 · 공급사 · 원가 개선 항목 · 원가 개선 사유 · 완료 여부(Y 완료 / N 미완료) 필수.
//   Y 완료 = 수행 기간(시작 달 ~ 끝 달, 또는 끝 없음(계속) → 'YYMM~YYMM' / 'YYMM~') + 원가 개선액(천원, 0 이상, 시트 칸 '기대 성과' —
//            끝 달 있음 = 기간 총액 '개선 2,400천원', 끝 없음 = 월 평균 '개선 200천원 / 월 평균')
//            + 아이템키(숫자, 쉼표) 모두 필수 — 추가매출 Y 달성과 같은 모양.
//   N 미완료 = 완료 여부만(수행 기간·개선액·아이템키 칸 없음, 날짜 검사 없음) — 추가매출 N 미달성과 같음.
//   ㉑ 날짜 검사는 달 단위(month): 끝 달이 있으면 끝 달, 끝 없음이면 시작 달(checkRecordMonth). 시작 달은 그 파일 연도 안.
CREATE_RULES.costSave = {
  label: '원가개선',
  headers: ['고객사', '공급사', '원가 개선 항목', '원가 개선 사유', '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', '기대 성과', ITEM_KEY_HEADER],
  validate: function (b) {
    const bad = function (field) { return { ok: false, error: 'BAD_INPUT', field: field }; };
    const customer = cleanText(b.customer, 100); if (!customer) return bad('customer');
    const supplier = cleanText(b.supplier, 100); if (!supplier) return bad('supplier');
    const item = cleanText(b.item, 100); if (!item) return bad('item');
    const reason = cleanText(b.reason, TEXT_MAX); if (!reason) return bad('reason');
    const done = String(b.done === undefined || b.done === null ? '' : b.done).trim().toUpperCase();
    if (done !== 'Y' && done !== 'N') return bad('done');
    const cells = { '고객사': customer, '공급사': supplier, '원가 개선 항목': item, '원가 개선 사유': reason, '완료 여부 (Y/N)': done };
    if (done === 'N') return { ok: true, cells: cells };
    const from = String(b.periodFrom || '').trim(), to = String(b.periodTo || '').trim(), open = b.periodOpen === true;
    if (!validYymm(from)) return bad('periodFrom');
    if ((open && to) || (!open && !to) || (to && (!validYymm(to) || to < from))) return bad('periodTo');
    const amount = parseThousand(b.amount, false); if (amount === null) return bad('amount');
    const keys = parseItemKeys(b.itemKeys); if (!keys) return bad('itemKeys');
    cells['수행 기간 (YYMMDD~YYMMDD)'] = from + '~' + (open ? '' : to);
    // 끝 없음(계속) = 한 달 평균 개선액 → '개선 200천원 / 월 평균', 끝 달 있음 = 기간 전체 총액 → '개선 2,400천원' (2026-10-27 재홍님)
    cells['기대 성과'] = '개선 ' + comma(amount) + '천원' + (open ? ' / 월 평균' : '');
    cells[ITEM_KEY_HEADER] = keys;
    // 검사할 달: 'YYYY-MM' (끝 달, 끝 없음이면 시작 달) + 시작 달 연도
    const ym = function (y) { return '20' + y.slice(0, 2) + '-' + y.slice(2, 4); };
    return { ok: true, cells: cells, month: ym(open ? from : to), startMonth: ym(from) };
  }
};
// 자기개발·직급역량(2026-10-28 재홍님 결정): 원가개선과 같은 틀 — 항목(카드 제목)·사유·완료 여부(Y 완료 / N 미완료) 필수.
//   Y 완료 = 수행 기간(시작 달 ~ 끝 달, **끝 없음 불가** — 끝난 일만) + 자기 성취 평가(글자) 필수. N 미완료 = 항목·사유·완료 여부만(날짜 검사 없음).
//   ㉑ 달 단위 검사는 끝 달(checkRecordMonth). 시트 머리글은 2026-10-19 1행 직접 읽은 이름.
function doneRule(label, itemH, reasonH, evalH) {
  return {
    label: label,
    headers: [itemH, reasonH, '수행 기간 (YYMMDD~YYMMDD)', '완료 여부 (Y/N)', evalH],
    validate: function (b) {
      const bad = function (field) { return { ok: false, error: 'BAD_INPUT', field: field }; };
      const item = cleanText(b.item, 100); if (!item) return bad('item');
      const reason = cleanText(b.reason, TEXT_MAX); if (!reason) return bad('reason');
      const done = String(b.done === undefined || b.done === null ? '' : b.done).trim().toUpperCase();
      if (done !== 'Y' && done !== 'N') return bad('done');
      const cells = {}; cells[itemH] = item; cells[reasonH] = reason; cells['완료 여부 (Y/N)'] = done;
      if (done === 'N') return { ok: true, cells: cells };
      const from = String(b.periodFrom || '').trim(), to = String(b.periodTo || '').trim();
      if (!validYymm(from)) return bad('periodFrom');
      if (b.periodOpen === true || !validYymm(to) || to < from) return bad('periodTo');
      const evaluation = cleanText(b.evaluation, TEXT_MAX); if (!evaluation) return bad('evaluation');
      cells['수행 기간 (YYMMDD~YYMMDD)'] = from + '~' + to;
      cells[evalH] = evaluation;
      const ym = function (y) { return '20' + y.slice(0, 2) + '-' + y.slice(2, 4); };
      return { ok: true, cells: cells, month: ym(to), startMonth: ym(from) };
    }
  };
}
CREATE_RULES.selfDev = doneRule('자기개발', '자기개발 항목', '자기개발 사유', '자기 성취 평가 요약');
CREATE_RULES.gradeComp = doneRule('직급역량', '개선 직급 역량 항목', '직급 역량 개선 사유', '자기 성취 평가');
// ㉑ 달 단위 검사(원가개선). month·startMonth = 'YYYY-MM', today = 'YYYY-MM-DD'. 허용 = 오늘이 속한 달 ~ (오늘 - (N-1)일)이 속한 달.
// 반환 '' 또는 DATE_FUTURE / DATE_TOO_OLD / DATE_OTHER_YEAR
function checkRecordMonth(month, startMonth, today, windowDays, fileYear) {
  if (Number(startMonth.slice(0, 4)) !== Number(fileYear)) return 'DATE_OTHER_YEAR';
  if (month > today.slice(0, 7)) return 'DATE_FUTURE';
  const t = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const oldest = new Date(t - (windowDays - 1) * 86400000).toISOString().slice(0, 7);
  if (month < oldest) return 'DATE_TOO_OLD';
  return '';
}
function validateCreate(form, b) {
  const key = String(form || '');
  const rule = Object.prototype.hasOwnProperty.call(CREATE_RULES, key) ? CREATE_RULES[key] : null;
  if (!rule) return { ok: false, error: 'TAB_NOT_SUPPORTED' };
  const v = rule.validate(b || {});
  if (v.ok) v.form = key;
  return v;
}
// 기록 탭({id,label}) → 그 탭에 쓰는 입력 칸 규칙 키(없으면 ''). 기존 키가 같거나 탭 이름(항목 이름)이 같으면.
function createFormFor(tab) {
  if (!tab) return '';
  const keys = Object.keys(CREATE_RULES);
  for (let i = 0; i < keys.length; i++) if (tab.id === keys[i] || String(tab.label || '').trim() === CREATE_RULES[keys[i]].label) return keys[i];
  return '';
}
// 새 줄 계획. tab = {id,title}, values = 그 탭 A1:Z, allIds = 파일 안 기존 기록ID(Set), viewer = {name,email,office},
// v = validateCreate 결과, opts = { team, nowMs, rand }. 반환 { ok:true, writes, record } 또는 { ok:false, error:'HEADER_NOT_READY' }
// 새 줄 = 값이 있는 마지막 줄 다음(Sheets는 끝쪽 빈 줄을 돌려주지 않음). 순번 = 그 탭 순번 칸의 가장 큰 숫자 + 1.
function planCreate(tab, values, allIds, viewer, v, opts) {
  opts = opts || {};
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  const nameHeader = header.indexOf('이름') >= 0 ? '이름' : (header.indexOf('담당') >= 0 ? '담당' : '');
  const rule = CREATE_RULES[v.form];
  const need = (rule ? rule.headers : []).concat([TEAM_HEADER, EXTRA_HEADERS[0], EXTRA_HEADERS[1], EXTRA_HEADERS[2]]);
  if (!nameHeader || need.some(function (h) { return header.indexOf(h) < 0; })) return { ok: false, error: 'HEADER_NOT_READY' };
  const rowNum = Math.max(rows.length, 1) + 1;
  const cells = Object.assign({}, v.cells);
  cells[nameHeader] = String(viewer.name || '').trim();
  if (header.indexOf('사무소') >= 0) cells['사무소'] = String(viewer.office || '').trim();
  if (header.indexOf('순번') >= 0) {
    let max = 0;
    for (let r = 1; r < rows.length; r++) { const n = Number(String((rows[r] || [])[header.indexOf('순번')] || '').trim()); if (Number.isInteger(n) && n > max) max = n; }
    cells['순번'] = String(max + 1);
  }
  cells[TEAM_HEADER] = String(opts.team || '').trim();
  cells[EXTRA_HEADERS[0]] = makeRecordId(seoulDateStr(opts.nowMs), allIds, opts.rand);
  cells[EXTRA_HEADERS[1]] = normEmail(viewer.email);
  cells[EXTRA_HEADERS[2]] = seoulDateTimeStr(opts.nowMs);
  const writes = Object.keys(cells).filter(function (h) { return cells[h] !== ''; }).map(function (h) {
    return { range: quoteTab(tab.title) + '!' + colLetter(header.indexOf(h)) + rowNum, value: cells[h] };
  });
  const fields = {};
  header.forEach(function (h) { if (h) fields[h] = cells[h] === undefined ? '' : cells[h]; });
  return { ok: true, writes: writes, record: { tab: tab.id, row: rowNum, recordId: cells[EXTRA_HEADERS[0]], name: cells[nameHeader],
    authorEmail: normEmail(viewer.email), authorStatus: 'active', office: String(viewer.office || ''), recordedAt: cells[EXTRA_HEADERS[2]],
    leaderOpinion: '', reviewState: reviewState({ fields: fields, leaderOpinion: '' }), fields: fields } };
}

module.exports.recordWindowDays = recordWindowDays;
module.exports.seoulIsoDate = seoulIsoDate;
module.exports.validIsoDate = validIsoDate;
module.exports.checkRecordDate = checkRecordDate;
module.exports.CREATE_RULES = CREATE_RULES;
module.exports.validateCreate = validateCreate;
module.exports.planCreate = planCreate;
module.exports.createFormFor = createFormFor;
module.exports.checkRecordMonth = checkRecordMonth;

// =====================================================================
// 2-라 (설계서 v1.25 ⑳-7): 팀원 본인 기록 고치기(action update)·지우기(action delete) — 순수 함수.
// - 대상: 입력 칸 규칙(CREATE_RULES)이 있는 탭(대면영업·원가개선·자기개발·직급역량). 추가매출(달성 여부 칸 있는 탭)은 여기서 다루지 않음.
// - 본인 줄(작성자이메일 = 로그인)만. 고치기: 규칙의 내용 칸 중 바뀐 칸 + 수정일시만 쓴다(같은 값이면 NO_CHANGE).
//   평가 완료 줄(팀장 의견 있음)은 고치지도 지우지도 못한다(ALREADY_REVIEWED, 2026-10-28 재홍님) — 고칠 일이 있으면 팀장에게 1회 요청(2-마에서).
//   ㉑ 날짜 검사는 날짜·기간 칸이 바뀐 때만(needDateCheck) — 내용만 고치면 오래된 기록도 고칠 수 있음.
// - 지우기: 평가 전(팀장 의견 빈칸)만. 시트에서 그 줄을 통째로 지운다(deleteDimension, index.js).
// =====================================================================
const OPINION_HEADERS = ['팀장 의견', '팀장 의견 (상중하)'];
const DATE_HEADERS = ['미팅 일시(YYMMDD-HH)', '수행 기간 (YYMMDD~YYMMDD)']; // 바뀌면 ㉑ 검사
function findOwnRow_(values, recordId, viewerEmail) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  if (header.indexOf(EXTRA_HEADERS[0]) < 0 || header.indexOf(EXTRA_HEADERS[1]) < 0) return { ok: false, error: 'HEADER_NOT_READY' };
  if (header.indexOf(ADD_SALES_REPLY_HEADER) >= 0) return { ok: false, error: 'NOT_EDITABLE' };
  const col = function (h) { return header.indexOf(h); };
  const cell = function (row, h) { const i = col(h); const x = i < 0 ? '' : row[i]; return String(x === undefined || x === null ? '' : x).trim(); };
  const rid = String(recordId || '').trim();
  const hits = [];
  for (let r = 1; r < rows.length; r++) { if (rid && cell(rows[r] || [], EXTRA_HEADERS[0]) === rid) hits.push(r); }
  if (!hits.length) return { ok: false, error: 'RECORD_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, error: 'DUPLICATE_RECORD_ID' };
  const r = hits[0]; const row = (rows[r] || []).slice();
  if (!normEmail(viewerEmail) || normEmail(cell(row, EXTRA_HEADERS[1])) !== normEmail(viewerEmail)) return { ok: false, error: 'NOT_YOUR_RECORD' };
  const opH = OPINION_HEADERS.filter(function (h) { return col(h) >= 0; })[0] || '';
  return { ok: true, header: header, row: row, r: r, col: col, cell: cell, opH: opH, opinion: opH ? cell(row, opH) : '' };
}
function planUpdate(tab, values, recordId, viewerEmail, v, nowMs) {
  const f = findOwnRow_(values, recordId, viewerEmail);
  if (!f.ok) return f;
  if (f.opinion) return { ok: false, error: 'ALREADY_REVIEWED' };
  const rule = CREATE_RULES[v.form];
  if (!rule || rule.headers.some(function (h) { return f.col(h) < 0; }) || f.col(MODIFIED_AT_HEADER) < 0) return { ok: false, error: 'HEADER_NOT_READY' };
  const set = [];
  let needDateCheck = false;
  rule.headers.forEach(function (h) {
    const nv = v.cells[h] === undefined ? '' : String(v.cells[h]);
    if (nv !== f.cell(f.row, h)) { set.push([h, nv]); if (DATE_HEADERS.indexOf(h) >= 0 && nv) needDateCheck = true; }
  });
  if (!set.length) return { ok: false, error: 'NO_CHANGE' };
  set.push([MODIFIED_AT_HEADER, seoulDateTimeStr(nowMs)]);
  const row = f.row;
  const writes = set.map(function (s) {
    while (row.length <= f.col(s[0])) row.push('');
    row[f.col(s[0])] = s[1];
    return { range: quoteTab(tab.title) + '!' + colLetter(f.col(s[0])) + (f.r + 1), value: s[1] };
  });
  const parsed = parseTab(tab.id, [f.header, row])[0];
  const fields = {}; f.header.forEach(function (h, i) { if (h) fields[h] = row[i] === undefined ? '' : row[i]; });
  const rec = parsed || { tab: tab.id, recordId: f.cell(row, EXTRA_HEADERS[0]), leaderOpinion: '', fields: fields };
  return { ok: true, writes: writes, needDateCheck: needDateCheck,
    record: { tab: tab.id, row: f.r + 1, recordId: rec.recordId, name: rec.name, authorEmail: normEmail(viewerEmail), authorStatus: 'active',
      office: rec.office, recordedAt: rec.recordedAt, leaderOpinion: rec.leaderOpinion, reviewState: reviewState(rec), fields: fields } };
}
function planDelete(values, recordId, viewerEmail) {
  const f = findOwnRow_(values, recordId, viewerEmail);
  if (!f.ok) return f.error === 'NOT_EDITABLE' ? { ok: false, error: 'NOT_DELETABLE' } : f;
  if (f.opinion) return { ok: false, error: 'ALREADY_REVIEWED' };
  if (editApproved_(f.cell(f.row, EDIT_REQ_HEADER))) return { ok: false, error: 'APPROVED_EDIT_ONLY' }; // 2-마-1: 팀장이 수정을 승인한 기록은 고치기만(지우기 불가)
  return { ok: true, rowIndex: f.r }; // 0부터 센 줄 번호(1행 머리글 = 0) — deleteDimension startIndex
}
module.exports.planUpdate = planUpdate;
module.exports.planDelete = planDelete;

// 2-라 추가매출: 결과 고치기(action replyEdit)·결과 지우기(action replyClear) — 계획 칸은 그대로, 결과 4칸(달성 여부·시점·결산·아이템키)만.
// - 본인 줄이면서 결과가 이미 있는 줄만(없으면 NOT_REPLIED — [결과 적기]를 쓰면 됨).
// - 고치기: validateReply 결과로 4칸을 새로 정함(N이면 시점·결산·아이템키 비움, 이익개선 줄은 이익만). 바뀐 칸 + 수정일시만 쓴다(같으면 NO_CHANGE).
// - 고치기·지우기 모두 평가 전(미평가)만 — 평가 완료면 ALREADY_REVIEWED(planUpdate와 같음).
// - 지우기: 4칸 비우고 수정일시 → 다시 '계획'.
function planReplyEdit(tab, values, recordId, viewerEmail, v, nowMs, clear) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  const need = [EXTRA_HEADERS[0], EXTRA_HEADERS[1], MODIFIED_AT_HEADER, ADD_SALES_REPLY_HEADER, REPLY_PERIOD_HEADER, REPLY_SETTLE_HEADER, ITEM_KEY_HEADER];
  if (need.some(function (h) { return header.indexOf(h) < 0; })) return { ok: false, error: 'HEADER_NOT_READY' };
  const col = function (h) { return header.indexOf(h); };
  const cell = function (row, h) { const i = col(h); const x = i < 0 ? '' : row[i]; return String(x === undefined || x === null ? '' : x).trim(); };
  const rid = String(recordId || '').trim();
  const hits = [];
  for (let r = 1; r < rows.length; r++) { if (rid && cell(rows[r] || [], EXTRA_HEADERS[0]) === rid) hits.push(r); }
  if (!hits.length) return { ok: false, error: 'RECORD_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, error: 'DUPLICATE_RECORD_ID' };
  const r = hits[0]; const row = (rows[r] || []).slice();
  if (!normEmail(viewerEmail) || normEmail(cell(row, EXTRA_HEADERS[1])) !== normEmail(viewerEmail)) return { ok: false, error: 'NOT_YOUR_RECORD' };
  if (!cell(row, ADD_SALES_REPLY_HEADER)) return { ok: false, error: 'NOT_REPLIED' };
  const opH = OPINION_HEADERS.filter(function (h) { return col(h) >= 0; })[0] || '';
  const opinion = opH ? cell(row, opH) : '';
  if (opinion) return { ok: false, error: 'ALREADY_REVIEWED' };
  if (clear && editApproved_(cell(row, EDIT_REQ_HEADER))) return { ok: false, error: 'APPROVED_EDIT_ONLY' }; // 2-마-1: 승인 뒤 결과 지우기 불가
  let target;
  if (clear) {
    target = [[ADD_SALES_REPLY_HEADER, ''], [REPLY_PERIOD_HEADER, ''], [REPLY_SETTLE_HEADER, ''], [ITEM_KEY_HEADER, '']];
  } else if (v.achieved === 'N') {
    target = [[ADD_SALES_REPLY_HEADER, 'N'], [REPLY_PERIOD_HEADER, ''], [REPLY_SETTLE_HEADER, ''], [ITEM_KEY_HEADER, '']];
  } else {
    const profitOnly = col('구분') >= 0 && cell(row, '구분') === PROFIT_ONLY_KIND;
    if (!profitOnly && (v.sales === null || v.sales === undefined)) return { ok: false, error: 'BAD_INPUT', field: 'settleSales' };
    const settle = profitOnly ? settleText(null, v.profit, v.open) : v.settle;
    target = [[ADD_SALES_REPLY_HEADER, 'Y'], [REPLY_PERIOD_HEADER, v.period], [REPLY_SETTLE_HEADER, settle], [ITEM_KEY_HEADER, v.itemKeys]];
  }
  const set = target.filter(function (s) { return s[1] !== cell(row, s[0]); });
  if (!set.length) return { ok: false, error: 'NO_CHANGE' };
  set.push([MODIFIED_AT_HEADER, seoulDateTimeStr(nowMs)]);
  const writes = set.map(function (s) {
    while (row.length <= col(s[0])) row.push('');
    row[col(s[0])] = s[1];
    return { range: quoteTab(tab.title) + '!' + colLetter(col(s[0])) + (r + 1), value: s[1] };
  });
  const fields = {};
  header.forEach(function (h, i) { if (h) fields[h] = row[i] === undefined ? '' : row[i]; });
  const leaderOpinion = String(fields['팀장 의견'] || fields['팀장 의견 (상중하)'] || '');
  return { ok: true, writes: writes,
    record: { tab: tab.id, row: r + 1, recordId: rid, leaderOpinion: leaderOpinion, reviewState: reviewState({ fields: fields, leaderOpinion: leaderOpinion }),
      recordedAt: String(fields['기록일시'] || ''), fields: fields } };
}
module.exports.planReplyEdit = planReplyEdit;

// =====================================================================
// 2-마-1: 평가 완료 기록 1회 수정 요청 → 팀장 승인·거절 (설계서 v1.26 ⑳-8, 2026-10-28 재홍님 결정)
// - 각 기록 탭 '수정 요청' 칸(재홍님이 '팀' 바로 왼쪽에 열 삽입 — 끝 6칸(기록ID~첨부)은 맨 끝 그대로여야 checkHeaderRow·채우기 점검이 통과) 하나에 상태를 글자로 남긴다.
//   서버는 칸 이름으로 찾으므로 위치는 동작과 무관. 시트에서도 읽히게 글자로:
//     요청: '요청 2026-10-28 14:20 · 사유: …'
//     승인: '승인 2026-10-29 09:10 · 이전 평가: 중 / 한줄: … · 사유: …'  (팀장 의견·팀장한줄의견은 비움 → 미평가)
//     거절: '거절 2026-10-29 09:10 · 사유: …'
// - 1회: 이 칸에 값이 있으면(요청·승인·거절·그 밖의 글자) 다시 요청할 수 없다(ALREADY_REQUESTED). 거절도 1회 사용.
// - 요청 = 본인 줄 + 평가 완료(팀장 의견 있음)만. 사유 필수(1~200자, 줄바꿈은 띄어쓰기로).
// - 승인·거절 = 그 팀원과 같은 팀의 활성 팀장만(index.js에서 판정), 칸이 '요청'일 때만.
// - 승인된 기록은 미평가로 돌아가 팀원이 고칠 수 있지만 지울 수는 없다(APPROVED_EDIT_ONLY — planDelete·planReplyEdit clear).
// =====================================================================
const EDIT_REQ_HEADER = '수정 요청';
const EDIT_REASON_MAX = 200;
function editApproved_(text) { return /^승인(\s|$)/.test(String(text || '').trim()); }
function parseEditRequest(text) {
  const s = String(text === undefined || text === null ? '' : text).trim();
  if (!s) return null;
  const m = /^(요청|승인|거절)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(s);
  const reason = /사유:\s*([\s\S]*)$/.exec(s);
  const prev = /이전 평가:\s*([\s\S]*?)\s*·\s*사유:/.exec(s);
  return { state: m ? m[1] : '기타', at: m ? m[2] : '', reason: reason ? reason[1].trim() : '', prev: prev ? prev[1].trim() : '' };
}
function validateEditReason(reason) {
  const r = String(reason === undefined || reason === null ? '' : reason).replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!r || r.length > EDIT_REASON_MAX) return { ok: false, error: 'BAD_INPUT', field: 'reason' };
  return { ok: true, reason: r };
}
// 기록ID로 줄 찾기(본인 여부·탭 종류는 따지지 않음)
function rowById_(values, recordId) {
  const rows = values || [];
  const header = (rows[0] || []).map(function (h) { return String(h === undefined ? '' : h).trim(); });
  if (header.indexOf(EXTRA_HEADERS[0]) < 0 || header.indexOf(EXTRA_HEADERS[1]) < 0 || header.indexOf(EDIT_REQ_HEADER) < 0) return { ok: false, error: 'HEADER_NOT_READY' };
  const col = function (h) { return header.indexOf(h); };
  const cell = function (row, h) { const i = col(h); const x = i < 0 ? '' : row[i]; return String(x === undefined || x === null ? '' : x).trim(); };
  const rid = String(recordId || '').trim();
  const hits = [];
  for (let r = 1; r < rows.length; r++) { if (rid && cell(rows[r] || [], EXTRA_HEADERS[0]) === rid) hits.push(r); }
  if (!hits.length) return { ok: false, error: 'RECORD_NOT_FOUND' };
  if (hits.length > 1) return { ok: false, error: 'DUPLICATE_RECORD_ID' };
  const r = hits[0];
  return { ok: true, header: header, row: (rows[r] || []).slice(), r: r, col: col, cell: cell };
}
function editPlanOut_(tab, f, set) {
  const writes = set.map(function (s) {
    while (f.row.length <= f.col(s[0])) f.row.push('');
    f.row[f.col(s[0])] = s[1];
    return { range: quoteTab(tab.title) + '!' + colLetter(f.col(s[0])) + (f.r + 1), value: s[1] };
  });
  const fields = {};
  f.header.forEach(function (h, i) { if (h) fields[h] = f.row[i] === undefined ? '' : f.row[i]; });
  const leaderOpinion = String(fields['팀장 의견'] || fields['팀장 의견 (상중하)'] || '');
  return { ok: true, writes: writes, authorEmail: normEmail(fields[EXTRA_HEADERS[1]]),
    record: { tab: tab.id, row: f.r + 1, recordId: String(fields[EXTRA_HEADERS[0]] || ''), leaderOpinion: leaderOpinion,
      reviewState: reviewState({ fields: fields, leaderOpinion: leaderOpinion }), recordedAt: String(fields['기록일시'] || ''),
      office: String(fields['사무소'] || ''), fields: fields } };
}
// 팀원: 수정 요청(action editRequest). reason = validateEditReason 결과의 글자.
function planEditRequest(tab, values, recordId, viewerEmail, reason, nowMs) {
  const f = rowById_(values, recordId);
  if (!f.ok) return f;
  if (!normEmail(viewerEmail) || normEmail(f.cell(f.row, EXTRA_HEADERS[1])) !== normEmail(viewerEmail)) return { ok: false, error: 'NOT_YOUR_RECORD' };
  const opH = OPINION_HEADERS.filter(function (h) { return f.col(h) >= 0; })[0] || '';
  if (!(opH && f.cell(f.row, opH))) return { ok: false, error: 'NOT_REVIEWED' };
  if (f.cell(f.row, EDIT_REQ_HEADER)) return { ok: false, error: 'ALREADY_REQUESTED' };
  return editPlanOut_(tab, f, [[EDIT_REQ_HEADER, '요청 ' + seoulDateTimeStr(nowMs) + ' · 사유: ' + reason]]);
}
// 팀장: 승인(approve = true) / 거절. 같은 팀인지는 index.js가 plan.authorEmail로 판정한다.
function planEditDecide(tab, values, recordId, approve, nowMs) {
  const f = rowById_(values, recordId);
  if (!f.ok) return f;
  const req = parseEditRequest(f.cell(f.row, EDIT_REQ_HEADER));
  if (!req || req.state !== '요청') return { ok: false, error: 'NOT_REQUESTED' };
  const now = seoulDateTimeStr(nowMs);
  if (!approve) return editPlanOut_(tab, f, [[EDIT_REQ_HEADER, '거절 ' + now + ' · 사유: ' + req.reason]]);
  const set = [];
  const prev = [];
  OPINION_HEADERS.forEach(function (h) { if (f.col(h) >= 0 && f.cell(f.row, h)) { prev.push(f.cell(f.row, h)); set.push([h, '']); } });
  const line = f.col('팀장한줄의견') >= 0 ? f.cell(f.row, '팀장한줄의견') : '';
  if (line) set.push(['팀장한줄의견', '']);
  set.push([EDIT_REQ_HEADER, '승인 ' + now + ' · 이전 평가: ' + (prev.join(' / ') || '-') + (line ? ' / 한줄: ' + line : '') + ' · 사유: ' + req.reason]);
  return editPlanOut_(tab, f, set);
}
module.exports.EDIT_REQ_HEADER = EDIT_REQ_HEADER;
module.exports.parseEditRequest = parseEditRequest;
module.exports.validateEditReason = validateEditReason;
module.exports.planEditRequest = planEditRequest;
module.exports.planEditDecide = planEditDecide;
