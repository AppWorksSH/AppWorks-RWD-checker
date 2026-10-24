import type { APIRequestContext } from 'playwright-core';
import type { LinkCheck } from './types';
import { isSameSite, looksLikeNonHtml } from './url';

export interface LinkCheckInput {
  links: Record<string, string[]>;
  statuses: Record<string, number>;
  rootUrl: string;
  includeSubdomains: boolean;
  checkExternal: boolean;
  limit?: number;
}

async function probe(request: APIRequestContext, url: string): Promise<{ status: number; error?: string }> {
  try {
    let res = await request.fetch(url, { method: 'HEAD', timeout: 12000, failOnStatusCode: false, maxRedirects: 10 });
    if ([405, 403, 400, 501].includes(res.status()) || res.status() >= 500) {
      res = await request.get(url, { timeout: 15000, failOnStatusCode: false, maxRedirects: 10 });
    }
    return { status: res.status() };
  } catch (e) {
    return { status: 0, error: (e as Error).message.split('\n')[0].slice(0, 160) };
  }
}

export async function checkLinks(
  request: APIRequestContext,
  input: LinkCheckInput,
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<{ broken: LinkCheck[]; checked: number }> {
  const entries = Object.entries(input.links)
    .map(([url, foundOn]) => ({ url, foundOn, external: !isSameSite(url, input.rootUrl, input.includeSubdomains) }))
    .filter((e) => input.checkExternal || !e.external)
    .slice(0, input.limit ?? 800);

  const broken: LinkCheck[] = [];
  let done = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < entries.length && !cancelled()) {
      const e = entries[idx++];
      let status = input.statuses[e.url];
      let error: string | undefined;
      if (status === undefined || (status === 0 && !looksLikeNonHtml(e.url))) {
        const r = await probe(request, e.url);
        status = r.status;
        error = r.error;
      }
      const uncertain = e.external && [401, 403, 429, 999].includes(status);
      if ((status >= 400 || status === 0) && !uncertain) {
        broken.push({ url: e.url, status, error, external: e.external, foundOn: e.foundOn.slice(0, 20) });
      }
      onProgress(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { broken, checked: done };
}
