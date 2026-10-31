# PartLens

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?style=flat-square)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?style=flat-square)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?style=flat-square)](https://www.docker.com/)
[![Dataset](https://img.shields.io/badge/Dataset-YOLO%20%7C%20COCO-orange.svg?style=flat-square)](https://docs.ultralytics.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

> **PartLens** ist ein intelligentes Inspektions- und Annotations-Studio für Leiterplatten (PCBs), das Computer Vision, Texterkennung (OCR) und multimodale LLMs kombiniert, um elektronische Bauteile aus Fotos und Live-Videostreams automatisch zu erkennen, zu klassifizieren, zu dekodieren und zu katalogisieren.

**Sprache:** [English](README.md) | [Deutsch](README.de.md)

---

## Kernfunktionen

- **Mehrstufige KI-Pipeline**:
  - **Stufe 0 (Lokalisierung)**: Automatische Bounding-Box-Erkennung von Bauteilen auf Leiterplatten via Kantenheuristiken, Florence-2 oder YOLO.
  - **Stufe 1 (Klassifizierung)**: Standardisierte Einordnung in 14 elektronische Bauteilklassen.
  - **Stufe 2 (OCR & Beschriftung)**: Textextraktion für integrierte Schaltkreise (ICs), Mikrocontroller und Lasergravuren.
  - **Stufe 3 (Widerstands-Decoder)**: Automatische Farbring-Erkennung und Widerstandsberechnung (4- und 5-Ring-Codes mit Toleranz und Abgleich gegen E-Reihen).
  - **Stufe 4 (Footprint-Matching)**: Abgleich und Vektor-Vorschau von Part-DB Gehäuse-Footprints (SOIC, QFP, TQFP, TSSOP, BGA, SOT, SMD, THT).
  - **Stufe 5 (Multimodales LLM)**: Zero-Shot-Bauteilanalyse und automatische Etikettierung mit Google Gemini (1.5 / 2.0 / 3.x) oder lokalen Vision-Modellen (Qwen2.5-VL via Ollama).
- **Interaktives Annotations-Studio**:
  - CAD- & Figma-Canvas mit flüssigem Pan, Zoom, Touch-Gesten (Pinch-to-Zoom) und Touch-Lupe für Mobilgeräte/iPhones.
  - **Fokus- & Isoliermodus (`F`)**: Blendet auf Tastendruck alle nicht ausgewählten Boxen aus, um Leiterbahnen und Lötstellen ungestört zu inspizieren.
  - **Transparenzsteuerung (`O`)**: Stufenlose Box-Deckkraft für optimale Sicht auf Leiterbahnen.
  - **Schnellbearbeitung**: Zifferntasten `1-9` für 1-Klick-Klassenbelegung, `R` zum Aufziehen manueller Boxen und schwebendes Roboflow-Quick-Tag-Popover.
- **Datensatz-Verwaltung**:
  - Direkter Im- und Export für **YOLO** (`.txt` + `data.yaml`) und **COCO** (`instances.json`).
  - Integrierte Galerie mit Filterung nach Klassen, Statistiken und Train/Val-Splits.
  - Konvertierungsskript für Mendeley Data (ElectroCom61) und Roboflow-Exporte.

---

## Die 14 standardisierten Bauteilklassen

| ID | Klassenname | Beschreibung |
|:--:|:------------|:-------------|
| 0 | `resistor` | Widerstände (SMD und axiale bedrahtete Bauteile) |
| 1 | `capacitor` | Kondensatoren (Keramik, Elektrolyt, Tantal) |
| 2 | `inductor` | Induktivitäten, Spulen, Drosseln |
| 3 | `diode` | Dioden, Zener-Dioden, Schottky-Dioden |
| 4 | `led` | Leuchtdioden |
| 5 | `transistor` | Bipolar- und Feldeffekttransistoren |
| 6 | `ic` | Integrierte Schaltkreise, MCUs, Flash-Chips |
| 7 | `potentiometer` | Trimmer, Potentiometer |
| 8 | `switch_button` | Kurzhubtaster, Schalter |
| 9 | `relay` | Elektromechanische und Halbleiterrelais |
| 10 | `connector` | USB-Buchsen, Stiftleisten, Klemmen |
| 11 | `display` | 7-Segment-, OLED- und LCD-Anzeigen |
| 12 | `board` | Submodule, Sensorboards, Tochterplatinen |
| 13 | `other` | Quarze, Testpunkte, sonstige passive Teile |

---

## Schnelleinstieg

### Variante A: Lokale Python-Installation

#### Voraussetzungen
- Python 3.10 oder neuer
- Git

```bash
# 1. Repository klonen
git clone https://github.com/mupplelabs/PartLens.git
cd PartLens

# 2. Virtuelle Umgebung erstellen und aktivieren
python3 -m venv .venv
source .venv/bin/activate  # Unter Windows: .venv\Scripts\activate

# 3. Abhängigkeiten installieren
pip install -r requirements.txt

# 4. Server starten
python server.py
```

Die Anwendung ist anschließend unter `http://localhost:8000` im Browser erreichbar.

#### Kommandozeilen-Optionen
```bash
python server.py --help
# Optionen:
#   --host HOST      Host-Adresse (Standard: 0.0.0.0)
#   --port PORT      Portnummer (Standard: 8000)
#   --debug, -d      Aktiviert detailliertes LLM-Debug-Logging im Terminal
```

---

### Variante B: Docker & Docker Compose

```bash
# Mit Docker Compose starten
docker compose up -d

# Logs ansehen
docker compose logs -f
```

Der Container bindet automatisch folgende Verzeichnisse ein:
- `./dataset` (Trainings- und Validierungsdaten)
- `./config` (LLM-Einstellungen und API-Schlüssel)
- `./cache` (Thumbnails und Part-DB-Footprint-Cache)
- Host-Netzwerk-Routing (`host.docker.internal`), um lokale Ollama-Instanzen auf dem Host-Rechner direkt ansprechen zu können.

---

## Multimodale LLM-Einbindung

PartLens unterstützt sowohl cloudbasierte als auch vollständig lokale Open-Source-Vision-Modelle:

1. **Google Gemini**:
   - Trage deinen API-Schlüssel im Einstellungsmenü (`Einstellungen` -> `LLM Engine`) ein oder hinterlege ihn in der `.env`-Datei:
     ```env
     GEMINI_API_KEY=dein_gemini_api_key
     ```
   - Unterstützt unter anderem `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-3.5-flash-lite` und `gemini-3.8-flash`.

2. **Lokale Vision-Modelle (Ollama)**:
   - Starte das gewünschte multimodale Modell:
     ```bash
     ollama run qwen2.5-vl
     ```
   - Wähle in den PartLens-Einstellungen **Ollama** aus:
     - Endpunkt: `http://localhost:11434` (bzw. `http://host.docker.internal:11434` bei Ausführung im Docker-Container)
     - Modell: `qwen2.5-vl` (oder ein anderes Bild-Sprachmodell)

---

## Datensatz-Import & Normalisierung

PartLens enthält ein integriertes Werkzeug, um externe Datensätze in das einheitliche 14-Klassen-Schema zu überführen:

```bash
# Testlauf ohne Schreiboperationen (Dry-Run)
python import_external_datasets.py --dry-run

# Vollständiger Import mit automatischem Train/Val-Split
python import_external_datasets.py --split-ratio 0.85
```

Unterstützt:
- **Mendeley Data** (`ElectroCom61`-Datensatz)
- **Roboflow** YOLOv8/YOLOv11-Exporte (mit automatischer Polygon-zu-Bounding-Box-Konvertierung)

---

## Tastaturkürzel im Studio

| Taste | Funktion |
|:-----:|:---------|
| `Leertaste` + Ziehen | Arbeitsbereich verschieben (Pan im Figma/CAD-Stil) |
| `Mausrad` | Stufenloser Zoom an Cursor-Position |
| `F` | **Fokus / Isolieren**: Nicht ausgewählte Boxen ausblenden |
| `O` | Box-Flächenfüllung transparent / sichtbar schalten |
| `H` | Floating Stage HUD ein- / ausklappen |
| `R` | Manuelle Bounding-Box zeichnen |
| `1` bis `9` | Klasse für ausgewähltes Bauteil schnell zuweisen |
| `Esc` | Popovers oder Modals schließen |

---

## Projektstruktur

```
PartLens/
├── app/
│   ├── config.py                 # Pfade, Klassendefinitionen und Konfiguration
│   ├── main.py                   # FastAPI Initialisierung & Middleware
│   ├── routes/
│   │   ├── dataset.py            # Datensatz CRUD, Statistiken, YOLO/COCO-Export
│   │   ├── footprints.py         # Footprint-Suche und Vektorzeichnungen
│   │   ├── import_data.py        # Import externer Datensätze
│   │   └── settings.py           # LLM-Zugangsdaten & Modellkonfiguration
│   └── services/
│       ├── coco.py               # COCO-Format Serialisierung
│       ├── dataset_service.py    # YOLO-Dateioperationen & Caching
│       ├── footprint_service.py  # Part-DB Footprint-Katalog
│       └── llm_service.py        # Gemini- & Ollama-Anbindung mit striktem JSON
├── frontend/
│   ├── index.html                # Studio- & Datensatz-Oberfläche
│   ├── css/                      # Stylesheets (Studio, Layout, Komponenten)
│   └── js/                       # Modulare Vanilla-JavaScript Controller
├── dataset/                      # YOLO-Bilder, Labeldateien und Metadaten
├── models/                       # Lokale Modellgewichte und ONNX-Dateien
├── studies/                      # Testbilder für Platinenanalysen
├── Dockerfile                    # Multi-Stage Produktions-Dockerfile
├── docker-compose.yml            # Docker-Compose Orchestrierung
├── import_external_datasets.py   # CLI-Tool zur Datensatznormalisierung
├── requirements.txt              # Python-Abhängigkeiten
└── server.py                     # Server-Startpunkt mit Argument-Parser
```

---

## Lizenz

Dieses Projekt ist unter der [MIT-Lizenz](LICENSE) lizenziert.
