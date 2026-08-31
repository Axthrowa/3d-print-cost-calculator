/**
 * Hazır ürün katalogu ve sipariş fişi fiyatlandırması.
 *
 * Buradaki kural: kayıtlı bir ürünün GEÇMİŞTEKİ maliyeti hiçbir zaman
 * kullanılmaz. Ürün yalnızca "ne kadar malzeme, ne kadar süre" bilgisini
 * saklar; fiyat her seferinde envanterdeki GÜNCEL filament fiyatları ve
 * güncel elektrik/amortisman ayarlarıyla yeniden hesaplanır.
 *
 * Saf ve zaman parametrelidir; React'ten bağımsızdır.
 */

import { calculateCost } from './costEngine';
import { splitDuration } from './gcodeParser';
import { labourHours, labourTotal } from './workshop';
import type {
  CalculatorInputs,
  CatalogProduct,
  CatalogTool,
  CostResult,
  FilamentSpool,
  Order,
  OrderItem,
} from '../types';

/** Ürünün toplam model gramajı. */
export function productModelGrams(product: Pick<CatalogProduct, 'tools'>): number {
  return product.tools.reduce((sum, tool) => sum + Math.max(0, tool.modelGrams), 0);
}

/** Ürünün toplam atık gramajı. */
export function productWasteGrams(product: Pick<CatalogProduct, 'tools'>): number {
  return product.tools.reduce((sum, tool) => sum + Math.max(0, tool.wasteGrams), 0);
}

/** Ürünün toplam malzemesi (model + atık). */
export function productTotalGrams(product: Pick<CatalogProduct, 'tools'>): number {
  return productModelGrams(product) + productWasteGrams(product);
}

/**
 * Bir araç listesi için varsayılan makara ataması üretir.
 * Önce malzeme türü eşleşen makara, yoksa kütüphanedeki ilk makara seçilir.
 */
export function defaultAssignment(
  tools: CatalogTool[],
  spools: FilamentSpool[],
): Record<number, string | null> {
  const assignment: Record<number, string | null> = {};
  for (const tool of tools) {
    const byType = tool.filamentType
      ? (spools.find((s) => s.material.toUpperCase() === tool.filamentType?.toUpperCase())?.id ??
        null)
      : null;
    assignment[tool.toolIndex] = byType ?? spools[0]?.id ?? null;
  }
  return assignment;
}

/**
 * Ürünü + adedi + makara atamasını, hesaplayıcının anlayacağı girdilere çevirir.
 * `base` hesaplayıcıdaki güncel ayarlardır (watt, kWh, amortisman, fire,
 * işçilik, KDV); yalnızca süre, adet ve malzeme satırları ürüne göre değişir.
 */
export function toInputs(
  tools: CatalogTool[],
  printSeconds: number,
  quantity: number,
  assignment: Record<number, string | null>,
  base: CalculatorInputs,
): CalculatorInputs {
  const { hours, minutes } = splitDuration(printSeconds);
  return {
    ...base,
    printHours: hours,
    printMinutes: minutes,
    quantity: Math.max(1, Math.round(quantity)),
    usages: tools.map((tool) => ({
      id: `tool-${tool.toolIndex}`,
      spoolId: assignment[tool.toolIndex] ?? null,
      grams: Math.max(0, tool.modelGrams),
      wasteGrams: Math.max(0, tool.wasteGrams),
      toolIndex: tool.toolIndex,
      colorHex: tool.colorHex,
    })),
  };
}

/** Bir hazır ürünü güncel fiyatlarla hesaplar. */
export function priceProduct(
  product: CatalogProduct,
  quantity: number,
  assignment: Record<number, string | null>,
  spools: FilamentSpool[],
  base: CalculatorInputs,
): CostResult {
  return calculateCost(
    toInputs(product.tools, product.printSeconds, quantity, assignment, base),
    spools,
  );
}

// ---------------------------------------------------------------------------
// Sipariş fişi
// ---------------------------------------------------------------------------

export interface PricedItem {
  item: OrderItem;
  result: CostResult | null;
  /** Kalemin net maliyeti (adet dahil). */
  netCost: number;
  /** Kalemin satış tutarı (adet dahil). */
  salePrice: number;
  modelGrams: number;
  wasteGrams: number;
  hours: number;
}

