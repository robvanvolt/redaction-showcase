// Each attempt gets a fresh ONNX runtime. A failed backend initialization can
// poison the runtime's internal promise chain, so changing `device` alone is
// insufficient for a reliable fallback.
export function createRuntime(onProgress) {
  const workerURL = new URL('./runtime-worker.js', import.meta.url);
  const worker = new Worker(workerURL, { type: 'module' });
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  function rejectPending(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { onProgress?.(data.progress); return; }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    closed = true;
    worker.terminate();
    const detail = event.message || event.error?.message ||
      `Worker-Datei konnte nicht gestartet werden: ${workerURL.href}`;
    rejectPending(new Error(detail));
  };
  return {
    request(type, payload) {
      if (closed) return Promise.reject(new Error('Modell-Runtime wurde beendet.'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, type, ...payload });
      });
    },
    dispose() {
      closed = true;
      worker.terminate();
      rejectPending(new Error('Modell wurde gewechselt.'));
    },
  };
}

export function isAppleMobile(nav = navigator) {
  // iPad Safari also uses a desktop Macintosh user agent.
  return /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
}
