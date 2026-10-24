import { useEffect, useRef, useState } from 'react';
import { CATEGORY_LABELS, DEFAULT_AI_MODELS, DEFAULT_VIEWPORTS, ENGINE_LABELS } from '../../core/defaults';
import type { AiProvider, DeviceCategory, ViewportDef } from '../../core/types';
import type { AppSettings, BrowserInfo } from '../../shared/api';
import { api, Check, errorMessage, Segmented, useToast } from '../ui';

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
];

function Browsers() {
  const toast = useToast();
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.browserInfo().then((i) => {
      setInfo(i);
      setBusy(i.installing);
    });
    return api.onBrowsersLog((line) =>
      setLog((l) => {
        const isBar = line.startsWith('|');
        const prev = l.length && l[l.length - 1].startsWith('|') ? l.slice(0, -1) : l;
        return [...(isBar ? prev : l).slice(-200), line];
      }),
    );
  }, []);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log.length]);

  const install = async () => {
    setBusy(true);
    setLog([]);
    let ok = false;
    try {
      ok = await api.installBrowsers();
    } catch (e) {
      setLog((l) => [...l, `Błąd: ${errorMessage(e)}`]);
    } finally {
      setBusy(false);
      setInfo(await api.browserInfo());
    }
    toast(ok ? 'Przeglądarki zainstalowane.' : 'Instalacja nie powiodła się — sprawdź dziennik.', ok ? 'ok' : 'err');
  };

  const allInstalled = info?.engines.every((e) => e.installed);
  return (
    <div className="panel">
      <h2>Przeglądarki testowe</h2>
      {info && (
        <div className="row" style={{ gap: 24, marginBottom: 12 }}>
          {info.engines.map((e) => (
            <span key={e.engine}>
              <span className="engine-dot" style={{ background: e.installed ? '#1f9d55' : '#d9363e' }} />
              {ENGINE_LABELS[e.engine]} — {e.installed ? 'zainstalowana' : 'brak'}
            </span>
          ))}
          <span className="muted">Google Chrome w systemie: {info.systemChrome ? 'tak' : 'nie'}</span>
        </div>
      )}
      <div className="row">
        <button className={`btn ${allInstalled ? '' : 'primary'}`} disabled={busy} onClick={install}>
          {busy ? 'Instaluję…' : allInstalled ? 'Zaktualizuj / zainstaluj ponownie' : 'Zainstaluj przeglądarki'}
        </button>
        <span className="hint">Jednorazowo ok. 400 MB do ~/Library/Caches/ms-playwright.</span>
      </div>
      {log.length > 0 && (
        <div className="log" ref={logRef} style={{ marginTop: 12, maxHeight: 180 }}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Ai({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const toast = useToast();
  const provider = settings.aiProvider;
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings.aiModels[provider]);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setModel(settings.aiModels[provider]);
    setModels([]);
  }, [provider]);

  const saveModel = async (m: string) => onSettings(await api.saveSettings({ aiModels: { ...settings.aiModels, [provider]: m.trim() || DEFAULT_AI_MODELS[provider] } }));

  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Analiza AI</h2>
      <Segmented value={provider} options={PROVIDERS} onChange={async (p) => onSettings(await api.saveSettings({ aiProvider: p }))} />
      <div className="grid2" style={{ marginTop: 14 }}>
        <label className="field">
          <span>Klucz API {settings.hasKey[provider] && <span style={{ color: '#1f9d55' }}>✓ zapisany</span>}</span>
          <div className="row">
            <input
              type="password"
              style={{ flex: 1 }}
              placeholder={settings.hasKey[provider] ? '••••••••••••' : provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="btn primary"
              disabled={!key.trim() || busy}
              onClick={() =>
                action(async () => {
                  onSettings(await api.setApiKey(provider, key));
                  setKey('');
                  toast('Klucz zapisany w pęku kluczy macOS.');
                })
              }
            >
              Zapisz
            </button>
            {settings.hasKey[provider] && (
              <button className="btn danger" onClick={() => action(async () => onSettings(await api.setApiKey(provider, '')))}>
                Usuń
              </button>
            )}
          </div>
          <span className="hint">Klucz jest szyfrowany i nie trafia do raportów.</span>
        </label>
        <label className="field">
          <span>Model</span>
          <div className="row">
            <input type="text" list="ai-models" style={{ flex: 1 }} value={model} onChange={(e) => setModel(e.target.value)} onBlur={() => saveModel(model)} />
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              className="btn"
              disabled={!settings.hasKey[provider] || busy}
              onClick={() =>
                action(async () => {
                  const list = await api.listModels(provider);
                  setModels(list);
                  toast(`Pobrano ${list.length} modeli — wybierz z listy w polu „Model”.`);
                })
              }
            >
              Lista modeli
            </button>
          </div>
          <span className="hint">Model musi obsługiwać obrazy. Domyślnie: {DEFAULT_AI_MODELS[provider]}.</span>
        </label>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn"
          disabled={!settings.hasKey[provider] || busy}
          onClick={() =>
            action(async () => {
              await saveModel(model);
              const reply = await api.testAi(provider, model);
              toast(`Połączenie działa: ${reply.slice(0, 80)}`);
            })
          }
        >
          {busy ? 'Sprawdzam…' : 'Testuj połączenie'}
        </button>
      </div>
    </div>
  );
}

function Viewports({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const toast = useToast();
  const [list, setList] = useState<ViewportDef[]>(settings.defaults.viewports);
  const dirty = JSON.stringify(list) !== JSON.stringify(settings.defaults.viewports);
  const upd = (i: number, patch: Partial<ViewportDef>) => setList(list.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  const save = async () => {
    const order: DeviceCategory[] = ['phone', 'tablet', 'desktop'];
    const clean = list
      .filter((v) => v.width >= 200 && v.height >= 200)
      .map((v) => ({ ...v, id: v.id || `${v.category}-${v.width}x${v.height}-${Math.random().toString(36).slice(2, 6)}` }))
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.width - b.width);
    setList(clean);
    onSettings(await api.saveSettings({ defaults: { ...settings.defaults, viewports: clean } }));
    toast('Zapisano rozdzielczości.');
  };

  return (
    <div className="panel">
      <h2>Rozdzielczości</h2>
      <table className="list vp-table">
        <thead>
          <tr>
            <th>Włączona</th>
            <th>Nazwa</th>
            <th>Typ</th>
            <th>Szerokość</th>
            <th>Wysokość</th>
            <th>Gęstość (DPR)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((v, i) => (
            <tr key={v.id || i}>
              <td>
                <input type="checkbox" checked={v.enabled} onChange={(e) => upd(i, { enabled: e.target.checked })} />
              </td>
              <td>
                <input type="text" value={v.label} onChange={(e) => upd(i, { label: e.target.value })} />
              </td>
              <td>
                <select value={v.category} onChange={(e) => upd(i, { category: e.target.value as DeviceCategory })}>
                  {(Object.keys(CATEGORY_LABELS) as DeviceCategory[]).map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="number" value={v.width} onChange={(e) => upd(i, { width: Number(e.target.value) })} />
              </td>
              <td>
                <input type="number" value={v.height} onChange={(e) => upd(i, { height: Number(e.target.value) })} />
              </td>
              <td>
                <input type="number" value={v.deviceScaleFactor} min={1} max={4} step={0.5} onChange={(e) => upd(i, { deviceScaleFactor: Number(e.target.value) })} />
              </td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn small danger" onClick={() => setList(list.filter((_, j) => j !== i))}>
                  Usuń
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            setList([...list, { id: '', label: 'Nowa rozdzielczość', category: 'phone', width: 375, height: 667, deviceScaleFactor: 2, enabled: true }])
          }
        >
          Dodaj
        </button>
        <button className="btn" onClick={() => setList(DEFAULT_VIEWPORTS.map((v) => ({ ...v })))}>
          Przywróć domyślne
        </button>
        <button className="btn primary" disabled={!dirty} onClick={save}>
          Zapisz
        </button>
      </div>
    </div>
  );
}

function SiteRulesPanel({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const hosts = Object.keys(settings.siteRules).sort();
  return (
    <div className="panel">
      <h2>Ignorowane problemy i elementy</h2>
      <div className="hint" style={{ marginBottom: 12 }}>
        Dodawane z poziomu raportu (przyciski „Ignoruj…”). Działają w kolejnych skanach danej witryny.
      </div>
      {!hosts.length && <div className="muted">Brak reguł.</div>}
      {hosts.map((h) => {
        const r = settings.siteRules[h];
        return (
          <div key={h} style={{ marginBottom: 14 }}>
            <b>{h}</b>
            <div style={{ marginTop: 6 }}>
              {r.ignoreSelectors.map((s) => (
                <span key={s} className="tag">
                  element <code>{s}</code>
                  <button title="Usuń" onClick={async () => onSettings(await api.removeSiteRule(h, 'selector', s))}>
                    ×
                  </button>
                </span>
              ))}
              {r.ignoredFingerprints.map((f) => (
                <span key={f.fingerprint} className="tag" title={f.fingerprint}>
                  {f.title || 'problem'}: <code>{f.fingerprint.split('|').slice(1).join('|').slice(0, 50)}</code>
                  <button title="Usuń" onClick={async () => onSettings(await api.removeSiteRule(h, 'fingerprint', f.fingerprint))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Settings(props: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const { settings, onSettings } = props;
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  useEffect(() => {
    api.appInfo().then(setInfo);
  }, []);

  return (
    <div>
      <h1>Ustawienia</h1>
      <Browsers />
      <Ai settings={settings} onSettings={onSettings} />
      <Viewports settings={settings} onSettings={onSettings} />
      <SiteRulesPanel settings={settings} onSettings={onSettings} />
      <div className="panel">
        <h2>Aplikacja</h2>
        <div className="grid2">
          <Check
            checked={settings.notifications}
            onChange={async (v) => onSettings(await api.saveSettings({ notifications: v }))}
            label="Powiadomienia po zakończeniu skanu"
          />
          <Check
            checked={settings.launchAtLogin}
            onChange={async (v) => onSettings(await api.saveSettings({ launchAtLogin: v }))}
            label="Uruchamiaj przy logowaniu"
            hint="Potrzebne do zaplanowanych skanów."
          />
        </div>
        {info && (
          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted">
              Raporty: <code>{info.dataDir}</code>
            </span>
            <button className="btn small" onClick={() => api.openDataDir()}>
              Otwórz
            </button>
            <span className="muted">· wersja {info.version}</span>
          </div>
        )}
      </div>
    </div>
  );
}
