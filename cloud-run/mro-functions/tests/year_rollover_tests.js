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
const FNS = ['yrNextName_', 'yrStartDay_', 'yrSettingInsertRow_', 'yrTarget_', 'yearRolloverDaily', 'yearRolloverRunNow', 'yearRolloverTest', 'yearRolloverCleanupTest',
  'installYearRolloverTrigger', 'yrMail_', 'yrRun_'];
const SRC = consts + '\n' + FNS.map(extractFn).join('\n');

// ───── 가짜 시트·Drive ─────
function mkSheet(name, rows, opt) {
  opt = opt || {};
  const sh = { name, rows: rows.map(r => r.slice()), hidden: !!opt.hidden, validation: opt.validation || {} };
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
      getDataValidation: () => (sh.validation[(c)] ? { rule: 'YN' } : null)
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
        const sheets = f.sheets.map(s => mkSheet(s.name, s.rows, { hidden: s.hidden, validation: Object.assign({}, s.validation) }));
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
    mkSheet('인사평가설정', [['키', '값', '설명'], ['연도전환시작일', o.startDay === undefined ? '1' : o.startDay, ''], ['전년도입력마감일', '15', '']])
  ], o.noSA ? ['joojhong@gmail.com'] : ['joojhong@gmail.com', SA]);
  // MRO '설정' 탭: [키, 값, 설명, 구분]
  const setRows = [['키', '값', '설명', '구분'], ['팀장_열람범위', '자기팀', '', '공통'], [o.noCurKey ? '다른키' : '인사평가파일_2026', cur, '', '공통'],
    ['트리거시각', '1', '', '자재시황'], ['백업시각', '23', '', '자재시황']];
  if (o.nextExists) setRows.push(['인사평가파일_2027', 'FX', '', '공통']);
  const settings = mkSheet('설정', setRows);
  const ctx = {
    JSON, String, Number, Math, Object, Array, Error, RegExp,
    SHEET_SETTING: '설정', ADMIN_EMAIL: 'jhjoo@nkmro.com',
    Logger: { log: s => { st.log = (st.log || '') + s + '\n'; } },
    Utilities: { formatDate: (d, tz, fmt) => { const s = new Date(d.getTime() + 9 * 3600000).toISOString(); return fmt === 'yyyy' ? s.slice(0, 4) : s.slice(0, 10); } },
    getSetting_: k => { const r = settings.rows.slice(1).find(x => x[0] === k); return r ? r[1] : null; },
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
  vm.runInNewContext(SRC + '\nthis.__t = { yrNextName_, yrStartDay_, yrSettingInsertRow_, yrTarget_, yrRun_, yearRolloverDaily, yearRolloverRunNow, yearRolloverTest, yearRolloverCleanupTest, installYearRolloverTrigger };', ctx);
  return { st, fn: ctx.__t, cur, settings, SA, file: id => st.files[id], byName: n => Object.values(st.files).find(f => f.name === n) };
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
  const w2 = world();
  const r2 = w2.fn.yearRolloverRunNow(); // 오늘(11월)·2026 있음
  t('Y24 11월·수동 → 할 일 없음(다음 해 파일 미리 안 만듦)', r2.skipped === 'NOTHING_TO_DO' && w2.st.copies === 0, r2);
  const w3 = world({ startDay: '20' });
  const r3 = w3.fn.yrRun_(false, KST(2026, 12, 2), true);
  t('Y25 12/2·시작일 20·수동 → 시작일 무시하고 2027 생성·등록', r3.ok && w3.st.copies === 1 && w3.settings.rows.some(x => x[0] === '인사평가파일_2027'), r3);
  const r4 = w3.fn.yrRun_(false, KST(2026, 12, 3), true);
  t('Y26 수동 다시 실행 → 이미 있으면 아무것도 안 함', r4.skipped === 'ALREADY_DONE' && w3.st.copies === 1, r4);
  const w5 = world();
  const r5 = w5.fn.yrRun_(false, KST(2027, 3, 2), true);
  t('Y27 3월·2027 없음·수동 → 작년(2026) 파일로 2027 생성·등록(복구)', r5.ok && r5.name === '2027_인사평가' && w5.settings.rows.some(x => x[0] === '인사평가파일_2027'), r5);
}

console.log('pass ' + pass + ' / fail ' + fail);
process.exit(fail ? 1 : 0);
