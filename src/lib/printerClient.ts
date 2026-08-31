/**
 * Yazıcı istemcisi.
 *
 * `printerLink.ts` hangi adrese ne sorulacağını bilir; burası o isteği yerel
 * köprüye (Node sunucusu veya Tauri) götürüp gelen ham cevabı ortak
 * `LiveStatus` biçimine çevirir. Tarayıcı LAN'daki bir cihaza doğrudan
 * bağlanamadığı için istek daima köprüden geçer.
 */

import {
  authHeaders,
  baseUrl,
  commandRequest,
  normalizeStatus,
  offlineStatus,
  statusPaths,
  uploadTarget,
  type LiveStatus,
  type PrinterCommand,
  type PrinterLink,
} from './printerLink';
import { invokeCommand, isTauri } from './runtime';

export interface ActionResult {
  ok: boolean;
  message: string;
}

interface BridgeReply {
  ok?: boolean;
  error?: string | null;
  payload?: unknown;
  status?: number;
  ports?: string[];
  id?: string;
  name?: string;
  size?: number;
  dir?: string;
  files?: StoredGcode[];
  totalBytes?: number;
}

const SERIAL_ONLY_NODE = 'USB seri bağlantı yalnızca Baslat.bat / exe sürümünde çalışır.';

const OFFLINE_HINT =
  'Yerel köprüye ulaşılamadı. Uygulamayı "Baslat.bat" ile çalıştırdığınızdan emin olun.';

/**
 * Tauri kabuğunda istek Rust tarafına gider; tarayıcı + Node sürümünde yerel
 * sunucuya. İki yolda da cevap aynı `BridgeReply` biçimindedir.
 */
async function viaTauri(command: string, args: Record<string, unknown>): Promise<BridgeReply> {
  try {
    return await invokeCommand<BridgeReply>(command, args);
  } catch (error) {
    return { ok: false, error: typeof error === 'string' ? error : 'Yazıcıya ulaşılamadı.' };
  }
}

async function bridge(path: string, init: RequestInit, timeoutMs: number): Promise<BridgeReply> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, error: OFFLINE_HINT };
  }
  let body: BridgeReply | null = null;
  try {
    body = (await response.json()) as BridgeReply;
  } catch {
    body = null;
  }
  if (!response.ok) {
    return { ok: false, error: body?.error ?? `Köprü hatası (${response.status})` };
  }
  return body ?? { ok: false, error: 'Köprüden boş cevap geldi.' };
}

