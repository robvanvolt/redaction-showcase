# med redact · Echtzeit-PII-Anonymisierung im Browser

**Live-Demo: https://robvanvolt.github.io/redaction-showcase/**

Showcase-Webapp: links ein editierbares (fiktives) medizinisches Gutachten, rechts die in
Echtzeit anonymisierte Fassung – komplett lokal im Browser via WebGPU (automatischer
WASM/CPU-Fallback). **Es verlässt kein Text den Browser.**

## Offline-PWA für Vorführungen

Die App lässt sich installieren und nach der Vorbereitung vollständig ohne
Internet neu starten – inklusive Modellwechsel und Export.

1. **Zuerst installieren.** Auf dem iPad in Safari: Teilen → Zum Home-Bildschirm.
   Auf Desktop/Android die Browser-Installation oder „App installieren“ nutzen.
2. **Die installierte App online öffnen**, dann „App installieren & Offline-Demo
   vorbereiten“ aufklappen.
3. **„Alle Modelle offline speichern“** wählen und warten, bis die
   Vorbereitung abgeschlossen ist. Beide Modelle benötigen zusammen etwa
   **97 MB Gewichte**, dazu Tokenizer und CPU-/GPU-Runtimes. Der Download läuft
   Modell für Modell; bereits gespeicherte Dateien werden wiederverwendet.
4. **„Offline-Demo prüfen“** wählen. Jedes verfügbare Modell wird in einem neuen
   Worker mit ausschließlich gespeicherten Modell-/Runtime-Dateien geladen und
   auf dem aktuellen Text ausgeführt.
5. **Flugmodus einschalten, die App schließen und neu öffnen.** Jetzt ohne
   Internet Text eingeben, Modelle wechseln und Ergebnisse kopieren/exportieren.

Die Anzeige „Offline-Demo bereit“ prüft die tatsächlichen Cache-Einträge, nicht
nur einen früheren Download. Fehlen Dateien, z. B. nach Speicherbereinigung,
wird das Modell nicht mehr als bereit angezeigt. Rampart und Shield-82M können
auf allen unterstützten Geräten vorbereitet werden.
Ein Test mit echten Gewichten auf dem jeweiligen iPad bleibt vor der Vorführung
erforderlich; die automatisierten Browser-Tests verwenden kleine Fixtures.

Die App speichert HTML, Module, Icons und das vollständige Transformers-Bundle.
Die ONNX-Dateien, einschließlich externer Gewichtsdateien, Tokenizer und beide
WASM-Runtime-Paare teilen sich den vorhandenen Transformers-Cache; es wird keine
zweite Kopie der großen Modelle angelegt. Metadaten halten fest, welche Dateien
pro Modell erfolgreich gespeichert wurden. Eingegebene Texte werden nicht
persistiert. App-Updates ersetzen den App-Cache und behalten die angebotenen Modelle.
Die entfernten Modelle OpenAI Privacy Filter und Bardsai werden beim Aktivieren
dieser App-Version aus dem Modell-Cache entfernt, um Speicher freizugeben.

Safari kann Speicher bei Platzmangel entfernen. Die App beantragt dauerhaften
Speicher, soweit unterstützt; der Browser entscheidet darüber. Installierte
iPad-Apps können einen eigenen Speicherbereich haben: deshalb **erst installieren,
dann innerhalb dieser App vorbereiten** und vor der Vorführung im Flugmodus testen.
Ein privates Browserfenster ist für dauerhaft gespeicherte Offline-Demos ungeeignet.

## Modelle

Alle Gewichte werden beim ersten Laden direkt vom Hugging-Face-CDN bezogen (dieses
Repository enthält keine Modelldateien) und anschließend vom Browser gecacht.
Umschaltbar über das Dropdown im Frontend:

