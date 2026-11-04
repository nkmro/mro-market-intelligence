# AI 공급자 OpenAI 추가 설계 v1 (2026-11-04)

> 범위: DeepSeek → OpenAI(ChatGPT API) 교체를 위한 **설계와 모델 비교 시험 계획**. 코드 변경·배포 없음.
> 표기: [확인] 코드·공식 문서·화면으로 확인 / [추정] 근거 있는 추정 / [미확인] 확인 전.

---

## 0. 먼저 알려드릴 것 — gpt-5.4-nano는 폐기 예정

| 항목 | 내용 | 근거 |
|---|---|---|
| gpt-5.4-nano | 모델 페이지에 **Deprecated** 표시. **2027-04-01 API에서 제거**(2026-10-01 공지, 6개월 예고) | [확인] developers.openai.com/api/docs/deprecations, /models/gpt-5.4-nano |
| 권장 대체 모델 | **gpt-6-luna** ("focused, high-volume tasks"용 가장 효율적인 모델) | [확인] 같은 폐기 공지 표 |
| gpt-5.4-mini | 폐기 표시 없음. 폐기 공지 목록에도 없음 | [확인] /models/gpt-5.4-mini, deprecations 페이지 |

→ nano를 지금 채택하면 5개월 뒤 다시 바꿔야 합니다. **시험 대상에 gpt-6-luna를 넣고, nano는 참고용 비교로만** 두는 것을 제안합니다.

## 1. 모델 공식 정보 [확인: 각 모델 페이지, 2026-11-04 조회]

| 항목 | gpt-6-luna | gpt-5.4-mini | gpt-5.4-nano (폐기 예정) |
|---|---|---|---|
| 용도(공식 문구) | focused, high-volume tasks | coding, computer use, subagents / high-volume | classification, data extraction, ranking, sub-agents |
| reasoning_effort 값 | none, low, **medium(기본)**, high, xhigh, max | **none(기본)**, low, medium, high, xhigh | **none(기본)**, low, medium, high, xhigh |
| Chat Completions(`v1/chat/completions`) | 지원 | 지원 | 지원 |
| Structured outputs | 지원 | 지원 | 지원 |
| 지식 기준일 | 2026-05-18 | 2025-08-31 | 2025-08-31 |
| 입력 한도 | 1,050,000 토큰 | 400,000 | 400,000 |

- 요금은 회사 예산이라 비교에서 뺐습니다. 대신 **호출 1건당 토큰 수**(입력·출력·추론)를 시험에서 잽니다.
- gpt-6-luna는 기본 추론 강도가 **medium**이라, 코드에서 `reasoning_effort`를 **반드시 명시**합니다(빼면 느려지고 추론 토큰이 늘어남) [확인: 모델 페이지].

## 2. API 호환성 — DeepSeek와 거의 같음

