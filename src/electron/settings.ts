import { app, safeStorage } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultOptions, DEFAULT_AI_MODELS, DEFAULT_VIEWPORTS } from '../core/defaults';
import { bareHost } from '../core/url';
import type { AiProvider, ScanOptions } from '../core/types';
import type { AppSettings, SiteRules } from '../shared/api';

interface StoredSettings extends Omit<AppSettings, 'hasKey'> {
  keys: Partial<Record<AiProvider, string>>;
}

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function dataDir(): string {
  const dir = path.join(app.getPath('userData'), 'scans');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initial(): StoredSettings {
  return {
    defaults: defaultOptions(''),
    profile: 'standard',
    aiProvider: 'anthropic',
    aiModels: { ...DEFAULT_AI_MODELS },
    siteRules: {},
    schedules: [],
    notifications: true,
    launchAtLogin: false,
    keys: {},
  };
}

let cache: StoredSettings | null = null;

function load(): StoredSettings {
  if (cache) return cache;
  const base = initial();
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<StoredSettings>;
    const defaults = { ...base.defaults, ...raw.defaults } as ScanOptions;
    defaults.sweep = { ...base.defaults.sweep, ...raw.defaults?.sweep };
    defaults.ai = { ...base.defaults.ai, ...raw.defaults?.ai, apiKey: undefined };
    defaults.engines = { ...base.defaults.engines, ...raw.defaults?.engines };
    if (!defaults.viewports?.length) defaults.viewports = DEFAULT_VIEWPORTS.map((v) => ({ ...v }));
    cache = { ...base, ...raw, defaults, aiModels: { ...base.aiModels, ...raw.aiModels }, keys: raw.keys ?? {} };
  } catch {
    cache = base;
  }
  return cache;
}

function persist(s: StoredSettings) {
  cache = s;
  mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, file());
}

export function getSettings(): AppSettings {
  const { keys, ...rest } = load();
  return structuredClone({
    ...rest,
    hasKey: { anthropic: !!keys.anthropic, openai: !!keys.openai },
  });
}

export function saveSettings(patch: Partial<Omit<AppSettings, 'hasKey'>>): AppSettings {
  const s = load();
  const next: StoredSettings = { ...s, ...structuredClone(patch), keys: s.keys };
  next.defaults = { ...next.defaults, url: '', ai: { ...next.defaults.ai, apiKey: undefined } };
  persist(next);
  return getSettings();
}

export function setApiKey(provider: AiProvider, key: string): AppSettings {
  const s = load();
  const keys = { ...s.keys };
  const trimmed = key.trim();
  if (!trimmed) delete keys[provider];
  else if (safeStorage.isEncryptionAvailable()) keys[provider] = 'enc:' + safeStorage.encryptString(trimmed).toString('base64');
  else keys[provider] = 'raw:' + trimmed;
  persist({ ...s, keys });
  return getSettings();
}

export function getApiKey(provider: AiProvider): string | undefined {
  const v = load().keys[provider];
  if (!v) return undefined;
  if (v.startsWith('raw:')) return v.slice(4);
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
  } catch {
    return undefined;
  }
}

export function hostOf(url: string): string {
  try {
    return bareHost(new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).hostname);
  } catch {
    return '';
  }
}

function rulesFor(s: StoredSettings, host: string): SiteRules {
  return s.siteRules[host] ?? { ignoreSelectors: [], ignoredFingerprints: [] };
}

export function addSiteRule(host: string, kind: 'selector' | 'fingerprint', value: string, title = ''): AppSettings {
  const s = load();
  const r = structuredClone(rulesFor(s, host));
  if (kind === 'selector') {
    if (!r.ignoreSelectors.includes(value)) r.ignoreSelectors.push(value);
  } else if (!r.ignoredFingerprints.some((f) => f.fingerprint === value)) {
    r.ignoredFingerprints.push({ fingerprint: value, title, addedAt: new Date().toISOString() });
  }
  persist({ ...s, siteRules: { ...s.siteRules, [host]: r } });
  return getSettings();
}

export function removeSiteRule(host: string, kind: 'selector' | 'fingerprint', value: string): AppSettings {
  const s = load();
  const r = structuredClone(rulesFor(s, host));
  if (kind === 'selector') r.ignoreSelectors = r.ignoreSelectors.filter((x) => x !== value);
  else r.ignoredFingerprints = r.ignoredFingerprints.filter((f) => f.fingerprint !== value);
  const siteRules = { ...s.siteRules, [host]: r };
  if (!r.ignoreSelectors.length && !r.ignoredFingerprints.length) delete siteRules[host];
  persist({ ...s, siteRules });
  return getSettings();
}

/** Uzupełnia opcje skanu o reguły ignorowania dla domeny i klucz API. */
export function finalizeOptions(o: ScanOptions): ScanOptions {
  const s = load();
  const out = structuredClone(o);
  const r = rulesFor(s, hostOf(out.url));
  out.ignoreSelectors = [...new Set([...out.ignoreSelectors, ...r.ignoreSelectors])];
  out.ignoredFingerprints = [...new Set([...out.ignoredFingerprints, ...r.ignoredFingerprints.map((f) => f.fingerprint)])];
  if (out.ai.enabled) {
    const key = getApiKey(out.ai.provider);
    if (key) out.ai.apiKey = key;
    else out.ai.enabled = false;
  }
  return out;
}
