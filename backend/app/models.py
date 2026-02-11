from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Message(BaseModel):
    sender: str | None = None
    timestamp: str
    text: str


class Dialog(BaseModel):
    dialog_id: str
    ru_name: str | None = None
    tu_name: str | None = None
    ru_id: int | None = None
    tu_id: int | None = None
    messages: list[Message]


class PromptConfig(BaseModel):
    system_instruction: str
    rules: list[str]
    output_instruction: str


class ModelConfig(BaseModel):
    provider: str | None = None
    project_id: str | None = None
    location: str | None = None
    endpoint_id: str | None = None
    api_key: str | None = None
    access_token: str | None = None
    model_name: str | None = None
    api_base: str | None = None
    api_version: str | None = None
    instance_template: dict[str, Any] | None = None
    parameters_template: dict[str, Any] | None = None


class SummarizeRequest(BaseModel):
    dialog: Dialog
    prompt: PromptConfig
    parameters: dict[str, Any] | None = None
    model: ModelConfig | None = None


class SummarizeResponse(BaseModel):
    summary: str
    latency_ms: int
    provider: str


class ParseResponse(BaseModel):
    dialogs: list[Dialog]


class BatchSummarizeRequest(BaseModel):
    dialogs: list[Dialog]
    prompt: PromptConfig
    parameters: dict[str, Any] | None = None
    model: ModelConfig | None = None


class BatchSummarizeResponseItem(BaseModel):
    dialog_id: str
    summary: str
    latency_ms: int
    provider: str


class BatchSummarizeResponse(BaseModel):
    items: list[BatchSummarizeResponseItem]
