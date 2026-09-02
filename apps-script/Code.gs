/**
 * ===== 미러 파일 안내 (2026-08-18 동기화) =====
 * 이 파일은 Apps Script 편집기(스크립트 ID: 1abBaoRibDm8UCe4C_inwRatU7clqoL5_JpV71Rq2D-2cmeprNyn9gvYe)의
 * Code.gs 를 그대로 복사한 미러 사본입니다. 실제로 코드를 수정/배포하는 곳은 여전히 Apps Script 편집기이며,
 * 이 GitHub 파일은 "지금 운영 중인 코드가 무엇인지" 기록/추적하기 위한 용도입니다.
 *
 * [알려진 차이점] 이 사본은 브라우저 자동화로 편집기 내용을 복사해 옮기는 과정에서 원본의 들여쓰기(공백)가
 * 모두 제거되었습니다(줄바꿈과 코드 내용 자체는 100% 동일하며, 문법적으로도 유효한 코드입니다 — node --check로
 * 검증됨). 즉 로직/동작에는 차이가 없지만, 보기 편한 들여쓰기는 원본과 다릅니다. 다음에 Code.gs를 수정해
 * 이 파일을 다시 동기화할 때는, 가능하면 Apps Script 편집기에서 직접 다운로드한 원본 형태로 교체해 주세요.
 */

/**
* MRO 자재 시황 관리 시스템 - 인증/권한 백엔드
* v23: 이메일+비밀번호 로그인/회원가입으로 전환 (Google OAuth 방식 폐기)
*
* 전제:
* - Script Properties에 SHEET_ID 등록 필요 (파일 > 프로젝트 속성 > 스크립트 속성)
* - 프론트(GitHub Pages)는 로그인 성공 시 받은 sessionToken을 이후 모든 요청에
* body.sessionToken으로 실어 보낸다 (idToken 방식 폐기).
* - 회원가입은 @nkmro.com 이메일만 허용, 인증코드(6자리) 확인 후 즉시 활성화되며
* 기본 역할은 '일반'(뷰어)으로 등록된다. 역할 승격은 재홍님이 시트에서 직접 변경.
*/

const SHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
const SHEET_USER = '사용자팀마스터';
const SHEET_SETTING = '설정';
const SHEET_THREAD_SEEN = '댓글확인이력';
const SHEET_COMMENT = '댓글';
const SHEET_POST = '시황게시물';
const SHEET_ITEM = '품목마스터';
const SIGNUP_DOMAIN = 'nkmro.com';
const ADMIN_EMAIL = 'jhjoo@nkmro.com'; // 설정 페이지 전용 — 역할 시스템과 무관
const LOGIN_DIAG_QUEUE_KEY = 'loginDiagQueue_v1';

function buildBrandedEmailHtml_(greetLine, descLine, code, footerLine) {
return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Malgun Gothic,Arial,sans-serif;max-width:560px;margin:0 auto;">' +
'<div style="background:#1a6b52;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0;font-size:15px;font-weight:700;">MRO 자재 시황 관리 시스템</div>' +
'<div style="border:1px solid #e2e0da;border-top:none;border-radius:0 0 8px 8px;padding:28px 24px;">' +
'<div style="font-size:14px;color:#1f2320;margin-bottom:8px;line-height:1.6;">' + greetLine + '</div>' +
'<div style="font-size:13px;color:#6b6f6a;line-height:1.6;margin-bottom:22px;">' + descLine + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;"><tr><td style="background:#f6f5f2;border:1px dashed #c8c4b8;border-radius:10px;padding:20px;text-align:center;">' +
'<div style="font-size:11px;color:#9a9891;margin-bottom:8px;">인증코드</div>' +
'<div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1a6b52;">' + code + '</div>' +
'</td></tr></table>' + '<div style="text-align:center;font-size:12px;color:#b3413a;margin-bottom:4px;">이 코드는 10분간만 유효합니다.</div>' +
'<hr style="border:none;border-top:1px solid #e2e0da;margin:22px 0 14px;">' +
'<div style="font-size:11px;color:#9a9891;line-height:1.6;">' + footerLine + '</div>' +
'</div></div>';
}

/**
* ===== 요청 단위 캐시 (v23 성능 최적화) =====
* 한 번의 doPost 실행(=한 번의 HTTP 요청) 안에서 같은 시트를 여러 번 열고
* getDataRange().getValues()를 반복 호출하던 문제를 해결하기 위한 캐시 레이어.
* - _ssCache_: Spreadsheet 객체 자체를 요청당 1회만 오픈.
* - _sheetDataCache_: 시트 이름별 getValues() 결과를 요청당 1회만 읽어 재사용.
* 주의: GAS 웹앱 인스턴스가 여러 요청에 걸쳐 재사용될 수 있으므로,
* 반드시 doPost() 최초 진입 시 resetRequestCache_()를 호출해야 한다.
*/
let _ssCache_ = null;
let _sheetDataCache_ = {};
let _loginDiag_ = null;
let _materialItemsCache_ = {};

function resetRequestCache_() {
_ssCache_ = null;
_sheetDataCache_ = {};
_loginDiag_ = null;
_materialItemsCache_ = {};
}

function getSS_() {
if (!_ssCache_) {
_ssCache_ = SpreadsheetApp.openById(SHEET_ID);
}
return _ssCache_;
}

function getSheetObj_(sheetName) {
return getSS_().getSheetByName(sheetName);
}

function getSheetValues_(sheetName) {
if (_sheetDataCache_[sheetName]) return _sheetDataCache_[sheetName];

// 5-1/5-2 성능: 요청 간(여러 doPost 호출에 걸쳐) 유지되는 CacheService 레이어.
// _sheetDataCache_(요청 1회용)와 별개로, 5분간 여러 요청이 이 결과를 재사용한다.
// 주의: JSON 직렬화를 거치므로 Date 셀 값은 문자열로 바뀐다. 이 프로젝트의 다른 코드는
// 전부 new Date(x)로 감싸 비교하므로 안전하나(문자열/Date 객체 둘 다 처리 가능),
// 원본 Date 인스턴스 자체가 필요한 곳(예: purgeSheetOlderThan_)은 이 캐시를 타지 않고
// 시트를 직접 읽으므로 영향받지 않는다.
const cache = CacheService.getScriptCache();
const cacheKey = 'sheetv_' + sheetName;
try {
const cached = cache.get(cacheKey);
if (cached) {
const values = JSON.parse(cached);
_sheetDataCache_[sheetName] = values;
return values;
}
} catch (e) {
// 캐시 파싱 실패 시 그냥 시트에서 새로 읽는다(요청 자체는 정상 진행).
}

const values = getSheetObj_(sheetName).getDataRange().getValues();
_sheetDataCache_[sheetName] = values;
try {
cache.put(cacheKey, JSON.stringify(values), 300); // 5분
} catch (e) {
// 100KB 초과 등으로 캐싱 실패해도 요청 자체는 정상 진행(캐시는 최적화일 뿐).
}
return values;
}

function invalidateSheetCache_(sheetName) {
delete _sheetDataCache_[sheetName];
try {
CacheService.getScriptCache().remove('sheetv_' + sheetName);
} catch (e) {}
}

/**
* 웹앱 진입점. 프론트가 id_token을 담아 POST 요청.
* 요청 body 예: { "idToken": "eyJhbGciOi..." }
*/
function doPost(e) {
const __t0 = Date.now();
try {
resetRequestCache_();
const body = JSON.parse(e.postData.contents);
const action = body.action || 'login';

if (action === 'ping') {
// 예열 핑 실측용: 시트/캐시 접근 전혀 없이 콜드스타트 비용만 순수하게 측정하기 위한 액션.
return ContentService.createTextOutput(JSON.stringify({ ok: true, t: Date.now() })).setMimeType(ContentService.MimeType.JSON);
}
if (action === 'getTeams') {
return handleGetTeams_();
}
if (action === 'login') {
let __loginResult;
try {
__loginResult = withIdempotency_(body.idempotencyKey, function () { return handleLogin_(body); });
} catch (loginErr) {
try {
if (_loginDiag_) {
_loginDiag_.ms.total = Date.now() - __t0;
_loginDiag_.ok = false;
_loginDiag_.error = 'EXCEPTION: ' + String(loginErr);
_loginDiag_.isRetry = !!body.isRetry;
writeLoginDiagLog_(String(body.email || '(no-email)'), _loginDiag_);
}
} catch (diagErr) {}
return jsonResponse_({ ok: false, error: 'SERVER_ERROR', detail: String(loginErr) });
}
try {
if (_loginDiag_) {
_loginDiag_.ms.total = Date.now() - __t0;
// __loginResult는 jsonResponse_()가 반환한 ContentService 객체라 .ok/.error 프로퍼티가
// 없다(항상 undefined) - 실제 값을 보려면 안에 든 JSON 문자열을 파싱해야 한다. 이 버그
// 때문에 로그인진단로그에는 성공/실패 상관없이 항상 ok:false, error 없음으로 잘못
// 기록되고 있었다(2026-08-07 발견, 실제 클라이언트 응답 자체는 정상이었음).
let __loginResultObj = null;
try { __loginResultObj = JSON.parse(__loginResult.getContent()); } catch (parseErr) {}
_loginDiag_.ok = !!(__loginResultObj && __loginResultObj.ok);
if (__loginResultObj && !__loginResultObj.ok) _loginDiag_.error = __loginResultObj.error;
_loginDiag_.isRetry = !!body.isRetry;
writeLoginDiagLog_(String(body.email || '(no-email)'), _loginDiag_);
}
} catch (diagErr) {}
return __loginResult;
}

if (action === 'requestSignup') {
return handleRequestSignup_(body);
}
if (action === 'verifySignup') {
return handleVerifySignup_(body);
}
if (action === 'requestPasswordReset') {
return handleRequestPasswordReset_(body);
}
if (action === 'confirmPasswordReset') {
return handleConfirmPasswordReset_(body);
}

const user = authenticateRequest_(body);
if (!user) {
return jsonResponse_({ ok: false, error: 'UNAUTHORIZED' });
}

let __result;
switch (action) {
case 'getFeed': __result = handleGetFeed_(user, body); break;
case 'pollSignal': __result = handlePollSignal_(user, body); break;
case 'getComments': __result = handleGetComments_(user, body); break;
case 'postComment': __result = withIdempotency_(body.idempotencyKey, function () { return handlePostComment_(user, body); }); break;
case 'updateComment': __result = withIdempotency_(body.idempotencyKey, function () { return handleUpdateComment_(user, body); }); break;
case 'deleteComment': __result = withIdempotency_(body.idempotencyKey, function () { return handleDeleteComment_(user, body); }); break;
case 'getNotifications': __result = handleGetNotifications_(user, body); break;
case 'clientDebugLog': __result = handleClientDebugLog_(user, body); break;
case 'getPostById': __result = handleGetPostById_(user, body); break;
case 'markChecked': __result = withIdempotency_(body.idempotencyKey, function () { return handleMarkChecked_(user, body); }); break;
case 'upsertItem': __result = withIdempotency_(body.idempotencyKey, function () { return handleUpsertItem_(user, body); }); break;
case 'suggestMaterials': __result = handleSuggestMaterials_(user, body); break;
case 'getSettings': __result = handleGetSettings_(user, body); break;
case 'updateSettings': __result = withIdempotency_(body.idempotencyKey, function () { return handleUpdateSettings_(user, body); }); break;
case 'getUsers': __result = handleGetUsers_(user, body); break;
case 'updateUser': __result = withIdempotency_(body.idempotencyKey, function () { return handleUpdateUser_(user, body); }); break;
case 'getThreadSeen': __result = handleGetThreadSeen_(user, body); break;
case 'markThreadSeen': __result = withIdempotency_(body.idempotencyKey, function () { return handleMarkThreadSeen_(user, body); }); break;
case 'getItems': __result = handleGetItems_(user, body); break;
case 'getCustomers': __result = handleGetCustomers_(user, body); break;
case 'upsertCustomer': __result = withIdempotency_(body.idempotencyKey, function () { return handleUpsertCustomer_(user, body); }); break;
case 'changePassword': __result = withIdempotency_(body.idempotencyKey, function () { return handleChangePassword_(user, body); }); break;
case 'getAttentionPosts': __result = handleGetAttentionPosts_(user, body); break;
case 'getTeamManagers': __result = handleGetTeamManagers_(user, body); break;
default: __result = jsonResponse_({ ok: false, error: 'UNKNOWN_ACTION' });
}
Logger.log('TIMING ' + action + ': ' + (Date.now() - __t0) + 'ms');
return __result;
} catch (err) {
return jsonResponse_({ ok: false, error: 'SERVER_ERROR', detail: String(err) });
}
}

/**
* action: 'login' — 이메일 + 비밀번호 로그인 (v23, Google OAuth 폐기).
* 성공 시 sessionToken을 발급하며, 이후 모든 요청은 이 토큰을 실어 보낸다.
*/
function handleLogin_(body) {
const email = String(body.email || '').trim().toLowerCase();
const password = String(body.password || '');

if (!email || !password) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

// [TEMP-DIAG 2026-08-05] 로그인 지연 원인(콜드스타트/네트워크/시트I/O) 진단용. 확인 후 제거 예정.
_loginDiag_ = { ms: {}, platform: String(body.platform || 'unknown') };
try {
_loginDiag_.userSheetCacheHit = !!CacheService.getScriptCache().get('sheetv_' + SHEET_USER);
} catch (diagE) {}

const __tFindUser = Date.now();
const user = findUser_(email);
_loginDiag_.ms.findUser = Date.now() - __tFindUser;

if (!user) {
return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
}
if (user.status !== '활성') {
return jsonResponse_({ ok: false, error: 'USER_INACTIVE' });
}
if (user.failCount >= 5) {
return jsonResponse_({ ok: false, error: 'ACCOUNT_LOCKED' });
}
const __tHash = Date.now();
const __computedHash = hashPassword_(password, email);
_loginDiag_.ms.hash = Date.now() - __tHash;
if (!user.passwordHash || user.passwordHash !== __computedHash) {
const __tWrite = Date.now();
incrementLoginFailCount_(email, user.failCount);
_loginDiag_.ms.write = Date.now() - __tWrite;
return jsonResponse_({ ok: false, error: 'WRONG_PASSWORD' });
}

const __tWrite2 = Date.now();
resetLoginFailCount_(email);
_loginDiag_.ms.write = Date.now() - __tWrite2;

const sessionToken = Utilities.getUuid();
CacheService.getScriptCache().put('session_' + sessionToken, email, 21600); // 6시간(CacheService 최대 TTL)
syncSessionToCloudRun_(sessionToken, email);
// 캐시에 짧게 저장해서 이후 요청(코멘트 조회 등)마다
// 매번 시트를 다시 읽지 않도록 함 (CacheService, 5분)
cacheUser_(email, user);

const expireDays = Number(getSetting_('비밀번호만료일수')) || 90;
const changedAt = user.passwordChangedAt ? new Date(user.passwordChangedAt) : null;
const daysSincePwChange = changedAt ? (Date.now() - changedAt.getTime()) / 86400000 : Infinity;
const passwordExpired = daysSincePwChange > expireDays;

return jsonResponse_({
ok: true,
sessionToken: sessionToken,
email: email,
name: user.name,
role: user.role,
team: user.team,
passwordExpired: passwordExpired
});
}
// 로그인 성공 시 Firestore에 세션을 미러링 (Cloud Run 마이그레이션용, v24). 실패해도 로그인 흐름에는 영향 없음(best-effort).
function syncSessionToCloudRun_(sessionToken, email) {
try {
UrlFetchApp.fetch('https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/sessionSyncTest', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ sessionToken: sessionToken, email: email }), muteHttpExceptions: true });
} catch (e) {
console.error('syncSessionToCloudRun_ 실패(무시): ' + e);
}
}

// 로그인 Cloud Run 재전환 준비(2026-08-28): 세션 저장소 비대칭 해소용 조회 헬퍼.
// 지금까지는 syncSessionToCloudRun_()로 "Apps Script -> Firestore" 방향의 복사만 있고
// 반대 방향(Firestore에만 있는 세션을 Apps Script CacheService가 알아보는 경로)이 없었다.
// login이 Cloud Run(loginTest)으로 전환되면 세션이 Firestore에만 기록되므로, 그 세션으로
// 들어온 요청이 이 함수를 못 만나면 (아직 이 서버로는 옮기지 않은 다른 액션이거나, 다른
// Cloud Run 액션이 실패해 Apps Script로 폴백한 경우) authenticateRequest_가 "모르는 세션"으로
// 판단해 정상 로그인한 사용자를 강제 로그아웃시키는 문제가 생긴다. 이미 배포되어 있는
// whoamiTest(Cloud Run, sessionToken -> Firestore 세션 조회 + 사용자 정보 반환)를 그대로
// 재사용해서 이 문제를 해소한다(새 Cloud Run 함수를 추가하지 않음). 실패(네트워크 오류,
// 세션 없음/만료 등 무엇이든)하면 조용히 null을 반환해 기존과 동일하게 인증 실패로 처리된다
// — 필수 경로가 아니라 best-effort 보완 조회다.
function lookupSessionEmailFromCloudRun_(sessionToken) {
try {
const resp = UrlFetchApp.fetch('https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/whoamiTest', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ sessionToken: sessionToken }), muteHttpExceptions: true });
const json = JSON.parse(resp.getContentText());
if (json && json.ok && json.email) return json.email;
return null;
} catch (e) {
return null;
}
}

/**
* login 이외의 action에서 공통으로 쓰는 인증 헬퍼 (v23, sessionToken 기반).
* 세션 캐시에 있으면 캐시를 우선 사용해 시트 재조회를 줄이고,
* 사용 중인 세션은 요청마다 TTL을 6시간으로 슬라이딩 연장한다.
* (2026-08-28) 캐시에 없으면 Cloud Run(whoamiTest)에도 한 번 물어본다 — login이 Cloud Run에서
* 발급한 세션은 이 캐시에 원래 기록된 적이 없기 때문. lookupSessionEmailFromCloudRun_() 참고.
*/
function authenticateRequest_(body) {
const sessionToken = body.sessionToken;
if (!sessionToken) return null;

const cache = CacheService.getScriptCache();
const cacheKey = 'session_' + sessionToken;
let email = cache.get(cacheKey);
if (!email) {
email = lookupSessionEmailFromCloudRun_(sessionToken);
if (!email) return null;
}

cache.put(cacheKey, email, 21600); // 슬라이딩 세션 연장 (Cloud Run 쪽에서 방금 확인된 세션이면 여기서 처음 기록됨)

let user = getCachedUser_(email);
if (!user) {
user = findUser_(email);
if (user) cacheUser_(email, user);
}
if (!user || user.status !== '활성') return null;
return user;
}

/**
* 비밀번호 해시 (SHA-256 + 이메일 salt). 평문은 절대 저장하지 않는다.
*/
function hashPassword_(password, email) {
const raw = password + ':' + String(email).trim().toLowerCase();
const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
return bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

function updateSheetCacheCell_(sheetName, rowIndex, colIndex, value) {
// 로그인 실패/성공 시 시트에 쓴 값 하나를 캐시에도 즉시 반영한다 (시트 재조회 없이).
// 동시에 같은 시트를 갱신하는 다른 요청과 겹치지 않도록 짧은 락으로 보호한다.
const lock = LockService.getScriptLock();
const gotLock = lock.tryLock(3000);
if (!gotLock) {
invalidateSheetCache_(sheetName); // 락을 못 잡으면 그냥 무효화(다음 요청이 새로 읽음)
return;
}
try {
const cache = CacheService.getScriptCache();
const cacheKey = 'sheetv_' + sheetName;
let data = null;
try {
const cached = cache.get(cacheKey);
data = cached ? JSON.parse(cached) : null;
} catch (e) {
data = null;
}
if (!data) {
delete _sheetDataCache_[sheetName]; // 캐시가 이미 비어있으면 다음 요청이 자연스럽게 새로 읽게 둔다
return;
}
if (data[rowIndex]) data[rowIndex][colIndex] = value;
_sheetDataCache_[sheetName] = data;
cache.put(cacheKey, JSON.stringify(data), 300);
} catch (e) {
invalidateSheetCache_(sheetName);
} finally {
lock.releaseLock();
}
}

function incrementLoginFailCount_(email, currentFailCount) {
const sheet = getSheetObj_(SHEET_USER);
const data = getSheetValues_(SHEET_USER);
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
sheet.getRange(i + 1, 8).setValue((currentFailCount || 0) + 1); // H열: 로그인실패횟수
updateSheetCacheCell_(SHEET_USER, i, 7, (currentFailCount || 0) + 1);
break;
}
}
}

function resetLoginFailCount_(email) {
const sheet = getSheetObj_(SHEET_USER);
const data = getSheetValues_(SHEET_USER);
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
sheet.getRange(i + 1, 8).setValue(0);
updateSheetCacheCell_(SHEET_USER, i, 7, 0);
break;
}
}
}

/**
* action: 'requestSignup' — 회원가입 1단계. @nkmro.com 이메일만 허용.
* 인증코드(6자리)를 이메일로 발송하고, 비밀번호는 해시만 캐시에 임시 보관한다.
*/
function handleGetTeams_() {
const sheet = getSheetObj_(SHEET_USER);
const rule = sheet.getRange('D2').getDataValidation();
const teams = (rule && rule.getCriteriaValues()[0]) || [];
return jsonResponse_({ ok: true, teams: teams });
}

function checkAndIncrementRequestRate_(prefix, email) {
const cache = CacheService.getScriptCache();
const key = prefix + '_rate_' + Utilities.base64EncodeWebSafe(email);
const current = Number(cache.get(key)) || 0;
if (current >= 5) return false;
cache.put(key, String(current + 1), 3600); // 1시간
return true;
}

