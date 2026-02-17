"use strict";

function extractTimestampAndText(message) {
  const timestampFields = ["timestamp", "date", "datetime", "time", "created_at", "createdAt", "ts"];
  for (const field of timestampFields) {
    if (message[field] !== undefined && message[field] !== null) {
      const ts = String(message[field]).trim();
      if (ts) {
        return [ts, extractText(message)];
      }
    }
  }

  for (const [key, value] of Object.entries(message)) {
    if (!isSenderField(key) && isTimestampKey(key)) {
      return [key, stringifyText(value)];
    }
  }

  return ["", extractText(message)];
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

function extractText(message) {
  const primaryTextFields = ["text", "message", "content", "body", "caption"];
  for (const field of primaryTextFields) {
    if (message[field] !== undefined && message[field] !== null) {
      const text = stringifyText(message[field]).trim();
      if (text) {
        return text;
      }
    }
  }

  for (const [key, value] of Object.entries(message)) {
    if (isSenderField(key) || isMetaField(key) || isTimestampKey(key)) {
      continue;
    }
    const text = stringifyText(value).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function stringifyText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyText(item)).join("");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (Array.isArray(value.text)) {
      return stringifyText(value.text);
    }
    return Object.values(value)
      .map((item) => stringifyText(item))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return String(value);
}

function isSenderField(key) {
  const normalized = String(key).toLowerCase();
  return normalized === "from" || normalized === "sender" || normalized === "from_id" || normalized === "author";
}

function isMetaField(key) {
  const normalized = String(key).toLowerCase();
  return normalized === "id" || normalized === "type" || normalized === "date_unixtime";
}

function isTimestampKey(key) {
  const value = String(key).trim();
  if (!value) {
    return false;
  }
  return (
    /^\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?$/i.test(value) ||
    /^\d{2}\.\d{2}\.\d{4}(?:[ t]\d{2}:\d{2}(?::\d{2})?)?$/.test(value)
  );
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
    const sender = safeStr(item.from || item.sender || item.from_id || item.author);
    const [timestamp, text] = extractTimestampAndText(item);
    if (!text.trim()) {
      continue;
    }
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
