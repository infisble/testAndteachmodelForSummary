"use strict";

const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value);
}

function parseJsonTemplate(value, fieldName) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON template in ${fieldName}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed;
}

const settings = {
  appName: "Bescosial Model Tester",
  modelProvider: readEnv("BESCO_MODEL_PROVIDER", "mock"),
  vertexProjectId: readEnv("BESCO_VERTEX_PROJECT_ID", "") || null,
  vertexLocation: readEnv("BESCO_VERTEX_LOCATION", "us-central1"),
  vertexEndpointId: readEnv("BESCO_VERTEX_ENDPOINT_ID", "") || null,
  vertexInstanceTemplate: readEnv("BESCO_VERTEX_INSTANCE_TEMPLATE", "{\"prompt\": \"{prompt}\"}"),
  vertexParametersTemplate: readEnv("BESCO_VERTEX_PARAMETERS_TEMPLATE", "{\"temperature\": 0.2, \"maxOutputTokens\": 5512}"),
  geminiApiKey: readEnv("BESCO_GEMINI_API_KEY", "") || null,
  geminiAccessToken: readEnv("BESCO_GEMINI_ACCESS_TOKEN", "") || null,
  geminiModel: readEnv("BESCO_GEMINI_MODEL", "gemini-2.5-pro"),
  geminiApiBase: readEnv("BESCO_GEMINI_API_BASE", "https://aiplatform.googleapis.com"),
  geminiApiVersion: readEnv("BESCO_GEMINI_API_VERSION", "v1/publishers/google"),
  requestTimeoutSec: Number(readEnv("BESCO_REQUEST_TIMEOUT_SEC", "60")) || 60,
  corsOrigins: readEnv("BESCO_CORS_ORIGINS", "http://localhost:5173"),
  mockReply: readEnv("BESCO_MOCK_REPLY", "Mock summary")
};

module.exports = {
  settings,
  parseJsonTemplate
};
