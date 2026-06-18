"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const env = readDotEnv(path.resolve(process.cwd(), ".env"));
const apiKey = env.BESCO_GEMINI_API_KEY || process.env.BESCO_GEMINI_API_KEY;
const model = env.BESCO_GEMINI_MODEL || process.env.BESCO_GEMINI_MODEL || "gemini-2.5-flash";
const apiBase = env.BESCO_GEMINI_API_BASE || process.env.BESCO_GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
const apiVersion = env.BESCO_GEMINI_API_VERSION || process.env.BESCO_GEMINI_API_VERSION || "v1beta";
const count = parsePositiveInt(process.argv[2] || process.env.GEMINI_BATCH_COUNT, 100);
const timeoutMs = parsePositiveInt(process.env.GEMINI_BATCH_TIMEOUT_MS, 45000);

if (!apiKey) {
  throw new Error("BESCO_GEMINI_API_KEY is required in .env or environment");
}

const url = `${apiBase.replace(/\/+$/g, "")}/${apiVersion}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
const body = JSON.stringify({
  contents: [{ parts: [{ text: "Hello" }] }],
  generationConfig: {
    maxOutputTokens: 1,
    temperature: 0
  }
});

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const startedAt = performance.now();
  const results = await Promise.all(Array.from({ length: count }, (_, index) => requestOnce(index + 1)));
  const elapsedMs = Math.round(performance.now() - startedAt);
  const counts = countStatuses(results);
  const timings = summarizeTimings(results);
  const first429 = results.find((item) => item.status === 429);

  console.log(`model=${model}`);
  console.log(`requests=${count}`);
  console.log(`elapsed_ms=${elapsedMs}`);
  console.log(`statuses=${formatCounts(counts)}`);
  console.log(`ok_200=${counts.get(200) || 0}`);
  console.log(`rate_limited_429=${counts.get(429) || 0}`);
  console.log(`other_errors=${results.filter((item) => item.status !== 200 && item.status !== 429).length}`);
  console.log(`avg_ms=${timings.avgMs} p95_ms=${timings.p95Ms} max_ms=${timings.maxMs}`);

  if (first429) {
    console.log(`first_429_request=${first429.n}`);
    console.log(`first_429_message=${first429.message}`);
  }
}

async function requestOnce(n) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal
    });
    const text = await response.text();
    return {
      n,
      status: response.status,
      ms: Math.round(performance.now() - startedAt),
      message: extractMessage(text)
    };
  } catch (error) {
    return {
      n,
      status: error?.name === "AbortError" ? 408 : 0,
      ms: Math.round(performance.now() - startedAt),
      message: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function countStatuses(results) {
  const counts = new Map();
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) || 0) + 1);
  }
  return counts;
}

function summarizeTimings(results) {
  const times = results.map((item) => item.ms).sort((a, b) => a - b);
  if (!times.length) {
    return { avgMs: 0, p95Ms: 0, maxMs: 0 };
  }
  const avgMs = Math.round(times.reduce((sum, item) => sum + item, 0) / times.length);
  return {
    avgMs,
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    maxMs: times[times.length - 1]
  };
}

function formatCounts(counts) {
  return Array.from(counts.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([status, total]) => `${status}:${total}`)
    .join(",");
}

function extractMessage(text) {
  if (!text) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message || parsed?.message || "").replace(/\s+/g, " ").slice(0, 240);
  } catch {
    return text.replace(/\s+/g, " ").slice(0, 240);
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
