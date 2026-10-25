print("Server script starting...", flush=True)
import os
# Verhindere Pydantic, OTEL & Telemetrie Deadlock/Overhead in Python 3.14
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["OTEL_PYTHON_DISABLED"] = "true"
os.environ["PYDANTIC_DISABLE_PLUGINS"] = "1"
os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
os.environ["LOGFIRE_IGNORE_NO_CONFIG"] = "1"
os.environ["FASTAPI_TELEMETRY_ENABLED"] = "0"
import sys
import io
import time
import uuid
import asyncio
import threading
import base64
import json
import re
import traceback
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
STUDIES_DIR = BASE_DIR / "studies"
PURE_HTML_DIR = STUDIES_DIR / "pureHtmlJs"
DATASET_DIR = BASE_DIR / "dataset"
EXT_DIR = BASE_DIR / "external_datasets"

from import_external_datasets import (
    ELECTROCOM61_MAPPING,
    ROBOFLOW_MAPPING,
    polygon_to_bbox,
    parse_yaml_names,
)

# Standard YOLO-Klassen für Elektronik-Komponenten (14 English classes aligned with Part-DB)
CLASS_NAMES = [
    "resistor",         # 0: THT & SMD Resistors (carbon, metal film)
    "capacitor",        # 1: Electrolytic, ceramic, film, tantalum
    "inductor",         # 2: Coils, chokes, ferrites
    "diode",            # 3: Standard, Schottky, Zener, Rectifiers
    "led",              # 4: THT LEDs, SMD LEDs
    "transistor",       # 5: BJT, MOSFET, IGBT (TO-92, TO-220, SOT-23)
    "ic",               # 6: Integrated Circuits (DIP, SOIC, QFP, QFN)
    "potentiometer",    # 7: Trimmer, rotary potentiometers
    "switch_button",    # 8: Tactile buttons, toggle switches, slide switches
    "relay",            # 9: Mechanical / Solid State relays
    "connector",        # 10: Pin headers, screw terminals, sockets
    "display",          # 11: 7-Segment, OLED, LCD displays
    "board",            # 12: Microcontroller boards (Arduino, ESP32), sensor modules
    "other"             # 13: Fuses, buzzers, heatsinks, unclassified
]
CLASS_TO_ID = {name: idx for idx, name in enumerate(CLASS_NAMES)}

def normalize_label_to_yolo(label: str) -> str:
    if not label:
        return "other"
    lbl = str(label).lower().strip().replace("-", "_").replace(" ", "_")
    if lbl in CLASS_TO_ID:
        return lbl
    # Substring checks for natural-language / heuristic / external labels
    if any(k in lbl for k in ["resistor", "widerstand"]):
        return "resistor"
    if any(k in lbl for k in ["capacitor", "kondensator", "elko", "cap_"]):
        return "capacitor"
    if any(k in lbl for k in ["inductor", "spule", "drossel", "ferrite"]):
        return "inductor"
    if "led" in lbl or "leuchtdiode" in lbl:
        return "led"
    if any(k in lbl for k in ["diode", "zener", "rectifier", "gleichrichter"]):
        return "diode"
    if any(k in lbl for k in ["transistor", "mosfet", "bjt", "igbt", "to_92", "to_220", "fet"]):
        return "transistor"
    if any(k in lbl for k in ["ic", "chip", "dip", "smd_ic", "processor", "microcontroller", "mcu", "soic", "qfp"]):
        return "ic"
    if any(k in lbl for k in ["potentiometer", "poti", "trimmer"]):
        return "potentiometer"
    if any(k in lbl for k in ["switch", "button", "taster", "schalter"]):
        return "switch_button"
    if any(k in lbl for k in ["relay", "relais"]):
        return "relay"
    if any(k in lbl for k in ["connector", "header", "steckverbinder", "pin_header", "terminal"]):
        return "connector"
    if any(k in lbl for k in ["display", "oled", "lcd", "7_segment", "screen"]):
        return "display"
    if any(k in lbl for k in ["board", "platine", "arduino", "esp32", "pcb", "module"]):
        return "board"
    return "other"

# Pydantic Schemas für Structured Output
LabelType = Literal[
    'resistor',
    'capacitor',
    'inductor',
    'diode',
    'led',
    'transistor',
    'ic',
    'potentiometer',
    'switch_button',
    'relay',
    'connector',
    'display',
    'board',
    'other'
]

class DetectedComponent(BaseModel):
    label: str = Field(default="other", description="Component category")
    ymin: float = Field(default=0.0, description="Normalized top edge [0.0 - 1.0]")
    xmin: float = Field(default=0.0, description="Normalized left edge [0.0 - 1.0]")
    ymax: float = Field(default=1.0, description="Normalized bottom edge [0.0 - 1.0]")
    xmax: float = Field(default=1.0, description="Normalized right edge [0.0 - 1.0]")
    confidence: Optional[float] = Field(default=0.95, description="Confidence score")
    part_marking: Optional[str] = Field(default=None, description="Component text marking if clearly legible, e.g. 'NE555P' or '2N2222'")
    ic_subgroup: Optional[str] = Field(default=None, description="Optional IC subtype: 'logic', 'analog', 'mcu', 'special'")
    footprint: Optional[str] = Field(default=None, description="Optional Part-DB package footprint, e.g. 'DIP-8', 'TO-92'")
    footprint_path: Optional[str] = Field(default=None, description="Optional exact relative path to footprint drawing in Part-DB cache")

class AutoLabelResult(BaseModel):
    components: list[DetectedComponent] = Field(description="List of detected electronic components")

