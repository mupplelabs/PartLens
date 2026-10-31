import os
import json
from pathlib import Path
from typing import Literal, Optional
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
STUDIES_DIR = BASE_DIR / "studies"
DATASET_DIR = BASE_DIR / "dataset"
THUMBNAILS_DIR = DATASET_DIR / "thumbnails"
EXT_DIR = BASE_DIR / "external_datasets"
CACHE_DIR = BASE_DIR / "cache"
CONFIG_DIR = BASE_DIR / "config"
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

DATASET_INDEX_FILE = DATASET_DIR / "dataset_index.json"
LLM_CONFIG_FILE = CONFIG_DIR / "llm_config.json"
FOOTPRINTS_CACHE_DIR = CACHE_DIR / "footprints"
FOOTPRINTS_INDEX_FILE = CACHE_DIR / "footprints_index.json"

# KiCad 3D Footprint upstream CDN (Part-DB / KiCad official previews)
FOOTPRINTS_CDN_URL = os.environ.get(
    "FOOTPRINTS_CDN_URL",
    "https://raw.githubusercontent.com/Part-DB/kicad-footprint-images/master/previews_optimized"
)
FOOTPRINTS_CDN_FALLBACK = "https://cdn.jsdelivr.net/gh/Part-DB/kicad-footprint-images@master/previews_optimized"

# Optional legacy Part-DB URL from environment (fallback if set)
PARTDB_BASE_URL = os.environ.get("PARTDB_URL", "")

# Standard 14 YOLO classes aligned with Part-DB
CLASS_NAMES = [
    "resistor",         # 0
    "capacitor",        # 1
    "inductor",         # 2
    "diode",            # 3
    "led",              # 4
    "transistor",       # 5
    "ic",               # 6
    "potentiometer",    # 7
    "switch_button",    # 8
    "relay",            # 9
    "connector",        # 10
    "display",          # 11
    "board",            # 12
    "other"             # 13
]
CLASS_TO_ID = {name: idx for idx, name in enumerate(CLASS_NAMES)}

# Pydantic Schemas
class DetectedComponent(BaseModel):
    label: str = Field(default="other", description="Component category")
    ymin: float = Field(default=0.0, description="Normalized top edge [0.0 - 1.0]")
    xmin: float = Field(default=0.0, description="Normalized left edge [0.0 - 1.0]")
    ymax: float = Field(default=1.0, description="Normalized bottom edge [0.0 - 1.0]")
    xmax: float = Field(default=1.0, description="Normalized right edge [0.0 - 1.0]")
    confidence: Optional[float] = Field(default=0.95, description="Confidence score")
    part_marking: Optional[str] = Field(default=None, description="Component marking (OCR)")
    ic_subgroup: Optional[str] = Field(default=None, description="IC subtype: 'logic', 'analog', 'mcu', 'special'")
    footprint: Optional[str] = Field(default=None, description="Part-DB footprint")
    footprint_path: Optional[str] = Field(default=None, description="Footprint SVG path")

class AutoLabelRequest(BaseModel):
    image_base64: str
    provider: Optional[Literal['gemini', 'openai', 'lmstudio', 'ollama']] = None
    model_name: Optional[str] = None
    # api_key is optional for backward compatibility, but server keys take precedence
    api_key: Optional[str] = None
    openai_url: Optional[str] = None
    ollama_url: Optional[str] = None
    lmstudio_url: Optional[str] = None
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
    tags: Optional[list[str]] = None

class DatasetStatsResponse(BaseModel):
    train_images: int
    val_images: int
    total_annotations: int
    class_counts: dict[str, int]
    classes: list[str]

class LLMSettingsUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    provider: Optional[str] = None
    default_provider: Optional[str] = None
    model: Optional[str] = None
    default_model: Optional[str] = None
    custom_url: Optional[str] = None
    openai_url: Optional[str] = None
    ollama_url: Optional[str] = None
    lmstudio_url: Optional[str] = None
    options: Optional[dict] = None

# Server-side LLM Configuration Storage
def load_llm_config() -> dict:
    config = {
        "gemini_api_key": os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "",
        "openai_api_key": os.environ.get("OPENAI_API_KEY") or "",
        "default_provider": os.environ.get("DEFAULT_LLM_PROVIDER") or "gemini",
        "default_model": os.environ.get("DEFAULT_LLM_MODEL") or "gemini-2.5-flash",
        "openai_url": os.environ.get("OPENAI_URL") or "http://host.docker.internal:1234/v1",
        "ollama_url": os.environ.get("OLLAMA_URL") or "http://host.docker.internal:11434/v1",
        "lmstudio_url": os.environ.get("LMSTUDIO_URL") or "http://host.docker.internal:1234/v1"
    }
    if LLM_CONFIG_FILE.exists():
        try:
            saved = json.loads(LLM_CONFIG_FILE.read_text(encoding="utf-8"))
            for k, v in saved.items():
                if v is not None and str(v).strip():
                    config[k] = v
        except Exception as e:
            print(f"Warning: could not read llm_config.json: {e}", flush=True)
    return config

def save_llm_config(updates: dict) -> dict:
    current = load_llm_config()
    for k, v in updates.items():
        if v is not None:
            current[k] = v
    try:
        LLM_CONFIG_FILE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"Error saving llm_config.json: {e}", flush=True)
    return current

def get_llm_public_settings() -> dict:
    cfg = load_llm_config()
    return {
        "has_gemini_key": bool(cfg.get("gemini_api_key", "").strip()),
        "has_openai_key": bool(cfg.get("openai_api_key", "").strip()),
        "default_provider": cfg.get("default_provider", "gemini"),
        "default_model": cfg.get("default_model", "gemini-2.5-flash"),
        "openai_url": cfg.get("openai_url", "http://host.docker.internal:1234/v1"),
        "ollama_url": cfg.get("ollama_url", "http://host.docker.internal:11434/v1"),
        "lmstudio_url": cfg.get("lmstudio_url", "http://host.docker.internal:1234/v1")
    }

def get_api_key_for_provider(provider: str) -> Optional[str]:
    cfg = load_llm_config()
    if provider == "gemini":
        key = cfg.get("gemini_api_key", "").strip()
        return key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    elif provider in ("openai", "lmstudio"):
        key = cfg.get("openai_api_key", "").strip()
        return key or os.environ.get("OPENAI_API_KEY")
    return None
