from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.services.footprint_service import (
    search_footprints,
    get_footprint_svg
)

router = APIRouter(prefix="/api/footprints", tags=["footprints"])

@router.get("/list")
async def list_footprints(
    class_name: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(150, ge=1, le=500)
):
    return search_footprints(class_name=class_name, search=search, limit=limit)

@router.get("/file/{path:path}")
async def get_footprint_file(path: str):
    svg_bytes = await get_footprint_svg(path)
    if svg_bytes is not None:
        return Response(content=svg_bytes, media_type="image/svg+xml")
    raise HTTPException(status_code=404, detail="Footprint-Zeichnung konnte nicht geladen werden.")
