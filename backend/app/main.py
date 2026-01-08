from __future__ import annotations

from typing import Any

import orjson
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import (
    BatchSummarizeRequest,
    BatchSummarizeResponse,
    BatchSummarizeResponseItem,
    ParseResponse,
    SummarizeRequest,
    SummarizeResponse,
)
from .parsing import load_dialogs
from .prompting import build_prompt
from .vertex import VertexClient

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

vertex_client = VertexClient(settings)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "provider": settings.model_provider}


@app.post("/api/parse", response_model=ParseResponse)
async def parse_dialogs(file: UploadFile = File(...)) -> ParseResponse:
    try:
        raw = await file.read()
        payload = orjson.loads(raw)
        dialogs = load_dialogs(payload)
        return ParseResponse(dialogs=dialogs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to parse JSON: {exc}") from exc


@app.post("/api/summarize", response_model=SummarizeResponse)
async def summarize(request: SummarizeRequest) -> SummarizeResponse:
    prompt = build_prompt(request.dialog, request.prompt)
    provider = (request.model.provider if request.model and request.model.provider else settings.model_provider).lower()

    if provider == "mock":
        latency_ms = 0
        return SummarizeResponse(summary=_mock_summary(prompt), latency_ms=latency_ms, provider="mock")

    if provider != "vertex":
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    overrides = _build_overrides(request)

    try:
        summary, latency_ms = vertex_client.predict(prompt, overrides)
        return SummarizeResponse(summary=summary, latency_ms=latency_ms, provider="vertex")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/summarize-batch", response_model=BatchSummarizeResponse)
async def summarize_batch(request: BatchSummarizeRequest) -> BatchSummarizeResponse:
    provider = (request.model.provider if request.model and request.model.provider else settings.model_provider).lower()
    overrides = _build_overrides(request)

    items: list[BatchSummarizeResponseItem] = []

    for dialog in request.dialogs:
        prompt = build_prompt(dialog, request.prompt)

        if provider == "mock":
            summary = _mock_summary(prompt)
            latency_ms = 0
        elif provider == "vertex":
            summary, latency_ms = vertex_client.predict(prompt, overrides)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

        items.append(
            BatchSummarizeResponseItem(
                dialog_id=dialog.dialog_id,
                summary=summary,
                latency_ms=latency_ms,
                provider=provider,
            )
        )

    return BatchSummarizeResponse(items=items)


def _mock_summary(prompt: str) -> str:
    if "Routine exchange" in prompt:
        return "Routine exchange"
    return settings.mock_reply


def _build_overrides(request: SummarizeRequest | BatchSummarizeRequest) -> dict[str, Any]:
    overrides: dict[str, Any] = {}

    if request.model:
        if request.model.project_id:
            overrides["project_id"] = request.model.project_id
        if request.model.location:
            overrides["location"] = request.model.location
        if request.model.endpoint_id:
            overrides["endpoint_id"] = request.model.endpoint_id
        if request.model.instance_template:
            overrides["instance_template"] = request.model.instance_template
        if request.model.parameters_template:
            overrides["parameters_template"] = request.model.parameters_template

    if request.parameters:
        if request.model and request.model.parameters_template is not None:
            base = dict(request.model.parameters_template)
        else:
            base = settings.parse_json_template(settings.vertex_parameters_template)
        base.update(request.parameters)
        overrides["parameters_template"] = base

    return overrides
