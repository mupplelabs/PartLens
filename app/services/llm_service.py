import time
import json
import re
import httpx
from typing import Optional
from app.config import (
    CLASS_NAMES,
    DetectedComponent,
    AutoLabelRequest,
    AutoLabelResponse,
    get_api_key_for_provider,
    load_llm_config
)
from app.services.dataset_service import parse_image_base64

def build_gemini_schema(detect_footprint: bool = True, detect_part_marking: bool = True, detect_ic_subgroup: bool = True) -> dict:
    item_props = {
        "label": {
            "type": "STRING",
            "enum": CLASS_NAMES,
            "description": "Component class category"
        },
        "ymin": {"type": "NUMBER", "description": "Normalized top coordinate [0.0 - 1.0]"},
        "xmin": {"type": "NUMBER", "description": "Normalized left coordinate [0.0 - 1.0]"},
        "ymax": {"type": "NUMBER", "description": "Normalized bottom coordinate [0.0 - 1.0]"},
        "xmax": {"type": "NUMBER", "description": "Normalized right coordinate [0.0 - 1.0]"},
        "confidence": {"type": "NUMBER", "description": "Confidence score [0.0 - 1.0]"}
    }
    required = ["label", "ymin", "xmin", "ymax", "xmax"]

    if detect_part_marking:
        item_props["part_marking"] = {
            "type": "STRING",
            "description": "Clearly legible printed text/marking on the component (e.g. 'NE555P', '2N2222', '104')"
        }
    if detect_footprint:
        item_props["footprint"] = {
            "type": "STRING",
            "description": "Electronic package/footprint if identifiable by shape and pins, e.g. 'DIP-8', 'TO-92', '0805'"
        }
    if detect_ic_subgroup:
        item_props["ic_subgroup"] = {
            "type": "STRING",
            "enum": ["analog", "logic", "mcu", "special"],
            "description": "Functional IC subtype"
        }

    return {
        "type": "OBJECT",
        "properties": {
            "components": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": item_props,
                    "required": required
                }
            }
        },
        "required": ["components"]
    }

CURATED_GEMINI_MODELS = [
    {
        "id": "gemini-2.0-flash",
        "display_name": "2.0 Flash",
        "description": "Standard & Schnell (Empfohlen)"
    },
    {
        "id": "gemini-3.8-flash",
        "display_name": "3.8 Flash",
        "description": "Vielseitige Unterstützung"
    },
    {
        "id": "gemini-3.5-flash-lite",
        "display_name": "3.5 Flash-Lite",
        "description": "Schnellste Antworten"
    },
    {
        "id": "gemini-3.1-pro",
        "display_name": "3.1 Pro",
        "description": "Logisches Schlussfolgern"
    },
    {
        "id": "gemini-4-argon",
        "display_name": "4 Argon",
        "description": "Komplexe Aufgaben"
    },
    {
        "id": "gemini-1.5-pro",
        "display_name": "1.5 Pro",
        "description": "Hohe Erkennungsgenauigkeit"
    },
    {
        "id": "gemini-1.5-flash",
        "display_name": "1.5 Flash",
        "description": "Klassisch & Sparsam"
    },
    {
        "id": "gemini-1.5-flash-8b",
        "display_name": "1.5 Flash-8B",
        "description": "Ultraleicht"
    }
]

def build_autolabel_prompt(
    detect_footprint: bool = True,
    detect_part_marking: bool = True,
    detect_ic_subgroup: bool = True,
    custom_prompt: Optional[str] = None
) -> str:
    instructions = [
        "You are an expert electronics engineer and computer vision annotator.",
        "Locate every single electronic component (resistor, capacitor, inductor, diode, led, transistor, ic, potentiometer, switch_button, relay, connector, display, board) visible in this photo.",
        f"For each component, return its precise normalized bounding box [ymin, xmin, ymax, xmax] from 0.0 to 1.0, and its correct class label from the allowed list: {CLASS_NAMES}."
    ]

    if detect_part_marking:
        instructions.append("Carefully read and transcribe any printed text, laser engraving, or code on the component as 'part_marking'. Omit if unreadable.")
    if detect_footprint:
        instructions.append("Identify the physical package/footprint ('footprint') by counting pins and recognizing standard package shapes (e.g. DIP-8, TO-92, SOIC-8, 0805).")
    if detect_ic_subgroup:
        instructions.append("If a component is an IC, classify its functional subgroup into 'analog', 'logic', 'mcu', or 'special'.")

    instructions.append("Be thorough: find every component even if rotated or partially in shadow.")
    instructions.append("Output strictly valid, raw JSON with a single root object containing the 'components' array. Do not include markdown codeblocks, conversational text, explanations, or any characters outside the JSON object.")
    if custom_prompt:
        instructions.append(f"Additional instruction: {custom_prompt}")

    return " ".join(instructions)

