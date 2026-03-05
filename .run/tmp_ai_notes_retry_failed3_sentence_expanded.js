const fs = require("fs");
const { spawn } = require("child_process");

const root = "C:/works/bescosial/testAndteachmodelForSummary";
const srcPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.json";
const outSanitizedPath = "C:/Users/Lenovo/Downloads/Telegram Desktop/ai_notes.failed3.sentence-sanitized-expanded.json";
const outResultsPath = `${root}/.run/ai_notes-failed3-sentence-sanitized-expanded-results.json`;
const port = 8024;
const targetIndexes = new Set([1, 3, 5]);

function parseWithFix(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replace(/,(\s*[}\]])/g, "$1"));
  }
}

const markers = [
  "ride my dick",
  "ass fuck",
  "ride you",
  "deepthroat",
  "blowjob",
  "fucking",
  "orgasm",
  "horny",
  "pussy",
  "throat",
  "dick",
  "cum",
  "ass",
  "fist",
  "tit's",
  "tit",
  "fuck",
  "sex",
  "sexual",
  "sexy",
  "aroused",
  "climax",
  "come",
  "cock",
  "penis",
  "vagina",
  "suck",
  "ride",
  "tits",
  "boob",
  "boobs",
  "breast",
  "breasts",
  "naked",
  "nude",
  "kiss",
  "kissing",
  "toy",
  "toys",
  "butt",
  "spank",
  "photo",
  "picture",
  "pic"
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const markerRe = new RegExp(markers.map(escapeRegex).sort((a, b) => b.length - a.length).join("|"), "i");

function sanitizeSentenceLevel(content) {
  if (typeof content !== "string" || !content) {
    return { text: typeof content === "string" ? content : "", changed: false, replacedSentences: 0 };
  }

  // Sentence-ish split (dot/exclamation/question). Keeps separators.
  const parts = content.split(/([.!?]+(?:\s+|$))/);
  let changed = false;
  let replacedSentences = 0;
  const out = [];

  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] || "";
    const sep = parts[i + 1] || "";
    if (!sentence) {
      if (sep) out.push(sep);
      continue;
    }
    if (markerRe.test(sentence)) {
      changed = true;
      replacedSentences += 1;
      out.push("[explicit message omitted]");
      if (sep) out.push(sep);
    } else {
      out.push(sentence);
      if (sep) out.push(sep);
    }
  }

  const text = out
    .join("")
    .replace(/(?:\[explicit message omitted\](?:\s*[.!?]+\s*)?){2,}/g, "[explicit message omitted] ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { text, changed, replacedSentences };
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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    clearTimeout(timer);
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

  const picked = [];
  const sanitizeStats = [];
  for (let i = 0; i < source.length; i++) {
    if (!targetIndexes.has(i)) continue;
    const item = source[i];
    let changedMessages = 0;
    let replacedSentences = 0;
    const clone = { ...item };
    if (Array.isArray(clone.dialog)) {
      clone.dialog = clone.dialog.map((msg) => {
        if (!msg || typeof msg !== "object") return msg;
        const res = sanitizeSentenceLevel(msg.content);
        if (res.changed) {
          changedMessages += 1;
          replacedSentences += res.replacedSentences;
          return { ...msg, content: res.text };
        }
        return msg;
      });
    }
    sanitizeStats.push({
      index: i,
      date: clone.date,
      totalMessages: Array.isArray(clone.dialog) ? clone.dialog.length : 0,
      changedMessages,
      replacedSentences
    });
    picked.push({ index: i, item: clone });
  }

  fs.writeFileSync(
    outSanitizedPath,
    JSON.stringify(picked.map((x) => ({ ...x.item, __sourceIndex: x.index })), null, 2),
    "utf8"
  );

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
  for (const { index, item } of picked) {
    const dialog = toInternalDialog(item, index);
    const res = await requestWithRecovery({ dialog, prompt, parameters, model });
    const rec = { index, date: item.date, dialog_id: dialog.dialog_id, status: res.status };
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

  fs.writeFileSync(
    outResultsPath,
    JSON.stringify({ health, totalDialogs: results.length, success, failed, sanitizeStats, results }, null, 2),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        outSanitizedPath,
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
