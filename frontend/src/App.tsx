import { useEffect, useMemo, useState } from 'react';
import { defaultPrompt } from './defaultPrompt';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_PROVIDER = import.meta.env.VITE_MODEL_PROVIDER || 'mock';
const ALL_DAYS = '__all_days__';
const PROVIDER_OPTIONS = [
  { value: 'mock', label: 'Mock' },
  { value: 'gemini', label: 'Gemini API' },
  { value: 'vertex', label: 'Vertex AI Endpoint' }
] as const;
const MODEL_OPTIONS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'flashlight', label: 'Gemini 2.5 Flashlight (alias)' }
] as const;

type Message = {
  sender?: string;
  timestamp: string;
  text: string;
};

type Dialog = {
  dialog_id: string;
  ru_name?: string;
  tu_name?: string;
  ru_id?: number;
  tu_id?: number;
  messages: Message[];
};

type PromptConfig = {
  system_instruction: string;
  rules: string[];
  output_instruction: string;
  max_message_chars?: number;
  max_merged_line_chars?: number;
};

type SummaryItem = {
  summary: string;
  latency_ms: number;
  provider: string;
  model_name: string;
  usage?: {
    prompt_tokens: number;
    output_tokens: number;
    thoughts_tokens: number;
    total_tokens: number;
  } | null;
  evaluation?: Evaluation | null;
};

type Evaluation = {
  source: {
    message_count: number;
    participant_count: number;
    day_count: number;
    source_words: number;
    source_chars: number;
    average_message_words: number;
    duration_minutes: number;
    estimated_reading_minutes: number;
  };
  summary: {
    words: number;
    chars: number;
    compression_ratio: number;
    keyword_coverage: number;
    estimated_time_saved_minutes: number;
  };
  quality: {
    score: number;
    gates: Array<{
      id: string;
      label: string;
      status: 'pass' | 'warn';
      detail: string;
    }>;
  };
};

type RunHistoryItem = {
  id: string;
  dialog_id: string;
  day: string;
  provider: string;
  model_name: string;
  latency_ms: number;
  quality_score: number;
  time_saved_minutes: number;
};

function extractDay(timestamp: string): string | null {
  const isoMatch = timestamp.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const dotMatch = timestamp.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotMatch) {
    return `${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}`;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDay(day: string): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return day;
  }
  return parsed.toLocaleDateString('ru-RU');
}

