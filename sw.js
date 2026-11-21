// Lets the app open offline. Uses the latest version when online, the saved copy when not.
const CACHE = 'budget-v7';
const FILES = ['./', './index.html', './sync.js', './firebase-config.js', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'];
const SDK_HOST = 'https://www.gstatic.com';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const sdk = (url.origin === SDK_HOST && url.pathname.startsWith('/firebasejs/'))
    || url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com'; // library + font files: saved copy first
  if (!sameOrigin && !sdk) return; // Firebase's own data traffic goes straight to the network
  e.respondWith(caches.open(CACHE).then(cache => {
    if (sdk) {
      // Library files never change for a given version: use the saved copy first.
      return cache.match(e.request).then(hit => hit || fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }));
    }
    // 'no-cache' makes the browser check GitHub for a newer copy instead of reusing one for 10 minutes
    return fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cache.match(e.request, { ignoreSearch: true }).then(r => r || cache.match('./index.html')));
  }));
});
