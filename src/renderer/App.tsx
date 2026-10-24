import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, AppState } from '../shared/api';
import { History } from './pages/History';
import { NewScan } from './pages/NewScan';
import { Progress } from './pages/Progress';
import { Schedule } from './pages/Schedule';
import { Settings } from './pages/Settings';
import { api, ToastContext } from './ui';

type Page = 'new' | 'progress' | 'history' | 'schedule' | 'settings';

const NAV: { id: Page; label: string }[] = [
  { id: 'new', label: 'Nowy skan' },
  { id: 'progress', label: 'Skany' },
  { id: 'history', label: 'Historia' },
  { id: 'schedule', label: 'Harmonogram' },
  { id: 'settings', label: 'Ustawienia' },
];

export function App() {
  const [page, setPage] = useState<Page>('new');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [state, setState] = useState<AppState>({ jobs: [] });
  const [version, setVersion] = useState('');
  const [toast, setToast] = useState<{ message: string; kind: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((message: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 7000 : 3500);
  }, []);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.getState().then(setState);
    api.appInfo().then((i) => setVersion(i.version));
    const offState = api.onState(setState);
    const offSettings = api.onSettingsChanged(() => api.getSettings().then(setSettings));
    return () => {
      offState();
      offSettings();
    };
  }, []);

  const active = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  if (!settings) return null;
  return (
    <ToastContext.Provider value={showToast}>
      <div className="app">
        <nav className="sidebar">
          <div className="brand">
            <span className="brand-logo">R</span> RWD Checker
          </div>
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => setPage(n.id)}>
              <span>{n.label}</span>
              {n.id === 'progress' && active > 0 && <span className="nav-badge">{active}</span>}
            </button>
          ))}
          <div className="spacer" />
          <div className="version">AppWorks · v{version}</div>
        </nav>
        <main className="main">
          <div className="drag-strip" />
          {page === 'new' && (
            <NewScan settings={settings} onSettings={setSettings} onStarted={() => setPage('progress')} goSettings={() => setPage('settings')} />
          )}
          {page === 'progress' && <Progress state={state} onNew={() => setPage('new')} />}
          {page === 'history' && <History state={state} />}
          {page === 'schedule' && <Schedule settings={settings} onSettings={setSettings} />}
          {page === 'settings' && <Settings settings={settings} onSettings={setSettings} />}
        </main>
        {toast && <div className={`toast ${toast.kind === 'err' ? 'err' : ''}`}>{toast.message}</div>}
      </div>
    </ToastContext.Provider>
  );
}
