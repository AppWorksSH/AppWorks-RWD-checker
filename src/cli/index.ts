import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { applyProfile, defaultOptions, DEFAULT_AI_MODELS, type ProfileId } from '../core/defaults';
import { exportSingleFile } from '../core/report/html';
import { exportPdf } from '../core/report/pdf';
import { playwrightCliPath } from '../core/browsers';
import { ruleMeta, SEVERITY_LABELS, severityRank } from '../core/rules';
import { Scanner } from '../core/scanner';
import { ScanStore } from '../core/storage';
import type { AiProvider, ScanEvent, Severity } from '../core/types';

const HELP = `RWD Checker — automatyczne sprawdzanie responsywności stron

Użycie:
  rwd-checker scan <adres> [opcje]
  rwd-checker browsers            instaluje przeglądarki (Chromium, WebKit, Firefox)

Opcje skanu:
  --profile <quick|standard|full>  profil skanu (domyślnie standard)
  --max-pages <n>                  limit podstron (domyślnie 50)
  --depth <n>                      maksymalna głębokość linków (domyślnie 5)
  --concurrency <n>                liczba równoległych kart (domyślnie 4)
  --out <katalog>                  katalog raportów (domyślnie ./rwd-reports)
  --no-sweep                       wyłącz skan zakresów szerokości
  --sweep-step <px>                krok skanu szerokości (domyślnie wg profilu)
  --no-webkit / --firefox          wyłącz Safari (WebKit) / dodaj Firefox (desktop)
  --no-axe / --no-links            wyłącz testy dostępności / sprawdzanie linków
  --exclude <wzorzec>              wyklucz adresy (można powtarzać, /regex/ lub tekst z *)
  --ignore <selektor>              ignoruj elementy CSS (można powtarzać)
  --basic-auth <login:hasło>       uwierzytelnienie HTTP (np. serwer testowy)
  --ai                             analiza AI (klucz: ANTHROPIC_API_KEY lub OPENAI_API_KEY)
  --ai-provider <anthropic|openai> dostawca AI
  --ai-model <model>               model AI
  --resume <id>                    wznów przerwany skan o podanym identyfikatorze
  --pdf                            dodatkowo zapisz raport PDF
  --single                         dodatkowo zapisz raport jako jeden plik HTML
  --open                           otwórz raport po zakończeniu
  --fail-on <critical|high|medium|low>  kod wyjścia 1, jeśli są problemy o tej wadze lub wyższej
`;

function installBrowsers(): Promise<number> {
  const cli = playwrightCliPath();
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, 'install', 'chromium', 'webkit', 'firefox'], { stdio: 'inherit' });
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

