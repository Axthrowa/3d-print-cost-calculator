/**
 * Çalışma ortamı köprüsü.
 *
 * Uygulama iki ortamda çalışabilir:
 *  - Tauri masaüstü kabuğu → uzak sayfaları Rust tarafı indirir (`invoke`).
 *  - Tarayıcı + yerel Node sunucusu → aynı işi `/api/fetch` yapar.
 *
 * Her iki durumda da AYRIŞTIRMA arayüzdeki saf TypeScript modüllerinde
 * yapılır; böylece tek bir kod yolu ve tek bir test kümesi vardır.
 */

export interface FetchedPage {
  html: string;
  finalUrl: string;
}

export class FetchError extends Error {
  offline: boolean;

  constructor(message: string, offline = false) {
    super(message);
    this.name = 'FetchError';
    this.offline = offline;
  }
}

interface TauriInternals {
  invoke?: unknown;
}

/** Uygulama Tauri kabuğunda mı çalışıyor? */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Uygulama kendi penceresinde mi çalışıyor?
 *
 * İki masaüstü yolu vardır: Tauri kabuğu ve yerel sunucunun açtığı çerçevesiz
 * pencere. İkincisini sunucu adrese koyduğu işaretten anlarız; tarayıcıda
 * elle açılan sekmede bu işaret bulunmaz.
 */
export function isDesktopShell(): boolean {
  if (isTauri()) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('pencere');
}

/** Tauri komutunu çağırır (yalnızca masaüstünde). */
export async function invokeCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

function toMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Uzak bir sayfayı indirir. Ayrıştırma çağıranın işidir. */
export async function fetchPage(url: string, timeoutMs = 20000): Promise<FetchedPage> {
  if (isTauri()) {
    try {
      return await invokeCommand<FetchedPage>('fetch_page', { url });
    } catch (error) {
      throw new FetchError(toMessage(error, 'Sayfa indirilemedi.'));
    }
  }

  let response: Response;
  try {
    response = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new FetchError(
      timedOut
        ? 'İstek zaman aşımına uğradı. Bağlantınızı kontrol edip tekrar deneyin.'
        : 'Fiyat servisine ulaşılamadı. Uygulamayı "Baslat.bat" ile çalıştırdığınızdan emin olun ya da bilgileri manuel girin.',
      true,
    );
  }

  if (!response.ok) {
    let detail = `Sunucu hatası (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Gövde JSON değilse varsayılan mesaj kullanılır.
    }
    throw new FetchError(detail);
  }

  return (await response.json()) as FetchedPage;
}

/** Arama motorundan aday sayfa adresleri toplar (en iyi çaba). */
export async function searchWeb(query: string, limit = 4): Promise<string[]> {
  if (isTauri()) {
    try {
      return await invokeCommand<string[]>('search_web', { query, limit });
    } catch (error) {
      throw new FetchError(toMessage(error, 'Arama yapılamadı.'));
    }
  }

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new FetchError('Arama servisine ulaşılamadı.');
    const body = (await response.json()) as { urls?: string[] };
    return body.urls ?? [];
  } catch (error) {
    if (error instanceof FetchError) throw error;
    throw new FetchError('Arama servisine şu an ulaşılamıyor.', true);
  }
}

/** Tip denetimi için: pencerede Tauri iç nesnesi bulunabilir. */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

// ---------------------------------------------------------------------------
// Yedekleme (yalnizca yerel sunucu/exe surumunde diske yazar)
// ---------------------------------------------------------------------------

export interface BackupFileInfo {
  name: string;
  size: number;
  at: string;
}

/** Diske yedek yazma bu ortamda destekleniyor mu? */
export function diskBackupSupported(): boolean {
  return !isTauri();
}

/** Yedegi diske yazar; yazilan dizini dondurur. */
export async function pushBackup(name: string, snapshot: unknown): Promise<string> {
  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, snapshot }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    let detail = 'Yedek yazilamadi.';
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Govde JSON degilse varsayilan mesaj.
    }
    throw new FetchError(detail);
  }
  const body = (await response.json()) as { dir?: string };
  return body.dir ?? '';
}

/** Diskteki yedekleri listeler. */
export async function listBackups(): Promise<{ dir: string; files: BackupFileInfo[] }> {
  try {
    const response = await fetch('/api/backups', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { dir: '', files: [] };
    return (await response.json()) as { dir: string; files: BackupFileInfo[] };
  } catch {
    return { dir: '', files: [] };
  }
}

/** Bir yedegin icerigini metin olarak okur. */
export async function pullBackup(name: string): Promise<string> {
  const response = await fetch(`/api/backup?name=${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new FetchError('Yedek okunamadi.');
  return response.text();
}
