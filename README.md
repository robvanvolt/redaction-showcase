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

> Das OpenAI-Modell benötigt **WebGPU** und lädt knapp 1 GB – bitte nur in einem
> Chromium/Edge 113+ auswählen und etwas Geduld mitbringen.

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

## Deployment

GitHub Pages, Branch `main`, Ordner `/` (root). `index.html` liegt im Repo-Wurzelverzeichnis.

## Struktur

```
index.html          selbstständige App (CDN + Import-Map für transformers.js)
rampart/index.js    gebündelte Rampart-Runtime
.nojekyll           Jekyll-Verarbeitung auf GitHub Pages abschalten
```

Alle Beispieldaten sind fiktiv.
