from __future__ import annotations

from .models import Dialog, PromptConfig


def build_prompt(dialog: Dialog, prompt: PromptConfig) -> str:
    rules_text = "\n".join(f"- {rule}" for rule in prompt.rules)
    dialog_text = "\n".join(_format_message(msg.sender, msg.text) for msg in dialog.messages if msg.text)

    return (
        f"{prompt.system_instruction}\n\n"
        f"Rules:\n{rules_text}\n\n"
        f"Dialog:\n{dialog_text}\n\n"
        f"{prompt.output_instruction}"
    ).strip()


def _format_message(sender: str | None, text: str) -> str:
    speaker = sender if sender else "UNK"
    cleaned = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return f"[{speaker}] {cleaned}"
