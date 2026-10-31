from fastapi import APIRouter
from app.config import (
    LLMSettingsUpdate,
    get_llm_public_settings,
    save_llm_config
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("/llm")
async def get_llm_settings():
    """Gibt oeffentliche LLM-Konfigurationsdetails zurueck (Maskierte Keys, URLs, Default-Provider)."""
    return {
        "success": True,
        "settings": get_llm_public_settings()
    }

@router.post("/llm")
async def update_llm_settings(update: LLMSettingsUpdate):
    """Speichert LLM-API-Keys und Modell-Praeferenzen sicher auf dem Server."""
    update_dict = {}
    if update.gemini_api_key is not None and update.gemini_api_key.strip():
        update_dict["gemini_api_key"] = update.gemini_api_key.strip()
    if update.openai_api_key is not None and update.openai_api_key.strip():
        update_dict["openai_api_key"] = update.openai_api_key.strip()
    if update.default_provider is not None:
        update_dict["default_provider"] = update.default_provider.strip()
    if update.default_model is not None:
        update_dict["default_model"] = update.default_model.strip()
    if update.openai_url is not None:
        update_dict["openai_url"] = update.openai_url.strip()
    if update.ollama_url is not None:
        update_dict["ollama_url"] = update.ollama_url.strip()
    if update.lmstudio_url is not None:
        update_dict["lmstudio_url"] = update.lmstudio_url.strip()

    save_llm_config(update_dict)
    return {
        "success": True,
        "message": "LLM-Konfiguration erfolgreich auf dem Server gespeichert.",
        "settings": get_llm_public_settings()
    }
