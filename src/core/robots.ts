interface RobotsRule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

export interface Robots {
  isAllowed(url: string): boolean;
  sitemaps: string[];
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

export function parseRobots(text: string, agents: string[] = ['rwd-checker']): Robots {
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue;
      current.rules.push({ allow: key === 'allow', pattern: value, re: toRegExp(value) });
    }
  }

  const wanted = agents.map((a) => a.toLowerCase());
  let rules = groups.filter((g) => g.agents.some((a) => wanted.includes(a))).flatMap((g) => g.rules);
  if (!rules.length) rules = groups.filter((g) => g.agents.includes('*')).flatMap((g) => g.rules);

  return {
    sitemaps,
    isAllowed(url: string) {
      let path: string;
      try {
        const u = new URL(url);
        path = u.pathname + u.search;
      } catch {
        return true;
      }
      let best: RobotsRule | null = null;
      for (const r of rules) {
        if (r.re.test(path)) {
          if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}
