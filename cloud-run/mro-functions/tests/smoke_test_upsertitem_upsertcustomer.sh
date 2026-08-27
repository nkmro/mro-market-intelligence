#!/usr/bin/env bash
# upsertItemTest/upsertCustomerTest 배포 후 smoke test 스크립트.
#
# ============================================================================
# 운영 데이터 보호 원칙 (설계 문서 UPSERTITEM_UPSERTCUSTOMER_CLOUDRUN_DESIGN.md
# 4번 "Smoke 테스트 계획" 기준, 2026-08-27) — 반드시 지킬 것
# ============================================================================
#   - 품목마스터/고객사마스터에는 postComment/updateComment/deleteComment 같은 진짜 삭제
#     API가 없다. 품목은 status를 '비활성'으로 바꾸는 소프트 삭제만 가능하고, 고객사는
#     그마저도 안 된다(status 컬럼 자체가 없음) — 한번 만들면 API로 되돌릴 방법이 없다.
#   - 그래서 이 스크립트는:
#     1. 품목명/자재코드에 SMOKETEST_/ZZTEST- 접두사 + 타임스탬프를 붙여, 실제 운영
#        데이터와 절대 혼동되지 않고 나중에 찾기 쉽게 만든다.
#     2. upsertItemTest로 "기존에 이미 있는 고객사"(TEST_CUSTOMER_NAME, 아래 참고)를 대상으로
#        신규 품목만 등록한다 — newCustomerCode를 쓰지 않으므로 고객사마스터는 전혀 건드리지
#        않는다.
#     3. 등록 직후 getItemsTest로 실제 시트에 반영됐는지 읽어서 확인한다.
#     4. 곧바로 같은 itemId로 status:'비활성' 수정을 호출해 소프트 삭제하고, 다시
#        getItemsTest로 비활성 전환을 확인한다. 스크립트가 끝까지 정상 실행되면 시트에는
#        "SMOKETEST_ 접두사가 붙은 비활성 품목 행 1개"만 흔적으로 남는다(완전히 지워지지는
#        않지만 목록 화면에서 비활성으로 표시되어 실사용에 지장이 없다).
#   - upsertCustomer 단독 정상 등록(신규 고객사 실제 생성)은 이 스크립트에서 절대 실행하지
#     않는다(설계 문서 4-3, 되돌릴 방법이 없고 현재 UI에도 이 액션의 단독 진입점이 없음).
#     upsertCustomer는 실제 쓰기가 없는 에러 경로(세션 없음/권한 없음/필드 누락)만 확인한다.
#   - 중간에 실패해서 스크립트가 조기 종료되면(set -e) 아래 안내를 참고해 직접 확인/정리할 것:
#       * "2. upsertItemTest 신규 등록" 단계 자체가 실패하면 시트에 아무것도 남지 않으므로
#         정리할 것이 없다.
#       * "2" 이후, "4. 소프트 삭제" 단계 전에 실패하면, 활성 상태의 SMOKETEST_ 품목이
#         하나 남는다 — 출력에 찍힌 MATERIAL_CODE를 기록해뒀다가, 나중에 이 스크립트를
#         MATERIAL_CODE만 아래처럼 고정해서 다시 실행하거나(3~4단계만 다시 타면 됨),
#         화면(UI)에서 직접 그 품목을 찾아 status를 '비활성'으로 바꿔주면 된다.
#       * "4. 소프트 삭제" 요청 자체는 보냈는데 응답이 불확실하면(네트워크 오류 등),
#         "5. 소프트 삭제 확인" 단계의 출력을 보고 실제 status가 무엇인지 확인할 것.
#
# ============================================================================
# 사전 조건
# ============================================================================
#   - loginTest, upsertItemTest, upsertCustomerTest, getItemsTest 4개 함수가 모두 Cloud
#     Run에 배포되어 있어야 한다(이 스크립트 자체는 배포를 수행하지 않는다).
#   - TEST_EMAIL/TEST_PASSWORD: role이 '팀장'인 실제 로그인 가능한 계정
#     (upsertItemTest/upsertCustomerTest 둘 다 팀장만 허용).
#   - TEST_MANAGER_NAME: TEST_EMAIL 계정과 같은 팀에 소속된 실제 '담당' role 사용자 이름
#     (upsertItem의 필수 필드인 manager에 들어간다 — 담당소장 검증 로직 때문에 아무 이름이나
#     넣으면 MANAGER_NOT_FOUND/MANAGER_NOT_IN_YOUR_TEAM으로 실패한다).
#   - TEST_CUSTOMER_NAME: 이미 고객사마스터에 존재하는 실제 고객사명(정확히 일치해야 함).
#     이 스크립트는 newCustomerCode를 쓰지 않으므로 반드시 기존 고객사여야 CUSTOMER_NOT_FOUND
#     없이 등록이 성공한다.
#   - (선택) TEST_EMAIL_2/TEST_PASSWORD_2: role이 '팀장'이 아닌 계정(FORBIDDEN 케이스 확인용).
#     지정하지 않으면 이 케이스만 SKIPPED로 표시하고 넘어간다.
#
# ============================================================================
# 사용법
# ============================================================================
#   TEST_EMAIL=... TEST_PASSWORD=... TEST_MANAGER_NAME=... TEST_CUSTOMER_NAME=... \
#     ./smoke_test_upsertitem_upsertcustomer.sh
#   (선택, 권한 오류 케이스까지 실행하려면)
#   TEST_EMAIL=... TEST_PASSWORD=... TEST_MANAGER_NAME=... TEST_CUSTOMER_NAME=... \
#     TEST_EMAIL_2=... TEST_PASSWORD_2=... ./smoke_test_upsertitem_upsertcustomer.sh
#   필요하면 엔드포인트도 환경변수로 덮어쓸 수 있다(기본값은 실제 배포 URL 패턴):
#   LOGIN_ENDPOINT=... UPSERT_ITEM_ENDPOINT=... UPSERT_CUSTOMER_ENDPOINT=... GET_ITEMS_ENDPOINT=...
#
# 비밀번호는 이 스크립트나 커밋에 절대 하드코딩하지 말 것 — 항상 환경변수로만 전달한다.
set -euo pipefail

