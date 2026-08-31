/**
 * Fiyat güncelleme turunu yürüten koşucu. Ağ katmanı dışarıdan `fetcher` olarak
 * verildiği için birim testlerde sahte bir okuyucuyla çalıştırılabilir.
 */

import {
  applyCheckFailure,
  applyPriceUpdate,
  summarizeRun,
  type PriceUpdate,
  type RunSummary,
} from './priceWatcher';
import type { FilamentSpool } from '../types';

export interface FetchedPrice {
  ok: boolean;
  price: number | null;
  weightGrams: number | null;
  warnings: string[];
}

export interface RefreshResult {
  /** Yalnızca değişen makaralar; kimlik -> yeni hâli. */
  updated: Map<string, FilamentSpool>;
  /** Fiyatı gerçekten değişenler (bildirim metni için). */
  changes: PriceUpdate[];
  summary: RunSummary;
}

/**
 * Verilen makaraları sırayla yeniden okur. Bir adres hata verirse tur durmaz;
 * o makara "başarısız" olarak işaretlenip diğerlerine devam edilir.
 */
export async function refreshSpools(
  targets: FilamentSpool[],
  fetcher: (url: string) => Promise<FetchedPrice>,
  at: string,
): Promise<RefreshResult> {
  const updated = new Map<string, FilamentSpool>();
  const results: PriceUpdate[] = [];
  let failures = 0;

  for (const spool of targets) {
    if (!spool.sourceUrl) continue;
    try {
      const fetched = await fetcher(spool.sourceUrl);
      if (!fetched.ok || fetched.price === null) {
        failures += 1;
        updated.set(
          spool.id,
          applyCheckFailure(spool, fetched.warnings[0] ?? 'Fiyat bulunamadı.', at),
        );
        continue;
      }
      const update = applyPriceUpdate(spool, fetched.price, at, fetched.weightGrams);
      results.push(update);
      updated.set(spool.id, update.spool);
    } catch (error) {
      failures += 1;
      updated.set(
        spool.id,
        applyCheckFailure(spool, error instanceof Error ? error.message : 'Bilinmeyen hata', at),
      );
    }
  }

  return {
    updated,
    changes: results.filter((r) => r.changed),
    summary: summarizeRun(results, failures),
  };
}

/** Güncellenmiş makaraları mevcut listeye işler, sırayı korur. */
export function mergeSpools(
  spools: FilamentSpool[],
  updated: Map<string, FilamentSpool>,
): FilamentSpool[] {
  if (updated.size === 0) return spools;
  return spools.map((spool) => updated.get(spool.id) ?? spool);
}
