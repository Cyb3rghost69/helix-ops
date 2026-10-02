"""OpenAI provider for ADZE. No orchestration, no dashboard, no key logging."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

OPENAI_URL = "https://api.openai.com/v1/chat/completions"


class AdzeProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def openai_configured() -> bool:
    return bool((os.environ.get("OPENAI_API_KEY") or "").strip())


def adze_model() -> str:
    return (os.environ.get("ADZE_MODEL") or "gpt-4o").strip() or "gpt-4o"


def complete(messages: list[dict], *, timeout: float = 60, max_tokens: int = 2500) -> dict:
    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise AdzeProviderError("offline", "OPENAI PROVIDER UNAVAILABLE")
    body = json.dumps(
        {
            "model": adze_model(),
            "messages": messages,
            "max_tokens": int(max_tokens),
            "temperature": 0.3,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        OPENAI_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise AdzeProviderError("http", f"openai http {e.code}") from None
    except urllib.error.URLError:
        raise AdzeProviderError("offline", "OPENAI PROVIDER UNAVAILABLE") from None
    except TimeoutError:
        raise AdzeProviderError("timeout", "openai timeout") from None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise AdzeProviderError("malformed", "malformed provider response") from None
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise AdzeProviderError("malformed", "malformed provider response") from None
    usage = data.get("usage") or {}
    return {
        "text": text.strip(),
        "model": data.get("model") or adze_model(),
        "usage": {
            "prompt": usage.get("prompt_tokens"),
            "completion": usage.get("completion_tokens"),
            "total": usage.get("total_tokens"),
        },
    }
