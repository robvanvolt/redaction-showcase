import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRuntime, isAppleMobile } from '../runtime-client.js';

test('iPads with mobile or desktop user agents use the memory-conscious path', () => {
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)', maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 }), true);
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 0 }), false);
  assert.equal(isAppleMobile({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 10 }), false);
});

test('worker client delivers progress, rejects failures, and cancels pending work on model switches', async () => {
  let worker;
  globalThis.Worker = class {
    constructor(url, options) { worker = this; this.options = options; this.url = url; }
    postMessage(message) { this.message = message; }
    terminate() { this.terminated = true; }
  };
  const updates = [];
  const runtime = createRuntime(p => updates.push(p));
  assert.equal(worker.options.type, 'module');
  const load = runtime.request('load', { device: 'webgpu' });
  worker.onmessage({ data: { type: 'progress', progress: { loaded: 10 } } });
  worker.onmessage({ data: { id: worker.message.id, error: 'webgpuInit is not a function' } });
  await assert.rejects(load, /webgpuInit/);
  assert.deepEqual(updates, [{ loaded: 10 }]);
  const inference = runtime.request('infer', { text: 'Test' });
  runtime.dispose();
  await assert.rejects(inference, /gewechselt/);
  assert.equal(worker.terminated, true);
  await assert.rejects(runtime.request('load', {}), /beendet/);
  const second = createRuntime();
  const result = second.request('load', { device: 'wasm' });
  worker.onmessage({ data: { id: worker.message.id, result: 'ready' } });
  assert.equal(await result, 'ready');
  second.dispose();
  delete globalThis.Worker;
});

