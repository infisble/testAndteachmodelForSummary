"use strict";

function extractTimestampAndText(message) {
  for (const [key, value] of Object.entries(message)) {
    if (key === "from" || key === "sender") {
      continue;
    }
    return [key, String(value)];
  }
  return ["", String(message.text || message.message || "")];
}

function safeInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function safeStr(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  return text ? text : null;
}

function buildDialogId(ruId, tuId, index) {
  if (ruId !== null && tuId !== null) {
    return `${ruId}_${tuId}_${index}`;
  }
  return String(index);
}

function convertDialog(raw, index) {
  const context = raw.context || {};
  const ru = context.RU || {};
  const tu = context.TU || {};

  const ruId = safeInt(ru.id);
  const tuId = safeInt(tu.id);
  const dialogId = raw.dialog_id || buildDialogId(ruId, tuId, index);

  const messages = [];
  for (const item of raw.messages || []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const sender = item.from || item.sender || null;
    const [timestamp, text] = extractTimestampAndText(item);
    messages.push({
      sender,
      timestamp,
      text
    });
  }

  return {
    dialog_id: String(dialogId),
    ru_name: safeStr(ru.name),
    tu_name: safeStr(tu.name),
    ru_id: ruId,
    tu_id: tuId,
    messages
  };
}

function loadDialogs(payload) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (Object.hasOwn(payload, "messages")) {
      return [convertDialog(payload, 0)];
    }
    if (Array.isArray(payload.dialogs)) {
      return payload.dialogs.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map(convertDialog);
    }
    if (Array.isArray(payload.data)) {
      return payload.data.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map(convertDialog);
    }
  }

  if (Array.isArray(payload)) {
    return payload.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map(convertDialog);
  }

  throw new Error("Unsupported JSON format: expected a dialog object or list of dialogs");
}

module.exports = {
  loadDialogs
};
