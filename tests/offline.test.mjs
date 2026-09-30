import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, access } from 'node:fs/promises';
import { APP_CACHE, DATA_CACHE, READY_CACHE, APP_FILES, BUNDLE_URL, RUNTIME_FILES } from '../pwa-config.js';
import { trackingCache, saveModelManifest, getModelStatus, prepareDependencies, shellIsReady, runtimesAreReady } from '../offline-storage.js';

class MemoryCache {
  entries = new Map();
  key(request, options = {}) {
    const url = new URL(typeof request === 'string' ? request : request.href || request.url, 'https://example.test/showcase/');
    if (options.ignoreSearch) url.search = '';
    return url.href;
  }
  async match(request, options) {
    const key = this.key(request, options);
    for (const [url, response] of this.entries) if (this.key(url, options) === key) return response.clone();
    return undefined;
  }
  async put(request, response) { this.entries.set(this.key(request), response.clone()); }
}
function storage() {
  const stores = new Map();
  return {
    stores,
    async open(name) { if (!stores.has(name)) stores.set(name, new MemoryCache()); return stores.get(name); },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
}

test('tracking and readiness verify external weights and detect cache eviction', async () => {
  const previous = globalThis.caches;
  globalThis.caches = storage();
  try {
    const cache = await trackingCache();
    const files = ['config.json','tokenizer.json','onnx/model_q4.onnx','onnx/model_q4.onnx_data']
      .map(file => 'https://huggingface.co/openai/privacy-filter/resolve/main/' + file);
    for (const file of files) await cache.put(file, new Response('fixture'));
    assert.equal(cache.files.size, 4);
    const manifest = { model:'openai/privacy-filter', files:[...cache.files], device:'webgpu' };
    await saveModelManifest('openai',manifest);
    assert.equal((await getModelStatus('openai',manifest.model)).ready,true);
    assert.equal((await getModelStatus('openai','different/repository')).ready,false);
    const models = await caches.open(DATA_CACHE);
    models.entries.delete(models.key(files[3]));
    assert.equal((await getModelStatus('openai',manifest.model)).ready,false);
    await assert.rejects(saveModelManifest('openai',manifest),/Offline-Datei fehlt/);
    assert.equal((await caches.open(READY_CACHE)).entries.size,1,'metadata only, no duplicate model weights');
  } finally { globalThis.caches = previous; }
});

test('failed cache writes cannot produce a ready marker', async () => {
  const previous = globalThis.caches;
  globalThis.caches = storage();
  try {
    const native = await caches.open(DATA_CACHE);
    native.put = async () => { throw Error('QuotaExceededError'); };
    const cache = await trackingCache();
    const url='https://huggingface.co/fixture/model/resolve/main/onnx/model.onnx';
    await assert.rejects(cache.put(url,new Response('fixture')),/QuotaExceededError/);
    assert.equal(cache.files.has(url),true);
    await assert.rejects(saveModelManifest('fixture',{model:'fixture/model',files:[...cache.files]}),/Offline-Datei fehlt/);
    assert.equal((await getModelStatus('fixture','fixture/model')).ready,false);
  } finally { globalThis.caches = previous; }
});

test('preparation saves both WASM backends and the library once; checks all shell files', async () => {
  const oldCache=globalThis.caches, oldFetch=globalThis.fetch;
  globalThis.caches=storage();
  let downloads=0;
  globalThis.fetch=async()=>{downloads++;return new Response('fixture');};
  try {
    await prepareDependencies();
    assert.equal(downloads,5);
    assert.equal(await runtimesAreReady(),true);
    await prepareDependencies();
    assert.equal(downloads,5,'repeat preparation uses stored resources');
    assert.equal(await shellIsReady(),false,'library alone is not an offline app');
    const app=await caches.open(APP_CACHE);
    const base=new URL('../',import.meta.url);
    for (const file of APP_FILES) await app.put(new URL(file,base),new Response('fixture'));
    assert.equal(await shellIsReady(),true);
    const models=await caches.open(DATA_CACHE);
    models.entries.delete(models.key(RUNTIME_FILES[0]));
    assert.equal(await runtimesAreReady(),false);
  } finally {globalThis.caches=oldCache;globalThis.fetch=oldFetch;}
});

test('PWA manifest and precache paths work at a GitHub Pages project subpath', async () => {
  const manifest=JSON.parse(await readFile(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
  const base=new URL('https://example.test/redaction-showcase/');
  assert.equal(new URL(manifest.start_url,base).href,base.href);
  assert.equal(new URL(manifest.scope,base).href,base.href);
  assert.equal(manifest.display,'standalone');
  for (const file of APP_FILES.filter(file=>file!=='./')) await access(new URL('../'+file,import.meta.url));
  for (const icon of manifest.icons) {
    const image=await readFile(new URL('../'+icon.src,import.meta.url));
    assert.equal(image.readUInt32BE(16),Number(icon.sizes.split('x')[0]));
    assert.equal(image.readUInt32BE(20),Number(icon.sizes.split('x')[1]));
  }
});

test('service worker serves a cold navigation, worker modules, CDN library and external weights without network', async () => {
  const cacheStorage=storage();
  const app=await cacheStorage.open(APP_CACHE), data=await cacheStorage.open(DATA_CACHE);
  const base='https://example.test/redaction-showcase/';
  for (const file of APP_FILES) await app.put(new URL(file,base),new Response(file));
  await app.put(BUNDLE_URL,new Response('library'));
  const weights='https://huggingface.co/openai/privacy-filter/resolve/main/onnx/model_q4.onnx_data';
  await data.put(weights,new Response('weights'));
  const handlers=new Map();
  let network=0, claimed=false;
  const context=vm.createContext({
    APP_CACHE,DATA_CACHE,APP_FILES,BUNDLE_URL,caches:cacheStorage,URL,Request,
    fetch:async()=>{network++;throw Error('network disabled');},
    self:{registration:{scope:base},clients:{claim:async()=>{claimed=true;}},addEventListener:(event,handler)=>handlers.set(event,handler)},
  });
  const source=(await readFile(new URL('../sw.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  vm.runInContext(source,context);
  for (const url of [base+'?model=openai',base+'runtime-worker.js',base+'offline-storage.js',BUNDLE_URL,weights]) {
    let response;
    handlers.get('fetch')({request:new Request(url),respondWith:promise=>response=promise});
    assert.equal((await response).ok,true);
  }
  assert.equal(network,0);
  await cacheStorage.open('med-redact-app-old');
  await cacheStorage.open(READY_CACHE);
  let activation;
  handlers.get('activate')({waitUntil:promise=>activation=promise});
  await activation;
  assert.equal(claimed,true);
  assert.ok(!(await cacheStorage.keys()).includes('med-redact-app-old'));
  assert.ok((await cacheStorage.keys()).includes(DATA_CACHE));
  assert.ok((await cacheStorage.keys()).includes(READY_CACHE));
});
