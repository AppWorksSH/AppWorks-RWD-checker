import type { Browser, BrowserContext } from 'playwright-core';
import { contextOptions } from './browsers';
import { DEFAULT_VIEWPORTS } from './defaults';
import { parseRobots, type Robots } from './robots';
import { loadSitemaps } from './sitemap';
import type { DiscoveryResult, PageInfo, ScanOptions } from './types';
import { compilePattern, exclusionReason, isSameSite, isUnderPath, normalizeUrl, templateKey } from './url';

export interface DiscoveryHooks {
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  progress: (done: number, total: number, msg?: string) => void;
  cancelled: () => boolean;
}

export interface DiscoveryOutput extends DiscoveryResult {
  rootUrl: string;
  /** Statusy HTTP adresów odwiedzonych podczas odkrywania. */
  statuses: Record<string, number>;
}

interface QueueItem {
  url: string;
  depth: number;
  foundOn?: string;
  source: PageInfo['source'];
}

export async function discover(browser: Browser, o: ScanOptions, hooks: DiscoveryHooks): Promise<DiscoveryOutput> {
  const desktop = DEFAULT_VIEWPORTS.find((v) => v.id === 'desktop-1440')!;
  const context: BrowserContext = await browser.newContext(contextOptions(desktop, 'chromium', o));
  try {
    return await crawl(context, o, hooks);
  } finally {
    await context.close().catch(() => {});
  }
}

