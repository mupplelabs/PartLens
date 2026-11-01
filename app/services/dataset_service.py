import os
import io
import time
import json
import base64
import threading
from pathlib import Path
from typing import Optional
from PIL import Image

from app.config import (
    DATASET_DIR,
    THUMBNAILS_DIR,
    DATASET_INDEX_FILE,
    CLASS_NAMES,
    CLASS_TO_ID,
    DatasetStatsResponse,
    DetectedComponent,
    SaveSampleRequest
)

_cached_stats: Optional[DatasetStatsResponse] = None
_cached_samples_data: Optional[list[dict]] = None
_index_lock = threading.Lock()

def init_dataset_structure():
    """Erstellt die YOLO-Verzeichnisstruktur, Metadaten-Ordner und data.yaml falls nicht vorhanden."""
    for split in ['train', 'val']:
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "metadata" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "thumbnails" / split).mkdir(parents=True, exist_ok=True)
    
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

def normalize_label_to_yolo(label: str) -> str:
    if not label:
        return "other"
    lbl = str(label).lower().strip().replace("-", "_").replace(" ", "_")
    if lbl in CLASS_TO_ID:
        return lbl
    if any(k in lbl for k in ["resistor", "widerstand"]):
        return "resistor"
    if any(k in lbl for k in ["capacitor", "kondensator", "elko", "cap_"]):
        return "capacitor"
    if any(k in lbl for k in ["inductor", "spule", "drossel", "ferrite"]):
        return "inductor"
    if "led" in lbl or "leuchtdiode" in lbl:
        return "led"
    if "diode" in lbl:
        return "diode"
    if any(k in lbl for k in ["transistor", "mosfet", "bjt", "igbt", "to_92", "to_220"]):
        return "transistor"
    if any(k in lbl for k in ["ic", "dip", "chip", "mcu", "processor", "soic", "qfp", "qfn"]):
        return "ic"
    if "potentiometer" in lbl or "poti" in lbl or "trimmer" in lbl:
        return "potentiometer"
    if any(k in lbl for k in ["switch", "button", "taster", "schalter"]):
        return "switch_button"
    if "relay" in lbl or "relais" in lbl:
        return "relay"
    if any(k in lbl for k in ["connector", "header", "stecker", "buchse", "pin", "terminal"]):
        return "connector"
    if any(k in lbl for k in ["display", "oled", "lcd", "screen", "segment"]):
        return "display"
    if any(k in lbl for k in ["board_mcu", "mcu_stick", "nano", "nodemcu", "pico", "teensy", "pro_micro"]):
        return "board_mcu_stick"
    if any(k in lbl for k in ["board_mini", "mini_stamp", "stamp", "supermini", "d1_mini", "wemos"]):
        return "board_mini_stamp"
    if any(k in lbl for k in ["board_std", "board_standard", "uno", "mega", "due", "leonardo"]):
        return "board_standard"
    if any(k in lbl for k in ["board_mod", "board_module", "sensor_mod", "driver_mod", "breakout"]):
        return "board_module"
    if any(k in lbl for k in ["oscillator", "crystal", "quarz", "resonator"]):
        return "oscillator"
    if any(k in lbl for k in ["motor", "servo", "stepper", "actuator"]):
        return "motor_actuator"
    if any(k in lbl for k in ["buzzer", "speaker", "piezo", "beeper"]):
        return "speaker_buzzer"
    if any(k in lbl for k in ["board", "arduino", "esp32", "module", "shield", "pcb"]):
        return "board_standard"
    return "other"