function handleRequestSignup_(body) {
const email = String(body.email || '').trim().toLowerCase();
const name = String(body.name || '').trim();
const team = String(body.team || '').trim();
const password = String(body.password || '');

if (!email || !name || !team || !password) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
if (!email.endsWith('@' + SIGNUP_DOMAIN)) {
return jsonResponse_({ ok: false, error: 'INVALID_DOMAIN' });
}
if (password.length < 6) {
return jsonResponse_({ ok: false, error: 'PASSWORD_TOO_SHORT' });
}
if (findUser_(email)) {
return jsonResponse_({ ok: false, error: 'ALREADY_REGISTERED' });
}
if (!checkAndIncrementRequestRate_('signup', email)) {
return jsonResponse_({ ok: false, error: 'TOO_MANY_REQUESTS' });
}

const code = String(Math.floor(100000 + Math.random() * 900000));
const passwordHash = hashPassword_(password, email);
const cache = CacheService.getScriptCache();
cache.put('signup_' + Utilities.base64EncodeWebSafe(email), JSON.stringify({ code: code, name: name, team: team, passwordHash: passwordHash, attempts: 0 }), 600); // 10분

GmailApp.sendEmail(email, '[MRO 시황] 회원가입 인증코드', name + '님, 회원가입 인증코드는 [' + code + '] 입니다. 10분 이내에 입력해주세요.', { from: ADMIN_EMAIL, name: 'MRO 자재 시황', htmlBody: buildBrandedEmailHtml_(name + '님, 안녕하세요.', '회원가입을 위해 아래 인증코드를 화면에 입력해주세요.', code, '이 메일은 MRO 자재 시황 관리 시스템에서 자동으로 발송했어요.') });

return jsonResponse_({ ok: true });
}
function handleVerifySignup_(body) {
const email = String(body.email || '').trim().toLowerCase();
const code = String(body.code || '').trim();

const cache = CacheService.getScriptCache();
const cacheKey = 'signup_' + Utilities.base64EncodeWebSafe(email);
const cached = cache.get(cacheKey);
if (!cached) {
return jsonResponse_({ ok: false, error: 'CODE_EXPIRED_OR_NOT_FOUND' });
}
const data = JSON.parse(cached);
if (data.code !== code) {
data.attempts = (data.attempts || 0) + 1;
if (data.attempts >= 5) {
cache.remove(cacheKey);
return jsonResponse_({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
}
cache.put(cacheKey, JSON.stringify(data), 600);
return jsonResponse_({ ok: false, error: 'CODE_MISMATCH', remainingAttempts: 5 - data.attempts });
}
if (findUser_(email)) {
cache.remove(cacheKey);
return jsonResponse_({ ok: false, error: 'ALREADY_REGISTERED' });
}

const sheet = getSheetObj_(SHEET_USER);
sheet.appendRow([email, data.name, '일반', data.team, '활성', '', data.passwordHash, 0, new Date().toISOString()]);
invalidateSheetCache_(SHEET_USER);
cache.remove(cacheKey);

return jsonResponse_({ ok: true });
}
function handleRequestPasswordReset_(body) {
const email = String(body.email || '').trim().toLowerCase();
if (!email) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
const user = findUser_(email);
if (!user) {
return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
}
if (!checkAndIncrementRequestRate_('pwreset', email)) {
return jsonResponse_({ ok: false, error: 'TOO_MANY_REQUESTS' });
}

const code = String(Math.floor(100000 + Math.random() * 900000));
const cache = CacheService.getScriptCache();
cache.put('pwreset_' + Utilities.base64EncodeWebSafe(email), JSON.stringify({ code: code, attempts: 0 }), 600); // 10분

GmailApp.sendEmail(email, '[MRO 시황] 비밀번호 재설정 인증코드', user.name + '님, 비밀번호 재설정 인증코드는 [' + code + '] 입니다. 10분 이내에 입력해주세요.', { from: ADMIN_EMAIL, name: 'MRO 자재 시황', htmlBody: buildBrandedEmailHtml_(user.name + '님, 안녕하세요.', '비밀번호 재설정을 요청하셨습니다. 아래 인증코드를 화면에 입력해주세요.', code, '본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 비밀번호는 변경되지 않습니다.') });

return jsonResponse_({ ok: true });
}
function handleConfirmPasswordReset_(body) {
const email = String(body.email || '').trim().toLowerCase();
const code = String(body.code || '').trim();
const newPassword = String(body.newPassword || '');

if (!email || !code || !newPassword) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
if (newPassword.length < 6) {
return jsonResponse_({ ok: false, error: 'PASSWORD_TOO_SHORT' });
}

const cache = CacheService.getScriptCache();
const cacheKey = 'pwreset_' + Utilities.base64EncodeWebSafe(email);
const cached = cache.get(cacheKey);
if (!cached) {
return jsonResponse_({ ok: false, error: 'CODE_MISMATCH_OR_EXPIRED' });
}
const data = JSON.parse(cached);
if (data.code !== code) {
data.attempts = (data.attempts || 0) + 1;
if (data.attempts >= 5) {
cache.remove(cacheKey);
return jsonResponse_({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
}
cache.put(cacheKey, JSON.stringify(data), 600);
return jsonResponse_({ ok: false, error: 'CODE_MISMATCH_OR_EXPIRED', remainingAttempts: 5 - data.attempts });
}

const sheet = getSheetObj_(SHEET_USER);
const rows = getSheetValues_(SHEET_USER);
let found = false;
for (let i = 1; i < rows.length; i++) {
if (String(rows[i][0]).trim().toLowerCase() === email) {
sheet.getRange(i + 1, 7).setValue(hashPassword_(newPassword, email)); // G열: 비밀번호해시
sheet.getRange(i + 1, 8).setValue(0); // H열: 로그인실패횟수 초기화(잠금 해제)
invalidateSheetCache_(SHEET_USER);
found = true;
break;
}
}
cache.remove(cacheKey);

if (!found) {
return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
}
return jsonResponse_({ ok: true });
}
function findUser_(email) {
const data = getSheetValues_(SHEET_USER);

for (let i = 1; i < data.length; i++) {
const row = data[i];
if (String(row[0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
return {
email: row[0],
name: row[1],
role: row[2],
team: row[3],
status: row[4],
lastCheckedAt: row[5] || null,
passwordHash: row[6] || null,
passwordChangedAt: row[8] || null,
failCount: Number(row[7]) || 0
};
}
}
return null;
}

/**
* 설정 시트에서 키로 값 조회 (예: '팀장_열람범위' → '자기팀' 또는 '전체').
*/
function getSetting_(key) {
const data = getSheetValues_(SHEET_SETTING); // [키, 값, 설명]

for (let i = 1; i < data.length; i++) {
if (data[i][0] === key) return data[i][1];
}
return null;
}

/**
* 코멘트 열람 권한 체크. 코멘트 조회 API(3단계 이후)에서 이 함수를 호출해
* 서버에서 필터링한다. 클라이언트 필터 절대 금지 원칙 반영.
*
* @param {Object} user - { role, team } (findUser_ 반환값)
* @param {string} commentTeam - 조회하려는 코멘트가 속한 팀
* @return {boolean}
*/
function canViewComment_(user, commentTeam) {
switch (user.role) {
case '임원':
return true; // 전 지역
case '팀장': {
const scope = getSetting_('팀장_열람범위'); // '자기팀' | '전체'
return scope === '전체' || user.team === commentTeam;
}
case '담당':
case '일반':
return user.team === commentTeam; // 자기 팀만
default:
return false;
}
}

/**
* 캐시 저장 (5분). 이메일을 키로 하되 그대로 쓰면 콜론 등 특수문자로
* CacheService 키 제한에 걸릴 수 있어 간단히 해시 처리.
*/
function cacheUser_(email, user) {
const cache = CacheService.getScriptCache();
const key = 'user_' + Utilities.base64EncodeWebSafe(email);
cache.put(key, JSON.stringify(user), 300); // 5분
}

function getCachedUser_(email) {
const cache = CacheService.getScriptCache();
const key = 'user_' + Utilities.base64EncodeWebSafe(email);
const cached = cache.get(key);
return cached ? JSON.parse(cached) : null;
}

function jsonResponse_(obj) {
return ContentService.createTextOutput(JSON.stringify(obj))
.setMimeType(ContentService.MimeType.JSON);
}

function withIdempotency_(idempotencyKey, actionFn) {
if (!idempotencyKey) return actionFn();
const cache = CacheService.getScriptCache();
const cacheKey = 'idem_' + idempotencyKey;
const IN_PROGRESS = '__IN_PROGRESS__';
const TTL_SEC = 21600;

const lock = LockService.getScriptLock();
let gotLock = false;
try {
gotLock = lock.tryLock(5000);
} catch (e) {}

if (!gotLock) {
return actionFn();
}

let reservedByMe = false;
try {
const existing = cache.get(cacheKey);
if (existing && existing !== IN_PROGRESS) {
return ContentService.createTextOutput(existing).setMimeType(ContentService.MimeType.JSON);
}
if (!existing) {
cache.put(cacheKey, IN_PROGRESS, TTL_SEC);
reservedByMe = true;
}
} finally {
lock.releaseLock();
}

if (!reservedByMe) {
for (let i = 0; i < 4; i++) {
Utilities.sleep(500);
const polled = cache.get(cacheKey);
if (polled && polled !== IN_PROGRESS) {
return ContentService.createTextOutput(polled).setMimeType(ContentService.MimeType.JSON);
}
}
return jsonResponse_({ ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' });
}

try {
const resultOutput = actionFn();
const resultText = resultOutput.getContent();
cache.put(cacheKey, resultText, TTL_SEC);
return resultOutput;
} catch (err) {
cache.remove(cacheKey);
throw err;
}
}

/**
* 마스터 시트에 새 데이터가 입력되면 등록일 컬럼을 오늘 날짜로 자동 기록.
* 이미 등록일 값이 있으면(수동 입력 포함) 덮어쓰지 않음 - 수동 입력이 항상 우선.
* 단순 트리거(simple trigger)라 별도 설치 없이 이 스프레드시트 편집 시 자동 실행됨.
*
* REG_DATE_CONFIGS: 시트별 등록일 자동화 설정
* - regDateCol : 등록일이 위치한 컬럼 번호
* - triggerCols: 이 컬럼들 중 하나라도 값이 있으면 등록일 자동 기록 대상으로 판단
*/
const REG_DATE_CONFIGS = {
'품목마스터': { regDateCol: 8, triggerCols: [1, 3] }, // H열 / MP자재코드(A), 품목명(C) — G열(영문명) 삭제로 8열로 조정
'원자재마스터': { regDateCol: 5, triggerCols: [1, 2] } // E열 / 원자재코드(A), 원자재명 한글(B) — C열(영문명) 삭제로 5열로 조정
};

function onEdit(e) {
try {
const sheet = e.range.getSheet();
const config = REG_DATE_CONFIGS[sheet.getName()];
if (!config) return;

const row = e.range.getRow();
if (row === 1) return; // 헤더 행 제외

const regDateCell = sheet.getRange(row, config.regDateCol);
if (regDateCell.getValue() !== '') return; // 이미 값이 있으면(수동 입력 포함) 건드리지 않음

const hasTriggerValue = config.triggerCols.some(function (col) {
return sheet.getRange(row, col).getValue() !== '';
});
if (!hasTriggerValue) return;

regDateCell.setValue(new Date());
regDateCell.setNumberFormat('yyyy-mm-dd');
} catch (err) {
// onEdit 트리거 오류가 시트 편집 자체를 막지 않도록 무시
}
}

// ==================== 원자재 자동 추천 (품목명 → 원자재 매핑) ====================

function onEditInstallable(e) {
try {
const sheet = e.range.getSheet();
const sheetName = sheet.getName();
const row = e.range.getRow();
const col = e.range.getColumn();
if (row === 1) return; // 헤더 제외

// 마스터 데이터 변경 시 품목마스터 일괄 동기화 (고객사마스터.소장, 사용자팀마스터.소속팀)
if (sheetName === '고객사마스터' && col === 3) {
const startRow = Math.max(2, row);
const endRow = e.range.getLastRow();
for (let r = startRow; r <= endRow; r++) {
const customer = sheet.getRange(r, 2).getValue();
if (customer) runWithSyncLock_(function () { syncManagersForCustomer_(customer); });
}
return;
}

if (sheetName === SHEET_USER && col === 4) {
const startRowU = Math.max(2, row);
const endRowU = e.range.getLastRow();
for (let ru = startRowU; ru <= endRowU; ru++) {
const managerName = sheet.getRange(ru, 2).getValue();
if (managerName) runWithSyncLock_(function () { syncTeamsForManager_(managerName); });
}
return;
}

if (sheetName !== '품목마스터') return;
const startRow2 = Math.max(2, row);
const endRow2 = e.range.getLastRow();
for (let r2 = startRow2; r2 <= endRow2; r2++) {
try {
const a2 = sheet.getRange(r2, 1).getValue();
const b2 = sheet.getRange(r2, 2).getValue();
const c2 = sheet.getRange(r2, 3).getValue();
if (!a2 || !b2 || !c2) continue;
const dCell2 = sheet.getRange(r2, 4);
if (!dCell2.getValue()) autofillManagerFromCustomer_(sheet, r2);
const fCell2 = sheet.getRange(r2, 6);
if (!fCell2.getValue()) {
const aiResult2 = suggestRawMaterials(c2);
if (aiResult2 && aiResult2.korean && aiResult2.korean.length) {
fCell2.setValue(aiResult2.korean.join(', '));
}
}
const gCell2 = sheet.getRange(r2, 7);
if (!gCell2.getValue()) gCell2.setValue('활성');
const hCell2 = sheet.getRange(r2, 8);
if (!hCell2.getValue()) {
hCell2.setValue(new Date());
hCell2.setNumberFormat('yyyy-mm-dd');
}
} catch (rowErr2) {
console.error('ensureItemRowComplete row ' + r2 + ' error: ' + rowErr2);
}
}

if (col === 2) { autofillManagerFromCustomer_(sheet, row); return; } // B열(고객사) 선택 시 D/E 연쇄 자동입력 (신규 행용)

if (col !== 3) return; // C열(품목명)만 반응

// v19: 단일 셀(1x1) 편집인지 판별 - 붙여넣기(여러 행/열 동시 편집)와 구분해서 처리
const isSingleCellEdit = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;

const itemName = sheet.getRange(row, 3).getValue();
if (!itemName) return;

// F열(주요원자재 한글)에 이미 값이 있으면 건드리지 않음 - 수동 입력 우선 원칙
// 단, 사람이 단일 셀을 직접 수정(확정)한 경우엔 F값 유무와 무관하게 무조건 재추천한다.
// (품목명을 잘못 입력했다가 고친 경우 F가 옛 값으로 남는 문제 방지 - 붙여넣기 경로는 기존대로 F가 비어있을 때만 채움)
const existingF = sheet.getRange(row, 6).getValue();
if (existingF !== '' && !isSingleCellEdit) return;

const result = suggestRawMaterials(itemName);
if (!result) return;

sheet.getRange(row, 6).setValue(result.korean.join(', '));
} catch (err) {
// 실패해도 시트 편집 자체는 막지 않음
console.error('onEditInstallable error: ' + err);
}

}
// ===================== 담당소장/팀 자동입력 (고객사 → 소장 → 팀 연쇄) =====================

function autofillManagerFromCustomer_(sheet, row) {
const customer = sheet.getRange(row, 2).getValue();
if (!customer) return;

const existingManager = sheet.getRange(row, 4).getValue();
if (existingManager !== '') return; // 수동 입력 우선 원칙

const ss = SpreadsheetApp.openById(SHEET_ID);
const custSheet = ss.getSheetByName('고객사마스터');
const custData = custSheet.getDataRange().getValues();

let manager = '';
for (let i = 1; i < custData.length; i++) {
if (custData[i][1] === customer) { // B열: 고객사명
manager = custData[i][2]; // C열: 소장
break;
}
}
if (!manager) return;

sheet.getRange(row, 4).setValue(manager); // D열: 담당소장
autofillTeamFromManager_(sheet, row);
}

function autofillTeamFromManager_(sheet, row) {
const manager = sheet.getRange(row, 4).getValue();
if (!manager) return;

const ss = SpreadsheetApp.openById(SHEET_ID);
const teamSheet = ss.getSheetByName(SHEET_USER);
const teamData = teamSheet.getDataRange().getValues();

for (let i = 1; i < teamData.length; i++) {
if (teamData[i][1] === manager) { // B열: 이름
const team = teamData[i][3]; // D열: 소속팀
if (team) sheet.getRange(row, 5).setValue(team); // E열: 팀/지역
return;
}
}
}

// ===================== 마스터 데이터 변경 시 품목마스터 일괄 동기화 =====================

// syncManagersForCustomer_/syncTeamsForManager_ 실행 중 발생하는 품목마스터 D/E열 setValues는
// 자체적으로 onEdit을 재발화할 수 있으나, 해당 범위(col=4)는 onEditInstallable에서 반응하지
// 않는 열이라 자연스럽게 무해하다. 그래도 방어적으로 CacheService 락을 추가해 재진입을 차단한다.
function runWithSyncLock_(fn) {
const cache = CacheService.getScriptCache();
if (cache.get('MASTER_SYNC_LOCK') === '1') return; // 이미 동기화 진행 중
cache.put('MASTER_SYNC_LOCK', '1', 30); // 최대 30초 락
try {
fn();
} finally {
cache.remove('MASTER_SYNC_LOCK');
}
}

function syncManagersForCustomer_(customerName) {
const ss = SpreadsheetApp.openById(SHEET_ID);
const custSheet = ss.getSheetByName('고객사마스터');
const custData = custSheet.getDataRange().getValues();

let manager = '';
for (let i = 1; i < custData.length; i++) {
if (custData[i][1] === customerName) { // B열: 고객사명
manager = custData[i][2]; // C열: 소장
break;
}
}

const itemSheet = ss.getSheetByName('품목마스터');
const lastRow = itemSheet.getLastRow();
if (lastRow < 2) return;

const bValues = itemSheet.getRange(2, 2, lastRow - 1, 1).getValues(); // B열(고객사)만 읽기
const deRange = itemSheet.getRange(2, 4, lastRow - 1, 2); // D~E열
const deValues = deRange.getValues();

let changed = false;
for (let i = 0; i < bValues.length; i++) {
if (bValues[i][0] === customerName && deValues[i][0] !== manager) {
deValues[i][0] = manager; // D열: 담당소장
changed = true;
}
}
if (changed) deRange.setValues(deValues);

if (manager) syncTeamsForManager_(manager); // 소장이 바뀌었으니 팀도 재동기화
}

function syncTeamsForManager_(managerName) {
const ss = SpreadsheetApp.openById(SHEET_ID);
const teamSheet = ss.getSheetByName(SHEET_USER);
const teamData = teamSheet.getDataRange().getValues();

let team = '';
for (let i = 1; i < teamData.length; i++) {
if (teamData[i][1] === managerName) { // B열: 이름
team = teamData[i][3]; // D열: 소속팀
break;
}
}

const itemSheet = ss.getSheetByName('품목마스터');
const lastRow = itemSheet.getLastRow();
if (lastRow < 2) return;

const deRange = itemSheet.getRange(2, 4, lastRow - 1, 2); // D~E열
const deValues = deRange.getValues();

let changed = false;
for (let i = 0; i < deValues.length; i++) {
if (deValues[i][0] === managerName && deValues[i][1] !== team) {
deValues[i][1] = team; // E열: 팀/지역
changed = true;
}
}
if (changed) deRange.setValues(deValues);
}

function suggestRawMaterials(itemName) {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const rmSheet = ss.getSheetByName('원자재마스터');
const data = rmSheet.getDataRange().getValues();
const rows = data.slice(1).filter(r => r[0]); // 헤더 제외, 빈 행 제외

const existingList = rows.map(r => ({
code: r[0], korean: r[1], keyword: r[2]
}));

const listText = existingList
.map(m => `- 코드:${m.code}, 한글명:${m.korean}`)
.join('\n');

const prompt = `너는 MRO(산업 소모성 자재) 원자재 분류 전문가야.
아래 품목명을 만드는 데 사용되는 주요 원자재를 판단해줘.

[기존 등록된 원자재 목록]
${listText}

[품목명]
${itemName}

규칙:
1. 먼저 이 품목의 원가에 실질적으로 영향을 주는 원자재를 모두 나열해봐. 하나만 있다고 단정하지 말고 여러 개일 가능성을 항상 먼저 검토해 (예: 부직포 필터 → 펄프, PP). 단, 품목명 자체가 이미 시장에서 유통되는 화학제품/원자재명(예: 가성소다, 요소, 황산, 암모니아)이라면 그 상위 원료(예: 소금, 천연가스)로 쪼개지 말고 품목명 자체를 주요원자재로 사용해 - 시황 뉴스는 원료가 아니라 실제 유통되는 화학제품명 기준으로 보도되기 때문이야. 단, 품목명에 쓰인 표현이 업계 관용명/줄임말/오기이고 뉴스·시황 보도에서는 정식 화학명이 훨씬 더 많이 쓰인다면(예: '유산반토'→실제 뉴스는 '황산알루미늄', '차염소산소다'→실제 뉴스는 '차아염소산소다'), 품목명 표현을 그대로 쓰지 말고 뉴스 검색에 실제로 걸리는 정식 명칭을 사용해.
2. 나열한 원자재 각각에 대해 기존 목록을 확인해. 세부 등급 차이 정도면(예: 폴리에틸렌 vs 저밀도폴리에틸렌) 기존 항목명을 재사용해. 하지만 원료 자체가 달라서 시황(가격 흐름)이 별도로 움직이는 경우(예: 버진 펄프 vs 재활용 고지/폐지)는 억지로 기존 항목에 합치지 말고 새 원자재로 제안해(isNew: true).
3. 위 2번에 해당하지 않고 애매하면 가장 가까운 기존 항목을 재사용해 — 원자재 종류가 무한정 늘어나지 않게 신중하게 판단해.
4. 반드시 아래 JSON 형식으로만 응답해. 다른 설명 붙이지 마.
5. keyword(수집키워드)는 원자재명 그대로 써도 되고, 뉴스 검색에 더 적합한 시장 용어로 바꿔도 좋아
(예: '폴리에틸렌' 대신 'PE 필름'). 화학제품의 경우 업계 관용명/줄임말과 정식 화학명이 다를 수 있는데,
반드시 실제 뉴스·시황 기사 검색에 걸리는 쪽을 keyword로 선택해 - 관용명이 뉴스에 거의 안 나온다면
정식 화학명을 keyword로 써(예: '유산반토'가 아니라 '황산알루미늄', '차염소산소다'가 아니라 '차아염소산소다').
korean(한글명) 필드는 관용명을 유지해도 되지만, keyword만큼은 실제 검색 결과가 나오는 표현이어야 해.
단, '가격'/'인상'/'인하'/'단가' 같은 시황 단어는 절대 붙이지 마 —
그건 검색 시점에 별도로 조합돼.
6. 최종적으로 응답에 포함하는 원자재(materials 배열)는 품목의 원가에서 차지하는 비중이 큰 순서로 최대 2개까지만 선정해. 후보가 여러 개 있더라도 가장 핵심적인 2개만 남기고 나머지는 제외해.

{
"materials": [
{ "isNew": false, "korean": "고무", "keyword": "고무" },
{ "isNew": true, "korean": "재활용 폐지", "keyword": "고지" }
]
}`;

let parsed = null;
let lastRawText = '';
for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
const text = callAI_(prompt);
if (!text) continue;
lastRawText = text;
try {
const cleaned = text.replace(/```json|```/g, '').trim();
const p = JSON.parse(cleaned);
if (p.materials && p.materials.length > 0) parsed = p;
} catch (err) {
console.error('suggestRawMaterials JSON parse error (attempt ' + (attempt + 1) + '): ' + err + ' / raw: ' + text);
}
}
if (!parsed) {
console.error('suggestRawMaterials: no valid result after retries for ' + itemName + ' / lastRaw: ' + lastRawText);
return null;
}
const koreanNames = [];

const lock = LockService.getScriptLock();
const gotLock = lock.tryLock(10000);
if (!gotLock) {
console.error('suggestRawMaterials: could not acquire lock for ' + itemName);
return null;
}

try {
// AI 호출 중 다른 실행이 원자재를 추가했을 수 있으므로, 락 안에서 최신 데이터를 다시 읽는다.
const freshData = rmSheet.getDataRange().getValues();
const freshRows = freshData.slice(1).filter(r => r[0]);
const normalize = s => String(s || '').replace(/\s/g, '').toLowerCase();
const freshNames = new Set(freshRows.map(r => normalize(r[1])));
let nextCodeNum = freshRows.length
? Math.max.apply(null, freshRows.map(r => parseInt(String(r[0]).replace('RM', '')))) + 1
: 1;

const appendedRows = []; // 이번 실행이 실제로 추가한 행 기록 (사후 자가검증용)

parsed.materials.forEach(m => {
const key = normalize(m.korean);
if (m.isNew && !freshNames.has(key)) {
const newCode = 'RM' + String(nextCodeNum).padStart(3, '0');
rmSheet.appendRow([newCode, m.korean, m.keyword, '활성', new Date()]);
const newRow = rmSheet.getLastRow();
rmSheet.getRange(newRow, 5).setNumberFormat('yyyy-mm-dd'); // 등록일은 기존 onEdit 자동화가 채움
const dRange = rmSheet.getRange(2, 4, newRow - 1, 1); const dRule =
rmSheet.getRange('D2').getDataValidation(); if (dRule) dRange.setDataValidation(dRule);
nextCodeNum++;
freshNames.add(key);
appendedRows.push({ row: newRow, key: key });
} else if (m.isNew && freshNames.has(key)) {
console.log('suggestRawMaterials: skipped duplicate append for ' + m.korean + ' (already exists)');
}
koreanNames.push(m.korean);
});
SpreadsheetApp.flush(); // 락 해제 전 쓰기 내용을 확실히 커밋해, 다음 실행이 최신 상태를 읭도록 보장 (코드 번호 경합 방지)

// 2026-08-24: 락 안에서 fresh read를 하고도(동시 실행 경합 또는 Sheets 쓰기 전파 지연으로)
// 같은 원자재명이 중복 추가되는 사례가 있어, append 직후 같은 락 안에서 한 번 더 검증한다.
// 항상 "더 먼저 생긴 행(낮은 행 번호)"을 남기고, 이번 실행이 만든 행만 지운다 — row 번호
// 내림차순으로 처리해서, 삭제가 아직 처리하지 않은 다른 항목의 row 번호를 밀어내리지 않게 한다.
if (appendedRows.length > 0) {
const verifyRows = rmSheet.getDataRange().getValues().slice(1)
.map((r, i) => ({ row: i + 2, key: normalize(r[1]) })).filter(r => r.key);
appendedRows.sort((a, b) => b.row - a.row).forEach(added => {
const matches = verifyRows.filter(r => r.key === added.key).map(r => r.row);
if (matches.length > 1 && matches.includes(added.row)) {
const keepRow = Math.min.apply(null, matches);
if (added.row !== keepRow) {
rmSheet.deleteRow(added.row);
console.error('suggestRawMaterials: 사후 검증에서 중복 발견 — 방금 추가한 행(' + added.row
+ ')을 자동 삭제함 (유지: ' + keepRow + ', 원자재: ' + added.key + ')');
}
}
});
SpreadsheetApp.flush();
}
} finally {
lock.releaseLock();
}

return { korean: koreanNames };
}

function installOnEditTrigger() {
// 최초 1회만 실행 — 설치형 트리거 등록
ScriptApp.newTrigger('onEditInstallable')
.forSpreadsheet(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))
.onEdit()
.create();
}

function testSuggestDebug() {
const result = suggestRawMaterials('산업용 실리콘 패킹');
Logger.log('RESULT: ' + JSON.stringify(result));
}

function testSuggestDebug2() {
const props = PropertiesService.getScriptProperties();
const apiKey = props.getProperty('GEMINI_API_KEY');
Logger.log('apiKey exists: ' + (!!apiKey) + ', length: ' + (apiKey ? apiKey.length : 0));

const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;
const payload = {
contents: [{ parts: [{ text: '테스트: 1+1은?' }] }],
generationConfig: { responseMimeType: 'application/json' }
};
const res = UrlFetchApp.fetch(url, {
method: 'post',
contentType: 'application/json',
payload: JSON.stringify(payload),
muteHttpExceptions: true
});
Logger.log('HTTP status: ' + res.getResponseCode());
Logger.log('RAW BODY: ' + res.getContentText().substring(0, 1500));
}

/**
* '설정' 시트(키/값 구조)에서 가격키워드, 뉴스수집건수를 읽어옴.
* 값이 없으면 기본값(5개 키워드, display=5)으로 폴백.
*/
function getSettings_() {
const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('설정');
const data = sheet.getDataRange().getValues();
const map = {};
data.slice(1).forEach(row => { if (row[0]) map[row[0]] = row[1]; });
const priceTerms = String(map['가격키워드'] || '가격,단가,인상,인하,반등')
.split(',').map(s => s.trim()).filter(Boolean);
const display = Number(map['뉴스수집건수']) || 5;
const triggerHour = Number(map['트리거시각']) || 1;
const postRetentionDays = Number(map['시황게시물보관기간']) || 60;
const logRetentionDays = Number(map['수집로그보관기간']) || 30;
const maxArticleAgeDays = Number(map['기사최대경과일']) || 7;
// 2026-08-18: 같은 원자재에 대해 AI가 관련 있다고 판단한 뉴스가 하루에 여러 건이어도,
// collectMarketNews() 1회 실행당 원자재(code)별로 "AI가 판단한 시황 중요도(relevanceScore)" 상위
// 이 건수만 시황게시물로 게시한다(점수가 없으면 발행일 최신순으로 폴백). 값이 없거나 0/음수/숫자가
// 아니면 기본값 1(원자재당 대표 1건)로 동작한다.
const maxPostsPerMaterial = Math.max(1, Number(map['원자재별시황게시물출력건수']) || 1);
// 2026-09-01: [2]번 유사 게시물 비게시 기능의 비교 기간. 기사최대경과일(사전 필터, 원문 기사 단위)과는
// 별개의 설정이다 - 이 값은 AI가 최종 선정한 대표 후보를 "실제 게시된" 시황게시물과 다시 한번
// 비교하는 후처리 단계에서만 쓰인다. 설정 시트에 값이 없거나 0/음수/숫자가 아니면 기본값 3(일)로 동작.
const similarPostCompareDays = Number(map['유사게시물비교기간']) || 3;
return { priceTerms, display, triggerHour, postRetentionDays, logRetentionDays, maxArticleAgeDays, maxPostsPerMaterial, similarPostCompareDays };
}
// 네이버 뉴스검색 API가 &quot; 등 HTML 엔티티로 이스케이프한 title/description을 원래 문자로 되돌리는 유틸
function decodeHtmlEntities_(str) { return String(str).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
/**
* 3단계: 뉴스 수집 파이프라인
* 원자재마스터(활성 상태)를 순회하며 각 원자재의 수집키워드에
* 가격/인상/인하/단가 등 시황 단어를 조합해 네이버 뉴스 검색 -> AI 판단 -> 시황게시물에 게시.
* 이미 수집로그에 있는 링크는 중복 게시하지 않음.
* 뉴스 수집(네이버 API) 단계는 fetchAll로 전체 원자재를 한 번에 병렬 요청하되,
* 네이버 공식 제한(초당 10건)을 지키기 위해 10건씩 배치로 나눠 호출하고 배치 사이 1.1초 대기함.
*/
/**
* AI 호출 실패 재시도 대기열 시트를 가져오거나 없으면 생성.
* 컬럼: link, code, korean, title, description, pubDate, firstFailedAt
*/
function getAIRetryQueueSheet_(ss) {
let sheet = ss.getSheetByName('AI실패대기');
if (!sheet) {
sheet = ss.insertSheet('AI실패대기');
sheet.appendRow(['link', 'code', 'korean', 'title', 'description', 'pubDate', 'firstFailedAt']);
}
return sheet;
}

/**
* 재시도 대기열에서 link로 해당 행을 제거 (해결됨: 성공/실패확정 등)
*/
function removeFromAIRetryQueue_(sheet, link) {
const data = sheet.getDataRange().getValues();
for (let i = data.length - 1; i >= 1; i--) {
if (data[i][0] === link) {
sheet.deleteRow(i + 1);
}
}
}

/**
* 재시도 대기열에 신규 실패 항목 추가 (이미 있으면 건드리지 않음 - 최초 실패시각 보존)
*/
function addToAIRetryQueue_(sheet, entry) {
const data = sheet.getDataRange().getValues();
const exists = data.slice(1).some(function(r){ return r[0] === entry.link; });
if (!exists) {
sheet.appendRow([entry.link, entry.code, entry.korean, entry.title, entry.description, entry.pubDate, new Date()]);
}
}

function collectMarketNews() {
const scriptStartTime_ = new Date().getTime();
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const rmSheet = ss.getSheetByName('원자재마스터');
const postSheet = ss.getSheetByName('시황게시물');
const logSheet = ss.getSheetByName('수집로그');

// AI 호출 실패 재시도 대기열 로드
const retryQueueSheet = getAIRetryQueueSheet_(ss);
const retryQueueData = retryQueueSheet.getDataRange().getValues();
const retryPendingMap = {}; // link -> {code, korean, title, description, pubDate, firstFailedAt}
const RETRY_DELAY_MS = 3 * 60 * 60 * 1000; // 3시간
retryQueueData.slice(1).forEach(function(r){
retryPendingMap[r[0]] = { link: r[0], code: r[1], korean: r[2], title: r[3], description: r[4], pubDate: r[5], firstFailedAt: new Date(r[6]) };
});

const rmData = rmSheet.getDataRange().getValues();
// 품목마스터에서 실제 참조되는 원자재명 모으기 (활성 품목의 F열만)
const itemDataForRef = ss.getSheetByName('품목마스터').getDataRange().getValues();
const referencedNames = new Set();
itemDataForRef.slice(1).forEach(r => {
if (r[0] && r[6] === '활성') { // A열(자재코드) 있고, G열(상태)=활성
String(r[5] || '').split(',').forEach(n => {
const name = n.trim();
if (name) referencedNames.add(name);
});
}
});

const materials = rmData.slice(1).filter(r => r[0] && r[3] === '활성' && referencedNames.has(String(r[1]).trim()));

const logData = logSheet.getDataRange().getValues();
const existingLinks = new Set(logData.slice(1).map(r => r[1]));

const settings = getSettings_();
const priceTerms = settings.priceTerms;
const clientId = props.getProperty('NAVER_CLIENT_ID');
const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');

// 1단계: 전체 원자재 x 키워드 조합 요청을 만들고, 배치로 병렬 수집(네이버 초당 10건 제한 준수)
const requests = [];
const reqMeta = [];
materials.forEach((m, mi) => {
const keyword = m[2] || m[1];
priceTerms.forEach(term => {
const query = encodeURIComponent(keyword + ' ' + term);
const url = 'https://openapi.naver.com/v1/search/news.json?query=' + query + '&display=' + settings.display + '&sort=date';
requests.push({
url: url,
headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
muteHttpExceptions: true
});
reqMeta.push(mi);
});
});

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1100;
const itemsByMaterial = materials.map(() => []);
// 2026-08-31: 8/25 수집이 네이버 API 호출 중 대역폭 할당량 초과 예외로 collectMarketNews
// 전체가 중단되어 그날 게시물이 0건이 된 사고 재발 방지. fetchAll 한 번이 실패해도 이
// 배치만 건너뛰고 나머지 배치는 계속 수집하며, 실패가 있었으면 아래 안전마진 재시도
// 로직(원래 AI 처리 시간초과용)을 함께 타도록 해 1시간 뒤 collectMarketNews가 재실행된다.
let collectionBatchFailed = false;

for (let i = 0; i < requests.length; i += BATCH_SIZE) {
const batchRequests = requests.slice(i, i + BATCH_SIZE);
const batchMeta = reqMeta.slice(i, i + BATCH_SIZE);
let responses;
try {
responses = UrlFetchApp.fetchAll(batchRequests);
} catch (e) {
console.error('collectMarketNews 뉴스 수집 fetchAll 예외(이 배치 건너뜀): ' + e);
collectionBatchFailed = true;
if (i + BATCH_SIZE < requests.length) {
Utilities.sleep(BATCH_DELAY_MS);
}
continue;
}
responses.forEach((res, j) => {
if (res.getResponseCode() !== 200) return;
try {
const json = JSON.parse(res.getContentText());
if (json.items) itemsByMaterial[batchMeta[j]] = itemsByMaterial[batchMeta[j]].concat(json.items);
} catch (e) {}
});
if (i + BATCH_SIZE < requests.length) {
Utilities.sleep(BATCH_DELAY_MS);
}
}

Logger.log('뉴스 수집 완료: 원자재 ' + materials.length + '개, 요청 ' + requests.length + '건' + (collectionBatchFailed ? ' (일부 배치 실패로 건너뜀 있었음)' : ''));
// 2026-09-02: 재발 방지용 진행 단계 체크포인트. 6분 타임아웃으로 강제 종료되면 이후 코드는 전혀
// 실행되지 않으므로(catch 불가능), 다음 실행 시작 시 "지난번에 어디까지 갔었는지"를 바로 확인할 수
// 있도록 각 단계 완료 시점마다 스크립트 속성에 기록해둔다. (사후 진단용 - 로직에는 영향 없음)
props.setProperty('CMN_LAST_STAGE', '수집완료@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round((new Date().getTime() - scriptStartTime_) / 1000) + '초');

// 2단계: 원자재별 중복 제거 후 AI 판단 대상 후보 생성 (원자재 간 교차 중복도 방지)
const runningLinks = new Set(existingLinks);
const candidates = [];
materials.forEach((m, mi) => {
const code = m[0];
const korean = m[1];
const items = itemsByMaterial[mi];

const seen = {};
items.forEach(it => { seen[it.link] = it; });
const uniqueItems = Object.values(seen);

uniqueItems.forEach(it => {
if (runningLinks.has(it.link)) return;
if (retryPendingMap[it.link] && (Date.now() - retryPendingMap[it.link].firstFailedAt.getTime()) < RETRY_DELAY_MS) return; // 재시도 대기 중(3시간 미경과)이면 스킵
runningLinks.add(it.link);
const title = decodeHtmlEntities_(it.title.replace(/<[^>]+>/g, ''));
const description = decodeHtmlEntities_(it.description.replace(/<[^>]+>/g, ''));
if (!/[0-9%]/.test(title + ' ' + description)) return; // 숫자/퍼센트 없는 기사는 AI 호출 없이 사전 배제
const pubDateObj = new Date(it.pubDate);
if (!isNaN(pubDateObj.getTime()) && (Date.now() - pubDateObj.getTime()) > settings.maxArticleAgeDays * 24 * 60 * 60 * 1000) return; // 설정된 경과일보다 오래된 기사는 AI 호출 없이 사전 배제
candidates.push({
code: code,
korean: korean,
title: title,
description: description,
link: it.link,
pubDate: it.pubDate,
isRetry: false
});
});
});

// 3시간 이상 경과한 재시도 대기 항목을 후보에 직접 추가 (네이버 재검색 없이 저장된 원문 그대로 재판단)
Object.keys(retryPendingMap).forEach(function(link){
if (runningLinks.has(link)) return; // 이번 실행에서 신규로도 이미 잡힌 경우 중복 방지
const p = retryPendingMap[link];
if ((Date.now() - p.firstFailedAt.getTime()) >= RETRY_DELAY_MS) {
runningLinks.add(link);
candidates.push({
code: p.code,
korean: p.korean,
title: p.title,
description: p.description,
link: p.link,
pubDate: p.pubDate,
isRetry: true
});
}
});

// 유사 제목의 중복 기사 제거 (같은 이슈를 여러 언론사가 반복 보도하는 경우 대표 1건만 남김) - AI 호출 전에 걸러 토큰 절약
// v19: 이번 실행의 신규 후보들끼리뿐 아니라, 최근 게시된 기존 시황게시물 제목과도 비교해 재보도 중복을 막는다.
const postDataForDedup = postSheet.getDataRange().getValues();
const recentPostedTitles = postDataForDedup.slice(1)
.filter(r => r[0] && r[7] && (scriptStartTime_ - new Date(r[7]).getTime()) <= settings.maxArticleAgeDays * 24 * 60 * 60 * 1000)
.map(r => ({ code: r[1], title: r[3], summary: r[4] }));
const dedupedCandidates = [...recentPostedTitles];
const newCandidates = [];
// v24: 제목 겹침만으로는 못 잡는 "제목은 다르지만 같은 사건" 케이스 대비 - 확실한 중복(0.5 이상)까지는
// 아니지만 애매하게 겹치는 경우, 후보를 지우지 않고 대신 AI 요약 프롬프트에 "혹시 이 기사와 같은
// 사건이면 알려줘" 참고 정보로 넘겨서 AI가 의미 기반으로 최종 판단하게 한다(관련성 판단과 같은
// 호출에 묻어가므로 API 호출 횟수는 늘지 않음). 애매함의 기준은 일부러 넉넉하게 잡았다 - 여기서
// 걸러도 최종 판단은 AI가 하므로, 놓치는 것보다 한 번 더 확인시키는 쪽이 안전하다.
candidates.forEach(c => {
let isDup = false;
let possibleDupRef = null;
for (const d of dedupedCandidates) {
if (d.code !== c.code) continue;
const tOverlap = titleOverlap_(d.title, c.title);
if (tOverlap >= 0.5) { isDup = true; break; }
const dOverlap = titleOverlap_(d.description, c.description);
if (!possibleDupRef && (tOverlap >= 0.2 || dOverlap >= 0.3)) {
possibleDupRef = { title: d.title, summary: d.summary || d.description || '' };
}
}
if (!isDup) {
if (possibleDupRef) c.possibleDuplicateOf = possibleDupRef;
dedupedCandidates.push(c);
newCandidates.push(c);
}
});
candidates.splice(0, candidates.length, ...newCandidates);

// 3단계: AI 판단 요청을 전부 생성한 뒤 배치로 병렬 호출 (뉴스 수집과 동일한 fetchAll 배치 패턴)
const prompts = candidates.map(c => buildSummarizePrompt_(c.korean, c.title, c.description, c.possibleDuplicateOf));
// 2026-09-02: 기존에는 aiDeadline이 "스크립트 시작 시각 + 고정 4.5분"이라, 네이버 수집(1단계)이
// 예상보다 오래 걸린 날(예: 9/2, 191초)에도 AI 구간에 쓸 수 있는 시간이 그대로였다. 그 결과
// 수집+AI를 마친 뒤 남는 시간(원래 의도한 안전마진 1.5분)이 실제로는 부족해, 뒤쪽 수집로그
// 기록/게시 단계까지 가지 못하고 6분 하드리밋에 걸려 강제 종료된 사고가 있었다(2026-09-02).
// 이제는 "실행 한도(6분) - 후처리 예약시간"을 절대 기준선으로 두고, 그 안에서만 AI 호출을
// 진행하도록 한다 - 수집이 오래 걸린 만큼 AI 구간이 자동으로 줄어들어, 어떤 경우에도 후처리에
// 쓸 최소 시간이 보장된다.
const HARD_TIME_LIMIT_MS = 6 * 60 * 1000; // Apps Script 실행 시간 한도
const POST_AI_RESERVE_MS = 60 * 1000; // 수집로그 배치 기록 + 게시 + 정리에 최소 확보할 시간
const aiDeadline = scriptStartTime_ + HARD_TIME_LIMIT_MS - POST_AI_RESERVE_MS;
const aiResult = callAIBatch_(prompts, aiDeadline);
const aiTexts = aiResult.texts;
const processedCount = aiResult.processedCount;
props.setProperty('CMN_LAST_STAGE', 'AI판단완료@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round((new Date().getTime() - scriptStartTime_) / 1000) + '초/처리' + processedCount + '건');

let posted = 0;
const postedSummariesThisRun_ = []; // {code, summary} - AI 요약본 중복 체크용 (같은 배치 내)
// 2026-08-18: 같은 원자재(code)에 관련 뉴스가 여러 건이어도 대표 N건만 게시하기 위해,
// AI가 relevant:true로 판단한 후보를 여기서는 즉시 게시하지 않고 원자재코드별로 모아둔다.
// relevantByCode[code] = [{c, result}, ...] (이 실행에서 candidates 처리 순서대로 쌓임)
const relevantByCode = {};
// 2026-09-02: 수집로그 기록을 건별 appendRow에서 배치(setValues) 기록으로 전환. 기존에는 이 루프
// 안에서 후보마다 appendRow를 1회씩 호출해, 2026-09-02 사고 당시 120건 처리 중 73초 동안 겨우
// 일부(RM017까지)만 기록하고 6분 하드리밋에 걸려 죽었다(즉 이 루프 안에서 남은 시간이 소진됨).
// 이제는 판단/분류(순수 메모리 연산)만 루프에서 수행하고, 실제 시트 기록은 루프가 끝난 뒤
// 배열을 한 번에 setValues로 기록한다 - 후보 수가 몇 백 건으로 늘어도 API 호출은 1회뿐이다.
const logRowsToAppend_ = [];
candidates.slice(0, processedCount).forEach((c, idx) => {
const result = parseSummarizeResult_(aiTexts[idx], c.title);

if (result.aiFailed) {
if (c.isRetry) {
// 재시도(3시간 후)까지 실패 -> 포기하고 수집로그에 영구 기록, 대기열에서 제거
Logger.log('재시도 후에도 AI 실패, 포기: ' + c.title);
logRowsToAppend_.push([c.code, c.link, new Date()]);
removeFromAIRetryQueue_(retryQueueSheet, c.link);
} else {
// 최초 실패 -> 재시도 대기열에 등록 (수집로그에는 기록하지 않아 3시간 후 재시도됨)
addToAIRetryQueue_(retryQueueSheet, c);
}
return;
}

// AI 호출 성공 (관련 있음/없음 판단 완료)
if (c.isRetry) {
removeFromAIRetryQueue_(retryQueueSheet, c.link); // 재시도가 성공적으로 처리됨
}

if (result.relevant) {
const isDupSummary = postedSummariesThisRun_.some(p => p.code === c.code && titleOverlap_(p.summary, result.summary) >= 0.6);
if (!isDupSummary) {
postedSummariesThisRun_.push({ code: c.code, summary: result.summary });
(relevantByCode[c.code] = relevantByCode[c.code] || []).push({ c: c, result: result });
}
}
// 수집로그는 게시 여부(N건 제한 통과 여부)와 무관하게 항상 기록한다 - 기존 중복 방지 로직 그대로 유지.
// (실제 시트 기록은 루프 종료 후 배치로 처리 - 바로 위 주석 참고)
logRowsToAppend_.push([c.code, c.link, new Date()]);
});
// 배치 기록 실행 (건별 appendRow 대신 setValues 1회 호출)
if (logRowsToAppend_.length > 0) {
const logLastRow_ = logSheet.getLastRow();
logSheet.getRange(logLastRow_ + 1, 1, logRowsToAppend_.length, 3).setValues(logRowsToAppend_);
}
props.setProperty('CMN_LAST_STAGE', '수집로그기록완료@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round((new Date().getTime() - scriptStartTime_) / 1000) + '초/기록' + logRowsToAppend_.length + '건');

// 원자재(code)별로 "AI가 판단한 시황 중요도(relevanceScore)" 높은 순으로 정렬 후, 설정 시트의
// '원자재별시황게시물출력건수'(기본 1)만큼만 게시. relevanceScore가 없는 경우(AI가 점수를 주지
// 않았거나 파싱 실패)에만 발행일(pubDate) 최신순으로 폴백한다.
// - 둘 다 점수 있음: 점수 높은 순, 동점이면 pubDate 최신순
// - 한쪽만 점수 있음: 점수 있는 쪽 우선 (pubDate와 무관)
// - 둘 다 점수 없음: pubDate 최신순 (기존 로직과 동일)
const maxPostsPerMaterial = settings.maxPostsPerMaterial;
function compareByRelevanceThenDate_(a, b) {
const aScore = a.result.relevanceScore;
const bScore = b.result.relevanceScore;
if (aScore !== null && bScore !== null) {
if (aScore !== bScore) return bScore - aScore;
return new Date(b.c.pubDate).getTime() - new Date(a.c.pubDate).getTime();
}
if (aScore !== null) return -1;
if (bScore !== null) return 1;
return new Date(b.c.pubDate).getTime() - new Date(a.c.pubDate).getTime();
}
// [2]번 유사 게시물 비게시 (2026-09-01): 위에서 이미 읽어둔 postDataForDedup(시황게시물)을
// 다시 읽지 않고, 비교 기간(설정 시트 '유사게시물비교기간', 기본 3일)만 다르게 적용해 필터링한다.
const similarPostCutoff = scriptStartTime_ - settings.similarPostCompareDays * 24 * 60 * 60 * 1000;
const recentPostsForSimilarityCheck = postDataForDedup.slice(1)
.filter(r => r[0] && r[7] && new Date(r[7]).getTime() >= similarPostCutoff)
.map(r => ({ code: r[1], title: r[3], summary: r[4] }));

Object.keys(relevantByCode).forEach(code => {
const group = relevantByCode[code];
group.sort(compareByRelevanceThenDate_);
group.slice(0, maxPostsPerMaterial).forEach(({ c, result }) => {
const similarPost = isSimilarToRecentPost_(recentPostsForSimilarityCheck, c.code, c.title, result.summary);
if (similarPost) {
Logger.log('[유사게시물스킵] ' + c.code + ' "' + c.title + '" - 최근 ' + settings.similarPostCompareDays + '일 내 게시물과 유사해 게시하지 않음 (유사 게시물: "' + similarPost.title + '")');
// TODO([1]번 구현 시): 탈락뉴스 시트에 사유='유사게시물스킵'으로 기록
return;
}
postSheet.appendRow([Utilities.getUuid(), c.code, c.korean, c.title, result.summary, c.link, c.pubDate, new Date()]);
posted++;
});
});
props.setProperty('CMN_LAST_STAGE', '게시완료@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round((new Date().getTime() - scriptStartTime_) / 1000) + '초/게시' + posted + '건');

const skipped = candidates.length - processedCount;
if (skipped > 0) {
Logger.log('시간 제한으로 이번 실행에서 처리하지 못한 후보: ' + skipped + '건 (로그에 남기지 않아 다음 수집 때 재시도됨)');
}
Logger.log('신규 게시된 기사 수: ' + posted);

// 안전마진 도달 시 1시간 뒤 자동 재실행 예약 (상대시간 기반, v14)
const ss_props = PropertiesService.getScriptProperties();
const prevTriggerId = ss_props.getProperty('CATCHUP_TRIGGER_ID');
if (prevTriggerId) {
ScriptApp.getProjectTriggers().forEach(t => {
if (t.getUniqueId() === prevTriggerId) ScriptApp.deleteTrigger(t);
});
ss_props.deleteProperty('CATCHUP_TRIGGER_ID');
}
if (skipped > 0 || collectionBatchFailed) {
const newTrigger = ScriptApp.newTrigger('collectMarketNews')
.timeBased()
.after(60 * 60 * 1000)
.create();
ss_props.setProperty('CATCHUP_TRIGGER_ID', newTrigger.getUniqueId());
Logger.log('안전마진 도달 또는 수집 배치 실패로 1시간 후 재실행 예약됨 (남은 후보 ' + skipped + '건, 수집 배치 실패: ' + collectionBatchFailed + ')');
}
// 2026-09-02: 게시(위)까지는 이미 끝난 뒤이므로, 정리(purge)는 남은 시간이 빠듯하면 이번 실행은
// 건너뛰고 다음 실행에 맡긴다. 정리를 하루 미뤄도 데이터 유실은 없지만(보관기한 기준 배치
// 삭제라 다음 실행에서 마저 처리됨), 게시 직후 시간이 얼마 없는데 정리까지 욕심내다 6분
// 하드리밋에 걸리는 것보다 안전하다.
const elapsedBeforePurge_ = new Date().getTime() - scriptStartTime_;
const PURGE_MIN_REMAINING_MS = 15 * 1000; // 정리 실행에 최소 필요하다고 보는 여유시간
if (HARD_TIME_LIMIT_MS - elapsedBeforePurge_ < PURGE_MIN_REMAINING_MS) {
Logger.log('실행 시간이 얼마 남지 않아 이번 실행에서는 정리(purgeOldRecords_)를 건너뜀 (경과 ' + Math.round(elapsedBeforePurge_ / 1000) + '초)');
props.setProperty('CMN_LAST_STAGE', '정리건너뜀@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round(elapsedBeforePurge_ / 1000) + '초');
return;
}
// ⭐ 오래된 시황게시물/수집로그 자동 정리 (설정 시트 값 기준, 기본 60일/30일)
purgeOldRecords_();
props.setProperty('CMN_LAST_STAGE', '정리완료@' + new Date(scriptStartTime_).toISOString() + '/경과' + Math.round((new Date().getTime() - scriptStartTime_) / 1000) + '초');
}
/**
* 시황게시물/수집로그의 오래된 행을 '설정' 시트 값 기준으로 자동 삭제.
* getSettings_()에서 postRetentionDays(기본 60일), logRetentionDays(기본 30일)를 읽어와 사용.
* 배치 read/write 방식 (건별 삭제 API 호출 없음) — 데이터가 많아져도 빠름.
*/
function purgeOldRecords_() {
const ss = SpreadsheetApp.openById(SHEET_ID);
const settings = getSettings_();

const now = new Date();
const postCutoff = new Date(now.getTime() - settings.postRetentionDays * 24 * 60 * 60 * 1000);
const logCutoff = new Date(now.getTime() - settings.logRetentionDays * 24 * 60 * 60 * 1000);

const postResult = purgeSheetOlderThan_(ss, '시황게시물', 8, postCutoff); // H열=게시일
const logResult = purgeSheetOlderThan_(ss, '수집로그', 3, logCutoff); // C열=수집일시

// 5-7: 게시물이 삭제되면 연결된 댓글이 고아 데이터로 남으므로 함께 정리
let orphanCommentsDeleted = 0;
if (postResult.deletedIds.length > 0) {
orphanCommentsDeleted = purgeCommentsByPostIds_(ss, postResult.deletedIds);
}

// 5-7: 삭제 이력을 시트에 남긴다(Logger.log는 시간 지나면 사라져 감사 불가능하므로)
logPurgeHistory_(ss, postResult.count, logResult.count, orphanCommentsDeleted, postResult.deletedIds);

Logger.log('purgeOldRecords_: 시황게시물 ' + postResult.count + '건 삭제(기준 ' + settings.postRetentionDays + '일), 수집로그 ' + logResult.count + '건 삭제(기준 ' + settings.logRetentionDays + '일), 고아댓글 ' + orphanCommentsDeleted + '건 정리');
}

/**
* 지정 시트에서 dateColIndex(1-based) 열 값이 cutoff보다 오래된 행을 배치로 제거.
* 날짜가 아니거나 비어있는 행은 안전하게 보존(삭제하지 않음).
* 5-7: 삭제된 행 수뿐 아니라, 각 행의 첫 컬럼(ID)도 함께 반환해 고아 데이터 정리/감사에 활용.
*/
function purgeSheetOlderThan_(ss, sheetName, dateColIndex, cutoff) {
const sheet = ss.getSheetByName(sheetName);
const lastRow = sheet.getLastRow();
const lastCol = sheet.getLastColumn();
if (lastRow < 2) return { count: 0, deletedIds: [] }; // 헤더만 있거나 빈 시트

const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
const header = data[0];
const kept = [header];
const deletedIds = [];

for (let i = 1; i < data.length; i++) {
const dateVal = data[i][dateColIndex - 1];
const isOld = (dateVal instanceof Date) && (dateVal.getTime() < cutoff.getTime());
if (isOld) {
deletedIds.push(data[i][0]);
} else {
kept.push(data[i]);
}
}

if (deletedIds.length > 0) {
sheet.getRange(1, 1, kept.length, header.length).setValues(kept);
sheet.getRange(kept.length + 1, 1, lastRow - kept.length, lastCol).clearContent();
}

return { count: deletedIds.length, deletedIds: deletedIds };
}

/**
* 5-7: 삭제된 게시물 ID들과 연결된 댓글을 댓글 시트에서 함께 제거(고아 데이터 방지).
* 댓글 시트 컬럼: commentId, postId, itemId, authorEmail, authorName, authorRole, parentCommentId, content, createdAt
*/
function purgeCommentsByPostIds_(ss, postIds) {
const sheet = ss.getSheetByName(SHEET_COMMENT);
const lastRow = sheet.getLastRow();
const lastCol = sheet.getLastColumn();
if (lastRow < 2) return 0;

const idSet = {};
postIds.forEach(function (id) { idSet[String(id)] = true; });

const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
const header = data[0];
const kept = [header];
let deletedCount = 0;

for (let i = 1; i < data.length; i++) {
const postId = String(data[i][1]);
if (idSet[postId]) {
deletedCount++;
} else {
kept.push(data[i]);
}
}

if (deletedCount > 0) {
sheet.getRange(1, 1, kept.length, header.length).setValues(kept);
sheet.getRange(kept.length + 1, 1, lastRow - kept.length, lastCol).clearContent();
invalidateSheetCache_(SHEET_COMMENT);
}
return deletedCount;
}

/**
* 5-7: 자동삭제 실행 이력을 '삭제이력' 시트에 기록(없으면 생성). 재홍님이 나중에
* "언제 무슨 게시물이 삭제됐는지" 감사할 수 있도록 영구 보존(Logger.log와 달리 안 사라짐).
*/

function logPurgeHistory_(ss, postCount, logCount, orphanCount, deletedPostIds) {
let sheet = ss.getSheetByName('삭제이력');
if (!sheet) {
sheet = ss.insertSheet('삭제이력');
sheet.appendRow(['삭제일시', '시황게시물삭제건수', '수집로그삭제건수', '고아댓글삭제건수', '삭제된게시물ID목록']);
}
sheet.appendRow([new Date(), postCount, logCount, orphanCount, deletedPostIds.join(', ')]);
}

/**
* AI 공급자 라우터. Script Properties의 AI_PROVIDER 값(DEEPSEEK/GEMINI)에 따라 분기.
* 반환값: 성공 시 AI 응답 텍스트(string), 실패 시 null.
*/
function callAI_(prompt) {
const provider = (PropertiesService.getScriptProperties().getProperty('AI_PROVIDER') || 'GEMINI').toUpperCase();
try {
if (provider === 'DEEPSEEK') return callDeepSeek_(prompt);
if (provider === 'GEMINI') return callGemini_(prompt);
console.error('callAI_: 알 수 없는 AI_PROVIDER(' + provider + ') - Gemini로 폴백');
return callGemini_(prompt);
} catch (err) {
console.error('callAI_ 예외: ' + err);
return null;
}
}

/**
* AI 프롬프트 1건에 대한 요청 객체 생성 (공급자별 분기). callAIBatch_에서 사용.
*/
function buildAIRequest_(prompt, provider, props) {
if (provider === 'DEEPSEEK') {
const apiKey = props.getProperty('DEEPSEEK_API_KEY');
return {
url: 'https://api.deepseek.com/chat/completions',
method: 'post',
contentType: 'application/json',
headers: { 'Authorization': 'Bearer ' + apiKey },
payload: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: prompt }], reasoning_effort: 'low' }),
muteHttpExceptions: true
};
}
const apiKey = props.getProperty('GEMINI_API_KEY');
return {
url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey,
method: 'post',
contentType: 'application/json',
payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
muteHttpExceptions: true
};
}

/**
* callAIBatch_ 전용 응답 파싱 (공급자별 분기). 실패 시 null 반환.
*/
function parseAIResponse_(res, provider) {
const json = JSON.parse(res.getContentText());
if (provider === 'DEEPSEEK') {
return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || null;
}
return (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text) || null;
}

/**
* AI 프롬프트 배열을 fetchAll로 배치 병렬 호출 (뉴스 수집 단계와 동일한 패턴).
* 반환: 각 프롬프트에 대응하는 AI 응답 텍스트 배열(실패 시 해당 인덱스는 null).
*/
function callAIBatch_(prompts, deadlineMs) {
const props = PropertiesService.getScriptProperties();
const provider = (props.getProperty('AI_PROVIDER') || 'GEMINI').toUpperCase();
const AI_BATCH_SIZE = 40;
const AI_BATCH_DELAY_MS = 500;

const requests = prompts.map(p => buildAIRequest_(p, provider, props));
const results = new Array(prompts.length).fill(null);
let processedCount = 0;

for (let i = 0; i < requests.length; i += AI_BATCH_SIZE) {
if (deadlineMs && new Date().getTime() > deadlineMs) {
Logger.log('callAIBatch_: 시간 제한 도달, ' + i + '/' + requests.length + '건만 처리하고 중단');
break;
}
const batchRequests = requests.slice(i, i + AI_BATCH_SIZE);
let responses;
try {
responses = UrlFetchApp.fetchAll(batchRequests);
} catch (e) {
console.error('callAIBatch_ fetchAll 예외: ' + e);
processedCount = i + batchRequests.length;
if (i + AI_BATCH_SIZE < requests.length) Utilities.sleep(AI_BATCH_DELAY_MS);
continue;
}
responses.forEach((res, j) => {
try {
const code = res.getResponseCode();
if (code < 200 || code >= 300) {
console.error('callAIBatch_ HTTP ' + code + ': ' + res.getContentText());
return;
}
results[i + j] = parseAIResponse_(res, provider);
} catch (e) {
console.error('callAIBatch_ 파싱 예외: ' + e);
}
});
processedCount = i + batchRequests.length;
if (i + AI_BATCH_SIZE < requests.length) {
Utilities.sleep(AI_BATCH_DELAY_MS);
}
}
return { texts: results, processedCount: processedCount };
}

/**
* Gemini 2.5 Flash-Lite 호출. 응답 실패 시 null 반환.
*/
function callGemini_(prompt) {
const props = PropertiesService.getScriptProperties();
const apiKey = props.getProperty('GEMINI_API_KEY');
const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;
const payload = { contents: [{ parts: [{ text: prompt }] }] };
const res = UrlFetchApp.fetch(url, {
method: 'post',
contentType: 'application/json',
payload: JSON.stringify(payload),
muteHttpExceptions: true
});
const code = res.getResponseCode();
if (code < 200 || code >= 300) {
console.error('callGemini_ HTTP ' + code + ': ' + res.getContentText());
return null;
}
const json = JSON.parse(res.getContentText());
const text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0].text;
return text || null;
}

/**
* DeepSeek-V4-Flash 호출 (OpenAI 호환 Chat Completions). 응답 실패 시 null 반환.
*/
function callDeepSeek_(prompt) {
const props = PropertiesService.getScriptProperties();
const apiKey = props.getProperty('DEEPSEEK_API_KEY');
const url = 'https://api.deepseek.com/chat/completions';
const payload = {
model: 'deepseek-v4-flash',
messages: [{ role: 'user', content: prompt }],
reasoning_effort: 'low' // 정확도는 유지하면서 응답 속도를 크게 높임 (실측: 약 4~5배)
};
const res = UrlFetchApp.fetch(url, {
method: 'post',
contentType: 'application/json',
headers: { 'Authorization': 'Bearer ' + apiKey },
payload: JSON.stringify(payload),
muteHttpExceptions: true
});
const code = res.getResponseCode();
if (code < 200 || code >= 300) {
console.error('callDeepSeek_ HTTP ' + code + ': ' + res.getContentText());
return null;
}
const json = JSON.parse(res.getContentText());
const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
return text || null;
}

/**
* 뉴스 관련성 판단 프롬프트 생성. [원자재] 가격/시황 관련 여부를 판단하고,
* 관련 있으면 해당 원자재 중심으로 요약. 주가/증시 등 원자재와 무관한 내용은 제외.
*/
/**
* 두 기사 제목의 단어 겹침 비율(overlap coefficient)을 계산.
* 같은 이슈를 다른 언론사가 재보도할 때 제목 문구는 다르지만 핵심 단어(품목명, 수치 등)는 대부분 겹치는 점을 이용.
*/
function titleOverlap_(a, b) {
const norm = s => String(s || '')
.replace(/[^\wㄱ-힣%.]+/g, ' ')
.split(/\s+/)
.map(t => t.replace(/^\.+|\.+$/g, ''))
.filter(t => t.length > 1);
const setA = new Set(norm(a));
const setB = new Set(norm(b));
if (setA.size === 0 || setB.size === 0) return 0;
let common = 0;
setA.forEach(t => { if (setB.has(t)) common++; });
return common / Math.min(setA.size, setB.size);
}

/**
* [2]번 유사 게시물 비게시 (2026-09-01).
* AI가 최종 선정한 대표 후보(제목+AI요약)가, 최근 `유사게시물비교기간`일 이내 실제 게시된
* 시황게시물과 겹치면 그 게시물을 반환(겹치지 않으면 null).
* - 사전 필터(titleOverlap_ 직접 호출부, candidates 단계)는 "원문 기사 제목/설명" 대 "게시물 제목/요약"을
*   비교한다 - 언론사마다 문구가 달라 겹침이 낮게 나와 놓치는 경우가 있다.
* - 이 함수는 AI가 이미 한 번 정제한 "대표 후보의 제목+AI요약" 대 "게시물의 제목+요약"을 비교해,
*   문구가 정규화된 뒤에도 여전히 겹치는지 다시 한번 확인하는 후처리 단계다.
* - recentPosts는 호출부에서 이미 읽어둔 시황게시물 데이터를 기간으로만 다시 필터링해 넘긴다
*   (시트를 다시 읽지 않음 - 성능 영향 없음).
* - 임계값은 기존 사전 필터와 동일하게 0.5(제목 또는 요약 중 하나라도 넘으면 중복)를 재사용한다.
*/
function isSimilarToRecentPost_(recentPosts, code, title, summary) {
for (const p of recentPosts) {
if (p.code !== code) continue;
if (titleOverlap_(title, p.title) >= 0.5) return p;
if (titleOverlap_(summary, p.summary) >= 0.5) return p;
}
return null;
}

/**
* isSimilarToRecentPost_()의 동작을 가상 데이터로 확인하는 테스트 함수 (2026-09-01).
* 시트를 읽거나 쓰지 않음 - Apps Script 편집기에서 이 함수만 선택해 실행하고 로그를 보면 된다.
* 실제 3일 이내 중복 사례가 나오길 기다리지 않고도 로직을 바로 검증할 수 있다.
*/
function testSimilarPostSkipLogic() {
const recentPosts = [
{ code: 'PVC', title: '유럽산 PVC 페이스트 수지에 반덤핑관세...5년간 최대 31.55%', summary: '유럽산 PVC 페이스트 수지에 5년간 최대 31.55% 반덤핑 관세가 부과됐다.' },
{ code: 'PVC', title: '국제 유가 상승세, 정제마진도 개선', summary: '국제 유가가 최근 상승세를 보이며 정제마진도 함께 개선되고 있다.' }
];
const cases = [
{ label: '같은 사건, 표현만 다름 (스킵 기대)', code: 'PVC', title: '정부, 유럽산 PVC 페이스트 수지에 덤핑방지관세 부과', summary: '정부가 유럽산 PVC 페이스트 수지에 최대 31.55%의 반덤핑 관세를 부과하기로 했다.' },
{ label: '제목은 겹치지만 원자재코드가 다름 (게시 기대)', code: 'HDPE', title: '유럽산 PVC 페이스트 수지에 반덤핑관세', summary: '요약 문구는 임의로 다르게 작성.' },
{ label: '같은 코드지만 전혀 다른 사안 (게시 기대)', code: 'PVC', title: '나프타값 보전, 공급가 인하 동참', summary: '나프타 가격 보전으로 공급가 인하에 동참하는 업체가 늘고 있다.' }
];
cases.forEach(tc => {
const dup = isSimilarToRecentPost_(recentPosts, tc.code, tc.title, tc.summary);
Logger.log('[' + tc.label + '] ' + (dup ? '스킵됨 (유사 게시물: "' + dup.title + '")' : '게시 진행'));
});
}

function buildSummarizePrompt_(materialName, title, description, possibleDuplicateOf) {
let prompt = "너는 MRO(산업 소모성 자재) 원자재 시황 뉴스 분석 전문가야.\n" +
"아래 기사가 산업 원자재 [" + materialName + "]의 실제 가격/시황과 관련이 있는지 먼저 판단해.\n" +
"[" + materialName + "]이라는 단어가 기사에 등장하더라도, 다른 뜻(일상 표현, 비유, 동음이의어, 무관한 산업)으로 쓰였거나 원자재 가격/시황과 무관하면 관련 없음으로 판단해.\n" +
"기사가 특정 기업의 주가·증시·주식시장 동향(상한가, 급등락, 시가총액, 투자의견 등)을 다루는 내용이면, [" + materialName + "] 언급 여부와 무관하게 관련 없음으로 판단해.\n" +
"기사 안에 [" + materialName + "]의 가격, 수급, 물량, 생산량, 수출입 등 시황과 관련된 구체적인 숫자나 퍼센트(%)가 없으면 관련 없음으로 판단해.\n" +
"기사 제목이나 전체 논조가 특정 방향(상승/하락)을 암시하더라도, 개별 원자재의 수치는 정반대 방향일 수 있어. 예를 들어 \"수입물가 전체 하락\" 기사 안에서도 특정 품목만 상승했다고 나올 수 있으니, 반드시 [" + materialName + "] 바로 옆에 명시된 숫자와 방향(상승/하락/%)만 근거로 판단하고, 기사 제목이나 전체 톤에 맞춰 방향을 추측하지 마.\n" +
"관련 있으면 반드시 [" + materialName + "]의 가격/수급/물량/생산량 등 시황 동향을 나타내는 구체적인 숫자나 퍼센트(%)를 포함해 2문장 이내 한국어로 중심 요약하고(주가·기업 실적 등 원자재와 무관한 내용은 요약에서 제외), 관련 없으면 요약은 빈 문자열로 둬.\n" +
"관련 있으면 이 기사가 [" + materialName + "]의 시황(가격/수급) 변화를 얼마나 구체적이고 직접적으로 반영하는지 1(약함)~5(매우 강함) 정수로 평가해 relevanceScore에 담고, 관련 없으면 relevanceScore는 0으로 둬.\n" +
// 2026-08-18: 원문 기사(특히 중국發 시황을 다루는 기사)에 중국어 인용구/통계가 섞여 있으면 AI가
// 요약을 중국어로 답하는 사고가 실제로 발생했다. summary는 반드시 한국어로만 작성하도록 별도
// 문장으로 강하게 명시해, 다른 판단 규칙들 사이에 묻혀 지시 강도가 약해지지 않게 한다.
"summary는 반드시 한국어(한글)로만 작성해. 기사 원문에 중국어/한자/일본어 등 외국어 인용구나 통계가 있어도 summary에는 그 외국어를 그대로 옮기지 말고 한국어로 바꿔서 써. summary에 한자, 중국어, 일본어, 그 밖의 외국어 문자를 절대 섞지 마.\n";
if (possibleDuplicateOf) {
// v24: 사전 필터(titleOverlap_)에서 애매하게 겹친 기존 게시물 참고 정보. 핵심 사실관계가
// 같으면 문구가 달라도 중복으로 판단하도록 AI에게 명시적으로 안내한다.
prompt += "\n[참고] 아래와 사실상 같은 사건(같은 발표/같은 통계/같은 보도자료)을 다른 표현으로 다시 보도한 기사일 수 있어. 핵심 사실관계(수치, 발표 주체, 사건)가 같다면 문구가 달라도 이미 게시된 것으로 보고 관련 없음(false)으로 판단해. 핵심 사실이 다르면(예: 다른 시점, 다른 수치, 다른 사건) 정상적으로 판단해.\n" +
"[이미 게시된 유사 기사 제목] " + possibleDuplicateOf.title + "\n" +
"[이미 게시된 유사 기사 요약] " + possibleDuplicateOf.summary + "\n";
}
prompt += "\n반드시 아래 JSON 형식으로만 응답해. 다른 텍스트나 코드블록 표시는 붙이지 마.\n" +
'{"relevant": true 또는 false, "summary": "요약 또는 빈 문자열", "relevanceScore": 관련 있으면 1~5 정수, 관련 없으면 0}\n\n' +
"[제목]\n" + title + "\n\n" +
"[본문 일부]\n" + description;
return prompt;
}

/**
* summary에 한국어(한글)/숫자/영문/공백/시황 요약에 흔히 쓰이는 기호 외의 문자(한자·중국어·
* 일본어 등 비허용 언어)가 섞여 있는지 검사. 빈 문자열(관련 없음)은 항상 통과시킨다.
* 2026-08-18: '중국어 AI 요약' 버그(원문에 중국어 인용구가 있으면 AI가 요약 전체를 중국어로
* 답한 사고) 재발 방지용. 한자(중국어 간체/번체와 동일한 CJK 유니코드 영역)는 이 시스템의
* 정상적인 한국어 시황 요약에는 쓰이지 않으므로, 화이트리스트에 없는 문자가 하나라도 있으면
* 실패로 처리한다(= 사실상 한자/외국어 비율 0% 기준).
*/
function isSummaryLanguageSafe_(summary) {
if (!summary) return true; // 관련 없음(빈 문자열)은 항상 통과
const allowedPattern = /^[가-힣ㄱ-ㅎㅏ-ㅣ0-9a-zA-Z\s.,%()\-\/~!?:'"·+&℃°㈜]+$/;
return allowedPattern.test(summary);
}

/**
* AI 응답 텍스트를 파싱해 { relevant, summary } 형태로 반환. 파싱 실패/무응답 시 안전한 폴백.
*/
function parseSummarizeResult_(text, title) {
if (!text) {
console.error('parseSummarizeResult_: AI 응답 없음 - relevant:false 처리(재시도 대상). title=' + title);
return { relevant: false, summary: '', relevanceScore: null, aiFailed: true };
}
try {
const cleaned = text.replace(/```json|```/g, '').trim();
const parsed = JSON.parse(cleaned);
// 2026-08-18: relevanceScore는 원자재별 시황게시물 N건 출력 시 "AI가 판단한 시황 중요도" 기준으로
// 정렬하기 위한 값. 1~5 정수가 아니면(누락/범위 밖/파싱 이상) null로 처리해, collectMarketNews()의
// 정렬 비교 로직에서 발행일(pubDate) 최신순 폴백이 적용되도록 한다.
const rawScore = Number(parsed.relevanceScore);
const relevanceScore = (Number.isInteger(rawScore) && rawScore >= 1 && rawScore <= 5) ? rawScore : null;
const summary = parsed.summary ? parsed.summary.trim() : '';
// 2026-08-18: '중국어 AI 요약' 버그 방지 - summary에 한자/중국어/일본어 등 비허용 문자가
// 섞여 있으면 aiFailed:true로 처리해, 기존 AI 실패 재시도 큐(3시간 후 1회 재시도 -> 그래도
// 실패하면 포기하고 수집로그에만 기록) 흐름을 그대로 재사용한다. 뉴스 수집/게시/중복방지
// 로직은 건드리지 않는다.
if (parsed.relevant === true && !isSummaryLanguageSafe_(summary)) {
console.error('parseSummarizeResult_: summary에 비허용 언어(한자/외국어) 감지 - relevant:false 처리(재시도 대상). title=' + title + ', summary=' + summary);
return { relevant: false, summary: '', relevanceScore: null, aiFailed: true };
}
return {
relevant: parsed.relevant === true,
summary: summary,
relevanceScore: relevanceScore,
aiFailed: false
};
} catch (err) {
console.error('parseSummarizeResult_: 파싱 실패 - relevant:false 처리(재시도 대상). title=' + title);
return { relevant: false, summary: '', relevanceScore: null, aiFailed: true };
}
}

/**
* 2026-08-18: '중국어 AI 요약' 버그 수정 확인용 수동 테스트. 실제 API를 호출하지 않고, AI가 중국어로
* 답했다고 가정한 가짜 응답과 정상 한국어 응답을 실제 배포된 parseSummarizeResult_()에 그대로 넣어
* 결과를 로그로 확인한다. 실행 후 "실행 로그"에서 두 결과가 기대한 대로 나오는지 확인하면 됨.
* (기존 testSuggestDebug2()와 같은 목적의 수동 디버그 함수 - 트리거/자동실행에는 사용되지 않음)
*/
function testSummaryLanguageFilter() {
const chineseCase = JSON.stringify({ relevant: true, summary: '国际铜价创历史新高，市场需求持续增长。', relevanceScore: 5 });
const koreanCase = JSON.stringify({ relevant: true, summary: '국제 구리 가격이 사상 최고치를 기록하며 전월 대비 3.2% 상승했다.', relevanceScore: 5 });

const r1 = parseSummarizeResult_(chineseCase, '[테스트] 중국어로 답한 경우');
Logger.log('[테스트1: 중국어 요약] aiFailed=' + r1.aiFailed + ', relevant=' + r1.relevant + ', summary="' + r1.summary + '" (기대값: aiFailed=true, summary="" → 게시되지 않고 재시도 대상으로 걸러져야 함)');

const r2 = parseSummarizeResult_(koreanCase, '[테스트] 정상 한국어로 답한 경우');
Logger.log('[테스트2: 정상 한국어 요약] aiFailed=' + r2.aiFailed + ', relevant=' + r2.relevant + ', summary="' + r2.summary + '" (기대값: aiFailed=false, summary가 그대로 채워져야 함 → 정상 게시)');

if (r1.aiFailed === true && r1.summary === '' && r2.aiFailed === false && r2.summary.length > 0) {
Logger.log('결과: 통과 - 중국어 요약은 걸러지고, 정상 한국어 요약은 그대로 통과함.');
} else {
Logger.log('결과: 실패!! 기대값과 다름 - 코드를 다시 확인해야 함.');
}
}

function summarizeNews_(materialName, title, description) {
const prompt = buildSummarizePrompt_(materialName, title, description);
const text = callAI_(prompt);
return parseSummarizeResult_(text, title);
}

/**
* Gemini로 뉴스 제목+본문 요약 및 관련성 판단 (원자재 시황 관점, 2문장 이내)
* 반환: { relevant: boolean, summary: string }
*/
function summarizeNewsWithGemini_(materialName, title, description) {
const props = PropertiesService.getScriptProperties();
const apiKey = props.getProperty('GEMINI_API_KEY');
const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' + apiKey;

const prompt = "너는 MRO(산업 소모성 자재) 원자재 시황 뉴스 분석 전문가야.\n" +
"아래 기사가 산업 원자재 [" + materialName + "]의 실제 가격/시황과 관련이 있는지 먼저 판단해.\n" +
"[" + materialName + "]이라는 단어가 기사에 등장하더라도, 다른 뜻(일상 표현, 비유, 동음이의어, 무관한 산업)으로 쓰였거나 원자재 가격/시황과 무관하면 관련 없음으로 판단해.\n" +
"관련 있으면 2문장 이내 한국어로 요약하고, 관련 없으면 요약은 빈 문자열로 둬.\n" +
"반드시 아래 JSON 형식으로만 응답하고 다른 텍스트나 코드블록 표시는 붙이지 마.\n" +
'{"relevant": true 또는 false, "summary": "요약 또는 빈 문자열"}\n\n' +
"[제목]\n" + title + "\n\n" +
"[본문 일부]\n" + description;

const payload = { contents: [{ parts: [{ text: prompt }] }] };

const res = UrlFetchApp.fetch(url, {
method: 'post',
contentType: 'application/json',
payload: JSON.stringify(payload),
muteHttpExceptions: true
});

Logger.log('GEMINI RAW: ' + res.getContentText());
const json = JSON.parse(res.getContentText());
const text = json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts[0].text;

if (!text) return { relevant: true, summary: title };

try {
const cleaned = text.replace(/```json|```/g, '').trim();
const parsed = JSON.parse(cleaned);
return {
relevant: parsed.relevant !== false,
summary: parsed.summary ? parsed.summary.trim() : title
};
} catch (err) {
return { relevant: true, summary: text.trim() };
}
}

/**
* 최초 1회만 실행 - 매일 뉴스 수집 트리거 등록. 시각은 '설정' 시트의 트리거시각 값 사용.
* 재실행 시 기존 collectMarketNews 트리거를 먼저 삭제해 중복 등록을 방지함.
*/
function installDailyCollectionTrigger() {
ScriptApp.getProjectTriggers().forEach(t => {
if (t.getHandlerFunction() === 'collectMarketNews') ScriptApp.deleteTrigger(t);
});
const settings = getSettings_();
ScriptApp.newTrigger('collectMarketNews')
.timeBased()
.atHour(settings.triggerHour)
.everyDays(1)
.create();
}

/**
* 테스트용: 원자재마스터 1행(예: 고무)만 골라 수집 파이프라인을 시험 실행.
* 뉴스 수집(네이버 API)은 fetchAll로 배치 병렬 요청(네이버 초당 10건 제한 준수).
* 정식 배포 전 삭제 권장.
*/
function testCollectOneMaterial() {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const rmSheet = ss.getSheetByName('원자재마스터');
const postSheet = ss.getSheetByName('시황게시물');
const logSheet = ss.getSheetByName('수집로그');

const rmData = rmSheet.getDataRange().getValues();
const m = rmData[1]; // RM001 고무
const code = m[0];
const korean = m[1];
const keyword = m[2] || m[1];

const logData = logSheet.getDataRange().getValues();
const existingLinks = new Set(logData.slice(1).map(r => r[1]));

const settings = getSettings_();
const priceTerms = settings.priceTerms;
const clientId = props.getProperty('NAVER_CLIENT_ID');
const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');

const requests = priceTerms.map(term => {
const query = encodeURIComponent(keyword + ' ' + term);
const url = 'https://openapi.naver.com/v1/search/news.json?query=' + query + '&display=' + settings.display + '&sort=date';
return {
url: url,
headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
muteHttpExceptions: true
};
});

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1100;
let items = [];
for (let i = 0; i < requests.length; i += BATCH_SIZE) {
const batchRequests = requests.slice(i, i + BATCH_SIZE);
const batchTerms = priceTerms.slice(i, i + BATCH_SIZE);
const responses = UrlFetchApp.fetchAll(batchRequests);
responses.forEach((res, j) => {
Logger.log(batchTerms[j] + ' -> HTTP ' + res.getResponseCode());
if (res.getResponseCode() !== 200) return;
try {
const json = JSON.parse(res.getContentText());
if (json.items) items = items.concat(json.items);
} catch (e) {}
});
if (i + BATCH_SIZE < requests.length) {
Utilities.sleep(BATCH_DELAY_MS);
}
}

Logger.log('총 수집된 기사 수(중복 포함): ' + items.length);

const seen = {};
items.forEach(it => { seen[it.link] = it; });
const uniqueItems = Object.values(seen);
Logger.log('중복 제거 후: ' + uniqueItems.length);

let posted = 0;
uniqueItems.forEach(it => {
if (existingLinks.has(it.link)) return;
const title = it.title.replace(/<[^>]+>/g, '');
const description = it.description.replace(/<[^>]+>/g, '');
const result = summarizeNews_(korean, title, description);
if (result.relevant) {
postSheet.appendRow([Utilities.getUuid(), code, korean, title, result.summary, it.link, it.pubDate, new Date()]);
posted++;
}
logSheet.appendRow([code, it.link, new Date()]);
existingLinks.add(it.link);
});
Logger.log('신규 게시된 기사 수: ' + posted);
}

function testNaverBooleanSyntax() {
const props = PropertiesService.getScriptProperties();
const clientId = props.getProperty('NAVER_CLIENT_ID');
const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');
const queries = [
'구리 AND (가격 OR 단가)',
'구리 가격'
];
queries.forEach(q => {
const url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURIComponent(q) + '&display=5&sort=date';
const res = UrlFetchApp.fetch(url, {
headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
muteHttpExceptions: true
});
const json = JSON.parse(res.getContentText());
Logger.log('QUERY[' + q + '] total:' + json.total);
(json.items||[]).slice(0,3).forEach(it => Logger.log(' - ' + it.title.replace(/<[^>]+>/g,'')));
});
}

/**
* fetchAll 병렬 처리 실측 테스트 (배치 분할 버전). 원자재 최대 5개만 사용.
* 네이버 검색 API 공식 제한(초당 10건)을 지키기 위해 10건씩 배치로 나눠 fetchAll 호출하고,
* 배치 사이에 1.1초씩 대기함(네이버 권장: 0.1초 이상 간격).
*/
function testFetchAllPerformance_() {
const start = Date.now();
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const rmSheet = ss.getSheetByName('원자재마스터');
const rmData = rmSheet.getDataRange().getValues();
const materials = rmData.slice(1).filter(r => r[0] && r[3] === '활성').slice(0, 5);
const settings = getSettings_();
const clientId = props.getProperty('NAVER_CLIENT_ID');
const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');

const requests = [];
const meta = [];
materials.forEach(m => {
const keyword = m[2] || m[1];
settings.priceTerms.forEach(term => {
const query = encodeURIComponent(keyword + ' ' + term);
const url = 'https://openapi.naver.com/v1/search/news.json?query=' + query + '&display=' + settings.display + '&sort=date';
requests.push({
url: url,
headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
muteHttpExceptions: true
});
meta.push(m[1] + ' / ' + term);
});
});

Logger.log('요청 개수: ' + requests.length + ' (원자재 ' + materials.length + '개 x 키워드 ' + settings.priceTerms.length + '개)');

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1100;
let successCount = 0;
let totalItems = 0;
const fetchStart = Date.now();

for (let i = 0; i < requests.length; i += BATCH_SIZE) {
const batchRequests = requests.slice(i, i + BATCH_SIZE);
const batchMeta = meta.slice(i, i + BATCH_SIZE);
const responses = UrlFetchApp.fetchAll(batchRequests);
responses.forEach((res, j) => {
const code = res.getResponseCode();
if (code === 200) {
successCount++;
try {
const json = JSON.parse(res.getContentText());
totalItems += (json.items || []).length;
} catch (e) {}
} else {
Logger.log('실패: ' + batchMeta[j] + ' -> HTTP ' + code);
}
});
if (i + BATCH_SIZE < requests.length) {
Utilities.sleep(BATCH_DELAY_MS);
}
}

const fetchEnd = Date.now();
const totalElapsed = Date.now() - start;
Logger.log('=== fetchAll 배치 실측 결과 ===');
Logger.log('요청 수: ' + requests.length + ' / 배치 크기: ' + BATCH_SIZE + ' / 배치 간 대기: ' + BATCH_DELAY_MS + 'ms');
Logger.log('성공: ' + successCount + ' / 실패: ' + (requests.length - successCount));
Logger.log('수집된 뉴스 항목 합계: ' + totalItems);
Logger.log('배치 fetch 총 소요 시간(ms): ' + (fetchEnd - fetchStart));
Logger.log('전체 함수 소요 시간(ms): ' + totalElapsed);

}

// ===================== 일회성 설정: 품목마스터 D/E열을 순수 DB 파생값으로 전환 =====================
// 드롭다운(데이터 유효성 검사) 제거 + 수동 편집 방지(보호). 딱 한 번만 직접 실행하면 됨.
function protectItemManagerTeamColumns_() {
const ss = SpreadsheetApp.openById(SHEET_ID);
const itemSheet = ss.getSheetByName('품목마스터');
const maxRows = itemSheet.getMaxRows();

// 1) D:E열 데이터 유효성 검사(드롭다운) 전체 제거
const deRange = itemSheet.getRange(2, 4, maxRows - 1, 2);
deRange.clearDataValidations();

// 2) 기존에 D:E열에 걸린 보호가 있으면 정리 (중복 방지)
const existingProtections = itemSheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
existingProtections.forEach(function (p) {
const r = p.getRange();
if (r.getColumn() === 4 && r.getNumColumns() === 2) p.remove();
});

// 3) D:E열 보호 설정: 이 스크립트 소유자만 편집 가능, 다른 모든 사용자는 편집 불가
const protection = deRange.protect();
protection.setDescription('D:E열은 고객사마스터/사용자팀마스터에서 자동 동기화되는 값입니다. 직접 수정하지 마세요.');
const editors = protection.getEditors();
if (editors && editors.length) protection.removeEditors(editors);
if (protection.canDomainEdit()) protection.setDomainEdit(false);

Logger.log('D:E열 드롭다운 제거 및 편집 보호 설정 완료');
}

/**
* 품목마스터 D/E열(담당소장/팀·지역) 헤더에 '자동 동기화, 직접 수정 금지' 안내 메모(Note)를 추가.
* 편집 보호(protectItemManagerTeamColumns_)만으로는 시트 소유자 본인의 실수를 막지 못하므로,
* 헤더에 메모를 달아 시각적으로 안내함. 한 번만 실행하면 됨(idempotent, 덮어쓰기 방식).
*/
function addSyncNotesToItemMaster_() {
const ss = SpreadsheetApp.openById(SHEET_ID);
const sheet = ss.getSheetByName('품목마스터');
sheet.getRange('D1').setNote('이 열은 고객사마스터의 소장 값을 기준으로 자동 동기화됩니다. 직접 수정하지 마세요.');
sheet.getRange('E1').setNote('이 열은 사용자팀마스터의 소속팀 값을 기준으로 자동 동기화됩니다. 직접 수정하지 마세요.');
Logger.log('D1/E1에 자동 동기화 안내 메모 설정 완료');
}

function testMaterialsFilterDebug() {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const rmSheet = ss.getSheetByName('원자재마스터');
const rmData = rmSheet.getDataRange().getValues();

const itemDataForRef = ss.getSheetByName('품목마스터').getDataRange().getValues();
const referencedNames = new Set();
itemDataForRef.slice(1).forEach(r => {
if (r[0] && r[6] === '활성') {
String(r[5] || '').split(',').forEach(n => {
const name = n.trim();
if (name) referencedNames.add(name);
});
}
});

const allActive = rmData.slice(1).filter(r => r[0] && r[3] === '활성');
const materials = allActive.filter(r => referencedNames.has(String(r[1]).trim()));
const excluded = allActive.filter(r => !referencedNames.has(String(r[1]).trim())).map(r => r[1]);

Logger.log('참조된 원자재명 집합: ' + JSON.stringify(Array.from(referencedNames)));
Logger.log('최종 수집대상(' + materials.length + '개): ' + materials.map(r => r[1]).join(', '));
Logger.log('제외된 원자재(' + excluded.length + '개): ' + excluded.join(', '));
}

function testFreshnessFilterDebug() {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const clientId = props.getProperty('NAVER_CLIENT_ID');
const clientSecret = props.getProperty('NAVER_CLIENT_SECRET');
const settings = getSettings_();

const testKeyword = '기유';
const testTerm = '가격';
const query = encodeURIComponent(testKeyword + ' ' + testTerm);
const url = 'https://openapi.naver.com/v1/search/news.json?query=' + query + '&display=' + settings.display + '&sort=date';

const res = UrlFetchApp.fetch(url, {
headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
muteHttpExceptions: true
});
const json = JSON.parse(res.getContentText());
const items = json.items || [];

Logger.log('설정된 최대경과일: ' + settings.maxArticleAgeDays + '일');
Logger.log('검색 결과 ' + items.length + '건:');
items.forEach(it => {
const pubDateObj = new Date(it.pubDate);
const ageMs = Date.now() - pubDateObj.getTime();
const ageDays = (ageMs / (24*60*60*1000)).toFixed(1);
const pass = ageMs <= settings.maxArticleAgeDays * 24 * 60 * 60 * 1000;
Logger.log('- [' + (pass ? '통과' : '제외') + '] ' + it.pubDate + ' (경과 ' + ageDays + '일) : ' + it.title.replace(/<[^>]+>/g, ''));
});
}

function testTitleOverlapDebug() {
const t1 = '유럽산 PVC 페이스트 수지에 5년간 최대 31.55% 덤핑 방지 관세';
const t2 = '유럽산 PVC 페이스트 수지에 반덤핑관세...5년간 최대 31.55%';
const t3 = '정부, 유럽산 PVC 페이스트 수지에 덤핑방지관세 부과';
const t4 = '정부가 나프타값 보전하자 공급가 인하…롯데케미칼도 동참';

Logger.log('t1 vs t2: ' + titleOverlap_(t1, t2).toFixed(2));
Logger.log('t1 vs t3: ' + titleOverlap_(t1, t3).toFixed(2));
Logger.log('t2 vs t3: ' + titleOverlap_(t2, t3).toFixed(2));
Logger.log('t1 vs t4 (다른 사안): ' + titleOverlap_(t1, t4).toFixed(2));
}

/**
* 시황게시물 조회 (uuid 기준).
*/
function findPost_(postId) {
const data = getSheetValues_(SHEET_POST);

for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim() === String(postId).trim()) {
return {
id: data[i][0],
materialCode: data[i][1],
materialName: data[i][2],
title: data[i][3],
summary: data[i][4],
link: data[i][5],
pubDate: data[i][6],
createdAt: data[i][7]
};
}
}
return null;
}

/**
* 특정 게시물에 달린 댓글 전체를 반환 (권한 필터링 전 원본).
*/
function getCommentsForPost_(postId) {
const data = getSheetValues_(SHEET_COMMENT);
const result = [];

for (let i = 1; i < data.length; i++) {
const row = data[i];
if (String(row[1]).trim() === String(postId).trim()) {
result.push({
commentId: row[0],
postId: row[1],
itemId: row[2],
authorEmail: row[3],
authorName: row[4],
authorRole: row[5],
parentCommentId: row[6],
content: row[7],
createdAt: row[8]
});
}
}
return result;
}

function appendComment_(row) {
const sheet = getSheetObj_(SHEET_COMMENT);
sheet.appendRow(row);
invalidateSheetCache_(SHEET_COMMENT);
}

/**
* 이메일로 사용자의 현재 소속팀을 조회 (캨시 우선).
* 댓글 열람 권한 판단은 항상 현재 팀 기준으로 한다 (역할 스냅샷과는 별개).
*/
function getUserTeam_(email) {
const cached = getCachedUser_(email);
if (cached) return cached.team;
const u = findUser_(email);
return u ? u.team : null;
}

/**
* 해당 사용자가 이 게시물의 원자재를 쓰는 품목 중 담당소장인지 확인.
* (품목마스터 D열 담당소장 이름 기준 매칭 — 이메일 컴럼은 품목마스터에 없음).
*/
/**
* 품목마스터에서 자재코드(품목ID)로 품목 1건 조회.
*/
function getItemById_(itemId) {
const data = getSheetValues_(SHEET_ITEM);

for (let i = 1; i < data.length; i++) {
const row = data[i];
if (String(row[0]).trim() === String(itemId).trim()) {
return {
itemId: String(row[0]),
customer: row[1],
itemName: row[2],
manager: row[3],
team: row[4],
materials: row[5],
status: row[6]
};
}
}
return null;
}

/**
* 해당 사용자가 이 품목(itemId)의 담당소장인지, 그리고 이 품목이 실제로
* 게시물의 원자재(post.materialName)를 쓰는 품목이 맞는지 확인.
*/
function isManagerForItem_(user, itemId, post) {
const item = getItemById_(itemId);
if (!item) return false;
if (String(item.manager).trim() !== String(user.name).trim()) return false;
if (post && String(item.materials).indexOf(post.materialName) === -1) return false;
return true;
}

/**
* action: 'getComments' — 특정 게시물의 댓글 스레드 조회.
* 본 댓글의 작성자 팀과 조회자의 권한을 canViewComment_로 건별 필터링 (클라이언트 필터 금지 원칙).
*/
function handleGetComments_(user, body) {
const postId = body.postId;
if (!postId) {
return jsonResponse_({ ok: false, error: 'MISSING_POST_ID' });
}

const all = getCommentsForPost_(postId);
const visible = all.filter(function (c) {
const authorTeam = getUserTeam_(c.authorEmail);
return canViewComment_(user, authorTeam);
});

visible.sort(function (a, b) {
return new Date(a.createdAt) - new Date(b.createdAt);
});

return jsonResponse_({ ok: true, comments: visible });
}

/**
* action: 'postComment' — 댓글 작성.
* 게시물당 최초 댓글은 담당소장만, 그 이후는 담당자(보어)를 제외한 누구나 자유롭게.
*/
/**
* action: 'postComment' — 댓글 작성.
* itemId가 있고 해당 게시물+품목 조합에 첫 댓글이면 담당소장 검증(최초 확인 게이트).
* 이미 그 품목(또는 게시물 전체)에 댓글이 있으면 소장/팀장/임원 자유 답글.
* itemId가 없는 일반 댓글은, 이 게시물에 확인된 품목이 하나도 없으면 허용하지 않는다.
*/
function handlePostComment_(user, body) {
if (user.role === '일반') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN_VIEWER' });
}

const postId = body.postId;
const content = body.content;
const itemId = body.itemId || '';
const parentCommentId = body.parentCommentId || '';

if (!postId || !content) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

const post = findPost_(postId);
if (!post) {
return jsonResponse_({ ok: false, error: 'POST_NOT_FOUND' });
}

const existingForPost = getCommentsForPost_(postId);

if (itemId) {
const existingForItem = existingForPost.filter(function (c) {
return String(c.itemId) === String(itemId);
});

if (existingForItem.length === 0) {
if (user.role !== '담당') {
return jsonResponse_({ ok: false, error: 'FIRST_COMMENT_MANAGER_ONLY' });
}
if (!isManagerForItem_(user, itemId, post)) {
return jsonResponse_({ ok: false, error: 'NOT_ASSIGNED_MANAGER' });
}
if (parentCommentId) {
return jsonResponse_({ ok: false, error: 'FIRST_COMMENT_CANNOT_HAVE_PARENT' });
}
} else if (parentCommentId) {
const parentExists = existingForPost.some(function (c) {
return String(c.commentId) === String(parentCommentId);
});
if (!parentExists) {
return jsonResponse_({ ok: false, error: 'PARENT_COMMENT_NOT_FOUND' });
}
}
} else {
if (existingForPost.length === 0) {
return jsonResponse_({ ok: false, error: 'NO_CONFIRMED_ITEM_YET' });
}
if (parentCommentId) {
const parentExists = existingForPost.some(function (c) {
return String(c.commentId) === String(parentCommentId);
});
if (!parentExists) {
return jsonResponse_({ ok: false, error: 'PARENT_COMMENT_NOT_FOUND' });
}
}
}

const commentId = Utilities.getUuid();
const now = new Date();
appendComment_([commentId, postId, itemId, user.email, user.name, user.role, parentCommentId, content, now]);

// 5-1 성능: 프론트가 postComment 이후 getComments/loadFeed를 별도로 다시 호출하지
// 않도록(원래 3연속 호출), 갱신된 댓글 목록과 이 게시물의 최신 feed 엔트리를 함께 반환한다.
const allComments = getAllComments_();
const updatedForPost = allComments.filter(function (c) {
return String(c.postId) === String(postId);
});
const visibleComments = updatedForPost.filter(function (c) {
const authorTeam = getUserTeam_(c.authorEmail);
return canViewComment_(user, authorTeam);
});
visibleComments.sort(function (a, b) {
return new Date(a.createdAt) - new Date(b.createdAt);
});

const allItems = getAllItems_();
const commentsByPost = {};
commentsByPost[String(postId)] = updatedForPost;
const teamByEmailLocal = {};
updatedForPost.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmailLocal)) teamByEmailLocal[email] = getUserTeam_(email);
});
const updatedEntry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmailLocal);
const updatedPost = updatedEntry ? {
id: updatedEntry.post.id,
materialCode: updatedEntry.post.materialCode,
materialName: updatedEntry.post.materialName,
title: updatedEntry.post.title,
summary: updatedEntry.post.summary,
link: updatedEntry.post.link,
pubDate: updatedEntry.post.pubDate,
createdAt: updatedEntry.post.createdAt,
confirmedCount: updatedEntry.confirmedCount,
totalCount: updatedEntry.totalCount,
needsAttention: updatedEntry.needsAttention,
items: updatedEntry.items
} : null;

return jsonResponse_({ ok: true, commentId: commentId, comments: visibleComments, updatedPost: updatedPost });
}

