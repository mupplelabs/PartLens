from typing import Optional
from fastapi import APIRouter, HTTPException
from app.config import AutoLabelRequest, AutoLabelResponse, SaveSampleRequest
from app.services.llm_service import (
    run_autolabel_inference,
    query_local_models,
    query_gemini_models
)
from app.services.dataset_service import save_sample, recommend_split

router = APIRouter(prefix="/api", tags=["autolabel"])

@router.post("/auto-label", response_model=AutoLabelResponse)
@router.post("/autolabel", response_model=AutoLabelResponse)
async def autolabel_endpoint(req: AutoLabelRequest):
    try:
        resp = await run_autolabel_inference(req)
        classes = [c.label for c in resp.components]
        part_markings = [c.part_marking for c in resp.components if c.part_marking]
        suggested_split, reason, code, params = recommend_split(classes, part_markings)
        resp.suggested_split = suggested_split
        resp.suggested_split_reason = reason
        resp.suggested_split_code = code
        resp.suggested_split_params = params
        return resp
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save-sample")
async def save_sample_legacy_endpoint(req: SaveSampleRequest):
    try:
        return save_sample(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/local-models")
async def local_models_endpoint(provider: str = 'openai', url: Optional[str] = None, api_key: Optional[str] = None):
    return await query_local_models(provider=provider, url=url, api_key=api_key)

@router.get("/gemini-models")
async def gemini_models_endpoint(api_key: Optional[str] = None):
    return await query_gemini_models(api_key=api_key)
