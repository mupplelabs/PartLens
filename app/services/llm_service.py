import os
import sys
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

def is_llm_debug_enabled() -> bool:
    for arg in sys.argv:
        if arg in ("--debug", "--debug-llm", "--llm-debug", "-d"):
            return True
        if arg in ("--no-debug", "--no-debug-llm", "--no-llm-debug"):
            return False
        if arg.startswith("--debug="):
            val = arg.split("=", 1)[1].strip().lower()
            return val in ("1", "true", "yes", "on")
        if arg.startswith("--llm-debug="):
            val = arg.split("=", 1)[1].strip().lower()
            return val in ("1", "true", "yes", "on")

    env_val = os.environ.get("DEBUG_LLM") or os.environ.get("LLM_DEBUG") or os.environ.get("DEBUG")
    if env_val:
        return env_val.strip().lower() in ("1", "true", "yes", "on")

    return False

def debug_log(*args, **kwargs):
    if is_llm_debug_enabled():
        if "flush" not in kwargs:
            kwargs["flush"] = True
        print(*args, **kwargs)

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
        instructions.append("Carefully read and transcribe any printed text, laser engraving, or code on the component as 'part_marking' (e.g. 'LT1013CP', 'NE555P', '2N2222', '104'). Omit or leave empty if unreadable.")
    if detect_footprint:
        instructions.append("Identify the physical package/footprint ('footprint') by counting pins/leads and recognizing standard package shapes (e.g. 'DIP-8', 'DIP-14', 'DIP-16', 'SOIC-8', 'TO-92', 'TO-220', 'SOT-23', '0805', 'DO-35', 'DO-41', 'Radial-Elko').")
    if detect_ic_subgroup:
        instructions.append("If a component is an IC ('ic'), classify its functional subgroup ('ic_subgroup') into: 'analog' (Op-Amps, linear ICs, voltage regulators like LT1013, LM358, LM317), 'logic' (74xx, 40xx logic gates, shift registers), 'mcu' (microcontrollers like ATmega, PIC, ESP), or 'special' (drivers, RTC, interface chips).")

    instructions.append("Be thorough: find every component even if rotated, partially in shadow, or sitting on dark ESD foam.")
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

