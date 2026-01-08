from __future__ import annotations

import time
from typing import Any

from google.cloud import aiplatform_v1

from .config import Settings


class VertexClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def predict(self, prompt: str, overrides: dict[str, Any] | None = None) -> tuple[str, int]:
        start = time.time()

        config = _merge_overrides(self.settings, overrides or {})
        instance = _render_template(config.instance_template, prompt)
        parameters = _render_template(config.parameters_template, prompt)

        client = aiplatform_v1.PredictionServiceClient(
            client_options={"api_endpoint": f"{config.location}-aiplatform.googleapis.com"}
        )
        endpoint = client.endpoint_path(config.project_id, config.location, config.endpoint_id)

        response = client.predict(
            endpoint=endpoint,
            instances=[instance],
            parameters=parameters,
        )

        text = _extract_prediction_text(response.predictions)
        latency_ms = int((time.time() - start) * 1000)
        return text, latency_ms


def _merge_overrides(settings: Settings, overrides: dict[str, Any]) -> _ResolvedConfig:
    project_id = overrides.get("project_id") or settings.vertex_project_id
    endpoint_id = overrides.get("endpoint_id") or settings.vertex_endpoint_id
    location = overrides.get("location") or settings.vertex_location

    if not project_id or not endpoint_id:
        raise ValueError("Vertex project_id and endpoint_id are required")

    if "instance_template" in overrides:
        instance_template = overrides["instance_template"]
    else:
        instance_template = settings.parse_json_template(settings.vertex_instance_template)

    if "parameters_template" in overrides:
        parameters_template = overrides["parameters_template"]
    else:
        parameters_template = settings.parse_json_template(settings.vertex_parameters_template)

    return _ResolvedConfig(
        project_id=project_id,
        endpoint_id=endpoint_id,
        location=location,
        instance_template=instance_template,
        parameters_template=parameters_template,
    )


def _render_template(template: dict[str, Any], prompt: str) -> dict[str, Any]:
    def render(value: Any) -> Any:
        if isinstance(value, str):
            return value.replace("{prompt}", prompt)
        if isinstance(value, dict):
            return {key: render(val) for key, val in value.items()}
        if isinstance(value, list):
            return [render(item) for item in value]
        return value

    return render(template)


def _extract_prediction_text(predictions: Any) -> str:
    if not predictions:
        return ""

    first = predictions[0]
    if isinstance(first, str):
        return first

    if isinstance(first, dict):
        for key in ("content", "text", "output", "prediction", "generated_text", "response"):
            if key in first and isinstance(first[key], str):
                return first[key]
        if "candidates" in first and first["candidates"]:
            candidate = first["candidates"][0]
            if isinstance(candidate, dict):
                for key in ("content", "text", "output"):
                    if key in candidate and isinstance(candidate[key], str):
                        return candidate[key]
            if isinstance(candidate, str):
                return candidate

    return str(first)


class _ResolvedConfig:
    def __init__(
        self,
        project_id: str,
        endpoint_id: str,
        location: str,
        instance_template: dict[str, Any],
        parameters_template: dict[str, Any],
    ) -> None:
        self.project_id = project_id
        self.endpoint_id = endpoint_id
        self.location = location
        self.instance_template = instance_template
        self.parameters_template = parameters_template
