// [DELIVERY] cloud-run/mro-functions/lib/materialSuggest.js 전체 교체용 — GitHub 커밋본이 곧 gcloud 배포 소스(단일본). (2026-10-13 AI 대기 방식 수정: 1회 40초·전체 45초·재시도는 남은 10초 이상일 때만·요청 전체 50초)
// cloud-run/mro-functions/lib/materialSuggest.js
//
// AI 원자재 추천 엔진 (MATERIAL_SUGGEST_CLOUDRUN_DESIGN_v2.md 2-0·2-1·2-4·2-7·3-2·3-4).
// Code.gs suggestRawMaterials(itemName)(편집기 원본, GitHub 미러 942행)를 포팅한 것이다.
//
//   1. 원자재마스터 전체를 읽어 프롬프트에 기존 목록을 넣는다.
//   2. 규칙 프롬프트로 AI를 최대 N회(기본 2) 순차 호출한다(응답 없음/JSON 실패 시 다음 시도).
//   3. 원자재마스터 잠금(Firestore writeLocks/rawMaterialMaster, 대기 10초)을 잡는다.
//   4. 잠금 안에서 다시 읽기 → RM 번호(^RM\d+$만 숫자로 읽음) → 같은 이름이 없을 때만 새 행 추가
//      (Sheets values.append — Apps Script appendRow처럼 "마지막 내용 행 바로 아래"에 서버가 붙인다.
//       다른 경로가 같은 순간 행을 붙여도 서로 덮어쓰지 않는다) → D열 데이터 확인 규칙 복사 + E열 날짜 서식.
//   5. 사후 검증(같은 이름 2행 이상이면 이번에 추가한 행을 비움, 같은 코드가 다른 행에 있으면
//      이번에 추가한 행의 코드를 새 번호로 바꿈).
//   6. { ok:true, materials:[한글명...] } 반환.
//
// [프롬프트 유일본, 설계 2-4] 아래 promptTemplate_의 본문은 편집기 원본 suggestRawMaterials의
// 템플릿 문자열을 글자 그대로 옮긴 것이다. 편집기 원본과 GitHub 미러의 템플릿 SHA-256이 같음을
// 2026-10-12에 확인했다(PROMPT_TEMPLATE_SHA256). 동결 기간(2~4주)에는 Apps Script 동결본과 이
// 파일 두 벌이 있으며, 규칙 수정은 이 파일에서만 한다.
//
// 이 파일은 시트·Firestore·AI를 직접 만들지 않는다. index.js가 실제 객체(Sheets 클라이언트,
// Firestore 잠금, fetch)를 넘겨주고, 시험(tests/materialsuggest_run_tests.js)은 가짜를 넘긴다.

const RAW_SHEET_NAME = '원자재마스터';
const RAW_LOCK_NAME = 'rawMaterialMaster';           // 설계 2-7: Apps Script 폴백도 단계 2부터 같은 이름을 쓴다
const RAW_LOCK_OPTS = { waitMs: 10000, staleMs: 30000, pollMs: 200 }; // Code.gs tryLock(10000)과 같은 대기
const SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul, index.js msToSheetSerialForItem_과 동일
const PROMPT_TEMPLATE_SHA256 = 'd6ce4d85ba18f96fbd64bbe760e1a709a3f13ba38289bf3f6f53ad7e5d869d7d';

// 설정 시트 키(설계 3-4). 시트에 행이 없으면 기본값을 쓴다.
const SETTING_KEYS = {
  aiTimeoutSec: '원자재추천AI대기초',
  aiAttempts: '원자재추천AI시도횟수'
};
const DEFAULTS = { aiTimeoutSec: 40, aiAttempts: 2 };
const LIMITS = { aiTimeoutSec: [10, 45], aiAttempts: [1, 2] };