export interface OrderPricing {
  items: PricedItem[];
  netCost: number;
  salePrice: number;
  profit: number;
  modelFilamentCost: number;
  wasteFilamentCost: number;
  modelGrams: number;
  wasteGrams: number;
  totalHours: number;
  itemCount: number;
  /** Baski sonrasi el isciligi (TL). Maliyete ve satisa birebir eklenir. */
  labourCost: number;
  labourHours: number;
  /** Fiyatı hesaplanamayan (makara seçilmemiş) kalem var mı? */
  warnings: string[];
}

/** Tek bir sipariş kalemini güncel fiyatlarla hesaplar. */
export function priceItem(
  item: OrderItem,
  spools: FilamentSpool[],
  base: CalculatorInputs,
): PricedItem {
  const quantity = Math.max(1, Math.round(item.quantity));

  // Malzeme dökümü olmayan elle girilmiş kalem: doğrudan tutarlar kullanılır.
  if (
    item.tools.length === 0 &&
    (item.manualUnitCost !== undefined || item.manualUnitPrice !== undefined)
  ) {
    const unitCost = Math.max(0, item.manualUnitCost ?? 0);
    const unitPrice = Math.max(0, item.manualUnitPrice ?? unitCost);
    return {
      item,
      result: null,
      netCost: unitCost * quantity,
      salePrice: unitPrice * quantity,
      modelGrams: 0,
      wasteGrams: 0,
      hours: (item.printSeconds / 3600) * quantity,
    };
  }

  const result = calculateCost(
    toInputs(item.tools, item.printSeconds, quantity, item.assignment, {
      ...base,
      marginPct: base.marginPct,
    }),
    spools,
  );

  // Elle girilen satis fiyati hesaplanan fiyatin yerine gecer. Maliyet
  // malzemeden hesaplanmaya devam eder; boylece kar marji gercekci kalir.
  const salePrice =
    item.manualUnitPrice !== undefined
      ? Math.max(0, item.manualUnitPrice) * quantity
      : result.salePrice;

  return {
    item,
    result,
    netCost: result.netCost,
    salePrice,
    modelGrams: result.modelGrams,
    wasteGrams: result.wasteGrams,
    hours: result.totalHours,
  };
}

/** Tüm sipariş fişini güncel envanter fiyatlarıyla hesaplar. */
export function priceOrder(
  order: Order,
  spools: FilamentSpool[],
  base: CalculatorInputs,
): OrderPricing {
  const settings: CalculatorInputs = { ...base, marginPct: order.marginPct };
  const items = order.items.map((item) => priceItem(item, spools, settings));
  const warnings: string[] = [];

  // Isicilik maliyet ve satisa AYNI tutarla girer: saatlik ucret zaten
  // atolyenin fiyatidir, uzerine ayrica kar marji eklenmez.
  const labour = labourTotal(order.labour);

  let netCost = labour;
  let salePrice = labour;
  let modelFilamentCost = 0;
  let wasteFilamentCost = 0;
  let modelGrams = 0;
  let wasteGrams = 0;
  let totalHours = 0;

  for (const priced of items) {
    netCost += priced.netCost;
    salePrice += priced.salePrice;
    modelGrams += priced.modelGrams;
    wasteGrams += priced.wasteGrams;
    totalHours += priced.hours;
    if (priced.result) {
      modelFilamentCost += priced.result.modelFilamentCost;
      wasteFilamentCost += priced.result.wasteFilamentCost;
      if (priced.result.warnings.some((w) => w.includes('makara seçilmedi'))) {
        warnings.push(`"${priced.item.name}" için filament seçilmemiş satır var.`);
      }
    }
  }

  if (order.items.length === 0) warnings.push('Siparişte hiç kalem yok.');

  return {
    items,
    netCost,
    salePrice,
    profit: salePrice - netCost,
    modelFilamentCost,
    wasteFilamentCost,
    modelGrams,
    wasteGrams,
    totalHours,
    itemCount: order.items.reduce((sum, item) => sum + Math.max(1, Math.round(item.quantity)), 0),
    labourCost: labour,
    labourHours: labourHours(order.labour),
    warnings: [...new Set(warnings)],
  };
}

