/**
 * 3D Baskı Maliyet Hesaplayıcı - yerel sunucu.
 *
 * - Derlenmis arayuzu (dist/) statik olarak sunar.
 * - /api/fetch   : verilen adresi indirip ham HTML döndürür (CORS aşma katmanı).
 * - /api/search  : arama motorundan aday sayfa adresleri toplar.
 * - /api/data    : uygulamanin tum verisi (tek kaynak, diskte JSON).
 * - /api/backup* : verinin diske yedeklenmesi ve geri okunmasi.
 * - /api/printer*: agdaki veya USB'ye bagli yazicilarla iletisim.
 * - /api/gcode*  : siparise bagli g-code dosyalarinin diskte saklanmasi.
 * - /api/pdf     : faturayi sistemdeki Chromium ile PDF'e cevirir.
 * - /api/slice   : STL'i kurulu dilimleyiciyle g-code'a cevirir.
 * - /api/webhook*: e-ticaret siparislerini kuyruga alir.
 * - /api/launch  : kullanicinin tanimladigi programi acar.
 *
 * Ayrıştırma bilinçli olarak arayüzde yapılır; böylece Tauri sürümüyle aynı
 * kod yolu kullanılır ve mantık tek yerde test edilir.
 *
 * Hicbir ucuncu parti bagimliligi yoktur; sadece Node standart kutuphanesi.
 */

import { createServer, request as httpRequest } from 'node:http';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { spawn } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { parseFilamentPage } from './filamentParser.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8787;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
/** Urun sayfalarinda fiyat/renk genelde ilk ~350 KB icindedir. */
const FETCH_BODY_LIMIT = 350 * 1024;
/**
 * Deneme basina zaman asimi (ms), kademeli artan.
 *
 * Hepsi ayni ve uzun oldugunda tek bir tutuk deneme kullaniciya 18 saniye
 * bekletiyordu; ucu birden basarisiz olunca 55 saniye. Ilk denemeyi kisa
 * tutmak, gecici bir takilmadan sonra ~6 saniyede toparlanmayi sagliyor.
 */
const FETCH_TIMEOUTS_MS = [6000, 10000, 15000];

/** Ayni adres kisa surede tekrar istenirse agdan degil bellekten doner. */
const PAGE_CACHE_MS = 90_000;
const PAGE_CACHE_MAX = 20;
const pageCache = new Map();
const FETCH_ATTEMPTS = FETCH_TIMEOUTS_MS.length;
const DNS_CACHE_MS = 5 * 60 * 1000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Guvenlik: yalnızca genel internet adreslerine istek at (SSRF koruması)
// ---------------------------------------------------------------------------

const dnsCache = new Map();

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(ip) {
  const value = ip.toLowerCase();
  return (
    value === '::1' ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe80') ||
    value.startsWith('::ffff:')
  );
}

async function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'Geçersiz adres. http:// veya https:// ile başlamalıdır.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Yalnızca http ve https adresleri desteklenir.');
  }

  const host = parsed.hostname;
  const direct = isIP(host);
  let addresses;
  if (direct) {
    addresses = [{ address: host, family: direct }];
  } else {
    const cached = dnsCache.get(host);
    if (cached && cached.expires > Date.now()) {
      addresses = cached.addresses;
    } else {
      try {
        addresses = await lookup(host, { all: true });
        dnsCache.set(host, { addresses, expires: Date.now() + DNS_CACHE_MS });
      } catch {
        throw new HttpError(502, `Alan adi çözümlenemedi: ${host}`);
      }
    }
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (isPrivate) {
      throw new HttpError(400, 'Yerel ag adreslerine istek yapılamaz.');
    }
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Uzak sayfa indirme
// ---------------------------------------------------------------------------

async function fetchPage(url, bodyLimit = FETCH_BODY_LIMIT) {
  await assertPublicUrl(url);

  // Ayni urunu tekrar eklemek ya da hatadan sonra yeniden denemek ag
  // gecikmesini bastan odemesin.
  const cacheKey = `${url}|${bodyLimit}`;
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PAGE_CACHE_MS) return cached.page;

  const attempt = (timeoutMs) =>
    fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
    });

  const retryableFetchError = (error) => {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
    const code = error?.cause?.code ?? error?.code ?? '';
    return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNABORTED'].includes(
      code,
    );
  };

  let response;
  let lastError;
  for (let tries = 0; tries < FETCH_ATTEMPTS; tries += 1) {
    try {
      response = await attempt(FETCH_TIMEOUTS_MS[tries]);
      break;
    } catch (error) {
      lastError = error;
      if (tries < FETCH_ATTEMPTS - 1 && retryableFetchError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (tries + 1)));
        continue;
      }
      break;
    }
  }

  if (!response) {
    const timedOut = lastError?.name === 'TimeoutError';
    throw new HttpError(
      504,
      timedOut
        ? 'Sayfa zamanında yanıt vermedi. Site yavaş olabilir; birazdan tekrar deneyin veya bilgileri elle girin.'
        : 'Sayfaya bağlanılamadı. Adresi ve internet bağlantınızı kontrol edip tekrar deneyin.',
    );
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      `Site ${response.status} yanıtı döndü. Sayfa bot koruması kullanıyor olabilir; bilgileri manuel girin.`,
    );
  }

  const type = response.headers.get('content-type') ?? '';
  if (type && !/text\/html|application\/xhtml|text\/plain|application\/json/i.test(type)) {
    throw new HttpError(415, `Desteklenmeyen içerik türü: ${type.split(';')[0]}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const limit = Math.min(bodyLimit, MAX_BODY_BYTES);
  const truncated = buffer.subarray(0, limit);

  // Basit karakter kodlamasi tespiti (Turkce siteler sik sik windows-1254 kullanir).
  const head = truncated.subarray(0, 4096).toString('latin1');
  const charsetMatch = head.match(/charset\s*=\s*["']?\s*([\w-]+)/i);
  const charset = (charsetMatch?.[1] ?? 'utf-8').toLowerCase();

  let html;
  try {
    const decoder = new TextDecoder(charset === 'iso-8859-9' ? 'windows-1254' : charset);
    html = decoder.decode(truncated);
  } catch {
    html = truncated.toString('utf-8');
  }

  const page = { html, finalUrl: response.url || url };

  pageCache.set(cacheKey, { at: Date.now(), page });
  // Bellek sinirli tutulur: en eski kayit dusurulur.
  if (pageCache.size > PAGE_CACHE_MAX) {
    pageCache.delete(pageCache.keys().next().value);
  }
  return page;
}

// ---------------------------------------------------------------------------
// API: yedekleme
// ---------------------------------------------------------------------------

/**
 * Yedekler her zaman kullanici profilinde tutulur. Boylece uygulama
 * tasinsa, silinse veya salt-okunur bir klasorden calissa bile yedekler
 * yerinde kalir ve yazma izni sorunu yasanmaz.
 */
const BACKUP_DIR = join(process.env.APPDATA || homedir(), '3D Baski Maliyet', 'yedekler');
const BACKUP_NAME = /^yedek-[\d-]+\.json$/;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
const KEEP_BACKUPS = 20;

/** Istek govdesini sinirli boyutta okur. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BACKUP_BYTES) throw new HttpError(413, 'Yedek verisi cok buyuk.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function listBackupFiles() {
  try {
    const names = (await readdir(BACKUP_DIR)).filter((name) => BACKUP_NAME.test(name));
    const files = [];
    for (const name of names.sort((a, b) => b.localeCompare(a))) {
      const info = await stat(join(BACKUP_DIR, name));
      files.push({ name, size: info.size, at: info.mtime.toISOString() });
    }
    return files;
  } catch {
    return [];
  }
}

async function handleBackupList(res) {
  sendJson(res, 200, { dir: BACKUP_DIR, files: await listBackupFiles() });
}

async function handleBackupWrite(req, res) {
  const body = await readBody(req);
  let name;
  try {
    const parsed = JSON.parse(body);
    name = typeof parsed?.name === 'string' ? parsed.name : null;
    if (!name || !BACKUP_NAME.test(name)) throw new Error('ad');
    if (!parsed?.snapshot) throw new Error('veri');
    await mkdir(BACKUP_DIR, { recursive: true });
    await writeFile(join(BACKUP_DIR, name), JSON.stringify(parsed.snapshot), 'utf-8');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Yedek yazılamadı: geçersiz istek.');
  }

  // Eskileri temizle.
  const files = await listBackupFiles();
  for (const file of files.slice(KEEP_BACKUPS)) {
    try {
      await unlink(join(BACKUP_DIR, file.name));
    } catch {
      // Silinemezse sorun degil, bir sonraki turda denenir.
    }
  }

  sendJson(res, 200, { name, dir: BACKUP_DIR, count: Math.min(files.length, KEEP_BACKUPS) });
}

async function handleBackupRead(name, res) {
  if (!BACKUP_NAME.test(name)) throw new HttpError(400, 'Gecersiz yedek adi.');
  try {
    const text = await readFile(join(BACKUP_DIR, name), 'utf-8');
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text);
  } catch {
    throw new HttpError(404, 'Yedek bulunamadi.');
  }
}

// ---------------------------------------------------------------------------
// API: ham sayfa indirme
// ---------------------------------------------------------------------------

async function handleFetch(url, res) {
  const { html, finalUrl } = await fetchPage(url, MAX_BODY_BYTES);
  sendJson(res, 200, { html, finalUrl });
}

async function handleFilament(url, res) {
  const { html, finalUrl } = await fetchPage(url);
  sendJson(res, 200, { ...parseFilamentPage(html, finalUrl), finalUrl });
}

// ---------------------------------------------------------------------------
// API: arama motoru adayları
// ---------------------------------------------------------------------------

/** DuckDuckGo HTML arayüzünden aday sonuç adreslerini toplar. */
async function handleSearch(query, limit, res) {
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { html } = await fetchPage(endpoint);
  const urls = [];

  for (const match of html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi)) {
    let href = match[1].replace(/&amp;/g, '&');
    const redirect = href.match(/[?&]uddg=([^&]+)/);
    if (redirect) href = decodeURIComponent(redirect[1]);
    if (/^https?:\/\//i.test(href) && !urls.includes(href)) urls.push(href);
    if (urls.length >= limit) break;
  }
  sendJson(res, 200, { urls });
}

// ---------------------------------------------------------------------------
// Statik dosya sunumu
// ---------------------------------------------------------------------------

// ------------------------------------------------------------ Yazicilar
/**
 * Yazici baglanti katmani.
 *
 * Tarayici LAN'daki bir cihaza dogrudan baglanamaz (CORS + karisik icerik),
 * bu yuzden istekler buradan gecirilir. Hangi adrese ne sorulacagi bilgisi
 * arayuzdeki `printerLink.ts` dosyasindadir; sunucu yalnizca verilen goreli
 * yola gider ve ham cevabi geri doner. Boylece protokol bilgisi tek yerde
 * durur ve donanim olmadan test edilebilir.
 */
const PRINTER_TIMEOUT_MS = 8000;
const PRINTER_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const SERIAL_IDLE_MS = 3 * 60 * 1000;
const SERIAL_LOG_LINES = 40;
const SERIAL_OK_TIMEOUT_MS = 30000;

/** Yaziciya gidecek taban adresi dogrular. */
function assertPrinterBase(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new HttpError(400, 'Yazıcı adresi geçersiz.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Yalnızca http/https adresleri desteklenir.');
  }
  if (url.username || url.password) throw new HttpError(400, 'Adreste kullanıcı bilgisi olamaz.');
  if (!url.hostname) throw new HttpError(400, 'Yazıcı adresi eksik.');
  return `${url.protocol}//${url.host}`;
}

/** Istemcinin verdigi yol ayni sunucuda goreli olmalidir. */
function assertPrinterPath(raw) {
  const path = String(raw ?? '');
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new HttpError(400, 'Yazıcı yolu "/" ile başlamalıdır.');
  }
  return path;
}

