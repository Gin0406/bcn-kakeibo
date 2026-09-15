'use strict';

// バージョンを更新すると古いキャッシュが自動的に削除されます
const CACHE_VERSION = 'bcn-kakeibo-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 為替レートAPIなど外部APIはネットワーク優先・キャッシュしない
  if (req.url.includes('frankfurter.dev') || req.url.includes('frankfurter.app')) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 503 })));
    return;
  }

  if (req.method !== 'GET') return;

  // アプリ本体はキャッシュ優先、なければネットワーク取得しキャッシュへ保存
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const resClone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => {
          // ナビゲーションリクエストならindex.htmlへフォールバック
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response(null, { status: 503 });
        });
    })
  );
});
