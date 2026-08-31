import { describe, expect, it } from 'vitest';
import {
  LOW_STOCK_RATIO,
  checkAvailability,
  consume,
  groupBySpool,
  refill,
  remainingOf,
  remainingRatio,
  restore,
  setRemaining,
  stockLevel,
  summarizeStock,
} from '../lib/inventory';
import type { FilamentSpool, JobMaterial } from '../types';

const spool = (over: Partial<FilamentSpool> = {}): FilamentSpool => ({
  id: 's1',
  brand: 'Porima',
  material: 'PLA',
  color: 'Siyah',
  rollPrice: 600,
  rollWeight: 1000,
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const mat = (spoolId: string | null, grams: number): JobMaterial => ({ spoolId, grams });

describe('remainingOf', () => {
  it('alan yoksa makara dolu sayılır', () => {
    expect(remainingOf(spool())).toBe(1000);
  });

  it('yazılı değeri kullanır', () => {
    expect(remainingOf(spool({ remainingGrams: 250 }))).toBe(250);
  });

  it('negatif ve bozuk değerleri sıfırlar', () => {
    expect(remainingOf(spool({ remainingGrams: -50 }))).toBe(0);
    expect(remainingOf(spool({ remainingGrams: Number.NaN }))).toBe(1000);
  });
});

describe('stockLevel / remainingRatio', () => {
  it('dolu makara ok', () => {
    expect(stockLevel(spool({ remainingGrams: 900 }))).toBe('ok');
    expect(remainingRatio(spool({ remainingGrams: 900 }))).toBeCloseTo(0.9, 6);
  });

  it('eşik altı az kaldı', () => {
    expect(stockLevel(spool({ remainingGrams: 1000 * LOW_STOCK_RATIO }))).toBe('low');
    expect(stockLevel(spool({ remainingGrams: 100 }))).toBe('low');
  });

  it('sıfır boş', () => {
    expect(stockLevel(spool({ remainingGrams: 0 }))).toBe('empty');
  });

  it('rulo ağırlığı sıfırsa çökmez', () => {
    expect(remainingRatio(spool({ rollWeight: 0 }))).toBe(0);
  });
});

describe('groupBySpool', () => {
  it('aynı makaranın satırlarını toplar', () => {
    const totals = groupBySpool([mat('a', 10), mat('b', 5), mat('a', 7)]);
    expect(totals.get('a')).toBe(17);
    expect(totals.get('b')).toBe(5);
  });

  it('boş ve geçersiz satırları atar', () => {
    const totals = groupBySpool([mat(null, 10), mat('a', 0), mat('a', -5)]);
    expect(totals.size).toBe(0);
  });
});

describe('consume', () => {
  const spools = [
    spool({ id: 'pla', remainingGrams: 500 }),
    spool({ id: 'petg', remainingGrams: 800 }),
  ];

  it('kullanılan miktarı düşer', () => {
    const result = consume(spools, [mat('pla', 120), mat('petg', 40)]);
    expect(remainingOf(result.spools[0])).toBe(380);
    expect(remainingOf(result.spools[1])).toBe(760);
    expect(result.appliedGrams).toBe(160);
    expect(result.warnings).toEqual([]);
  });

  it('girdiyi değiştirmez', () => {
    consume(spools, [mat('pla', 100)]);
    expect(spools[0].remainingGrams).toBe(500);
  });

  it('stok yetmezse eksiye düşmez ve uyarır', () => {
    const result = consume(spools, [mat('pla', 700)]);
    expect(remainingOf(result.spools[0])).toBe(0);
    expect(result.appliedGrams).toBe(500);
    expect(result.warnings.join(' ')).toContain('eksik kaldı');
  });

  it('envanterde olmayan makarayı uyarır', () => {
    const result = consume(spools, [mat('yok', 50)]);
    expect(result.warnings.join(' ')).toContain('Envanterde olmayan');
  });

  it('boş malzemede dokunmaz', () => {
    const result = consume(spools, []);
    expect(result.spools).toBe(spools);
    expect(result.appliedGrams).toBe(0);
  });

  it('aynı makaradan çoklu satırı birleştirir', () => {
    const result = consume(spools, [mat('pla', 100), mat('pla', 50)]);
    expect(remainingOf(result.spools[0])).toBe(350);
  });
});

describe('restore', () => {
  it('düşülen miktarı geri verir', () => {
    const spools = [spool({ id: 'pla', remainingGrams: 380 })];
    const result = restore(spools, [mat('pla', 120)]);
    expect(remainingOf(result.spools[0])).toBe(500);
  });

  it('rulo kapasitesini aşmaz', () => {
    const spools = [spool({ id: 'pla', remainingGrams: 950 })];
    const result = restore(spools, [mat('pla', 200)]);
    expect(remainingOf(result.spools[0])).toBe(1000);
  });

  it('düş-geri al döngüsü başa döndürür', () => {
    const spools = [spool({ id: 'pla', remainingGrams: 640 })];
    const materials = [mat('pla', 140)];
    const after = restore(consume(spools, materials).spools, materials);
    expect(remainingOf(after.spools[0])).toBe(640);
  });
});

describe('refill / setRemaining', () => {
  it('doldurma kalanı kapasiteye çeker', () => {
    const result = refill([spool({ remainingGrams: 12 })], 's1');
    expect(remainingOf(result[0])).toBe(1000);
  });

  it('elle ayarlama sınırları korur', () => {
    expect(remainingOf(setRemaining([spool()], 's1', 5000)[0])).toBe(1000);
    expect(remainingOf(setRemaining([spool()], 's1', -20)[0])).toBe(0);
    expect(remainingOf(setRemaining([spool()], 's1', 333)[0])).toBe(333);
  });

  it('başka makarayı etkilemez', () => {
    const spools = [
      spool({ id: 'a', remainingGrams: 100 }),
      spool({ id: 'b', remainingGrams: 200 }),
    ];
    const result = refill(spools, 'a');
    expect(remainingOf(result[1])).toBe(200);
  });
});

describe('summarizeStock', () => {
  it('kalan miktarı, değeri ve uyarıları sayar', () => {
    const summary = summarizeStock([
      spool({ id: 'a', remainingGrams: 500 }),
      spool({ id: 'b', remainingGrams: 100 }),
      spool({ id: 'c', remainingGrams: 0 }),
    ]);
    expect(summary.totalRemaining).toBe(600);
    expect(summary.totalCapacity).toBe(3000);
    // 600 g x 0,60 TL/g = 360 TL
    expect(summary.value).toBeCloseTo(360, 6);
    expect(summary.low).toBe(1);
    expect(summary.empty).toBe(1);
  });

  it('boş envanterde çökmez', () => {
    const summary = summarizeStock([]);
    expect(summary.totalRemaining).toBe(0);
    expect(summary.value).toBe(0);
  });
});

describe('checkAvailability', () => {
  const spools = [spool({ id: 'pla', remainingGrams: 100 })];

  it('yeterli stokta ok döner', () => {
    expect(checkAvailability(spools, [mat('pla', 80)]).ok).toBe(true);
  });

  it('eksik olanı bildirir', () => {
    const result = checkAvailability(spools, [mat('pla', 150)]);
    expect(result.ok).toBe(false);
    expect(result.shortages[0]).toMatchObject({ need: 150, have: 100 });
  });

  it('bilinmeyen makarayı eksik saymaz', () => {
    expect(checkAvailability(spools, [mat('yok', 999)]).ok).toBe(true);
  });
});