LOGIN_ENDPOINT="${LOGIN_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest}"
UPSERT_ITEM_ENDPOINT="${UPSERT_ITEM_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/upsertItemTest}"
UPSERT_CUSTOMER_ENDPOINT="${UPSERT_CUSTOMER_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/upsertCustomerTest}"
GET_ITEMS_ENDPOINT="${GET_ITEMS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getItemsTest}"

TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"
TEST_MANAGER_NAME="${TEST_MANAGER_NAME:-}"
TEST_CUSTOMER_NAME="${TEST_CUSTOMER_NAME:-}"
TEST_EMAIL_2="${TEST_EMAIL_2:-}"
TEST_PASSWORD_2="${TEST_PASSWORD_2:-}"

if [[ -z "$TEST_EMAIL" || -z "$TEST_PASSWORD" || -z "$TEST_MANAGER_NAME" || -z "$TEST_CUSTOMER_NAME" ]]; then
  echo "TEST_EMAIL, TEST_PASSWORD, TEST_MANAGER_NAME, TEST_CUSTOMER_NAME 환경변수를 설정하세요."
  echo "  - TEST_EMAIL/TEST_PASSWORD: role이 '팀장'인 계정"
  echo "  - TEST_MANAGER_NAME: TEST_EMAIL과 같은 팀 소속의 실제 '담당' role 사용자 이름"
  echo "  - TEST_CUSTOMER_NAME: 고객사마스터에 이미 존재하는 실제 고객사명"
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

jget() {
  # 표준입력으로 받은 JSON에서 $1 키를 꺼낸다(없으면 빈 문자열).
  python3 -c "import sys,json
try:
    d = json.load(sys.stdin)
except Exception:
    print('')
else:
    v = d.get('$1', '')
    print(v if v is not None else '')"
}

jitem() {
  # 표준입력으로 받은 getItemsTest 응답 JSON의 items 배열에서 itemId=$1인 항목을 찾아
  # $2 필드를 출력한다(못 찾으면 빈 문자열).
  python3 -c "import sys,json
target_id, field = sys.argv[1], sys.argv[2]
try:
    d = json.load(sys.stdin)
    items = d.get('items') or []
    for it in items:
        if str(it.get('itemId','')) == target_id:
            print(it.get(field, ''))
            break
    else:
        print('')
except Exception:
    print('')
" "$1" "$2"
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || echo unknown)-$$"
ITEM_NAME="SMOKETEST_품목_${STAMP}"
MATERIAL_CODE="ZZTEST-${STAMP}"