async function crawl(context: BrowserContext, o: ScanOptions, hooks: DiscoveryHooks): Promise<DiscoveryOutput> {
  const start = normalizeUrl(o.url);
  if (!start) throw new Error(`Nieprawidłowy adres: ${o.url}`);
  const userPatterns = o.excludePatterns.map(compilePattern).filter((x): x is RegExp => !!x);

  const pages: PageInfo[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const links: Record<string, Set<string>> = {};
  const statuses: Record<string, number> = {};
  const seen = new Set<string>();
  const pageSet = new Set<string>();
  const templateCounts = new Map<string, number>();
  const queue: QueueItem[] = [];
  let robots: Robots | null = null;
  let robotsFound = false;
  let sitemapUrls = 0;
  let rootUrl = start;

  const skip = (url: string, reason: string) => {
    if (skipped.length < 300) skipped.push({ url, reason });
  };

  const visit = async (item: QueueItem): Promise<void> => {
    const page = await context.newPage();
    try {
      const resp = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: o.pageTimeoutMs });
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
      const status = resp?.status() ?? 0;
      statuses[item.url] = status;
      const finalUrl = normalizeUrl(page.url()) ?? item.url;
      if (finalUrl !== item.url) statuses[finalUrl] = status;
      if (!isSameSite(finalUrl, rootUrl, o.includeSubdomains)) {
        skip(item.url, `przekierowanie poza witrynę (${finalUrl})`);
        return;
      }
      if (pageSet.has(finalUrl)) {
        if (finalUrl !== item.url) skip(item.url, `przekierowanie do ${finalUrl}`);
        return;
      }
      seen.add(finalUrl);
      const ctype = resp?.headers()['content-type'] ?? 'text/html';
      if (!/html/i.test(ctype)) {
        skip(item.url, `nie HTML (${ctype})`);
        return;
      }
      if (status >= 400) {
        skip(item.url, `HTTP ${status}`);
        return;
      }
      if (pages.length >= o.maxPages) {
        skip(item.url, 'limit podstron');
        return;
      }
      const title = await page.title().catch(() => '');
      pageSet.add(finalUrl);
      pages.push({
        url: finalUrl,
        depth: item.depth,
        foundOn: item.foundOn,
        status,
        title,
        template: templateKey(finalUrl) ?? undefined,
        source: item.source,
      });
      hooks.progress(pages.length, o.maxPages, finalUrl);

      const hrefs: string[] = await page
        .evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href))
        .catch(() => []);
      for (const href of hrefs) {
        const n = normalizeUrl(href, finalUrl);
        if (!n) continue;
        const same = isSameSite(n, rootUrl, o.includeSubdomains);
        if (same || o.checkExternalLinks) (links[n] ??= new Set()).add(finalUrl);
        if (!same) continue;
        enqueue({ url: n, depth: item.depth + 1, foundOn: finalUrl, source: 'link' });
      }
    } catch (e) {
      statuses[item.url] = statuses[item.url] ?? 0;
      skip(item.url, `błąd: ${(e as Error).message.split('\n')[0]}`);
      if (item.source === 'start') throw new Error(`Nie udało się wczytać strony startowej: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
  };

  const enqueue = (item: QueueItem) => {
    if (seen.has(item.url)) return;
    seen.add(item.url);
    const reason = exclusionReason(item.url, userPatterns);
    if (reason) return skip(item.url, reason);
    if (o.restrictToPath && !isUnderPath(item.url, rootUrl)) return skip(item.url, 'poza ścieżką startową');
    if (item.depth > o.maxDepth) return skip(item.url, 'za głęboko');
    if (o.respectRobots && robots && !robots.isAllowed(item.url)) return skip(item.url, 'zablokowane w robots.txt');
    const tk = templateKey(item.url);
    if (tk && o.templateSampling > 0) {
      const c = templateCounts.get(tk) ?? 0;
      if (c >= o.templateSampling) return skip(item.url, `próbka szablonu ${tk}`);
      templateCounts.set(tk, c + 1);
    }
    queue.push(item);
  };

  // Strona startowa — ustala docelowy adres po przekierowaniach.
  hooks.log('info', `Wczytuję stronę startową ${start}`);
  {
    const probe = await context.newPage();
    try {
      await probe.goto(start, { waitUntil: 'domcontentloaded', timeout: o.pageTimeoutMs });
      rootUrl = normalizeUrl(probe.url()) ?? start;
    } catch (e) {
      throw new Error(`Nie udało się wczytać strony startowej: ${(e as Error).message.split('\n')[0]}`);
    } finally {
      await probe.close().catch(() => {});
    }
  }
  if (rootUrl !== start) hooks.log('info', `Przekierowanie na ${rootUrl}`);
  const origin = new URL(rootUrl).origin;

  try {
    const res = await context.request.get(`${origin}/robots.txt`, { timeout: 10000, failOnStatusCode: false });
    if (res.ok() && /text\/plain/i.test(res.headers()['content-type'] ?? 'text/plain')) {
      robots = parseRobots(await res.text());
      robotsFound = true;
      hooks.log('info', `Znaleziono robots.txt (${robots.sitemaps.length} map witryny)`);
    }
  } catch {
    /* brak robots.txt */
  }

  seen.add(rootUrl);
  queue.push({ url: rootUrl, depth: 0, source: 'start' });

  if (o.useSitemap) {
    const urls = await loadSitemaps(context.request, origin, robots?.sitemaps ?? []);
    sitemapUrls = urls.length;
    if (urls.length) hooks.log('info', `Mapa witryny: ${urls.length} adresów`);
    for (const u of urls) {
      const n = normalizeUrl(u);
      if (n && isSameSite(n, rootUrl, o.includeSubdomains)) enqueue({ url: n, depth: 1, source: 'sitemap' });
    }
  }

  const active = new Set<Promise<void>>();
  let first = true;
  while ((queue.length || active.size) && !hooks.cancelled()) {
    while (queue.length && active.size < (first ? 1 : o.concurrency) && pages.length + active.size < o.maxPages) {
      const item = queue.shift()!;
      const p: Promise<void> = visit(item).finally(() => active.delete(p));
      active.add(p);
    }
    if (!active.size) break;
    await Promise.race(active);
    first = false;
  }
  for (const item of queue) skip(item.url, 'limit podstron');

  return {
    rootUrl,
    pages,
    skipped,
    links: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, [...v]])),
    robotsFound,
    sitemapUrls,
    statuses,
  };
}
