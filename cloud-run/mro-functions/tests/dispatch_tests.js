// 2026-11-04 요금 절감 1-다: lib/dispatch.js 테스트(가짜 호출 클라이언트·가짜 Firestore, 실제 호출 없음).
const path = require('path');
const d = require(path.join(__dirname, '..', 'lib', 'dispatch.js'));
let pass = 0, fail = 0;
const t = (n, ok, info) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  → ' + JSON.stringify(info))); };
const kstMs = (h, m, s) => Date.UTC(2026, 10, 4, h - 9, m, s || 0); // KST h:m → UTC ms

function fakeClients(behavior) {
  const calls = [];
  const getClient = async (aud) => ({
    async request(opts) {
      calls.push({ aud, url: opts.url, method: opts.method, timeout: opts.timeout });
      const b = behavior[opts.url] || { status: 200, data: { ok: true, processed: 3, secretish: 'X' } };
      if (b.throw) throw new Error(b.throw);
      if (b.delay) await new Promise(r => setTimeout(r, b.delay));
      return { status: b.status, data: b.data };
    }
  });
  return { calls, getClient };
}
function fakeFs(sessions, opts) {
  const st = { deleted: [], queries: [], commits: 0 };
  const coll = name => ({
    where(f, op, v) {
      return {
        limit(n) {
          return {
            async get() {
              st.queries.push({ name, f, op, v, n });
              if (opts && opts.queryThrow) throw new Error('boom');
              const docs = sessions.filter(s => op === '<' && s[f] instanceof Date && s[f] < v).slice(0, n)
                .map(s => ({ id: s.id, ref: { id: s.id } }));
              return { empty: !docs.length, docs };
            }
          };
        }
      };
    }
  });
  return {
    st,
    collection: coll,
    batch() { const del = []; return { delete(r) { del.push(r.id); }, async commit() { st.commits++; st.deleted.push(...del); } }; }
  };
}

