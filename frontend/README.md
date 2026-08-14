# 프론트엔드 (frontend)

이 문서는 프론트엔드를 설명하는 안내 문서이며, **실제 코드 파일은 이 폴더가 아니라 저장소 최상위(루트)에 있습니다.** GitHub Pages가 이 저장소를 "main 브랜치 / 루트(`/`) 폴더" 설정으로 서비스하기 때문입니다 (GitHub 저장소 Settings → Pages에서 확인 가능). `index.html`이 반드시 루트에 있어야 `https://nkmro.github.io/mro-market-intelligence/` 주소가 정상 동작하므로, 구조 정리 과정에서 실제 파일을 옮기지는 않았습니다.

## 실제 파일 위치 (저장소 루트)

| 파일 | 역할 |
|---|---|
| `/index.html` | 로그인 / 회원가입 / 비밀번호 재설정 화면. 로그인 성공 시 `sessionToken`을 받아 이후 모든 요청에 실어 보냄 |
| `/feed.html` | 로그인 후 메인 화면. 시황 뉴스 피드, 설정 화면, 품목/고객 관리, 팀 댓글 등 거의 모든 기능이 이 파일 하나에 있음 (매우 큰 파일) |
| `/sw.js` | PWA용 서비스워커 (오프라인/설치 지원) |
| `/manifest.json` | PWA 매니페스트 (앱 이름, 아이콘 등) |
| `/icon-192.png`, `/icon-512.png` | 앱 아이콘 |

## 백엔드 호출 방식 공통 구조

`index.html`과 `feed.html`은 각자 독립적으로 다음을 갖고 있습니다 (파일 간에 코드를 공유하지 않음 — 각 파일이 스스로 완결된 하나의 HTML 문서입니다):

- `GAS_URL` — Google Apps Script Web App의 URL. 모든 API 호출의 기본(레거시) 경로.
- `callApi(action, body)` — 재시도, idempotency key, 타임아웃, 지연 알림 등을 처리하는 공용 API 호출 함수. **이 함수 자체는 Cloud Run 전환 작업에서 건드리지 않습니다.**
- `CLOUD_RUN_<ACTION>_URL` 형태의 상수들 — 특정 action 하나를 Cloud Run으로 돌리기 위한 스위치. **빈 문자열로 바꾸면 즉시 기존 Apps Script 경로로 롤백됩니다.** 현재 존재하는 상수:
  - `index.html`: `CLOUD_RUN_GET_TEAMS_URL`
  - `feed.html`: `CLOUD_RUN_GET_SETTINGS_URL`

새로운 API를 Cloud Run으로 옮길 때는 항상 이 패턴을 따릅니다: (1) 상수 추가, (2) 해당 action의 호출부만 "상수가 있으면 Cloud Run, 없거나 실패하면 기존 callApi" 구조로 교체, (3) 기존 Apps Script 호출 코드는 절대 삭제하지 않음.

## 참고

- `feed.html`은 `sessionToken`을 담은 전역 `session` 객체를 갖고 있으며, 인증이 필요한 API를 Cloud Run으로 옮길 때는 이 토큰을 요청 본문에 실어 보내야 합니다 (Cloud Run 쪽은 이 토큰으로 Firestore에서 세션을 조회합니다).
- 프론트엔드를 정말로 `frontend/` 폴더로 옮기고 싶다면, GitHub Pages의 배포 방식을 "Deploy from a branch"에서 GitHub Actions 기반 커스텀 빌드로 바꿔야 합니다. 이는 별도의, 더 위험도가 높은 작업이므로 이번 구조 정리에는 포함하지 않았습니다.
