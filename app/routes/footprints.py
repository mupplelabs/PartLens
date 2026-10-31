import mimetypes
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from app.config import (
    FOOTPRINTS_CACHE_DIR,
    FOOTPRINTS_CDN_URL,
    FOOTPRINTS_CDN_FALLBACK,
)
from app.services.footprint_service import (
    search_footprints,
    get_footprint_image_bytes,
    get_footprints_index,
    reload_footprints_index,
)
from app.services.kicad_footprint_builder import (
    generate_and_save_index,
    preload_core_footprints,
)

router = APIRouter(prefix="/api/footprints", tags=["footprints"])

@router.get("/status")
async def get_footprints_status():
    index = get_footprints_index()
    cached_files = list(FOOTPRINTS_CACHE_DIR.glob("**/*.png")) + list(FOOTPRINTS_CACHE_DIR.glob("**/*.svg"))
    cached_size_bytes = sum(f.stat().st_size for f in cached_files if f.is_file())
    return {
        "indexed_count": len(index),
        "cached_count": len(cached_files),
        "cached_size_kb": round(cached_size_bytes / 1024, 1),
        "cdn_primary": FOOTPRINTS_CDN_URL,
        "cdn_fallback": FOOTPRINTS_CDN_FALLBACK,
    }

@router.post("/sync")
async def sync_footprints():
    total_indexed = await generate_and_save_index()
    reload_footprints_index()
    preloaded = await preload_core_footprints()
    return {
        "status": "ok",
        "indexed": total_indexed,
        "preloaded": preloaded,
    }

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

    # Remote Fallback ueber CDN / Part-DB
    content = await get_footprint_image_bytes(clean_path)
    if content is not None:
        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=2592000, immutable"}
        )

    raise HTTPException(status_code=404, detail="Footprint-Bild konnte nicht geladen werden.")

@router.get("/file/{path:path}")
async def get_footprint_file(path: str):
    return await get_footprint_image(path=path)

