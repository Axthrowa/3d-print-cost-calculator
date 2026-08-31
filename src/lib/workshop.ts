/**
 * Atölye ek modülleri: baskı sonrası işçilik, yazıcı bakımı ve müşteri
 * bildirim şablonları.
 *
 * Üçü de saf fonksiyonlardır; zaman ve kimlik dışarıdan verilir, böylece
 * donanım veya takvim olmadan test edilebilirler.
 */

import type { Order, OrderStatus } from '../types';

// ---------------------------------------------------------------------------
// Baskı sonrası işçilik
// ---------------------------------------------------------------------------

export interface LabourItem {
  id: string;
  /** İşin adı: Destek Sökme, Zımpara, Boyama… */
  name: string;
  hours: number;
  /** Saatlik ücret (TL). */
  hourlyRate: number;
}

/** Atölyede en sık geçen işler; tek tıkla eklenir. */
export const LABOUR_PRESETS: Array<{ name: string; hours: number }> = [
  { name: 'Destek sökme', hours: 0.5 },
  { name: 'Zımpara', hours: 1 },
  { name: 'Boyama', hours: 2 },
  { name: 'Montaj', hours: 0.5 },
  { name: 'Paketleme', hours: 0.25 },
];

export const DEFAULT_HOURLY_RATE = 200;

export function newLabour(
  id: string,
  name = '',
  hours = 1,
  hourlyRate = DEFAULT_HOURLY_RATE,
): LabourItem {
  return { id, name, hours, hourlyRate };
}

/** Tek bir işçilik kaleminin tutarı. */
export function labourCost(item: LabourItem): number {
  const hours = Math.max(0, item.hours);
  const rate = Math.max(0, item.hourlyRate);
  return Math.round(hours * rate * 100) / 100;
}

/** Siparişe eklenmiş tüm işçiliğin toplamı. */
export function labourTotal(items: LabourItem[] | undefined): number {
  if (!items || items.length === 0) return 0;
  return Math.round(items.reduce((sum, item) => sum + labourCost(item), 0) * 100) / 100;
}

/** Toplam işçilik saati; kapasite planlaması için. */
export function labourHours(items: LabourItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, item) => sum + Math.max(0, item.hours), 0);
}

/** Faturaya yazılacak kalem açıklaması: "Boyama (2 sa × 200 TL/sa)". */
export function labourLabel(item: LabourItem): string {
  const hours = Math.max(0, item.hours);
  const pretty = Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace('.', ',');
  return `${item.name || 'İşçilik'} (${pretty} sa × ${Math.max(0, item.hourlyRate)} TL/sa)`;
}

// ---------------------------------------------------------------------------
// Yazıcı bakım takibi
// ---------------------------------------------------------------------------

export interface MaintenanceSettings {
  /** Kaç saatte bir bakım hatırlatılsın? */
  intervalHours: number;
  /** Yazıcı adı -> son bakımın yapıldığı toplam saat. */
  done: Record<string, number>;
}

export const DEFAULT_MAINTENANCE: MaintenanceSettings = {
  intervalHours: 300,
  done: {},
};

export const MAINTENANCE_CHECKLIST = [
  'Mil ve kızakları yağlayın',
  'Kayış gerginliğini kontrol edin',
  'Nozul ve soğutucu fanını temizleyin',
  'Tabla düzlemini (bed leveling) doğrulayın',
];

export interface MaintenanceStatus {
  /** Son bakımdan bu yana geçen saat. */
  sinceHours: number;
  /** Bakıma kalan saat; negatifse gecikmiş demektir. */
  remainingHours: number;
  /** 0..1 aralığında doluluk. */
  ratio: number;
  due: boolean;
}

