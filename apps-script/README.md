# Apps Script 백엔드 (apps-script)

## 이 폴더는 무엇인가

`Code.gs`는 이 시스템의 **원래이자 지금도 대부분의 기능을 담당하는 백엔드**입니다. Google Apps Script Web App으로 배포되어 있고, 프론트엔드(`index.html`, `feed.html`)의 `callApi()`가 여기로 요청을 보냅니다.

이 폴더의 `Code.gs`는 **Google Apps Script 편집기에 있는 실제 코드의 미러(사본)입니다.** 즉, 실제로 코드를 수정하고 배포하는 곳은 여전히 Apps Script 편집기이며, 이 GitHub 파일은 "지금 운영 중인 코드가 무엇인지 기록/추적"하기 위한 것입니다. **Code.gs를 수정했다면, 이 파일도 최신 상태로 다시 동기화해 주세요** (그렇지 않으면 이 문서를 보는 사람/AI가 실제와 다른 코드를 보게 됩니다).

- **Apps Script 프로젝트**: "MRO 자재 시황 관리 시스템"
- **프로젝트 ID**: `1abBaoRibDm8UCe4C_inwRatU7clqoL5_JpV71Rq2D-2cmeprNyn9gvYe`
- **편집기 URL**: https://script.google.com/home/projects/1abBaoRibDm8UCe4C_inwRatU7clqoL5_JpV71Rq2D-2cmeprNyn9gvYe/edit
- **배포 형태**: Web App (`doPost(e)`가 모든 요청의 진입점, `action` 필드로 분기)

## 데이터베이스: Google Sheets

이 시스템의 실제 데이터베이스는 Google Sheets입니다. `Code.gs`가 사용하는 주요 시트:

| 시트 이름(한글) | 상수명 | 용도 |
|---|---|---|
| 사용자팀마스터 | `SHEET_USER` | 사용자 계정, 역할(일반/담당/팀장/임원), 소속팀, 활성 상태 |
| 설정 | `SHEET_SETTING` | 시스템 설정값 (키/값/설명) |
| 댓글확인이력 | `SHEET_THREAD_SEEN` | 댓글 읽음 처리 이력 |
| 댓글 | `SHEET_COMMENT` | 게시물 댓글 |
| 시황게시물 | `SHEET_POST` | 시황 뉴스/게시물 |
| 품목마스터 | `SHEET_ITEM` | 품목 정보 |

실제 시트 ID는 Script Properties의 `SHEET_ID`에 저장되어 있습니다 (코드에 하드코딩되어 있지 않음).

## Script Properties (이름만 — 실제 값은 절대 기록하지 않음)

Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성에서 아래 이름으로 값이 등록되어 있어야 정상 동작합니다. **아래 목록은 이름만 기록한 것이며, 실제 값은 여기에도, GitHub 어디에도 저장하지 않습니다.**

| 속성 이름 | 용도(추정) |
|---|---|
| `SHEET_ID` | 위 Google Sheets 문서의 ID |
| `GEMINI_API_KEY` | Google Gemini API 호출용 |
| `DEEPSEEK_API_KEY` | DeepSeek API 호출용 |
| `AI_PROVIDER` | 사용할 AI 제공자 선택 (Gemini/DeepSeek 등) |
| `NAVER_CLIENT_ID` | 네이버 뉴스 검색 API 클라이언트 ID |
| `NAVER_CLIENT_SECRET` | 네이버 뉴스 검색 API 시크릿 |
| `CATCHUP_TRIGGER_ID` | 특정 트리거(자동 실행) 식별자 |

> 참고: `ADMIN_EMAIL`(관리자 이메일)과 `BACKUP_PARENT_FOLDER_ID`(백업 저장용 Drive 폴더 ID)는 Script Properties가 아니라 코드에 직접 상수로 쓰여 있습니다. 비밀번호나 API Key 같은 "비밀값"은 아니지만, 내부 식별자가 코드에 노출되어 있다는 점은 참고해 주세요.

## 세션/인증 방식

- 로그인 성공 시 서버가 `sessionToken`을 발급하고, 이후 모든 요청은 이 토큰을 body에 실어 보냅니다.
- 세션은 기존에는 `CacheService`(Apps Script 자체 캐시)에만 저장되었으나, Cloud Run 전환을 위해 **로그인 시점에 Firestore에도 같은 세션을 동시에 기록**하도록 되어 있습니다 (`syncSessionToCloudRun_` 같은 이름의 best-effort 동기화 호출 — 실패해도 로그인 자체는 영향받지 않음). Cloud Run 쪽 함수들은 이 Firestore 세션을 조회해서 인증합니다.

## 배포 방법

1. Apps Script 편집기에서 `Code.gs`를 직접 수정합니다.
2. 상단 "배포" 버튼 → "배포 관리" 또는 "새 배포"로 Web App을 새로 배포합니다.
3. **배포가 끝나면, 이 저장소의 `apps-script/Code.gs`도 최신 코드로 다시 복사해 커밋해 주세요** (편집기에서 전체 선택 → 복사 → 이 파일에 붙여넣기).

## 롤백 방법

- **코드 롤백**: Apps Script 편집기 좌측의 시계 아이콘(버전 기록/실행 로그) 또는 "배포 관리"에서 이전 배포 버전으로 되돌릴 수 있습니다. 또는 이 저장소의 이전 커밋에 있는 `Code.gs` 내용을 다시 편집기에 붙여넣고 재배포하면 됩니다.
- **API 트래픽 롤백** (특정 기능만 Cloud Run에서 되돌리기): 이 파일이 아니라 프론트엔드(`index.html`/`feed.html`)의 `CLOUD_RUN_..._URL` 상수를 빈 문자열로 바꾸면 됩니다 — Apps Script 코드는 항상 그대로 남아있고 삭제되지 않으므로, Apps Script 자체를 롤백할 필요는 거의 없습니다.

## 현재 운영 상태

`Code.gs`는 계속 프로덕션에서 대부분의 API(로그인, 피드, 설정 변경, 품목/고객 관리 등)를 처리하는 **주 백엔드**입니다. `getTeams`, `getSettings` 두 개의 조회성 API만 Cloud Run으로 (자동/수동 롤백 가능한 형태로) 부분 전환되었고, 나머지는 전부 이 코드가 처리합니다.
