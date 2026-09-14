# 댓글 고정(Pin Comment) — 실제 코드 diff (v3, pin/unpin 에러 피드백 명세 반영)

`PIN_COMMENT_CLOUDRUN_DESIGN.md`의 5가지 확정 결정사항 + 코드 리뷰 v2 지적사항 4개 + 이번에 주신 pin/unpin 에러 피드백 정확한 명세를 모두 반영한 diff입니다. **아직 커밋·배포하지 않았습니다.**

## v3에서 반영한 것

주신 명세 그대로 반영했습니다:
- `pinComment()`/`unpinComment()` 모두 `else if (res && res.error) { alert(pinErrorMessage_(res.error)); }` 구조로 통일
- `catch` 블록은 `alert('네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.');`로 고정 메시지
- `pinErrorMessage_(error)`를 주신 `map` 객체 방식으로 교체(`FORBIDDEN_NOT_LEAD_OR_EXEC`/`COMMENT_NOT_FOUND`/`MISSING_FIELDS`/`MISSING_COMMENT_ID`/`USER_NOT_FOUND`/`FEATURE_DISABLED`/`NETWORK_ERROR` 전부 포함, fallback은 `'고정 처리 실패: ' + error`)

한 가지만 주신 명세에 제 판단으로 보탰습니다: map에 `PIN_LIMIT_REACHED`도 유지했습니다. `pinCommentTest`가 실제로 이 에러 코드를 반환할 수 있는데(3개 한도 초과), 이걸 map에서 빼면 fallback 문구("고정 처리 실패: PIN_LIMIT_REACHED")로 떨어져서 v2에서 만든 "고정은 최대 3개까지만..." 문구보다 안내가 부정확해지기 때문입니다. 원치 않으시면 바로 빼겠습니다.

## 파일별 변경 요약 (v3 누적)

- **`cloud-run/mro-functions/index.js`**: 287줄 추가, 0줄 삭제, 0줄 변경 — v2에서 변경 없음(이번 요청은 feed.html 한정).
- **`feed.html`**: 291줄 추가, 2줄 변경(기존 코드 변경분은 여전히 `renderThread`의 wrapper `id` 속성 1개 + `.comment-actions`의 `${pinBtn}` 1개뿐).

---

## 1. `cloud-run/mro-functions/index.js` diff (v2와 동일, 변경 없음)