def build_gemini_schema(detect_footprint: bool = True, detect_part_marking: bool = True, detect_ic_subgroup: bool = True) -> dict:
    item_props = {
        "label": {
            "type": "STRING",
            "enum": CLASS_NAMES,
            "description": "Component class category"
        },
        "ymin": {"type": "NUMBER", "description": "Normalized top coordinate [0.0 - 1.0]"},
        "xmin": {"type": "NUMBER", "description": "Normalized left coordinate [0.0 - 1.0]"},
        "ymax": {"type": "NUMBER", "description": "Normalized bottom coordinate [0.0 - 1.0]"},
        "xmax": {"type": "NUMBER", "description": "Normalized right coordinate [0.0 - 1.0]"},
        "confidence": {"type": "NUMBER", "description": "Confidence score [0.0 - 1.0]"}
    }
    required = ["label", "ymin", "xmin", "ymax", "xmax"]

    if detect_part_marking:
        item_props["part_marking"] = {
            "type": "STRING",
            "description": "Clearly legible printed text/marking on the component (e.g. 'LT1013CP', 'NE555P', '2N2222', '104')"
        }
    if detect_footprint:
        item_props["footprint"] = {
            "type": "STRING",
            "description": "Electronic package/footprint if identifiable by shape and pins, e.g. 'DIP-8', 'DIP-14', 'DIP-16', 'SOIC-8', 'TO-92', 'TO-220', 'SOT-23', '0805', 'DO-35', 'Radial-Elko'"
        }
    if detect_ic_subgroup:
        item_props["ic_subgroup"] = {
            "type": "STRING",
            "enum": ["analog", "logic", "mcu", "special"],
            "description": "If component is an IC, its functional subcategory: 'analog' (op-amp/linear), 'logic' (gates/shift registers), 'mcu' (microcontroller), or 'special'"
        }

    return {
        "type": "OBJECT",
        "properties": {
            "components": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": item_props,
                    "required": required
                }
            }
        },
        "required": ["components"]
    }

def build_autolabel_prompt(
    detect_footprint: bool = True,
    detect_part_marking: bool = True,
    detect_ic_subgroup: bool = True,
    custom_prompt: Optional[str] = None
) -> str:
    instructions = [
        "You are an expert electronics engineer and computer vision annotator.",
        "Locate every single electronic component (resistor, capacitor, inductor, diode, led, transistor, ic, potentiometer, switch_button, relay, connector, display, board) visible in this photo.",
        f"For each component, return its precise normalized bounding box [ymin, xmin, ymax, xmax] from 0.0 to 1.0, and its correct class label from the allowed list: {CLASS_NAMES}."
    ]

    if detect_part_marking:
        instructions.append("Carefully read and transcribe any printed text, laser engraving, or code on the component as 'part_marking' (e.g. 'LT1013CP', 'NE555P', '2N2222', '104'). Omit or leave empty if unreadable.")

    if detect_footprint:
        instructions.append("Identify the physical package/footprint ('footprint') by counting pins/leads and recognizing standard package shapes (e.g. 'DIP-8', 'DIP-14', 'DIP-16', 'SOIC-8', 'TO-92', 'TO-220', 'SOT-23', '0805', 'DO-35', 'DO-41', 'Radial-Elko').")

    if detect_ic_subgroup:
        instructions.append("If a component is an IC ('ic'), classify its functional subgroup ('ic_subgroup') into: 'analog' (Op-Amps, linear ICs, voltage regulators like LT1013, LM358, LM317), 'logic' (74xx, 40xx logic gates, shift registers), 'mcu' (microcontrollers like ATmega, PIC, ESP), or 'special' (drivers, RTC, interface chips).")

    instructions.append("Be thorough: find every component even if rotated, partially in shadow, or sitting on dark ESD foam.")

    if custom_prompt:
        instructions.append(f"Additional instruction: {custom_prompt}")

    return " ".join(instructions)

class AutoLabelRequest(BaseModel):
    image_base64: str
    provider: Literal['gemini', 'ollama', 'lmstudio'] = 'gemini'
    model_name: Optional[str] = None
    api_key: Optional[str] = None
    ollama_url: Optional[str] = 'http://localhost:11434/v1'
    lmstudio_url: Optional[str] = 'http://localhost:1234/v1'
    custom_prompt: Optional[str] = None
    detect_footprint: Optional[bool] = True
    detect_part_marking: Optional[bool] = True
    detect_ic_subgroup: Optional[bool] = True

class AutoLabelResponse(BaseModel):
    components: list[DetectedComponent]
    provider: str
    model: str
    latency_ms: int

class SaveSampleRequest(BaseModel):
    image_base64: str
    boxes: list[DetectedComponent]
    split: Literal['train', 'val'] = 'train'
    dataset_name: Optional[str] = 'workshop_dataset'

class DatasetStatsResponse(BaseModel):
    train_images: int
    val_images: int
    total_annotations: int
    class_counts: dict[str, int]
    classes: list[str]

# FastAPI App
app = FastAPI(title="ComponentTracker Auto-Labeling & Inventory Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def init_dataset_structure():
    """Erstellt die YOLO-Verzeichnisstruktur und data.yaml falls nicht vorhanden."""
    for split in ['train', 'val']:
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)
    
    yaml_path = DATASET_DIR / "data.yaml"
    if not yaml_path.exists():
        names_yaml = "\n".join([f"  {idx}: {name}" for idx, name in enumerate(CLASS_NAMES)])
        yaml_content = f"""path: {DATASET_DIR.resolve()}
train: images/train
val: images/val

names:
{names_yaml}
"""
        yaml_path.write_text(yaml_content, encoding="utf-8")

init_dataset_structure()

def parse_image_base64(data_url_or_b64: str) -> tuple[bytes, str, str]:
    """Extrahiert Rohdaten, Media-Type und bereinigten Base64-String."""
    if ',' in data_url_or_b64:
        header, b64_str = data_url_or_b64.split(',', 1)
        media_type = 'image/jpeg'
        if 'image/png' in header:
            media_type = 'image/png'
        elif 'image/webp' in header:
            media_type = 'image/webp'
    else:
        b64_str = data_url_or_b64
        media_type = 'image/jpeg'
    
    raw_bytes = base64.b64decode(b64_str)
    return raw_bytes, media_type, b64_str

_cached_stats: Optional[DatasetStatsResponse] = None
_cached_samples_data: Optional[list[dict]] = None

def invalidate_dataset_cache():
    global _cached_stats, _cached_samples_data
    _cached_stats = None
    _cached_samples_data = None

def get_stats(force_refresh: bool = False) -> DatasetStatsResponse:
    global _cached_stats
    if _cached_stats is not None and not force_refresh:
        return _cached_stats
    train_imgs = len(list((DATASET_DIR / "images" / "train").glob("*.jpg")))
    val_imgs = len(list((DATASET_DIR / "images" / "val").glob("*.jpg")))
    
    counts = {name: 0 for name in CLASS_NAMES}
    total_boxes = 0
    
    for lbl_file in (DATASET_DIR / "labels").rglob("*.txt"):
        try:
            lines = lbl_file.read_text(encoding="utf-8").strip().splitlines()
            for line in lines:
                parts = line.strip().split()
                if parts:
                    cid = int(parts[0])
                    if 0 <= cid < len(CLASS_NAMES):
                        counts[CLASS_NAMES[cid]] += 1
                        total_boxes += 1
        except Exception:
            pass
            
    _cached_stats = DatasetStatsResponse(
        train_images=train_imgs,
        val_images=val_imgs,
        total_annotations=total_boxes,
        class_counts=counts,
        classes=CLASS_NAMES
    )
    return _cached_stats

