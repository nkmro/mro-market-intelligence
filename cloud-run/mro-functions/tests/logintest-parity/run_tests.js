// loginTest 코드 레벨 로직 parity 테스트 (2026-08-21, 합성 데이터 — 실제 시트/Firestore/
// Cloud Run 호출 없음). postCommentTest/markThreadSeenTest parity 테스트와 동일한 A/B 그룹
// 구조를 따른다.
//
// A. 로그인 검증 체인 parity (시나리오 1~11): apps_script_ref.js(Code.gs handleLogin_/
//    hashPassword_/findUser_ 포트) vs cloudrun_port.js(index.js loginAction_/hashPassword_의
//    검증 로직 포트) — 둘 다 실제 Sheets 조회/쓰기, Firestore 세션 쓰기를 걷어낸 순수 함수
//    포트다. "실제로 배포된 그 함수"가 아니라 "그 함수의 핵심 판단 로직을 그대로 옮긴 거울"을
//    비교한다(다른 parity 테스트와 동일한 방식·한계).
//
//    핵심 포인트: passwordChangedAt 컬럼을 두 런타임이 서로 다른 표현으로 읽는다는 걸 그대로
//    반영해서 시험한다 — Apps Script는 SpreadsheetApp이 이미 Date 객체로 돌려주고, Cloud Run은
//    Sheets API UNFORMATTED_VALUE가 돌려주는 시트 시리얼 숫자를 읃feedEngine.sheetSerialToMs로
//    변환한다. 이 표현 차이 자체가 postComment 때 발견된 날짜 버그와 같은 종류의 함정이 있는지
//    검증하는 지점이다(apps_script_ref.js 55~59행 주석 참고). 그래서 이 테스트는 "같은 로우
//    배열"을 두 쪽에 그대로 넘기지 않고, 하나의 논리적 레코드(changedAtMs = 실제 절대시각)로부터
//    각 런타임이 실제로 보게 될 표현(Date 객체 / 시트 시리얼 숫자)을 각각 만들어서 넘긴다.
//
// B. idempotency/세션 구조/락 테스트 (시나리오 12~18): 포트가 아니라 lib/writeIdempotency.js의
//    withIdempotency()와 lib/auth.js의 authenticateSession()을 "실제 프로덕션 코드 그대로"
//    require해서 fake_firestore.js(인메모리 스텁)를 인자로 넘겨 직접 실행한다. 추가로
//    cloudrun_port.js에 포트된 acquireLoginLock_/releaseLoginLock_(index.js 안에서는 비공개
//    함수라 직접 require 불가 — "포트 비교"임을 명시)의 락 시나리오도 여기서 함께 다룬다.
//
// 이 스크립트는 GCP/Firestore/Sheets API에 어떤 네트워크 호출도 하지 않는다.

const { handleLogin_ } = require('./apps_script_ref');
const {
  loginAction_,
  acquireLoginLock_,
  releaseLoginLock_,
  LOGIN_LOCK_STALE_MS
} = require('./cloudrun_port');
const { FakeFirestore } = require('./fake_firestore');
const { withIdempotency } = require('../../lib/writeIdempotency');
const { authenticateSession } = require('../../lib/auth');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const results = [];

// ---------------------------------------------------------------------------
// 공용 합성 데이터 / 헬퍼
// ---------------------------------------------------------------------------
const SPREADSHEET_UTC_OFFSET_MS = 9 * 60 * 60 * 1000; // lib/feedEngine.js와 동일 (서울, UTC+9)
const DAY_MS = 86400000;
const NOW_MS = new Date('2026-08-21T00:00:00.000Z').getTime();
const PASSWORD = 'correct-password-1234';
const HASH = require('crypto').createHash('sha256').update(PASSWORD + ':kim@nkmro.com', 'utf8').digest('hex');

// changedAtMs(실제 절대 UTC ms) -> Sheets API UNFORMATTED_VALUE가 돌려줄 시트 시리얼 숫자.
// lib/feedEngine.js의 sheetSerialToMs 역함수 — 같은 절대시각을 두 표현으로 왕복 변환해서
// "같은 실제 순간을 가리키는 서로 다른 두 런타임의 원시값"을 만든다.
function msToSheetSerial(ms) {
  return (ms + SPREADSHEET_UTC_OFFSET_MS) / DAY_MS + 25569;
}

