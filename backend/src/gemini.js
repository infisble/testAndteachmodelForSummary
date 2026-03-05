"use strict";

const { performance } = require("node:perf_hooks");
const { toLogJson } = require("./logging");

const DEFAULT_VERTEX_GEMINI_API_BASE = "https://aiplatform.googleapis.com";
const DEFAULT_VERTEX_GEMINI_API_VERSION = "v1/publishers/google";
const DEFAULT_DIRECT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const DEFAULT_DIRECT_GEMINI_API_VERSION = "v1beta";

class GeminiClient {
  constructor(settings) {
    this.settings = settings;
  }

  async generate(prompt, overrides = {}) {
    const start = performance.now();
    const config = mergeOverrides(this.settings, overrides);
    const retryCfg = getRetryConfig(this.settings);
    const promptCandidates = buildPromptCandidates(prompt, retryCfg.promptCharBudgets);

    let lastError = null;

    for (let promptIndex = 0; promptIndex < promptCandidates.length; promptIndex += 1) {
      const promptText = promptCandidates[promptIndex];
      for (let attempt = 1; attempt <= retryCfg.maxAttempts; attempt += 1) {
        try {
          const text = await generateOnce(this.settings, config, promptText);
          const latencyMs = Math.round(performance.now() - start);
          return [text, latencyMs];
        } catch (error) {
          lastError = error;
          const canRetry = isRetriableError(error);
          const isLastAttempt = attempt >= retryCfg.maxAttempts;
          const hasSmallerPrompt = promptIndex < promptCandidates.length - 1;

          if (!canRetry) {
            throw error;
          }

          if (!isLastAttempt) {
            const delayMs = calculateRetryDelayMs(error, attempt, retryCfg.baseDelayMs, retryCfg.maxDelayMs);
            console.warn(
              "GEMINI RETRY status=%s attempt=%s/%s delay_ms=%s prompt_chars=%s",
              error?.status || "unknown",
              attempt,
              retryCfg.maxAttempts,
              delayMs,
              promptText.length
            );
            await sleep(delayMs);
            continue;
          }

          if (hasSmallerPrompt) {
            const nextPromptChars = promptCandidates[promptIndex + 1].length;
            console.warn(
              "GEMINI RETRY prompt_shrink from_chars=%s to_chars=%s status=%s",
              promptText.length,
              nextPromptChars,
              error?.status || "unknown"
            );
          }
        }
      }
    }

    throw lastError || new Error("Gemini request failed");
  }
}

async function generateOnce(settings, config, promptText) {
  const url = `${config.apiBase.replace(/\/+$/g, "")}/${config.apiVersion}/models/${config.modelName}:generateContent`;
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }]
      }
    ]
  };
  if (config.parameters) {
    payload.generationConfig = config.parameters;
  }

  const headers = {};
  const queryParams = new URLSearchParams();
  if (config.accessToken) {
    headers.Authorization = `Bearer ${config.accessToken}`;
  } else if (config.apiKey) {
    queryParams.set("key", config.apiKey);
  }

  const finalUrl = queryParams.toString() ? `${url}?${queryParams}` : url;
  console.info(
    "GEMINI REQUEST url=%s headers=%s payload=%s",
    finalUrl,
    toLogJson(headers),
    toLogJson(payload)
  );

  const response = await fetchWithTimeout(
    finalUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(payload)
    },
    settings.requestTimeoutSec * 1000
  );

  const body = await safeJson(response);
  console.info("GEMINI RESPONSE status=%s body=%s", response.status, toLogJson(body));
  if (!response.ok) {
    const error = new Error(formatError("Gemini", response.status, body));
    error.status = response.status;
    error.responseBody = body;
    error.retryAfterMs = parseRetryAfterMs(response.headers);
    throw error;
  }

  const text = extractText(body);
  if (!text) {
    throw new Error(describeEmptyTextResponse(body));
  }
  return text;
}