@app.get("/api/status")
async def status():
    has_gemini_env = bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    stats = get_stats()
    return {
        "status": "ok",
        "has_gemini_env": has_gemini_env,
        "classes": CLASS_NAMES,
        "stats": stats
    }

@app.get("/api/dataset/stats", response_model=DatasetStatsResponse)
async def dataset_stats():
    return get_stats()

@app.get("/api/local-models")
async def local_models(provider: Literal['lmstudio', 'ollama'] = 'lmstudio', url: Optional[str] = None):
    """Fragt installierte Modelle von LM Studio (Port 1234) oder Ollama (Port 11434) ab."""
    import httpx
    default_url = 'http://127.0.0.1:1234/v1' if provider == 'lmstudio' else 'http://127.0.0.1:11434/v1'
    target_url = url or default_url
    
    candidates = [target_url]
    if "127.0.0.1" in target_url:
        candidates.append(target_url.replace("127.0.0.1", "localhost"))
    elif "localhost" in target_url:
        candidates.append(target_url.replace("localhost", "127.0.0.1"))
        
    last_err = ""
    for u in candidates:
        endpoint = f"{u.rstrip('/')}/models"
        try:
            async with httpx.AsyncClient(timeout=3.0, verify=False) as client:
                resp = await client.get(endpoint)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                    return {"success": True, "provider": provider, "url": u, "models": models}
                last_err = f"HTTP {resp.status_code}"
        except Exception as e:
            last_err = str(e)
            
    return {"success": False, "provider": provider, "url": target_url, "error": last_err, "models": []}

@app.get("/api/gemini-models")
async def gemini_models(api_key: Optional[str] = None):
    """Fragt die aktuell verfügbaren Gemini-Modelle live über die Google Generative Language API ab."""
    import httpx
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key or not key.strip():
        return {"success": False, "error": "Kein API-Key angegeben.", "models": []}
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key.strip()}"
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                err_msg = resp.text
                try:
                    err_json = resp.json()
                    err_msg = err_json.get("error", {}).get("message", resp.text)
                except Exception:
                    pass
                return {"success": False, "error": f"Google API Fehler ({resp.status_code}): {err_msg}", "models": []}
            
            data = resp.json()
            models_list = data.get("models", [])
            valid_models = []
            for m in models_list:
                methods = m.get("supportedGenerationMethods", [])
                if "generateContent" in methods:
                    name = m.get("name", "")
                    clean_name = name.replace("models/", "").strip()
                    display_name = m.get("displayName", clean_name)
                    valid_models.append({
                        "id": clean_name,
                        "display_name": display_name,
                        "description": m.get("description", "")
                    })
            
            # Sortierung: Flash zuerst, dann Pro
            def sort_key(m):
                mid = m["id"].lower()
                cat = 0 if "flash" in mid else (1 if "pro" in mid else 2)
                return (cat, mid)
            
            valid_models.sort(key=sort_key)
            return {
                "success": True,
                "models": [m["id"] for m in valid_models],
                "details": valid_models
            }
    except Exception as e:
        return {"success": False, "error": str(e), "models": []}

