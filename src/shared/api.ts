import type { ProfileId } from '../core/defaults';
import type { AiProvider, EngineName, ScanEvent, ScanMeta, ScanOptions, ScanPhase } from '../core/types';

export interface Schedule {
  id: string;
  url: string;
  profile: ProfileId;
  interval: 'daily' | 'weekly';
  weekday: number;
  hour: number;
  enabled: boolean;
  lastRun?: string;
}

export interface SiteRules {
  ignoreSelectors: string[];
  ignoredFingerprints: { fingerprint: string; title: string; addedAt: string }[];
}

export interface AppSettings {
  defaults: ScanOptions;
  profile: ProfileId;
  aiProvider: AiProvider;
  aiModels: Record<AiProvider, string>;
  hasKey: Record<AiProvider, boolean>;
  siteRules: Record<string, SiteRules>;
  schedules: Schedule[];
  notifications: boolean;
  launchAtLogin: boolean;
}

export interface JobState {
  id: string;
  url: string;
  status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed';
  phase?: ScanPhase;
  done: number;
  total: number;
  message?: string;
  issues: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  logs: { level: 'info' | 'warn' | 'error'; message: string; at: string }[];
  meta?: ScanMeta;
}

export interface AppState {
  jobs: JobState[];
}

export interface BrowserInfo {
  engines: { engine: EngineName; installed: boolean }[];
  systemChrome: boolean;
  installing: boolean;
}

export interface RwdApi {
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<Omit<AppSettings, 'hasKey'>>): Promise<AppSettings>;
  setApiKey(provider: AiProvider, key: string): Promise<AppSettings>;
  removeSiteRule(host: string, kind: 'selector' | 'fingerprint', value: string): Promise<AppSettings>;

  startScan(options: ScanOptions): Promise<{ id: string }>;
  cancelScan(id: string): Promise<void>;
  resumeScan(id: string): Promise<{ id: string }>;
  getState(): Promise<AppState>;
  clearFinished(): Promise<void>;

  listScans(): Promise<ScanMeta[]>;
  deleteScan(id: string): Promise<void>;
  openReport(id: string): Promise<void>;
  revealScan(id: string): Promise<void>;
  exportPdf(id: string): Promise<string | null>;
  exportHtml(id: string): Promise<string | null>;

  browserInfo(): Promise<BrowserInfo>;
  installBrowsers(): Promise<boolean>;
  testAi(provider: AiProvider, model: string): Promise<string>;
  listModels(provider: AiProvider): Promise<string[]>;

  appInfo(): Promise<{ version: string; dataDir: string }>;
  openDataDir(): Promise<void>;
  openExternal(url: string): Promise<void>;

  onState(cb: (state: AppState) => void): () => void;
  onScanEvent(cb: (id: string, e: ScanEvent) => void): () => void;
  onBrowsersLog(cb: (line: string) => void): () => void;
  onSettingsChanged(cb: () => void): () => void;
}

export type WorkerIn =
  | { type: 'start'; storeDir: string; options: ScanOptions; resumeId?: string; id: string }
  | { type: 'cancel' };

export type WorkerOut =
  | { type: 'event'; event: ScanEvent }
  | { type: 'done'; meta: ScanMeta }
  | { type: 'error'; message: string };
