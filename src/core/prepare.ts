import type { Frame, Page } from 'playwright-core';

export const FREEZE_CSS = `
*, *::before, *::after {
  transition-duration: 0s !important;
  transition-delay: 0s !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  animation-iteration-count: 1 !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; }
`;

export const CLS_INIT_SCRIPT = `
window.__rwdCls = 0;
try {
  new PerformanceObserver(function (list) {
    for (const e of list.getEntries()) { if (!e.hadRecentInput) window.__rwdCls += e.value; }
  }).observe({ type: 'layout-shift', buffered: true });
} catch (e) {}
`;

export interface ConsentResult {
  clicked: boolean;
  coverage?: number;
  selector?: string;
}

/** Wykonywane w przeglądarce — musi być samowystarczalne. */
function clickConsentInPage(): ConsentResult {
  const KNOWN = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    '.cky-btn-accept',
    '#cookie_action_close_header',
    '.cmplz-accept',
    '[data-cookiefirst-action="accept"]',
    '#didomi-notice-agree-button',
    '.fc-cta-consent',
    '.iubenda-cs-accept-btn',
    '#axeptio_btn_acceptAll',
    '.cc-allow',
    '.cc-accept',
    '.cc-btn.cc-dismiss',
    '#cn-accept-cookie',
    '.js-cookie-consent-agree',
    '[data-testid="uc-accept-all-button"]',
    '#uc-btn-accept-banner',
    '.osano-cm-accept-all',
    '#truste-consent-button',
    '#hs-eu-confirmation-button',
    '#CookieBoxSaveButton',
    '._brlbs-btn-accept-all',
    '.moove-gdpr-infobar-allow-all',
    '#wt-cli-accept-all-btn',
    '.cli_action_button[data-cli_action="accept_all"]',
    '.cookie-consent-accept',
    '#accept-cookies',
    '#acceptCookies',
    '.accept-cookies',
    '#cookies-accept',
    '.cookies-accept',
  ];
  const TEXT =
    /^(zaakceptuj( wszystkie| wszystko)?|akceptuj( wszystkie| wszystko)?|akceptuję|zgadzam się|zgoda|wyrażam zgodę|zezwól na wszystkie|zezwalaj na wszystkie|przejdź do (serwisu|strony)|rozumiem|ok|okej|accept( all)?( cookies)?|allow( all)?( cookies)?|i agree|agree|got it|i understand|alle akzeptieren|akzeptieren)\b/i;
  const CONTEXT = /cookie|ciastecz|prywatno|privacy|zgod|consent|rodo|gdpr|dane osobowe|personal data/i;

  const roots: (Document | ShadowRoot)[] = [document];
  document.querySelectorAll('*').forEach((el) => {
    if ((el as HTMLElement).shadowRoot) roots.push((el as HTMLElement).shadowRoot!);
  });

  const isVisible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };

  const coverageOf = (btn: Element): number | undefined => {
    let best: Element | null = null;
    for (let p: Element | null = btn; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'fixed' || s.position === 'sticky' || p.getAttribute('role') === 'dialog') best = p;
    }
    if (!best) return undefined;
    const r = best.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return (w * h) / (innerWidth * innerHeight);
  };

  for (const root of roots) {
    for (const sel of KNOWN) {
      const el = root.querySelector(sel);
      if (el && isVisible(el)) {
        const coverage = coverageOf(el);
        (el as HTMLElement).click();
        return { clicked: true, coverage, selector: sel };
      }
    }
  }
  for (const root of roots) {
    const cands = Array.from(
      root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'),
    );
    for (const el of cands) {
      const text = ((el as HTMLInputElement).value || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 40 || !TEXT.test(text) || !isVisible(el)) continue;
      let ctx: Element | null = el;
      let ok = false;
      for (let i = 0; i < 8 && ctx; i++, ctx = ctx.parentElement) {
        const attrs = (ctx.id || '') + ' ' + (typeof ctx.className === 'string' ? ctx.className : '');
        if (CONTEXT.test(attrs) || CONTEXT.test((ctx.textContent || '').slice(0, 2000))) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;
      const coverage = coverageOf(el);
      (el as HTMLElement).click();
      return { clicked: true, coverage, selector: text };
    }
  }
  return { clicked: false };
}

