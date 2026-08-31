/**
 * Tauri derlemesinin ciktisini Masaustune kopyalar.
 *
 * `npm run build:desktop` zincirinin son halkasidir. Tauri iki cikti uretir:
 * calistirilabilir .exe (target/release) ve NSIS kurulum dosyasi
 * (target/release/bundle/nsis). Ikisi de bulunursa ikisi de kopyalanir.
 *
 * Kullanim:  node packaging/copy-desktop.mjs
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = join(ROOT, 'src-tauri', 'target', 'release');
const DESKTOP = join(homedir(), 'Desktop');
const OUT = join(DESKTOP, '3D Baski Maliyet (masaustu)');

/** Bir klasordeki .exe dosyalarini toplar (alt klasorlere inmez). */
function exesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.exe'))
    .map((name) => join(dir, name))
    .filter((full) => statSync(full).isFile());
}

const candidates = [
  ...exesIn(RELEASE).filter((p) => /baski/i.test(p)),
  ...exesIn(join(RELEASE, 'bundle', 'nsis')),
];

if (candidates.length === 0) {
  console.error('');
  console.error('  Tauri ciktisi bulunamadi.');
  console.error(`  Beklenen yer: ${RELEASE}`);
  console.error('  Once "npm run build && npx tauri build" calistirin.');
  console.error('');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

for (const source of candidates) {
  const target = join(OUT, source.split(/[\\/]/).pop());
  copyFileSync(source, target);
  const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`  kopyalandi: ${target}  (${mb} MB)`);
}

console.log('');
console.log(`> Masaustu klasoru hazir: ${OUT}`);
