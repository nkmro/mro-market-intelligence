// 2026-11-02 요금 절감 1-가: lib/pushSender.js B-1(noLiveSig) + 기기 생존 판단 변경 테스트(가짜 Firestore).
const path = require('path');
const { FieldValue } = require('@google-cloud/firestore');
const ps = require(path.join(__dirname, '..', 'lib', 'pushSender.js'));
let pass = 0, fail = 0;
const t = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  → ' + JSON.stringify(info))); };
const H = 3600 * 1000, NOW = Date.now();
function fakeFs(sessions, subs, state) {
  const st = { reads: 0, queries: 0, writes: [], state: Object.assign({}, state || {}), subs };
  const docRef = (coll, id) => ({
    async get() { st.reads++; const d = coll === 'pushNotifyState' ? st.state[id] : null; return { exists: !!d, data: () => d }; },
    async set(v, o) { st.writes.push([coll, id, v]); if (coll === 'pushNotifyState') { const cur = Object.assign({}, st.state[id] || {}); Object.keys(v).forEach(k => { if (v[k] && v[k].isEqual && v[k].isEqual(FieldValue.delete())) delete cur[k]; else cur[k] = v[k]; }); st.state[id] = cur; } }
  });
  const query = (coll, conds) => ({
    where(f, op, v) { return query(coll, conds.concat([[f, v]])); },
    async get() {
      st.queries++;
      const src = coll === 'sessions' ? sessions : st.subs;
      const docs = src.filter(d => conds.every(c => d[c[0]] === c[1])).map(d => ({ data: () => d, ref: { set: async (v) => { st.writes.push([coll, d.deviceId, v]); Object.assign(d, v); } } }));
      return { empty: !docs.length, docs, forEach: f => docs.forEach(f) };
    }
  });
  return { st, collection: c => ({ doc: id => docRef(c, id), where: (f, op, v) => query(c, [[f, v]]) }) };
}
const sess = (dev, expOffsetMs) => ({ email: 'a@x.com', deviceId: dev, expiresAt: new Date(NOW + expOffsetMs) });
const counts = { newPosts: 2, needsReply: 0, awaitingReply: 0 }, SIG = '2-0-0';
const auth = { request: async () => ({}) };
(async () => {
  // 기기 생존 판단(순수 함수)
  const A = (deviceLive, liveNoDevice) => ({ deviceLive, liveNoDevice });
  t('D1 deviceId 없는 옛 구독 → 살아있음(예전과 같음)', ps.isDeviceSessionAlive_(A({}, false), null) === true);
  t('D2 이 기기 세션 살아있음 → 살아있음', ps.isDeviceSessionAlive_(A({ d1: true }, false), 'd1') === true);
  t('D3 이 기기 세션 전부 만료 → 죽음(예전과 같음)', ps.isDeviceSessionAlive_(A({ d1: false }, false), 'd1') === false);
  t('D4 이 기기 세션 없음 + deviceId 없는 살아있는 세션 있음 → 살아있음', ps.isDeviceSessionAlive_(A({ d2: true }, true), 'd1') === true);
  t('D5 이 기기 세션 없음(지워짐) + 다른 기기만 살아있음 → 죽음 (101행 변경점)', ps.isDeviceSessionAlive_(A({ d2: true }, false), 'd1') === false);

  // B-1: 로그아웃 상태 반복 막기
  let f = fakeFs([sess('d1', -2 * H), sess('d1', -30 * H)], [{ email: 'a@x.com', deviceId: 'd1', active: true, fcmToken: 'T' }]);
  let r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('N1 로그아웃 상태 첫 배치 → NO_LIVE_SESSION, 구독 끔, noLiveSig 기록', r.reason === 'NO_LIVE_SESSION' && f.st.subs[0].active === false && f.st.state['a@x.com'].noLiveSig === SIG, { r, s: f.st.state });
  const q1 = f.st.queries;
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('N2 5분 뒤 같은 내용 → 세션 조회 없이 끝(NO_LIVE_SESSION_SAME)', r.reason === 'NO_LIVE_SESSION_SAME' && f.st.queries === q1, { r, q: f.st.queries, q1 });
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', { newPosts: 3, needsReply: 0, awaitingReply: 0 });
  t('N3 내용이 바뀌면 → 다시 조회(예전 흐름)', r.reason === 'NO_LIVE_SESSION' && f.st.queries > q1, r);

  // 다시 로그인 → 구독 등록이 noLiveSig 지움 → 예전 흐름
  f.st.state['a@x.com'].noLiveSig = SIG;
  await f.collection('pushNotifyState').doc('a@x.com').set({ noLiveSig: FieldValue.delete() }, { merge: true });
  t('N4 구독 등록 때 noLiveSig 지움(가짜 저장소 반영 확인)', !('noLiveSig' in f.st.state['a@x.com']), f.st.state);

  // 살아있지만 앱 닫힘 → 발송, 죽은 기기는 끔(조회는 세션 1번뿐)
  f = fakeFs([sess('d1', 5 * H), sess('d2', -1 * H)], [{ email: 'a@x.com', deviceId: 'd1', active: true, fcmToken: 'T1' }, { email: 'a@x.com', deviceId: 'd2', active: true, fcmToken: 'T2' }]);
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('S1 살아있는 기기 d1만 발송, 만료 기기 d2는 끔', r.sentCount === 1 && r.deactivatedCount === 1 && f.st.subs[1].active === false, r);
  t('S2 sessions 조회는 사용자당 1번(예전: 1 + 구독 수)', f.st.queries === 2, f.st.queries); // sessions 1 + pushSubscriptions 1

  // 지워진 세션(1-다 이후) 상황: d1 세션 문서가 없어짐, d2만 살아있음 → d1에 보내지 않음
  f = fakeFs([sess('d2', 5 * H)], [{ email: 'a@x.com', deviceId: 'd1', active: true, fcmToken: 'T1' }]);
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('S3 세션이 지워진 기기 d1 → 발송 안 하고 끔 (예전: 오발송)', r.sentCount === 0 && r.deactivatedCount === 1, r);

  // Apps Script 대체 로그인(deviceId 없는 세션)만 살아있음 → 기기 d1에 보냄
  f = fakeFs([{ email: 'a@x.com', expiresAt: new Date(NOW + 5 * H) }], [{ email: 'a@x.com', deviceId: 'd1', active: true, fcmToken: 'T1' }]);
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('S4 deviceId 없는 살아있는 세션만 있음 → 보냄(예전과 같음)', r.sentCount === 1, r);

  // 앱 열림 → APP_OPEN 그대로
  f = fakeFs([sess('d1', 6 * H - 30 * 1000)], []);
  r = await ps.sendConsolidatedPushForUser(f, auth, 'p', 'a@x.com', counts);
  t('S5 앱 열림 → APP_OPEN(예전과 같음)', r.reason === 'APP_OPEN', r);

  // 리마인더도 같은 기기 판단 사용
  f = fakeFs([sess('d2', 5 * H)], [{ email: 'a@x.com', deviceId: 'd1', active: true, fcmToken: 'T1' }, { email: 'a@x.com', deviceId: 'd2', active: true, fcmToken: 'T2' }]);
  r = await ps.sendReminderPushForUser(f, auth, 'p', 'a@x.com', { title: 't', body: 'b' });
  t('R1 리마인더: d2만 발송, 세션 없는 d1은 끔', r.sentCount === 1 && r.deactivatedCount === 1, r);
  console.log('pass ' + pass + ' / fail ' + fail);
})();