const PHASES: Record<string, string> = {
  discovery: 'Odkrywanie podstron',
  links: 'Sprawdzanie linków',
  audit: 'Audyt widoków',
  sweep: 'Skan zakresów szerokości',
  ai: 'Analiza AI',
  report: 'Generowanie raportu',
  done: 'Gotowe',
};

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string', default: 'standard' },
      'max-pages': { type: 'string' },
      depth: { type: 'string' },
      concurrency: { type: 'string' },
      out: { type: 'string', default: 'rwd-reports' },
      'no-sweep': { type: 'boolean' },
      'sweep-step': { type: 'string' },
      'no-webkit': { type: 'boolean' },
      firefox: { type: 'boolean' },
      'no-axe': { type: 'boolean' },
      'no-links': { type: 'boolean' },
      exclude: { type: 'string', multiple: true },
      ignore: { type: 'string', multiple: true },
      'basic-auth': { type: 'string' },
      ai: { type: 'boolean' },
      'ai-provider': { type: 'string' },
      'ai-model': { type: 'string' },
      resume: { type: 'string' },
      pdf: { type: 'boolean' },
      single: { type: 'boolean' },
      open: { type: 'boolean' },
      'fail-on': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const cmd = positionals[0];
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === 'browsers') return installBrowsers();
  if (cmd !== 'scan') {
    process.stderr.write(`Nieznane polecenie: ${cmd}\n\n${HELP}`);
    return 2;
  }

  const store = new ScanStore(path.resolve(values.out!));
  let url = positionals[1];
  if (values.resume) {
    const saved = await store.read<{ url: string }>(values.resume, 'options.json');
    if (!saved) throw new Error(`Nie znaleziono skanu ${values.resume} w ${store.baseDir}`);
    url = saved.url;
  }
  if (!url) {
    process.stderr.write('Podaj adres strony, np.: rwd-checker scan https://example.com\n');
    return 2;
  }

  let o = values.resume
    ? { ...defaultOptions(url), ...(await store.read<ReturnType<typeof defaultOptions>>(values.resume, 'options.json'))! }
    : applyProfile(defaultOptions(url), values.profile as ProfileId);
  if (!values.resume) {
    if (values['max-pages']) o.maxPages = Number(values['max-pages']);
    if (values.depth) o.maxDepth = Number(values.depth);
    if (values.concurrency) o.concurrency = Number(values.concurrency);
    if (values['no-sweep']) o.sweep.enabled = false;
    if (values['sweep-step']) o.sweep = { ...o.sweep, enabled: true, step: Number(values['sweep-step']) };
    if (values['no-webkit']) o.engines.webkit = [];
    if (values.firefox) o.engines.firefox = ['desktop'];
    if (values['no-axe']) o.axe = false;
    if (values['no-links']) o.checkLinks = false;
    if (values.exclude) o.excludePatterns = values.exclude;
    if (values.ignore) o.ignoreSelectors = values.ignore;
    if (values['basic-auth']) {
      const [username, ...rest] = values['basic-auth'].split(':');
      o.basicAuth = { username, password: rest.join(':') };
    }
    if (values.ai) o.ai.enabled = true;
  }
  if (o.ai.enabled) {
    const provider = (values['ai-provider'] as AiProvider) ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : o.ai.provider);
    o.ai.provider = provider;
    o.ai.model = values['ai-model'] ?? (values['ai-provider'] ? DEFAULT_AI_MODELS[provider] : o.ai.model);
    o.ai.apiKey = provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  }

  const isTty = process.stderr.isTTY;
  let lastLine = '';
  const line = (s: string) => {
    if (isTty) {
      process.stderr.write('\r\x1b[2K' + s.slice(0, (process.stderr.columns || 120) - 1));
      lastLine = s;
    }
  };
  const println = (s: string) => {
    if (isTty && lastLine) process.stderr.write('\r\x1b[2K');
    process.stderr.write(s + '\n');
    lastLine = '';
  };
  const onEvent = (e: ScanEvent) => {
    if (e.type === 'phase') println(`▸ ${PHASES[e.phase] ?? e.phase}`);
    else if (e.type === 'progress') line(`  [${e.done}/${e.total}] ${e.message ?? ''}`);
    else if (e.type === 'log') println(`  ${e.level === 'error' ? '✖' : e.level === 'warn' ? '!' : '·'} ${e.message}`);
  };

  const scanner = new Scanner({ options: o, store, resumeId: values.resume, onEvent });
  process.on('SIGINT', () => scanner.cancel());
  println(`Skan ${scanner.id}`);
  const result = await scanner.run();
  const dir = store.dir(scanner.id);
  const report = path.join(dir, 'report.html');

  if (result.meta.status === 'failed') {
    println(`\nSkan nie powiódł się: ${result.meta.error}`);
    return 3;
  }
  const s = result.meta.summary!;
  println('');
  if (result.meta.status === 'cancelled') println(`Skan przerwany — wznów poleceniem: rwd-checker scan --resume ${scanner.id} --out ${values.out}`);
  println(`Wynik RWD: ${s.score}/100   (${result.discovery.pages.length} podstron, ${s.tasks} widoków)`);
  println(
    (['critical', 'high', 'medium', 'low'] as Severity[]).map((k) => `${SEVERITY_LABELS[k]}: ${s.bySeverity[k]}`).join('   '),
  );
  for (const g of result.groups.filter((g) => severityRank(g.severity) <= 1).slice(0, 10)) {
    println(`  • [${SEVERITY_LABELS[g.severity]}] ${ruleMeta(g.ruleId).title} — ${g.message.slice(0, 110)} (${g.pageCount} podstr.)`);
  }
  if (values.pdf) {
    const f = path.join(dir, 'raport.pdf');
    await exportPdf(dir, f);
    println(`PDF: ${f}`);
  }
  if (values.single) {
    const f = path.join(dir, `raport-${result.meta.host}.html`);
    await exportSingleFile(dir, f);
    println(`Jeden plik: ${f}`);
  }
  println(`Raport: ${report}`);
  if (values.open) spawn('open', [report], { stdio: 'ignore', detached: true }).unref();

  const failOn = values['fail-on'] as Severity | undefined;
  if (failOn && result.groups.some((g) => severityRank(g.severity) <= severityRank(failOn))) return 1;
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`Błąd: ${(e as Error).message}\n`);
    process.exit(3);
  },
);
