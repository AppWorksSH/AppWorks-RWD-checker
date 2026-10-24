import { useEffect, useMemo, useState } from 'react';
import { applyProfile, CATEGORY_LABELS, ENGINE_LABELS, PROFILE_LABELS, type ProfileId } from '../../core/defaults';
import type { DeviceCategory, EngineName, ScanOptions } from '../../core/types';
import type { AppSettings, BrowserInfo } from '../../shared/api';
import { api, Check, errorMessage, LinesField, NumberField, Segmented, useToast } from '../ui';

const PROFILE_DESC: Record<ProfileId, string> = {
  quick: '3 rozdzielczości w Chrome, bez skanu zakresów, dostępności i linków. Kilka minut — do szybkiej kontroli.',
  standard: '9 rozdzielczości, Chrome + Safari (telefon i tablet), skan szerokości co 20 px, dostępność, linki.',
  full: 'Wszystko: Chrome, Safari i Firefox, skan szerokości co 10 px, linki zewnętrzne i analiza AI (jeśli jest klucz).',
};

const ENGINES: EngineName[] = ['chromium', 'webkit', 'firefox'];
const CATEGORIES: DeviceCategory[] = ['phone', 'tablet', 'desktop'];

function initialOptions(s: AppSettings, profile: ProfileId): ScanOptions {
  const o = applyProfile(s.defaults, profile);
  o.ai = { ...o.ai, provider: s.aiProvider, model: s.aiModels[s.aiProvider] };
  if (!s.hasKey[s.aiProvider]) o.ai.enabled = false;
  return o;
}

export function estimate(o: ScanOptions, pages: number) {
  const views = ENGINES.reduce(
    (sum, e) => sum + o.viewports.filter((v) => v.enabled && o.engines[e].includes(v.category)).length,
    0,
  );
  const widths = o.sweep.enabled ? Math.floor((o.sweep.to - o.sweep.from) / Math.max(1, o.sweep.step)) + 1 : 0;
  const aiImages = o.ai.enabled ? pages * o.ai.categories.length * o.ai.maxSegments : 0;
  const seconds = (pages * views * 4) / Math.max(1, o.concurrency) + pages * widths * 0.15 + (aiImages * 6) / Math.max(1, o.ai.concurrency) + 20;
  return { views, widths, aiImages, minutes: Math.max(1, Math.round(seconds / 60)), aiCost: aiImages * 0.012 };
}

