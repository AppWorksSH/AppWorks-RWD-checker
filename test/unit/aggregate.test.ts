import { describe, expect, it } from 'vitest';
import { buildGroups, collectRecords, compareGroups, computeScore, fingerprint, summarize } from '../../src/core/aggregate';
import { aggregateRanges, type WidthSample } from '../../src/core/sweep';
import type { Issue, IssueGroup, TaskResult } from '../../src/core/types';

function task(pageUrl: string, viewportId: string, issues: Issue[]): TaskResult {
  return {
    key: `${pageUrl}|${viewportId}`,
    pageUrl,
    viewportId,
    engine: 'chromium',
    status: 'ok',
    issues,
    metrics: { loadMs: 1, cls: 0, docWidth: 390, docHeight: 1000, viewportWidth: 390 },
    durationMs: 1,
  };
}

const overflow = (px: number): Issue => ({
  ruleId: 'horizontal-overflow',
  severity: 'critical',
  message: `Element wychodzi ${px} px poza prawą krawędź ekranu.`,
  selector: 'div.promo',
  signature: 'div.promo',
});

describe('fingerprint', () => {
  it('ignoruje liczby w komunikacie, gdy brak sygnatury', () => {
    const a: Issue = { ruleId: 'console-error', severity: 'low', message: 'Błąd w linii 12' };
    const b: Issue = { ruleId: 'console-error', severity: 'low', message: 'Błąd w linii 87' };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
  it('klucz ma pierwszeństwo przed sygnaturą', () => {
    expect(fingerprint({ ...overflow(1), key: 'k' })).toBe('horizontal-overflow|k');
  });
});

describe('buildGroups', () => {
  const pages = ['/a', '/b', '/c', '/d'].map((p) => 'https://example.com' + p);
  const tasks = [
    ...pages.map((p) => task(p, 'phone-390', [overflow(200)])),
    task(pages[0], 'phone-360', [overflow(230)]),
    task(pages[1], 'desktop-1440', [{ ruleId: 'small-text', severity: 'medium', message: 'Mały tekst', signature: 'p.x' }]),
  ];
  const groups = buildGroups(collectRecords(tasks, [], []), pages.length);

  it('łączy ten sam problem z wielu podstron', () => {
    const g = groups.find((x) => x.ruleId === 'horizontal-overflow')!;
    expect(g.occurrences).toHaveLength(5);
    expect(g.pageCount).toBe(4);
    expect(g.viewportIds.sort()).toEqual(['phone-360', 'phone-390']);
    expect(g.global).toBe(true);
  });
  it('sortuje wg wagi', () => {
    expect(groups.map((g) => g.ruleId)).toEqual(['horizontal-overflow', 'small-text']);
  });
  it('pomija ignorowane i wyłączone', () => {
    const fp = fingerprint(overflow(1));
    expect(buildGroups(collectRecords(tasks, [], []), 4, { ignoredFingerprints: [fp] }).map((g) => g.ruleId)).toEqual(['small-text']);
    expect(buildGroups(collectRecords(tasks, [], []), 4, { disabledRules: ['small-text'] }).map((g) => g.ruleId)).toEqual([
      'horizontal-overflow',
    ]);
  });
  it('linki trafiają do każdej strony, na której występują', () => {
    const g = buildGroups(
      collectRecords([], [], [{ url: 'https://example.com/x', status: 404, external: false, foundOn: pages.slice(0, 2) }]),
      4,
    );
    expect(g[0].ruleId).toBe('broken-link');
    expect(g[0].pageCount).toBe(2);
  });
});

describe('wynik i porównanie', () => {
  it('wynik 100 bez problemów, spada z wagą problemów', () => {
    expect(computeScore([])).toBe(100);
    const mk = (severity: IssueGroup['severity'], category: IssueGroup['category'] = 'rwd'): IssueGroup =>
      ({ severity, category, global: false }) as IssueGroup;
    const low = computeScore([mk('low')]);
    const crit = computeScore([mk('critical')]);
    expect(low).toBeGreaterThan(crit);
    expect(computeScore([mk('critical', 'tech')])).toBeGreaterThan(crit);
    expect(computeScore(Array.from({ length: 50 }, () => mk('critical')))).toBeGreaterThanOrEqual(0);
  });

  it('summarize liczy wg wagi i kategorii', () => {
    const groups = buildGroups(collectRecords([task('https://e.com/', 'phone-390', [overflow(1)])], [], []), 1);
    const s = summarize(groups, [task('https://e.com/', 'phone-390', [])], 1);
    expect(s.bySeverity.critical).toBe(1);
    expect(s.byCategory.rwd).toBe(1);
  });

  it('compareGroups oznacza nowe i naprawione', () => {
    const cur = [{ fingerprint: 'a' }, { fingerprint: 'b' }] as IssueGroup[];
    const c = compareGroups(cur, {
      id: 'p',
      date: '2026-01-01',
      score: 50,
      groups: [
        { fingerprint: 'b', ruleId: 'x', message: '', severity: 'low' },
        { fingerprint: 'c', ruleId: 'y', message: 'naprawiony', severity: 'high' },
      ],
    });
    expect(c.newCount).toBe(1);
    expect(c.persisting).toBe(1);
    expect(c.fixed.map((f) => f.fingerprint)).toEqual(['c']);
    expect(cur[0].isNew).toBe(true);
    expect(cur[1].isNew).toBe(false);
  });
});

describe('aggregateRanges', () => {
  const sample = (width: number, overflow: number, sel = 'div.banner'): WidthSample => ({
    width,
    overflow,
    culprits: overflow > 1 ? [{ selector: sel, signature: sel, snippet: '' }] : [],
  });

  it('łączy kolejne szerokości w zakresy', () => {
    const samples = [690, 700, 710, 720, 730, 740, 750, 760, 770].map((w) => sample(w, w >= 700 && w <= 760 ? 800 - w : 0));
    const r = aggregateRanges(samples, 10);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ from: 700, to: 760, maxOverflow: 100, worstWidth: 700 });
    expect(r[0].culprits[0].selector).toBe('div.banner');
  });
  it('rozdziela przerwane zakresy', () => {
    const r = aggregateRanges([sample(320, 50), sample(330, 0), sample(340, 20), sample(350, 20)], 10);
    expect(r.map((x) => [x.from, x.to])).toEqual([
      [320, 320],
      [340, 350],
    ]);
  });
  it('ignoruje przepełnienie 1 px (zaokrąglenia)', () => {
    expect(aggregateRanges([sample(320, 1), sample(330, 0.5)], 10)).toEqual([]);
  });
});
