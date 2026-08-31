import type { LabourItem } from './lib/workshop';

/** Uygulama genelinde kullanilan tip tanimlari. */

export const MATERIALS = [
  'PLA',
  'PLA+',
  'PLA Silk',
  'PETG',
  'ABS',
  'ASA',
  'TPU',
  'NYLON',
  'PC',
  'PVA',
  'HIPS',
  'PA-CF',
  'PET-CF',
  'Diger',
] as const;

export type Material = (typeof MATERIALS)[number];

/** Kutuphaneye kayitli bir filament makarasi. */
export interface FilamentSpool {
  id: string;
  brand: string;
  material: Material;
  color: string;
  /** Makaranin satin alma fiyati (TL). */
  rollPrice: number;
  /** Makaradaki net filament agirligi (gram). */
  rollWeight: number;
  sourceUrl?: string;
  /** ISO tarih. */
  updatedAt: string;
  /** Makarada kalan filament (gram). Yazilmamissa makara dolu sayilir. */
  remainingGrams?: number;
  /** Otomatik fiyat takibi bu makara icin acik mi? */
  autoUpdate?: boolean;
  /** Son fiyat kontrolu (ISO tarih). */
  lastCheckedAt?: string;
  /** Son kontrolun sonucu. */
  lastCheckStatus?: 'ok' | 'unchanged' | 'failed';
  /** Son kontrol hatasi. */
  lastCheckError?: string;
  /** Fiyat gecmisi (en fazla 30 kayit). */
  priceHistory?: PriceSample[];
}

/** Tek bir fiyat olcumu. */
export interface PriceSample {
  at: string;
  price: number;
}

/** Otomatik fiyat guncelleme ayarlari. */
export interface WatchSettings {
  enabled: boolean;
  /** Kontrol araligi (saat). */
  intervalHours: number;
  lastRunAt: string | null;
}

// ---------------------------------------------------------------------------
// Hazir urunler (katalog) ve siparisler
// ---------------------------------------------------------------------------

/** Bir urunun tek renginin (tool) malzeme dokumu. */
export interface CatalogTool {
  toolIndex: number;
  colorHex: string;
  filamentType: string | null;
  /** Modele giden gram. */
  modelGrams: number;
  /** Temizleme kulesine giden gram. */
  wasteGrams: number;
}

/** Katalogda saklanan hazir urun. */
export interface CatalogProduct {
  id: string;
  name: string;
  notes: string;
  /** Verinin kaynagi. */
  source: 'gcode' | 'stl' | 'manual';
  sourceFile?: string;
  /** Sunucuda saklanan g-code dosyasinin kimligi (varsa). */
  gcodeId?: string;
  gcodeSize?: number;
  /** Tahmini baski suresi (saniye). */
  printSeconds: number;
  tools: CatalogTool[];
  /**
   * Elle girilen satis fiyati (adet basina, TL).
   *
   * Doluysa hesaplanan satis fiyatinin yerine gecer; maliyet yine malzemeden
   * hesaplanir, boylece kar marji dogru gorunur. Bos birakilirsa fiyat
   * her zamanki gibi guncel envanterden hesaplanir.
   */
  manualPrice?: number;
  createdAt: string;
}

/** Siparis fisindeki tek kalem. */
/** Bir siparis kaleminin uretim durumu. */
export type OrderItemStatus = 'waiting' | 'printing' | 'done';

export interface OrderItem {
  id: string;
  /** Katalogdan geldiyse urun kimligi. */
  productId: string | null;
  name: string;
  quantity: number;
  printSeconds: number;
  tools: CatalogTool[];
  /** toolIndex -> makara kimligi. */
  assignment: Record<number, string | null>;
  /** Malzeme dokumu olmayan elle girilen kalemler icin. */
  manualUnitCost?: number;
  manualUnitPrice?: number;
  /** Sunucuda saklanan g-code; yaziciya dogrudan gonderilebilir. */
  gcodeId?: string;
  /** Uretim durumu; eski kayitlarda bos olabilir (bekliyor sayilir). */
  status?: OrderItemStatus;
  /** Baskiya gonderildigi yazici. */
  printerName?: string;
  sentAt?: string;
}

