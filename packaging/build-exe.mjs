/**
 * Tek dosya .exe üreticisi (Node Single Executable Application).
 *
 * Hedef PC'de Node.js kurulu olmasını gerektirmeyen, arayüzü de içine gömülmüş
 * tek bir çalıştırılabilir dosya üretir.
 *
 * Sunucu mantığı server/server.mjs'ten TÜRETİLİR (kopyalanmaz): SEA yalnızca
 * CommonJS girdi kabul ettiği için import satırları require'a çevrilir ve
 * statik dosya sunumu, diskten okuma yerine gömülü varlıklardan okuyacak
 * biçimde değiştirilir. Böylece tek kaynak korunur.
 *
 * Kullanım:  node packaging/build-exe.mjs
 */

import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'packaging', 'build');
const APP_NAME = '3D Baski Maliyet.exe';

// ---------------------------------------------------------------------------
// 1. Gömülecek arayüz dosyalarını topla
// ---------------------------------------------------------------------------

/**
 * Windows SDK kurulumundaki en yeni signtool.exe'yi bulur.
 * PATH'e güvenmiyoruz: bulunamazsa Node'un imzası silinmeden kalır ve
 * postject sonrası exe imzalanamaz hale gelir (0x800700C1).
 */
function findSigntool() {
  const roots = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\Program Files (x86)', 'Windows Kits', '10', 'bin'),
    join(process.env['ProgramFiles'] ?? 'C:\Program Files', 'Windows Kits', '10', 'bin'),
  ];
  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, 'x64', 'signtool.exe');
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  found.sort();
  return found.at(-1) ?? 'signtool';
}

/**
 * Konsol penceresini gizler.
 *
 * Node bir konsol uygulamasidir; cift tiklandiginda arkada siyah bir komut
 * penceresi acilir. PE basligindaki Subsystem alani GUI (2) yapilinca bu
 * pencere hic olusmaz ve uygulama gercek bir masaustu uygulamasi gibi acilir.
 * Alan, hem PE32 hem PE32+ bicimlerinde optional header basindan 68 bayt
 * ilerdedir (onceki alanlarin boyut farklari birbirini goturur).
 */
function makeWindowsGui(exePath) {
  const buffer = readFileSync(exePath);
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('PE imzasi bulunamadi; exe bozuk olabilir.');
  }
  const optional = peOffset + 24;
  const magic = buffer.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new Error(`Bilinmeyen PE bicimi: 0x${magic.toString(16)}`);
  }
  const subsystemAt = optional + 68;
  if (buffer.readUInt16LE(subsystemAt) === 2) return false;
  buffer.writeUInt16LE(2, subsystemAt);
  writeFileSync(exePath, buffer);
  return true;
}

function collectAssets(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectAssets(full, base, out);
    else out[relative(base, full).replace(/\\/g, '/')] = full;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. server.mjs -> CommonJS + gömülü varlık sunumu
// ---------------------------------------------------------------------------

const SEA_REQUIRE = "const sea = require('node:sea');\n";

const SEA_STATIC = `async function serveStatic(pathname, res) {
  // Varlıklar exe'nin içine gömülüdür; dosya sistemi kullanılmaz. Anahtar
  // birebir eşleşmediği için dizin dışına çıkma riski de yoktur.
  let key = decodeURIComponent(pathname).replace(/^\\/+/, '');
  if (key === '') key = 'index.html';

  const send = (assetKey) => {
    let data;
    try {
      const raw = sea.getAsset(assetKey);
      if (!raw) return false;
      data = Buffer.from(raw);
    } catch {
      return false;
    }
    const ext = (0, import_node_path.extname)(assetKey).toLowerCase();
    const immutable = /-[A-Za-z0-9_]{8}\\./.test(assetKey);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': data.length,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
    return true;
  };

  if (send(key)) return;
  // Bilinmeyen yol -> tek sayfa uygulaması index.html'e düşer.
  if (send('index.html')) return;

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Arayüz bulunamadı.');
}`;

function applySeaPatches(source) {
  let out = source;

  // Gömülü varlık API'si — require bloğunun ardına ekle.
  const requireBlockEnd = out.indexOf('\n\n// server/filamentParser');
  if (requireBlockEnd === -1) throw new Error('esbuild çıktısında beklenen yapı bulunamadı.');
  out = out.slice(0, requireBlockEnd + 2) + SEA_REQUIRE + out.slice(requireBlockEnd + 2);

  // Disk yolları artık gereksiz (esbuild CJS biçimi).
  out = out.replace(
    /var ROOT = \(0, import_node_path\.resolve\)\([^;]+\);\nvar DIST = \(0, import_node_path\.join\)\(ROOT, "dist"\);\n/,
    '',
  );

  // Statik sunumu gömülü varlıklara çevir.
  const staticFn = out.match(/async function serveStatic\(pathname, res\) \{[\s\S]*?\n\}/);
  if (!staticFn) throw new Error('serveStatic işlevi bulunamadı.');
  out = out.replace(staticFn[0], SEA_STATIC);

  return out;
}

// ---------------------------------------------------------------------------
// 3. Derleme
// ---------------------------------------------------------------------------

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options });
}