// 하나의 논리적 사용자 레코드로부터, Apps Script가 실제로 보게 될 row(passwordChangedAt이
// Date 객체 또는 '')와 Cloud Run이 실제로 보게 될 row(같은 컬럼이 시트 시리얼 숫자 또는 '')를
// 각각 만든다. 나머지 컬럼(email~failCount)은 두 런타임이 원시값을 다르게 표현할 이유가 없어
// 동일하게 넣는다.
function buildRows({ email, name, role, team, status, passwordHash, failCount, changedAtMs }) {
  const appsScriptChangedAt = changedAtMs === null ? '' : new Date(changedAtMs);
  const cloudRunChangedAt = changedAtMs === null ? '' : msToSheetSerial(changedAtMs);
  const base = [email, name, role, team, status, '', passwordHash, failCount];
  return {
    appsScriptRow: base.concat([appsScriptChangedAt]),
    cloudRunRow: base.concat([cloudRunChangedAt])
  };
}

// index.js의 loginAction_ 안에 있는 사용자 조회 루프(row[0]~row[8] 매핑)를 그대로 복제한
// 테스트 글루 코드 — cloudrun_port.js의 loginAction_은 이미 조회된 user 객체를 받는 형태로
// 포트되어 있어(실제 index.js와 다르게, 조회 로직 자체는 이 포트의 시험 대상이 아님), 이
// 헬퍼가 실제 index.js가 하는 것과 동일한 방식으로 userRows -> user를 만들어 넘겨준다.
function findUserForCloudRun(userRows, email) {
  const normalizedEmail = String(email).trim().toLowerCase();
  for (let i = 0; i < userRows.length; i++) {
    const row = userRows[i];
    if (String(row[0] || '').trim().toLowerCase() === normalizedEmail) {
      return {
        email: row[0], name: row[1], role: row[2], team: row[3], status: row[4],
        passwordHash: row[6] || null, failCount: Number(row[7]) || 0, passwordChangedAtRaw: row[8]
      };
    }
  }
  return null;
}

function runCase(name, desc, { appsScriptRows, cloudRunRows, body, sessionToken, settings }) {
  const nowMs = NOW_MS;
  const a = handleLogin_(body, appsScriptRows, sessionToken, nowMs, settings || {});
  const b = loginAction_(body, findUserForCloudRun(cloudRunRows, body.email), sessionToken, nowMs, settings || {});
  const same = deepEqual(a, b);
  results.push({ group: 'A', name, desc, appsScript: a, cloudRun: b, same });
}

// ---------------------------------------------------------------------------
// A. 로그인 검증 체인 parity — apps_script_ref vs cloudrun_port
// ---------------------------------------------------------------------------

// 1. 필수값 누락(password 빈 문자열)
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('1', '필수값 누락(password 빈 문자열) -> MISSING_FIELDS', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: '' }, sessionToken: 'tok-1'
  });
}

// 2. 존재하지 않는 사용자
{
  runCase('2', '존재하지 않는 사용자 -> USER_NOT_FOUND', {
    appsScriptRows: [], cloudRunRows: [],
    body: { email: 'nobody@nkmro.com', password: PASSWORD }, sessionToken: 'tok-2'
  });
}

// 3. 비활성 계정
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '비활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('3', '비활성 계정 -> USER_INACTIVE', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-3'
  });
}

// 4. 잠긴 계정(failCount >= 5)
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 5, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('4', '잠긴 계정(failCount=5) -> ACCOUNT_LOCKED(비밀번호 맞아도 통과 못함)', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-4'
  });
}

// 5. 잘못된 비밀번호 -> failCountAfter 증가값 확인
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 2, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('5', '잘못된 비밀번호(failCount=2) -> WRONG_PASSWORD, failCountAfter=3', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: 'wrong-password' }, sessionToken: 'tok-5'
  });
}

