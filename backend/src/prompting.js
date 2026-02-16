"use strict";

const SYSTEM_SENDERS = new Set(["SYSTEM", "SYS", "BOT", "SERVICE", "MODERATOR", "ADMIN"]);
const NOISE_TEXT = new Set([
  "sticker",
  "photo",
  "gif",
  "video",
  "voice",
  "voice message",
  "audio",
  "image",
  "emoji",
  "call",
  "missed call"
]);
const LOW_SIGNAL_SHORT = new Set([
  "yes",
  "no",
  "ok",
  "okay",
  "k",
  "kk",
  "yep",
  "yup",
  "haha",
  "hehe",
  "what",
  "why",
  "wow",
  "mark",
  "babe",
  "honey",
  "sure",
  "maybe",
  "maby",
  "please"
]);
const MAX_PROMPT_TURNS = 240;
const MAX_MERGED_LEN = 420;

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
  const prepared = [];

  for (const raw of messages) {
    const sender = normalizeSender(raw.sender);
    const text = cleanText(raw.text);

    if (!text) {
      continue;
    }
    if (SYSTEM_SENDERS.has(sender)) {
      continue;
    }
    if (isSystemOutput(text)) {
      continue;
    }
    if (isNoise(text)) {
      continue;
    }
    if (isLowSignal(text)) {
      continue;
    }

    const item = { sender, text };
    const prev = prepared[prepared.length - 1];

    if (prev && prev.sender === item.sender) {
      if (prev.text.toLowerCase() === item.text.toLowerCase()) {
        continue;
      }
      const merged = `${prev.text} ${item.text}`.trim();
      if (merged.length <= MAX_MERGED_LEN) {
        prev.text = merged;
        continue;
      }
    }

    prepared.push(item);
  }

  const sliced = prepared.length > MAX_PROMPT_TURNS ? prepared.slice(-MAX_PROMPT_TURNS) : prepared;
  return sliced.map((item) => `[${item.sender}] ${item.text}`);
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
  let text = String(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();

  // Strip attachment prefixes like "[4 photo] ...", keeping any meaningful caption.
  text = text.replace(/^\[\s*\d+\s*(photo|photos|video|videos|image|images)\s*\]\s*/i, "").trim();

  return text;
}

function isSystemOutput(text) {
  const norm = text.toLowerCase();
  return norm.startsWith("system output") || norm.startsWith("service message") || norm.startsWith("auto message");
}

function isNoise(text) {
  const norm = text.toLowerCase().replace(/[.!?]+$/g, "").trim();
  if (!norm) {
    return true;
  }
  if (NOISE_TEXT.has(norm)) {
    return true;
  }
  if (/^[\W_]+$/u.test(norm)) {
    return true;
  }
  return false;
}

function isLowSignal(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return true;
  }
  const words = cleaned.split(" ");
  if (words.length > 2) {
    return false;
  }
  return words.every((word) => LOW_SIGNAL_SHORT.has(word));
}

module.exports = {
  buildPrompt
};