/**
* postComment의 5-1 최적화(요청 3연속 호출 방지)와 동일한 로직을 updateComment/deleteComment에서도
* 재사용하기 위한 헬퍼. 특정 게시물의 갱신된(가시성 필터링+정렬된) 댓글 목록과
* 최신 feed 엔트리(updatedPost)를 반환한다.
*/
function buildCommentUpdateResponse_(user, postId) {
const post = findPost_(postId);
const allComments = getAllComments_();
const updatedForPost = allComments.filter(function (c) {
return String(c.postId) === String(postId);
});
const visibleComments = updatedForPost.filter(function (c) {
const authorTeam = getUserTeam_(c.authorEmail);
return canViewComment_(user, authorTeam);
});
visibleComments.sort(function (a, b) {
return new Date(a.createdAt) - new Date(b.createdAt);
});

const allItems = getAllItems_();
const commentsByPost = {};
commentsByPost[String(postId)] = updatedForPost;
const teamByEmailLocal = {};
updatedForPost.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmailLocal)) teamByEmailLocal[email] = getUserTeam_(email);
});
const updatedEntry = post ? buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmailLocal) : null;
const updatedPost = updatedEntry ? {
id: updatedEntry.post.id,
materialCode: updatedEntry.post.materialCode,
materialName: updatedEntry.post.materialName,
title: updatedEntry.post.title,
summary: updatedEntry.post.summary,
link: updatedEntry.post.link,
pubDate: updatedEntry.post.pubDate,
createdAt: updatedEntry.post.createdAt,
confirmedCount: updatedEntry.confirmedCount,
totalCount: updatedEntry.totalCount,
needsAttention: updatedEntry.needsAttention,
items: updatedEntry.items
} : null;

