# pollSignal Cloud Run 이전 — 로직 비교 테스트 (1단계)

이 폴더는 실제 배포 코드가 아니라, `POLLSIGNAL_CLOUDRUN_TEST_RESULTS.md`에 정리된 로직 비교 테스트를 재실행하기 위한 스크립트입니다.

- `apps_script_ref.js` — Code.gs의 getRelatedItems_/canViewComment_/buildFeedEntry_/handlePollSignal_ 를 값 주입 방식으로 옮긴 기준 구현.
- `cloudrun_port.js` — 같은 로직을 독립적으로 다시 작성한 Cloud Run 포팅 초안(아직 실제 index.js에는 반영되지 않음).
- `run_tests.js` — 12개 시나리오에 동일한 입력을 넣어 두 구현을 비교. 실행: `node run_tests.js`
- `results.json` — 위 실행 결과 원본(2026-08-18 기준, 12개 전부 일치).

실제 사용자 계정·세션·시트 데이터는 전혀 사용하지 않았습니다(전부 손으로 만든 가상 데이터).