// 6. 정상 로그인, 비밀번호 만료 전(기본 90일, 10일 전 변경) -> passwordExpired=false
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 3, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('6', '정상 로그인(기본 90일 만료, 10일 전 변경) -> passwordExpired=false, failCountAfter=0', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-6'
  });
}

// 7. 정상 로그인이지만 비밀번호 만료(기본 90일, 100일 전 변경) -> passwordExpired=true
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 100 * DAY_MS
  });
  runCase('7', '정상 로그인(기본 90일 만료, 100일 전 변경) -> passwordExpired=true', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-7'
  });
}

// 8. passwordChangedAt이 한 번도 설정되지 않음(changedAtMs=null) -> Infinity일 -> 항상 만료
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: null
  });
  runCase('8', 'passwordChangedAt 미설정(빈 셀) -> daysSincePwChange=Infinity -> passwordExpired=true', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-8'
  });
}

// 9. 커스텀 비밀번호만료일수(30일) + 45일 전 변경 -> 만료
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 45 * DAY_MS
  });
  runCase('9', '설정값 비밀번호만료일수=30 + 45일 전 변경 -> passwordExpired=true', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-9',
    settings: { '비밀번호만료일수': '30' }
  });
}

// 9b. 같은 45일 전 변경이지만 설정값이 60일 -> 만료 아님(설정값이 실제로 반영되는지 함께 확인)
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 45 * DAY_MS
  });
  runCase('9b', '설정값 비밀번호만료일수=60 + 45일 전 변경 -> passwordExpired=false', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-9b',
    settings: { '비밀번호만료일수': '60' }
  });
}

// 10. 경계값 — daysSincePwChange가 expireDays와 정확히 같음(> 비교라 같으면 만료 아님)
{
  const changedAtMs = NOW_MS - 90 * DAY_MS; // 기본 90일과 정확히 일치
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs
  });
  runCase('10', '경계값 — daysSincePwChange가 expireDays(90)와 정확히 같음 -> passwordExpired=false(>=아니라 > 비교)', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: 'kim@nkmro.com', password: PASSWORD }, sessionToken: 'tok-10'
  });
}

// 11. 이메일 대소문자/공백 정규화 — body.email이 대문자+공백이어도 동일하게 인증됨
{
  const { appsScriptRow, cloudRunRow } = buildRows({
    email: 'kim@nkmro.com', name: '김담당', role: '일반', team: '자재팀', status: '활성',
    passwordHash: HASH, failCount: 0, changedAtMs: NOW_MS - 10 * DAY_MS
  });
  runCase('11', '이메일 대소문자/공백(" KIM@NKMRO.COM ") -> 정규화되어 정상 로그인', {
    appsScriptRows: [appsScriptRow], cloudRunRows: [cloudRunRow],
    body: { email: ' KIM@NKMRO.COM ', password: PASSWORD }, sessionToken: 'tok-11'
  });
}

