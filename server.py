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
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server:app", host=host, port=port, reload=True)
