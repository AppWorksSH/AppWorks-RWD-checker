import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { engineStatus, launchEngine, systemChromeAvailable } from '../browsers';

export async function exportPdf(scanDir: string, outFile: string): Promise<void> {
  const chromiumInstalled = engineStatus().find((s) => s.engine === 'chromium')?.installed;
  if (!chromiumInstalled && !systemChromeAvailable()) throw new Error('Do eksportu PDF potrzebna jest przeglądarka Chromium lub Google Chrome.');
  const browser = await launchEngine('chromium', { useSystemChrome: !chromiumInstalled });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(scanDir, 'report.html')).href + '#print', { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as { __reportReady?: boolean }).__reportReady === true, null, { timeout: 60000 });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: outFile,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:sans-serif">RWD Checker · strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
}
