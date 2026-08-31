import { describe, expect, it } from 'vitest';
import { renderInvoiceHtml } from '../lib/invoiceHtml';
import { EMPTY_SELLER, newCustomer, snapshotOf } from '../lib/invoice';
import type { Branding, Invoice } from '../types';

const invoice: Invoice = {
  id: 'i1',
  number: 'FTR-2026-0001',
  kind: 'invoice',
  orderId: null,
  customerId: 'c1',
  customer: snapshotOf({
    ...newCustomer('c1', '2026-08-01T00:00:00.000Z'),
    name: 'Ahmet Yılmaz',
    company: 'Akyıldız Ltd.',
  }),
  lines: [{ name: 'Ejderha', quantity: 2, unitPrice: 100 }],
  vatRate: 20,
  vatIncluded: false,
  discount: 0,
  issuedAt: '2026-08-29',
  dueDate: '2026-09-05',
  notes: '',
  createdAt: '2026-08-29T00:00:00.000Z',
};

const branding: Branding = {
  businessName: 'Axthrowa 3D Baskı',
  logo: 'data:image/png;base64,iVBORw0KGgo=',
  signature: 'data:image/png;base64,iVBORw0KGgo=',
  signatureLabel: 'Yetkili imza',
};

describe('fatura belgesi', () => {
  const html = renderInvoiceHtml(invoice, EMPTY_SELLER, branding);

  it('QR kodu gömer', () => {
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('shape-rendering="crispEdges"');
  });

  it('logo ve imzayı yerleştirir', () => {
    expect(html).toContain('class="logo"');
    expect(html).toContain('Yetkili imza');
    expect(html.match(/data:image\/png/g)?.length).toBe(2);
  });

  it('işletme adını başlığa yazar', () => {
    expect(html).toContain('Axthrowa 3D Baskı');
  });

  it('geliştirici imzasını taşır', () => {
    expect(html).toContain('Created by axthrowa');
  });

  it('müşteri adındaki işaretleri kaçırır', () => {
    const risky = {
      ...invoice,
      customer: { ...invoice.customer, name: '<script>alert(1)</script>' },
    };
    const out = renderInvoiceHtml(risky, EMPTY_SELLER, branding);
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });

  it('markasız da çalışır', () => {
    const plain = renderInvoiceHtml(invoice, EMPTY_SELLER);
    expect(plain).toContain('FTR-2026-0001');
    expect(plain).not.toContain('class="logo"');
  });
});