export default function App() {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>(ALL_DAYS);
  const [summaries, setSummaries] = useState<Record<string, SummaryItem>>({});
  const [runHistory, setRunHistory] = useState<RunHistoryItem[]>([]);
  const [promptText, setPromptText] = useState(() => JSON.stringify(defaultPrompt, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [temperature, setTemperature] = useState('0.2');
  const [maxTokens, setMaxTokens] = useState('300');
  const [selectedProvider, setSelectedProvider] = useState<string>(DEFAULT_PROVIDER);
  const [selectedModelName, setSelectedModelName] = useState<string>(DEFAULT_GEMINI_MODEL);

  const selectedDialog = useMemo(
    () => dialogs.find((dialog) => dialog.dialog_id === selectedId) || null,
    [dialogs, selectedId]
  );

  const availableDays = useMemo(() => {
    if (!selectedDialog) return [];

    const daySet = new Set<string>();
    for (const msg of selectedDialog.messages) {
      const day = extractDay(msg.timestamp);
      if (day) daySet.add(day);
    }

    return Array.from(daySet).sort();
  }, [selectedDialog]);

  useEffect(() => {
    if (!selectedDialog) {
      setSelectedDay(ALL_DAYS);
      return;
    }

    if (!availableDays.length) {
      setSelectedDay(ALL_DAYS);
      return;
    }

    setSelectedDay((current) => {
      if (current !== ALL_DAYS && availableDays.includes(current)) {
        return current;
      }
      return availableDays[availableDays.length - 1];
    });
  }, [selectedDialog, availableDays]);

  const filteredMessages = useMemo(() => {
    if (!selectedDialog) return [];
    if (selectedDay === ALL_DAYS) return selectedDialog.messages;

    return selectedDialog.messages.filter((msg) => extractDay(msg.timestamp) === selectedDay);
  }, [selectedDialog, selectedDay]);

  const dialogStats = useMemo(() => {
    if (!selectedDialog) return null;
    const messageCount = filteredMessages.length;
    const lastTimestamp = filteredMessages[messageCount - 1]?.timestamp || '';
    return { messageCount, lastTimestamp };
  }, [selectedDialog, filteredMessages]);

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_BASE}/api/parse`, {
        method: 'POST',
        body: form
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = await response.json();
      setDialogs(payload.dialogs || []);
      setSelectedId(payload.dialogs?.[0]?.dialog_id || null);
      setSummaries({});
      setRunHistory([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const parsePrompt = (): PromptConfig => {
    const parsed = JSON.parse(promptText);
    return parsed as PromptConfig;
  };

  const buildParameters = () => {
    const params: Record<string, number> = {};
    if (temperature.trim()) {
      const parsedTemperature = Number(temperature);
      if (Number.isFinite(parsedTemperature)) {
        params.temperature = Math.min(2, Math.max(0, parsedTemperature));
      }
    }
    if (maxTokens.trim()) {
      const parsedMaxTokens = Number(maxTokens);
      if (Number.isFinite(parsedMaxTokens) && parsedMaxTokens > 0) {
        params.maxOutputTokens = Math.min(512, Math.max(32, Math.round(parsedMaxTokens)));
      }
    }
    return params;
  };

  const runStart = async () => {
    if (!selectedDialog) return;
    if (!filteredMessages.length) {
      setError('Для выбранного дня нет сообщений.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const payload = {
        dialog: { ...selectedDialog, messages: filteredMessages },
        prompt: parsePrompt(),
        parameters: buildParameters(),
        model: { provider: selectedProvider, model_name: selectedModelName }
      };
      const response = await fetch(`${API_BASE}/api/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = await response.json();
      setSummaries((prev) => ({
        ...prev,
        [selectedDialog.dialog_id]: {
          ...result,
          model_name: selectedModelName
        }
      }));
      setRunHistory((prev) => [
        {
          id: `${selectedDialog.dialog_id}-${Date.now()}`,
          dialog_id: selectedDialog.dialog_id,
          day: selectedDay,
          provider: result.provider,
          model_name: selectedModelName,
          latency_ms: result.latency_ms,
          quality_score: result.evaluation?.quality?.score ?? 0,
          time_saved_minutes: result.evaluation?.summary?.estimated_time_saved_minutes ?? 0
        },
        ...prev
      ].slice(0, 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedSummary = selectedDialog ? summaries[selectedDialog.dialog_id] : null;
  const portfolioStats = useMemo(() => {
    const totalMessages = dialogs.reduce((sum, dialog) => sum + dialog.messages.length, 0);
    const completed = Object.values(summaries).filter((item) => item.summary);
    const totalSaved = completed.reduce(
      (sum, item) => sum + (item.evaluation?.summary?.estimated_time_saved_minutes || 0),
      0
    );
    const avgQuality = completed.length
      ? Math.round(completed.reduce((sum, item) => sum + (item.evaluation?.quality?.score || 0), 0) / completed.length)
      : 0;
    const avgLatency = completed.length
      ? Math.round(completed.reduce((sum, item) => sum + item.latency_ms, 0) / completed.length)
      : 0;

    return {
      totalDialogs: dialogs.length,
      totalMessages,
      completed: completed.length,
      totalSaved,
      avgQuality,
      avgLatency
    };
  }, [dialogs, summaries]);

  const summaryStats = useMemo(() => {
    if (!selectedSummary?.summary) return null;
    const text = selectedSummary.summary.trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    return { wordCount, charCount: text.length };
  }, [selectedSummary]);

  const exportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      portfolio: portfolioStats,
      runs: runHistory,
      summaries
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dialog-summary-report.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Context Model Evaluator</p>
          <h1>Dialog Summary Studio</h1>
          <p className="subtitle">Upload dialog JSON, choose a day and model, then press Start.</p>
        </div>
        <div className="hero-actions">
          <label className="file-input">
            <input
              type="file"
              accept="application/json"
              onChange={(event) => event.target.files?.[0] && handleFile(event.target.files[0])}
            />
            <span>{busy ? 'Loading...' : 'Upload JSON'}</span>
          </label>
          <button className="primary" onClick={runStart} disabled={busy || !selectedDialog || !filteredMessages.length}>
            {busy ? 'Running...' : 'Start'}
          </button>
          <button className="secondary-action" onClick={exportReport} disabled={!runHistory.length}>
            Export report
          </button>
        </div>
      </header>

      <main className="grid">
        <section className="panel wide metrics-panel">
          <div className="metric-card">
            <span>Dialogs</span>
            <strong>{portfolioStats.totalDialogs}</strong>
          </div>
          <div className="metric-card">
            <span>Messages</span>
            <strong>{portfolioStats.totalMessages}</strong>
          </div>
          <div className="metric-card">
            <span>Summarized</span>
            <strong>{portfolioStats.completed}</strong>
          </div>
          <div className="metric-card">
            <span>Quality</span>
            <strong>{portfolioStats.avgQuality}%</strong>
          </div>
          <div className="metric-card">
            <span>Time saved</span>
            <strong>{portfolioStats.totalSaved.toFixed(1)}m</strong>
          </div>
          <div className="metric-card">
            <span>Avg latency</span>
            <strong>{portfolioStats.avgLatency}ms</strong>
          </div>
        </section>

        <section className="panel">
          <h2>Prompt</h2>
          <textarea
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            spellCheck={false}
          />
          <div className="panel-footer">
            <span className="hint">Prompt is JSON. Changes apply to the next run.</span>
          </div>
        </section>

        <section className="panel">
          <h2>Run Settings</h2>
          <div className="field">
            <label>Day</label>
            <select
              value={selectedDay}
              onChange={(event) => setSelectedDay(event.target.value)}
              disabled={!selectedDialog}
            >
              <option value={ALL_DAYS}>All days</option>
              {availableDays.map((day) => (
                <option key={day} value={day}>
                  {formatDay(day)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Provider</label>
            <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>
              {PROVIDER_OPTIONS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Model</label>
            <select value={selectedModelName} onChange={(event) => setSelectedModelName(event.target.value)}>
              {MODEL_OPTIONS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Temperature</label>
              <input value={temperature} onChange={(event) => setTemperature(event.target.value)} />
            </div>
            <div className="field">
              <label>Max tokens</label>
              <input
                value={maxTokens}
                inputMode="numeric"
                onChange={(event) => setMaxTokens(event.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="panel wide">
          <h2>Dialogs</h2>
          <div className="table">
            <div className="table-head">
              <div>ID</div>
              <div>RU</div>
              <div>TU</div>
              <div>Messages</div>
              <div>Summary</div>
            </div>
            {dialogs.map((dialog) => {
              const summary = summaries[dialog.dialog_id]?.summary;
              return (
                <button
                  key={dialog.dialog_id}
                  className={dialog.dialog_id === selectedId ? 'row active' : 'row'}
                  onClick={() => setSelectedId(dialog.dialog_id)}
                  type="button"
                >
                  <div>{dialog.dialog_id}</div>
                  <div>{dialog.ru_name || dialog.ru_id || '-'}</div>
                  <div>{dialog.tu_name || dialog.tu_id || '-'}</div>
                  <div>{dialog.messages.length}</div>
                  <div className="summary-cell">{summary ? summary.slice(0, 80) : '-'}</div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <h2>Conversation</h2>
          {selectedDialog ? (
            <div className="conversation">
              <div className="conversation-meta">
                <span>{selectedDialog.ru_name || 'RU'} / {selectedDialog.tu_name || 'TU'}</span>
                {dialogStats && (
                  <span>
                    Day: {selectedDay === ALL_DAYS ? 'All' : formatDay(selectedDay)} | Messages: {dialogStats.messageCount} | Last: {dialogStats.lastTimestamp}
                  </span>
                )}
              </div>
              <div className="conversation-body">
                {filteredMessages.map((msg, index) => (
                  <div key={`${msg.timestamp}-${index}`} className="bubble">
                    <div className="bubble-header">
                      <span>{msg.sender || 'UNK'}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <p>{msg.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="placeholder">Upload a dialog JSON to start.</p>
          )}
        </section>

        <section className="panel">
          <h2>Summary</h2>
          {selectedSummary ? (
            <div className="summary">
              <div className="summary-meta">
                <span>Provider: {selectedSummary.provider}</span>
                <span>Model: {selectedSummary.model_name}</span>
                <span>Latency: {selectedSummary.latency_ms} ms</span>
                {selectedSummary.usage && (
                  <span>
                    Tokens P/O/Th/T: {selectedSummary.usage.prompt_tokens} / {selectedSummary.usage.output_tokens} / {selectedSummary.usage.thoughts_tokens} / {selectedSummary.usage.total_tokens}
                  </span>
                )}
                {summaryStats && (
                  <span>Words: {summaryStats.wordCount} | Chars: {summaryStats.charCount}</span>
                )}
              </div>
              {selectedSummary.evaluation && (
                <div className="quality-grid">
                  <div className="quality-score">
                    <span>Quality</span>
                    <strong>{selectedSummary.evaluation.quality.score}%</strong>
                  </div>
                  <div className="quality-facts">
                    <span>Compression {(selectedSummary.evaluation.summary.compression_ratio * 100).toFixed(1)}%</span>
                    <span>Coverage {(selectedSummary.evaluation.summary.keyword_coverage * 100).toFixed(0)}%</span>
                    <span>Saved {selectedSummary.evaluation.summary.estimated_time_saved_minutes.toFixed(1)} min</span>
                  </div>
                  <div className="gates">
                    {selectedSummary.evaluation.quality.gates.map((gate) => (
                      <span key={gate.id} className={`gate ${gate.status}`}>
                        {gate.label}: {gate.detail}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p>{selectedSummary.summary}</p>
            </div>
          ) : (
            <p className="placeholder">Choose day and press Start.</p>
          )}
        </section>

        <section className="panel wide">
          <h2>Run History</h2>
          {runHistory.length ? (
            <div className="history-table">
              <div className="history-head">
                <div>Dialog</div>
                <div>Day</div>
                <div>Provider</div>
                <div>Model</div>
                <div>Quality</div>
                <div>Saved</div>
                <div>Latency</div>
              </div>
              {runHistory.map((run) => (
                <div className="history-row" key={run.id}>
                  <div>{run.dialog_id}</div>
                  <div>{run.day === ALL_DAYS ? 'All' : formatDay(run.day)}</div>
                  <div>{run.provider}</div>
                  <div>{run.model_name}</div>
                  <div>{run.quality_score}%</div>
                  <div>{run.time_saved_minutes.toFixed(1)}m</div>
                  <div>{run.latency_ms}ms</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="placeholder">Runs will appear here after the first summary.</p>
          )}
        </section>
      </main>

      {error && (
        <div className="toast">
          <strong>Request failed.</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