return { comments: visibleComments, updatedPost: updatedPost };
}
/**
* action: 'updateComment' — 댓글 수정 (5-8).
* 본인이 작성한 댓글만 수정 가능. 내용만 바꾸고 작성자/시각 등은 유지한다.
*/
function handleUpdateComment_(user, body) {
const commentId = body.commentId;
const content = String(body.content || '').trim();
if (!commentId || !content) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

const sheet = getSheetObj_(SHEET_COMMENT);
const data = sheet.getDataRange().getValues();
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]) === String(commentId)) {
if (String(data[i][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
return jsonResponse_({ ok: false, error: 'FORBIDDEN_NOT_AUTHOR' });
}
const postId = data[i][1];
sheet.getRange(i + 1, 8).setValue(content); // H열: content
invalidateSheetCache_(SHEET_COMMENT);
return jsonResponse_(Object.assign({ ok: true }, buildCommentUpdateResponse_(user, postId)));
}
}
return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });
}

/**
* action: 'deleteComment' — 댓글 삭제 (5-8).
* 본인이 작성한 댓글만 삭제 가능. 최초 댓글을 지우면 해당 품목은 다시 '미확인'
* 상태로 자연스럽게 돌아간다(confirmed = itemComments.length > 0 로직 재사용).
* 이 댓글에 달린 답글은 고아 상태가 되지만(parentCommentId가 존재하지 않는 댓글을
* 가리킴), 프론트 depthOf()가 이미 안전하게(무한루프 방지 + 존재 확인) 처리한다.
*/
function handleDeleteComment_(user, body) {
const commentId = body.commentId;
if (!commentId) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

const sheet = getSheetObj_(SHEET_COMMENT);
const lastRow = sheet.getLastRow();
const lastCol = sheet.getLastColumn();
if (lastRow < 2) return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });

