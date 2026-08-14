# Cloud Run 백엔드 (cloud-run)

## 이 폴더는 무엇인가

`Code.gs`(Apps Script) 기반 백엔드의 일부 API를 더 빠르게 만들기 위해 도입한 **신규 백엔드**입니다. 전체 기능을 옮기는 것이 아니라, **실제로 트래픽이 있고 안전하게 검증한 API만 하나씩** 이곳으로 옮기고 있습니다. 여기 없는 기능은 전부 여전히 `apps-script/Code.gs`가 처리합니다.

- **GCP 프로젝트**: `mro-market-intelligence`
- **리전**: `asia-northeast3` (서울)
- **런타임**: Node.js 20, Cloud Functions (2nd gen), HTTP 트리거, 인증 없이 호출 가능(`--allow-unauthenticated`) — 대신 각 함수 내부에서 `sessionToken`으로 자체 인증
- ⚠️ **Node.js 20은 2026-10-30에 지원 종료(decommission) 예정입니다.** 다음 배포부터는 `--runtime=nodejs22`로 올리는 것을 권장합니다 (아직 실행 안 함 — 별도 작업으로 진행 필요).

## 소스 구조

`cloud-run/mro-functions/`에 있는 **하나의 소스 디렉터리**에서 8개 함수가 모두 배포됩니다 (`index.js` 하나에 여러 개의 `exports.함수이름`이 있고, 배포 시 `--entry-point`로 어느 함수를 쓸지 지정하는 방식). 즉 폴더가 함수마다 나뉘어 있는 게 아니라, **소스 하나 + 진입점(entry point) 8개** 구조입니다.

의존 패키지(`package.json`): `@google-cloud/firestore`, `google-auth-library`. **환경변수나 Secret이 전혀 필요 없습니다** — Google Sheets 접근은 `google-auth-library`의 `GoogleAuth`가 Cloud Functions 실행 서비스 계정의 권한을 그대로 사용하고, Firestore도 마찬가지로 서비스 계정 IAM 권한만으로 동작합니다 (코드에 `process.env` 참조가 전혀 없음 — 직접 확인함).

## 함수별 목록

| 함수(entry point) | URL | 대응 Apps Script 함수 | 상태 | 설명 |
|---|---|---|---|---|
| `getTeamsTest` | `.../getTeamsTest` | (팀 목록 조회 로직) | ✅ **프로덕션에 실제 연동됨** (`index.html`) | 인증 불필요. 회원가입 화면 팀 선택 드롭다운에 사용 중 |
| `getSettingsTest` | `.../getSettingsTest` | `handleGetSettings_` | ✅ **프로덕션에 실제 연동됨** (`feed.html`) | POST + `sessionToken` 필요. 실패 시 프론트에서 자동으로 Apps Script로 폴백 |
| `getTeamManagersTest` | `.../getTeamManagersTest` | `handleGetTeamManagers_` | ⏸ 검증만 완료, 미연동 | 프론트에 이 기능을 호출하는 곳이 없음 (최상위 `README.md`의 "getTeamManagers 분석" 참고) |
| `whoamiTest` | `.../whoamiTest` | (로그인/세션 확인 로직) | 🧪 실험/성능 측정용 | 세션 조회 성능(콜드/웜 스타트) 검증에 사용. 프로덕션 미연동 |
| `sessionSyncTest` | `.../sessionSyncTest` | `syncSessionToCloudRun_`가 호출하는 대상 | ⚙️ 내부 동기화용 | Apps Script 로그인 성공 시 이 함수를 호출해 Firestore `sessions/{sessionToken}`에 세션을 미러링(이중 쓰기). 실패해도 로그인 자체에는 영향 없음 |
| `firestoreTest` | `.../firestoreTest` | 없음 | 🧪 진단용 | Firestore 연결 확인용 스캐폴딩. 공개 API가 아님 |
| `sheetPingTest` | `.../sheetPingTest` | 없음 | 🧪 진단용 | Google Sheets API 연결 확인용 스캐폴딩. 공개 API가 아님 |
| `pingTest` | `.../pingTest` | 없음 | 🧪 진단용 | 가장 단순한 헬스체크. 공개 API가 아님 |

> URL 전체 형식: `https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/<함수이름>`

## Firestore 구조

- 컬렉션 `sessions`, 문서 ID = `sessionToken`
- 필드: `email`(string), `createdAt`(Timestamp), `expiresAt`(Timestamp — 6시간 후 만료)
- Apps Script가 로그인 시 이 컬렉션에 세션을 기록하고(`sessionSyncTest` 경유), Cloud Run 함수들은 요청받은 `sessionToken`으로 이 컬렉션을 조회해 로그인 여부/만료 여부를 확인합니다.

## 배포 방법

```bash
cd cloud-run/mro-functions
gcloud functions deploy <함수이름> \
  --gen2 --runtime=nodejs20 --region=asia-northeast3 \
  --source=. --entry-point=<함수이름> \
  --trigger-http --allow-unauthenticated \
  --project=mro-market-intelligence --quiet
```

`<함수이름>`을 위 표의 entry point 중 하나로 바꿔서 실행합니다. `index.js`를 수정한 뒤에는, 그 코드를 실제로 사용하는 **모든** entry point를 각각 다시 배포해야 합니다 (하나의 파일을 여러 함수가 공유하기 때문).

## 롤백 방법

- **개별 API 트래픽 롤백**: 프론트엔드(`index.html`/`feed.html`)의 `CLOUD_RUN_..._URL` 상수를 빈 문자열로 바꾸면, 그 즉시 해당 API는 기존 Apps Script 경로로 되돌아갑니다. (가장 흔히 쓰는 방법)
- **함수 자체 롤백**: `gcloud functions deploy`는 매번 새 리비전을 만듭니다. Cloud Console → Cloud Functions → 해당 함수 → "리비전" 탭에서 이전 리비전으로 트래픽을 이동할 수 있습니다.
- **소스 롤백**: 이 저장소의 이전 커밋에 있는 `cloud-run/mro-functions/index.js`로 되돌린 뒤 다시 배포하면 됩니다.

## 앞으로 지켜야 할 원칙

1. **새 Cloud Run 함수를 만들거나 기존 함수를 수정하면, 반드시 이 저장소의 `cloud-run/mro-functions/index.js`도 함께 갱신해서 커밋합니다.** Cloud Run 콘솔에만 존재하고 GitHub에는 없는 코드가 생기지 않도록 합니다.
2. 실제 서비스에 연동하기 전에는 반드시: (1) 결과가 Apps Script와 동일한지 확인, (2) 인증/권한 체크가 정확한지 확인(관리자/일반 계정 등 여러 케이스), (3) 실패 시 자동으로 Apps Script로 되돌아가는 폴백 구조를 갖추기.
3. 진단용 함수(`pingTest`, `sheetPingTest`, `firestoreTest`)는 공개 API로 취급하지 않습니다 — 필요 없어지면 정리해도 됩니다.
