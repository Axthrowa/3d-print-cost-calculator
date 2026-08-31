/**
 * PDF çıktısı.
 *
 * Fatura HTML'i yerel köprüye gönderilir; köprü sistemde kurulu Chromium'un
 * yazdırma çekirdeğiyle PDF üretip diske yazar. Üçüncü parti bir PDF
 * kütüphanesi kullanılmaz: metin vektörel kalır, Türkçe harfler sorunsuzdur
 * ve uygulamaya tek bayt eklenmez.
 */

import { isTauri } from './runtime';

export interface PdfResult {
  ok: boolean;
  /** Kaydedilen dosyanın tam yolu. */
  path?: string;
  dir?: string;
  error?: string;
}

/** Bu ortamda doğrudan PDF kaydedilebilir mi? */
export function pdfSupported(): boolean {
  return !isTauri();
}

export async function exportPdf(html: string, fileName: string): Promise<PdfResult> {
  if (!pdfSupported()) {
    return { ok: false, error: 'Bu sürümde doğrudan PDF kaydı yok; "Yazdır" ile alabilirsiniz.' };
  }
  try {
    const response = await fetch(`/api/pdf?name=${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html,
      signal: AbortSignal.timeout(120000),
    });
    const body = (await response.json()) as PdfResult;
    if (!response.ok)
      return { ok: false, error: body?.error ?? `Köprü hatası (${response.status})` };
    return body;
  } catch {
    return { ok: false, error: 'Yerel köprüye ulaşılamadı.' };
  }
}

/** Kaydedilen PDF'i Dosya Gezgini'nde gösterir. */
export async function revealPdf(path: string): Promise<void> {
  if (!pdfSupported()) return;
  try {
    await fetch('/api/pdf/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Gezgin açılamazsa yol zaten kullanıcıya gösteriliyor.
  }
}