```diff
diff --git a/cloud-run/mro-functions/index.js b/cloud-run/mro-functions/index.js
index 9826234..2354fde 100644
--- a/cloud-run/mro-functions/index.js
+++ b/cloud-run/mro-functions/index.js
@@ -2822,3 +2822,290 @@ exports.reminderBatchTest = async (req, res) => {
     res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
   }
 };
+
+// ---------------------------------------------------------------------------
+// 댓글 고정(Pin Comment) 기능 — 2026-09-11, PIN_COMMENT_CLOUDRUN_DESIGN.md 설계 확정 반영.
+// 기존 Apps Script 함수를 옮기는 게 아니라 완전 신규 기능이다. 기존 '댓글' 시트/기존
+// Firestore 컬렉션(sessions/pushSubscriptions 등)은 전부 읽기만 하고, 이 기능 전용으로
+// 새로 만든 Firestore 컬렉션 'pinnedComments'(문서 ID = commentId)에만 쓴다.
+//
+// [권한] 고정: 팀장/임원만. 해제: 팀장/임원이면 누구나(고정한 사람이 아니어도 됨).
+// [한도] 역할 구분 없이 전체 피드 기준 전역 3개(팀장 3 + 임원 3 = 6이 아니다 — 기획 확정).
+// [스냅샷] contentSnapshot은 고정 당시 댓글 내용을 그대로 고정 — 이후 원본 댓글이
+//         updateComment로 수정돼도 고정 영역 문구는 바뀌지 않는다(기획 확정, "공지" 성격).
+// [중복 고정] 이미 고정된 댓글을 다시 고정 요청하면 에러 없이 조용히 성공 처리(멱등, 기획 확정).
+// [원본 삭제] 조회 시점에 원본 댓글이 이미 삭제돼 있으면 그 pinnedComments 문서를 자동
+//            정리(자가정리)한다(기획 확정).
+//
+// [롤백] feed.html의 CLOUD_RUN_GET_PINNED_COMMENTS_URL / CLOUD_RUN_PIN_COMMENT_URL /
+// CLOUD_RUN_UNPIN_COMMENT_URL을 빈 문자열로 바꾸면 이 3개 함수 전부 즉시 쓰이지 않게 된다
+// (기존 CLOUD_RUN_*_URL 롤백 관례 그대로). 이 블록을 통째로 지워도 다른 함수는 전혀 영향받지
+// 않는다 — 아래 3개 함수 모두 다른 exports.* 함수를 호출하지 않고, 읽기 전용 공용 모듈
+// (lib/auth.js, lib/sheetsClient.js, lib/feedEngine.js)만 기존 함수들과 동일하게 재사용한다.
+const PINNED_COMMENTS_COLLECTION = 'pinnedComments';
+const PIN_MAX = 3;
+
+// pinnedComments 문서 하나 -> 프론트가 쓰기 좋은 평면 객체 (pinnedAt Timestamp -> ISO 문자열).
+function pinnedDocToJson_(doc) {
+  const d = doc.data();
+  const pinnedAtRaw = d.pinnedAt;
+  const pinnedAt = (pinnedAtRaw && pinnedAtRaw.toDate) ? pinnedAtRaw.toDate().toISOString() : null;
+  return {
+    commentId: doc.id,
+    postId: d.postId,
+    itemId: d.itemId || null,
+    authorEmail: d.authorEmail,
+    authorName: d.authorName,
+    authorRole: d.authorRole,
+    contentSnapshot: d.contentSnapshot,
+    pinnedByEmail: d.pinnedByEmail,
+    pinnedByName: d.pinnedByName,
+    pinnedAt: pinnedAt
+  };
+}
+
+// ---------------------------------------------------------------------------
+// POST /getPinnedCommentsTest — 로그인한 모든 사용자가 조회 가능. 각 항목을 조회자 본인의
+// 팀 스코프(feedEngine.visibleCommentsForPost, 기존 getCommentsTest와 동일 필터)로 다시
+// 검증해서, 다른 팀 담당자 댓글이 고정 영역을 통해 새어나가지 않게 한다.
+exports.getPinnedCommentsTest = async (req, res) => {
+  setCors(res);
+  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
+  const t0 = Date.now();
+  try {
+    const { sessionToken } = req.body || {};
+    const auth = await authenticateSession(firestore, sessionToken);
+    if (!auth.ok) {
+      const serverMs = Date.now() - t0;
+      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
+      return;
+    }
+    const timings = Object.assign({}, auth.timings);
+    const email = auth.email;
+
+    const p0 = Date.now();
+    const pinnedSnap = await firestore.collection(PINNED_COMMENTS_COLLECTION).get();
+    timings.pinnedMs = Date.now() - p0;
+
+    if (pinnedSnap.empty) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: true, serverMs, timings, pinnedComments: [] });
+      return;
+    }
+
+    const u0 = Date.now();
+    const client = await getSheetsClient();
+    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
+    timings.sheetMs = Date.now() - u0;
+
+    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
+    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
+    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);
+
+    const viewer = feedEngine.findViewer(allUsers, email);
+    if (!viewer) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
+      return;
+    }
+
+    const leadScope = settings['팀장_열람범위'] || null;
+    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
+
+    const result = [];
+    const staleDocIds = []; // 원본 댓글이 이미 삭제된 경우 -> 자가정리 대상
+    pinnedSnap.docs
+      .sort(function (a, b) {
+        const at = a.data().pinnedAt, bt = b.data().pinnedAt;
+        const ams = (at && at.toMillis) ? at.toMillis() : 0;
+        const bms = (bt && bt.toMillis) ? bt.toMillis() : 0;
+        return ams - bms;
+      })
+      .forEach(function (doc) {
+        const d = doc.data();
+        const original = allComments.find(function (c) { return c.commentId === doc.id; });
+        if (!original) { staleDocIds.push(doc.id); return; }
+        const visible = feedEngine.visibleCommentsForPost(allComments, d.postId, viewer.role, viewer.team, leadScope, teamByEmail);
+        const stillVisible = visible.some(function (c) { return c.commentId === doc.id; });
+        if (!stillVisible) return; // 이 조회자 팀 스코프에서는 안 보임 -> 이번 응답에서만 제외(문서는 유지)
+        result.push(pinnedDocToJson_(doc));
+      });
+
+    // 자가정리: 원본 댓글이 삭제된 pinnedComments 문서를 지운다. 실패해도 이 요청의 응답
+    // 자체에는 영향을 주지 않도록 개별 delete를 catch로 감쌌지만(원칙 3), 응답을 보내기
+    // 전에 await로 완료를 기다린다 — Cloud Run/Cloud Functions는 응답 전송 후 컨테이너를
+    // 곧바로 얼릴 수 있어(await 없이 res.json()보다 먼저 함수가 끝나버리면) 백그라운드로
+    // 남겨둔 정리 작업이 중간에 끊길 수 있기 때문이다(재홍님 코드 리뷰 지적 반영).
+    if (staleDocIds.length > 0) {
+      await Promise.all(staleDocIds.map(function (id) {
+        return firestore.collection(PINNED_COMMENTS_COLLECTION).doc(id).delete().catch(function (e) {
+          console.error('[getPinnedCommentsTest] 자가정리 실패(무시): ' + id + ' - ' + e);
+        });
+      })).catch(function () {});
+    }
+
+    const serverMs = Date.now() - t0;
+    res.status(200).json({ ok: true, serverMs, timings, pinnedComments: result });
+  } catch (err) {
+    const serverMs = Date.now() - t0;
+    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
+  }
+};
+
+// ---------------------------------------------------------------------------
+// POST /pinCommentTest — 팀장/임원만. 이미 고정된 댓글은 에러 없이 조용히 성공(멱등).
+// 전체 최대 PIN_MAX(3)개 — Firestore 트랜잭션으로 "현재 개수 확인 + 추가"를 원자적으로 처리해
+// 동시에 두 사람이 마지막 슬롯을 두고 경쟁해도 4개가 되는 레이스 컨디션을 막는다.
+exports.pinCommentTest = async (req, res) => {
+  setCors(res);
+  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
+  const t0 = Date.now();
+  try {
+    const { sessionToken, postId, itemId, commentId } = req.body || {};
+    const auth = await authenticateSession(firestore, sessionToken);
+    if (!auth.ok) {
+      const serverMs = Date.now() - t0;
+      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
+      return;
+    }
+    const timings = Object.assign({}, auth.timings);
+    const email = auth.email;
+
+    if (!postId || !commentId) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'MISSING_FIELDS' });
+      return;
+    }
+
+    const u0 = Date.now();
+    const client = await getSheetsClient();
+    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, FEED_BATCH_RANGES, { unformatted: true });
+    timings.sheetMs = Date.now() - u0;
+
+    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
+    const allComments = rowsToComments((valueRanges[3] && valueRanges[3].values) || []);
+    const settings = parseSettings((valueRanges[4] && valueRanges[4].values) || []);
+
+    const viewer = feedEngine.findViewer(allUsers, email);
+    if (!viewer) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
+      return;
+    }
+    if (viewer.role !== '팀장' && viewer.role !== '임원') {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN_NOT_LEAD_OR_EXEC' });
+      return;
+    }
+
+    const leadScope = settings['팀장_열람범위'] || null;
+    const teamByEmail = feedEngine.buildTeamByEmail(allUsers);
+    const visible = feedEngine.visibleCommentsForPost(allComments, postId, viewer.role, viewer.team, leadScope, teamByEmail);
+    const target = visible.find(function (c) { return c.commentId === commentId; });
+    if (!target) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'COMMENT_NOT_FOUND' });
+      return;
+    }
+
+    const docRef = firestore.collection(PINNED_COMMENTS_COLLECTION).doc(commentId);
+    let limitReached = false;
+    let alreadyPinned = false;
+
+    await firestore.runTransaction(async function (tx) {
+      // Firestore는 경합(다른 트랜잭션과의 충돌)이 있으면 이 콜백을 처음부터 다시 호출할 수
+      // 있다. limitReached/alreadyPinned를 콜백 바깥에서 선언해두고 여기서 리셋하지 않으면,
+      // 재시도 전 시도에서 true로 세팅된 값이 이번 시도 결과와 무관하게 그대로 남아 잘못된
+      // 응답(예: 실제로는 이번에 정상 고정됐는데도 이전 시도의 limitReached=true가 남아있는
+      // 경우)을 낼 수 있어 매 시도 시작 시 반드시 초기화한다(재홍님 코드 리뷰 지적 반영).
+      alreadyPinned = false;
+      limitReached = false;
+      const collRef = firestore.collection(PINNED_COMMENTS_COLLECTION);
+      const snap = await tx.get(collRef);
+      const existing = snap.docs.find(function (d) { return d.id === commentId; });
+      if (existing) { alreadyPinned = true; return; } // 멱등: 조용히 성공(기획 확정)
+      if (snap.size >= PIN_MAX) { limitReached = true; return; }
+      tx.set(docRef, {
+        postId: postId,
+        itemId: itemId || null,
+        authorEmail: target.authorEmail,
+        authorName: target.authorName,
+        authorRole: target.authorRole,
+        contentSnapshot: target.content, // 스냅샷 방식(기획 확정) — 이후 댓글 수정과 무관하게 유지
+        pinnedByEmail: viewer.email,
+        pinnedByName: viewer.name,
+        pinnedAt: FieldValue.serverTimestamp()
+      });
+    });
+
+    if (limitReached) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'PIN_LIMIT_REACHED' });
+      return;
+    }
+
+    let pinned = null;
+    if (!alreadyPinned) {
+      const freshSnap = await docRef.get();
+      pinned = pinnedDocToJson_(freshSnap);
+    }
+
+    const serverMs = Date.now() - t0;
+    res.status(200).json({ ok: true, serverMs, timings, alreadyPinned: alreadyPinned, pinned: pinned });
+  } catch (err) {
+    const serverMs = Date.now() - t0;
+    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
+  }
+};
+
+// ---------------------------------------------------------------------------
+// POST /unpinCommentTest — 팀장/임원 누구나(고정한 사람이 아니어도 된다, 기획 확정). 이미
+// 해제됐거나 존재하지 않는 commentId를 다시 해제 요청해도 성공으로 처리(멱등).
+exports.unpinCommentTest = async (req, res) => {
+  setCors(res);
+  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
+  const t0 = Date.now();
+  try {
+    const { sessionToken, commentId } = req.body || {};
+    const auth = await authenticateSession(firestore, sessionToken);
+    if (!auth.ok) {
+      const serverMs = Date.now() - t0;
+      res.status(auth.status).json(authFailureResponseBody_(serverMs, auth));
+      return;
+    }
+    const timings = Object.assign({}, auth.timings);
+    const email = auth.email;
+
+    if (!commentId) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'MISSING_COMMENT_ID' });
+      return;
+    }
+
+    const u0 = Date.now();
+    const client = await getSheetsClient();
+    const valueRanges = await batchGetValues(client, SPREADSHEET_ID, [POLL_USER_RANGE], { unformatted: true });
+    timings.sheetMs = Date.now() - u0;
+    const allUsers = rowsToUsers((valueRanges[0] && valueRanges[0].values) || []);
+
+    const viewer = feedEngine.findViewer(allUsers, email);
+    if (!viewer) {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'USER_NOT_FOUND', email });
+      return;
+    }
+    if (viewer.role !== '팀장' && viewer.role !== '임원') {
+      const serverMs = Date.now() - t0;
+      res.status(200).json({ ok: false, serverMs, timings, error: 'FORBIDDEN_NOT_LEAD_OR_EXEC' });
+      return;
+    }
+
+    await firestore.collection(PINNED_COMMENTS_COLLECTION).doc(commentId).delete();
+
+    const serverMs = Date.now() - t0;
+    res.status(200).json({ ok: true, serverMs, timings, commentId: commentId });
+  } catch (err) {
+    const serverMs = Date.now() - t0;
+    res.status(500).json({ ok: false, serverMs, error: String((err && err.message) || err) });
+  }
+};

```

