from typing import Optional
from fastapi import APIRouter, HTTPException
from app.config import AutoLabelRequest, AutoLabelResponse
from app.services.llm_service import (
    run_autolabel_inference,
    query_local_models,
    query_gemini_models
)

router = APIRouter(prefix="/api", tags=["autolabel"])

@router.post("/autolabel", response_model=AutoLabelResponse)
async def autolabel_endpoint(req: AutoLabelRequest):
    try:
        return await run_autolabel_inference(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/local-models")
async def local_models_endpoint(provider: str = 'openai', url: Optional[str] = None):
    return await query_local_models(provider=provider, url=url)

@router.get("/gemini-models")
async def gemini_models_endpoint(api_key: Optional[str] = None):
    return await query_gemini_models(api_key=api_key)