function main() {
  if (!statSync(DIST, { throwIfNoEntry: false })) {
    throw new Error('dist/ yok. Önce "npm run build" çalıştırın.');
  }

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const assets = collectAssets(DIST);
  const assetCount = Object.keys(assets).length;
  console.log(`> ${assetCount} arayüz dosyası gömülecek`);

  buildSync({
    entryPoints: [join(ROOT, 'server', 'server.mjs')],
    outfile: join(WORK, 'server-raw.cjs'),
    format: 'cjs',
    platform: 'node',
    bundle: true,
    packages: 'external',
    logLevel: 'silent',
  });

  const entry = join(WORK, 'server.cjs');
  writeFileSync(
    entry,
    '// OTOMATIK URETILDI - kaynak: server/server.mjs\n' +
      applySeaPatches(readFileSync(join(WORK, 'server-raw.cjs'), 'utf8')),
    'utf8',
  );

  const configPath = join(WORK, 'sea-config.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: entry.replace(/\\/g, '/'),
        output: join(WORK, 'sea-prep.blob').replace(/\\/g, '/'),
        disableExperimentalSEAWarning: true,
        assets: Object.fromEntries(
          Object.entries(assets).map(([key, file]) => [key, file.replace(/\\/g, '/')]),
        ),
      },
      null,
      2,
    ),
    'utf8',
  );

  // Uretilen CJS bozuksa exe sessizce calismaz hale gelir; simdi yakalanir.
  try {
    execFileSync(process.execPath, ['--check', join(WORK, 'server.cjs')], { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Uretilen server.cjs gecersiz:\n${String(error?.stderr ?? error)}`);
  }

  console.log('> SEA veri bloğu üretiliyor…');
  run(process.execPath, ['--experimental-sea-config', configPath]);

  const exePath = join(WORK, APP_NAME);
  copyFileSync(process.execPath, exePath);

  console.log('> Node imzası kaldırılıyor (blob enjeksiyonu için gerekli)…');
  const signtool = findSigntool();
  try {
    run(signtool, ['remove', '/s', exePath], { stdio: 'pipe' });
  } catch (error) {
    // Kalan sertifika tablosu enjeksiyondan sonra exe'yi imzalanamaz yapar.
    throw new Error(
      `Node imzası kaldırılamadı (${signtool}). Windows SDK signtool gerekli.
${String(error)}`,
    );
  }

  console.log('> Uygulama exe içine enjekte ediliyor…');
  run(process.execPath, [
    join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js'),
    exePath,
    'NODE_SEA_BLOB',
    join(WORK, 'sea-prep.blob'),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ]);

  console.log('> Konsol penceresi gizleniyor (PE subsystem -> GUI)…');
  makeWindowsGui(exePath);

  const size = statSync(exePath).size;
  console.log(`\n> Hazır: ${exePath}`);
  console.log(`  Boyut: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

main();