echo "=== 이번 실행에서 사용할 테스트 품목 ==="
echo "  itemName(품목명)   = $ITEM_NAME"
echo "  materialCode(코드) = $MATERIAL_CODE"
echo "  customer(고객사)   = $TEST_CUSTOMER_NAME (기존 고객사, 새로 만들지 않음)"
echo "  manager(담당소장)  = $TEST_MANAGER_NAME"
echo

echo "=== 1. 로그인해서 sessionToken 받기 (계정: $TEST_EMAIL) ==="
LOGIN_RESP=$(curl -sS -X POST "$LOGIN_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$(uuid)")")
echo "$LOGIN_RESP"
SESSION_TOKEN=$(echo "$LOGIN_RESP" | jget sessionToken)
if [[ -z "$SESSION_TOKEN" ]]; then
  echo "로그인 실패 - sessionToken을 못 받았습니다. 위 응답을 확인하세요(계정의 role이 '팀장'인지도 확인)."
  exit 1
fi
echo "sessionToken 획득: ${SESSION_TOKEN:0:8}...(생략)"

echo
echo "=== 2. [정상 등록] upsertItemTest로 신규 품목 등록 (기존 고객사 대상, newCustomerCode 없음) ==="
CREATE_RESP=$(curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","customer":"%s","itemName":"%s","manager":"%s","materialCode":"%s","materials":["SMOKETEST 자동생성 - 삭제해도 무방"],"idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$TEST_CUSTOMER_NAME" "$ITEM_NAME" "$TEST_MANAGER_NAME" "$MATERIAL_CODE" "$(uuid)")")
echo "$CREATE_RESP"
CREATE_OK=$(echo "$CREATE_RESP" | jget ok)
CREATE_MODE=$(echo "$CREATE_RESP" | jget mode)
if [[ "$CREATE_OK" != "True" || "$CREATE_MODE" != "created" ]]; then
  echo "등록 실패 - ok:true, mode:created를 받지 못했습니다. 위 응답의 error 값을 확인하세요."
  echo "  (CUSTOMER_NOT_FOUND면 TEST_CUSTOMER_NAME 철자를, MANAGER_NOT_FOUND/MANAGER_NOT_IN_YOUR_TEAM이면"
  echo "   TEST_MANAGER_NAME이 TEST_EMAIL과 같은 팀의 '담당' role인지 확인하세요.)"
  echo "이 단계가 실패했으므로 시트에는 아무것도 남지 않았습니다 - 별도 정리는 필요 없습니다."
  exit 1
fi
echo "등록 성공: itemId=$MATERIAL_CODE"

echo
echo "=== 3. [등록 확인] getItemsTest로 실제 시트에 반영됐는지 읽어서 확인 (상태 '활성' 기대) ==="
LIST_RESP_1=$(curl -sS -X POST "$GET_ITEMS_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s"}' "$SESSION_TOKEN")")
FOUND_STATUS_1=$(echo "$LIST_RESP_1" | jitem "$MATERIAL_CODE" status)
FOUND_NAME_1=$(echo "$LIST_RESP_1" | jitem "$MATERIAL_CODE" itemName)
echo "itemId=$MATERIAL_CODE 조회 결과: itemName=\"$FOUND_NAME_1\", status=\"$FOUND_STATUS_1\""
if [[ "$FOUND_NAME_1" != "$ITEM_NAME" || "$FOUND_STATUS_1" != "활성" ]]; then
  echo "경고: 방금 등록한 품목을 getItemsTest 목록에서 기대한 값(itemName=$ITEM_NAME, status=활성)으로 찾지 못했습니다."
  echo "  (팀장 열람범위 설정에 따라 다른 팀 품목이 목록에서 제외될 수 있습니다 - 그 경우는 정상입니다.)"
fi

