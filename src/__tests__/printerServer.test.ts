/**
 * Yazıcı köprüsünün uçtan uca sınavı.
 *
 * Gerçek bir yazıcı yerine sahte bir HTTP sunucusu ayağa kaldırılır; uygulama
 * sunucusu ayrı bir süreçte çalıştırılır. Böylece yönlendirme, başlık
 * aktarımı, hata çevirisi ve çok parçalı yükleme donanım olmadan doğrulanır.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_PORT = 8931;
const APP = `http://127.0.0.1:${APP_PORT}`;

interface Seen {
  path: string;
  method: string;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

let printer: Server;
let printerPort = 0;
let app: ChildProcess;
const seen: Seen[] = [];

/** Sahte yazıcı: Moonraker ve OctoPrint uçlarını taklit eder. */
function startFakePrinter(): Promise<void> {
  printer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '';
      seen.push({
        path,
        method: req.method ?? '',
        headers: req.headers as Record<string, string | undefined>,
        body: Buffer.concat(chunks),
      });

      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (path.startsWith('/printer/objects/query')) {
        json(200, {
          result: {
            status: {
              print_stats: { state: 'printing', filename: 'a/kapak.gcode', print_duration: 600 },
              extruder: { temperature: 210.4, target: 210 },
              heater_bed: { temperature: 59.8, target: 60 },
              virtual_sdcard: { progress: 0.25 },
            },
          },
        });
        return;
      }
      if (path === '/api/printer') {
        if (req.headers['x-api-key'] !== 'gizli') {
          json(403, { error: 'no' });
          return;
        }
        json(200, {
          state: { text: 'Operational', flags: { operational: true, printing: false } },
          temperature: { tool0: { actual: 24, target: 0 }, bed: { actual: 23, target: 0 } },
        });
        return;
      }
      if (path === '/api/job') {
        json(200, { job: { file: { name: 'x.gcode' } }, progress: { completion: 0 } });
        return;
      }
      if (path === '/printer/print/pause') {
        json(200, { result: 'ok' });
        return;
      }
      if (path === '/api/files/local' || path === '/server/files/upload') {
        json(201, { done: true });
        return;
      }
      if (path === '/bos') {
        res.writeHead(500);
        res.end('patladi');
        return;
      }
      json(404, { error: 'yok' });
    });
  });

  return new Promise((resolve) => {
    printer.listen(0, '127.0.0.1', () => {
      const address = printer.address();
      printerPort = typeof address === 'object' && address ? address.port : 0;
      resolve();
    });
  });
}

