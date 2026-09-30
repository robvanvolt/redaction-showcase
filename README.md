# med redact · Echtzeit-PII-Anonymisierung im Browser

**Live-Demo: https://robvanvolt.github.io/redaction-showcase/**

Showcase-Webapp: links ein editierbares (fiktives) medizinisches Gutachten, rechts die in
Echtzeit anonymisierte Fassung – komplett lokal im Browser via WebGPU (automatischer
WASM/CPU-Fallback). **Es verlässt kein Text den Browser.**

## Modelle

Alle Gewichte werden beim ersten Laden direkt vom Hugging-Face-CDN bezogen (dieses
Repository enthält keine Modelldateien) und anschließend vom Browser gecacht.
Umschaltbar über das Dropdown im Frontend:

| Modell | Klassen | Größe | Quelle |
| --- | --- | --- | --- |
| EU-Multilingual (XLM-R) | 36 GDPR-Klassen, 24 EU-Sprachen | ≈279 MB (INT8) | [`bardsai/eu-pii-anonimization-multilang`](https://huggingface.co/bardsai/eu-pii-anonimization-multilang) |
| Shield-82M (DistilRoBERTa) | 56 PII-Klassen | ≈82 MB (INT8) | [`onnx-community/Shield-82M-ONNX`](https://huggingface.co/onnx-community/Shield-82M-ONNX) |
| Rampart (MiniLM-L6) | 17 Klassen, 7 Sprachen | ≈14.7 MB (Q4) | [`nationaldesignstudio/rampart`](https://huggingface.co/nationaldesignstudio/rampart) |
| OpenAI Privacy Filter (MoE 1.4B / 50M aktiv) | 8 Klassen (BIOES), 131k Kontext | ≈917 MB (Q4) | [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter) |

> Das OpenAI-Modell benötigt **WebGPU** und lädt knapp 1 GB. Es ist auch auf
> iPad/iPhone auswählbar, sobald der Browser einen WebGPU-Adapter bereitstellt
> (Safari ab iPadOS/iOS 26). Ohne Adapter bleibt es deaktiviert; ein Link mit
> `?model=openai` startet dann stattdessen Rampart. Ein verfügbarer Adapter
> garantiert nicht, dass der Arbeitsspeicher für dieses große Modell reicht.

## iPad / Safari

Auf iPad/iPhone (auch mit Safaris Desktop-User-Agent) startet standardmäßig
**Rampart (14.7 MB)** mit **WASM auf der CPU**. Das hält den Speicherbedarf auf
Geräten wie dem iPad der 9. Generation niedrig. EU-Multilingual und Shield bleiben
manuell auswählbar; ihre größeren Downloads benötigen entsprechend mehr Speicher.
Die CPU-Inferenz kann länger dauern als auf einer Desktop-GPU.
Für OpenAI Privacy Filter wird WebGPU auch auf iPad/iPhone geprüft und verwendet.
Der Worker prüft seinen GPU-Adapter zusätzlich vor dem Download. Die drei kleinen
Modelle verwenden auf iPad/iPhone weiterhin CPU/WASM. Ohne GPU zeigt die
Modellauswahl die konkrete Voraussetzung statt einer allgemeinen Gerätesperre.

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
node --test tests/runtime.test.mjs
```

Diese Tests verwenden simulierte Runtime-Antworten; sie ersetzen keinen Test der
tatsächlichen Modell-Inferenz auf einem iPad.

## Deployment

GitHub Pages, Branch `main`, Ordner `/` (root). `index.html` liegt im Repo-Wurzelverzeichnis.

## Struktur

```
index.html          selbstständige App (CDN + Import-Map für transformers.js)
runtime-client.js   Worker-Kommunikation und iPad/iPhone-Erkennung
runtime-worker.js   gepinnte ONNX-Runtime, Modell-Laden und Inferenz
rampart/index.js    gebündelte Rampart-Runtime
.nojekyll           Jekyll-Verarbeitung auf GitHub Pages abschalten
```

Alle Beispieldaten sind fiktiv.
