// What lets Dime Coach open from a home screen without a connection, and open quickly with one.
//
// It is deliberately small, because an app that shows an old copy of itself is worse than one
// that waits a moment:
//   - The page itself is always asked for from the site first. The copy kept here is used only
//     when the site cannot be reached.
//   - The built files under /assets/ have a different name every time they change, so one kept
//     here is always the right one and is never asked for twice.
//   - Nothing under /api/ is ever kept or answered from here: what the app shows is always what
//     the server says now.
const SHELL = 'dime-shell-v1';
const ASSETS = 'dime-assets-v1';
const KEEP = [SHELL, ASSETS];
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  // The page and its icons, so there is something to open the first time the connection is gone.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['/', '/favicon.svg', '/logo-mark.svg', '/logo-mark-white.svg', '/icon-192.png']))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // Copies kept by an earlier version of this file are thrown away.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Opening the app, or any page of it: the site first, the kept page when it cannot be reached.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('/').then((kept) => kept || Response.error())),
    );
    return;
  }
  // The built files: kept the first time, and from here ever after.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (kept) =>
          kept ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(ASSETS)
                .then((cache) =>
                  cache
                    .put(req, copy)
                    // Files from older versions of the app are let go, oldest first, so this never grows without end.
                    .then(() => cache.keys())
                    .then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k)))),
                )
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }
  // Icons and the like: the site first, the kept copy when it cannot be reached.
  event.respondWith(fetch(req).catch(() => caches.match(req).then((kept) => kept || Response.error())));
});
