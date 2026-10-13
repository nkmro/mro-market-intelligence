# AI 원자재 추천 Cloud Run 이전 설계서 v2 (최종본) — (a)안: 감지만 Apps Script, 처리는 Cloud Run

- 작성일: 2026-10-12 (v1 → v2: 재홍님 결정 5건 + 검토 지적 3건 반영)
- 기준 코드: GitHub `nkmro/mro-market-intelligence` 커밋 `637c5e1` (Code.gs는 편집기의 미러 사본)
- 상태: 설계 확정본(2026-10-12 재홍님 승인). 실제 구현은 단계별 승인을 받아 진행한다.
- 진행: **단계 0 완료(2026-10-12, 부록 B) · 단계 1 완료(2026-10-13, 부록 C)** · 단계 2 대기
- 목적: 이 문서만 읽고 다음 작업자(사람/AI)가 단계 0부터 시작할 수 있게 한다.

### 표기 규칙
- **[확인]** = 코드 또는 실행 기록으로 직접 확인한 사실 (근거 위치 병기)
- **[추정]** = 확인하지 못한 판단. 배포 전에 검증한다
- **[확정]** = 재홍님이 결정한 사항 (2026-10-12)
- **[미확인]** = 아직 아무도 확인하지 않은 사실. 단계 0 또는 해당 단계에서 확인한다

---

## 0. 프로젝트 기본 맥락 (처음 보는 작업자용)

| 항목 | 값 |
|---|---|
| 서비스 | MRO 자재 시황 관리 시스템. AI가 원자재 시황 뉴스를 수집·게시하고, 품목별로 담당자가 댓글을 다는 사내 앱 |
| 사용자/관리자 | 재홍님(동부 팀장, 관리자, **비개발자**). 작업 지시와 승인, 인증 클릭, 비밀값 입력만 하고, 나머지(코드·GitHub 업로드·배포·시험)는 AI가 브라우저 조작으로 수행 |
| 화면 | GitHub Pages: `index.html`(로그인), `feed.html`(앱 본체). 저장소 최상위 파일을 GitHub에 커밋하면 약 1분 뒤 반영 |
| 백엔드 1 | Google Apps Script `apps-script/Code.gs`(웹앱, 현재 **배포 버전 88**). 프로젝트 ID `1abBaoRibDm8UCe4C_inwRatU7clqoL5_JpV71Rq2D-2cmeprNyn9gvYe`. 트리거는 **Head**(최신 저장본)로 실행 [확인: 실행 기록 화면] |
| 백엔드 2 | Cloud Run(Cloud Functions gen2), GCP 프로젝트 `mro-market-intelligence`, 리전 `asia-northeast3`, 런타임 `nodejs22`, 소스 `cloud-run/mro-functions`(모든 함수가 `index.js` 하나, entry point별 배포 `--source=.`) |
| 서비스 계정 | `771006650918-compute@developer.gserviceaccount.com` (Cloud Run 실행·Scheduler 호출자) |
| DB | Google Sheets(스프레드시트 ID `1_pvEWU3PRoLM4ZO8aY2v0kEYz--tFNRy2g_fE6MMubU`) + Firestore(세션, 잠금, 실행 기록) |
| 배포 원칙 | ① diff를 먼저 보여 주고 승인 ② GitHub 커밋 ③ 새로 clone해 해시 대조 ④ Cloud Shell에서 같은 해시를 확인한 뒤 `gcloud functions deploy` ⑤ 실사용 검증. **GitHub 커밋 ≠ 배포**. Apps Script는 편집기 저장 = Head 반영, 웹앱은 "새 버전 배포"가 별도로 필요 |
| 작업 도구 | Claude 앱 내장 브라우저로 GitHub 업로드 페이지·Cloud Shell·Apps Script 편집기 조작. Cloud Shell 입력은 ClipboardEvent paste + Enter keydown, 출력은 `.xterm-accessibility-tree` 텍스트로 읽음(창이 가려지면 화면 그리기가 멈추므로) |
| 비밀값 원칙 | 비밀번호·키는 AI가 보거나 출력하지 않는다. 재홍님이 Cloud Shell에서 `read -s`로 직접 입력한다 |
| 선례 | 이슈 댓글 메일(`issueMailBatchTest`, Scheduler + OIDC + Secret `issue-mail-smtp-password`), 회원가입·비밀번호 찾기(`authCodeTest`, 공개 배포 + 화면의 자동 폴백 스위치). 이 설계는 두 선례의 패턴을 재사용한다 |

### 용어·시트 구조
- **원자재마스터**: A 원자재코드(`RM001` 형식), B 한글명, C 수집키워드, D 상태, E 등록일 [확인: Code.gs 1031행 appendRow, 685행]
- **품목마스터**: A MP자재코드(=itemId), B 고객사, C 품목명, D 담당, E 팀, F 주요원자재(한글, `, ` 구분), G 상태, H 등록일, I 원자재수정일 [확인: Code.gs 684·2928~2937행]
- **I열의 의미** [확인]: 피드에서 품목↔게시물을 매칭할 때의 **날짜 기준선**이다. `기준선 = I가 있으면 I, 없으면 H`. 게시물 수집 시각(시황게시물 H열 `new Date()`)이 기준선 이후일 때만 매칭된다. 근거: Cloud Run `lib/feedEngine.js` 54~65행 `relatedActiveItems`, Code.gs 2996~3002행 `getRelatedItems_`. 매칭은 수집 시점에 저장되지 않고 **조회 때마다 다시 계산**된다(시황게시물에는 품목 정보가 없음, Code.gs 1584·2336행).

---

## 【1】 현재 상태 진단 (v1과 동일, 요약)

### 1-1. 추천이 실행되는 3개 경로 — 모두 Code.gs `suggestRawMaterials(itemName)`(942행) 하나를 호출 [확인]

| 경로 | 시작점 → 호출 흐름 | 실행본 |
|---|---|---|
| ① 앱 버튼 | feed.html `suggestMaterialsForForm`(버튼 또는 품목명 입력 0.8초 뒤) → `callApi('suggestMaterials')` → `doPost` → `handleSuggestMaterials_`(3674행, **팀장만**) | 웹앱 버전 88 |
| ② 시트 편집 | 설치형 트리거 `onEditInstallable`(714행) → ②-a 행 완성 루프(744~770행, 어느 열을 편집해도 편집 범위 각 행의 D·**F(빈 경우 AI)**·G·H를 채움, I 미갱신) + ②-b C열 단일 셀 편집(790~826행, F가 있어도 재추천, 결과가 다르면 I 갱신) | Head |
| ③ 15분 점검 | 시간 트리거 `ensureAllItemRowsComplete`(4284행) → 행마다 D(·E)·**F(빈 경우 AI)**·G·H 채움, I 미갱신(4318~4326행) | Head, 매시 :14:53/:29:53/:44:53/:59:53 [확인: 실행 기록] |

