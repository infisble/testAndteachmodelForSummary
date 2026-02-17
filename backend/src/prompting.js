"use strict";

function buildPrompt(dialog, prompt) {
  const rulesText = (prompt.rules || []).map((rule) => `- ${String(rule)}`).join("\n");
  const dialogLines = normalizeDialogLines(dialog.messages || []);
  const dialogText = dialogLines.join("\n");

  return [
    String(prompt.system_instruction || "").trim(),
    "",
    "Rules:",
    rulesText,
    "",
    "Dialog:",
    dialogText,
    "",
    String(prompt.output_instruction || "").trim()
  ]
    .join("\n")
    .trim();
}

function normalizeDialogLines(messages) {
  const lines = [];
  for (const raw of messages) {
    const sender = normalizeSender(raw?.sender);
    const text = cleanText(raw?.text);
    if (!text) {
      continue;
    }
    lines.push(`[${sender}] ${text}`);
  }
  return lines;
}

function normalizeSender(sender) {
  if (!sender) {
    return "UNK";
  }
  const text = String(sender).trim();
  if (!text) {
    return "UNK";
  }
  return text.toUpperCase();
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  buildPrompt
};
