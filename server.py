import os
import uvicorn
from app.main import app

from app.config import (
    CLASS_NAMES,
    CLASS_TO_ID,
    BASE_DIR,
    DATASET_DIR,
    EXT_DIR,
    THUMBNAILS_DIR,
    FRONTEND_DIR,
    STUDIES_DIR,
    load_llm_config,
    save_llm_config,
    get_llm_public_settings
)
from app.services.dataset_service import (
    scan_full_dataset,
    get_stats,
    load_dataset_index,
    save_dataset_index,
    save_dataset_index_async,
    invalidate_dataset_cache,
    parse_image_base64,
    normalize_label_to_yolo
)
from app.services.coco import build_coco_instances, coco_bbox_to_yolo
from app.services.dataset_import_service import scan_external_datasets, _run_import_thread
from app.services.footprint_service import get_footprints_index, search_footprints
from app.services.llm_service import run_autolabel_inference, build_autolabel_prompt, build_gemini_schema
from app.routes.dataset import export_dataset_zip, export_dataset_coco
from app.routes.import_data import get_import_sources

if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="PartLens Component Tracker Server")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"), help="Host-Adresse (Standard: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")), help="Port (Standard: 8000)")
    parser.add_argument("--debug", "--llm-debug", "-d", dest="debug", action="store_true", help="Aktiviert ausfuehrliches LLM-Debug-Logging im Terminal")
    parser.add_argument("--no-debug", dest="debug", action="store_false", help="Deaktiviert das LLM-Debug-Logging")
    parser.set_defaults(debug=os.environ.get("DEBUG_LLM", "").lower() in ("1", "true", "yes", "on"))

    args, unknown = parser.parse_known_args()

    if args.debug:
        os.environ["DEBUG_LLM"] = "1"
        print("[PartLens] LLM-Debug-Logging ist AKTIVIERT (--debug)", flush=True)
    else:
        os.environ["DEBUG_LLM"] = "0"

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=True, reload_dirs=["app", "frontend"])
