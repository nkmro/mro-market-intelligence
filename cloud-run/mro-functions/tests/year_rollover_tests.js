// 2026-11-10 인사평가 자동 연도 전환(역량평가 설계서 6-3절, 5단계) 시험. 실제 Drive·시트·메일 접속 0건 — 가짜 환경.
// apps-script/Code.gs의 연도 전환 함수들을 그대로 잘라 vm에서 실행한다(시험한 코드 = 편집기에 넣을 코드).
// 실행: (cloud-run/mro-functions 폴더에서) node tests/year_rollover_tests.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const repo = path.resolve(__dirname, '..', '..', '..');
const code = fs.readFileSync(path.join(repo, 'apps-script', 'Code.gs'), 'utf8');
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL: ' + name + (info === undefined ? '' : ' → ' + JSON.stringify(info).slice(0, 600))); } }

function extractFn(name) {
  const start = code.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('Code.gs에서 못 찾음: ' + name);
  const rest = code.slice(start + 1);
  const m = rest.slice(1).search(/\n(function [\w$]+\s*\(|\/\*\*|\/\/ =====)/);
  return m < 0 ? rest : rest.slice(0, m + 1);
}
const consts = (code.match(/^const YR_[A-Z_]+_ = '[^']*';$/gm) || []).join('\n');
// 2026-11-19 실적관리 추가: 종류 표(YR_KINDS_ = { … }; 여러 줄)도 그대로 잘라 넣는다
const kinds = (code.match(/^const YR_KINDS_ = \{[\s\S]*?\n\};$/m) || [''])[0];
const FNS = ['yrNextName_', 'yrStartDay_', 'yrSettingInsertRow_', 'yrTarget_', 'yearRolloverDaily', 'yearRolloverRunNow', 'yearRolloverTest', 'yearRolloverCleanupTest',
  'installYearRolloverTrigger', 'yrMail_', 'yrRun_', 'yrRunAll_', 'yrSalesCollapse_', 'yrFxWarn_', 'yrSalesPrep_'];
const SRC = consts + '\n' + kinds + '\n' + FNS.map(extractFn).join('\n');

// ───── 가짜 시트·Drive ─────
function mkSheet(name, rows, opt) {
  opt = opt || {};
  const sh = { name, rows: rows.map(r => r.slice()), hidden: !!opt.hidden, validation: opt.validation || {}, fx: opt.fx || {} }; // fx: { 'R,C': '=수식' } (2026-11-19 실적관리)
  const a1 = (r, c) => { let s = '', x = c; while (x > 0) { const m = (x - 1) % 26; s = String.fromCharCode(65 + m) + s; x = Math.floor((x - 1) / 26); } return s + r; };
  const cellOf = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return [Number(m[2]), c]; };
  const width = () => sh.rows.reduce((m, r) => { let w = 0; r.forEach((v, i) => { if (v !== '' && v !== undefined) w = i + 1; }); return Math.max(m, w); }, 0);
  const lastRow = () => { for (let i = sh.rows.length - 1; i >= 0; i--) if (sh.rows[i].some(v => v !== '' && v !== undefined)) return i + 1; return 0; };
  sh.api = {
    getName: () => sh.name, isSheetHidden: () => sh.hidden, getLastRow: lastRow, getLastColumn: width,
    getDataRange: () => ({ getValues: () => sh.rows.slice(0, Math.max(lastRow(), 1)).map(r => { const o = r.slice(); while (o.length < Math.max(width(), 1)) o.push(''); return o; }) }),
    insertRowAfter: n => { sh.rows.splice(n, 0, []); sh.inserted = (sh.inserted || []).concat(n); },
    getRange: (r, c, nr, nc) => ({
      clearContent: () => { for (let i = r - 1; i < r - 1 + (nr || 1); i++) for (let j = c - 1; j < c - 1 + (nc || 1); j++) if (sh.rows[i]) sh.rows[i][j] = ''; sh.cleared = (sh.cleared || 0) + 1; },
      getValues: () => { const out = []; for (let i = r - 1; i < r - 1 + (nr || 1); i++) { const row = []; for (let j = c - 1; j < c - 1 + (nc || 1); j++) row.push(sh.rows[i] && sh.rows[i][j] !== undefined ? sh.rows[i][j] : ''); out.push(row); } return out; },
      setValues: v => { v.forEach((row, i) => { while (sh.rows.length < r + i) sh.rows.push([]); row.forEach((x, j) => { sh.rows[r - 1 + i][c - 1 + j] = x; }); }); },
      getDataValidation: () => (sh.validation[(c)] ? { rule: 'YN' } : null),
      getFormulas: () => { const out = []; for (let i = r; i < r + (nr || 1); i++) { const row = []; for (let j = c; j < c + (nc || 1); j++) row.push(sh.fx[i + ',' + j] || ''); out.push(row); } return out; },
      getA1Notation: () => a1(r, c)
    }),
    getRangeList: list => ({
      setValue: v => { list.forEach(x => { const [r, c] = cellOf(x); sh.rows[r - 1][c - 1] = v; delete sh.fx[r + ',' + c]; }); sh.rangeListCalls = (sh.rangeListCalls || 0) + 1; },
      clearContent: () => { list.forEach(x => { const [r, c] = cellOf(x); sh.rows[r - 1][c - 1] = ''; delete sh.fx[r + ',' + c]; }); sh.rangeListCalls = (sh.rangeListCalls || 0) + 1; }
    })
  };
  return sh;
}
function world(o) {
  o = o || {};
  const st = { files: {}, mails: [], copies: 0, triggers: (o.triggers || []).slice(), props: Object.assign({}, o.props || {}), lockOk: o.lockOk !== false, lockReleased: 0, cacheCleared: 0, n: 0 };
  const folder = { id: 'FOLDER', name: '엔케이엠알오_공유' };
  function addFile(name, sheets, editors) {
    const id = 'F' + (++st.n);
    st.files[id] = { id, name, sheets, editors: editors || [], trashed: false, folder, owner: 'joojhong@gmail.com' };
    return id;
  }
  function fileApi(f) {
    return {
      getId: () => f.id, getName: () => f.name, isTrashed: () => f.trashed, setTrashed: v => { f.trashed = v; },
      getParents: () => { let used = !f.folder; return { hasNext: () => !used, next: () => { used = true; return f.folder; } }; },
      makeCopy: (name, dest) => {
        st.copies++;
        const sheets = f.sheets.map(s => mkSheet(s.name, s.rows, { hidden: s.hidden, validation: Object.assign({}, s.validation), fx: Object.assign({}, s.fx) }));
        const id = addFile(name, sheets, []); st.files[id].folder = dest; return fileApi(st.files[id]);
      },
      getEditors: () => f.editors.map(e => ({ getEmail: () => e })),
      addEditor: e => { if (f.editors.indexOf(e) < 0 && !o.addEditorNoop) f.editors.push(e); },
      getOwner: () => ({ getEmail: () => f.owner }), getSharingAccess: () => 'PRIVATE'
    };
  }
  // 올해(2026) 인사평가 파일: 기록 탭 2개 + 숨긴 기록 탭 1 + 기준·설정 탭
  const SA = '771006650918-compute@developer.gserviceaccount.com';
  const cur = addFile('2026_인사평가', [
    mkSheet('역량-개선기획역량-추가매출', [['사무소', '담당', '달성 여부 (Y/N)', '기록ID'], ['김해', '이도윤', 'Y', 'X1'], ['김해', '이도윤', 'N', 'X2']], { validation: { 3: true } }),
    mkSheet('역량-영업수행역량-대면영업', [['순번', '이름', '기록ID'], ['1', '이도윤', 'X3']]),
    mkSheet('역량-옛탭-보관', [['순번', '이름'], ['1', '보관']], { hidden: true }),
    mkSheet('CRM-역량평가-기준', [['역량', '설명'], ['- 영업', '...']]),
    mkSheet('인사평가설정', [['키', '값', '설명'], ['연도전환시작일', o.startDay === undefined ? '1' : o.startDay, ''], ['전년도입력마감일', '15', ''],
      ['성과평가단위_동부', '사무소', ''], ['성과공개일수', 1, ''], ['성과마감메일사용', true, ''], ['성과마감메일시각', 17, '']]),
    // 2026-11-13 성과평가 탭(예시 숫자 — 실제 실적 아님): 월실적(2025 기준 줄 + 2026 줄)·마감·평가기준 + 이름이 비슷한 보관 탭
    mkSheet('성과-월실적', [o.perfHeader11 ? ['연도', '월', '팀', '단위구분', '단위', '단위이름', '매출액', '이익', '인원', '수정자', '수정일시'] : ['연도', '월', '팀', '단위구분', '단위', '단위이름', '매출액', '이익', '인원', '수정자', '수정일시', '비고'],
      [2025, 9, '동부', '사무소', '가사무소', '가사무소', 100, 10, 2, '', '', ''], [2026, 9, '동부', '사무소', '가사무소', '가사무소', 120, 12, 2, 'jh', '2026-10-14 10:00', '예시 비고']]),
    mkSheet('성과-마감', [['연도', '팀', '마감월', '마감자', '마감일시', '기록'], [2026, '동부', 9, 'jh', '2026-10-14 10:05', '9월 마감']], { hidden: !!o.perfCloseHidden }),
    mkSheet('성과-평가기준', [['묶음', '묶음가중치', '항목키', '항목 이름', '배점비율', '등급표'], ['성장', 0.5, 'sales', '매출', 0.3, '110:100, 나머지:70']]),
    mkSheet('성과-월실적_옛', [['연도', '월'], [2024, 12]])
  ], o.noSA ? ['joojhong@gmail.com'] : ['joojhong@gmail.com', SA]);
  // MRO '설정' 탭: [키, 값, 설명, 구분]
  const setRows = [['키', '값', '설명', '구분'], ['팀장_열람범위', '자기팀', '', '공통'], [o.noCurKey ? '다른키' : '인사평가파일_2026', cur, '', '공통'],
    ['트리거시각', '1', '', '자재시황'], ['백업시각', '23', '', '자재시황']];
  if (o.nextExists) setRows.push(['인사평가파일_2027', 'FX', '', '공통']);
  // 2026-11-19 실적관리 파일(o.sales일 때만 — 예시 숫자, 실제 실적 아님). 고객사: 가나화학 6월 담당 바뀜, 라마산업 8월 추가, 사바전자 9월 사용 끔
  let salesId = null;
  if (o.sales) {
    const CH = ['팀', '계열', '구매사명', '발주형태', '사무소', '담당', '사용', '순서', '비고', '등록자', '등록일시', '적용월'];
    const PH = ['연도', '팀', '구매사명']; for (let m = 1; m <= 12; m++) PH.push(m + '월 매출', m + '월 이익', m + '월 이익률'); PH.push('연간 매출', '연간 이익');
    const pr = (n, v) => { const r = [2026, '동부', n]; for (let i = 0; i < 38; i++) r.push(v); return r; };
    salesId = addFile('2026_실적관리', [
      mkSheet('실적-고객사', [CH, ['동부', '', '가나화학(주)', '', '', '김민수', 'TRUE', 1, '', '', '', ''], ['동부', '', '다라테크(주)', '', '', '이서연', 'TRUE', 2, '', '', '', ''],
        ['동부', '', '사바전자(주)', '', '', '이서연', 'TRUE', 3, '', '', '', ''], ['동부', '', '가나화학(주)', '', '', '박지훈', 'TRUE', 1, '', '', '', 6],
        ['동부', '', '라마산업(주)', '', '', '김민수', 'TRUE', 4, '', '', '', 8], ['동부', '', '사바전자(주)', '', '', '이서연', 'FALSE', 3, '', '', '', 9]]),
      mkSheet('실적-연간계획', [PH, pr('가나화학(주)', 100), pr('다라테크(주)', 50)], { fx: Object.assign({ '2,6': '=E2/D2' }, o.planFx || {}) }),
      mkSheet('실적-주간', [['연도', '월', '주차', '팀', '구매사명', '매출누적'], [2026, 11, 1, '동부', '가나화학(주)', 30], [2026, 11, 2, '동부', '가나화학(주)', 60]]),
      mkSheet('실적-진행', [['연도', '월', '주차', '팀', '단계'], [2026, 11, 1, '동부', '팀 확정']]),
      mkSheet('실적-설정', [['키', '값', '설명'], ['입력요일', '월', ''], ['연도전환시작일', o.salesStartDay === undefined ? '1' : o.salesStartDay, '']])
    ], o.salesNoSA ? ['joojhong@gmail.com'] : ['joojhong@gmail.com', SA]);
    setRows.push(['실적관리파일_2026', salesId, '', '공통']);
  }
  const settings = mkSheet('설정', setRows);
  const ctx = {
    JSON, String, Number, Math, Object, Array, Error, RegExp,
    SHEET_SETTING: '설정', ADMIN_EMAIL: 'jhjoo@nkmro.com',
    Logger: { log: s => { st.log = (st.log || '') + s + '\n'; } },
    Utilities: { formatDate: (d, tz, fmt) => { const s = new Date(d.getTime() + 9 * 3600000).toISOString(); return fmt === 'yyyy' ? s.slice(0, 4) : s.slice(0, 10); } },
    getSetting_: k => { if (o.hrThrows && /^인사평가파일_/.test(k)) throw new Error('boom'); const r = settings.rows.slice(1).find(x => x[0] === k); return r ? r[1] : null; },
    getSheetObj_: n => { if (n !== '설정') throw new Error('unexpected sheet ' + n); return settings.api; },
    invalidateSheetCache_: () => { st.cacheCleared++; },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in st.props ? st.props[k] : null), setProperty: (k, v) => { st.props[k] = v; }, deleteProperty: k => { delete st.props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => st.lockOk, releaseLock: () => { st.lockReleased++; } }) },
    DriveApp: { getFileById: id => { if (!st.files[id]) throw new Error('no file ' + id); return fileApi(st.files[id]); } },
    SpreadsheetApp: { openById: id => ({ getSheets: () => st.files[id].sheets.map(s => s.api), getSheetByName: n => { const s = st.files[id].sheets.find(x => x.name === n); return s ? s.api : null; } }), flush: () => {} },
    MailApp: { sendEmail: (to, subj, body, opt) => { if (o.mailThrows) throw new Error('mail down'); st.mails.push({ to, subj, body, opt }); } },
    GmailApp: { sendEmail: () => { throw new Error('GmailApp은 쓰면 안 됨(권한 없음)'); } },
    ScriptApp: {
      getProjectTriggers: () => st.triggers.map(tr => ({ getHandlerFunction: () => tr.fn, _tr: tr })),
      deleteTrigger: x => { st.triggers = st.triggers.filter(tr => tr !== x._tr); },
      newTrigger: fn => { const spec = { fn }; const b = { timeBased: () => b, atHour: h => { spec.hour = h; return b; }, everyDays: n => { spec.days = n; return b; }, inTimezone: z => { spec.tz = z; return b; }, create: () => { st.triggers.push(spec); return spec; } }; return b; }
    }
  };
  vm.runInNewContext(SRC + '\nthis.__t = { yrNextName_, yrStartDay_, yrSettingInsertRow_, yrTarget_, yrRun_, yearRolloverDaily, yearRolloverRunNow, yearRolloverTest, yearRolloverCleanupTest, installYearRolloverTrigger, yrRunAll_, yrSalesCollapse_, yrFxWarn_ };', ctx);
  return { st, fn: ctx.__t, cur, salesId, settings, SA, file: id => st.files[id], byName: n => Object.values(st.files).find(f => f.name === n) };
}
const KST = (y, m, d, h) => new Date(Date.UTC(y, m - 1, d, (h === undefined ? 4 : h) - 9));