- [확인] **새 행에 C를 한 칸 입력하면 AI가 2번 불린다**(②-a가 빈 F를 채운 뒤 ②-b가 다시 추천).
- [확인] 앱의 품목 저장은 이미 Cloud Run `upsertItemTest`가 Sheets API로 한다(index.js 1960행~). 원자재가 바뀌면 I도 찍는다(2033~2036행, 빈칸→값도 "바뀜"으로 판정).

### 1-2. `suggestRawMaterials` 동작 [확인: 942~1065행]
1. 원자재마스터 전체를 읽어 프롬프트에 기존 목록을 넣는다.
2. 규칙 프롬프트(957행~, 최대 2개 선정, JSON)로 `callAI_`를 최대 2회 순차 호출한다(JSON 실패 시 재시도).
3. **스크립트 공용 잠금** `tryLock(10000)`. 못 잡으면 null(=추천 실패). 로그인 캐시(328행)·동기화(628행) 등과 같은 잠금 1개를 공유한다.
4. 잠금 안에서 다시 읽기 → RM 번호 = 기존 코드 숫자 최댓값 + 1 → 같은 이름 없으면 appendRow → D열 데이터 확인 규칙 복사.
5. flush 후 사후 검증(같은 이름 2행 이상이면 이번에 추가한 행 삭제).
6. `{ korean: [...] }` 반환.

### 1-3. AI 호출 [확인: 1813~1960행]
- `AI_PROVIDER`(Script Properties, 기본 GEMINI) → `callDeepSeek_`(`deepseek-v4-flash`, `reasoning_effort:'low'`) 또는 `callGemini_`(`gemini-2.5-flash-lite`).
- 대기시간 상한을 코드에서 지정하지 않는다. 오류는 `console.error`만 남긴다.
- 뉴스 수집(`callAIBatch_`)·보고서 프롬프트도 같은 키를 쓰며 **이전 범위 밖**이다.

### 1-4. Apps Script가 이미 Cloud Run·Firestore를 직접 부른다 [확인]
- `UrlFetchApp`로 `whoamiTest`·`sessionSyncTest` 호출(258·277행).
- `ScriptApp.getOAuthToken()`으로 Firestore REST 호출(4197~4201행).
- manifest에 `script.external_request`, `datastore` 범위가 있다(`appsscript.json`). 새 권한 승인 없이 프록시와 Firestore 공용 잠금을 구현할 수 있다.

### 1-5. 프롬프트 사본 수
- [확인] 1벌(Code.gs 957행). Cloud Run에는 없다.
- [미확인] GitHub 사본과 편집기 원본의 일치 여부.

---

## 【2】 확정 설계

### 2-0. 전체 구조 [확정: Cloud Run 함수 1개, mode로 3경로 구분]

```
[앱 버튼] ──세션토큰──────────────▶┐
[시트 편집] onEditInstallable        │  Cloud Run  suggestMaterialsTest (가칭, 1개 함수)
   (감지 + D/E/G/H 채우기)          ├─▶  mode = app | sheet | sweep
   ──프록시 비밀값────────────────▶│     공통 엔진 lib/materialSuggest.js
[Cloud Scheduler 15분] ──OIDC─────▶┘     · 프롬프트 유일본 · AI 호출(대기·재시도)
                                        · 원자재마스터 추가(RM 번호)
                                        · F·I 쓰기(sheet/sweep) · [suggest] 로그
                     Firestore: writeLocks/rawMaterialMaster (원자재마스터 잠금)
                                materialRowClaims/{itemId}   (행 단위 처리권, 지적 3)
                                sweepRuns/material           (점검 실행 기록)
```

- **공개 배포**(`--allow-unauthenticated`)한다. 앱이 브라우저에서 직접 부르기 때문이다(authCodeTest와 같은 사정, 재홍님 명시 승인 필요).
- 경로별 인증
  - `app`: 세션 토큰 + 팀장 역할
  - `sheet`: 프록시 비밀값 헤더
  - `sweep`: **Google 서명 OIDC 토큰** 확인. 함수 안에서 `Authorization: Bearer` 토큰을 google-auth-library로 검증하고, 발급 대상(audience)이 이 함수 URL이며 이메일이 위 서비스 계정일 때만 허용한다.
  - [추정] 공개 함수에서도 이 방식으로 Scheduler 호출만 걸러낼 수 있다. 단계 4에서 실제 동작을 확인하고, 안 되면 sweep만 비공개 별도 함수로 분리하는 것을 대안으로 둔다.

### 2-1. ① 앱 버튼 → Cloud Run 완전 이전
- 요청 `{ mode:'app', sessionToken, idempotencyKey, itemName }`.
  - 인증은 `lib/auth.js authenticateSession`. 사용자팀마스터 역할이 팀장일 때만 허용한다(Code.gs 3675행과 동일).
- 처리: 엔진의 "추천 + 원자재마스터 추가"만 한다. **F열은 쓰지 않는다.** 앱 폼에 태그만 돌려주고, 저장은 기존 `upsertItemTest`가 한다(이때 I도 기존 규칙대로 찍힘).
- 응답: `{ ok:true, materials:[...] }`. 오류 코드는 `AI_FAILED`(쓰기 전 실패), `LOCK_TIMEOUT`, `FORBIDDEN`, `SERVER_ERROR`.
- `withIdempotency`(기존 lib)로 같은 요청 번호의 재전송은 AI를 다시 부르지 않는다.
- feed.html: `CLOUD_RUN_SUGGEST_MATERIALS_URL` 추가(빈 문자열 = 롤백). 60초 대기와 순번 가드(커밋 637c5e1)는 유지한다.

### 2-2. ② 시트 편집 → 감지는 Apps Script, F/I 처리는 Cloud Run

**Apps Script(`onEditInstallable`)에 남는 것** [확정: D/E/G/H는 Apps Script 유지]
- 편집 감지
- ②-a 루프에서 D(담당·팀)·G(활성)·H(등록일) 채우기
- **F가 필요한 행을 모아 Cloud Run에 1번 보내기**
  - 대상: F가 빈 행(`reason:'fill_empty'`) + C열 단일 셀 편집 행(`reason:'single_edit'`). 같은 행이 둘 다면 `single_edit` 하나로 합친다. **AI 2회 호출 문제가 여기서 해결된다.**
  - 요청 `{ mode:'sheet', rows:[{ itemId, itemName, reason }] }`, 헤더에 프록시 비밀값
- Apps Script는 Cloud Run이 성공 응답한 행의 F/I를 쓰지 않는다.

**Cloud Run이 하는 일 (행마다)**
1. 행 처리권 획득(2-6, 지적 3)
2. 엔진으로 추천(AI + 원자재마스터 추가)
3. 쓰기 직전 재확인: 품목마스터를 다시 읽어 **A열(itemId)로 행을 찾고**, C가 요청 당시 품목명과 같고, `fill_empty`면 F가 아직 비어 있을 때만 쓴다. 아니면 `stale` 로그만 남기고 쓰지 않는다.
4. F 쓰기 + **I 규칙(2-5) 적용**
5. 처리권 해제

