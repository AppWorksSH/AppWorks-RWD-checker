import type { DeviceCategory, EngineName, ScanOptions, ViewportDef } from './types';

export const APP_VERSION = '1.0.0';

export const DEFAULT_VIEWPORTS: ViewportDef[] = [
  { id: 'phone-360', label: 'Android 360×800', category: 'phone', width: 360, height: 800, deviceScaleFactor: 3, enabled: true },
  { id: 'phone-390', label: 'iPhone 390×844', category: 'phone', width: 390, height: 844, deviceScaleFactor: 3, enabled: true },
  { id: 'phone-414', label: 'iPhone Plus 414×896', category: 'phone', width: 414, height: 896, deviceScaleFactor: 3, enabled: true },
  { id: 'tablet-768', label: 'iPad mini 768×1024', category: 'tablet', width: 768, height: 1024, deviceScaleFactor: 2, enabled: true },
  { id: 'tablet-820', label: 'iPad Air 820×1180', category: 'tablet', width: 820, height: 1180, deviceScaleFactor: 2, enabled: true },
  { id: 'tablet-1024', label: 'iPad poziomo 1024×768', category: 'tablet', width: 1024, height: 768, deviceScaleFactor: 2, enabled: true },
  { id: 'desktop-1280', label: 'Laptop 1280×800', category: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, enabled: true },
  { id: 'desktop-1440', label: 'Desktop 1440×900', category: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, enabled: true },
  { id: 'desktop-1920', label: 'Full HD 1920×1080', category: 'desktop', width: 1920, height: 1080, deviceScaleFactor: 1, enabled: true },
];

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  phone: 'Telefon',
  tablet: 'Tablet',
  desktop: 'Desktop',
};

export const ENGINE_LABELS: Record<EngineName, string> = {
  chromium: 'Chrome (Chromium)',
  webkit: 'Safari (WebKit)',
  firefox: 'Firefox',
};

export const DEFAULT_AI_MODELS = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1',
} as const;

export type ProfileId = 'quick' | 'standard' | 'full';

export const PROFILE_LABELS: Record<ProfileId, string> = {
  quick: 'Szybki',
  standard: 'Standardowy',
  full: 'Pełny',
};

export function defaultOptions(url = ''): ScanOptions {
  return {
    url,
    maxPages: 50,
    maxDepth: 5,
    includeSubdomains: false,
    restrictToPath: false,
    respectRobots: true,
    useSitemap: true,
    excludePatterns: [],
    templateSampling: 5,
    viewports: DEFAULT_VIEWPORTS.map((v) => ({ ...v })),
    engines: {
      chromium: ['phone', 'tablet', 'desktop'],
      webkit: ['phone', 'tablet'],
      firefox: [],
    },
    concurrency: 4,
    pageTimeoutMs: 45000,
    dismissCookies: true,
    closePopups: true,
    sweep: { enabled: true, from: 320, to: 1920, step: 10, height: 900 },
    axe: true,
    mobileMenuTest: true,
    checkLinks: true,
    checkExternalLinks: false,
    ai: {
      enabled: false,
      provider: 'anthropic',
      model: DEFAULT_AI_MODELS.anthropic,
      maxSegments: 4,
      categories: ['phone', 'tablet', 'desktop'],
      summary: true,
      concurrency: 3,
    },
    ignoreSelectors: [],
    disabledRules: [],
    ignoredFingerprints: [],
    useSystemChrome: false,
    screenshotMaxHeight: 12000,
    screenshotQuality: 70,
  };
}

export function applyProfile(options: ScanOptions, profile: ProfileId): ScanOptions {
  const o: ScanOptions = structuredClone(options);
  if (profile === 'quick') {
    const keep = new Set(['phone-390', 'tablet-768', 'desktop-1440']);
    o.viewports = o.viewports.map((v) => ({ ...v, enabled: keep.has(v.id) }));
    o.engines = { chromium: ['phone', 'tablet', 'desktop'], webkit: [], firefox: [] };
    o.sweep = { ...o.sweep, enabled: false };
    o.axe = false;
    o.checkLinks = false;
    o.ai = { ...o.ai, enabled: false };
  } else if (profile === 'standard') {
    o.viewports = o.viewports.map((v) => ({ ...v, enabled: true }));
    o.engines = { chromium: ['phone', 'tablet', 'desktop'], webkit: ['phone', 'tablet'], firefox: [] };
    o.sweep = { ...o.sweep, enabled: true, step: 20 };
    o.axe = true;
    o.checkLinks = true;
  } else {
    o.viewports = o.viewports.map((v) => ({ ...v, enabled: true }));
    o.engines = { chromium: ['phone', 'tablet', 'desktop'], webkit: ['phone', 'tablet', 'desktop'], firefox: ['desktop'] };
    o.sweep = { ...o.sweep, enabled: true, step: 10 };
    o.axe = true;
    o.checkLinks = true;
    o.checkExternalLinks = true;
    o.ai = { ...o.ai, enabled: true };
  }
  return o;
}

export function enabledViewports(o: ScanOptions): ViewportDef[] {
  return o.viewports.filter((v) => v.enabled);
}

/** Usuwa sekrety przed zapisaniem opcji na dysku / w raporcie. */
export function sanitizeOptions(o: ScanOptions): ScanOptions {
  const copy = structuredClone(o);
  delete copy.ai.apiKey;
  if (copy.basicAuth) copy.basicAuth = { username: copy.basicAuth.username, password: '••••' };
  return copy;
}
