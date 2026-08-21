#!/usr/bin/env node
// 로그인 테스트 계정용 passwordHash 오프라인 계산기.
//
// apps-script/Code.gs의 hashPassword_(331~335행), 그리고 cloud-run/mro-functions/index.js의
// hashPassword_(loginTest용, 동일 공식으로 포트)와 완전히 같은 방식으로 해시값을 계산합니다:
//   raw = 비밀번호 + ':' + 이메일.trim().toLowerCase()
//   hash = SHA-256(raw)의 16진수 문자열
//
// 이 스크립트는 어디로도 네트워크 요청을 보내지 않습니다 — 로컬(또는 Cloud Shell)에서
// 계산만 하고 화면에 출력합니다.
//
// [주의] 입력한 비밀번호가 이 터미널 화면에 그대로 표시됩니다(에코 숨김 없음 — 여러 환경에서
// 안정적으로 동작하도록 일부러 단순하게 만들었습니다). 그러니:
//   - 화면 공유/캡처/채팅 붙여넣기 중에는 실행하지 마세요.
//   - 실행 후 화면에 나온 해시값만 시트에 붙여넣고, 필요하면 `clear` 명령으로 터미널
//     스크롤백을 지우세요.
//   - 이 값들은 어디에도 저장/전송되지 않습니다 — 이 창을 닫으면 사라집니다.
//
// 사용법:
//   node compute_login_hash.js
'use strict';

const crypto = require('crypto');
const readline = require('readline');

function hashPassword_(password, email) {
  const raw = password + ':' + String(email).trim().toLowerCase();
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query) {
  return new Promise(function (resolve) {
    rl.question(query, resolve);
  });
}

(async function main() {
  console.log('=== 로그인 테스트 계정 passwordHash 계산기 (오프라인, 로컬 실행) ===');
  console.log('(입력한 비밀번호는 이 터미널에 그대로 보입니다 — 화면 공유 중에는 실행하지 마세요)\n');

  const email = await ask('이메일 (예: logintest.cloudrun@nkmro.com): ');
  const password = await ask('비밀번호: ');
  rl.close();

  if (!email.trim() || !password) {
    console.error('\n이메일과 비밀번호를 모두 입력해야 합니다.');
    process.exit(1);
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const hash = hashPassword_(password, normalizedEmail);

  console.log('\n=== 계산 결과 ===');
  console.log('정규화된 이메일:', normalizedEmail);
  console.log('사용자팀마스터 시트의 G열(passwordHash 컬럼)에 아래 값을 그대로 붙여넣으세요:\n');
  console.log(hash);
  console.log('\n(비밀번호 자체는 어디에도 저장/전송되지 않았습니다. 이 해시값만 시트에 넣으세요.'
    + ' 화면을 닫거나 clear 명령으로 스크롤백을 지우시길 권장합니다.)');
  process.exit(0);
})();