- 응답 `{ ok:true, results:[{ itemId, status:'written'|'stale'|'busy'|'ai_failed'|'deferred', materials }] }`
- 여러 행 붙여넣기: 순서대로 처리하되 2-3과 같은 "행 수 또는 시간 상한, 먼저 닿는 쪽" 규칙을 쓴다(시트 경로 기본 행 상한 10, 시간 상한 4분). 남은 행은 `deferred`로 돌려주고 F가 빈 채로 남아 ③이 채운다.
- 인증: 헤더 비밀값을 Secret `material-suggest-proxy-token`과 비교한다. Apps Script는 같은 값을 Script Properties `SUGGEST_PROXY_TOKEN`에 갖는다.

### 2-3. ③ 15분 점검 → Cloud Scheduler + Cloud Run (지적 1·2 반영)

**Cloud Run sweep**
- Scheduler 작업 `material-sweep-15m`: `*/15 * * * *`(Asia/Seoul), OIDC(위 서비스 계정), POST `{ mode:'sweep' }`. 이슈 메일 `issue-mail-hourly`와 같은 방식이다.
- 처리
  1. `sweepRuns/material`로 중복 실행을 막는다(만료 6분).
  2. 품목마스터를 1번 읽어 **A·B·C가 있고 F가 빈 행**을 고른다.
  3. 행마다 처리권 → 엔진 → 재확인 → F·I 쓰기
- **[지적 2 반영] 1회 처리 한도: "행 수 상한 또는 시간 상한 중 먼저 닿는 쪽에서 중단"**
  - 행 수 상한 기본 **10행**(설정 `원자재점검1회처리한도`, 허용 범위 1~30)
  - 시간 상한 **4분**(240초). 함수 timeout은 300초로 배포한다.
  - **새 행을 시작하기 전에** "지금까지 걸린 시간 + 행당 최대 예상시간(AI 대기 × 시도횟수 + 10초 = 기본 20×2+10 = 50초)"이 4분을 넘으면 그 행을 시작하지 않는다. 진행 중인 행이 시간 상한에 잘리는 일이 없게 하기 위해서다.
  - 처리량: 최악(행당 50초)이면 1회 4행, 평균(행당 약 10초 **[추정]**)이면 10행. 15분 주기로 하루 최대 약 960행. 남은 행은 다음 회차로 넘긴다.
  - `sweepRuns`에 처리·성공·실패·남은 행 수를 기록한다.

**Apps Script `ensureAllItemRowsComplete` — [지적 1 반영] "F 스위치로 끄기"가 아니라 함수를 D/E/G/H 전용으로 축소**
- 변경 내용(단계 4에서 구현)
  - F 관련 코드(4320~4325행 `suggestRawMaterials` 호출)를 **삭제**한다.
  - "이미 완성된 행" 판정(현재 `if (d && e && f && g && h) continue`)에서 **f를 뺀다.** 그러면 F만 빈 행은 Apps Script가 더 이상 열지 않는다.
  - 실행 중복 방지와 3분 상한 주석에서 `suggestRawMaterials` 관련 설명을 정리한다.
- 효과
  - AI 호출과 F 판단 로직이 사라져 행마다 셀을 다시 읽는 횟수가 줄어든다(`getRange().getValue()` 반복).
  - D/E/G/H가 다 찬 행은 바로 건너뛴다.
  - **정정:** v1 검토 지적에 있던 "시트 읽기 범위 감소"는 일어나지 않는다. 이 함수는 원래 시작할 때 `getDataRange().getValues()`로 시트를 한 번 통째로 읽고, 그 부분은 D/E/G/H 판단에도 필요해서 그대로다 [확인: 4296~4298행 부근 `sheet.getDataRange().getValues()`].
- 트리거 자체는 유지한다(15분, D/E/G/H 담당).
- ②-a 루프(onEditInstallable 752~757행)의 F 부분도 같은 방식으로 Cloud Run 호출로 바꾼다(2-2).
- **롤백 방식 변경:** 스위치 대신 **Apps Script 이전 코드로 되돌리기**(편집기에 GitHub 이전 커밋의 Code.gs 해당 함수를 다시 붙여넣고 저장 → Head 즉시 반영). 동결 기간에는 `suggestRawMaterials`가 남아 있으므로 되돌리면 바로 동작한다. 절차는 【5】 단계 4 롤백 칸에 적었다.

### 2-4. 프롬프트(규칙) 단일화 [확정: 2~4주 동결 후 폐기]
- Cloud Run `lib/materialSuggest.js`에 프롬프트 유일본을 둔다. 옮길 때는 **편집기 원본**에서 복사하고, GitHub 사본과의 차이를 기록한다.
- Apps Script `suggestRawMaterials`는 **폴백 전용 동결본**으로 2~4주 둔다.
  - 맨 위에 "동결 — 규칙 수정 금지, 규칙 변경은 Cloud Run lib/materialSuggest.js에서만. 폐기 예정일: YYYY-MM-DD" 주석을 단다.
  - 동결본을 쓰는 곳: ① 앱 폴백(웹앱 `suggestMaterials`), ② 시트 프록시 실패 시 폴백
- 관찰 기간이 끝나면 동결본과 `handleSuggestMaterials_`, feed.html의 Apps Script 폴백 경로를 삭제한다(GitHub 이력이 백업). 이후 Cloud Run 장애 시 동작은 "앱: 추천 실패 표시, 시트: F를 비워 두고 다음 점검에 맡김"이다.

### 2-5. I열(원자재수정일) 규칙 [확정: fill_empty도 I를 찍는다]
- **규칙 v2:** 자동 경로가 F를 쓸 때, 정규화한 이전 값과 새 값이 다르면 **I = 쓰는 시각**. 빈칸 → 값도 "다름"이다. 비교는 기존 `normalizeMaterialsForCompare_`와 같다(Code.gs·index.js 양쪽에 존재 [확인]).
- 적용 범위
  - Cloud Run `sheet`(fill_empty, single_edit 모두), `sweep`
  - Apps Script 동결본 폴백 경로(②-a·②-b)도 같은 규칙으로 맞춘다(단계 2·3에서 수정)
  - 앱 저장(`upsertItemTest`)은 이미 이 규칙이다
- 값 형식: Cloud Run은 기존 `msToSheetSerialForItem_`(index.js 1914행)로 시트 시리얼 숫자를 쓴다. 앱 저장과 같은 방식이다. Apps Script는 `new Date()` + `yyyy-mm-dd hh:mm:ss` 표시 형식(818~823행과 동일).
- **근거(코드 검증, 2026-10-12)**
  - H=6/1이고 F가 빈 품목을 점검이 10/12에 "고무"로 채우면서 I를 안 찍으면, 기준선이 6/1로 남는다. 그 결과 10/1에 수집된 고무 뉴스가 10/12부터 이 품목에 **소급 노출**된다.
  - I=10/12를 찍으면 노출되지 않는다.
  - Cloud Run `relatedActiveItems`와 Code.gs `getRelatedItems_`에 가짜 데이터를 넣어 두 경로 모두 같은 결과임을 확인했다. 재홍님 원칙("뉴스는 수집 시점 매칭")과 일치시키기 위한 결정이다.
