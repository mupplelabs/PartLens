from fastapi import APIRouter
from app.config import (
    LLMSettingsUpdate,
    get_llm_public_settings,
    save_llm_config
)
from app.services.token_service import get_token_stats, reset_token_stats

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

    def is_valid_model(m: Optional[str]) -> bool:
        if not m:
            return False
        s = m.strip()
        if not s or s == "__custom__" or s.lower().startswith("lade modelle"):
            return False
        return True

    mod = update.model or update.default_model
    if is_valid_model(mod):
        mod_clean = mod.strip()
        update_dict["default_model"] = mod_clean
        if prov == "gemini":
            update_dict["gemini_model"] = mod_clean
        elif prov in ("openai", "lmstudio"):
            update_dict["openai_model"] = mod_clean
        elif prov == "ollama":
            update_dict["ollama_model"] = mod_clean

    if is_valid_model(update.gemini_model):
        update_dict["gemini_model"] = update.gemini_model.strip()
    if is_valid_model(update.openai_model):
        update_dict["openai_model"] = update.openai_model.strip()
    if is_valid_model(update.ollama_model):
        update_dict["ollama_model"] = update.ollama_model.strip()

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

@router.get("/token-usage")
async def get_token_usage_endpoint():
    """Liefert aggregierte Token-Verbrauchsdaten und Modellstatistiken."""
    return {
        "success": True,
        "usage": get_token_stats()
    }

@router.post("/token-usage/reset")
async def reset_token_usage_endpoint():
    """Setzt die gespeicherten Token-Verbrauchsstatistiken zurueck."""
    return {
        "success": True,
        "message": "Token-Statistiken erfolgreich zurueckgesetzt.",
        "usage": reset_token_stats()
    }