// ── 시간 예산 (2026-10-13 실측 반영: DeepSeek 응답 12~17초, 20초 초과 1건) ──
// 아래 4개는 설정값이 아니라 코드 상수다. 앱(feed.html)의 60초 대기와 맞물려 있어서, 설정 화면에서
// 바꾸면 앱이 먼저 포기하는 문제가 다시 생길 수 있기 때문이다.
//   REQUEST_BUDGET_MS : 요청 1건 전체(로그인 확인~시트 쓰기)를 이 안에 끝낸다. index.js가 요청 시작
//                       시각 + 이 값을 deadlineMs로 넘긴다. 앱 대기 60초 - 50초 = 10초는 Cloud Run 시동·
//                       네트워크 여유.
//   AI_TOTAL_BUDGET_MS: AI 호출(1·2차 합계)은 첫 호출 시작부터 이 안에 끝낸다.
//   AI_RETRY_MIN_MS   : 2차 호출은 AI 예산이 이만큼 이상 남았을 때만 한다. 느려서 끊긴 경우(40초)엔
//                       남은 시간이 5초뿐이라 다시 부르지 않고, 빨리 실패한 경우(서버 오류·형식 오류)만
//                       다시 부른다.
//   WRITE_RESERVE_MS  : AI가 끝난 뒤 잠금·시트 쓰기·사후 검증에 남겨 두는 최소 시간.
const REQUEST_BUDGET_MS = 50000;
const AI_TOTAL_BUDGET_MS = 45000;
const AI_RETRY_MIN_MS = 10000;
const WRITE_RESERVE_MS = 4000;

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-v4-flash'; // Code.gs callDeepSeek_와 동일

// ───────────────────────── 프롬프트 ─────────────────────────

// Code.gs suggestRawMaterials의 `const prompt = \`...\`` 본문 그대로(글자 하나도 바꾸지 말 것).
function promptTemplate_(listText, itemName) {
  return `너는 MRO(산업 소모성 자재) 원자재 분류 전문가야.
아래 품목명을 만드는 데 사용되는 주요 원자재를 판단해줘.

[기존 등록된 원자재 목록]
${listText}

[품목명]
${itemName}

규칙:
1. 먼저 이 품목의 원가에 실질적으로 영향을 주는 원자재를 모두 나열해봐. 하나만 있다고 단정하지 말고 여러 개일 가능성을 항상 먼저 검토해 (예: 부직포 필터 → 펄프, PP). 단, 품목명 자체가 이미 시장에서 유통되는 화학제품/원자재명(예: 가성소다, 요소, 황산, 암모니아)이라면 그 상위 원료(예: 소금, 천연가스)로 쪼개지 말고 품목명 자체를 주요원자재로 사용해 - 시황 뉴스는 원료가 아니라 실제 유통되는 화학제품명 기준으로 보도되기 때문이야. 단, 품목명에 쓰인 표현이 업계 관용명/줄임말/오기이고 뉴스·시황 보도에서는 정식 화학명이 훨씬 더 많이 쓰인다면(예: '유산반토'→실제 뉴스는 '황산알루미늄', '차염소산소다'→실제 뉴스는 '차아염소산소다'), 품목명 표현을 그대로 쓰지 말고 뉴스 검색에 실제로 걸리는 정식 명칭을 사용해.
2. 품목명에 괄호 ( )가 있으면 그 안의 내용을 확인해. 괄호 안이 쉼표 등으로 구분된 실제 원자재/화학성분명(예: 벤젠, 구연산, 가성소다)으로 판단되면 그 성분들을 주요 원자재 후보로 우선 사용해. 이때 품목명 자체가 1번 규칙에서 말하는 "이미 시장에서 유통되는 화학제품명"에 해당하더라도, 괄호 안에 성분이 명시되어 있으면 이 2번 규칙을 1번보다 우선 적용해(예: "P.E.G#6000 (에틸렌옥사이드,프로필렌옥사이드)"는 폴리에틸렌글리콜로 뭉치지 말고 에틸렌옥사이드/프로필렌옥사이드로 판단). 단, 괄호 안 내용이 화학성분명이 아니라 제품 유형/용도/등급 설명(예: 무기물세정제, 산업용, KS등급)이면 그 내용은 무시하고 품목명 전체를 기준으로 1번 규칙대로 판단해.
3. 나열한 원자재 각각에 대해 기존 목록을 확인해. 세부 등급 차이 정도면(예: 폴리에틸렌 vs 저밀도폴리에틸렌) 기존 항목명을 재사용해. 하지만 원료 자체가 달라서 시황(가격 흐름)이 별도로 움직이는 경우(예: 버진 펄프 vs 재활용 고지/폐지)는 억지로 기존 항목에 합치지 말고 새 원자재로 제안해(isNew: true).
4. 위 3번에 해당하지 않고 애매하면 가장 가까운 기존 항목을 재사용해 — 원자재 종류가 무한정 늘어나지 않게 신중하게 판단해.
5. 반드시 아래 JSON 형식으로만 응답해. 다른 설명 붙이지 마.
6. keyword(수집키워드)는 원자재명 그대로 써도 되고, 뉴스 검색에 더 적합한 시장 용어로 바꿔도 좋아
(예: '폴리에틸렌' 대신 'PE 필름'). 화학제품의 경우 업계 관용명/줄임말과 정식 화학명이 다를 수 있는데,
반드시 실제 뉴스·시황 기사 검색에 걸리는 쪽을 keyword로 선택해 - 관용명이 뉴스에 거의 안 나온다면
정식 화학명을 keyword로 써(예: '유산반토'가 아니라 '황산알루미늄', '차염소산소다'가 아니라 '차아염소산소다').
korean(한글명) 필드는 관용명을 유지해도 되지만, keyword만큼은 실제 검색 결과가 나오는 표현이어야 해.
단, '가격'/'인상'/'인하'/'단가' 같은 시황 단어는 절대 붙이지 마 —
그건 검색 시점에 별도로 조합돼.
7. 최종적으로 응답에 포함하는 원자재(materials 배열)는 품목의 원가에서 차지하는 비중이 큰 순서로 최대 2개까지만 선정해. 후보가 여러 개 있더라도 가장 핵심적인 2개만 남기고 나머지는 제외해.

{
"materials": [
{ "isNew": false, "korean": "고무", "keyword": "고무" },
{ "isNew": true, "korean": "재활용 폐지", "keyword": "고지" }
]
}`;
}

