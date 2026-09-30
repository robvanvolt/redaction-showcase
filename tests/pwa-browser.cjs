// Real service-worker/module-worker lifecycle with tiny local model fixtures.
// No requests to model hubs/CDNs and no browser downloads.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const bundleURL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js';
const ortURL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
const fixture = `
export const env = { fetch: globalThis.fetch, backends: { onnx: { versions: { web: '1.26.0-dev.20260416-b7804b056c' }, wasm: {} } } };
const modelURL = (model, file) => location.origin + '/showcase/fixtures/models/' + model + '/' + file;
async function file(url, offlineOnly) {
  let response = await env.customCache.match(url);
  if (!response) {
    if (offlineOnly) throw Error('fixture refused network');
    response = await env.fetch(url);
    await env.customCache.put(url, response.clone());
  }
  return response.arrayBuffer();
}
export const AutoTokenizer = { async from_pretrained(model, opts) {
  for (const name of ['tokenizer.json','tokenizer_config.json']) await file(modelURL(model,name),opts.local_files_only);
  const tok = async text => ({ input_ids: { tolist: () => [[1]] } });
  tok.decode = () => 'Patient';
  return tok;
} };
export const AutoModelForTokenClassification = { async from_pretrained(model, opts) {
  for (const url of Object.values(env.backends.onnx.wasm.wasmPaths)) await file(url,opts.local_files_only);
  for (const name of ['config.json','onnx/model_' + opts.dtype + '.onnx', ...(model.includes('openai') ? ['onnx/model_q4.onnx_data'] : [])]) await file(modelURL(model,name),opts.local_files_only);
  opts.progress_callback?.({status:'ready'});
  const mdl = async () => ({ logits: { dims: [1,1,2], data: [10,0] } });
  mdl.config = { id2label: {'0':'O','1':'B-PERSON_NAME'} };
  return mdl;
} };
export async function pipeline(task, model, opts) {
  await AutoTokenizer.from_pretrained(model,opts);
  await AutoModelForTokenClassification.from_pretrained(model,opts);
  return async () => [];
}
`;
let browser;
let requests = 0;
const server = http.createServer(async (req, res) => {
  requests++;
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/showcase/')) { res.writeHead(404).end(); return; }
    const name = pathname.slice('/showcase/'.length) || 'index.html';
    if (name.startsWith('fixtures/')) {
      res.setHeader('Content-Type', name.endsWith('.js') || name.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
      res.end(name.endsWith('transformers.min.js') ? fixture : '{}'); return;
    }
    let content = await fs.readFile(path.join(root,name));
    if (/\.(js|html)$/.test(name)) {
      content = content.toString().replaceAll(bundleURL, '/showcase/fixtures/transformers.min.js').replaceAll(ortURL, '/showcase/fixtures/ort/').replace('const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.versions.web}/dist/`;', 'const prefix = `${location.origin}/showcase/fixtures/ort/`;');
      if (name === 'runtime-worker.js') content = `Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({})}});\n` + content;
    }
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'image/png');
    res.end(content);
  } catch (error) { res.writeHead(404).end(String(error)); }
});
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}/showcase/`;
  browser = await chromium.launch({ headless:true, executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const context = await browser.newContext({viewport:{width:810,height:1080},hasTouch:true,userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15'});
  await context.route('**/*',route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await context.addInitScript(() => {
    Object.defineProperty(navigator,'maxTouchPoints',{value:5});
    Object.defineProperty(navigator,'gpu',{value:{requestAdapter:async()=>({})}});
  });
  let page = await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error') console.error(m.text());});
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelector('#stEnt').textContent !== '–');
  await page.locator('#pwaPanel').evaluate(el=>el.open=true);
  await page.locator('#btnPrepareOffline').click();
  await page.waitForFunction(()=>document.querySelector('#pwaMessage').textContent.startsWith('Alle verfügbaren Modelle gespeichert'),{},{timeout:30000});
  assert.equal(await page.locator('#offlineBadge').textContent(),'Offline-Demo bereit');
  const saved = await page.evaluate(async()=>({
    manifests:(await (await caches.open('med-redact-ready-v1')).keys()).length,
    files:(await (await caches.open('transformers-cache')).keys()).map(r=>r.url),
    overflow:document.documentElement.scrollWidth>innerWidth,
  }));
  assert.equal(saved.manifests,4);
  assert.ok(saved.files.some(url=>url.endsWith('model_q4.onnx_data')),'external ONNX weights saved');
  assert.equal(saved.overflow,false,'iPad layout fits');
  await page.locator('#btnVerifyOffline').click();
  await page.waitForFunction(()=>document.querySelector('#pwaMessage').textContent.startsWith('Offline-Test bestanden'),{},{timeout:30000});
  assert.equal(errors.length,0,errors.join('\n'));
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#overlay')).opacity === '0');
  await page.screenshot({path:'/tmp/redaction-pwa-fixture.png',fullPage:true});
  await context.setOffline(true);
  await page.close();
  const before = requests;
  page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'?model=openai');
  await page.waitForFunction(()=>document.querySelector('#stEnt').textContent !== '–');
  assert.equal(await page.locator('#optModel').inputValue(),'openai');
  assert.equal(await page.locator('#offlineBadge').textContent(),'Offline-Demo bereit');
  await page.locator('#optModel').selectOption('shield');
  await page.waitForFunction(()=>document.querySelector('#modelBadge').textContent === 'LH-Tech-AI/Shield-82M' && document.querySelector('#stEnt').textContent !== '–');
  await page.locator('#input').fill('Patient: Max Mustermann. E-Mail: max@example.com');
  await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('[EMAIL_ADDRESS]'));
  await page.locator('#pwaPanel').evaluate(el=>el.open=true);
  await page.locator('#btnVerifyOffline').click();
  await page.waitForFunction(()=>document.querySelector('#pwaMessage').textContent.startsWith('Offline-Test bestanden'),{},{timeout:30000});
  assert.equal(requests,before,'cold start and all-model offline verification made zero server requests');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: GitHub Pages subpath, all four model manifests, external ONNX data, offline verification, fresh offline page/workers, switching and editing; zero network requests.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