def scan_full_dataset() -> tuple[list[dict], DatasetStatsResponse]:
    """Scannt alle Datensatzordner neu und baut Index und Statistiken auf."""
    samples = []
    counts = {name: 0 for name in CLASS_NAMES}
    train_count = 0
    val_count = 0
    total_boxes = 0

    for s in ["train", "val"]:
        img_dir = DATASET_DIR / "images" / s
        lbl_dir = DATASET_DIR / "labels" / s
        meta_dir = DATASET_DIR / "metadata" / s
        if not img_dir.exists():
            continue

        for img_file in sorted(img_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not img_file.is_file() or img_file.suffix.lower() not in [".jpg", ".jpeg", ".png", ".webp"]:
                continue

            if s == "train":
                train_count += 1
            else:
                val_count += 1
            sample_id = img_file.stem
            lbl_file = lbl_dir / f"{sample_id}.txt"
            meta_file = meta_dir / f"{sample_id}.json"
            boxes = []
            classes_in_sample = set()
            tags_in_sample = set()

            if meta_file.exists():
                try:
                    meta_raw = json.loads(meta_file.read_text(encoding="utf-8"))
                    boxes = meta_raw.get("boxes", [])
                    classes_in_sample = set(meta_raw.get("classes", []))
                    tags_in_sample = set(meta_raw.get("tags", []))
                    for b in boxes:
                        cname = b.get("label", "other")
                        classes_in_sample.add(cname)
                        counts[cname] = counts.get(cname, 0) + 1
                        total_boxes += 1
                        if b.get("footprint"):
                            tags_in_sample.add(b["footprint"])
                        if b.get("part_marking"):
                            tags_in_sample.add(b["part_marking"])
                        if b.get("ic_subgroup"):
                            tags_in_sample.add(b["ic_subgroup"])
                except Exception as me:
                    print(f"Warning: error reading metadata for {sample_id}: {me}", flush=True)

            if not boxes and lbl_file.exists():
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
                            counts[cname] = counts.get(cname, 0) + 1
                            total_boxes += 1
                            boxes.append({
                                "class_id": cid,
                                "label": cname,
                                "xmin": round(xmin, 4),
                                "ymin": round(ymin, 4),
                                "xmax": round(xmax, 4),
                                "ymax": round(ymax, 4),
                                "confidence": 1.0,
                                "part_marking": None,
                                "footprint": None,
                                "ic_subgroup": None
                            })
                except Exception:
                    pass

            try:
                stat = img_file.stat()
                mtime = int(stat.st_mtime)
                size_bytes = stat.st_size
            except Exception:
                mtime = int(time.time())
                size_bytes = 0

            samples.append({
                "id": sample_id,
                "split": s,
                "image_url": f"/dataset/images/{s}/{img_file.name}",
                "thumb_url": f"/api/dataset/thumbnails/{s}/{sample_id}",
                "boxes": boxes,
                "box_count": len(boxes),
                "classes": sorted(list(classes_in_sample)),
                "tags": sorted(list(tags_in_sample)),
                "created_at": mtime,
                "size_bytes": size_bytes
            })

    stats = DatasetStatsResponse(
        train_images=train_count,
        val_images=val_count,
        total_annotations=total_boxes,
        class_counts=counts,
        classes=CLASS_NAMES
    )
    return samples, stats

def save_dataset_index(samples: list[dict], stats: DatasetStatsResponse):
    with _index_lock:
        try:
            data = {
                "version": 1,
                "saved_at": int(time.time()),
                "stats": stats.model_dump(),
                "samples": samples
            }
            tmp_file = DATASET_INDEX_FILE.with_suffix(".tmp")
            tmp_file.write_text(json.dumps(data), encoding="utf-8")
            tmp_file.replace(DATASET_INDEX_FILE)
        except Exception as e:
            print(f"Warning: could not write dataset_index.json: {e}", flush=True)

def save_dataset_index_async():
    global _cached_samples_data, _cached_stats
    if _cached_samples_data is not None and _cached_stats is not None:
        samples_snap = list(_cached_samples_data)
        stats_snap = _cached_stats
        t = threading.Thread(target=save_dataset_index, args=(samples_snap, stats_snap), daemon=True)
        t.start()

def load_dataset_index() -> bool:
    global _cached_samples_data, _cached_stats
    if not DATASET_INDEX_FILE.exists():
        return False
    try:
        with _index_lock:
            raw = json.loads(DATASET_INDEX_FILE.read_text(encoding="utf-8"))
            if raw.get("version") == 1 and "samples" in raw and "stats" in raw:
                _cached_samples_data = raw["samples"]
                _cached_stats = DatasetStatsResponse(**raw["stats"])
                return True
    except Exception as e:
        print(f"Dataset index corrupted, rebuilding: {e}", flush=True)
    return False

def invalidate_dataset_cache():
    global _cached_stats, _cached_samples_data
    _cached_stats = None
    _cached_samples_data = None

def get_stats(force_refresh: bool = False) -> DatasetStatsResponse:
    global _cached_stats, _cached_samples_data
    if _cached_stats is not None and not force_refresh:
        return _cached_stats
    if not force_refresh and load_dataset_index():
        return _cached_stats

    samples, stats = scan_full_dataset()
    _cached_samples_data = samples
    _cached_stats = stats
    save_dataset_index_async()
    return _cached_stats

# Cache-Start initialisieren
try:
    if not load_dataset_index():
        _init_samples, _init_stats = scan_full_dataset()
        _cached_samples_data = _init_samples
        _cached_stats = _init_stats
        save_dataset_index_async()
except Exception as _ie:
    print(f"Dataset initial index warning: {_ie}", flush=True)

def get_samples(
    split: Optional[str] = None,
    class_name: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = 60,
    offset: int = 0,
    force_refresh: bool = False
) -> dict:
    global _cached_samples_data, _cached_stats
    if _cached_samples_data is None or force_refresh:
        get_stats(force_refresh=True)

    results = _cached_samples_data or []
    if split and split != "all":
        results = [s for s in results if s.get("split") == split]
    if class_name and class_name != "all":
        results = [s for s in results if class_name in s.get("classes", [])]
    if tag:
        tag_lower = tag.strip().lower()
        results = [s for s in results if any(tag_lower in t.lower() for t in s.get("tags", []))]

    total = len(results)
    paginated = results[offset : offset + limit]
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "samples": paginated
    }