// Code.gs: existingList = rows.map(r => ({code:r[0], korean:r[1], keyword:r[2]}))
//          listText = existingList.map(m => `- 코드:${m.code}, 한글명:${m.korean}`).join('\n')
function buildPrompt(rawRows, itemName) {
  const rows = rawRows.filter(function (r) { return r[0]; });
  const listText = rows
    .map(function (r) { return `- 코드:${r[0]}, 한글명:${r[1]}`; })
    .join('\n');
  return promptTemplate_(listText, itemName);
}

// Code.gs: cleaned = text.replace(/```json|```/g, '').trim(); p = JSON.parse(cleaned);
//          if (p.materials && p.materials.length > 0) parsed = p;
function parseAIText(text) {
  if (!text) return null;
  try {
    const p = JSON.parse(String(text).replace(/```json|```/g, '').trim());
    if (p && p.materials && p.materials.length > 0) return p;
  } catch (e) { /* 다음 시도 */ }
  return null;
}

// ───────────────────────── 설정 ─────────────────────────

function clampInt_(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// settings: lib/sheetsClient.parseSettings 결과({키: 값})
function readOptions(settings) {
  settings = settings || {};
  return {
    aiTimeoutSec: clampInt_(settings[SETTING_KEYS.aiTimeoutSec], LIMITS.aiTimeoutSec[0], LIMITS.aiTimeoutSec[1], DEFAULTS.aiTimeoutSec),
    aiAttempts: clampInt_(settings[SETTING_KEYS.aiAttempts], LIMITS.aiAttempts[0], LIMITS.aiAttempts[1], DEFAULTS.aiAttempts)
  };
}

// ───────────────────────── AI 호출 ─────────────────────────

// Code.gs callDeepSeek_ 대응. 차이: 대기 상한(timeoutMs)을 둔다(Apps Script는 상한 없음).
// 반환 { text|null, httpStatus, ms, error } — 키·프롬프트·응답 전문은 로그에 남기지 않는다.
async function callDeepSeek(fetchFn, apiKey, prompt, timeoutMs) {
  const t0 = Date.now();
  if (!apiKey) return { text: null, httpStatus: 0, ms: 0, error: 'NO_API_KEY' };
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const res = await fetchFn(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{ role: 'user', content: prompt }], reasoning_effort: 'low' }),
      signal: controller.signal
    });
    const status = res.status;
    if (status < 200 || status >= 300) {
      return { text: null, httpStatus: status, ms: Date.now() - t0, error: 'HTTP_' + status };
    }
    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return { text: text || null, httpStatus: status, ms: Date.now() - t0, error: text ? null : 'EMPTY' };
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || controller.signal.aborted);
    return { text: null, httpStatus: 0, ms: Date.now() - t0, error: aborted ? 'TIMEOUT' : 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}

