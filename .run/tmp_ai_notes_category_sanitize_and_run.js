const fs = require("fs");
const { spawn } = require("child_process");

const root = "C:/works/bescosial/testAndteachmodelForSummary";
const srcPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.json";
const outJsonPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.category-sanitized.json";
const outStatsPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.category-sanitized.stats.json";
const outResultsPath = `${root}/.run/ai_notes-category-sanitized-summary-results.json`;
const port = 8026;

function parseWithFix(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"));
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const RULES = {
  exactPhrases: [
    "ride my dick",
    "ass fuck",
    "ride you",
    "deepthroat",
    "blowjob"
  ],
  bodyParts: [
    "pussy",
    "vagina",
    "dick",
    "cock",
    "penis",
    "ass",
    "anus",
    "butt",
    "throat",
    "tit",
    "tits",
    "breast",
    "breasts",
    "boob",
    "boobs"
  ],
  sexualActions: [
    "fuck",
    "fucking",
    "suck",
    "cum",
    "orgasm",
    "climax",
    "ride",
    "kiss",
    "kissing",
    "spank",
    "lick",
    "licking",
    "masturbate",
    "masturbating",
    "masturbation"
  ],
  sexualStates: ["horny", "aroused", "sexy", "sexual"],
  explicitObjects: ["toy", "toys", "photo", "picture", "pic", "video", "naked", "nude"],
  coercion: ["force", "forced", "hold down", "rape"],
  familyAge: ["daughter", "child", "kid", "young", "teen"]
};

const REGEX = {
  exactPhrases: new RegExp(RULES.exactPhrases.map(escapeRegex).sort((a, b) => b.length - a.length).join("|"), "i"),
  bodyParts: new RegExp(`\\b(?:${RULES.bodyParts.map(escapeRegex).join("|")})\\b`, "gi"),
  sexualActions: new RegExp(`\\b(?:${RULES.sexualActions.map(escapeRegex).join("|")})\\b`, "gi"),
  sexualStates: new RegExp(`\\b(?:${RULES.sexualStates.map(escapeRegex).join("|")})\\b`, "gi"),
  explicitObjects: new RegExp(`\\b(?:${RULES.explicitObjects.map(escapeRegex).join("|")})\\b`, "gi"),
  coercion: new RegExp(`\\b(?:${RULES.coercion.map(escapeRegex).join("|")})\\b`, "gi"),
  familyAge: new RegExp(`\\b(?:${RULES.familyAge.map(escapeRegex).join("|")})\\b`, "gi"),
  sendMediaRequest: /\b(send|show|share)\b.{0,24}\b(photo|picture|pic|video)\b/i
};

function matches(rx, text) {
  return [...text.matchAll(rx)].map((m) => m[0].toLowerCase());
}

function uniq(arr) {
  return [...new Set(arr)];
}

function assessMessage(content) {
  if (typeof content !== "string" || !content.trim()) {
    return { sanitize: false, score: 0, reasons: [] };
  }

  const text = content;
  const bodyParts = uniq(matches(REGEX.bodyParts, text));
  const sexualActions = uniq(matches(REGEX.sexualActions, text));
  const sexualStates = uniq(matches(REGEX.sexualStates, text));
  const explicitObjects = uniq(matches(REGEX.explicitObjects, text));
  const coercion = uniq(matches(REGEX.coercion, text));
  const familyAge = uniq(matches(REGEX.familyAge, text));
  const exactPhrase = REGEX.exactPhrases.test(text);
  const sendMediaRequest = REGEX.sendMediaRequest.test(text);

  const reasons = [];
  let score = 0;

  if (exactPhrase) {
    score += 5;
    reasons.push("exact_phrase");
  }
  if (bodyParts.length) {
    score += Math.min(4, bodyParts.length * 2);
    reasons.push(`body_parts:${bodyParts.join(",")}`);
  }
  if (sexualActions.length) {
    score += Math.min(4, sexualActions.length * 2);
    reasons.push(`sexual_actions:${sexualActions.join(",")}`);
  }
  if (sexualStates.length) {
    score += Math.min(2, sexualStates.length);
    reasons.push(`sexual_states:${sexualStates.join(",")}`);
  }
  if (explicitObjects.length) {
    score += 1;
    reasons.push(`explicit_objects:${explicitObjects.join(",")}`);
  }
  if (coercion.length) {
    score += 4;
    reasons.push(`coercion:${coercion.join(",")}`);
  }
  if (sendMediaRequest && (bodyParts.length || sexualActions.length || sexualStates.length)) {
    score += 4;
    reasons.push("send_media_plus_intimate_context");
  }
  if (bodyParts.length && sexualActions.length) {
    score += 5;
    reasons.push("body_part_plus_sexual_action");
  }
  if (familyAge.length && (bodyParts.length || sexualActions.length || sexualStates.length)) {
    score += 5;
    reasons.push("family_or_age_plus_intimate_context");
  }

  // Thresholds:
  // - any strong combo or explicit phrase tends to sanitize
  // - single mild words should not necessarily sanitize
  const sanitize = score >= 5;
  return { sanitize, score, reasons };
}

function sanitizeMessage(content, stats) {
  const assessment = assessMessage(content);
  if (!assessment.sanitize) {
    return { text: typeof content === "string" ? content : "", changed: false, assessment };
  }

  stats.sanitizedMessages += 1;
  for (const reason of assessment.reasons) {
    stats.reasonCounts[reason] = (stats.reasonCounts[reason] || 0) + 1;
  }
  return {
    text: "[explicit message omitted]",
    changed: true,
    assessment
  };
}

function toInternalDialog(item, index) {
  const messages = Array.isArray(item.dialog)
    ? item.dialog.map((m) => ({
        sender: String(m?.initiator ?? ""),
        timestamp: String(m?.date ?? ""),
        text: String(m?.content ?? "")
      }))
    : [];

  return {
    dialog_id: `ai_notes_${item.ladyId || "lady"}_${item.manId || "man"}_${item.date || index}`,
    ru_id: item.manId ? Number(item.manId) : null,
    tu_id: item.ladyId ? Number(item.ladyId) : null,
    messages
  };
}

let backend = null;

async function httpJson(path, method, body, timeoutMs = 180000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const txt = await res.text();
    let parsed;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = { raw: txt };
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(t);
  }
}