---

## 2. `feed.html` diff (v3 전체)

```diff
diff --git a/feed.html b/feed.html
index 2505789..dfd4d32 100644
--- a/feed.html
+++ b/feed.html
@@ -158,6 +158,34 @@ font-size: 13px; padding: 2px 4px; display: none;
     0% { box-shadow: 0 0 0 3px var(--accent); }
     100% { box-shadow: none; }
   }
+  /* ===== 댓글 고정(Pin Comment) 신규 기능 CSS — 기존 규칙은 그대로 두고 전부 추가만 함
+     (PIN_COMMENT_CLOUDRUN_DESIGN.md 승인 확정, 2026-09-11) ===== */
+  .comment-item.flash { animation: flash-highlight 1.6s ease; }
+  .pinned-area-box {
+    background: var(--card); border: 1px solid var(--border); border-radius: 14px;
+    padding: 14px 16px; margin-bottom: 16px;
+  }
+  .pinned-area-title { font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; }
+  .pinned-item {
+    display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer;
+    border-top: 1px solid var(--border);
+  }
+  .pinned-item:first-of-type { border-top: none; }
+  .pinned-author { font-size: 12px; font-weight: 700; color: var(--text); flex-shrink: 0; }
+  .pinned-text {
+    font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis;
+    white-space: nowrap; min-width: 0;
+  }
+  .comment-pin-divider {
+    display: inline-block; width: 1px; height: 12px; background: var(--border);
+    margin: 0 2px; vertical-align: middle;
+  }
+  .comment-pin-btn {
+    font-size: 11px; background: none; border: none; cursor: pointer; padding: 4px 0;
+    color: var(--blue);
+  }
+  .comment-pin-btn.pinned { color: var(--accent); font-weight: 700; }
+  .comment-pin-btn[disabled] { opacity: 0.5; cursor: default; }
   .post-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
   .bot-icon {
     width: 34px; height: 34px; border-radius: 50%;
@@ -578,6 +606,7 @@ padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
 
     <div class="main">
       <div id="feed-view">
+        <div id="pinned-area"></div>
         <div id="feed-root">
           <div class="feed-loading" id="feed-loading"><span class="mro-spinner"></span>불러오는 중...</div>
         </div>
@@ -702,6 +731,15 @@ const CLOUD_RUN_REGISTER_PUSH_SUBSCRIPTION_URL = 'https://asia-northeast3-mro-ma
 // 2026-09-07: registerPushSubscriptionTest와 대칭되는 로그아웃용 엔드포인트. 로그아웃 후에도
 // FCM 푸시가 계속 오던 문제(재홍님 발견) 수정 — doLogout()/무활동 로그아웃 경로에서 호출한다.
 const CLOUD_RUN_UNREGISTER_PUSH_SUBSCRIPTION_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/unregisterPushSubscriptionTest';
+// 댓글 고정(Pin Comment) 신규 기능 배선(PIN_COMMENT_CLOUDRUN_DESIGN.md 승인 확정, 2026-09-11) —
+// 기존 Apps Script에 대응하는 액션이 없는 완전 신규 엔드포인트 3개라, callApi()(Apps Script
+// 우선 + Cloud Run 있으면 대체하는 기존 패턴)를 쓰지 않고 이 URL들로 직접 호출한다. 폴백 없음 —
+// 실패하면 고정 기능만 조용히 비활성화되고(#pinned-area가 비어보임) 기존 피드/댓글은 그대로
+// 정상 동작한다. 다른 CLOUD_RUN_*_URL 상수와 동일하게, 빈 문자열로 바꾸면 즉시 이 기능
+// 전체가 꺼지는 롤백 스위치다.
+const CLOUD_RUN_GET_PINNED_COMMENTS_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getPinnedCommentsTest';
+const CLOUD_RUN_PIN_COMMENT_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/pinCommentTest';
+const CLOUD_RUN_UNPIN_COMMENT_URL = 'https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/unpinCommentTest';
 // [주의 — 실제 배포 전 필수 확인] 아래 firebaseConfig/VAPID 값은 전부 자리표시자다. sw.js에
 // 넣어둔 것과 동일한 이유(설계 문서 1-1/1-3절) — Firebase 콘솔에서 이 GCP 프로젝트에 Firebase를
 // 연동한 뒤 실제 값으로 교체해야 하고, 전부 공개값이라 실제 값을 커밋해도 안전하다.
@@ -1190,6 +1228,11 @@ updateNotifPermButton();
 // 분기하므로(default/granted/denied) 여기서는 그냥 호출만 한다. 실패해도(권한 거부, 미지원
 // 브라우저 등) 로그인 자체가 막히지 않도록 await 없이 fire-and-forget으로 둔다.
 if (typeof initPushOnLogin_ === 'function') initPushOnLogin_().catch(function () {});
+// 댓글 고정(Pin Comment) 신규 기능 — 로그인 성공마다 1번, 초기 고정 목록을 불러온다.
+// initPushOnLogin_()과 동일하게 실패해도(백엔드 미배포, 네트워크 오류 등) 로그인 자체가
+// 막히지 않도록 await 없이 fire-and-forget으로 둔다 — #pinned-area가 비어보일 뿐 기존
+// 피드/댓글 로딩에는 전혀 영향이 없다.
+if (typeof loadPinnedComments === 'function') loadPinnedComments().catch(function () {});
 // push 6단계(PUSH_NOTIFICATION_STAGE6_DESIGN.md 3-2절) — 알림 클릭으로 새로 열렸을 때
 // (?view=notif) "알림" 탭으로 전환한다. proceedAfterAuth() 완료 시점(이 줄)에서 처리해서,
 // 세션/화면이 아직 준비 안 된 상태에서 switchView가 호출되는 타이밍 문제를 피한다.
@@ -2011,6 +2054,81 @@ function goToItem(postId, itemId) {
   }, 50);
 }
 
+// 댓글 고정(Pin Comment) 신규 기능 — 고정 영역 클릭 시 해당 댓글까지 이동한다.
+// goToItem()과 동일한 필터 해제/미로딩 게시물 조회 로직을 그대로 따라가되(기존 goToItem을
+// 수정하지 않고 새 함수로 완전히 분리), 스레드가 열려있지 않으면 toggleThread()의 완료를
+// 실제로 기다린 뒤(댓글 목록 fetch가 끝난 뒤) 특정 댓글 엘리먼트로 다시 스크롤+깜빡임한다
+// (goToItem은 fire-and-forget이라 그 완료를 기다릴 수 없어 그대로 재사용하지 않았다).
+function goToComment(postId, itemId, commentId) {
+  switchView('feed');
+  setTimeout(async () => {
+    const key = postId + '-' + itemId;
+
+    let filtersCleared = false;
+    if (feedState.teamFilter) {
+      feedState.teamFilter = '';
+      const teamSelectEl = document.getElementById('team-label');
+      if (teamSelectEl && teamSelectEl.tagName === 'SELECT') teamSelectEl.value = '';
+      filtersCleared = true;
+    }
+    if (feedState.searchQuery) {
+      feedState.searchQuery = '';
+      const searchInputEl = document.getElementById('search-input');
+      if (searchInputEl) searchInputEl.value = '';
+      const clearBtnEl = document.getElementById('search-clear-btn');
+      if (clearBtnEl) clearBtnEl.classList.remove('show');
+      filtersCleared = true;
+    }
+    if (filtersCleared) renderFeed();
+
+    let row = document.getElementById('row-' + key);
+    if (!row) {
+      const existsInFeed = feedState.posts.some(function (p) { return p.id === postId; });
+      if (!existsInFeed) {
+        let res = null;
+        if (CLOUD_RUN_GET_POST_BY_ID_URL) {
+          try {
+            const controller = new AbortController();
+            const timeoutId = setTimeout(function () { controller.abort(); }, 20000);
+            const cloudRes = await fetch(CLOUD_RUN_GET_POST_BY_ID_URL, {
+              method: 'POST',
+              headers: { 'Content-Type': 'application/json' },
+              body: JSON.stringify({ sessionToken: session ? session.sessionToken : null, postId: postId }),
+              signal: controller.signal
+            }).then(function (r) { return r.json(); });
+            clearTimeout(timeoutId);
+            const trustedFailure = cloudRes && (cloudRes.error === 'NOT_FOUND' || cloudRes.error === 'FORBIDDEN' || cloudRes.error === 'MISSING_POST_ID');
+            if (cloudRes && (cloudRes.ok === true || trustedFailure)) res = cloudRes;
+          } catch (e) {}
+        }
+        if (!res) {
+          try { res = await callApi('getPostById', { postId: postId }); } catch (e) { res = null; }
+        }
+        if (res && res.ok && res.post) {
+          feedState.posts.unshift(res.post);
+          renderFeed();
+        } else {
+          return;
+        }
+      }
+      row = document.getElementById('row-' + key);
+      if (!row) return;
+    }
+
+    const st = threadState[key] || (threadState[key] = { open: false, replyOpenFor: null });
+    if (!st.open) {
+      await toggleThread(postId, itemId);
+    } else if (session.role !== '담당') {
+      markThreadSeenLocal(postId, itemId);
+    }
+
+    const el = document.getElementById('comment-' + commentId) || row;
+    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
+    el.classList.add('flash');
+    setTimeout(() => el.classList.remove('flash'), 1600);
+  }, 50);
+}
+
 function renderPost(post) {
 const items = post.items || [];
 const itemsHtml = items.map(item => renderItemRow(post, item)).join('');
@@ -2242,6 +2360,11 @@ function canStartFirstComment(item) {
 function canReply() {
   return session && (session.role === '담당' || session.role === '팀장' || session.role === '임원');
 }
+// 댓글 고정(Pin Comment) 신규 기능 — 고정/해제 권한은 팀장·임원(최대 3개 전역 공유 한도).
+// 본인 댓글 여부와 무관하게 동일하게 적용된다(설계 문서 확정 사항).
+function canPin() {
+  return !!(session && (session.role === '팀장' || session.role === '임원'));
+}
 function roleClass(role) {
   if (role === '담당') return 'role-담당';
   if (role === '팀장') return 'role-팀장';
@@ -2290,8 +2413,15 @@ function renderThread(postId, itemId) {
     const deleteBtn = isMine
       ? `<button class="comment-delete-btn" onclick="deleteCommentConfirm('${postId}', '${itemId}', '${c.commentId}')">삭제</button>`
       : '';
+    // 댓글 고정(Pin Comment) 신규 기능 — 답장/수정/삭제와 구분되는 별도 권한(팀장·임원)이라
+    // 얇은 구분선 뒤에 붙인다(목업 확정 레이아웃과 동일). 본인 댓글 여부와 무관하게 노출된다.
+    const pinned = (typeof isPinned_ === 'function') && isPinned_(c.commentId);
+    const pinPending = (typeof pinningInFlight !== 'undefined') && pinningInFlight.has(c.commentId);
+    const pinBtn = ((c.pending || c.deleting) || !canPin())
+      ? ''
+      : `<span class="comment-pin-divider"></span><button class="comment-pin-btn${pinned ? ' pinned' : ''}"${pinPending ? ' disabled' : ''} onclick="${pinned ? 'unpinComment' : 'pinComment'}('${postId}', '${itemId}', '${c.commentId}')">${pinPending ? '처리 중...' : (pinned ? '고정됨' : '고정')}</button>`;
     return `