| Modell | Klassen | Größe | Quelle |
| --- | --- | --- | --- |
| Shield-82M (DistilRoBERTa) | 56 PII-Klassen | ≈82 MB (INT8) | [`onnx-community/Shield-82M-ONNX`](https://huggingface.co/onnx-community/Shield-82M-ONNX) |
| Rampart (MiniLM-L6) | 17 Klassen, 7 Sprachen | ≈14.7 MB (Q4) | [`nationaldesignstudio/rampart`](https://huggingface.co/nationaldesignstudio/rampart) |

Rampart startet standardmäßig. Alte Links auf entfernte Modelle starten ebenfalls Rampart.

## iPad / Safari

Auf iPad/iPhone (auch mit Safaris Desktop-User-Agent) startet standardmäßig
**Rampart (14.7 MB)** mit **WASM auf der CPU**. Das hält den Speicherbedarf auf
Geräten wie dem iPad der 9. Generation niedrig. Shield bleibt manuell auswählbar;
sein größerer Download benötigt entsprechend mehr Speicher.
Beide Modelle verwenden auf iPad/iPhone CPU/WASM.
Die CPU-Inferenz kann länger dauern als auf einer Desktop-GPU.

Modell und Inferenz laufen in einem eigenen Module-Web-Worker, damit die Oberfläche
bedienbar bleibt. Beim Modellwechsel wird der vorige Worker samt Modell beendet.
Der Worker importiert das vollständige `transformers.min.js`-Browser-Bundle:
`transformers.web.js` enthält Paketimporte für Bundler, die ohne Import-Map im
Worker nicht aufgelöst werden können. Der Import erfolgt im Ladehandler, damit
auch CDN-/Importfehler mit ihrer Ursache in der Oberfläche erscheinen.
WebGPU wird auf anderen Geräten versucht; schlägt das Laden eines CPU-fähigen
Modells fehl, startet ein neuer Worker mit WASM. Ein fehlgeschlagener ONNX-Start
kann dadurch die CPU-Runtime nicht blockieren. Ladefehler bieten Wiederholen und
den Wechsel zu Rampart an.

Die ONNX-JavaScript- und WASM-Dateien kommen aus derselben gepinnten Version.
WebGPU verwendet das JSEP-Dateipaar mit `webgpuInit`, die CPU das normale
WASM-Dateipaar. Es wird ein WASM-Thread verwendet, da GitHub Pages keine
Cross-Origin-Isolation bereitstellt. Safari benötigt Module-Worker und Import-Maps
(Safari/iPadOS 16.4 oder neuer).

Ergänzt wird das Ganze durch eine client-seitige **Regex-Hybrid-Schicht** als
Sicherheitsnetz (Daten, IBAN, Kennzeichen, Dokumentnummern …) sowie Post-Processing:
Wortgrenzen-Snap, Personen-/Adress-Teilmerge und prioritätsbasierter Span-Merge.

## Features

- Zwei-Spalten-Ansicht: Original (editierbar) ↔ anonymisierte Fassung
- Echtzeit-Anonymisierung bei jeder Eingabe (Debounce 280 ms, veraltete Läufe werden verworfen)
- **4 Anzeigemodi**: `[KLASSE]` / `private_klasse` / Blockbalken / **Pseudonyme**
  (konsistente, deterministische Ersatzwerte inkl. formaterhaltender Datums-Verschiebung)
- **Export**: Kopieren, `.txt`, `.json`-Entity-Report (Offsets, Typen, Konfidenz, Pseudonyme)
- 3 Beispiel-Gutachten: neurologisch, kardiologisch, Kfz-Sachverständigen
- Confidence-Schwelle einstellbar, Regex-Layer zuschaltbar
- Entity-Liste mit Konfidenz + Kategorie-Farblegende
- „Original anzeigen“-Hover/Toggle zur Prüfung der Treffer
- Statusleiste: Backend (WebGPU/WASM), Inferenzzeit, Token-/Entity-Zahl

## Stack

- [transformers.js v4.2.0](https://github.com/huggingface/transformers.js) (ONNX Runtime Web), via CDN + Import-Map
- Rampart-Runtime aus dem [Original-Repo](https://github.com/nationaldesignstudio/rampart)
  gebündelt (`rampart/index.js`, esbuild; transformers.js als Peer-Dependency über die Import-Map geteilt) –
  deterministische Recognizer-Layer (Luhn/SSN-Validatoren), Premask-Pipeline, Default-Deny-Policy
  (optional: Stadt/Bundesland/PLZ behalten)

## Lokal starten

Ein beliebiger statischer Server genügt – es gibt keinen Build-Schritt:

```bash
python3 -m http.server 8471
```

Dann `http://localhost:8471` öffnen.

Die Kompatibilitäts- und Fehlerpfade lassen sich ohne Downloads prüfen:

```bash
node --test tests/runtime.test.mjs tests/offline.test.mjs
```

Diese Tests verwenden simulierte Runtime-Antworten; sie ersetzen keinen Test der
tatsächlichen Modell-Inferenz auf einem iPad.

Ein zusätzlicher Browser-Test prüft echte Service-/Module-Worker, einen frischen
Offline-Start, beide Modelle, Modellwechsel und Eingabe
mit winzigen lokalen Fixtures und **null Netzwerkzugriffen nach dem Offline-Start**.
Er benötigt eine vorhandene Playwright-Installation und ein installiertes Chrome:

```bash
node tests/pwa-browser.cjs
```

Bei Bedarf `PLAYWRIGHT_MODULE` auf die vorhandene Playwright-Installation und
`CHROME_EXECUTABLE` auf die Chrome-Datei setzen. Der Test lädt weder Modelle noch
Browser herunter und blockiert sämtliche externen Requests.

## Deployment

GitHub Pages, Branch `main`, Ordner `/` (root). `index.html` liegt im Repo-Wurzelverzeichnis.
Bei Änderungen an App-Dateien die Version von `APP_CACHE` in `pwa-config.js`
erhöhen. Den Daten-Cache unverändert lassen, damit Modell-Downloads erhalten
bleiben. Ein neues App-Update wird aktiv, sobald die bisherigen App-Fenster
geschlossen sind.

## Struktur

```
index.html          selbstständige App (CDN + Import-Map für transformers.js)
runtime-client.js   Worker-Kommunikation und iPad/iPhone-Erkennung
runtime-worker.js   gepinnte ONNX-Runtime, Modell-Laden und Inferenz
pwa.js              Installation, Download aller Modelle und Offline-Prüfung
pwa-config.js       Cache-Versionen, App-Dateien und gepinnte CDN-Adressen
offline-storage.js  gemeinsame Caches und geprüfte Modell-Metadaten
sw.js               Offline-App, Bibliotheks- und Runtime-Auslieferung
manifest.webmanifest PWA-Metadaten mit relativem GitHub-Pages-Scope
icons/              App- und iPad-Home-Screen-Icons
rampart/index.js    gebündelte Rampart-Runtime
.nojekyll           Jekyll-Verarbeitung auf GitHub Pages abschalten
```

Alle Beispieldaten sind fiktiv.