function mergeOverrides(settings, overrides) {
  const apiKey = overrides.api_key || settings.geminiApiKey;
  const accessToken = overrides.access_token || settings.geminiAccessToken;
  const modelName = normalizeModelPath(normalizeModelName(overrides.model_name || settings.geminiModel));
  let apiBase = overrides.api_base || settings.geminiApiBase;
  let apiVersion = overrides.api_version || settings.geminiApiVersion;
  const parameters = isObject(overrides.parameters_template) ? overrides.parameters_template : null;

  // Avoid routing API-key requests to the Vertex endpoint defaults.
  if (apiKey && !accessToken && isVertexGeminiEndpoint(apiBase, apiVersion)) {
    apiBase = DEFAULT_DIRECT_GEMINI_API_BASE;
    apiVersion = DEFAULT_DIRECT_GEMINI_API_VERSION;
    console.info(
      "GEMINI CONFIG using direct Gemini endpoint api_base=%s api_version=%s",
      apiBase,
      apiVersion
    );
  }

  if (!apiKey && !accessToken) {
    throw new Error("Gemini API key or OAuth access token is required");
  }
  if (!modelName) {
    throw new Error("Gemini model name is required");
  }

  return {
    apiKey,
    accessToken,
    modelName,
    apiBase,
    apiVersion,
    parameters
  };
}

const MODEL_ALIASES = {
  "pro": "gemini-2.5-pro",
  "2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-pro": "gemini-2.5-pro",
  "flash": "gemini-2.5-flash",
  "2.5-flash": "gemini-2.5-flash",
  "gemini-2.5-flash": "gemini-2.5-flash",
  "flashlight": "gemini-2.5-flash-lite",
  "flash-lite": "gemini-2.5-flash-lite",
  "flashlite": "gemini-2.5-flash-lite",
  "2.5-flashlight": "gemini-2.5-flash-lite",
  "2.5-flash-lite": "gemini-2.5-flash-lite",
  "2.5-flashlite": "gemini-2.5-flash-lite",
  "gemini-2.5-flashlight": "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
  "gemini-2.5-flashlite": "gemini-2.5-flash-lite"
};

function normalizeModelName(value) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalized = trimmed
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");

  return MODEL_ALIASES[normalized] || trimmed;
}

function normalizeModelPath(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value
    .trim()
    .replace(/^publishers\/google\/models\//i, "")
    .replace(/^models\//i, "");
}

function isVertexGeminiEndpoint(apiBase, apiVersion) {
  return (
    normalizeBase(apiBase) === normalizeBase(DEFAULT_VERTEX_GEMINI_API_BASE) &&
    normalizeVersion(apiVersion) === normalizeVersion(DEFAULT_VERTEX_GEMINI_API_VERSION)
  );
}

function normalizeBase(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\/+$/g, "");
}

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "");
}

function extractText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const texts = [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        texts.push(part.text);
      }
    }
    if (texts.length) {
      return texts.join("\n");
    }
  }
  return "";
}

function describeEmptyTextResponse(body) {
  const details = [];

  const promptBlockReason = body?.promptFeedback?.blockReason;
  if (promptBlockReason) {
    details.push(`promptBlockReason=${promptBlockReason}`);
  }

  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const candidateDetails = candidates
    .map((candidate, index) => {
      const parts = [];
      if (candidate?.finishReason) {
        parts.push(`finishReason=${candidate.finishReason}`);
      }
      if (candidate?.finishMessage) {
        parts.push(`finishMessage=${candidate.finishMessage}`);
      }

      const blockedSafety = Array.isArray(candidate?.safetyRatings)
        ? candidate.safetyRatings
            .filter((item) => item?.blocked || String(item?.probability || "").toUpperCase() !== "NEGLIGIBLE")
            .map((item) => `${item.category || "UNKNOWN"}:${item.probability || "UNKNOWN"}${item.blocked ? ":blocked" : ""}`)
        : [];
      if (blockedSafety.length) {
        parts.push(`safety=${blockedSafety.join(",")}`);
      }

      return parts.length ? `candidate${index}(${parts.join("; ")})` : "";
    })
    .filter(Boolean);

  if (candidateDetails.length) {
    details.push(candidateDetails.join(" | "));
  }

  if (!details.length) {
    return "Gemini returned no text in candidates";
  }

  return `Gemini returned no text (${details.join(" | ")})`;
}