def get_sample_meta(split: str, sample_id: str) -> Optional[dict]:
    meta_path = DATASET_DIR / "metadata" / split / f"{sample_id}.json"
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None

def save_sample(req: SaveSampleRequest) -> dict:
    global _cached_samples_data, _cached_stats
    raw_bytes, media_type, _ = parse_image_base64(req.image_base64)
    sample_id = f"comp_{int(time.time())}_{os.urandom(3).hex()}"
    img_filename = f"{sample_id}.jpg"

    img_path = DATASET_DIR / "images" / req.split / img_filename
    lbl_path = DATASET_DIR / "labels" / req.split / f"{sample_id}.txt"
    thumb_path = THUMBNAILS_DIR / req.split / f"{sample_id}.webp"

    img_path.parent.mkdir(parents=True, exist_ok=True)
    lbl_path.parent.mkdir(parents=True, exist_ok=True)
    thumb_path.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(io.BytesIO(raw_bytes)) as pil_img:
        rgb_img = pil_img.convert("RGB")
        rgb_img.save(img_path, "JPEG", quality=92)
        thumb_img = rgb_img.copy()
        thumb_img.thumbnail((380, 380), Image.Resampling.BILINEAR)
        thumb_img.save(thumb_path, "WEBP", quality=75)

    yolo_lines = []
    sample_boxes = []
    classes_in_sample = set()
    tags_in_sample = set(req.tags or [])

    for b in req.boxes:
        norm_label = normalize_label_to_yolo(b.label)
        cid = CLASS_TO_ID.get(norm_label, CLASS_TO_ID["other"])
        classes_in_sample.add(norm_label)

        xmin = max(0.0, min(1.0, b.xmin))
        ymin = max(0.0, min(1.0, b.ymin))
        xmax = max(0.0, min(1.0, b.xmax))
        ymax = max(0.0, min(1.0, b.ymax))
        if xmax < xmin:
            xmin, xmax = xmax, xmin
        if ymax < ymin:
            ymin, ymax = ymax, ymin

        bw = xmax - xmin
        bh = ymax - ymin
        xc = xmin + bw / 2.0
        yc = ymin + bh / 2.0

        yolo_lines.append(f"{cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")

        clean_footprint = b.footprint.strip() if b.footprint else None
        clean_part_marking = b.part_marking.strip() if b.part_marking else None
        clean_ic_subgroup = b.ic_subgroup.strip() if b.ic_subgroup else None
        if clean_footprint:
            tags_in_sample.add(clean_footprint)
        if clean_part_marking:
            tags_in_sample.add(clean_part_marking)
        if clean_ic_subgroup:
            tags_in_sample.add(clean_ic_subgroup)

        sample_boxes.append({
            "class_id": cid,
            "label": norm_label,
            "xmin": round(xmin, 4),
            "ymin": round(ymin, 4),
            "xmax": round(xmax, 4),
            "ymax": round(ymax, 4),
            "confidence": b.confidence or 1.0,
            "part_marking": clean_part_marking,
            "footprint": clean_footprint,
            "ic_subgroup": clean_ic_subgroup
        })

    lbl_path.write_text("\n".join(yolo_lines) + "\n", encoding="utf-8")

    all_tags = sorted(list(tags_in_sample))
    meta_dir = DATASET_DIR / "metadata" / req.split
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta_path = meta_dir / f"{sample_id}.json"
    sample_meta = {
        "id": sample_id,
        "split": req.split,
        "created_at": int(time.time()),
        "box_count": len(sample_boxes),
        "classes": sorted(list(classes_in_sample)),
        "tags": all_tags,
        "boxes": sample_boxes
    }
    meta_path.write_text(json.dumps(sample_meta, indent=2, ensure_ascii=False), encoding="utf-8")

    new_sample_entry = {
        "id": sample_id,
        "split": req.split,
        "image_url": f"/dataset/images/{req.split}/{sample_id}.jpg",
        "thumb_url": f"/api/dataset/thumbnails/{req.split}/{sample_id}",
        "boxes": sample_boxes,
        "box_count": len(sample_boxes),
        "classes": sorted(list(classes_in_sample)),
        "tags": all_tags,
        "created_at": sample_meta["created_at"],
        "size_bytes": len(raw_bytes)
    }

    if _cached_samples_data is not None:
        _cached_samples_data.insert(0, new_sample_entry)
        if _cached_stats is not None:
            if req.split == 'train':
                _cached_stats.train_images += 1
            else:
                _cached_stats.val_images += 1
            _cached_stats.total_annotations += len(sample_boxes)
            for cname in classes_in_sample:
                _cached_stats.class_counts[cname] = _cached_stats.class_counts.get(cname, 0) + 1
        save_dataset_index_async()

    return {
        "success": True,
        "sample_id": sample_id,
        "split": req.split,
        "box_count": len(sample_boxes),
        "image_url": new_sample_entry["image_url"],
        "thumb_url": new_sample_entry["thumb_url"],
        "stats": get_stats()
    }

