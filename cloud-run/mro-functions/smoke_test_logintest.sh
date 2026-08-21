#!/usr/bin/env bash
# loginTest 배포 후 smoke test 스크립트.
#
# 아래 4개 변수만 채운 뒤 실행하세요:
#   ENDPOINT        - gcloud functions deploy 출력의 url (예: https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest)
#   TEST_EMAIL       - 활성 테스트 계정 이메일 (logintest.cloudrun@nkmro.com)
#   TEST_PASSWORD    - 위 계정의 실제 비밀번호(compute_login_hash.js에 넣었던 값)
#   INACTIVE_EMAIL   - 비활성 테스트 계정 이메일 (logintest.cloudrun.inactive@nkmro.com)
#
# 사용법: ENDPOINT=... TEST_EMAIL=... TEST_PASSWORD=... INACTIVE_EMAIL=... ./smoke_test_logintest.sh
# 또는 아래 변수 값을 직접 채워서 실행.
#
# 이 스크립트는 실제 배포된 Cloud Run 엔드포인트에 진짜 HTTP 요청을 보냅니다(합성 테스트
# 계정 대상이라 안전합니다). 실행 후 시트의 H열(failCount)이 올라가 있을 것이므로, 테스트가
# 끝나면 반드시 LOGIN_CLOUDRUN_DESIGN.md 8-4절대로 resetLoginFailCount_로 되돌려주세요.
set -euo pipefail

ENDPOINT="${ENDPOINT:-}"
TEST_EMAIL="${TEST_EMAIL:-logintest.cloudrun@nkmro.com}"
TEST_PASSWORD="${TEST_PASSWORD:-}"
INACTIVE_EMAIL="${INACTIVE_EMAIL:-logintest.cloudrun.inactive@nkmro.com}"

if [[ -z "$ENDPOINT" ]]; then
  echo "ENDPOINT 환경변수를 설정하세요 (예: export ENDPOINT=https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest)"
  exit 1
fi
if [[ -z "$TEST_PASSWORD" ]]; then
  echo "TEST_PASSWORD 환경변수를 설정하세요 (compute_login_hash.js에 넣었던 실제 비밀번호)."
  exit 1
fi

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    cat /proc/sys/kernel/random/uuid
  else
    python3 -c "import uuid; print(uuid.uuid4())"
  fi
}

call() {
  local desc="$1"; local body="$2"
  echo "----------------------------------------------------------------"
  echo "[$desc]"
  echo "요청 본문: $body"
  curl -sS -X POST "$ENDPOINT" -H 'Content-Type: application/json' -d "$body"
  echo
}

echo "=== 1. 정상 로그인 ==="
call "정상 로그인" "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$(uuid)")"

echo
echo "=== 2. 잘못된 비밀번호 1회 (failCount +1 기대) ==="
WRONG_KEY_1=$(uuid)
call "잘못된 비밀번호 1회" "$(printf '{"email":"%s","password":"wrong-password-1","idempotencyKey":"%s"}' "$TEST_EMAIL" "$WRONG_KEY_1")"

echo
echo "=== 3. 같은 idempotencyKey로 재요청 (캐시된 응답, failCount 추가 증가 없어야 함) ==="
call "같은 idempotencyKey 재요청" "$(printf '{"email":"%s","password":"wrong-password-1","idempotencyKey":"%s"}' "$TEST_EMAIL" "$WRONG_KEY_1")"

echo
echo "=== 4. 잘못된 비밀번호 4번 더 (다른 idempotencyKey, 누적 5회째 ACCOUNT_LOCKED 기대) ==="
for i in 2 3 4 5; do
  call "잘못된 비밀번호 시도 $i" "$(printf '{"email":"%s","password":"wrong-password-%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$i" "$(uuid)")"
done

echo
echo "=== 5. 비활성 계정 -> USER_INACTIVE 기대 ==="
call "비활성 계정" "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$INACTIVE_EMAIL" "$TEST_PASSWORD" "$(uuid)")"

echo
echo "=== 6. 존재하지 않는 사용자 -> USER_NOT_FOUND 기대 ==="
call "존재하지 않는 사용자" "$(printf '{"email":"no-such-user-%s@nkmro.com","password":"whatever","idempotencyKey":"%s"}' "$(uuid)" "$(uuid)")"

echo
echo "=== 7. idempotencyKey 누락 -> MISSING_IDEMPOTENCY_KEY(400) 기대 ==="
call "idempotencyKey 누락" "$(printf '{"email":"%s","password":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD")"

echo
echo "=== 8. (선택) 동시 요청으로 LOGIN_BUSY_RETRY 유도 — 타이밍에 따라 안 걸릴 수 있음 ==="
BUSY_KEY_A=$(uuid)
BUSY_KEY_B=$(uuid)
( call "동시 요청 A" "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$BUSY_KEY_A")" ) &
( call "동시 요청 B" "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$BUSY_KEY_B")" ) &
wait

echo
echo "=== 끝 — 이제 사용자팀마스터 시트에서 두 계정의 H열(failCount)을 확인하고, ==="
echo "===       테스트가 끝났으면 임시 Apps Script 함수로 resetLoginFailCount_를 호출해 0으로 되돌리세요. ==="
