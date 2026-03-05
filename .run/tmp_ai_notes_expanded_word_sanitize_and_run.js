const fs = require("fs");
const { spawn } = require("child_process");

const root = "C:/works/bescosial/testAndteachmodelForSummary";
const srcPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.json";
const outJsonPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.word-sanitized-expanded.json";
const outStatsPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.word-sanitized-expanded.stats.json";
const outResultsPath = `${root}/.run/ai_notes-word-sanitized-expanded-summary-results.json`;
const port = 8023;

function parseWithFix(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"));
  }
}

// Combined dictionary: original phrase list + expanded suspicious words list.
const replacements = [
  ["ride my dick", "[redacted_phrase]"],
  ["ass fuck", "[redacted_phrase]"],
  ["ride you", "[redacted_phrase]"],

  ["deepthroat", "[redacted_word]"],
  ["blowjob", "[redacted_word]"],
  ["fucking", "[redacted_word]"],
  ["orgasm", "[redacted_word]"],
  ["horny", "[redacted_word]"],
  ["pussy", "[redacted_word]"],
  ["throat", "[redacted_word]"],
  ["dick", "[redacted_word]"],
  ["cum", "[redacted_word]"],
  ["ass", "[redacted_word]"],
  ["fist", "[redacted_word]"],
  ["tit's", "[redacted_word]"],
  ["tit", "[redacted_word]"],
  ["fuck", "[redacted_word]"],
  ["sex", "[redacted_word]"],

  ["sexual", "[redacted_word]"],
  ["sexy", "[redacted_word]"],
  ["aroused", "[redacted_word]"],
  ["climax", "[redacted_word]"],
  ["come", "[redacted_word]"],
  ["cock", "[redacted_word]"],
  ["penis", "[redacted_word]"],
  ["vagina", "[redacted_word]"],
  ["suck", "[redacted_word]"],
  ["ride", "[redacted_word]"],
  ["tits", "[redacted_word]"],
  ["boob", "[redacted_word]"],
  ["boobs", "[redacted_word]"],
  ["breast", "[redacted_word]"],
  ["breasts", "[redacted_word]"],
  ["naked", "[redacted_word]"],
  ["nude", "[redacted_word]"],
  ["kiss", "[redacted_word]"],
  ["kissing", "[redacted_word]"],
  ["toy", "[redacted_word]"],
  ["toys", "[redacted_word]"],
  ["butt", "[redacted_word]"],
  ["spank", "[redacted_word]"],

  // optional media/context words user asked to include
  ["photo", "[redacted_media]"],
  ["picture", "[redacted_media]"],
  ["pic", "[redacted_media]"]
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokenRegex = new RegExp(
  replacements.map(([token]) => escapeRegex(token)).sort((a, b) => b.length - a.length).join("|"),
  "gi"
);

function sanitizeContent(text, stats) {
  if (typeof text !== "string") return { text: "", changed: false };
  let changed = false;
  const replaced = text.replace(tokenRegex, (match) => {
    changed = true;
    const found = replacements.find(([token]) => token.toLowerCase() === match.toLowerCase());
    const key = found ? found[0] : match.toLowerCase();
    const replacement = found ? found[1] : "[redacted]";
    stats.hitCounts[key] = (stats.hitCounts[key] || 0) + 1;
    stats.totalReplacements += 1;
    return replacement;
  });
  return { text: replaced, changed };
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
    totalReplacements: 0,
    hitCounts: Object.fromEntries(replacements.map(([k]) => [k, 0])),
    perDialog: []
  };

  const sanitized = source.map((dialogObj, idx) => {
    let dialogChanged = false;
    let dialogChangedMessages = 0;
    let dialogReplacementsBefore = stats.totalReplacements;
    const clone = { ...dialogObj };
    if (Array.isArray(clone.dialog)) {
      clone.dialog = clone.dialog.map((msg) => {
        if (!msg || typeof msg !== "object") return msg;
        const res = sanitizeContent(msg.content, stats);
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
      changedMessages: dialogChangedMessages,
      replacements: stats.totalReplacements - dialogReplacementsBefore
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
