/**
 * filamentParser.ts → server/filamentParser.mjs
 *
 * Node sunucusu TypeScript calistiramadigi icin ayristirici tek dosyada
 * bundle edilir. Kaynak degisince `npm run build` bunu yeniden uretir.
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(ROOT, 'src/lib/filamentParser.ts')],
  outfile: resolve(ROOT, 'server/filamentParser.mjs'),
  format: 'esm',
  platform: 'node',
  target: 'node18',
  bundle: true,
  logLevel: 'silent',
});

console.log('  server/filamentParser.mjs guncellendi');