@app.post("/api/auto-label", response_model=AutoLabelResponse)
async def auto_label(req: AutoLabelRequest):
    import httpx
    t0 = time.perf_counter()
    image_bytes, media_type, b64_clean = parse_image_base64(req.image_base64)

    prompt = build_autolabel_prompt(
        detect_footprint=bool(req.detect_footprint),
        detect_part_marking=bool(req.detect_part_marking),
        detect_ic_subgroup=bool(req.detect_ic_subgroup),
        custom_prompt=req.custom_prompt
    )

    model_used = ""
    result_data = None

    try:
        if req.provider == 'gemini':
            api_key = req.api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                raise HTTPException(status_code=400, detail="Gemini API Key fehlt. Bitte im Eingabefeld eintragen oder GEMINI_API_KEY als Umgebungsvariable setzen.")

            model_name = req.model_name or 'gemini-3.8-flash'
            model_used = f"google:{model_name}"

            gemini_schema = build_gemini_schema(
                detect_footprint=bool(req.detect_footprint),
                detect_part_marking=bool(req.detect_part_marking),
                detect_ic_subgroup=bool(req.detect_ic_subgroup)
            )

            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
            body = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": media_type,
                                    "data": b64_clean
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "response_schema": gemini_schema,
                    "temperature": 0.2
                }
            }

            async with httpx.AsyncClient(verify=False, timeout=60.0) as client:
                resp = await client.post(url, json=body)
                if resp.status_code != 200:
                    err_msg = resp.text
                    try:
                        err_json = resp.json()
                        err_msg = err_json.get("error", {}).get("message", resp.text)
                    except Exception:
                        pass
                    raise HTTPException(status_code=resp.status_code, detail=f"Gemini API Fehler ({resp.status_code}): {err_msg}")

                resp_data = resp.json()
                candidates = resp_data.get("candidates", [])
                if not candidates:
                    raise HTTPException(status_code=500, detail="Gemini hat keine Antwort zurückgegeben.")

                parts = candidates[0].get("content", {}).get("parts", [])
                raw_text = parts[0].get("text", "{}") if parts else "{}"
                result_data = AutoLabelResult.model_validate_json(raw_text)

        elif req.provider in ('lmstudio', 'ollama'):
            base_url = req.lmstudio_url if req.provider == 'lmstudio' else req.ollama_url
            model_name = req.model_name or ('qwen2-vl' if req.provider == 'ollama' else 'Qwen2.5-VL-7B-Instruct-4bit')
            model_used = f"{req.provider}:{model_name}"
            schema_dict = AutoLabelResult.model_json_schema()

            example_comp = {"label": "ic", "ymin": 0.12, "xmin": 0.34, "ymax": 0.28, "xmax": 0.52, "confidence": 0.98}
            if req.detect_part_marking:
                example_comp["part_marking"] = "LT1013CP"
            if req.detect_footprint:
                example_comp["footprint"] = "DIP-8"
            if req.detect_ic_subgroup:
                example_comp["ic_subgroup"] = "analog"
            example_str = json.dumps({"components": [example_comp]})

            messages = [
                {
                    "role": "system",
                    "content": "You are an expert electronics annotator. Always output pure valid JSON matching the requested schema."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt + f"\nOutput strictly JSON matching this format: {example_str}"},
                        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64_clean}"}}
                    ]
                }
            ]

            endpoint = f"{base_url.rstrip('/')}/chat/completions"
            raw_text = "{}"

            async with httpx.AsyncClient(verify=False, timeout=120.0) as client:
                body = {
                    "model": model_name,
                    "messages": messages,
                    "response_format": {"type": "json_schema", "json_schema": {"name": "AutoLabelResult", "schema": schema_dict}},
                    "temperature": 0.2
                }
                resp = await client.post(endpoint, json=body)

                if resp.status_code != 200:
                    resp_err = resp.text
                    if "does not support images" in resp_err.lower() or "vision" in resp_err.lower():
                        raise HTTPException(
                            status_code=400,
                            detail=f"Das gewählte Modell '{model_name}' unterstützt keine Bilder (Vision). Bitte wähle ein Vision-Modell (z.B. Qwen2.5-VL-7B-Instruct-4bit)."
                        )
                    # Fallback ohne json_schema für Server/Modelle die json_schema nicht unterstützen
                    body.pop("response_format", None)
                    resp = await client.post(endpoint, json=body)
                    if resp.status_code != 200:
                        raise HTTPException(
                            status_code=resp.status_code,
                            detail=f"Fehler von {req.provider.upper()} ({resp.status_code}): {resp.text[:300]}"
                        )

                res_json = resp.json()
                choices = res_json.get("choices", [])
                if choices:
                    raw_text = choices[0].get("message", {}).get("content", "") or "{}"

            # JSON Parsing
            try:
                # Suche nach JSON-Block falls Modell Markdown ```json nutzt
                json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
                clean_json = json_match.group(1) if json_match else raw_text.strip()
                result_data = AutoLabelResult.model_validate_json(clean_json)
            except Exception as parse_err:
                raise HTTPException(status_code=500, detail=f"Konnte JSON von {model_used} nicht parsen: {str(parse_err)}\nAntwort war: {raw_text[:200]}")

        else:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {req.provider}")

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        err_msg = str(e)
        if "does not support images" in err_msg.lower():
            err_msg = f"Das Modell '{req.model_name}' unterstützt keine Bildeingaben (Vision). Bitte lade in LM Studio ein Vision-fähiges Modell (z.B. Qwen2-VL)."
        raise HTTPException(status_code=500, detail=f"Auto-label error: {err_msg}")

    dt_ms = int((time.perf_counter() - t0) * 1000)
    
    # Sortierung der Boxen in natürlicher Leserichtung (oben nach unten, links nach rechts)
    sorted_components = sorted(
        result_data.components if result_data else [],
        key=lambda c: (round(c.ymin * 5), c.xmin)
    )

    # Footprint Auto-Resolution: Falls footprint erkannt wurde, matche gegen den Part-DB Katalog
    if req.detect_footprint:
        for c in sorted_components:
            if c.footprint and c.footprint.strip():
                try:
                    fp_match = await list_footprints(class_name=c.label, search=c.footprint.strip(), limit=1)
                    if fp_match.get("footprints"):
                        top_fp = fp_match["footprints"][0]
                        c.footprint = top_fp["name"]
                        c.footprint_path = top_fp["path"]
                except Exception as fe:
                    print(f"Footprint auto-match error for '{c.footprint}': {fe}", flush=True)

    return AutoLabelResponse(
        components=sorted_components,
        provider=req.provider,
        model=model_used,
        latency_ms=dt_ms
    )