test('worker uses version-matched GPU/CPU assets, passes progress to Rampart and serializes inference', async () => {
  const source = (await readFile(new URL('../runtime-worker.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+from '\.\/(?:rampart\/index|offline-storage)\.js';\n/gm, '')
    .replace(/import\('https:[^']+'\)/, 'importTransformers()');
  for (const device of ['webgpu', 'wasm']) {
    const messages = [];
    let options;
    let concurrent = 0, peak = 0;
    const env = { backends: { onnx: { versions: { web: 'test-version' }, wasm: {} } } };
    const context = vm.createContext({
      env, pipeline: () => {},
      trackingCache: async () => ({ files: new Set(), match: async () => undefined, put: async () => {} }),
      navigator: { gpu: { requestAdapter: async () => ({}) } },
      importTransformers: async () => ({ env, pipeline: context.pipeline }),
      self: { postMessage: m => messages.push(m) },
      loadNerClassifier: async o => { options = o; o.progress_callback({ status: 'ready' }); return () => {}; },
      detectNer: async text => {
        peak = Math.max(peak, ++concurrent);
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrent--;
        return [{ text, label: 'GIVEN_NAME', start: 0, end: text.length, score: 0.9 }];
      }, setTimeout,
    });
    vm.runInContext(source, context);
    context.self.onmessage({ data: { id: 1, type: 'load', model: { kind: 'rampart', dir: 'test-model' }, device } });
    context.self.onmessage({ data: { id: 2, type: 'infer', text: 'Max', minConf: 0.4 } });
    context.self.onmessage({ data: { id: 3, type: 'infer', text: 'Anna', minConf: 0.4 } });
    await vm.runInContext('queue', context);
    assert.equal(peak, 1);
    assert.equal(options.device, device);
    assert.equal(options.transformers.pipeline, context.pipeline);
    const asset = device === 'webgpu' ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
    assert.equal(env.backends.onnx.wasm.wasmPaths.mjs, `https://cdn.jsdelivr.net/npm/onnxruntime-web@test-version/dist/${asset}.mjs`);
    assert.equal(env.backends.onnx.wasm.wasmPaths.wasm, `https://cdn.jsdelivr.net/npm/onnxruntime-web@test-version/dist/${asset}.wasm`);
    assert.equal(env.backends.onnx.wasm.numThreads, 1);
    assert.equal(env.backends.onnx.wasm.proxy, false);
    assert.deepEqual(messages.filter(m => m.id).map(m => m.id), [1, 2, 3]);
    assert.equal(messages.find(m => m.id === 3).result[0].text, 'Anna');
  }
});

async function appHarness({ nav, search = '', failLoad = () => false, failInfer = () => false }) {
  const rampart = await import('../rampart/index.js');
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', innerHTML: '', checked: false, hidden: true,
      style: {}, listeners: new Map(),
      classList: { values: new Set(), add(...v) { v.forEach(x => this.values.add(x)); }, remove(...v) { v.forEach(x => this.values.delete(x)); } },
      addEventListener(type, handler) { this.listeners.set(type, handler); },
    });
    return elements.get(id);
  }
  element('optConf').value = '35';
  element('optMode').value = 'bracket';
  element('optRegex').checked = true;
  const attempts = [], runtimes = [];
  const context = vm.createContext({
    setupPWA: () => ({ busy: false, offlineOnly: false, init: async () => {}, preferredKey: async key => key, modelLoaded: async () => {} }),
    ...rampart, isAppleMobile: () => isAppleMobile(nav), navigator: nav, location: { search }, URLSearchParams,
    performance, setTimeout, clearTimeout, console: { error() {}, warn() {} },
    document: { getElementById: element },
    createRuntime: onProgress => {
      const runtime = {
        disposed: false,
        async request(type, data) {
          if (type === 'load') {
            this.model = data.model;
            attempts.push(data);
            if (failLoad(data)) throw Error('no available backend found: webgpuInit is not a function');
            onProgress({ status: 'ready' });
          } else {
            if (failInfer(data)) throw Error('inference failed');
            return this.model.kind === 'rampart' ? [] : { pieces: [], labels: [], tokCount: 0 };
          }
        }, dispose() { this.disposed = true; },
      };
      runtimes.push(runtime);
      return runtime;
    },
  });
  const source = (await readFile(new URL('../index.html', import.meta.url), 'utf8'))
    .split('<script type="module">')[1].split('</script>')[0]
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace('(async function init() {', 'globalThis.initialized = (async function init() {');
  vm.runInContext(source, context);
  await context.initialized;
  return { context, element, attempts, runtimes };
}

test('iPad desktop mode starts Rampart on CPU even when WebGPU is exposed', async () => {
  let probes = 0;
  const app = await appHarness({ nav: {
    userAgent: 'Macintosh', maxTouchPoints: 5,
    gpu: { requestAdapter: async () => { probes++; return {}; } },
  } });
  assert.equal(probes, 1);
  assert.equal(app.attempts.length, 1);
  assert.equal(app.attempts[0].model.kind, 'rampart');
  assert.equal(app.attempts[0].device, 'wasm');
  assert.equal(app.element('backendBadge').textContent, 'WASM (CPU)');
  assert.equal(app.element('overlay').classList.values.has('hidden'), true);
  assert.match(app.element('output').innerHTML, /\[EMAIL\]/);
});

test('removed model links safely start Rampart on iPad and desktop', async () => {
  for (const nav of [
    { userAgent: 'iPad', maxTouchPoints: 5, gpu: { requestAdapter: async () => ({}) } },
    { userAgent: 'Firefox', maxTouchPoints: 0 },
  ]) {
    for (const key of ['openai', 'bardsai']) {
      const app = await appHarness({ nav, search: '?model=' + key });
      assert.equal(app.element('optModel').value, 'rampart');
      assert.equal(app.attempts[0].device, 'wasm');
      assert.equal(app.attempts.length, 1);
    }
  }
});

test('the iPad showcase offers only Rampart and Shield; switching stays on CPU', async () => {
  const app = await appHarness({ nav: {
    userAgent: 'Macintosh', maxTouchPoints: 5, gpu: { requestAdapter: async () => ({}) },
  } });
  assert.deepEqual(Array.from(vm.runInContext('Object.keys(MODELS).sort()', app.context)), ['rampart', 'shield']);
  await vm.runInContext("selectModel('shield')", app.context);
  assert.equal(app.runtimes[0].disposed, true);
  assert.equal(app.attempts[1].device, 'wasm');
  assert.equal(app.element('optModel').value, 'shield');
});

test('failed GPU loads fall back in fresh runtimes on startup and model changes', async () => {
  const app = await appHarness({
    nav: { userAgent: 'Chrome', maxTouchPoints: 0, gpu: { requestAdapter: async () => ({}) } },
    failLoad: data => data.device === 'webgpu',
  });
  assert.deepEqual(app.attempts.map(x => x.device), ['webgpu', 'wasm']);
  assert.equal(app.runtimes[0].disposed, true);
  assert.equal(app.runtimes[1].disposed, false);
  await vm.runInContext("selectModel('shield')", app.context);
  assert.equal(app.runtimes[1].disposed, true);
  assert.deepEqual(app.attempts.map(x => x.device), ['webgpu', 'wasm', 'webgpu', 'wasm']);
  assert.equal(app.element('optModel').value, 'shield');
  assert.equal(app.element('backendBadge').textContent, 'WASM (CPU)');
  assert.equal(app.element('overlay').classList.values.has('hidden'), true);
});

test('CPU download failures remain recoverable by switching to Rampart', async () => {
  const app = await appHarness({
    nav: { userAgent: 'Firefox', maxTouchPoints: 0 }, search: '?model=shield',
    failLoad: data => data.model.dir.includes('Shield-82M'),
  });
  assert.equal(app.element('loadRecovery').hidden, false);
  assert.equal(app.element('overlay').classList.values.has('hidden'), false);
  assert.equal(app.runtimes[0].disposed, true);
  await app.element('btnSmallModel').listeners.get('click')();
  assert.equal(app.element('optModel').value, 'rampart');
  assert.equal(app.element('loadRecovery').hidden, true);
  assert.equal(app.element('overlay').classList.values.has('hidden'), true);
});

test('inference failures show recovery and leave the text retryable', async () => {
  let shouldFail = true;
  const app = await appHarness({
    nav: { userAgent: 'iPad', maxTouchPoints: 5 }, failInfer: () => shouldFail,
  });
  assert.equal(app.element('loadRecovery').hidden, false);
  shouldFail = false;
  await app.element('btnRetry').listeners.get('click')();
  assert.equal(app.element('loadRecovery').hidden, true);
  assert.equal(app.element('overlay').classList.values.has('hidden'), true);
});

test('worker bootstrap uses the standalone browser bundle and reports import failures to the UI', async () => {
  const original = await readFile(new URL('../runtime-worker.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dependencyURL = original.match(/await import\('([^']+)'\)/)?.[1];
  assert.equal(dependencyURL, 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js');
  assert.equal(JSON.parse(html.split('<script type="importmap">')[1].split('</script>')[0]).imports['@huggingface/transformers'], dependencyURL);
  // There must be no static CDN import that can fail before onmessage exists.
  assert.doesNotMatch(original, /^import[\s\S]*?from ['"]https:/m);
  const messages = [];
  const source = original
    .replace(/^import[^\n]+from '\.\/(?:rampart\/index|offline-storage)\.js';\n/gm, '')
    .replace(/import\('https:[^']+'\)/, 'importTransformers()');
  const context = vm.createContext({
    self: { postMessage: message => messages.push(message) },
    importTransformers: async () => { throw new TypeError('Failed to fetch dynamically imported module'); },
  });
  vm.runInContext(source, context);
  context.self.onmessage({ data: { id: 1, type: 'load', model: { kind: 'rampart' }, device: 'wasm' } });
  await vm.runInContext('queue', context);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 1);
  assert.match(messages[0].error, /Modell-Bibliothek konnte nicht importiert werden: Failed to fetch/);
});

test('missing worker GPU fails before any library or model download', async () => {
  const source = (await readFile(new URL('../runtime-worker.js', import.meta.url), 'utf8'))
    .replace(/^import[^\n]+from '\.\/(?:rampart\/index|offline-storage)\.js';\n/gm, '')
    .replace(/import\('https:[^']+'\)/, 'importTransformers()');
  let imports = 0;
  const messages = [];
  const context = vm.createContext({
    navigator: {},
    self: { postMessage: message => messages.push(message) },
    importTransformers: async () => { imports++; throw Error('must not be downloaded'); },
  });
  vm.runInContext(source, context);
  context.self.onmessage({ data: { id: 1, type: 'load', model: { dir: 'onnx-community/Shield-82M-ONNX' }, device: 'webgpu' } });
  await vm.runInContext('queue', context);
  assert.equal(imports, 0);
  assert.match(messages[0].error, /WebGPU ist im Modell-Worker nicht verfügbar/);
});
