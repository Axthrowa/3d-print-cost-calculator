import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_PRINTER,
  addRunHours,
  jobRunHours,
  lifetimeUsed,
  runHoursOf,
  runKey,
  sortRunHours,
  totalRunHours,
  type RunHours,
} from '../lib/tracking';
import type { PrintJob } from '../types';

const job = (over: Partial<PrintJob> = {}): PrintJob => ({
  id: 'j1',
  name: 'Vazo',
  printerName: 'Bambu Lab P1S',
  materials: [],
  grams: 50,
  estimatedHours: 4,
  status: 'done',
  startedAt: null,
  finishedAt: null,
  orderId: null,
  notes: '',
  ...over,
});

describe('runKey', () => {
  it('boş adı ortak anahtara toplar', () => {
    expect(runKey('')).toBe(UNKNOWN_PRINTER);
    expect(runKey('   ')).toBe(UNKNOWN_PRINTER);
    expect(runKey(null)).toBe(UNKNOWN_PRINTER);
  });

  it('adı kırpar', () => {
    expect(runKey('  Ender 3  ')).toBe('Ender 3');
  });
});

describe('jobRunHours', () => {
  it('gerçek süre varsa onu kullanır', () => {
    const j = job({
      startedAt: '2026-08-29T08:00:00.000Z',
      finishedAt: '2026-08-29T11:30:00.000Z',
    });
    expect(jobRunHours(j)).toBeCloseTo(3.5, 6);
  });

  it('gerçek süre yoksa tahminî süreyi kullanır', () => {
    expect(jobRunHours(job())).toBe(4);
  });

  it('ölçülen süre bir dakikadan kısaysa tahmine düşer', () => {
    // Kullanıcı baskı bitmişken Başlat + Tamamlandı derse ölçüm saniyeler olur.
    const j = job({
      startedAt: '2026-08-29T08:00:00.000Z',
      finishedAt: '2026-08-29T08:00:20.000Z',
    });
    expect(jobRunHours(j)).toBe(4);
  });

  it('tutarsız zaman damgasında tahmine düşer', () => {
    const j = job({
      startedAt: '2026-08-29T12:00:00.000Z',
      finishedAt: '2026-08-29T08:00:00.000Z',
    });
    expect(jobRunHours(j)).toBe(4);
  });

  it('negatif tahmini sıfırlar', () => {
    expect(jobRunHours(job({ estimatedHours: -3 }))).toBe(0);
  });
});

describe('addRunHours', () => {
  it('süre ekler', () => {
    const map = addRunHours({}, 'Ender 3', 2.5);
    expect(map['Ender 3']).toBeCloseTo(2.5, 6);
  });

  it('aynı yazıcıya biriktirir', () => {
    let map: RunHours = {};
    map = addRunHours(map, 'Ender 3', 2);
    map = addRunHours(map, 'Ender 3', 1.25);
    expect(map['Ender 3']).toBeCloseTo(3.25, 6);
  });

  it('negatif değer düşer', () => {
    const map = addRunHours({ 'Ender 3': 5 }, 'Ender 3', -2);
    expect(map['Ender 3']).toBeCloseTo(3, 6);
  });

  it('sıfırın altına inmez ve anahtarı temizler', () => {
    const map = addRunHours({ 'Ender 3': 1 }, 'Ender 3', -5);
    expect(map['Ender 3']).toBeUndefined();
  });

  it('girdiyi değiştirmez', () => {
    const original: RunHours = { 'Ender 3': 5 };
    addRunHours(original, 'Ender 3', 3);
    expect(original['Ender 3']).toBe(5);
  });

  it('sıfır saatte dokunmaz', () => {
    const original: RunHours = { a: 1 };
    expect(addRunHours(original, 'a', 0)).toBe(original);
  });

  it('ekle-geri al başa döndürür', () => {
    const start: RunHours = { P1S: 10 };
    const after = addRunHours(addRunHours(start, 'P1S', 3.5), 'P1S', -3.5);
    expect(after['P1S']).toBeCloseTo(10, 6);
  });
});

describe('totalRunHours / runHoursOf / sortRunHours', () => {
  const map: RunHours = { P1S: 12, 'Ender 3': 30, Bos: 0 };

  it('toplamı verir', () => {
    expect(totalRunHours(map)).toBe(42);
    expect(totalRunHours({})).toBe(0);
  });

  it('tek yazıcıyı okur', () => {
    expect(runHoursOf(map, 'P1S')).toBe(12);
    expect(runHoursOf(map, 'yok')).toBe(0);
  });

  it('çoktan aza sıralar ve sıfırı atar', () => {
    expect(sortRunHours(map)).toEqual([
      { name: 'Ender 3', hours: 30 },
      { name: 'P1S', hours: 12 },
    ]);
  });
});

describe('lifetimeUsed', () => {
  it('oranı verir', () => {
    expect(lifetimeUsed(1000, 5000)).toBeCloseTo(0.2, 6);
  });

  it('üst sınır 1', () => {
    expect(lifetimeUsed(9000, 5000)).toBe(1);
  });

  it('ömür bilinmiyorsa null', () => {
    expect(lifetimeUsed(100, undefined)).toBeNull();
    expect(lifetimeUsed(100, 0)).toBeNull();
  });
});
