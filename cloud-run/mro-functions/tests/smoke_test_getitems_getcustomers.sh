#!/usr/bin/env bash
# getItemsTest/getCustomersTest 배포 후 smoke test 스크립트.
#
# smoke_test_logintest.sh와 같은 관례: 실제 배포된 Cloud Run 엔드포인트에 진짜 HTTP 요청을
# 보낸다. getItemsTest/getCustomersTest는 loginTest와 달리 로그인 자체가 아니라 로그인
# 이후의 sessionToken이 있어야 호출되므로, 먼저 loginTest로 로그인해서 sessionToken을 받은
# 다음 그 토큰으로 두 함수를 호출한다.
#
# 사용법:
#   TEST_EMAIL=... TEST_PASSWORD=... ./smoke_test_getitems_getcustomers.sh
# 필요하면 엔드포인트도 환경변수로 덮어쓸 수 있다(기본값은 실제 배포 URL):
#   LOGIN_ENDPOINT=... ITEMS_ENDPOINT=... CUSTOMERS_ENDPOINT=... TEST_EMAIL=... TEST_PASSWORD=... ./smoke_test_getitems_getcustomers.sh
#
# 비밀번호는 이 스크립트나 커밋에 절대 하드코딩하지 말 것 — 항상 환경변수로만 전달한다.
# 관리자 계정(ADMIN_EMAIL)으로 실행하면 getItemsTest의 관리자 전용 분기(팀 필터 없이 전체
# 조회)까지 함께 확인할 수 있다.
set -euo pipefail

LOGIN_ENDPOINT="${LOGIN_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest}"
ITEMS_ENDPOINT="${ITEMS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getItemsTest}"
CUSTOMERS_ENDPOINT="${CUSTOMERS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getCustomersTest}"
TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"

if [[ -z "$TEST_EMAIL" || -z "$TEST_PASSWORD" ]]; then
  echo "TEST_EMAIL, TEST_PASSWORD 환경변수를 설정하세요 (실제 로그인 가능한 계정)."
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

echo "=== 1. 로그인해서 sessionToken 받기 ==="
LOGIN_RESP=$(curl -sS -X POST "$LOGIN_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$(uuid)")")
echo "$LOGIN_RESP"
SESSION_TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sessionToken',''))")

if [[ -z "$SESSION_TOKEN" ]]; then
  echo "로그인 실패 - sessionToken을 못 받았습니다. 위 응답을 확인하세요."
  exit 1
fi
echo "sessionToken 획득: ${SESSION_TOKEN:0:8}...(생략)"

echo
echo "=== 2. getItemsTest 호출 ==="
curl -sS -X POST "$ITEMS_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s"}' "$SESSION_TOKEN")"
echo

echo
echo "=== 3. getCustomersTest 호출 ==="
curl -sS -X POST "$CUSTOMERS_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s"}' "$SESSION_TOKEN")"
echo