/** Basliklari suzer: satir sonu enjeksiyonuna izin verilmez. */
function safeHeaders(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (/^[A-Za-z0-9-]+$/.test(key) && typeof value === 'string' && !/[\r\n]/.test(value)) {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * Uygulama disindan gelen istekleri eler. Sunucu 127.0.0.1'e bagli olsa da
 * bu uclar keyfi bir adrese istek atabildigi icin ek bir kapi konur.
 */
function assertLocalOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const host = new URL(origin).hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return;
  } catch {
    // asagida reddedilir
  }
  throw new HttpError(403, 'Bu istek yalnızca uygulama içinden yapılabilir.');
}

function parseJsonParam(raw) {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

async function readJson(req) {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Geçersiz istek gövdesi.');
  }
}

function printerError(status) {
  if (status === 401 || status === 403) return 'API anahtarı reddedildi.';
  if (status === 404) return 'Yazıcı bu API ucunu tanımıyor. Bağlantı türünü kontrol edin.';
  if (status === 409) return 'Yazıcı meşgul; işlem şimdi yapılamıyor.';
  return `Yazıcı ${status} kodu döndürdü.`;
}

/** Ag hatasini kullanicinin anlayacagi bir cumleye cevirir. */
function networkMessage(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return 'Yazıcı zamanında cevap vermedi.';
  }
  const code = error?.cause?.code ?? error?.code ?? '';
  if (code === 'ECONNREFUSED') return 'Bağlantı reddedildi. Adres ve port doğru mu?';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH')
    return 'Yazıcıya ağ üzerinden ulaşılamıyor.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Adres çözümlenemedi.';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Bağlantı zaman aşımına uğradı.';
  }
  if (code === 'ECONNRESET') return 'Bağlantı yazıcı tarafından kesildi.';
  return 'Yazıcıya ulaşılamadı.';
}

async function printerFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
}

/** Durum sorgusu: istenen yollarin ham cevaplarini birlestirip doner. */
async function handlePrinterStatus(req, res) {
  const body = await readJson(req);
  const base = assertPrinterBase(body.base);
  const headers = safeHeaders(body.headers);
  const paths = Array.isArray(body.paths) ? body.paths.slice(0, 4) : [];
  if (paths.length === 0) throw new HttpError(400, 'Sorgu yolu verilmedi.');

  const payload = {};
  try {
    for (const item of paths) {
      const path = assertPrinterPath(item?.path);
      const response = await printerFetch(base + path, { headers }, PRINTER_TIMEOUT_MS);
      if (!response.ok) {
        sendJson(res, 200, {
          ok: false,
          status: response.status,
          error: printerError(response.status),
        });
        return;
      }
      const json = await response.json().catch(() => null);
      if (item.key) payload[item.key] = json;
      else Object.assign(payload, json ?? {});
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    sendJson(res, 200, { ok: false, error: networkMessage(error) });
    return;
  }
  sendJson(res, 200, { ok: true, payload });
}

/** Duraklat / devam et / iptal gibi komutlari iletir. */
async function handlePrinterCommand(req, res) {
  const body = await readJson(req);
  const base = assertPrinterBase(body.base);
  const path = assertPrinterPath(body.path);
  const init = { method: 'POST', headers: safeHeaders(body.headers) };
  if (body.body && typeof body.body === 'object') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body.body);
  } else {
    init.headers['Content-Length'] = '0';
  }

  try {
    const response = await printerFetch(base + path, init, PRINTER_TIMEOUT_MS);
    const textBody = await response.text().catch(() => '');
    sendJson(res, 200, {
      ok: response.ok,
      status: response.status,
      error: response.ok ? null : printerError(response.status),
      body: textBody.slice(0, 400),
    });
  } catch (error) {
    sendJson(res, 200, { ok: false, error: networkMessage(error) });
  }
}

