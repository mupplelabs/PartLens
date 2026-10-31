import json
import httpx
from pathlib import Path
from typing import Optional
from app.config import (
    FOOTPRINTS_CACHE_DIR,
    FOOTPRINTS_INDEX_FILE,
    PARTDB_BASE_URL
)

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
    if any(k in c for k in ["ic", "dip", "chip", "mcu", "processor", "soic", "qfp", "qfn"]):
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
    cat = fp.get("category", "").lower()

    if norm_class and norm_class != "all":
        if norm_class in matched_classes:
            score += 1000
        elif norm_class in cat:
            score += 500

    if not raw_s:
        return score

    if raw_s == fp_name_lower or raw_s == fp_full_lower:
        score += 2000
    elif s_clean and (s_clean == fp_name_lower.replace("-", "").replace("_", "") or s_clean in fp_name_lower):
        score += 1500
    elif s_unzero and s_unzero in fp_name_lower:
        score += 1200
    elif s_zero and s_zero in fp_name_lower:
        score += 1200
    elif any(raw_s == a.lower() for a in aliases):
        score += 1400
    elif fp_name_lower.startswith(raw_s):
        score += 800
    elif raw_s in fp_name_lower or raw_s in fp_full_lower:
        score += 400
    elif any(raw_s in a.lower() for a in aliases):
        score += 300

    return score

def search_footprints(class_name: Optional[str] = None, search: Optional[str] = None, limit: int = 150) -> dict:
    idx = get_footprints_index()
    norm_class = normalize_footprint_class(class_name)

    filtered = []
    raw_s = search.strip().lower() if search else ""
    s_clean = raw_s.replace("-", "").replace("_", "") if raw_s else ""
    s_unzero = raw_s.lstrip("0") if raw_s else ""
    s_zero = ("0" + raw_s) if (raw_s and not raw_s.startswith("0") and raw_s.isdigit()) else ""

    for fp in idx:
        matched_classes = fp.get("matched_classes", [])
        if norm_class and norm_class != "all" and norm_class not in matched_classes:
            continue

        if raw_s:
            s_score = score_footprint(fp, raw_s, s_clean, s_unzero, s_zero, norm_class)
            if s_score <= (1000 if (norm_class and norm_class != 'all') else 0):
                continue
            fp_copy = dict(fp)
            fp_copy["_score"] = s_score
            filtered.append(fp_copy)
        else:
            filtered.append(fp)

    if raw_s:
        filtered.sort(key=lambda x: x.get("_score", 0), reverse=True)

    return {
        "total": len(filtered),
        "limit": limit,
        "class_filter": norm_class,
        "search": search,
        "footprints": filtered[:limit]
    }

async def get_footprint_image_bytes(path: str) -> Optional[bytes]:
    FOOTPRINTS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    clean_path = Path(path.strip("/\\")).as_posix()
    if ".." in clean_path:
        return None

    cached_file = FOOTPRINTS_CACHE_DIR / clean_path
    if cached_file.exists():
        return cached_file.read_bytes()

    target_urls = [
        f"{PARTDB_BASE_URL.rstrip('/')}/img/footprints/{clean_path}",
        f"{PARTDB_BASE_URL.rstrip('/')}/{clean_path}"
    ]
    try:
        async with httpx.AsyncClient(verify=False, timeout=8.0) as client:
            for url in target_urls:
                try:
                    resp = await client.get(url, headers={"User-Agent": "ComponentTracker/1.0"})
                    if resp.status_code == 200:
                        cached_file.parent.mkdir(parents=True, exist_ok=True)
                        cached_file.write_bytes(resp.content)
                        return resp.content
                except Exception:
                    continue
    except Exception as e:
        print(f"Error fetching footprint image for '{clean_path}': {e}", flush=True)

    return None

get_footprint_svg = get_footprint_image_bytes
