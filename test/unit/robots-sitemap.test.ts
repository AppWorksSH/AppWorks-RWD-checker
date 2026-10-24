import { describe, expect, it } from 'vitest';
import { parseRobots } from '../../src/core/robots';
import { extractLocs } from '../../src/core/sitemap';

describe('parseRobots', () => {
  const txt = `
# komentarz
User-agent: *
Disallow: /private
Disallow: /*.php$
Allow: /private/public
Disallow:

User-agent: googlebot
Disallow: /

Sitemap: https://example.com/sitemap.xml
`;
  const r = parseRobots(txt);

  it('stosuje reguły dla *', () => {
    expect(r.isAllowed('https://example.com/')).toBe(true);
    expect(r.isAllowed('https://example.com/private/x')).toBe(false);
    expect(r.isAllowed('https://example.com/private/public/x')).toBe(true);
  });
  it('obsługuje * i $', () => {
    expect(r.isAllowed('https://example.com/index.php')).toBe(false);
    expect(r.isAllowed('https://example.com/index.php?a=1')).toBe(true);
  });
  it('zbiera mapy strony', () => {
    expect(r.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });
  it('pusty plik pozwala na wszystko', () => {
    expect(parseRobots('').isAllowed('https://example.com/x')).toBe(true);
  });
});

describe('extractLocs', () => {
  it('czyta zwykłą mapę strony', () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url>
      <url><loc><![CDATA[ https://example.com/b ]]></loc></url></urlset>`;
    expect(extractLocs(xml)).toEqual({ urls: ['https://example.com/a?x=1&y=2', 'https://example.com/b'], sitemaps: [] });
  });
  it('rozpoznaje indeks map', () => {
    const xml = `<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(extractLocs(xml)).toEqual({ urls: [], sitemaps: ['https://example.com/post-sitemap.xml'] });
  });
});
