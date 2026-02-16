import { useEffect, useMemo, useState } from 'react';
import { defaultPrompt } from './defaultPrompt';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const ALL_DAYS = '__all_days__';
const MODEL_OPTIONS = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
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
};

type SummaryItem = {
  summary: string;
  latency_ms: number;
  provider: string;
  model_name: string;
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
  const [promptText, setPromptText] = useState(() => JSON.stringify(defaultPrompt, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [temperature, setTemperature] = useState('0.2');
  const [maxTokens, setMaxTokens] = useState('512');
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
    if (temperature.trim()) params.temperature = Number(temperature);
    if (maxTokens.trim()) params.maxOutputTokens = Number(maxTokens);
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
        model: { model_name: selectedModelName }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selectedSummary = selectedDialog ? summaries[selectedDialog.dialog_id] : null;
  const summaryStats = useMemo(() => {
    if (!selectedSummary?.summary) return null;
    const text = selectedSummary.summary.trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    return { wordCount, charCount: text.length };
  }, [selectedSummary]);

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
        </div>
      </header>

      <main className="grid">
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
              <input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} />
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
                {summaryStats && (
                  <span>Words: {summaryStats.wordCount} | Chars: {summaryStats.charCount}</span>
                )}
              </div>
              <p>{selectedSummary.summary}</p>
            </div>
          ) : (
            <p className="placeholder">Choose day and press Start.</p>
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
