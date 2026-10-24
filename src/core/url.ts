const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|yclid|ref|igshid)$/i;

const NON_HTML_EXT =
  /\.(pdf|zip|rar|7z|gz|tar|docx?|xlsx?|pptx?|odt|ods|csv|txt|xml|json|rss|atom|jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|avi|mkv|mp3|wav|ogg|flac|woff2?|ttf|otf|eot|css|js|mjs|map|exe|dmg|apk|ics|vcf)$/i;

const DEFAULT_EXCLUDES = [
  /\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|admin|administrator|login|logowanie|logout|wyloguj|signin|signup|register|rejestracja)(\/|$|\?)/i,
  /\/(cart|koszyk|checkout|zamowienie|zamówienie|kasa|my-account|moje-konto|account)(\/|$|\?)/i,
  /[?&](add-to-cart|add_to_cart|action=logout|replytocom|share)=/i,
  /\/feed\/?$/i,
  /\/cdn-cgi\//i,
];

export function normalizeUrl(input: string, base?: string): string | null {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/{2,}/g, '/');
  path = path.replace(/\/index\.(html?|php)$/i, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  u.pathname = path;
  return u.toString();
}

export function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

export function isSameSite(url: string, root: string, includeSubdomains: boolean): boolean {
  let a: URL, b: URL;
  try {
    a = new URL(url);
    b = new URL(root);
  } catch {
    return false;
  }
  const ha = bareHost(a.hostname);
  const hb = bareHost(b.hostname);
  if (ha === hb) return true;
  return includeSubdomains && ha.endsWith('.' + hb);
}

export function isUnderPath(url: string, root: string): boolean {
  const a = new URL(url);
  const prefix = new URL(root).pathname.replace(/\/+$/, '');
  if (!prefix) return true;
  return a.pathname === prefix || a.pathname.startsWith(prefix + '/');
}

export function looksLikeNonHtml(url: string): boolean {
  try {
    return NON_HTML_EXT.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

/** Wzorce użytkownika: zwykły tekst = „zawiera”, /…/ = wyrażenie regularne, * = dowolny ciąg. */
export function compilePattern(p: string): RegExp | null {
  const t = p.trim();
  if (!t) return null;
  const m = t.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (m) return new RegExp(m[1], m[2].replace('g', ''));
    if (t.includes('*')) return new RegExp(t.split('*').map(escapeRegExp).join('.*'), 'i');
    return new RegExp(escapeRegExp(t), 'i');
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function exclusionReason(url: string, userPatterns: RegExp[]): string | null {
  if (looksLikeNonHtml(url)) return 'plik (nie HTML)';
  for (const re of DEFAULT_EXCLUDES) if (re.test(url)) return 'adres techniczny (logowanie, koszyk, panel)';
  for (const re of userPatterns) if (re.test(url)) return `wykluczenie: ${re.source}`;
  return null;
}

/**
 * Klucz szablonu: ostatni segment ścieżki zastępowany „*”, liczby „:id”.
 * Strony z pierwszego poziomu (/o-nas, /kontakt) nie są grupowane.
 */
export function templateKey(url: string): string | null {
  const u = new URL(url);
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs.length < 2) {
    if (segs.length === 1 && u.search) return `/${segs[0]}?*`;
    return null;
  }
  const norm = segs.slice(0, -1).map((s) => (/^\d+$/.test(s) ? ':id' : s));
  return '/' + [...norm, '*'].join('/');
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

export function shortPath(url: string): string {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search) || '/';
  } catch {
    return url;
  }
}

export function slugForFile(url: string, max = 60): string {
  const p = shortPath(url).replace(/^\/+/, '') || 'home';
  return p.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, max).toLowerCase() || 'home';
}
