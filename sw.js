// MRO 자재 시황 관리 시스템 - 서비스워커
// PWA 설치 가능성 + 알림 표시를 위한 최소 구현

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  // 캐싱 없이 그대로 통과 (추후 오프라인 지원 필요 시 확장)
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
