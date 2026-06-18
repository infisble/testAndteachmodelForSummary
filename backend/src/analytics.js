"use strict";

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const READING_WORDS_PER_MINUTE = 220;

function analyzeDialog(dialog) {
  const messages = Array.isArray(dialog?.messages) ? dialog.messages : [];
  const participants = new Set();
  const days = new Set();
  let sourceText = "";
  const timestamps = [];

  for (const message of messages) {
    const sender = normalizeText(message?.sender);
    if (sender) {
      participants.add(sender);
    }

    const timestamp = normalizeText(message?.timestamp);
    const day = extractDay(timestamp);
    if (day) {
      days.add(day);
    }
    const parsedTime = Date.parse(timestamp);
    if (Number.isFinite(parsedTime)) {
      timestamps.push(parsedTime);
    }

    const text = normalizeText(message?.text);
    if (text) {
      sourceText += `${text}\n`;
    }
  }

  const sourceWords = countWords(sourceText);
  const sourceChars = sourceText.trim().length;
  const sortedTimes = timestamps.sort((a, b) => a - b);
  const durationMinutes =
    sortedTimes.length > 1
      ? Math.max(0, Math.round((sortedTimes[sortedTimes.length - 1] - sortedTimes[0]) / 60000))
      : 0;

  return {
    message_count: messages.length,
    participant_count: participants.size,
    day_count: days.size,
    source_words: sourceWords,
    source_chars: sourceChars,
    average_message_words: messages.length ? round(sourceWords / messages.length, 1) : 0,
    duration_minutes: durationMinutes,
    estimated_reading_minutes: round(sourceWords / READING_WORDS_PER_MINUTE, 1)
  };
}

function evaluateSummary(dialog, summary, usage = null, latencyMs = 0) {
  const source = analyzeDialog(dialog);
  const summaryText = normalizeText(summary);
  const summaryWords = countWords(summaryText);
  const summaryChars = summaryText.length;
  const compressionRatio = source.source_words > 0 ? round(summaryWords / source.source_words, 3) : 0;
  const timeSavedMinutes = Math.max(
    0,
    round((source.source_words - summaryWords) / READING_WORDS_PER_MINUTE, 1)
  );
  const keywordCoverage = calculateKeywordCoverage(dialog, summaryText);
  const gates = buildQualityGates({
    sourceWords: source.source_words,
    summaryWords,
    compressionRatio,
    keywordCoverage,
    latencyMs,
    usage
  });

  return {
    source,
    summary: {
      words: summaryWords,
      chars: summaryChars,
      compression_ratio: compressionRatio,
      keyword_coverage: keywordCoverage,
      estimated_time_saved_minutes: timeSavedMinutes
    },
    quality: {
      score: calculateScore(gates),
      gates
    }
  };
}

function buildQualityGates(input) {
  const gates = [];
  gates.push({
    id: "concise",
    label: "Concise output",
    status: input.summaryWords > 0 && input.compressionRatio <= 0.35 ? "pass" : "warn",
    detail: `summary/source word ratio ${input.compressionRatio}`
  });
  gates.push({
    id: "substantive",
    label: "Substantive enough",
    status: input.summaryWords >= 12 || input.sourceWords < 40 ? "pass" : "warn",
    detail: `${input.summaryWords} summary words`
  });
  gates.push({
    id: "coverage",
    label: "Keyword coverage",
    status: input.keywordCoverage >= 0.25 || input.sourceWords < 60 ? "pass" : "warn",
    detail: `${Math.round(input.keywordCoverage * 100)}% source keyword overlap`
  });
  gates.push({
    id: "latency",
    label: "Latency budget",
    status: Number(input.latencyMs || 0) <= 8000 ? "pass" : "warn",
    detail: `${Number(input.latencyMs || 0)} ms`
  });

  if (input.usage && Number.isFinite(Number(input.usage.total_tokens))) {
    gates.push({
      id: "token_budget",
      label: "Token budget",
      status: Number(input.usage.total_tokens) <= 2000 ? "pass" : "warn",
      detail: `${input.usage.total_tokens} total tokens`
    });
  }

  return gates;
}

function calculateScore(gates) {
  if (!gates.length) {
    return 0;
  }
  const passed = gates.filter((gate) => gate.status === "pass").length;
  return Math.round((passed / gates.length) * 100);
}

function calculateKeywordCoverage(dialog, summary) {
  const messages = Array.isArray(dialog?.messages) ? dialog.messages : [];
  const sourceWords = new Map();
  for (const message of messages) {
    for (const word of tokenize(message?.text)) {
      if (word.length >= 5) {
        sourceWords.set(word, (sourceWords.get(word) || 0) + 1);
      }
    }
  }

  const topKeywords = Array.from(sourceWords.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);

  if (!topKeywords.length) {
    return 0;
  }

  const summaryWords = new Set(tokenize(summary));
  const matched = topKeywords.filter((word) => summaryWords.has(word)).length;
  return round(matched / topKeywords.length, 3);
}

function tokenize(value) {
  return normalizeText(value).toLowerCase().match(WORD_RE) || [];
}

function countWords(value) {
  return tokenize(value).length;
}

function normalizeText(value) {
  return value === undefined || value === null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function extractDay(timestamp) {
  const text = normalizeText(timestamp);
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const dotMatch = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  }
  return "";
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

module.exports = {
  analyzeDialog,
  evaluateSummary
};