/** Otomatik yedekleme ayarlari. */
export interface BackupSettings {
  enabled: boolean;
  /** Yedek araligi (dakika). */
  intervalMinutes: number;
  lastAt: string | null;
}

/** Siparis durumu. */
export type OrderStatus = 'pending' | 'printing' | 'ready' | 'delivered' | 'cancelled';

/** Musteri siparisi (cok kalemli fis). */
export interface Order {
  id: string;
  code: string;
  /** Musteri adi (cari secilmemisse elle yazilir). */
  customer: string;
  /** Cari karti; secilirse fatura bilgileri buradan gelir. */
  customerId?: string;
  status: OrderStatus;
  /** Teslim tarihi (YYYY-AA-GG). */
  dueDate: string;
  notes: string;
  createdAt: string;
  /** Fisteki kalemler. */
  items: OrderItem[];
  /** Bu siparise uygulanacak kar marji (%). */
  marginPct: number;
  /** Baski sonrasi el iscilikleri (destek sokme, zimpara, boyama...). */
  labour?: LabourItem[];
  /** Kargo takip kodu; bildirim sablonlarinda kullanilir. */
  trackingCode?: string;
  shippingCarrier?: string;
}

/** Bir baski isinin tek bir makaradan tuketimi. */
export interface JobMaterial {
  spoolId: string | null;
  grams: number;
  /** Coklu renkte arac numarasi (varsa). */
  toolIndex?: number;
  colorHex?: string;
}

/** Baski isi durumu. */
export type JobStatus = 'queued' | 'printing' | 'done' | 'failed';

/** Yazici baski isi (kuyruk / takip). */
export interface PrintJob {
  id: string;
  name: string;
  printerName: string;
  /** Kullanilan makaralar ve gramajlari. */
  materials: JobMaterial[];
  /** Toplam gramaj (materials toplami) - gosterim kolayligi icin. */
  grams: number;
  /** Malzeme stoktan dusuldu mu? Cifte dusmeyi onler. */
  consumed?: boolean;
  /** Yazicinin toplam calisma suresine eklenen saat (geri almak icin). */
  consumedHours?: number;
  /** Tahmini sure (ondalikli saat). */
  estimatedHours: number;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  orderId: string | null;
  notes: string;
  /** Bağlı yazıcı kaydı (canlı takip). */
  printerLinkId?: string;
  /** Yazıcıdaki dosya adı; eşleştirme için. */
  remoteJobName?: string | null;
}

/** Hesaplamada kullanilan tek bir filament satiri. */
export interface FilamentUsage {
  id: string;
  spoolId: string | null;
  /** Modele giden filament (gram). */
  grams: number;
  /** Temizleme kulesine / purge'e giden atik (gram). */
  wasteGrams?: number;
  /** Coklu malzemede arac (tool) numarasi. */
  toolIndex?: number;
  /** G-code'dan gelen renk (#RRGGBB). */
  colorHex?: string;
}

/** Yazici tanimi (katalogdan veya manuel). */
export interface PrinterProfile {
  id: string;
  brand: string;
  model: string;
  /** Baski sirasindaki ortalama guc tuketimi (W). */
  avgPowerW: number;
  /** Isinma/pik anindaki maksimum guc (W). */
  maxPowerW: number;
  /** Bekleme (idle) tuketimi (W). */
  idlePowerW: number;
  technology: 'FDM' | 'RESIN';
  buildVolume?: string;
  heatedBed?: boolean;
  enclosure?: boolean;
  /** Beklenen toplam calisma omru (saat). */
  lifetimeHours?: number;
  /** Verinin nereden geldigi. */
  source: 'catalog' | 'online' | 'manual';
  sourceUrl?: string;
}

/** Hesaplayici girdileri. */
export interface CalculatorInputs {
  usages: FilamentUsage[];
  printHours: number;
  printMinutes: number;
  quantity: number;
  printerWatts: number;
  kwhPrice: number;
  depreciationPerHour: number;
  failureRatePct: number;
  laborRatePerHour: number;
  laborMinutes: number;
  extraCost: number;
  marginPct: number;
  vatEnabled: boolean;
  vatPct: number;
}