function closePopupsInPage(): number {
  const vw = innerWidth;
  const vh = innerHeight;
  const CLOSE =
    '[aria-label*="zamknij" i], [aria-label*="close" i], [title*="zamknij" i], [title*="close" i], .close, .modal-close, .popup-close, .mfp-close, .fancybox-close, .fancybox-button--close, .pum-close, [data-dismiss="modal"], [data-bs-dismiss="modal"], button[class*="close" i], a[class*="close" i], [class*="dismiss" i]';
  const CLOSE_TEXT = /^(×|✕|✖|x|zamknij|close|nie,? dziękuję|no,? thanks|później|pomiń|skip)$/i;
  let closed = 0;
  const all = Array.from(document.body?.querySelectorAll('*') ?? []);
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    if ((w * h) / (vw * vh) < 0.25) continue;
    if ((el.textContent || '').length > 4000) continue;
    const isDialog =
      el.matches('[role="dialog"], [aria-modal="true"], dialog') ||
      /modal|popup|pop-up|newsletter|lightbox|overlay|dialog/i.test((el.id || '') + ' ' + String(el.className || ''));
    if (!isDialog) continue;
    const btn = Array.from(el.querySelectorAll(CLOSE)).find((b) => {
      const br = b.getBoundingClientRect();
      return br.width > 0 && br.height > 0;
    }) ||
      Array.from(el.querySelectorAll('button, a, [role="button"], span, div')).find((b) => {
        const t = (b.textContent || '').trim();
        const br = b.getBoundingClientRect();
        return t.length < 25 && CLOSE_TEXT.test(t) && br.width > 0 && br.height > 0 && b.children.length === 0;
      });
    if (btn) {
      (btn as HTMLElement).click();
      closed++;
    }
  }
  return closed;
}

async function autoScroll(page: Page, maxHeight: number): Promise<void> {
  await page.evaluate(async (limit) => {
    const step = Math.max(200, Math.floor(innerHeight * 0.85));
    let y = 0;
    for (let i = 0; i < 60; i++) {
      const total = Math.min(document.documentElement.scrollHeight, limit);
      if (y >= total) break;
      y += step;
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
      await new Promise((r) => setTimeout(r, 110));
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, maxHeight);
}

export async function settle(page: Page, ms = 4000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
}

async function waitFonts(page: Page): Promise<void> {
  await page
    .evaluate(() => Promise.race([document.fonts?.ready.then(() => true), new Promise((r) => setTimeout(r, 3000))]))
    .catch(() => {});
}

export async function dismissConsent(page: Page): Promise<ConsentResult> {
  let result: ConsentResult = { clicked: false };
  try {
    result = await page.evaluate(clickConsentInPage);
  } catch {
    /* strona mogła nawigować */
  }
  if (!result.clicked) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const r = await evaluateInFrame(frame);
      if (r?.clicked) {
        result = { clicked: true, selector: r.selector };
        break;
      }
    }
  }
  if (result.clicked) await page.waitForTimeout(600);
  return result;
}

async function evaluateInFrame(frame: Frame): Promise<ConsentResult | null> {
  try {
    return await frame.evaluate(clickConsentInPage);
  } catch {
    return null;
  }
}

export async function closePopups(page: Page): Promise<number> {
  try {
    const n = await page.evaluate(closePopupsInPage);
    if (n) await page.waitForTimeout(400);
    return n;
  } catch {
    return 0;
  }
}

export interface PrepareOptions {
  dismissCookies: boolean;
  closePopups: boolean;
  maxHeight: number;
  scroll?: boolean;
}

export interface PrepareResult {
  consent: ConsentResult;
}

export async function preparePage(page: Page, o: PrepareOptions): Promise<PrepareResult> {
  let consent: ConsentResult = { clicked: false };
  if (o.dismissCookies) consent = await dismissConsent(page);
  if (o.closePopups) await closePopups(page);
  await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
  if (o.scroll !== false) {
    await autoScroll(page, o.maxHeight).catch(() => {});
    await settle(page, 3000);
  }
  await waitFonts(page);
  if (o.closePopups) await closePopups(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page
    .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250)))))
    .catch(() => {});
  return { consent };
}
