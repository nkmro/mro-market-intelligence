# markThreadSeen Cloud Run 이전 — 0단계+1단계 설계 확정 문서

작성일: 2026-08-20
승인 범위: **0단계(Firestore writeIdempotency 스키마 확정) + 1단계(markThreadSeenTest 구현 준비 설계)만.**
상태: **설계 문서 — 코드 작성/GitHub 커밋/Cloud Run 배포/Apps Script 배포 전혀 하지 않음.** 실제 구현은 이 설계에 대한 별도 승인 후 진행합니다.
보류(이번 범위 아님): postComment 이전, `Code.gs` idempotencyKey 컬럼 추가, 쓰기 전용 서비스 계정 분리.

---

## 0단계: Firestore `writeIdempotency` 컬렉션 스키마 + TTL 확정

이전 검토(`WRITE_API_MIGRATION_PREP_REVIEW.md` 1-4)에서 제안한 스키마를 그대로 확정합니다.

```
컬렉션: writeIdempotency
문서 ID: idempotencyKey (feed.html의 generateIdempotencyKey_()가 만든 UUID, 그대로 사용)

필드:
  action:     string   — 'markThreadSeen' (나중에 postComment 등이 추가되면 값만 늘어남, 컬렉션은 공유)
  status:     string   — 'IN_PROGRESS' | 'DONE'
  response:   map      — status가 'DONE'일 때만 존재. 그대로 재반환할 JSON (예: {ok:true})
  createdAt:  Timestamp
  expiresAt:  Timestamp — createdAt + 6시간 (Apps Script CacheService TTL 21600초와 동일하게 맞춤)
```

**TTL 설정(인프라 설정, 코드 아님 — 실제 구현 승인 시 1회 실행)**:

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=writeIdempotency \
  --enable-ttl \
  --project=mro-market-intelligence
