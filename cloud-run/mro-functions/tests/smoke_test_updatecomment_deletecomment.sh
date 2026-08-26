#!/usr/bin/env bash
# updateCommentTest/deleteCommentTest 배포 후 smoke test 스크립트.
#
# ============================================================================
# 운영 데이터 보호 원칙 (재홍님 승인 조건, 2026-08-26) — 반드시 지킬 것
# ============================================================================
#   - 이 스크립트는 절대 기존(실제 사용자가 작성한) 운영 댓글을 대상으로 update/delete를
#     실행하지 않는다.
#   - 대신 postCommentTest로 이 스크립트 전용 "더미 댓글"을 하나 새로 생성하고, 그
#     commentId로만 updateCommentTest -> deleteCommentTest를 실행한다.
#   - 마지막 단계에서 항상 그 더미 댓글을 deleteCommentTest로 정리(cleanup)하므로,
#     스크립트가 끝까지 정상 실행되면 댓글 시트에 테스트 흔적이 남지 않는다.
#   - 중간에 실패해서 스크립트가 조기 종료되면(set -e) 더미 댓글이 남아있을 수 있다 —
#     그 경우 출력에 찍힌 commentId를 기록해두었다가 직접 확인/정리할 것.
#
# ============================================================================
# 사전 조건
# ============================================================================
#   - loginTest, postCommentTest, updateCommentTest, deleteCommentTest 4개 함수가 모두
#     Cloud Run에 배포되어 있어야 한다(이 스크립트 자체는 배포를 수행하지 않는다).
#   - TEST_POST_ID: 이미 댓글이 1개 이상 달려 있는 실제 게시글의 postId. postCommentAction_
#     로직상(index.js) itemId 없이 댓글을 달려면 해당 postId에 기존 댓글이 최소 1개 있어야
#     한다(없으면 NO_CONFIRMED_ITEM_YET 오류 — MRO 자재 시황 관리 시스템 스프레드시트의
#     "게시글"/"댓글" 시트에서 이미 댓글이 달린 postId를 하나 골라서 넣을 것).
#   - TEST_EMAIL/TEST_PASSWORD: 정상 로그인 가능한 계정. role이 '일반'이면 postCommentTest가
#     FORBIDDEN_VIEWER를 반환하므로 '담당' 또는 '팀장' role 계정을 쓸 것.
#   - (선택) TEST_EMAIL_2/TEST_PASSWORD_2: 더미 댓글 작성자와 다른 계정. 지정하면 "권한 없는
#     사용자가 남의 댓글을 수정/삭제 시도"(FORBIDDEN_NOT_AUTHOR)까지 검증한다. 지정하지
#     않으면 이 두 케이스는 SKIPPED로 표시하고 넘어간다(세션 없음 케이스는 계정 무관하게
#     항상 실행되므로, "권한 없는 사용자(또는 세션 없이)" 요건 자체는 항상 충족됨).
#
# ============================================================================
# 사용법
# ============================================================================
#   TEST_EMAIL=... TEST_PASSWORD=... TEST_POST_ID=... ./smoke_test_updatecomment_deletecomment.sh
#   (선택, 권한 오류 케이스까지 실행하려면)
#   TEST_EMAIL=... TEST_PASSWORD=... TEST_POST_ID=... TEST_EMAIL_2=... TEST_PASSWORD_2=... \
#     ./smoke_test_updatecomment_deletecomment.sh
#   필요하면 엔드포인트도 환경변수로 덮어쓸 수 있다(기본값은 실제 배포 URL 패턴):
#   LOGIN_ENDPOINT=... POST_COMMENT_ENDPOINT=... UPDATE_ENDPOINT=... DELETE_ENDPOINT=... ...
#
# 비밀번호는 이 스크립트나 커밋에 절대 하드코딩하지 말 것 — 항상 환경변수로만 전달한다.
set -euo pipefail

LOGIN_ENDPOINT="${LOGIN_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/loginTest}"
POST_COMMENT_ENDPOINT="${POST_COMMENT_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/postCommentTest}"
UPDATE_ENDPOINT="${UPDATE_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/updateCommentTest}"
DELETE_ENDPOINT="${DELETE_ENDPOINT:-https://asia-northeast3-mro-market-intelligence.cloudfunctions.net/deleteCommentTest}"

