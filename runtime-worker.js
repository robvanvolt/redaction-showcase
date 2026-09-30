import {
  AutoTokenizer, AutoModelForTokenClassification, pipeline, env,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.web.js';
import { loadNerClassifier, detectNer } from './rampart/index.js';

env.allowLocalModels = false;
env.allowRemoteModels = true;

let active;
const progress_callback = (progress) => self.postMessage({ type: 'progress', progress });

async function load({ model, device }) {
  const ort = env.backends.onnx;
  const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.versions.web}/dist/`;
  // Safari's default plain WASM binary has no webgpuInit export. Use the
  // matching JSEP pair for WebGPU; plain WASM is sufficient for CPU inference.
  const asset = device === 'webgpu' ? 'ort-wasm-simd-threaded.jsep' : 'ort-wasm-simd-threaded';
  ort.wasm.wasmPaths = { mjs: `${prefix}${asset}.mjs`, wasm: `${prefix}${asset}.wasm` };
  // GitHub Pages does not provide cross-origin isolation for WASM threads.
  ort.wasm.numThreads = 1;
  ort.wasm.proxy = false; // Already running outside the UI thread.

  if (model.kind === 'rampart') {
    const classifier = await loadNerClassifier({
      model: model.dir, device, transformers: { pipeline }, progress_callback,
    });
    active = { kind: 'rampart', classifier };
  } else {
    const tok = await AutoTokenizer.from_pretrained(model.dir, { progress_callback });
    const mdl = await AutoModelForTokenClassification.from_pretrained(model.dir, {
      device, dtype: model.dtype || 'q8', progress_callback,
    });
    active = { tok, mdl, maxLen: model.maxLen };
  }
}

async function infer({ text, minConf }) {
  if (active.kind === 'rampart') return detectNer(text, active.classifier, minConf);
  const enc = await active.tok(text, { truncation: true, max_length: active.maxLen });
  const pieces = enc.input_ids.tolist().flat().map((id) => active.tok.decode([Number(id)]));
  const out = await active.mdl(enc);
  const [, S, C] = out.logits.dims;
  const data = out.logits.data;
  const labels = [];
  for (let i = 0; i < S; i++) {
    let best = -Infinity, bi = 0;
    for (let c = 0; c < C; c++) {
      const v = data[i * C + c];
      if (v > best) { best = v; bi = c; }
    }
    let sum = 0;
    for (let c = 0; c < C; c++) sum += Math.exp(data[i * C + c] - best);
    labels.push({ t: active.mdl.config.id2label[String(bi)], c: 1 / sum });
  }
  return { pieces, labels, tokCount: S };
}

// Serialize inference, while allowing the UI to discard stale results.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const result = data.type === 'load' ? await load(data) : await infer(data);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      self.postMessage({ id: data.id, error: error?.message || String(error) });
    }
  });
};