def extract_json_data(text: str) -> dict:
    if not text or not str(text).strip():
        return {}
    clean = str(text).strip()
    if "```" in clean:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", clean)
        if m:
            clean = m.group(1).strip()
    try:
        return json.loads(clean)
    except Exception:
        pass
    b = clean.find("{")
    k = clean.find("[")
    idx = -1
    if b != -1 and k != -1:
        idx = min(b, k)
    elif b != -1:
        idx = b
    elif k != -1:
        idx = k
    if idx != -1:
        try:
            obj, _ = json.JSONDecoder().raw_decode(clean[idx:])
            return obj if isinstance(obj, (dict, list)) else {}
        except Exception:
            pass
    m = re.search(r"(\{[\s\S]*\})", clean)
    if m:
        cand = m.group(1)
        for end in range(len(cand), 1, -1):
            if cand[end - 1] == '}':
                try:
                    return json.loads(cand[:end])
                except Exception:
                    continue
    return {}

async def run_autolabel_inference(req: AutoLabelRequest) -> AutoLabelResponse:
    t0 = time.time()
    cfg = load_llm_config()
    provider = req.provider or cfg.get("default_provider") or "gemini"
    raw_bytes, media_type, b64_str = parse_image_base64(req.image_base64)

    prompt = build_autolabel_prompt(
        detect_footprint=bool(req.detect_footprint),
        detect_part_marking=bool(req.detect_part_marking),
        detect_ic_subgroup=bool(req.detect_ic_subgroup),
        custom_prompt=req.custom_prompt
    )

    detected_components = []
    model_used = ""

    if provider == 'gemini':
        api_key = req.api_key or get_api_key_for_provider("gemini")
        if not api_key:
            raise ValueError("Kein Gemini API-Key auf dem Server hinterlegt. Bitte unter Einstellungen konfigurieren.")

        model_name = req.model_name or cfg.get("default_model") or 'gemini-2.0-flash'
        model_used = f"google:{model_name}"

        gemini_schema = build_gemini_schema(
            detect_footprint=bool(req.detect_footprint),
            detect_part_marking=bool(req.detect_part_marking),
            detect_ic_subgroup=bool(req.detect_ic_subgroup)
        )

        async def _call_generate_content(m_name: str) -> list:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m_name}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": media_type,
                                    "data": b64_str
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "response_mime_type": "application/json",
                    "response_schema": gemini_schema,
                    "temperature": 0.1
                }
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code != 200:
                    print(f"\n[DEBUG GEMINI generateContent ERROR]\nStatus: {resp.status_code}\nResponse: {resp.text}\n", flush=True)
                    raise RuntimeError(f"Gemini API Fehler ({resp.status_code}): {resp.text}")
                result_json = resp.json()
                print(f"\n========== [DEBUG GEMINI generateContent RESPONSE] ==========", flush=True)
                print(f"Modell: {m_name} (Status: {resp.status_code})", flush=True)
                print(f"Raw Response JSON:\n{json.dumps(result_json, indent=2, ensure_ascii=False)}", flush=True)

                candidates = result_json.get("candidates", [])
                if not candidates:
                    print("[DEBUG GEMINI] Keine 'candidates' in der Antwort vorhanden!", flush=True)
                    return []
                cand0 = candidates[0]
                finish_reason = cand0.get("finishReason", "UNKNOWN")
                print(f"[DEBUG GEMINI] finishReason: {finish_reason}", flush=True)

                parts = cand0.get("content", {}).get("parts", [])
                candidate = "".join([p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p])
                print(f"[DEBUG GEMINI] Zusammengesetzter Text ({len(candidate)} Zeichen):\n{candidate}", flush=True)

                data = extract_json_data(candidate)
                comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                print(f"[DEBUG GEMINI] Extrahierte Komponenten ({len(comps)}):\n{comps}", flush=True)
                print(f"=============================================================\n", flush=True)
                return comps

        async def _call_interactions_api(m_name: str) -> list:
            interact_url = f"https://generativelanguage.googleapis.com/v1beta/interactions?key={api_key}"
            interact_payload = {
                "model": m_name,
                "input": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image",
                        "mime_type": media_type,
                        "data": b64_str
                    }
                ]
            }
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(interact_url, json=interact_payload)
                if resp.status_code != 200:
                    print(f"\n[DEBUG GEMINI interactions ERROR]\nStatus: {resp.status_code}\nResponse: {resp.text}\n", flush=True)
                    raise RuntimeError(f"Gemini Interactions API Fehler ({resp.status_code}): {resp.text}")
                result_json = resp.json()
                print(f"\n========== [DEBUG GEMINI interactions RESPONSE] ==========", flush=True)
                print(f"Modell: {m_name} (Status: {resp.status_code})", flush=True)
                print(f"Raw Response JSON:\n{json.dumps(result_json, indent=2, ensure_ascii=False)}", flush=True)

                raw_text = ""
                for step in result_json.get("steps", []):
                    if step.get("type") == "model_output":
                        for part in step.get("content", []):
                            if isinstance(part, dict) and "text" in part:
                                raw_text += part["text"]
                print(f"[DEBUG GEMINI] Interactions Text ({len(raw_text)} Zeichen):\n{raw_text}", flush=True)
                if not raw_text:
                    raise RuntimeError("Keine Textausgabe in der Interactions API Antwort erhalten.")
                data = extract_json_data(raw_text)
                comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                print(f"[DEBUG GEMINI] Extrahierte Komponenten ({len(comps)}):\n{comps}", flush=True)
                print(f"==========================================================\n", flush=True)
                return comps

        is_interactions_model = any(k in model_name.lower() for k in ["3.", "4", "argon", "deep-research"])
        comps = []

        if is_interactions_model:
            try:
                comps = await _call_interactions_api(model_name)
            except Exception as e_inter:
                # Automatischer Fallback auf stabiles Standardmodell
                try:
                    comps = await _call_generate_content('gemini-2.0-flash')
                    model_used = "google:gemini-2.0-flash (Fallback)"
                except Exception:
                    raise e_inter
        else:
            try:
                comps = await _call_generate_content(model_name)
            except Exception as e_gen:
                if "Interactions API" in str(e_gen):
                    try:
                        comps = await _call_interactions_api(model_name)
                    except Exception:
                        raise e_gen
                else:
                    raise e_gen

            for c in comps:
                detected_components.append(DetectedComponent(
                    label=c.get("label", "other"),
                    ymin=float(c.get("ymin", 0.0)),
                    xmin=float(c.get("xmin", 0.0)),
                    ymax=float(c.get("ymax", 1.0)),
                    xmax=float(c.get("xmax", 1.0)),
                    confidence=float(c.get("confidence", 0.95)),
                    part_marking=c.get("part_marking"),
                    footprint=c.get("footprint"),
                    ic_subgroup=c.get("ic_subgroup")
                ))

    elif provider in ('openai', 'lmstudio', 'ollama'):
        if provider in ('openai', 'lmstudio'):
            base_url = req.openai_url or req.lmstudio_url or cfg.get("openai_url") or 'http://host.docker.internal:1234/v1'
        else:
            base_url = req.ollama_url or cfg.get("ollama_url") or 'http://host.docker.internal:11434/v1'

        url = f"{base_url.rstrip('/')}/chat/completions"
        model_name = req.model_name or ("default" if provider == 'lmstudio' else "qwen2-vl-7b-instruct")
        api_key = req.api_key or get_api_key_for_provider(provider)
        headers = {
            "Content-Type": "application/json"
        }
        # Optionaler API-Key: Nur mitsenden, wenn konfiguriert
        if api_key and api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"

        sys_msg = (
            "You are a computer vision model specialized in electronic components. "
            f"Allowed classes: {CLASS_NAMES}. "
            "Output strictly valid JSON with key 'components' containing array of objects: "
            "[{\"label\": str, \"ymin\": float, \"xmin\": float, \"ymax\": float, \"xmax\": float, "
            "\"confidence\": float, \"part_marking\": str or null, \"footprint\": str or null, \"ic_subgroup\": str or null}]"
        )

        user_content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{media_type};base64,{b64_str}"}
            }
        ]

        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }

        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code != 200:
                raise RuntimeError(f"{provider.upper()} API Fehler ({resp.status_code}): {resp.text}")

            result_json = resp.json()
            raw_text = result_json["choices"][0]["message"]["content"]
            data = extract_json_data(raw_text)

            comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            for c in comps:
                detected_components.append(DetectedComponent(
                    label=c.get("label", "other"),
                    ymin=float(c.get("ymin", 0.0)),
                    xmin=float(c.get("xmin", 0.0)),
                    ymax=float(c.get("ymax", 1.0)),
                    xmax=float(c.get("xmax", 1.0)),
                    confidence=float(c.get("confidence", 0.85)),
                    part_marking=c.get("part_marking"),
                    footprint=c.get("footprint"),
                    ic_subgroup=c.get("ic_subgroup")
                ))
    else:
        raise ValueError(f"Unbekannter Provider: {provider}")

    latency_ms = int((time.time() - t0) * 1000)
    return AutoLabelResponse(
        components=detected_components,
        provider=provider,
        model=model_used,
        latency_ms=latency_ms
    )