TEST_EMAIL="${TEST_EMAIL:-}"
TEST_PASSWORD="${TEST_PASSWORD:-}"
TEST_POST_ID="${TEST_POST_ID:-}"
TEST_EMAIL_2="${TEST_EMAIL_2:-}"
TEST_PASSWORD_2="${TEST_PASSWORD_2:-}"

if [[ -z "$TEST_EMAIL" || -z "$TEST_PASSWORD" || -z "$TEST_POST_ID" ]]; then
  echo "TEST_EMAIL, TEST_PASSWORD, TEST_POST_ID 환경변수를 설정하세요."
  echo "TEST_POST_ID는 이미 댓글이 1개 이상 달려 있는 실제 게시글의 postId여야 합니다."
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

DUMMY_STAMP="smoke-test-dummy-$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || echo unknown)-$$"

echo "=== 1. 로그인해서 sessionToken 받기 (더미 댓글 작성용 계정: $TEST_EMAIL) ==="
LOGIN_RESP=$(curl -sS -X POST "$LOGIN_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL" "$TEST_PASSWORD" "$(uuid)")")
echo "$LOGIN_RESP"
SESSION_TOKEN=$(echo "$LOGIN_RESP" | jget sessionToken)
if [[ -z "$SESSION_TOKEN" ]]; then
  echo "로그인 실패 - sessionToken을 못 받았습니다. 위 응답을 확인하세요."
  exit 1
fi
echo "sessionToken 획득: ${SESSION_TOKEN:0:8}...(생략)"

echo
echo "=== 2. postCommentTest로 테스트 전용 더미 댓글 생성 (postId=$TEST_POST_ID) ==="
POST_RESP=$(curl -sS -X POST "$POST_COMMENT_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","postId":"%s","content":"%s","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$TEST_POST_ID" "$DUMMY_STAMP" "$(uuid)")")
echo "$POST_RESP"
DUMMY_COMMENT_ID=$(echo "$POST_RESP" | jget commentId)
if [[ -z "$DUMMY_COMMENT_ID" ]]; then
  echo "더미 댓글 생성 실패 - commentId를 못 받았습니다."
  echo "TEST_POST_ID가 유효한지(이미 댓글이 1개 이상 있는 postId인지), 계정 role이 '일반'이 아닌지 확인하세요."
  exit 1
fi
echo "더미 댓글 생성됨: commentId=$DUMMY_COMMENT_ID (content=\"$DUMMY_STAMP\")"

echo
echo "=== 3. [잘못된 입력] updateCommentTest에 commentId 없이 호출 -> MISSING_FIELDS 기대 ==="
curl -sS -X POST "$UPDATE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","commentId":"","content":"아무 내용","idempotencyKey":"%s"}' "$SESSION_TOKEN" "$(uuid)")"
echo

echo
echo "=== 4. [세션 없음] sessionToken 없이 updateCommentTest 호출 -> MISSING_SESSION_TOKEN(HTTP 400) 기대 ==="
curl -sS -i -X POST "$UPDATE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"commentId":"%s","content":"세션없이 수정 시도","idempotencyKey":"%s"}' "$DUMMY_COMMENT_ID" "$(uuid)")"
echo
echo

echo "=== 5. [세션 없음] sessionToken 없이 deleteCommentTest 호출 -> MISSING_SESSION_TOKEN(HTTP 400) 기대 ==="
curl -sS -i -X POST "$DELETE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"commentId":"%s","idempotencyKey":"%s"}' "$DUMMY_COMMENT_ID" "$(uuid)")"
echo
echo