(async () => {
  // 1) 분 → 할 일
  const exp = m => {
    const s = Math.floor((((m - 2) % 60) + 60) % 60 / 5);
    const k = ['push']; if (s % 3 === 0) k.push('sweep'); if (s === 0) k.push('reminder', 'issueMail', 'cleanup'); return k.join(',');
  };
  const sched = [2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57];
  t('P1 :02 → push+sweep+reminder+issueMail+cleanup', d.planTargets(2).keys.join(',') === 'push,sweep,reminder,issueMail,cleanup', d.planTargets(2));
  t('P2 :07 → push만', d.planTargets(7).keys.join(',') === 'push');
  t('P3 :17/:32/:47 → push+sweep', [17, 32, 47].every(m => d.planTargets(m).keys.join(',') === 'push,sweep'));
  const sweepMins = sched.filter(m => d.planTargets(m).keys.includes('sweep'));
  t('P4 한 시간 sweep = 2,17,32,47(기존과 같음)', sweepMins.join(',') === '2,17,32,47', sweepMins);
  const hourly = sched.filter(m => d.planTargets(m).keys.includes('reminder'));
  t('P5 한 시간 reminder/issueMail/정리 = 1번(:02)', hourly.join(',') === '2', hourly);
  t('P6 한 시간 push = 12번', sched.filter(m => d.planTargets(m).keys.includes('push')).length === 12);
  t('P7 몇 분 늦어도 같은 칸(:03~:06 → slot 0, :01 → slot 11)', [3, 4, 5, 6].every(m => d.planTargets(m).slot === 0) && d.planTargets(1).slot === 11 && d.planTargets(0).slot === 11);
  t('P8 0~59분 전체가 규칙식과 일치', Array.from({ length: 60 }, (_, m) => m).every(m => d.planTargets(m).keys.join(',') === exp(m)));
  t('P9 KST 분 계산(UTC 15:02 = KST 00:02)', d.kstMinute(Date.UTC(2026, 10, 4, 15, 2, 30)) === 2);

  // 2) 호출
  {
    const f = fakeClients({});
    const r = await d.callTarget(f.getClient, 'push', d.DISPATCH_TARGETS.push, 60000);
    t('C1 성공 200 → ok, POST, timeout 전달', r.ok && r.status === 200 && f.calls[0].method === 'POST' && f.calls[0].timeout === 60000, r);
    t('C2 audience = 호출 주소', f.calls[0].aud === d.DISPATCH_TARGETS.push);
    t('C3 응답 본문은 작은 값만 남김(processed 있음, 다른 값 없음)', r.res.processed === 3 && !('secretish' in r.res), r.res);
  }
  {
    const f = fakeClients({ [d.DISPATCH_TARGETS.sweep]: { status: 429, data: 'Rate exceeded.' } });
    const r = await d.callTarget(f.getClient, 'sweep', d.DISPATCH_TARGETS.sweep, 1000);
    t('C4 429 → ok=false, status 기록, 예외 없음', !r.ok && r.status === 429 && r.res === null, r);
  }
  {
    const f = fakeClients({ [d.DISPATCH_TARGETS.reminder]: { throw: 'ETIMEDOUT' } });
    const r = await d.callTarget(f.getClient, 'reminder', d.DISPATCH_TARGETS.reminder, 1000);
    t('C5 연결 오류 → ok=false, error 기록', !r.ok && /ETIMEDOUT/.test(r.error), r);
  }
  {
    const r = await d.callTarget(async () => { throw new Error('no token'); }, 'push', 'u', 1);
    t('C6 토큰 발급 실패 → ok=false', !r.ok && /no token/.test(r.error), r);
  }
  {
    const f = fakeClients({});
    await d.callTarget(f.getClient, 'issueMail', d.DISPATCH_TARGETS.issueMail, 1000);
    t('C9 run.app 주소: 호출은 끝 / 그대로, audience는 끝 / 없이(기존 스케줄러와 같음)', f.calls[0].url === 'https://issuemailbatchtest-tact3ecppq-du.a.run.app/' && f.calls[0].aud === 'https://issuemailbatchtest-tact3ecppq-du.a.run.app', f.calls[0]);
    t('C10 audienceOf_: sweep 끝 / 제거, cloudfunctions 주소는 그대로', d.audienceOf_(d.DISPATCH_TARGETS.sweep) === 'https://materialsweeptest-tact3ecppq-du.a.run.app' && d.audienceOf_(d.DISPATCH_TARGETS.reminder) === d.DISPATCH_TARGETS.reminder);
  }
  t('C7 주소 4개 = 기존 스케줄러 주소', d.DISPATCH_TARGETS.push.endsWith('/pushBatchTest') && d.DISPATCH_TARGETS.reminder.endsWith('/reminderBatchTest') && d.DISPATCH_TARGETS.issueMail === 'https://issuemailbatchtest-tact3ecppq-du.a.run.app/' && d.DISPATCH_TARGETS.sweep === 'https://materialsweeptest-tact3ecppq-du.a.run.app/');
  t('C8 sweep 대기 290초 < 배포 제한 320초', d.DISPATCH_TIMEOUT_MS.sweep === 290000 && Object.values(d.DISPATCH_TIMEOUT_MS).every(v => v < 320000));

  // 3) 세션 정리
  const NOW = kstMs(10, 2), H = 3600e3;
  const mk = (id, off) => ({ id, expiresAt: new Date(NOW + off) });
  {
    const ss = [mk('live', 2 * H), mk('exp1h', -1 * H), mk('exp23h', -23 * H), mk('exp25h', -25 * H), mk('exp30d', -30 * 24 * H), { id: 'str', expiresAt: '2020-01-01' }];
    const fs = fakeFs(ss);
    const r = await d.purgeExpiredSessions(fs, NOW);
    t('S1 만료 24시간 넘은 것만 삭제(25h, 30d)', r.ok && fs.st.deleted.sort().join(',') === 'exp25h,exp30d', fs.st.deleted);
    t('S2 살아있는/최근 만료(1h,23h) 세션은 남김', !fs.st.deleted.includes('live') && !fs.st.deleted.includes('exp1h') && !fs.st.deleted.includes('exp23h'));
    t('S3 조건 = sessions.expiresAt < 지금-24h, limit 300', fs.st.queries[0].name === 'sessions' && fs.st.queries[0].f === 'expiresAt' && fs.st.queries[0].v.getTime() === NOW - 24 * H && fs.st.queries[0].n === 300);
    t('S4 batch 1번 커밋, more=false', fs.st.commits === 1 && r.more === false && r.deleted === 2, r);
  }
  {
    const ss = Array.from({ length: 450 }, (_, i) => mk('o' + i, -48 * H));
    const fs = fakeFs(ss);
    const r = await d.purgeExpiredSessions(fs, NOW);
    t('S5 450개 밀려 있으면 300개만, more=true', r.deleted === 300 && r.more === true && fs.st.commits === 1, r);
  }
  {
    const fs = fakeFs([mk('live', H)]);
    const r = await d.purgeExpiredSessions(fs, NOW);
    t('S6 지울 것 없으면 커밋 안 함', r.ok && r.deleted === 0 && fs.st.commits === 0, r);
  }
  {
    const fs = fakeFs([], { queryThrow: true });
    const r = await d.purgeExpiredSessions(fs, NOW);
    t('S7 조회 실패 → ok=false, 예외 안 던짐', !r.ok && /boom/.test(r.error), r);
  }

  // 4) 전체 실행
  {
    const f = fakeClients({}); const fs = fakeFs([mk('old', -48 * H)]);
    const r = await d.runDispatch({ getClient: f.getClient, firestore: fs }, kstMs(10, 2, 5));
    t('R1 :02 → 4개 호출 + 정리, 모두 ok', r.allOk && r.results.length === 5 && f.calls.length === 4 && fs.st.deleted.join() === 'old', r);
    t('R2 결과 순서 = 계획 순서', r.results.map(x => x.key).join(',') === 'push,sweep,reminder,issueMail,cleanup');
  }
  {
    const f = fakeClients({}); const fs = fakeFs([mk('old', -48 * H)]);
    const r = await d.runDispatch({ getClient: f.getClient, firestore: fs }, kstMs(10, 7, 3));
    t('R3 :07 → push 1개만, 정리 안 함', r.allOk && f.calls.length === 1 && f.calls[0].url === d.DISPATCH_TARGETS.push && fs.st.queries.length === 0, r);
  }
  {
    const f = fakeClients({ [d.DISPATCH_TARGETS.sweep]: { status: 500, data: { ok: false } } });
    const r = await d.runDispatch({ getClient: f.getClient, firestore: fakeFs([]) }, kstMs(10, 17));
    t('R4 sweep 실패해도 push는 성공, allOk=false', !r.allOk && r.results.find(x => x.key === 'push').ok && !r.results.find(x => x.key === 'sweep').ok, r);
  }
  {
    const f = fakeClients({ [d.DISPATCH_TARGETS.sweep]: { status: 200, data: { ok: true }, delay: 150 }, [d.DISPATCH_TARGETS.push]: { status: 200, data: { ok: true }, delay: 150 } });
    const s = Date.now();
    await d.runDispatch({ getClient: f.getClient, firestore: fakeFs([]) }, kstMs(10, 32));
    const ms = Date.now() - s;
    t('R5 동시에 호출(150ms 2개 → 300ms보다 짧게 끝남)', ms < 280, ms);
  }
  {
    const f = fakeClients({});
    const r = await d.runDispatch({ getClient: f.getClient, firestore: fakeFs([]) }, kstMs(0, 2));
    t('R6 자정 00:02도 매시 작업 포함', r.slot === 0 && f.calls.length === 4, r);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
