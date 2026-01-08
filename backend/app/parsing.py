from __future__ import annotations

from typing import Any

from .models import Dialog, Message


def _extract_timestamp_and_text(message: dict[str, Any]) -> tuple[str, str]:
    for key, value in message.items():
        if key in {"from", "sender"}:
            continue
        return key, str(value)
    return "", str(message.get("text") or message.get("message") or "")


def _convert_dialog(raw: dict[str, Any], index: int) -> Dialog:
    context = raw.get("context") or {}
    ru = context.get("RU") or {}
    tu = context.get("TU") or {}

    ru_id = _safe_int(ru.get("id"))
    tu_id = _safe_int(tu.get("id"))

    dialog_id = raw.get("dialog_id") or _build_dialog_id(ru_id, tu_id, index)

    messages: list[Message] = []
    for item in raw.get("messages") or []:
        if not isinstance(item, dict):
            continue
        sender = item.get("from") or item.get("sender")
        timestamp, text = _extract_timestamp_and_text(item)
        messages.append(Message(sender=sender, timestamp=timestamp, text=text))

    return Dialog(
        dialog_id=str(dialog_id),
        ru_name=_safe_str(ru.get("name")),
        tu_name=_safe_str(tu.get("name")),
        ru_id=ru_id,
        tu_id=tu_id,
        messages=messages,
    )


def _build_dialog_id(ru_id: int | None, tu_id: int | None, index: int) -> str:
    if ru_id is not None and tu_id is not None:
        return f"{ru_id}_{tu_id}_{index}"
    return str(index)


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def load_dialogs(payload: Any) -> list[Dialog]:
    if isinstance(payload, dict):
        if "messages" in payload:
            return [_convert_dialog(payload, 0)]
        if "dialogs" in payload and isinstance(payload["dialogs"], list):
            return [_convert_dialog(item, i) for i, item in enumerate(payload["dialogs"]) if isinstance(item, dict)]
        if "data" in payload and isinstance(payload["data"], list):
            return [_convert_dialog(item, i) for i, item in enumerate(payload["data"]) if isinstance(item, dict)]

    if isinstance(payload, list):
        return [_convert_dialog(item, i) for i, item in enumerate(payload) if isinstance(item, dict)]

    raise ValueError("Unsupported JSON format: expected a dialog object or list of dialogs")
