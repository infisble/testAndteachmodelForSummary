"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const env = readDotEnv(path.resolve(process.cwd(), ".env"));
const apiKey = env.BESCO_GEMINI_API_KEY || process.env.BESCO_GEMINI_API_KEY;
const model = env.BESCO_GEMINI_MODEL || process.env.BESCO_GEMINI_MODEL || "gemini-2.5-flash";
const apiBase = env.BESCO_GEMINI_API_BASE || process.env.BESCO_GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
const apiVersion = env.BESCO_GEMINI_API_VERSION || process.env.BESCO_GEMINI_API_VERSION || "v1beta";

const maxRequests = Number(process.env.GEMINI_RATE_TEST_MAX_REQUESTS || 3000);
const target429 = Number(process.env.GEMINI_RATE_TEST_TARGET_429 || 1);
const timeoutMs = Number(process.env.GEMINI_RATE_TEST_TIMEOUT_MS || 45000);
const batches = parseBatches(process.env.GEMINI_RATE_TEST_BATCHES || "20,40,80,120,180,240,320,420,520,640,440");

if (!apiKey) {
  throw new Error("BESCO_GEMINI_API_KEY is required");
}

const endpoint = `${apiBase.replace(/\/+$/g, "")}/${apiVersion}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
const payload = JSON.stringify({
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
  console.log(`Rate test model=${model} api_base=${apiBase} api_version=${apiVersion}`);
  console.log(`Plan batches=${batches.join(",")} max_requests=${maxRequests} timeout_ms=${timeoutMs}`);

  const all = [];
  const startedAt = performance.now();

  for (let waveIndex = 0; waveIndex < batches.length && all.length < maxRequests; waveIndex += 1) {
    const size = Math.min(batches[waveIndex], maxRequests - all.length);
    const waveStart = performance.now();
    const wave = await Promise.all(Array.from({ length: size }, (_, i) => requestOnce(all.length + i + 1)));
    all.push(...wave);

    const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
    const waveSec = ((performance.now() - waveStart) / 1000).toFixed(1);
    const summary = summarize(wave);
    const total429 = all.filter((item) => item.status === 429).length;
    console.log(
      `wave=${waveIndex + 1} size=${size} wave_sec=${waveSec} elapsed_sec=${elapsedSec} total=${all.length} ` +
        `statuses=${formatStatusCounts(summary.statusCounts)} avg_ms=${summary.avgMs} max_ms=${summary.maxMs} total_429=${total429}`
    );

    const first429 = all.find((item) => item.status === 429);
    if (total429 >= target429 && first429) {
      printFinal(all, startedAt, first429);
      return;
    }
  }

  printFinal(all, startedAt, null);
}

async function requestOnce(n) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      signal: controller.signal
    });
    const text = await response.text();
    return {
      n,
      status: response.status,
      ms: Math.round(performance.now() - start),
      retryAfter: response.headers.get("retry-after") || "",
      message: extractMessage(text)
    };
  } catch (error) {
    return {
      n,
      status: error?.name === "AbortError" ? 408 : 0,
      ms: Math.round(performance.now() - start),
      retryAfter: "",
      message: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function printFinal(results, startedAt, first429) {
  const summary = summarize(results);
  const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log("FINAL");
  console.log(`total=${results.length} elapsed_sec=${elapsedSec} statuses=${formatStatusCounts(summary.statusCounts)}`);
  console.log(`avg_ms=${summary.avgMs} p95_ms=${summary.p95Ms} max_ms=${summary.maxMs}`);
  if (first429) {
    console.log(
      `first_429_request=${first429.n} first_429_ms=${first429.ms} retry_after=${first429.retryAfter || "none"} ` +
        `message=${first429.message || ""}`
    );
  } else {
    console.log("first_429_request=none");
  }
}

function summarize(items) {
  const statusCounts = new Map();
  const times = [];
  for (const item of items) {
    statusCounts.set(item.status, (statusCounts.get(item.status) || 0) + 1);
    times.push(item.ms);
  }
  times.sort((a, b) => a - b);
  const avgMs = times.length ? Math.round(times.reduce((sum, item) => sum + item, 0) / times.length) : 0;
  const p95Ms = times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : 0;
  const maxMs = times.length ? times[times.length - 1] : 0;
  return { statusCounts, avgMs, p95Ms, maxMs };
}

function formatStatusCounts(counts) {
  return Array.from(counts.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([status, count]) => `${status}:${count}`)
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

function parseBatches(value) {
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.round(item));
}

function readDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const result = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