-      <div class="comment-item${c.pending ? ' pending' : ''}${c.deleting ? ' pending' : ''}" style="margin-left:${depth * 24}px;">
+      <div class="comment-item${c.pending ? ' pending' : ''}${c.deleting ? ' pending' : ''}" id="comment-${c.commentId}" style="margin-left:${depth * 24}px;">
         <div class="avatar ${roleClass(c.authorRole)}">${escapeHtml(initials(c.authorName))}</div>
         <div class="comment-body">
           ${parent ? `<div class="reply-to">↳ ${escapeHtml(parent.authorName)} ${escapeHtml(parent.authorRole || '')}에게 답장</div>` : ''}
@@ -2299,7 +2429,7 @@ function renderThread(postId, itemId) {
             <span class="role">${escapeHtml(c.authorRole || '')}</span>${!parent ? `<span class="role">· 최초 댓글</span>` : ''}<span class="time">· ${c.pending ? '전송 중...' : (c.deleting ? '삭제 중...' : escapeHtml(fmtTime(c.createdAt)))}</span>
           </div>
           <div class="comment-text" id="text-${c.commentId}">${escapeHtml(c.content)}</div>
-          ${(c.pending || c.deleting) ? '' : `<div class="comment-actions">${replyBtn}${editBtn}${deleteBtn}</div>`}
+          ${(c.pending || c.deleting) ? '' : `<div class="comment-actions">${replyBtn}${editBtn}${deleteBtn}${pinBtn}</div>`}
           <div id="composer-${key}-${c.commentId}"></div>
         </div>
       </div>
@@ -3625,6 +3755,163 @@ async function getUsersRemote_() {
   return res;
 }
 
+// ==== 댓글 고정(Pin Comment) — 신규 기능, 기존 댓글/피드 로직과 완전히 분리된 블록
+// (PIN_COMMENT_CLOUDRUN_DESIGN.md 승인 확정, 2026-09-11). 팀장/임원이 중요 댓글을 최대
+// 3개까지(역할별이 아닌 전역 공유 한도) 고정할 수 있다. 신규 Firestore 컬렉션
+// (pinnedComments)만 쓰고 기존 시트/컬렉션은 읽기만 하므로 기존 기능에 영향이 없다.
+// getComments/getItems 등과 달리 Apps Script 대응 액션이 없으므로 폴백 없이 Cloud Run
+// 직접 호출만 하며, 실패 시 #pinned-area만 조용히 비워지고 기존 피드/댓글은 그대로 동작한다.
+let pinnedState = { items: [], loaded: false };
+const pinningInFlight = new Set();
+
+async function getPinnedCommentsRemote_() {
+  if (!CLOUD_RUN_GET_PINNED_COMMENTS_URL) return null;
+  try {
+    const controller = new AbortController();
+    const timeoutId = setTimeout(function () { controller.abort(); }, 20000);
+    const cloudRes = await fetch(CLOUD_RUN_GET_PINNED_COMMENTS_URL, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ sessionToken: session ? session.sessionToken : null }),
+      signal: controller.signal
+    }).then(function (r) { return r.json(); });
+    clearTimeout(timeoutId);
+    if (cloudRes && cloudRes.ok === true) return cloudRes;
+  } catch (e) {}
+  return null;
+}
+
+async function pinCommentRemote_(postId, itemId, commentId) {
+  if (!CLOUD_RUN_PIN_COMMENT_URL) return { ok: false, error: 'FEATURE_DISABLED' };
+  try {
+    const controller = new AbortController();
+    const timeoutId = setTimeout(function () { controller.abort(); }, 20000);
+    const res = await fetch(CLOUD_RUN_PIN_COMMENT_URL, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ sessionToken: session ? session.sessionToken : null, postId: postId, itemId: itemId, commentId: commentId }),
+      signal: controller.signal
+    }).then(function (r) { return r.json(); });
+    clearTimeout(timeoutId);
+    return res || { ok: false, error: 'NETWORK_ERROR' };
+  } catch (e) {
+    return { ok: false, error: 'NETWORK_ERROR' };
+  }
+}
+
+async function unpinCommentRemote_(commentId) {
+  if (!CLOUD_RUN_UNPIN_COMMENT_URL) return { ok: false, error: 'FEATURE_DISABLED' };
+  try {
+    const controller = new AbortController();
+    const timeoutId = setTimeout(function () { controller.abort(); }, 20000);
+    const res = await fetch(CLOUD_RUN_UNPIN_COMMENT_URL, {
+      method: 'POST',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ sessionToken: session ? session.sessionToken : null, commentId: commentId }),
+      signal: controller.signal
+    }).then(function (r) { return r.json(); });
+    clearTimeout(timeoutId);
+    return res || { ok: false, error: 'NETWORK_ERROR' };
+  } catch (e) {
+    return { ok: false, error: 'NETWORK_ERROR' };
+  }
+}
+
+// pin/unpin 실패 사유를 사람이 읽을 수 있는 문구로 변환한다(재홍님 코드 리뷰 지적 반영 —
+// 이전에는 PIN_LIMIT_REACHED 외의 실패(권한 없음, 댓글 삭제됨, 네트워크 오류 등)가 아무
+// 피드백 없이 조용히 무시됐다).
+function pinErrorMessage_(error) {
+  const map = {
+    'PIN_LIMIT_REACHED': '고정은 최대 3개까지만 가능합니다. 다른 댓글을 먼저 해제한 뒤 다시 시도해주세요.',
+    'FORBIDDEN_NOT_LEAD_OR_EXEC': '팀장/임원만 고정할 수 있어요.',
+    'COMMENT_NOT_FOUND': '댓글을 찾을 수 없어요.',
+    'MISSING_FIELDS': '필수 정보가 누락됐어요.',
+    'MISSING_COMMENT_ID': '댓글 정보가 누락됐어요.',
+    'USER_NOT_FOUND': '사용자 정보를 찾을 수 없어요.',
+    'FEATURE_DISABLED': '이 기능은 현재 사용할 수 없어요.',
+    'NETWORK_ERROR': '네트워크 오류가 발생했어요.'
+  };
+  return map[error] || ('고정 처리 실패: ' + error);
+}
+
+function isPinned_(commentId) {
+  return pinnedState.items.some(function (p) { return p.commentId === commentId; });
+}
+
+async function loadPinnedComments() {
+  try {
+    const res = await getPinnedCommentsRemote_();
+    pinnedState.items = (res && res.ok && Array.isArray(res.pinnedComments)) ? res.pinnedComments : [];
+  } catch (e) {
+    pinnedState.items = [];
+  }
+  pinnedState.loaded = true;
+  renderPinnedArea();
+}
+
+function renderPinnedArea() {
+  const root = document.getElementById('pinned-area');
+  if (!root) return;
+  try {
+    if (!pinnedState.items.length) { root.innerHTML = ''; return; }
+    root.innerHTML = `
+      <div class="pinned-area-box">
+        <div class="pinned-area-title">📌 고정된 댓글</div>
+        ${pinnedState.items.map(function (p) {
+          return `
+            <div class="pinned-item" onclick="goToComment('${p.postId}', '${p.itemId || ''}', '${p.commentId}')">
+              <span class="pinned-author">${escapeHtml(p.authorName || '')} ${escapeHtml(p.authorRole || '')}</span>
+              <span class="pinned-text">${escapeHtml(truncate(p.contentSnapshot || '', 40))}</span>
+            </div>
+          `;
+        }).join('')}
+      </div>
+    `;
+  } catch (e) {
+    // 고정 영역 렌더링 실패는 이 영역만 비우고 기존 피드/댓글에는 영향을 주지 않는다.
+    root.innerHTML = '';
+  }
+}
+
+async function pinComment(postId, itemId, commentId) {
+  if (!canPin() || pinningInFlight.has(commentId)) return;
+  pinningInFlight.add(commentId);
+  renderThread(postId, itemId);
+  try {
+    const res = await pinCommentRemote_(postId, itemId, commentId);
+    if (res && res.ok) {
+      await loadPinnedComments();
+    } else if (res && res.error) {
+      // PIN_LIMIT_REACHED뿐 아니라 모든 실패 사유에 대해 피드백을 준다(재홍님 코드 리뷰 지적 반영).
+      alert(pinErrorMessage_(res.error));
+    }
+  } catch (e) {
+    alert('네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
+  } finally {
+    pinningInFlight.delete(commentId);
+    renderThread(postId, itemId);
+  }
+}
+
+async function unpinComment(postId, itemId, commentId) {
+  if (!canPin() || pinningInFlight.has(commentId)) return;
+  pinningInFlight.add(commentId);
+  renderThread(postId, itemId);
+  try {
+    const res = await unpinCommentRemote_(commentId);
+    if (res && res.ok) {
+      await loadPinnedComments();
+    } else if (res && res.error) {
+      alert(pinErrorMessage_(res.error));
+    }
+  } catch (e) {
+    alert('네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.');
+  } finally {
+    pinningInFlight.delete(commentId);
+    renderThread(postId, itemId);
+  }
+}
+
 async function loadItems(isRetry) {
 const root = document.getElementById('items-view');
 // 이미 한번 불러온 적이 있으면(=백그라운드 복귀 등으로 인한 조용한 갱신) 화면을 비우지 않고

```

---

## 3. 테스트 시나리오 (설계 문서 §5 재사용)

| # | 시나리오 | 확인 방법 |
|---|---|---|
| 1 | 팀장/임원이 고정 → 목록에 반영 | 합성 데이터, 정상 흐름 |
| 2 | 담당/일반이 고정 시도 → FORBIDDEN, alert로 "팀장/임원만 고정할 수 있어요." 표시 | 합성 데이터 |
| 3 | 이미 3개 고정된 상태에서 4번째 고정 시도 → PIN_LIMIT_REACHED, alert로 3개 한도 안내 | 합성 데이터 |
| 4 | 동시에 2명이 3번째 슬롯을 두고 고정 시도(레이스) → 한쪽만 성공 | Firestore 트랜잭션 검증 |
| 5 | 팀 스코프상 안 보이는 댓글이 고정된 상태에서, 그 팀이 아닌 팀장이 조회 → 응답에서 제외 | 합성 데이터, `visibleCommentsForPost` 재검증 확인 |
| 6 | 고정된 댓글의 원본이 나중에 삭제됨 → 조회 시 자동 제외(+ 자가정리) | 합성 데이터 |
| 7 | 임원이 고정, 팀장이 해제(다른 사람이 고정한 것 해제) → 정상 | 합성 데이터, "해제는 누구나" 규칙 확인 |
| 8 | `CLOUD_RUN_PIN_COMMENT_URL`을 빈 값으로 설정 → 고정 버튼 자체가 안 뜨거나 눌러도 아무 일 없음, 나머지 피드/댓글은 100% 정상 | 수동 확인(스모크 테스트) |
| 9 | 신규 API 3개가 전부 500 에러를 내도 피드 로딩 자체는 영향 없음 | 수동 확인 |
| 10 (신규) | 네트워크 끊긴 상태에서 고정/해제 시도 → "네트워크 오류가 발생했어요." alert 표시, 기존 상태 유지 | 수동 확인(개발자 도구로 오프라인 시뮬레이션) |
| 11 (신규) | 알림/품목/사용자/설정 탭 이동 → `#pinned-area`가 안 보이는지 | 수동 확인 |

`node -c cloud-run/mro-functions/index.js`, `node --check`(feed.html 인라인 스크립트 추출) 모두 통과했습니다.

---

## 다음 단계 (승인 시)

1. 로컬 커밋 (이 세션의 git push는 프록시에서 막혀 있어, 승인 시 파일을 보내드리고 GitHub 업로드 → `git pull` 안내를 드리겠습니다)
2. `gcloud functions deploy`로 3개 함수 배포
3. 결정사항 5번에 따라 테스트용 게시물/댓글(`🧪 [테스트] 댓글 고정 기능 테스트용`) 생성 후 스모크 테스트
4. 문제 없으면 feed.html 실제 반영, 테스트용 게시물/댓글 삭제