// ───── 순수 함수 ─────
{
  const { fn } = world();
  t('Y1 이름: 앞 연도만 바꿈 / 연도 없으면 앞에 붙임 / 첫 번째만', fn.yrNextName_('2026_인사평가', 2026, 2027) === '2027_인사평가' && fn.yrNextName_('인사평가', 2026, 2027) === '2027_인사평가' && fn.yrNextName_('2026_인사평가(2026)', 2026, 2027) === '2027_인사평가(2026)');
  t('Y2 연도전환시작일: 없으면 1, 5→5, 0·32·글자→1', fn.yrStartDay_([]) === 1 && fn.yrStartDay_([['연도전환시작일', '5']]) === 5 && fn.yrStartDay_([['연도전환시작일', 5]]) === 5 && ['0', '32', 'abc', '2.5', ''].every(v => fn.yrStartDay_([['연도전환시작일', v]]) === 1));
  t('Y3 끼워 넣을 줄: 마지막 공통 아래 / 공통 없으면 맨 아래', fn.yrSettingInsertRow_([['h'], ['a', 1, '', '공통'], ['b', 1, '', '공통'], ['c', 1, '', '자재시황']]) === 4 && fn.yrSettingInsertRow_([['h'], ['a', 1, '', '자재시황']]) === 3);
}
// ───── 실제 모드 ─────
{
  const w = world();
  const r = w.fn.yrRun_(false, KST(2026, 11, 30));
  t('Y4 11월 30일 → NOTHING_TO_DO, 복사·메일·잠금 없음', r.skipped === 'NOTHING_TO_DO' && w.st.copies === 0 && w.st.mails.length === 0 && w.st.lockReleased === 0, r);
  const w2 = world({ nextExists: true });
  const r2 = w2.fn.yrRun_(false, KST(2027, 1, 2));
  t('Y4b 1월·2027 키 있음 → 할 일 없음', r2.skipped === 'NOTHING_TO_DO' && w2.st.copies === 0 && w2.st.mails.length === 0);
}
{
  const w = world({ nextExists: true });
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y5 이미 2027 키 있음 → ALREADY_DONE, 복사·메일 없음', r.skipped === 'ALREADY_DONE' && w.st.copies === 0 && w.st.mails.length === 0, r);
}
{
  const w = world({ startDay: '3' });
  const r = w.fn.yrRun_(false, KST(2026, 12, 2));
  t('Y6 시작일 3, 12/2 → BEFORE_START_DAY, 복사 없음, 잠금 풀림', r.skipped === 'BEFORE_START_DAY' && w.st.copies === 0 && w.st.mails.length === 0 && w.st.lockReleased === 1, r);
  const r3 = w.fn.yrRun_(false, KST(2026, 12, 3));
  t('Y6b 12/3 → 실행', r3.ok === true && w.st.copies === 1, r3);
}
{
  const w = world();
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  const nf = w.byName('2027_인사평가');
  const sh = n => nf.sheets.find(s => s.name === n);
  t('Y7a 성공: 같은 폴더에 2027_인사평가 1개', r.ok && nf && nf.folder.id === 'FOLDER' && w.st.copies === 1, r);
  t('Y7b 기록 탭 2행 아래만 지움(머리글 유지)', sh('역량-개선기획역량-추가매출').rows[0][2] === '달성 여부 (Y/N)' && sh('역량-개선기획역량-추가매출').rows.slice(1).every(row => row.every(v => v === '')) && sh('역량-영업수행역량-대면영업').rows[1].every(v => v === ''));
  t('Y7c 숨긴 기록 탭·기준·인사평가설정 탭은 그대로', sh('역량-옛탭-보관').rows[1][1] === '보관' && sh('CRM-역량평가-기준').rows[1][0] === '- 영업' && sh('인사평가설정').rows[1][1] === '1');
  t('Y7d 올해 파일은 손대지 않음', w.file(w.cur).sheets[0].rows[1][3] === 'X1' && w.file(w.cur).name === '2026_인사평가');
  t('Y7e 서비스 계정 편집자 추가', nf.editors.indexOf(w.SA) >= 0);
  const rows = w.settings.rows;
  t("Y7f '설정' 탭: 마지막 공통 줄(3행) 아래 4행에 인사평가파일_2027 = 새 파일 ID, D열 공통, 아래 줄은 밀림", rows[3][0] === '인사평가파일_2027' && rows[3][1] === nf.id && rows[3][3] === '공통' && rows[4][0] === '트리거시각' && w.settings.inserted && w.settings.inserted[0] === 3, rows);
  t('Y7g 캐시 비움 · 진행 속성 지움 · 잠금 풀림', w.st.cacheCleared >= 2 && !('YR_2027_FILEID' in w.st.props) && w.st.lockReleased === 1);
  t('Y7h 성공 메일 1번(받는 사람 관리자, [시험] 없음, 링크 포함)', w.st.mails.length === 1 && w.st.mails[0].to === 'jhjoo@nkmro.com' && /^\[MRO 워크허브\] 2027 인사평가 파일 생성 완료/.test(w.st.mails[0].subj) && w.st.mails[0].body.indexOf(nf.id) >= 0, w.st.mails);
  const r2 = w.fn.yrRun_(false, KST(2026, 12, 2));
  t('Y8 다음 날 → ALREADY_DONE, 메일 추가 없음(성공 메일은 1번)', r2.skipped === 'ALREADY_DONE' && w.st.mails.length === 1 && w.st.copies === 1);
}
{
  const w = world({ noSA: true });
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y9 3단계 실패(서비스 계정 없음) → 실패 메일(단계·내일 재시도), 설정 안 씀, 만든 파일 ID 보관', r.ok === false && r.step === 3 && w.st.mails.length === 1 && /3단계/.test(w.st.mails[0].subj) && /내일 새벽 다시 시도/.test(w.st.mails[0].body) && !w.settings.rows.some(x => x[0] === '인사평가파일_2027') && w.st.props.YR_2027_FILEID, r);
  w.file(w.cur).editors.push(w.SA); // 재홍님이 원인 해결
  const r2 = w.fn.yrRun_(false, KST(2026, 12, 2));
  t('Y9b 다음 날 재시도 → 같은 파일 이어서(복사 1번뿐), 성공', r2.ok && w.st.copies === 1 && r2.fileId === w.st.files[r2.fileId].id && w.st.mails.length === 2, r2);
}
{
  const w = world({ addEditorNoop: true });
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y10 편집자 추가가 반영 안 되면 3단계 실패(확인 실패)', r.ok === false && r.step === 3 && /확인 실패/.test(r.error), r);
}
{
  const w = world({ lockOk: false });
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y11 잠금 못 잡음 → 0단계 실패 메일, 복사 없음', r.error === 'LOCK_TIMEOUT' && w.st.copies === 0 && /0단계/.test(w.st.mails[0].subj));
}
{
  const w = world({ noCurKey: true });
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y12 올해 키 없음 → 0단계 실패, 복사 없음', r.ok === false && r.step === 0 && w.st.copies === 0 && /0단계/.test(w.st.mails[0].subj), r);
}
// ───── 시험 모드·정리 ─────
{
  const w = world();
  const r = w.fn.yrRun_(true, KST(2026, 11, 10, 15));
  const nf = w.byName('TEST_2027_인사평가');
  t('Y13a 시험 모드(11월이어도 실행): TEST_2027_인사평가 생성', r.ok && nf && r.test === true, r);
  t("Y13b 시험 모드는 '설정' 탭을 쓰지 않음", w.settings.rows.length === 5 && !w.settings.inserted);
  t('Y13c 메일 제목 [시험], 정리 안내 포함', /^\[시험\] \[MRO 워크허브\]/.test(w.st.mails[0].subj) && /yearRolloverCleanupTest/.test(w.st.mails[0].body));
  t('Y13d 확인 항목 보고: 드롭다운 있음·소유자·링크 공유·서비스 계정', r.report.some(x => x === '추가매출 Y/N 드롭다운: 있음') && r.report.some(x => /소유자: joojhong@gmail.com \/ 링크 공유: PRIVATE/.test(x)) && r.report.some(x => x.indexOf(w.SA) >= 0), r.report);
  t('Y13e 시험 진행 속성은 실제와 따로(YR_TEST_2027_FILEID)', w.st.props.YR_TEST_2027_FILEID === nf.id && !('YR_2027_FILEID' in w.st.props));
  const r2 = w.fn.yrRun_(true, KST(2026, 11, 10, 16));
  t('Y14 시험 다시 실행 → 같은 시험 파일 이어서(복사 1번뿐)', r2.ok && w.st.copies === 1);
  const trashed = w.fn.yearRolloverCleanupTest();
  t('Y15 정리 → 시험 파일만 휴지통, 속성 지움, 올해 파일 그대로', trashed.length === 1 && nf.trashed === true && !('YR_TEST_2027_FILEID' in w.st.props) && w.file(w.cur).trashed === false, trashed);
}
{
  const w = world({ props: { YR_TEST_2027_FILEID: 'F1' } }); // 잘못해서 올해 파일 ID가 들어간 경우
  const trashed = w.fn.yearRolloverCleanupTest();
  t('Y16 정리는 TEST_로 시작하는 파일만 — 올해 파일은 절대 휴지통 안 감', trashed.length === 0 && w.file('F1').trashed === false);
}
// ───── (11/10 시험 결과) 메일은 MailApp, from 없음 ─────
{
  const w = world();
  w.fn.yrRun_(false, KST(2026, 12, 1));
  const m = w.st.mails[0] || {};
  t('Y28 메일은 MailApp으로(이름 MRO 워크허브, from 옵션 없음)', m.opt && m.opt.name === 'MRO 워크허브' && !('from' in m.opt), m);
  t('Y29 Code.gs 연도 전환 부분에 GmailApp 호출 없음', !/GmailApp\.\w+\(/.test(SRC) && /MailApp\.sendEmail/.test(SRC));
  const w2 = world({ mailThrows: true });
  const r2 = w2.fn.yrRun_(false, KST(2026, 12, 1));
  t('Y30 메일이 실패해도 파일 생성·설정 등록은 완료(로그에 메일 실패)', r2.ok && w2.settings.rows.some(x => x[0] === '인사평가파일_2027') && /메일 실패/.test(w2.st.log), r2);
}
{
  const man = JSON.parse(fs.readFileSync(path.join(repo, 'apps-script', 'appsscript.json'), 'utf8'));
  t('Y31 appsscript.json: script.send_mail 권한 있음', man.oauthScopes.indexOf('https://www.googleapis.com/auth/script.send_mail') >= 0, man.oauthScopes);
  t('Y31b appsscript.json: gmail.send 권한 그대로 있음', man.oauthScopes.indexOf('https://www.googleapis.com/auth/gmail.send') >= 0, man.oauthScopes);
}
// ───── 예약 등록 ─────
{
  const w = world({ triggers: [{ fn: 'yearRolloverDaily' }, { fn: 'yearRolloverDaily' }, { fn: 'collectMarketNews' }] });
  const n = w.fn.installYearRolloverTrigger();
  const mine = w.st.triggers.filter(x => x.fn === 'yearRolloverDaily');
  t('Y17 예약 등록: 기존 것 지우고 1개, 매일 4시 서울, 다른 트리거 그대로', n === 1 && mine.length === 1 && mine[0].hour === 4 && mine[0].days === 1 && mine[0].tz === 'Asia/Seoul' && w.st.triggers.some(x => x.fn === 'collectMarketNews'), w.st.triggers);
}
{
  const w = world();
  w.fn.yearRolloverDaily();
  t('Y18 예약 진입점은 실제 모드(11월이면 바로 끝)', w.st.copies === 0 && w.st.mails.length === 0);
}

// ───── (11/10 확인 4) 12월 실패 → 1월 이어서 / 수동 복구 ─────
{
  const { fn } = world();
  const has = ys => yy => ys.indexOf(yy) >= 0;
  const j = x => JSON.stringify(x);
  t('Y19 yrTarget_ 예약: 12월 올해→다음 해 / 1월·올해 키 없음 작년→올해 / 1월·키 있음 null / 2월 null',
    j(fn.yrTarget_(12, 2026, has([2026]), false)) === j({ src: 2026, dst: 2027 }) && j(fn.yrTarget_(1, 2027, has([2026]), false)) === j({ src: 2026, dst: 2027 }) &&
    fn.yrTarget_(1, 2027, has([2026, 2027]), false) === null && fn.yrTarget_(2, 2027, has([2026]), false) === null);
  t('Y19b yrTarget_ 수동: 1월·2027 있음 null(2028 안 만듦) / 11월·올해 있음 null / 2월·2027 없음 작년→올해 / 12월 올해→다음 해',
    fn.yrTarget_(1, 2027, has([2026, 2027]), true) === null && fn.yrTarget_(11, 2026, has([2026]), true) === null &&
    j(fn.yrTarget_(2, 2027, has([2026]), true)) === j({ src: 2026, dst: 2027 }) && j(fn.yrTarget_(12, 2026, has([2026]), true)) === j({ src: 2026, dst: 2027 }));
}
{
  const w = world({ noSA: true, startDay: '5' });
  const r1 = w.fn.yrRun_(false, KST(2026, 12, 31));
  t('Y20a 12/31 실패(3단계)', r1.ok === false && r1.step === 3 && w.st.copies === 1, r1);
  w.file(w.cur).editors.push(w.SA);
  const r2 = w.fn.yrRun_(false, KST(2027, 1, 1));
  t('Y20b 1/1 4시 → 작년(2026) 파일 기준으로 어제 만든 2027 파일 이어서 성공(복사 1번뿐, 시작일 5와 무관)', r2.ok && w.st.copies === 1 && w.settings.rows.some(x => x[0] === '인사평가파일_2027' && x[1] === r2.fileId) && r2.name === '2027_인사평가', r2);
  const w4 = world({ noSA: true });
  w4.fn.yrRun_(false, KST(2027, 1, 31)); w4.fn.yrRun_(false, KST(2027, 2, 3), true);
  t('Y20d 1/31·수동 실패 메일은 "자동 재시도 없음 — yearRolloverRunNow" 안내', w4.st.mails.length === 2 && w4.st.mails.every(m => /자동 재시도는 없습니다/.test(m.body) && !/내일 새벽/.test(m.body)), w4.st.mails.map(m => m.body.slice(-80)));
  const r3 = w.fn.yrRun_(false, KST(2027, 1, 2));
  t('Y20c 1/2 → 2027 키 있으니 할 일 없음', r3.skipped === 'NOTHING_TO_DO' && w.st.copies === 1);
}
{
  const w = world();
  const r = w.fn.yrRun_(false, KST(2027, 1, 10));
  t('Y21 12월 내내 못 만들고 1/10 처음 성공해도 2027 파일·설정 등록', r.ok && w.byName('2027_인사평가') && w.settings.rows.some(x => x[0] === '인사평가파일_2027'), r);
  const w2 = world();
  const r2 = w2.fn.yrRun_(false, KST(2027, 2, 1));
  t('Y22 2월에는 예약으로 시도하지 않음(수동 함수로)', r2.skipped === 'NOTHING_TO_DO' && w2.st.copies === 0);
}
{
  const w = world({ nextExists: true });
  const r = w.fn.yrRun_(false, KST(2027, 1, 5), true);
  t('Y23 1월·2027 있음·수동 → 할 일 없음(2028 복사 안 함), 메일 없음', r.skipped === 'NOTHING_TO_DO' && w.st.copies === 0 && w.st.mails.length === 0 && !w.byName('2028_인사평가'), r);
  const w2 = world({ sales: true });
  const r2 = w2.fn.yearRolloverRunNow(); // 오늘(11월)·2026 있음 — 2026-11-19부터 인사평가·실적관리 둘 다
  t('Y24 11월·수동 → 할 일 없음(다음 해 파일 미리 안 만듦) — 인사평가·실적관리 둘 다', r2.hr.skipped === 'NOTHING_TO_DO' && r2.sales.skipped === 'NOTHING_TO_DO' && w2.st.copies === 0, r2);
  const w3 = world({ startDay: '20' });
  const r3 = w3.fn.yrRun_(false, KST(2026, 12, 2), true);
  t('Y25 12/2·시작일 20·수동 → 시작일 무시하고 2027 생성·등록', r3.ok && w3.st.copies === 1 && w3.settings.rows.some(x => x[0] === '인사평가파일_2027'), r3);
  const r4 = w3.fn.yrRun_(false, KST(2026, 12, 3), true);
  t('Y26 수동 다시 실행 → 이미 있으면 아무것도 안 함', r4.skipped === 'ALREADY_DONE' && w3.st.copies === 1, r4);
  const w5 = world();
  const r5 = w5.fn.yrRun_(false, KST(2027, 3, 2), true);
  t('Y27 3월·2027 없음·수동 → 작년(2026) 파일로 2027 생성·등록(복구)', r5.ok && r5.name === '2027_인사평가' && w5.settings.rows.some(x => x[0] === '인사평가파일_2027'), r5);
}

// (가짜 시트의 getLastColumn = 머리글·데이터 모든 줄에서 마지막으로 값이 있는 칸 — 공식 문서 "last column that has content"와 같은 규칙)
// ───── 2026-11-13 성과평가 탭 처리 (재홍님 결정: 성과-월실적·성과-마감은 비우고, 성과-평가기준·인사평가설정은 그대로) ─────
{
  const w = world();
  const r = w.fn.yrRun_(false, KST(2026, 12, 1));
  const nf = w.byName('2027_인사평가');
  const sh = n => nf.sheets.find(s => s.name === n);
  const blankBelow = s => s.rows.slice(1).every(row => row.every(v => v === ''));
  t('Y28a 성과-월실적: 1행 머리글 12칸 그대로, 2행 아래(2025·2026 줄) 내용 비움', r.ok && sh('성과-월실적').rows[0].length === 12 && sh('성과-월실적').rows[0][11] === '비고' && blankBelow(sh('성과-월실적')), sh('성과-월실적').rows);
  t('Y28b 성과-마감: 1행 머리글 6칸 그대로, 2행 아래 비움', sh('성과-마감').rows[0].join() === '연도,팀,마감월,마감자,마감일시,기록' && blankBelow(sh('성과-마감')), sh('성과-마감').rows);
  t('Y28c 지우는 방식 = 내용만(clearContent) — 줄 수는 그대로(줄 삭제 아님), 탭마다 1번', sh('성과-월실적').rows.length === 3 && sh('성과-마감').rows.length === 2 && sh('성과-월실적').cleared === 1 && sh('성과-마감').cleared === 1);
  t('Y28d 성과-평가기준 그대로', sh('성과-평가기준').rows[1].join() === '성장,0.5,sales,매출,0.3,110:100, 나머지:70' && !sh('성과-평가기준').cleared);
  t('Y28e 인사평가설정의 성과 줄(평가 단위·공개 일수·메일 켜짐·시각) 그대로 다음 해로', ['성과평가단위_동부|사무소', '성과공개일수|1', '성과마감메일사용|true', '성과마감메일시각|17'].every(k => sh('인사평가설정').rows.some(x => (x[0] + '|' + x[1]) === k)));
  t('Y28f 이름이 비슷한 탭(성과-월실적_옛)은 지우지 않음 — 정확한 이름 2개만', sh('성과-월실적_옛').rows[1].join() === '2024,12' && !sh('성과-월실적_옛').cleared);
  t('Y28g 올해(2026) 파일의 성과 탭은 손대지 않음', (() => { const c = w.file(w.cur).sheets; const g = n => c.find(s => s.name === n); return g('성과-월실적').rows[2][6] === 120 && g('성과-마감').rows[1][2] === 9 && !g('성과-월실적').cleared; })());
  t('Y28i 경계: 2025 줄은 L(비고) 빈칸·2026 줄은 L 채움(섞임) → L까지 모두 비움(지운 칸 12열)', sh('성과-월실적').rows[1].length >= 12 && sh('성과-월실적').rows[2][11] === '' && sh('성과-월실적').rows[1].slice(0, 12).every(v => v === ''));
  t('Y28h 완료 메일 보고: "지움: 성과-월실적 2줄"·"지움: 성과-마감 1줄", 그대로 둔 탭에 성과-평가기준·인사평가설정', r.report.indexOf('지움: 성과-월실적 2줄') >= 0 && r.report.indexOf('지움: 성과-마감 1줄') >= 0
    && r.report.some(x => x.indexOf('그대로 둔 탭: ') === 0 && x.indexOf('성과-평가기준') > 0 && x.indexOf('인사평가설정') > 0 && x.indexOf('성과-월실적,') < 0), r.report);
}
{
  const w = world({ perfHeader11: true });
  w.fn.yrRun_(false, KST(2026, 12, 1));
  const s = w.byName('2027_인사평가').sheets.find(x => x.name === '성과-월실적');
  t('Y28j 경계: 머리글이 11칸(L 머리글 없음)인데 데이터에 L(비고)이 있어도 → 마지막 값 있는 칸(L)까지 비움', s.rows[0].length === 11 && s.rows[2][11] === '' && s.rows.slice(1).every(row => row.every(v => v === '')), s.rows);
}
{
  const w = world({ perfCloseHidden: true });
  w.fn.yrRun_(false, KST(2026, 12, 1));
  const nf = w.byName('2027_인사평가');
  t('Y29 숨긴 성과-마감 탭은 건드리지 않음(역량 숨긴 탭과 같은 규칙), 성과-월실적은 비움', nf.sheets.find(s => s.name === '성과-마감').rows[1][2] === 9 && !nf.sheets.find(s => s.name === '성과-마감').cleared && nf.sheets.find(s => s.name === '성과-월실적').cleared === 1);
}
{
  const w = world({ sales: true });
  const r = w.fn.yearRolloverTest().hr; // 2026-11-19부터 { hr, sales }
  const nf = Object.values(w.st.files).find(f => /^TEST_.*인사평가/.test(f.name));
  t('Y30 시험 모드(yearRolloverTest): TEST_ 파일에서도 성과 탭 2개 비움 + 메일 보고에 지움 줄, 설정 탭에는 안 씀', r.ok && nf && nf.sheets.find(s => s.name === '성과-월실적').cleared === 1
    && w.st.mails.filter(m => /인사평가/.test(m.subj)).length === 1 && w.st.mails[0].body.indexOf('지움: 성과-월실적 2줄') >= 0 && w.st.mails[0].body.indexOf('지움: 성과-마감 1줄') >= 0 && !w.settings.rows.some(x => x[0] === '인사평가파일_2027'), { r: r && r.ok, mail: w.st.mails[0] && w.st.mails[0].body.slice(0, 400) });
}

// ───── 2026-11-19 실적관리(주간 실적) 파일 — 같은 예약, 따로 진행 ─────
{
  const w = world({ sales: true });
  const rh = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'hr'), rs = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales');
  const nf = w.byName('2027_실적관리'), sh = n => nf.sheets.find(x => x.name === n);
  t('S1 12/1: 인사평가·실적관리 둘 다 생성, 설정 탭에 두 키 등록', rh.ok && rs.ok && w.st.copies === 2 && w.settings.rows.some(x => x[0] === '인사평가파일_2027') && w.settings.rows.some(x => x[0] === '실적관리파일_2027' && x[1] === nf.id && /2027년 실적관리 파일 ID/.test(x[2]) && x[3] === '공통'), [rh, rs]);
  t('S2 실적-주간·실적-진행 2행 아래 비움, 머리글 그대로', sh('실적-주간').rows.slice(1).every(r => r.every(v => v === '')) && sh('실적-주간').rows[0][0] === '연도' && sh('실적-진행').rows.slice(1).every(r => r.every(v => v === '')));
  const cr = sh('실적-고객사').rows.filter((r, i) => i > 0 && r[2]);
  t('S3 실적-고객사: 4곳, 가나화학=박지훈·순서1, 사바전자=FALSE, 라마산업 포함, 적용월 모두 비움', cr.length === 4 && cr[0][5] === '박지훈' && cr[0][7] === 1 && cr[2][2] === '사바전자(주)' && cr[2][6] === 'FALSE' && cr[3][2] === '라마산업(주)' && cr.every(r => r[11] === ''), cr);
  const pl = sh('실적-연간계획');
  t('S4 실적-연간계획: 연도 2027, 팀·구매사명 그대로, 숫자 비움, 수식 칸 그대로', pl.rows[1][0] === 2027 && pl.rows[2][0] === 2027 && pl.rows[1][2] === '가나화학(주)' && pl.rows[1].slice(3).every((v, j) => j === 2 || v === '') && pl.fx['2,6'] === '=E2/D2' && pl.rows[0][3] === '1월 매출', pl.rows[1].slice(0, 8));
  t('S5 실적-설정 그대로, 원본 2026 파일은 안 바뀜', sh('실적-설정').rows.length === 3 && w.file(w.salesId).sheets.find(x => x.name === '실적-주간').rows[1][5] === 30 && w.file(w.salesId).sheets.find(x => x.name === '실적-고객사').rows.length === 7);
  const ms = w.st.mails.find(m => /실적관리/.test(m.subj));
  t('S6 메일 따로 1통: 제목·보고 줄', w.st.mails.length === 2 && ms && /2027 실적관리 파일 생성 완료 — 1월 첫 입력 전에 연간계획 숫자를 넣어 주세요/.test(ms.subj)
    && /고객사 정리: 6줄 → 4곳 \(이력 줄 2개 합침, 적용월 비움, 사용 끔 1곳은 그대로 FALSE\)/.test(ms.body) && /연간계획: 2줄 연도 2027로, 숫자 75칸 비움 \(수식 칸 1개 그대로\)/.test(ms.body) && /그대로 둔 탭: 실적-설정/.test(ms.body), ms && ms.body);
  t('S7 이어서 하기 속성: 실적관리는 YRS_, 끝나면 지움', !('YRS_2027_FILEID' in w.st.props) && !('YR_2027_FILEID' in w.st.props));
  const again = w.fn.yrRun_(false, KST(2026, 12, 2), false, 'sales');
  t('S8 다음 날 → 이미 있음, 복사 안 함', again.skipped === 'ALREADY_DONE' && w.st.copies === 2);
}
{
  const w = world({ sales: true, salesStartDay: '10' });
  const rh = w.fn.yrRun_(false, KST(2026, 12, 2), false, 'hr'), rs = w.fn.yrRun_(false, KST(2026, 12, 2), false, 'sales');
  t('S9 시작일은 각 파일 설정 탭: 실적-설정 10 → 실적만 기다림, 인사평가(1)는 생성', rh.ok && rs.skipped === 'BEFORE_START_DAY' && rs.startDay === 10 && w.st.copies === 1);
}
{
  const w = world({ sales: true, salesNoSA: true });
  const rh = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'hr'), rs = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales');
  const ms = w.st.mails.find(m => /실적관리/.test(m.subj));
  t('S10 실적관리만 3단계 실패 → 실패 메일·속성 남김(다음 날 이어서), 인사평가는 정상', rh.ok && rs.ok === false && rs.step === 3 && /2027 실적관리 파일 생성 실패 — 3단계/.test(ms.subj) && /내일 새벽 다시 시도합니다/.test(ms.body) && w.st.props.YRS_2027_FILEID && !w.settings.rows.some(x => x[0] === '실적관리파일_2027'), rs);
  w.file(w.salesId).editors.push(w.SA);
  const rs2 = w.fn.yrRun_(false, KST(2026, 12, 2), false, 'sales');
  const cr = w.byName('2027_실적관리').sheets.find(x => x.name === '실적-고객사').rows.filter((r, i) => i > 0 && r[2]);
  t('S11 다음 날 이어서 → 같은 파일(복사 1번뿐), 고객사 다시 정리해도 4곳 그대로', rs2.ok && w.st.copies === 2 && cr.length === 4 && w.settings.rows.some(x => x[0] === '실적관리파일_2027'), rs2);
}
{
  const w = world();
  const rs = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales'), rh = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'hr');
  t("S12 '설정'에 실적관리파일_2026 없음 → 실적만 0단계 실패 메일, 인사평가는 정상", rs.ok === false && rs.step === 0 && /실적관리파일_2026 키가 없음/.test(rs.error) && rh.ok && w.st.mails.some(m => /실적관리 파일 생성 실패 — 0단계/.test(m.subj)), rs);
}
{
  const w = world({ sales: true });
  const out = w.fn.yrRunAll_(true, false);
  const tf = Object.values(w.st.files).filter(f => /^TEST_/.test(f.name)).map(f => f.name).sort();
  t('S13 시험 모드 둘 다: TEST_2027_인사평가·TEST_2027_실적관리, 설정 탭 안 씀, [시험] 메일 2통', out.hr.ok && out.sales.ok && JSON.stringify(tf) === JSON.stringify(['TEST_2027_실적관리', 'TEST_2027_인사평가']) && w.settings.rows.length === 6 && w.st.mails.length === 2 && w.st.mails.every(m => /^\[시험\]/.test(m.subj)), { out, tf });
  t('S14 시험 속성 따로: YR_TEST_2027_FILEID / YRS_TEST_2027_FILEID', !!w.st.props.YR_TEST_2027_FILEID && !!w.st.props.YRS_TEST_2027_FILEID);
  const y = new Date().getFullYear();
  if (y === 2026) {
    const trashed = w.fn.yearRolloverCleanupTest().slice().sort();
    t('S15 정리 → 시험 파일 2개 휴지통, 원본 그대로', JSON.stringify(trashed) === JSON.stringify(['TEST_2027_실적관리', 'TEST_2027_인사평가']) && !w.file(w.salesId).trashed && !w.file(w.cur).trashed && !w.st.props.YRS_TEST_2027_FILEID, trashed);
  }
}
{
  const w = world({ sales: true, hrThrows: true });
  const out = w.fn.yrRunAll_(true, false);
  t('S16a 시험: 인사평가 쪽 실패해도 실적관리는 진행', out.hr.ok === false && /boom/.test(out.hr.error) && out.sales.ok === true, out);
  const out2 = w.fn.yrRunAll_(false, true); // 수동(11월): 인사평가는 잠금 전 단계에서 예외 → yrRunAll_이 잡음, 실적관리는 할 일 없음
  t('S16b 잠금 전 예외도 yrRunAll_이 잡고 다음 종류로 넘어감', out2.hr.ok === false && /boom/.test(out2.hr.error) && out2.sales.skipped === 'NOTHING_TO_DO' && /hr 연도 전환 예외/.test(w.st.log), out2);
}
{
  // Cloud Run lib/weeklySales.js customersAt(rows, 12)와 같은 규칙인지(무작위 300번) + 새해 1월 화면 = 올해 12월 화면
  const ws = require('../lib/weeklySales.js'), { fn } = world();
  const J = x => JSON.parse(JSON.stringify(x));
  let same = true, info = null;
  for (let k = 0; k < 300 && same; k++) {
    const rows = [], n = 1 + Math.floor(Math.random() * 12);
    for (let i = 0; i < n; i++) rows.push([['동부', '동부팀', '서부지역팀'][i % 3], '', 'C' + Math.floor(Math.random() * 4), '', '', 'D' + i, Math.random() < 0.3 ? 'FALSE' : 'TRUE', Math.floor(Math.random() * 5), '', '', '', ['', 0, 3, 6, 6, 12, 13, 'x'][Math.floor(Math.random() * 8)]]);
    const a = J(fn.yrSalesCollapse_(rows)), b = ws.customersAt(rows, 12);
    const ok1 = JSON.stringify(a.map(r => r.slice(0, 11))) === JSON.stringify(b.map(r => r.slice(0, 11))) && a.every(r => r[11] === '');
    const ok2 = JSON.stringify(ws.customersAt(a, 1).map(r => r.slice(0, 11))) === JSON.stringify(b.map(r => r.slice(0, 11)));
    const ok3 = JSON.stringify(J(fn.yrSalesCollapse_(a))) === JSON.stringify(a);
    if (!(ok1 && ok2 && ok3)) { same = false; info = { rows, a, b, ok1, ok2, ok3 }; }
  }
  t('S17 고객사 합치기 = Cloud Run customersAt(12월) / 새해 1월 화면 = 올해 12월 / 두 번 해도 같음 (무작위 300번)', same, info);
}