- **기존 데이터 처리 [확정: (iii) 단계 0에서 목록 확인 후 결정]**
  - 이미 과거에 점검·붙여넣기로 F가 채워졌고 I가 빈 품목들은 지금도 소급 노출 상태일 수 있다 **[추정: 실제 해당 품목 수 미확인]**.
  - 선택지
    - (i) 그대로 둔다
    - (ii) "F 있음 + I 빈칸" 품목에 I = 특정일(예: 이전 작업일)을 일괄로 찍는다. 그날 이전 게시물이 그 품목에서 사라지며, 정상 매칭이던 과거 게시물도 함께 사라질 수 있다.
    - (iii) 해당 품목 목록을 먼저 뽑아 재홍님이 보고 결정한다(권장)
  - 단계 0에서 해당 품목 수를 센다.

### 2-6. 행 단위 처리권 (지적 3 반영)
- **문제:** 시트 경로(트리거 → Cloud Run)와 점검(sweep)이 같은 행을 동시에 처리하면 AI가 2번 불리고 원자재마스터 추가가 겹칠 수 있다(원자재마스터 잠금이 중복 행은 막지만 AI 비용과 F 덮어쓰기 순서는 못 막음).
- **해결: Firestore `materialRowClaims/{itemId}` 문서로 행 처리권을 잡는다**(트랜잭션).
  - 문서 = `{ holder, mode, itemName, claimedAt }`. 만료 **90초**(행당 최대 예상 50초 + 여유). 만료된 처리권은 빼앗을 수 있다(기존 `lib/writeLock.js`와 같은 원리). 처리가 끝나면 삭제한다.
  - **sweep**이 처리권을 못 잡으면 그 행은 이번 회차에서 건너뛴다(`busy`). 다음 회차에 F가 차 있으면 자연히 제외된다.
  - **sheet fill_empty**가 못 잡으면 `busy`로 응답한다. 다른 쪽이 이미 처리 중이므로 할 일이 없다.
  - **sheet single_edit**(사람이 품목명을 바꿈)는 우선권을 가진다. 처리권이 잡혀 있으면 최대 60초까지 2초 간격으로 해제를 기다렸다가 잡는다. 앞선 처리는 2-2의 "쓰기 직전 재확인"에서 C가 바뀐 걸 보고 쓰지 않는다. 그 결과 새 품목명 기준 결과만 남는다. 60초 안에 못 잡으면 `busy`로 응답하고 로그를 남긴다. F에는 옛 값 또는 빈 값이 남는데, F가 비어 있으면 다음 점검이 채우고, 옛 값이면 남는다 **[한계: 이 경우 재홍님이 C를 한 번 더 저장하면 재처리]**.
  - **최근 처리 시각 비교**(검토 지적의 대안)는 쓰지 않는다. 이미 끝난 처리와 겹치는 문제는 재확인(F가 이미 찼는지)으로 충분하고, 진행 중인 처리와 겹치는 문제는 처리권만 막을 수 있어서다.
- Apps Script 동결본 폴백 경로는 처리권을 잡지 않는다. Cloud Run이 응답하지 않을 때만 쓰이는 비상 경로이고, 그때는 sweep(Cloud Run)도 동작하지 않을 가능성이 높아서다 **[추정]**. 겹쳐도 원자재마스터 중복은 2-7의 공용 잠금과 사후 검증이 막는다.

### 2-7. RM 번호 겹침 방지
- 원자재마스터에 행을 추가하는 코드는 Cloud Run 엔진 하나다. 동결 기간의 Apps Script 폴백도 **같은 Firestore 잠금** `writeLocks/rawMaterialMaster`를 REST로 잡는다(기존 스크립트 잠금도 함께 잡아 기존 동작 유지). 대기 10초, 만료 30초.
- 번호 규칙 이관
  1. 잠금 안에서 새로 읽는다.
  2. `^RM\d+$` 형식만 숫자로 읽어 최댓값 + 1 → `RM` + 3자리 0 채움.
  3. 같은 이름(공백 제거·소문자)이면 추가하지 않는다.
  4. 추가 후 다시 읽어 이름 중복이면 이번에 추가한 행을 삭제한다(1-2의 5와 동일).
- 개선: 형식이 다른 코드가 섞여 있어도 `RMNaN`이 생기지 않게 한다(기존 `parseInt` 방식의 위험 **[추정: 실제 그런 코드 존재 여부 미확인]**).
- 추가 행: `[코드, 한글명, 수집키워드, '활성', 등록일(시리얼)]` + D열 데이터 확인 규칙 복사. Sheets API `batchUpdate`의 `setDataValidation`으로 재현한다 **[미확인: 결과를 시트에서 눈으로 확인]**.

---

## 【3】 폴백·장애 대응

### 3-1. Cloud Run 실패 시 자동 폴백
| 경로 | Apps Script로 넘김 | 넘기지 않음 |
|---|---|---|
| ① 앱 | 연결 실패·5xx 즉시 응답, `AI_FAILED`·`LOCK_TIMEOUT` | 60초 무응답 → "추천 실패 - 다시 시도"만 표시(서버가 이미 썼을 수 있어서. 9/4 hedge 제거와 같은 이유) |
| ② 시트 | 프록시 연결 실패·5xx·인증 실패·`ok:false` → 동결본으로 그 행 처리(I 규칙 v2 적용) | 응답 지연으로 Apps Script 대기 상한 초과 → F를 비워 두고 ③에 맡김 |
| ③ 점검 | — | Cloud Run 장애 시 그 회차 건너뜀. 장기 장애면 단계 4 롤백(Apps Script 함수 되돌리기) |

**스위치**
- feed.html `CLOUD_RUN_SUGGEST_MATERIALS_URL=''` → ① 즉시 기존 경로
- Apps Script Script Properties `SUGGEST_PROXY_URL` 빈 값 → ② 즉시 동결본 경로(배포 불필요, Head 실행)
- Scheduler 작업 일시중지 + Apps Script 함수 되돌리기 → ③

### 3-2. AI 공급자 장애 [확정: 예비 공급자 미사용, 추후 검토]
- 시도당 대기 상한(설정 `원자재추천AI대기초`, ~~기본 20초~~ → **기본 40초, 범위 10~45초**, 2026-10-13 변경 — 부록 C), 시도 횟수(`원자재추천AI시도횟수`, 기본 2).
- **시간 예산(2026-10-13 추가, 코드 상수):** AI 1·2차 합계 45초, 2차는 AI 예산이 10초 이상 남았을 때만, 요청 전체 50초(잠금 대기도 마감에 맞춰 줄임). 앱은 Cloud Run 요청 후 30초 이상 지나 받은 실패는 Apps Script로 넘기지 않는다(성공은 시간 무관).
- 2회 모두 실패하면 `AI_FAILED`. 원자재마스터·F 모두 쓰지 않는다.
- 같은 품목이 점검마다 반복 실패해 비용이 쌓이지 않게 Firestore에 행별 실패 기록을 남기고, 하루 3회(설정 `원자재추천일일실패한도`) 이상이면 그날은 건너뛴다.
- 예비 공급자(Gemini) 전환 기능은 만들지 않는다. 엔진의 AI 호출부를 공급자 하나로만 받게 두되, 나중에 추가할 수 있게 공급자별 함수로 나눠 둔다.

