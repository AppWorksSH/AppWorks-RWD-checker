import { createContext, useContext, type ReactNode } from 'react';
import type { ScanPhase } from '../core/types';
import type { RwdApi } from '../shared/api';

export const api: RwdApi = (window as unknown as { rwd: RwdApi }).rwd;

export const PHASE_LABELS: Record<ScanPhase, string> = {
  discovery: 'Odkrywanie podstron',
  links: 'Sprawdzanie linków',
  audit: 'Audyt widoków',
  sweep: 'Zakresy szerokości',
  ai: 'Analiza AI',
  report: 'Raport',
  done: 'Gotowe',
};

export const STATUS_LABELS: Record<string, string> = {
  queued: 'W kolejce',
  running: 'W toku',
  done: 'Zakończony',
  completed: 'Zakończony',
  cancelled: 'Przerwany',
  failed: 'Błąd',
};

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function scoreColor(score: number): string {
  return score >= 90 ? '#1f9d55' : score >= 70 ? '#7cb518' : score >= 50 ? '#e08a00' : '#d9363e';
}

export function errorMessage(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

type ToastFn = (message: string, kind?: 'ok' | 'err') => void;
export const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        {props.label}
        {props.hint && <div className="hint">{props.hint}</div>}
      </span>
    </label>
  );
}

export function NumberField(props: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  suffix?: string;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <span className="row">
        <input
          type="number"
          value={props.value}
          min={props.min}
          max={props.max}
          step={props.step}
          disabled={props.disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) props.onChange(v);
          }}
        />
        {props.suffix && <span className="muted">{props.suffix}</span>}
      </span>
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export function LinesField(props: { label: ReactNode; value: string[]; onChange: (v: string[]) => void; placeholder?: string; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <textarea
        defaultValue={props.value.join('\n')}
        placeholder={props.placeholder}
        onBlur={(e) =>
          props.onChange(
            e.target.value
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean),
          )
        }
      />
      {props.hint && <span className="hint">{props.hint}</span>}
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Score({ value }: { value?: number }) {
  if (value == null) return <span className="muted">—</span>;
  return (
    <span className="score" style={{ background: scoreColor(value) }}>
      {value}
    </span>
  );
}
