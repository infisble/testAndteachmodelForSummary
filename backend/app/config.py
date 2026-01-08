from __future__ import annotations

import json
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BESCO_", env_file=".env", extra="ignore")

    app_name: str = "Bescosial Model Tester"
    model_provider: str = "mock"  # mock | vertex

    vertex_project_id: str | None = None
    vertex_location: str = "us-central1"
    vertex_endpoint_id: str | None = None
    vertex_instance_template: str = '{"prompt": "{prompt}"}'
    vertex_parameters_template: str = '{"temperature": 0.2, "maxOutputTokens": 512}'
    request_timeout_sec: int = 60

    cors_origins: str = "http://localhost:5173"

    mock_reply: str = "Routine exchange"

    def parse_json_template(self, value: str) -> dict[str, Any]:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON template: {exc}")
        if not isinstance(parsed, dict):
            raise ValueError("Template must be a JSON object")
        return parsed


settings = Settings()