const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
const header = data[0];
let targetIndex = -1;
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]) === String(commentId)) { targetIndex = i; break; }
}
if (targetIndex === -1) {
return jsonResponse_({ ok: false, error: 'COMMENT_NOT_FOUND' });
}
if (String(data[targetIndex][3]).trim().toLowerCase() !== String(user.email).trim().toLowerCase()) {
return jsonResponse_({ ok: false, error: 'FORBIDDEN_NOT_AUTHOR' });
}

const postId = data[targetIndex][1];
const kept = [header];
for (let i = 1; i < data.length; i++) {
if (i !== targetIndex) kept.push(data[i]);
}
sheet.getRange(1, 1, kept.length, header.length).setValues(kept);
sheet.getRange(kept.length + 1, 1, lastRow - kept.length, lastCol).clearContent();
invalidateSheetCache_(SHEET_COMMENT);

return jsonResponse_(Object.assign({ ok: true }, buildCommentUpdateResponse_(user, postId)));
}

function getAllPosts_() {
const data = getSheetValues_(SHEET_POST);
const result = [];

for (let i = 1; i < data.length; i++) {
const row = data[i];
result.push({
id: row[0],
materialCode: row[1],
materialName: row[2],
title: row[3],
summary: row[4],
link: row[5],
pubDate: row[6],
createdAt: row[7]
});
}
return result;
}

