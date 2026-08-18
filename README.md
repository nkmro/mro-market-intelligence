# MRO 자재 시황 관리 시스템 (mro-market-intelligence)

원자재/자재 시황 뉴스를 수집·정리해 팀원들에게 보여주는 사내 시스템입니다. 이 문서는 **새로운 AI 어시스턴트나 개발자가 이 저장소만 보고도 전체 구조를 이해할 수 있도록** 작성되었습니다.

## 한눈에 보는 구조

```
mro-market-intelligence/
├── index.html, feed.html, sw.js, manifest.json, icon-*.png   ← 프론트엔드 (GitHub Pages, 저장소 루트)
├── apps-script/        ← Google Apps Script 백엔드 소스 (Code.gs, 미러 사본)
├── cloud-run/          ← Google Cloud Run 백엔드 소스 (신규, 일부 API만 이전 중)
└── README.md           ← 이 문서
```

> **2026-08-18 업데이트**: `apps-script/Code.gs`, `apps-script/appsscript.json`, `cloud-run/mro-functions/*`(index.js·package.json·package-lock.json·fix.py·fix2.py) 실제 소스 파일을 이 저장소에 처음으로 커밋했습니다. 지금까지는 README만 있고 실제 코드는 Apps Script 편집기/GCP 콘솔에만 있었는데, 이제 GitHub에서도 실제 코드를 볼 수 있습니다. (세부 사항은 각 하위 README 참고.)

**왜 프론트엔드 파일이 `frontend/` 폴더가 아니라 저장소 최상위에 있나요?**
GitHub Pages가 이 저장소를 "main 브랜치 / 루트(`/`) 폴더" 설정으로 서비스하고 있습니다 (Settings → Pages에서 확인). 즉 `index.html`이 반드시 루트에 있어야만 `https://nkmro.github.io/mro-market-intelligence/`가 정상 동작합니다. 만약 이 파일들을 `frontend/`로 옮기면 실제 서비스 URL이 전부 깨집니다. 그래서 구조 정리 단계에서는 **실제 파일을 옮기지 않고, 문서로만 "프론트엔드 영역"을 표시**했습니다 (`frontend/README.md` 참고). 나중에 GitHub Actions 기반 Pages 배포로 전환하면 실제로 옮길 수 있습니다 — 이건 별도의, 더 큰 작업입니다.

## 전체 아키텍처

```
[사용자 브라우저]
      │  (index.html: 로그인/회원가입, feed.html: 시황 피드/설정/관리)
      ▼
[callApi()]  ┸  프론트 공용 함수]
      │
      ├── 기존 경로 (전체 API의 기본 경로) ──────────────► [Google Apps Script Web App] ─┐
      │                                                     (Code.gs, doPost)              │
      └── 신규 경로 (getTeams·getSettings만, 상수로 켜짐) ─► [Google Cloud Run 함수들]      │
                                                             (cloud-run/mro-functions)       │
                                                                     │                        │
                                                                     ▼                        ▼
                                                          [Firestore: sessions]      [Google Sheets — 실제 DB]
                                                          (Cloud Run용 세션 미러)      (사용자팀마스터, 설정,
                                                                                        시황게시물, 품목마스터 등)
```

- **Google Sheets가 실제 데이터베이스입니다.** 사용자 계정(사용자팀마스터), 설정값(설정), 시황 게시물, 품목, 고객, 댓글 등 모든 데이터가 스프레드시트에 저장됩니다.
- **Google Apps Script(Code.gs)가 지금까지의 유일한 백엔드였고, 지금도 대부분의 기능을 담당합니다.** 로그인/회원가입, 피드, 설정 변경, 항목 관리, 고객 관리 등 전부 여기서 처리됩니다.
- **Google Cloud Run은 Apps Script의 느린 응답(특히 CacheService 기반 세션 조회)을 개선하기 위해 최근 도입된 신규 백엔드입니다.** 전체 기능을 옮기는 게 아니라, **실제로 트래픽이 있고 안전하게 검증 가능한 API부터 하나씩** Cloud Run으로 옮기고 있습니다. Cloud Run은 세션을 Apps Script의 캐시가 아니라 Firestore에서 조회합니다 (Apps Script 로그인 시 Firestore에도 세션을 같이 기록하는 "이중 쓰기" 방식으로 동기화).
- **전환 원칙(중요): 기존 Apps Script 코드는 절대 삭제하지 않습니다.** 프론트엔드에는 `CLOUD_RUN_..._URL`이라는 이름의 상수가 있고, 이 상수가 채워져 있으면 Cloud Run을 먼저 시도하고, 비어 있으면(혹은 실패하면) 기존 Apps Script로 자동/수동 롤백됩니다.

## API 매핑표 (프론트 호출 → 백엔드 대응)

