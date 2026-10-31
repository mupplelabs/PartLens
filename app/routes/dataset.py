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

@router.get("/sample/{split}/{sample_id}/meta")
async def get_single_sample_metadata(split: str, sample_id: str):
    meta = get_sample_meta(split, sample_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Metadaten nicht gefunden.")
    return meta

@router.post("/sample")
async def save_new_sample(req: SaveSampleRequest):
    try:
        return save_sample(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/sample/{split}/{sample_id}/boxes")
async def update_sample_boxes_endpoint(split: str, sample_id: str, boxes: list[DetectedComponent]):
    try:
        return update_sample_boxes(split, sample_id, boxes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/sample/{split}/{sample_id}")
async def delete_single_sample_endpoint(split: str, sample_id: str):
    return delete_sample(split, sample_id)

@router.post("/delete-bulk")
async def delete_samples_bulk_endpoint(req: dict):
    items = req.get("items", [])
    if not items:
        raise HTTPException(status_code=400, detail="Keine Elemente uebergeben.")
    return delete_samples_bulk(items)

@router.get("/thumbnails/{split}/{sample_id}")
async def get_thumbnail(split: str, sample_id: str):
    thumb_path = THUMBNAILS_DIR / split / f"{sample_id}.webp"
    if thumb_path.exists():
        return FileResponse(thumb_path, media_type="image/webp")

    img_path = DATASET_DIR / "images" / split / f"{sample_id}.jpg"
    if img_path.exists():
        return FileResponse(img_path, media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Thumbnail nicht gefunden.")

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
