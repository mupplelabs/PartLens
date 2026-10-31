import mimetypes
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from app.config import FOOTPRINTS_CACHE_DIR
from app.services.footprint_service import (
    search_footprints,
    get_footprint_image_bytes
)

router = APIRouter(prefix="/api/footprints", tags=["footprints"])

@router.get("/list")
async def list_footprints(
    class_name: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(150, ge=1, le=500)
):
    return search_footprints(class_name=class_name, search=search, limit=limit)

@router.get("/image")
async def get_footprint_image(path: str = Query(..., description="Footprint relative path")):
    clean_path = Path(path.strip("/\\")).as_posix()
    if ".." in clean_path:
        raise HTTPException(status_code=400, detail="Ungueltiger Pfad")

    local_file = FOOTPRINTS_CACHE_DIR / clean_path
    media_type = mimetypes.guess_type(str(local_file))[0] or "image/png"

    if local_file.exists():
        return FileResponse(
            local_file,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )

    # Remote Fallback von Part-DB
    content = await get_footprint_image_bytes(clean_path)
    if content is not None:
        local_file.parent.mkdir(parents=True, exist_ok=True)
        local_file.write_bytes(content)
        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )

    raise HTTPException(status_code=404, detail="Footprint-Bild konnte nicht geladen werden.")

@router.get("/file/{path:path}")
async def get_footprint_file(path: str):
    return await get_footprint_image(path=path)
