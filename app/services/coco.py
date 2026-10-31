import time
from datetime import datetime
from PIL import Image
from app.config import DATASET_DIR, CLASS_NAMES

def coco_bbox_to_yolo(bbox: list[float], img_w: int, img_h: int) -> tuple[float, float, float, float]:
    """Wandelt COCO BBox [xmin, ymin, width, height] in Pixeln in normalisierte YOLO BBox [xc, yc, w, h] (0..1) um."""
    if img_w <= 0 or img_h <= 0 or len(bbox) < 4:
        return 0.5, 0.5, 0.1, 0.1
    xmin, ymin, bw, bh = [float(v) for v in bbox[:4]]
    xmin = max(0.0, min(float(img_w), xmin))
    ymin = max(0.0, min(float(img_h), ymin))
    bw = max(1.0, min(float(img_w - xmin), bw))
    bh = max(1.0, min(float(img_h - ymin), bh))

    xc = (xmin + bw / 2.0) / float(img_w)
    yc = (ymin + bh / 2.0) / float(img_h)
    nw = bw / float(img_w)
    nh = bh / float(img_h)
    return round(xc, 6), round(yc, 6), round(nw, 6), round(nh, 6)

def build_coco_instances(split: str, samples: list[dict]) -> dict:
    """Erzeugt ein standardkonformes COCO JSON-Dictionary fuer den gegebenen Split (train/val)."""
    split_samples = [s for s in samples if s.get("split") == split]

    info = {
        "year": datetime.now().year,
        "version": "1.0",
        "description": "ComponentTracker Electronic Components Dataset",
        "contributor": "ComponentTracker",
        "date_created": datetime.now().isoformat()
    }
    licenses = [
        {"id": 1, "name": "Proprietary / Open Access", "url": ""}
    ]
    categories = [
        {"id": idx + 1, "name": name, "supercategory": "electronic_component"}
        for idx, name in enumerate(CLASS_NAMES)
    ]

    images = []
    annotations = []
    annotation_id = 1

    for img_id, sample in enumerate(split_samples, start=1):
        sample_id = sample.get("id")
        img_name = f"{sample_id}.jpg"
        img_path = DATASET_DIR / "images" / split / img_name
        if not img_path.exists():
            cand = list((DATASET_DIR / "images" / split).glob(f"{sample_id}.*"))
            if cand:
                img_path = cand[0]
                img_name = img_path.name
            else:
                continue

        try:
            with Image.open(img_path) as im:
                w, h = im.size
        except Exception:
            w, h = 800, 600

        created_ts = sample.get("created_at", int(time.time()))
        date_cap = datetime.fromtimestamp(created_ts).strftime("%Y-%m-%d")

        images.append({
            "id": img_id,
            "file_name": img_name,
            "width": int(w),
            "height": int(h),
            "date_captured": date_cap
        })

        for box in sample.get("boxes", []):
            label = box.get("label", "other")
            if label not in CLASS_NAMES:
                label = "other"
            cat_id = CLASS_NAMES.index(label) + 1

            xmin = float(box.get("xmin", 0.0))
            ymin = float(box.get("ymin", 0.0))
            xmax = float(box.get("xmax", 0.0))
            ymax = float(box.get("ymax", 0.0))

            px_min = max(0.0, min(float(w), xmin * w))
            py_min = max(0.0, min(float(h), ymin * h))
            px_max = max(px_min + 1.0, min(float(w), xmax * w))
            py_max = max(py_min + 1.0, min(float(h), ymax * h))

            bw = px_max - px_min
            bh = py_max - py_min
            area = round(bw * bh, 2)

            annotations.append({
                "id": annotation_id,
                "image_id": img_id,
                "category_id": cat_id,
                "bbox": [round(px_min, 2), round(py_min, 2), round(bw, 2), round(bh, 2)],
                "area": area,
                "segmentation": [],
                "iscrowd": 0,
                "attributes": {
                    "part_marking": box.get("part_marking"),
                    "footprint": box.get("footprint"),
                    "ic_subgroup": box.get("ic_subgroup"),
                    "confidence": float(box.get("confidence", 1.0))
                }
            })
            annotation_id += 1

    return {
        "info": info,
        "licenses": licenses,
        "categories": categories,
        "images": images,
        "annotations": annotations
    }
