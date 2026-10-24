import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScanMeta, ScanResult } from './types';
import { bareHost } from './url';

export function makeScanId(url: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  let host = 'strona';
  try {
    host = bareHost(new URL(url).hostname).replace(/[^a-z0-9.-]/gi, '');
  } catch {
    /* zostaje domyślna nazwa */
  }
  return `${stamp}_${host}`;
}

export class ScanStore {
  constructor(public readonly baseDir: string) {}

  dir(id: string): string {
    return path.join(this.baseDir, id);
  }

  async ensure(id: string): Promise<void> {
    for (const sub of ['', 'tasks', 'sweeps', 'shots']) await mkdir(path.join(this.dir(id), sub), { recursive: true });
  }

  async write(id: string, name: string, data: unknown): Promise<void> {
    await writeFile(path.join(this.dir(id), name), JSON.stringify(data));
  }

  async read<T>(id: string, name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.dir(id), name), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  exists(id: string, name: string): boolean {
    return existsSync(path.join(this.dir(id), name));
  }

  async readAll<T>(id: string, sub: string): Promise<T[]> {
    const d = path.join(this.dir(id), sub);
    if (!existsSync(d)) return [];
    const files = (await readdir(d)).filter((f) => f.endsWith('.json'));
    const out: T[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await readFile(path.join(d, f), 'utf8')) as T);
      } catch {
        /* uszkodzony plik pomijamy */
      }
    }
    return out;
  }

  async list(): Promise<ScanMeta[]> {
    if (!existsSync(this.baseDir)) return [];
    const ids = await readdir(this.baseDir);
    const metas: ScanMeta[] = [];
    for (const id of ids) {
      const m = await this.read<ScanMeta>(id, 'meta.json');
      if (m) metas.push(m);
    }
    return metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async remove(id: string): Promise<void> {
    if (!id || id.includes('..') || id.includes('/')) throw new Error('Nieprawidłowy identyfikator skanu');
    await rm(this.dir(id), { recursive: true, force: true });
  }

  async findPrevious(host: string, beforeId: string): Promise<ScanResult | null> {
    const metas = await this.list();
    const prev = metas.find((m) => m.host === host && m.id < beforeId && m.status === 'completed');
    if (!prev) return null;
    return this.read<ScanResult>(prev.id, 'result.json');
  }
}
