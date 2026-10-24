import { describe, expect, it } from 'vitest';
import { applyProfile, defaultOptions, sanitizeOptions } from '../../src/core/defaults';
import { imageSize } from '../../src/core/image';
import { ruleMeta, RULES } from '../../src/core/rules';
import { normalizeOptions } from '../../src/core/scanner';
import { makeScanId } from '../../src/core/storage';

describe('imageSize', () => {
  it('czyta wymiary PNG', () => {
    const buf = Buffer.alloc(32);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.writeUInt32BE(640, 16);
    buf.writeUInt32BE(480, 20);
    expect(imageSize(buf)).toEqual({ width: 640, height: 480 });
  });
  it('czyta wymiary JPEG (SOF0)', () => {
    const buf = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0,
    ]);
    expect(imageSize(buf)).toEqual({ width: 640, height: 480 });
  });
  it('zwraca null dla innych danych', () => {
    expect(imageSize(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('opcje', () => {
  it('profile zmieniają zakres testów', () => {
    const base = defaultOptions('https://example.com');
    const quick = applyProfile(base, 'quick');
    expect(quick.viewports.filter((v) => v.enabled)).toHaveLength(3);
    expect(quick.sweep.enabled).toBe(false);
    const full = applyProfile(base, 'full');
    expect(full.engines.firefox).toEqual(['desktop']);
    expect(full.sweep.step).toBe(10);
    expect(base.sweep.step).toBe(10);
  });
  it('sanitizeOptions usuwa sekrety', () => {
    const o = defaultOptions('https://example.com');
    o.ai.apiKey = 'sk-secret';
    o.basicAuth = { username: 'u', password: 'p' };
    const s = sanitizeOptions(o);
    expect(s.ai.apiKey).toBeUndefined();
    expect(s.basicAuth?.password).not.toBe('p');
    expect(o.ai.apiKey).toBe('sk-secret');
  });
  it('normalizeOptions dodaje protokół i pilnuje limitów', () => {
    const o = normalizeOptions({ ...defaultOptions('example.com'), concurrency: 999, sweep: { ...defaultOptions().sweep, step: 0 } });
    expect(o.url.startsWith('https://example.com')).toBe(true);
    expect(o.concurrency).toBeLessThanOrEqual(16);
    expect(o.sweep.step).toBeGreaterThanOrEqual(1);
  });
});

describe('reguły', () => {
  it('każda reguła ma polski opis i wskazówkę naprawy', () => {
    for (const [id, r] of Object.entries(RULES)) {
      expect(r.title, id).toBeTruthy();
      expect(r.description, id).toBeTruthy();
      expect(r.fix, id).toBeTruthy();
    }
  });
  it('reguły axe mają kategorię dostępności', () => {
    expect(ruleMeta('axe:color-contrast').category).toBe('a11y');
  });
});

describe('makeScanId', () => {
  it('zawiera datę i domenę', () => {
    expect(makeScanId('https://www.example.com/x', new Date(2026, 9, 24, 8, 5, 3))).toBe('2026-10-24_08-05-03_example.com');
  });
});