/** Yazicilar dosya adinda yol veya tirnak kabul etmez. */
function safeUploadName(raw) {
  const parts = String(raw ?? '').split(/[\\/]/);
  const clean = (parts[parts.length - 1] ?? '').replace(/["'\r\n]/g, '').trim();
  if (!clean) return 'baski.gcode';
  return clean.slice(0, 120);
}

/**
 * G-code yuklemesi. Dosya bellege alinmadan yaziciya akitilir; boylece
 * yuzlerce megabaytlik dosyalar da gecebilir. Icerik uzunlugu onceden
 * bilindigi icin parcali (chunked) gonderim kullanilmaz - OctoPrint bunu
 * kabul etmez.
 */
async function handlePrinterUpload(req, res, url) {
  const base = assertPrinterBase(url.searchParams.get('base'));
  if (base.startsWith('https:')) {
    throw new HttpError(400, 'HTTPS üzerinden yükleme desteklenmiyor.');
  }
  const path = assertPrinterPath(url.searchParams.get('path'));
  const field = (url.searchParams.get('field') || 'file').replace(/[^A-Za-z0-9_-]/g, '') || 'file';
  const fields = parseJsonParam(url.searchParams.get('fields'));

  // Kaynak ya istegin govdesi ya da depodaki dosyadir. Depodan gonderirken
  // dosya tarayiciya hic ugramaz; diskten dogrudan yaziciya akar.
  const storedId = url.searchParams.get('gcodeId');
  let source;
  let size;
  let filename;
  if (storedId) {
    const id = assertGcodeId(storedId);
    const stats = await stat(gcodePath(id)).catch(() => null);
    if (!stats) throw new HttpError(404, 'Saklanan g-code bulunamadı.');
    const meta = await readGcodeMeta(id);
    size = stats.size;
    filename = safeUploadName(url.searchParams.get('filename') || meta?.name);
    source = createReadStream(gcodePath(id));
  } else {
    size = Number(url.searchParams.get('size'));
    filename = safeUploadName(url.searchParams.get('filename'));
    source = req;
  }
  if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Dosya boyutu geçersiz veya çok büyük.');
  }
  const headers = safeHeaders(parseJsonParam(url.searchParams.get('headers')));

  const boundary = '----p3dcc' + randomBytes(12).toString('hex');
  let head = '';
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) continue;
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';
  const tail = `\r\n--${boundary}--\r\n`;

  const target = new URL(base + path);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (source !== req) source.destroy();
      sendJson(res, 200, payload);
      resolve();
    };

    const outbound = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        path: target.pathname + target.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(Buffer.byteLength(head) + size + Buffer.byteLength(tail)),
        },
        timeout: PRINTER_UPLOAD_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          if (chunks.length < 20) chunks.push(chunk);
        });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          finish({
            ok,
            status,
            error: ok ? null : printerError(status),
            body: Buffer.concat(chunks).toString('utf-8').slice(0, 400),
          });
        });
      },
    );

    outbound.on('error', (error) => finish({ ok: false, error: networkMessage(error) }));
    outbound.on('timeout', () => {
      outbound.destroy();
      finish({ ok: false, error: 'Yükleme zaman aşımına uğradı.' });
    });

    let sent = 0;
    outbound.write(head);
    source.on('data', (chunk) => {
      if (settled) return;
      sent += chunk.length;
      if (sent > size) {
        outbound.destroy();
        finish({ ok: false, error: 'Dosya bildirilenden büyük geldi.' });
        return;
      }
      outbound.write(chunk);
    });
    source.on('end', () => {
      if (settled) return;
      if (sent !== size) {
        outbound.destroy();
        finish({ ok: false, error: 'Dosya eksik geldi; yükleme yarıda kesildi.' });
        return;
      }
      outbound.end(tail);
    });
    source.on('error', () => {
      outbound.destroy();
      finish({ ok: false, error: 'Dosya okunamadı.' });
    });
  });
}

// ------------------------------------------------------- G-code deposu
/**
 * Siparise bagli g-code dosyalari diskte saklanir.
 *
 * Tarayicinin yerel deposu (localStorage) yuz megabaytlik dosyalari tutamaz;
 * ayrica dosyayi yaziciya gonderirken tarayiciya geri indirmek bos yere ag
 * ve bellek harcar. Bu yuzden dosya bir kez buraya yazilir, sonra dogrudan
 * diskten yaziciya akitilir.
 *
 * Her dosya iki parcadir: <id>.gcode (icerik) ve <id>.json (ad, boyut, tarih).
 * Ortak bir dizin listesi tutulmaz; boylece es zamanli yazmada bozulma olmaz.
 */
const GCODE_DIR = join(process.env.APPDATA || homedir(), '3D Baski Maliyet', 'gcode');
const MAX_GCODE_BYTES = 512 * 1024 * 1024;

function assertGcodeId(raw) {
  const id = String(raw ?? '');
  if (!/^[0-9a-f]{24}$/.test(id)) throw new HttpError(400, 'Geçersiz dosya kimliği.');
  return id;
}

const gcodePath = (id) => join(GCODE_DIR, `${id}.gcode`);
const gcodeMetaPath = (id) => join(GCODE_DIR, `${id}.json`);

/** Yuklenen g-code'u diske alir ve kimligini doner. */
function handleGcodeSave(req, res, url) {
  const name = safeUploadName(url.searchParams.get('name'));
  const size = Number(url.searchParams.get('size'));
  if (!Number.isInteger(size) || size <= 0 || size > MAX_GCODE_BYTES) {
    throw new HttpError(400, 'Dosya boyutu geçersiz veya çok büyük.');
  }

  const id = randomBytes(12).toString('hex');
  return mkdir(GCODE_DIR, { recursive: true }).then(
    () =>
      new Promise((resolve) => {
        let settled = false;
        const finish = async (payload, cleanup) => {
          if (settled) return;
          settled = true;
          if (cleanup) await unlink(gcodePath(id)).catch(() => {});
          sendJson(res, payload.ok ? 200 : 400, payload);
          resolve();
        };

        const sink = createWriteStream(gcodePath(id));
        let written = 0;
        req.on('data', (chunk) => {
          written += chunk.length;
          if (written > size) {
            sink.destroy();
            void finish({ ok: false, error: 'Dosya bildirilenden büyük geldi.' }, true);
          }
        });
        req.on('error', () => {
          sink.destroy();
          void finish({ ok: false, error: 'Dosya okunamadı.' }, true);
        });
        req.pipe(sink);

        sink.on('error', () => void finish({ ok: false, error: 'Dosya yazılamadı.' }, true));
        sink.on('finish', async () => {
          if (settled) return;
          if (written !== size) {
            await finish({ ok: false, error: 'Dosya eksik geldi.' }, true);
            return;
          }
          const meta = { name, size: written, at: new Date().toISOString() };
          await writeFile(gcodeMetaPath(id), JSON.stringify(meta), 'utf-8').catch(() => {});
          await finish({ ok: true, id, ...meta });
        });
      }),
  );
}

async function readGcodeMeta(id) {
  try {
    const raw = await readFile(gcodeMetaPath(id), 'utf-8');
    const meta = JSON.parse(raw);
    return { name: safeUploadName(meta?.name), size: Number(meta?.size) || 0, at: meta?.at ?? '' };
  } catch {
    return null;
  }
}

/** Saklanan dosyayi ve bilgi kaydini siler. */
async function handleGcodeRemove(req, res) {
  const body = await readJson(req);
  const id = assertGcodeId(body.id);
  await unlink(gcodePath(id)).catch(() => {});
  await unlink(gcodeMetaPath(id)).catch(() => {});
  sendJson(res, 200, { ok: true });
}

/** Depodaki dosyalarin listesi (bakim ve yedek ekrani icin). */
async function handleGcodeList(res) {
  let names = [];
  try {
    names = await readdir(GCODE_DIR);
  } catch {
    sendJson(res, 200, { ok: true, dir: GCODE_DIR, files: [], totalBytes: 0 });
    return;
  }
  const files = [];
  let totalBytes = 0;
  for (const entry of names) {
    if (!entry.endsWith('.gcode')) continue;
    const id = entry.slice(0, -6);
    if (!/^[0-9a-f]{24}$/.test(id)) continue;
    const meta = await readGcodeMeta(id);
    let size = meta?.size ?? 0;
    if (!size) {
      size = await stat(gcodePath(id))
        .then((s) => s.size)
        .catch(() => 0);
    }
    totalBytes += size;
    files.push({ id, name: meta?.name ?? `${id}.gcode`, size, at: meta?.at ?? '' });
  }
  files.sort((a, b) => b.at.localeCompare(a.at));
  sendJson(res, 200, { ok: true, dir: GCODE_DIR, files, totalBytes });
}

