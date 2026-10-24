import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CATEGORY_LABELS, ENGINE_LABELS } from '../defaults';
import { CATEGORY_LABELS_RULE, RULES, SEVERITY_LABELS } from '../rules';
import type { ScanResult } from '../types';
import { reportClient } from './client';
import { reportCss } from './styles';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function buildReportHtml(result: ScanResult, opts: { inline?: (file: string) => string | null } = {}): string {
  const data = {
    meta: result.meta,
    options: result.options,
    discovery: result.discovery,
    tasks: result.tasks.map(({ aiSegments: _a, ...t }) => t),
    sweeps: result.sweeps,
    links: result.links,
    linksChecked: result.linksChecked,
    aiReviews: result.aiReviews,
    aiSummary: result.aiSummary,
    aiSummaryError: result.aiSummaryError,
    groups: result.groups,
    comparison: result.comparison,
    viewports: result.options.viewports.filter((v) => v.enabled),
    labels: {
      rules: RULES,
      severity: SEVERITY_LABELS,
      ruleCategory: CATEGORY_LABELS_RULE,
      engines: ENGINE_LABELS,
      device: CATEGORY_LABELS,
    },
  };
  const inline = opts.inline;
  const json = JSON.stringify(
    data,
    inline ? (_k, v) => (typeof v === 'string' && v.startsWith('shots/') ? (inline(v) ?? v) : v) : undefined,
  ).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raport RWD — ${escapeHtml(result.meta.host)}</title>
<style>${reportCss}</style>
</head>
<body>
<div id="app"></div>
<script id="rwd-data" type="application/json">${json}</script>
<script>(${reportClient.toString()})();</script>
</body>
</html>`;
}

export async function generateReport(result: ScanResult, scanDir: string): Promise<string> {
  const file = path.join(scanDir, 'report.html');
  await writeFile(file, buildReportHtml(result));
  return file;
}

/** Raport w jednym pliku HTML — zrzuty ekranu osadzone jako data URI. */
export async function exportSingleFile(scanDir: string, outFile: string): Promise<void> {
  const result = JSON.parse(await readFile(path.join(scanDir, 'result.json'), 'utf8')) as ScanResult;
  const cache = new Map<string, string | null>();
  const html = buildReportHtml(result, {
    inline: (file) => {
      if (cache.has(file)) return cache.get(file)!;
      let uri: string | null = null;
      try {
        uri = `data:image/jpeg;base64,${readFileSync(path.join(scanDir, file)).toString('base64')}`;
      } catch {
        uri = null;
      }
      cache.set(file, uri);
      return uri;
    },
  });
  await writeFile(outFile, html);
}

export async function regenerateReport(scanDir: string): Promise<void> {
  const result = JSON.parse(await readFile(path.join(scanDir, 'result.json'), 'utf8')) as ScanResult;
  await generateReport(result, scanDir);
}
