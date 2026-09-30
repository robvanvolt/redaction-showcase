import { prepareDependencies, shellIsReady, runtimesAreReady, saveModelManifest, getModelStatus } from './offline-storage.js';

export function setupPWA({ models, usableKeys, activeKey, load, isLoading, onBusy }) {
  let supported = false, busy = false, installPrompt = null;
  let statuses = {};
  const el = id => document.getElementById(id);
  const online = () => navigator.onLine !== false;
  const installed = () => navigator.standalone || globalThis.matchMedia?.('(display-mode: standalone)').matches;

  async function refresh() {
    if (!supported) return;
    const keys = usableKeys();
    for (const key of keys) statuses[key] = await getModelStatus(key, models[key].dir);
    const readyCount = keys.filter(key => statuses[key].ready).length;
    const shell = await shellIsReady();
    const runtimes = await runtimesAreReady();
    const complete = shell && runtimes && readyCount === keys.length;
    el('offlineBadge').textContent = complete ? 'Offline-Demo bereit' : `Offline: ${readyCount}/${keys.length} Modelle`;
    el('offlineBadge').classList.toggle('ok', complete);
    el('pwaStatus').textContent = `${online() ? 'Online' : 'Offline'} · App ${shell ? 'gespeichert' : 'noch nicht vollständig gespeichert'} · ${readyCount}/${keys.length} verfügbare Modelle gespeichert`;
    el('pwaModels').textContent = keys.map(key => `${statuses[key].ready ? '✓' : '○'} ${models[key].label.split('·')[0].trim()}`).join('  ·  ');
    el('btnPrepareOffline').disabled = busy || !online();
    el('btnVerifyOffline').disabled = busy;
    if (navigator.storage?.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate();
        el('pwaStorage').textContent = `${((usage || 0) / 1e6).toFixed(0)} MB belegt${quota ? ` · ${(quota / 1e9).toFixed(1)} GB Speicherlimit` : ''}`;
      } catch { el('pwaStorage').textContent = 'Speicherstatus nicht verfügbar.'; }
    }
  }

  async function run(verify) {
    if (!supported || busy || isLoading()) return;
    const original = activeKey();
    busy = true;
    onBusy(true);
    el('btnPrepareOffline').disabled = true;
    el('btnVerifyOffline').disabled = true;
    try {
      if (verify) {
        if (!await shellIsReady() || !await runtimesAreReady()) throw new Error('App oder Runtimes fehlen. Bitte zuerst offline speichern.');
        for (const key of usableKeys()) {
          if (!(await getModelStatus(key, models[key].dir)).ready) throw new Error(`${models[key].label}: Bitte zuerst offline speichern.`);
        }
      } else {
        if (!online()) throw new Error('Zum ersten Download wird eine Internetverbindung benötigt.');
        // Called from a user gesture. Browsers decide whether to grant persistence.
        try { await navigator.storage?.persist?.(); } catch { /* Still use normal cache storage. */ }
        el('pwaMessage').textContent = 'App-Runtimes werden gespeichert …';
        await prepareDependencies();
      }
      // Release each model through the normal switch path; never hold all in RAM.
      for (const key of usableKeys()) {
        el('pwaMessage').textContent = `${verify ? 'Offline-Test' : 'Speichere'}: ${models[key].label}`;
        if (!await load(key, verify)) throw new Error(`${models[key].label}: ${verify ? 'Offline-Test' : 'Vorbereitung'} fehlgeschlagen. Bereits gespeicherte Dateien bleiben erhalten.`);
        if (!(await getModelStatus(key, models[key].dir)).ready) throw new Error('Dateien konnten nicht vollständig gespeichert werden. Bitte freien Speicher prüfen.');
      }
      if (original !== activeKey() && !await load(original, true)) throw new Error('Das vorherige Modell konnte offline nicht wieder geladen werden.');
      await refresh();
      el('pwaMessage').textContent = verify
        ? 'Offline-Test bestanden: Alle verfügbaren Modelle wurden in frischen Workern ausschließlich aus gespeicherten Dateien geladen. Jetzt Flugmodus einschalten und die App neu öffnen.'
        : 'Alle verfügbaren Modelle gespeichert. Bitte „Offline-Demo prüfen“ ausführen und danach im Flugmodus neu öffnen.';
    } catch (error) {
      el('pwaMessage').textContent = error?.message || String(error);
    } finally {
      busy = false;
      onBusy(false);
      try { await refresh(); }
      catch (error) { el('pwaMessage').textContent = 'Offline-Speicher konnte nicht geprüft werden: ' + error.message; }
    }
  }

  globalThis.addEventListener?.('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    el('btnInstall').textContent = 'App installieren';
  });
  el('btnInstall').addEventListener('click', async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
    } else {
      el('pwaHelp').hidden = false;
    }
  });
  el('btnPrepareOffline').addEventListener('click', () => run(false));
  el('btnVerifyOffline').addEventListener('click', () => run(true));
  for (const event of ['online', 'offline']) globalThis.addEventListener?.(event, () => refresh().catch(console.error));

  return {
    get busy() { return busy; },
    get offlineOnly() { return !online(); },
    async init() {
      if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) {
        el('pwaStatus').textContent = 'Offline-PWA benötigt HTTPS und einen Browser mit Service-Worker-Unterstützung.';
        return;
      }
      try {
        const registration = online()
          ? await navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { type: 'module', updateViaCache: 'none' })
          : await navigator.serviceWorker.getRegistration(new URL('./', import.meta.url));
        if (!registration) throw new Error('Bitte die Offline-App zuerst mit Internetverbindung vorbereiten.');
        if (!navigator.serviceWorker.controller) {
          await new Promise((resolve, reject) => {
            const ready = () => {
              if (!navigator.serviceWorker.controller) return;
              clearTimeout(timer);
              navigator.serviceWorker.removeEventListener('controllerchange', ready);
              resolve();
            };
            const timer = setTimeout(() => {
              navigator.serviceWorker.removeEventListener('controllerchange', ready);
              reject(new Error('Offline-App konnte nicht gestartet werden. Bitte online neu laden.'));
            }, 20000);
            navigator.serviceWorker.addEventListener('controllerchange', ready);
            ready();
          });
        }
        supported = true;
        if (installed()) { el('btnInstall').textContent = 'App installiert'; el('btnInstall').disabled = true; }
        await refresh();
      } catch (error) { el('pwaStatus').textContent = error?.message || String(error); }
    },
    async modelLoaded(key, active) {
      if (!supported) return;
      try {
        await saveModelManifest(key, await active.runtime.request('manifest'));
        await refresh();
      } catch (error) { el('pwaMessage').textContent = 'Modell läuft, aber Offline-Speichern fehlgeschlagen: ' + error.message; }
    },
    async preferredKey(key) {
      if (!supported || online()) return key;
      for (const candidate of [key, ...usableKeys()]) {
        if ((await getModelStatus(candidate, models[candidate].dir)).ready) return candidate;
      }
      return key;
    },
  };
}