// -------------------------------------------------------- Veri dosyasi
/**
 * Uygulamanin tek veri kaynagi.
 *
 * Veri eskiden yalnizca tarayicinin localStorage'inda dururdu. Bunun uc
 * sorunu vardi:
 *   1. Tarayici kipi ile kendi penceresi kipi AYRI profiller kullandigi icin
 *      iki ayri veri kumesi olusuyordu.
 *   2. localStorage adrese (port dahil) bagli oldugu icin port degisince
 *      kayitlar gorunmez oluyordu.
 *   3. Tarayici verisi temizlenince her sey siliniyordu.
 *
 * Artik tek kaynak burasi: %APPDATA%\3D Baski Maliyet\veri.json. Guncelleme
 * yapildiginda yalnizca dist/ ve exe degisir; bu dosyaya dokunulmaz.
 *
 * Yazma atomiktir: once .yeni dosyasina yazilir, sonra yeniden adlandirilir.
 * Boylece yazma sirasinda elektrik kesilse bile eldeki dosya bozulmaz. Bir
 * onceki surum de veri.onceki.json olarak saklanir.
 */
const DATA_DIR = join(process.env.APPDATA || homedir(), '3D Baski Maliyet');
const DATA_FILE = join(DATA_DIR, 'veri.json');
const DATA_PREV = join(DATA_DIR, 'veri.onceki.json');
const DATA_TEMP = join(DATA_DIR, 'veri.yeni.json');
const MAX_DATA_BYTES = 32 * 1024 * 1024;

/** Veri dosyasini okur. Dosya yoksa null doner (ilk acilis). */
async function handleDataRead(res) {
  try {
    const raw = await readFile(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    sendJson(res, 200, { ok: true, data, file: DATA_FILE });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      sendJson(res, 200, { ok: true, data: null, file: DATA_FILE });
      return;
    }
    // Dosya bozuksa bir onceki surumu denemek kullaniciyi kurtarir.
    try {
      const raw = await readFile(DATA_PREV, 'utf-8');
      sendJson(res, 200, {
        ok: true,
        data: JSON.parse(raw),
        file: DATA_PREV,
        recovered: true,
      });
    } catch {
      sendJson(res, 200, { ok: false, error: 'Veri dosyası okunamadı.', file: DATA_FILE });
    }
  }
}

/**
 * Yazmalari sıraya sokar.
 *
 * İki istek üst üste gelirse (ör. Ctrl+S ile anlik kayit, gecikmeli
 * otomatik kayitle çakışırsa) ikisi de ayni gecici dosyayi kullanirdi;
 * biri diğerinin içeriğini yeniden adlandirmadan önce ezer ve "basarili"
 * yanit alan istegin verisi diske hiç yazilmamis olurdu. Kuyruk bu
 * çakışmayı önler; her yazma bir öncekinin tamamen bitmesini bekler.
 */
let writeQueue = Promise.resolve();

/** Tum veriyi atomik olarak diske yazar. */
async function handleDataWrite(req, res) {
  const raw = await readBody(req);
  if (raw.length > MAX_DATA_BYTES) throw new HttpError(413, 'Veri çok büyük.');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Geçersiz veri gövdesi.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Veri bir nesne olmalıdır.');
  }

  const task = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DATA_TEMP, JSON.stringify(parsed), 'utf-8');
    // Eldeki dosyayi yedekle, sonra yenisini yerine koy.
    await rename(DATA_FILE, DATA_PREV).catch(() => {});
    await rename(DATA_TEMP, DATA_FILE);
  });
  // Sıradaki yazma, bu istek çökse bile bekletilmeye devam etsin.
  writeQueue = task.catch(() => {});
  await task;

  sendJson(res, 200, { ok: true, file: DATA_FILE, size: Buffer.byteLength(raw) });
}

// ------------------------------------------------------------ PDF cikti
/**
 * Fatura PDF'i uretimi.
 *
 * Ucuncu parti bir PDF kutuphanesi (jsPDF/html2canvas) KULLANILMAZ. Sebep:
 * jsPDF'in gomulu yazi tipleri Turkce harfleri (s, g, i, c, o, u) tasimaz,
 * duzgun cikti icin ~300 KB'lik bir TTF gomulmesi gerekir; html2canvas ise
 * yaziyi resme cevirdigi icin bulanik ve aranamaz PDF uretir.
 *
 * Bunun yerine sistemde zaten kurulu olan Chromium motorunun yazdirma
 * cekirdegi kullanilir: metin vektorel kalir, Turkce sorunsuzdur, uygulamaya
 * tek bayt eklenmez ve cikti tarayicidan basilanla birebir aynidir.
 */
const PDF_DIR = join(homedir(), 'Documents', '3D Baski Maliyet', 'Faturalar');
const PDF_TIMEOUT_MS = 90000;

