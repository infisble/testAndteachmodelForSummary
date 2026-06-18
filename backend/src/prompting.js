"use strict";

const DEFAULT_MAX_MESSAGE_CHARS = 700;
const DEFAULT_MAX_MERGED_LINE_CHARS = 900;

function buildPrompt(dialog, prompt) {
  const maxMessageChars = clampPositiveInt(prompt?.max_message_chars, DEFAULT_MAX_MESSAGE_CHARS);
  const maxMergedLineChars = clampPositiveInt(prompt?.max_merged_line_chars, DEFAULT_MAX_MERGED_LINE_CHARS);
  const rulesText = (prompt.rules || []).map((rule) => `- ${String(rule)}`).join("\n");
  const dialogLines = normalizeDialogLines(dialog.messages || [], {
    maxMessageChars,
    maxMergedLineChars
  });
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

function normalizeDialogLines(messages, options) {
  const lines = [];
  let activeSender = "";
  let activeParts = [];
  let activeChars = 0;

  const flushLine = () => {
    if (!activeParts.length) {
      return;
    }
    lines.push(`${activeSender}: ${activeParts.join(" | ")}`);
    activeSender = "";
    activeParts = [];
    activeChars = 0;
  };

  for (const raw of messages) {
    const sender = normalizeSender(raw?.sender);
    const text = cleanText(raw?.text, options.maxMessageChars);
    if (!text) {
      continue;
    }

    const delimiterChars = activeParts.length ? 3 : 0;
    if (sender === activeSender && activeChars + delimiterChars + text.length <= options.maxMergedLineChars) {
      activeParts.push(text);
      activeChars += delimiterChars + text.length;
      continue;
    }

    flushLine();
    activeSender = sender;
    activeParts = [text];
    activeChars = text.length;
  }

  flushLine();
  return lines;
}

function normalizeSender(sender) {
  if (!sender) {
    return "U";
  }
  const text = String(sender).trim().toUpperCase();
  if (!text) {
    return "U";
  }
  if (text === "RU") {
    return "R";
  }
  if (text === "TU") {
    return "T";
  }
  return text.length <= 3 ? text : text.slice(0, 3);
}

function cleanText(value, maxMessageChars) {
  if (value === undefined || value === null) {
    return "";
  }
  const normalized = String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxMessageChars) {
    return normalized;
  }

  const keepHead = Math.max(40, Math.floor(maxMessageChars * 0.65));
  const keepTail = Math.max(20, maxMessageChars - keepHead);
  const omitted = Math.max(0, normalized.length - keepHead - keepTail);

  return `${normalized.slice(0, keepHead)} ...[${omitted} chars omitted]... ${normalized.slice(-keepTail)}`;
}

function clampPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

module.exports = {
  buildPrompt
};