function getAllItems_() {
const data = getSheetValues_(SHEET_ITEM);
const result = [];

for (let i = 1; i < data.length; i++) {
const row = data[i];
result.push({
itemId: String(row[0]),
customer: row[1],
itemName: row[2],
manager: row[3],
team: row[4],
materials: row[5],
status: row[6],
registeredAt: row[7]
});
}
return result;
}

function getAllComments_() {
const data = getSheetValues_(SHEET_COMMENT);
const result = [];

for (let i = 1; i < data.length; i++) {
const row = data[i];
result.push({
commentId: row[0],
postId: row[1],
itemId: row[2],
authorEmail: row[3],
authorName: row[4],
authorRole: row[5],
parentCommentId: row[6],
content: row[7],
createdAt: row[8]
});
}
return result;
}

/**
* 게시물의 원자재명을 쓰는 품목 전체(팀 필터 전, 원본).
*/
function getRelatedItems_(post, allItems) {
// [2026-08-06 성능 최적화] materialMatch/statusActive는 게시물의 materialName에만 의존하고
// 개별 게시물(post)과는 무관하다(afterRegistration만 게시물별로 다름). handleGetFeed_/
// handleGetNotifications_가 게시물 전체를 순회하며 매번 이 함수를 부르기 때문에, 예전 방식은
// 요청 1번당 O(게시물수 × 품목수)로 allItems를 반복 스캔했다. 같은 원자재를 다루는 게시물이
// 여러 개인 경우가 많으므로(시황 뉴스 특성상) 원자재명별 매칭+활성 결과를 요청 1번 안에서
// 한 번만 계산해 _materialItemsCache_에 캐시하고, 게시물별로 다른 afterRegistration 체크만
// 그 후보군에 매번 적용한다. 매칭 로직(indexOf 등) 자체는 그대로라 결과는 이전과 동일하다.
const materialName = post.materialName;
let candidates = _materialItemsCache_[materialName];
if (!candidates) {
candidates = allItems.filter(function (it) {
const materialMatch = String(it.materials).indexOf(materialName) !== -1;
const statusActive = it.status === '활성';
return materialMatch && statusActive;
});
_materialItemsCache_[materialName] = candidates;
}
// 품목 등록일 이전에 작성된 게시물은 매핑 대상에서 제외 (신규 품목 소급 답글 요구 버그 수정)
return candidates.filter(function (it) {
return !it.registeredAt || new Date(post.createdAt) >= new Date(it.registeredAt);
});
}

function buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail) {
const related = getRelatedItems_(post, allItems);
const visibleItems = related.filter(function (it) {
return canViewComment_(user, it.team);
});
if (visibleItems.length === 0) return null;

const postComments = commentsByPost[String(post.id)] || [];
const commentsByItem = {};
postComments.forEach(function (c) {
const key = String(c.itemId);
if (!commentsByItem[key]) commentsByItem[key] = [];
commentsByItem[key].push(c);
});

const itemStatuses = visibleItems.map(function (it) {
const itemComments = commentsByItem[String(it.itemId)] || [];
let lastComment = null;
itemComments.forEach(function (c) {
if (!lastComment || new Date(c.createdAt) > new Date(lastComment.createdAt)) lastComment = c;
});
// A. 댓글 예열: 이 품목에 달린 댓글을, getComments와 동일한 팀 필터를 적용해 통째로 포함시킨다.
// (getFeed 한 번으로 스레드 클릭 시 재조회 없이 즉시 렌더링 가능하게 함. 기존 confirmed/commentCount 계산 로직은 건드리지 않음)
const visibleComments = itemComments.filter(function (c) {
const authorTeam = teamByEmail[String(c.authorEmail || '')];
return canViewComment_(user, authorTeam);
}).sort(function (a, b) {
return new Date(a.createdAt) - new Date(b.createdAt);
});
return {
itemId: it.itemId,
customer: it.customer,
itemName: it.itemName,
manager: it.manager,
team: it.team,
confirmed: itemComments.length > 0,
commentCount: itemComments.length,
lastCommentAuthorEmail: lastComment ? lastComment.authorEmail : null,
lastCommentAt: lastComment ? lastComment.createdAt : null,
comments: visibleComments
};
});

const confirmedCount = itemStatuses.filter(function (s) { return s.confirmed; }).length;

const lastCheckedMs = user.lastCheckedAt ? new Date(user.lastCheckedAt).getTime() : 0;
let needsAttention = false;
if (user.role === '담당') {
needsAttention = itemStatuses.some(function (s) {
const isMine = String(s.manager).trim() === String(user.name).trim();
if (!isMine) return false;
if (!s.confirmed) return true;
// 5-4: 이미 시작한 스레드라도, 남이 단 새 답글이 마지막 확인 이후에 있으면 알림 필요
return !!s.lastCommentAuthorEmail && s.lastCommentAuthorEmail !== user.email &&
new Date(s.lastCommentAt).getTime() > lastCheckedMs;
});
} else if (user.role === '팀장' || user.role === '임원') {
needsAttention = itemStatuses.some(function (s) {
// 버그 수정: 담당이 아직 최초 댓글도 안 단 상태면 기간(뉴스피드출력기간) 무관하게
// 팀장/임원도 계속 노출돼야 한다(그래야 확인 요청을 할 수 있음). 이 분기가 없어서
// 팀장/임원은 7일 초과 미확인 게시물이 안 보이던 버그였음.
if (!s.confirmed) return true;
// 5-4: commentCount<=1 휴리스틱 대신, 마지막 댓글 작성자가 본인이 아니고
// 마지막 확인 이후에 달렸으면 답글 필요로 판단(양방향 대응)
return !!s.lastCommentAuthorEmail && s.lastCommentAuthorEmail !== user.email &&
new Date(s.lastCommentAt).getTime() > lastCheckedMs;
});
}

return {
post: post,
items: itemStatuses,
confirmedCount: confirmedCount,
totalCount: itemStatuses.length,
needsAttention: needsAttention
};
}

/**
* action: 'getFeed' — 미확인(또는 대댓글 필요) 우선 + 최신순 정렬,
* 숫자 오프셋 기반 커서 페이지네이션(body.cursor, body.limit).
*/
/**
* B. 실시간 댓글 폴링용 경량 API.
* handleGetFeed_와 완전히 동일한 buildFeedEntry_ 계산을 재사용해서 배지(totalNeedsAttention) 로직이
* 두 갈래로 갈라지지 않게 한다. 응답은 품목별 {postId, itemId, commentCount, lastCommentAt} 배열 +
* totalNeedsAttention만 가벼운 필드로 반환 (기사 제목/요약 등 무거운 필드는 제외).
*/
function handlePollSignal_(user, body) {
const allPosts = getAllPosts_();
const allItems = getAllItems_();
const allComments = getAllComments_();
const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});
const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});

let totalNeedsAttentionCount = 0;
const signatures = [];
allPosts.forEach(function (post) {
const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
if (!entry) return;
if (entry.needsAttention) totalNeedsAttentionCount++;
entry.items.forEach(function (it) {
signatures.push({
postId: post.id,
itemId: it.itemId,
commentCount: it.commentCount,
lastCommentAt: it.lastCommentAt
});
});
});

return jsonResponse_({
ok: true,
totalNeedsAttention: totalNeedsAttentionCount,
signatures: signatures
});
}

function handleGetFeed_(user, body) {
const cursor = Number(body.cursor) || 0;
const limit = Number(body.limit) || 25;

// 뉴스피드출력기간(일): 설정 시트 값, 기본 14일. 시황게시물보관기간(삭제 기준)과는 별개 개념.
// 메인 피드 노출 기준은 needsAttention(역할별 답변대기 여부)과 무관하게 이 기간 하나만 사용한다.
// 단, 품목 중 하나라도 담당이 아직 첫 댓글을 안 단 게시물(hasUnconfirmed)은 기간이 지나도 계속 노출한다
// (담당이 반드시 확인하도록 유도하는 목적). 기간이 지나 노출 안 되는 게시물은 삭제되는 게 아니라
// 알림함(getNotifications)을 통해서만 접근 가능하다.
const feedDisplayDays = Number(getSetting_('뉴스피드출력기간')) || 14;
const feedCutoff = new Date(Date.now() - feedDisplayDays * 24 * 60 * 60 * 1000);

const allPosts = getAllPosts_();
const allItems = getAllItems_();
const allComments = getAllComments_();
// 5-1/5-2 성능: 댓글을 postId별로 미리 그룹핑(O(posts×comments) 방지)
const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});

// A. 댓글 예열 최적화: getUserTeam_ 은 CacheService.get()을 매번 호출하는 실제 네트워크 호출이라
// 댓글마다 반복 호출하면 안 됨. 전체 댓글의 "고유 작성자 이메일"만 추려서 딱 한 번씩만 조회 후
// 메모리 맵으로 buildFeedEntry_에 전달한다 (호출 횟수가 댓글 수가 아니라 사용자 수에 비례하게 됨 - 사용자 수가 늘어도 안전).
const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});

