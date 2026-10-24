import { existsSync } from 'node:fs';
import path from 'node:path';
import { nodeRequire } from './resolve';
import { chromium, firefox, webkit, type Browser, type BrowserContextOptions, type BrowserType } from 'playwright-core';
import type { EngineName, ScanOptions, ViewportDef } from './types';

const TYPES: Record<EngineName, BrowserType> = { chromium, webkit, firefox };

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 15; SM-X720) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:142.0) Gecko/20100101 Firefox/142.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0',
};

function userAgent(vp: ViewportDef, engine: EngineName): string {
  if (vp.category === 'desktop') {
    return engine === 'webkit' ? UA.safariMac : engine === 'firefox' ? UA.firefoxMac : UA.chromeMac;
  }
  if (engine === 'webkit') return vp.category === 'phone' ? UA.iphone : UA.ipad;
  if (engine === 'firefox') return UA.firefoxAndroid;
  return vp.category === 'phone' ? UA.androidPhone : UA.androidTablet;
}

export function contextOptions(vp: ViewportDef, engine: EngineName, o: ScanOptions): BrowserContextOptions {
  const mobile = vp.category !== 'desktop';
  return {
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: mobile && engine !== 'firefox',
    hasTouch: mobile,
    userAgent: userAgent(vp, engine),
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    ignoreHTTPSErrors: true,
    bypassCSP: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    httpCredentials: o.basicAuth?.username ? { ...o.basicAuth } : undefined,
  };
}

export async function launchEngine(engine: EngineName, o: Pick<ScanOptions, 'useSystemChrome'>): Promise<Browser> {
  const type = TYPES[engine];
  if (engine === 'chromium' && o.useSystemChrome) {
    return type.launch({ headless: true, channel: 'chrome' });
  }
  return type.launch({ headless: true });
}

export interface EngineStatus {
  engine: EngineName;
  installed: boolean;
  path: string;
}

export function engineStatus(): EngineStatus[] {
  return (Object.keys(TYPES) as EngineName[]).map((engine) => {
    let exe = '';
    try {
      exe = TYPES[engine].executablePath();
    } catch {
      exe = '';
    }
    return { engine, installed: !!exe && existsSync(exe), path: exe };
  });
}

/** Ścieżka do instalatora przeglądarek Playwright (poza archiwum asar, bo uruchamiamy go jako osobny proces). */
export function playwrightCliPath(): string {
  const pkg = nodeRequire.resolve('playwright-core/package.json');
  return path.join(path.dirname(pkg), 'cli.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

export function systemChromeAvailable(): boolean {
  return existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
}
