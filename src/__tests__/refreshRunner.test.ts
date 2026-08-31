import { describe, expect, it, vi } from 'vitest';
import { mergeSpools, refreshSpools, type FetchedPrice } from '../lib/refreshRunner';
import type { FilamentSpool } from '../types';

const AT = '2026-08-29T12:00:00.000Z';

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

const priced = (price: number | null, weightGrams: number | null = null): FetchedPrice => ({
  ok: price !== null,
  price,
  weightGrams,
  warnings: price === null ? ['Fiyat bulunamadı.'] : [],
});

describe('refreshSpools', () => {
  it('fiyatı okur ve değişeni işaretler', async () => {
    const result = await refreshSpools([spool()], async () => priced(720), AT);
    expect(result.updated.get('s1')?.rollPrice).toBe(720);
    expect(result.changes).toHaveLength(1);
    expect(result.summary.updated).toBe(1);
    expect(result.summary.failed).toBe(0);
  });

  it('fiyat aynıysa değişiklik saymaz ama kontrolü kaydeder', async () => {
    const result = await refreshSpools([spool()], async () => priced(600), AT);
    expect(result.changes).toHaveLength(0);
    expect(result.updated.get('s1')?.lastCheckedAt).toBe(AT);
    expect(result.updated.get('s1')?.lastCheckStatus).toBe('unchanged');
  });

  it('fiyat bulunamazsa başarısız olarak işaretler', async () => {
    const result = await refreshSpools([spool()], async () => priced(null), AT);
    expect(result.updated.get('s1')?.lastCheckStatus).toBe('failed');
    expect(result.updated.get('s1')?.rollPrice).toBe(600);
    expect(result.summary.failed).toBe(1);
  });

  it('bir adres patlarsa tur durmaz, diğerleri işlenir', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('kirik')) throw new Error('Sayfaya bağlanılamadı.');
      return priced(800);
    });
    const result = await refreshSpools(
      [
        spool({ id: 'a', sourceUrl: 'https://ornek.com/kirik' }),
        spool({ id: 'b', sourceUrl: 'https://ornek.com/saglam' }),
      ],
      fetcher,
      AT,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.updated.get('a')?.lastCheckStatus).toBe('failed');
    expect(result.updated.get('a')?.lastCheckError).toBe('Sayfaya bağlanılamadı.');
    expect(result.updated.get('b')?.rollPrice).toBe(800);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.updated).toBe(1);
  });

  it('adressiz makarayı atlar', async () => {
    const fetcher = vi.fn(async () => priced(500));
    const result = await refreshSpools([spool({ sourceUrl: undefined })], fetcher, AT);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.updated.size).toBe(0);
  });

  it('yeni gramajı da işler', async () => {
    const result = await refreshSpools([spool()], async () => priced(700, 750), AT);
    expect(result.updated.get('s1')?.rollWeight).toBe(750);
  });

  it('boş listede özet uygun mesaj verir', async () => {
    const result = await refreshSpools([], async () => priced(1), AT);
    expect(result.summary.checked).toBe(0);
    expect(result.summary.message).toContain('güncellenecek filament yok');
  });
});

describe('mergeSpools', () => {
  it('sırayı koruyarak günceller', () => {
    const list = [spool({ id: 'a' }), spool({ id: 'b' }), spool({ id: 'c' })];
    const merged = mergeSpools(list, new Map([['b', spool({ id: 'b', rollPrice: 999 })]]));
    expect(merged.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1].rollPrice).toBe(999);
    expect(merged[0]).toBe(list[0]);
  });

  it('güncelleme yoksa aynı diziyi döndürür', () => {
    const list = [spool()];
    expect(mergeSpools(list, new Map())).toBe(list);
  });
});
