import { useEffect, useMemo, useState } from 'react';
import type { ScanMeta } from '../../core/types';
import type { AppState } from '../../shared/api';
import { api, errorMessage, formatDate, formatDuration, Score, STATUS_LABELS, useToast } from '../ui';

export function History({ state }: { state: AppState }) {
  const toast = useToast();
  const [scans, setScans] = useState<ScanMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const finishedCount = state.jobs.filter((j) => j.status !== 'running' && j.status !== 'queued').length;

  const load = () => api.listScans().then(setScans);
  useEffect(() => {
    load();
  }, [finishedCount]);

  const activeIds = new Set(state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => j.id));
  const filtered = useMemo(() => (scans ?? []).filter((s) => !query || s.host.includes(query.toLowerCase()) || s.url.includes(query)), [scans, query]);

  const run = (fn: () => Promise<unknown>) => fn().catch((e) => toast(errorMessage(e), 'err'));
  const remove = async (s: ScanMeta) => {
    if (!confirm(`Usunąć skan ${s.host} z ${formatDate(s.startedAt)}? Raport i zrzuty zostaną skasowane.`)) return;
    await run(() => api.deleteScan(s.id));
    load();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Historia</h1>
        <div className="row">
          <input type="text" placeholder="Szukaj domeny…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn" onClick={() => api.openDataDir()}>
            Folder raportów
          </button>
        </div>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        {scans && !filtered.length ? (
          <div className="empty">{scans.length ? 'Brak wyników.' : 'Nie ma jeszcze żadnych skanów.'}</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Witryna</th>
                <th>Data</th>
                <th>Status</th>
                <th>Wynik</th>
                <th>Problemy</th>
                <th>Podstrony</th>
                <th>Czas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const status = activeIds.has(s.id) ? 'running' : s.status;
                const sum = s.summary;
                return (
                  <tr key={s.id}>
                    <td>
                      <b>{s.host}</b>
                      <div className="small muted">{s.url}</div>
                    </td>
                    <td>{formatDate(s.startedAt)}</td>
                    <td>
                      <span className={`status ${status === 'completed' ? 'done' : status}`}>{STATUS_LABELS[status]}</span>
                    </td>
                    <td>
                      <Score value={sum?.score} />
                    </td>
                    <td className="nowrap">
                      {sum ? (
                        <>
                          <span className="sev critical" title="Krytyczne">{sum.bySeverity.critical}</span>
                          <span className="sev high" title="Wysokie">{sum.bySeverity.high}</span>
                          <span className="sev medium" title="Średnie">{sum.bySeverity.medium}</span>
                          <span className="sev low" title="Niskie">{sum.bySeverity.low}</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{sum?.pages ?? '—'}</td>
                    <td>{formatDuration(s.durationMs)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {status === 'completed' && (
                          <>
                            <button className="btn small primary" onClick={() => run(() => api.openReport(s.id))}>
                              Raport
                            </button>
                            <button className="btn small" onClick={() => run(() => api.exportPdf(s.id))}>
                              PDF
                            </button>
                            <button className="btn small" onClick={() => run(() => api.exportHtml(s.id))}>
                              HTML
                            </button>
                          </>
                        )}
                        {(status === 'cancelled' || status === 'failed') && (
                          <button className="btn small primary" onClick={() => run(() => api.resumeScan(s.id))}>
                            Wznów
                          </button>
                        )}
                        <button className="btn small" title="Pokaż w Finderze" onClick={() => run(() => api.revealScan(s.id))}>
                          Finder
                        </button>
                        {status !== 'running' && (
                          <button className="btn small danger" title="Usuń" onClick={() => remove(s)}>
                            Usuń
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
