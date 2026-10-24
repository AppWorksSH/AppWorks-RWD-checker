import { readFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { nodeRequire } from './resolve';
import type { Issue, Severity } from './types';

let axeSource: string | null = null;
let axeLocale: unknown = null;

function loadAxe(): { source: string; locale: unknown } {
  if (!axeSource) {
    axeSource = readFileSync(nodeRequire.resolve('axe-core/axe.min.js'), 'utf8');
    try {
      axeLocale = JSON.parse(readFileSync(nodeRequire.resolve('axe-core/locales/pl.json'), 'utf8'));
    } catch {
      axeLocale = null;
    }
  }
  return { source: axeSource, locale: axeLocale };
}

const IMPACT: Record<string, Severity> = { critical: 'high', serious: 'medium', moderate: 'low', minor: 'low' };

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  description: string;
  helpUrl: string;
  nodes: { target: string; html: string; summary: string; rect?: { x: number; y: number; width: number; height: number } }[];
  total: number;
}

export async function runAxe(page: Page): Promise<Issue[]> {
  const { source, locale } = loadAxe();
  await page.addScriptTag({ content: source });
  const violations: AxeViolation[] = await page.evaluate(async (loc) => {
    const w = window as unknown as { axe: any };
    if (loc) {
      try {
        w.axe.configure({ locale: loc });
      } catch {
        /* brak tłumaczenia */
      }
    }
    const res = await w.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    });
    return res.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      total: v.nodes.length,
      nodes: v.nodes.slice(0, 8).map((n: any) => {
        const target = Array.isArray(n.target) ? n.target.map(String).join(' ') : String(n.target);
        let rect;
        try {
          const el = document.querySelector(String(n.target[n.target.length - 1]));
          if (el) {
            const r = el.getBoundingClientRect();
            rect = { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
          }
        } catch {
          /* selektor z iframe/shadow DOM */
        }
        return { target, html: String(n.html).slice(0, 240), summary: String(n.failureSummary || '').slice(0, 400), rect };
      }),
    }));
  }, locale);

  return violations.map((v) => ({
    ruleId: `axe:${v.id}`,
    severity: IMPACT[v.impact || 'minor'] ?? 'low',
    message: `${v.help} (${v.total} ${v.total === 1 ? 'element' : 'elementów'})`,
    selector: v.nodes[0]?.target,
    signature: v.id,
    snippet: v.nodes[0]?.html,
    rect: v.nodes[0]?.rect,
    key: v.id,
    details: { description: v.description, helpUrl: v.helpUrl, impact: v.impact, total: v.total, nodes: v.nodes },
  }));
}
