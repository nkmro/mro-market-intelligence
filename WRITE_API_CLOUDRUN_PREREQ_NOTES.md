# 쓰기 API(postComment, markThreadSeen) Cloud Run 이전 전 검토 노트

작성일: 2026-08-20
상태: 검토/기록용 메모 (실제 postComment/markThreadSeen 이전 구현은 아직 시작 안 함 — 보존 커밋)

이 문서는 지금 당장 구현하려는 것이 아니라, getFeed/getNotifications/getComments 같은
읽기 API 전환을 진행하면서 앞으로 postComment/markThreadSeen 같은 쓰기 작업을 Cloud Run으로
옮길 때 반드시 짚어야 할 조건들을 실제 `apps-script/Code.gs` 코드를 근거로 미리 기록해두는
용도다.

## 1. 시트 쓰기 권한

Apps Script는 실행자(웹앱을 배포한 계정)의 권한으로 `SpreadsheetApp`을 통해 시트에 직접
쓴다 — 별도 인증/권한 설정이 필요 없다.

Cloud Run으로 쓰기를 옮기면 서비스 계정이 Sheets API(`sheets.spreadsheets.values.append` 등)로
써야 하므로, 그 서비스 계정에 대상 스프레드시트의 **편집자 권한**을 별도로 공유해줘야 한다.
현재 읽기 전용 3개 API(`getFeedTest`/`getNotificationsTest`/`getPostByIdTest`)는 `sheetsClient.js`가
`batchGet`(읽기)만 쓰므로 뷰어 권한으로 충분했는데, 쓰기로 넘어가는 순간 이 권한 범위를 넓혀야
한다는 점을 미리 인지해둘 필요가 있다.

## 2. 중복 방지 (postComment는 현재 dedup 장치가 없음)

`handlePostComment_`(Code.gs 2269행) → `appendComment_`(2180행)를 실제로 확인한 결과:

```js
function appendComment_(row) {
  const sheet = getSheetObj_(SHEET_COMMENT);
  sheet.appendRow(row);
  invalidateSheetCache_(SHEET_COMMENT);
}
```

- `commentId`는 매 호출마다 `Utilities.getUuid()`로 새로 생성되고, 같은 요청이 두 번 들어와도
  이를 걸러낼 멱등성 키나 dedup 체크가 전혀 없다.
- 지금은 Apps Script 단일 호출 경로라 실질적으로 문제가 거의 없었지만, Cloud Run으로 옮기면
  `feed.html`의 기존 hedge/retry 패턴(`API_HEDGE_DELAY_MS`, `API_ROUND_BACKOFF_MS`)이 쓰기에도
  실수로 적용되거나, 네트워크 재시도·이중 클릭이 발생하면 **댓글이 중복 저장될 위험**이 있다.
- 참고로 `feed.html`의 `IDEMPOTENT_WRITE_ACTIONS`(565행)는 "재시도해도 안전한 쓰기"만 재시도
  대상으로 구분해두는 기존 장치인데, `postComment`는 이 목록에 들어가려면 서버 쪽에 먼저
  멱등성 키(예: 클라이언트가 생성한 `clientRequestId`를 같은 시트나 별도 컬럼에 기록해 중복 체크)가
  갖춰져야 한다는 뜻이다. → **선행 조건**: `postComment` Cloud Run 버전을 만들기 전에 dedup 키
  설계부터 먼저 결정해야 함.

## 3. 동시성 제어

- `handleMarkThreadSeen_`(3399행)는 `LockService.getScriptLock()`으로 잠그고, 기존 행이 있으면
  update, 없으면 append하는 **upsert 패턴**이라 이미 자연스럽게 멱등적이다. 다만 이 락은 "이
  Apps Script 프로젝트 전체에 대한 단일 락"이라서 Cloud Run 인스턴스가 여러 개 동시에 뜨면
  똑같은 보장이 없다 — Cloud Run에서는 이 역할을 대신할 무언가(예: Firestore 트랜잭션으로 같은
  키를 잠그거나, Sheets 쪽에서 낙관적 동시성 재시도)가 필요하다.
- `appendComment_`는 반대로 락이 전혀 없다 — 순수 append이기 때문에 Apps Script 안에서도
  동시 실행 시 데이터가 깨지진 않지만(각 호출이 한 행씩 추가), 이 역시 위 2번의 dedup 문제와는
  별개로 "여러 Cloud Run 인스턴스가 동시에 같은 시트에 append"하는 상황 자체는 Sheets API append
  호출 자체가 원자적이라 데이터 손상 위험은 낮다. 진짜 위험은 락이 아니라 dedup(2번) 쪽이다.
- 결론: `markThreadSeen`은 "동시성 제어(락)"가 핵심 선행조건, `postComment`는 "중복 방지(dedup
  키)"가 핵심 선행조건 — 두 API가 필요로 하는 안전장치의 성격이 다르다.

## 다음에 결정해야 할 것 (지금 결정하지 않음)

- `postComment` dedup 키를 어디에 둘지 (시트에 컬럼 추가 vs Firestore에 별도 기록)
- `markThreadSeen`의 락을 Cloud Run에서 무엇으로 대체할지 (Firestore 트랜잭션 vs Sheets API
  낙관적 재시도)
- 이 두 쓰기 API를 Cloud Run으로 옮기는 시점 자체는 getFeed(승인 B)/getNotifications(승인 C)/
  getComments 읽기 전환이 다 끝난 뒤로 미룸 — 이번 라운드에서는 구현하지 않음.