const entries = [];
let totalNeedsAttentionCount = 0;
allPosts.forEach(function (post) {
const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
if (!entry) return;
if (entry.needsAttention) totalNeedsAttentionCount++;
const hasUnconfirmed = entry.items.some(function (it) { return !it.confirmed; });
// 담당 미확인 품목이 있으면 기간 무관 노출, 아니면 뉴스피드출력기간 이내일 때만 노출
if (hasUnconfirmed || new Date(post.createdAt) >= feedCutoff) {
entries.push(entry);
}
});

entries.sort(function (a, b) {
return new Date(b.post.createdAt) - new Date(a.post.createdAt);
});

const page = entries.slice(cursor, cursor + limit);
const nextCursor = cursor + limit < entries.length ? cursor + limit : null;

return jsonResponse_({
ok: true,
posts: page.map(function (e) {
return {
id: e.post.id,
materialCode: e.post.materialCode,
materialName: e.post.materialName,
title: e.post.title,
summary: e.post.summary,
link: e.post.link,
pubDate: e.post.pubDate,
createdAt: e.post.createdAt,
confirmedCount: e.confirmedCount,
totalCount: e.totalCount,
needsAttention: e.needsAttention,
items: e.items
};
}),
nextCursor: nextCursor,
totalNeedsAttention: totalNeedsAttentionCount
});
}

/**
* 사용자팀마스터 F열(마지막확인일시)을 갱신.
*/
function updateUserLastChecked_(email, date) {
const sheet = getSheetObj_(SHEET_USER);
const data = getSheetValues_(SHEET_USER);

for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim().toLowerCase() === String(email).trim().toLowerCase()) {
sheet.getRange(i + 1, 6).setValue(date);
invalidateSheetCache_(SHEET_USER);
break;
}
}
}

/**
* action: 'markChecked' — 알림함을 열람했다는 시점을 기록.
* 팀장/임원의 '새 게시물 수' 판단 기준(마지막확인일시)을 갱신한다.
*/
function handleMarkChecked_(user, body) {
const now = new Date();
updateUserLastChecked_(user.email, now);
cacheUser_(user.email, Object.assign({}, user, { lastCheckedAt: now }));
return jsonResponse_({ ok: true });
}

function handleClientDebugLog_(user, body) {
try {
Logger.log('[CLIENT_DEBUG] ' + user.email + ' :: ' + JSON.stringify(body));
writeClientDebugLog_(user, body);
} catch (e) {}
return jsonResponse_({ ok: true });
}

function writeClientDebugLog_(user, body) {
try {
// [2026-08-13] apiDelay 로그는 서버가 느려질수록(재시도 라운드마다) 더 많이 발생하는데,
// 이 로그 자체를 같은 스프레드시트에 계속 appendRow/deleteRows 하는 것이 쓰기 부하를 더해
// 지연을 악화시키는 역설을 만든다. 사용자당 20초에 최대 1건으로 제한해 시트 쓰기 폭주를 막는다.
// (2026-08-12 sendBeacon 수정으로 apiDelay 로그가 처음으로 정상 적재되기 시작하면서 드러남)
if (body && body.kind === 'apiDelay') {
const rlCache = CacheService.getScriptCache();
const rlKey = 'dbglogrl_' + user.email;
if (rlCache.get(rlKey)) return;
rlCache.put(rlKey, '1', 20);
}
const ss = getSS_();
let sheet = ss.getSheetByName('디버그로그');
if (!sheet) {
sheet = ss.insertSheet('디버그로그');
sheet.appendRow(['시각', '이메일', '내용']);
}
sheet.appendRow([new Date(), user.email, JSON.stringify(body)]);
const lastRow = sheet.getLastRow();
if (lastRow > 3001) {
sheet.deleteRows(2, lastRow - 3001);
}
} catch (e) {}
}

/**
* [TEMP-DIAG 2026-08-05] 로그인 지연 원인(콜드스타트/네트워크/시트I/O) 진단 전용 로그.
* 알림배지 등 다른 클라이언트 디버그 로그와 트래픽이 섞이지 않도록 별도 시트에 기록한다.
* 원인 확인 후 이 함수와 호출부, 그리고 '로그인진단로그' 시트를 함께 제거할 것.
*
* [2026-08-06 변경] 로그인 응답 경로에서 시트에 직접 appendRow하면 그 자체가 로그인 응답을
* 0.5~2초 늦추고, 이 지연은 우리 자체 측정(ms.total)에도 안 잡히는 사각지대였다. 그래서
* 여기서는 CacheService에 큐로 쌓아두기만 하고(락 없이 - 드문 동시 로그인 충돌로 항목
* 하나 누락돼도 진단용이라 무해함), 실제 시트 기록은 flushLoginDiagQueue_()가 별도
* 시간 트리거(installLoginDiagFlushTrigger로 설치, 5분 주기)에서 배치로 처리한다.
*/
function writeLoginDiagLog_(email, diag) {
try {
const entry = { t: new Date().toISOString(), email: email, diag: diag };
const cache = CacheService.getScriptCache();
const raw = cache.get(LOGIN_DIAG_QUEUE_KEY);
const queue = raw ? JSON.parse(raw) : [];
queue.push(entry);
cache.put(LOGIN_DIAG_QUEUE_KEY, JSON.stringify(queue), 21600);
} catch (e) {}
}
/**
* writeLoginDiagLog_가 CacheService에 쌓아둔 로그인 진단 큐를 '로그인진단로그' 시트에
* 배치로 기록한다. installLoginDiagFlushTrigger()로 설치한 시간 트리거가 주기적으로 호출한다.
* (여기는 사용자 요청 경로가 아니라 트리거 실행이므로 락 대기 시간이 로그인 응답에 영향 없음.)
*/
function flushLoginDiagQueue_() {
const lock = LockService.getScriptLock();
if (!lock.tryLock(5000)) return;
let queue;
try {
const cache = CacheService.getScriptCache();
const raw = cache.get(LOGIN_DIAG_QUEUE_KEY);
if (!raw) return;
queue = JSON.parse(raw);
cache.remove(LOGIN_DIAG_QUEUE_KEY);
} finally {
lock.releaseLock();
}
if (!queue || !queue.length) return;
try {
const ss = SpreadsheetApp.openById(SHEET_ID);
let sheet = ss.getSheetByName('로그인진단로그');
if (!sheet) {
sheet = ss.insertSheet('로그인진단로그');
sheet.appendRow(['시각', '이메일', '내용']);
}
const rows = queue.map(function (e) {
return [new Date(e.t), e.email, JSON.stringify(e.diag)];
});
sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
const lastRow = sheet.getLastRow();
if (lastRow > 1001) {
sheet.deleteRows(2, lastRow - 1001);
}
} catch (e) {}
}
/**
* flushLoginDiagQueue_ 시간 트리거를 설치한다(5분 주기). 딱 한 번만 수동 실행하면 됨
* (이미 설치된 동일 트리거는 먼저 삭제하므로 여러 번 실행해도 중복 생성되지 않음).
*/
function installLoginDiagFlushTrigger() {
ScriptApp.getProjectTriggers().forEach(function (t) {
if (t.getHandlerFunction() === 'flushLoginDiagQueue_') ScriptApp.deleteTrigger(t);
});
ScriptApp.newTrigger('flushLoginDiagQueue_')
.timeBased()
.everyMinutes(5)
.create();
Logger.log('로그인진단로그 큐 flush 트리거(5분 주기) 설치 완료');
}

function doGet(e) {
try {
const params = (e && e.parameter) ? e.parameter : {};
if (params.action === 'readClientDebugLogs' && params.key === 'mro-debug-9f31ac72') {
const ss = getSS_();
const sheet = ss.getSheetByName('디버그로그');
if (!sheet) return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: [] })).setMimeType(ContentService.MimeType.JSON);
const data = sheet.getDataRange().getValues();
const rows = data.slice(1).map(function (r) { return { at: String(r[0]), email: r[1], body: r[2] }; });
return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: rows })).setMimeType(ContentService.MimeType.JSON);
}
return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
} catch (err) {
return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
}
}

/**
* action: 'getNotifications' — 역할별로 다른 배지/목록 구성.
* 소장: 아직 최초 확인 댓글을 안 단 게시물 목록.
* 팀장/임원: 새 게시물(마지막확인일시 이후 등록) + 대댓글 필요 스레드.
*/
function handleGetNotifications_(user, body) {
const allPosts = getAllPosts_();
const allItems = getAllItems_();
const allComments = getAllComments_();
const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});

const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});

const entries = [];
allPosts.forEach(function (post) {
const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
if (entry) entries.push(entry);
});

entries.sort(function (a, b) { return new Date(b.post.createdAt) - new Date(a.post.createdAt); });
if (user.role === '담당') {
const activeManagersByName = {};
getSheetValues_(SHEET_USER).slice(1).forEach(function (row) {
const name = String(row[1] || '').trim();
if (name && !(name in activeManagersByName)) activeManagersByName[name] = String(row[4] || '').trim() === '활성';
});
entries.forEach(function (e) {
e.items = e.items.filter(function (it) {
const managerName = String(it.manager || '').trim();
if (!activeManagersByName[managerName]) return true;
return managerName === String(user.name || '').trim();
});
e.confirmedCount = e.items.filter(function (s) { return s.confirmed; }).length;
e.totalCount = e.items.length;
});
}

function toNotification(e) {
return {
postId: e.post.id,
materialName: e.post.materialName,
title: e.post.title,
summary: e.post.summary,
createdAt: e.post.createdAt,
items: e.items,
confirmedCount: e.confirmedCount,
totalCount: e.totalCount,
needsAttention: e.needsAttention
};
}

return jsonResponse_({
ok: true,
count: entries.length,
items: entries.map(toNotification)
});
}

/**
* [테스트] getPostById 응답에 materialCode/link/pubDate/confirmedCount/totalCount가
* 정상적으로 포함되는지 실제 데이터로 확인 (알림함 -> 새 게시글 클릭 시 "기사 원문 보기"가
* 사라지던 버그의 수정 검증용). Apps Script 편집기에서 직접 실행.
*/
function testGetPostByIdFields() {
const allPosts = getAllPosts_();
if (!allPosts.length) { Logger.log('테스트 불가: 시황게시물이 비어 있습니다.'); return; }
const target = allPosts.find(function (p) { return p.link; }) || allPosts[0];

const userData = getSheetValues_(SHEET_USER);
let execUser = null;
for (let i = 1; i < userData.length; i++) {
if (userData[i][2] === '임원' && userData[i][4] === '활성') {
execUser = { email: userData[i][0], name: userData[i][1], role: userData[i][2], team: userData[i][3], status: userData[i][4] };
break;
}
}
if (!execUser) { Logger.log('테스트 불가: 활성 임원 사용자를 찾지 못했습니다.'); return; }

const res = handleGetPostById_(execUser, { postId: target.id });
const json = JSON.parse(res.getContent());
if (!json.ok || !json.post) {
Logger.log('결과: 실패!! getPostById 응답 자체가 ok:false 입니다. (' + JSON.stringify(json) + ')');
return;
}
const p = json.post;
Logger.log('[테스트 대상] postId=' + target.id + ', materialName=' + p.materialName);
Logger.log('materialCode=' + p.materialCode + ', link="' + p.link + '", pubDate=' + p.pubDate + ', confirmedCount=' + p.confirmedCount + ', totalCount=' + p.totalCount);

const hasAllFields = ('materialCode' in p) && ('link' in p) && ('pubDate' in p) && ('confirmedCount' in p) && ('totalCount' in p);
const linkNonEmptyIfSourcePostHasLink = !target.link || (p.link === target.link);
if (hasAllFields && linkNonEmptyIfSourcePostHasLink) {
Logger.log('결과: 통과 - materialCode/link/pubDate/confirmedCount/totalCount가 모두 정상 포함됨 (기사 원문 보기·확인건수 버그 수정 확인).');
} else {
Logger.log('결과: 실패!! 여전히 일부 항목이 빠져 있거나 값이 원본과 다릅니다.');
}
}

function handleGetPostById_(user, body) {
const postId = body.postId;
if (!postId) return jsonResponse_({ ok: false, error: 'MISSING_POST_ID' });
const allPosts = getAllPosts_();
const post = allPosts.find(function (p) { return p.id === postId; });
if (!post) return jsonResponse_({ ok: false, error: 'NOT_FOUND' });
const allItems = getAllItems_();
const allComments = getAllComments_();
const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});
const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});
const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
if (!entry) return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
// 2026-08-19: getFeed/buildCommentUpdateResponse_와 동일한 게시물 응답 형태로 맞춤.
// 이전에는 materialCode/link/pubDate/confirmedCount/totalCount가 빠져 있어,
// 알림함 등에서 아직 로드되지 않은 게시물을 getPostById로 불러올 때
// "기사 원문 보기" 버튼과 확인 건수(확인 0/N)가 잘못 표시되는 문제가 있었음.
return jsonResponse_({
ok: true,
post: {
id: entry.post.id,
materialCode: entry.post.materialCode,
materialName: entry.post.materialName,
title: entry.post.title,
summary: entry.post.summary,
link: entry.post.link,
pubDate: entry.post.pubDate,
createdAt: entry.post.createdAt,
confirmedCount: entry.confirmedCount,
totalCount: entry.totalCount,
needsAttention: entry.needsAttention,
items: entry.items
}
});
}

/**
* 사용자팀마스터에서 이름으로 사용자 조회(담당소장 검증용).
*/
function findUserByName_(name) {
const data = getSheetValues_(SHEET_USER);

for (let i = 1; i < data.length; i++) {
const row = data[i];
if (String(row[1]).trim() === String(name).trim()) {
return { email: row[0], name: row[1], role: row[2], team: row[3], status: row[4] };
}
}
return null;
}

/**
* action: 'upsertItem' — 품목 등록/수정. 팀장만 가능.
* itemId가 있으면 수정, 없으면 신규 등록(사용자가 입력한 MP자재코드를 그대로 A열에 저장).
* 담당소장은 요청한 팀장과 같은 팀 소속이어야 하며, 팀/지역은 그 담당소장의
* 소속팀으로 자동 입력한다(사람이 직접 입력하지 않음 — 스크립트 전용 컬럼).
*/
function handleUpsertItem_(user, body) {
if (user.role !== '팀장') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}

const itemId = body.itemId || '';
const customer = body.customer;
const itemName = body.itemName;
const manager = body.manager;
const materials = Array.isArray(body.materials) ? body.materials.join(', ') : (body.materials || '');
const status = body.status || '활성';
const materialCode = String(body.materialCode || '').trim();
// 신규 고객사코드. 고객사가 아직 고객사마스터에 없을 때만 값이 들어온다 - 신규 고객사 등록을
// 이 함수 안에서 품목 등록/수정과 함께 원자적으로 처리하기 위함(2026-08-19, 아래 참고).
const newCustomerCode = String(body.newCustomerCode || '').trim();

if (!customer || !itemName || !manager) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

const managerUser = findUserByName_(manager);
if (!managerUser) {
return jsonResponse_({ ok: false, error: 'MANAGER_NOT_FOUND' });
}
if (String(managerUser.team).trim() !== String(user.team).trim()) {
return jsonResponse_({ ok: false, error: 'MANAGER_NOT_IN_YOUR_TEAM' });
}

const team = managerUser.team;
const sheet = getSheetObj_(SHEET_ITEM);
const customerExists = !!findCustomerByName_(customer);

if (!customerExists && !newCustomerCode) {
return jsonResponse_({ ok: false, error: 'CUSTOMER_NOT_FOUND' });
}

if (!itemId && !materialCode) {
return jsonResponse_({ ok: false, error: 'MISSING_MATERIAL_CODE' });
}

const lock = LockService.getScriptLock();
const gotLock = lock.tryLock(10000);
if (!gotLock) {
return jsonResponse_({ ok: false, error: 'LOCK_TIMEOUT' });
}

// 2026-08-19: 신규 고객사 등록 + 품목 등록/수정을 하나의 Lock 구간에서 원자적으로 처리.
// 예전에는 프론트엔드가 upsertCustomer → upsertItem을 별도의 두 요청으로 순차 호출했는데,
// 첫 번째 요청(고객사 등록)이 성공한 뒤 두 번째 요청(품목 등록/수정)이 네트워크 오류 등으로
// 실패하면 고객사만 영구히 남고 품목은 등록되지 않는 불일치가 생겼다(실사용 중 발견: 신규
// 고객사 "동양산업(주)" 등록 후 품목 등록이 네트워크 오류로 실패했으나 고객사는 그대로 남음).
// 이제는 "이번 호출로 새로 만든 고객사"를 createdCustomerCode에 추적해서, 그 이후 어떤
// 이유로든(검증 실패든 예기치 못한 예외든) 최종 result가 실패이면 방금 만든 고객사 행을
// 삭제해 되돌린다. 원래부터 있던 고객사는 이 되돌리기 대상이 절대 아니다.
let createdCustomerCode = null;
let result;
try {
try {
if (!customerExists) {
if (findCustomerByName_(customer)) {
result = { ok: false, error: 'CUSTOMER_ALREADY_EXISTS' };
} else if (findCustomerByCode_(newCustomerCode)) {
result = { ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' };
} else {
const customerSheet = getSheetObj_('고객사마스터');
customerSheet.appendRow([newCustomerCode, customer, manager]);
invalidateSheetCache_('고객사마스터');
createdCustomerCode = newCustomerCode;
}
}

if (!result) {
if (itemId) {
const data = getSheetValues_(SHEET_ITEM);
let found = false;
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim() === String(itemId).trim()) {
sheet.getRange(i + 1, 2, 1, 6).setValues([[customer, itemName, manager, team, materials, status]]);
SpreadsheetApp.flush();
invalidateSheetCache_(SHEET_ITEM);
found = true;
break;
}
}
result = found
? { ok: true, itemId: itemId, mode: 'updated' }
: { ok: false, error: 'ITEM_NOT_FOUND' };
} else if (getItemById_(materialCode)) {
result = { ok: false, error: 'MATERIAL_CODE_ALREADY_EXISTS' };
} else {
const now = new Date();
sheet.appendRow([materialCode, customer, itemName, manager, team, materials, status, now]);
SpreadsheetApp.flush();
const newRow = sheet.getLastRow();
sheet.getRange(newRow, 8).setNumberFormat('yyyy-mm-dd');
invalidateSheetCache_(SHEET_ITEM);
result = { ok: true, itemId: materialCode, mode: 'created' };
}
}
} catch (err) {
// 등록/수정 로직 중 예기치 못한 예외가 나도 아래 보정 로직으로 흘러가도록 여기서 삼킨다.
result = { ok: false, error: 'SERVER_ERROR', detail: String(err) };
}

if (result && !result.ok && createdCustomerCode) {
try {
const customerSheet = getSheetObj_('고객사마스터');
const customerData = getSheetValues_('고객사마스터');
for (let i = 1; i < customerData.length; i++) {
if (String(customerData[i][0]).trim() === createdCustomerCode) {
customerSheet.deleteRow(i + 1);
invalidateSheetCache_('고객사마스터');
break;
}
}
} catch (rollbackErr) {
// 보정(롤백) 자체가 실패해도 원래 오류(result)는 그대로 반환한다.
}
}

return jsonResponse_(result);
} finally {
lock.releaseLock();
}
}

/**
* action: 'suggestMaterials' — 품목명 기준 AI 원자재 추천(재요청 버튼용). 팀장만 가능.
*/
function handleSuggestMaterials_(user, body) {
if (user.role !== '팀장') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const itemName = body.itemName;
if (!itemName) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
const result = suggestRawMaterials(itemName);
if (!result) {
return jsonResponse_({ ok: false, error: 'AI_SUGGEST_FAILED' });
}
return jsonResponse_({ ok: true, materials: result.korean });
}

function findCustomerByName_(customerName) {
const data = getSheetValues_('고객사마스터');

for (let i = 1; i < data.length; i++) {
if (String(data[i][1]).trim() === String(customerName).trim()) {
return { code: data[i][0], name: data[i][1], manager: data[i][2] };
}
}
return null;
}

function findCustomerByCode_(code) {
const data = getSheetValues_('고객사마스터');
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim() === String(code).trim()) {
return { code: data[i][0], name: data[i][1], manager: data[i][2] };
}
}
return null;
}

function testIssueToken_() {
resetRequestCache_();
const user = findUser_('typark@nkmro.com');
const token = Utilities.getUuid();
CacheService.getScriptCache().put('session_' + token, user.email, 21600);
Logger.log('TOKEN:' + token);
}

/**
* action: 'getSettings' — 설정 조회. 재홍님 개인 이메일 전용(역할 시스템과 무관).
*/
function handleGetSettings_(user, body) {
const data = getSheetValues_(SHEET_SETTING);
const settings = {};
const descriptions = {};
for (let i = 1; i < data.length; i++) {
const key = data[i][0];
if (!key) continue;
settings[key] = data[i][1];
descriptions[key] = data[i][2] || '';
}
return jsonResponse_({ ok: true, settings: settings, descriptions: descriptions });
}
function handleUpdateSettings_(user, body) {
if (String(user.email).trim().toLowerCase() !== ADMIN_EMAIL) {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const updates = body.settings;
if (!updates || typeof updates !== 'object') {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}

const sheet = getSheetObj_(SHEET_SETTING);
const data = getSheetValues_(SHEET_SETTING);
const updatedKeys = [];
const unknownKeys = [];

Object.keys(updates).forEach(function (key) {
let found = false;
for (let i = 1; i < data.length; i++) {
if (data[i][0] === key) {
sheet.getRange(i + 1, 2).setValue(updates[key]);
updatedKeys.push(key);
found = true;
break;
}
}
if (!found) unknownKeys.push(key);
});

invalidateSheetCache_(SHEET_SETTING);

return jsonResponse_({ ok: true, updatedKeys: updatedKeys, unknownKeys: unknownKeys });
}
// ==== 사용자 현황 (관리자 전용) ====
function handleGetUsers_(user, body) {
var isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
var isScopedRole = (user.role === '담당' || user.role === '팀장');
if (!isAdmin && !isScopedRole) {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const rows = getSheetValues_('사용자팀마스터');
const users = [];
for (let i = 1; i < rows.length; i++) {
const row = rows[i];
if (!row[0]) continue;
if (!isAdmin && String(row[3]).trim() !== String(user.team).trim()) continue;
users.push({
row: i + 1,
email: row[0],
name: row[1],
role: row[2],
team: row[3],
status: row[4]
});
}
return jsonResponse_({ ok: true, users: users });
}

function handleUpdateUser_(user, body) {
if (String(user.email).trim().toLowerCase() !== ADMIN_EMAIL) {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const rowNum = Number(body.row);
if (!rowNum || rowNum < 2) {
return jsonResponse_({ ok: false, error: 'INVALID_ROW' });
}
const VALID_ROLES = ['일반', '담당', '팀장', '임원'];
const VALID_TEAMS = ['동부', '서부', '중부', '영업지원', '소싱', '본사'];
const VALID_STATUS = ['활성', '비활성'];
if (body.role !== undefined && VALID_ROLES.indexOf(body.role) === -1) {
return jsonResponse_({ ok: false, error: 'INVALID_ROLE' });
}
if (body.team !== undefined && VALID_TEAMS.indexOf(body.team) === -1) {
return jsonResponse_({ ok: false, error: 'INVALID_TEAM' });
}
if (body.status !== undefined && VALID_STATUS.indexOf(body.status) === -1) {
return jsonResponse_({ ok: false, error: 'INVALID_STATUS' });
}
const sheet = getSheetObj_('사용자팀마스터');
if (body.name !== undefined && String(body.name).trim() !== '') {
sheet.getRange(rowNum, 2).setValue(String(body.name).trim());
}
if (body.role !== undefined) sheet.getRange(rowNum, 3).setValue(body.role);
if (body.team !== undefined) sheet.getRange(rowNum, 4).setValue(body.team);
if (body.status !== undefined) sheet.getRange(rowNum, 5).setValue(body.status);
invalidateSheetCache_('사용자팀마스터');
return jsonResponse_({ ok: true });
}

// ==== 댓글 확인이력 (알림함 '댓글 필요' 정확도 개선용) ====
function setupThreadSeenSheet_() {
const ss = getSS_();
let sheet = ss.getSheetByName(SHEET_THREAD_SEEN);
if (!sheet) {
sheet = ss.insertSheet(SHEET_THREAD_SEEN);
sheet.getRange(1, 1, 1, 4).setValues([['이메일', 'postId', 'itemId', '확인시각']]);
}
}

function getThreadSeenMap_(email) {
const data = getSheetValues_(SHEET_THREAD_SEEN);
const map = {};
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).toLowerCase() === String(email).toLowerCase()) {
map[data[i][1] + '-' + data[i][2]] = data[i][3];
}
}
return map;
}

