/**
 * Filament stok takibi.
 *
 * Her makaranın kalan gramajı tutulur. Bir baskı işi "Tamamlandı" veya
 * "Başarısız" olarak kapatıldığında kullandığı malzeme stoktan düşülür —
 * başarısız baskı da plastiği harcadığı için o da düşülür.
 *
 * İşin durumu geri alınırsa (kuyruğa dönerse) düşülen miktar iade edilir.
 * Çifte düşmeyi önlemek için işin `consumed` bayrağı kullanılır.
 *
 * Saf ve yan etkisizdir; girdileri değiştirmez.
 */

import type { FilamentSpool, JobMaterial } from '../types';

/** Stok uyarı eşiği: rulonun bu oranının altına düşünce "az kaldı" sayılır. */
export const LOW_STOCK_RATIO = 0.1;

export type StockLevel = 'ok' | 'low' | 'empty';

/**
 * Makaranın kalan gramajı.
 * Alan hiç yazılmamışsa (eski kayıt) makara dolu kabul edilir.
 */
export function remainingOf(spool: FilamentSpool): number {
  const value = spool.remainingGrams;
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, spool.rollWeight);
  return Math.max(0, value);
}

/** Kalan oranı (0..1). */
export function remainingRatio(spool: FilamentSpool): number {
  const total = Math.max(0, spool.rollWeight);
  if (total === 0) return 0;
  return Math.min(1, remainingOf(spool) / total);
}

/** Stok seviyesi. */
export function stockLevel(spool: FilamentSpool): StockLevel {
  const remaining = remainingOf(spool);
  if (remaining <= 0) return 'empty';
  return remainingRatio(spool) <= LOW_STOCK_RATIO ? 'low' : 'ok';
}

/** Bir malzeme listesinin makara başına toplamı. */
export function groupBySpool(materials: JobMaterial[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const material of materials) {
    if (!material.spoolId) continue;
    const grams = Number.isFinite(material.grams) ? Math.max(0, material.grams) : 0;
    if (grams === 0) continue;
    totals.set(material.spoolId, (totals.get(material.spoolId) ?? 0) + grams);
  }
  return totals;
}

export interface StockChange {
  spools: FilamentSpool[];
  /** Gerçekten düşülen/iade edilen toplam gram. */
  appliedGrams: number;
  warnings: string[];
}

/**
 * Malzemeyi stoktan düşer.
 *
 * Stok yetmezse eksiye düşülmez; kalan sıfırlanır ve uyarı verilir.
 * Böylece kayıt gerçeğe yakın kalır ve kullanıcı eksiği görür.
 */
export function consume(spools: FilamentSpool[], materials: JobMaterial[]): StockChange {
  const totals = groupBySpool(materials);
  if (totals.size === 0) return { spools, appliedGrams: 0, warnings: [] };

  const warnings: string[] = [];
  let appliedGrams = 0;

  const next = spools.map((spool) => {
    const need = totals.get(spool.id);
    if (need === undefined) return spool;

    const remaining = remainingOf(spool);
    const taken = Math.min(remaining, need);
    appliedGrams += taken;

    if (need > remaining) {
      warnings.push(
        `${spool.brand} ${spool.material}: stokta ${remaining.toFixed(0)} g vardı, ` +
          `${need.toFixed(0)} g gerekti. Makara boşaldı, ${(need - remaining).toFixed(0)} g eksik kaldı.`,
      );
    }
    return { ...spool, remainingGrams: Number((remaining - taken).toFixed(2)) };
  });

  // Envanterde bulunmayan makaralar (silinmiş olabilir).
  for (const [spoolId, grams] of totals) {
    if (!spools.some((s) => s.id === spoolId)) {
      warnings.push(`Envanterde olmayan bir makaradan ${grams.toFixed(0)} g düşülemedi.`);
    }
  }

  return { spools: next, appliedGrams, warnings };
}

/** Düşülen malzemeyi geri verir (iş kuyruğa döndüğünde). */
export function restore(spools: FilamentSpool[], materials: JobMaterial[]): StockChange {
  const totals = groupBySpool(materials);
  if (totals.size === 0) return { spools, appliedGrams: 0, warnings: [] };

  let appliedGrams = 0;
  const next = spools.map((spool) => {
    const back = totals.get(spool.id);
    if (back === undefined) return spool;
    // Rulo kapasitesinin üstüne çıkmasın.
    const restored = Math.min(spool.rollWeight, remainingOf(spool) + back);
    appliedGrams += restored - remainingOf(spool);
    return { ...spool, remainingGrams: Number(restored.toFixed(2)) };
  });

  return { spools: next, appliedGrams, warnings: [] };
}

