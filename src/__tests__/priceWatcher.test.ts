import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  applyCheckFailure,
  applyPriceUpdate,
  isStale,
  isWatchable,
  nextRunAt,
  selectSpoolsToRefresh,
  summarizeRun,
} from '../lib/priceWatcher';
import type { FilamentSpool, WatchSettings } from '../types';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const spool = (over: Partial<FilamentSpool> = {}): FilamentSpool => ({
  id: 's1',
  brand: 'Porima',
  material: 'PLA',
  color: 'Siyah',
  rollPrice: 600,
  rollWeight: 1000,
  sourceUrl: 'https://ornek.com/pla',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const settings = (over: Partial<WatchSettings> = {}): WatchSettings => ({
  enabled: true,
  intervalHours: 24,
  lastRunAt: null,
  ...over,
});

describe('isWatchable', () => {
  it('adresi olan ve kapatılmamış makaraları izler', () => {
    expect(isWatchable(spool())).toBe(true);
    expect(isWatchable(spool({ autoUpdate: true }))).toBe(true);
  });

  it('adressiz veya kapatılmış makaraları izlemez', () => {
    expect(isWatchable(spool({ sourceUrl: undefined }))).toBe(false);
    expect(isWatchable(spool({ autoUpdate: false }))).toBe(false);
  });
});

describe('isStale', () => {
  it('hiç kontrol edilmemişse bayattır', () => {
    expect(isStale(spool(), 24, NOW)).toBe(true);
  });

  it('aralık dolmadan bayat sayılmaz', () => {
    const recent = new Date(NOW - 2 * HOUR).toISOString();
    expect(isStale(spool({ lastCheckedAt: recent }), 24, NOW)).toBe(false);
  });

  it('aralık dolduğunda bayat olur', () => {
    const old = new Date(NOW - 25 * HOUR).toISOString();
    expect(isStale(spool({ lastCheckedAt: old }), 24, NOW)).toBe(true);
  });

  it('sınır anında (tam aralık) bayat sayılır', () => {
    const exact = new Date(NOW - 24 * HOUR).toISOString();
    expect(isStale(spool({ lastCheckedAt: exact }), 24, NOW)).toBe(true);
  });

  it('bozuk tarih bayat kabul edilir', () => {
    expect(isStale(spool({ lastCheckedAt: 'gecersiz' }), 24, NOW)).toBe(true);
  });

  it('izlenmeyen makara asla bayat değildir', () => {
    expect(isStale(spool({ autoUpdate: false }), 24, NOW)).toBe(false);
  });
});

describe('selectSpoolsToRefresh', () => {
  it('takip kapalıyken hiçbir şey seçmez', () => {
    expect(selectSpoolsToRefresh([spool()], settings({ enabled: false }), NOW)).toHaveLength(0);
  });

  it('yalnızca bayat ve izlenebilir olanları seçer', () => {
    const list = [
      spool({ id: 'a' }),
      spool({ id: 'b', lastCheckedAt: new Date(NOW - HOUR).toISOString() }),
      spool({ id: 'c', sourceUrl: undefined }),
      spool({ id: 'd', autoUpdate: false }),
    ];
    expect(selectSpoolsToRefresh(list, settings(), NOW).map((s) => s.id)).toEqual(['a']);
  });
});

describe('nextRunAt', () => {
  it('takip kapalıyken null döner', () => {
    expect(nextRunAt([spool()], settings({ enabled: false }), NOW)).toBeNull();
  });

  it('izlenecek makara yoksa null döner', () => {
    expect(nextRunAt([spool({ sourceUrl: undefined })], settings(), NOW)).toBeNull();
  });

  it('en erken zamanı döndürür', () => {
    const list = [
      spool({ id: 'a', lastCheckedAt: new Date(NOW - 20 * HOUR).toISOString() }),
      spool({ id: 'b', lastCheckedAt: new Date(NOW - 2 * HOUR).toISOString() }),
    ];
    expect(nextRunAt(list, settings(), NOW)).toBe(NOW - 20 * HOUR + 24 * HOUR);
  });
});

describe('applyPriceUpdate', () => {
  const at = '2026-08-29T12:00:00.000Z';

  it('fiyat değiştiğinde günceller ve geçmişe yazar', () => {
    const result = applyPriceUpdate(spool(), 750, at);
    expect(result.changed).toBe(true);
    expect(result.spool.rollPrice).toBe(750);
    expect(result.previousPrice).toBe(600);
    expect(result.deltaPct).toBeCloseTo(25, 6);
    expect(result.spool.lastCheckStatus).toBe('ok');
    expect(result.spool.priceHistory).toHaveLength(2);
    expect(result.spool.priceHistory?.at(-1)).toEqual({ at, price: 750 });
  });

  it('fiyat aynıysa değişiklik yazmaz ama kontrol zamanını günceller', () => {
    const result = applyPriceUpdate(spool(), 600, at);
    expect(result.changed).toBe(false);
    expect(result.spool.rollPrice).toBe(600);
    expect(result.spool.lastCheckStatus).toBe('unchanged');
    expect(result.spool.updatedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(result.spool.lastCheckedAt).toBe(at);
  });

  it('kuruş altı farkı değişiklik saymaz', () => {
    expect(applyPriceUpdate(spool(), 600.004, at).changed).toBe(false);
  });

  it('geçersiz fiyatta eski fiyatı korur', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const result = applyPriceUpdate(spool(), bad, at);
      expect(result.spool.rollPrice).toBe(600);
      expect(result.changed).toBe(false);
    }
  });

  it('yeni gramaj verildiyse günceller, verilmediyse korur', () => {
    expect(applyPriceUpdate(spool(), 700, at, 750).spool.rollWeight).toBe(750);
    expect(applyPriceUpdate(spool(), 700, at, null).spool.rollWeight).toBe(1000);
    expect(applyPriceUpdate(spool(), 700, at, 0).spool.rollWeight).toBe(1000);
  });

  it('geçmişi üst sınırda tutar', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => ({
      at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      price: 500 + i,
    }));
    const result = applyPriceUpdate(spool({ priceHistory: history }), 999, at);
    expect(result.spool.priceHistory).toHaveLength(HISTORY_LIMIT);
    expect(result.spool.priceHistory?.at(-1)?.price).toBe(999);
  });

  it('girdi nesnesini değiştirmez', () => {
    const original = spool();
    applyPriceUpdate(original, 900, at);
    expect(original.rollPrice).toBe(600);
    expect(original.lastCheckedAt).toBeUndefined();
  });

  it('düşüşte negatif yüzde verir', () => {
    expect(applyPriceUpdate(spool(), 450, at).deltaPct).toBeCloseTo(-25, 6);
  });
});

describe('applyCheckFailure', () => {
  it('hata bilgisini işler, fiyata dokunmaz', () => {
    const result = applyCheckFailure(spool(), 'Sayfa açılamadı', '2026-08-29T12:00:00.000Z');
    expect(result.lastCheckStatus).toBe('failed');
    expect(result.lastCheckError).toBe('Sayfa açılamadı');
    expect(result.rollPrice).toBe(600);
  });
});

describe('summarizeRun', () => {
  const at = '2026-08-29T12:00:00.000Z';

  it('güncellenen ve başarısız sayısını bildirir', () => {
    const updates = [applyPriceUpdate(spool(), 700, at), applyPriceUpdate(spool(), 600, at)];
    const summary = summarizeRun(updates, 1);
    expect(summary.checked).toBe(3);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.message).toContain('1 fiyat güncellendi');
    expect(summary.message).toContain('1 adres okunamadı');
  });

  it('değişiklik yoksa bunu söyler', () => {
    const summary = summarizeRun([applyPriceUpdate(spool(), 600, at)], 0);
    expect(summary.message).toContain('değişiklik yok');
  });

  it('hiç iş yoksa uygun mesaj verir', () => {
    expect(summarizeRun([], 0).message).toContain('güncellenecek filament yok');
  });
});