/** Bir yazıcının bakım durumu. */
export function maintenanceStatus(
  printerName: string,
  runHours: number,
  settings: MaintenanceSettings,
): MaintenanceStatus {
  const interval = Math.max(1, settings.intervalHours);
  const last = Math.max(0, settings.done[printerName] ?? 0);
  // Sayaç sıfırlandıktan sonra saat geriye gitmez; yine de negatife düşmesin.
  const since = Math.max(0, runHours - last);
  return {
    sinceHours: since,
    remainingHours: interval - since,
    ratio: Math.min(1, since / interval),
    due: since >= interval,
  };
}

/** Bakım yapıldı: sayaç o anki toplam saate çekilir. */
export function markMaintenanceDone(
  settings: MaintenanceSettings,
  printerName: string,
  runHours: number,
): MaintenanceSettings {
  return {
    ...settings,
    done: { ...settings.done, [printerName]: Math.max(0, runHours) },
  };
}

/** Bakımı gelmiş yazıcıların adları. */
export function printersDueForMaintenance(
  hours: Record<string, number>,
  settings: MaintenanceSettings,
): string[] {
  return Object.keys(hours)
    .filter((name) => maintenanceStatus(name, hours[name], settings).due)
    .sort((a, b) => a.localeCompare(b, 'tr'));
}

// ---------------------------------------------------------------------------
// Müşteri bildirim şablonları
// ---------------------------------------------------------------------------

export interface TemplateVars {
  musteriAd: string;
  siparisNo: string;
  urunler: string;
  tutar: string;
  kargoFirma: string;
  kargoKodu: string;
  teslimTarihi: string;
}

/**
 * `{Degisken}` yer tutucularını doldurur. Bilinmeyen yer tutucu olduğu gibi
 * bırakılmaz, silinir: müşteriye "{kargoKodu}" yazan bir mesaj gitmemeli.
 */
export function renderTemplate(template: string, vars: Partial<TemplateVars>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      const value = vars[key as keyof TemplateVars];
      return value ? String(value) : '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const NOTIFY_TEMPLATES: Partial<Record<OrderStatus, { label: string; body: string }>> = {
  printing: {
    label: 'Baskıya alındı',
    body:
      'Sayın {musteriAd}, {siparisNo} numaralı siparişiniz üretime alınmıştır. ' +
      'Baskı tamamlandığında sizi tekrar bilgilendireceğiz. İyi günler dileriz.',
  },
  ready: {
    label: 'Tamamlandı',
    body:
      'Sayın {musteriAd}, {siparisNo} numaralı siparişiniz ({urunler}) hazırdır. ' +
      'Toplam tutar: {tutar}. Teslimat için sizinle iletişime geçeceğiz.',
  },
  delivered: {
    label: 'Kargolandı',
    body:
      'Sayın {musteriAd}, {siparisNo} numaralı siparişiniz {kargoFirma} ile kargoya verilmiştir. ' +
      'Takip kodu: {kargoKodu}. Bizi tercih ettiğiniz için teşekkür ederiz.',
  },
  cancelled: {
    label: 'İptal edildi',
    body:
      'Sayın {musteriAd}, {siparisNo} numaralı siparişiniz iptal edilmiştir. ' +
      'Bir yanlışlık olduğunu düşünüyorsanız lütfen bizimle iletişime geçin.',
  },
};

/** Siparişten şablon değişkenlerini toplar. */
export function templateVarsOf(order: Order, total: string, customerName: string): TemplateVars {
  return {
    musteriAd: customerName || order.customer || 'Müşterimiz',
    siparisNo: order.code,
    urunler: order.items.map((item) => `${item.name} x${item.quantity}`).join(', '),
    tutar: total,
    kargoFirma: order.shippingCarrier ?? '',
    kargoKodu: order.trackingCode ?? '',
    teslimTarihi: order.dueDate,
  };
}

/** WhatsApp bağlantısı; telefon varsa doğrudan sohbeti açar. */
export function whatsappLink(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Türkiye numaraları 0 ile yazılır; uluslararası biçim 90 ister.
  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  const full = national.length === 10 ? `90${national}` : national;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}
