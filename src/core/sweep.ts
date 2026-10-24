import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { clearHighlight, hash6, highlight, markViewportEdge } from './audit';
import { contextOptions } from './browsers';
import { runDetectors, type DetectorConfig } from './detectors';
import { imageSize } from './image';
import { preparePage, settle } from './prepare';
import type { Rect, ScanOptions, SweepRange, SweepResult, ViewportDef } from './types';
import { slugForFile } from './url';

export interface WidthSample {
  width: number;
  overflow: number;
  culprits: { selector: string; signature: string; snippet: string; rect?: Rect }[];
}

export function aggregateRanges(samples: WidthSample[], step: number): Omit<SweepRange, 'screenshot'>[] {
  type Acc = { from: number; to: number; worst: WidthSample; culprits: Map<string, WidthSample['culprits'][number]> };
  const acc: Acc[] = [];
  let cur: Acc | null = null;
  for (const s of samples) {
    if (s.overflow <= 1) {
      cur = null;
      continue;
    }
    if (!cur || s.width - cur.to > step) {
      cur = { from: s.width, to: s.width, worst: s, culprits: new Map() };
      acc.push(cur);
    } else {
      cur.to = s.width;
      if (s.overflow > cur.worst.overflow) cur.worst = s;
    }
    for (const c of s.culprits) if (!cur.culprits.has(c.signature)) cur.culprits.set(c.signature, c);
  }
  return acc.map((r) => ({
    from: r.from,
    to: r.to,
    maxOverflow: r.worst.overflow,
    worstWidth: r.worst.width,
    culprits: [...r.culprits.values()].slice(0, 5).map(({ selector, signature, snippet }) => ({ selector, signature, snippet })),
  }));
}

export async function runSweep(
  browser: Browser,
  pageUrl: string,
  o: ScanOptions,
  shotsDir: string,
  cancelled: () => boolean,
): Promise<SweepResult> {
  const { from, to, step, height } = o.sweep;
  const result: SweepResult = { pageUrl, status: 'ok', from, to, step, checkedWidths: 0, overflowWidths: [], ranges: [] };
  const vp: ViewportDef = { id: 'sweep', label: 'sweep', category: 'desktop', width: from, height, deviceScaleFactor: 1, enabled: true };
  const context = await browser.newContext({ ...contextOptions(vp, 'chromium', o), deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(o.pageTimeoutMs);
  const samples: WidthSample[] = [];
  try {
    await page.setViewportSize({ width: 1280, height });
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: o.pageTimeoutMs });
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => {});
    await settle(page, 5000);
    await preparePage(page, { dismissCookies: o.dismissCookies, closePopups: o.closePopups, maxHeight: o.screenshotMaxHeight });

    for (let w = from; w <= to; w += step) {
      if (cancelled()) break;
      await page.setViewportSize({ width: w, height });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40)))));
      const cfg: DetectorConfig = {
        category: 'desktop',
        ignoreSelectors: o.ignoreSelectors,
        disabledRules: [],
        onlyRules: ['horizontal-overflow'],
        maxPerRule: 5,
        dpr: 1,
      };
      const det = await page.evaluate(runDetectors, cfg);
      result.checkedWidths++;
      const culprits = det.issues
        .filter((i) => i.selector)
        .map((i) => ({ selector: i.selector!, signature: i.signature!, snippet: i.snippet ?? '', rect: i.rect }));
      samples.push({ width: w, overflow: det.overflowPx, culprits });
      if (det.overflowPx > 1) result.overflowWidths.push(w);
    }

    const ranges = aggregateRanges(samples, step);
    const base = `${slugForFile(pageUrl, 40)}-${hash6(pageUrl)}-sweep`;
    for (const [i, r] of ranges.entries()) {
      const sample = samples.find((s) => s.width === r.worstWidth)!;
      const range: SweepRange = { ...r };
      try {
        await page.setViewportSize({ width: r.worstWidth, height });
        await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60)))));
        const rects = sample.culprits.map((c) => c.rect).filter((x): x is Rect => !!x);
        const docW = await page.evaluate(() => document.documentElement.scrollWidth);
        const y = rects.length ? Math.max(0, rects[0].y - 150) : 0;
        await highlight(page, rects);
        await markViewportEdge(page, r.worstWidth);
        const buf = await page.screenshot({
          type: 'jpeg',
          quality: o.screenshotQuality,
          scale: 'css',
          animations: 'disabled',
          fullPage: true,
          clip: { x: 0, y, width: Math.min(docW, r.worstWidth + 600), height: Math.min(height, 700) },
        });
        await clearHighlight(page);
        const name = `${base}-${i}-${r.worstWidth}.jpg`;
        await writeFile(path.join(shotsDir, name), buf);
        const size = imageSize(buf) ?? { width: 0, height: 0 };
        range.screenshot = { file: `shots/${name}`, ...size };
      } catch {
        /* zrzut nie jest wymagany */
      }
      result.ranges.push(range);
    }
  } catch (e) {
    result.status = 'error';
    result.error = (e as Error).message?.split('\n')[0];
    if (samples.length) result.ranges = aggregateRanges(samples, step);
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}
