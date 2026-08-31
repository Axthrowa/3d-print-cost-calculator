import type { CalculatorInputs, CostResult, CostSegment, FilamentSpool } from '../types';

/** Negatif, tanimsiz ve NaN degerleri sifira indirger. */
export function safe(n: number | null | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Bir makaranin gram başına fiyatını hesaplar (TL/g). */
export function pricePerGram(spool: Pick<FilamentSpool, 'rollPrice' | 'rollWeight'>): number {
  const weight = safe(spool.rollWeight);
  if (weight === 0) return 0;
  return safe(spool.rollPrice) / weight;
}

/**
 * Elektrik maliyeti: (Watt / 1000) * Saat * kWh Fiyatı
 */
export function electricityCost(watt: number, hours: number, kwhPrice: number): number {
  return (safe(watt) / 1000) * safe(hours) * safe(kwhPrice);
}

/**
 * Filament maliyeti: (Rulo Fiyatı / Rulo Gramajı) * Harcanan Gram
 */
export function filamentCost(rollPrice: number, rollWeight: number, gramsUsed: number): number {
  return pricePerGram({ rollPrice, rollWeight }) * safe(gramsUsed);
}

/** Saat + dakika girisini ondalikli saate cevirir. */
export function toHours(hours: number, minutes: number): number {
  return safe(hours) + safe(minutes) / 60;
}

const SEGMENT_COLORS = {
  filament: '#38bdf8',
  electricity: '#facc15',
  depreciation: '#a78bfa',
  failure: '#fb7185',
  labor: '#34d399',
  extra: '#fb923c',
  waste: '#f87171',
} as const;

/**
 * Tüm maliyet kalemlerini ve tavsiye edilen satış fiyatını hesaplar.
 *
 * Fire (başarısız baskı) payı yalnızca malzeme + enerji + amortisman toplamına
 * uygulanir; işçilik ve kar marjı fire üzerinden tekrar çarpılmaz.
 */
export function calculateCost(inputs: CalculatorInputs, spools: FilamentSpool[]): CostResult {
  const warnings: string[] = [];
  const spoolMap = new Map(spools.map((s) => [s.id, s]));
  const quantity = Math.max(1, Math.floor(safe(inputs.quantity) || 1));

  let unitModelFilament = 0;
  let unitWasteFilament = 0;
  let unitModelGrams = 0;
  let unitWasteGrams = 0;

  for (const usage of inputs.usages) {
    const grams = safe(usage.grams);
    const waste = safe(usage.wasteGrams);
    if (grams === 0 && waste === 0) continue;
    unitModelGrams += grams;
    unitWasteGrams += waste;

    const spool = usage.spoolId ? spoolMap.get(usage.spoolId) : undefined;
    if (!spool) {
      warnings.push('Bir filament satırı için makara seçilmedi, maliyete dahil edilmedi.');
      continue;
    }
    if (safe(spool.rollWeight) === 0) {
      warnings.push(`${spool.brand} ${spool.material}: rulo gramajı 0, maliyet hesaplanamadı.`);
      continue;
    }
    // Atık, atılan rengin kendi rulo fiyatı üzerinden ücretlendirilir.
    unitModelFilament += filamentCost(spool.rollPrice, spool.rollWeight, grams);
    unitWasteFilament += filamentCost(spool.rollPrice, spool.rollWeight, waste);
  }

  const unitFilament = unitModelFilament + unitWasteFilament;
  const unitGrams = unitModelGrams + unitWasteGrams;

  const unitHours = toHours(inputs.printHours, inputs.printMinutes);
  const unitEnergyKwh = (safe(inputs.printerWatts) / 1000) * unitHours;
  const unitElectricity = electricityCost(inputs.printerWatts, unitHours, inputs.kwhPrice);
  const unitDepreciation = safe(inputs.depreciationPerHour) * unitHours;

  const machineSubtotal = unitFilament + unitElectricity + unitDepreciation;
  const failureRate = Math.min(Math.max(safe(inputs.failureRatePct), 0), 100);
  const unitFailure = machineSubtotal * (failureRate / 100);

  const unitLabor = safe(inputs.laborRatePerHour) * (safe(inputs.laborMinutes) / 60);
  const unitExtra = safe(inputs.extraCost);

  const unitNet = machineSubtotal + unitFailure + unitLabor + unitExtra;
  const margin = Math.max(safe(inputs.marginPct), 0);
  const unitSaleExVat = unitNet * (1 + margin / 100);

  const filament = unitFilament * quantity;
  const modelFilament = unitModelFilament * quantity;
  const wasteFilament = unitWasteFilament * quantity;
  const electricity = unitElectricity * quantity;
  const depreciation = unitDepreciation * quantity;
  const failure = unitFailure * quantity;
  const labor = unitLabor * quantity;
  const extra = unitExtra * quantity;
  const netCost = unitNet * quantity;
  const salePriceExVat = unitSaleExVat * quantity;
  const marginAmount = salePriceExVat - netCost;
  const vatRate = inputs.vatEnabled ? Math.max(safe(inputs.vatPct), 0) : 0;
  const vatAmount = salePriceExVat * (vatRate / 100);
  const salePrice = salePriceExVat + vatAmount;

  if (unitGrams === 0) warnings.push('Baskı gramajı girilmedi.');
  if (unitHours === 0) warnings.push('Baskı süresi girilmedi.');
  if (safe(inputs.kwhPrice) === 0) warnings.push('Elektrik birim fiyatı 0 olarak alındı.');

  const segments: CostSegment[] = [
    { key: 'filament', label: 'Filament', value: modelFilament, color: SEGMENT_COLORS.filament },
    {
      key: 'waste',
      label: 'Atık (temizleme)',
      value: wasteFilament,
      color: SEGMENT_COLORS.waste,
    },
    {
      key: 'electricity',
      label: 'Elektrik',
      value: electricity,
      color: SEGMENT_COLORS.electricity,
    },
    {
      key: 'depreciation',
      label: 'Amortisman',
      value: depreciation,
      color: SEGMENT_COLORS.depreciation,
    },
    { key: 'failure', label: 'Fire riski', value: failure, color: SEGMENT_COLORS.failure },
    { key: 'labor', label: 'İşçilik', value: labor, color: SEGMENT_COLORS.labor },
    { key: 'extra', label: 'Ek giderler', value: extra, color: SEGMENT_COLORS.extra },
  ].filter((s) => s.value > 0.0000001);

  return {
    unit: {
      netCost: unitNet,
      salePrice: unitSaleExVat * (1 + vatRate / 100),
    },
    filamentCost: filament,
    modelFilamentCost: modelFilament,
    wasteFilamentCost: wasteFilament,
    electricityCost: electricity,
    depreciationCost: depreciation,
    failureCost: failure,
    laborCost: labor,
    extraCost: extra,
    riskAndDepreciationCost: depreciation + failure,
    netCost,
    marginAmount,
    salePriceExVat,
    vatAmount,
    salePrice,
    profit: marginAmount,
    totalHours: unitHours * quantity,
    totalGrams: unitGrams * quantity,
    modelGrams: unitModelGrams * quantity,
    wasteGrams: unitWasteGrams * quantity,
    energyKwh: unitEnergyKwh * quantity,
    quantity,
    segments,
    warnings: [...new Set(warnings)],
  };
}

/**
 * Yazıcı bedeli ve beklenen omurden saatlik amortisman onerir.
 */
export function suggestDepreciation(priceTRY: number, lifetimeHours: number): number {
  const life = safe(lifetimeHours);
  if (life === 0) return 0;
  return safe(priceTRY) / life;
}
