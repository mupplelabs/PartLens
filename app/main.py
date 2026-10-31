import os
import urllib.parse

# Verhindere Pydantic, OTEL & Telemetrie Overhead
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["OTEL_PYTHON_DISABLED"] = "true"
os.environ["PYDANTIC_DISABLE_PLUGINS"] = "1"
os.environ["PYDANTIC_AI_NO_BANNER"] = "1"
os.environ["LOGFIRE_IGNORE_NO_CONFIG"] = "1"
os.environ["FASTAPI_TELEMETRY_ENABLED"] = "0"

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import (
    FRONTEND_DIR,
    STUDIES_DIR,
    DATASET_DIR
)
from app.services.dataset_service import init_dataset_structure
from app.routes.system import router as system_router
from app.routes.settings import router as settings_router
from app.routes.dataset import router as dataset_router
from app.routes.autolabel import router as autolabel_router
from app.routes.footprints import router as footprints_router
from app.routes.import_data import router as import_router

# Dataset-Verzeichnisse pruefen und vorbereiten
init_dataset_structure()

app = FastAPI(
    title="ComponentTracker Auto-Labeling & Inventory Backend",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    from app.config import FOOTPRINTS_INDEX_FILE
    if not FOOTPRINTS_INDEX_FILE.exists():
        import asyncio
        from app.services.kicad_footprint_builder import generate_and_save_index, preload_core_footprints
        async def _init_footprints():
            try:
                await generate_and_save_index()
                await preload_core_footprints()
            except Exception as e:
                print(f"Warning: Auto-init footprints failed: {e}", flush=True)
        asyncio.create_task(_init_footprints())


# Router einbinden
app.include_router(system_router)
app.include_router(settings_router)
app.include_router(dataset_router)
app.include_router(autolabel_router)
app.include_router(footprints_router)
app.include_router(import_router)

# Statische Verzeichnisse mounten
if DATASET_DIR.exists():
    app.mount("/dataset", StaticFiles(directory=str(DATASET_DIR)), name="dataset")

# Fallback falls unescaped ? den Dateinamen als Query-String abschneidet
@app.get("/studies/4xDIP14_zuviel_Licht")
async def alias_zuviel_licht():
    target = STUDIES_DIR / "4xDIP14_zuviel_Licht.jpeg"
    if target.exists():
        return FileResponse(target)
    raise HTTPException(status_code=404, detail="Datei nicht gefunden.")

if STUDIES_DIR.exists():
    app.mount("/studies", StaticFiles(directory=str(STUDIES_DIR)), name="studies")

if FRONTEND_DIR.exists():
    app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")
    vendor_dir = FRONTEND_DIR / "vendor"
    if vendor_dir.exists():
        app.mount("/vendor", StaticFiles(directory=str(vendor_dir)), name="vendor")

# Standard-Routen fuer das Web-Frontend
@app.get("/")
@app.get("/v2")
async def serve_index():
    no_cache_headers = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, headers=no_cache_headers)
    # Fallback falls index.html noch aufgeteilt wird
    backup_file = FRONTEND_DIR / "backups" / "index_v2.html.original"
    if backup_file.exists():
        return FileResponse(backup_file, headers=no_cache_headers)
    return {"message": "ComponentTracker Backend running. Frontend initializing..."}

@app.get("/favicon.ico")
@app.get("/favicon.png")
async def favicon_png():
    fav = FRONTEND_DIR / "favicon.png"
    if fav.exists():
        return FileResponse(fav)
    return FileResponse(FRONTEND_DIR / "favicon.svg")

@app.get("/favicon.svg")
async def favicon_svg():
    fav_svg = FRONTEND_DIR / "favicon.svg"
    if fav_svg.exists():
        return FileResponse(fav_svg)
    return FileResponse(FRONTEND_DIR / "favicon.png")

@app.get("/apple-touch-icon.png")
@app.get("/apple-touch-icon-180x180.png")
async def apple_touch_icon():
    icon = FRONTEND_DIR / "apple-touch-icon.png"
    if icon.exists():
        return FileResponse(icon)
    return FileResponse(FRONTEND_DIR / "favicon.png")

@app.get("/{filename}")
async def serve_root_fallback(filename: str):
    clean_name = urllib.parse.unquote(filename)
    if clean_name.startswith("4xDIP14_zuviel_Licht"):
        study_file = STUDIES_DIR / "4xDIP14_zuviel_Licht.jpeg"
        if study_file.exists():
            return FileResponse(study_file)
    study_file = STUDIES_DIR / clean_name
    if study_file.exists() and study_file.is_file():
        return FileResponse(study_file)
    frontend_file = FRONTEND_DIR / clean_name
    if frontend_file.exists() and frontend_file.is_file():
        return FileResponse(frontend_file)
    raise HTTPException(status_code=404, detail=f"Datei '{clean_name}' nicht gefunden.")
