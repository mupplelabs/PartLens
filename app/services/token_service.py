import os
import json
import time
from typing import Optional
from app.config import CONFIG_DIR

TOKEN_USAGE_FILE = CONFIG_DIR / "token_usage.json"

def _default_stats() -> dict:
    return {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_requests": 0,
        "last_updated": int(time.time()),
        "by_model": {},
        "by_provider": {},
        "recent_calls": []
    }

def get_token_stats() -> dict:
    if not TOKEN_USAGE_FILE.exists():
        return _default_stats()
    try:
        data = json.loads(TOKEN_USAGE_FILE.read_text(encoding="utf-8"))
        # Ensure all expected top-level keys exist
        default = _default_stats()
        for k, v in default.items():
            if k not in data:
                data[k] = v
        return data
    except Exception as e:
        print(f"Warning: could not read token_usage.json: {e}", flush=True)
        return _default_stats()

def save_token_stats(stats: dict) -> None:
    try:
        stats["last_updated"] = int(time.time())
        TOKEN_USAGE_FILE.write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print(f"Error saving token_usage.json: {e}", flush=True)

def record_token_usage(
    provider: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: int = 0
) -> dict:
    stats = get_token_stats()
    p_tokens = max(0, int(prompt_tokens or 0))
    c_tokens = max(0, int(completion_tokens or 0))
    t_tokens = p_tokens + c_tokens

    clean_prov = (provider or "unknown").strip().lower()
    clean_mod = (model or "unknown").replace("google:", "").replace("openai:", "").replace("ollama:", "").replace("lmstudio:", "").strip()

    stats["total_tokens"] += t_tokens
    stats["prompt_tokens"] += p_tokens
    stats["completion_tokens"] += c_tokens
    stats["total_requests"] += 1

    # By Model
    by_model = stats.setdefault("by_model", {})
    if clean_mod not in by_model:
        by_model[clean_mod] = {
            "total_tokens": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "requests": 0,
            "last_used": int(time.time()),
            "provider": clean_prov
        }
    m_entry = by_model[clean_mod]
    m_entry["total_tokens"] += t_tokens
    m_entry["prompt_tokens"] += p_tokens
    m_entry["completion_tokens"] += c_tokens
    m_entry["requests"] += 1
    m_entry["last_used"] = int(time.time())
    m_entry["provider"] = clean_prov

    # By Provider
    by_prov = stats.setdefault("by_provider", {})
    if clean_prov not in by_prov:
        by_prov[clean_prov] = {
            "total_tokens": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "requests": 0
        }
    p_entry = by_prov[clean_prov]
    p_entry["total_tokens"] += t_tokens
    p_entry["prompt_tokens"] += p_tokens
    p_entry["completion_tokens"] += c_tokens
    p_entry["requests"] += 1

    # Recent Calls (Keep last 15)
    recent = stats.setdefault("recent_calls", [])
    recent.insert(0, {
        "timestamp": int(time.time()),
        "provider": clean_prov,
        "model": clean_mod,
        "prompt_tokens": p_tokens,
        "completion_tokens": c_tokens,
        "total_tokens": t_tokens,
        "latency_ms": latency_ms
    })
    stats["recent_calls"] = recent[:15]

    save_token_stats(stats)
    return stats

def reset_token_stats() -> dict:
    fresh = _default_stats()
    save_token_stats(fresh)
    return fresh