/** Dosya adini guvenli hale getirir ve .pdf uzantisini garantiler. */
function safePdfName(raw) {
  const parts = String(raw ?? '').split(/[\\/]/);
  let clean = (parts[parts.length - 1] ?? '')
    .replace(/["'\r\n:*?<>|]/g, '')
    .trim()
    .slice(0, 120);
  if (!clean) clean = 'fatura';
  return clean.toLowerCase().endsWith('.pdf') ? clean : `${clean}.pdf`;
}

/** Ayni adda dosya varsa sonuna (2), (3) ekler. */
async function uniquePath(dir, fileName) {
  const dot = fileName.lastIndexOf('.');
  const stem = fileName.slice(0, dot);
  const ext = fileName.slice(dot);
  for (let index = 0; index < 200; index += 1) {
    const candidate = join(dir, index === 0 ? fileName : `${stem} (${index + 1})${ext}`);
    const exists = await stat(candidate).then(
      () => true,
      () => false,
    );
    if (!exists) return candidate;
  }
  return join(dir, `${stem}-${randomBytes(4).toString('hex')}${ext}`);
}

/**
 * Gonderilen HTML'i PDF'e cevirip diske yazar.
 * Govde: yazdirilacak tam HTML belgesi. Cevap: kaydedilen dosyanin yolu.
 */
async function handlePdfExport(req, res, url) {
  const engine = findBrowserEngine();
  if (!engine) {
    sendJson(res, 200, {
      ok: false,
      error:
        'PDF için Edge veya Chrome gerekli; bulunamadı. Fatura ekranındaki "Yazdır" ile PDF olarak kaydedebilirsiniz.',
    });
    return;
  }

  const html = await readBody(req);
  if (!html.trim()) throw new HttpError(400, 'Yazdırılacak içerik boş.');

  await mkdir(PDF_DIR, { recursive: true });
  const target = await uniquePath(PDF_DIR, safePdfName(url.searchParams.get('name')));
  const tempHtml = join(tmpdir(), `p3dcc-fatura-${randomBytes(8).toString('hex')}.html`);
  await writeFile(tempHtml, html, 'utf-8');

  try {
    await runCommand(
      engine,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${join(tmpdir(), `p3dcc-pdf-${randomBytes(6).toString('hex')}`)}`,
        // Yazi tipleri ve duzen otursun diye kisa bir sanal sure taninir.
        '--virtual-time-budget=4000',
        '--no-pdf-header-footer',
        `--print-to-pdf=${target}`,
        pathToFileURL(tempHtml).href,
      ],
      PDF_TIMEOUT_MS,
    );
  } catch (error) {
    await unlink(tempHtml).catch(() => {});
    sendJson(res, 200, {
      ok: false,
      error: `PDF üretilemedi: ${String(error?.message ?? error).slice(0, 200)}`,
    });
    return;
  }

  await unlink(tempHtml).catch(() => {});

  const info = await stat(target).catch(() => null);
  if (!info || info.size === 0) {
    sendJson(res, 200, { ok: false, error: 'PDF oluşturuldu ama dosya boş çıktı.' });
    return;
  }

  sendJson(res, 200, { ok: true, path: target, dir: PDF_DIR, size: info.size });
}

/** Kaydedilen PDF'i Dosya Gezgini'nde secili olarak gosterir. */
async function handlePdfReveal(req, res) {
  const body = await readJson(req);
  const target = String(body.path ?? '');
  // Yalnizca kendi cikti klasorumuzdeki dosyalar acilabilir.
  const normalized = resolve(target);
  if (!normalized.startsWith(resolve(PDF_DIR))) {
    throw new HttpError(400, 'Bu dosya uygulamanın fatura klasöründe değil.');
  }
  const exists = await stat(normalized).then(
    () => true,
    () => false,
  );
  if (!exists) throw new HttpError(404, 'Dosya bulunamadı.');

  if (process.platform === 'win32') {
    spawn('explorer', ['/select,', normalized], { detached: true, stdio: 'ignore' }).unref();
  }
  sendJson(res, 200, { ok: true });
}

// ------------------------------------------------------- Dilimleyici (CLI)
/**
 * STL -> G-code dilimleme.
 *
 * Sistemde kurulu PrusaSlicer / OrcaSlicer / Bambu Studio / CuraEngine
 * konsol surumu aranir ve sessiz kipte calistirilir. Uretilen g-code
 * dogrudan g-code deposuna alinir, boylece siparise baglanip yaziciya
 * gonderilebilir.
 *
 * NOT: Bu makinede kurulu dilimleyici bulunmadigi icin akis gercek bir
 * dilimleyiciyle DOGRULANAMADI. Bulunamama ve hata durumlari kullaniciya
 * anlasilir mesajla doner; sunucu hicbir kosulda dusmez.
 */
const SLICER_CANDIDATES = [
  {
    id: 'prusaslicer',
    label: 'PrusaSlicer',
    relatives: [
      join('Prusa3D', 'PrusaSlicer', 'prusa-slicer-console.exe'),
      join('Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe'),
    ],
    args: (input, output) => ['--export-gcode', '--loglevel', '1', '-o', output, input],
  },
  {
    id: 'orcaslicer',
    label: 'OrcaSlicer',
    relatives: [join('OrcaSlicer', 'orca-slicer.exe')],
    args: (input, output) => ['--export-3mf=' + output, '--slice', '0', input],
  },
  {
    id: 'bambustudio',
    label: 'Bambu Studio',
    relatives: [join('Bambu Studio', 'bambu-studio.exe')],
    args: (input, output) => ['--export-gcode', '-o', output, input],
  },
  {
    id: 'curaengine',
    label: 'CuraEngine',
    relatives: [
      join('Ultimaker Cura 5.7', 'CuraEngine.exe'),
      join('UltiMaker Cura 5.7.0', 'CuraEngine.exe'),
      join('Ultimaker Cura', 'CuraEngine.exe'),
    ],
    args: (input, output) => ['slice', '-v', '-o', output, '-l', input],
  },
];

/** Kurulu dilimleyicileri bulur. */
function findSlicers() {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .map((root) => join(root, 'Programs'))
    .concat([process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean));

  const found = [];
  for (const candidate of SLICER_CANDIDATES) {
    for (const relative of candidate.relatives) {
      for (const root of roots) {
        const full = join(root, relative);
        if (existsSync(full)) {
          found.push({ id: candidate.id, label: candidate.label, path: full });
          break;
        }
      }
      if (found.some((entry) => entry.id === candidate.id)) break;
    }
  }
  return found;
}

/** STL'i dilimleyip uretilen g-code'u depoya alir. */
function handleSlice(req, res, url) {
  const slicers = findSlicers();
  const wanted = url.searchParams.get('slicer');
  const slicer = wanted ? slicers.find((entry) => entry.id === wanted) : slicers[0];
  if (!slicer) {
    sendJson(res, 200, {
      ok: false,
      error:
        'Kurulu dilimleyici bulunamadı. PrusaSlicer, OrcaSlicer, Bambu Studio veya Cura kurun.',
    });
    return Promise.resolve();
  }

  const spec = SLICER_CANDIDATES.find((entry) => entry.id === slicer.id);
  const size = Number(url.searchParams.get('size'));
  if (!Number.isInteger(size) || size <= 0 || size > MAX_GCODE_BYTES) {
    throw new HttpError(400, 'Dosya boyutu geçersiz veya çok büyük.');
  }
  const name = safeUploadName(url.searchParams.get('name') || 'model.stl');
  const stamp = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `p3dcc-${stamp}.stl`);
  const outputPath = join(tmpdir(), `p3dcc-${stamp}.gcode`);

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      await unlink(inputPath).catch(() => {});
      sendJson(res, 200, payload);
      resolve();
    };

    const sink = createWriteStream(inputPath);
    let written = 0;
    req.on('data', (chunk) => {
      written += chunk.length;
      if (written > size) {
        sink.destroy();
        void finish({ ok: false, error: 'Dosya bildirilenden büyük geldi.' });
      }
    });
    req.on('error', () => {
      sink.destroy();
      void finish({ ok: false, error: 'Dosya okunamadı.' });
    });
    req.pipe(sink);

    sink.on('error', () => void finish({ ok: false, error: 'Geçici dosya yazılamadı.' }));
    sink.on('finish', async () => {
      if (settled) return;
      try {
        await runCommand(slicer.path, spec.args(inputPath, outputPath), 10 * 60 * 1000);
      } catch (error) {
        await finish({
          ok: false,
          error: `${slicer.label} dilimleme yapamadı: ${String(error?.message ?? error).slice(0, 200)}`,
        });
        return;
      }

      const info = await stat(outputPath).catch(() => null);
      if (!info || info.size === 0) {
        await finish({ ok: false, error: `${slicer.label} çıktı üretmedi.` });
        return;
      }

      // Uretilen g-code'u kalici depoya al.
      const id = randomBytes(12).toString('hex');
      await mkdir(GCODE_DIR, { recursive: true });
      const gcodeName = name.replace(/\.stl$/i, '') + '.gcode';
      await copyFile(outputPath, gcodePath(id)).catch(() => {});
      await writeFile(
        gcodeMetaPath(id),
        JSON.stringify({ name: gcodeName, size: info.size, at: new Date().toISOString() }),
        'utf-8',
      ).catch(() => {});
      await unlink(outputPath).catch(() => {});

      await finish({ ok: true, id, name: gcodeName, size: info.size, slicer: slicer.label });
    });
  });
}

// --------------------------------------------------- E-ticaret siparis ucu
/**
 * Disaridan siparis kabul eden uc (Shopify / Etsy / Shopier webhook'lari).
 *
 * Gelen istekler diskte bir kuyruga yazilir; arayuz kuyrugu okuyup
 * "Siparisler" sekmesine dusurur.
 *
 * SINIR: sunucu yalnizca 127.0.0.1'e baglidir. Gercek bir webhook'un
 * ulasabilmesi icin cloudflared/ngrok gibi bir tunel gerekir; aksi halde
 * bu uc yalnizca ayni bilgisayardan cagrilabilir. Paylasilan gizli anahtar
 * (WEBHOOK_TOKEN) tanimliysa dogrulanir.
 */
const INBOX_FILE = join(DATA_DIR, 'gelen-siparisler.json');
const MAX_INBOX = 200;

async function readInbox() {
  try {
    const raw = await readFile(INBOX_FILE, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeInbox(list) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(INBOX_FILE, JSON.stringify(list.slice(-MAX_INBOX)), 'utf-8');
}

/** Gelen webhook'u normalize edip kuyruga ekler. */
async function handleWebhookOrder(req, res, url) {
  const expected = process.env.WEBHOOK_TOKEN;
  if (expected) {
    const given = url.searchParams.get('token') || req.headers['x-webhook-token'];
    if (given !== expected) throw new HttpError(403, 'Gecersiz webhook anahtari.');
  }

  const body = await readJson(req);
  const source = String(url.searchParams.get('source') || body.source || 'webhook').slice(0, 40);

  const items = Array.isArray(body.items) ? body.items : [];
  const entry = {
    id: randomBytes(8).toString('hex'),
    source,
    receivedAt: new Date().toISOString(),
    externalId: String(body.id ?? body.order_id ?? body.orderId ?? '').slice(0, 80),
    customer: String(body.customer ?? body.customer_name ?? body.buyer ?? body.name ?? '').slice(
      0,
      120,
    ),
    phone: String(body.phone ?? body.customer_phone ?? '').slice(0, 40),
    email: String(body.email ?? body.customer_email ?? '').slice(0, 120),
    note: String(body.note ?? body.notes ?? '').slice(0, 400),
    items: items.slice(0, 50).map((item) => ({
      name: String(item?.name ?? item?.title ?? 'Ürün').slice(0, 120),
      quantity: Math.max(1, Math.round(Number(item?.quantity ?? item?.qty ?? 1)) || 1),
      unitPrice: Number(item?.price ?? item?.unitPrice ?? 0) || 0,
    })),
    handled: false,
  };

  const inbox = await readInbox();
  inbox.push(entry);
  await writeInbox(inbox);
  sendJson(res, 200, { ok: true, id: entry.id });
}

/** Arayuzun kuyrugu okumasi ve isaretlemesi. */
async function handleInbox(req, res) {
  if (req.method === 'GET') {
    const inbox = await readInbox();
    sendJson(res, 200, {
      ok: true,
      pending: inbox.filter((entry) => !entry.handled),
      file: INBOX_FILE,
      listening: `http://${HOST}:${PORT}/api/webhook/order`,
      tokenSet: Boolean(process.env.WEBHOOK_TOKEN),
    });
    return;
  }

  const body = await readJson(req);
  const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
  const inbox = await readInbox();
  for (const entry of inbox) if (ids.has(entry.id)) entry.handled = true;
  await writeInbox(inbox);
  sendJson(res, 200, { ok: true });
}

// ------------------------------------------------ Yerel uygulama baslatici
/**
 * Kullanicinin tanimladigi programi acar (Cura, Blender, Fusion...).
 *
 * Yol yalnizca kullanicinin ayarlarda kaydettigi degerden gelir; sayfadan
 * ARGUMAN GECIRILMEZ. Bu bilincli bir sinirlamadir: argüman kabul etmek,
 * arayuze sizan bir metnin komut satirina donusmesi anlamina gelirdi.
 */
async function handleLaunch(req, res) {
  const body = await readJson(req);
  const target = String(body.path ?? '').trim();
  if (!target) throw new HttpError(400, 'Program yolu gerekli.');

  const resolved = resolve(target);
  if (!/\.(exe|lnk)$/i.test(resolved)) {
    throw new HttpError(400, 'Yalnızca .exe ve .lnk dosyaları açılabilir.');
  }
  const info = await stat(resolved).catch(() => null);
  if (!info || !info.isFile()) throw new HttpError(404, 'Program bulunamadı.');

  try {
    if (resolved.toLowerCase().endsWith('.lnk')) {
      spawn('cmd', ['/c', 'start', '""', resolved], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(resolved, [], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    throw new HttpError(500, `Program başlatılamadı: ${String(error?.message ?? error)}`);
  }
  sendJson(res, 200, { ok: true });
}

// --------------------------------------------------------- Seri port (USB)
/**
 * Marlin uyumlu yazicilar icin USB seri baglanti. Windows'ta seri port bir
 * dosya gibi acilabildigi icin ek bir pakete gerek yoktur: once `mode` ile
 * hiz/parite ayarlanir, sonra `\\.\COMx` aygiti okuma-yazma acilir.
 *
 * Baglanti kalicidir: her sorguda acilip kapansaydi kart yeniden baslar ve
 * suren baski iptal olurdu. Oturum bir sure kullanilmazsa kendi kapanir.
 *
 * DENEYSEL: burasi gercek donanim olmadan dogrulanamaz. Her hata yakalanir ve
 * arayuze "baglanilamadi" olarak doner; sunucu asla dusmez.
 */
const serialSessions = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Harici bir komutu calistirip ciktisini toplar. */
function runCommand(command, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} zaman aşımına uğradı.`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString('utf-8');
    });
    child.stderr?.on('data', (chunk) => {
      err += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `${command} ${code} kodu ile bitti.`));
    });
  });
}

/** Sistemde tanimli COM portlarini listeler. */
async function listSerialPorts() {
  if (process.platform !== 'win32') return [];
  try {
    const out = await runCommand('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM']);
    const found = [...out.matchAll(/REG_SZ\s+(COM\d{1,3})/g)].map((m) => m[1]);
    return [...new Set(found)].sort();
  } catch {
    return [];
  }
}

function assertSerialName(raw) {
  const clean = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (!/^COM\d{1,3}$/.test(clean)) {
    throw new HttpError(400, 'Seri port adı COM3 gibi olmalıdır.');
  }
  return clean;
}

/** Gelen satiri bekleyen komutlara dagitir. */
function pushSerialLine(session, line) {
  session.lines.push(line);
  if (session.lines.length > SERIAL_LOG_LINES) session.lines.shift();

  if (/^(ok|done saving file)/i.test(line)) {
    const waiter = session.waiters.shift();
    waiter?.resolve(line);
  } else if (/^(error|!!)/i.test(line)) {
    session.error = line.slice(0, 200);
    const waiter = session.waiters.shift();
    waiter?.reject(new Error(line.slice(0, 200)));
  } else if (/^echo:busy/i.test(line)) {
    // Yazici mesgul: bekleyenin sayaci yenilenir.
    for (const waiter of session.waiters) waiter.touch();
  }
}

async function readSerialLoop(session) {
  const buffer = Buffer.alloc(4096);
  while (!session.closed) {
    let bytesRead = 0;
    try {
      const result = await session.handle.read(buffer, 0, buffer.length, null);
      bytesRead = result.bytesRead;
    } catch (error) {
      if (!session.closed) session.error = String(error?.message ?? error);
      break;
    }
    if (bytesRead === 0) {
      await delay(60);
      continue;
    }
    session.carry += buffer.subarray(0, bytesRead).toString('ascii');
    const parts = session.carry.split(/\r?\n/);
    session.carry = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (line) pushSerialLine(session, line);
    }
  }
  session.closed = true;
  for (const waiter of session.waiters.splice(0)) {
    waiter.reject(new Error('Seri bağlantı kapandı.'));
  }
}

async function openSerial(name, baudRate) {
  if (process.platform !== 'win32') {
    throw new HttpError(400, 'Seri bağlantı yalnızca Windows üzerinde desteklenir.');
  }
  const rate = Number(baudRate) || 115200;
  const existing = serialSessions.get(name);
  if (existing && !existing.closed && existing.baudRate === rate) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) await closeSerial(name);

  try {
    await runCommand('mode', [
      `${name}:`,
      `BAUD=${rate}`,
      'PARITY=n',
      'DATA=8',
      'STOP=1',
      'to=on',
      'xon=off',
      'odsr=off',
      'octs=off',
      'dtr=on',
      'rts=on',
      'idsr=off',
    ]);
  } catch (error) {
    throw new HttpError(502, `Seri port ayarlanamadı: ${String(error?.message ?? error)}`);
  }

  let handle;
  try {
    handle = await open(`\\\\.\\${name}`, 'r+');
  } catch {
    throw new HttpError(502, `${name} açılamadı. Başka bir program kullanıyor olabilir.`);
  }

  const session = {
    name,
    baudRate: rate,
    handle,
    lines: [],
    carry: '',
    waiters: [],
    closed: false,
    error: null,
    streaming: false,
    streamProgress: 0,
    jobName: null,
    abort: false,
    lastUsed: Date.now(),
  };
  serialSessions.set(name, session);
  readSerialLoop(session).catch(() => {
    session.closed = true;
  });
  return session;
}

async function closeSerial(name) {
  const session = serialSessions.get(name);
  if (!session) return;
  session.closed = true;
  session.abort = true;
  serialSessions.delete(name);
  await session.handle.close().catch(() => {});
}

async function writeSerial(session, line) {
  session.lastUsed = Date.now();
  await session.handle.write(Buffer.from(`${line}\n`, 'ascii'));
}

/** Yazicidan "ok" gelene kadar bekler; mesgul mesajlari sureyi uzatir. */
function waitForOk(session, timeoutMs = SERIAL_OK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const entry = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      touch: () => {
        clearTimeout(timer);
        timer = setTimeout(fail, timeoutMs);
      },
    };
    const fail = () => {
      const index = session.waiters.indexOf(entry);
      if (index >= 0) session.waiters.splice(index, 1);
      reject(new Error('Yazıcı "ok" cevabı vermedi.'));
    };
    timer = setTimeout(fail, timeoutMs);
    session.waiters.push(entry);
  });
}

/** Sirayla G-code satirlarini gonderir, her birinde "ok" bekler. */
async function sendSerialLines(session, lines) {
  for (const line of lines) {
    if (session.closed) throw new HttpError(502, 'Seri bağlantı kapalı.');
    await writeSerial(session, line);
    await waitForOk(session).catch(() => null);
  }
}

/**
 * Bir G-code dosyasini satir satir yaziciya akitir. Yazicinin tamponu
 * tasmasin diye her satirda "ok" beklenir (Pronterface'in yaptigi gibi).
 */
async function streamGcodeToSerial(session, filePath, jobName) {
  session.streaming = true;
  session.streamProgress = 0;
  session.jobName = jobName;
  session.abort = false;
  session.error = null;
  try {
    const total = (await stat(filePath)).size;
    let done = 0;
    let carry = '';
    const stream = createReadStream(filePath, { encoding: 'ascii', highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      if (session.closed || session.abort) break;
      carry += chunk;
      const parts = carry.split(/\r?\n/);
      carry = parts.pop() ?? '';
      for (const raw of parts) {
        done += raw.length + 1;
        if (session.closed || session.abort) break;
        const line = raw.replace(/;.*$/, '').trim();
        if (!line) continue;
        await writeSerial(session, line);
        await waitForOk(session);
        session.streamProgress = total > 0 ? done / total : 0;
      }
    }
    if (!session.abort && !session.closed) session.streamProgress = 1;
  } catch (error) {
    session.error = String(error?.message ?? error).slice(0, 200);
  } finally {
    session.streaming = false;
    session.abort = false;
    await unlink(filePath).catch(() => {});
  }
}

/** Uzun sure kullanilmayan baglantilari kapatir. */
function sweepSerialSessions() {
  const now = Date.now();
  for (const [name, session] of serialSessions) {
    if (session.streaming) continue;
    if (now - session.lastUsed > SERIAL_IDLE_MS) closeSerial(name).catch(() => {});
  }
}

/** Seri baglanti uclari: durum, komut, baglantiyi kapatma. */
async function handleSerial(req, res) {
  const body = await readJson(req);
  const action = String(body.action ?? 'status');

  if (action === 'close') {
    await closeSerial(assertSerialName(body.path));
    sendJson(res, 200, { ok: true });
    return;
  }

  const name = assertSerialName(body.path);
  let session;
  try {
    session = await openSerial(name, body.baudRate);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, 200, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 200, { ok: false, error: networkMessage(error) });
    return;
  }

  try {
    if (action === 'gcode') {
      const lines = Array.isArray(body.gcode)
        ? body.gcode.filter((l) => typeof l === 'string' && !/[\r\n]/.test(l)).slice(0, 50)
        : [];
      if (lines.some((l) => /^M524/i.test(l))) session.abort = true;
      await sendSerialLines(session, lines);
    } else if (!session.streaming) {
      // M105: sicakliklar, M27: SD baskisinin ilerlemesi.
      await sendSerialLines(session, ['M105', 'M27']);
    }
  } catch (error) {
    sendJson(res, 200, { ok: false, error: String(error?.message ?? error).slice(0, 200) });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    payload: {
      lines: session.lines.slice(-SERIAL_LOG_LINES),
      streaming: session.streaming,
      streamProgress: session.streamProgress,
      jobName: session.jobName,
      error: session.error,
    },
  });
}

/** G-code dosyasini gecici klasore alip seri porta akitmaya baslar. */
function handleSerialUpload(req, res, url) {
  const name = assertSerialName(url.searchParams.get('path'));
  const baudRate = Number(url.searchParams.get('baudRate')) || 115200;
  const filename = safeUploadName(url.searchParams.get('filename'));
  const size = Number(url.searchParams.get('size'));
  if (!Number.isInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'Dosya boyutu geçersiz veya çok büyük.');
  }

  const tempPath = join(tmpdir(), `p3dcc-${randomBytes(8).toString('hex')}.gcode`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      sendJson(res, 200, payload);
      resolve();
    };

    const sink = createWriteStream(tempPath);
    let written = 0;
    req.on('data', (chunk) => {
      written += chunk.length;
      if (written > size) {
        sink.destroy();
        finish({ ok: false, error: 'Dosya bildirilenden büyük geldi.' });
      }
    });
    req.on('error', () => {
      sink.destroy();
      finish({ ok: false, error: 'Dosya okunamadı.' });
    });
    req.pipe(sink);

    sink.on('error', () => finish({ ok: false, error: 'Geçici dosya yazılamadı.' }));
    sink.on('finish', async () => {
      if (settled) {
        await unlink(tempPath).catch(() => {});
        return;
      }
      let session;
      try {
        session = await openSerial(name, baudRate);
      } catch (error) {
        await unlink(tempPath).catch(() => {});
        finish({ ok: false, error: error?.message ?? 'Seri port açılamadı.' });
        return;
      }
      if (session.streaming) {
        await unlink(tempPath).catch(() => {});
        finish({ ok: false, error: 'Bu porta zaten bir baskı gönderiliyor.' });
        return;
      }
      // Akitma arka planda surer; arayuz ilerlemeyi durum sorgusundan okur.
      streamGcodeToSerial(session, tempPath, filename).catch(() => {});
      finish({ ok: true, streaming: true });
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(pathname, res) {
  const decoded = decodeURIComponent(pathname);
  const safePath = normalize(decoded).replace(/^([/\\])+/, '');
  const filePath = join(DIST, safePath);

  // Dizin disina cikisi engelle.
  if (!filePath.startsWith(DIST + sep) && filePath !== DIST) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isFile()) {
      const ext = extname(filePath).toLowerCase();
      const immutable = /-[A-Za-z0-9_]{8}\./.test(filePath);
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      createReadStream(filePath).pipe(res);
      return;
    }
  } catch {
    // Dosya yok - SPA fallback'e dus.
  }

  try {
    const html = await readFile(join(DIST, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
    res.end(html);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Arayüz bulunamadı. Once "npm run build" çalıştırın.');
  }
}

// ---------------------------------------------------------------------------
// HTTP sunucusu
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`);

  const isWrite =
    req.method === 'POST' &&
    (url.pathname === '/api/backup' ||
      url.pathname.startsWith('/api/printer/') ||
      url.pathname.startsWith('/api/gcode/') ||
      url.pathname === '/api/pdf' ||
      url.pathname === '/api/pdf/reveal' ||
      url.pathname === '/api/data' ||
      url.pathname === '/api/slice' ||
      url.pathname === '/api/webhook/order' ||
      url.pathname === '/api/inbox' ||
      url.pathname === '/api/launch');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isWrite) {
    sendJson(res, 405, { error: 'Desteklenmeyen istek turu.' });
    return;
  }

  try {
    if (url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, version: '2.3.1' });
      return;
    }

    if (url.pathname === '/api/fetch') {
      const target = url.searchParams.get('url');
      if (!target) throw new HttpError(400, '"url" parametresi zorunludur.');
      await handleFetch(target, res);
      return;
    }

    if (url.pathname === '/api/filament') {
      const target = url.searchParams.get('url');
      if (!target) throw new HttpError(400, '"url" parametresi zorunludur.');
      await handleFilament(target, res);
      return;
    }

    if (url.pathname === '/api/search') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2) throw new HttpError(400, 'Arama metni çok kısa.');
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 4, 1), 8);
      await handleSearch(query, limit, res);
      return;
    }

    if (url.pathname === '/api/backups') {
      await handleBackupList(res);
      return;
    }

    if (url.pathname === '/api/backup') {
      if (req.method === 'POST') {
        await handleBackupWrite(req, res);
        return;
      }
      const name = url.searchParams.get('name');
      if (!name) throw new HttpError(400, '"name" parametresi zorunludur.');
      await handleBackupRead(name, res);
      return;
    }

    if (url.pathname === '/api/slicers') {
      sendJson(res, 200, { ok: true, slicers: findSlicers() });
      return;
    }

    if (url.pathname === '/api/slice') {
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      assertLocalOrigin(req);
      await handleSlice(req, res, url);
      return;
    }

    if (url.pathname === '/api/webhook/order') {
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      // Disaridan gelen webhook'ta Origin kontrolu yapilmaz; kimlik
      // dogrulamasi paylasilan anahtarla (WEBHOOK_TOKEN) yapilir.
      await handleWebhookOrder(req, res, url);
      return;
    }

    if (url.pathname === '/api/inbox') {
      if (req.method === 'POST') assertLocalOrigin(req);
      await handleInbox(req, res);
      return;
    }

    if (url.pathname === '/api/launch') {
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      assertLocalOrigin(req);
      await handleLaunch(req, res);
      return;
    }

    if (url.pathname === '/api/data') {
      if (req.method === 'POST') {
        assertLocalOrigin(req);
        await handleDataWrite(req, res);
        return;
      }
      await handleDataRead(res);
      return;
    }

    if (url.pathname === '/api/pdf' || url.pathname === '/api/pdf/reveal') {
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      assertLocalOrigin(req);
      if (url.pathname === '/api/pdf') await handlePdfExport(req, res, url);
      else await handlePdfReveal(req, res);
      return;
    }

    if (url.pathname.startsWith('/api/gcode/')) {
      if (url.pathname === '/api/gcode/list') {
        await handleGcodeList(res);
        return;
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      assertLocalOrigin(req);
      if (url.pathname === '/api/gcode/save') {
        await handleGcodeSave(req, res, url);
        return;
      }
      if (url.pathname === '/api/gcode/remove') {
        await handleGcodeRemove(req, res);
        return;
      }
    }

    if (url.pathname.startsWith('/api/printer/')) {
      if (url.pathname === '/api/printer/ports') {
        sendJson(res, 200, { ok: true, ports: await listSerialPorts() });
        return;
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Bu uç POST bekler.');
      assertLocalOrigin(req);
      if (url.pathname === '/api/printer/status') {
        await handlePrinterStatus(req, res);
        return;
      }
      if (url.pathname === '/api/printer/command') {
        await handlePrinterCommand(req, res);
        return;
      }
      if (url.pathname === '/api/printer/upload') {
        await handlePrinterUpload(req, res, url);
        return;
      }
      if (url.pathname === '/api/printer/serial') {
        await handleSerial(req, res);
        return;
      }
      if (url.pathname === '/api/printer/serial-upload') {
        await handleSerialUpload(req, res, url);
        return;
      }
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Bilinmeyen API ucu.' });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof HttpError ? error.message : 'Sunucuda beklenmeyen bir hata oluştu.';
    if (status >= 500) console.error('[hata]', error);
    sendJson(res, status, { error: message });
  }
});