{
  // S18 (2026-11-19 재홍님 '넣기'): 연간계획 수식 중 올해 연도·IMPORTRANGE는 메일에 '확인 필요 수식'으로, 정상 수식은 조용히
  const { fn } = world();
  t('S18a yrFxWarn_: 연도 박힘·IMPORTRANGE만 true, 같은 줄 계산·다른 숫자(20260, 12026, 2027)는 false',
    fn.yrFxWarn_('=IF(A2=2026,D2,0)', 2026) && fn.yrFxWarn_("='2026 계획'!D2", 2026) && fn.yrFxWarn_('=importrange("1AbC","실적-연간계획!D2")', 2026) && fn.yrFxWarn_('=2026', 2026)
    && !fn.yrFxWarn_('=E2/D2', 2026) && !fn.yrFxWarn_('=SUM(D2,G2,J2)', 2026) && !fn.yrFxWarn_('=D2*20260', 2026) && !fn.yrFxWarn_('=D2+12026', 2026) && !fn.yrFxWarn_('=IF(A2=2027,1,0)', 2026));
  const long = '=IF(A2=2026,D2*1.1+E2*1.2+F2*1.3+G2*1.4+H2*1.5+I2*1.6,0)';
  const w = world({ sales: true, planFx: { '2,7': '=IF(A2=2026,D2,0)', '3,8': '=IMPORTRANGE("1AbC","실적-연간계획!D3")', '3,9': long } });
  const rs = w.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales');
  const line = rs.report.find(x => /^확인 필요 수식/.test(x)) || '';
  t('S18b 메일 줄: G2·H3·I3 위치와 수식(50자 넘으면 …), 정상 수식 F2(=E2/D2)는 안 나옴, 수식은 그대로 남음',
    rs.ok && /G2 =IF\(A2=2026,D2,0\)/.test(line) && /H3 =IMPORTRANGE\("1AbC"/.test(line) && line.indexOf('I3 ' + long.slice(0, 50) + '…') >= 0 && line.indexOf('F2 =E2/D2') < 0
    && w.byName('2027_실적관리').sheets.find(x => x.name === '실적-연간계획').fx['2,7'] === '=IF(A2=2026,D2,0)' && /수식 칸 4개 그대로/.test(rs.report.join('\n')), rs.report);
  const many = {}; for (let c = 4; c <= 15; c++) many['2,' + c] = '=IF($A$2=2026,1,0)';
  const w2 = world({ sales: true, planFx: many });
  const l2 = w2.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales').report.find(x => /^확인 필요 수식/.test(x)) || '';
  t('S18c 12개면 10개까지 + "외 2개"', (l2.match(/=IF\(\$A\$2=2026/g) || []).length === 10 && / 외 2개$/.test(l2), l2);
  const w3 = world({ sales: true });
  const r3 = w3.fn.yrRun_(false, KST(2026, 12, 1), false, 'sales');
  t('S18d 걸리는 수식이 없으면(정상 수식 1개뿐) 안내 줄 없음', r3.ok && !r3.report.some(x => /확인 필요 수식/.test(x)), r3.report);
}

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
