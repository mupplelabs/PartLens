# PartLens

[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg?style=flat-square)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?style=flat-square)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?style=flat-square)](https://www.docker.com/)
[![Dataset](https://img.shields.io/badge/Dataset-YOLO%20%7C%20COCO-orange.svg?style=flat-square)](https://docs.ultralytics.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

> **PartLens** is an intelligent PCB component inspection and annotation studio that combines computer vision, OCR, and multimodal LLMs to automatically detect, classify, decode, and catalog electronic components from photos and live video.

**Language:** [English](README.md) | [Deutsch](README.de.md)

---

## Highlights

- **Multi-Stage AI Pipeline**:
  - **Stage 0 (Localization)**: Automatic bounding box detection for circuit board components via edge heuristics, Florence-2, or YOLO.
  - **Stage 1 (Classification)**: Standardized into 14 electronic component classes.
  - **Stage 2 (OCR & Markings)**: Text extraction for integrated circuits (ICs), microcontrollers, and laser-etched markings.
  - **Stage 3 (Resistor Decoder)**: Automated color-band detection and resistance calculation (4- and 5-band with tolerance and standard E-series alignment).
  - **Stage 4 (Footprint Matching)**: Direct matching and vector preview of Part-DB package footprints (SOIC, QFP, TQFP, TSSOP, BGA, SOT, SMD, THT).
  - **Stage 5 (Multimodal LLM)**: Zero-shot component analysis, reasoning, and automated labeling using Google Gemini (1.5 / 2.0 / 3.x) or local vision models (Qwen2.5-VL via Ollama).
- **Interactive Annotation Studio**:
  - Figma- / CAD-style canvas with smooth pan, zoom, touch pinch-to-zoom, and touch loupe for mobile devices.
  - **Focus & Isolate Mode (`F`)**: Instantly hide unselected components or clear canvas overlays to inspect raw traces.
  - **Opacity Control (`O`)**: Adjust fill transparency for clear visibility of tracks and solder joints.
  - **Shortcuts & Speed**: `1-9` keys for 1-click class assignment, `R` to draw bounding boxes, and Roboflow-style floating quick-tag popovers.
- **Dataset Operations**:
  - Direct import and export for **YOLO** (`.txt` + `data.yaml`) and **COCO** (`instances.json`).
  - Integrated gallery with filtering, class statistics, and train/validation splitting.
  - External dataset ingestion script for Mendeley Data (ElectroCom61) and Roboflow exports.

---

## 14 Standardized Component Classes

| ID | Class Name | Description |
|:--:|:-----------|:------------|
| 0 | `resistor` | Resistors (SMD & axial through-hole) |
| 1 | `capacitor` | Capacitors (ceramic, electrolytic, tantalum) |
| 2 | `inductor` | Inductors, coils, chokes |
| 3 | `diode` | Diodes, Zener diodes, Schottkys |
| 4 | `led` | Light emitting diodes |
| 5 | `transistor` | Bipolar and field-effect transistors |
| 6 | `ic` | Integrated circuits, MCUs, flash chips |
| 7 | `potentiometer` | Trimmers, potentiometers |
| 8 | `switch_button` | Tactile switches, pushbuttons |
| 9 | `relay` | Electromechanical and solid-state relays |
| 10 | `connector` | USB, pin headers, terminal blocks |
| 11 | `display` | Seven-segment, OLED, LCD displays |
| 12 | `board` | Sub-modules, sensor boards, daughterboards |
| 13 | `other` | Crystals, test points, passive unassigned parts |

---

## Quick Start

### Option A: Local Python Installation

#### Prerequisites
- Python 3.10 or higher
- Git

```bash
# 1. Clone repository
git clone https://github.com/<your-username>/PartLens.git
cd PartLens

# 2. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start server
python server.py
```

The application is now accessible at `http://localhost:8000`.

#### Command-Line Options
```bash
python server.py --help
# Options:
#   --host HOST      Host address (default: 0.0.0.0)
#   --port PORT      Port number (default: 8000)
#   --debug, -d      Enable verbose LLM payload & response debugging in terminal
```

---

### Option B: Docker & Docker Compose

```bash
# Start with Docker Compose
docker compose up -d

# Check logs
docker compose logs -f
```

The Docker container automatically mounts:
- `./dataset` (for training and validation data)
- `./config` (for server-side LLM settings and API keys)
- `./cache` (for thumbnails and Part-DB footprint data)
- Host network mapping (`host.docker.internal`) to connect with local Ollama instances.

---

## Multimodal LLM Setup

PartLens can operate with both cloud-hosted and completely local open-weight vision models:

1. **Google Gemini**:
   - Provide your API key in the Studio settings modal (`Settings` -> `LLM Engine`) or via `.env`:
     ```env
     GEMINI_API_KEY=your_gemini_api_key
     ```
   - Supports `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash`, `gemini-3.5-flash-lite`, and `gemini-3.8-flash`.

2. **Local Vision Models (Ollama)**:
   - Run a vision model locally:
     ```bash
     ollama run qwen2.5-vl
     ```
   - In PartLens Studio settings, select **Ollama** and specify:
     - Endpoint: `http://localhost:11434` (or `http://host.docker.internal:11434` when using Docker)
     - Model: `qwen2.5-vl` (or any multimodal vision model)

---

## Dataset Ingestion & Conversion

PartLens includes a built-in import utility to normalize external datasets into the standard 14-class schema:

```bash
# Ingest external datasets (dry-run first)
python import_external_datasets.py --dry-run

# Run full ingestion
python import_external_datasets.py --split-ratio 0.85
```

Supports:
- **Mendeley Data** (`ElectroCom61` dataset)
- **Roboflow** YOLOv8/YOLOv11 exports (with automatic polygon-to-bounding-box conversion)

---

## Keyboard Shortcuts

| Key | Action |
|:---:|:-------|
| `Space` + Drag | Pan across canvas (CAD / Figma style) |
| `Mouse Wheel` | Smooth zoom at cursor position |
| `F` | **Focus / Isolate**: Toggle visibility of unselected boxes |
| `O` | Toggle bounding box fill transparency |
| `H` | Collapse / expand floating stage controls HUD |
| `R` | Activate manual bounding box drawing mode |
| `1` - `9` | Quick assign class to selected box |
| `Esc` | Close popovers, modals, or cancel current operation |

---

## Project Architecture

```
PartLens/
├── app/
│   ├── config.py                 # Paths, class definitions, and settings
│   ├── main.py                   # FastAPI initialization and middleware
│   ├── routes/
│   │   ├── dataset.py            # Dataset CRUD, stats, YOLO/COCO export
│   │   ├── footprints.py         # Footprint search and vector drawings
│   │   ├── import_data.py        # External dataset scanning and import
│   │   └── settings.py           # LLM credentials and active model configuration
│   └── services/
│       ├── coco.py               # COCO format serialization
│       ├── dataset_service.py    # YOLO file operations and caching
│       ├── footprint_service.py  # Part-DB footprint catalog
│       └── llm_service.py        # Gemini & Ollama integration with structured output
├── frontend/
│   ├── index.html                # Main Studio & Dataset UI
│   ├── css/                      # Responsive stylesheets (studio, layout, components)
│   └── js/                       # Modular vanilla JavaScript controllers
├── dataset/                      # YOLO images, labels, and metadata sidecars
├── models/                       # Optional local model weights and ONNX files
├── studies/                      # Sample PCB test images
├── Dockerfile                    # Multi-stage production container
├── docker-compose.yml            # Container orchestration
├── import_external_datasets.py   # Dataset normalization CLI
├── requirements.txt              # Python dependencies
└── server.py                     # Entry point with CLI arguments
```

---

## License

This project is licensed under the [MIT License](LICENSE).