/**
 * Uygulama penceresi.
 *
 * Uygulama bir tarayici SEKMESINDE degil, kendi penceresinde acilir: sistemde
 * hazir bulunan WebView2/Chromium motoru "--app" kipinde baslatilir. Bu kipte
 * sekme cubugu, adres cubugu ve yer imleri yoktur; pencerenin kendi gorev
 * cubugu girisi olur. Ayri bir profil klasoru kullanilir, boylece kullanicinin
 * acik tarayicisiyla hicbir sekilde karismaz ve gercekten ayri bir surectir.
 *
 * Pencere kapatilinca sunucu da kapanir; uygulama arkada calismaya devam etmez.
 */
const WINDOW_PROFILE = join(process.env.LOCALAPPDATA || homedir(), '3D Baski Maliyet', 'pencere');

/**
 * Arayuzun nasil acilacagini belirler.
 *
 *   app      : kendi penceresinde acilir (sekme/adres cubugu yok). exe'nin
 *              varsayilanidir; pencere kapatilinca sunucu da kapanir.
 *   browser  : varsayilan tarayicida normal bir sekmede acilir. Baslat.bat
 *              bu kipi kullanir; sekme kapatilsa bile sunucu calisir.
 *   none     : hicbir sey acilmaz (sunucu olarak calistirmak icin).
 *
 * OPEN_MODE cevre degiskeniyle secilir; NO_OPEN eskiden beri "none" demektir.
 */
