import { describe, expect, it } from 'vitest';
import {
  calculateCost,
  electricityCost,
  filamentCost,
  pricePerGram,
  safe,
  suggestDepreciation,
  toHours,
} from '../lib/costEngine';
import type { CalculatorInputs, FilamentSpool } from '../types';

const spool = (over: Partial<FilamentSpool> = {}): FilamentSpool => ({
  id: 's1',
  brand: 'Porima',
  material: 'PLA',
  color: 'Siyah',
  rollPrice: 600,
  rollWeight: 1000,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const inputs = (over: Partial<CalculatorInputs> = {}): CalculatorInputs => ({
  usages: [{ id: 'u1', spoolId: 's1', grams: 100 }],
  printHours: 5,
  printMinutes: 0,
  quantity: 1,
  printerWatts: 200,
  kwhPrice: 3,
  depreciationPerHour: 0,
  failureRatePct: 0,
  laborRatePerHour: 0,
  laborMinutes: 0,
  extraCost: 0,
  marginPct: 0,
  vatEnabled: false,
  vatPct: 20,
  ...over,
});

describe('yardimci fonksiyonlar', () => {
  it('safe negatif ve gecersiz degerleri sifirlar', () => {
    expect(safe(5)).toBe(5);
    expect(safe(-3)).toBe(0);
    expect(safe(Number.NaN)).toBe(0);
    expect(safe(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('toHours saat ve dakikayi ondalikli saate cevirir', () => {
    expect(toHours(4, 30)).toBe(4.5);
    expect(toHours(0, 90)).toBe(1.5);
    expect(toHours(2, 0)).toBe(2);
  });
});

describe('Elektrik Maliyeti = (Watt / 1000) x Saat x kWh Fiyati', () => {
  it('200 W, 5 sa, 3 TL/kWh -> 3.00 TL', () => {
    // (200/1000) * 5 * 3 = 3
    expect(electricityCost(200, 5, 3)).toBeCloseTo(3, 10);
  });

  it('1000 W, 1 sa, 4.25 TL/kWh -> 4.25 TL', () => {
    expect(electricityCost(1000, 1, 4.25)).toBeCloseTo(4.25, 10);
  });

  it('ondalikli sure ile dogru calisir', () => {
    // (150/1000) * 7.5 * 3.6 = 4.05
    expect(electricityCost(150, 7.5, 3.6)).toBeCloseTo(4.05, 10);
  });

  it('sifir/negatif girdilerde sifir doner', () => {
    expect(electricityCost(0, 5, 3)).toBe(0);
    expect(electricityCost(-200, 5, 3)).toBe(0);
    expect(electricityCost(200, 5, -1)).toBe(0);
  });
});

describe('Filament Maliyeti = (Rulo Fiyati / Rulo Gramaji) x Harcanan Gram', () => {
  it('600 TL / 1000 g x 100 g -> 60 TL', () => {
    expect(filamentCost(600, 1000, 100)).toBeCloseTo(60, 10);
  });

  it('750 g makarada dogru oransal hesap yapar', () => {
    // (450/750) * 250 = 150
    expect(filamentCost(450, 750, 250)).toBeCloseTo(150, 10);
  });

  it('gram fiyati dogru hesaplanir', () => {
    expect(pricePerGram({ rollPrice: 600, rollWeight: 1000 })).toBeCloseTo(0.6, 10);
  });

  it('rulo gramaji sifirsa sifira bolme yapmaz', () => {
    expect(filamentCost(600, 0, 100)).toBe(0);
    expect(pricePerGram({ rollPrice: 600, rollWeight: 0 })).toBe(0);
  });
});

describe('calculateCost', () => {
  it('temel senaryoyu ucdan uca dogrular', () => {
    const result = calculateCost(inputs(), [spool()]);
    expect(result.filamentCost).toBeCloseTo(60, 10); // 100 g * 0.6
    expect(result.electricityCost).toBeCloseTo(3, 10); // 0.2 kW * 5 sa * 3
    expect(result.netCost).toBeCloseTo(63, 10);
    expect(result.energyKwh).toBeCloseTo(1, 10);
    expect(result.totalGrams).toBe(100);
  });

  it('amortisman saat basina uygulanir', () => {
    const result = calculateCost(inputs({ depreciationPerHour: 4 }), [spool()]);
    expect(result.depreciationCost).toBeCloseTo(20, 10); // 4 TL * 5 sa
    expect(result.netCost).toBeCloseTo(83, 10);
  });

  it('fire orani malzeme+enerji+amortisman toplamina uygulanir', () => {
    const result = calculateCost(inputs({ depreciationPerHour: 4, failureRatePct: 10 }), [spool()]);
    // (60 + 3 + 20) * 0.10 = 8.3
    expect(result.failureCost).toBeCloseTo(8.3, 10);
    expect(result.netCost).toBeCloseTo(91.3, 10);
    expect(result.riskAndDepreciationCost).toBeCloseTo(28.3, 10);
  });

  it('fire orani iscilik ve ek giderleri sismez', () => {
    const withLabor = calculateCost(
      inputs({ failureRatePct: 10, laborRatePerHour: 120, laborMinutes: 30, extraCost: 5 }),
      [spool()],
    );
    expect(withLabor.failureCost).toBeCloseTo(6.3, 10); // sadece (60+3) uzerinden
    expect(withLabor.laborCost).toBeCloseTo(60, 10); // 120 TL/sa * 0.5 sa
    expect(withLabor.netCost).toBeCloseTo(60 + 3 + 6.3 + 60 + 5, 10);
  });

  it('kar marji satis fiyatini dogru uretir', () => {
    const result = calculateCost(inputs({ marginPct: 50 }), [spool()]);
    expect(result.netCost).toBeCloseTo(63, 10);
    expect(result.salePriceExVat).toBeCloseTo(94.5, 10);
    expect(result.marginAmount).toBeCloseTo(31.5, 10);
    expect(result.salePrice).toBeCloseTo(94.5, 10); // KDV kapali
  });

  it('KDV acikken satis fiyatina eklenir', () => {
    const result = calculateCost(inputs({ marginPct: 50, vatEnabled: true, vatPct: 20 }), [
      spool(),
    ]);
    expect(result.vatAmount).toBeCloseTo(18.9, 10);
    expect(result.salePrice).toBeCloseTo(113.4, 10);
  });

  it('adet tum kalemleri olcekler, birim degerleri korur', () => {
    const result = calculateCost(inputs({ quantity: 3, marginPct: 100 }), [spool()]);
    expect(result.unit.netCost).toBeCloseTo(63, 10);
    expect(result.netCost).toBeCloseTo(189, 10);
    expect(result.totalGrams).toBe(300);
    expect(result.salePrice).toBeCloseTo(378, 10);
  });

  it('birden fazla filamenti toplar', () => {
    const result = calculateCost(
      inputs({
        usages: [
          { id: 'u1', spoolId: 's1', grams: 100 },
          { id: 'u2', spoolId: 's2', grams: 50 },
        ],
      }),
      [spool(), spool({ id: 's2', rollPrice: 900, rollWeight: 1000, material: 'PETG' })],
    );
    // 100*0.6 + 50*0.9 = 105
    expect(result.filamentCost).toBeCloseTo(105, 10);
    expect(result.totalGrams).toBe(150);
  });

  it('secilmemis makara icin uyari verir ve maliyete katmaz', () => {
    const result = calculateCost(inputs({ usages: [{ id: 'u1', spoolId: null, grams: 100 }] }), [
      spool(),
    ]);
    expect(result.filamentCost).toBe(0);
    expect(result.warnings.some((w) => w.includes('makara seçilmedi'))).toBe(true);
  });

  it('bos girdilerde cokmez ve sifir doner', () => {
    const result = calculateCost(
      inputs({
        usages: [],
        printHours: 0,
        printMinutes: 0,
        printerWatts: 0,
        kwhPrice: 0,
      }),
      [],
    );
    expect(result.netCost).toBe(0);
    expect(result.salePrice).toBe(0);
    expect(result.segments).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('negatif ve NaN girdilere karsi dayaniklidir', () => {
    const result = calculateCost(
      inputs({
        printerWatts: -100,
        kwhPrice: Number.NaN,
        failureRatePct: -20,
        marginPct: -50,
        quantity: 0,
      }),
      [spool()],
    );
    expect(Number.isFinite(result.netCost)).toBe(true);
    expect(result.electricityCost).toBe(0);
    expect(result.failureCost).toBe(0);
    expect(result.quantity).toBe(1);
  });

  it('fire orani %100 ile sinirlandirilir', () => {
    const result = calculateCost(inputs({ failureRatePct: 400 }), [spool()]);
    expect(result.failureCost).toBeCloseTo(63, 10);
  });

  it('grafik dilimleri yalnizca pozitif kalemleri icerir', () => {
    const result = calculateCost(inputs({ depreciationPerHour: 2, extraCost: 0 }), [spool()]);
    const keys = result.segments.map((s) => s.key);
    expect(keys).toContain('filament');
    expect(keys).toContain('electricity');
    expect(keys).toContain('depreciation');
    expect(keys).not.toContain('extra');
  });

  it('dilimlerin toplami net maliyete esittir', () => {
    const result = calculateCost(
      inputs({
        depreciationPerHour: 3,
        failureRatePct: 7,
        laborRatePerHour: 200,
        laborMinutes: 15,
        extraCost: 12,
      }),
      [spool()],
    );
    const sum = result.segments.reduce((acc, segment) => acc + segment.value, 0);
    expect(sum).toBeCloseTo(result.netCost, 8);
  });
});

describe('suggestDepreciation', () => {
  it('cihaz bedelini omre boler', () => {
    expect(suggestDepreciation(20000, 4000)).toBeCloseTo(5, 10);
  });

  it('omur sifirsa sifir doner', () => {
    expect(suggestDepreciation(20000, 0)).toBe(0);
  });
});
