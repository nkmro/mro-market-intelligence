#!/usr/bin/env bash
# updateUserTest / changePasswordTest / updateSettingsTest 스모크 테스트
#
# [운영 데이터 보호 원칙 — 반드시 읽어주세요]
# 이 스크립트는 다음 세 종류의 실제 쓰기를 수행하지만, 모두 스크립트 안에서 즉시 원상복구합니다.
#   1) updateUser  : 테스트 계정(TEST_EMAIL)의 "이름"만 SMOKETEST_ 접두사로 잠깐 바꿨다가,
#                     같은 스크립트 안에서 즉시 원래 이름으로 되돌립니다. 실제 팀원 계정은
#                     전혀 건드리지 않습니다.
#   2) changePassword: 테스트 계정(TEST_EMAIL)의 비밀번호를 임시 비밀번호로 바꿨다가, 같은
#                     스크립트 안에서 즉시 원래 비밀번호(TEST_PASSWORD)로 되돌립니다.
#   3) updateSettings: 실제 설정 값을 "읽어서 그 값 그대로 다시 쓰는" no-op 왕복만 합니다 —
#                     실제로 바뀌는 값은 없습니다.
# 이 세 함수 중 updateUser/updateSettings는 Code.gs 원본부터 "관리자 이메일 1명"에게만
# 허용되어 있어(역할 기반이 아님), 성공 경로 테스트는 재홍님의 실제 관리자 계정
# (jhjoo@nkmro.com)으로 로그인해야만 확인할 수 있습니다 — 별도의 "테스트용 관리자 계정"을
# 만들 수 없습니다. 관리자 비밀번호는 이 스크립트가 요구하는 환경변수(ADMIN_PASSWORD)를 통해
# 터미널에서만 입력되고, 어디에도 저장/출력되지 않습니다.
#
# 스크립트가 중간에 실패하면(예: Ctrl+C, 네트워크 오류): 아래 "정리 방법"을 참고하세요.
#   - updateUser 단계 실패: TEST_EMAIL 계정의 이름이 SMOKETEST_ 접두사로 남아있을 수 있습니다.
#     getUsersTest/사용자 관리 화면에서 직접 확인 후, 필요하면 원래 이름으로 되돌려주세요.
#   - changePassword 단계 실패: TEST_EMAIL 계정의 비밀번호가 임시 비밀번호로 남아있을 수
#     있습니다. 이 스크립트가 출력하는 임시 비밀번호 값을 기록해두었다가, 필요하면 그 값으로
#     로그인해서 다시 원래 비밀번호로 변경해주세요.
#   - updateSettings 단계는 애초에 값을 바꾸지 않으므로(no-op) 정리할 것이 없습니다.
#
# 사용법(필수 환경변수):
#   ADMIN_PASSWORD   : 재홍님의 실제 로그인 비밀번호(jhjoo@nkmro.com). updateUser/updateSettings
#                       성공 경로 테스트에만 사용됩니다.
#   TEST_EMAIL       : 기존 스모크 테스트에서 쓰던 테스트 계정 이메일(예: upsertItem 테스트 때
#                       쓴 계정을 그대로 재사용).
#   TEST_PASSWORD    : 위 테스트 계정의 현재 비밀번호.
# 선택 환경변수:
#   TEST_EMAIL_2 / TEST_PASSWORD_2 : 관리자가 아닌 두 번째 계정(FORBIDDEN 케이스 확인용, 없으면
#                       해당 케이스만 건너뜁니다 — TEST_EMAIL 자체가 이미 비관리자이므로 없어도
#                       핵심 검증에는 지장 없습니다. upsertItem 스모크 테스트 때 쓰던 것과 동일한
#                       변수라 이미 값이 있다면 그대로 재사용하시면 됩니다).
#
# 실행: bash cloud-run/mro-functions/tests/smoke_test_updateuser_changepassword_updatesettings.sh

set -euo pipefail

LOGIN_ENDPOINT="${LOGIN_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest}"
GET_USERS_ENDPOINT="${GET_USERS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getUsersTest}"
GET_SETTINGS_ENDPOINT="${GET_SETTINGS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/getSettingsTest}"
UPDATE_USER_ENDPOINT="${UPDATE_USER_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/updateUserTest}"
CHANGE_PASSWORD_ENDPOINT="${CHANGE_PASSWORD_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/changePasswordTest}"
UPDATE_SETTINGS_ENDPOINT="${UPDATE_SETTINGS_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/updateSettingsTest}"

ADMIN_EMAIL_FOR_TEST="jhjoo@nkmro.com" # Code.gs/index.js의 ADMIN_EMAIL 상수와 동일(고정값)

