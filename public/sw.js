// public/sw.js
// Service Worker for PraConnect Web Push Notifications.

self.addEventListener('push', (event) => {
  let payload = { title: 'PraConnect', body: 'New message received', url: '/' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }

  const title = payload.title || 'PraConnect';
  const options = {
    body: payload.body || 'New message received',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: {
      url: payload.url || '/',
      friendId: payload.friendId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
