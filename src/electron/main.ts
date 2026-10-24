import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { aiListModels, aiTest } from '../core/ai';
import { APP_VERSION, applyProfile, defaultOptions } from '../core/defaults';
import { engineStatus, playwrightCliPath, systemChromeAvailable } from '../core/browsers';
import { exportSingleFile, regenerateReport } from '../core/report/html';
import { makeScanId, ScanStore } from '../core/storage';
import type { AiProvider, ScanEvent, ScanOptions } from '../core/types';
import type { AppState, JobState, WorkerOut } from '../shared/api';
import {
  addSiteRule,
  dataDir,
  finalizeOptions,
  getApiKey,
  getSettings,
  removeSiteRule,
  saveSettings,
  setApiKey,
} from './settings';

app.setName('RWD Checker');
if (process.env.RWD_USER_DATA) app.setPath('userData', path.resolve(process.env.RWD_USER_DATA));

let mainWindow: BrowserWindow | null = null;
const jobs: JobState[] = [];
const pending = new Map<string, { options: ScanOptions; resume: boolean }>();
let running: { id: string; proc: UtilityProcess } | null = null;
let installing = false;
const store = () => new ScanStore(dataDir());

// ---------- okna ----------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'RWD Checker',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  guardNavigation(mainWindow.webContents);
  mainWindow.on('closed', () => (mainWindow = null));
}

function guardNavigation(wc: WebContents) {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
}

async function openReport(id: string) {
  const dir = store().dir(id);
  if (existsSync(path.join(dir, 'result.json'))) await regenerateReport(dir).catch(() => {});
  const file = path.join(dir, 'report.html');
  if (!existsSync(file)) throw new Error('Raport dla tego skanu nie istnieje.');
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    title: 'Raport RWD',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'reportPreload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  guardNavigation(win.webContents);
  await win.loadFile(file);
}

async function printPdf(id: string, outFile: string) {
  const dir = store().dir(id);
  const win = new BrowserWindow({ show: false, width: 1100, height: 1400, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(path.join(dir, 'report.html'), { hash: 'print' });
    const started = Date.now();
    while (!(await win.webContents.executeJavaScript('window.__reportReady === true'))) {
      if (Date.now() - started > 60000) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.47, bottom: 0.55, left: 0.4, right: 0.4 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:sans-serif">RWD Checker · strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outFile, pdf);
  } finally {
    win.destroy();
  }
}

// ---------- kolejka skanów ----------

let stateTimer: NodeJS.Timeout | null = null;
function pushState(now = false) {
  const send = () => {
    stateTimer = null;
    mainWindow?.webContents.send('state', getState());
  };
  if (now) {
    if (stateTimer) clearTimeout(stateTimer);
    send();
  } else if (!stateTimer) stateTimer = setTimeout(send, 200);
}

function getState(): AppState {
  return { jobs: structuredClone(jobs) };
}

function job(id: string) {
  return jobs.find((j) => j.id === id);
}

function enqueue(options: ScanOptions, resumeId?: string): string {
  const id = resumeId ?? makeScanId(options.url);
  if (job(id) && ['queued', 'running'].includes(job(id)!.status)) return id;
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx >= 0) jobs.splice(idx, 1);
  jobs.unshift({ id, url: options.url, status: 'queued', done: 0, total: 0, issues: 0, logs: [] });
  pending.set(id, { options, resume: !!resumeId });
  pushState(true);
  setImmediate(runNext);
  return id;
}

function runNext() {
  if (running) return;
  const next = [...jobs].reverse().find((j) => j.status === 'queued');
  if (!next) return;
  const p = pending.get(next.id);
  pending.delete(next.id);
  if (!p) {
    next.status = 'failed';
    next.error = 'Brak parametrów skanu';
    return runNext();
  }
  next.status = 'running';
  next.startedAt = new Date().toISOString();
  const proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], {
    serviceName: 'RWD Checker – skan',
    stdio: 'pipe',
  });
  running = { id: next.id, proc };
  proc.stderr?.on('data', (d) => addLog(next, 'error', String(d).trim().slice(0, 400)));
  proc.on('message', (m: WorkerOut) => onWorkerMessage(next, m));
  proc.on('exit', (code) => {
    if (next.status === 'running') {
      next.status = 'failed';
      next.error = `Proces skanu zakończył się nieoczekiwanie (kod ${code}).`;
      next.finishedAt = new Date().toISOString();
      notify(next);
    }
    running = null;
    pushState(true);
    setImmediate(runNext);
  });
  proc.postMessage({ type: 'start', storeDir: dataDir(), options: p.options, id: next.id, resumeId: p.resume ? next.id : undefined });
  pushState(true);
}

function addLog(j: JobState, level: 'info' | 'warn' | 'error', message: string) {
  if (!message) return;
  j.logs.push({ level, message, at: new Date().toISOString() });
  if (j.logs.length > 300) j.logs.splice(0, j.logs.length - 300);
}

