import { gunzipSync } from 'node:zlib';
import type { APIRequestContext } from 'playwright-core';

export function extractLocs(xml: string): { urls: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&').trim(),
  );
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

async function fetchText(request: APIRequestContext, url: string): Promise<string | null> {
  try {
    const res = await request.get(url, { timeout: 15000, failOnStatusCode: false });
    if (!res.ok()) return null;
    const buf = await res.body();
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

export async function loadSitemaps(
  request: APIRequestContext,
  origin: string,
  fromRobots: string[],
  limit = 5000,
): Promise<string[]> {
  const queue = fromRobots.length
    ? [...fromRobots]
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`];
  const seen = new Set<string>();
  const urls = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 25 && urls.size < limit) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await fetchText(request, sm);
    fetched++;
    if (!xml || !/<(urlset|sitemapindex)[\s>]/i.test(xml)) continue;
    const { urls: u, sitemaps } = extractLocs(xml);
    u.forEach((x) => urls.size < limit && urls.add(x));
    queue.push(...sitemaps);
    if (!fromRobots.length && urls.size) break;
  }
  return [...urls];
}
