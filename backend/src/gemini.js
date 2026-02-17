"use strict";

const { performance } = require("node:perf_hooks");
const { toLogJson } = require("./logging");

class GeminiClient {
  constructor(settings) {
    this.settings = settings;
  }

  async generate(prompt, overrides = {}) {
    const start = performance.now();
    const config = mergeOverrides(this.settings, overrides);
    const url = `${config.apiBase.replace(/\/+$/g, "")}/${config.apiVersion}/models/${config.modelName}:generateContent`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
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

    const response = await fetchWithTimeout(finalUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(payload)
    }, this.settings.requestTimeoutSec * 1000);

    const body = await safeJson(response);
    console.info("GEMINI RESPONSE status=%s body=%s", response.status, toLogJson(body));
    if (!response.ok) {
      throw new Error(formatError("Gemini", response.status, body));
    }

    const text = extractText(body);
    const latencyMs = Math.round(performance.now() - start);
    return [text, latencyMs];
  }
}

function mergeOverrides(settings, overrides) {
  const apiKey = overrides.api_key || settings.geminiApiKey;
  const accessToken = overrides.access_token || settings.geminiAccessToken;
  const modelName = overrides.model_name || settings.geminiModel;
  const apiBase = overrides.api_base || settings.geminiApiBase;
  const apiVersion = overrides.api_version || settings.geminiApiVersion;
  const parameters = isObject(overrides.parameters_template) ? overrides.parameters_template : null;

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
      throw new Error("Request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  GeminiClient
};