export function NewScan(props: { settings: AppSettings; onSettings: (s: AppSettings) => void; onStarted: () => void; goSettings: () => void }) {
  const { settings } = props;
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState<ProfileId>(settings.profile);
  const [o, setO] = useState<ScanOptions>(() => initialOptions(settings, settings.profile));
  const [formKey, setFormKey] = useState(0);
  const [browsers, setBrowsers] = useState<BrowserInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.browserInfo().then(setBrowsers);
  }, []);

  const set = (patch: Partial<ScanOptions>) => setO((prev) => ({ ...prev, ...patch }));
  const hasKey = settings.hasKey[o.ai.provider];
  const est = useMemo(() => estimate(o, Math.min(o.maxPages, 20)), [o]);
  const engineInstalled = (e: EngineName) => browsers?.engines.find((x) => x.engine === e)?.installed ?? true;
  const chromiumMissing = browsers && !engineInstalled('chromium') && !browsers.systemChrome;
  const missingUsed = ENGINES.filter((e) => o.engines[e].length && !engineInstalled(e) && !(e === 'chromium' && browsers?.systemChrome));

  const chooseProfile = (p: ProfileId) => {
    setProfile(p);
    setO((prev) => {
      const next = applyProfile(prev, p);
      if (!hasKey) next.ai.enabled = false;
      return next;
    });
  };

  const start = async () => {
    if (!url.trim()) {
      toast('Podaj adres strony.', 'err');
      return;
    }
    setBusy(true);
    try {
      await api.startScan({ ...o, url: url.trim() });
      props.onStarted();
    } catch (e) {
      toast(errorMessage(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const saveDefaults = async () => {
    const s = await api.saveSettings({ defaults: { ...o, url: '', basicAuth: undefined }, profile });
    props.onSettings(s);
    toast('Zapisano jako ustawienia domyślne.');
  };

  const reset = () => {
    setO(initialOptions(settings, profile));
    setFormKey((k) => k + 1);
  };

  const toggleEngine = (e: EngineName, c: DeviceCategory, on: boolean) =>
    set({ engines: { ...o.engines, [e]: on ? [...o.engines[e], c] : o.engines[e].filter((x) => x !== c) } });

  return (
    <div>
      <h1>Nowy skan</h1>

      {chromiumMissing && (
        <div className="alert err">
          <span>Brak przeglądarek do testów. Zainstaluj je w Ustawieniach (jednorazowo, ok. 400 MB).</span>
          <button className="btn" onClick={props.goSettings}>
            Przejdź do ustawień
          </button>
        </div>
      )}
      {!chromiumMissing && missingUsed.length > 0 && (
        <div className="alert warn">
          <span>
            Niezainstalowane: {missingUsed.map((e) => ENGINE_LABELS[e]).join(', ')} — te widoki zostaną pominięte.
          </span>
          <button className="btn" onClick={props.goSettings}>
            Zainstaluj
          </button>
        </div>
      )}

      <div className="panel">
        <div className="row">
          <input
            className="url-input"
            type="url"
            placeholder="https://adres-strony.pl"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />
          <button className="btn primary big" disabled={busy || !!chromiumMissing} onClick={start}>
            Rozpocznij skan
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <Segmented
            value={profile}
            onChange={chooseProfile}
            options={(Object.keys(PROFILE_LABELS) as ProfileId[]).map((p) => ({ value: p, label: PROFILE_LABELS[p] }))}
          />
          <div className="profile-desc">{PROFILE_DESC[profile]}</div>
        </div>
        <div className="estimate">
          <div>
            <span className="muted small">Widoków na podstronę</span>
            <b>{est.views}</b>
          </div>
          <div>
            <span className="muted small">Szerokości w skanie zakresów</span>
            <b>{est.widths || '—'}</b>
          </div>
          <div>
            <span className="muted small">Szacowany czas (20 podstron)</span>
            <b>~{est.minutes} min</b>
          </div>
          <div>
            <span className="muted small">Analiza AI</span>
            <b>{o.ai.enabled ? `do ${est.aiImages} obrazów (~$${est.aiCost.toFixed(2)})` : 'wyłączona'}</b>
          </div>
        </div>
      </div>

      <div className="panel" key={formKey}>
        <details className="adv">
          <summary>Ustawienia zaawansowane</summary>

          <h3>Zakres skanowania</h3>
          <div className="grid3">
            <NumberField label="Limit podstron" value={o.maxPages} min={1} max={2000} onChange={(v) => set({ maxPages: v })} />
            <NumberField label="Głębokość linków" value={o.maxDepth} min={0} max={20} onChange={(v) => set({ maxDepth: v })} />
            <NumberField
              label="Podstron z jednego wzorca"
              value={o.templateSampling}
              min={0}
              onChange={(v) => set({ templateSampling: v })}
              hint="Np. maks. 5 wpisów z /blog/*. 0 = bez limitu."
            />
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <Check checked={o.useSitemap} onChange={(v) => set({ useSitemap: v })} label="Używaj mapy strony (sitemap.xml)" />
            <Check checked={o.respectRobots} onChange={(v) => set({ respectRobots: v })} label="Respektuj robots.txt" />
            <Check
              checked={o.restrictToPath}
              onChange={(v) => set({ restrictToPath: v })}
              label="Tylko w obrębie podanej ścieżki"
              hint="Np. dla https://firma.pl/oferta/ skanuj tylko /oferta/…"
            />
            <Check checked={o.includeSubdomains} onChange={(v) => set({ includeSubdomains: v })} label="Uwzględnij subdomeny" />
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <LinesField
              label="Wykluczone adresy"
              value={o.excludePatterns}
              onChange={(v) => set({ excludePatterns: v })}
              placeholder={'/regulamin\n*/tag/*\n/\\?page=\\d+/'}
              hint="Jeden wzorzec w linii: fragment adresu, * jako dowolny ciąg lub /wyrażenie regularne/."
            />
            <LinesField
              label="Ignorowane elementy (selektory CSS)"
              value={o.ignoreSelectors}
              onChange={(v) => set({ ignoreSelectors: v })}
              placeholder={'#chat-widget\n.cookie-bar'}
              hint="Elementy pomijane przez detektory, np. widżety czatu."
            />
          </div>

          <h3>Rozdzielczości i przeglądarki</h3>
          <div className="grid2">
            <div>
              {CATEGORIES.map((c) => (
                <div key={c} style={{ marginBottom: 8 }}>
                  <div className="small muted" style={{ marginBottom: 4 }}>
                    {CATEGORY_LABELS[c]}
                  </div>
                  {o.viewports
                    .filter((v) => v.category === c)
                    .map((v) => (
                      <Check
                        key={v.id}
                        checked={v.enabled}
                        label={v.label}
                        onChange={(on) => set({ viewports: o.viewports.map((x) => (x.id === v.id ? { ...x, enabled: on } : x)) })}
                      />
                    ))}
                </div>
              ))}
              <div className="hint">Listę rozdzielczości zmienisz w Ustawieniach.</div>
            </div>
            <div>
              <table className="matrix">
                <thead>
                  <tr>
                    <th />
                    {CATEGORIES.map((c) => (
                      <th key={c}>{CATEGORY_LABELS[c]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ENGINES.map((e) => (
                    <tr key={e}>
                      <td>
                        {ENGINE_LABELS[e]}
                        {browsers && !engineInstalled(e) && <span className="hint"> (brak)</span>}
                      </td>
                      {CATEGORIES.map((c) => (
                        <td key={c} className="c">
                          <input type="checkbox" checked={o.engines[e].includes(c)} onChange={(ev) => toggleEngine(e, c, ev.target.checked)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hint" style={{ marginTop: 6 }}>
                Safari (WebKit) wyłapuje błędy specyficzne dla iPhone’a i iPada.
              </div>
            </div>
          </div>

          <h3>Skan zakresów szerokości</h3>
          <Check
            checked={o.sweep.enabled}
            onChange={(v) => set({ sweep: { ...o.sweep, enabled: v } })}
            label="Sprawdzaj przewijanie poziome przy każdej szerokości"
            hint="Wykrywa błędy występujące tylko w wąskim zakresie, np. między 700 a 760 px."
          />
          <div className="grid3" style={{ marginTop: 10 }}>
            <NumberField label="Od" suffix="px" value={o.sweep.from} min={240} disabled={!o.sweep.enabled} onChange={(v) => set({ sweep: { ...o.sweep, from: v } })} />
            <NumberField label="Do" suffix="px" value={o.sweep.to} max={3840} disabled={!o.sweep.enabled} onChange={(v) => set({ sweep: { ...o.sweep, to: v } })} />
            <NumberField label="Krok" suffix="px" value={o.sweep.step} min={1} max={200} disabled={!o.sweep.enabled} onChange={(v) => set({ sweep: { ...o.sweep, step: v } })} />
          </div>

          <h3>Testy</h3>
          <div className="grid2">
            <Check checked={o.mobileMenuTest} onChange={(v) => set({ mobileMenuTest: v })} label="Test menu mobilnego (klik w „hamburger”)" />
            <Check checked={o.axe} onChange={(v) => set({ axe: v })} label="Dostępność (axe-core, WCAG)" />
            <Check checked={o.checkLinks} onChange={(v) => set({ checkLinks: v })} label="Niedziałające linki wewnętrzne" />
            <Check checked={o.checkExternalLinks} disabled={!o.checkLinks} onChange={(v) => set({ checkExternalLinks: v })} label="Sprawdzaj też linki zewnętrzne" />
            <Check checked={o.dismissCookies} onChange={(v) => set({ dismissCookies: v })} label="Zamykaj baner cookies" />
            <Check checked={o.closePopups} onChange={(v) => set({ closePopups: v })} label="Zamykaj wyskakujące okna (newsletter itp.)" />
          </div>

          <h3>Analiza AI</h3>
          {!hasKey && (
            <div className="alert warn">
              <span>Aby włączyć analizę AI, dodaj klucz API w Ustawieniach.</span>
              <button className="btn" onClick={props.goSettings}>
                Ustawienia
              </button>
            </div>
          )}
          <Check
            checked={o.ai.enabled}
            disabled={!hasKey}
            onChange={(v) => set({ ai: { ...o.ai, enabled: v } })}
            label={`Wizualna ocena zrzutów przez AI (${o.ai.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}, ${o.ai.model})`}
            hint="Model ogląda zrzuty ekranu i wskazuje problemy, których nie widzą reguły (np. nienaturalny układ, nieczytelne sekcje)."
          />
          <div className="grid3" style={{ marginTop: 10 }}>
            <div>
              {CATEGORIES.map((c) => (
                <Check
                  key={c}
                  checked={o.ai.categories.includes(c)}
                  disabled={!o.ai.enabled}
                  label={CATEGORY_LABELS[c]}
                  onChange={(on) => set({ ai: { ...o.ai, categories: on ? [...o.ai.categories, c] : o.ai.categories.filter((x) => x !== c) } })}
                />
              ))}
            </div>
            <NumberField
              label="Fragmentów strony na widok"
              value={o.ai.maxSegments}
              min={1}
              max={12}
              disabled={!o.ai.enabled}
              onChange={(v) => set({ ai: { ...o.ai, maxSegments: v } })}
              hint="Długie strony są cięte na fragmenty."
            />
            <Check checked={o.ai.summary} disabled={!o.ai.enabled} onChange={(v) => set({ ai: { ...o.ai, summary: v } })} label="Podsumowanie raportu przez AI" />
          </div>

          <h3>Wydajność i dostęp</h3>
          <div className="grid3">
            <NumberField label="Równoległe karty" value={o.concurrency} min={1} max={12} onChange={(v) => set({ concurrency: v })} />
            <NumberField
              label="Limit czasu strony"
              suffix="s"
              value={Math.round(o.pageTimeoutMs / 1000)}
              min={10}
              max={300}
              onChange={(v) => set({ pageTimeoutMs: v * 1000 })}
            />
            <Check checked={o.useSystemChrome} onChange={(v) => set({ useSystemChrome: v })} label="Użyj zainstalowanego Google Chrome" />
          </div>
          <div className="grid3" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Basic Auth — login</span>
              <input
                type="text"
                value={o.basicAuth?.username ?? ''}
                onChange={(e) => set({ basicAuth: e.target.value ? { username: e.target.value, password: o.basicAuth?.password ?? '' } : undefined })}
              />
            </label>
            <label className="field">
              <span>Basic Auth — hasło</span>
              <input
                type="password"
                value={o.basicAuth?.password ?? ''}
                disabled={!o.basicAuth?.username}
                onChange={(e) => set({ basicAuth: { username: o.basicAuth!.username, password: e.target.value } })}
              />
            </label>
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <button className="btn" onClick={saveDefaults}>
              Zapisz jako domyślne
            </button>
            <button className="btn" onClick={reset}>
              Przywróć
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
