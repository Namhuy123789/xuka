// sw.js
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Danh sách origin được phép
const allowedOrigins = [
  'https://xuka.com.vn',
  'http://127.0.0.1:5000',
  'http://localhost:5000',
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com'
];

// Xử lý request
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isAllowed = allowedOrigins.includes(url.origin);

  if (!isAllowed) {
    event.respondWith(
      new Response('Mạng bị ngắt trong lúc thi. Không thể truy cập tài nguyên ngoài.', {
        status: 403,
        statusText: 'Forbidden'
      })
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});