### 3-3. 잠금·충돌
- 원자재마스터 잠금 10초 초과 → `LOCK_TIMEOUT`. 앱은 폴백, 시트·점검은 F를 비워 다음 회차로 넘긴다.
- Cloud Run은 Apps Script **스크립트 공용 잠금**(로그인 등과 공유)에 묶이지 않는다.
- **트리거 ↔ 점검 동시 처리:** 2-6 행 처리권.
- **행 이동·사람의 동시 편집:** 2-2의 재확인(A열로 행 찾기 + C 일치 + fill_empty면 F 빈칸 확인). A열이 2행 이상 같으면 쓰지 않고 로그를 남긴다.
- Sheets API 429: 지수 대기 후 1회 재시도. 그래도 실패하면 그 행만 실패 처리한다.

### 3-4. 로그·조절값
- 로그: 요청(행)마다 `[suggest] {JSON}` 1줄.
  - 필드: `mode`, `source`(cloud-run / apps-script-fallback), `itemId`, `itemName`, `reason`, `provider`, 시도별 `aiMs`·`httpStatus`·`parseOk`, `materials`, `newRM`, `lockMs`, `claim`(acquired/busy/waited N초), `sheetWrite`(written/stale/skip), `iUpdated`, `totalMs`, `error`
  - AI 키와 프롬프트 전문은 남기지 않는다.
- 설정 시트 키(앱 설정 화면 SETTINGS_META에 추가해 재홍님이 수정 가능)

| 키 | 기본값 | 의미 |
|---|---|---|
| `원자재추천AI대기초` | 40 (2026-10-13, 기존 20) | AI 1회 호출 대기 상한(초), 범위 10~45 |
| `원자재추천AI시도횟수` | 2 | AI 시도 횟수 |
| `원자재점검1회처리한도` | 10 | 점검 1회 최대 처리 행 수(시간 상한 4분과 먼저 닿는 쪽) |
| `원자재추천일일실패한도` | 3 | 같은 행 하루 실패 허용 횟수 |

- 주 공급자는 배포 환경변수 `AI_PROVIDER`(단계 0에서 확인한 현재 값과 동일하게)로 둔다.
- 모니터링: `sweepRuns` 기록. 연속 실패 알림 메일은 만들지 않는다 [확정 2026-10-12].

---

## 【4】 AI 키 이관 절차

- **Secret Manager 사용.** 환경변수는 콘솔·배포 기록에 값이 보이기 때문이다. 이미 `issue-mail-smtp-password`를 같은 방식으로 운영 중이다 [확인].
- 예비 공급자를 쓰지 않으므로 이번에는 **주 공급자 키 1개 + 프록시 비밀값**만 등록한다.

| Secret | 내용 | 환경변수 |
|---|---|---|
| `ai-deepseek-api-key` (주 공급자가 DeepSeek인 경우) 또는 `ai-gemini-api-key` | AI 키 | `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` |
| `material-suggest-proxy-token` | 임의 생성 비밀값 | `SUGGEST_PROXY_TOKEN` |

- Apps Script의 기존 키는 지우지 않는다(뉴스 수집·보고서 프롬프트가 사용).

**절차 (재홍님이 Cloud Shell에 한 블록씩 붙여넣기)**

0. 준비: Apps Script 편집기 → 프로젝트 설정(톱니바퀴) → 스크립트 속성에서 `AI_PROVIDER` 값을 확인해 알려 주시고, 그 공급자의 키 값을 복사해 둔다.

1. 키 등록(아래는 DeepSeek 예시. Gemini면 이름만 `ai-gemini-api-key`로 바꾼다)
```bash
printf '%s' "AI 키를 붙여넣고 Enter: "; IFS= read -r -s K; echo
printf '%s' "$K" | gcloud secrets create ai-deepseek-api-key --replication-policy=automatic --data-file=- --project=mro-market-intelligence
unset K
echo "길이 확인(내용은 출력 안 함): $(gcloud secrets versions access latest --secret=ai-deepseek-api-key --project=mro-market-intelligence | wc -c)"
```

2. 프록시 비밀값 자동 생성
```bash
T=$(openssl rand -hex 32)
printf '%s' "$T" | gcloud secrets create material-suggest-proxy-token --replication-policy=automatic --data-file=- --project=mro-market-intelligence
unset T
```

3. 서비스 계정에 읽기 권한
```bash
for S in ai-deepseek-api-key material-suggest-proxy-token; do
  gcloud secrets add-iam-policy-binding $S --project=mro-market-intelligence \
    --member=serviceAccount:771006650918-compute@developer.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo "권한 OK: $S"
done
```

- 길이가 원래 키와 다르면 `gcloud secrets versions add <이름> --data-file=-`로 새 버전을 넣고 잘못된 버전은 폐기한다(10/7 메일 비밀번호 때와 같은 방식).
- 프록시 비밀값을 Apps Script에 넣는 것은 단계 3 직전에 한다. 재홍님이 `gcloud secrets versions access latest --secret=material-suggest-proxy-token`으로 값을 보고, 스크립트 속성 `SUGGEST_PROXY_TOKEN`에 직접 붙여넣는다(AI는 값을 보지 않음).
- 배포 시 `--set-secrets=DEEPSEEK_API_KEY=ai-deepseek-api-key:latest,SUGGEST_PROXY_TOKEN=material-suggest-proxy-token:latest` (알림 메일을 만들지 않으므로 SMTP 비밀값은 연결하지 않음).

---

## 【5】 마이그레이션 단계

각 단계: **diff 제시 → 승인 → GitHub 커밋 → clone 해시 대조 → 배포 → 검증**. 시험에는 **시험 전용 품목 행**(재홍님 지정, 시험 후 삭제)을 쓰고, 시험 중 원자재마스터에 생긴 항목은 재홍님 확인 후 정리한다.