async def query_local_models(provider: str = 'openai', url: Optional[str] = None, api_key: Optional[str] = None) -> dict:
    cfg = load_llm_config()
    default_url = cfg.get("ollama_url") if provider == 'ollama' else cfg.get("openai_url")
    target_url = url or default_url or ('http://host.docker.internal:11434/v1' if provider == 'ollama' else 'http://host.docker.internal:1234/v1')

    key = api_key or (get_api_key_for_provider("openai") if provider in ("openai", "lmstudio") else None)
    headers = {}
    if key and key.strip():
        headers["Authorization"] = f"Bearer {key.strip()}"

    candidates = [target_url]
    if "127.0.0.1" in target_url:
        candidates.append(target_url.replace("127.0.0.1", "host.docker.internal"))
        candidates.append(target_url.replace("127.0.0.1", "localhost"))
    elif "localhost" in target_url:
        candidates.append(target_url.replace("localhost", "host.docker.internal"))
        candidates.append(target_url.replace("localhost", "127.0.0.1"))

    last_err = ""
    for u in candidates:
        endpoint = f"{u.rstrip('/')}/models"
        try:
            async with httpx.AsyncClient(timeout=3.0, verify=False) as client:
                resp = await client.get(endpoint, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = [m.get("id") for m in data.get("data", []) if m.get("id")]
                    return {"success": True, "provider": provider, "url": u, "models": models}
                last_err = f"HTTP {resp.status_code}"
        except Exception as e:
            last_err = str(e)

    return {"success": False, "provider": provider, "url": target_url, "error": last_err, "models": []}

async def query_gemini_models(api_key: Optional[str] = None) -> dict:
    key = api_key or get_api_key_for_provider("gemini")
    if not key or not key.strip():
        return {"success": True, "models": CURATED_GEMINI_MODELS}

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={key.strip()}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                raw_models = data.get("models", [])
                api_model_ids = {m.get("name", "").replace("models/", "").lower() for m in raw_models}

                # Filtere anhand unserer kuratierten Whitelist vor (wie die offizielle Gemini App)
                matched_models = []
                for c in CURATED_GEMINI_MODELS:
                    cid = c["id"].lower()
                    clean_short = cid.replace("gemini-", "")
                    if cid in api_model_ids or any(cid in aid or clean_short in aid for aid in api_model_ids):
                        matched_models.append(c)

                # Falls der spezifische API-Key nicht alle Modelle meldet oder Whitelists abweichen,
                # bieten wir die kuratierte Standardpalette an
                result_models = matched_models if len(matched_models) >= 2 else CURATED_GEMINI_MODELS
                return {"success": True, "models": result_models}
            else:
                return {"success": True, "models": CURATED_GEMINI_MODELS}
    except Exception:
        return {"success": True, "models": CURATED_GEMINI_MODELS}
