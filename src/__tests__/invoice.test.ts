import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE,
  amountInWords,
  buildInvoice,
  displayName,
  invoiceFileName,
  invoiceTotals,
  lineNet,
  newCustomer,
  nextInvoiceNumber,
  numberToWords,
  searchCustomers,
  snapshotOf,
  sortInvoices,
  summarizeInvoices,
  toKurus,
  validateCustomer,
  validateInvoice,
} from '../lib/invoice';
import type { Customer, Invoice, InvoiceLine } from '../types';

const customer = (over: Partial<Customer> = {}): Customer => ({
  ...newCustomer('c1', '2026-08-29T00:00:00.000Z'),
  name: 'Ahmet Yılmaz',
  ...over,
});

const line = (name: string, quantity: number, unitPrice: number): InvoiceLine => ({
  name,
  quantity,
  unitPrice,
});

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'i1',
  number: 'FTR-2026-0001',
  kind: 'invoice',
  orderId: null,
  customerId: 'c1',
  customer: snapshotOf(customer()),
  lines: [line('Ejderha', 2, 100)],
  vatRate: DEFAULT_VAT_RATE,
  vatIncluded: false,
  discount: 0,
  issuedAt: '2026-08-29',
  dueDate: '2026-09-05',
  notes: '',
  createdAt: '2026-08-29T00:00:00.000Z',
  ...over,
});