function resolveOpenMode() {
  if (process.env.NO_OPEN) return 'none';
  const raw = String(process.env.OPEN_MODE || '')
    .trim()
    .toLowerCase();
  if (raw === 'browser' || raw === 'tarayici') return 'browser';
  if (raw === 'none' || raw === 'yok') return 'none';
  return 'app';
}

/** Sistemdeki Edge/Chrome kurulumlarini sirayla dener. */
function findBrowserEngine() {
  const roots = [
    process.env.LOCALAPPDATA,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramFiles,
  ].filter(Boolean);

  const relatives = [
    join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join('Google', 'Chrome', 'Application', 'chrome.exe'),
    join('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ];

  for (const relative of relatives) {
    for (const root of roots) {
      const candidate = join(root, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Arayuzu secilen kipte acar. Kendi penceresi istendigi halde uygun bir
 * motor bulunamazsa tarayiciya duser; bu durumda pencere kapanisini
 * izleyemeyecegimiz icin sunucu acik birakilir.
 */
function launchUi(address, onWindowClosed) {
  const mode = resolveOpenMode();
  if (mode === 'none') return mode;

  if (mode === 'browser') {
    openWithShell(address);
    return mode;
  }

  // Isaret arayuze "kendi penceremdeyim" der; surum etiketi buna gore yazilir.
  const target = `${address}/?pencere=1`;
  if (process.platform === 'win32') {
    const engine = findBrowserEngine();
    if (engine) {
      try {
        let fellBack = false;
        const child = spawn(
          engine,
          [
            `--app=${target}`,
            `--user-data-dir=${WINDOW_PROFILE}`,
            '--window-size=1440,940',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-features=Translate,AutofillServerCommunication',
          ],
          { detached: false, stdio: 'ignore', windowsHide: false },
        );
        child.on('error', () => {
          fellBack = true;
          openWithShell(address);
        });
        // Pencere kapatilinca uygulama da kapansin.
        child.on('exit', () => {
          if (!fellBack) onWindowClosed?.();
        });
        return mode;
      } catch {
        // Asagidaki kabuk yontemine dusulur.
      }
    }
  }
  openWithShell(target);
  return mode;
}

/** Son care: isletim sisteminin varsayilan uygulamasiyla ac. */
function openWithShell(target) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Acilamazsa kullanici adresi elle girebilir.
  }
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\n  ${PORT} portu kullanımda. Baska bir port deneyin:  set PORT=8899 && npm run serve\n`,
    );
    process.exit(1);
  }
  throw error;
});

const serialSweeper = setInterval(sweepSerialSessions, 30000);
serialSweeper.unref?.();

server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  const mode = launchUi(address, () => {
    // Kullanici pencereyi kapatti: arkada calisan bir surec birakmiyoruz.
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });

  const NOTE = {
    app: 'Kendi penceresinde açıldı. Pencereyi kapatınca uygulama da kapanır.',
    browser: 'Tarayıcıda açıldı. Kapatmak için bu pencerede Ctrl+C.',
    none: 'Yalnızca sunucu çalışıyor. Adresi tarayıcıya elle yazabilirsiniz.',
  };

  console.log('');
  console.log('  3D Baskı Maliyet Hesaplayıcı');
  console.log(`  ${address}`);
  console.log(`  ${NOTE[mode]}`);
  console.log('');
});
