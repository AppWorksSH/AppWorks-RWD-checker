import type { Page } from 'playwright-core';
import type { Issue } from './types';

interface ToggleInfo {
  found: boolean;
  selector?: string;
  label?: string;
  rect?: { x: number; y: number; width: number; height: number };
  hiddenNavLinks: number;
  visibleNavLinks: number;
}

function findToggleInPage(): ToggleInfo {
  const NAME =
    /hamburger|burger|navbar-toggler|menu-toggle|nav-toggle|toggle-menu|togglemenu|mobile-menu|mobilemenu|menu-btn|menu-button|menu-icon|menu-trigger|nav-trigger|open-menu|offcanvas|toggle-nav|js-menu|menu-open|nav-btn/i;
  const TEXT = /^(menu|nawigacja|otwórz menu|open menu|toggle navigation|navigation|☰|≡|menü)$/i;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });

  const navLinks = Array.from(
    document.querySelectorAll('nav a[href], [role="navigation"] a[href], header ul a[href], .menu a[href], #menu a[href]'),
  );
  const hiddenNavLinks = navLinks.filter((a) => !visible(a)).length;
  const visibleNavLinks = navLinks.filter((a) => {
    if (!visible(a)) return false;
    const r = a.getBoundingClientRect();
    return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
  }).length;

  const cands = Array.from(
    document.querySelectorAll(
      'button, a, [role="button"], label[for], div[class*="burger" i], span[class*="burger" i], div[class*="toggle" i], div[class*="menu" i], span[class*="menu" i]',
    ),
  );
  let best: { el: Element; score: number } | null = null;
  for (const el of cands) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 160 || r.height > 120) continue;
    const inHeader = !!el.closest('header, nav, [role="banner"], [class*="header" i], [id*="header" i]');
    if (r.top > 260 && !inHeader) continue;
    if (r.top > innerHeight) continue;
    let score = 0;
    const attrs = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('data-toggle') || ''} ${el.getAttribute('data-bs-toggle') || ''}`;
    if (NAME.test(attrs)) score += 6;
    if (el.hasAttribute('aria-controls')) score += 4;
    if (el.hasAttribute('aria-expanded')) score += 3;
    const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    const text = (el.textContent || '').trim();
    if (TEXT.test(aria) || TEXT.test(text) || /menu|nawigac/i.test(aria)) score += 4;
    if (text.length === 0 && (el.querySelector('svg, i, img') || el.querySelectorAll('span').length >= 2)) score += 1;
    if (inHeader) score += 1;
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) score -= 10;
    }
    if (score >= 4 && (!best || score > best.score)) best = { el, score };
  }
  document.querySelectorAll('[data-rwd-menu-toggle]').forEach((e) => e.removeAttribute('data-rwd-menu-toggle'));
  if (!best) return { found: false, hiddenNavLinks, visibleNavLinks };
  best.el.setAttribute('data-rwd-menu-toggle', '1');
  const r = best.el.getBoundingClientRect();
  const label = (best.el.getAttribute('aria-label') || best.el.textContent || best.el.className.toString()).trim().slice(0, 40);
  return {
    found: true,
    selector: '[data-rwd-menu-toggle]',
    label,
    rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
    hiddenNavLinks,
    visibleNavLinks,
  };
}

function visibleLinksInPage(): string[] {
  const out: string[] = [];
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const r = a.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue;
    const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(a === hit || a.contains(hit) || hit.contains(a))) continue;
    out.push((a.getAttribute('href') || '') + '|' + (a.textContent || '').trim().slice(0, 30));
  }
  return out;
}

function menuOverflowInPage(): { overflow: number; selector?: string } {
  const vw = document.documentElement.clientWidth;
  let worst = 0;
  let sel: string | undefined;
  for (const a of Array.from(document.querySelectorAll('nav a[href], [role="navigation"] a[href], [class*="menu" i] a[href]'))) {
    const r = a.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const s = getComputedStyle(a);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    const over = r.right - vw;
    if (over > worst && r.left < vw) {
      worst = over;
      sel = a.tagName.toLowerCase() + (a.className ? '.' + String(a.className).trim().split(/\s+/).slice(0, 2).join('.') : '');
    }
  }
  return { overflow: Math.round(worst), selector: sel };
}

export interface MenuTestResult {
  issues: Issue[];
  menuOpened: boolean;
  screenshot?: Buffer;
}

export async function testMobileMenu(page: Page, screenshotQuality: number): Promise<MenuTestResult> {
  const issues: Issue[] = [];
  const info = await page.evaluate(findToggleInPage);
  if (!info.found) {
    if (info.hiddenNavLinks >= 3 && info.visibleNavLinks < 2) {
      issues.push({
        ruleId: 'mobile-menu-missing',
        severity: 'high',
        message: `Nawigacja (${info.hiddenNavLinks} linków) jest ukryta, a na ekranie nie ma rozpoznawalnego przycisku menu.`,
      });
    }
    return { issues, menuOpened: false };
  }

  const before = await page.evaluate(visibleLinksInPage);
  const urlBefore = page.url();
  try {
    await page.click('[data-rwd-menu-toggle]', { timeout: 3000 });
  } catch {
    try {
      await page.click('[data-rwd-menu-toggle]', { timeout: 2000, force: true });
    } catch {
      issues.push({
        ruleId: 'mobile-menu-broken',
        severity: 'high',
        message: `Nie da się kliknąć przycisku menu „${info.label}” — jest zasłonięty lub poza ekranem.`,
        rect: info.rect,
        selector: info.label,
      });
      return { issues, menuOpened: false };
    }
  }
  await page.waitForTimeout(800);
  if (page.url() !== urlBefore) return { issues, menuOpened: true };

  const after = await page.evaluate(visibleLinksInPage);
  const beforeSet = new Set(before);
  const newly = after.filter((l) => !beforeSet.has(l)).length;
  const shot = await page.screenshot({ type: 'jpeg', quality: screenshotQuality, scale: 'css', animations: 'disabled' }).catch(() => undefined);

  if (newly >= 2) {
    const ov = await page.evaluate(menuOverflowInPage);
    if (ov.overflow > 4) {
      issues.push({
        ruleId: 'mobile-menu-overflow',
        severity: 'high',
        message: `Po otwarciu menu link wystaje ${ov.overflow} px poza ekran.`,
        selector: ov.selector,
        signature: ov.selector,
      });
    }
    return { issues, menuOpened: true, screenshot: shot };
  }
  issues.push({
    ruleId: 'mobile-menu-broken',
    severity: 'high',
    message: `Po kliknięciu „${info.label || 'menu'}” nie pojawiły się nowe widoczne linki nawigacji.`,
    rect: info.rect,
    selector: info.label,
    signature: info.label,
  });
  return { issues, menuOpened: false, screenshot: shot };
}
