import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AiProvider, Issue, IssueGroup, Severity, ViewportDef } from './types';
import { ruleMeta, SEVERITY_LABELS } from './rules';
import { CATEGORY_LABELS } from './defaults';
import { imageSize } from './image';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

type Part = { type: 'text'; text: string } | { type: 'image'; base64: string; mediaType: string };

class AiError extends Error {
  constructor(message: string, public status?: number, public retryAfter?: number) {
    super(message);
  }
}

async function callOnce(cfg: AiConfig, system: string, parts: Part[], maxTokens: number, json: boolean): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: 'user',
            content: parts.map((p) =>
              p.type === 'text'
                ? { type: 'text', text: p.text }
                : { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } },
            ),
          },
        ],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      throw new AiError(body?.error?.message || `HTTP ${res.status}`, res.status, Number(res.headers.get('retry-after')) || undefined);
    }
    return (body.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_completion_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: parts.map((p) =>
            p.type === 'text'
              ? { type: 'text', text: p.text }
              : { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}`, detail: 'high' } },
          ),
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    throw new AiError(body?.error?.message || `HTTP ${res.status}`, res.status, Number(res.headers.get('retry-after')) || undefined);
  }
  return body.choices?.[0]?.message?.content ?? '';
}

async function call(cfg: AiConfig, system: string, parts: Part[], maxTokens: number, json = false): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await callOnce(cfg, system, parts, maxTokens, json);
    } catch (e) {
      lastErr = e;
      const err = e as AiError;
      const retriable = err.status === undefined || err.status === 429 || err.status >= 500;
      if (!retriable) break;
      const wait = (err.retryAfter ? err.retryAfter * 1000 : 2000 * 2 ** attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, Math.min(wait, 30000)));
    }
  }
  throw lastErr;
}

function extractJson(text: string): any {
  const cleaned = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model nie zwrócił JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const REVIEW_SYSTEM = `Jesteś doświadczonym testerem QA specjalizującym się w responsywności stron (RWD).
Oceniasz zrzuty ekranu strony internetowej wykonane w podanej rozdzielczości. Zrzuty to kolejne fragmenty strony od góry do dołu.
Szukaj WYŁĄCZNIE wyraźnie widocznych problemów wizualnych i układu, np.:
- nachodzące na siebie elementy lub teksty, ucięte teksty i przyciski,
- elementy wychodzące poza ekran lub kontener, poziome paski przewijania,
- rozjechany, niewyrównany lub złamany układ (kolumny, siatki, karty o różnej wysokości wyglądające na błąd),
- za mały lub nieczytelny tekst, zbyt mały kontrast tekstu do tła,
- zniekształcone, rozciągnięte lub źle przycięte obrazy,
- za małe lub zbyt ciasno ułożone przyciski i linki na urządzeniach dotykowych,
- niepotrzebnie duże puste przestrzenie, elementy przyklejone zasłaniające treść,
- problemy z nawigacją i nagłówkiem w tej rozdzielczości.
Nie oceniaj treści merytorycznej, języka ani estetyki projektu, jeśli układ działa poprawnie. Nie wymyślaj problemów — jeśli strona wygląda dobrze, zwróć pustą listę.
Odpowiadasz po polsku, wyłącznie poprawnym JSON-em.`;

export async function aiReview(
  cfg: AiConfig,
  scanDir: string,
  segments: string[],
  pageUrl: string,
  vp: ViewportDef,
  knownIssues: string[],
): Promise<Issue[]> {
  const parts: Part[] = [];
  for (const [i, file] of segments.entries()) {
    const buf = await readFile(path.join(scanDir, file));
    parts.push({ type: 'text', text: `Fragment ${i + 1} z ${segments.length}:` });
    parts.push({ type: 'image', base64: buf.toString('base64'), mediaType: 'image/jpeg' });
  }
  parts.push({
    type: 'text',
    text: `Strona: ${pageUrl}
Urządzenie: ${CATEGORY_LABELS[vp.category]} — ${vp.label}, szerokość ${vp.width} px.
Automatyczne testy już wykryły (nie powtarzaj ich, chyba że widzisz dodatkowy kontekst):
${knownIssues.length ? knownIssues.map((k) => `- ${k}`).join('\n') : '- brak'}

Zwróć JSON w formacie:
{"issues":[{"severity":"high|medium|low","title":"krótki tytuł","description":"co jest nie tak i jak to naprawić (1–3 zdania)","segment":1,"box":[x,y,szerokość,wysokość]}]}
"segment" to numer fragmentu (od 1). "box" to przybliżone położenie problemu w procentach (0–100) względem wymiarów tego fragmentu; pomiń, jeśli nie da się wskazać.
Maksymalnie 8 najważniejszych problemów.`,
  });

  const text = await call(cfg, REVIEW_SYSTEM, parts, 2500, true);
  const data = extractJson(text);
  const list: any[] = Array.isArray(data?.issues) ? data.issues : [];
  const segH = await segmentHeight(scanDir, segments[0], vp);
  return list.slice(0, 8).map((it) => {
    const sev: Severity = it.severity === 'high' || it.severity === 'critical' ? 'high' : it.severity === 'low' ? 'low' : 'medium';
    const title = String(it.title || 'Problem wizualny').slice(0, 120);
    const desc = String(it.description || '').slice(0, 600);
    const seg = Math.max(1, Math.min(segments.length, Number(it.segment) || 1));
    let rect;
    if (Array.isArray(it.box) && it.box.length === 4 && it.box.every((n: unknown) => typeof n === 'number')) {
      const [bx, by, bw, bh] = it.box as number[];
      rect = {
        x: Math.round((bx / 100) * vp.width),
        y: Math.round((seg - 1) * segH + (by / 100) * segH),
        width: Math.max(10, Math.round((bw / 100) * vp.width)),
        height: Math.max(10, Math.round((bh / 100) * segH)),
      };
    }
    return {
      ruleId: 'ai-visual',
      severity: sev,
      message: desc ? `${title}. ${desc}` : title,
      rect,
      cropFile: segments[seg - 1],
      key: title.toLowerCase().replace(/[^a-ząćęłńóśźż0-9]+/g, ' ').trim(),
      details: { title, description: desc, segment: seg },
    } satisfies Issue;
  });
}

async function segmentHeight(scanDir: string, file: string, vp: ViewportDef): Promise<number> {
  const buf = await readFile(path.join(scanDir, file));
  return imageSize(buf)?.height ?? vp.height;
}

const SUMMARY_SYSTEM = `Jesteś ekspertem od front-endu i responsywności stron. Na podstawie wyników automatycznego audytu RWD przygotowujesz zwięzłe podsumowanie dla zespołu software house'u.
Piszesz po polsku, w Markdown (nagłówki ###, listy, pogrubienia). Bez wstępów i grzeczności.`;

export async function aiSummary(
  cfg: AiConfig,
  input: { url: string; score: number; pages: number; viewports: string[]; groups: IssueGroup[] },
): Promise<string> {
  const top = input.groups.slice(0, 45).map((g) => ({
    waga: SEVERITY_LABELS[g.severity],
    typ: ruleMeta(g.ruleId).title,
    opis: g.message.slice(0, 220),
    element: g.selector,
    podstrony: g.pageCount,
    widoki: g.viewportIds.slice(0, 8),
    globalny: g.global,
  }));
  const text = `Witryna: ${input.url}
Wynik RWD: ${input.score}/100
Liczba podstron: ${input.pages}
Rozdzielczości: ${input.viewports.join(', ')}
Najważniejsze grupy problemów (JSON):
${JSON.stringify(top, null, 1)}

Przygotuj:
### Ocena ogólna
2–4 zdania o kondycji RWD strony.
### Priorytety
Lista max 6 najważniejszych rzeczy do poprawy, w kolejności. Przy każdej: czego dotyczy, gdzie występuje i konkretna wskazówka techniczna (CSS/HTML).
### Szybkie poprawki
Max 4 rzeczy, które da się poprawić w kilka minut.
### Uwagi
Ewentualne fałszywe alarmy lub rzeczy do ręcznej weryfikacji (krótko).`;
  return call(cfg, SUMMARY_SYSTEM, [{ type: 'text', text }], 2500);
}

export async function aiTest(cfg: AiConfig): Promise<string> {
  const reply = await call(cfg, 'Odpowiadaj jednym słowem.', [{ type: 'text', text: 'Napisz: OK' }], 20);
  return reply.trim();
}

export async function aiListModels(cfg: Omit<AiConfig, 'model'>): Promise<string[]> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    return (body.data || []).map((m: any) => m.id as string);
  }
  const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${cfg.apiKey}` } });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return (body.data || [])
    .map((m: any) => m.id as string)
    .filter((id: string) => /^(gpt-4o|gpt-4\.1|gpt-5|o\d)/.test(id))
    .sort();
}
