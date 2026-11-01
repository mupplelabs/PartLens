from fastapi import APIRouter
from app.config import CLASS_NAMES, get_llm_public_settings
from app.services.dataset_service import get_stats

router = APIRouter(prefix="/api", tags=["system"])

@router.get("/status")
async def status():
    llm_settings = get_llm_public_settings()
    stats = get_stats()
    return {
        "status": "ok",
        "has_gemini_env": llm_settings["has_gemini_key"],
        "classes": CLASS_NAMES,
        "stats": stats,
        "llm_settings": llm_settings
    }

@router.get("/classes")
async def get_classes():
    return {
        "nc": len(CLASS_NAMES),
        "classes": CLASS_NAMES,
        "class_to_id": {name: idx for idx, name in enumerate(CLASS_NAMES)}
    }

@router.get("/health")
async def health():
    return {"status": "healthy"}