// 공급자 선택(설계 3-2: 예비 공급자 미사용, 공급자별 함수만 나눠 둔다).
function makeAiCaller(provider, fetchFn, env) {
  const p = String(provider || '').toUpperCase();
  if (p === 'DEEPSEEK') {
    return function (prompt, timeoutMs) { return callDeepSeek(fetchFn, env.DEEPSEEK_API_KEY, prompt, timeoutMs); };
  }
  return async function () { return { text: null, httpStatus: 0, ms: 0, error: 'PROVIDER_NOT_SUPPORTED:' + p }; };
}

// ───────────────────────── 시트 입출력 ─────────────────────────

function hasText_(v) { return String(v === undefined || v === null ? '' : v).trim() !== ''; }

function msToSheetSerial(ms) { return (ms + SPREADSHEET_UTC_OFFSET_MS) / 86400000 + 25569; }

// client: google-auth-library 클라이언트(쓰기 스코프). 모든 호출은 Sheets REST v4.
function makeSheetsIO(client, spreadsheetId) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId;
  let sheetIdPromise = null;
  function rng(a1) { return encodeURIComponent(RAW_SHEET_NAME + '!' + a1); }
  return {
    // 헤더 제외 A2:E, 날짜는 시리얼 숫자(UNFORMATTED_VALUE). index 0 == 시트 2행.
    readRawRows: async function () {
      const resp = await client.request({ url: base + '/values/' + rng('A2:E') + '?valueRenderOption=UNFORMATTED_VALUE' });
      return (resp.data && resp.data.values) || [];
    },
    // Apps Script appendRow 대응. OVERWRITE = 표 바로 아래 빈 행에 쓴다(행을 새로 끼워 넣지 않음 —
    // 원자재마스터 아래쪽 빈 행에 미리 걸려 있는 D열 드롭다운을 그대로 쓴다). 반환: 실제로 쓴 첫 행 번호.
    appendRows: async function (rows) {
      const resp = await client.request({
        url: base + '/values/' + rng('A:E') + ':append?valueInputOption=RAW&insertDataOption=OVERWRITE',
        method: 'POST', data: { values: rows }
      });
      const updated = resp && resp.data && resp.data.updates && resp.data.updates.updatedRange;
      const m = /![A-Z]+(\d+)/.exec(String(updated || ''));
      if (!m) throw new Error('APPEND_RANGE_UNKNOWN:' + String(updated || '').slice(0, 80));
      return parseInt(m[1], 10);
    },
    writeCode: async function (row, code) {
      await client.request({ url: base + '/values/' + rng('A' + row) + '?valueInputOption=RAW', method: 'PUT', data: { values: [[code]] } });
    },
    clearRow: async function (row) {
      await client.request({ url: base + '/values/' + rng('A' + row + ':E' + row) + ':clear', method: 'POST', data: {} });
    },
    // Code.gs: D열 데이터 확인 규칙을 D2에서 복사 + E열 'yyyy-mm-dd' 서식
    formatNewRows: async function (startRow, count) {
      if (!sheetIdPromise) {
        sheetIdPromise = client.request({ url: base + '?fields=sheets.properties(sheetId,title)' }).then(function (resp) {
          const s = ((resp.data && resp.data.sheets) || []).find(function (x) { return x.properties && x.properties.title === RAW_SHEET_NAME; });
          if (!s) throw new Error('RAW_SHEET_NOT_FOUND');
          return s.properties.sheetId;
        });
        sheetIdPromise.catch(function () { sheetIdPromise = null; });
      }
      const sheetId = await sheetIdPromise;
      const r0 = startRow - 1, r1 = startRow - 1 + count;
      await client.request({
        url: base + ':batchUpdate', method: 'POST',
        data: { requests: [
          { copyPaste: {
            source: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: 4 },
            destination: { sheetId: sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 3, endColumnIndex: 4 },
            pasteType: 'PASTE_DATA_VALIDATION' } },
          { repeatCell: {
            range: { sheetId: sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: 4, endColumnIndex: 5 },
            cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
            fields: 'userEnteredFormat.numberFormat' } }
        ] }
      });
    }
  };
}

// ───────────────────────── 엔진 ─────────────────────────

// Code.gs: normalize = s => String(s || '').replace(/\s/g, '').toLowerCase()
function normalizeName(s) { return String(s || '').replace(/\s/g, '').toLowerCase(); }

