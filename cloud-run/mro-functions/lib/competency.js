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
  const sales = parseThousand(b.settleSales, false);
  if (sales === null) return bad('settleSales');
  const profit = parseThousand(b.settleProfit, true);
  if (profit === null) return bad('settleProfit');
  const itemKeys = parseItemKeys(b.itemKeys);
  if (itemKeys === null) return bad('itemKeys');
  return { ok: true, achieved: 'Y', period: from + '~' + to, itemKeys: itemKeys,
    settle: '매출 ' + comma(sales) + '천원 / 이익 ' + (profit < 0 ? '-' + comma(-profit) : comma(profit)) + '천원' };
}
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
  const set = [[ADD_SALES_REPLY_HEADER, v.achieved]];
  if (v.achieved === 'Y') set.push([REPLY_PERIOD_HEADER, v.period], [REPLY_SETTLE_HEADER, v.settle], [ITEM_KEY_HEADER, v.itemKeys]);
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