// ---------------------------------------------------------------------------
// B. idempotency / 세션 구조 호환성 / 락 — 실제 lib/writeIdempotency.js, lib/auth.js를
//    그대로 실행 + cloudrun_port.js에 포트된 락 함수 시나리오
// ---------------------------------------------------------------------------
async function runIdempotencyAndSessionCases() {
  // 12. idempotencyKey 중복 -> actionFn 1회만 실행, 실패 응답도 그대로 캐시
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const actionFn = async function () { callCount += 1; return { ok: false, error: 'WRONG_PASSWORD', failCountAfter: callCount }; };
    const r1 = await withIdempotency(fs, 'login-dup-key-1', 'login', actionFn);
    const r2 = await withIdempotency(fs, 'login-dup-key-1', 'login', actionFn);
    const pass = callCount === 1 && deepEqual(r1, r2) && r1.error === 'WRONG_PASSWORD';
    results.push({
      group: 'B', name: '12', desc: 'idempotencyKey 중복 -> actionFn 1회만 실행, WRONG_PASSWORD 응답도 그대로 캐시(split-brain 재시도 정책 근거)',
      detail: { callCount, r1, r2 }, same: pass
    });
  }

  // 13-a. IN_PROGRESS -> 폴링 중 DONE으로 전환되면 그 응답을 받아야 함(login에도 동일 적용)
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('login-inprogress-a');
    await docRef.set({ action: 'login', status: 'IN_PROGRESS', createdAt: new Date() });
    setTimeout(function () { docRef.update({ status: 'DONE', response: { ok: true, sessionToken: 'from-other-process' } }); }, 700);
    const r = await withIdempotency(fs, 'login-inprogress-a', 'login', async function () {
      throw new Error('actionFn이 호출되면 안 됨(이미 다른 프로세스가 처리 중)');
    });
    const pass = deepEqual(r, { ok: true, sessionToken: 'from-other-process' });
    results.push({
      group: 'B', name: '13-a', desc: 'IN_PROGRESS -> 폴링 중 DONE 전환 -> 그 응답을 그대로 받음(failCount 중복 증가 없이 재시도 안전)',
      detail: { r }, same: pass
    });
  }

  // 13-b. IN_PROGRESS가 끝까지 안 풀리면 DUPLICATE_IN_PROGRESS_RETRY_LATER
  {
    const fs = new FakeFirestore();
    const docRef = fs.collection('writeIdempotency').doc('login-inprogress-b');
    await docRef.set({ action: 'login', status: 'IN_PROGRESS', createdAt: new Date() });
    const r = await withIdempotency(fs, 'login-inprogress-b', 'login', async function () {
      throw new Error('actionFn이 호출되면 안 됨');
    });
    const pass = deepEqual(r, { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' });
    results.push({
      group: 'B', name: '13-b', desc: 'IN_PROGRESS가 끝까지 안 풀림 -> DUPLICATE_IN_PROGRESS_RETRY_LATER',
      detail: { r }, same: pass
    });
  }

  // 14. 애매한 실패(예외) 후 같은 키로 재시도 -> 선점 해제되어 재실행 성공(설계 문서 split-brain
  //     "같은 idempotencyKey로 1회 재시도" 정책의 근거가 되는 저수준 동작)
  {
    const fs = new FakeFirestore();
    let callCount = 0;
    const flakyActionFn = async function () {
      callCount += 1;
      if (callCount === 1) throw new Error('시뮬레이션된 애매한 실패(타임아웃 등)');
      return { ok: true, sessionToken: 'succeeded-on-retry' };
    };
    let firstErr = null;
    try {
      await withIdempotency(fs, 'login-retry-key-1', 'login', flakyActionFn);
    } catch (e) {
      firstErr = e;
    }
    const r2 = await withIdempotency(fs, 'login-retry-key-1', 'login', flakyActionFn);
    const pass = firstErr !== null && callCount === 2 && r2.ok === true && r2.sessionToken === 'succeeded-on-retry';
    results.push({
      group: 'B', name: '14', desc: '애매한 실패(예외) 후 같은 키로 재시도 -> 선점 해제되어 재실행 성공(1회 재시도 정책 검증)',
      detail: { callCount, r2 }, same: pass
    });
  }

  // 15. 세션 구조 호환성 — loginAction_이 실제로 쓸 필드 구조({email, createdAt, expiresAt})로
  //     세션 문서를 직접 만들어서, authenticateSession(lib/auth.js, 실제 프로덕션 코드)이 그대로
  //     조회할 수 있는지 확인(사용자가 명시적으로 요구한 요건 — 다른 Cloud Run 함수가 그대로
  //     세션을 조회할 수 있어야 함).
  {
    const fs = new FakeFirestore();
    const now = Date.now();
    const sessionToken = 'login-issued-session-token';
    // loginAction_/index.js의 실제 세션 쓰기 코드와 동일한 모양:
    //   firestore.collection('sessions').doc(sessionToken).set({ email, createdAt: new Date(now), expiresAt: new Date(now + SESSION_TTL_MS) })
    await fs.collection('sessions').doc(sessionToken).set({
      email: 'kim@nkmro.com', createdAt: new Date(now), expiresAt: new Date(now + 21600 * 1000)
    });
    const auth = await authenticateSession(fs, sessionToken);
    const pass = auth.ok === true && auth.email === 'kim@nkmro.com';
    results.push({
      group: 'B', name: '15', desc: 'loginAction_이 만드는 세션 문서 구조({email,createdAt,expiresAt})를 authenticateSession(실제 lib/auth.js)이 정상 조회 -> 다른 Cloud Run 함수와 세션 호환',
      detail: { auth }, same: pass
    });
  }

  // 16. 정상적인 락 획득/해제 — 아무도 안 잡고 있으면 즉시 획득, holderId 일치 시 해제 성공
  {
    const fs = new FakeFirestore();
    const acquired = await acquireLoginLock_(fs, 'lock-a@nkmro.com', 'holder-A');
    await releaseLoginLock_(fs, 'lock-a@nkmro.com', 'holder-A');
    const afterRelease = await fs.collection('loginLocks').doc('lock-a@nkmro.com').get();
    const pass = acquired === true && afterRelease.exists === false;
    results.push({
      group: 'B', name: '16', desc: '정상 락 획득 -> holderId 일치 해제 -> 문서 삭제됨',
      detail: { acquired, afterReleaseExists: afterRelease.exists }, same: pass
    });
  }

  // 17. 이미 잡혀 있는(신선한) 락에 대해 다른 holder가 시도 -> 3초 대기 후 획득 실패(false)
  //     (LOGIN_LOCK_WAIT_MS=3000이라 이 케이스 하나가 약 3초 걸림 — 의도된 것)
  {
    const fs = new FakeFirestore();
    await fs.collection('loginLocks').doc('lock-b@nkmro.com').set({ lockedAt: new Date(), holderId: 'holder-A' });
    const t0 = Date.now();
    const acquired = await acquireLoginLock_(fs, 'lock-b@nkmro.com', 'holder-B');
    const waitedMs = Date.now() - t0;
    const pass = acquired === false && waitedMs >= 2900; // 최소 대기시간 근처까지 실제로 기다렸는지도 함께 확인
    results.push({
      group: 'B', name: '17', desc: '이미 잡힌 신선한 락에 다른 holder가 시도 -> 3초 대기 후 획득 실패(LOGIN_BUSY_RETRY로 이어짐)',
      detail: { acquired, waitedMs }, same: pass
    });
  }

  // 18. 오래된(TTL 만료) 락 -> 다른 holder가 즉시 회수, holderId 불일치 해제는 거부됨
  {
    const fs = new FakeFirestore();
    const staleLockedAt = new Date(Date.now() - (LOGIN_LOCK_STALE_MS + 1000));
    await fs.collection('loginLocks').doc('lock-c@nkmro.com').set({ lockedAt: staleLockedAt, holderId: 'holder-A' });
    const t0 = Date.now();
    const acquired = await acquireLoginLock_(fs, 'lock-c@nkmro.com', 'holder-C');
    const waitedMs = Date.now() - t0;
    // holder-A(원래 주인 아닌 다른 사람)가 해제를 시도해도 문서는 그대로 남아있어야 함(holderId 불일치)
    await releaseLoginLock_(fs, 'lock-c@nkmro.com', 'holder-A');
    const afterWrongRelease = await fs.collection('loginLocks').doc('lock-c@nkmro.com').get();
    const pass = acquired === true && waitedMs < 500 && afterWrongRelease.exists === true && afterWrongRelease.data().holderId === 'holder-C';
    results.push({
      group: 'B', name: '18', desc: '10초 TTL 만료된 락 -> 대기 없이 즉시 회수, holderId 불일치 해제 요청은 무시됨(문서 그대로 유지)',
      detail: { acquired, waitedMs, afterWrongRelease: afterWrongRelease.exists ? afterWrongRelease.data() : null }, same: pass
    });
  }
}

(async function main() {
  await runIdempotencyAndSessionCases();

  console.log(JSON.stringify(results, null, 2));

  console.error('\n=== SUMMARY (loginTest 코드 레벨 parity/정책/락 테스트) ===');
  for (const r of results) {
    console.error(`[${r.group}] case ${r.name}: ${r.same ? 'PASS' : 'FAIL'} - ${r.desc}`);
  }
  const allPass = results.every(function (r) { return r.same; });
  console.error(allPass ? '\nALL CASES PASS' : '\nSOME CASES FAIL');
  process.exitCode = allPass ? 0 : 1;
})();