def update_sample_boxes(split: str, sample_id: str, boxes: list[DetectedComponent]) -> dict:
    lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"
    meta_path = DATASET_DIR / "metadata" / split / f"{sample_id}.json"
    yolo_lines = []
    sample_boxes = []
    classes_in_sample = set()
    tags_in_sample = set()

    for b in boxes:
        norm_label = normalize_label_to_yolo(b.label)
        cid = CLASS_TO_ID.get(norm_label, CLASS_TO_ID["other"])
        classes_in_sample.add(norm_label)

        xmin = max(0.0, min(1.0, b.xmin))
        ymin = max(0.0, min(1.0, b.ymin))
        xmax = max(0.0, min(1.0, b.xmax))
        ymax = max(0.0, min(1.0, b.ymax))
        if xmax < xmin:
            xmin, xmax = xmax, xmin
        if ymax < ymin:
            ymin, ymax = ymax, ymin

        bw = xmax - xmin
        bh = ymax - ymin
        xc = xmin + bw / 2.0
        yc = ymin + bh / 2.0

        yolo_lines.append(f"{cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")

        clean_footprint = b.footprint.strip() if b.footprint else None
        clean_part_marking = b.part_marking.strip() if b.part_marking else None
        clean_ic_subgroup = b.ic_subgroup.strip() if b.ic_subgroup else None
        if clean_footprint:
            tags_in_sample.add(clean_footprint)
        if clean_part_marking:
            tags_in_sample.add(clean_part_marking)
        if clean_ic_subgroup:
            tags_in_sample.add(clean_ic_subgroup)

        sample_boxes.append({
            "class_id": cid,
            "label": norm_label,
            "xmin": round(xmin, 4),
            "ymin": round(ymin, 4),
            "xmax": round(xmax, 4),
            "ymax": round(ymax, 4),
            "confidence": b.confidence or 1.0,
            "part_marking": clean_part_marking,
            "footprint": clean_footprint,
            "ic_subgroup": clean_ic_subgroup
        })

    lbl_path.write_text("\n".join(yolo_lines) + "\n", encoding="utf-8")

    all_tags = sorted(list(tags_in_sample))
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    sample_meta = {
        "id": sample_id,
        "split": split,
        "created_at": int(time.time()),
        "box_count": len(sample_boxes),
        "classes": sorted(list(classes_in_sample)),
        "tags": all_tags,
        "boxes": sample_boxes
    }
    meta_path.write_text(json.dumps(sample_meta, indent=2, ensure_ascii=False), encoding="utf-8")
    invalidate_dataset_cache()
    return {"success": True, "sample_id": sample_id, "box_count": len(sample_boxes), "stats": get_stats(force_refresh=True)}

