import * as esbuild from 'esbuild';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const out = (p) => path.join(root, 'dist', p);
const src = (p) => path.join(root, 'src', p);

const nodeCommon = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'playwright-core', 'axe-core'],
  logLevel: 'info',
};

const builds = [
  { ...nodeCommon, entryPoints: [src('electron/main.ts')], outfile: out('main.js') },
  { ...nodeCommon, entryPoints: [src('electron/worker.ts')], outfile: out('worker.js') },
  { ...nodeCommon, entryPoints: [src('electron/preload.ts')], outfile: out('preload.js') },
  { ...nodeCommon, entryPoints: [src('electron/reportPreload.ts')], outfile: out('reportPreload.js') },
  {
    ...nodeCommon,
    entryPoints: [src('cli/index.ts')],
    outfile: out('cli.js'),
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    bundle: true,
    platform: 'browser',
    target: ['chrome130'],
    format: 'iife',
    sourcemap: true,
    entryPoints: [src('renderer/main.tsx')],
    outfile: out('renderer/main.js'),
    jsx: 'automatic',
    minify: !watch,
    loader: { '.css': 'css' },
    logLevel: 'info',
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  },
];

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
const selected = builds.filter((b) => !only || b.entryPoints[0].includes(only));

await mkdir(out('renderer'), { recursive: true });
if (!only) await copyFile(src('renderer/index.html'), out('renderer/index.html'));

if (watch) {
  const contexts = await Promise.all(selected.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Obserwuję zmiany…');
} else {
  await Promise.all(selected.map((b) => esbuild.build(b)));
  if (existsSync(out('cli.js'))) await chmod(out('cli.js'), 0o755);
}
