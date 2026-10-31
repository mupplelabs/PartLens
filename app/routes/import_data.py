from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.config import CLASS_NAMES
from app.services.dataset_import_service import (
    scan_external_datasets,
    start_import_task,
    abort_import_task,
    get_import_status_state
)

router = APIRouter(prefix="/api/dataset/import", tags=["import"])

class StartImportRequest(BaseModel):
    source_ids: list[str]
    custom_mapping: dict[str, str] = {}
    skip_other: bool = False
    max_samples: int = 0
    generate_thumbnails: bool = True

@router.get("/sources")
async def get_import_sources():
    datasets = scan_external_datasets()
    sources = []
    for d in datasets:
        sources.append({
            "id": d["id"],
            "name": d["name"],
            "format": d.get("format", "yolo"),
            "folder": d["folder"],
            "total_images": d["total_images"],
            "splits": d["splits"],
            "classes": d["classes"],
            "default_mapping": d["default_mapping"]
        })

    return {
        "sources": sources,
        "target_classes": CLASS_NAMES,
        "current_status": get_import_status_state()
    }

@router.post("/start")
async def start_dataset_import(req: StartImportRequest):
    success = start_import_task(
        source_ids=req.source_ids,
        custom_mapping=req.custom_mapping,
        skip_other=req.skip_other,
        max_samples=req.max_samples,
        generate_thumbnails=req.generate_thumbnails
    )
    if not success:
        raise HTTPException(status_code=409, detail="Ein Import laeuft bereits.")
    return {"success": True, "message": "Import gestartet."}

@router.post("/abort")
async def abort_dataset_import():
    abort_import_task()
    return {"success": True, "message": "Import-Abbruch angefordert."}

@router.get("/status")
async def get_dataset_import_status():
    return {"success": True, "status": get_import_status_state()}
