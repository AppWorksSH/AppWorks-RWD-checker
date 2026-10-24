import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright-core';
import { collectRecords, buildGroups, compareGroups, summarize } from './aggregate';
import { aiReview, aiSummary } from './ai';
import { runAuditTask, taskKey, type AuditTask } from './audit';
import { contextOptions, engineStatus, launchEngine, systemChromeAvailable } from './browsers';
import { discover, type DiscoveryOutput } from './crawler';
import { APP_VERSION, enabledViewports, sanitizeOptions } from './defaults';
import { checkLinks } from './links';
import { CLS_INIT_SCRIPT } from './prepare';
import { generateReport } from './report/html';
import { ruleMeta } from './rules';
import { makeScanId, ScanStore } from './storage';
import { runSweep } from './sweep';
import type {
  AiReview,
  DeviceCategory,
  EngineName,
  LinkCheck,
  PageInfo,
  ScanEvent,
  ScanMeta,
  ScanOptions,
  ScanResult,
  SweepResult,
  TaskResult,
} from './types';
import { bareHost, normalizeUrl, shortPath } from './url';

const ENGINES: EngineName[] = ['chromium', 'webkit', 'firefox'];

export function normalizeOptions(input: ScanOptions): ScanOptions {
  const o: ScanOptions = structuredClone(input);
  let url = o.url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const n = normalizeUrl(url);
  if (!n) throw new Error(`Nieprawidłowy adres strony: ${input.url}`);
  o.url = n;
  const clamp = (v: number, min: number, max: number, def: number) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
  o.maxPages = clamp(o.maxPages, 1, 2000, 50);
  o.maxDepth = clamp(o.maxDepth, 0, 20, 5);
  o.concurrency = clamp(o.concurrency, 1, 10, 4);
  o.pageTimeoutMs = clamp(o.pageTimeoutMs, 5000, 180000, 45000);
  o.templateSampling = clamp(o.templateSampling, 0, 1000, 5);
  o.sweep.from = clamp(o.sweep.from, 240, 3840, 320);
  o.sweep.to = clamp(o.sweep.to, o.sweep.from, 3840, 1920);
  o.sweep.step = clamp(o.sweep.step, 2, 400, 10);
  o.sweep.height = clamp(o.sweep.height, 300, 2000, 900);
  o.ai.maxSegments = clamp(o.ai.maxSegments, 1, 12, 4);
  o.ai.concurrency = clamp(o.ai.concurrency, 1, 8, 3);
  o.screenshotMaxHeight = clamp(o.screenshotMaxHeight, 1000, 30000, 12000);
  o.screenshotQuality = clamp(o.screenshotQuality, 30, 95, 70);
  if (!enabledViewports(o).length) throw new Error('Wybierz co najmniej jedną rozdzielczość.');
  return o;
}

