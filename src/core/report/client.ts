/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Skrypt raportu wykonywany w przeglądarce. Serializowany przez toString(),
 * więc nie może odwoływać się do niczego spoza swojego ciała.
 */
export function reportClient(): void {
  const D: any = JSON.parse(document.getElementById('rwd-data')!.textContent || '{}');
  const L: any = D.labels;
  const app: any = (window as any).rwdApp;
  const PRINT = location.hash === '#print';
  const root = document.getElementById('app')!;

  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const plural = (n: number, one: string, few: string, many: string) => {
    if (n === 1) return one;
    const d = n % 10;
    const h = n % 100;
    return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
  };
  const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleString('pl-PL') : '—');
  const fmtDur = (ms: number) => {
    if (!ms) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  };
  const pathOf = (url: string) => {
    try {
      const u = new URL(url);
      return decodeURI(u.pathname + u.search) || '/';
    } catch {
      return url;
    }
  };
  const vpById: Record<string, any> = {};
  for (const v of D.viewports) vpById[v.id] = v;
  const vpLabel = (id: string) =>
    id === 'all' ? 'wszystkie' : id.startsWith('sweep:') ? `zakres ${id.slice(6).replace('-', '–')} px` : vpById[id]?.label ?? id;
  const vpCat = (id: string) => (id === 'all' ? 'all' : id.startsWith('sweep') ? 'sweep' : vpById[id]?.category ?? 'desktop');
  const engineLabel = (e: string) => (e === 'all' ? '—' : L.engines[e] ?? e);
  const rule = (id: string) =>
    L.rules[id] ??
    (id.startsWith('axe:')
      ? { title: 'Dostępność: ' + id.slice(4), category: 'a11y', description: '', fix: '' }
      : { title: id, category: 'rwd', description: '', fix: '' });
  const SEVS = ['critical', 'high', 'medium', 'low'];
  const sevRank = (s: string) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(s);

  const tasksByKey: Record<string, any> = {};
  const tasksByPage: Record<string, any[]> = {};
  for (const t of D.tasks) {
    tasksByKey[t.key] = t;
    (tasksByPage[t.pageUrl] ??= []).push(t);
  }
  const groupsByCat = (cats: string[]) => D.groups.filter((g: any) => cats.includes(g.category));

  const state = {
    tab: 'problems',
    sev: new Set(SEVS),
    dev: 'all',
    engine: 'all',
    q: '',
    onlyNew: false,
    onlyGlobal: false,
  };

  const md = (src: string) => {
    const inline = (s: string) =>
      esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
    let html = '';
    let list: string | null = null;
    const close = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    for (const raw of src.replace(/\r/g, '').split('\n')) {
      const l = raw.trimEnd();
      let m: RegExpMatchArray | null;
      if (!l.trim()) {
        close();
        continue;
      }
      if ((m = l.match(/^#{1,6}\s+(.*)/))) {
        close();
        html += `<h3>${inline(m[1])}</h3>`;
      } else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) {
        if (list !== 'ul') {
          close();
          html += '<ul>';
          list = 'ul';
        }
        html += `<li>${inline(m[1])}</li>`;
      } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
        if (list !== 'ol') {
          close();
          html += '<ol>';
          list = 'ol';
        }
        html += `<li>${inline(m[1])}</li>`;
      } else {
        close();
        html += `<p>${inline(l)}</p>`;
      }
    }
    close();
    return html;
  };

  const toast = (msg: string) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  // ---------- Nagłówek i podsumowanie ----------
  const header = () => {
    const m = D.meta;
    const vps = D.viewports.length;
    const statusText: Record<string, string> = {
      cancelled: 'Skan został przerwany — raport jest niepełny.',
      failed: `Skan zakończył się błędem: ${m.error ?? ''}. Raport może być niepełny.`,
      running: 'Skan w toku — raport częściowy.',
    };
    return `<header class="top"><div class="wrap">
      <div class="brand">RWD Checker · AppWorks</div>
      <h1>Raport RWD — ${esc(m.host)}</h1>
      <div class="meta"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.url)}</a> · ${fmtDate(m.startedAt)} · czas skanu ${fmtDur(m.durationMs)} ·
      ${D.discovery.pages.length} ${plural(D.discovery.pages.length, 'podstrona', 'podstrony', 'podstron')} · ${vps} ${plural(vps, 'rozdzielczość', 'rozdzielczości', 'rozdzielczości')}</div>
      ${statusText[m.status] ? `<div class="status-banner">${esc(statusText[m.status])}</div>` : ''}
    </div></header>`;
  };

  const summary = () => {
    const s = D.meta.summary ?? { score: 0, bySeverity: {}, byCategory: {}, tasks: 0, failedTasks: 0 };
    const color = s.score >= 85 ? 'var(--ok)' : s.score >= 60 ? 'var(--medium)' : 'var(--critical)';
    const sev = SEVS.map(
      (k) => `<div class="sev-box sev-${k}"><b>${s.bySeverity[k] ?? 0}</b><span>${L.severity[k]}</span></div>`,
    ).join('');
    const cats = Object.keys(L.ruleCategory)
      .map((k) => `<span>${L.ruleCategory[k]}: <b>${s.byCategory[k] ?? 0}</b></span>`)
      .join('');
    let cmp = '<p class="muted">Brak wcześniejszego skanu tej witryny do porównania.</p>';
    if (D.comparison) {
      const c = D.comparison;
      const delta = s.score - c.previousScore;
      cmp = `<p>Poprzedni skan: <b>${fmtDate(c.previousDate)}</b><br>Wynik: ${c.previousScore} → <b>${s.score}</b>
        <span class="${delta >= 0 ? 'delta-up' : 'delta-down'}">(${delta >= 0 ? '+' : ''}${delta})</span></p>
        <p>Nowe problemy: <b>${c.newCount}</b> · Naprawione: <b>${c.fixed.length}</b> · Bez zmian: <b>${c.persisting}</b></p>
        ${c.fixed.length ? `<ul>${c.fixed.slice(0, 6).map((f: any) => `<li>${esc(rule(f.ruleId).title)}: ${esc(f.message.slice(0, 90))}</li>`).join('')}${c.fixed.length > 6 ? `<li>… i ${c.fixed.length - 6} więcej</li>` : ''}</ul>` : ''}`;
    }
    return `<div class="wrap"><section class="summary">
      <div class="card score"><div class="ring" style="--p:${s.score};--c:${color}"><span>${s.score}</span></div><small>Wynik RWD (0–100)</small></div>
      <div class="card"><h3>Grupy problemów</h3><div class="sevs">${sev}</div><div class="cats">${cats}</div>
        <div class="cats"><span>Sprawdzonych widoków: <b>${s.tasks}</b></span>${s.failedTasks ? `<span>Nieudanych: <b>${s.failedTasks}</b></span>` : ''}${D.linksChecked ? `<span>Sprawdzonych linków: <b>${D.linksChecked}</b></span>` : ''}</div></div>
      <div class="card cmp"><h3>Porównanie</h3>${cmp}</div>
    </section>
    ${D.aiSummary ? `<section class="card ai-summary"><h3>Podsumowanie AI</h3><div class="md">${md(D.aiSummary)}</div></section>` : ''}
    ${D.aiSummaryError ? `<p class="muted">Podsumowanie AI niedostępne: ${esc(D.aiSummaryError)}</p>` : ''}
    </div>`;
  };

  // ---------- Karty problemów ----------
  const filteredOcc = (g: any) =>
    g.occurrences.filter(
      (o: any) =>
        (state.dev === 'all' || o.viewportId === 'all' || vpCat(o.viewportId) === state.dev) &&
        (state.engine === 'all' || o.engine === 'all' || o.engine === state.engine),
    );

  const groupMatches = (g: any) => {
    if (!state.sev.has(g.severity)) return false;
    if (state.onlyNew && !g.isNew) return false;
    if (state.onlyGlobal && !g.global) return false;
    if (state.q) {
      const hay = `${rule(g.ruleId).title} ${g.message} ${g.selector ?? ''} ${g.occurrences.map((o: any) => o.pageUrl).join(' ')}`.toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return filteredOcc(g).length > 0;
  };

  const kv = (k: string, v: string) => `<div class="kv"><b>${k}</b>${v}</div>`;

  const groupCard = (g: any) => {
    const occ = PRINT ? g.occurrences : filteredOcc(g);
    const pages = new Set(occ.map((o: any) => o.pageUrl)).size;
    const vps = new Set(occ.map((o: any) => o.viewportId)).size;
    const r = rule(g.ruleId);
    const d = g.details ?? {};
    let extra = '';
    if (d.helpUrl) extra += kv('Dokumentacja', `<a href="${esc(d.helpUrl)}" target="_blank" rel="noopener">${esc(d.helpUrl)}</a>`);
    if (d.description && g.ruleId.startsWith('axe:')) extra += kv('Opis reguły', esc(d.description));
    if (Array.isArray(d.nodes) && d.nodes.length)
      extra += kv(
        'Przykładowe elementy',
        d.nodes
          .slice(0, 5)
          .map((n: any) => `<pre>${esc(n.target)}\n${esc(n.html)}${n.summary ? '\n\n' + esc(n.summary) : ''}</pre>`)
          .join(''),
      );
    if (Array.isArray(d.culprits) && d.culprits.length > 1)
      extra += kv('Inne elementy w tym zakresie', d.culprits.slice(1).map((c: any) => `<code>${esc(c.selector)}</code>`).join(' '));
    if (Array.isArray(d.foundOn)) extra += kv('Link znajduje się na', d.foundOn.map((u: string) => `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(pathOf(u))}</a></div>`).join(''));
    if (d.moreCount) extra += kv('Uwaga', `Na tym widoku jest jeszcze ${d.moreCount} podobnych elementów.`);

    const rows = occ
      .slice()
      .sort((a: any, b: any) => a.pageUrl.localeCompare(b.pageUrl))
      .slice(0, PRINT ? 12 : 60)
      .map(
        (o: any) => `<tr><td class="url"><a href="${esc(o.pageUrl)}" target="_blank" rel="noopener">${esc(pathOf(o.pageUrl))}</a></td>
        <td>${esc(vpLabel(o.viewportId))}</td><td>${esc(engineLabel(o.engine))}</td>
        <td>${o.message !== g.message ? esc(o.message) : '<span class="muted">—</span>'}</td>
        <td>${o.taskKey && tasksByKey[o.taskKey]?.screenshot ? `<button class="btn" data-open-task="${esc(o.taskKey)}" data-issue="${o.issueIndex}">Zrzut</button>` : ''}</td></tr>`,
      )
      .join('');
    const more = occ.length > (PRINT ? 12 : 60) ? `<p class="muted">… i ${occ.length - (PRINT ? 12 : 60)} kolejnych wystąpień</p>` : '';
    const crop = g.cropFile;
    return `<details class="issue sev-${g.severity}" ${PRINT ? 'open' : ''}>
      <summary><div class="head"><span class="badge">${L.severity[g.severity]}</span><span class="title">${esc(r.title)}</span>
        ${g.global ? '<span class="badge global">Globalny</span>' : ''}${g.isNew ? '<span class="badge new">Nowy</span>' : ''}${g.category === 'ai' ? '<span class="badge ai">AI</span>' : ''}
        <span class="where">${pages} ${plural(pages, 'podstrona', 'podstrony', 'podstron')} · ${vps} ${plural(vps, 'widok', 'widoki', 'widoków')}</span></div>
        <p class="msg">${esc(g.message)}</p></summary>
      <div class="body">
        <div class="cols ${crop ? '' : 'single'}"><div>
          ${r.description ? kv('Na czym polega problem', esc(r.description)) : ''}
          ${r.fix ? kv('Jak naprawić', esc(r.fix)) : ''}
          ${g.selector ? kv('Element', `<code>${esc(g.selector)}</code>`) : ''}
          ${g.snippet && !g.ruleId.startsWith('axe:') ? kv('Kod', `<pre>${esc(g.snippet)}</pre>`) : ''}
          ${extra}
        </div>${crop ? `<div><img class="crop" ${PRINT ? '' : 'loading="lazy"'} src="${esc(crop)}" data-zoom alt=""></div>` : ''}</div>
        ${rows ? `<table><thead><tr><th>Podstrona</th><th>Widok</th><th>Przeglądarka</th><th>Szczegóły</th><th></th></tr></thead><tbody>${rows}</tbody></table>${more}` : ''}
        ${app && !PRINT ? `<div style="margin-top:10px;display:flex;gap:8px"><button class="btn" data-ignore="${esc(g.fingerprint)}" data-title="${esc(r.title)}">Ignoruj ten problem w kolejnych skanach</button>${g.selector && g.category !== 'tech' ? `<button class="btn" data-ignore-sel="${esc(g.selector)}">Ignoruj element ${esc(g.selector.length > 40 ? g.selector.slice(0, 40) + '…' : g.selector)}</button>` : ''}</div>` : ''}
      </div></details>`;
  };

  const filtersBar = (opts: { devices: boolean }) => {
    const sevChips = SEVS.map(
      (s) => `<button class="chip sev-${s} ${state.sev.has(s) ? 'on' : ''}" data-sev="${s}"><span class="dot"></span>${L.severity[s]}</button>`,
    ).join('');
    const devs = [
      ['all', 'Wszystkie urządzenia'],
      ['phone', 'Telefon'],
      ['tablet', 'Tablet'],
      ['desktop', 'Desktop'],
      ...(D.sweeps.length ? [['sweep', 'Zakresy szerokości']] : []),
    ];
    const devChips = opts.devices
      ? devs.map(([k, l]) => `<button class="chip ${state.dev === k ? 'on' : ''}" data-dev="${k}">${l}</button>`).join('')
      : '';
    const engines = [...new Set(D.tasks.map((t: any) => t.engine))] as string[];
    const engSel =
      opts.devices && engines.length > 1
        ? `<select data-engine><option value="all">Wszystkie przeglądarki</option>${engines.map((e) => `<option value="${e}" ${state.engine === e ? 'selected' : ''}>${esc(engineLabel(e))}</option>`).join('')}</select>`
        : '';
    return `<div class="filters">${sevChips}<span style="width:8px"></span>${devChips}${engSel}
      <input type="search" placeholder="Szukaj (opis, element, adres)…" value="${esc(state.q)}" data-search>
      ${D.comparison ? `<label><input type="checkbox" data-only-new ${state.onlyNew ? 'checked' : ''}> tylko nowe</label>` : ''}
      <label><input type="checkbox" data-only-global ${state.onlyGlobal ? 'checked' : ''}> tylko globalne</label></div>`;
  };

  const groupList = (cats: string[], empty: string) => {
    const list = groupsByCat(cats).filter(groupMatches);
    if (!list.length) return `<div class="empty">${empty}</div>`;
    return `<p class="muted">${list.length} ${plural(list.length, 'grupa', 'grupy', 'grup')} problemów. Kliknij, aby zobaczyć szczegóły, zrzut ekranu i listę wystąpień.</p>` + list.map(groupCard).join('');
  };

  // ---------- Widoki ----------
  const viewProblems = () => filtersBar({ devices: true }) + `<div id="list">${groupList(['rwd', 'ai'], 'Brak problemów RWD dla wybranych filtrów. 🎉')}</div>`;
  const viewA11y = () =>
    `<p class="muted">Testy dostępności (axe-core, WCAG 2.2 AA) uruchamiane są na pierwszym widoku telefonu i desktopu.</p>` +
    filtersBar({ devices: false }) +
    `<div id="list">${groupList(['a11y'], 'Brak problemów dostępności dla wybranych filtrów.')}</div>`;
  const viewTech = () => {
    let html = filtersBar({ devices: true }) + `<div id="list">${groupList(['tech'], 'Brak problemów technicznych dla wybranych filtrów.')}</div>`;
    if (D.links.length) {
      html += `<h2 class="section-title">Niedziałające linki (${D.links.length})</h2><table><thead><tr><th>Adres</th><th>Status</th><th>Znaleziony na</th></tr></thead><tbody>${D.links
        .map(
          (l: any) => `<tr><td class="url">${esc(l.url)}${l.external ? ' <span class="badge soft">zewnętrzny</span>' : ''}</td><td>${l.status || esc(l.error ?? 'błąd')}</td>
          <td class="url">${l.foundOn.slice(0, 5).map((u: string) => `<div><a href="${esc(u)}" target="_blank" rel="noopener">${esc(pathOf(u))}</a></div>`).join('')}${l.foundOn.length > 5 ? `<div class="muted">+${l.foundOn.length - 5}</div>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table>`;
    }
    return html;
  };

  const pageSev: Record<string, Record<string, number>> = {};
  for (const g of D.groups) {
    for (const p of new Set(g.occurrences.map((o: any) => o.pageUrl)) as Set<string>) {
      pageSev[p] ??= { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      pageSev[p][g.severity]++;
    }
  }

  const taskChip = (t: any) => {
    const vp = vpById[t.viewportId];
    const serious = t.issues.filter((i: any) => sevRank(i.severity) <= 2);
    const worst = serious.reduce((w: string, i: any) => (sevRank(i.severity) < sevRank(w) ? i.severity : w), 'low');
    const icon = vp?.category === 'phone' ? '📱' : vp?.category === 'tablet' ? '▭' : '🖥';
    const eng = t.engine === 'chromium' ? 'Ch' : t.engine === 'webkit' ? 'Sf' : 'Ff';
    return `<span class="tchip sev-${worst} ${serious.length ? '' : 'ok'} ${t.status === 'error' ? 'err' : ''}" data-open-task="${esc(t.key)}" title="${esc((vp?.label ?? t.viewportId) + ' · ' + engineLabel(t.engine))}">
      ${icon} ${vp?.width ?? ''} <span class="muted">${eng}</span> <i>${t.status === 'error' ? '!' : serious.length || '✓'}</i></span>`;
  };

  const viewPages = () => {
    const rows = D.discovery.pages
      .map((p: any) => {
        const s = pageSev[p.url] ?? {};
        const counts = SEVS.filter((k) => s[k]).map((k) => `<span class="badge sev-${k}">${s[k]}</span>`).join(' ') || '<span class="muted">brak</span>';
        const tasks = (tasksByPage[p.url] ?? []).map(taskChip).join('');
        return `<tr><td class="url"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(pathOf(p.url))}</a><div class="muted">${esc(p.title ?? '')}</div></td>
          <td>${counts}</td><td><div class="task-chips">${tasks}</div></td></tr>`;
      })
      .join('');
    return `<p class="muted">Kliknij widok, aby zobaczyć pełny zrzut strony z zaznaczonymi problemami. Liczba przy widoku = problemy o wadze średniej lub wyższej. Ch = Chrome, Sf = Safari, Ff = Firefox.</p>
      <table><thead><tr><th style="width:32%">Podstrona</th><th style="width:14%">Grupy problemów</th><th>Widoki</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const viewSweep = () => {
    if (!D.sweeps.length) return '<div class="empty">Skan zakresów szerokości nie był uruchomiony.</div>';
    const o = D.options.sweep;
    const span = Math.max(1, o.to - o.from);
    const widths = [...new Set(D.viewports.map((v: any) => v.width))].filter((w: any) => w >= o.from && w <= o.to) as number[];
    let lastLabel = -100;
    const ticks = [...new Set([o.from, ...widths.sort((a, b) => a - b), o.to])]
      .map((w) => {
        const pos = ((w - o.from) / span) * 100;
        const showLabel = pos - lastLabel > 3.5 || w === o.to;
        if (showLabel) lastLabel = pos;
        return `<div class="tick" style="left:${pos}%"><span>${showLabel ? w : ''}</span></div>`;
      })
      .join('');
    const bad = D.sweeps.filter((s: any) => s.ranges.length).length;
    const sorted = D.sweeps.slice().sort((a: any, b: any) => b.ranges.length - a.ranges.length);
    return `<p class="muted">Symulacja zmiany szerokości okna przeglądarki (Chromium) od ${o.from} do ${o.to} px co ${o.step} px. Czerwone pola oznaczają szerokości, przy których strona przewija się poziomo. Pionowe kreski to testowane rozdzielczości.
      Problemy w zakresach: <b>${bad}</b> z ${D.sweeps.length} podstron.</p>` +
      sorted
        .map((s: any) => {
          const rng = s.ranges
            .map((r: any) => `<div class="rng" title="${r.from}–${r.to} px" style="left:${((r.from - o.from) / span) * 100}%;width:${Math.max(0.4, ((r.to - r.from + s.step) / span) * 100)}%"></div>`)
            .join('');
          const details = s.ranges
            .map(
              (r: any) => `<div class="range"><b>${r.from === r.to ? r.from : `${r.from}–${r.to}`} px</b> · maks. ${r.maxOverflow} px nadmiaru przy ${r.worstWidth} px
              ${r.culprits.length ? `<div>Przyczyna: ${r.culprits.slice(0, 3).map((c: any) => `<code>${esc(c.selector)}</code>`).join(' ')}</div>` : '<div class="muted">Nie wskazano elementu.</div>'}
              ${r.screenshot ? `<img class="crop" ${PRINT ? '' : 'loading="lazy"'} src="${esc(r.screenshot.file)}" data-zoom alt="">` : ''}</div>`,
            )
            .join('');
          return `<div class="sweep-row"><div><a href="${esc(s.pageUrl)}" target="_blank" rel="noopener"><b>${esc(pathOf(s.pageUrl))}</b></a>
            ${s.status === 'error' ? ` <span class="badge sev-high">błąd: ${esc(s.error)}</span>` : s.ranges.length ? ` <span class="badge sev-high">${s.ranges.length} ${plural(s.ranges.length, 'zakres', 'zakresy', 'zakresów')}</span>` : ' <span class="badge" style="background:var(--ok)">OK</span>'}
            <span class="muted"> · sprawdzono ${s.checkedWidths} szerokości</span></div>
            <div class="bar ${s.status === 'error' ? 'err' : ''}">${rng}${ticks}</div>${details ? `<div class="ranges">${details}</div>` : ''}</div>`;
        })
        .join('');
  };

  const viewInfo = () => {
    const o = D.options;
    const engines = Object.keys(o.engines)
      .filter((e) => o.engines[e].length)
      .map((e) => `${engineLabel(e)}: ${o.engines[e].map((c: string) => L.device[c]).join(', ')}`)
      .join('<br>');
    const cfg = [
      ['Adres startowy', esc(o.url)],
      ['Limit podstron / głębokość', `${o.maxPages} / ${o.maxDepth}`],
      ['Próbka szablonów', o.templateSampling ? `max ${o.templateSampling} podstron na wzorzec adresu` : 'wyłączona'],
      ['robots.txt / sitemap', `${o.respectRobots ? 'respektowany' : 'ignorowany'} (${D.discovery.robotsFound ? 'znaleziono' : 'brak'}) / ${o.useSitemap ? `${D.discovery.sitemapUrls} adresów` : 'wyłączona'}`],
      ['Przeglądarki', engines],
      ['Skan szerokości', o.sweep.enabled ? `${o.sweep.from}–${o.sweep.to} px co ${o.sweep.step} px` : 'wyłączony'],
      ['Dostępność (axe)', o.axe ? 'tak' : 'nie'],
      ['Test menu mobilnego', o.mobileMenuTest ? 'tak' : 'nie'],
      ['Sprawdzanie linków', o.checkLinks ? (o.checkExternalLinks ? 'wewnętrzne i zewnętrzne' : 'wewnętrzne') : 'nie'],
      ['Analiza AI', o.ai.enabled ? `${o.ai.provider} · ${esc(o.ai.model)} · ${D.aiReviews.length} analiz${D.aiReviews.filter((r: any) => r.error).length ? `, błędy: ${D.aiReviews.filter((r: any) => r.error).length}` : ''}` : 'wyłączona'],
      ['Ignorowane selektory', o.ignoreSelectors.length ? o.ignoreSelectors.map((s: string) => `<code>${esc(s)}</code>`).join(' ') : 'brak'],
      ['Ignorowane problemy', String(o.ignoredFingerprints.length)],
    ]
      .map(([k, v]) => `<tr><th style="width:240px">${k}</th><td>${v}</td></tr>`)
      .join('');
    const vps = D.viewports.map((v: any) => `<tr><td>${esc(v.label)}</td><td>${L.device[v.category]}</td><td>${v.width}×${v.height}</td><td>${v.deviceScaleFactor}x</td></tr>`).join('');
    const pages = D.discovery.pages
      .map((p: any) => `<tr><td class="url"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(pathOf(p.url))}</a></td><td>${esc(p.title ?? '')}</td><td>${p.depth}</td><td>${p.source === 'sitemap' ? 'mapa witryny' : p.source === 'start' ? 'start' : 'link'}</td></tr>`)
      .join('');
    const skipped = D.discovery.skipped
      .slice(0, 150)
      .map((s: any) => `<tr><td class="url">${esc(s.url)}</td><td>${esc(s.reason)}</td></tr>`)
      .join('');
    return `<div class="grid2"><div class="card"><h3>Konfiguracja skanu</h3><table>${cfg}</table></div>
      <div class="card"><h3>Rozdzielczości</h3><table><thead><tr><th>Nazwa</th><th>Typ</th><th>Wymiary</th><th>Gęstość</th></tr></thead><tbody>${vps}</tbody></table></div></div>
      <h2 class="section-title">Sprawdzone podstrony (${D.discovery.pages.length})</h2>
      <table><thead><tr><th>Adres</th><th>Tytuł</th><th>Głębokość</th><th>Źródło</th></tr></thead><tbody>${pages}</tbody></table>
      ${skipped ? `<h2 class="section-title">Pominięte adresy (${D.discovery.skipped.length})</h2><table><thead><tr><th>Adres</th><th>Powód</th></tr></thead><tbody>${skipped}</tbody></table>` : ''}`;
  };

  // ---------- Podgląd zrzutu ----------
  let modalEl: HTMLDivElement | null = null;
  const closeModal = () => {
    modalEl?.remove();
    modalEl = null;
  };

  const openViewer = (key: string, focus?: number) => {
    const t = tasksByKey[key];
    if (!t) return;
    const siblings = tasksByPage[t.pageUrl] ?? [t];
    const vp = vpById[t.viewportId];
    const issues = t.issues.map((i: any, idx: number) => ({ ...i, idx })).sort((a: any, b: any) => sevRank(a.severity) - sevRank(b.severity));
    const W = t.screenshot?.width || vp?.width || 1;
    const H = t.screenshot?.height || 1;
    let n = 0;
    const num: Record<number, number> = {};
    for (const i of issues) if (i.rect && i.rect.y < H && i.rect.width > 0) num[i.idx] = ++n;
    const boxes = issues
      .filter((i: any) => num[i.idx])
      .map((i: any) => {
        const r = i.rect;
        return `<div class="box" data-n="${num[i.idx]}" title="${esc(i.message)}" style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${Math.max(0.5, (r.width / W) * 100)}%;height:${Math.max(0.3, (Math.min(r.height, H - r.y) / H) * 100)}%"><b>${num[i.idx]}</b></div>`;
      })
      .join('');
    const side = issues.length
      ? issues
          .map(
            (i: any) => `<div class="si sev-${i.severity}" ${num[i.idx] ? `data-n="${num[i.idx]}"` : ''}>
          ${num[i.idx] ? `<span class="n">${num[i.idx]}</span>` : ''}<span class="badge">${L.severity[i.severity]}</span> <b>${esc(rule(i.ruleId).title)}</b>
          <div>${esc(i.message)}</div>${i.selector ? `<div><code>${esc(i.selector)}</code></div>` : ''}</div>`,
          )
          .join('')
      : '<p class="muted">Brak problemów na tym widoku. ✓</p>';
    const tabs = siblings
      .map((s: any) => `<button class="chip ${s.key === key ? 'on' : ''}" data-vtab="${esc(s.key)}">${esc(vpById[s.viewportId]?.label ?? s.viewportId)} · ${esc(engineLabel(s.engine))}</button>`)
      .join('');
    const shot = t.screenshot
      ? `<div class="shot" style="width:min(100%, ${Math.max(W, 360)}px)"><img src="${esc(t.screenshot.file)}" alt="">${boxes}</div>`
      : `<div class="empty">Brak zrzutu ekranu${t.error ? `: ${esc(t.error)}` : ''}</div>`;
    const menu = t.menuShot
      ? `<h3 style="text-align:center">Po kliknięciu przycisku menu</h3><div class="shot" style="width:min(100%, ${t.menuShot.width}px)"><img src="${esc(t.menuShot.file)}" alt=""></div>`
      : '';
    closeModal();
    modalEl = document.createElement('div');
    modalEl.className = 'modal';
    modalEl.innerHTML = `<div class="panel"><div class="ph"><h2>${esc(pathOf(t.pageUrl))} <span class="muted" style="font-weight:400">${esc(t.title ?? '')}</span></h2>
      <a class="btn" href="${esc(t.pageUrl)}" target="_blank" rel="noopener">Otwórz stronę</a><button class="btn" data-close>Zamknij ✕</button>
      <div class="vtabs" style="width:100%">${tabs}</div></div>
      <div class="pb"><div class="shot-area">${shot}${menu}
      <p class="muted" style="text-align:center">${t.metrics?.docWidth ? `Dokument ${t.metrics.docWidth}×${t.metrics.docHeight} px` : ''}${t.metrics?.loadMs ? ` · ładowanie ${(t.metrics.loadMs / 1000).toFixed(1)} s` : ''}${t.metrics?.cls != null ? ` · CLS ${t.metrics.cls}` : ''}${t.httpStatus ? ` · HTTP ${t.httpStatus}` : ''}</p></div>
      <div class="side">${side}</div></div></div>`;
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });
    document.body.appendChild(modalEl);
    if (focus !== undefined && num[focus]) setTimeout(() => focusBox(num[focus]), 150);
  };

  const focusBox = (n: number) => {
    if (!modalEl) return;
    const box = modalEl.querySelector(`.box[data-n="${n}"]`) as HTMLElement | null;
    const si = modalEl.querySelector(`.si[data-n="${n}"]`) as HTMLElement | null;
    if (box) {
      box.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      box.classList.remove('flash');
      void box.offsetWidth;
      box.classList.add('flash');
    }
    if (si) si.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const lightbox = (src: string) => {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${esc(src)}" alt="">`;
    lb.addEventListener('click', () => lb.remove());
    document.body.appendChild(lb);
  };

  // ---------- Render ----------
  const tabs = () => {
    const c = (cats: string[]) => groupsByCat(cats).length;
    const list: [string, string, number | null][] = [
      ['problems', 'Problemy RWD', c(['rwd', 'ai'])],
      ['pages', 'Podstrony', D.discovery.pages.length],
      ...(D.sweeps.length ? ([['sweep', 'Zakresy szerokości', D.sweeps.filter((s: any) => s.ranges.length).length]] as [string, string, number][]) : []),
      ['a11y', 'Dostępność', c(['a11y'])],
      ['tech', 'Techniczne', c(['tech'])],
      ['info', 'Informacje o skanie', null],
    ];
    return `<nav class="tabs">${list.map(([k, l, n]) => `<button data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${l}${n !== null ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</nav>`;
  };

  const views: Record<string, () => string> = { problems: viewProblems, pages: viewPages, sweep: viewSweep, a11y: viewA11y, tech: viewTech, info: viewInfo };

  const render = () => {
    const main = document.getElementById('view');
    if (main) main.innerHTML = views[state.tab]();
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.tab === state.tab));
  };

  const renderList = () => {
    const list = document.getElementById('list');
    if (!list) return render();
    const cats = state.tab === 'problems' ? ['rwd', 'ai'] : state.tab === 'a11y' ? ['a11y'] : ['tech'];
    list.innerHTML = groupList(cats, 'Brak problemów dla wybranych filtrów.');
  };

  if (PRINT) {
    root.innerHTML =
      header() +
      summary() +
      `<div class="wrap"><h2 class="section-title">Problemy RWD</h2>${groupsByCat(['rwd', 'ai']).map(groupCard).join('') || '<p>Brak.</p>'}
      ${D.sweeps.length ? `<h2 class="section-title">Zakresy szerokości</h2>${viewSweep()}` : ''}
      <h2 class="section-title">Dostępność</h2>${groupsByCat(['a11y']).map(groupCard).join('') || '<p>Brak.</p>'}
      <h2 class="section-title">Problemy techniczne</h2>${groupsByCat(['tech']).map(groupCard).join('') || '<p>Brak.</p>'}
      </div><footer>Wygenerowano przez RWD Checker · AppWorks</footer>`;
    const imgs = Array.from(document.images);
    Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })))).then(() => {
      (window as any).__reportReady = true;
    });
    return;
  }

  root.innerHTML = header() + summary() + `<div class="wrap">${tabs()}<main id="view"></main></div><footer>Wygenerowano przez RWD Checker · AppWorks · v${esc(D.meta.appVersion)}</footer>`;
  render();
  (window as any).__reportReady = true;

  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest(
      '[data-tab],[data-sev],[data-dev],[data-open-task],[data-zoom],[data-close],[data-vtab],[data-n],[data-ignore],[data-ignore-sel]',
    ) as HTMLElement | null;
    if (!el) return;
    const ds = el.dataset;
    if (ds.tab) {
      state.tab = ds.tab;
      render();
    } else if (ds.sev) {
      state.sev.has(ds.sev) ? state.sev.delete(ds.sev) : state.sev.add(ds.sev);
      el.classList.toggle('on');
      renderList();
    } else if (ds.dev) {
      state.dev = ds.dev;
      document.querySelectorAll('[data-dev]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.dev === ds.dev));
      renderList();
    } else if (ds.openTask) {
      e.preventDefault();
      openViewer(ds.openTask, ds.issue !== undefined ? Number(ds.issue) : undefined);
    } else if (ds.vtab) {
      openViewer(ds.vtab);
    } else if (ds.zoom !== undefined) {
      e.preventDefault();
      lightbox((el as HTMLImageElement).src);
    } else if (ds.close !== undefined) {
      closeModal();
    } else if (ds.n) {
      focusBox(Number(ds.n));
    } else if (ds.ignore && app) {
      Promise.resolve(app.ignoreFingerprint(D.meta.host, ds.ignore, ds.title)).then(() => toast('Problem będzie ignorowany w kolejnych skanach tej witryny.'));
    } else if (ds.ignoreSel && app) {
      Promise.resolve(app.ignoreSelector(D.meta.host, ds.ignoreSel)).then(() => toast('Element będzie pomijany w kolejnych skanach tej witryny.'));
    }
  });

  let searchTimer: number | undefined;
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-search]')) {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.q = t.value.trim();
        renderList();
      }, 200);
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-engine]')) state.engine = t.value;
    else if (t.matches('[data-only-new]')) state.onlyNew = t.checked;
    else if (t.matches('[data-only-global]')) state.onlyGlobal = t.checked;
    else return;
    renderList();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const lb = document.querySelector('.lightbox');
    if (lb) lb.remove();
    else closeModal();
  });
}
