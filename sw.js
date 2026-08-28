// MRO 자재 시황 관리 시스템 - 서비스워커
// PWA 설치 가능성 + 알림 표시를 위한 최소 구현

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) { return caches.delete(name); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  // 항상 네트워크에서 최신 버전을 가져오도록 강제 (브라우저/CDN 캐시로 인해
  // 배포한 새 버전이 안 뜨는 문제를 방지하기 위함 - 절대 이 로직을 캐싱 전략으로
  // 바꾸지 말 것. 문제가 반복 발생했던 원인이었음)
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(function () {
        return fetch(event.request);
      })
    );
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./feed.html');
    })
  );
});

// ---------------------------------------------------------------------------
// FCM 백그라운드 푸시 수신 (push 4단계 — 코드 구현만, 아직 미배포/미연결)
// 설계: PUSH_NOTIFICATION_STAGE3_DESIGN.md(pushNotifyState 역할 경계) /
// PUSH_NOTIFICATION_STAGE4_DESIGN.md 5절("sw.js는 순수 추가만, 기존
// install/activate/fetch/notificationclick 변경 없음"). 이 블록 위의 4개 리스너는
// 한 글자도 바꾸지 않았다.
//
// importScripts는 서비스워커 자체의 스크립트 로딩 메커니즘이라 위 'fetch' 이벤트
// 리스너를 거치지 않는다 — 그 리스너의 "캐싱 전략으로 바꾸지 말 것" 원칙과 서로
// 무관/무충돌이다(설계 문서 5절에서 이미 확인한 내용).
//
// [주의 — 실제 배포 전 필수 확인] 아래 firebaseConfig 값은 전부 자리표시자(placeholder)다.
// Firebase 콘솔에서 이 GCP 프로젝트에 Firebase를 연동한 뒤(설계 문서 1-1절, 재홍님이
// 콘솔에서 1회 수행), 프로젝트 설정 > 일반 탭에서 나오는 실제 값으로 교체해야 동작한다.
// 이 값들은 설계 문서 1-3절에서 확인한 대로 전부 공개값이라 GitHub에 실제 값을 그대로
// 커밋해도 안전하다(비밀번호/API 시크릿과 다름). 또한 아래 SDK 버전(12.18.0)은 이 코드를
// 작성한 시점 기준 npm의 최신 firebase 패키지 버전이다 — 실제 배포 직전에
// https://firebase.google.com/docs/web/setup 에서 최신 버전인지 한 번 더 확인 권장.
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'REPLACE_WITH_FIREBASE_WEB_API_KEY',
  authDomain: 'REPLACE_WITH_FIREBASE_AUTH_DOMAIN',
  projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_WITH_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_FIREBASE_APP_ID'
});

const messaging = firebase.messaging();

// 서버(6단계 이후 실제 발송 로직)는 "notification" 페이로드가 아니라 "data" 페이로드만
// 보내도록 설계한다(설계 문서 5절) — 그래야 브라우저가 자동으로 알림을 띄우지 않고,
// 아래 핸들러가 showNotification()을 직접 호출해서 알림 표시를 완전히 통제할 수 있다.
// (notification 페이로드를 쓰면 브라우저 자동 표시 + 이 핸들러가 각각 한 번씩, 알림이
// 2번 뜨는 문제가 생길 수 있어 피한다.)
//
// 알림 클릭 처리는 새로 안 만든다 — 위에 이미 있는 'notificationclick' 리스너가 그대로
// 담당한다(showNotification()으로 띄운 알림도 동일하게 'notificationclick' 이벤트를
// 발생시키므로, 별도 핸들러가 필요 없다).
messaging.onBackgroundMessage(function (payload) {
  const data = payload.data || {};
  const title = data.title || 'MRO 시황관리';
  self.registration.showNotification(title, {
    body: data.body || '',
    icon: './icon-192.png'
  });
});
