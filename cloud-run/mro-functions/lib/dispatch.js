// [2026-11-04 요금 절감 1-다] 스케줄러 작업 4개(push 5분 / sweep 15분 / reminder·issueMail 1시간)를
// 5분마다 도는 작업 1개(dispatchBatchTest)로 합치기 위한 공통 모듈.
// - 기존 함수의 코드를 여기서 직접 돌리지 않고, 기존 함수 주소를 HTTP로 그대로 호출한다
//   (sweep은 AI 키, issueMail은 메일 비밀번호를 각자 함수의 Secret으로 갖고 있어서 — 함수 밖으로
//   꺼내지 않기 위해). 호출 방식은 Cloud Run 공식 문서 service-to-service의 Node 예시
//   (new GoogleAuth().getIdTokenClient(audience))와 같다.
// - 주소는 기존 스케줄러 작업이 부르던 주소 그대로다(2026-11-04 Cloud Scheduler 화면에서 확인).
//   push/reminder의 cloudfunctions.net 주소는 서비스 YAML의 custom-audiences에 그대로 등록돼
//   있어 ID 토큰 audience로 쓸 수 있다(같은 날 YAML 확인).
// - 만료된 지 24시간 넘은 sessions 문서 정리(1시간에 1번, 최대 300개)도 여기서 한다. TTL 정책은
//   삭제 무료 한도에 포함되지 않아(Firestore 가격 문서) 쓰지 않는다.

const DISPATCH_TARGETS = {
  push: 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/pushBatchTest',
  reminder: 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/reminderBatchTest',
  issueMail: 'https://issuemailbatchtest-tact3ecppq-du.a.run.app/',
  sweep: 'https://materialsweeptest-tact3ecppq-du.a.run.app/'
};
// 각 호출의 최대 대기 시간. sweep은 함수 자체 예산 240초(SWEEP_BUDGET_MS)·제한 300초라 290초.
const DISPATCH_TIMEOUT_MS = { push: 60000, reminder: 120000, issueMail: 120000, sweep: 290000 };

const SESSION_PURGE_GRACE_MS = 24 * 60 * 60 * 1000; // 만료 후 24시간 지난 것만 지운다
const SESSION_PURGE_LIMIT = 300;                    // 한 번에 최대 300개(읽기·삭제 각 300 이하)

function kstMinute(nowMs) {
  return new Date(nowMs + 9 * 60 * 60 * 1000).getUTCMinutes();
}

// 스케줄 '2-59/5 * * * *'(분 2,7,12,…,57) 기준. 몇 분 늦게 실행돼도 같은 칸으로 묶이도록
// 분을 5분 칸(slot 0~11)으로 바꿔서 판단한다. slot 0 = 매시 2~6분.
//   push     : 매번(5분)
//   sweep    : slot 0,3,6,9 = 매시 2·17·32·47분(기존 material-sweep-15m과 같은 분)
//   reminder·issueMail·세션 정리 : slot 0 = 매시 2분(기존 매시 0분에서 2분 늦어짐)
function planTargets(minute) {
  const slot = Math.floor((((minute - 2) % 60 + 60) % 60) / 5);
  const keys = ['push'];
  if (slot % 3 === 0) keys.push('sweep');
  if (slot === 0) keys.push('reminder', 'issueMail', 'cleanup');
  return { slot: slot, keys: keys };
}

// 응답 본문 중 로그에 남길 작은 값만 고른다(본문 전체는 남기지 않음).
function pickSummary_(data) {
  if (!data || typeof data !== 'object') return null;
  const out = {};
  ['ok', 'skipped', 'reason', 'processed', 'failed', 'sent', 'serverMs', 'totalMs'].forEach(function (k) {
    if (data[k] !== undefined) out[k] = data[k];
  });
  return out;
}

// ID 토큰 audience = 주소 끝의 '/'를 뗀 값. 기존 스케줄러 작업도 호출 주소는 '…a.run.app/'
// 이지만 audience는 '…a.run.app'(끝 '/' 없음)으로 등록돼 있다(2026-11-04 issue-mail-hourly·
// material-sweep-15m 편집 화면에서 확인). cloudfunctions.net 주소는 원래 '/'가 없어 그대로다.
function audienceOf_(url) {
  return String(url).replace(/\/+$/, '');
}

async function callTarget(getClient, key, url, timeoutMs) {
  const t0 = Date.now();
  try {
    const client = await getClient(audienceOf_(url));
    const res = await client.request({ url: url, method: 'POST', data: {}, timeout: timeoutMs, validateStatus: function () { return true; } });
    const ok = res.status >= 200 && res.status < 300;
    return { key: key, ok: ok, status: res.status, ms: Date.now() - t0, res: pickSummary_(res.data) };
  } catch (e) {
    return { key: key, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 200) };
  }
}

async function purgeExpiredSessions(firestore, nowMs) {
  const t0 = Date.now();
  try {
    const cutoff = new Date(nowMs - SESSION_PURGE_GRACE_MS);
    const snap = await firestore.collection('sessions').where('expiresAt', '<', cutoff).limit(SESSION_PURGE_LIMIT).get();
    if (snap.empty) return { key: 'cleanup', ok: true, deleted: 0, more: false, ms: Date.now() - t0 };
    const batch = firestore.batch();
    snap.docs.forEach(function (d) { batch.delete(d.ref); });
    await batch.commit();
    return { key: 'cleanup', ok: true, deleted: snap.docs.length, more: snap.docs.length === SESSION_PURGE_LIMIT, ms: Date.now() - t0 };
  } catch (e) {
    return { key: 'cleanup', ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// deps: { getClient(url) -> IdTokenClient, firestore, targets?, timeouts? }
// 모든 호출을 동시에 시작하고 전부 끝날 때까지 기다린다(Promise.allSettled). 하나가 실패해도
// 나머지는 그대로 진행된다.
async function runDispatch(deps, nowMs) {
  const targets = deps.targets || DISPATCH_TARGETS;
  const timeouts = deps.timeouts || DISPATCH_TIMEOUT_MS;
  const minute = kstMinute(nowMs);
  const plan = planTargets(minute);
  const jobs = plan.keys.map(function (k) {
    if (k === 'cleanup') return purgeExpiredSessions(deps.firestore, nowMs);
    return callTarget(deps.getClient, k, targets[k], timeouts[k]);
  });
  const settled = await Promise.allSettled(jobs);
  const results = settled.map(function (s, i) {
    return s.status === 'fulfilled' ? s.value : { key: plan.keys[i], ok: false, error: String(s.reason).slice(0, 200) };
  });
  return { minute: minute, slot: plan.slot, allOk: results.every(function (r) { return r.ok; }), results: results };
}

module.exports = {
  DISPATCH_TARGETS, DISPATCH_TIMEOUT_MS, SESSION_PURGE_GRACE_MS, SESSION_PURGE_LIMIT,
  kstMinute, planTargets, audienceOf_, callTarget, purgeExpiredSessions, runDispatch
};