| 단계 | 내용 | 종료 조건(검증) | 롤백 | 예상 |
|---|---|---|---|---|
| **0 사전 확인** | ① 편집기 Code.gs와 GitHub 사본 대조(`suggestRawMaterials`·`onEditInstallable`·`ensureAllItemRowsComplete`·`callAI_`·`normalizeMaterialsForCompare_`), 다르면 사본 갱신 커밋 ② `AI_PROVIDER` 값 ③ 원자재마스터 A열 비정형 코드 유무 ④ 품목마스터 A열 중복 유무 ⑤ "F 있음 + I 빈칸" 품목 수(2-5 기존 데이터) ⑥ Apps Script `UrlFetchApp` 대기 상한·설치형 트리거 실행 상한(구글 문서) ⑦ 【4】 키 등록 | ①~⑦ 결과를 이 문서 부록에 기록 | — | 0.5일 |
| **1 엔진 + 앱 경로** | `lib/materialSuggest.js`, `suggestMaterialsTest`(mode=app), 원자재마스터 잠금, 로그, feed.html 스위치 | 가짜 데이터 시험 → Cloud Shell에서 시험 품목명 3개 호출(로그·원자재마스터 확인) → 앱에서 10회 사용 시 실패 0·중복 RM 0·걸린 시간 기록 | feed.html URL `''` | 1일 |
| **2 Apps Script 동결·잠금 통일** | 동결 주석, Firestore 잠금 추가, 폴백 로그 형식, ②-a·②-b 폴백 경로의 I 규칙 v2 | 시험 함수로 폴백 1회(잠금 문서 생성·해제, I 갱신 확인). **웹앱 새 버전 배포**(앱 폴백이 웹앱 버전을 타므로) | 웹앱을 버전 88로 되돌림 + 편집기 코드 복원 | 0.5일 |
| **3 시트 경로 프록시** | `onEditInstallable` F 부분 → Cloud Run(mode=sheet), 행 처리권, 재확인, I 규칙 v2, AI 2회 호출 제거. `SUGGEST_PROXY_TOKEN`·`SUGGEST_PROXY_URL` 설정 | 시험 행으로 (a) 새 행 C 입력 (b) 기존 행 C 단일 수정 (c) 3행 붙여넣기 (d) 처리 중 C 재수정 → F·I·로그·AI 호출 횟수 1회 확인 | `SUGGEST_PROXY_URL` 빈 값 | 1일 |
| **4 점검 이전** | Cloud Run mode=sweep + OIDC 확인, Scheduler 15분, 1회 한도(10행·4분), Apps Script `ensureAllItemRowsComplete`를 D/E/G/H 전용으로 축소 | 시험 행 F를 비워 다음 회차에 채워지는지·I 찍히는지, 한도에서 멈추는지, 트리거↔점검 동시 처리 시 처리권 동작(`busy` 로그) 확인 | Scheduler 일시중지 + 편집기에서 `ensureAllItemRowsComplete`를 단계 4 직전 커밋의 코드로 되돌려 저장 | 0.5일 |
| **5 관찰** | 2~4주 실사용 기록(실패율·시간·폴백·busy 빈도) | 중대 문제 없음 | 단계별 롤백 | 기간 |
| **6 정리** | 동결본·Apps Script 폴백 경로 삭제, feed.html 폴백 제거, README·설계서 갱신 | 반영 완료 | GitHub 이력 | 0.5일 |

- 작업 합계 약 4일(승인 대기 제외) **[추정: 10/8 회원가입·비밀번호 찾기 이전 작업 속도 기준]**.
- 단계 1만 끝나도 앱 경로 실패 원인이 로그에 남고, 공용 잠금 대기가 사라진다.

---

## 【6】 (a)안 vs (b)안 비교 (참고, 결정은 (a)안)

| 항목 | (a) 감지만 Apps Script | (b) 주기 점검이 시트 입력까지 흡수 |
|---|---|---|
| F가 채워지기까지 | AI 응답 시간(수 초~수십 초) | 점검 주기 + AI 시간 |
| "F가 있어도 C를 고치면 재추천" | 유지(편집 이벤트) | 변경 감지 장치가 따로 필요 |
| 복잡도 | Apps Script 프록시 + Cloud Run 3모드 | Cloud Run 변경 감지 추가 |
| 유지보수 | 두 곳을 알아야 함 | 시트 AI는 Cloud Run 한 곳 |
| 폴백 | 시트 경로 즉시 동결본 폴백 | Cloud Run 장애 시 시트 입력 처리 전체 정지 |
| 실행량 | 편집이 있을 때만 | 주기마다 시트 전체 읽기 |

---

## 【7】 리스크·미확인·미해결

### 7-1. 미확인 사항 (v1 유지 + 갱신)
1. GitHub `apps-script/Code.gs` 사본과 편집기 원본(웹앱 버전 88 / Head)의 일치 여부 — **Head(편집기)는 일치 확인(부록 B ①)**. 웹앱 버전 88 내용은 미확인
2. ~~`AI_PROVIDER` 실제 값과 키 보유 현황~~ → **해결: DEEPSEEK(부록 B ②), 키 Secret 등록·유효성 확인 완료(부록 B ⑦)**
3. 10/12 19.3초·28.1초 웹앱 실행이 추천 요청이었는지, 시간 내역 — 실행 로그 세부를 열지 못함
4. Sheets API 쓰기가 편집 트리거를 깨우지 않는다는 점 — 구글 문서 기준, 이 프로젝트에서 직접 시험하지 않음
5. ~~Apps Script 실행 상한~~ → **해결(부록 B ⑥)**. 단 `UrlFetchApp` 1회 대기 한도는 공식 문서에 없어 약 60초로 **추정**
6. ~~원자재마스터 A열 비정형 코드, 품목마스터 A열 유일성~~ → **해결(부록 B ③④)**
7. D열 데이터 확인 규칙을 Sheets API로 재현한 결과
8. ~~I열 규칙 의도~~ → **해결: 2-5로 확정**(2026-10-12 코드 검증 후 재홍님 결정)
9. ~~예비 공급자 품질 차이~~ → 예비 공급자 미사용으로 보류
10. **(신규)** 공개 함수 안에서 Scheduler OIDC 토큰을 검증하는 방식의 실제 동작(2-0). 안 되면 sweep 전용 비공개 함수로 분리
11. ~~**(신규)** "F 있음 + I 빈칸" 기존 품목 수와 실제 소급 노출 여부~~ → **해결: 93건, (i) 그대로 두기 확정(부록 B ⑤)**
12. **(신규, 해결)** 품목마스터 A열 중복 1건(A1000995427: 50행 스팟타방지제 / 51행 목장갑) → **재홍님 수정 완료**(51행 → 1000252867). 2026-10-12 시트 재확인: 중복 0건. 기존 댓글 73건·댓글확인이력은 모두 부탄·나프타·실리콘 게시물 대상이라 50행(코드 유지)에 그대로 연결됨 — 51행(목장갑, F=면) 대상 기록은 0건 [확인]

### 7-2. 결정 현황
| 항목 | 상태 |
|---|---|
| D/E/G/H 위치 | [확정] Apps Script 유지 |
| 프롬프트 | [확정] 2~4주 동결 후 폐기 |
| I열 규칙 | [확정] 모든 자동 F 쓰기에서 I 갱신(2-5) |
| Cloud Run 함수 수 | [확정] 1개, mode 구분 |
| 예비 AI 공급자 | [확정] 미사용(추후 검토) |
| 기존 "F 있음 + I 빈칸" 품목 처리 | [확정] **(i) 그대로 두기** (2026-10-12, 93건 전부 등록일 2026-07-27 이후라 위험 낮음) |
| 점검 연속 실패 알림 메일 | [확정] 만들지 않음 |
| 시험 전용 품목 행, 시험 중 생긴 원자재 정리 방침 | [확정] 시험 행 = 품목마스터 96행 TEST-001(비활성). 시험 중 생긴 원자재는 단계 4 뒤 한 번에 정리(목록: 부록 C-4) |

