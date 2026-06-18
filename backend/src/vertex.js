"use strict";

const { performance } = require("node:perf_hooks");
const { GoogleAuth } = require("google-auth-library");
const { parseJsonTemplate } = require("./config");
const { toLogJson } = require("./logging");

class VertexClient {
  constructor(settings) {
    this.settings = settings;
    this.auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
  }

  async predict(prompt, overrides = {}) {
    const start = performance.now();
    const config = mergeOverrides(this.settings, overrides);
    const instance = renderTemplate(config.instanceTemplate, prompt);
    const parameters = renderTemplate(config.parametersTemplate, prompt);
    const endpoint = `projects/${config.projectId}/locations/${config.location}/endpoints/${config.endpointId}`;

    console.info(
      "VERTEX REQUEST endpoint=%s instance=%s parameters=%s",
      endpoint,
      toLogJson(instance),
      toLogJson(parameters)
    );

    const token = await this.getAccessToken(overrides);
    const url = `https://${config.location}-aiplatform.googleapis.com/v1/${endpoint}:predict`;

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          instances: [instance],
          parameters
        })
      },
      this.settings.requestTimeoutSec * 1000
    );

    const body = await safeJson(response);
    if (!response.ok) {
      throw new Error(formatError("Vertex", response.status, body));
    }

    const predictions = Array.isArray(body?.predictions) ? body.predictions : [];
    console.info("VERTEX RESPONSE predictions=%s", toLogJson(predictions));

    const text = extractPredictionText(predictions);
    const latencyMs = Math.round(performance.now() - start);
    return [text, latencyMs];
  }

  async getAccessToken(overrides) {
    if (overrides.access_token) {
      return overrides.access_token;
    }
    const client = await this.auth.getClient();
    const tokenResult = await client.getAccessToken();
    const token = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
    if (!token) {
      throw new Error("Failed to acquire Google access token");
    }
    return token;
  }
}

function mergeOverrides(settings, overrides) {
  const projectId = overrides.project_id || settings.vertexProjectId;
  const endpointId = overrides.endpoint_id || settings.vertexEndpointId;
  const location = overrides.location || settings.vertexLocation;

  if (!projectId || !endpointId) {
    throw new Error("Vertex project_id and endpoint_id are required");
  }

  const instanceTemplate = isObject(overrides.instance_template)
    ? overrides.instance_template
    : parseJsonTemplate(settings.vertexInstanceTemplate, "BESCO_VERTEX_INSTANCE_TEMPLATE");

  const parametersTemplate = isObject(overrides.parameters_template)
    ? overrides.parameters_template
    : parseJsonTemplate(settings.vertexParametersTemplate, "BESCO_VERTEX_PARAMETERS_TEMPLATE");

  return {
    projectId,
    endpointId,
    location,
    instanceTemplate,
    parametersTemplate
  };
}

function renderTemplate(template, prompt) {
  if (Array.isArray(template)) {
    return template.map((item) => renderTemplate(item, prompt));
  }
  if (template && typeof template === "object") {
    const out = {};
    for (const [key, value] of Object.entries(template)) {
      out[key] = renderTemplate(value, prompt);
    }
    return out;
  }
  if (typeof template === "string") {
    return template.replaceAll("{prompt}", prompt);
  }
  return template;
}

function extractPredictionText(predictions) {
  if (!predictions.length) {
    return "";
  }
  const first = predictions[0];
  if (typeof first === "string") {
    return first;
  }
  if (first && typeof first === "object") {
    for (const key of ["content", "text", "output", "prediction", "generated_text", "response"]) {
      if (typeof first[key] === "string") {
        return first[key];
      }
    }
    if (Array.isArray(first.candidates) && first.candidates.length) {
      const candidate = first.candidates[0];
      if (typeof candidate === "string") {
        return candidate;
      }
      if (candidate && typeof candidate === "object") {
        for (const key of ["content", "text", "output"]) {
          if (typeof candidate[key] === "string") {
            return candidate[key];
          }
        }
      }
    }
  }
  return String(first);
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
  VertexClient
};
