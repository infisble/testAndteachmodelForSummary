import { useMemo, useState } from 'react';
import { defaultPrompt } from './defaultPrompt';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
};

export default function App() {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SummaryItem>>({});
  const [promptText, setPromptText] = useState(() => JSON.stringify(defaultPrompt, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState('mock');
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('us-central1');
  const [endpointId, setEndpointId] = useState('');
  const [instanceTemplate, setInstanceTemplate] = useState('{"prompt": "{prompt}"}');
  const [temperature, setTemperature] = useState('0.2');
  const [maxTokens, setMaxTokens] = useState('512');

  const selectedDialog = useMemo(
    () => dialogs.find((dialog) => dialog.dialog_id === selectedId) || null,
    [dialogs, selectedId]
  );

  const dialogStats = useMemo(() => {
    if (!selectedDialog) return null;
    const messageCount = selectedDialog.messages.length;
    const lastTimestamp = selectedDialog.messages[messageCount - 1]?.timestamp || '';
    return { messageCount, lastTimestamp };
  }, [selectedDialog]);

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

  const buildModelConfig = () => {
    let instanceJson: Record<string, unknown> | undefined;
    if (instanceTemplate.trim()) {
      instanceJson = JSON.parse(instanceTemplate);
    }
    const model: Record<string, unknown> = {
      provider
    };
    if (projectId.trim()) model.project_id = projectId.trim();
    if (location.trim()) model.location = location.trim();
    if (endpointId.trim()) model.endpoint_id = endpointId.trim();
    if (instanceJson) model.instance_template = instanceJson;
    return model;
  };

  const buildParameters = () => {
    const params: Record<string, number> = {};
    if (temperature.trim()) params.temperature = Number(temperature);
    if (maxTokens.trim()) params.maxOutputTokens = Number(maxTokens);
    return params;
  };

  const runSingle = async () => {
    if (!selectedDialog) return;
    setError(null);
    setBusy(true);
    try {
      const payload = {
        dialog: selectedDialog,
        prompt: parsePrompt(),
        parameters: buildParameters(),
        model: buildModelConfig()
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
      setSummaries((prev) => ({ ...prev, [selectedDialog.dialog_id]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runBatch = async () => {
    if (!dialogs.length) return;
    setError(null);
    setBusy(true);
    try {
      const payload = {
        dialogs,
        prompt: parsePrompt(),
        parameters: buildParameters(),
        model: buildModelConfig()
      };
      const response = await fetch(`${API_BASE}/api/summarize-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = await response.json();
      const map: Record<string, SummaryItem> = {};
      for (const item of result.items || []) {
        map[item.dialog_id] = {
          summary: item.summary,
          latency_ms: item.latency_ms,
          provider: item.provider
        };
      }
      setSummaries(map);
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
          <p className="subtitle">
            Upload dialog JSON, send it to Vertex endpoints, and review factual summaries in one place.
          </p>
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
          <button className="primary" onClick={runSingle} disabled={busy || !selectedDialog}>
            Run selected
          </button>
          <button className="ghost" onClick={runBatch} disabled={busy || !dialogs.length}>
            Run batch
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
          <h2>Model</h2>
          <div className="field">
            <label>Provider</label>
            <select value={provider} onChange={(event) => setProvider(event.target.value)}>
              <option value="mock">Mock</option>
              <option value="vertex">Vertex endpoint</option>
            </select>
          </div>
          <div className="field">
            <label>Project ID</label>
            <input value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="gcp-project" />
          </div>
          <div className="field">
            <label>Location</label>
            <input value={location} onChange={(event) => setLocation(event.target.value)} />
          </div>
          <div className="field">
            <label>Endpoint ID</label>
            <input value={endpointId} onChange={(event) => setEndpointId(event.target.value)} placeholder="123456789" />
          </div>
          <div className="field">
            <label>Instance template</label>
            <textarea
              value={instanceTemplate}
              onChange={(event) => setInstanceTemplate(event.target.value)}
              spellCheck={false}
            />
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
                  <span>Messages: {dialogStats.messageCount} | Last: {dialogStats.lastTimestamp}</span>
                )}
              </div>
              <div className="conversation-body">
                {selectedDialog.messages.map((msg, index) => (
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
                <span>Latency: {selectedSummary.latency_ms} ms</span>
                {summaryStats && (
                  <span>Words: {summaryStats.wordCount} | Chars: {summaryStats.charCount}</span>
                )}
              </div>
              <p>{selectedSummary.summary}</p>
            </div>
          ) : (
            <p className="placeholder">Run a summary to see results.</p>
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
