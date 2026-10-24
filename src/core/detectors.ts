import type { DeviceCategory, Issue } from './types';

export interface DetectorConfig {
  category: DeviceCategory;
  ignoreSelectors: string[];
  disabledRules: string[];
  /** Jeśli podane — uruchamiane są tylko te reguły. */
  onlyRules?: string[];
  maxPerRule: number;
  dpr: number;
}

export interface DetectorOutput {
  issues: Issue[];
  docWidth: number;
  docHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  overflowPx: number;
}

/**
 * Uruchamiane w przeglądarce przez page.evaluate — funkcja musi być w pełni samowystarczalna
 * (bez odwołań do zmiennych modułu).
 */
export function runDetectors(cfg: DetectorConfig): DetectorOutput {
  type R = { left: number; right: number; top: number; bottom: number; width: number; height: number };
  const issues: Issue[] = [];
  const counts: Record<string, number> = {};
  const docEl = document.documentElement;
  const body = document.body;
  const vw = docEl.clientWidth;
  const vh = window.innerHeight;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const mobile = cfg.category !== 'desktop';
  const phone = cfg.category === 'phone';

  const want = (id: string) =>
    !cfg.disabledRules.includes(id) && (!cfg.onlyRules || cfg.onlyRules.includes(id));

  const push = (issue: Issue) => {
    counts[issue.ruleId] = (counts[issue.ruleId] || 0) + 1;
    if (counts[issue.ruleId] > cfg.maxPerRule) return;
    issues.push(issue);
  };

  const ignoreSel = cfg.ignoreSelectors.filter((s) => {
    try {
      document.querySelector(s);
      return true;
    } catch {
      return false;
    }
  });
  const isIgnored = (el: Element) =>
    el.closest('[data-rwd-overlay]') !== null || ignoreSel.some((s) => el.closest(s) !== null);

  const csCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element) => {
    let s = csCache.get(el);
    if (!s) {
      s = getComputedStyle(el);
      csCache.set(el, s);
    }
    return s;
  };

  const visCache = new Map<Element, boolean>();
  const visible = (el: Element): boolean => {
    const cached = visCache.get(el);
    if (cached !== undefined) return cached;
    let v: boolean;
    const anyEl = el as Element & { checkVisibility?: (o: object) => boolean };
    if (typeof anyEl.checkVisibility === 'function') {
      v = anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    } else {
      const s = cs(el);
      v = s.display !== 'none' && s.visibility === 'visible' && parseFloat(s.opacity) > 0;
    }
    if (v) {
      const r = el.getBoundingClientRect();
      v = r.width > 0.5 && r.height > 0.5;
    }
    visCache.set(el, v);
    return v;
  };

  const goodClass = (c: string) =>
    c.length > 0 &&
    c.length < 40 &&
    !/\d{3,}/.test(c) &&
    !/[:[\]/]/.test(c) &&
    !/^(css|sc|jsx|svelte|emotion|chakra)-/.test(c) &&
    !/__[a-zA-Z0-9]{5,}$/.test(c);

  const stableId = (id: string) => /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && id.length < 40;

  const part = (el: Element, withNth: boolean): string => {
    let p = el.tagName.toLowerCase();
    const cls = Array.from(el.classList).filter(goodClass).slice(0, 2);
    if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
    if (withNth && el.parentElement) {
      const same = Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName);
      if (same.length > 1) p += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return p;
  };

  const selectorFor = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let d = 0; cur && cur !== body && cur !== docEl && d < 5; d++) {
      if (cur.id && stableId(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      parts.unshift(part(cur, true));
      cur = cur.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  };

  const signatureFor = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let d = 0; cur && cur !== body && cur !== docEl && d < 3; d++) {
      if (cur.id && stableId(cur.id)) {
        parts.unshift('#' + cur.id);
        break;
      }
      parts.unshift(part(cur, false));
      cur = cur.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  };

  const snippetOf = (el: Element): string => {
    let s = '<' + el.tagName.toLowerCase();
    for (const a of Array.from(el.attributes).slice(0, 6)) {
      const val = a.value.length > 60 ? a.value.slice(0, 60) + '…' : a.value;
      s += ` ${a.name}="${val}"`;
    }
    s += '>';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) s += text.length > 60 ? text.slice(0, 60) + '…' : text;
    return s.slice(0, 260);
  };

  const label = (el: Element): string => {
    const t =
      el.getAttribute('aria-label') ||
      (el as HTMLInputElement).placeholder ||
      (el.textContent || '').trim().replace(/\s+/g, ' ') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      '';
    return t.length > 50 ? t.slice(0, 50) + '…' : t;
  };

  const docRect = (r: R) => ({
    x: Math.round(r.left + sx),
    y: Math.round(r.top + sy),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });

  const base = (el: Element) => ({
    selector: selectorFor(el),
    signature: signatureFor(el),
    rect: docRect(el.getBoundingClientRect()),
    snippet: snippetOf(el),
  });

  const clipOf = (el: Element) => {
    let left = -Infinity;
    let right = Infinity;
    let top = -Infinity;
    let bottom = Infinity;
    let fixed = false;
    for (let p: Element | null = el; p && p !== body && p !== docEl; p = p.parentElement) {
      const s = cs(p);
      if (p !== el) {
        const ox = s.overflowX;
        const oy = s.overflowY;
        if (ox !== 'visible' || oy !== 'visible') {
          const r = p.getBoundingClientRect();
          if (ox !== 'visible') {
            left = Math.max(left, r.left);
            right = Math.min(right, r.right);
          }
          if (oy !== 'visible') {
            top = Math.max(top, r.top);
            bottom = Math.min(bottom, r.bottom);
          }
        }
      }
      if (s.position === 'fixed') {
        fixed = true;
        break;
      }
    }
    return { left, right, top, bottom, fixed };
  };

  const SKIP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BR', 'WBR', 'HEAD', 'TITLE', 'SOURCE', 'TRACK', 'PARAM', 'OPTION', 'OPTGROUP',
  ]);
  const elements: Element[] = [];
  if (body) {
    const all = body.getElementsByTagName('*');
    for (let i = 0; i < all.length && elements.length < 20000; i++) {
      const el = all[i];
      if (SKIP.has(el.tagName)) continue;
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      if (el.hasAttribute('data-rwd-overlay')) continue;
      elements.push(el);
    }
  }

  const hasDirectText = (el: Element) => {
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3 && (n.nodeValue || '').trim().length > 1) return true;
    return false;
  };

  // ---------- Przepełnienie poziome ----------
  const scrollW = docEl.scrollWidth;
  const clipsX = (v: string) => v === 'hidden' || v === 'clip';
  const rootClipped = clipsX(cs(docEl).overflowX) || (!!body && clipsX(cs(body).overflowX));
  const hasHScroll = scrollW > vw + 1 && !rootClipped;
  const overflowPx = hasHScroll ? scrollW - vw : 0;
  const overflowCulprits = new Set<Element>();

  if (want('horizontal-overflow') || want('content-cut-off')) {
    const cands: { el: Element; r: DOMRect; fixed: boolean }[] = [];
    for (const el of elements) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (!visible(el) || isIgnored(el)) continue;
      const c = clipOf(el);
      const visL = Math.max(r.left, c.left);
      const visR = Math.min(r.right, c.right);
      if (visR - visL <= 0) continue;
      if (visR <= vw + 1 && visL >= -1) continue;
      const visT = Math.max(r.top, c.top);
      const visB = Math.min(r.bottom, c.bottom);
      if (visB - visT <= 0) continue;
      cands.push({ el, r, fixed: c.fixed });
    }
    const set = new Set(cands.map((c) => c.el));
    const roots = cands.filter((c) => !c.el.parentElement || !set.has(c.el.parentElement));

    let reported = 0;
    for (const c of roots) {
      const over = Math.round(Math.max(c.r.right - vw, -c.r.left));
      const side = c.r.right - vw >= -c.r.left ? 'prawą' : 'lewą';
      const tag = c.el.tagName.toLowerCase();
      const kind =
        tag === 'img' ? 'Obraz' : tag === 'table' ? 'Tabela' : tag === 'iframe' ? 'Ramka (iframe)' : tag === 'video' ? 'Wideo' : 'Element';
      if (hasHScroll && !c.fixed) {
        if (!want('horizontal-overflow') || over < 2) continue;
        overflowCulprits.add(c.el);
        reported++;
        push({
          ruleId: 'horizontal-overflow',
          severity: mobile ? 'critical' : 'high',
          message: `${kind} wychodzi ${over} px poza ${side} krawędź ekranu (${vw} px) i powoduje poziome przewijanie strony.`,
          details: { overflowPx: over, viewportWidth: vw, elementWidth: Math.round(c.r.width) },
          ...base(c.el),
        });
      } else {
        if (!want('content-cut-off') || over < 8) continue;
        const partially = c.r.left < vw - 1 && c.r.right > 1;
        if (!partially) continue;
        const meaningful =
          (c.el.textContent || '').trim().length > 0 || /^(img|video|iframe|svg|canvas|picture|input|button|select|textarea)$/.test(tag);
        if (!meaningful) continue;
        push({
          ruleId: 'content-cut-off',
          severity: phone ? 'high' : 'medium',
          message: c.fixed
            ? `Przyklejony ${kind.toLowerCase()} wystaje ${over} px poza ${side} krawędź ekranu — część jest niewidoczna.`
            : `${kind} wystaje ${over} px poza ${side} krawędź ekranu, ale przewijanie jest zablokowane (overflow-x: hidden) — część treści jest niewidoczna.`,
          details: { overflowPx: over, viewportWidth: vw },
          ...base(c.el),
        });
      }
    }
    if (hasHScroll && reported === 0 && want('horizontal-overflow')) {
      push({
        ruleId: 'horizontal-overflow',
        severity: mobile ? 'critical' : 'high',
        message: `Strona przewija się poziomo o ${overflowPx} px, ale nie udało się wskazać elementu (możliwy pseudo-element ::before/::after, margines lub cień).`,
        details: { overflowPx, viewportWidth: vw },
      });
    }
  }

  // ---------- Meta viewport ----------
  if (phone) {
    const meta = document.querySelector('meta[name="viewport" i]');
    const content = (meta?.getAttribute('content') || '').toLowerCase().replace(/\s+/g, '');
    if (!meta) {
      if (want('viewport-meta-missing'))
        push({ ruleId: 'viewport-meta-missing', severity: 'critical', message: 'Brak <meta name="viewport"> — telefon wyświetli wersję desktopową w pomniejszeniu.' });
    } else {
      if (!/width=device-width/.test(content) && want('viewport-meta-invalid'))
        push({ ruleId: 'viewport-meta-invalid', severity: 'high', message: `Meta viewport ma wartość „${content}” zamiast width=device-width.`, snippet: meta.outerHTML });
      const maxScale = content.match(/maximum-scale=([\d.]+)/);
      if ((/user-scalable=(no|0)/.test(content) || (maxScale && parseFloat(maxScale[1]) < 2)) && want('viewport-zoom-disabled'))
        push({ ruleId: 'viewport-zoom-disabled', severity: 'medium', message: `Meta viewport blokuje powiększanie: „${content}”.`, snippet: meta.outerHTML });
    }
  }

  // ---------- Tekst ----------
  const textEls: Element[] = [];
  const needText = want('small-text') || want('text-clipped') || want('text-overflow') || want('text-overlap');
  if (needText) {
    for (const el of elements) if (hasDirectText(el) && visible(el) && !isIgnored(el)) textEls.push(el);
  }

  const visibleArea = (el: Element, r: R) => {
    const c = clipOf(el);
    const w = Math.min(r.right, c.right) - Math.max(r.left, c.left);
    const h = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
    return w > 0 && h > 0 ? w * h : 0;
  };

  if (mobile && want('small-text')) {
    const small: { el: Element; fs: number }[] = [];
    for (const el of textEls) {
      const fs = parseFloat(cs(el).fontSize);
      if (!(fs < 12) || fs === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3 || visibleArea(el, r) < 9) continue;
      small.push({ el, fs });
    }
    small.sort((a, b) => a.fs - b.fs);
    for (const { el, fs } of small) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      push({
        ruleId: 'small-text',
        severity: phone ? 'medium' : 'low',
        message: `Tekst ma ${Math.round(fs * 10) / 10} px: „${text.length > 50 ? text.slice(0, 50) + '…' : text}”.`,
        details: { fontSize: fs },
        ...base(el),
      });
    }
  }

  if (want('text-clipped') || want('text-overflow')) {
    for (const el of textEls) {
      const s = cs(el);
      if (s.display === 'inline' || s.display === 'contents') continue;
      if (parseFloat(s.fontSize) < 1 || parseFloat(s.textIndent) < -100) continue;
      if (s.textOverflow === 'ellipsis') continue;
      const lineClamp = (s as unknown as Record<string, string>).webkitLineClamp;
      if (lineClamp && lineClamp !== 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || visibleArea(el, r) < 16) continue;
      let tl = Infinity;
      let tr = -Infinity;
      let tb = -Infinity;
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType !== 3 || !(n.nodeValue || '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const lr of Array.from(range.getClientRects())) {
          if (lr.width < 1) continue;
          tl = Math.min(tl, lr.left);
          tr = Math.max(tr, lr.right);
          tb = Math.max(tb, lr.bottom);
        }
      }
      if (!isFinite(tr)) continue;
      const bl = parseFloat(s.borderLeftWidth) || 0;
      const br = parseFloat(s.borderRightWidth) || 0;
      const bb = parseFloat(s.borderBottomWidth) || 0;
      const overR = tr - (r.right - br);
      const overL = r.left + bl - tl;
      const overB = tb - (r.bottom - bb);
      const clipX = s.overflowX !== 'visible';
      const clipY = s.overflowY !== 'visible';
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      const short = text.length > 50 ? text.slice(0, 50) + '…' : text;
      if ((clipX && Math.max(overR, overL) > 3) || (clipY && overB > 3)) {
        if (want('text-clipped'))
          push({
            ruleId: 'text-clipped',
            severity: 'medium',
            message: `Tekst „${short}” jest ucięty — nie mieści się w elemencie (${Math.round(Math.max(overR, overL, overB))} px).`,
            ...base(el),
          });
      } else if (!clipX && Math.max(overR, overL) > 4) {
        if (want('text-overflow'))
          push({
            ruleId: 'text-overflow',
            severity: 'medium',
            message: `Tekst „${short}” wychodzi ${Math.round(Math.max(overR, overL))} px poza swój element.`,
            ...base(el),
          });
      }
    }
  }

  if (want('text-overlap')) {
    type LR = { el: Element; l: number; t: number; r: number; b: number; text: string };
    const lines: LR[] = [];
    for (const el of textEls) {
      if (lines.length > 6000) break;
      const s = cs(el);
      if (parseFloat(s.fontSize) < 1 || parseFloat(s.textIndent) < -100) continue;
      const c = clipOf(el);
      if (c.fixed) continue;
      const text = (el.textContent || '').trim();
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType !== 3 || !(n.nodeValue || '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const lr of Array.from(range.getClientRects())) {
          const l = Math.max(lr.left, c.left);
          const rr = Math.min(lr.right, c.right);
          const t = Math.max(lr.top, c.top);
          const b = Math.min(lr.bottom, c.bottom);
          if (rr - l < 3 || b - t < 5) continue;
          lines.push({ el, l, t, r: rr, b, text });
        }
      }
    }
    const CELL = 64;
    const grid = new Map<string, number[]>();
    const seenPairs = new Set<string>();
    const ids = new Map<Element, number>();
    let nextId = 0;
    const idOf = (e: Element) => {
      let v = ids.get(e);
      if (v === undefined) {
        v = nextId++;
        ids.set(e, v);
      }
      return v;
    };
    lines.forEach((a, i) => {
      const x0 = Math.floor((a.l + sx) / CELL);
      const x1 = Math.floor((a.r + sx) / CELL);
      const y0 = Math.floor((a.t + sy) / CELL);
      const y1 = Math.floor((a.b + sy) / CELL);
      const checked = new Set<number>();
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = gx + ':' + gy;
          const bucket = grid.get(key);
          if (bucket) {
            for (const j of bucket) {
              if (checked.has(j)) continue;
              checked.add(j);
              const b = lines[j];
              if (b.el === a.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
              if (a.text === b.text) continue;
              const iw = Math.min(a.r, b.r) - Math.max(a.l, b.l);
              const ih = Math.min(a.b, b.b) - Math.max(a.t, b.t);
              if (iw <= 2 || ih <= 2) continue;
              const minArea = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
              if ((iw * ih) / minArea < 0.3) continue;
              const pk = [idOf(a.el), idOf(b.el)].sort().join('-');
              if (seenPairs.has(pk)) continue;
              seenPairs.add(pk);
              const ta = a.text.replace(/\s+/g, ' ').slice(0, 30);
              const tb = b.text.replace(/\s+/g, ' ').slice(0, 30);
              const ra = a.el.getBoundingClientRect();
              const rb = b.el.getBoundingClientRect();
              const l = Math.min(ra.left, rb.left);
              const t = Math.min(ra.top, rb.top);
              push({
                ruleId: 'text-overlap',
                severity: 'medium',
                message: `Tekst „${ta}” nachodzi na tekst „${tb}”.`,
                selector: selectorFor(a.el),
                signature: signatureFor(a.el) + ' ~ ' + signatureFor(b.el),
                snippet: snippetOf(a.el),
                rect: docRect({
                  left: l,
                  top: t,
                  right: Math.max(ra.right, rb.right),
                  bottom: Math.max(ra.bottom, rb.bottom),
                  width: Math.max(ra.right, rb.right) - l,
                  height: Math.max(ra.bottom, rb.bottom) - t,
                }),
                details: { otherSelector: selectorFor(b.el) },
              });
            }
          }
          if (!bucket) grid.set(key, [i]);
          else bucket.push(i);
        }
    });
  }

  // ---------- Element wystaje poza rodzica ----------
  if (want('outside-parent')) {
    const cands = new Set<Element>();
    const list: { el: Element; over: number }[] = [];
    for (const el of elements) {
      const p = el.parentElement;
      if (!p || p === body || p === docEl) continue;
      if (overflowCulprits.has(el)) continue;
      const s = cs(el);
      if (s.position === 'absolute' || s.position === 'fixed') continue;
      if (parseFloat(s.marginLeft) < -0.5 || parseFloat(s.marginRight) < -0.5) continue;
      const ps = cs(p);
      if (ps.overflowX !== 'visible' || ps.display === 'inline' || ps.display === 'contents') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 4) continue;
      const pr = p.getBoundingClientRect();
      if (pr.width < 1) continue;
      const over = Math.max(r.right - pr.right, pr.left - r.left);
      if (over <= 8) continue;
      if (!visible(el) || isIgnored(el)) continue;
      cands.add(el);
      list.push({ el, over });
    }
    for (const { el, over } of list) {
      if (el.parentElement && cands.has(el.parentElement)) continue;
      push({
        ruleId: 'outside-parent',
        severity: 'low',
        message: `Element wystaje ${Math.round(over)} px poza swój kontener (${part(el.parentElement!, false)}).`,
        details: { overflowPx: Math.round(over) },
        ...base(el),
      });
    }
  }

  // ---------- Obrazy ----------
  if (want('image-distorted') || want('image-oversized')) {
    for (const img of Array.from(document.images)) {
      if (!img.complete || img.naturalWidth < 8 || img.naturalHeight < 8) continue;
      if (!visible(img) || isIgnored(img)) continue;
      const src = img.currentSrc || img.src || '';
      if (/\.svg(\?|#|$)/i.test(src) || src.startsWith('data:image/svg')) continue;
      const s = cs(img);
      const r = img.getBoundingClientRect();
      const w =
        r.width -
        (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0) -
        (parseFloat(s.borderLeftWidth) || 0) - (parseFloat(s.borderRightWidth) || 0);
      const h =
        r.height -
        (parseFloat(s.paddingTop) || 0) - (parseFloat(s.paddingBottom) || 0) -
        (parseFloat(s.borderTopWidth) || 0) - (parseFloat(s.borderBottomWidth) || 0);
      if (w < 24 || h < 24) continue;
      if (want('image-distorted') && s.objectFit === 'fill') {
        const dev = w / h / (img.naturalWidth / img.naturalHeight) - 1;
        if (Math.abs(dev) > 0.06) {
          push({
            ruleId: 'image-distorted',
            severity: 'medium',
            message: `Obraz jest ${dev > 0 ? 'rozciągnięty w poziomie' : 'ściśnięty w poziomie'} o ${Math.round(Math.abs(dev) * 100)}% (wyświetlany ${Math.round(w)}×${Math.round(h)}, oryginał ${img.naturalWidth}×${img.naturalHeight}).`,
            details: { rendered: [Math.round(w), Math.round(h)], natural: [img.naturalWidth, img.naturalHeight], src },
            ...base(img),
          });
        }
      }
      if (want('image-oversized')) {
        const need = w * cfg.dpr;
        if (img.naturalWidth > need * 2.5 && img.naturalWidth - need > 600) {
          push({
            ruleId: 'image-oversized',
            severity: 'low',
            message: `Obraz ma ${img.naturalWidth} px szerokości, a wystarczyłoby ok. ${Math.round(need)} px (wyświetlany ${Math.round(w)} px przy gęstości ${cfg.dpr}x).`,
            details: { src, natural: [img.naturalWidth, img.naturalHeight], rendered: Math.round(w) },
            key: src.split('?')[0],
            ...base(img),
          });
        }
      }
    }
  }

  // ---------- Pola formularzy (zoom na iOS) ----------
  if (phone && want('input-zoom-ios')) {
    const fields = Array.from(document.querySelectorAll('input, select, textarea')).filter((el) => {
      const t = ((el as HTMLInputElement).type || '').toLowerCase();
      return !['checkbox', 'radio', 'hidden', 'submit', 'button', 'reset', 'range', 'color', 'file', 'image'].includes(t);
    });
    for (const el of fields) {
      if (!visible(el) || isIgnored(el)) continue;
      const fs = parseFloat(cs(el).fontSize);
      if (fs >= 16) continue;
      push({
        ruleId: 'input-zoom-ios',
        severity: 'medium',
        message: `Pole „${label(el) || el.tagName.toLowerCase()}” ma czcionkę ${Math.round(fs * 10) / 10} px (< 16 px) — iPhone powiększy stronę po kliknięciu.`,
        details: { fontSize: fs },
        ...base(el),
      });
    }
  }

  // ---------- Obszary dotyku ----------
  if (mobile && want('tap-target-size')) {
    const SEL =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="switch"], [onclick], label[for]';
    type T = { el: Element; r: DOMRect; cx: number; cy: number; small: boolean };
    const targets: T[] = [];
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      if ((el as HTMLButtonElement).disabled) continue;
      if (!visible(el) || isIgnored(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right < 0 || r.left > vw) continue;
      const s = cs(el);
      if (s.display === 'inline' && el.parentElement) {
        const own = (el.textContent || '').trim().length;
        const parentText = (el.parentElement.textContent || '').trim().length;
        if (parentText > own + 15) continue;
      }
      if (visibleArea(el, r) < 4) continue;
      targets.push({ el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2, small: r.width < 23.5 || r.height < 23.5 });
    }
    const related = (a: Element, b: Element) => {
      if (a.contains(b) || b.contains(a)) return true;
      const la = a as HTMLLabelElement;
      const lb = b as HTMLLabelElement;
      if (la.control === b || lb.control === a) return true;
      const labA = a.closest('label');
      return !!labA && labA === b.closest('label');
    };
    const distToRect = (x: number, y: number, r: DOMRect) => {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      return Math.hypot(dx, dy);
    };
    for (const t of targets) {
      if (!t.small) continue;
      let worst: { d: number; other: T } | null = null;
      for (const u of targets) {
        if (u === t || related(t.el, u.el)) continue;
        if (Math.abs(u.cy - t.cy) > 80 || Math.abs(u.cx - t.cx) > 300) continue;
        const d = distToRect(t.cx, t.cy, u.r);
        const viol = d < 12 || (u.small && Math.hypot(u.cx - t.cx, u.cy - t.cy) < 24);
        if (viol && (!worst || d < worst.d)) worst = { d, other: u };
      }
      if (!worst) continue;
      push({
        ruleId: 'tap-target-size',
        severity: phone ? 'medium' : 'low',
        message: `Element „${label(t.el) || t.el.tagName.toLowerCase()}” ma ${Math.round(t.r.width)}×${Math.round(t.r.height)} px i leży ${Math.round(worst.d)} px od „${label(worst.other.el) || worst.other.el.tagName.toLowerCase()}” (min. 24×24 px wg WCAG 2.2).`,
        details: { size: [Math.round(t.r.width), Math.round(t.r.height)], distance: Math.round(worst.d) },
        ...base(t.el),
      });
    }
  }

  for (const id of Object.keys(counts)) {
    if (counts[id] > cfg.maxPerRule) {
      const first = issues.find((i) => i.ruleId === id);
      if (first) first.details = { ...(first.details || {}), moreCount: counts[id] - cfg.maxPerRule };
    }
  }

  return {
    issues,
    docWidth: Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0),
    docHeight: Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0),
    viewportWidth: vw,
    viewportHeight: vh,
    overflowPx,
  };
}