| 항목 | DeepSeek(현재) | OpenAI | 근거 |
|---|---|---|---|
| 주소 | `https://api.deepseek.com/chat/completions` | `https://api.openai.com/v1/chat/completions` | [확인] Code.gs 2242행 / OpenAI API reference |
| 인증 | `Authorization: Bearer 키` | 같음 | [확인] |
| 요청 본문 | `{model, messages:[{role:'user',content}], reasoning_effort:'low'}` | 같은 모양. `reasoning_effort`도 같은 이름 | [확인] Create chat completion 문서: "none, minimal, low, medium, high, xhigh, and max" |
| 응답에서 글 꺼내기 | `choices[0].message.content` | 같음 | [확인] 문서 응답 예시 |
| 토큰 사용량 | — | `usage.prompt_tokens / completion_tokens / completion_tokens_details.reasoning_tokens` | [확인] 문서 응답 예시 |
| JSON 강제 | 없음(프롬프트로 요청 + ``` 제거 후 파싱) | `response_format: {type:'json_object'}` 또는 `json_schema` 가능 | [확인] 문서 |

→ 요청·응답 모양이 같아서 **DeepSeek 함수를 복제해 주소·모델·키만 바꾸는 수준**입니다 [추정: 실제 호출 시험으로 확인 예정].
→ `response_format`은 **1차에선 넣지 않습니다.** 지금 DeepSeek과 같은 조건에서 모델만 비교하기 위해서이고, 시험에서 JSON 오류가 나오면 그때 추가합니다. (`callAI_`는 보고서 프롬프트 생성(3887행)처럼 JSON이 아닌 응답에도 쓰여서 일괄 적용하면 안 됨 [확인].)

## 3. 원자재 추천 작업 난이도 분석 (nano로 충분한가?)

현재 프롬프트: Code.gs `suggestRawMaterials` 1091~1120행 = Cloud Run `lib/materialSuggest.js` `promptTemplate_`(61행, 60행 주석 "글자 하나도 바꾸지 말 것", 지문 `PROMPT_TEMPLATE_SHA256` 29행) [확인].

| 규칙 | 필요한 능력 | 난이도 |
|---|---|---|
| 1. 원가에 영향 주는 원자재를 **여러 개** 검토, 단 유통 화학제품명이면 상위 원료로 쪼개지 말 것, 관용명·오기면 정식 화학명으로 | 품목 구성에 대한 **도메인 지식 + 예외 판단** | 높음 |
| 2. 괄호 안이 성분명이면 우선, 용도·등급 설명이면 무시 | 문맥 판별 | 중간 |
| 3·4. 기존 원자재 목록과 대조: 등급 차이면 재사용, 시황이 따로 움직이면 신규(isNew) | 목록 매칭 + 시황 관점 판단 | 높음 |
| 6. keyword는 **뉴스 검색에 실제 걸리는 표현** | 한국 시황 보도 용어 지식 | 높음 |
| 7. 원가 비중 순 최대 2개 | 순위 판단 | 중간 |
| 5. JSON만 출력 | 형식 준수 | 낮음 |

**판단 [추정]:** 이 작업은 "품명에서 단어를 뽑는 추출"이 아니라 **"이 제품이 무엇으로 만들어지는지 + 한국 시황 기사에서 뭐라고 부르는지"를 아는 지식 판단**입니다. 공식 문서가 nano 용도로 든 분류·추출보다 어렵습니다. 그래서 **nano급(가장 작은 모델)이 정확도에서 밀릴 위험이 실제로 있고, 시험 없이 정하면 안 된다**고 봅니다. 반대로 뉴스 관련성 판단·2문장 요약(`buildSummarizePrompt_` 2399행, 수집 시 일괄 호출 1744·1755행)은 분류에 가까워 작은 모델이 맞을 가능성이 높습니다.

## 4. 모델 비교 시험 설계

### 4-1. 시험 대상 (6개 조합 제안)

| 조합 | 모델 | reasoning_effort | 이유 |
|---|---|---|---|
| A | gpt-6-luna | none | 폐기 대체 모델, 최속 |
| B | gpt-6-luna | low | 현재 DeepSeek과 같은 강도 |
| C | gpt-5.4-mini | none | 기본값 |
| D | gpt-5.4-mini | low | 현재 DeepSeek과 같은 강도 |
| E | gpt-5.4-nano | low | 참고용(폐기 예정이라 채택 대상 아님) |
| F | DeepSeek(현재) | low | **기준선** — 지금보다 나빠지면 안 되므로 |

- F(DeepSeek)는 Secret Manager의 기존 키를 화면에 출력하지 않고 변수로만 읽어서 씁니다. 원하지 않으시면 F를 빼고, 시트의 기존 값(현재 운영 결과)을 기준선으로 씁니다.

### 4-2. 샘플 (60개)

- 출처: **품목마스터**(C 품목명, F 주요원자재) + **원자재마스터**(목록). Claude가 브라우저로 **읽기만** 합니다.
- 4종류를 고르게(각 15개): ① 단순 품목(예: 고무장갑) ② 괄호 성분 품목(규칙 2) ③ 화학제품명 품목(규칙 1 예외) ④ 복합재·MRO 규격 코드가 섞인 품목(베어링·벨트 등).
- **정답 만들기(재홍님 작업, 약 20~30분):** 시트의 F열은 예전 AI가 만든 값이라 그 자체가 정답이 아닙니다. Claude가 60개 표(품목명 / 현재 값)를 만들어 드리면, 재홍님이 각 줄에 "맞음 / 고칠 값"만 적어 주시면 됩니다. 이 과정에서 **현재 운영값의 정확도**도 함께 나옵니다.
- 샘플 데이터는 회사 정보라 **GitHub에 올리지 않고** Cloud Shell 안에서만 씁니다.

### 4-3. 지표

| 지표 | 계산 | 자동/사람 |
|---|---|---|
| 정확도 | 정답 원자재와 일치: 완전일치 1점, 2개 중 1개 일치 0.5점 | 자동(정답표 대조) |
| 1순위 정확도 | 첫 번째 원자재가 정답에 포함 | 자동 |
| 엉뚱한 원자재(환각) | 정답에 없고, 재홍님이 "틀림"으로 표시한 원자재 비율 | 결과 중 불일치만 재홍님 확인 |
| 목록 불일치 | `isNew:false`인데 기존 목록에 없는 이름 | 자동 |
| JSON 오류 | 파싱 실패·materials 없음 | 자동 |
| 응답 시간 | 평균·최대(초) | 자동 |
| 토큰 | 입력·출력·추론 토큰 평균 | 자동(`usage`) |
| 흔들림 | 같은 품목을 2번 돌려 결과가 바뀌는 비율 | 자동(전체 2회 실행) |

### 4-4. 판정 기준 (제안)

1. **JSON 오류 0건**, 응답 시간 최대 **35초 이하**(Cloud Run AI 예산 45초 안, `AI_TOTAL_BUDGET_MS` 51행) — 못 넘으면 탈락.
2. 정확도가 **기준선(DeepSeek 또는 현재 운영값) 이상**.
3. 그중 가장 작은 모델 선택. 정확도 차이가 3%p 이내면 작은 쪽.
4. 재홍님 제안 "95% 이상"은 **기준선을 먼저 본 뒤** 정하는 것을 권합니다 — 현재 DeepSeek이 85%라면 95%는 모든 후보가 탈락하는 기준이 될 수 있습니다 [추정].
5. 용도별 혼용(추천=큰 모델, 뉴스 요약=작은 모델)은 4-6의 뉴스 시험 결과로 판단.

### 4-5. 실행 방식 (배포 없음)

- 시험 스크립트는 **새로 만들 OpenAI 호출 코드(`lib/materialSuggest.js`)와 실제 프롬프트 함수 `buildPrompt`를 그대로 불러** 씁니다 → 시험한 코드 = 배포할 코드.
- 실행 장소: **Cloud Shell**. OpenAI 키는 재홍님이 `read -s OPENAI_API_KEY`로 직접 입력(화면에 안 보임, 파일 저장 안 함).
- 호출 수: 6조합 × 60개 × 2회 = 720회. 조합별로 나눠 실행, 동시 5건 이하.
- 결과: Cloud Shell에 CSV + 요약표 출력(키·프롬프트 전문은 출력하지 않음).
- **1-다 측정 영향 없음 [추정 근거: 시험은 Cloud Shell → OpenAI 직접 호출이라 Cloud Run·Firestore·스케줄러를 거치지 않음].** 그래서 시험 자체는 11/6 이전에도 가능합니다.

### 4-6. 뉴스 관련성·요약 시험 (작게, 선택)

- 수집 로그에서 기사 30건(관련 15 / 무관 15, 재홍님 확인) → 같은 조합으로 `relevant` 판정 일치율·요약 길이·JSON 오류.
- 뉴스 수집은 호출 수가 가장 많아(`callAIBatch_` 40건씩, 1744·1755행) 작은 모델로 갈 수 있으면 이득이 큽니다.

## 5. 코드 변경 계획 (diff는 시험·모델 확정 후)

| 위치 | 변경 | 비고 |
|---|---|---|
| Code.gs `callAI_` 2114행 | `OPENAI` 갈래 → `callOpenAI_` | 모르는 값 → Gemini 대체 동작은 그대로 |
| Code.gs `buildAIRequest_` 2130행 | `OPENAI` 갈래(주소·키·모델) | 현재 DEEPSEEK이 아니면 전부 Gemini로 가는 구조라 **반드시 추가해야** 함 [확인] |
| Code.gs `parseAIResponse_` 2155행 | `OPENAI`를 DEEPSEEK과 같은 파싱으로 | 응답 모양 같음 |
| Code.gs 신규 `callOpenAI_` | `callDeepSeek_`(2239행) 복제, 주소·모델·키만 다름 | |
| `lib/materialSuggest.js` `makeAiCaller` 164행 | `OPENAI` 갈래 → `callOpenAI` | `callDeepSeek`(136행)과 같은 대기 상한·반환 모양 |
| 모델 이름 | 코드 상수 + 설정으로 바꿀 수 있게(`OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`) | 2027년 같은 모델 폐기 때 **설정만 바꾸면** 되도록 |
| 프롬프트 | **변경 없음** (`PROMPT_TEMPLATE_SHA256` 유지) | |
| 로그 | `provider`에 모델명·토큰 수 추가 | 토큰 효율 추적 |

**키 보관**
- Apps Script: 스크립트 속성 `OPENAI_API_KEY` — **재홍님이 편집기에서 직접 입력**(Claude는 속성 화면을 열지 않음).
- Cloud Run: Secret Manager `ai-openai-api-key` → 환경변수 `OPENAI_API_KEY`(`--set-secrets`). 기존 `ai-deepseek-api-key`와 같은 방식. 재홍님이 Cloud Shell에서 `read -s`로 입력해 만듦.
- 회사 키라면 OpenAI 쪽 프로젝트별 사용 한도 설정은 회사 담당자 확인 사항 [미확인].

**공급자 값과 기본값**
- `AI_PROVIDER = 'OPENAI'`.
- 코드 기본값(Code.gs GEMINI / Cloud Run DEEPSEEK)은 **바꾸지 않습니다.** 설정으로 전환하고, 되돌릴 때도 설정만 되돌리면 되게 하기 위해서입니다. DeepSeek·Gemini 갈래도 남겨 둡니다.

## 6. 진행 순서 (1-다 측정 오염 방지)

| 단계 | 시점 | 내용 | 1-다 영향 |
|---|---|---|---|
| ① | 지금 | 설계 승인, 샘플 60개 표 작성 → 재홍님 정답 표시 | 없음 |
| ② | 지금~11/6 | OpenAI 호출 코드 diff(배포 X, 커밋은 가능) | 없음 |
| ③ | 11/6 전후 가능 | Cloud Shell 비교 시험 → 모델 확정 | 없음 [추정] |
| ④ | **11/6~7 정리·재측정 후** | Cloud Run `suggestMaterialsTest`·`materialSweepTest` 재배포(새 Secret 연결, **AI_PROVIDER는 아직 DEEPSEEK**) | 재배포만, 동작 동일 |
| ⑤ | ④ 다음 | Cloud Run `AI_PROVIDER=OPENAI` 전환 → sweep 로그 1~2일 관찰 | 외부 전송량·sweep 시간 변화(측정 끝난 뒤라 무관) |
| ⑥ | ⑤ 확인 후 | Apps Script 스크립트 속성 `AI_PROVIDER=OPENAI`(뉴스 수집·요약 전환) | — |
| 되돌리기 | 언제든 | 설정값을 DEEPSEEK으로 되돌림(코드 재배포 불필요) | — |

## 7. 회귀 시험

- 기존: `materialsuggest_run_tests`, `stage4_sweep_tests`, `stage2_appsscript_tests`, `stage3_sheet_tests` 전부 통과 유지.
- 신규: OpenAI 갈래 — 정상 응답, HTTP 오류, 대기 초과, 빈 응답, 키 없음, `usage` 기록, 모르는 공급자 값.
- 프롬프트 지문 `PROMPT_TEMPLATE_SHA256` 불변 확인.

## 8. 결정 사항 (2026-11-04 재홍님 승인)

1. 시험 대상: **gpt-6-luna 추가, gpt-5.4-nano는 참고용**(채택 대상 아님).
2. 기준선: **DeepSeek 재실행(F)** — 키는 Secret Manager에서 변수로만 읽음(화면 출력 없음). 재홍님 정답표로 현재 운영값 정확도도 함께 확인.
3. 판정: ① JSON 오류 0 + 최대 35초 이하 → ② **기준선(DeepSeek) 대비 −3%p 이내** → ③ 통과한 것 중 가장 작은 모델.
4. 뉴스 관련성·요약 시험(4-6) 포함.
5. 비교 시험은 11/6 이전에 해도 됨(1-다 측정과 무관). 배포는 11/6~7 정리 이후.

### 샘플 변경
- 품목마스터 전체 100행 중 테스트용 6행·중복 1행을 뺀 **93개 전부**를 씁니다(4종류 15개씩 고르려 했으나 괄호 성분 품목이 8개뿐이라 전수로 변경). 유형: 일반 32 / 괄호 성분 8 / 화학제품명 28 / 규격·코드 25.
- 호출 수: 6조합 × 93개 × 2회 = 1,116회.

### 구현 파일
- `lib/materialSuggest.js`: `callOpenAI`, `makeAiCaller` OPENAI 갈래, 시도 로그에 `usage`(모델·토큰 수).
- `apps-script/Code.gs`: `callAI_`·`buildAIRequest_`·`parseAIResponse_` OPENAI 갈래, `openAIPayload_`·`callOpenAI_`.
- 설정(없으면 기본값 gpt-6-luna / low): Cloud Run 환경변수 `OPENAI_MODEL`·`OPENAI_REASONING_EFFORT`, Apps Script 스크립트 속성 같은 이름.
- 시험: `tests/openai_provider_tests.js`(가짜 호출), `tests/ai_model_compare.js`(Cloud Shell 실제 비교 실행기, 샘플은 저장소 밖).