// 설계 2-7: ^RM\d+$ 형식만 숫자로 읽어 최댓값 + 1. 하나도 없으면 1.
// (Code.gs는 parseInt(code.replace('RM',''))라 형식이 다른 코드가 섞이면 RMNaN이 될 수 있었다.)
function nextRmNumber(rows) {
  let max = 0;
  rows.forEach(function (r) {
    const m = /^RM(\d+)$/.exec(String(r[0] || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max + 1;
}
function rmCode(n) { return 'RM' + String(n).padStart(3, '0'); }

// deps = {
//   io: makeSheetsIO(...) 결과,
//   lock: { acquire: async (waitMs) => boolean, release: async () => void },
//   ai: async (prompt, timeoutMs) => { text, httpStatus, ms, error },
//   now: () => ms
// }
// opts = readOptions(settings) 결과 + deadlineMs(요청 마감 시각, index.js가 요청 시작 + REQUEST_BUDGET_MS로 넣음)
// log  = 호출부가 넘긴 로그 객체(이 함수가 필드를 채운다)
// 반환: { ok:true, materials:[...] } | { ok:false, error:'AI_FAILED'|'LOCK_TIMEOUT' }
// AI 시도 계획(시간 예산). 순수 계산이라 시험에서 그대로 확인한다.
//   aiDeadline = min(AI 첫 호출 시작 + 45초, 요청 마감 - 쓰기 여유 4초)
//   n번째 시도 직전: remaining = aiDeadline - 지금
//     - remaining <= 0                          → 시도하지 않음(예산 소진)
//     - 2차 이상이고 remaining < 10초           → 시도하지 않음(느린 실패 뒤 재시도 금지)
//     - 그 외: 이번 시도 대기 = min(설정 1회 대기, remaining)  → 예산을 절대 넘지 않음
function planAttempt(nowMs, aiDeadlineMs, attemptIndex, aiTimeoutSec) {
  const remaining = aiDeadlineMs - nowMs;
  if (remaining <= 0) return { go: false, why: 'AI_BUDGET_USED', remaining: remaining };
  if (attemptIndex > 0 && remaining < AI_RETRY_MIN_MS) return { go: false, why: 'RETRY_SKIPPED_LOW_TIME', remaining: remaining };
  return { go: true, timeoutMs: Math.min(aiTimeoutSec * 1000, remaining), remaining: remaining };
}

async function suggestForItemName(deps, itemName, opts, log) {
  log = log || {};
  log.attempts = [];
  const deadlineMs = opts.deadlineMs || (deps.now() + REQUEST_BUDGET_MS);

  // 1) 프롬프트용 목록 (잠금 밖, Code.gs와 같은 순서)
  const initialRows = await deps.io.readRawRows();
  const prompt = buildPrompt(initialRows, itemName);

  // 2) AI 최대 N회 — 시간 예산 안에서만(planAttempt)
  const aiStart = deps.now();
  const aiDeadline = Math.min(aiStart + AI_TOTAL_BUDGET_MS, deadlineMs - WRITE_RESERVE_MS);
  let parsed = null;
  for (let attempt = 0; attempt < opts.aiAttempts && !parsed; attempt++) {
    const plan = planAttempt(deps.now(), aiDeadline, attempt, opts.aiTimeoutSec);
    if (!plan.go) { log.aiStop = plan.why; break; }
    const r = await deps.ai(prompt, plan.timeoutMs);
    const p = parseAIText(r.text);
    log.attempts.push({ aiMs: r.ms, timeoutMs: plan.timeoutMs, httpStatus: r.httpStatus, parseOk: !!p, error: r.error || (p ? null : (r.text ? 'PARSE' : null)) });
    if (p) parsed = p;
  }
  log.aiTotalMs = deps.now() - aiStart;
  if (!parsed) return { ok: false, error: 'AI_FAILED' };

  // AI가 korean 없는 항목을 주면 건너뛴다(Code.gs는 undefined를 그대로 넣었음 — 차이 기록).
  const materials = parsed.materials.filter(function (m) { return m && hasText_(m.korean); });
  if (materials.length === 0) { log.attempts.push({ error: 'NO_KOREAN' }); return { ok: false, error: 'AI_FAILED' }; }

  // 3) 원자재마스터 잠금
  // 잠금 대기: 기본 10초지만 요청 마감까지 남은 시간(쓰기용 3초 제외)을 넘지 않게 줄인다(최소 1초).
  const l0 = deps.now();
  const lockWaitMs = Math.max(1000, Math.min(RAW_LOCK_OPTS.waitMs, deadlineMs - l0 - 3000));
  log.lockWaitMs = lockWaitMs;
  const gotLock = await deps.lock.acquire(lockWaitMs);
  log.lockMs = deps.now() - l0;
  if (!gotLock) return { ok: false, error: 'LOCK_TIMEOUT' };

  const koreanNames = [];
  const added = []; // { row, code, key }
  try {
    // 4) 잠금 안에서 다시 읽기
    const fresh = await deps.io.readRawRows();
    const freshRows = fresh.filter(function (r) { return r[0]; });
    const freshNames = new Set(freshRows.map(function (r) { return normalizeName(r[1]); }));
    let nextNum = nextRmNumber(freshRows);
    const serial = msToSheetSerial(deps.now());
    const newRows = [];

    materials.forEach(function (m) {
      const key = normalizeName(m.korean);
      if (m.isNew && !freshNames.has(key)) {
        const code = rmCode(nextNum++);
        newRows.push([code, m.korean, m.keyword === undefined || m.keyword === null ? '' : m.keyword, '활성', serial]);
        added.push({ idx: newRows.length - 1, code: code, key: key });
        freshNames.add(key);
      } else if (m.isNew && freshNames.has(key)) {
        (log.skippedDuplicate = log.skippedDuplicate || []).push(m.korean);
      }
      koreanNames.push(m.korean);
    });

    if (newRows.length > 0) {
      const startRow = await deps.io.appendRows(newRows);
      added.forEach(function (a) { a.row = startRow + a.idx; });
      log.appendRow = startRow;
      try {
        await deps.io.formatNewRows(startRow, newRows.length);
      } catch (fmtErr) {
        // 값은 이미 들어갔다. 서식·드롭다운만 실패한 경우라 추천 자체는 성공으로 둔다.
        log.formatError = String((fmtErr && fmtErr.message) || fmtErr).slice(0, 200);
      }

      // 5) 사후 검증 (Code.gs 2026-08-24 검증과 같은 원칙: 먼저 생긴 행을 남기고 이번에 만든 행만 정리)
      const verify = await deps.io.readRawRows();
      const byKey = {}, byCode = {};
      verify.forEach(function (r, i) {
        const row = i + 2;
        const k = normalizeName(r[1]);
        if (k) (byKey[k] = byKey[k] || []).push(row);
        const c = String(r[0] || '').trim();
        if (c) (byCode[c] = byCode[c] || []).push(row);
      });
      let maxNum = nextRmNumber(verify) - 1;
      for (const a of added.slice().sort(function (x, y) { return y.row - x.row; })) {
        const sameName = byKey[a.key] || [];
        if (sameName.length > 1 && sameName.indexOf(a.row) !== -1 && Math.min.apply(null, sameName) !== a.row) {
          await deps.io.clearRow(a.row);
          (log.clearedDuplicate = log.clearedDuplicate || []).push({ row: a.row, code: a.code });
          a.cleared = true;
          continue;
        }
        // Apps Script 경로가 같은 순간 같은 번호를 다른 이름으로 썼을 때(단계 2 전까지는 잠금이 달라 가능) —
        // 방금 만든 이번 행의 번호를 바꾼다(아직 이 번호를 쓰는 게시물이 없다). 같은 이름 행은 그쪽 사후 검증이
        // 지우므로 제외한다.
        const sameCode = (byCode[a.code] || []).filter(function (row) {
          return row !== a.row && normalizeName((verify[row - 2] || [])[1]) !== a.key;
        });
        if (sameCode.length > 0) {
          const newCode = rmCode(++maxNum);
          await deps.io.writeCode(a.row, newCode);
          (log.codeReassigned = log.codeReassigned || []).push({ row: a.row, from: a.code, to: newCode });
          a.code = newCode;
        }
      }
    }
  } finally {
    await deps.lock.release();
  }

  log.newRM = added.filter(function (a) { return !a.cleared; }).map(function (a) { return a.code; });
  log.materials = koreanNames;
  return { ok: true, materials: koreanNames };
}

module.exports = {
  RAW_SHEET_NAME, RAW_LOCK_NAME, RAW_LOCK_OPTS, PROMPT_TEMPLATE_SHA256, SETTING_KEYS, DEFAULTS, LIMITS,
  REQUEST_BUDGET_MS, AI_TOTAL_BUDGET_MS, AI_RETRY_MIN_MS, WRITE_RESERVE_MS, planAttempt,
  promptTemplate_, buildPrompt, parseAIText, readOptions,
  callDeepSeek, makeAiCaller, makeSheetsIO, msToSheetSerial,
  normalizeName, nextRmNumber, rmCode,
  suggestForItemName
};
