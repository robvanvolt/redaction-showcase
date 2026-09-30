export const APP_CACHE = 'med-redact-app-v2';
// Share Transformers.js's existing cache to avoid a second copy of large models.
export const DATA_CACHE = 'transformers-cache';
export const READY_CACHE = 'med-redact-ready-v1';
export const BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
export const ORT_PREFIX = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
export const APP_FILES = [
  './', './index.html', './runtime-client.js', './runtime-worker.js',
  './rampart/index.js', './pwa.js', './pwa-config.js', './offline-storage.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
export const RUNTIME_FILES = ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.jsep']
  .flatMap(name => [`${ORT_PREFIX}${name}.mjs`, `${ORT_PREFIX}${name}.wasm`]);