/** Katalog ürününden sipariş kalemi üretir. */
export function itemFromProduct(
  product: CatalogProduct,
  quantity: number,
  spools: FilamentSpool[],
  id: string,
): OrderItem {
  return {
    id,
    productId: product.id,
    name: product.name,
    quantity: Math.max(1, Math.round(quantity)),
    printSeconds: product.printSeconds,
    tools: product.tools.map((tool) => ({ ...tool })),
    assignment: defaultAssignment(product.tools, spools),
    // Urun bir g-code'dan gelmisse dosya kalemle birlikte tasinir.
    ...(product.gcodeId ? { gcodeId: product.gcodeId } : {}),
    // Urune elle fiyat girilmisse siparise de o fiyat gider.
    ...(product.manualPrice !== undefined ? { manualUnitPrice: product.manualPrice } : {}),
    status: 'waiting',
  };
}

// ---------------------------------------------------------------------------
// Eski veri göçü
// ---------------------------------------------------------------------------

/** v1.3 ve öncesindeki tek kalemli sipariş biçimi. */
interface LegacyOrder {
  id: string;
  code: string;
  customer: string;
  customerId?: string;
  status: Order['status'];
  dueDate: string;
  notes: string;
  createdAt: string;
  title?: string;
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
  items?: OrderItem[];
  marginPct?: number;
}

/**
 * Eski tek kalemli siparişleri çok kalemli fiş biçimine taşır.
 * Malzeme dökümü olmadığı için kalem "elle girilmiş" olarak korunur;
 * böylece geçmiş siparişlerin tutarları kaybolmaz.
 */
/**
 * Zorunlu metin alanini guvenle okur.
 *
 * Eski veya elle duzenlenmis kayitlarda bu alanlar null olabiliyor.
 * `createdAt` null gelince siralamadaki `localeCompare` cagrisi tum
 * siparisler ekranini coldurmustu; bu yuzden gocurmede temizlenir.
 */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Bilinmeyen/eksik durumu guvenli varsayilana cevirir. */
function normalizeOrderStatus(value: unknown): Order['status'] {
  const allowed: Array<Order['status']> = [
    'pending',
    'printing',
    'ready',
    'delivered',
    'cancelled',
  ];
  return allowed.includes(value as Order['status']) ? (value as Order['status']) : 'pending';
}

export function migrateOrders(raw: unknown, defaultMarginPct: number): Order[] {
  if (!Array.isArray(raw)) return [];
  const orders: Order[] = [];

  for (const entry of raw as LegacyOrder[]) {
    if (!entry || typeof entry !== 'object') continue;
    // Kimliksiz kayit duzenlenemez ve React anahtarlarini bozar.
    if (typeof entry.id !== 'string' || !entry.id) continue;

    if (Array.isArray(entry.items)) {
      orders.push({
        id: entry.id,
        code: text(entry.code, entry.id),
        customer: text(entry.customer),
        // Cari baglantisi tasinmazsa siparis fatura bilgisini kaybeder.
        ...(entry.customerId ? { customerId: entry.customerId } : {}),
        status: normalizeOrderStatus(entry.status),
        dueDate: text(entry.dueDate),
        notes: text(entry.notes),
        createdAt: text(entry.createdAt),
        items: entry.items.map((item) => ({
          ...item,
          status: item?.status === 'printing' || item?.status === 'done' ? item.status : 'waiting',
        })),
        marginPct: entry.marginPct ?? defaultMarginPct,
      });
      continue;
    }

    const quantity = Math.max(1, Math.round(entry.quantity ?? 1));
    const unitCost = Math.max(0, entry.unitCost ?? 0);
    const unitPrice = Math.max(0, entry.unitPrice ?? 0);
    const margin = unitCost > 0 ? ((unitPrice - unitCost) / unitCost) * 100 : defaultMarginPct;

    orders.push({
      id: entry.id,
      code: text(entry.code, entry.id),
      customer: text(entry.customer),
      status: normalizeOrderStatus(entry.status),
      dueDate: text(entry.dueDate),
      notes: text(entry.notes),
      createdAt: text(entry.createdAt),
      marginPct: Number.isFinite(margin) ? Math.max(0, Math.round(margin)) : defaultMarginPct,
      items: [
        {
          id: `${entry.id}-1`,
          productId: null,
          name: entry.title || 'Ürün',
          quantity,
          printSeconds: 0,
          tools: [],
          assignment: {},
          manualUnitCost: unitCost,
          manualUnitPrice: unitPrice,
        },
      ],
    });
  }

  return orders;
}
