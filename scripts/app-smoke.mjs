// Test dymny aplikacji: uruchamia Electron, przechodzi przez ekrany, skanuje stronę testową i otwiera raport.
// Użycie: node scripts/app-smoke.mjs [adres]   (strona testowa: node test/fixtures/server.mjs)
// Spakowana aplikacja: RWD_APP="release/mac-arm64/RWD Checker.app/Contents/MacOS/RWD Checker" node scripts/app-smoke.mjs
import { _electron as electron } from 'playwright-core';
import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test/.tmp/app-smoke');
const url = process.argv[2] ?? 'http://127.0.0.1:4321/';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const packaged = process.env.RWD_APP;
const app = await electron.launch({
  executablePath: packaged ?? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: packaged ? [] : [root],
  env: { ...process.env, RWD_USER_DATA: path.join(out, 'userdata') },
});
const errors = [];
const win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.waitForSelector('.sidebar');
const shot = (name) => win.screenshot({ path: path.join(out, `${name}.png`) });

for (const [label, name] of [
  ['Ustawienia', 'settings'],
  ['Harmonogram', 'schedule'],
  ['Historia', 'history-empty'],
  ['Nowy skan', 'new'],
]) {
  await win.click(`.nav-item:has-text("${label}")`);
  await win.waitForTimeout(400);
  await shot(name);
}

await win.click('summary:has-text("Ustawienia zaawansowane")');
await win.waitForTimeout(200);
await shot('new-advanced');
await win.click('.segmented button:has-text("Szybki")');
await win.fill('.url-input', url);
await win.click('button:has-text("Rozpocznij skan")');
await win.waitForSelector('.status.running', { timeout: 20000 });
await win.waitForTimeout(6000);
await shot('progress');
await win.waitForSelector('button:has-text("Otwórz raport")', { timeout: 600000 });
await shot('done');

await win.click('.nav-item:has-text("Historia")');
await win.waitForTimeout(500);
await shot('history');

const reportPromise = app.waitForEvent('window');
await win.click('.nav-item:has-text("Skany")');
await win.click('button:has-text("Otwórz raport")');
const report = await reportPromise;
await report.waitForSelector('details.issue', { timeout: 20000 });
const hasIgnore = await report.locator('[data-ignore]').count();
await report.screenshot({ path: path.join(out, 'report.png') });
await report.locator('details.issue').first().click();
await report.locator('[data-ignore]').first().click();
await report.waitForTimeout(500);

const exported = {};
for (const [btn, ext] of [
  ['PDF', 'pdf'],
  ['Jeden plik HTML', 'html'],
]) {
  const file = path.join(out, `export.${ext}`);
  await app.evaluate(({ dialog, shell }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    shell.showItemInFolder = () => {};
  }, file);
  await win.click(`button:has-text("${btn}")`);
  for (let i = 0; i < 120 && !existsSync(file); i++) await win.waitForTimeout(500);
  await win.waitForTimeout(500);
  exported[ext] = existsSync(file) ? statSync(file).size : 0;
}

await win.click('.nav-item:has-text("Ustawienia")');
await win.waitForTimeout(500);
const rules = await win.locator('.tag').count();
await shot('settings-rules');

console.log(JSON.stringify({ errors, ignoreButtons: hasIgnore, siteRules: rules, exported }, null, 2));
await app.close();
