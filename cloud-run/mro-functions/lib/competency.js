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
