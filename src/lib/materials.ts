/**
 * Filament özkütleleri ve STL hacminden gramaj tahmini.
 */

import type { Material } from '../types';

/** Malzeme özkütleleri (g/cm³) — üretici teknik föylerinin tipik değerleri. */
export const DENSITIES: Record<Material, number> = {
  PLA: 1.24,
  'PLA+': 1.24,
  'PLA Silk': 1.23,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
  NYLON: 1.14,
  PC: 1.2,
  PVA: 1.23,
  HIPS: 1.04,
  'PA-CF': 1.15,
  'PET-CF': 1.3,
  Diger: 1.24,
};

/** Bir malzemenin özkütlesi; bilinmeyende PLA değeri döner. */
export function densityOf(material: string | null | undefined): number {
  if (!material) return DENSITIES.PLA;
  const key = material.toUpperCase().trim();
  const found = (Object.keys(DENSITIES) as Material[]).find((m) => m.toUpperCase() === key);
  return found ? DENSITIES[found] : DENSITIES.PLA;
}

export interface WeightEstimateInput {
  volumeCm3: number;
  surfaceAreaCm2: number;
  /** Kabuk (duvar + üst/alt katman) kalınlığı, mm. */
  wallThicknessMm: number;
  /** İç dolgu oranı, %. */
  infillPct: number;
  /** Özkütle, g/cm³. */
  density: number;
}

export interface WeightEstimate {
  /** Kabuğun kapladığı hacim (cm³). */
  shellCm3: number;
  /** Dolgunun kapladığı hacim (cm³). */
  infillCm3: number;
  /** Toplam malzeme hacmi (cm³). */
  materialCm3: number;
  grams: number;
  /** Modelin tamamı dolu basılsaydı (cm³). */
  solidGrams: number;
}

/**
 * Yaklaşık filament gramajını hesaplar.
 *
 * Model iki parçaya ayrılır:
 *   kabuk  = yüzey alanı × duvar kalınlığı   (perimetreler + üst/alt katmanlar)
 *   içeriz = toplam hacim − kabuk            (yalnızca dolgu oranı kadar dolu)
 *
 * Bu, "hacim × dolgu %" gibi düz bir çarpımdan belirgin biçimde daha
 * gerçekçidir: %10 dolguyla basılan bir parça asla kütlesinin %10'u kadar
 * olmaz, çünkü duvarlar her zaman doludur.
 */
export function estimateWeight(input: WeightEstimateInput): WeightEstimate {
  const volume = Math.max(0, input.volumeCm3);
  const area = Math.max(0, input.surfaceAreaCm2);
  const wallCm = Math.max(0, input.wallThicknessMm) / 10;
  const infill = Math.min(100, Math.max(0, input.infillPct)) / 100;
  const density = Math.max(0, input.density);

  const shellCm3 = Math.min(volume, area * wallCm);
  const innerCm3 = Math.max(0, volume - shellCm3);
  const infillCm3 = innerCm3 * infill;
  const materialCm3 = shellCm3 + infillCm3;

  return {
    shellCm3,
    infillCm3,
    materialCm3,
    grams: materialCm3 * density,
    solidGrams: volume * density,
  };
}