function postJson(path: string, body: unknown, timeoutMs: number): Promise<BridgeReply> {
  return bridge(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

/** Yazıcının anlık durumunu okur. Hata durumunda `offline` döner. */
export async function readStatus(link: PrinterLink): Promise<LiveStatus> {
  if (link.kind === 'serial') {
    if (isTauri()) return offlineStatus(SERIAL_ONLY_NODE);
    const reply = await postJson(
      '/api/printer/serial',
      { action: 'status', path: link.serialPath, baudRate: link.baudRate },
      20000,
    );
    if (!reply.ok) return offlineStatus(reply.error ?? 'Seri porta bağlanılamadı.');
    return normalizeStatus('serial', reply.payload);
  }

  const base = baseUrl(link);
  if (!base) return offlineStatus('Yazıcı adresi girilmemiş.');

  const args = {
    base,
    paths: statusPaths(link.kind, link.apiKey),
    headers: authHeaders(link.kind, link.apiKey),
  };
  const reply = isTauri()
    ? await viaTauri('printer_status', args)
    : await postJson('/api/printer/status', args, 15000);
  if (!reply.ok) return offlineStatus(reply.error ?? 'Yazıcıya ulaşılamadı.');
  return normalizeStatus(link.kind, reply.payload);
}

/** Bağlantıyı sınar; kullanıcıya gösterilecek bir cümle döner. */
export async function testConnection(link: PrinterLink): Promise<ActionResult> {
  const status = await readStatus(link);
  if (status.state === 'offline') {
    return { ok: false, message: status.message ?? 'Bağlantı kurulamadı.' };
  }
  const parts = ['Bağlantı kuruldu'];
  if (status.raw) parts.push(`durum: ${status.raw}`);
  if (status.nozzle) parts.push(`nozul ${status.nozzle.current.toFixed(0)}°`);
  return { ok: true, message: parts.join(' · ') };
}

/** Duraklat / devam et / iptal. */
export async function runPrinterCommand(
  link: PrinterLink,
  command: PrinterCommand,
): Promise<ActionResult> {
  const request = commandRequest(link.kind, command, link.apiKey);

  if (link.kind === 'serial') {
    if (isTauri()) return { ok: false, message: SERIAL_ONLY_NODE };
    const reply = await postJson(
      '/api/printer/serial',
      {
        action: 'gcode',
        path: link.serialPath,
        baudRate: link.baudRate,
        gcode: request.gcode ?? [],
      },
      30000,
    );
    return {
      ok: reply.ok === true,
      message: reply.ok ? 'Komut gönderildi.' : (reply.error ?? 'Komut gönderilemedi.'),
    };
  }

  const base = baseUrl(link);
  if (!base) return { ok: false, message: 'Yazıcı adresi girilmemiş.' };

  const args = {
    base,
    path: request.path,
    headers: authHeaders(link.kind, link.apiKey),
    body: request.body,
  };
  const reply = isTauri()
    ? await viaTauri('printer_command', args)
    : await postJson('/api/printer/command', args, 20000);
  return {
    ok: reply.ok === true,
    message: reply.ok ? 'Komut gönderildi.' : (reply.error ?? 'Komut gönderilemedi.'),
  };
}

/**
 * G-code dosyasını yazıcıya yükler ve istenirse baskıyı başlatır.
 * Dosya köprüye ham gövde olarak akıtılır; bellekte kopyalanmaz.
 */
export async function sendToPrint(
  link: PrinterLink,
  file: File,
  start: boolean,
): Promise<ActionResult> {
  if (file.size === 0) return { ok: false, message: 'Dosya boş görünüyor.' };
  if (isTauri()) {
    // Tarayıcı File nesnesinin disk yolu yoktur; Rust ucu dosya yolu bekler.
    return {
      ok: false,
      message: 'Baskıya gönderme yalnızca Baslat.bat / exe sürümünde çalışır.',
    };
  }

  if (link.kind === 'serial') {
    const query = new URLSearchParams({
      path: link.serialPath,
      baudRate: String(link.baudRate),
      filename: file.name,
      size: String(file.size),
    });
    const reply = await bridge(
      `/api/printer/serial-upload?${query.toString()}`,
      { method: 'POST', body: file },
      10 * 60 * 1000,
    );
    return {
      ok: reply.ok === true,
      message: reply.ok
        ? 'Baskı seri porttan gönderilmeye başlandı.'
        : (reply.error ?? 'Baskı gönderilemedi.'),
    };
  }

  const base = baseUrl(link);
  if (!base) return { ok: false, message: 'Yazıcı adresi girilmemiş.' };

  const target = uploadTarget(link.kind, link.apiKey, start);
  const query = new URLSearchParams({
    base,
    path: target.path,
    field: target.field,
    fields: JSON.stringify(target.fields),
    headers: JSON.stringify(authHeaders(link.kind, link.apiKey)),
    filename: file.name,
    size: String(file.size),
  });

  const reply = await bridge(
    `/api/printer/upload?${query.toString()}`,
    { method: 'POST', body: file },
    10 * 60 * 1000,
  );
  return {
    ok: reply.ok === true,
    message: reply.ok
      ? start
        ? 'Dosya yüklendi, baskı başlatıldı.'
        : 'Dosya yazıcıya yüklendi.'
      : (reply.error ?? 'Yükleme başarısız.'),
  };
}

/** Bilgisayardaki seri portları listeler (Windows). */
export async function listSerialPorts(): Promise<string[]> {
  if (isTauri()) return [];
  const reply = await bridge('/api/printer/ports', { method: 'GET' }, 10000);
  return reply.ports ?? [];
}

// ---------------------------------------------------------------------------
// Saklanan g-code dosyaları
// ---------------------------------------------------------------------------

export interface StoredGcode {
  id: string;
  name: string;
  size: number;
}

/**
 * G-code'u sunucunun deposuna yazar. Tarayıcının yerel deposu bu boyutu
 * kaldıramaz; ayrıca yazıcıya gönderirken dosya diskten doğrudan akıtılır.
 * Depolama yoksa (Tauri kabuğu) null döner — çağıran bunu sessizce geçer.
 */
export async function saveGcode(file: File): Promise<StoredGcode | null> {
  if (isTauri() || file.size === 0) return null;
  const query = new URLSearchParams({ name: file.name, size: String(file.size) });
  const reply = await bridge(
    `/api/gcode/save?${query.toString()}`,
    { method: 'POST', body: file },
    5 * 60 * 1000,
  );
  if (reply.ok !== true || typeof reply.id !== 'string') return null;
  return { id: reply.id, name: reply.name ?? file.name, size: reply.size ?? file.size };
}

/** Depodaki g-code dosyalarının sayısı, toplam boyutu ve klasörü. */
export async function storedGcodeSummary(): Promise<{
  dir: string;
  count: number;
  totalBytes: number;
}> {
  if (isTauri()) return { dir: '', count: 0, totalBytes: 0 };
  const reply = await bridge('/api/gcode/list', { method: 'GET' }, 15000);
  return {
    dir: reply.dir ?? '',
    count: reply.files?.length ?? 0,
    totalBytes: reply.totalBytes ?? 0,
  };
}

/** Artık hiçbir kayıt kullanmıyorsa dosyayı diskten siler. */
export async function removeGcode(id: string): Promise<void> {
  if (isTauri()) return;
  await postJson('/api/gcode/remove', { id }, 15000);
}

/**
 * Depodaki bir g-code'u yazıcıya gönderir ve baskıyı başlatır.
 * Dosya tarayıcıya hiç uğramaz; sunucu diskten yazıcıya akıtır.
 */
export async function sendStoredToPrint(
  link: PrinterLink,
  gcodeId: string,
  filename: string,
): Promise<ActionResult> {
  if (isTauri()) {
    return { ok: false, message: 'Baskıya gönderme yalnızca Baslat.bat / exe sürümünde çalışır.' };
  }
  if (link.kind === 'serial') {
    return { ok: false, message: 'Seri porta sipariş ekranından gönderme henüz desteklenmiyor.' };
  }

  const base = baseUrl(link);
  if (!base) return { ok: false, message: 'Yazıcı adresi girilmemiş.' };

  const target = uploadTarget(link.kind, link.apiKey, true);
  const query = new URLSearchParams({
    base,
    path: target.path,
    field: target.field,
    fields: JSON.stringify(target.fields),
    headers: JSON.stringify(authHeaders(link.kind, link.apiKey)),
    filename,
    gcodeId,
  });

  const reply = await bridge(
    `/api/printer/upload?${query.toString()}`,
    { method: 'POST' },
    10 * 60 * 1000,
  );
  return {
    ok: reply.ok === true,
    message: reply.ok ? 'Dosya yüklendi, baskı başlatıldı.' : (reply.error ?? 'Yükleme başarısız.'),
  };
}