@app.post("/api/save-sample")
async def save_sample(req: SaveSampleRequest):
    try:
        raw_bytes, _, _ = parse_image_base64(req.image_base64)
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
        w, h = img.size

        sample_id = f"comp_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        split = req.split

        img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
        lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"

        # Bild als JPEG speichern
        img.save(img_path, format="JPEG", quality=95)

        # Low-Res Proxy-Thumbnail (WebP, max 380px, ~30-40 KB) im gesonderten Ordner anlegen
        thumb_dir = THUMBNAILS_DIR / split
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumb_path = thumb_dir / f"{sample_id}.webp"
        try:
            thumb_img = img.copy()
            thumb_img.thumbnail((380, 380), Image.Resampling.BILINEAR)
            thumb_img.save(thumb_path, format="WEBP", quality=75)
        except Exception as te:
            print(f"Thumbnail generation warning: {te}", flush=True)

        # YOLO Text-Annotations schreiben: class_id x_center y_center width height
        yolo_lines = []
        for box in req.boxes:
            clean_label = normalize_label_to_yolo(box.label)
            cid = CLASS_TO_ID.get(clean_label, CLASS_TO_ID["other"])
            
            # Normalisierte BBox validieren & clampen
            ymin = max(0.0, min(1.0, float(box.ymin)))
            xmin = max(0.0, min(1.0, float(box.xmin)))
            ymax = max(0.0, min(1.0, float(box.ymax)))
            xmax = max(0.0, min(1.0, float(box.xmax)))

            if ymin > ymax:
                ymin, ymax = ymax, ymin
            if xmin > xmax:
                xmin, xmax = xmax, xmin

            # Mindestgröße sicherstellen
            if xmax - xmin < 0.001:
                xmax = min(1.0, xmin + 0.005)
                xmin = max(0.0, xmax - 0.005)
            if ymax - ymin < 0.001:
                ymax = min(1.0, ymin + 0.005)
                ymin = max(0.0, ymax - 0.005)

            xc = (xmin + xmax) / 2.0
            yc = (ymin + ymax) / 2.0
            bw = xmax - xmin
            bh = ymax - ymin

            yolo_lines.append(f"{cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")

        lbl_path.write_text("\n".join(yolo_lines) + "\n", encoding="utf-8")

        invalidate_dataset_cache()
        stats = get_stats(force_refresh=True)
        return {
            "success": True,
            "sample_id": sample_id,
            "image_file": str(img_path.relative_to(BASE_DIR)),
            "label_file": str(lbl_path.relative_to(BASE_DIR)),
            "annotations_saved": len(yolo_lines),
            "stats": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save training sample: {str(e)}")

THUMBNAILS_DIR = DATASET_DIR / "thumbnails"

@app.get("/api/dataset/thumbnails/{split}/{sample_id}")
async def get_dataset_thumbnail(split: Literal['train', 'val'], sample_id: str):
    """Gibt ein schnelles, kompaktes WebP-Thumbnail (~30-50 KB) zurück (mit Disk-Cache & Cache-Control)."""
    split_dir = THUMBNAILS_DIR / split
    split_dir.mkdir(parents=True, exist_ok=True)
    thumb_path = split_dir / f"{sample_id}.webp"
    
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    
    if thumb_path.exists():
        return FileResponse(str(thumb_path), media_type="image/webp", headers=headers)
        
    img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
        
    try:
        def _generate():
            with Image.open(img_path) as im:
                im.thumbnail((380, 380), Image.Resampling.BILINEAR)
                im.save(thumb_path, format="WEBP", quality=75)
        await asyncio.to_thread(_generate)
        return FileResponse(str(thumb_path), media_type="image/webp", headers=headers)
    except Exception:
        return FileResponse(str(img_path), media_type="image/jpeg", headers=headers)

@app.get("/api/dataset/samples")
async def list_dataset_samples(split: Optional[str] = None, force_refresh: bool = False):
    """Gibt alle vorhandenen Samples des Datasets mit Bounding-Box Metadaten zurück (mit Cache)."""
    global _cached_samples_data
    if _cached_samples_data is None or force_refresh:
        splits = ['train', 'val']
        samples = []
        
        for s in splits:
            img_dir = DATASET_DIR / "images" / s
            lbl_dir = DATASET_DIR / "labels" / s
            if not img_dir.exists():
                continue
                
            for img_file in sorted(img_dir.glob("*.jpg"), key=os.path.getmtime, reverse=True):
                sample_id = img_file.stem
                lbl_file = lbl_dir / f"{sample_id}.txt"
                boxes = []
                classes_in_sample = set()
                
                if lbl_file.exists():
                    try:
                        for line in lbl_file.read_text(encoding="utf-8").strip().splitlines():
                            parts = line.strip().split()
                            if len(parts) >= 5:
                                cid = int(parts[0])
                                xc, yc, bw, bh = map(float, parts[1:5])
                                xmin = max(0.0, xc - bw / 2.0)
                                ymin = max(0.0, yc - bh / 2.0)
                                xmax = min(1.0, xc + bw / 2.0)
                                ymax = min(1.0, yc + bh / 2.0)
                                
                                cname = CLASS_NAMES[cid] if 0 <= cid < len(CLASS_NAMES) else "other"
                                classes_in_sample.add(cname)
                                boxes.append({
                                    "class_id": cid,
                                    "label": cname,
                                    "xmin": round(xmin, 4),
                                    "ymin": round(ymin, 4),
                                    "xmax": round(xmax, 4),
                                    "ymax": round(ymax, 4)
                                })
                    except Exception:
                        pass
                        
                stat = img_file.stat()
                samples.append({
                    "id": sample_id,
                    "split": s,
                    "image_url": f"/dataset/images/{s}/{img_file.name}",
                    "thumb_url": f"/api/dataset/thumbnails/{s}/{sample_id}",
                    "boxes": boxes,
                    "box_count": len(boxes),
                    "classes": sorted(list(classes_in_sample)),
                    "created_at": int(stat.st_mtime),
                    "size_bytes": stat.st_size
                })
        _cached_samples_data = samples

    results = _cached_samples_data
    if split in ('train', 'val'):
        results = [s for s in _cached_samples_data if s["split"] == split]

    return {"samples": results, "total": len(results), "stats": get_stats(force_refresh=force_refresh)}

@app.get("/api/dataset/samples/{split}/{sample_id}")
async def get_dataset_sample(split: Literal['train', 'val'], sample_id: str):
    img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
    lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"
    if not img_path.exists():
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' in split '{split}' nicht gefunden.")
        
    boxes = []
    if lbl_path.exists():
        for line in lbl_path.read_text(encoding="utf-8").strip().splitlines():
            parts = line.strip().split()
            if len(parts) >= 5:
                cid = int(parts[0])
                xc, yc, bw, bh = map(float, parts[1:5])
                xmin = max(0.0, xc - bw / 2.0)
                ymin = max(0.0, yc - bh / 2.0)
                xmax = min(1.0, xc + bw / 2.0)
                ymax = min(1.0, yc + bh / 2.0)
                cname = CLASS_NAMES[cid] if 0 <= cid < len(CLASS_NAMES) else "other"
                boxes.append({
                    "label": cname,
                    "xmin": round(xmin, 4),
                    "ymin": round(ymin, 4),
                    "xmax": round(xmax, 4),
                    "ymax": round(ymax, 4)
                })
                
    return {
        "id": sample_id,
        "split": split,
        "image_url": f"/dataset/images/{split}/{sample_id}.jpg",
        "boxes": boxes
    }

@app.delete("/api/dataset/samples/{split}/{sample_id}")
async def delete_dataset_sample(split: Literal['train', 'val'], sample_id: str):
    img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
    lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"
    
    thumb_path = THUMBNAILS_DIR / split / f"{sample_id}.webp"
    if thumb_path.exists():
        thumb_path.unlink()
    deleted = False
    if img_path.exists():
        img_path.unlink()
        deleted = True
    if lbl_path.exists():
        lbl_path.unlink()
        deleted = True
        
    if not deleted:
        raise HTTPException(status_code=404, detail="Sample nicht gefunden.")
        
    invalidate_dataset_cache()
    return {"success": True, "deleted_id": sample_id, "stats": get_stats(force_refresh=True)}

@app.get("/api/dataset/export-zip")
async def export_dataset_zip():
    import zipfile
    from fastapi.responses import Response
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in DATASET_DIR.rglob("*"):
            if p.is_file():
                rel = p.relative_to(DATASET_DIR)
                zf.write(p, arcname=str(rel))
    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="component_dataset_yolo.zip"'}
    )

# =============================================================================
# PART-DB BUILTIN FOOTPRINTS PROXY & CATALOG
# =============================================================================
FOOTPRINTS_CACHE_DIR = BASE_DIR / "cache" / "footprints"
FOOTPRINTS_INDEX_FILE = BASE_DIR / "cache" / "footprints_index.json"
PARTDB_BASE_URL = os.environ.get("PARTDB_URL", "https://homenas2.fritz.box:9443")

_footprints_index = None

def get_footprints_index():
    global _footprints_index
    if _footprints_index is None:
        if FOOTPRINTS_INDEX_FILE.exists():
            try:
                _footprints_index = json.loads(FOOTPRINTS_INDEX_FILE.read_text(encoding="utf-8"))
            except Exception:
                _footprints_index = []
        else:
            _footprints_index = []
    return _footprints_index

