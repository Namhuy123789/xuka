// sw.js
const CACHE_NAME = 'xuka-cache-v2';

// File tĩnh cần cache sẵn
const PRECACHE_URLS = [
  '/', // ⚠️ nếu deploy ở subpath thì đổi thành đường dẫn gốc phù hợp
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/img/logo.png',
  '/static/fonts/roboto.woff2'
];

// Install: cache sẵn file tĩnh
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(err => {
        console.warn("Precache failed:", err);
      })
    )
  );
  self.skipWaiting();
});

// Activate: xóa cache cũ
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API → network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // có thể clone response để cache lại API nếu cần
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // File tĩnh → cache-first
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Mặc định → network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
