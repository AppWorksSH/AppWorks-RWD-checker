// Generuje build/icon.png (1024×1024) używane przez electron-builder.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = `<!doctype html><html><body style="margin:0;width:1024px;height:1024px;background:transparent">
<div style="position:absolute;left:100px;top:100px;width:824px;height:824px;border-radius:185px;
  background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);box-shadow:0 20px 40px rgba(0,0,0,.25);overflow:hidden">
  <div style="position:absolute;left:150px;top:250px;width:420px;height:300px;border:28px solid #fff;border-radius:28px"></div>
  <div style="position:absolute;left:300px;top:578px;width:120px;height:28px;background:#fff;border-radius:14px"></div>
  <div style="position:absolute;left:470px;top:330px;width:210px;height:290px;border:28px solid #fff;border-radius:30px;background:rgba(255,255,255,.18)"></div>
  <div style="position:absolute;left:590px;top:430px;width:100px;height:190px;border:24px solid #fff;border-radius:22px;background:#ec4899"></div>
  <div style="position:absolute;left:500px;top:520px;width:190px;height:190px;border-radius:50%;background:#22c55e;border:24px solid #fff;
    display:flex;align-items:center;justify-content:center;color:#fff;font:900 130px/1 -apple-system,sans-serif">✓</div>
</div></body></html>`;

await mkdir(path.join(root, 'build'), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(html);
await page.screenshot({ path: path.join(root, 'build/icon.png'), omitBackground: true });
await browser.close();
console.log('build/icon.png');
