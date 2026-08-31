/**
 * Cari ve fatura hesapları.
 *
 * Buradaki her şey saftır: para aritmetiği, KDV ayrıştırma, numara üretimi ve
 * yazıyla tutar. Kuruş hataları müşteriye yansıdığı için tüm tutarlar tek bir
 * yerde, aynı yuvarlama kuralıyla hesaplanır.
 */

import type {
  Customer,
  CustomerSnapshot,
  Invoice,
  InvoiceKind,
  InvoiceLine,
  SellerInfo,
} from '../types';

/** Türkiye'de mal teslimlerinde güncel genel oran. */
export const DEFAULT_VAT_RATE = 20;

export const VAT_RATES = [0, 1, 10, 20];

export const INVOICE_KIND_META: Record<InvoiceKind, { label: string; chip: string }> = {
  proforma: {
    label: 'Proforma',
    chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
  },
  invoice: {
    label: 'Fatura',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  },
};

export const EMPTY_SELLER: SellerInfo = {
  name: '',
  taxOffice: '',
  taxNumber: '',
  phone: '',
  email: '',
  address: '',
  iban: '',
  vatRate: DEFAULT_VAT_RATE,
};

const EMPTY_SNAPSHOT: CustomerSnapshot = {
  name: '',
  company: '',
  taxOffice: '',
  taxNumber: '',
  phone: '',
  email: '',
  address: '',
};

/** Kuruşa yuvarlar. Yarımlar yukarı; kayan nokta kaymasına karşı korumalı. */
export function toKurus(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // 1e-9 eklemesi 1.005 gibi ikili tabanda 1.00499… olan sayıları kurtarır.
  return Math.round((value + Number.EPSILON * Math.abs(value) + 1e-9) * 100) / 100;
}

export function newCustomer(id: string, at: string): Customer {
  return {
    id,
    name: '',
    company: '',
    taxOffice: '',
    taxNumber: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    createdAt: at,
  };
}

/** Cari kartından faturaya donacak anlık kopyayı çıkarır. */
export function snapshotOf(customer: Customer | null | undefined): CustomerSnapshot {
  if (!customer) return { ...EMPTY_SNAPSHOT };
  return {
    name: customer.name,
    company: customer.company,
    taxOffice: customer.taxOffice,
    taxNumber: customer.taxNumber,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
  };
}

/** Listede ve faturada gösterilecek tek satırlık ad. */
export function displayName(customer: CustomerSnapshot | Customer): string {
  const company = customer.company.trim();
  const name = customer.name.trim();
  if (company && name) return `${company} (${name})`;
  return company || name || 'İsimsiz cari';
}

/** VKN 10, TCKN 11 hanedir; boş bırakmak serbesttir. */
export function validateCustomer(customer: Customer): string[] {
  const errors: string[] = [];
  if (!customer.name.trim() && !customer.company.trim()) {
    errors.push('Ad soyad veya firma unvanı gerekli.');
  }
  const tax = customer.taxNumber.replace(/\s/g, '');
  if (tax && !/^\d{10}$|^\d{11}$/.test(tax)) {
    errors.push('Vergi numarası 10 (VKN) veya 11 (TCKN) hane olmalı.');
  }
  if (customer.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())) {
    errors.push('E-posta adresi geçersiz.');
  }
  return errors;
}

/** Basit arama: ad, firma, telefon ve vergi numarasında geçen metin. */
export function searchCustomers(customers: Customer[], query: string): Customer[] {
  const needle = query.trim().toLocaleLowerCase('tr');
  if (!needle) return customers;
  return customers.filter((customer) =>
    [customer.name, customer.company, customer.phone, customer.taxNumber, customer.email]
      .join(' ')
      .toLocaleLowerCase('tr')
      .includes(needle),
  );
}

// ---------------------------------------------------------------------------
// Tutarlar
// ---------------------------------------------------------------------------

export interface InvoiceTotals {
  /** İskonto öncesi kalem toplamı (KDV hariç). */
  subtotal: number;
  discount: number;
  /** KDV matrahı: iskonto düşülmüş net tutar. */
  taxable: number;
  vat: number;
  /** Ödenecek toplam. */
  grand: number;
}

export function lineNet(line: InvoiceLine, vatRate: number, vatIncluded: boolean): number {
  const gross = Math.max(0, line.quantity) * line.unitPrice;
  if (!vatIncluded) return toKurus(gross);
  // Fiyata KDV dahilse matrah geriye doğru ayrıştırılır.
  return toKurus(gross / (1 + Math.max(0, vatRate) / 100));
}

/**
 * Faturanın tüm tutarları. İskonto KDV matrahından düşülür; KDV, iskonto
 * sonrası matrah üzerinden hesaplanır.
 */
export function invoiceTotals(invoice: Invoice): InvoiceTotals {
  const rate = Math.max(0, invoice.vatRate);
  const subtotal = toKurus(
    invoice.lines.reduce((sum, line) => sum + lineNet(line, rate, invoice.vatIncluded), 0),
  );
  const discount = toKurus(Math.min(Math.max(0, invoice.discount), subtotal));
  const taxable = toKurus(subtotal - discount);
  const vat = toKurus((taxable * rate) / 100);
  return { subtotal, discount, taxable, vat, grand: toKurus(taxable + vat) };
}

