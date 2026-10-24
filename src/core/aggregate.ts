import { maxSeverity, ruleMeta, severityRank } from './rules';
import type {
  Comparison,
  EngineName,
  Issue,
  IssueGroup,
  LinkCheck,
  Occurrence,
  RuleCategory,
  ScanSummary,
  Severity,
  SweepResult,
  TaskResult,
} from './types';

export interface IssueRecord {
  issue: Issue;
  pageUrl: string;
  viewportId: string;
  engine: EngineName | 'all';
  taskKey?: string;
  issueIndex?: number;
}

export function fingerprint(i: Issue): string {
  const id = i.key ?? i.signature ?? i.message.replace(/\d+([.,]\d+)?/g, '#').slice(0, 140);
  return `${i.ruleId}|${id}`;
}

export function sweepIssues(s: SweepResult): Issue[] {
  return s.ranges.map((r) => {
    const c = r.culprits[0];
    return {
      ruleId: 'sweep-overflow',
      severity: r.to - r.from >= 40 ? 'high' : 'medium',
      message:
        `Przewijanie poziome przy szerokości ${r.from === r.to ? `${r.from} px` : `${r.from}–${r.to} px`} ` +
        `(maks. ${r.maxOverflow} px nadmiaru przy ${r.worstWidth} px)` +
        (c ? `. Przyczyna: ${c.selector}` : '. Nie wskazano elementu (możliwy pseudo-element lub margines).'),
      selector: c?.selector,
      signature: c?.signature ?? 'nieznany',
      snippet: c?.snippet,
      cropFile: r.screenshot?.file,
      details: { from: r.from, to: r.to, maxOverflow: r.maxOverflow, worstWidth: r.worstWidth, culprits: r.culprits },
    } satisfies Issue;
  });
}

export function linkIssues(l: LinkCheck): Issue {
  return {
    ruleId: 'broken-link',
    severity: l.external ? 'medium' : 'high',
    message: `Link ${l.external ? 'zewnętrzny ' : ''}do ${l.url} ${l.status ? `zwraca HTTP ${l.status}` : `nie działa (${l.error ?? 'błąd połączenia'})`}.`,
    key: l.url,
    details: { url: l.url, status: l.status, error: l.error, foundOn: l.foundOn },
  };
}

export function collectRecords(tasks: TaskResult[], sweeps: SweepResult[], links: LinkCheck[]): IssueRecord[] {
  const out: IssueRecord[] = [];
  for (const t of tasks) {
    t.issues.forEach((issue, issueIndex) =>
      out.push({ issue, pageUrl: t.pageUrl, viewportId: t.viewportId, engine: t.engine, taskKey: t.key, issueIndex }),
    );
  }
  for (const s of sweeps) {
    for (const issue of sweepIssues(s)) {
      const d = issue.details as { from: number; to: number };
      out.push({ issue, pageUrl: s.pageUrl, viewportId: `sweep:${d.from}-${d.to}`, engine: 'chromium' });
    }
  }
  for (const l of links) {
    const issue = linkIssues(l);
    for (const page of l.foundOn) out.push({ issue, pageUrl: page, viewportId: 'all', engine: 'all' });
  }
  return out;
}

export function buildGroups(
  records: IssueRecord[],
  totalPages: number,
  opts: { ignoredFingerprints?: string[]; disabledRules?: string[] } = {},
): IssueGroup[] {
  const ignored = new Set(opts.ignoredFingerprints ?? []);
  const disabled = new Set(opts.disabledRules ?? []);
  const map = new Map<string, IssueGroup & { _pages: Set<string>; _vps: Set<string> }>();

  for (const rec of records) {
    const i = rec.issue;
    if (i.severity === 'info' && i.ruleId !== 'console-error') continue;
    if (disabled.has(i.ruleId)) continue;
    const fp = fingerprint(i);
    if (ignored.has(fp)) continue;
    let g = map.get(fp);
    if (!g) {
      g = {
        fingerprint: fp,
        ruleId: i.ruleId,
        category: ruleMeta(i.ruleId).category,
        severity: i.severity,
        message: i.message,
        selector: i.selector,
        signature: i.signature,
        snippet: i.snippet,
        cropFile: i.cropFile,
        details: i.details,
        occurrences: [],
        pageCount: 0,
        viewportIds: [],
        global: false,
        _pages: new Set(),
        _vps: new Set(),
      };
      map.set(fp, g);
    }
    if (severityRank(i.severity) < severityRank(g.severity)) {
      g.severity = maxSeverity(g.severity, i.severity);
      g.message = i.message;
      if (i.cropFile) g.cropFile = i.cropFile;
    }
    if (!g.cropFile && i.cropFile) g.cropFile = i.cropFile;
    const occ: Occurrence = {
      pageUrl: rec.pageUrl,
      viewportId: rec.viewportId,
      engine: rec.engine,
      taskKey: rec.taskKey,
      issueIndex: rec.issueIndex,
      message: i.message,
      rect: i.rect,
      cropFile: i.cropFile,
    };
    g.occurrences.push(occ);
    g._pages.add(rec.pageUrl);
    g._vps.add(rec.viewportId);
  }

  const globalThreshold = Math.max(3, Math.ceil(totalPages * 0.6));
  const groups: IssueGroup[] = [...map.values()].map(({ _pages, _vps, ...g }) => ({
    ...g,
    pageCount: _pages.size,
    viewportIds: [..._vps],
    global: totalPages >= 3 && _pages.size >= globalThreshold,
  }));

  groups.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      Number(b.global) - Number(a.global) ||
      b.pageCount - a.pageCount ||
      b.occurrences.length - a.occurrences.length,
  );
  return groups;
}

const WEIGHTS: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 0.5, info: 0 };
const CATEGORY_WEIGHT: Record<RuleCategory, number> = { rwd: 1, ai: 0.6, a11y: 0.5, tech: 0.4 };

export function computeScore(groups: IssueGroup[]): number {
  let sum = 0;
  for (const g of groups) sum += WEIGHTS[g.severity] * CATEGORY_WEIGHT[g.category] * (g.global ? 1.5 : 1);
  return Math.round(100 * Math.exp(-sum / 60));
}

export function summarize(groups: IssueGroup[], tasks: TaskResult[], pages: number): ScanSummary {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory: Record<RuleCategory, number> = { rwd: 0, a11y: 0, tech: 0, ai: 0 };
  for (const g of groups) {
    bySeverity[g.severity]++;
    byCategory[g.category]++;
  }
  return {
    score: computeScore(groups),
    bySeverity,
    byCategory,
    pages,
    tasks: tasks.length,
    failedTasks: tasks.filter((t) => t.status === 'error').length,
  };
}

export function compareGroups(
  groups: IssueGroup[],
  prev: { id: string; date: string; score: number; groups: Pick<IssueGroup, 'fingerprint' | 'ruleId' | 'message' | 'severity'>[] },
): Comparison {
  const prevSet = new Set(prev.groups.map((g) => g.fingerprint));
  const curSet = new Set(groups.map((g) => g.fingerprint));
  let newCount = 0;
  let persisting = 0;
  for (const g of groups) {
    g.isNew = !prevSet.has(g.fingerprint);
    if (g.isNew) newCount++;
    else persisting++;
  }
  const fixed = prev.groups
    .filter((g) => !curSet.has(g.fingerprint))
    .map(({ fingerprint, ruleId, message, severity }) => ({ fingerprint, ruleId, message, severity }));
  return { previousId: prev.id, previousDate: prev.date, previousScore: prev.score, newCount, fixed, persisting };
}