export interface CoverageConfig {
  category: DeviceCategory;
  ignoreSelectors: string[];
}

export interface CoverageResult {
  coverage: number;
  elements: { selector: string; signature: string; rect: { x: number; y: number; width: number; height: number }; snippet: string }[];
}

/** Mierzy, jaką część ekranu zasłaniają elementy fixed/sticky w połowie przewinięcia strony. */
export async function measureFixedCoverage(cfg: CoverageConfig): Promise<CoverageResult> {
  const docEl = document.documentElement;
  const startY = window.scrollY;
  const target = Math.max(0, Math.min(docEl.scrollHeight - innerHeight, Math.round(docEl.scrollHeight / 2)));
  window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
  await new Promise((r) => setTimeout(r, 450));
  const vw = docEl.clientWidth;
  const vh = innerHeight;
  const ignore = cfg.ignoreSelectors.filter((s) => {
    try {
      document.querySelector(s);
      return true;
    } catch {
      return false;
    }
  });
  const found: { el: Element; r: DOMRect }[] = [];
  for (const el of Array.from(document.body?.getElementsByTagName('*') ?? [])) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'sticky') continue;
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue;
    if (el.closest('[data-rwd-overlay]') || ignore.some((sel) => el.closest(sel))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const area = (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if (area / (vw * vh) > 0.9) {
      const bg = s.backgroundColor;
      const transparent = bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg);
      if (transparent && s.backgroundImage === 'none') continue;
    }
    if (found.some((f) => f.el.contains(el))) continue;
    for (let i = found.length - 1; i >= 0; i--) if (el.contains(found[i].el)) found.splice(i, 1);
    found.push({ el, r });
  }
  const NX = 24;
  const NY = 48;
  let covered = 0;
  for (let ix = 0; ix < NX; ix++)
    for (let iy = 0; iy < NY; iy++) {
      const x = ((ix + 0.5) / NX) * vw;
      const y = ((iy + 0.5) / NY) * vh;
      if (found.some(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) covered++;
    }
  const elements = found.map(({ el, r }) => {
    const cls = Array.from(el.classList).slice(0, 2).join('.');
    const sig = el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls ? '.' + cls : '');
    return {
      selector: sig,
      signature: sig,
      rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      snippet: '<' + el.tagName.toLowerCase() + (el.id ? ` id="${el.id}"` : '') + (cls ? ` class="${cls.replace('.', ' ')}"` : '') + '>',
    };
  });
  window.scrollTo({ top: startY, behavior: 'instant' as ScrollBehavior });
  await new Promise((r) => setTimeout(r, 100));
  return { coverage: covered / (NX * NY), elements };
}