```

이 명령은 Firestore 콘솔에서도 동일하게 설정 가능합니다(데이터베이스 → 색인 → TTL). 이 정책이 걸리면 `expiresAt`이 지난 문서는 Firestore가 자동으로 삭제해줘서, Apps Script `CacheService`의 자동 만료와 같은 효과를 별도 정리 배치 없이 얻습니다. **이 명령은 이번 승인 범위(설계)에는 포함되지 않고, 실제 구현 승인 시 최초 1회만 실행하면 됩니다.**

**컬렉션을 공유로 설계한 이유**: `action` 필드로 구분해두면, 나중에 postComment(2단계, 아직 미승인)를 옮길 때도 같은 컬렉션/같은 트랜잭션 로직을 재사용할 수 있습니다. 지금 markThreadSeen만 쓰더라도 컬렉션 이름을 `markThreadSeenIdempotency`처럼 좁게 잡지 않은 이유입니다.

---

## 1단계: `markThreadSeenTest` Cloud Run 구현 준비 설계

### 1-1. 함수 시그니처(제안)

- entry point 이름: `markThreadSeenTest` (기존 `getThreadSeenTest`와 짝이 되도록 명명 규칙 통일)
- 요청: `POST { sessionToken, postId, itemId, idempotencyKey }`
- 응답: `{ ok: true }` 또는 `{ ok: false, error: '<코드>' }` — `handleMarkThreadSeen_`(Code.gs 3399행)과 정확히 동일한 모양을 유지합니다. (참고: `feed.html`의 `markThreadSeenLocal()`은 이 응답을 fire-and-forget으로 버리므로(`.catch(function(){})`만 있고 `.then` 없음) 프론트 화면에는 응답 모양이 영향을 주지 않지만, 콘솔 로그(`source=cloud-run/apps-script`)와 향후 디버깅을 위해 Apps Script와 모양을 맞춰둡니다.)

### 1-2. 세션 인증 — 재사용 방식 결정 필요(구현 시 선택)

두 가지 기존 패턴이 저장소에 공존합니다.

- **A. 인라인 방식**: 형제 함수인 `getThreadSeenTest`(index.js 703~752행)가 쓰는, Firestore `sessions` 조회를 직접 인라인으로 작성하는 방식.
- **B. `lib/auth.js` 재사용**: `getFeedTest`/`getNotificationsTest`/`getPostByIdTest`/리팩터링된 `pollSignalTest`가 쓰는 공용 `authenticateSession(firestore, sessionToken)` 함수.

`lib/auth.js` 주석에 "이 모듈은 이번(2단계)에 새로 만드는 함수와, 리팩터링 대상만 쓰고, 기존 잘 동작하는 함수는 건드리지 않는다"는 원칙이 적혀 있습니다. `markThreadSeenTest`는 완전히 새로 만드는 함수이므로 **B(lib/auth.js 재사용)를 권장**합니다 — 형제 함수(`getThreadSeenTest`)와 스타일이 달라지긴 하지만, 신규 함수는 최신 공용 모듈을 쓰는 쪽이 중복을 늘리지 않습니다. 다만 이건 실제 구현 시 다시 한번 확인받겠습니다(취향 차이 수준의 결정이라 지금 확정하지 않아도 무방).

### 1-3. idempotency 처리 흐름 (Firestore 트랜잭션, 의사코드)

```js
async function withIdempotency(firestore, idempotencyKey, actionFn) {
  if (!idempotencyKey) return actionFn(); // Code.gs withIdempotency_와 동일한 예외 처리

  const docRef = firestore.collection('writeIdempotency').doc(idempotencyKey);

  // 1) 트랜잭션으로 "선점" 시도
  const claim = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      tx.set(docRef, {
        action: 'markThreadSeen',
        status: 'IN_PROGRESS',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 6 * 3600 * 1000)
      });
      return { claimed: true };
    }
    const data = snap.data();
    if (data.status === 'DONE') return { claimed: false, response: data.response };
    return { claimed: false, inProgress: true };
  });

  if (!claim.claimed) {
    if (claim.response) return claim.response;               // 이미 끝난 요청 → 캐시된 응답 그대로
    // IN_PROGRESS: Code.gs와 동일하게 짧게 몇 번 재확인 후 포기
    for (let i = 0; i < 4; i++) {
      await sleep(500);
      const polled = await docRef.get();
      if (polled.exists && polled.data().status === 'DONE') return polled.data().response;
    }
    return { ok: false, error: 'DUPLICATE_IN_PROGRESS_RETRY_LATER' };
  }

  // 2) 선점 성공 → 실제 작업 수행
  try {
    const result = await actionFn();
    await docRef.update({ status: 'DONE', response: result });
    return result;
  } catch (err) {
    await docRef.delete(); // Code.gs가 실패 시 cache.remove()로 재시도 가능하게 하는 것과 동일
    throw err;
  }
}
```

이 흐름은 `Code.gs`의 `withIdempotency_`(626~677행)와 한 글자도 다르지 않은 정책(선점 → 완료 시 캐시된 응답 반환 → 진행 중이면 짧게 폴링 후 포기 → 실패 시 예약 취소)을 그대로 재현합니다. 차이는 저장소(Firestore 트랜잭션 vs CacheService+LockService)뿐입니다.

### 1-4. 실제 시트 upsert (Firestore 트랜잭션 밖에서 수행)

Sheets API는 트랜잭션이 없으므로, 위 `actionFn()` 안에서 `handleMarkThreadSeen_`과 동일한 절차를 수행합니다.

1. `values.get`(`댓글확인이력!A2:D`)로 전체 행을 읽음.
2. `(email, postId, itemId)`가 일치하는 행이 있으면 그 행의 D열만 `values.update`로 현재 시각(ISO 문자열)으로 갱신.
3. 없으면 `values.append`로 `[email, postId, itemId, nowIso]` 새 행 추가.
4. 이메일 비교는 기존과 동일하게 소문자 정규화(`toLowerCase()`) 후 비교.

이 부분은 위 검토 문서(2-3)에서 설명한 대로, idempotencyKey dedup이 "같은 요청의 재실행"을 막아주고, upsert라는 데이터 구조 자체가 "다른 두 요청(예: Cloud Run 성공 + Apps Script 폴백 실행)이 겹쳐도 결과가 수렴"하게 해주므로, `LockService`가 하던 것과 같은 수준의 락을 Firestore로 다시 구현하지는 않습니다(이전 검토 2-3에서 승인받은 실용적 접근).

### 1-5. 에러 코드 매핑 (Apps Script와 동일하게 유지)

| 상황 | 응답 |
|---|---|
| `sessionToken` 없음 | `{ok:false, error:'MISSING_SESSION_TOKEN'}` |
| 세션 없음 | `{ok:false, error:'SESSION_NOT_FOUND'}` |
| 세션 만료 | `{ok:false, error:'SESSION_EXPIRED'}` |
| `postId`/`itemId` 없음 | `{ok:false, error:'MISSING_FIELDS'}` |
| 같은 키가 처리 중 | `{ok:false, error:'DUPLICATE_IN_PROGRESS_RETRY_LATER'}` |
| 정상 | `{ok:true}` |

### 1-6. 쓰기 권한 (구현 전 선행 조건)

- 이 함수만 `GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] })`(읽기+쓰기)를 쓰고, 다른 기존 함수(읽기 전용 8개)는 지금처럼 `spreadsheets.readonly`를 그대로 유지합니다(이전 검토 3-3의 최소 권한 원칙, 승인된 방향).
- **선행 조건**: Cloud Run 실행 서비스 계정이 대상 스프레드시트에 편집자로 공유돼 있어야 합니다 — 아래 "추가 확인 필요" 항목 참고.

### 1-7. 프론트엔드 배선 설계(이번엔 구현하지 않음, 설계만)

- 상수 제안: `CLOUD_RUN_MARKTHREADSEEN_URL` — 기존 `CLOUD_RUN_GET_THREADSEEN_URL` 옆에 추가.
- `markThreadSeenLocal()`(feed.html 2310~2315행)을 아래처럼 바꾸는 것을 제안(**설계만, 이번엔 수정하지 않음**):
  1. `idempotencyKey`를 로컬에서 미리 생성(재시도/폴백 전체에서 재사용).
  2. Cloud Run URL이 있으면 먼저 시도 → `ok:true`만 성공으로 인정 → 실패/타임아웃/예외면 기존 `callApi('markThreadSeen', {postId, itemId})` 경로로 폴백(이때도 같은 `idempotencyKey`를 실어 보내, Apps Script의 `withIdempotency_`가 우연히 같은 키의 요청이 반복돼도 대응할 수 있게 함 — 다만 두 백엔드의 idempotency 저장소가 분리돼 있다는 한계는 이전 검토에서 설명한 그대로 남아 있고, markThreadSeen은 upsert라 이 한계가 실질적 위험으로 이어지지 않는다는 결론을 그대로 따릅니다).
  3. `console.log('[markThreadSeen] source=cloud-run|apps-script ...')` 로그 추가(기존 컨벤션).

### 1-8. Parity 테스트 계획 (구현 승인 후 1단계, 실 데이터 변경 없이)

`POLLSIGNAL_CLOUDRUN_TEST_PLAN.md` 방식을 재사용합니다. 시나리오 제안:

1. 신규 행 생성 — 해당 `(email,postId,itemId)` 조합이 시트에 없는 경우 → 새 행이 정확한 4개 컬럼 값으로 추가되는지.
2. 기존 행 갱신 — 이미 있는 조합 → D열(확인시각)만 갱신되고 다른 행에는 영향 없는지.
3. 이메일 대소문자 혼용 — 시트에는 소문자, 요청은 대문자 이메일(또는 반대) → 정확히 매칭되는지.
4. 동일 `idempotencyKey`로 2번 연속 호출 — 실제로 시트에 한 번만 반영되고, 두 번째 호출은 캐시된 `{ok:true}`를 즉시 반환하는지(Firestore 문서 상태로 확인).
5. `IN_PROGRESS` 상태에서 같은 키로 재호출(동시 요청 흉내) → 짧은 폴링 후 정상 완료 응답을 받는지, 혹은 `DUPLICATE_IN_PROGRESS_RETRY_LATER`가 적절히 반환되는지.
6. `sessionToken` 누락/만료, `postId`/`itemId` 누락 — 에러 코드가 표와 정확히 일치하는지.
7. (2단계 통합 테스트, 별도 승인 필요) 실제 소수 계정으로 Cloud Run 엔드포인트까지 end-to-end 확인 후에만 `feed.html` 배선.

---

## 추가 확인 필요: 스프레드시트 편집자 공유 여부

제가 직접 GCP 콘솔이나 Google Sheets의 공유 설정에 로그인해서 확인할 방법은 없습니다(재홍님 계정 권한이 필요한 화면입니다). 대신 확인하는 방법을 안내드립니다.

1. GCP 콘솔 → Cloud Functions(또는 Cloud Run) → 이미 배포된 함수 하나(예: `getThreadSeenTest`)를 클릭 → "세부정보" 또는 "구성" 탭에서 **"런타임 서비스 계정"** 항목을 확인합니다. `...@mro-market-intelligence.iam.gserviceaccount.com` 또는 `...-compute@developer.gserviceaccount.com` 형태의 이메일입니다.
2. 실제 시황 데이터가 들어있는 Google Sheets 문서를 열고 우측 상단 "공유" 버튼 클릭 → 위에서 확인한 서비스 계정 이메일이 목록에 있는지, 있다면 권한이 "뷰어"인지 "편집자"인지 확인합니다.
3. 편집자가 아니라면(뷰어이거나 목록에 없다면), 실제 구현 승인 시점에 편집자로 추가해주셔야 `markThreadSeenTest`가 시트에 쓸 수 있습니다.

만약 지금 브라우저에 GCP/Google 계정으로 로그인돼 있는 탭이 있고, 제가 화면을 대신 확인해봐도 괜찮으시면 말씀해주세요 — 조회만 하는 작업이라 진행은 가능하지만, 계정 설정 화면이라 먼저 여쭤보고 진행하겠습니다.

---

## 요약

- 0단계(Firestore 스키마+TTL)와 1단계(markThreadSeenTest 설계)를 위와 같이 확정 제안합니다.
- **이 문서 자체는 설계일 뿐이며, 실제 `index.js`/`feed.html` 코드 작성, GitHub 커밋, Cloud Run/Apps Script 배포는 전혀 하지 않았습니다.**
- 이 설계에 동의하시면 다음 요청 시 실제 구현(코드 작성)에 들어가겠습니다 — 그 이후에도 커밋/배포는 각각 별도로 승인받습니다.
- 스프레드시트 편집자 공유 여부는 위 안내대로 직접 확인해 알려주시거나, 제가 화면을 봐도 되는지 알려주세요.
