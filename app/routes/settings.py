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
    if update.openai_api_key is not None:
        # Erlaubt das Setzen oder optionale Leeren des OpenAI API-Keys
        val = update.openai_api_key.strip()
        update_dict["openai_api_key"] = val

    prov = update.provider or update.default_provider
    if prov is not None and prov.strip():
        update_dict["default_provider"] = prov.strip()

    mod = update.model or update.default_model
    if mod is not None and mod.strip():
        update_dict["default_model"] = mod.strip()

    url_val = update.custom_url or update.openai_url
    if url_val is not None and url_val.strip():
        update_dict["openai_url"] = url_val.strip()

    if update.ollama_url is not None and update.ollama_url.strip():
        update_dict["ollama_url"] = update.ollama_url.strip()
    if update.lmstudio_url is not None and update.lmstudio_url.strip():
        update_dict["lmstudio_url"] = update.lmstudio_url.strip()
    if update.options is not None:
        update_dict["options"] = update.options

    save_llm_config(update_dict)
    return {
        "success": True,
        "message": "LLM-Konfiguration erfolgreich auf dem Server gespeichert.",
        "settings": get_llm_public_settings()
    }