| 프론트 함수(파일) | action 이름 | Cloud Run 전환 상태 | Apps Script 대응 함수 | 비고 |
|---|---|---|---|---|
| `loadTeamOptions()` (index.html, 회원가입 팀 선택) | `getTeams` | ✅ 전환됨 (`CLOUD_RUN_GET_TEAMS_URL`) | `handleGetTeams_` (또는 동일 로직) | 인증 불필요, 실서비스 검증 완료 (결과 100% 동일, clientMs 개선 확인) |
| `loadIdleTimeoutSetting()`, `loadSettingsPage()` (feed.html) | `getSettings` | ✅ 전환됨 (`CLOUD_RUN_GET_SETTINGS_URL`), 실패 시 자동 Apps Script 폴백 | `handleGetSettings_` | 세션 인증 필요 (Firestore 세션 조회 → Sheets 읽기). ok:false·오류·타임아웃 등 모든 실패 시 자동 폴백 |
| (프론트 호출 지점 없음) | `getTeamManagers` | ⏸ 보류 (Cloud Run에 `getTeamManagersTest`는 배포·검증되어 있으나 프론트에서 부르는 곳이 없음) | `handleGetTeamManagers_` | 아래 "getTeamManagers 분석" 참고 — 사실상 미사용/대체된 기능으로 판단됨 |
| `handleLogin_()` / 로그인 폼 | `login` | 📋 계획 수립 완료, 승인 대기 (`LOGIN_WHOAMI_MIGRATION_PLAN.md` 참고) | `handleLogin_` | 가장 민감한 기능 — 세션 발급 자체를 통째로 옮기면 다른 대부분 기능(CacheService 인증)이 깨짐. 1단계(Firestore 세션 슬라이딩)·2단계(whoami 신설)만 우선 승인 요청, 3단계(login 자체 이전)는 보류 |
| 피드 로딩 전체 | `getPostById`, `getAttentionPosts` 등 다수 | ⏳ 미착수 | 다수의 `handle*_` 함수 | 가장 무겁고 복잡한 영역, 가장 마지막에 이전 예정 |
| 그 외 모든 action (`getUsers`, `updateUser`, `getItems`, `getCustomers`, `upsertCustomer`, `changePassword`, `getThreadSeen`, `markThreadSeen`, `updateSettings` 등) | 다수 | ⏳ 미착수 | `Code.gs`의 각 `handle*_` 함수 | 아직 전부 Apps Script 경로만 사용 |

> 이 표는 `getTeams`·`getSettings` 전환이 완료된 시점(2026-08-14) 기준입니다. 새로운 API를 전환할 때마다 이 표를 함께 갱신해 주세요.

## getTeamManagers 분석 (2026-08-14)

`getTeamManagers`는 Code.gs에도 있고 Cloud Run(`getTeamManagersTest`)에도 이미 만들어져 검증까지 되어 있지만, **실제 프론트엔드(`index.html`, `feed.html`) 어디에서도 호출되지 않습니다.**

조사 결과, 이 기능이 하려던 일(팀장이 자기 팀의 "담당" 역할 사용자 목록을 보는 것)은 **이미 다른 방식으로 살아서 동작하고 있습니다.** `feed.html`의 품목 관리 화면(담당자 배정 드롭다운)은 `getUsers` API를 호출한 뒤, 그 결과를 프론트엔드에서 `team === 내팀 && status === '활성' && role === '담당'` 조건으로 직접 필터링해서 씁니다 — 이는 `handleGetTeamManagers_`가 서버에서 하는 필터링과 완전히 동일한 로직입니다. 즉 `getTeamManagers`는 **중복 구현이며, 지금은 죽은 코드(dead code)**로 보입니다.

결론: 실사용 기능은 이미 `getUsers` 경로로 정상 동작 중이므로, `getTeamManagers`를 위해 새 화면을 만들 필요는 없어 보입니다. 다만 최종 판단은 실제 업무 담당자가 하는 것이 안전합니다.

## 보안 정책 (반드시 지킬 것)

**API Key, 비밀번호, 실제 Secret 값 등 민감한 정보는 절대 GitHub에 저장하지 않습니다.** 이 저장소의 모든 README에는 Secret의 **이름**만 적혀 있고, 실제 값은 각 서비스의 안전한 저장소(Apps Script Script Properties / Cloud Run 서비스 계정 IAM 권한)에만 존재합니다.

## 하위 문서

- [`frontend/README.md`](./frontend/README.md) — 프론트엔드 파일 목록과 역할, 실제 위치에 대한 설명
- [`apps-script/README.md`](./apps-script/README.md) — Apps Script 백엔드: 배포 방법, Script Properties 목록(이름만), 롤백 방법
- [`cloud-run/README.md`](./cloud-run/README.md) — Cloud Run 함수별 URL, 프로젝트/리전, 상태, 배포/롤백 방법
- [`NODE22_UPGRADE_REPORT.md`](./NODE22_UPGRADE_REPORT.md) — Node.js 20→22 업그레이드 함수별 결과 보고 (2026-08-18)
- [`LOGIN_WHOAMI_MIGRATION_PLAN.md`](./LOGIN_WHOAMI_MIGRATION_PLAN.md) — login/whoami Cloud Run 전환 상세 계획 (분석·계획 단계, 승인 대기)
