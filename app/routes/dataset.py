import io
import json
import zipfile
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, FileResponse

from app.config import (
    DATASET_DIR,
    THUMBNAILS_DIR,
    DatasetStatsResponse,
    SaveSampleRequest,
    DetectedComponent
)
from app.services.dataset_service import (
    get_stats,
    get_samples,
    get_sample_meta,
    save_sample,
    update_sample_boxes,
    delete_sample,
    delete_samples_bulk
)
from app.services.coco import build_coco_instances

router = APIRouter(prefix="/api/dataset", tags=["dataset"])

@router.get("/stats", response_model=DatasetStatsResponse)
async def dataset_stats():
    return get_stats()

@router.get("/samples")
async def list_dataset_samples(
    split: Optional[str] = Query(None),
    class_name: Optional[str] = Query(None),
    tag: Optional[str] = Query(None),
    limit: int = Query(60, ge=1, le=500),
    offset: int = Query(0, ge=0),
    force_refresh: bool = Query(False)
):
    return get_samples(split=split, class_name=class_name, tag=tag, limit=limit, offset=offset, force_refresh=force_refresh)

@router.get("/samples/{split}/{sample_id}")
@router.get("/sample/{split}/{sample_id}")
async def get_dataset_sample_endpoint(split: str, sample_id: str):
    clean_id = sample_id.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replace(".webp", "")
    img_dir = DATASET_DIR / "images" / split
    img_path = None
    for ext in [".jpg", ".jpeg", ".png", ".webp"]:
        candidate = img_dir / f"{clean_id}{ext}"
        if candidate.exists():
            img_path = candidate
            break

    if not img_path:
        raise HTTPException(status_code=404, detail=f"Sample '{clean_id}' in split '{split}' nicht gefunden.")

    meta_path = DATASET_DIR / "metadata" / split / f"{clean_id}.json"
    lbl_path = DATASET_DIR / "labels" / split / f"{clean_id}.txt"

    boxes = []
    tags = []
    if meta_path.exists():
        try:
            meta_raw = json.loads(meta_path.read_text(encoding="utf-8"))
            boxes = meta_raw.get("boxes", [])
            tags = meta_raw.get("tags", [])
        except Exception:
            pass

    if not boxes and lbl_path.exists():
        try:
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
                        "ymax": round(ymax, 4),
                        "confidence": 1.0,
                        "part_marking": None,
                        "footprint": None,
                        "ic_subgroup": None
                    })
        except Exception:
            pass

    return {
        "id": clean_id,
        "split": split,
        "image_url": f"/dataset/images/{split}/{img_path.name}",
        "boxes": boxes,
        "tags": tags
    }

@router.get("/sample/{split}/{sample_id}/meta")
async def get_single_sample_metadata(split: str, sample_id: str):
    clean_id = sample_id.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replace(".webp", "")
    meta = get_sample_meta(split, clean_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Metadaten nicht gefunden.")
    return meta

@router.post("/sample")
@router.post("/save-sample")
async def save_new_sample(req: SaveSampleRequest):
    try:
        return save_sample(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/samples/{split}/{sample_id}/boxes")
@router.put("/sample/{split}/{sample_id}/boxes")
async def update_sample_boxes_endpoint(split: str, sample_id: str, boxes: list[DetectedComponent]):
    try:
        clean_id = sample_id.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replace(".webp", "")
        return update_sample_boxes(split, clean_id, boxes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/samples/{split}/{sample_id}")
@router.delete("/sample/{split}/{sample_id}")
async def delete_single_sample_endpoint(split: str, sample_id: str):
    clean_id = sample_id.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replace(".webp", "")
    return delete_sample(split, clean_id)

@router.api_route("/samples/batch-delete", methods=["POST", "DELETE"])
@router.api_route("/samples/bulk-delete", methods=["POST", "DELETE"])
@router.post("/delete-bulk")
async def delete_samples_bulk_endpoint(req: dict):
    items = req.get("samples") or req.get("items") or []
    if not items and "filenames" in req:
        for fn in req["filenames"]:
            stem = fn.replace(".jpg", "").replace(".jpeg", "").replace(".png", "").replace(".webp", "")
            items.append({"split": "train", "id": stem})

    if not items:
        raise HTTPException(status_code=400, detail="Keine Elemente uebergeben.")
    return delete_samples_bulk(items)

@router.get("/thumbnails/{split}/{sample_id}")
async def get_thumbnail(split: str, sample_id: str):
    clean_id = sample_id.replace(".webp", "").replace(".jpg", "").replace(".jpeg", "").replace(".png", "")
    thumb_path = THUMBNAILS_DIR / split / f"{clean_id}.webp"
    if thumb_path.exists():
        return FileResponse(thumb_path, media_type="image/webp")

    img_dir = DATASET_DIR / "images" / split
    for ext in [".jpg", ".jpeg", ".png", ".webp"]:
        candidate = img_dir / f"{clean_id}{ext}"
        if candidate.exists():
            try:
                from PIL import Image
                thumb_path.parent.mkdir(parents=True, exist_ok=True)
                with Image.open(candidate) as pil_img:
                    thumb_img = pil_img.convert("RGB")
                    thumb_img.thumbnail((380, 380), Image.Resampling.BILINEAR)
                    thumb_img.save(thumb_path, "WEBP", quality=75)
                return FileResponse(thumb_path, media_type="image/webp")
            except Exception:
                return FileResponse(candidate)

    svg_fallback = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="285" viewBox="0 0 380 285" fill="#18181b">'
        '<rect width="100%" height="100%" fill="#18181b"/>'
        '<rect x="130" y="82" width="120" height="120" rx="12" fill="#27272a" stroke="#3f3f46" stroke-width="2"/>'
        '<text x="190" y="148" text-anchor="middle" fill="#71717a" font-family="sans-serif" font-size="12">Sample nicht gefunden</text>'
        '</svg>'
    )
    return Response(content=svg_fallback, media_type="image/svg+xml")

@router.get("/export-coco")
async def export_dataset_coco():
    return await export_dataset_zip(format="coco")

@router.get("/export-zip")
async def export_dataset_zip(format: str = "yolo"):
    zip_buffer = io.BytesIO()

    if format.lower() == "coco":
        samples_data = get_samples(limit=100000).get("samples", [])
        train_coco = build_coco_instances("train", samples_data)
        val_coco = build_coco_instances("val", samples_data)

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("annotations/instances_train.json", json.dumps(train_coco, indent=2, ensure_ascii=False))
            zf.writestr("annotations/instances_val.json", json.dumps(val_coco, indent=2, ensure_ascii=False))

            for sp in ["train", "val"]:
                sp_img_dir = DATASET_DIR / "images" / sp
                if sp_img_dir.exists():
                    for p in sp_img_dir.glob("*.*"):
                        if p.is_file():
                            zf.write(p, arcname=f"images/{sp}/{p.name}")

        zip_buffer.seek(0)
        return Response(
            content=zip_buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="component_dataset_coco.zip"'}
        )
    else:
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