### 7-3. 미해결 이슈 (이번 설계 범위 밖, 별도 과제)
- **부분 문자열 매칭:** 피드 매칭이 `F열.indexOf(게시물 원자재명)` 글자 포함 비교라서, "프로필렌" 게시물이 "프로필렌옥사이드" 품목에 매칭된다 [확인: feedEngine.js 56행, Code.gs 2990행. 가짜 데이터 시험에서 I(9/23) 이후 수집된 프로필렌 게시물이 P.E.G#6000 품목에 노출됨]. 기준선(I)은 과거 게시물만 막는다. 원자재명을 쉼표로 나눠 정확히 비교하는 방식 등은 별도 설계로 다룬다.

### 7-4. 리스크
- [추정] 행 정렬·삽입 중 처리: 재확인으로 오기입은 막지만 F 빈칸이 다음 점검까지 남을 수 있다.
- [확인] 동결 기간에는 규칙이 두 벌이다. 수정은 Cloud Run에서만 한다.
- [추정] 반복 실패 시 AI 비용: 일일 실패 한도로 제한한다.
- [추정] single_edit 처리권 대기 60초 초과 시 옛 F가 남는 드문 경우가 있다(2-6).
- [확인] Cloud Run 서비스 계정은 이미 같은 스프레드시트에 쓰고 있다(`upsertItemTest` 등). 원자재마스터 쓰기에 새 권한은 필요 없을 것으로 본다 **[추정]**.

---

## 【8】 이어받기 자체 검토 — "다음 세션 AI가 이 문서만 보고 단계 0을 시작할 수 있는가"

**가능한 것(문서에 있음)**
- 대상 코드 위치(파일·행), 프로젝트·리전·서비스 계정·스프레드시트 ID, 배포 원칙과 선례
- 결정 사항과 남은 결정, 단계별 종료 조건·롤백, 키 등록 명령 전문
- 단계 0의 확인 항목 ①~⑦과 각각의 확인 방법(편집기 대조, 스크립트 속성, 시트 조회, 구글 문서)

**문서만으로는 부족한 맥락 (보완 필요)**
1. **브라우저 조작 요령의 세부:** GitHub 업로드 스크립트(DataTransfer로 파일 첨부 → 커밋 메시지 → 업로드 진행 표시가 사라진 뒤 Commit 클릭. 큰 파일은 8초 이상 대기), Cloud Shell 입력 헬퍼 코드. 0장에 요약만 있으므로, 이전 세션 기록이나 저장소의 다른 설계서를 참고해야 한다.
2. **GitHub 쓰기 권한:** 이 세션의 GitHub API로는 저장소에 쓸 수 없어, 지금까지 **브라우저 업로드 페이지로만** 커밋했다. 다음 세션도 같을 수 있다 **[추정]**.
3. **편집기 원본 확보 방법:** Apps Script 편집기 코드를 그대로 복사해 오는 방법이 정해져 있지 않다(2026-08-18 첫 동기화 때 들여쓰기가 사라진 전례, `apps-script/README.md`). 단계 0 ①에서 방법부터 정해야 한다.
4. **설정 화면 연동:** 설정 시트 키를 앱 설정 화면에 노출하려면 feed.html `SETTINGS_META`에 항목을 추가하고, 설정 시트에도 행을 미리 만들어야 한다(행이 없으면 저장 안 됨 — 10/7 이슈 메일 때 경험). 행 추가는 **재홍님이 직접** 한다(운영 시트 값은 AI가 브라우저로 수정하지 않는 원칙).
5. **재홍님과 소통 방식:** 항상 한국어, 비개발자 눈높이, 확인 안 된 것은 단정하지 않고 표시, 코드 변경은 diff 먼저.
6. **다른 진행 중 맥락:** 회원가입·비밀번호 찾기 Cloud Run 이전(10/8, `authCodeTest`) 관찰 중. 백로그 1건: 2단계 응답 유실 시 "코드 만료" 오해 가능성.

**확정 못 한 사항:** 7-1의 미확인 1(웹앱 버전 88 부분), 3, 4, 5(UrlFetchApp 대기 한도), 7, 10은 남아 있으며 해당 단계에서 확인한다. 2·6·11·12는 단계 0에서 해결(부록 B).

---

## 부록 A. v1 → v2 변경 요약
- 결정 5건 반영(D/E/G/H 유지, 프롬프트 동결 후 폐기, I열 갱신, 함수 1개, 예비 공급자 미사용)
- 지적 1: 점검 함수를 D/E/G/H 전용으로 축소. 롤백은 코드 되돌리기로 변경. "시트 읽기 범위 감소"는 실제로는 일어나지 않음을 정정
- 지적 2: 점검 기본 10행, "행 수 또는 4분 중 먼저", 행 시작 전 예상시간 확인
- 지적 3: Firestore 행 처리권(`materialRowClaims`)과 single_edit 우선 규칙 추가
- 신규: 기존 "F 있음 + I 빈칸" 품목 처리 결정 항목, sweep OIDC 확인 방식, 이어받기 자체 검토(【8】), 프로젝트 기본 맥락(0장)

## 부록 B. 단계 0 결과 기록란 (작업자가 채움)
| 항목 | 결과 | 확인일 |
|---|---|---|
| ① 편집기 ↔ GitHub 사본 대조 | **일치(확인)**. 편집기 화면 내용 전체를 GitHub 818e221과 줄 단위 대조 — 차이는 맨 위 미러 안내 배너 12줄뿐(들여쓰기 제외). 대상 5개 함수 + callDeepSeek_/getRelatedItems_/handleUpsertItem_ 모두 동일. 줄 번호는 편집기 = GitHub − 12. ※ 앱 웹앱 배포(버전 88)의 내용은 편집기(Head)와 같은지 미확인 | 2026-10-12 |
| ② AI_PROVIDER | DEEPSEEK (재홍님 화면 확인) | 2026-10-12 |
| ③ 원자재마스터 비정형 코드 | **0건(확인)**. 실제 데이터 78행(2~79행), RM001~RM078 빈 번호 없음, 코드·이름 중복 없음, 전부 활성 | 2026-10-12 |
| ④ 품목마스터 A열 중복 | **1건(확인)**: A1000995427 = 50행(스팟타방지제) / 51행(목장갑). 앱에서 51행을 수정하면 첫 번째 일치인 50행이 바뀜(handleUpsertItem_ 첫 일치 후 break — 코드 확인). 부가: 머리글 A1="G1:H10", Z1="done: found=false \| triggers=1" — 과거 디버그 흔적으로 추정, 코드는 머리글 이름을 읽지 않음(확인). **→ 조치 완료(재홍님):** 51행 A열 1000252867로 수정, A1 "MP자재코드" 복구, Z1 삭제. 2026-10-12 시트 재확인: A열 중복 0건, 머리글 A~I 정상, J열 이후 머리글 비어 있음. 기존 댓글·확인이력 영향 없음(7-1 12번) | 2026-10-12 |
| ⑤ F 있음 + I 빈칸 품목 수 | **93건**(활성 79 / 비활성 14) / 전체 94건 중 I 있는 건 47행 1건(2026-10-12 16:29). 목록: step0_F있음_I빈칸_93건.xlsx. **→ (i) 그대로 두기 확정(재홍님).** 메모: 93건 등록일(H) 최솟값 2026-07-27, 최댓값 2026-08-24 [시트 확인] — 전부 최근 2.5개월 이내 등록이라 소급 노출 위험 낮음 | 2026-10-12 |
| ⑥ UrlFetchApp/트리거 상한 | 공식 할당량 문서: 실행 1회 6분, 트리거 총 실행시간 하루 90분(일반 계정)/6시간(Workspace), URL Fetch 하루 2만/10만 회, 동시 실행 사용자당 30. UrlFetchApp 자체 대기 한도는 **공식 문서에 없음** — 비공식 자료상 약 60초·변경 불가(추정) | 2026-10-12 |
| ⑦ Secret 등록(길이 일치) | **완료(확인)**. 등록 전 비밀값은 issue-mail-smtp-password 1개뿐이었음. ① `ai-deepseek-api-key` 버전 1: 재홍님이 키를 화면에 표시되지 않게 입력(read -s) → 입력 길이 35 = 저장 길이 35, 저장 전 DeepSeek `GET /models` 응답 **200**(토큰 소모 없는 호출, 키 값은 출력·기록 안 함). ② `material-suggest-proxy-token` 버전 1: `openssl rand -hex 32`로 자동 생성, 저장 길이 64(값은 아무도 보지 않음). ③ 두 비밀값 모두 서비스 계정 771006650918-compute@developer.gserviceaccount.com에 `roles/secretmanager.secretAccessor` 부여 확인(get-iam-policy). 남은 일: 프록시 토큰을 Apps Script 속성 `SUGGEST_PROXY_TOKEN`에 넣는 것은 단계 3 직전(【4】) | 2026-10-12 |

## 부록 C. 단계 1 결과 기록 — **단계 1 완료 (2026-10-13)**

### C-1. 반영 내역
| 커밋 | 내용 |
|---|---|
| 913a9e2 · ec94c28 · 55f778d | `lib/materialSuggest.js`(신규 엔진) · 시험 75건 · `index.js`에 `suggestMaterialsTest`(mode=app) |
| 7da6335 · b76c30a · d2e9487 | 대기 방식 수정(1회 40초·AI 합계 45초·재시도 10초 기준·요청 50초) · 시험 94건 · 요청 마감 연결 |
| b95b361 | `feed.html`: Cloud Run 연결 + 자동 폴백 + 30초 넘은 실패는 폴백 안 함 (공개 주소 해시 ecc321be241f 확인) |

- 배포: `suggestMaterialsTest` 공개 배포(재홍님 승인), 리비전 00001-jik(10/13 오전) → **00002-zem**(시간 예산 반영). Secret `ai-deepseek-api-key` 연결, `AI_PROVIDER=DEEPSEEK`, 제한시간 120초.
- 롤백 스위치: `feed.html`의 `CLOUD_RUN_SUGGEST_MATERIALS_URL = ''`.

### C-2. 시험 결과 3종 비교 [확인: Cloud Run `[suggest]` 로그 원문]
| 구분 | 건수 | 결과 | 서버 처리 시간 | AI 시간 | 비고 |
|---|---|---|---|---|---|
| ① 10/13 오전 직접 호출(리비전 00001, 1회 상한 20초) | 3 | 3/3 성공 | 1번 **43.5초** · 2번 14.4초 · 3번 20.4초 | 1번: 1차 20초 끊김 → 2차 16.8초 | 1번에서 AI 2회 호출(시간·비용 2배) |
| ② 10/13 직접 호출(리비전 00002, 1회 상한 40초) | 3 | 3/3 성공 | 1번 **13.8초** · 2번 9.5초 · 3번 14.2초 | 7.5초 · 7.3초 · 12.2초 | 모두 1회 호출 |
| ③ 앱 시험(재홍님, 품목 TEST-001·니트릴장갑) | 9 | 9/9 성공 | 평균 **16.7초**, 최소 6.5초, 최대 **36.2초** | 평균 14.9초, 최소 4.5초, 최대 34.4초 | 실패 0 · 재시도 0 · Apps Script 폴백 0 · 새 원자재 0 |

- **36.2초 케이스의 의미:** AI 응답에 34.4초가 걸렸다. 1회 상한이 20초였다면 20초에 끊고 다시 불렀고, 2차도 20초 안에 못 받았으면 실패(AI_FAILED)였다. 새 40초 상한에서는 1회로 성공했고, 성공은 30초 규칙과 무관하게 화면에 표시된다.
- 실패율: ②+③ 12건 중 0건. 경고·오류 로그 0건.
- 앱 시험은 재홍님 기준 10회, 서버 기록 9건 — 버튼 처리 중 누름 등 화면 동작 차이로 판정(재홍님, 문제 없음).
- [추정] 같은 시간대 Apps Script 웹앱 실행은 2~4초짜리 3건뿐이라 AI 추천 요청은 아니었다(실행 세부는 열지 않음).

### C-3. 확인된 동작
- 프롬프트: 편집기 원본과 글자 단위 동일(SHA-256 d6ce4d85…, 시험 A0).
- 새 원자재 추가: 80행에 RM079(리튬) — Sheets append(OVERWRITE)로 마지막 행 바로 아래, 시트 전체 행 수 변화 없음(966행). 날짜 서식은 79행과 동일. D열 드롭다운 복사는 오류 없이 끝남 **[추정: 값이 찬 칸은 공개 보기에서 드롭다운 표시가 안 보여 눈으로는 미확인]**.
- 기존 원자재 재사용: 고무(RM001)·PP·아크릴 수지·코발트(RM038)·니트릴고무(RM029)·첨가제(RM011) — 새 행 없음.
- 품목마스터는 쓰지 않음(96행 F=고무, I 빈칸 그대로).

### C-4. 정리 대상 목록 (단계 4 뒤 한 번에 정리, 지금은 그대로 둠)
| 시트 | 행 | 코드 | 이름 | 상태 | 생긴 이유 |
|---|---|---|---|---|---|
| 품목마스터 | 96 | TEST-001 | 테스트용 고무장갑 | 비활성 | 시험 전용 행(재홍님 추가) |
| 원자재마스터 | 80 | RM079 | 리튬(키워드 리튬) | 활성 | 10/13 직접 호출 시험 3번 |

### C-5. 남은 관찰 항목
- 실사용 로그에서 `totalMs`가 48,000을 넘는 건이 나오면 시트 쓰기 시간 포함 예산을 다시 검토한다(T10은 시트 쓰기 시간 제외).
- 30초 경계: 29.9초 실패는 Apps Script로 넘어가 총 대기가 길어질 수 있고, 30초 이상 실패는 바로 "다시 시도" — 의도된 선택(재홍님 판정).
- 단계 2 전까지 Apps Script 경로(시트 편집·15분 점검·앱 폴백)는 스크립트 잠금만 써서, Cloud Run과 정확히 같은 순간 새 원자재를 만들면 번호가 겹칠 짧은 틈이 남는다(이름 중복은 양쪽 사후 검증이 막음).