function onWorkerMessage(j: JobState, m: WorkerOut) {
  if (m.type === 'event') {
    applyEvent(j, m.event);
    mainWindow?.webContents.send('scan:event', j.id, m.event);
  } else if (m.type === 'done') {
    j.meta = m.meta;
    j.status = m.meta.status === 'completed' ? 'done' : m.meta.status === 'cancelled' ? 'cancelled' : 'failed';
    j.error = m.meta.error;
    j.finishedAt = new Date().toISOString();
    j.phase = 'done';
    notify(j);
  } else if (m.type === 'error') {
    j.status = 'failed';
    j.error = m.message;
    j.finishedAt = new Date().toISOString();
    addLog(j, 'error', m.message);
    notify(j);
  }
  pushState(m.type !== 'event');
}

function applyEvent(j: JobState, e: ScanEvent) {
  if (e.type === 'phase') {
    j.phase = e.phase;
    j.done = 0;
    j.total = e.total ?? 0;
    j.message = undefined;
  } else if (e.type === 'progress') {
    j.phase = e.phase;
    j.done = e.done;
    j.total = e.total;
    j.message = e.message;
  } else if (e.type === 'log') addLog(j, e.level, e.message);
  else if (e.type === 'issues') j.issues = e.count;
  else if (e.type === 'finished') j.meta = e.meta;
}

function notify(j: JobState) {
  if (!getSettings().notifications || !Notification.isSupported()) return;
  const s = j.meta?.summary;
  const body =
    j.status === 'done' && s
      ? `Wynik ${s.score}/100 · krytyczne: ${s.bySeverity.critical}, wysokie: ${s.bySeverity.high}, średnie: ${s.bySeverity.medium}`
      : j.status === 'cancelled'
        ? 'Skan przerwany — możesz go wznowić z historii.'
        : `Skan nie powiódł się: ${j.error ?? 'nieznany błąd'}`;
  const n = new Notification({ title: `RWD Checker — ${j.meta?.host ?? j.url}`, body });
  n.on('click', () => {
    if (j.status === 'done') openReport(j.id).catch(() => {});
    else mainWindow?.show();
  });
  n.show();
}

function prepareNew(o: ScanOptions): ScanOptions {
  const url = o.url.trim();
  return finalizeOptions({ ...o, url: /^https?:\/\//i.test(url) ? url : `https://${url}` });
}

// ---------- harmonogram ----------

function scheduleDue(s: { interval: 'daily' | 'weekly'; weekday: number; hour: number; lastRun?: string }, now: Date): boolean {
  if (now.getHours() < s.hour) return false;
  if (s.interval === 'weekly' && now.getDay() !== s.weekday) return false;
  if (!s.lastRun) return true;
  const last = new Date(s.lastRun);
  const sameDay = last.toDateString() === now.toDateString();
  if (s.interval === 'daily') return !sameDay;
  return !sameDay && now.getTime() - last.getTime() > 6 * 864e5 - 3600e3;
}

function tickScheduler() {
  const settings = getSettings();
  const now = new Date();
  let changed = false;
  const schedules = settings.schedules.map((s) => {
    if (!s.enabled || !scheduleDue(s, now)) return s;
    changed = true;
    const base = applyProfile({ ...settings.defaults, url: s.url }, s.profile);
    enqueue(prepareNew(base));
    return { ...s, lastRun: now.toISOString() };
  });
  if (changed) saveSettings({ schedules });
}

// ---------- przeglądarki ----------

function installBrowsers(): Promise<boolean> {
  if (installing) return Promise.resolve(false);
  const log = (s: string) => mainWindow?.webContents.send('browsers:log', s);
  let cli: string;
  try {
    cli = playwrightCliPath();
    if (!existsSync(cli)) throw new Error(`nie znaleziono ${cli}`);
  } catch (e) {
    log(`Błąd: nie można uruchomić instalatora (${(e as Error).message}).`);
    return Promise.resolve(false);
  }
  installing = true;
  log('Pobieranie przeglądarek (ok. 400 MB) — może potrwać kilka minut…');
  return new Promise((resolve) => {
    let lastLine = '';
    const finish = (ok: boolean, message: string) => {
      if (!installing) return;
      installing = false;
      log(message);
      resolve(ok);
    };
    const p = spawn(process.execPath, [cli, 'install', 'chromium', 'webkit', 'firefox'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    const onData = (d: Buffer) =>
      String(d)
        .split(/\r|\n/)
        .map((l) => l.trim())
        .filter((l) => l && l !== lastLine)
        .forEach((l) => log((lastLine = l)));
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) => finish(false, `Błąd: ${e.message}`));
    p.on('close', (code) => finish(code === 0, code === 0 ? 'Instalacja zakończona.' : `Instalacja zakończona błędem (kod ${code}).`));
  });
}

// ---------- IPC ----------

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (_e, ...args) => fn(...args));
}

