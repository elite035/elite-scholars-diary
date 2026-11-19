// Only the explicit public offline shell/artwork is cached. Never cache API,
// authenticated documents, homework, login responses or user session data.
const SHELL = 'elite-offline-v2';
const PUBLIC_ASSETS = [
  '/offline.html',
  '/offline.css',
  '/assets/official-school-logo.jpeg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];
self.addEventListener('install', (event) =>
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PUBLIC_ASSETS))),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('elite-offline-') && key !== SHELL)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (event.request.mode === 'navigate')
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  else if (PUBLIC_ASSETS.includes(url.pathname))
    event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(event.request)));
});
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  const url =
    typeof data.url === 'string' && data.url.startsWith('/#/') ? data.url : '/#/notifications';
  event.waitUntil(
    self.registration.showNotification('Elite Scholars', {
      body: 'A school diary update is ready. Sign in to view it.',
      icon: '/assets/official-school-logo.jpeg',
      badge: '/assets/official-school-logo.jpeg',
      tag: String(data.tag || 'school-update'),
      renotify: true,
      vibrate: [120, 60, 120],
      data: { url },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/notifications', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === target.origin) {
          await client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
// The browser rotated this device's push keys: ask any open window to link the device again.
// If no window is open, the next sign-in or app open re-links it automatically.
self.addEventListener('pushsubscriptionchange', (event) =>
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: 'push-resync' }))),
  ),
);
