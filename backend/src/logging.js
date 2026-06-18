"use strict";

const SENSITIVE_KEYS = new Set(["api_key", "access_token", "authorization", "token", "key"]);
const MAX_LOG_CHARS = 12000;

function toLogJson(payload, maxChars = MAX_LOG_CHARS) {
  const redacted = redact(payload);
  let text;
  try {
    text = JSON.stringify(redacted);
  } catch {
    text = String(redacted);
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...<truncated ${text.length - maxChars} chars>`;
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
        out[key] = "***";
      } else {
        out[key] = redact(item);
      }
    }
    return out;
  }
  return value;
}

module.exports = {
  toLogJson
};