async function waitForApp(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${APP}/api/health`);
      if (response.ok) return;
    } catch {
      // henüz açılmadı
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Uygulama sunucusu açılmadı.');
}

async function post(path: string, body: unknown, init: RequestInit = {}) {
  const response = await fetch(APP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  await startFakePrinter();
  app = spawn(process.execPath, ['server/server.mjs'], {
    env: { ...process.env, PORT: String(APP_PORT), NO_OPEN: '1' },
    stdio: 'ignore',
  });
  await waitForApp();
}, 30000);

afterAll(async () => {
  app?.kill();
  await new Promise<void>((resolve) => printer.close(() => resolve()));
});

const base = () => `http://127.0.0.1:${printerPort}`;

describe('/api/printer/status', () => {
  it('Moonraker cevabını olduğu gibi iletir', async () => {
    const { body } = await post('/api/printer/status', {
      base: base(),
      paths: [{ key: '', path: '/printer/objects/query?print_stats' }],
    });
    expect(body.ok).toBe(true);
    const payload = body.payload as { result: { status: { print_stats: { state: string } } } };
    expect(payload.result.status.print_stats.state).toBe('printing');
  });

  it('OctoPrint iki ucu anahtarlı olarak birleştirir', async () => {
    const { body } = await post('/api/printer/status', {
      base: base(),
      headers: { 'X-Api-Key': 'gizli' },
      paths: [
        { key: 'printer', path: '/api/printer' },
        { key: 'job', path: '/api/job' },
      ],
    });
    expect(body.ok).toBe(true);
    const payload = body.payload as { printer: unknown; job: unknown };
    expect(payload.printer).toBeTruthy();
    expect(payload.job).toBeTruthy();
  });

  it('API anahtarı reddedilirse anlaşılır hata verir', async () => {
    const { body } = await post('/api/printer/status', {
      base: base(),
      headers: { 'X-Api-Key': 'yanlis' },
      paths: [{ key: 'printer', path: '/api/printer' }],
    });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('API anahtarı reddedildi');
  });

  it('bilinmeyen uçta bağlantı türü uyarısı verir', async () => {
    const { body } = await post('/api/printer/status', {
      base: base(),
      paths: [{ key: '', path: '/yok' }],
    });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('Bağlantı türünü');
  });

  it('kapalı porta ulaşamadığını söyler', async () => {
    const { body } = await post('/api/printer/status', {
      base: 'http://127.0.0.1:1',
      paths: [{ key: '', path: '/x' }],
    });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toMatch(/reddedildi|ulaşılamadı/i);
  });

  it('mutlak adres yollamayı reddeder', async () => {
    const { status, body } = await post('/api/printer/status', {
      base: base(),
      paths: [{ key: '', path: 'http://baska.example/x' }],
    });
    expect(status).toBe(400);
    expect(String(body.error)).toContain('"/" ile başlamalıdır');
  });

  it('şema dışı adresi reddeder', async () => {
    const { status } = await post('/api/printer/status', {
      base: 'file:///c:/gizli',
      paths: [{ key: '', path: '/x' }],
    });
    expect(status).toBe(400);
  });

  it('yabancı kaynaklı isteği geri çevirir', async () => {
    const { status } = await post(
      '/api/printer/status',
      { base: base(), paths: [{ key: '', path: '/api/job' }] },
      { headers: { 'content-type': 'application/json', origin: 'http://kotu.example' } },
    );
    expect(status).toBe(403);
  });
});

describe('/api/printer/command', () => {
  it('gövdesiz komutu iletir', async () => {
    const { body } = await post('/api/printer/command', {
      base: base(),
      path: '/printer/print/pause',
    });
    expect(body.ok).toBe(true);
    const hit = seen.filter((s) => s.path === '/printer/print/pause').at(-1);
    expect(hit?.method).toBe('POST');
  });

  it('JSON gövdesini olduğu gibi gönderir', async () => {
    await post('/api/printer/command', {
      base: base(),
      path: '/api/job',
      headers: { 'X-Api-Key': 'gizli' },
      body: { command: 'cancel' },
    });
    const hit = seen.filter((s) => s.path === '/api/job' && s.method === 'POST').at(-1);
    expect(JSON.parse(hit?.body.toString('utf-8') ?? '{}')).toEqual({ command: 'cancel' });
    expect(hit?.headers['x-api-key']).toBe('gizli');
  });

  it('yazıcı hata verirse durumu bildirir', async () => {
    const { body } = await post('/api/printer/command', { base: base(), path: '/bos' });
    expect(body.ok).toBe(false);
    expect(body.status).toBe(500);
  });
});

describe('/api/printer/upload', () => {
  const gcode = Buffer.from('G28\nG1 X10 Y10\nM104 S210\n'.repeat(50), 'utf-8');

  async function upload(params: Record<string, string>, payload: Buffer = gcode) {
    const query = new URLSearchParams({
      base: base(),
      path: '/api/files/local',
      field: 'file',
      filename: 'kapak.gcode',
      size: String(payload.length),
      ...params,
    });
    const response = await fetch(`${APP}/api/printer/upload?${query.toString()}`, {
      method: 'POST',
      body: new Uint8Array(payload),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('dosyayı çok parçalı gövdeyle yükler', async () => {
    const { body } = await upload({ fields: JSON.stringify({ select: 'true', print: 'true' }) });
    expect(body.ok).toBe(true);

    const hit = seen.filter((s) => s.path === '/api/files/local').at(-1);
    const raw = hit?.body.toString('utf-8') ?? '';
    expect(hit?.headers['content-type']).toContain('multipart/form-data; boundary=');
    expect(raw).toContain('name="select"');
    expect(raw).toContain('name="print"');
    expect(raw).toContain('filename="kapak.gcode"');
    // Dosyanın kendisi bozulmadan geçmeli.
    expect(hit?.body.includes(gcode)).toBe(true);
  });

  it('içerik uzunluğu doğru hesaplanır (parçalı gönderim yok)', async () => {
    await upload({});
    const hit = seen.filter((s) => s.path === '/api/files/local').at(-1);
    expect(hit?.headers['transfer-encoding']).toBeUndefined();
    expect(Number(hit?.headers['content-length'])).toBe(hit?.body.length);
  });

  it('dosya adındaki yolu ve tırnağı temizler', async () => {
    await upload({ filename: 'C:\\isler\\"kotu".gcode' });
    const hit = seen.filter((s) => s.path === '/api/files/local').at(-1);
    expect(hit?.body.toString('utf-8')).toContain('filename="kotu.gcode"');
  });

  it('bildirilen boyut tutmazsa yüklemeyi kesip söyler', async () => {
    const { body } = await upload({ size: String(gcode.length + 10) });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('eksik geldi');
  });

  it('boyutsuz istek reddedilir', async () => {
    const { status } = await upload({ size: '0' });
    expect(status).toBe(400);
  });

  it('Moonraker yükleme yolu da çalışır', async () => {
    const { body } = await upload({
      path: '/server/files/upload',
      fields: JSON.stringify({ root: 'gcodes', print: 'true' }),
    });
    expect(body.ok).toBe(true);
    const hit = seen.filter((s) => s.path === '/server/files/upload').at(-1);
    expect(hit?.body.toString('utf-8')).toContain('name="root"');
  });
});

describe('/api/gcode + depodan yazdırma', () => {
  const gcode = Buffer.from(';TIME:900\nG28\nG1 X1 Y1 E0.1\n'.repeat(80), 'utf-8');
  let storedId = '';

  async function save(name: string, payload: Buffer, declared = payload.length) {
    const query = new URLSearchParams({ name, size: String(declared) });
    const response = await fetch(`${APP}/api/gcode/save?${query.toString()}`, {
      method: 'POST',
      body: new Uint8Array(payload),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('dosyayı diske yazıp kimlik döner', async () => {
    const { body } = await save('ejderha.gcode', gcode);
    expect(body.ok).toBe(true);
    expect(String(body.id)).toMatch(/^[0-9a-f]{24}$/);
    expect(body.size).toBe(gcode.length);
    expect(body.name).toBe('ejderha.gcode');
    storedId = String(body.id);
  });

  it('listede görünür', async () => {
    const response = await fetch(`${APP}/api/gcode/list`);
    const body = (await response.json()) as {
      files: Array<{ id: string; name: string; size: number }>;
      totalBytes: number;
    };
    const found = body.files.find((f) => f.id === storedId);
    expect(found?.name).toBe('ejderha.gcode');
    expect(body.totalBytes).toBeGreaterThanOrEqual(gcode.length);
  });

  it('depodaki dosyayı yazıcıya gövde göndermeden akıtır', async () => {
    const query = new URLSearchParams({
      base: base(),
      path: '/server/files/upload',
      field: 'file',
      fields: JSON.stringify({ root: 'gcodes', print: 'true' }),
      filename: 'Ejderha.gcode',
      gcodeId: storedId,
    });
    const response = await fetch(`${APP}/api/printer/upload?${query.toString()}`, {
      method: 'POST',
    });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    const hit = seen.filter((s) => s.path === '/server/files/upload').at(-1);
    expect(hit?.body.toString('utf-8')).toContain('filename="Ejderha.gcode"');
    // Dosya diskten bozulmadan geçmeli.
    expect(hit?.body.includes(gcode)).toBe(true);
    expect(Number(hit?.headers['content-length'])).toBe(hit?.body.length);
  });

  it('bilinmeyen kimlik 404 verir', async () => {
    const query = new URLSearchParams({
      base: base(),
      path: '/server/files/upload',
      gcodeId: 'a'.repeat(24),
    });
    const response = await fetch(`${APP}/api/printer/upload?${query.toString()}`, {
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  it('bozuk kimliği reddeder', async () => {
    const response = await fetch(
      `${APP}/api/printer/upload?base=${encodeURIComponent(base())}&path=/x&gcodeId=kotu`,
      { method: 'POST' },
    );
    expect(response.status).toBe(400);
  });

  it('eksik gelen dosyayı kaydetmez', async () => {
    const { body } = await save('yarim.gcode', gcode, gcode.length + 50);
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain('eksik geldi');
  });

  it('silinen dosya listeden düşer', async () => {
    await fetch(`${APP}/api/gcode/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: storedId }),
    });
    const response = await fetch(`${APP}/api/gcode/list`);
    const body = (await response.json()) as { files: Array<{ id: string }> };
    expect(body.files.some((f) => f.id === storedId)).toBe(false);
  });
});

describe('/api/printer/ports', () => {
  it('seri port listesi döner', async () => {
    const response = await fetch(`${APP}/api/printer/ports`);
    const body = (await response.json()) as { ok: boolean; ports: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.ports)).toBe(true);
  });

  it('bilinmeyen yazıcı ucu 404 verir', async () => {
    const response = await fetch(`${APP}/api/printer/yok`, { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