echo
echo "=== 4. [소프트 삭제] 같은 itemId로 status:'비활성' 수정 호출 ==="
DEACTIVATE_RESP=$(curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","itemId":"%s","customer":"%s","itemName":"%s","manager":"%s","materials":["SMOKETEST 자동생성 - 삭제해도 무방"],"status":"비활성","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$MATERIAL_CODE" "$TEST_CUSTOMER_NAME" "$ITEM_NAME" "$TEST_MANAGER_NAME" "$(uuid)")")
echo "$DEACTIVATE_RESP"
DEACTIVATE_OK=$(echo "$DEACTIVATE_RESP" | jget ok)
DEACTIVATE_MODE=$(echo "$DEACTIVATE_RESP" | jget mode)
if [[ "$DEACTIVATE_OK" != "True" || "$DEACTIVATE_MODE" != "updated" ]]; then
  echo "경고: 소프트 삭제(비활성화)가 ok:true, mode:updated를 반환하지 않았습니다."
  echo "  itemId=$MATERIAL_CODE 품목이 활성 상태로 남아있을 수 있으니 화면(UI)에서 직접 확인/수정하세요."
else
  echo "소프트 삭제 요청 성공(응답 기준)"
fi

echo
echo "=== 5. [소프트 삭제 확인] getItemsTest로 status가 실제로 '비활성'인지 재확인 ==="
LIST_RESP_2=$(curl -sS -X POST "$GET_ITEMS_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s"}' "$SESSION_TOKEN")")
FOUND_STATUS_2=$(echo "$LIST_RESP_2" | jitem "$MATERIAL_CODE" status)
echo "itemId=$MATERIAL_CODE 조회 결과: status=\"$FOUND_STATUS_2\""
if [[ "$FOUND_STATUS_2" == "비활성" ]]; then
  echo "확인됨: 소프트 삭제 정상 반영."
else
  echo "경고: status가 '비활성'으로 확인되지 않았습니다(\"$FOUND_STATUS_2\"). itemId=$MATERIAL_CODE를 화면(UI)에서 직접 확인하세요."
fi

echo
echo "=== 6. [에러 케이스] 아래부터는 전부 실제 쓰기가 없거나 이미 만든 품목의 중복만 확인합니다 ==="

echo
echo "--- 6-1. [세션 없음] sessionToken 없이 upsertItemTest 호출 -> MISSING_SESSION_TOKEN(HTTP 400) 기대 ---"
curl -sS -i -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"customer":"%s","itemName":"세션없이 시도","manager":"%s","materialCode":"ZZTEST-should-not-be-created","idempotencyKey":"%s"}' "$TEST_CUSTOMER_NAME" "$TEST_MANAGER_NAME" "$(uuid)")"
echo
echo

echo "--- 6-2. [필수값 누락] itemName 없이 upsertItemTest 호출 -> MISSING_FIELDS 기대 ---"
curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","customer":"%s","itemName":"","manager":"%s","materialCode":"ZZTEST-should-not-be-created","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$TEST_CUSTOMER_NAME" "$TEST_MANAGER_NAME" "$(uuid)")"
echo

echo
echo "--- 6-3. [존재하지 않는 고객사] 무작위 고객사명으로 신규 등록 시도 -> CUSTOMER_NOT_FOUND 기대 ---"
curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","customer":"SMOKETEST_존재하지않는고객사_%s","itemName":"%s","manager":"%s","materialCode":"ZZTEST-should-not-be-created","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$STAMP" "$ITEM_NAME" "$TEST_MANAGER_NAME" "$(uuid)")"
echo

echo
echo "--- 6-4. [자재코드 중복] 2단계에서 만든 MATERIAL_CODE로 다시 신규 등록 시도 -> MATERIAL_CODE_ALREADY_EXISTS 기대 ---"
curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","customer":"%s","itemName":"중복 시도","manager":"%s","materialCode":"%s","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$TEST_CUSTOMER_NAME" "$TEST_MANAGER_NAME" "$MATERIAL_CODE" "$(uuid)")"
echo