/** Makarayı doldurur: kalanı rulo kapasitesine çeker. */
export function refill(spools: FilamentSpool[], spoolId: string): FilamentSpool[] {
  return spools.map((spool) =>
    spool.id === spoolId ? { ...spool, remainingGrams: Math.max(0, spool.rollWeight) } : spool,
  );
}

/** Kalan gramajı elle ayarlar. */
export function setRemaining(
  spools: FilamentSpool[],
  spoolId: string,
  grams: number,
): FilamentSpool[] {
  return spools.map((spool) =>
    spool.id === spoolId
      ? {
          ...spool,
          remainingGrams: Math.min(Math.max(0, spool.rollWeight), Math.max(0, grams)),
        }
      : spool,
  );
}

export interface StockSummary {
  totalRemaining: number;
  totalCapacity: number;
  /** Kalan malzemenin parasal değeri (TL). */
  value: number;
  low: number;
  empty: number;
}

/** Envanterin stok özeti. */
export function summarizeStock(spools: FilamentSpool[]): StockSummary {
  let totalRemaining = 0;
  let totalCapacity = 0;
  let value = 0;
  let low = 0;
  let empty = 0;

  for (const spool of spools) {
    const remaining = remainingOf(spool);
    totalRemaining += remaining;
    totalCapacity += Math.max(0, spool.rollWeight);
    if (spool.rollWeight > 0) value += (spool.rollPrice / spool.rollWeight) * remaining;
    const level = stockLevel(spool);
    if (level === 'low') low += 1;
    if (level === 'empty') empty += 1;
  }

  return { totalRemaining, totalCapacity, value, low, empty };
}

/**
 * Bir baskı için stok yetiyor mu? Yetmiyorsa eksik olanları bildirir.
 * Düşme yapmaz; yalnızca önceden uyarmak içindir.
 */
export function checkAvailability(
  spools: FilamentSpool[],
  materials: JobMaterial[],
): { ok: boolean; shortages: Array<{ spool: FilamentSpool; need: number; have: number }> } {
  const totals = groupBySpool(materials);
  const shortages: Array<{ spool: FilamentSpool; need: number; have: number }> = [];

  for (const [spoolId, need] of totals) {
    const spool = spools.find((s) => s.id === spoolId);
    if (!spool) continue;
    const have = remainingOf(spool);
    if (need > have) shortages.push({ spool, need, have });
  }

  return { ok: shortages.length === 0, shortages };
}

/** v1.5.3 ve oncesindeki tek makaralı baski isi bicimi. */
interface LegacyJob {
  spoolId?: string | null;
  grams?: number;
  materials?: JobMaterial[];
  [key: string]: unknown;
}

/**
 * Eski baski kayitlarini coklu malzeme bicimine tasir.
 * Eski isler tek bir makara + gramaj tutuyordu; bunlar tek elemanli bir
 * malzeme listesine cevrilir. Stok dusumu gecmise doner sekilde
 * uygulanmaz: eski isler `consumed` bayragi olmadigi icin kapali sayilir.
 */
export function migrateJobs(raw: unknown): import('../types').PrintJob[] {
  if (!Array.isArray(raw)) return [];
  return (raw as LegacyJob[])
    .filter((job) => job && typeof job === 'object')
    .map((job) => {
      if (Array.isArray(job.materials)) {
        return job as unknown as import('../types').PrintJob;
      }
      const grams = typeof job.grams === 'number' ? job.grams : 0;
      const materials: JobMaterial[] = job.spoolId ? [{ spoolId: job.spoolId, grams }] : [];
      const finished = job.status === 'done' || job.status === 'failed';
      return {
        ...(job as unknown as import('../types').PrintJob),
        materials,
        grams,
        // Gecmis isler icin stok zaten dusulmus kabul edilir; aksi halde
        // eski bir isi acip kapatmak stoktan ikinci kez dusurdu.
        consumed: finished,
      };
    });
}
