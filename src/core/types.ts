export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type DeviceCategory = 'phone' | 'tablet' | 'desktop';
export type EngineName = 'chromium' | 'webkit' | 'firefox';
export type RuleCategory = 'rwd' | 'a11y' | 'tech' | 'ai';
export type AiProvider = 'anthropic' | 'openai';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportDef {
  id: string;
  label: string;
  category: DeviceCategory;
  width: number;
  height: number;
  deviceScaleFactor: number;
  enabled: boolean;
}

export interface SweepOptions {
  enabled: boolean;
  from: number;
  to: number;
  step: number;
  height: number;
}

export interface AiOptions {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  apiKey?: string;
  maxSegments: number;
  categories: DeviceCategory[];
  summary: boolean;
  concurrency: number;
}

export interface ScanOptions {
  url: string;
  maxPages: number;
  maxDepth: number;
  includeSubdomains: boolean;
  restrictToPath: boolean;
  respectRobots: boolean;
  useSitemap: boolean;
  excludePatterns: string[];
  /** Maksymalna liczba podstron z jednego wzorca adresu (np. /blog/*). 0 = bez limitu. */
  templateSampling: number;
  viewports: ViewportDef[];
  engines: Record<EngineName, DeviceCategory[]>;
  concurrency: number;
  pageTimeoutMs: number;
  dismissCookies: boolean;
  closePopups: boolean;
  sweep: SweepOptions;
  axe: boolean;
  mobileMenuTest: boolean;
  checkLinks: boolean;
  checkExternalLinks: boolean;
  ai: AiOptions;
  ignoreSelectors: string[];
  disabledRules: string[];
  ignoredFingerprints: string[];
  basicAuth?: { username: string; password: string };
  useSystemChrome: boolean;
  screenshotMaxHeight: number;
  screenshotQuality: number;
}

export interface Issue {
  ruleId: string;
  severity: Severity;
  message: string;
  selector?: string;
  signature?: string;
  rect?: Rect;
  snippet?: string;
  details?: Record<string, unknown>;
  cropFile?: string;
  /** Nadpisanie odcisku do grupowania (np. adres zasobu). */
  key?: string;
}

export interface ShotInfo {
  file: string;
  width: number;
  height: number;
}

export interface TaskResult {
  key: string;
  pageUrl: string;
  viewportId: string;
  engine: EngineName;
  status: 'ok' | 'error';
  error?: string;
  finalUrl?: string;
  httpStatus?: number;
  title?: string;
  screenshot?: ShotInfo;
  menuShot?: ShotInfo;
  aiSegments?: string[];
  issues: Issue[];
  metrics: {
    loadMs?: number;
    cls?: number;
    docWidth?: number;
    docHeight?: number;
    viewportWidth?: number;
  };
  durationMs: number;
}

export interface SweepRange {
  from: number;
  to: number;
  maxOverflow: number;
  worstWidth: number;
  culprits: { selector: string; signature: string; snippet: string }[];
  screenshot?: ShotInfo;
}

export interface SweepResult {
  pageUrl: string;
  status: 'ok' | 'error';
  error?: string;
  from: number;
  to: number;
  step: number;
  checkedWidths: number;
  overflowWidths: number[];
  ranges: SweepRange[];
}

export interface PageInfo {
  url: string;
  depth: number;
  foundOn?: string;
  status?: number;
  title?: string;
  template?: string;
  source: 'start' | 'link' | 'sitemap';
}

export interface LinkCheck {
  url: string;
  status: number;
  error?: string;
  external: boolean;
  foundOn: string[];
}

export interface DiscoveryResult {
  pages: PageInfo[];
  skipped: { url: string; reason: string }[];
  links: Record<string, string[]>;
  robotsFound: boolean;
  sitemapUrls: number;
}

export interface Occurrence {
  pageUrl: string;
  viewportId: string;
  engine: EngineName | 'all';
  taskKey?: string;
  issueIndex?: number;
  message: string;
  rect?: Rect;
  cropFile?: string;
}

export interface IssueGroup {
  fingerprint: string;
  ruleId: string;
  category: RuleCategory;
  severity: Severity;
  message: string;
  selector?: string;
  signature?: string;
  snippet?: string;
  cropFile?: string;
  details?: Record<string, unknown>;
  occurrences: Occurrence[];
  pageCount: number;
  viewportIds: string[];
  global: boolean;
  isNew?: boolean;
}

export interface Comparison {
  previousId: string;
  previousDate: string;
  previousScore: number;
  newCount: number;
  fixed: { fingerprint: string; ruleId: string; message: string; severity: Severity }[];
  persisting: number;
}

export interface AiReview {
  taskKey: string;
  pageUrl: string;
  viewportId: string;
  issues: number;
  error?: string;
}

export interface ScanSummary {
  score: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<RuleCategory, number>;
  pages: number;
  tasks: number;
  failedTasks: number;
}

export type ScanStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface ScanMeta {
  id: string;
  url: string;
  host: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: ScanStatus;
  error?: string;
  summary?: ScanSummary;
  appVersion: string;
}

export interface ScanResult {
  meta: ScanMeta;
  options: ScanOptions;
  discovery: DiscoveryResult;
  tasks: TaskResult[];
  sweeps: SweepResult[];
  links: LinkCheck[];
  linksChecked: number;
  aiReviews: AiReview[];
  aiSummary?: string;
  aiSummaryError?: string;
  groups: IssueGroup[];
  comparison?: Comparison;
}

export type ScanPhase = 'discovery' | 'links' | 'audit' | 'sweep' | 'ai' | 'report' | 'done';

export type ScanEvent =
  | { type: 'phase'; phase: ScanPhase; total?: number }
  | { type: 'progress'; phase: ScanPhase; done: number; total: number; message?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'issues'; count: number }
  | { type: 'finished'; meta: ScanMeta };