def normalize_footprint_class(cls: Optional[str]) -> str:
    if not cls or cls.strip().lower() in ("all", "*"):
        return "all"
    c = cls.lower()
    if any(k in c for k in ["ic", "dip", "chip", "mcu", "processor", "soic", "qfp"]):
        return "ic"
    if "resistor" in c or "widerstand" in c:
        return "resistor"
    if "capacit" in c or "kondensator" in c or "elko" in c:
        return "capacitor"
    if "led" in c:
        return "led"
    if "diode" in c:
        return "diode"
    if any(k in c for k in ["transistor", "mosfet", "bjt", "igbt"]):
        return "transistor"
    if any(k in c for k in ["connector", "header", "pin", "stecker", "buchse", "pad"]):
        return "connector"
    if any(k in c for k in ["switch", "button", "taster"]):
        return "switch_button"
    if "relay" in c or "relais" in c:
        return "relay"
    if "potentiometer" in c or "poti" in c or "trimmer" in c:
        return "potentiometer"
    if "display" in c or "oled" in c or "lcd" in c:
        return "display"
    return c

def score_footprint(fp: dict, raw_s: str, s_clean: str, s_unzero: str, s_zero: str, norm_class: str) -> int:
    score = 0
    fp_name_lower = fp.get("name", "").lower()
    fp_full_lower = fp.get("full_name", "").lower()
    aliases = fp.get("aliases", [])
    matched_classes = fp.get("matched_classes", [])
    path = fp.get("path", "")
    cat = fp.get("category", "").lower()

    # 1. Class scoring
    if norm_class and norm_class != "all":
        if norm_class in matched_classes:
            score += 1000
        else:
            score -= 500

        # Special domain disambiguation
        if norm_class == "ic":
            if "active/ics/" in path.lower():
                score += 500
            if any(bad in path.lower() for bad in ["oscillator", "socket", "switch"]):
                score -= 2000
        elif norm_class == "resistor":
            if "resistor" in cat or "resistor" in path.lower():
                score += 500
        elif norm_class == "capacitor":
            if "capacit" in cat or "capacit" in path.lower():
                score += 500
        elif norm_class == "diode":
            if "diode" in cat or "diode" in path.lower():
                score += 500
        elif norm_class == "led":
            if "led" in cat or "led" in path.lower():
                score += 500
        elif norm_class == "transistor":
            if "transistor" in cat or "transistor" in path.lower() or any(p in path.lower() for p in ["to92", "to220", "sot23"]):
                score += 500
    else:
        # Default preference: IC packages over oscillators/sockets when ambiguous
        if "active/ics/" in path.lower():
            score += 100
        if any(bad in path.lower() for bad in ["oscillator", "socket"]):
            score -= 200

    # 2. Match exactness
    if fp_name_lower == raw_s:
        score += 500
    if s_clean in aliases or s_unzero in aliases or s_zero in aliases:
        score += 400
    if fp_full_lower == raw_s or fp_full_lower == s_clean:
        score += 300
    if fp_name_lower.startswith(raw_s):
        score += 150

    # 3. Shortest name preferred
    score += max(0, 50 - len(fp.get("name", "")))

    return score

@app.get("/api/footprints/list")
async def list_footprints(class_name: Optional[str] = None, search: Optional[str] = None, limit: int = 200):
    all_fps = get_footprints_index()
    norm_class = normalize_footprint_class(class_name)

    if not search or not search.strip():
        if norm_class != "all":
            results = [fp for fp in all_fps if norm_class in fp.get("matched_classes", [])]
        else:
            results = all_fps
        return {
            "total": len(results),
            "footprints": results[:limit]
        }

    raw_s = search.strip().lower()
    s_clean = re.sub(r'[^a-z0-9]', '', raw_s)
    s_unzero = re.sub(r'([a-z]+)0+(\d+)', r'\1\2', s_clean) if s_clean else ""
    s_zero = re.sub(r'([a-z]+)(\d)$', r'\g<1>0\2', s_clean) if s_clean else ""
    tokens = {t for t in [raw_s, s_clean, s_unzero, s_zero] if t}

    scored_matches = []
    for fp in all_fps:
        aliases = fp.get("aliases", [])
        fp_name_lower = fp.get("name", "").lower()
        fp_full_lower = fp.get("full_name", "").lower()
        name_clean = re.sub(r'[^a-z0-9]', '', fp_name_lower)
        full_clean = re.sub(r'[^a-z0-9]', '', fp_full_lower)

        hit = False
        if any(tok in aliases for tok in tokens):
            hit = True
        elif any(tok in fp_name_lower or tok in fp_full_lower for tok in [raw_s, s_clean] if tok):
            hit = True
        elif any(tok in name_clean or tok in full_clean for tok in [s_clean, s_unzero] if tok):
            hit = True
        elif raw_s in fp.get("category", "").lower() or raw_s in fp.get("subcategory", "").lower():
            hit = True
        elif raw_s in fp.get("path", "").lower():
            hit = True

        if hit:
            sc = score_footprint(fp, raw_s, s_clean, s_unzero, s_zero, norm_class)
            scored_matches.append((sc, fp))

    if not scored_matches:
        return {"total": 0, "footprints": []}

    scored_matches.sort(key=lambda x: x[0], reverse=True)

    if norm_class != "all":
        class_specific = [fp for sc, fp in scored_matches if norm_class in fp.get("matched_classes", []) and sc > 0]
        if class_specific:
            results = class_specific
        else:
            results = [fp for sc, fp in scored_matches]
    else:
        results = [fp for sc, fp in scored_matches]

    return {
        "total": len(results),
        "footprints": results[:limit]
    }


