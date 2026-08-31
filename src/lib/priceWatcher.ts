/**
 * Kayitli filament adreslerinden fiyatlari belirli araliklarla yeniden okuyan
 * takip mantigi. Saf (pure) ve zaman parametreli yazilmistir; boylece test
 * edilebilir ve React'ten bagimsizdir.
 */

import type { FilamentSpool, PriceSample, WatchSettings } from '../types';

export const HISTORY_LIMIT = 30;

export const INTERVAL_OPTIONS = [
  { value: 6, label: '6 saatte bir' },
  { value: 12, label: '12 saatte bir' },
  { value: 24, label: 'Günde bir' },
  { value: 72, label: '3 günde bir' },
  { value: 168, label: 'Haftada bir' },
] as const;

export const DEFAULT_WATCH_SETTINGS: WatchSettings = {
  enabled: false,
  intervalHours: 24,
  lastRunAt: null,
};

const HOUR_MS = 60 * 60 * 1000;

function toTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

/** Bir makaranin otomatik güncellemeye uygun olup olmadigini söyler. */
export function isWatchable(spool: FilamentSpool): boolean {
  return Boolean(spool.sourceUrl) && spool.autoUpdate !== false;
}

/** Verilen anda makaranin fiyati bayat mi? */
export function isStale(spool: FilamentSpool, intervalHours: number, now: number): boolean {
  if (!isWatchable(spool)) return false;
  const last = toTime(spool.lastCheckedAt);
  if (last === null) return true;
  return now - last >= Math.max(1, intervalHours) * HOUR_MS;
}

/** Bu turda güncellenmesi gereken makaralari döndürür. */
export function selectSpoolsToRefresh(
  spools: FilamentSpool[],
  settings: WatchSettings,
  now: number,
): FilamentSpool[] {
  if (!settings.enabled) return [];
  return spools.filter((spool) => isStale(spool, settings.intervalHours, now));
}

/** Bir sonraki kontrolün zamani (hicbir sey planli degilse null). */
export function nextRunAt(
  spools: FilamentSpool[],
  settings: WatchSettings,
  now: number,
): number | null {
  if (!settings.enabled) return null;
  const watchable = spools.filter(isWatchable);
  if (watchable.length === 0) return null;

  const times = watchable.map((spool) => {
    const last = toTime(spool.lastCheckedAt);
    return last === null ? now : last + settings.intervalHours * HOUR_MS;
  });
  return Math.min(...times);
}

export interface PriceUpdate {
  spool: FilamentSpool;
  /** Fiyat gercekten degisti mi? */
  changed: boolean;
  previousPrice: number;
  /** Yüzde degisim (artis pozitif). */
  deltaPct: number;
}

/**
 * Yeni okunan fiyati makaraya isler, gecmise ekler ve degisim oranini hesaplar.
 * Girdi nesnesi degistirilmez; yeni nesne döner.
 */
export function applyPriceUpdate(
  spool: FilamentSpool,
  newPrice: number,
  at: string,
  newWeight?: number | null,
): PriceUpdate {
  const previousPrice = spool.rollPrice;
  const valid = Number.isFinite(newPrice) && newPrice > 0;
  const price = valid ? Number(newPrice.toFixed(2)) : previousPrice;
  const changed = valid && Math.abs(price - previousPrice) > 0.009;

  const history: PriceSample[] = [...(spool.priceHistory ?? [])];
  if (history.length === 0) {
    history.push({ at: spool.updatedAt, price: previousPrice });
  }
  if (changed) history.push({ at, price });

  return {
    spool: {
      ...spool,
      rollPrice: price,
      rollWeight:
        newWeight && Number.isFinite(newWeight) && newWeight > 0
          ? Math.round(newWeight)
          : spool.rollWeight,
      lastCheckedAt: at,
      lastCheckStatus: changed ? 'ok' : 'unchanged',
      lastCheckError: undefined,
      updatedAt: changed ? at : spool.updatedAt,
      priceHistory: history.slice(-HISTORY_LIMIT),
    },
    changed,
    previousPrice,
    deltaPct: previousPrice > 0 ? ((price - previousPrice) / previousPrice) * 100 : 0,
  };
}

/** Basarisiz bir kontrolü makaraya isler. */
export function applyCheckFailure(spool: FilamentSpool, error: string, at: string): FilamentSpool {
  return { ...spool, lastCheckedAt: at, lastCheckStatus: 'failed', lastCheckError: error };
}

export interface RunSummary {
  checked: number;
  updated: number;
  failed: number;
  /** Kullaniciya gösterilecek özet metin. */
  message: string;
}

/** Bir güncelleme turunun sonucunu özetler. */
export function summarizeRun(updates: PriceUpdate[], failures: number): RunSummary {
  const updated = updates.filter((u) => u.changed).length;
  const checked = updates.length + failures;

  const parts: string[] = [];
  if (updated > 0) parts.push(`${updated} fiyat güncellendi`);
  if (updated === 0 && updates.length > 0) parts.push('fiyatlarda değişiklik yok');
  if (failures > 0) parts.push(`${failures} adres okunamadı`);
  if (parts.length === 0) parts.push('güncellenecek filament yok');

  return {
    checked,
    updated,
    failed: failures,
    message: `${checked} filament kontrol edildi — ${parts.join(', ')}.`,
  };
}