def parse_detected_component(c: dict, default_confidence: float = 0.95) -> Optional[DetectedComponent]:
    if not isinstance(c, dict):
        return None

    raw_label = str(c.get("label") or c.get("class") or c.get("name") or "other").strip().lower()
    label = raw_label
    if label not in CLASS_NAMES:
        matched = next((cls for cls in CLASS_NAMES if cls in label or label in cls), "other")
        label = matched

    b2d = c.get("box_2d") or c.get("box") or c.get("bbox")
    if isinstance(b2d, (list, tuple)) and len(b2d) == 4:
        try:
            y1, x1, y2, x2 = [float(v) for v in b2d]
            if y1 > 1.0 or x1 > 1.0 or y2 > 1.0 or x2 > 1.0:
                y1, x1, y2, x2 = y1 / 1000.0, x1 / 1000.0, y2 / 1000.0, x2 / 1000.0
            ymin, xmin, ymax, xmax = min(y1, y2), min(x1, x2), max(y1, y2), max(x1, x2)
        except Exception:
            ymin, xmin, ymax, xmax = 0.0, 0.0, 1.0, 1.0
    else:
        try:
            ymin = float(c.get("ymin") if c.get("ymin") is not None else (c.get("top") if c.get("top") is not None else c.get("y1", 0.0)))
            xmin = float(c.get("xmin") if c.get("xmin") is not None else (c.get("left") if c.get("left") is not None else c.get("x1", 0.0)))
            ymax = float(c.get("ymax") if c.get("ymax") is not None else (c.get("bottom") if c.get("bottom") is not None else c.get("y2", 1.0)))
            xmax = float(c.get("xmax") if c.get("xmax") is not None else (c.get("right") if c.get("right") is not None else c.get("x2", 1.0)))
            if ymax > 1.0 or xmax > 1.0 or ymin > 1.0 or xmin > 1.0:
                ymin, xmin, ymax, xmax = ymin / 1000.0, xmin / 1000.0, ymax / 1000.0, xmax / 1000.0
        except Exception:
            ymin, xmin, ymax, xmax = 0.0, 0.0, 1.0, 1.0

    ymin = max(0.0, min(1.0, ymin))
    xmin = max(0.0, min(1.0, xmin))
    ymax = max(0.0, min(1.0, ymax))
    xmax = max(0.0, min(1.0, xmax))

    if (ymax - ymin) <= 0.005 or (xmax - xmin) <= 0.005:
        return None

    confidence = float(c.get("confidence", default_confidence))
    part_marking = c.get("part_marking") or c.get("marking") or c.get("text")
    footprint = c.get("footprint") or c.get("package")
    ic_subgroup = c.get("ic_subgroup") or c.get("functional_group") or c.get("subgroup")

    return DetectedComponent(
        label=label,
        ymin=round(ymin, 4),
        xmin=round(xmin, 4),
        ymax=round(ymax, 4),
        xmax=round(xmax, 4),
        confidence=round(confidence, 3),
        part_marking=str(part_marking).strip() if part_marking else None,
        footprint=str(footprint).strip() if footprint else None,
        ic_subgroup=str(ic_subgroup).strip() if ic_subgroup else None
    )

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

        gemini_prompt = prompt + " Output strictly valid, raw JSON with a single root object containing the 'components' array. Do not include markdown codeblocks, conversational text, explanations, or any characters outside the JSON object."

        async def _call_generate_content(m_name: str) -> list:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m_name}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": gemini_prompt},
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
            debug_log(f"\n========== [DEBUG GEMINI REQUEST] ==========")
            debug_log(f"Modell: {m_name} | API: generateContent")
            debug_log(f"Endpoint: {url.split('?')[0]}")
            debug_log(f"Prompt ({len(gemini_prompt)} Zeichen):\n{gemini_prompt}")
            debug_log(f"============================================\n")

            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code != 200:
                    debug_log(f"\n[DEBUG GEMINI generateContent ERROR]\nStatus: {resp.status_code}\nResponse: {resp.text}\n")
                    raise RuntimeError(f"Gemini API Fehler ({resp.status_code}): {resp.text}")
                result_json = resp.json()
                debug_log(f"\n========== [DEBUG GEMINI generateContent RESPONSE] ==========")
                debug_log(f"Modell: {m_name} (Status: {resp.status_code})")
                debug_log(f"Raw Response JSON:\n{json.dumps(result_json, indent=2, ensure_ascii=False)}")

                candidates = result_json.get("candidates", [])
                if not candidates:
                    debug_log("[DEBUG GEMINI] Keine 'candidates' in der Antwort vorhanden!")
                    return []
                cand0 = candidates[0]
                finish_reason = cand0.get("finishReason", "UNKNOWN")
                debug_log(f"[DEBUG GEMINI] finishReason: {finish_reason}")

                parts = cand0.get("content", {}).get("parts", [])
                candidate = "".join([p.get("text", "") for p in parts if isinstance(p, dict) and "text" in p])
                debug_log(f"[DEBUG GEMINI] Zusammengesetzter Text ({len(candidate)} Zeichen):\n{candidate}")

                data = extract_json_data(candidate)
                comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                debug_log(f"[DEBUG GEMINI] Extrahierte Komponenten ({len(comps)}):\n{comps}")
                debug_log(f"=============================================================\n")
                return comps

        async def _call_interactions_api(m_name: str) -> list:
            interact_url = f"https://generativelanguage.googleapis.com/v1beta/interactions?key={api_key}"
            interact_payload = {
                "model": m_name,
                "input": [
                    {"type": "text", "text": gemini_prompt},
                    {
                        "type": "image",
                        "mime_type": media_type,
                        "data": b64_str
                    }
                ]
            }
            debug_log(f"\n========== [DEBUG GEMINI REQUEST] ==========")
            debug_log(f"Modell: {m_name} | API: Interactions API")
            debug_log(f"Endpoint: {interact_url.split('?')[0]}")
            debug_log(f"Prompt ({len(gemini_prompt)} Zeichen):\n{gemini_prompt}")
            debug_log(f"============================================\n")

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(interact_url, json=interact_payload)
                if resp.status_code != 200:
                    debug_log(f"\n[DEBUG GEMINI interactions ERROR]\nStatus: {resp.status_code}\nResponse: {resp.text}\n")
                    raise RuntimeError(f"Gemini Interactions API Fehler ({resp.status_code}): {resp.text}")
                result_json = resp.json()
                debug_log(f"\n========== [DEBUG GEMINI interactions RESPONSE] ==========")
                debug_log(f"Modell: {m_name} (Status: {resp.status_code})")
                debug_log(f"Raw Response JSON:\n{json.dumps(result_json, indent=2, ensure_ascii=False)}")

                raw_text = ""
                for step in result_json.get("steps", []):
                    if step.get("type") == "model_output":
                        for part in step.get("content", []):
                            if isinstance(part, dict) and "text" in part:
                                raw_text += part["text"]
                debug_log(f"[DEBUG GEMINI] Interactions Text ({len(raw_text)} Zeichen):\n{raw_text}")
                if not raw_text:
                    raise RuntimeError("Keine Textausgabe in der Interactions API Antwort erhalten.")
                data = extract_json_data(raw_text)
                comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
                debug_log(f"[DEBUG GEMINI] Extrahierte Komponenten ({len(comps)}):\n{comps}")
                debug_log(f"==========================================================\n")
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
            parsed_comp = parse_detected_component(c, default_confidence=0.95)
            if parsed_comp:
                detected_components.append(parsed_comp)

        debug_log(f"[DEBUG GEMINI] Final geparste Komponenten ({len(detected_components)}):\n{[c.model_dump() for c in detected_components]}")
        debug_log(f"==========================================================\n")

    elif provider in ('openai', 'lmstudio', 'ollama'):
        if provider in ('openai', 'lmstudio'):
            default_port = 1234
            default_def_model = 'Qwen2.5-VL-7B-Instruct-4bit'
            configured_url = req.openai_url or req.lmstudio_url or cfg.get("openai_url") or cfg.get("lmstudio_url") or 'http://localhost:1234/v1'
        else:
            default_port = 11434
            default_def_model = 'qwen2-vl'
            configured_url = req.ollama_url or cfg.get("ollama_url") or 'http://localhost:11434/v1'

        model_name = req.model_name or default_def_model
        model_used = f"{provider}:{model_name}"
        api_key = req.api_key or get_api_key_for_provider(provider)
        headers = {
            "Content-Type": "application/json"
        }
        if api_key and api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"

        schema_dict = {
            "type": "object",
            "properties": {
                "components": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "enum": CLASS_NAMES, "description": "Component category"},
                            "ymin": {"type": "number", "description": "Normalized top edge [0.0 - 1.0]"},
                            "xmin": {"type": "number", "description": "Normalized left edge [0.0 - 1.0]"},
                            "ymax": {"type": "number", "description": "Normalized bottom edge [0.0 - 1.0]"},
                            "xmax": {"type": "number", "description": "Normalized right edge [0.0 - 1.0]"},
                            "confidence": {"type": "number", "description": "Confidence score [0.0 - 1.0]"},
                            "part_marking": {"type": ["string", "null"], "description": "Printed marking or laser text on component"},
                            "footprint": {"type": ["string", "null"], "description": "Physical package/footprint (e.g. DIP-8, SOIC-8)"},
                            "ic_subgroup": {"type": ["string", "null"], "description": "IC functional subgroup: analog, logic, mcu, special"}
                        },
                        "required": ["label", "ymin", "xmin", "ymax", "xmax"]
                    }
                }
            },
            "required": ["components"]
        }

        example_comp = {
            "label": "ic",
            "ymin": 0.12,
            "xmin": 0.34,
            "ymax": 0.28,
            "xmax": 0.52,
            "confidence": 0.98
        }
        if req.detect_part_marking:
            example_comp["part_marking"] = "LT1013CP"
        if req.detect_footprint:
            example_comp["footprint"] = "DIP-8"
        if req.detect_ic_subgroup:
            example_comp["ic_subgroup"] = "analog"
        example_str = json.dumps({"components": [example_comp]})

        messages = [
            {
                "role": "system",
                "content": "You are an expert electronics annotator. Always output pure valid JSON matching the requested schema."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt + f"\nOutput strictly JSON matching this format: {example_str}"
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{b64_str}"}
                    }
                ]
            }
        ]

        target_url = configured_url
        candidates = [target_url]
        if "host.docker.internal" in target_url:
            candidates.append(target_url.replace("host.docker.internal", "127.0.0.1"))
            candidates.append(target_url.replace("host.docker.internal", "localhost"))
        elif "127.0.0.1" in target_url:
            candidates.append(target_url.replace("127.0.0.1", "host.docker.internal"))
            candidates.append(target_url.replace("127.0.0.1", "localhost"))
        elif "localhost" in target_url:
            candidates.append(target_url.replace("localhost", "127.0.0.1"))
            candidates.append(target_url.replace("localhost", "host.docker.internal"))

        body = {
            "model": model_name,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "AutoLabelResult", "schema": schema_dict}
            },
            "temperature": 0.2
        }

        debug_log(f"\n========== [DEBUG {provider.upper()} REQUEST] ==========")
        debug_log(f"Provider: {provider} | Modell: {model_name}")
        debug_log(f"Target URL: {target_url} (Kandidaten: {candidates})")
        debug_log(f"System Message: {messages[0]['content']}")
        debug_log(f"User Prompt ({len(prompt)} Zeichen):\n{prompt}")
        debug_log(f"Format Example: {example_str}")
        debug_log(f"========================================================\n")

        resp = None
        result_json = None
        used_endpoint = None
        last_resp_err = ""

        async with httpx.AsyncClient(timeout=120.0, verify=False) as client:
            for cand_base in candidates:
                endpoint = f"{cand_base.rstrip('/')}/chat/completions"
                used_endpoint = endpoint
                try:
                    resp = await client.post(endpoint, json=body, headers=headers)
                    if resp.status_code == 200:
                        break

                    # Fallback falls Server/Modell kein json_schema unterstützt (oft HTTP 400)
                    resp_text = resp.text
                    if resp.status_code == 400:
                        debug_log(f"[DEBUG {provider.upper()}] json_schema nicht unterstützt ({resp.status_code}): {resp_text[:120]}. Versuche Fallback...")
                        body_fb = dict(body)
                        body_fb["response_format"] = {"type": "json_object"}
                        resp = await client.post(endpoint, json=body_fb, headers=headers)
                        if resp.status_code == 200:
                            break
                        body_fb.pop("response_format", None)
                        resp = await client.post(endpoint, json=body_fb, headers=headers)
                        if resp.status_code == 200:
                            break

                    last_resp_err = f"HTTP {resp.status_code}: {resp.text}"
                except Exception as cand_err:
                    last_resp_err = str(cand_err)
                    continue

            if not resp or resp.status_code != 200:
                debug_log(f"\n[DEBUG {provider.upper()} ERROR]\nEndpoint: {used_endpoint}\nError: {last_resp_err}\n")
                raise RuntimeError(f"{provider.upper()} API Fehler an {used_endpoint}: {last_resp_err}")

            result_json = resp.json()
            raw_text = ""
            choices = result_json.get("choices", [])
            if choices:
                raw_text = choices[0].get("message", {}).get("content", "") or ""

            debug_log(f"\n========== [DEBUG {provider.upper()} RESPONSE] ==========")
            debug_log(f"Provider: {provider} | Modell: {model_name} (Status: {resp.status_code})")
            debug_log(f"Raw Response JSON:\n{json.dumps(result_json, indent=2, ensure_ascii=False) if isinstance(result_json, dict) else result_json}")
            debug_log(f"Content Text ({len(raw_text)} Zeichen):\n{raw_text}")

            data = extract_json_data(raw_text)
            comps = data.get("components", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
            debug_log(f"[DEBUG {provider.upper()}] Extrahierte Komponenten ({len(comps)}):\n{comps}")

            for c in comps:
                parsed_comp = parse_detected_component(c, default_confidence=0.85)
                if parsed_comp:
                    detected_components.append(parsed_comp)

            debug_log(f"[DEBUG {provider.upper()}] Final geparste Komponenten ({len(detected_components)}):\n{[c.model_dump() for c in detected_components]}")
            debug_log(f"========================================================\n")
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