function formatError(provider, status, body) {
  const error = body?.error ?? body;
  const message = typeof error === "object" ? error?.message || JSON.stringify(error) : String(error);
  return `${provider} request failed (${status}): ${message}`;
}

function safeJson(response) {
  return response.text().then((text) => {
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  });
}

function getRetryConfig(settings) {
  return {
    maxAttempts: clampPositiveInt(settings.geminiRetryMaxAttempts, 3),
    baseDelayMs: clampPositiveInt(settings.geminiRetryBaseDelayMs, 1500),
    maxDelayMs: clampPositiveInt(settings.geminiRetryMaxDelayMs, 12000),
    promptCharBudgets: parseCharBudgets(settings.geminiPromptCharBudgets)
  };
}

function parseCharBudgets(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item) && item > 0)
      .map((item) => Math.round(item));
  }
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.round(item));
}

function buildPromptCandidates(prompt, charBudgets) {
  const variants = [prompt];
  for (const limit of charBudgets) {
    const compact = compactDialogPrompt(prompt, limit);
    if (compact && compact.length < variants[variants.length - 1].length) {
      variants.push(compact);
    }
  }
  return variants;
}

function compactDialogPrompt(prompt, maxDialogChars) {
  const marker = "\nDialog:\n";
  const markerIndex = prompt.indexOf(marker);
  if (markerIndex === -1) {
    if (prompt.length <= maxDialogChars) {
      return prompt;
    }
    return prompt.slice(-maxDialogChars);
  }

  const prefix = prompt.slice(0, markerIndex + marker.length);
  const rest = prompt.slice(markerIndex + marker.length);
  const separatorIndex = rest.lastIndexOf("\n\n");
  const dialogBlock = separatorIndex >= 0 ? rest.slice(0, separatorIndex) : rest;
  const suffix = separatorIndex >= 0 ? rest.slice(separatorIndex) : "";

  if (dialogBlock.length <= maxDialogChars) {
    return prompt;
  }

  const lines = dialogBlock
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (!lines.length) {
    return prompt;
  }

  const kept = [];
  let usedChars = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const lineCost = line.length + 1;
    if (kept.length > 0 && usedChars + lineCost > maxDialogChars) {
      break;
    }
    if (kept.length === 0 && lineCost > maxDialogChars) {
      kept.push(line.slice(-(maxDialogChars - 1)));
      usedChars = maxDialogChars;
      break;
    }
    kept.push(line);
    usedChars += lineCost;
  }

  if (!kept.length) {
    return prompt;
  }

  const compactDialog = kept.reverse().join("\n");
  return `${prefix}${compactDialog}${suffix}`;
}

function isRetriableError(error) {
  const status = Number(error?.status || 0);
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  return Boolean(error?.isTimeout || error?.isNetworkError);
}

function calculateRetryDelayMs(error, attempt, baseDelayMs, maxDelayMs) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * 250);
  const retryAfterMs = clampPositiveInt(error?.retryAfterMs, 0);
  return Math.max(exponential + jitter, retryAfterMs);
}

function parseRetryAfterMs(headers) {
  const raw = headers && typeof headers.get === "function" ? headers.get("retry-after") : "";
  if (!raw) {
    return 0;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) {
    return 0;
  }
  return Math.max(0, dateMs - Date.now());
}

function clampPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      const timeoutError = new Error("Request timed out");
      timeoutError.status = 408;
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    const networkError = new Error(error?.message || "Network request failed");
    networkError.status = 0;
    networkError.isNetworkError = true;
    throw networkError;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  GeminiClient
};
