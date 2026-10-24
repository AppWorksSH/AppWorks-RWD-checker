import { useState } from 'react';
import { PROFILE_LABELS, type ProfileId } from '../../core/defaults';
import type { AppSettings, Schedule as ScheduleItem } from '../../shared/api';
import { api, Check, formatDate, useToast } from '../ui';

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

function describe(s: ScheduleItem): string {
  const at = `o ${String(s.hour).padStart(2, '0')}:00`;
  return s.interval === 'daily' ? `Codziennie ${at}` : `Co tydzień (${WEEKDAYS[s.weekday]}) ${at}`;
}

export function Schedule(props: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const toast = useToast();
  const { schedules } = props.settings;
  const [draft, setDraft] = useState<Omit<ScheduleItem, 'id'>>({
    url: '',
    profile: 'standard',
    interval: 'weekly',
    weekday: 1,
    hour: 7,
    enabled: true,
  });

  const save = async (next: ScheduleItem[]) => props.onSettings(await api.saveSettings({ schedules: next }));

  const add = async () => {
    if (!draft.url.trim()) {
      toast('Podaj adres strony.', 'err');
      return;
    }
    const now = new Date();
    const passedToday = now.getHours() >= draft.hour && (draft.interval === 'daily' || now.getDay() === draft.weekday);
    await save([
      ...schedules,
      {
        ...draft,
        url: draft.url.trim(),
        id: Math.random().toString(36).slice(2, 10),
        lastRun: passedToday ? now.toISOString() : undefined,
      },
    ]);
    setDraft({ ...draft, url: '' });
    toast('Dodano zaplanowany skan.');
  };

  return (
    <div>
      <h1>Harmonogram</h1>
      <div className="alert warn">
        <span>
          Zaplanowane skany uruchamiają się, gdy aplikacja jest otwarta (może działać w tle). Włącz „Uruchamiaj przy logowaniu” w
          Ustawieniach, aby nie przegapić terminu.
        </span>
      </div>

      <div className="panel">
        <h2>Nowy zaplanowany skan</h2>
        <div className="row">
          <input
            type="url"
            placeholder="https://adres-strony.pl"
            style={{ flex: 1, minWidth: 260 }}
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          />
          <select value={draft.profile} onChange={(e) => setDraft({ ...draft, profile: e.target.value as ProfileId })}>
            {(Object.keys(PROFILE_LABELS) as ProfileId[]).map((p) => (
              <option key={p} value={p}>
                Profil: {PROFILE_LABELS[p]}
              </option>
            ))}
          </select>
          <select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value as 'daily' | 'weekly' })}>
            <option value="daily">Codziennie</option>
            <option value="weekly">Co tydzień</option>
          </select>
          {draft.interval === 'weekly' && (
            <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <select value={draft.hour} onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={add}>
            Dodaj
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Skan używa ustawień domyślnych z profilem wybranym powyżej. Po zakończeniu pojawi się powiadomienie z wynikiem.
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        {!schedules.length ? (
          <div className="empty">Brak zaplanowanych skanów.</div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Aktywny</th>
                <th>Witryna</th>
                <th>Termin</th>
                <th>Profil</th>
                <th>Ostatnie uruchomienie</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Check checked={s.enabled} label="" onChange={(v) => save(schedules.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))} />
                  </td>
                  <td>
                    <b>{s.url}</b>
                  </td>
                  <td>{describe(s)}</td>
                  <td>{PROFILE_LABELS[s.profile]}</td>
                  <td>{formatDate(s.lastRun)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn small danger" onClick={() => save(schedules.filter((x) => x.id !== s.id))}>
                      Usuń
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
