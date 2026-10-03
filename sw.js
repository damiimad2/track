// Service worker for the repair tracking page.
//
// Its jobs, in plain language:
//   1. Let the page be installed on the customer's home screen (a PWA) so it opens like an app.
//   2. Show a real notification when the shop's sender pushes one - which is how the customer
//      hears about "your device is ready" even though the page is closed.
//   3. Keep the last page in the cache so the customer can still SEE the status while offline,
//      with an honest "this may be out of date" line rather than a blank screen.
//
// It never caches customer data on purpose beyond that last page, and it never sends anything
// anywhere: all it does is display what the browser hands it.

const CACHE_NAME = 'repair-tracking-v2';
const OFFLINE_PAGE = 'index.html';

// Bump this whenever index.html changes, so phones pick up the new version instead of a
// stale cached copy.
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll([OFFLINE_PAGE, 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network first, cache as the safety net: a tracking page that shows a stale status is better
// than one that shows nothing while the customer stands in the queue.
self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;   // database calls go straight to the network

    event.respondWith(
        fetch(request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request).then(cached => cached || caches.match(OFFLINE_PAGE)))
    );
});

/* ── the notification itself ─────────────────────────────────────────────── */

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (e) {
        payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'تحديث حالة جهازك';
    const options = {
        body: payload.body || '',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        // 'default' vibrates and sounds on Android; on iOS the OS decides.
        vibrate: payload.ready ? [120, 80, 120, 80, 260] : [140],
        tag: payload.tag || 'repair-status',
        renotify: true,
        data: {
            url: payload.url || (self.location.origin + '/'),
            code: payload.code || ''
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || (self.location.origin + '/');

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Reuse the tab if it is already open, instead of piling up new ones.
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(target);
                    return client.focus();
                }
            }
            return self.clients.openWindow(target);
        })
    );
});