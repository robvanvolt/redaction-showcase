import { APP_CACHE, DATA_CACHE, APP_FILES, BUNDLE_URL } from './pwa-config.js';

const base = self.registration.scope;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_FILES.map(path => new Request(new URL(path, base), { cache: 'reload' })));
    // Updates wait for open tabs to close, avoiding mixed app versions mid-demo.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('med-redact-app-') && key !== APP_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(base);
  const local = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  const dependency = request.url === BUNDLE_URL ||
    url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'huggingface.co';
  if (!local && !dependency) return;
  event.respondWith((async () => {
    const app = await caches.open(APP_CACHE);
    if (local) {
      const hit = await app.match(request, { ignoreSearch: true });
      if (hit) return hit;
    }
    // WASM factories and model assets use the same cache as Transformers.js.
    const data = await caches.open(DATA_CACHE);
    const hit = await data.match(request);
    if (hit) return hit;
    if (request.url === BUNDLE_URL) {
      const bundled = await app.match(request);
      if (bundled) return bundled;
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') {
        // Await storage so a successful library import also means it was saved.
        await app.put(request, response.clone());
      }
      return response;
    }
    // The runtime stores model responses itself; don't duplicate GB-sized data.
    return fetch(request);
  })());
});
