from __future__ import annotations
import time
from typing import Any
import requests
from .config import Settings
from .logging_utils import get_logger, to_log_json

logger = get_logger("app.gemini")


class GeminiClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def generate(self, prompt: str, overrides: dict[str, Any] | None = None) -> tuple[str, int]:
        start = time.time()
        config = _merge_overrides(self.settings, overrides or {})

        url = (
            f"{config.api_base.rstrip('/')}/{config.api_version}/models/"
            f"{config.model_name}:generateContent"
        )

        payload: dict[str, Any] = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ]
        }
        if config.parameters:
            payload["generationConfig"] = config.parameters

        headers: dict[str, str] = {}
        query_params: dict[str, str] = {}
        if config.access_token:
            headers["Authorization"] = f"Bearer {config.access_token}"
        elif config.api_key:
            query_params["key"] = config.api_key

        logger.info(
            "GEMINI REQUEST url=%s params=%s headers=%s payload=%s",
            url,
            to_log_json(query_params),
            to_log_json(headers),
            to_log_json(payload),
        )

        response = requests.post(
            url,
            params=query_params,
            headers=headers,
            json=payload,
            timeout=self.settings.request_timeout_sec,
        )
        logger.info(
            "GEMINI RESPONSE status=%s body=%s",
            response.status_code,
            to_log_json(_response_body(response)),
        )
        if not response.ok:
            raise RuntimeError(_format_error(response))

        data = response.json()
        text = _extract_text(data)
        latency_ms = int((time.time() - start) * 1000)
        return text, latency_ms


def _merge_overrides(settings: Settings, overrides: dict[str, Any]) -> _ResolvedGeminiConfig:
    api_key = overrides.get("api_key") or settings.gemini_api_key
    access_token = overrides.get("access_token") or settings.gemini_access_token
    model_name = overrides.get("model_name") or settings.gemini_model
    api_base = overrides.get("api_base") or settings.gemini_api_base
    api_version = overrides.get("api_version") or settings.gemini_api_version
    parameters = overrides.get("parameters_template")

    if not api_key and not access_token:
        raise ValueError("Gemini API key or OAuth access token is required")
    if not model_name:
        raise ValueError("Gemini model name is required")

    return _ResolvedGeminiConfig(
        api_key=api_key,
        access_token=access_token,
        model_name=model_name,
        api_base=api_base,
        api_version=api_version,
        parameters=parameters if isinstance(parameters, dict) else None,
    )


def _extract_text(data: dict[str, Any]) -> str:
    candidates = data.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        texts: list[str] = []
        for part in parts:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text)
        if texts:
            return "\n".join(texts)

    return ""


def _format_error(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = {"error": {"message": response.text}}
    error = payload.get("error", payload)
    if isinstance(error, dict):
        message = error.get("message") or str(error)
    else:
        message = str(error)
    return f"Gemini request failed ({response.status_code}): {message}"


def _response_body(response: requests.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return {"text": response.text}


class _ResolvedGeminiConfig:
    def __init__(
        self,
        api_key: str | None,
        access_token: str | None,
        model_name: str,
        api_base: str,
        api_version: str,
        parameters: dict[str, Any] | None,
    ) -> None:
        self.api_key = api_key
        self.access_token = access_token
        self.model_name = model_name
        self.api_base = api_base
        self.api_version = api_version
        self.parameters = parameters
