/**
 * Uygulama servisleri.
 *
 * İndirme işi ortama göre Rust'a (Tauri) veya yerel Node sunucusuna
 * devredilir; AYRIŞTIRMA her iki durumda da burada, test edilmiş saf
 * modüllerle yapılır. Böylece tek kod yolu ve tek test kümesi vardır.
 */

import { parseFilamentPage, stripHtml, type ParsedFilament } from './filamentParser';
import { findPrinter, isConfidentMatch, parsePrinterSpecText } from './printerCatalog';
import { FetchError, fetchPage, isTauri, searchWeb } from './runtime';

export { FetchError as ApiError } from './runtime';

export interface ApiFilamentResponse extends ParsedFilament {
  finalUrl: string;
}

export interface ApiPrinterResponse {
  /** Baski sirasindaki ortalama cekis (W). Yalnizca katalogda bilinir. */
  peakW?: number | null;
  idleW?: number | null;
  ok: boolean;
  brand: string | null;
  model: string | null;
  powerW: number | null;
  buildVolume: string | null;
  sourceUrl: string | null;
  warnings: string[];
}

/** Verilen ürün adresinden filament fiyat/gramaj/renk bilgisini çeker. */
export async function fetchFilamentFromUrl(url: string): Promise<ApiFilamentResponse> {
  if (!isTauri()) {
    let response: Response;
    try {
      response = await fetch(`/api/filament?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(25000),
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
        // JSON degilse varsayilan mesaj.
      }
      throw new FetchError(detail);
    }

    return (await response.json()) as ApiFilamentResponse;
  }

  const page = await fetchPage(url);
  return { ...parseFilamentPage(page.html, page.finalUrl), finalUrl: page.finalUrl };
}

/** Marka/model metninden yazıcı teknik bilgisi bulur. */
export async function fetchPrinterSpecs(query: string): Promise<ApiPrinterResponse> {
  // 1) Önce yerleşik katalog — anında ve çevrimdışı çalışır.
  //
  // Eşleşme YALNIZCA sorgudaki her kelime modelde karşılanıyorsa kabul
  // edilir. Aksi halde "Ender 3 Pro" araması "Ender 3 S1 Pro" kaydını
  // sessizce uygular ve kullanıcıya yanlış güç değeri yazardı.
  const match = findPrinter(query);
  if (match && isConfidentMatch(match, query)) {
    return {
      ok: true,
      brand: match.printer.brand,
      model: match.printer.model,
      // Hesaplamada ORTALAMA güç kullanılır; pik değer ayrıca döner.
      powerW: match.printer.avgPowerW,
      peakW: match.printer.maxPowerW,
      idleW: match.printer.idlePowerW,
      buildVolume: match.printer.buildVolume,
      sourceUrl: null,
      warnings: ['Yerleşik katalogdan eşleştirildi.'],
    };
  }

  // 2) Çevrimiçi arama (en iyi çaba).
  const warnings: string[] = [];
  let candidates: string[] = [];
  try {
    candidates = await searchWeb(`${query} 3d printer power consumption watt specifications`, 4);
  } catch (error) {
    warnings.push(
      error instanceof FetchError ? error.message : 'Arama servisine şu an ulaşılamıyor.',
    );
  }

  for (const candidate of candidates) {
    try {
      const page = await fetchPage(candidate);
      const spec = parsePrinterSpecText(stripHtml(page.html).slice(0, 60000));
      if (spec.powerW) {
        return {
          ok: true,
          brand: null,
          model: query,
          // Sayfadan okunan deger etiket/pik degeridir.
          powerW: null,
          peakW: spec.powerW,
          buildVolume: spec.buildVolume,
          sourceUrl: page.finalUrl,
          warnings: [
            'Değer internetten otomatik çıkarıldı, doğruluğunu kontrol edin.',
            ...spec.warnings,
          ],
        };
      }
    } catch {
      // Bu aday başarısız, sonrakine geç.
    }
  }

  warnings.push('Bu model için güç tüketimi bilgisi bulunamadı. Lütfen manuel girin.');
  return {
    ok: false,
    brand: null,
    model: query,
    powerW: null,
    buildVolume: null,
    sourceUrl: null,
    warnings,
  };
}