/** Yılın sıradaki fatura numarası: FTR-2026-0001. */
export function nextInvoiceNumber(invoices: Invoice[], year: number): string {
  const prefix = `FTR-${year}-`;
  let highest = 0;
  for (const invoice of invoices) {
    if (!invoice.number.startsWith(prefix)) continue;
    const value = Number.parseInt(invoice.number.slice(prefix.length), 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Yazıyla tutar
// ---------------------------------------------------------------------------

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon'];

/** Üç haneli bir grubu yazıya çevirir. */
function tripletToWords(value: number): string {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  let out = '';
  // "biryüz" denmez, sadece "yüz".
  if (hundreds > 0) out += (hundreds > 1 ? ONES[hundreds] : '') + 'yüz';
  out += TENS[tens] + ONES[ones];
  return out;
}

/** Tam sayıyı Türkçe yazıya çevirir. */
export function numberToWords(value: number): string {
  const whole = Math.floor(Math.abs(value));
  if (whole === 0) return 'sıfır';

  const groups: number[] = [];
  let rest = whole;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  let out = '';
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;
    // "birbin" denmez, sadece "bin".
    const words = index === 1 && group === 1 ? '' : tripletToWords(group);
    out += words + SCALES[index];
  }
  return out;
}

/** Fatura altına yazılan "Yalnız: ..." satırı. */
export function amountInWords(value: number): string {
  const rounded = toKurus(Math.abs(value));
  const lira = Math.floor(rounded);
  const kurus = Math.round((rounded - lira) * 100);
  const parts = [`${numberToWords(lira)} TL`];
  if (kurus > 0) parts.push(`${numberToWords(kurus)} kuruş`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Fatura üretimi
// ---------------------------------------------------------------------------

export interface DraftInvoiceInput {
  id: string;
  number: string;
  kind: InvoiceKind;
  orderId: string | null;
  customer: Customer | null;
  lines: InvoiceLine[];
  vatRate: number;
  /** Bugünün tarihi (YYYY-AA-GG); test edilebilirlik için dışarıdan verilir. */
  today: string;
  at: string;
}

export function buildInvoice(input: DraftInvoiceInput): Invoice {
  return {
    id: input.id,
    number: input.number,
    kind: input.kind,
    orderId: input.orderId,
    customerId: input.customer?.id ?? null,
    customer: snapshotOf(input.customer),
    lines: input.lines.map((line) => ({
      name: line.name,
      quantity: Math.max(0, line.quantity),
      unitPrice: toKurus(line.unitPrice),
    })),
    vatRate: input.vatRate,
    vatIncluded: false,
    discount: 0,
    issuedAt: input.today,
    dueDate: input.today,
    notes: '',
    createdAt: input.at,
  };
}

/** Fatura kesilebilir mi? Boş kalemli fatura kaydedilmez. */
export function validateInvoice(invoice: Invoice): string[] {
  const errors: string[] = [];
  if (invoice.lines.length === 0) errors.push('Faturada en az bir kalem olmalı.');
  if (invoice.lines.some((line) => !line.name.trim())) errors.push('Kalem adı boş bırakılamaz.');
  if (invoice.lines.some((line) => line.quantity <= 0)) errors.push('Adet sıfırdan büyük olmalı.');
  if (!displayName(invoice.customer).trim() || displayName(invoice.customer) === 'İsimsiz cari') {
    errors.push('Müşteri bilgisi gerekli.');
  }
  if (!invoice.issuedAt) errors.push('Düzenlenme tarihi gerekli.');
  return errors;
}

/** Fatura listesindeki özet sayaçlar. */
export interface InvoiceSummary {
  count: number;
  proforma: number;
  invoiced: number;
  /** Kesilmiş faturaların toplamı (KDV dahil). */
  total: number;
  vat: number;
}

export function summarizeInvoices(invoices: Invoice[]): InvoiceSummary {
  let total = 0;
  let vat = 0;
  let proforma = 0;
  let invoiced = 0;
  for (const invoice of invoices) {
    const totals = invoiceTotals(invoice);
    if (invoice.kind === 'invoice') {
      invoiced += 1;
      total += totals.grand;
      vat += totals.vat;
    } else {
      proforma += 1;
    }
  }
  return {
    count: invoices.length,
    proforma,
    invoiced,
    total: toKurus(total),
    vat: toKurus(vat),
  };
}

/** Yeniden eskiye sıralar; aynı gün içinde numaraya göre. */
export function sortInvoices(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort((a, b) => {
    const byDate = b.issuedAt.localeCompare(a.issuedAt);
    return byDate !== 0 ? byDate : b.number.localeCompare(a.number);
  });
}

/**
 * Dosya adı olarak kullanılabilir fatura adı.
 * Parantezli uzun unvan kesilince yarım kalırdı; bu yüzden yalnızca birincil
 * kimlik (firma varsa firma, yoksa ad) kullanılır ve sondaki noktalama atılır.
 */
export function invoiceFileName(invoice: Invoice): string {
  const primary = invoice.customer.company.trim() || invoice.customer.name.trim();
  const who = primary
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .replace(/[\s.,;(-]+$/, '');
  return `${invoice.number}${who ? ` - ${who}` : ''}.pdf`;
}