@app.get("/api/footprints/image")
async def get_footprint_image(path: str):
    clean_path = Path(path.strip("/\\")).as_posix()
    if ".." in clean_path:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    local_file = FOOTPRINTS_CACHE_DIR / clean_path
    if local_file.exists():
        return FileResponse(
            local_file,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )

    remote_url = f"{PARTDB_BASE_URL}/img/footprints/{clean_path}"
    import urllib.request
    import ssl
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        def fetch():
            req = urllib.request.Request(remote_url, headers={"User-Agent": "ComponentTracker/1.0"})
            with urllib.request.urlopen(req, context=ctx, timeout=6) as resp:
                return resp.read()

        data = await asyncio.to_thread(fetch)
        local_file.parent.mkdir(parents=True, exist_ok=True)
        local_file.write_bytes(data)

        from fastapi.responses import Response
        return Response(
            content=data,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Footprint image not found: {e}")

# =============================================================================
# EXTERNER DATENSATZ-IMPORT (Mendeley, Roboflow & Custom YOLO)
# =============================================================================

class StartImportRequest(BaseModel):
    source_ids: list[str] = ["mendeley", "roboflow"]
    custom_mapping: dict[str, str] = {}
    skip_other: bool = False
    max_samples: int = 0
    generate_thumbnails: bool = True

_import_state = {
    "status": "idle",       # "idle", "running", "completed", "failed", "aborted"
    "progress_pct": 0,
    "current": 0,
    "total": 0,
    "current_dataset": "",
    "current_file": "",
    "imported_images": 0,
    "imported_boxes": 0,
    "skipped_boxes": 0,
    "class_stats": {c: 0 for c in CLASS_NAMES},
    "error": None,
    "started_at": 0,
    "finished_at": 0
}
_import_abort_flag = False
_import_lock = threading.Lock()

def guess_default_mapping(classes: list[str]) -> dict[str, str]:
    """Erzeugt heuristische Vorschläge für Part-DB Klassen basierend auf Klassennamen."""
    mapping = {}
    for c in classes:
        cl = c.lower()
        if "resistor" in cl or "widerstand" in cl:
            mapping[c] = "resistor"
        elif "capacit" in cl or "kondensator" in cl:
            mapping[c] = "capacitor"
        elif "induct" in cl or "spule" in cl or "ferrite" in cl or "choke" in cl:
            mapping[c] = "inductor"
        elif "led" in cl:
            mapping[c] = "led"
        elif "diode" in cl:
            mapping[c] = "diode"
        elif any(k in cl for k in ["transistor", "mosfet", "bjt", "igbt"]):
            mapping[c] = "transistor"
        elif any(k in cl for k in ["ic", "dip", "soic", "qfp", "chip", "processor", "mcu", "optocoupler"]):
            mapping[c] = "ic"
        elif "potentiometer" in cl or "poti" in cl or "trimmer" in cl:
            mapping[c] = "potentiometer"
        elif "switch" in cl or "button" in cl or "taster" in cl:
            mapping[c] = "switch_button"
        elif "relay" in cl or "relais" in cl:
            mapping[c] = "relay"
        elif any(k in cl for k in ["connector", "header", "pin", "stecker", "buchse", "pad", "jumper"]):
            mapping[c] = "connector"
        elif any(k in cl for k in ["display", "screen", "oled", "lcd", "segment"]):
            mapping[c] = "display"
        elif any(k in cl for k in ["board", "arduino", "esp32", "module", "driver", "sensor"]):
            mapping[c] = "board"
        else:
            mapping[c] = "other"
    return mapping

def scan_external_datasets() -> list[dict]:
    """Scannt external_datasets/ rekursiv nach beliebigen YOLO-Datensätzen mit data.yaml."""
    if not EXT_DIR.exists():
        return []
    found_datasets = []
    seen_roots = set()

    for yaml_path in sorted(EXT_DIR.rglob("*.yaml")):
        if yaml_path.name.lower() in ("data.yaml", "dataset.yaml"):
            root = yaml_path.parent
            if root in seen_roots:
                continue
            seen_roots.add(root)

            raw_classes = parse_yaml_names(yaml_path)
            rel_path = root.relative_to(EXT_DIR)
            ds_id = re.sub(r"[^a-zA-Z0-9_-]", "_", str(rel_path)).strip("_").lower()
            
            # Schöne Namen & bekannte Mappings bevorzugen
            if "Electronic Components Detection" in str(root):
                name = "Electronic Components Detection (Roboflow)"
                ds_id = "roboflow"
                default_map = dict(ROBOFLOW_MAPPING)
            elif "ElectroCom61" in str(root):
                name = "ElectroCom61 (Mendeley Data)"
                ds_id = "mendeley"
                default_map = dict(ELECTROCOM61_MAPPING)
            else:
                name = root.name.replace("_", " ").strip()
                default_map = guess_default_mapping(raw_classes)

            # Splits zählen (train, valid, val, test oder flat images/)
            splits = {}
            total = 0
            for sp in ["train", "valid", "val", "test"]:
                p = root / sp / "images"
                if p.exists():
                    c = len(list(p.glob("*.*")))
                    if c > 0:
                        splits[sp] = c
                        total += c
            if total == 0:
                p = root / "images"
                if p.exists():
                    c = len(list(p.glob("*.*")))
                    if c > 0:
                        splits["all"] = c
                        total += c

            if total > 0:
                found_datasets.append({
                    "id": ds_id,
                    "name": name,
                    "root": root,
                    "folder": str(root.relative_to(BASE_DIR)),
                    "total_images": total,
                    "splits": splits,
                    "classes": raw_classes,
                    "default_mapping": default_map,
                    "prefix": f"{ds_id}_"
                })
    return found_datasets

def _run_import_thread(source_ids: list[str], custom_mapping: dict[str, str], skip_other: bool, max_samples: int, generate_thumbnails: bool):
    global _import_state, _import_abort_flag

    datasets_meta = scan_external_datasets()
    selected_datasets = [d for d in datasets_meta if d["id"] in source_ids and d["root"].exists()]
    
    total_imgs_to_process = 0
    for ds in selected_datasets:
        ds_imgs = ds.get("total_images", 0)
        if max_samples > 0:
            total_imgs_to_process += min(max_samples, ds_imgs)
        else:
            total_imgs_to_process += ds_imgs

    with _import_lock:
        _import_state["status"] = "running"
        _import_state["total"] = max(1, total_imgs_to_process)
        _import_state["current"] = 0
        _import_state["progress_pct"] = 0
        _import_state["imported_images"] = 0
        _import_state["imported_boxes"] = 0
        _import_state["skipped_boxes"] = 0
        _import_state["class_stats"] = {c: 0 for c in CLASS_NAMES}
        _import_state["error"] = None
        _import_state["started_at"] = int(time.time())
        _import_state["finished_at"] = 0
    _import_abort_flag = False

    try:
        current_count = 0
        for ds in selected_datasets:
            if _import_abort_flag:
                break

            ds_id = ds["id"]
            ds_name = ds["name"]
            root = ds["root"]
            prefix = ds["prefix"]
            mapping = dict(ds["default_mapping"])
            mapping.update(custom_mapping)

            raw_classes = parse_yaml_names(root / "data.yaml")
            ds_imported_count = 0

            for sp in ["train", "valid", "val", "test", "all"]:
                if _import_abort_flag:
                    break
                if max_samples > 0 and ds_imported_count >= max_samples:
                    break

                if sp == "all":
                    img_dir = root / "images"
                    lbl_dir = root / "labels"
                    target_split = "train"
                else:
                    img_dir = root / sp / "images"
                    lbl_dir = root / sp / "labels"
                    target_split = "train" if sp == "train" else "val"

                if not img_dir.exists():
                    continue
                img_files = sorted(list(img_dir.glob("*.*")))

                for img_path in img_files:
                    if _import_abort_flag:
                        break
                    if max_samples > 0 and ds_imported_count >= max_samples:
                        break

                    current_count += 1
                    ds_imported_count += 1

                    pct = min(100, int((current_count / max(1, total_imgs_to_process)) * 100))
                    with _import_lock:
                        _import_state["current"] = current_count
                        _import_state["progress_pct"] = pct
                        _import_state["current_dataset"] = ds_name
                        _import_state["current_file"] = img_path.name

                    lbl_path = lbl_dir / f"{img_path.stem}.txt"
                    if not lbl_path.exists():
                        continue

                    try:
                        lines = lbl_path.read_text(encoding="utf-8").splitlines()
                    except Exception:
                        continue

                    target_lines = []
                    for line in lines:
                        parts = line.strip().split()
                        if not parts:
                            continue
                        try:
                            raw_cid = int(parts[0])
                            floats = [float(v) for v in parts[1:]]
                        except ValueError:
                            continue

                        raw_name = raw_classes[raw_cid] if 0 <= raw_cid < len(raw_classes) else "other"
                        target_name = mapping.get(raw_name, "other")
                        if target_name in ("_ignore_", "ignore", "skip") or (skip_other and target_name == "other"):
                            with _import_lock:
                                _import_state["skipped_boxes"] += 1
                            continue

                        target_cid = CLASS_TO_ID.get(target_name, CLASS_TO_ID["other"])
                        if len(floats) == 4:
                            xc, yc, bw, bh = floats
                        elif len(floats) > 4:
                            xc, yc, bw, bh = polygon_to_bbox(floats)
                        else:
                            continue

                        target_lines.append(f"{target_cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")
                        with _import_lock:
                            _import_state["class_stats"][target_name] = _import_state["class_stats"].get(target_name, 0) + 1
                            _import_state["imported_boxes"] += 1

                    if not target_lines:
                        continue

                    new_stem = f"{prefix}{img_path.stem}"
                    dest_img = DATASET_DIR / "images" / target_split / f"{new_stem}.jpg"
                    dest_lbl = DATASET_DIR / "labels" / target_split / f"{new_stem}.txt"

                    dest_img.parent.mkdir(parents=True, exist_ok=True)
                    dest_lbl.parent.mkdir(parents=True, exist_ok=True)

                    try:
                        with Image.open(img_path) as im:
                            rgb_im = im.convert("RGB")
                            rgb_im.save(dest_img, format="JPEG", quality=92)
                            if generate_thumbnails:
                                thumb_dir = THUMBNAILS_DIR / target_split
                                thumb_dir.mkdir(parents=True, exist_ok=True)
                                thumb_path = thumb_dir / f"{new_stem}.webp"
                                thumb_im = rgb_im.copy()
                                thumb_im.thumbnail((380, 380), Image.Resampling.BILINEAR)
                                thumb_im.save(thumb_path, format="WEBP", quality=75)
                    except Exception as err:
                        print(f"Error copying image {img_path.name}: {err}", flush=True)
                        continue

                    dest_lbl.write_text("\n".join(target_lines) + "\n", encoding="utf-8")
                    with _import_lock:
                        _import_state["imported_images"] += 1

        invalidate_dataset_cache()
        get_stats(force_refresh=True)

        with _import_lock:
            _import_state["status"] = "aborted" if _import_abort_flag else "completed"
            _import_state["progress_pct"] = 100 if not _import_abort_flag else _import_state["progress_pct"]
            _import_state["finished_at"] = int(time.time())

    except Exception as e:
        traceback.print_exc()
        with _import_lock:
            _import_state["status"] = "failed"
            _import_state["error"] = str(e)
            _import_state["finished_at"] = int(time.time())

@app.get("/api/dataset/import/sources")
async def get_import_sources():
    datasets = scan_external_datasets()
    sources = []
    for d in datasets:
        sources.append({
            "id": d["id"],
            "name": d["name"],
            "folder": d["folder"],
            "total_images": d["total_images"],
            "splits": d["splits"],
            "classes": d["classes"],
            "default_mapping": d["default_mapping"]
        })

    with _import_lock:
        current_state = dict(_import_state)

    return {
        "sources": sources,
        "target_classes": CLASS_NAMES,
        "current_status": current_state
    }

@app.post("/api/dataset/import/start")
async def start_dataset_import(req: StartImportRequest):
    global _import_state
    with _import_lock:
        if _import_state["status"] == "running":
            raise HTTPException(status_code=409, detail="Ein Import läuft bereits.")

    thread = threading.Thread(
        target=_run_import_thread,
        args=(req.source_ids, req.custom_mapping, req.skip_other, req.max_samples, req.generate_thumbnails),
        daemon=True
    )
    thread.start()
    return {"success": True, "message": "Import gestartet."}

@app.get("/api/dataset/import/status")
async def get_dataset_import_status():
    with _import_lock:
        return dict(_import_state)

@app.post("/api/dataset/import/abort")
async def abort_dataset_import():
    global _import_abort_flag
    _import_abort_flag = True
    return {"success": True, "message": "Abbruch angefordert."}

# Statische Dateien mounten
app.mount("/studies", StaticFiles(directory=str(STUDIES_DIR)), name="studies")
app.mount("/dataset", StaticFiles(directory=str(DATASET_DIR)), name="dataset")
app.mount("/vendor", StaticFiles(directory=str(PURE_HTML_DIR / "vendor")), name="vendor")

@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return FileResponse(str(PURE_HTML_DIR / "index.html"))

@app.get("/pureHtmlJs/{path:path}")
async def pure_html(path: str):
    file_path = PURE_HTML_DIR / path
    if file_path.is_file():
        return FileResponse(str(file_path))
    return FileResponse(str(PURE_HTML_DIR / "index.html"))

@app.get("/{filename:path}")
async def file_fallback(filename: str):
    p1 = STUDIES_DIR / filename
    if p1.is_file():
        return FileResponse(str(p1))
    p2 = PURE_HTML_DIR / filename
    if p2.is_file():
        return FileResponse(str(p2))
    raise HTTPException(status_code=404, detail=f"File {filename} not found")

if __name__ == "__main__":
    import uvicorn
    print("Starting ComponentTracker Server on http://0.0.0.0:8000 ...", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info", ws="none", http="h11")
