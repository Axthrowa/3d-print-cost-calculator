/**
 * Gösterge paneli hesapları.
 *
 * Ay sınırı, "şu an" dışarıdan verilerek belirlenir; böylece testler takvime
 * bağlı kalmaz. Ciro yalnızca İPTAL EDİLMEMİŞ siparişlerden sayılır, kâr ise
 * satış ile maliyet farkıdır — işçilik dahil, çünkü işçilik de maliyettir.
 */

import { priceOrder } from './catalog';
import { colorToHex } from './filamentParser';
import type { CalculatorInputs, FilamentSpool, Order, OrderStatus, PrintJob } from '../types';

/** YYYY-AA biçiminde ay anahtarı. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export interface MoneySummary {
  revenue: number;
  cost: number;
  profit: number;
  orderCount: number;
  /** Kâr / ciro; ciro sıfırsa null. */
  margin: number | null;
}

const COUNTED: OrderStatus[] = ['pending', 'printing', 'ready', 'delivered'];

/** Bir ayın (veya tüm zamanların) ciro ve kâr özeti. */
export function summarizeMoney(
  orders: Order[],
  spools: FilamentSpool[],
  inputs: CalculatorInputs,
  month: string | null,
): MoneySummary {
  let revenue = 0;
  let cost = 0;
  let orderCount = 0;

  for (const order of orders) {
    if (!COUNTED.includes(order.status)) continue;
    if (month && monthKey(order.createdAt) !== month) continue;
    const pricing = priceOrder(order, spools, inputs);
    revenue += pricing.salePrice;
    cost += pricing.netCost;
    orderCount += 1;
  }

  const round = (value: number) => Math.round(value * 100) / 100;
  const profit = round(revenue - cost);
  return {
    revenue: round(revenue),
    cost: round(cost),
    profit,
    orderCount,
    margin: revenue > 0 ? profit / revenue : null,
  };
}

export interface RankedItem {
  label: string;
  value: number;
  /** Grafikte kullanılacak renk (varsa). */
  color?: string;
}

/** En çok satan ürünler: kalem adına göre toplam adet. */
export function topProducts(orders: Order[], limit = 5): RankedItem[] {
  const totals = new Map<string, number>();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items) {
      const quantity = Math.max(0, Math.round(item.quantity));
      if (quantity === 0) continue;
      totals.set(item.name, (totals.get(item.name) ?? 0) + quantity);
    }
  }
  return rank(totals, limit);
}

/**
 * En çok kullanılan filamentler: tamamlanan baskılarda harcanan gram.
 * Yalnızca stoktan gerçekten düşülmüş işler sayılır; tahmin değil, gerçek
 * tüketim istenmektedir.
 */
export function topFilaments(jobs: PrintJob[], spools: FilamentSpool[], limit = 5): RankedItem[] {
  const byId = new Map(spools.map((spool) => [spool.id, spool]));
  const totals = new Map<string, number>();
  const colors = new Map<string, string>();

  for (const job of jobs) {
    if (!job.consumed) continue;
    for (const material of job.materials) {
      if (!material.spoolId || material.grams <= 0) continue;
      const spool = byId.get(material.spoolId);
      if (!spool) continue;
      const label = `${spool.color || spool.material} · ${spool.brand}`;
      totals.set(label, (totals.get(label) ?? 0) + material.grams);
      const hex = material.colorHex ?? colorToHex(spool.color);
      if (hex) colors.set(label, hex);
    }
  }

  return rank(totals, limit).map((entry) => ({
    ...entry,
    ...(colors.has(entry.label) ? { color: colors.get(entry.label) } : {}),
  }));
}

/** Yazıcı doluluğu: toplam çalışma saatine göre pay. */
export function printerLoad(hours: Record<string, number>, limit = 6): RankedItem[] {
  const totals = new Map<string, number>();
  for (const [name, value] of Object.entries(hours)) {
    if (value > 0) totals.set(name, Math.round(value * 10) / 10);
  }
  return rank(totals, limit);
}

function rank(totals: Map<string, number>, limit: number): RankedItem[] {
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'tr'))
    .slice(0, Math.max(1, limit));
}

/** Son N ayın ciro dizisi; çubuk grafikte kullanılır. */
export function monthlyRevenue(
  orders: Order[],
  spools: FilamentSpool[],
  inputs: CalculatorInputs,
  months: string[],
): RankedItem[] {
  return months.map((month) => ({
    label: month,
    value: summarizeMoney(orders, spools, inputs, month).revenue,
  }));
}

/** `now` tarihinden geriye doğru N ayın anahtarları (eskiden yeniye). */
export function lastMonths(now: number, count: number): string[] {
  const out: string[] = [];
  const date = new Date(now);
  for (let index = count - 1; index >= 0; index -= 1) {
    const point = new Date(date.getFullYear(), date.getMonth() - index, 1);
    const month = String(point.getMonth() + 1).padStart(2, '0');
    out.push(`${point.getFullYear()}-${month}`);
  }
  return out;
}

/** "2026-08" -> "Ağu 26" */
const MONTH_NAMES = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const index = Number(month) - 1;
  if (!Number.isInteger(index) || index < 0 || index > 11) return key;
  return `${MONTH_NAMES[index]} ${year.slice(2)}`;
}
