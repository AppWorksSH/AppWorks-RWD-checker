import { useEffect, useRef, useState } from 'react';
import type { ScanPhase } from '../../core/types';
import type { AppState, JobState } from '../../shared/api';
import { api, errorMessage, formatDuration, PHASE_LABELS, Score, STATUS_LABELS, useToast } from '../ui';

const STEPS: ScanPhase[] = ['discovery', 'links', 'audit', 'sweep', 'ai', 'report'];

function Elapsed({ from, to }: { from?: string; to?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [to]);
  if (!from) return <>—</>;
  return <>{formatDuration((to ? Date.parse(to) : Date.now()) - Date.parse(from))}</>;
}

export function JobActions({ id, status }: { id: string; status: string }) {
  const toast = useToast();
  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errorMessage(e), 'err'));
  return (
    <div className="row">
      {status === 'done' && (
        <>
          <button className="btn primary" onClick={() => run(() => api.openReport(id))}>
            Otwórz raport
          </button>
          <button className="btn" onClick={() => run(() => api.exportPdf(id))}>
            PDF
          </button>
          <button className="btn" onClick={() => run(() => api.exportHtml(id))}>
            Jeden plik HTML
          </button>
        </>
      )}
      {(status === 'cancelled' || status === 'failed') && (
        <button className="btn primary" onClick={() => run(() => api.resumeScan(id))}>
          Wznów
        </button>
      )}
      <button className="btn" onClick={() => run(() => api.revealScan(id))}>
        Pokaż w Finderze
      </button>
    </div>
  );
}

function JobCard({ job }: { job: JobState }) {
  const logRef = useRef<HTMLDivElement>(null);
  const active = job.status === 'running' || job.status === 'queued';
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job.logs.length]);
  const phaseIdx = job.phase ? STEPS.indexOf(job.phase) : -1;
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const s = job.meta?.summary;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{job.meta?.host ?? job.url}</h2>
          <span className={`status ${job.status}`}>{STATUS_LABELS[job.status]}</span>
          <span className="muted small">
            {' '}
            · czas: <Elapsed from={job.startedAt} to={job.finishedAt} />
          </span>
        </div>
        {active ? (
          <button className="btn danger" onClick={() => api.cancelScan(job.id)}>
            {job.status === 'queued' ? 'Usuń z kolejki' : 'Przerwij'}
          </button>
        ) : (
          <JobActions id={job.id} status={job.status} />
        )}
      </div>

      {job.status === 'running' && (
        <>
          <div className="steps">
            {STEPS.map((p, i) => (
              <span key={p} className={`step ${i < phaseIdx || job.phase === 'done' ? 'done' : i === phaseIdx ? 'current' : ''}`}>
                {PHASE_LABELS[p]}
              </span>
            ))}
          </div>
          <div className={`progress ${job.total ? '' : 'indeterminate'}`}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="row small muted" style={{ marginTop: 6, justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{job.message ?? ''}</span>
            <span>{job.total ? `${job.done} / ${job.total}` : ''}</span>
          </div>
          <div className="stats">
            <div>
              <span className="muted small">Wykryte problemy</span>
              <b>{job.issues}</b>
            </div>
          </div>
        </>
      )}

      {job.status === 'done' && s && (
        <div className="stats">
          <div>
            <span className="muted small">Wynik RWD</span>
            <Score value={s.score} />
          </div>
          <div>
            <span className="muted small">Podstrony</span>
            <b>{s.pages}</b>
          </div>
          <div>
            <span className="muted small">Widoki</span>
            <b>{s.tasks}</b>
          </div>
          <div>
            <span className="muted small">Problemy</span>
            <div>
              <span className="sev critical">{s.bySeverity.critical}</span>
              <span className="sev high">{s.bySeverity.high}</span>
              <span className="sev medium">{s.bySeverity.medium}</span>
              <span className="sev low">{s.bySeverity.low}</span>
            </div>
          </div>
        </div>
      )}

      {job.error && <div className="alert err" style={{ marginTop: 12 }}>{job.error}</div>}

      {job.logs.length > 0 && (
        <details open={active} style={{ marginTop: 14 }}>
          <summary className="small muted">Dziennik ({job.logs.length})</summary>
          <div className="log" ref={logRef} style={{ marginTop: 8 }}>
            {job.logs.map((l, i) => (
              <div key={i} className={l.level}>
                <span className="time">{new Date(l.at).toLocaleTimeString('pl-PL')}</span>
                {l.message}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function Progress({ state, onNew }: { state: AppState; onNew: () => void }) {
  if (!state.jobs.length)
    return (
      <div>
        <h1>Skany</h1>
        <div className="panel empty">
          Brak skanów w tej sesji.
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onNew}>
              Nowy skan
            </button>
          </div>
        </div>
      </div>
    );
  const finished = state.jobs.some((j) => j.status !== 'running' && j.status !== 'queued');
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Skany</h1>
        {finished && (
          <button className="btn" onClick={() => api.clearFinished()}>
            Wyczyść zakończone
          </button>
        )}
      </div>
      {state.jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  );
}
