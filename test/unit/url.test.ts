import { describe, expect, it } from 'vitest';
import {
  compilePattern,
  exclusionReason,
  isSameSite,
  isUnderPath,
  looksLikeNonHtml,
  normalizeUrl,
  slugForFile,
  templateKey,
} from '../../src/core/url';

describe('normalizeUrl', () => {
  it('usuwa hash, parametry śledzące i końcowy ukośnik', () => {
    expect(normalizeUrl('https://Example.com/oferta/?utm_source=x&b=2&a=1#sekcja')).toBe('https://example.com/oferta?a=1&b=2');
  });
  it('rozwiązuje adresy względne i index.html', () => {
    expect(normalizeUrl('../kontakt/index.html', 'https://example.com/o-nas/zespol')).toBe('https://example.com/kontakt');
  });
  it('usuwa domyślny port i podwójne ukośniki', () => {
    expect(normalizeUrl('https://example.com:443//a//b')).toBe('https://example.com/a/b');
  });
  it('odrzuca inne protokoły', () => {
    expect(normalizeUrl('mailto:biuro@example.com')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('tel:+48123')).toBeNull();
  });
});

describe('zakres witryny', () => {
  it('traktuje www jako tę samą domenę', () => {
    expect(isSameSite('https://www.example.com/a', 'https://example.com', false)).toBe(true);
  });
  it('subdomeny tylko po włączeniu opcji', () => {
    expect(isSameSite('https://blog.example.com/', 'https://example.com', false)).toBe(false);
    expect(isSameSite('https://blog.example.com/', 'https://example.com', true)).toBe(true);
    expect(isSameSite('https://example.com.evil.pl/', 'https://example.com', true)).toBe(false);
  });
  it('ogranicza do ścieżki', () => {
    expect(isUnderPath('https://example.com/oferta/strony', 'https://example.com/oferta/')).toBe(true);
    expect(isUnderPath('https://example.com/oferta', 'https://example.com/oferta')).toBe(true);
    expect(isUnderPath('https://example.com/oferta-specjalna', 'https://example.com/oferta')).toBe(false);
    expect(isUnderPath('https://example.com/cokolwiek', 'https://example.com/')).toBe(true);
  });
});

describe('wykluczenia', () => {
  it('rozpoznaje pliki', () => {
    expect(looksLikeNonHtml('https://example.com/cennik.pdf')).toBe(true);
    expect(looksLikeNonHtml('https://example.com/cennik')).toBe(false);
  });
  it('domyślnie pomija logowanie i koszyk', () => {
    expect(exclusionReason('https://example.com/wp-admin/', [])).toMatch(/techniczny/);
    expect(exclusionReason('https://example.com/koszyk', [])).toMatch(/techniczny/);
    expect(exclusionReason('https://example.com/produkty?add-to-cart=12', [])).toMatch(/techniczny/);
    expect(exclusionReason('https://example.com/o-nas', [])).toBeNull();
  });
  it('wzorce użytkownika: tekst, * i regex', () => {
    const p = ['/regulamin', '*/tag/*', '/\\?page=\\d+/'].map(compilePattern).filter((x): x is RegExp => !!x);
    expect(exclusionReason('https://example.com/regulamin-sklepu', p)).toMatch(/wykluczenie/);
    expect(exclusionReason('https://example.com/blog/tag/rwd', p)).toMatch(/wykluczenie/);
    expect(exclusionReason('https://example.com/blog?page=3', p)).toMatch(/wykluczenie/);
    expect(exclusionReason('https://example.com/blog', p)).toBeNull();
  });
  it('błędny regex nie wywraca aplikacji', () => {
    expect(compilePattern('/(/')).toBeNull();
    expect(compilePattern('  ')).toBeNull();
  });
});

describe('templateKey', () => {
  it('grupuje podstrony z jednego katalogu', () => {
    expect(templateKey('https://example.com/blog/wpis-1')).toBe('/blog/*');
    expect(templateKey('https://example.com/blog/wpis-2')).toBe('/blog/*');
    expect(templateKey('https://example.com/sklep/12/produkt')).toBe('/sklep/:id/*');
  });
  it('nie grupuje stron pierwszego poziomu', () => {
    expect(templateKey('https://example.com/kontakt')).toBeNull();
    expect(templateKey('https://example.com/')).toBeNull();
    expect(templateKey('https://example.com/szukaj?q=a')).toBe('/szukaj?*');
  });
});

describe('slugForFile', () => {
  it('tworzy bezpieczną nazwę pliku', () => {
    expect(slugForFile('https://example.com/')).toBe('home');
    expect(slugForFile('https://example.com/O nas/Zespół?x=1')).toBe('o-nas-zesp-x-1');
  });
});