describe('toKurus', () => {
  it('kuruşa yuvarlar', () => {
    expect(toKurus(12.344)).toBe(12.34);
    expect(toKurus(12.346)).toBe(12.35);
  });

  it('ikili tabanda kayan yarımları yukarı alır', () => {
    // 1.005 ikili tabanda 1.00499999… tutulur; naif yuvarlama 1,00 verir.
    expect(toKurus(1.005)).toBe(1.01);
    expect(toKurus(8.475)).toBe(8.48);
  });

  it('bozuk değeri sıfırlar', () => {
    expect(toKurus(Number.NaN)).toBe(0);
    expect(toKurus(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('lineNet', () => {
  it('KDV hariç fiyatı olduğu gibi çarpar', () => {
    expect(lineNet(line('x', 3, 50), 20, false)).toBe(150);
  });

  it('KDV dahil fiyattan matrahı ayrıştırır', () => {
    // 120 TL, %20 dahil -> matrah 100 TL
    expect(lineNet(line('x', 1, 120), 20, true)).toBe(100);
  });

  it('negatif adedi saymaz', () => {
    expect(lineNet(line('x', -2, 50), 20, false)).toBe(0);
  });

  it('KDV sıfırken ayrıştırma yapmaz', () => {
    expect(lineNet(line('x', 1, 100), 0, true)).toBe(100);
  });
});

describe('invoiceTotals', () => {
  it('KDV hariç fiyatlarda toplamı kurar', () => {
    const totals = invoiceTotals(invoice());
    expect(totals.subtotal).toBe(200);
    expect(totals.taxable).toBe(200);
    expect(totals.vat).toBe(40);
    expect(totals.grand).toBe(240);
  });

  it('iskontoyu matrahtan düşer, KDV sonrasında hesaplanır', () => {
    const totals = invoiceTotals(invoice({ discount: 50 }));
    expect(totals.taxable).toBe(150);
    expect(totals.vat).toBe(30);
    expect(totals.grand).toBe(180);
  });

  it('iskonto ara toplamı aşamaz', () => {
    const totals = invoiceTotals(invoice({ discount: 5000 }));
    expect(totals.discount).toBe(200);
    expect(totals.taxable).toBe(0);
    expect(totals.grand).toBe(0);
  });

  it('negatif iskontoyu yok sayar', () => {
    expect(invoiceTotals(invoice({ discount: -100 })).discount).toBe(0);
  });

  it('KDV dahil fiyatlarda toplam değişmez', () => {
    // 240 TL KDV dahil = 200 matrah + 40 KDV
    const totals = invoiceTotals(invoice({ lines: [line('Ejderha', 2, 120)], vatIncluded: true }));
    expect(totals.subtotal).toBe(200);
    expect(totals.vat).toBe(40);
    expect(totals.grand).toBe(240);
  });

  it('çok kalemde kuruş kaçmaz', () => {
    const totals = invoiceTotals(
      invoice({ lines: [line('a', 3, 33.33), line('b', 7, 12.345)], vatRate: 10 }),
    );
    // 99,99 + 86,42 = 186,41 -> KDV 18,64 -> 205,05
    expect(totals.subtotal).toBe(186.41);
    expect(totals.vat).toBe(18.64);
    expect(totals.grand).toBe(205.05);
  });

  it('boş faturada sıfır döner', () => {
    const totals = invoiceTotals(invoice({ lines: [] }));
    expect(totals.grand).toBe(0);
  });

  it('%0 KDV ile toplam matraha eşittir', () => {
    const totals = invoiceTotals(invoice({ vatRate: 0 }));
    expect(totals.vat).toBe(0);
    expect(totals.grand).toBe(200);
  });
});

describe('nextInvoiceNumber', () => {
  it('ilk numarayı üretir', () => {
    expect(nextInvoiceNumber([], 2026)).toBe('FTR-2026-0001');
  });

  it('en büyüğün ardından devam eder', () => {
    const list = [
      invoice({ number: 'FTR-2026-0001' }),
      invoice({ number: 'FTR-2026-0007' }),
      invoice({ number: 'FTR-2026-0003' }),
    ];
    expect(nextInvoiceNumber(list, 2026)).toBe('FTR-2026-0008');
  });

  it('başka yılın numaralarını saymaz', () => {
    const list = [invoice({ number: 'FTR-2025-0042' })];
    expect(nextInvoiceNumber(list, 2026)).toBe('FTR-2026-0001');
  });

  it('bozuk numarayı atlar', () => {
    const list = [invoice({ number: 'FTR-2026-abc' }), invoice({ number: 'FTR-2026-0002' })];
    expect(nextInvoiceNumber(list, 2026)).toBe('FTR-2026-0003');
  });
});

describe('numberToWords / amountInWords', () => {
  it('küçük sayılar', () => {
    expect(numberToWords(0)).toBe('sıfır');
    expect(numberToWords(7)).toBe('yedi');
    expect(numberToWords(15)).toBe('onbeş');
    expect(numberToWords(90)).toBe('doksan');
  });

  it('yüzler "biryüz" demez', () => {
    expect(numberToWords(100)).toBe('yüz');
    expect(numberToWords(200)).toBe('ikiyüz');
    expect(numberToWords(345)).toBe('üçyüzkırkbeş');
  });

  it('binler "birbin" demez', () => {
    expect(numberToWords(1000)).toBe('bin');
    expect(numberToWords(1001)).toBe('binbir');
    expect(numberToWords(2000)).toBe('ikibin');
    expect(numberToWords(12500)).toBe('onikibinbeşyüz');
  });

  it('milyon ve üstü', () => {
    expect(numberToWords(1000000)).toBe('birmilyon');
    expect(numberToWords(2500000)).toBe('ikimilyonbeşyüzbin');
  });

  it('kuruşu ayrı yazar', () => {
    expect(amountInWords(240)).toBe('ikiyüzkırk TL');
    expect(amountInWords(240.5)).toBe('ikiyüzkırk TL elli kuruş');
    expect(amountInWords(0)).toBe('sıfır TL');
    expect(amountInWords(0.07)).toBe('sıfır TL yedi kuruş');
  });

  it('yuvarlama sonrası kuruşu doğru okur', () => {
    expect(amountInWords(1.005)).toBe('bir TL bir kuruş');
  });
});

describe('cari kartı', () => {
  it('firma ve ad birlikte yazılır', () => {
    expect(displayName(customer({ company: 'Akyıldız Ltd.' }))).toBe(
      'Akyıldız Ltd. (Ahmet Yılmaz)',
    );
    expect(displayName(customer({ name: '', company: 'Akyıldız Ltd.' }))).toBe('Akyıldız Ltd.');
    expect(displayName(customer({ name: '', company: '' }))).toBe('İsimsiz cari');
  });

  it('ad veya firma zorunlu', () => {
    expect(validateCustomer(customer({ name: '', company: '' })).join(' ')).toContain('gerekli');
    expect(validateCustomer(customer())).toEqual([]);
  });

  it('VKN 10, TCKN 11 hane kabul eder', () => {
    expect(validateCustomer(customer({ taxNumber: '1234567890' }))).toEqual([]);
    expect(validateCustomer(customer({ taxNumber: '12345678901' }))).toEqual([]);
    expect(validateCustomer(customer({ taxNumber: '12345' })).join(' ')).toContain('10 (VKN)');
  });

  it('geçersiz e-postayı yakalar', () => {
    expect(validateCustomer(customer({ email: 'abc' })).join(' ')).toContain('E-posta');
    expect(validateCustomer(customer({ email: 'a@b.co' }))).toEqual([]);
  });

  it('arama ad, telefon ve vergi numarasında çalışır', () => {
    const list = [
      customer({ id: 'a', name: 'Ahmet Yılmaz', phone: '0532 111 22 33' }),
      customer({ id: 'b', name: 'Zeynep Kaya', taxNumber: '9876543210' }),
    ];
    expect(searchCustomers(list, 'yılmaz').map((c) => c.id)).toEqual(['a']);
    expect(searchCustomers(list, '9876').map((c) => c.id)).toEqual(['b']);
    expect(searchCustomers(list, '0532').map((c) => c.id)).toEqual(['a']);
    expect(searchCustomers(list, '')).toHaveLength(2);
  });

  it('Türkçe büyük/küçük harf ayrımını gözetir', () => {
    const list = [customer({ id: 'a', name: 'IŞIL Tasarım' })];
    expect(searchCustomers(list, 'ışıl').map((c) => c.id)).toEqual(['a']);
  });
});

describe('buildInvoice / validateInvoice', () => {
  it('cari bilgisini dondurur', () => {
    const source = customer({ company: 'Akyıldız Ltd.' });
    const built = buildInvoice({
      id: 'i9',
      number: 'FTR-2026-0009',
      kind: 'proforma',
      orderId: 'o1',
      customer: source,
      lines: [line('Ejderha', 2, 89.999)],
      vatRate: 20,
      today: '2026-08-29',
      at: '2026-08-29T10:00:00.000Z',
    });
    expect(built.customerId).toBe('c1');
    expect(built.customer.company).toBe('Akyıldız Ltd.');
    expect(built.lines[0].unitPrice).toBe(90);

    // Cari sonradan değişse bile fatura değişmez.
    source.company = 'Yeni Unvan';
    expect(built.customer.company).toBe('Akyıldız Ltd.');
  });

  it('carisiz fatura da kurulabilir ama doğrulamadan geçmez', () => {
    const built = buildInvoice({
      id: 'i9',
      number: 'FTR-2026-0009',
      kind: 'invoice',
      orderId: null,
      customer: null,
      lines: [line('Ejderha', 1, 10)],
      vatRate: 20,
      today: '2026-08-29',
      at: '2026-08-29T10:00:00.000Z',
    });
    expect(validateInvoice(built).join(' ')).toContain('Müşteri');
  });

  it('boş kalem ve sıfır adet yakalanır', () => {
    expect(validateInvoice(invoice({ lines: [] })).join(' ')).toContain('en az bir kalem');
    expect(validateInvoice(invoice({ lines: [line('', 1, 5)] })).join(' ')).toContain('Kalem adı');
    expect(validateInvoice(invoice({ lines: [line('x', 0, 5)] })).join(' ')).toContain('Adet');
  });

  it('geçerli fatura sorunsuzdur', () => {
    expect(validateInvoice(invoice())).toEqual([]);
  });
});

describe('liste yardımcıları', () => {
  it("kesilmiş faturaları ve KDV'yi toplar", () => {
    const list = [invoice(), invoice({ id: 'i2', kind: 'proforma' })];
    const summary = summarizeInvoices(list);
    expect(summary.count).toBe(2);
    expect(summary.proforma).toBe(1);
    expect(summary.invoiced).toBe(1);
    // Proforma ciroya sayılmaz.
    expect(summary.total).toBe(240);
    expect(summary.vat).toBe(40);
  });

  it('yeniden eskiye sıralar', () => {
    const list = [
      invoice({ id: 'a', number: 'FTR-2026-0001', issuedAt: '2026-08-01' }),
      invoice({ id: 'b', number: 'FTR-2026-0002', issuedAt: '2026-08-29' }),
      invoice({ id: 'c', number: 'FTR-2026-0003', issuedAt: '2026-08-29' }),
    ];
    expect(sortInvoices(list).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('dosya adında firma unvanı önceliklidir', () => {
    const name = invoiceFileName(
      invoice({ customer: snapshotOf(customer({ company: 'Akyıldız Ltd.' })) }),
    );
    // Parantezli tam ad degil, tek kimlik yazilir.
    expect(name).toBe('FTR-2026-0001 - Akyıldız Ltd.pdf');
  });

  it('kesilen ad yarım noktalama ile bitmez', () => {
    const long = 'Çok Uzun Bir Firma Unvanı Anonim Şirketi (Merkez Şube)';
    const name = invoiceFileName(invoice({ customer: snapshotOf(customer({ company: long })) }));
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toMatch(/[\s.,;(-]\.pdf$/);
  });

  it('dosya adında yasak karakter bırakmaz', () => {
    const name = invoiceFileName(invoice({ customer: snapshotOf(customer({ name: 'A/B:C*D?' })) }));
    expect(name).toBe('FTR-2026-0001 - ABCD.pdf');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
