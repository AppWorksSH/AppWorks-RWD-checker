import type { Server } from 'node:http';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyProfile, defaultOptions } from '../../src/core/defaults';
import { exportSingleFile } from '../../src/core/report/html';
import { Scanner } from '../../src/core/scanner';
import { ScanStore } from '../../src/core/storage';
import type { ScanResult } from '../../src/core/types';
import { startServer } from '../fixtures/server.mjs';

const PORT = 4391;
const ROOT = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve('test/.tmp/e2e');

let server: Server;
let result: ScanResult;
let dir: string;

function rulesOn(page: string): string[] {
  const set = new Set<string>();
  for (const g of result.groups) for (const o of g.occurrences) if (new URL(o.pageUrl).pathname === page) set.add(g.ruleId);
  return [...set].sort();
}

beforeAll(async () => {
  server = await startServer(PORT);
  await rm(OUT, { recursive: true, force: true });
  const o = applyProfile(defaultOptions(ROOT + '/'), 'standard');
  o.viewports = o.viewports.map((v) => ({ ...v, enabled: ['phone-390', 'tablet-768', 'desktop-1440'].includes(v.id) }));
  o.engines = { chromium: ['phone', 'tablet', 'desktop'], webkit: ['phone'], firefox: [] };
  o.sweep = { ...o.sweep, from: 320, to: 1280, step: 20 };
  const store = new ScanStore(OUT);
  const scanner = new Scanner({ options: o, store });
  result = await scanner.run();
  dir = store.dir(scanner.id);
}, 600_000);

afterAll(async () => {
  await new Promise((r) => server?.close(r));
});

describe('skan strony testowej', () => {
  it('kończy się sukcesem i znajduje wszystkie podstrony', () => {
    expect(result.meta.status).toBe('completed');
    const paths = result.discovery.pages.map((p) => new URL(p.url).pathname).sort();
    expect(paths).toEqual(
      ['/', '/broken-menu', '/hidden-overflow', '/images', '/js-error', '/no-viewport', '/overflow', '/overlap', '/range', '/small'].sort(),
    );
    expect(result.tasks.every((t) => t.status === 'ok')).toBe(true);
  });

  it('strona poprawna nie ma błędów RWD', () => {
    const rwd = result.groups.filter(
      (g) => g.category === 'rwd' && g.occurrences.some((o) => new URL(o.pageUrl).pathname === '/'),
    );
    expect(rwd).toEqual([]);
  });

  it('wykrywa przewijanie poziome', () => {
    expect(rulesOn('/overflow')).toEqual(expect.arrayContaining(['horizontal-overflow', 'sweep-overflow']));
  });

  it('nie zgłasza przewijania, gdy jest ukryte (overflow-x: hidden), ale wskazuje ucięte treści', () => {
    const r = rulesOn('/hidden-overflow');
    expect(r).not.toContain('horizontal-overflow');
    expect(r).not.toContain('sweep-overflow');
    expect(r).toContain('content-cut-off');
  });

  it('wykrywa brak meta viewport', () => {
    expect(rulesOn('/no-viewport')).toContain('viewport-meta-missing');
  });

  it('wykrywa mały tekst, małe cele dotykowe i zoom pól na iOS', () => {
    expect(rulesOn('/small')).toEqual(expect.arrayContaining(['small-text', 'tap-target-size', 'input-zoom-ios']));
  });

  it('wykrywa zniekształcone i za duże obrazy', () => {
    expect(rulesOn('/images')).toEqual(expect.arrayContaining(['image-distorted', 'image-oversized']));
  });

  it('wykrywa nakładanie i ucinanie tekstu oraz zasłaniający pasek', () => {
    expect(rulesOn('/overlap')).toEqual(expect.arrayContaining(['text-overlap', 'text-clipped', 'fixed-coverage']));
  });

  it('wykrywa niedziałające menu mobilne', () => {
    expect(rulesOn('/broken-menu')).toContain('mobile-menu-broken');
  });

  it('znajduje błąd tylko w wąskim zakresie szerokości', () => {
    const s = result.sweeps.find((x) => x.pageUrl.endsWith('/range'))!;
    expect(s.ranges).toHaveLength(1);
    expect(s.ranges[0].from).toBeGreaterThanOrEqual(680);
    expect(s.ranges[0].to).toBeLessThanOrEqual(780);
    expect(s.ranges[0].culprits[0]?.selector).toMatch(/banner/);
  });

  it('wykrywa błędy JS, brakujące zasoby i przesunięcia układu', () => {
    expect(rulesOn('/js-error')).toEqual(expect.arrayContaining(['page-error', 'failed-resource', 'layout-shift']));
  });

  it('wykrywa niedziałające linki, a robots.txt blokuje /private', () => {
    const links = result.links.map((l) => new URL(l.url).pathname);
    expect(links).toContain('/missing-page');
    expect(result.discovery.pages.some((p) => p.url.includes('/private'))).toBe(false);
  });

  it('tworzy raport ze zrzutami i eksport do jednego pliku', async () => {
    expect(existsSync(path.join(dir, 'report.html'))).toBe(true);
    const withCrop = result.groups.filter((g) => g.cropFile);
    expect(withCrop.length).toBeGreaterThan(3);
    for (const g of withCrop) expect(existsSync(path.join(dir, g.cropFile!))).toBe(true);
    const single = path.join(dir, 'single.html');
    await exportSingleFile(dir, single);
    expect(existsSync(single)).toBe(true);
  });

  it('wynik jest w zakresie 0–100', () => {
    expect(result.meta.summary!.score).toBeGreaterThanOrEqual(0);
    expect(result.meta.summary!.score).toBeLessThan(80);
  });
});
