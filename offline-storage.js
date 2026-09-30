import { APP_CACHE, DATA_CACHE, READY_CACHE, APP_FILES, BUNDLE_URL, RUNTIME_FILES } from './pwa-config.js';

const base = new URL('./', import.meta.url);
const manifestURL = key => new URL(`./offline-model-${key}.json`, base).href;

export async function cacheResource(url, cacheName = DATA_CACHE) {
  const cache = await caches.open(cacheName);
  if (await cache.match(url)) return;
  const response = await fetch(url);
  if (!response.ok || response.type === 'opaque') throw new Error(`Download fehlgeschlagen: ${url}`);
  try { await cache.put(url, response); }
  catch { throw new Error('Nicht genug Speicher oder Browser-Speicher nicht verfügbar.'); }
}

export async function prepareDependencies() {
  await cacheResource(BUNDLE_URL, APP_CACHE);
  // Save both GPU and CPU runtimes so fallback also works without a network.
  for (const url of RUNTIME_FILES) await cacheResource(url);
}

export async function shellIsReady() {
  const app = await caches.open(APP_CACHE);
  for (const path of APP_FILES) if (!await app.match(new URL(path, base).href)) return false;
  return !!await app.match(BUNDLE_URL);
}

export async function runtimesAreReady() {
  const data = await caches.open(DATA_CACHE);
  for (const url of RUNTIME_FILES) if (!(await data.match(url))?.ok) return false;
  return true;
}

export async function saveModelManifest(key, manifest) {
  if (!manifest?.files?.length || !manifest.files.some(url => /\.onnx(?:$|\?)/.test(url))) {
    throw new Error('Modelldateien wurden nicht vollständig gespeichert.');
  }
  const data = await caches.open(DATA_CACHE);
  for (const url of manifest.files) {
    if (!(await data.match(url))?.ok) throw new Error('Offline-Datei fehlt: ' + url.split('/').pop());
  }
  const ready = await caches.open(READY_CACHE);
  await ready.put(manifestURL(key), new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/json' },
  }));
}

export async function getModelStatus(key, dir) {
  const ready = await caches.open(READY_CACHE);
  const response = await ready.match(manifestURL(key));
  if (!response) return { ready: false };
  let manifest;
  try { manifest = await response.json(); } catch { return { ready: false }; }
  if (manifest?.model !== dir || !Array.isArray(manifest.files) || !manifest.files.length) return { ready: false };
  const data = await caches.open(DATA_CACHE);
  for (const url of manifest.files) {
    if (!(await data.match(url))?.ok) return { ready: false };
  }
  return { ...manifest, ready: true };
}

// Track exactly what the tokenizer, external ONNX shards and WASM loader use.
// Optional files that don't exist are not marked as required.
export async function trackingCache() {
  const cache = await caches.open(DATA_CACHE);
  const files = new Set();
  const urlOf = request => typeof request === 'string' ? request : request.href || request.url;
  return {
    files,
    async match(request) {
      const response = await cache.match(request);
      if (response?.ok) files.add(urlOf(request));
      return response;
    },
    async put(request, response) {
      const url = urlOf(request);
      files.add(url); // Retain failed writes so validation detects quota failures.
      return cache.put(request, response);
    },
  };
}

// Remove retired showcase models without touching the remaining models/runtimes.
// Run on activation, after windows using the previous app version have closed.
export async function purgeRemovedModels() {
  const removed = ['bardsai/eu-pii-anonimization-multilang', 'openai/privacy-filter'];
  const data = await caches.open(DATA_CACHE);
  for (const request of await data.keys()) {
    const url = new URL(request.url);
    if (url.hostname === 'huggingface.co' && removed.some(repo => url.pathname.startsWith(`/${repo}/`))) {
      await data.delete(request);
    }
  }
  const ready = await caches.open(READY_CACHE);
  for (const key of ['bardsai', 'openai']) await ready.delete(manifestURL(key));
}