if [[ -n "$TEST_EMAIL_2" && -n "$TEST_PASSWORD_2" ]]; then
  echo "=== 6. [권한 없는 사용자] 다른 계정($TEST_EMAIL_2)으로 로그인 ==="
  LOGIN_RESP_2=$(curl -sS -X POST "$LOGIN_ENDPOINT" -H 'Content-Type: application/json' \
    -d "$(printf '{"email":"%s","password":"%s","idempotencyKey":"%s"}' "$TEST_EMAIL_2" "$TEST_PASSWORD_2" "$(uuid)")")
  echo "$LOGIN_RESP_2"
  SESSION_TOKEN_2=$(echo "$LOGIN_RESP_2" | jget sessionToken)
  if [[ -z "$SESSION_TOKEN_2" ]]; then
    echo "TEST_EMAIL_2 로그인 실패 - 6/7단계(권한 없는 사용자 케이스)를 건너뜁니다."
  else
    echo
    echo "=== 6-1. [권한 없는 사용자] 다른 계정으로 더미 댓글 수정 시도 -> FORBIDDEN_NOT_AUTHOR 기대 ==="
    curl -sS -X POST "$UPDATE_ENDPOINT" -H 'Content-Type: application/json' \
      -d "$(printf '{"sessionToken":"%s","commentId":"%s","content":"남의 댓글 수정 시도","idempotencyKey":"%s"}' "$SESSION_TOKEN_2" "$DUMMY_COMMENT_ID" "$(uuid)")"
    echo
    echo
    echo "=== 6-2. [권한 없는 사용자] 다른 계정으로 더미 댓글 삭제 시도 -> FORBIDDEN_NOT_AUTHOR 기대 ==="
    curl -sS -X POST "$DELETE_ENDPOINT" -H 'Content-Type: application/json' \
      -d "$(printf '{"sessionToken":"%s","commentId":"%s","idempotencyKey":"%s"}' "$SESSION_TOKEN_2" "$DUMMY_COMMENT_ID" "$(uuid)")"
    echo
  fi
else
  echo "=== 6. [권한 없는 사용자] SKIPPED — TEST_EMAIL_2/TEST_PASSWORD_2가 설정되지 않았습니다 ==="
fi

echo
echo "=== 7. [정상 수정] 더미 댓글을 원래 작성자(TEST_EMAIL)로 수정 -> ok:true 기대 ==="
UPDATE_RESP=$(curl -sS -X POST "$UPDATE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","commentId":"%s","content":"%s","idempotencyKey":"%s"}' \
    "$SESSION_TOKEN" "$DUMMY_COMMENT_ID" "$DUMMY_STAMP-updated" "$(uuid)")")
echo "$UPDATE_RESP"
UPDATE_OK=$(echo "$UPDATE_RESP" | jget ok)
if [[ "$UPDATE_OK" != "True" ]]; then
  echo "경고: 정상 수정이 ok:true를 반환하지 않았습니다. 위 응답을 확인하세요."
fi

echo
echo "=== 8. [정상 삭제 = cleanup] 더미 댓글을 원래 작성자(TEST_EMAIL)로 삭제 -> ok:true 기대 ==="
DELETE_RESP=$(curl -sS -X POST "$DELETE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","commentId":"%s","idempotencyKey":"%s"}' "$SESSION_TOKEN" "$DUMMY_COMMENT_ID" "$(uuid)")")
echo "$DELETE_RESP"
DELETE_OK=$(echo "$DELETE_RESP" | jget ok)
if [[ "$DELETE_OK" != "True" ]]; then
  echo "경고: 정상 삭제(cleanup)가 ok:true를 반환하지 않았습니다. commentId=$DUMMY_COMMENT_ID 가 시트에 남아있을 수 있으니 직접 확인하세요."
fi

echo
echo "=== 9. [존재하지 않는 댓글 / 이미 삭제된 댓글] 방금 삭제한 commentId로 재수정 시도 -> COMMENT_NOT_FOUND 기대 ==="
curl -sS -X POST "$UPDATE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","commentId":"%s","content":"이미 삭제됨","idempotencyKey":"%s"}' "$SESSION_TOKEN" "$DUMMY_COMMENT_ID" "$(uuid)")"
echo
echo

echo "=== 10. [존재하지 않는 댓글 / 이미 삭제된 댓글] 방금 삭제한 commentId로 재삭제 시도 -> COMMENT_NOT_FOUND 기대 ==="
curl -sS -X POST "$DELETE_ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(printf '{"sessionToken":"%s","commentId":"%s","idempotencyKey":"%s"}' "$SESSION_TOKEN" "$DUMMY_COMMENT_ID" "$(uuid)")"
echo

echo
echo "=== 완료 === 더미 댓글(commentId=$DUMMY_COMMENT_ID)은 8단계에서 정리되었습니다. 위 각 단계 응답을 육안으로 확인하세요."