async function stopBackend() {
  if (!backend) return;
  try {
    backend.kill("SIGTERM");
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
  backend = null;
}

async function startBackend() {
  await stopBackend();
  backend = spawn("node", ["backend/src/server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let out = "";
  let err = "";
  backend.stdout.on("data", (d) => (out += d.toString()));
  backend.stderr.on("data", (d) => (err += d.toString()));
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (backend.exitCode !== null) {
      throw new Error(`Backend exited early: ${err || out || backend.exitCode}`);
    }
    try {
      const h = await httpJson("/api/health", "GET", null, 5000);
      if (h.status === 200) return h.body;
    } catch {}
  }
  throw new Error("Backend did not become healthy");
}

async function requestWithRecovery(payload) {
  try {
    return await httpJson("/api/summarize", "POST", payload);
  } catch {
    await startBackend();
    return await httpJson("/api/summarize", "POST", payload);
  }
}

async function main() {
  const source = parseWithFix(fs.readFileSync(srcPath, "utf8"));
  if (!Array.isArray(source)) throw new Error("Expected top-level array");

  const stats = {
    source: srcPath,
    output: outJsonPath,
    dialogs: source.length,
    changedDialogs: 0,
    changedMessages: 0,
    sanitizedMessages: 0,
    reasonCounts: {},
    perDialog: []
  };

  const sanitized = source.map((dialogObj, idx) => {
    let dialogChanged = false;
    let dialogChangedMessages = 0;
    const clone = { ...dialogObj };
    if (Array.isArray(clone.dialog)) {
      clone.dialog = clone.dialog.map((msg) => {
        if (!msg || typeof msg !== "object") return msg;
        const res = sanitizeMessage(msg.content, stats);
        if (res.changed) {
          dialogChanged = true;
          dialogChangedMessages += 1;
          stats.changedMessages += 1;
          return { ...msg, content: res.text };
        }
        return msg;
      });
    }
    if (dialogChanged) stats.changedDialogs += 1;
    stats.perDialog.push({
      index: idx,
      date: clone.date || null,
      totalMessages: Array.isArray(clone.dialog) ? clone.dialog.length : 0,
      changedMessages: dialogChangedMessages
    });
    return clone;
  });

  fs.writeFileSync(outJsonPath, JSON.stringify(sanitized, null, 2), "utf8");
  fs.writeFileSync(outStatsPath, JSON.stringify(stats, null, 2), "utf8");

  const health = await startBackend();
  const prompt = {
    system_instruction: "You summarize dialogs between RU and TU in clear English.",
    rules: [
      "Return one concise paragraph.",
      "Use only details present in the dialog.",
      "Do not invent facts that are not in the messages.",
      "Use neutral wording when the dialog contains intimate content."
    ],
    output_instruction: "Return exactly one English paragraph in neutral tone."
  };
  const parameters = { temperature: 0.2, maxOutputTokens: 1024 };
  const model = { provider: "gemini", model_name: "gemini-2.5-flash" };

  const results = [];
  for (let i = 0; i < sanitized.length; i++) {
    const item = sanitized[i];
    const dialog = toInternalDialog(item, i);
    const res = await requestWithRecovery({ dialog, prompt, parameters, model });
    const rec = { index: i, date: item.date, dialog_id: dialog.dialog_id, status: res.status };
    if (res.status === 200) {
      rec.provider = res.body?.provider;
      rec.latency_ms = res.body?.latency_ms;
      rec.summary = res.body?.summary;
    } else {
      rec.error = String(res.body?.detail || JSON.stringify(res.body));
    }
    results.push(rec);
  }

  const success = results.filter((r) => r.status === 200).length;
  const failed = results.length - success;
  fs.writeFileSync(outResultsPath, JSON.stringify({ health, totalDialogs: results.length, success, failed, results }, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        outJsonPath,
        outStatsPath,
        outResultsPath,
        totalDialogs: results.length,
        success,
        failed,
        brief: results.map((r) => ({ index: r.index, date: r.date, status: r.status }))
      },
      null,
      2
    )
  );

  await stopBackend();
}

main().catch(async (e) => {
  try {
    await stopBackend();
  } catch {}
  console.error(e.stack || e.message);
  process.exit(1);
});
