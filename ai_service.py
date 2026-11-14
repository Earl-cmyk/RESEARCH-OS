"""Centralized Gemini service: model selection, JSON output, retries, errors."""
import json
import os
import time

from google import genai
from google.genai import types

_client = None


def client():
    global _client
    if _client is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        _client = genai.Client(
            api_key=key,
            http_options=types.HttpOptions(
                timeout=30_000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )
    return _client


MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")
MAX_CHARS = 30000


def ask_json(system: str, user: str, retries: int = 3) -> dict:
    user = user[:MAX_CHARS]
    last = None
    for attempt in range(retries):
        try:
            response = client().models.generate_content(
                model=MODEL,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    temperature=0.3,
                ),
            )
            return json.loads(response.text)
        except Exception as e:  # rate limit / transient
            last = e
            if attempt + 1 < retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"AI request failed: {last}")
