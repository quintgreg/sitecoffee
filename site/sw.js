/* KORA — service worker: приложение открывается без сети.
   Свои файлы — «сначала сеть»: онлайн всегда свежая версия, офлайн — из кеша.
   /api/* не кешируем никогда: корзина, аккаунт и заказы только живые. */
const VERSION = 'kora-v2';
const SHELL = [
  '/', '/index.html', '/css/styles.css', '/js/data.js', '/js/api.js', '/js/app.js',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png',
];
const FONTS = 'kora-fonts';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: файлы шрифтов неизменны — берём из кеша, при промахе докачиваем
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('/index.html');
      throw err;
    }
  })());
});
