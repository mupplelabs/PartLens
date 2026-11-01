import re
import time
import json
import collections
import threading
import traceback
from pathlib import Path
from typing import Optional
from PIL import Image

from app.config import (
    BASE_DIR,
    DATASET_DIR,
    THUMBNAILS_DIR,
    EXT_DIR,
    CLASS_NAMES,
    CLASS_TO_ID
)
from app.services.coco import coco_bbox_to_yolo
from app.services.dataset_service import invalidate_dataset_cache, get_stats
from import_external_datasets import (
    ELECTROCOM61_MAPPING,
    ROBOFLOW_MAPPING,
    polygon_to_bbox,
    parse_yaml_names,
)

_import_state = {
    "status": "idle",
    "total": 0,
    "current": 0,
    "progress_pct": 0,
    "current_dataset": None,
    "current_file": None,
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
        elif any(k in cl for k in ["mcu_stick", "nano", "nodemcu", "pico", "teensy", "pro_micro"]):
            mapping[c] = "board_mcu_stick"
        elif any(k in cl for k in ["mini_stamp", "stamp", "supermini", "d1_mini", "d1 mini", "wemos"]):
            mapping[c] = "board_mini_stamp"
        elif any(k in cl for k in ["uno", "mega", "due", "leonardo"]):
            mapping[c] = "board_standard"
        elif any(k in cl for k in ["module", "modul", "sensor", "driver", "breakout", "shield"]):
            mapping[c] = "board_module"
        elif any(k in cl for k in ["oscillator", "crystal", "quarz", "resonator"]):
            mapping[c] = "oscillator"
        elif any(k in cl for k in ["motor", "servo", "stepper", "actuator"]):
            mapping[c] = "motor_actuator"
        elif any(k in cl for k in ["buzzer", "speaker", "piezo", "beeper", "sound"]):
            mapping[c] = "speaker_buzzer"
        elif any(k in cl for k in ["board", "arduino", "esp32", "pcb"]):
            mapping[c] = "board_standard"
        else:
            mapping[c] = "other"
    return mapping

def scan_external_datasets() -> list[dict]:
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
                    "format": "yolo",
                    "root": root,
                    "folder": str(root.relative_to(BASE_DIR)),
                    "total_images": total,
                    "splits": splits,
                    "classes": raw_classes,
                    "default_mapping": default_map,
                    "prefix": f"{ds_id}_"
                })

    coco_candidates = {}
    for json_path in sorted(EXT_DIR.rglob("*.json")):
        jname = json_path.name.lower()
        if not (any(k in jname for k in ["coco", "instances", "annotations", "labels"]) or json_path.parent.name == "annotations"):
            continue

        if json_path.parent.name == "annotations":
            ds_root = json_path.parent.parent
        elif json_path.parent.name in ("train", "val", "valid", "test"):
            ds_root = json_path.parent.parent
        else:
            ds_root = json_path.parent

        if ds_root in seen_roots and ds_root not in coco_candidates:
            continue

        try:
            with open(json_path, "r", encoding="utf-8") as jf:
                coco_head = json.load(jf)
        except Exception:
            continue

        if not isinstance(coco_head, dict) or "images" not in coco_head or "annotations" not in coco_head:
            continue

        stem = json_path.stem.lower()
        parent_name = json_path.parent.name.lower()
        if "train" in stem or parent_name == "train":
            sp_name = "train"
        elif any(k in stem for k in ["val", "valid"]) or parent_name in ("val", "valid"):
            sp_name = "val"
        elif "test" in stem or parent_name == "test":
            sp_name = "test"
        else:
            sp_name = "all"

        candidate_dirs = [
            ds_root / sp_name,
            ds_root / "images" / sp_name,
            ds_root / sp_name / "images",
            json_path.parent,
            json_path.parent / "images",
            ds_root / "images",
            ds_root
        ]
        img_dir = json_path.parent
        for cdir in candidate_dirs:
            if cdir.exists() and (any(cdir.glob("*.jpg")) or any(cdir.glob("*.jpeg")) or any(cdir.glob("*.png"))):
                img_dir = cdir
                break

        img_count = len(coco_head.get("images", []))
        raw_cats = [c.get("name", "other") for c in coco_head.get("categories", []) if c.get("name")]

        if ds_root not in coco_candidates:
            seen_roots.add(ds_root)
            rel_path = ds_root.relative_to(EXT_DIR)
            ds_id = "coco_" + re.sub(r"[^a-zA-Z0-9_-]", "_", str(rel_path)).strip("_").lower()
            coco_candidates[ds_root] = {
                "id": ds_id,
                "name": f"{ds_root.name.replace('_', ' ').strip()} (COCO)",
                "format": "coco",
                "root": ds_root,
                "folder": str(ds_root.relative_to(BASE_DIR)),
                "splits": {},
                "coco_splits": {},
                "classes": list(dict.fromkeys(raw_cats)),
                "prefix": f"{ds_id}_"
            }

        coco_candidates[ds_root]["splits"][sp_name] = img_count
        coco_candidates[ds_root]["coco_splits"][sp_name] = {
            "json_path": json_path,
            "img_dir": img_dir
        }
        for rc in raw_cats:
            if rc not in coco_candidates[ds_root]["classes"]:
                coco_candidates[ds_root]["classes"].append(rc)

    for ds_root, c_ds in coco_candidates.items():
        total = sum(c_ds["splits"].values())
        if total > 0:
            c_ds["total_images"] = total
            c_ds["default_mapping"] = guess_default_mapping(c_ds["classes"])
            found_datasets.append(c_ds)

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
            ds_imported_count = 0
            ds_format = ds.get("format", "yolo")

            if ds_format == "coco":
                coco_splits = ds.get("coco_splits", {})
                for sp, split_info in coco_splits.items():
                    if _import_abort_flag:
                        break
                    if max_samples > 0 and ds_imported_count >= max_samples:
                        break

                    target_split = "train" if sp in ("train", "all") else "val"
                    json_path = split_info["json_path"]
                    img_dir = split_info["img_dir"]

                    try:
                        with open(json_path, "r", encoding="utf-8") as jf:
                            coco_data = json.load(jf)
                    except Exception as je:
                        print(f"Fehler beim Laden von COCO JSON {json_path}: {je}", flush=True)
                        continue

                    categories = {c["id"]: c.get("name", "other") for c in coco_data.get("categories", [])}
                    images = coco_data.get("images", [])
                    raw_annotations = coco_data.get("annotations", [])

                    annos_by_img = collections.defaultdict(list)
                    for anno in raw_annotations:
                        annos_by_img[anno.get("image_id")].append(anno)

                    for img_info in images:
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
                            _import_state["current_file"] = img_info.get("file_name", "")

                        img_file_name = img_info.get("file_name", "")
                        img_path = img_dir / img_file_name
                        if not img_path.exists():
                            img_path = img_dir / Path(img_file_name).name
                        if not img_path.exists():
                            continue

                        img_w = img_info.get("width")
                        img_h = img_info.get("height")
                        if not img_w or not img_h or img_w <= 0 or img_h <= 0:
                            try:
                                with Image.open(img_path) as im_probe:
                                    img_w, img_h = im_probe.size
                            except Exception:
                                img_w, img_h = 800, 600

                        img_annos = annos_by_img.get(img_info.get("id"), [])
                        if not img_annos:
                            continue

                        target_lines = []
                        sample_boxes = []
                        classes_in_sample = set()
                        tags_in_sample = set()

                        for anno in img_annos:
                            raw_cid = anno.get("category_id")
                            raw_name = categories.get(raw_cid, "other")
                            target_name = mapping.get(raw_name, "other")

                            if target_name in ("_ignore_", "ignore", "skip") or (skip_other and target_name == "other"):
                                with _import_lock:
                                    _import_state["skipped_boxes"] += 1
                                continue

                            target_cid = CLASS_TO_ID.get(target_name, CLASS_TO_ID["other"])
                            bbox = anno.get("bbox", [])
                            if len(bbox) < 4:
                                continue

                            xc, yc, bw, bh = coco_bbox_to_yolo(bbox, img_w, img_h)

                            attrs = anno.get("attributes") or {}
                            part_marking = attrs.get("part_marking")
                            footprint = attrs.get("footprint")
                            ic_subgroup = attrs.get("ic_subgroup")
                            conf = float(attrs.get("confidence", 1.0))

                            target_lines.append(f"{target_cid} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}")

                            xmin = max(0.0, xc - bw / 2.0)
                            ymin = max(0.0, yc - bh / 2.0)
                            xmax = min(1.0, xc + bw / 2.0)
                            ymax = min(1.0, yc + bh / 2.0)

                            sample_boxes.append({
                                "class_id": target_cid,
                                "label": target_name,
                                "xmin": round(xmin, 4),
                                "ymin": round(ymin, 4),
                                "xmax": round(xmax, 4),
                                "ymax": round(ymax, 4),
                                "confidence": conf,
                                "part_marking": part_marking,
                                "footprint": footprint,
                                "ic_subgroup": ic_subgroup
                            })
                            classes_in_sample.add(target_name)
                            if footprint:
                                tags_in_sample.add(footprint)
                            if part_marking:
                                tags_in_sample.add(part_marking)
                            if ic_subgroup:
                                tags_in_sample.add(ic_subgroup)

                            with _import_lock:
                                _import_state["class_stats"][target_name] = _import_state["class_stats"].get(target_name, 0) + 1
                                _import_state["imported_boxes"] += 1

                        if not target_lines:
                            continue

                        new_stem = f"{prefix}{Path(img_file_name).stem}"
                        dest_img = DATASET_DIR / "images" / target_split / f"{new_stem}.jpg"
                        dest_lbl = DATASET_DIR / "labels" / target_split / f"{new_stem}.txt"
                        dest_meta = DATASET_DIR / "metadata" / target_split / f"{new_stem}.json"

                        dest_img.parent.mkdir(parents=True, exist_ok=True)
                        dest_lbl.parent.mkdir(parents=True, exist_ok=True)
                        dest_meta.parent.mkdir(parents=True, exist_ok=True)

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
                            print(f"Fehler beim Kopieren von Bild {img_path.name}: {err}", flush=True)
                            continue

                        dest_lbl.write_text("\n".join(target_lines) + "\n", encoding="utf-8")

                        sample_meta = {
                            "id": new_stem,
                            "split": target_split,
                            "created_at": int(time.time()),
                            "box_count": len(sample_boxes),
                            "classes": sorted(list(classes_in_sample)),
                            "tags": sorted(list(tags_in_sample)),
                            "boxes": sample_boxes
                        }
                        dest_meta.write_text(json.dumps(sample_meta, indent=2, ensure_ascii=False), encoding="utf-8")

                        with _import_lock:
                            _import_state["imported_images"] += 1

            else:
                raw_classes = parse_yaml_names(root / "data.yaml")

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
                        sample_boxes = []
                        classes_in_sample = set()
                        tags_in_sample = set()

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

                            xmin = max(0.0, xc - bw / 2.0)
                            ymin = max(0.0, yc - bh / 2.0)
                            xmax = min(1.0, xc + bw / 2.0)
                            ymax = min(1.0, yc + bh / 2.0)

                            sample_boxes.append({
                                "class_id": target_cid,
                                "label": target_name,
                                "xmin": round(xmin, 4),
                                "ymin": round(ymin, 4),
                                "xmax": round(xmax, 4),
                                "ymax": round(ymax, 4),
                                "confidence": 1.0,
                                "part_marking": None,
                                "footprint": None,
                                "ic_subgroup": None
                            })
                            classes_in_sample.add(target_name)

                            with _import_lock:
                                _import_state["class_stats"][target_name] = _import_state["class_stats"].get(target_name, 0) + 1
                                _import_state["imported_boxes"] += 1

                        if not target_lines:
                            continue

                        new_stem = f"{prefix}{img_path.stem}"
                        dest_img = DATASET_DIR / "images" / target_split / f"{new_stem}.jpg"
                        dest_lbl = DATASET_DIR / "labels" / target_split / f"{new_stem}.txt"
                        dest_meta = DATASET_DIR / "metadata" / target_split / f"{new_stem}.json"

                        dest_img.parent.mkdir(parents=True, exist_ok=True)
                        dest_lbl.parent.mkdir(parents=True, exist_ok=True)
                        dest_meta.parent.mkdir(parents=True, exist_ok=True)

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

                        sample_meta = {
                            "id": new_stem,
                            "split": target_split,
                            "created_at": int(time.time()),
                            "box_count": len(sample_boxes),
                            "classes": sorted(list(classes_in_sample)),
                            "tags": sorted(list(tags_in_sample)),
                            "boxes": sample_boxes
                        }
                        dest_meta.write_text(json.dumps(sample_meta, indent=2, ensure_ascii=False), encoding="utf-8")

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

def start_import_task(source_ids: list[str], custom_mapping: dict[str, str], skip_other: bool, max_samples: int, generate_thumbnails: bool) -> bool:
    global _import_state
    with _import_lock:
        if _import_state["status"] == "running":
            return False

    thread = threading.Thread(
        target=_run_import_thread,
        args=(source_ids, custom_mapping, skip_other, max_samples, generate_thumbnails),
        daemon=True
    )
    thread.start()
    return True

def abort_import_task():
    global _import_abort_flag
    _import_abort_flag = True

def get_import_status_state() -> dict:
    with _import_lock:
        return dict(_import_state)
