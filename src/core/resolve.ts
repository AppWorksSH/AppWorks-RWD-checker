import { createRequire } from 'node:module';
import path from 'node:path';

export const nodeRequire: NodeRequire =
  typeof require === 'function' ? require : createRequire(path.join(process.cwd(), 'index.js'));