if [[ -n "$TEST_EMAIL_2" && -n "$TEST_PASSWORD_2" ]]; then
  echo
  echo "--- 6-5. [권한 없는 사용자] 다른 계정($TEST_EMAIL_2)으로 로그인 ---"
  LOGIN_RESP_2=$(curl -sS -X POST "$LOGIN_ENDPOINT" -H 'Content-Type: application/json' \
    -d "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL_2" "$TEST_PASSWORD_2" "$(uuid)")")
  echo "$LOGIN_RESP_2"
  SESSION_TOKEN_2=$(echo "$LOGIN_RESP_2" | jget sessionToken)
  if [[ -z "$SESSION_TOKEN_2" ]]; then
    echo "TEST_EMAIL_2 로그인 실패 - 6-6 단계(권한 없는 사용자 케이스)를 건너뜁니다."
  else
    echo
    echo "--- 6-6. [권한 없는 사용자] '팀장'이 아닌 계정으로 upsertItemTest 시도 -> FORBIDDEN 기대 ---"
    curl -sS -X POST "$UPSERT_ITEM_ENDPOINT" -H 'Content-Type: application/json' \
      -d "$(printf '{"sessionToken":"%s","customer":"%s","itemName":"권한없이 시도","manager":"%s","materialCode":"ZZTEST-should-not-be-created","idempotencyKey":"%s"}' \
        "$SESSION_TOKEN_2" "$TEST_CUSTOMER_NAME" "$TEST_MANAGER_NAME" "$(uuid)")"
    echo
    echo
    echo "--- 6-7. [권한 없는 사용자] '팀장'이 아닌 계정으로 upsertCustomerTest 시도 -> FORBIDDEN 기대 ---"
    curl -sS -X POST "$UPSERT_CUSTOMER_ENDPOINT" -H 'Content-Type: application/json' \
      -d "$(printf '{"sessionToken":"%s","name":"SMOKETEST_고객사_%s","code":"SMOKETEST-%s","manager":"%s","idempotencyKey":"%s"}' \
        "$SESSION_TOKEN_2" "$STAMP" "$STAMP" "$TEST_MANAGER_NAME" "$(uuid)")"
    echo
  fi
else
  echo
  echo "--- 6-5~6-7. [권한 없는 사용자] SKIPPED - TEST_EMAIL_2/TEST_PASSWORD_2가 설정되지 않았습니다 ---"
fi

echo
echo "=== 7. [upsertCustomerTest 에러 경로만 확인 - 실제 쓰기 없음] ==="

echo
echo "--- 7-1. [세션 없음] sessionToken 없이 upsertCustomerTest 호출 -> MISSING_SESSION_TOKEN(HTTP 400) 기대 ---"
curl -sS -i -X POST "$UPSERT_CUSTOMER_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"name":"세션없이 시도","code":"ZZTEST-should-not-be-created","idempotencyKey":"%s"}' "$(uuid)")"
echo
echo

echo "--- 7-2. [필수값 누락] code 없이 upsertCustomerTest 호출 -> MISSING_FIELDS 기대 ---"
curl -sS -X POST "$UPSERT_CUSTOMER_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","name":"이름만 있음","code":"","idempotencyKey":"%s"}' "$SESSION_TOKEN" "$(uuid)")"
echo

echo
echo "--- 7-3. [고객사명 중복] TEST_CUSTOMER_NAME(이미 존재)으로 신규 등록 시도 -> CUSTOMER_ALREADY_EXISTS 기대 ---"
curl -sS -X POST "$UPSERT_CUSTOMER_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","name":"%s","code":"ZZTEST-should-not-be-created","manager":"%s","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$TEST_CUSTOMER_NAME" "$TEST_MANAGER_NAME" "$(uuid)")"
echo

echo
echo "=== 완료 ==="
echo "itemId=$MATERIAL_CODE (itemName=\"$ITEM_NAME\")는 4~5단계에서 status:'비활성'으로 소프트 삭제됐습니다."
echo "삭제 API가 없어 시트에서 완전히 지워지지는 않지만(설계상 제약), 비활성 상태이므로 실사용에는 지장이 없습니다."
echo "upsertCustomerTest는 실제 쓰기가 있는 정상 등록 경로를 이 스크립트에서 실행하지 않았으므로 고객사마스터는"
echo "전혀 바뀌지 않았습니다. 위 각 단계 응답을 육안으로 확인하세요."
