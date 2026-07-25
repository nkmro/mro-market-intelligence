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
