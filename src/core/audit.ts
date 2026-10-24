import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import { runAxe } from './axe';
import { measureFixedCoverage, runDetectors } from './detectors';
import { imageSize } from './image';
import { testMobileMenu } from './menu';
import { preparePage, settle } from './prepare';
import type { EngineName, Issue, Rect, ScanOptions, ShotInfo, TaskResult, ViewportDef } from './types';
import { isSameSite, slugForFile } from './url';

export interface AuditTask {
  key: string;
  pageUrl: string;
  viewport: ViewportDef;
  engine: EngineName;
  /** Pierwszy widok danej kategorii w głównej przeglądarce — tu wykonujemy droższe pomiary. */
  primary: boolean;
  runAxe: boolean;
  aiShots: boolean;
  menuTest: boolean;
}

export interface AuditEnv {
  options: ScanOptions;
  rootUrl: string;
  shotsDir: string;
  cropRegistry: Set<string>;
}

export function hash6(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 6);
}

export function taskKey(pageUrl: string, viewportId: string, engine: EngineName): string {
  return `${slugForFile(pageUrl, 40)}-${hash6(pageUrl)}-${viewportId}-${engine}`;
}

const MAX_CROPS = 10;
const RESOURCE_TYPES = new Set(['image', 'stylesheet', 'script', 'font', 'media']);