def delete_sample(split: str, sample_id: str) -> dict:
    global _cached_samples_data, _cached_stats
    img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
    lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"
    meta_path = DATASET_DIR / "metadata" / split / f"{sample_id}.json"
    thumb_path = THUMBNAILS_DIR / split / f"{sample_id}.webp"

    for p in [img_path, lbl_path, meta_path, thumb_path]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    if _cached_samples_data is not None:
        idx = next((i for i, s in enumerate(_cached_samples_data) if s.get("id") == sample_id and s.get("split") == split), None)
        if idx is not None:
            removed = _cached_samples_data.pop(idx)
            if _cached_stats is not None:
                if split == 'train':
                    _cached_stats.train_images = max(0, _cached_stats.train_images - 1)
                else:
                    _cached_stats.val_images = max(0, _cached_stats.val_images - 1)
                _cached_stats.total_annotations = max(0, _cached_stats.total_annotations - removed.get("box_count", 0))
                for b in removed.get("boxes", []):
                    cname = b.get("label", "other")
                    if cname in _cached_stats.class_counts:
                        _cached_stats.class_counts[cname] = max(0, _cached_stats.class_counts[cname] - 1)
            save_dataset_index_async()

    return {"success": True, "deleted_id": sample_id, "stats": get_stats()}

def delete_samples_bulk(items: list[dict]) -> dict:
    global _cached_samples_data, _cached_stats
    deleted_ids = []
    for item in items:
        sample_id = item.get("id")
        split = item.get("split")
        if not sample_id or not split:
            continue

        img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
        lbl_path = DATASET_DIR / "labels" / split / f"{sample_id}.txt"
        meta_path = DATASET_DIR / "metadata" / split / f"{sample_id}.json"
        thumb_path = THUMBNAILS_DIR / split / f"{sample_id}.webp"

        for p in [img_path, lbl_path, meta_path, thumb_path]:
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
        deleted_ids.append(sample_id)

        if _cached_samples_data is not None:
            idx = next((i for i, s in enumerate(_cached_samples_data) if s.get("id") == sample_id and s.get("split") == split), None)
            if idx is not None:
                removed = _cached_samples_data.pop(idx)
                if _cached_stats is not None:
                    if split == 'train':
                        _cached_stats.train_images = max(0, _cached_stats.train_images - 1)
                    else:
                        _cached_stats.val_images = max(0, _cached_stats.val_images - 1)
                    _cached_stats.total_annotations = max(0, _cached_stats.total_annotations - removed.get("box_count", 0))
                    for b in removed.get("boxes", []):
                        cname = b.get("label", "other")
                        if cname in _cached_stats.class_counts:
                            _cached_stats.class_counts[cname] = max(0, _cached_stats.class_counts[cname] - 1)

    if _cached_samples_data is not None:
        save_dataset_index_async()
    return {"success": True, "deleted_count": len(deleted_ids), "deleted_ids": deleted_ids, "stats": get_stats()}