export function buildTasks(pages: PageInfo[], o: ScanOptions): AuditTask[] {
  const vps = enabledViewports(o);
  const firstOfCat = new Map<DeviceCategory, string>();
  for (const vp of vps) if (!firstOfCat.has(vp.category)) firstOfCat.set(vp.category, vp.id);
  const primaryEngine = (cat: DeviceCategory) => ENGINES.find((e) => o.engines[e]?.includes(cat));
  const tasks: AuditTask[] = [];
  for (const page of pages) {
    for (const vp of vps) {
      for (const engine of ENGINES) {
        if (!o.engines[engine]?.includes(vp.category)) continue;
        const primary = primaryEngine(vp.category) === engine && firstOfCat.get(vp.category) === vp.id;
        tasks.push({
          key: taskKey(page.url, vp.id, engine),
          pageUrl: page.url,
          viewport: vp,
          engine,
          primary,
          runAxe: o.axe && primary && vp.category !== 'tablet',
          aiShots: o.ai.enabled && !!o.ai.apiKey && primary && o.ai.categories.includes(vp.category),
          menuTest: o.mobileMenuTest && vp.category === 'phone',
        });
      }
    }
  }
  return tasks;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>, stop: () => boolean): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !stop()) await fn(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export interface ScannerParams {
  options: ScanOptions;
  store: ScanStore;
  resumeId?: string;
  id?: string;
  onEvent?: (e: ScanEvent) => void;
}

export class Scanner {
  readonly id: string;
  private cancelled = false;
  private browsers = new Map<EngineName, Promise<Browser>>();

  constructor(private readonly p: ScannerParams) {
    this.id = p.resumeId ?? p.id ?? makeScanId(p.options.url);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.log('warn', 'Przerywam skan…');
    for (const b of this.browsers.values()) b.then((x) => x.close()).catch(() => {});
  }

  private emit(e: ScanEvent) {
    this.p.onEvent?.(e);
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.emit({ type: 'log', level, message });
  }

  private browser(engine: EngineName, o: ScanOptions): Promise<Browser> {
    let b = this.browsers.get(engine);
    if (!b) {
      b = launchEngine(engine, o);
      this.browsers.set(engine, b);
      b.catch(() => this.browsers.delete(engine));
    }
    return b;
  }

  private async closeBrowsers() {
    const all = [...this.browsers.values()];
    this.browsers.clear();
    await Promise.all(all.map((b) => b.then((x) => x.close()).catch(() => {})));
  }

  async run(): Promise<ScanResult> {
    const store = this.p.store;
    const id = this.id;
    const resume = !!this.p.resumeId;
    let o = normalizeOptions(this.p.options);
    await store.ensure(id);

    let meta: ScanMeta = (resume && (await store.read<ScanMeta>(id, 'meta.json'))) || {
      id,
      url: o.url,
      host: bareHost(new URL(o.url).hostname),
      startedAt: new Date().toISOString(),
      status: 'running',
      appVersion: APP_VERSION,
    };
    meta = { ...meta, status: 'running', error: undefined };
    await store.write(id, 'meta.json', meta);
    await store.write(id, 'options.json', { ...o, ai: { ...o.ai, apiKey: undefined } });
    const t0 = Date.now();
    const scanDir = store.dir(id);

    let discovery: DiscoveryOutput | null = null;
    let taskResults: TaskResult[] = [];
    let sweeps: SweepResult[] = [];
    let linkData: { broken: LinkCheck[]; checked: number } | null = null;
    let aiReviews: AiReview[] = [];

    try {
      o = this.checkEngines(o);

      // 1. Odkrywanie podstron
      discovery = resume ? await store.read<DiscoveryOutput>(id, 'discovery.json') : null;
      if (!discovery) {
        this.emit({ type: 'phase', phase: 'discovery', total: o.maxPages });
        const chromium = await this.browser('chromium', o);
        discovery = await discover(chromium, o, {
          log: (l, m) => this.log(l, m),
          progress: (done, total, msg) => this.emit({ type: 'progress', phase: 'discovery', done, total, message: msg && shortPath(msg) }),
          cancelled: () => this.cancelled,
        });
        await store.write(id, 'discovery.json', discovery);
        this.log('info', `Znaleziono ${discovery.pages.length} podstron do sprawdzenia (pominięto ${discovery.skipped.length}).`);
      }
      if (!discovery.pages.length) throw new Error('Nie znaleziono żadnej podstrony do sprawdzenia.');
      const pages = discovery.pages;

      // 2. Linki
      linkData = await store.read(id, 'links.json');
      if (!linkData && o.checkLinks && !this.cancelled) {
        this.emit({ type: 'phase', phase: 'links' });
        const chromium = await this.browser('chromium', o);
        const ctx = await chromium.newContext({ ignoreHTTPSErrors: true, httpCredentials: o.basicAuth?.username ? o.basicAuth : undefined });
        try {
          linkData = await checkLinks(
            ctx.request,
            {
              links: discovery.links,
              statuses: discovery.statuses,
              rootUrl: discovery.rootUrl,
              includeSubdomains: o.includeSubdomains,
              checkExternal: o.checkExternalLinks,
            },
            (done, total) => this.emit({ type: 'progress', phase: 'links', done, total }),
            () => this.cancelled,
          );
        } finally {
          await ctx.close().catch(() => {});
        }
        if (!this.cancelled) await store.write(id, 'links.json', linkData);
        this.log('info', `Sprawdzono ${linkData.checked} linków, niedziałających: ${linkData.broken.length}.`);
      }

      // 3. Audyt
      taskResults = await this.runAudit(o, pages, discovery.rootUrl, scanDir);

      // 4. Sweep
      if (o.sweep.enabled && !this.cancelled) sweeps = await this.runSweeps(o, pages, scanDir);
      else sweeps = await store.readAll<SweepResult>(id, 'sweeps');

      // 5. AI
      aiReviews = (await store.read<AiReview[]>(id, 'ai.json')) ?? [];
      if (o.ai.enabled && !this.cancelled) {
        if (!o.ai.apiKey) this.log('warn', 'Analiza AI włączona, ale brak klucza API — pomijam.');
        else aiReviews = await this.runAi(o, taskResults, aiReviews, scanDir);
      }

      meta.status = this.cancelled ? 'cancelled' : 'completed';
    } catch (e) {
      meta.status = this.cancelled ? 'cancelled' : 'failed';
      meta.error = (e as Error).message;
      this.log('error', meta.error);
    } finally {
      await this.closeBrowsers();
    }

    // 6. Agregacja i raport
    this.emit({ type: 'phase', phase: 'report' });
    const pages = discovery?.pages ?? [];
    if (!taskResults.length) taskResults = await store.readAll<TaskResult>(id, 'tasks');
    const records = collectRecords(taskResults, sweeps, linkData?.broken ?? []);
    const groups = buildGroups(records, pages.length, {
      ignoredFingerprints: o.ignoredFingerprints,
      disabledRules: o.disabledRules,
    });
    const summary = summarize(groups, taskResults, pages.length);
    const prev = await store.findPrevious(meta.host, id).catch(() => null);
    const comparison = prev
      ? compareGroups(groups, { id: prev.meta.id, date: prev.meta.startedAt, score: prev.meta.summary?.score ?? 0, groups: prev.groups })
      : undefined;

    let aiSummaryText: string | undefined;
    let aiSummaryError: string | undefined;
    if (o.ai.enabled && o.ai.summary && o.ai.apiKey && groups.length && meta.status === 'completed') {
      this.emit({ type: 'progress', phase: 'ai', done: 0, total: 1, message: 'Podsumowanie AI' });
      try {
        aiSummaryText = await aiSummary(
          { provider: o.ai.provider, model: o.ai.model, apiKey: o.ai.apiKey },
          { url: meta.url, score: summary.score, pages: pages.length, viewports: enabledViewports(o).map((v) => v.label), groups },
        );
      } catch (e) {
        aiSummaryError = (e as Error).message;
        this.log('warn', `Podsumowanie AI nie powiodło się: ${aiSummaryError}`);
      }
    }

    meta.finishedAt = new Date().toISOString();
    meta.durationMs = (meta.durationMs ?? 0) + (Date.now() - t0);
    meta.summary = summary;

    const result: ScanResult = {
      meta,
      options: sanitizeOptions(o),
      discovery: {
        pages,
        skipped: discovery?.skipped ?? [],
        links: {},
        robotsFound: discovery?.robotsFound ?? false,
        sitemapUrls: discovery?.sitemapUrls ?? 0,
      },
      tasks: taskResults,
      sweeps,
      links: linkData?.broken ?? [],
      linksChecked: linkData?.checked ?? 0,
      aiReviews,
      aiSummary: aiSummaryText,
      aiSummaryError,
      groups,
      comparison,
    };
    await store.write(id, 'result.json', result);
    try {
      await generateReport(result, scanDir);
    } catch (e) {
      this.log('error', `Nie udało się wygenerować raportu: ${(e as Error).message}`);
    }
    await store.write(id, 'meta.json', meta);
    this.emit({ type: 'phase', phase: 'done' });
    this.emit({ type: 'finished', meta });
    return result;
  }

  private checkEngines(o: ScanOptions): ScanOptions {
    const status = engineStatus();
    const next = structuredClone(o);
    for (const s of status) {
      const wanted = next.engines[s.engine]?.length;
      if (!wanted) continue;
      if (s.engine === 'chromium' && next.useSystemChrome) {
        if (!systemChromeAvailable()) throw new Error('Nie znaleziono Google Chrome w /Applications.');
        continue;
      }
      if (!s.installed) {
        if (s.engine === 'chromium') {
          if (systemChromeAvailable()) {
            this.log('warn', 'Brak przeglądarki Chromium — używam zainstalowanego Google Chrome.');
            next.useSystemChrome = true;
            continue;
          }
          throw new Error('Brak przeglądarki Chromium. Zainstaluj przeglądarki w ustawieniach aplikacji (lub: npm run browsers).');
        }
        this.log('warn', `Przeglądarka ${s.engine} nie jest zainstalowana — pomijam ją.`);
        next.engines[s.engine] = [];
      }
    }
    return next;
  }

  private async runAudit(o: ScanOptions, pages: PageInfo[], rootUrl: string, scanDir: string): Promise<TaskResult[]> {
    const store = this.p.store;
    const tasks = buildTasks(pages, o);
    const existing = new Map((await store.readAll<TaskResult>(this.id, 'tasks')).filter((t) => t.status === 'ok').map((t) => [t.key, t]));
    const results = new Map<string, TaskResult>();
    for (const t of tasks) if (existing.has(t.key)) results.set(t.key, existing.get(t.key)!);
    const todo = tasks.filter((t) => !existing.has(t.key));

    this.emit({ type: 'phase', phase: 'audit', total: tasks.length });
    if (existing.size) this.log('info', `Wznawiam: ${existing.size} z ${tasks.length} zadań było już wykonanych.`);
    let done = existing.size;
    let issueCount = [...results.values()].reduce((s, t) => s + t.issues.length, 0);

    const contexts = new Map<string, Promise<BrowserContext>>();
    const getContext = (task: AuditTask) => {
      const key = `${task.engine}|${task.viewport.id}`;
      let c = contexts.get(key);
      if (!c) {
        c = this.browser(task.engine, o).then(async (b) => {
          const ctx = await b.newContext(contextOptions(task.viewport, task.engine, o));
          await ctx.addInitScript(CLS_INIT_SCRIPT);
          return ctx;
        });
        contexts.set(key, c);
        c.catch(() => contexts.delete(key));
      }
      return c;
    };
    const resetEngine = (engine: EngineName) => {
      for (const k of [...contexts.keys()]) if (k.startsWith(engine + '|')) contexts.delete(k);
      const b = this.browsers.get(engine);
      this.browsers.delete(engine);
      b?.then((x) => x.close()).catch(() => {});
    };

    const env = { options: o, rootUrl, shotsDir: path.join(scanDir, 'shots'), cropRegistry: new Set<string>() };
    const timeoutMs = o.pageTimeoutMs * 3 + 30000;

    const runOne = async (task: AuditTask, attempt = 0): Promise<TaskResult> => {
      try {
        const ctx = await getContext(task);
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('Przekroczono łączny limit czasu zadania')), timeoutMs);
        });
        try {
          const r = await Promise.race([runAuditTask(ctx, task, env), timeout]);
          if (r.status === 'error' && attempt === 0 && !this.cancelled && /closed|crash|disconnected/i.test(r.error ?? '')) {
            resetEngine(task.engine);
            return runOne(task, 1);
          }
          return r;
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        const msg = (e as Error).message.split('\n')[0];
        if (attempt === 0 && !this.cancelled && /closed|crash|disconnected|launch/i.test(msg)) {
          resetEngine(task.engine);
          return runOne(task, 1);
        }
        return {
          key: task.key,
          pageUrl: task.pageUrl,
          viewportId: task.viewport.id,
          engine: task.engine,
          status: 'error',
          error: msg,
          issues: [{ ruleId: 'load-error', severity: 'high', message: `Nie udało się sprawdzić podstrony: ${msg}` }],
          metrics: {},
          durationMs: 0,
        };
      }
    };

    await pool(
      todo,
      o.concurrency,
      async (task) => {
        const r = await runOne(task);
        if (this.cancelled && r.status === 'error') return;
        results.set(task.key, r);
        await store.write(this.id, `tasks/${task.key}.json`, r);
        done++;
        issueCount += r.issues.length;
        if (r.status === 'error') this.log('warn', `${shortPath(task.pageUrl)} (${task.viewport.label}, ${task.engine}): ${r.error}`);
        this.emit({
          type: 'progress',
          phase: 'audit',
          done,
          total: tasks.length,
          message: `${shortPath(task.pageUrl)} · ${task.viewport.label} · ${task.engine}`,
        });
        this.emit({ type: 'issues', count: issueCount });
      },
      () => this.cancelled,
    );

    await Promise.all([...contexts.values()].map((c) => c.then((x) => x.close()).catch(() => {})));
    return tasks.map((t) => results.get(t.key)).filter((x): x is TaskResult => !!x);
  }

  private async runSweeps(o: ScanOptions, pages: PageInfo[], scanDir: string): Promise<SweepResult[]> {
    const store = this.p.store;
    const existing = new Map((await store.readAll<SweepResult>(this.id, 'sweeps')).filter((s) => s.status === 'ok').map((s) => [s.pageUrl, s]));
    const results = new Map(existing);
    const todo = pages.filter((p) => !existing.has(p.url));
    this.emit({ type: 'phase', phase: 'sweep', total: pages.length });
    let done = existing.size;
    await pool(
      todo,
      Math.min(3, o.concurrency),
      async (page) => {
        let r: SweepResult;
        try {
          r = await runSweep(await this.browser('chromium', o), page.url, o, path.join(scanDir, 'shots'), () => this.cancelled);
        } catch (e) {
          r = { pageUrl: page.url, status: 'error', error: (e as Error).message, from: o.sweep.from, to: o.sweep.to, step: o.sweep.step, checkedWidths: 0, overflowWidths: [], ranges: [] };
        }
        if (this.cancelled) return;
        results.set(page.url, r);
        await store.write(this.id, `sweeps/${taskKey(page.url, 'sweep', 'chromium')}.json`, r);
        done++;
        this.emit({
          type: 'progress',
          phase: 'sweep',
          done,
          total: pages.length,
          message: `${shortPath(page.url)} · ${r.ranges.length ? `${r.ranges.length} zakres(y) z błędami` : 'bez przewijania poziomego'}`,
        });
      },
      () => this.cancelled,
    );
    return pages.map((p) => results.get(p.url)).filter((x): x is SweepResult => !!x);
  }

  private async runAi(o: ScanOptions, tasks: TaskResult[], reviews: AiReview[], scanDir: string): Promise<AiReview[]> {
    const store = this.p.store;
    const doneKeys = new Set(reviews.filter((r) => !r.error).map((r) => r.taskKey));
    const out = reviews.filter((r) => !r.error);
    const todo = tasks.filter((t) => t.aiSegments?.length && !doneKeys.has(t.key));
    if (!todo.length) return out;
    this.emit({ type: 'phase', phase: 'ai', total: todo.length });
    const cfg = { provider: o.ai.provider, model: o.ai.model, apiKey: o.ai.apiKey! };
    let done = 0;
    await pool(
      todo,
      o.ai.concurrency,
      async (t) => {
        const vp = o.viewports.find((v) => v.id === t.viewportId)!;
        const known = t.issues
          .filter((i) => ruleMeta(i.ruleId).category === 'rwd')
          .slice(0, 15)
          .map((i) => `${ruleMeta(i.ruleId).title}: ${i.message}`);
        try {
          const issues = await aiReview(cfg, scanDir, t.aiSegments!, t.pageUrl, vp, known);
          t.issues = t.issues.filter((i) => i.ruleId !== 'ai-visual').concat(issues);
          await store.write(this.id, `tasks/${t.key}.json`, t);
          out.push({ taskKey: t.key, pageUrl: t.pageUrl, viewportId: t.viewportId, issues: issues.length });
        } catch (e) {
          const msg = (e as Error).message;
          out.push({ taskKey: t.key, pageUrl: t.pageUrl, viewportId: t.viewportId, issues: 0, error: msg });
          this.log('warn', `AI (${shortPath(t.pageUrl)}, ${vp.label}): ${msg}`);
        }
        await store.write(this.id, 'ai.json', out);
        this.emit({ type: 'progress', phase: 'ai', done: ++done, total: todo.length, message: `${shortPath(t.pageUrl)} · ${vp.label}` });
      },
      () => this.cancelled,
    );
    return out;
  }
}