function cropRect(r: Rect, vpWidth: number, docW: number, docH: number): Rect | null {
  const pad = 20;
  let x: number;
  let width: number;
  if (vpWidth <= 1024) {
    x = 0;
    width = Math.min(docW, Math.max(vpWidth, r.x + r.width + pad));
  } else {
    x = Math.max(0, Math.min(r.x - 160, docW - 480));
    width = Math.min(docW - x, Math.max(480, r.width + 320), 1600);
  }
  const y = Math.max(0, r.y - 120);
  let height = Math.min(Math.max(r.height + 240, 240), 900);
  if (y + height > docH) height = docH - y;
  if (width < 10 || height < 10) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export async function highlight(page: Page, rects: Rect[]): Promise<void> {
  await page.evaluate((list) => {
    for (const r of list) {
      const d = document.createElement('div');
      d.setAttribute('data-rwd-overlay', '');
      Object.assign(d.style, {
        position: 'absolute',
        left: r.x - 2 + 'px',
        top: r.y - 2 + 'px',
        width: r.width + 4 + 'px',
        height: r.height + 4 + 'px',
        border: '3px solid #ff2d55',
        background: 'rgba(255,45,85,0.10)',
        boxSizing: 'border-box',
        zIndex: '2147483647',
        pointerEvents: 'none',
        borderRadius: '3px',
      });
      document.documentElement.appendChild(d);
    }
  }, rects);
}

export async function markViewportEdge(page: Page, x: number): Promise<void> {
  await page.evaluate((edge) => {
    const h = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
    const d = document.createElement('div');
    d.setAttribute('data-rwd-overlay', '');
    Object.assign(d.style, {
      position: 'absolute',
      left: edge + 'px',
      top: '0',
      width: '0',
      height: h + 'px',
      borderLeft: '2px dashed #ff2d55',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    const label = document.createElement('div');
    label.setAttribute('data-rwd-overlay', '');
    label.textContent = `krawędź ekranu ${edge}px`;
    Object.assign(label.style, {
      position: 'sticky',
      top: '0',
      marginLeft: '4px',
      font: '600 11px/1.4 -apple-system, sans-serif',
      color: '#fff',
      background: '#ff2d55',
      padding: '1px 5px',
      borderRadius: '3px',
      whiteSpace: 'nowrap',
      width: 'max-content',
    });
    d.appendChild(label);
    document.documentElement.appendChild(d);
  }, x);
}

export async function clearHighlight(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('[data-rwd-overlay]').forEach((e) => e.remove())).catch(() => {});
}

async function saveShot(buf: Buffer, dir: string, name: string): Promise<ShotInfo> {
  await writeFile(path.join(dir, name), buf);
  const size = imageSize(buf) ?? { width: 0, height: 0 };
  return { file: `shots/${name}`, width: size.width, height: size.height };
}

export async function runAuditTask(context: BrowserContext, task: AuditTask, env: AuditEnv): Promise<TaskResult> {
  const o = env.options;
  const vp = task.viewport;
  const started = Date.now();
  const result: TaskResult = {
    key: task.key,
    pageUrl: task.pageUrl,
    viewportId: vp.id,
    engine: task.engine,
    status: 'ok',
    issues: [],
    metrics: {},
    durationMs: 0,
  };
  const side: Issue[] = [];
  const seen = new Set<string>();
  let consoleCount = 0;
  let resourceCount = 0;

  const page = await context.newPage();
  page.setDefaultTimeout(o.pageTimeoutMs);

  page.on('pageerror', (err) => {
    const msg = String(err?.message || err).slice(0, 300);
    if (seen.has('pe' + msg) || consoleCount >= 10) return;
    seen.add('pe' + msg);
    consoleCount++;
    side.push({ ruleId: 'page-error', severity: 'medium', message: msg, key: msg.replace(/\d+/g, '#') });
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const msg = m.text().slice(0, 300);
    if (/Failed to load resource/i.test(msg)) return;
    if (seen.has('ce' + msg) || consoleCount >= 10) return;
    seen.add('ce' + msg);
    consoleCount++;
    side.push({ ruleId: 'console-error', severity: 'low', message: msg, key: msg.replace(/\d+/g, '#') });
  });
  page.on('response', (r) => {
    const status = r.status();
    if (status < 400) return;
    const req = r.request();
    if (req.resourceType() === 'document' && req.frame() === page.mainFrame()) return;
    const url = r.url();
    if (seen.has('r' + url) || resourceCount >= 15) return;
    seen.add('r' + url);
    resourceCount++;
    const own = isSameSite(url, env.rootUrl, true);
    side.push({
      ruleId: 'failed-resource',
      severity: own && RESOURCE_TYPES.has(req.resourceType()) ? 'medium' : 'low',
      message: `${req.resourceType()} ${url} → HTTP ${status}`,
      key: url.split('?')[0],
      details: { url, status, type: req.resourceType(), sameSite: own },
    });
  });
  page.on('requestfailed', (req) => {
    const err = req.failure()?.errorText || '';
    if (/ABORTED|cancel|NS_BINDING_ABORTED|interrupted/i.test(err)) return;
    const url = req.url();
    if (url.startsWith('data:') || seen.has('r' + url) || resourceCount >= 15) return;
    seen.add('r' + url);
    resourceCount++;
    const own = isSameSite(url, env.rootUrl, true);
    side.push({
      ruleId: 'failed-resource',
      severity: own && RESOURCE_TYPES.has(req.resourceType()) ? 'medium' : 'low',
      message: `${req.resourceType()} ${url} → ${err}`,
      key: url.split('?')[0],
      details: { url, error: err, type: req.resourceType(), sameSite: own },
    });
  });

  const base = `${slugForFile(task.pageUrl, 40)}-${hash6(task.pageUrl)}-${vp.id}-${task.engine}`;

  try {
    const t0 = Date.now();
    const resp = await page.goto(task.pageUrl, { waitUntil: 'domcontentloaded', timeout: o.pageTimeoutMs });
    await page.waitForLoadState('load', { timeout: Math.min(o.pageTimeoutMs, 20000) }).catch(() => {});
    await settle(page, 5000);
    result.metrics.loadMs = Date.now() - t0;
    result.httpStatus = resp?.status();
    result.finalUrl = page.url();
    result.title = await page.title().catch(() => '');
    if (result.httpStatus && result.httpStatus >= 400) {
      result.issues.push({ ruleId: 'http-error', severity: 'critical', message: `Podstrona zwróciła HTTP ${result.httpStatus}.` });
    }

    if (task.engine === 'chromium' && task.primary) {
      await page.waitForTimeout(1500);
      const cls = await page.evaluate(() => (window as unknown as { __rwdCls?: number }).__rwdCls ?? null).catch(() => null);
      if (typeof cls === 'number') {
        result.metrics.cls = Math.round(cls * 1000) / 1000;
        if (cls > 0.1 && !o.disabledRules.includes('layout-shift')) {
          result.issues.push({
            ruleId: 'layout-shift',
            severity: cls > 0.25 ? 'high' : 'medium',
            message: `CLS = ${result.metrics.cls} (zalecane ≤ 0,1) — elementy przeskakują podczas ładowania.`,
            details: { cls: result.metrics.cls },
            key: 'cls',
          });
        }
      }
    }

    const prep = await preparePage(page, {
      dismissCookies: o.dismissCookies,
      closePopups: o.closePopups,
      maxHeight: o.screenshotMaxHeight,
    });

    const dims = await page.evaluate(() => ({
      w: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
      h: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    }));
    const shotH = Math.min(dims.h, o.screenshotMaxHeight);
    const full = await page.screenshot({
      type: 'jpeg',
      quality: o.screenshotQuality,
      scale: 'css',
      animations: 'disabled',
      fullPage: true,
      clip: dims.h > o.screenshotMaxHeight ? { x: 0, y: 0, width: dims.w, height: shotH } : undefined,
    });
    result.screenshot = await saveShot(full, env.shotsDir, `${base}.jpg`);

    if (task.aiShots) {
      const segH = vp.category === 'phone' ? Math.round(vp.width * 2.6) : vp.category === 'tablet' ? Math.round(vp.width * 1.3) : Math.round(vp.width * 0.7);
      const count = Math.min(o.ai.maxSegments, Math.ceil(shotH / segH));
      result.aiSegments = [];
      for (let i = 0; i < count; i++) {
        const y = i * segH;
        const h = Math.min(segH, shotH - y);
        if (h < 50) break;
        const buf = await page.screenshot({
          type: 'jpeg',
          quality: 75,
          scale: 'css',
          animations: 'disabled',
          fullPage: true,
          clip: { x: 0, y, width: vp.width, height: h },
        });
        const name = `${base}-ai${i}.jpg`;
        await writeFile(path.join(env.shotsDir, name), buf);
        result.aiSegments.push(`shots/${name}`);
      }
    }

    const det = await page.evaluate(runDetectors, {
      category: vp.category,
      ignoreSelectors: o.ignoreSelectors,
      disabledRules: o.disabledRules,
      maxPerRule: 15,
      dpr: vp.deviceScaleFactor,
    });
    result.issues.push(...det.issues);
    result.metrics.docWidth = det.docWidth;
    result.metrics.docHeight = det.docHeight;
    result.metrics.viewportWidth = det.viewportWidth;

    if (!o.disabledRules.includes('fixed-coverage')) {
      const cov = await page.evaluate(measureFixedCoverage, { category: vp.category, ignoreSelectors: o.ignoreSelectors });
      const [med, high] = vp.category === 'phone' ? [0.3, 0.45] : [0.35, 0.5];
      if (cov.coverage > med && cov.elements.length) {
        const el = cov.elements[0];
        result.issues.push({
          ruleId: 'fixed-coverage',
          severity: cov.coverage > high ? 'high' : 'medium',
          message: `Przyklejone elementy zasłaniają ${Math.round(cov.coverage * 100)}% ekranu podczas przewijania (${cov.elements.map((e) => e.selector).join(', ')}).`,
          selector: el.selector,
          signature: el.signature,
          snippet: el.snippet,
          rect: el.rect,
          details: { coverage: cov.coverage, elements: cov.elements },
        });
      }
    }

    if (prep.consent.coverage !== undefined && vp.category !== 'desktop' && prep.consent.coverage > 0.4 && !o.disabledRules.includes('consent-coverage')) {
      result.issues.push({
        ruleId: 'consent-coverage',
        severity: prep.consent.coverage > 0.6 ? 'medium' : 'low',
        message: `Baner cookies zajmuje ${Math.round(prep.consent.coverage * 100)}% ekranu przy pierwszym wejściu.`,
        key: 'consent',
      });
    }

    if (task.runAxe) {
      try {
        const ax = await runAxe(page);
        result.issues.push(...ax.filter((i) => !o.disabledRules.includes(i.ruleId)));
      } catch (e) {
        result.issues.push({ ruleId: 'console-error', severity: 'info', message: `Nie udało się uruchomić testów dostępności: ${(e as Error).message}` });
      }
    }

    let crops = 0;
    for (const issue of result.issues) {
      if (crops >= MAX_CROPS) break;
      if (!issue.rect || !['critical', 'high', 'medium'].includes(issue.severity)) continue;
      const regKey = `${issue.ruleId}|${issue.signature ?? issue.message}|${vp.id}`;
      if (env.cropRegistry.has(regKey)) continue;
      const clip = cropRect(issue.rect, vp.width, Math.max(dims.w, det.docWidth), Math.min(det.docHeight, o.screenshotMaxHeight));
      if (!clip) continue;
      env.cropRegistry.add(regKey);
      try {
        await highlight(page, [issue.rect]);
        if (issue.ruleId === 'horizontal-overflow' || issue.ruleId === 'content-cut-off') {
          await markViewportEdge(page, det.viewportWidth);
        }
        const buf = await page.screenshot({ type: 'jpeg', quality: 75, scale: 'css', animations: 'disabled', fullPage: true, clip });
        const name = `${base}-c${crops}.jpg`;
        await writeFile(path.join(env.shotsDir, name), buf);
        issue.cropFile = `shots/${name}`;
        crops++;
      } catch {
        /* element mógł zniknąć */
      } finally {
        await clearHighlight(page);
      }
    }

    if (task.menuTest && !o.disabledRules.includes('mobile-menu-broken')) {
      const menu = await testMobileMenu(page, o.screenshotQuality).catch(() => null);
      if (menu) {
        result.issues.push(...menu.issues.filter((i) => !o.disabledRules.includes(i.ruleId)));
        if (menu.screenshot) result.menuShot = await saveShot(menu.screenshot, env.shotsDir, `${base}-menu.jpg`);
      }
    }
  } catch (e) {
    result.status = 'error';
    result.error = (e as Error).message?.split('\n')[0] ?? String(e);
    result.issues.push({ ruleId: 'load-error', severity: 'high', message: `Nie udało się sprawdzić podstrony: ${result.error}` });
  } finally {
    await page.close().catch(() => {});
  }

  result.issues.push(...side.filter((i) => !o.disabledRules.includes(i.ruleId)));
  result.durationMs = Date.now() - started;
  return result;
}
