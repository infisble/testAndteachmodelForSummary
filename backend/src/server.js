"use strict";

const { randomUUID } = require("node:crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { settings, parseJsonTemplate } = require("./config");
const { loadDialogs } = require("./parsing");
const { buildPrompt } = require("./prompting");
const { GeminiClient } = require("./gemini");
const { VertexClient } = require("./vertex");
const { toLogJson } = require("./logging");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const origins = settings.corsOrigins
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.use(express.json({ limit: "25mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin is not allowed"));
    },
    credentials: true
  })
);

const geminiClient = new GeminiClient(settings);
const vertexClient = new VertexClient(settings);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", provider: settings.modelProvider });
});

app.post("/api/parse", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ detail: "file is required" });
  }
  let payload;
  try {
    payload = JSON.parse(req.file.buffer.toString("utf-8"));
  } catch (error) {
    return res.status(400).json({ detail: `Failed to parse JSON: ${error.message}` });
  }
  const dialogs = loadDialogs(payload);
  res.json({ dialogs });
}));

app.post("/api/summarize", asyncHandler(async (req, res) => {
  const request = req.body || {};
  const dialog = request.dialog || {};
  const promptCfg = request.prompt || {};
  const provider = String(request?.model?.provider || settings.modelProvider || "mock").toLowerCase();
  const requestId = randomUUID().slice(0, 8);
  const prompt = buildPrompt(dialog, promptCfg);

  console.info(
    "MODEL REQUEST id=%s provider=%s dialog_id=%s payload=%s",
    requestId,
    provider,
    dialog.dialog_id || "unknown",
    toLogJson({ prompt })
  );

  if (provider === "mock") {
    const response = {
      summary: mockSummary(prompt),
      latency_ms: 0,
      provider: "mock"
    };
    console.info(
      "MODEL RESPONSE id=%s provider=%s latency_ms=%s payload=%s",
      requestId,
      response.provider,
      response.latency_ms,
      toLogJson(response)
    );
    return res.json(response);
  }

  if (provider !== "vertex" && provider !== "gemini") {
    return res.status(400).json({ detail: `Unsupported provider: ${provider}` });
  }

  const overrides = buildOverrides(request);

  try {
    const [summary, latencyMs] =
      provider === "vertex"
        ? await vertexClient.predict(prompt, overrides)
        : await geminiClient.generate(prompt, overrides);

    const response = {
      summary,
      latency_ms: latencyMs,
      provider
    };
    console.info(
      "MODEL RESPONSE id=%s provider=%s latency_ms=%s payload=%s",
      requestId,
      response.provider,
      response.latency_ms,
      toLogJson(response)
    );
    res.json(response);
  } catch (error) {
    console.error("MODEL ERROR id=%s provider=%s error=%s", requestId, provider, error?.message || String(error));
    throw error;
  }
}));

app.post("/api/summarize-batch", asyncHandler(async (req, res) => {
  const request = req.body || {};
  const dialogs = Array.isArray(request.dialogs) ? request.dialogs : [];
  const provider = String(request?.model?.provider || settings.modelProvider || "mock").toLowerCase();
  if (provider !== "mock" && provider !== "vertex" && provider !== "gemini") {
    return res.status(400).json({ detail: `Unsupported provider: ${provider}` });
  }

  const overrides = buildOverrides(request);
  const items = [];
  for (const dialog of dialogs) {
    const prompt = buildPrompt(dialog, request.prompt || {});
    let summary = "";
    let latencyMs = 0;

    if (provider === "mock") {
      summary = mockSummary(prompt);
    } else if (provider === "vertex") {
      [summary, latencyMs] = await vertexClient.predict(prompt, overrides);
    } else {
      [summary, latencyMs] = await geminiClient.generate(prompt, overrides);
    }

    items.push({
      dialog_id: dialog.dialog_id,
      summary,
      latency_ms: latencyMs,
      provider
    });
  }

  res.json({ items });
}));

app.use((error, req, res, next) => {
  const message = error?.message || String(error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).json({ detail: message });
});

const port = Number(process.env.PORT || 8000);
app.listen(port, () => {
  console.info("%s running on port %s", settings.appName, port);
});

function mockSummary(prompt) {
  if (prompt.includes("Routine exchange")) {
    return "Routine exchange";
  }
  return settings.mockReply;
}

function buildOverrides(request) {
  const overrides = {};
  const model = request?.model;
  if (model && typeof model === "object") {
    copyIfPresent(overrides, model, "api_key");
    copyIfPresent(overrides, model, "access_token");
    copyIfPresent(overrides, model, "model_name");
    copyIfPresent(overrides, model, "api_base");
    copyIfPresent(overrides, model, "api_version");
    copyIfPresent(overrides, model, "project_id");
    copyIfPresent(overrides, model, "location");
    copyIfPresent(overrides, model, "endpoint_id");
    copyIfPresent(overrides, model, "instance_template");
    copyIfPresent(overrides, model, "parameters_template");
  }

  if (request?.parameters && typeof request.parameters === "object" && !Array.isArray(request.parameters)) {
    let base;
    if (model && model.parameters_template && typeof model.parameters_template === "object" && !Array.isArray(model.parameters_template)) {
      base = { ...model.parameters_template };
    } else {
      base = parseJsonTemplate(settings.vertexParametersTemplate, "BESCO_VERTEX_PARAMETERS_TEMPLATE");
    }
    overrides.parameters_template = {
      ...base,
      ...request.parameters
    };
  }

  return overrides;
}

function copyIfPresent(target, source, key) {
  if (source[key] !== undefined && source[key] !== null) {
    target[key] = source[key];
  }
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