if [ -z "${ADMIN_PASSWORD:-}" ] || [ -z "${TEST_EMAIL:-}" ] || [ -z "${TEST_PASSWORD:-}" ]; then
  echo "사용법: ADMIN_PASSWORD, TEST_EMAIL, TEST_PASSWORD 환경변수를 먼저 설정한 뒤 실행하세요." >&2
  echo "예:" >&2
  echo "  export ADMIN_PASSWORD='실제 관리자 비밀번호'" >&2
  echo "  export TEST_EMAIL='기존 테스트 계정 이메일'" >&2
  echo "  export TEST_PASSWORD='기존 테스트 계정 비밀번호'" >&2
  exit 1
fi

uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    python3 -c "import uuid; print(uuid.uuid4())"
  fi
}

# 표준입력으로 받은 JSON에서 최상위 key 하나를 추출. 파싱 실패/키 없음이면 빈 문자열.
jget() {
  local key="$1"
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    v = data.get('$key', '')
    print(v if v is not None else '')
except Exception:
    print('')
"
}

# getUsersTest 응답 JSON(표준입력)에서 email이 일치하는 사용자 하나를 찾아 지정한 필드를 출력.
# $1 = 대상 email, $2 = 필드명(row/name/role/team/status). 못 찾거나 파싱 실패면 빈 문자열.
juser() {
  local target_email="$1"
  local field="$2"
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    target = '$target_email'.strip().lower()
    for u in data.get('users', []):
        if str(u.get('email', '')).strip().lower() == target:
            v = u.get('$field', '')
            print(v if v is not None else '')
            sys.exit(0)
    print('')
except Exception:
    print('')
"
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"

echo "=== 0. 설정 확인 ==="
echo "LOGIN_ENDPOINT           = ${LOGIN_ENDPOINT}"
echo "GET_USERS_ENDPOINT       = ${GET_USERS_ENDPOINT}"
echo "GET_SETTINGS_ENDPOINT    = ${GET_SETTINGS_ENDPOINT}"
echo "UPDATE_USER_ENDPOINT     = ${UPDATE_USER_ENDPOINT}"
echo "CHANGE_PASSWORD_ENDPOINT = ${CHANGE_PASSWORD_ENDPOINT}"
echo "UPDATE_SETTINGS_ENDPOINT = ${UPDATE_SETTINGS_ENDPOINT}"
echo "관리자 계정(고정)        = ${ADMIN_EMAIL_FOR_TEST}"
echo "테스트 계정              = ${TEST_EMAIL}"
echo

echo "=== 1. 관리자 로그인 (${ADMIN_EMAIL_FOR_TEST}) ==="
ADMIN_LOGIN_RESP=$(curl -sS -X POST "${LOGIN_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${ADMIN_EMAIL_FOR_TEST}\",\"password\":\"${ADMIN_PASSWORD}\",\"idempotencyKey\":\"$(uuid)\"}")
ADMIN_OK=$(echo "${ADMIN_LOGIN_RESP}" | jget ok)
ADMIN_SESSION=$(echo "${ADMIN_LOGIN_RESP}" | jget sessionToken)
if [ "${ADMIN_OK}" != "True" ] || [ -z "${ADMIN_SESSION}" ]; then
  echo "실패: 관리자 로그인에 실패했습니다. 비밀번호를 확인해주세요." >&2
  echo "응답: ${ADMIN_LOGIN_RESP}" >&2
  exit 1
fi
echo "-> 관리자 로그인 성공"
echo

echo "=== 2. 테스트 계정(${TEST_EMAIL}) 로그인 ==="
TEST_LOGIN_RESP=$(curl -sS -X POST "${LOGIN_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"idempotencyKey\":\"$(uuid)\"}")
TEST_OK=$(echo "${TEST_LOGIN_RESP}" | jget ok)
TEST_SESSION=$(echo "${TEST_LOGIN_RESP}" | jget sessionToken)
if [ "${TEST_OK}" != "True" ] || [ -z "${TEST_SESSION}" ]; then
  echo "실패: 테스트 계정 로그인에 실패했습니다. TEST_EMAIL/TEST_PASSWORD를 확인해주세요." >&2
  echo "응답: ${TEST_LOGIN_RESP}" >&2
  exit 1
fi
echo "-> 테스트 계정 로그인 성공"
echo

echo "=== 3. updateUser — 테스트 계정 row 조회(관리자 세션으로) ==="
ADMIN_USERS_RESP=$(curl -sS -X POST "${GET_USERS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\"}")
TEST_ROW=$(echo "${ADMIN_USERS_RESP}" | juser "${TEST_EMAIL}" row)
ORIGINAL_NAME=$(echo "${ADMIN_USERS_RESP}" | juser "${TEST_EMAIL}" name)
ORIGINAL_ROLE=$(echo "${ADMIN_USERS_RESP}" | juser "${TEST_EMAIL}" role)
ORIGINAL_TEAM=$(echo "${ADMIN_USERS_RESP}" | juser "${TEST_EMAIL}" team)
ORIGINAL_STATUS=$(echo "${ADMIN_USERS_RESP}" | juser "${TEST_EMAIL}" status)
if [ -z "${TEST_ROW}" ]; then
  echo "실패: getUsersTest 응답에서 테스트 계정(${TEST_EMAIL})을 찾지 못했습니다." >&2
  echo "응답: ${ADMIN_USERS_RESP}" >&2
  exit 1
fi
echo "-> 테스트 계정 row=${TEST_ROW}, 현재 이름='${ORIGINAL_NAME}' (백업 완료, 나중에 이 값으로 복구합니다)"
echo

echo "=== 4. updateUser — 이름을 SMOKETEST_로 임시 변경 ==="
NEW_NAME="SMOKETEST_${STAMP}"
UPDATE_NAME_RESP=$(curl -sS -X POST "${UPDATE_USER_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"row\":${TEST_ROW},\"name\":\"${NEW_NAME}\"}")
UPDATE_NAME_OK=$(echo "${UPDATE_NAME_RESP}" | jget ok)
if [ "${UPDATE_NAME_OK}" != "True" ]; then
  echo "실패: 이름 임시 변경(updateUser)이 실패했습니다 — 테스트 계정은 그대로이므로 정리할 것이 없습니다." >&2
  echo "응답: ${UPDATE_NAME_RESP}" >&2
  exit 1
fi
echo "-> 성공: 이름을 '${NEW_NAME}'(으)로 임시 변경함"
echo

echo "=== 5. updateUser — 변경 확인 ==="
CHECK_RESP=$(curl -sS -X POST "${GET_USERS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\"}")
CHECK_NAME=$(echo "${CHECK_RESP}" | juser "${TEST_EMAIL}" name)
if [ "${CHECK_NAME}" = "${NEW_NAME}" ]; then
  echo "-> 확인됨: 이름이 실제로 '${NEW_NAME}'(으)로 반영됨"
else
  echo "경고: 확인 응답의 이름('${CHECK_NAME}')이 기대값('${NEW_NAME}')과 다릅니다 — 계속 진행하되 화면에서 직접 확인해주세요." >&2
fi
echo

echo "=== 6. updateUser — 원래 이름으로 즉시 복구 ==="
RESTORE_RESP=$(curl -sS -X POST "${UPDATE_USER_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"row\":${TEST_ROW},\"name\":\"${ORIGINAL_NAME}\"}")
RESTORE_OK=$(echo "${RESTORE_RESP}" | jget ok)
if [ "${RESTORE_OK}" != "True" ]; then
  echo "!!! 중요: 원래 이름 복구에 실패했습니다 !!!" >&2
  echo "테스트 계정(${TEST_EMAIL})의 이름이 '${NEW_NAME}'(으)로 남아있을 수 있습니다." >&2
  echo "사용자 관리 화면에서 직접 '${ORIGINAL_NAME}'(으)로 되돌려주세요." >&2
  echo "응답: ${RESTORE_RESP}" >&2
  exit 1
fi
echo "-> 성공: 이름을 원래 값('${ORIGINAL_NAME}')으로 복구함"
echo

echo "=== 7. updateUser — 복구 확인 ==="
FINAL_CHECK_RESP=$(curl -sS -X POST "${GET_USERS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\"}")
FINAL_NAME=$(echo "${FINAL_CHECK_RESP}" | juser "${TEST_EMAIL}" name)
if [ "${FINAL_NAME}" = "${ORIGINAL_NAME}" ]; then
  echo "-> 확인됨: 이름이 원래 값으로 정상 복구됨"
else
  echo "경고: 복구 후 이름('${FINAL_NAME}')이 원래 값('${ORIGINAL_NAME}')과 다릅니다 — 화면에서 직접 확인해주세요." >&2
fi
echo

echo "=== 8. updateUser — 에러 케이스: 세션 없음 ==="
NO_SESSION_RESP=$(curl -sS -X POST "${UPDATE_USER_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"row\":${TEST_ROW},\"name\":\"x\"}")
echo "응답: ${NO_SESSION_RESP} (MISSING_SESSION_TOKEN 예상)"
echo

echo "=== 9. updateUser — 에러 케이스: 관리자가 아닌 계정(FORBIDDEN 예상) ==="
FORBIDDEN_RESP=$(curl -sS -X POST "${UPDATE_USER_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"row\":${TEST_ROW},\"name\":\"해킹시도\"}")
echo "응답: ${FORBIDDEN_RESP} (FORBIDDEN 예상, 실제로 아무것도 바뀌지 않아야 함)"
echo

echo "=== 10. updateUser — 에러 케이스: 잘못된 role(INVALID_ROLE 예상) ==="
INVALID_ROLE_RESP=$(curl -sS -X POST "${UPDATE_USER_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"row\":${TEST_ROW},\"role\":\"대표\"}")
echo "응답: ${INVALID_ROLE_RESP} (INVALID_ROLE 예상)"
echo

echo "=== 11. changePassword — 임시 비밀번호로 변경 ==="
TEMP_PASSWORD="SmokeTest${STAMP//[^a-zA-Z0-9]/}9!"
CHANGE_PW_RESP=$(curl -sS -X POST "${CHANGE_PASSWORD_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"currentPassword\":\"${TEST_PASSWORD}\",\"newPassword\":\"${TEMP_PASSWORD}\"}")
CHANGE_PW_OK=$(echo "${CHANGE_PW_RESP}" | jget ok)
if [ "${CHANGE_PW_OK}" != "True" ]; then
  echo "실패: 임시 비밀번호 변경이 실패했습니다 — 테스트 계정 비밀번호는 원래 그대로이므로 정리할 것이 없습니다." >&2
  echo "응답: ${CHANGE_PW_RESP}" >&2
  exit 1
fi
echo "-> 성공: 임시 비밀번호로 변경함"
echo

echo "=== 12. changePassword — 임시 비밀번호로 재로그인 확인 ==="
RELOGIN_RESP=$(curl -sS -X POST "${LOGIN_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEMP_PASSWORD}\",\"idempotencyKey\":\"$(uuid)\"}")
RELOGIN_OK=$(echo "${RELOGIN_RESP}" | jget ok)
if [ "${RELOGIN_OK}" != "True" ]; then
  echo "!!! 중요: 임시 비밀번호로 재로그인이 안 됩니다 !!!" >&2
  echo "테스트 계정(${TEST_EMAIL})의 비밀번호가 예상과 다른 상태일 수 있습니다. 아래 임시 비밀번호를 기록해두고 직접 확인해주세요:" >&2
  echo "임시 비밀번호: ${TEMP_PASSWORD}" >&2
  exit 1
fi
NEW_TEST_SESSION=$(echo "${RELOGIN_RESP}" | jget sessionToken)
echo "-> 확인됨: 임시 비밀번호로 정상 로그인됨"
echo

echo "=== 13. changePassword — 원래 비밀번호로 즉시 복구 ==="
RESTORE_PW_RESP=$(curl -sS -X POST "${CHANGE_PASSWORD_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${NEW_TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"currentPassword\":\"${TEMP_PASSWORD}\",\"newPassword\":\"${TEST_PASSWORD}\"}")
RESTORE_PW_OK=$(echo "${RESTORE_PW_RESP}" | jget ok)
if [ "${RESTORE_PW_OK}" != "True" ]; then
  echo "!!! 중요: 원래 비밀번호로 복구하지 못했습니다 !!!" >&2
  echo "테스트 계정(${TEST_EMAIL})의 비밀번호가 임시 비밀번호로 남아있습니다. 아래 값을 기록해두세요:" >&2
  echo "임시 비밀번호: ${TEMP_PASSWORD}" >&2
  echo "응답: ${RESTORE_PW_RESP}" >&2
  exit 1
fi
echo "-> 성공: 비밀번호를 원래 값(TEST_PASSWORD)으로 복구함"
echo

echo "=== 14. changePassword — 복구 확인(원래 비밀번호로 재로그인) ==="
FINAL_RELOGIN_RESP=$(curl -sS -X POST "${LOGIN_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"email\":\"${TEST_EMAIL}\",\"password\":\"${TEST_PASSWORD}\",\"idempotencyKey\":\"$(uuid)\"}")
FINAL_RELOGIN_OK=$(echo "${FINAL_RELOGIN_RESP}" | jget ok)
if [ "${FINAL_RELOGIN_OK}" = "True" ]; then
  echo "-> 확인됨: 원래 비밀번호로 정상 로그인됨(복구 완료)"
else
  echo "경고: 원래 비밀번호로 재로그인이 안 됩니다 — 직접 확인이 필요합니다." >&2
fi
echo

echo "=== 15. changePassword — 에러 케이스: 현재 비밀번호 틀림(WRONG_PASSWORD 예상) ==="
WRONG_PW_RESP=$(curl -sS -X POST "${CHANGE_PASSWORD_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"currentPassword\":\"완전히틀린값\",\"newPassword\":\"whatever123\"}")
echo "응답: ${WRONG_PW_RESP} (WRONG_PASSWORD 예상)"
echo

echo "=== 16. changePassword — 에러 케이스: 새 비밀번호 너무 짧음(PASSWORD_TOO_SHORT 예상) ==="
SHORT_PW_RESP=$(curl -sS -X POST "${CHANGE_PASSWORD_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"currentPassword\":\"${TEST_PASSWORD}\",\"newPassword\":\"123\"}")
echo "응답: ${SHORT_PW_RESP} (PASSWORD_TOO_SHORT 예상)"
echo

echo "=== 17. updateSettings — 현재 설정 값 읽기(no-op 준비) ==="
SETTINGS_RESP=$(curl -sS -X POST "${GET_SETTINGS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\"}")
SETTINGS_OK=$(echo "${SETTINGS_RESP}" | jget ok)
if [ "${SETTINGS_OK}" != "True" ]; then
  echo "실패: 현재 설정 값을 읽지 못했습니다(getSettingsTest)." >&2
  echo "응답: ${SETTINGS_RESP}" >&2
  exit 1
fi
CURRENT_EXPIRY=$(echo "${SETTINGS_RESP}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data.get('settings', {}).get('비밀번호만료일수', ''))
")
if [ -z "${CURRENT_EXPIRY}" ]; then
  echo "실패: '비밀번호만료일수' 설정 키를 찾지 못했습니다 — 스프레드시트의 설정 시트를 확인해주세요." >&2
  exit 1
fi
echo "-> 현재 '비밀번호만료일수' = ${CURRENT_EXPIRY} (이 값 그대로 다시 씁니다 — 실제 변경 없음)"
echo

echo "=== 18. updateSettings — 같은 값 그대로 다시 쓰기(no-op) ==="
NOOP_RESP=$(curl -sS -X POST "${UPDATE_SETTINGS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"settings\":{\"비밀번호만료일수\":\"${CURRENT_EXPIRY}\"}}")
NOOP_OK=$(echo "${NOOP_RESP}" | jget ok)
if [ "${NOOP_OK}" != "True" ]; then
  echo "실패: updateSettings no-op 호출이 실패했습니다." >&2
  echo "응답: ${NOOP_RESP}" >&2
  exit 1
fi
echo "응답: ${NOOP_RESP}"
echo "-> 성공: updatedKeys에 '비밀번호만료일수'가 포함되어 있어야 하고, 값은 실제로 바뀌지 않았습니다(같은 값을 다시 썼으므로)"
echo

echo "=== 19. updateSettings — 존재하지 않는 키(unknownKeys 예상, 아무것도 쓰지 않음) ==="
UNKNOWN_KEY_RESP=$(curl -sS -X POST "${UPDATE_SETTINGS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${ADMIN_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"settings\":{\"SMOKETEST_존재하지않는키_${STAMP}\":\"x\"}}")
echo "응답: ${UNKNOWN_KEY_RESP} (updatedKeys=[], unknownKeys에 해당 키 포함 예상)"
echo

echo "=== 20. updateSettings — 에러 케이스: 관리자가 아닌 계정(FORBIDDEN 예상) ==="
SETTINGS_FORBIDDEN_RESP=$(curl -sS -X POST "${UPDATE_SETTINGS_ENDPOINT}" -H 'Content-Type: application/json' \
  -d "{\"sessionToken\":\"${TEST_SESSION}\",\"idempotencyKey\":\"$(uuid)\",\"settings\":{\"비밀번호만료일수\":\"999\"}}")
echo "응답: ${SETTINGS_FORBIDDEN_RESP} (FORBIDDEN 예상, 실제로 아무것도 바뀌지 않아야 함)"
echo

echo "=== 완료 ==="
echo "최종 상태:"
echo "  - 테스트 계정(${TEST_EMAIL}) 이름: 원래 값('${ORIGINAL_NAME}')으로 복구됨"
echo "  - 테스트 계정(${TEST_EMAIL}) 비밀번호: 원래 값(TEST_PASSWORD)으로 복구됨"
echo "  - '비밀번호만료일수' 설정 값: 변경 없음(no-op)"
echo "  - 실제 팀원 계정/운영 설정 값은 어디도 건드리지 않았습니다."