/** Grafiklerde kullanilan tek maliyet dilimi. */
export interface CostSegment {
  key: string;
  label: string;
  value: number;
  /** CSS renk degeri. */
  color: string;
}

/** Hesaplama sonucu. */
export interface CostResult {
  /** Tek parca (adet basina) degerleri. */
  unit: {
    netCost: number;
    salePrice: number;
  };
  filamentCost: number;
  /** Filament maliyetinin modele giden kismi. */
  modelFilamentCost: number;
  /** Filament maliyetinin temizleme kulesine giden kismi. */
  wasteFilamentCost: number;
  electricityCost: number;
  depreciationCost: number;
  failureCost: number;
  laborCost: number;
  extraCost: number;
  /** Amortisman + fire toplami (ozet kart icin). */
  riskAndDepreciationCost: number;
  netCost: number;
  marginAmount: number;
  salePriceExVat: number;
  vatAmount: number;
  salePrice: number;
  profit: number;
  totalHours: number;
  /** Model + atik toplam malzeme (gram). */
  totalGrams: number;
  /** Yalnizca modele giden malzeme (gram). */
  modelGrams: number;
  /** Temizleme kulesine giden malzeme (gram). */
  wasteGrams: number;
  energyKwh: number;
  quantity: number;
  segments: CostSegment[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Cari (musteri) ve fatura
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  /** Ad Soyad veya firma unvani. */
  name: string;
  /** Sahis ise bos birakilir. */
  company: string;
  taxOffice: string;
  /** VKN (10 hane) veya TCKN (11 hane). */
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
}

export type InvoiceKind = 'proforma' | 'invoice';

export interface InvoiceLine {
  /** Kalem adi. */
  name: string;
  quantity: number;
  /** Birim fiyat; KDV dahil mi degil mi `vatIncluded` belirler. */
  unitPrice: number;
}

/**
 * Fatura kesildigi andaki musteri bilgisi. Cari kaydi sonradan degisse bile
 * kesilmis fatura degismemelidir; bu yuzden anlik kopya saklanir.
 */
export interface CustomerSnapshot {
  name: string;
  company: string;
  taxOffice: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
}

export interface Invoice {
  id: string;
  /** FTR-2026-0001 gibi sira numarasi. */
  number: string;
  kind: InvoiceKind;
  /** Kaynak siparis (elle olusturulduysa null). */
  orderId: string | null;
  customerId: string | null;
  customer: CustomerSnapshot;
  lines: InvoiceLine[];
  /** KDV orani (%). */
  vatRate: number;
  /** Birim fiyatlara KDV dahil mi? */
  vatIncluded: boolean;
  /** Iskonto (TL, KDV matrahindan dusulur). */
  discount: number;
  /** Duzenlenme tarihi (YYYY-AA-GG). */
  issuedAt: string;
  dueDate: string;
  notes: string;
  createdAt: string;
}

/** Faturayi kesen tarafin bilgileri; ayarlardan girilir. */
export interface SellerInfo {
  name: string;
  taxOffice: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  iban: string;
  /** Varsayilan KDV orani (%). */
  vatRate: number;
}

// ---------------------------------------------------------------------------
// Kurumsal kimlik ve calisma alani
// ---------------------------------------------------------------------------

/** Kurumsal gorunum: logo ve imza data URI olarak saklanir. */
export interface Branding {
  /** Isletme adi; kenar cubugunda ve faturada gorunur. */
  businessName: string;
  /** PNG/JPEG data URI. */
  logo: string;
  /** Islak imza gorseli (PNG/JPEG data URI). */
  signature: string;
  /** Imzanin altina yazilacak ad. */
  signatureLabel: string;
}

/** Dock'a eklenen yerel program kisayolu. */
export interface DockApp {
  id: string;
  label: string;
  /** Calistirilabilir dosyanin tam yolu. */
  path: string;
  /** Tek karakterlik simge harfi veya emoji. */
  icon: string;
}