function handleGetThreadSeen_(user, body) {
const map = getThreadSeenMap_(user.email);
return jsonResponse_({ ok: true, seenMap: map });
}

function handleMarkThreadSeen_(user, body) {
const postId = String(body.postId || '');
const itemId = String(body.itemId || '');
if (!postId || !itemId) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
const lock = LockService.getScriptLock();
lock.waitLock(5000);
try {
const sheet = getSheetObj_(SHEET_THREAD_SEEN);
const data = getSheetValues_(SHEET_THREAD_SEEN);
const now = new Date().toISOString();
let found = false;
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).toLowerCase() === String(user.email).toLowerCase() && String(data[i][1]) === postId && String(data[i][2]) === itemId) {
sheet.getRange(i + 1, 4).setValue(now);
found = true;
break;
}
}
if (!found) {
sheet.appendRow([user.email, postId, itemId, now]);
}
invalidateSheetCache_(SHEET_THREAD_SEEN);
} finally {
lock.releaseLock();
}
return jsonResponse_({ ok: true });
}

// ==== 품목 관리 페이지 (팀장 전용): 목록 조회 + 신규 고객사 등록 ====
function handleGetItems_(user, body) {
if (user.role !== '팀장' && user.role !== '담당') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const isAdmin = String(user.email).trim().toLowerCase() === ADMIN_EMAIL;
const data = getSheetValues_(SHEET_ITEM);
const items = [];
for (let i = 1; i < data.length; i++) {
const row = data[i];
if (!row[0]) continue;
if (!isAdmin && String(row[4]).trim() !== String(user.team).trim()) continue;
items.push({
itemId: String(row[0]),
customer: row[1],
itemName: row[2],
manager: row[3],
team: row[4],
materials: row[5],
status: row[6]
});
}
var resultItems = items;
if (user.role === '담당') {
resultItems = items.filter(function (it) { return it.team === user.team; });
} else if (user.role === '팀장') {
var scope = getSetting_('팀장_열람범위');
if (scope !== '전체') {
resultItems = items.filter(function (it) { return it.team === user.team; });
}
}
return jsonResponse_({ ok: true, items: resultItems });
}

function handleGetCustomers_(user, body) {
if (user.role !== '팀장') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const data = getSheetValues_('고객사마스터');
const customers = [];
for (let i = 1; i < data.length; i++) {
const row = data[i];
if (!row[1]) continue;
customers.push({ code: row[0], name: row[1], manager: row[2] });
}
return jsonResponse_({ ok: true, customers: customers });
}

function handleUpsertCustomer_(user, body) {
if (user.role !== '팀장') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const name = String(body.name || '').trim();
const code = String(body.code || '').trim();
const manager = String(body.manager || '').trim();
if (!name || !code) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
const lock = LockService.getScriptLock();
const gotLock = lock.tryLock(10000);
if (!gotLock) {
return jsonResponse_({ ok: false, error: 'LOCK_TIMEOUT' });
}
try {
// 2026-08-19: 이름/코드 중복 확인을 Lock 획득 이후로 이동.
// 기존에는 '중복확인 → Lock 획득 → appendRow' 순서라 동시 요청 두 개가
// 모두 중복확인을 통과한 뒤 같은 이름/코드로 두 번 등록될 수 있는 race condition이 있었음.
// 이제는 중복확인 + 등록 전체가 하나의 Lock 구간에서 원자적으로 처리됨.
// 또한 A열 코드는 임의 생성('WEB'+timestamp) 대신 사용자가 입력한 사내 시스템 코드를 그대로 쓰고,
// C열 담당자도 함께 저장해 신규 고객사 등록 시 담당자가 비어있던 문제를 해결함.
if (findCustomerByName_(name)) {
return jsonResponse_({ ok: false, error: 'CUSTOMER_ALREADY_EXISTS' });
}
if (findCustomerByCode_(code)) {
return jsonResponse_({ ok: false, error: 'CUSTOMER_CODE_ALREADY_EXISTS' });
}
const sheet = getSheetObj_('고객사마스터');
sheet.appendRow([code, name, manager]);
invalidateSheetCache_('고객사마스터');
return jsonResponse_({ ok: true, code: code, name: name, manager: manager });
} finally {
lock.releaseLock();
}
}

function handleGetTeamManagers_(user, body) {
if (user.role !== '팀장') {
return jsonResponse_({ ok: false, error: 'FORBIDDEN' });
}
const data = getSheetValues_(SHEET_USER);
const managers = [];
for (let i = 1; i < data.length; i++) {
const row = data[i];
if (!row[0]) continue;
const role = row[2];
const team = row[3];
const status = row[4];
if (role === '담당' && String(team).trim() === String(user.team).trim() && status === '활성') {
managers.push({ email: row[0], name: row[1] });
}
}
return jsonResponse_({ ok: true, managers: managers });
}

// ==== 비밀번호 주기적 강제 변경 ====
function setupPasswordExpirySheet_() {
const sheet = getSheetObj_(SHEET_USER);
const data = getSheetValues_(SHEET_USER);
const header = sheet.getRange(1, 9).getValue();
if (!header) {
sheet.getRange(1, 9).setValue('비밀번호변경일');
}
const now = new Date().toISOString();
for (let i = 1; i < data.length; i++) {
const existing = sheet.getRange(i + 1, 9).getValue();
if (!existing) {
sheet.getRange(i + 1, 9).setValue(now);
}
}
const settingSheet = getSheetObj_(SHEET_SETTING);
const settingData = getSheetValues_(SHEET_SETTING);
let hasSetting = false;
for (let i = 1; i < settingData.length; i++) {
if (String(settingData[i][0]).trim() === '비밀번호만료일수') { hasSetting = true; break; }
}
if (!hasSetting) {
settingSheet.appendRow(['비밀번호만료일수', '90', '비밀번호 강제 변경 주기(일). 코드 수정 없이 전환 가능']);
invalidateSheetCache_(SHEET_SETTING);
}
invalidateSheetCache_(SHEET_USER);
}

function handleChangePassword_(user, body) {
const currentPassword = String(body.currentPassword || '');
const newPassword = String(body.newPassword || '');
if (!currentPassword || !newPassword) {
return jsonResponse_({ ok: false, error: 'MISSING_FIELDS' });
}
if (newPassword.length < 6) {
return jsonResponse_({ ok: false, error: 'PASSWORD_TOO_SHORT' });
}
const fresh = findUser_(user.email);
if (!fresh) {
return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
}
if (fresh.passwordHash !== hashPassword_(currentPassword, user.email)) {
return jsonResponse_({ ok: false, error: 'WRONG_PASSWORD' });
}
const sheet = getSheetObj_(SHEET_USER);
const data = getSheetValues_(SHEET_USER);
let found = false;
for (let i = 1; i < data.length; i++) {
if (String(data[i][0]).trim().toLowerCase() === String(user.email).trim().toLowerCase()) {
sheet.getRange(i + 1, 7).setValue(hashPassword_(newPassword, user.email));
sheet.getRange(i + 1, 9).setValue(new Date().toISOString());
found = true;
break;
}
}
invalidateSheetCache_(SHEET_USER);
if (!found) {
return jsonResponse_({ ok: false, error: 'USER_NOT_FOUND' });
}
return jsonResponse_({ ok: true });
}

// ==== 알림함 전용: 담당 미확인(needsAttention) 게시물 전체 조회 (페이지네이션/기간 제한 없음) ====
function handleGetAttentionPosts_(user, body) {
const allPosts = getAllPosts_();
const allItems = getAllItems_();
const allComments = getAllComments_();

const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});

const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});

const results = [];
allPosts.forEach(function (post) {
const entry = buildFeedEntry_(user, post, allItems, commentsByPost, teamByEmail);
if (!entry) return;
const hasUnconfirmed = (entry.items || []).some(function (it) { return !it.confirmed; });
if (hasUnconfirmed) results.push(entry);
});

results.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

return jsonResponse_({ ok: true, posts: results });
}

function testGmailAuthReauth() {
GmailApp.sendEmail(ADMIN_EMAIL, '[MRO 시황] 권한 재승인 테스트', '이 메일이 도착했다면 Gmail 발송 권한이 정상 복구된 것입니다.', { from: ADMIN_EMAIL, name: 'MRO 자재 시황' });
}

/**
* ===== 일일 백업 (2026-07-28 추가) =====
* 매시간 실행되는 트리거에서 호출됨. 설정 시트의 '백업시각'(0~23) 값과
* 현재 시각이 일치하고, 오늘 아직 백업을 안 했으면 실제 백업을 수행한다.
* - DB(스프레드시트) 사본
* - 백엔드(이 Apps Script 프로젝트) 사본
* - 프론트(GitHub raw index.html / feed.html / manifest.json / sw.js) 텍스트 저장
* 저장 위치: "MRO자재시황관리시스템" 폴더(고정 ID) 안의 "MRO_백업" 폴더 > 오늘 날짜 하위 폴더.
* 15일보다 오래된 날짜 폴더는 자동 삭제(회전).
*/
const BACKUP_PARENT_FOLDER_ID = '1ZMSkoQtg5AFS0urC1529QpvXA2vpCKxk';
const BACKUP_RETENTION_DAYS = 15;
const BACKUP_FRONTEND_FILES = ['index.html', 'feed.html', 'manifest.json', 'sw.js'];
const BACKUP_GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/nkmro/mro-market-intelligence/main/';

function dailyBackupCheck_() {
try {
const hourSetting = getSetting_('백업시각');
const targetHour = (hourSetting !== null && hourSetting !== '') ? Number(hourSetting) : 23;
const now = new Date();
const todayStr = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');

if (now.getHours() !== targetHour) return; // 아직 백업 시각이 아님

const props = PropertiesService.getScriptProperties();
if (props.getProperty('lastBackupDate') === todayStr) return; // 오늘 이미 백업함

runDailyBackup_(todayStr);
props.setProperty('lastBackupDate', todayStr);
} catch (err) {
Logger.log('dailyBackupCheck_ 오류: ' + err);
}
}

function runDailyBackup_(todayStr) {
const parentFolder = DriveApp.getFolderById(BACKUP_PARENT_FOLDER_ID);
const backupRoot = getOrCreateChildFolder_(parentFolder, 'MRO_백업');
const dateFolder = getOrCreateChildFolder_(backupRoot, todayStr);

// 1) DB(스프레드시트) 사본
try {
DriveApp.getFileById(SHEET_ID).makeCopy('DB_' + todayStr, dateFolder);
} catch (e) {
Logger.log('DB 백업 실패: ' + e);
}

// 2) 백엔드(Apps Script 프로젝트 자체) 사본
try {
DriveApp.getFileById(ScriptApp.getScriptId()).makeCopy('백엔드_' + todayStr, dateFolder);
} catch (e) {
Logger.log('백엔드 백업 실패: ' + e);
}

// 3) 프론트(GitHub raw 파일) 텍스트로 저장
BACKUP_FRONTEND_FILES.forEach(function (fname) {
try {
const res = UrlFetchApp.fetch(BACKUP_GITHUB_RAW_BASE + fname, { muteHttpExceptions: true });
if (res.getResponseCode() === 200) {
dateFolder.createFile(fname, res.getContentText(), MimeType.PLAIN_TEXT);
}
} catch (e) {
Logger.log('프론트 백업 실패(' + fname + '): ' + e);
}
});

// 4) 회전 — BACKUP_RETENTION_DAYS일보다 오래된 날짜 폴더 삭제
const cutoff = new Date(Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
const folders = backupRoot.getFolders();
while (folders.hasNext()) {
const f = folders.next();
const name = f.getName();
if (/^\d{4}-\d{2}-\d{2}$/.test(name)) {
const folderDate = new Date(name + 'T00:00:00+09:00');
if (folderDate.getTime() < cutoff.getTime()) {
f.setTrashed(true);
}
}
}
}

function getOrCreateChildFolder_(parent, name) {
const it = parent.getFoldersByName(name);
if (it.hasNext()) return it.next();
return parent.createFolder(name);
}

function installBackupTrigger_() {
ScriptApp.getProjectTriggers().forEach(function (t) {
if (t.getHandlerFunction() === 'dailyBackupCheck_') ScriptApp.deleteTrigger(t);
});
ScriptApp.newTrigger('dailyBackupCheck_').timeBased().everyHours(1).create();
}

function diagCheckIncompleteRows() {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const sheet = ss.getSheetByName('품목마스터');
const data = sheet.getDataRange().getValues();

for (let r = 1; r < data.length; r++) {
const row = data[r];
const a = row[0], b = row[1], c = row[2], d = row[3], e = row[4], f = row[5], g = row[6];
const incomplete = a && c && (!d || !e || !f || !g);
if (incomplete) {
Logger.log('행' + (r+1) + ': A=[' + a + '] B=[' + b + '] C=[' + c + '] D=[' + d + '] E=[' + e + '] F=[' + f + '] G=[' + g + ']');
}
}
}

function ensureAllItemRowsComplete() {
// suggestRawMaterials 내부에서 LockService(스크립트 락)를 이미 쓰고 있어서, 여기서 같은 락을 또 잡으면
// 재진입 이슈가 생길 수 있으므로, 별도의 '소프트 락'(ScriptProperties 타임스탬프)으로 중첩 실행만 막는다.
const props = PropertiesService.getScriptProperties();
const RUN_FLAG_KEY = 'ENSURE_ITEM_COMPLETE_RUNNING_SINCE';
const STALE_MS = 6 * 60 * 1000; // 6분 이상 지난 플래그는 이전 실행이 비정상 종료된 것으로 보고 무시

const runningSince = props.getProperty(RUN_FLAG_KEY);
if (runningSince && (new Date().getTime() - Number(runningSince)) < STALE_MS) {
Logger.log('이전 실행이 아직 진행 중이라(또는 6분 이내) 이번 실행은 건너뜀');
return;
}
props.setProperty(RUN_FLAG_KEY, String(new Date().getTime()));

try {
const startTime = new Date().getTime();
const TIME_BUDGET_MS = 3 * 60 * 1000; // 5분 트리거와 겹치지 않도록 여유있게 3분으로 축소
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const sheet = ss.getSheetByName('품목마스터');
const data = sheet.getDataRange().getValues();

let processed = 0, skipped = 0;
for (let r = 1; r < data.length; r++) {
if (new Date().getTime() - startTime > TIME_BUDGET_MS) {
Logger.log('시간 제한 도달, 여기까지 처리하고 중단 (다음 트리거에서 이어서 처리됨). 처리행 수: ' + processed);
return;
}
const row = data[r];
const rowNum = r + 1;
const a = row[0], b = row[1], c = row[2], d = row[3], e = row[4], f = row[5], g = row[6], h = row[7];
if (!a || !b || !c) { continue; }
if (d && e && f && g && h) { continue; } // 이미 완성됨

try {
if (!sheet.getRange(rowNum, 4).getValue()) autofillManagerFromCustomer_(sheet, rowNum);

const fCell = sheet.getRange(rowNum, 6);
if (!fCell.getValue()) {
const aiResult = suggestRawMaterials(c);
if (aiResult && aiResult.korean && aiResult.korean.length) {
fCell.setValue(aiResult.korean.join(', '));
}
}

const gCell = sheet.getRange(rowNum, 7);
if (!gCell.getValue()) gCell.setValue('활성');

const hCell = sheet.getRange(rowNum, 8);
if (!hCell.getValue()) {
hCell.setValue(new Date());
hCell.setNumberFormat('yyyy-mm-dd');
}

processed++;
Logger.log('행' + rowNum + ' 완성 처리: ' + c);
} catch (rowErr) {
skipped++;
console.error('ensureAllItemRowsComplete row ' + rowNum + ' error: ' + rowErr);
}
}
Logger.log('전체 완료. 처리된 행: ' + processed + ' | 오류로 스킵된 행: ' + skipped);
} finally {
props.deleteProperty(RUN_FLAG_KEY);
}
}
function diagRecheckIncomplete() {
const props = PropertiesService.getScriptProperties();
const ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
const sheet = ss.getSheetByName('품목마스터');
const data = sheet.getDataRange().getValues();
let count = 0;
let firstFew = [];
for (let r = 1; r < data.length; r++) {
const row = data[r];
const a = row[0], b = row[1], c = row[2], d = row[3], e = row[4], f = row[5], g = row[6];
if (a && b && c && (!d || !e || !f || !g)) {
count++;
if (firstFew.length < 5) firstFew.push((r+1) + ':' + c);
}
}
Logger.log('남은 미완성 행 수: ' + count + ' | 예시: ' + firstFew.join(', '));
}

function installEnsureItemCompleteTrigger() {
ScriptApp.getProjectTriggers().forEach(function(t) {
if (t.getHandlerFunction() === 'ensureAllItemRowsComplete') ScriptApp.deleteTrigger(t);
});
ScriptApp.newTrigger('ensureAllItemRowsComplete')
.timeBased()
.everyMinutes(15)
.create();
Logger.log('15분 주기 트리거 설치 완료');
}

function getUnconfirmedItemsByManager_() {
const allPosts = getAllPosts_();
const allItems = getAllItems_();
const allComments = getAllComments_();
const commentsByPost = {};
allComments.forEach(function (c) {
const key = String(c.postId);
if (!commentsByPost[key]) commentsByPost[key] = [];
commentsByPost[key].push(c);
});
const teamByEmail = {};
allComments.forEach(function (c) {
const email = String(c.authorEmail || '');
if (email && !(email in teamByEmail)) teamByEmail[email] = getUserTeam_(email);
});
const virtualExecUser = { role: '임원', name: '', email: '', lastCheckedAt: null };
const activeManagersByName = {};
getSheetValues_(SHEET_USER).slice(1).forEach(function (row) {
const name = String(row[1] || '').trim();
if (name && !(name in activeManagersByName)) activeManagersByName[name] = String(row[4] || '').trim() === '활성';
});
const unconfirmedByManager = {};
allPosts.forEach(function (post) {
const entry = buildFeedEntry_(virtualExecUser, post, allItems, commentsByPost, teamByEmail);
if (!entry) return;
entry.items.forEach(function (it) {
if (it.confirmed) return;
const manager = String(it.manager || '').trim();
if (!manager || !activeManagersByName[manager]) return;
if (!unconfirmedByManager[manager]) unconfirmedByManager[manager] = [];
unconfirmedByManager[manager].push({
itemName: it.itemName,
postId: entry.post.id,
postTitle: entry.post.title,
postSummary: entry.post.summary,
postCreatedAt: entry.post.createdAt
});
});
});
return unconfirmedByManager;
}

function testUnconfirmedByManager() {
Logger.log(JSON.stringify(getUnconfirmedItemsByManager_(), null, 2));
}

function diagDebugLogVolume() {
const ss = getSS_();
const sheet = ss.getSheetByName('디버그로그');
if (!sheet) { Logger.log('시트 없음'); return; }
const lastRow = sheet.getLastRow();
const sampleSize = Math.min(1000, lastRow - 1);
const startRow = Math.max(2, lastRow - sampleSize + 1);
const numRows = lastRow - startRow + 1;
const data = sheet.getRange(startRow, 1, numRows, 3).getValues();
const kindCounts = {};
let firstTs = null;
let lastTs = null;
data.forEach(function (row) {
const ts = row[0];
if (!firstTs) firstTs = ts;
lastTs = ts;
try {
const obj = JSON.parse(row[2]);
const kind = obj.kind || 'unknown';
kindCounts[kind] = (kindCounts[kind] || 0) + 1;
} catch (e) {
kindCounts['parse_error'] = (kindCounts['parse_error'] || 0) + 1;
}
});
Logger.log(JSON.stringify({
lastRow: lastRow,
sampledRows: numRows,
firstTsInSample: firstTs,
lastTsInSample: lastTs,
kindCounts: kindCounts
}, null, 2));
}

function diagApiDelayRecent_() {
const sheet = getSS_().getSheetByName('디버그로그');
const data = sheet.getDataRange().getValues();
const now = new Date();
const cutoff = new Date(now.getTime() - 24*60*60*1000);
let total = 0;
const outcomeCounts = {};
const actionCounts = {};
const recent = [];
for (let i = data.length - 1; i >= 1; i--) {
const ts = data[i][0];
if (!(ts instanceof Date) || ts < cutoff) continue;
let body;
try { body = JSON.parse(data[i][2]); } catch (e) { continue; }
if (body.kind !== 'apiDelay') continue;
total++;
outcomeCounts[body.outcome] = (outcomeCounts[body.outcome]||0)+1;
actionCounts[body.action] = (actionCounts[body.action]||0)+1;
if (recent.length < 40) {
recent.push({ ts: Utilities.formatDate(ts, Session.getScriptTimeZone(), 'MM-dd HH:mm:ss'), action: body.action, round: body.round, outcome: body.outcome, elapsedMs: body.elapsedMs });
}
}
Logger.log(JSON.stringify({ total, outcomeCounts, actionCounts, recent }, null, 2));
}