function registerIpc() {
  handle('settings:get', () => getSettings());
  handle('settings:save', (patch) => {
    const s = saveSettings(patch);
    if (patch && 'launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
    return s;
  });
  handle('settings:setKey', (provider: AiProvider, key: string) => setApiKey(provider, key));
  handle('settings:removeSiteRule', (host, kind, value) => removeSiteRule(host, kind, value));
  handle('report:ignoreFingerprint', (host, fp, title) => {
    addSiteRule(host, 'fingerprint', fp, title);
    mainWindow?.webContents.send('settings:changed');
  });
  handle('report:ignoreSelector', (host, selector) => {
    addSiteRule(host, 'selector', selector);
    mainWindow?.webContents.send('settings:changed');
  });

  handle('scan:start', (o: ScanOptions) => {
    if (!o?.url?.trim()) throw new Error('Podaj adres strony.');
    return { id: enqueue(prepareNew(o)) };
  });
  handle('scan:cancel', (id: string) => {
    const j = job(id);
    if (!j) return;
    if (j.status === 'queued') {
      pending.delete(id);
      j.status = 'cancelled';
      pushState(true);
    } else if (running?.id === id) {
      running.proc.postMessage({ type: 'cancel' });
      addLog(j, 'warn', 'Przerywanie skanu…');
      pushState(true);
    }
  });
  handle('scan:resume', async (id: string) => {
    const saved = await store().read<ScanOptions>(id, 'options.json');
    if (!saved) throw new Error('Nie znaleziono opcji skanu — nie można go wznowić.');
    const o = finalizeOptions({ ...defaultOptions(saved.url), ...saved, ai: { ...defaultOptions().ai, ...saved.ai } });
    return { id: enqueue(o, id) };
  });
  handle('scan:state', () => getState());
  handle('scan:clearFinished', () => {
    for (let i = jobs.length - 1; i >= 0; i--) if (!['queued', 'running'].includes(jobs[i].status)) jobs.splice(i, 1);
    pushState(true);
  });

  handle('scans:list', async () =>
    (await store().list()).map((m) =>
      m.status === 'running' && running?.id !== m.id && job(m.id)?.status !== 'queued' ? { ...m, status: 'cancelled' as const } : m,
    ),
  );
  handle('scans:delete', async (id: string) => {
    if (running?.id === id) throw new Error('Nie można usunąć trwającego skanu.');
    await store().remove(id);
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx >= 0) jobs.splice(idx, 1);
    pushState(true);
  });
  handle('scans:open', (id: string) => openReport(id));
  handle('scans:reveal', (id: string) => {
    const dir = store().dir(id);
    const report = path.join(dir, 'report.html');
    if (existsSync(report)) shell.showItemInFolder(report);
    else shell.openPath(dir);
  });
  handle('scans:exportPdf', async (id: string) => {
    const meta = await store().read<{ host: string }>(id, 'meta.json');
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: path.join(app.getPath('downloads'), `raport-rwd-${meta?.host ?? id}-${id.slice(0, 10)}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await printPdf(id, r.filePath);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });
  handle('scans:exportHtml', async (id: string) => {
    const meta = await store().read<{ host: string }>(id, 'meta.json');
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: path.join(app.getPath('downloads'), `raport-rwd-${meta?.host ?? id}-${id.slice(0, 10)}.html`),
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (r.canceled || !r.filePath) return null;
    await exportSingleFile(store().dir(id), r.filePath);
    shell.showItemInFolder(r.filePath);
    return r.filePath;
  });

  handle('browsers:info', () => ({
    engines: engineStatus().map(({ engine, installed }) => ({ engine, installed })),
    systemChrome: systemChromeAvailable(),
    installing,
  }));
  handle('browsers:install', () => installBrowsers());

  handle('ai:test', (provider: AiProvider, model: string) => {
    const apiKey = getApiKey(provider);
    if (!apiKey) throw new Error('Najpierw zapisz klucz API.');
    return aiTest({ provider, model, apiKey });
  });
  handle('ai:models', (provider: AiProvider) => {
    const apiKey = getApiKey(provider);
    if (!apiKey) throw new Error('Najpierw zapisz klucz API.');
    return aiListModels({ provider, apiKey });
  });

  handle('app:info', () => ({ version: APP_VERSION, dataDir: dataDir() }));
  handle('app:openDataDir', () => shell.openPath(dataDir()));
  handle('app:openExternal', (url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  });
}

// ---------- start ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    createMainWindow();
    setInterval(tickScheduler, 60_000);
    setTimeout(tickScheduler, 5_000);
  });

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !running) app.quit();
  });

  app.on('before-quit', (e) => {
    if (!running) return;
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Przerwij i zamknij', 'Anuluj'],
      defaultId: 1,
      message: 'Trwa skan',
      detail: 'Zamknięcie aplikacji przerwie skan. Będzie go można wznowić z historii.',
    });
    if (choice === 1) {
      e.preventDefault();
      return;
    }
    running.proc.postMessage({ type: 'cancel' });
    running.proc.kill();
  });
}
