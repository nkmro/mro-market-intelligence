# Node.js 20 → 22 업그레이드 결과 보고 (2026-08-18)

이 문서는 `cloud-run/mro-functions`의 8개 Cloud Run 함수를 Node.js 20에서 Node.js 22로 업그레이드한 작업의 결과를 정리한 것입니다. 업그레이드 배경/근거는 `cloud-run/README.md`의 런타임 섹션을 참고하세요.

## 진행 방식

사용자 지시대로 다음 순서로 하나씩 배포·검증했습니다.

1. 진단/단순 함수: `pingTest` → `sheetPingTest` → `firestoreTest` → `sessionSyncTest` → `whoamiTest` → `getTeamManagersTest`
2. 실제 트래픽이 있는 함수: `getTeamsTest` → `getSettingsTest`

각 함수는 배포 직후 실제 요청을 보내(진단 함수는 그 자체 호출, 세션이 필요한 함수는 합성 테스트 세션 `node22upgrade-verify-baseline` / 존재하지 않는 이메일 `qa-node22-upgrade-test@nkmro.invalid` 사용) 업그레이드 전(Node.js 20) 베이스라인과 응답을 비교했습니다. 검증에 사용한 합성 Firestore 세션 문서는 작업 종료 후 삭제해 프로덕션 데이터에 남지 않도록 했습니다.

## 함수별 결과

| 함수 | Node.js 버전 | 배포 상태 | 테스트 결과 | 문제 여부 | 롤백 방법 |
|---|---|---|---|---|---|
| `pingTest` | 22 (업그레이드 완료) | ✅ 소스 빌드·서비스 업데이트·버전 생성·트래픽 라우팅 4단계 모두 성공. 신규 버전 `pingtest-00002-fwx`가 트래픽 100% | 업그레이드 전과 동일한 단순 pong 응답 확인 | 없음 | 콘솔 → `pingtest` → "버전" 탭 → `pingtest-00001-sax`(Node 20, 트래픽 0%로 보존됨— 2026-08-18 재확인)로 트래픽 이동 |
| `sheetPingTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 | Sheets 연결 확인 응답이 베이스라인과 동일 | 없음 | 콘솔 → `sheetpingtest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동 |
| `firestoreTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 | Firestore 연결/쓰기 확인 응답이 베이스라인과 동일 | 첫 호출에서 콜드 스타트로 인한 writeMs 소폭 증가 관찰(기능 이상 아님, 재호출 시 정상 범위) | 콘솔 → `firestoretest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동 |
| `sessionSyncTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 | 합성 세션 토큰으로 Firestore `sessions` 문서 기록 성공, 베이스라인과 동일 | 없음 | 콘솔 → `sessionsynctest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동 |
| `whoamiTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 | 합성 세션으로 조회 시 이메일·만료 여부 정상 반환, 베이스라인과 동일 | 응답의 `timings.sessionMs` 필드가 브라우저 도구의 민감정보 필터에 의해 한 차례 `[BLOCKED: Sensitive key]`로 치환되어 보였음 — 실제 서버 응답 자체의 문제가 아니라 제 쪽 도구의 필터링 동작이며, 기능적으로는 문제 없음 | 콘솔 → `whoamitest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동 |
| `getTeamManagersTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 | 베이스라인과 동일한 팀장 목록 반환 (참고: 이 API는 프론트엔드에서 호출되지 않는 미사용 상태 — 최상위 README의 "getTeamManagers 분석" 참고) | 없음 | 콘솔 → `getteammanagerstest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동 |
| `getTeamsTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공 (실제 프론트엔드 `index.html`에서 사용 중인 프로덕션 함수) | 팀 목록 결과가 베이스라인과 100% 동일 | 없음 | 콘솔 → `getteamstest` → "버전" 탭에서 이전 Node 20 리비전으로 트래픽 이동. 또는 `index.html`의 `CLOUD_RUN_GET_TEAMS_URL` 상수를 비워 Apps Script 경로로 즉시 폴백 가능 |
| `getSettingsTest` | 22 (업그레이드 완료) | ✅ 4단계 모두 성공. 신규 버전 `getsettingstest-00002-f8d`가 트래픽 100% (실제 프론트엔드 `feed.html`에서 사용 중인 프로덕션 함수) | 설정값 조회 결과가 베이스라인과 100% 동일 | 없음 | 콘솔 → `getsettingstest` → "버전" 탭 → `getsettingstest-00001-zah`(Node 20, 트래픽 0%로 보존됨 — 2026-08-18 재확인)로 트래픽 이동. 또는 `feed.html`의 `CLOUD_RUN_GET_SETTINGS_URL` 상수를 비워 Apps Script 경로로 즉시 폴백 가능 (이미 자동 폴백 로직도 있음) |

## 롤백 관련 확인 사항

- **직접 재확인함(2026-08-18, 콘솔 "버전" 탭)**: `pingTest`, `getSettingsTest` 두 함수는 이전 Node.js 20 리비전(`pingtest-00001-sax`, `getsettingstest-00001-zah`)이 삭제되지 않고 트래픽 0%로 남아 있음을 화면에서 직접 확인했습니다.
- **나머지 6개 함수**는 동일한 배포 방식(`gcloud functions deploy`는 항상 새 리비전을 추가만 하고 기존 리비전을 자동 삭제하지 않음)을 사용했고 배포 중 리비전 삭제 작업을 하지 않았으므로 마찬가지로 이전 Node 20 리비전이 남아있을 것으로 판단되지만, 8개 전부를 개별적으로 화면 캡처하며 재확인하지는 않았습니다. 필요하시면 나머지 6개도 동일하게 "버전" 탭에서 확인해드릴 수 있습니다.

## 다른 진행 중 작업과의 관계

이번 Node.js 22 업그레이드는 다음 두 작업의 진행을 막지 않았습니다.

1. **Code.gs / Cloud Run 실제 소스의 GitHub 정식 커밋**: 로컬 저장소(`/tmp/repo`, `main` 브랜치)에 커밋까지는 완료되어 있으나(`9b3e682`, `82d2adf`), `git push`가 샌드박스의 git 프록시에 의해 `access denied ... not in this session's authorized repository set`로 계속 차단되고 있습니다. 이 저장소를 세션의 승인된 저장소 목록에 추가해 주셔야 진행할 수 있습니다.
2. **login/whoami Cloud Run 전환 상세 계획**: 아직 시작하지 않았습니다. 위 GitHub 커밋/푸시 문제와 무관하게 이어서 진행하겠습니다.

"댓글 기능 분석"은 기존 합의대로 이번에도 손대지 않았습니다.
