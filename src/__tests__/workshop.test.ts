import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAINTENANCE,
  NOTIFY_TEMPLATES,
  labourCost,
  labourHours,
  labourLabel,
  labourTotal,
  maintenanceStatus,
  markMaintenanceDone,
  newLabour,
  printersDueForMaintenance,
  renderTemplate,
  templateVarsOf,
  whatsappLink,
} from '../lib/workshop';
import type { Order } from '../types';

const order: Order = {
  id: 'o1',
  code: 'SIP-0042',
  customer: 'Ahmet Yılmaz',
  status: 'delivered',
  dueDate: '2026-09-05',
  notes: '',
  createdAt: '2026-08-28T00:00:00.000Z',
  marginPct: 35,
  trackingCode: 'AB123456789TR',
  shippingCarrier: 'Yurtiçi Kargo',
  items: [
    {
      id: 'i1',
      productId: null,
      name: 'Ejderha',
      quantity: 2,
      printSeconds: 0,
      tools: [],
      assignment: {},
    },
  ],
};

describe('işçilik', () => {
  it('saat × ücret hesaplar', () => {
    expect(labourCost(newLabour('l1', 'Boyama', 2, 200))).toBe(400);
    expect(labourCost(newLabour('l2', 'Zımpara', 0.5, 150))).toBe(75);
  });

  it('negatif değerleri saymaz', () => {
    expect(labourCost(newLabour('l1', 'x', -2, 200))).toBe(0);
    expect(labourCost(newLabour('l2', 'x', 2, -200))).toBe(0);
  });

  it('kuruş hassasiyetini korur', () => {
    expect(labourCost(newLabour('l1', 'x', 0.33, 199.9))).toBe(65.97);
  });

  it('toplamı ve saatleri toplar', () => {
    const list = [newLabour('a', 'Boyama', 2, 200), newLabour('b', 'Zımpara', 1, 150)];
    expect(labourTotal(list)).toBe(550);
    expect(labourHours(list)).toBe(3);
  });

  it('boş listede sıfır döner', () => {
    expect(labourTotal(undefined)).toBe(0);
    expect(labourTotal([])).toBe(0);
    expect(labourHours(undefined)).toBe(0);
  });

  it('fatura açıklaması okunur biçimde', () => {
    expect(labourLabel(newLabour('a', 'Boyama', 2, 200))).toBe('Boyama (2 sa × 200 TL/sa)');
    expect(labourLabel(newLabour('b', 'Zımpara', 0.5, 150))).toBe('Zımpara (0,50 sa × 150 TL/sa)');
  });

  it('adsız kalem "İşçilik" olur', () => {
    expect(labourLabel(newLabour('a', '', 1, 100))).toContain('İşçilik');
  });
});

describe('bakım takibi', () => {
  const settings = { intervalHours: 300, done: { 'Ender 3': 100 } };

  it('son bakımdan bu yana geçen süreyi bulur', () => {
    const status = maintenanceStatus('Ender 3', 250, settings);
    expect(status.sinceHours).toBe(150);
    expect(status.remainingHours).toBe(150);
    expect(status.ratio).toBeCloseTo(0.5, 6);
    expect(status.due).toBe(false);
  });

  it('eşiğe gelince uyarır', () => {
    expect(maintenanceStatus('Ender 3', 400, settings).due).toBe(true);
  });

  it('gecikmişse kalan süre negatiftir', () => {
    expect(maintenanceStatus('Ender 3', 500, settings).remainingHours).toBe(-100);
  });

  it('hiç bakım yapılmamış yazıcıda sıfırdan sayar', () => {
    const status = maintenanceStatus('Yeni', 120, settings);
    expect(status.sinceHours).toBe(120);
  });

  it('oran biri aşmaz', () => {
    expect(maintenanceStatus('Ender 3', 5000, settings).ratio).toBe(1);
  });

  it('bakım yapılınca sayaç sıfırlanır', () => {
    const next = markMaintenanceDone(settings, 'Ender 3', 400);
    expect(next.done['Ender 3']).toBe(400);
    expect(maintenanceStatus('Ender 3', 400, next).sinceHours).toBe(0);
    expect(maintenanceStatus('Ender 3', 400, next).due).toBe(false);
    // Girdi değişmemeli.
    expect(settings.done['Ender 3']).toBe(100);
  });

  it('bakımı gelen yazıcıları listeler', () => {
    const hours = { 'Ender 3': 500, 'Bambu P1S': 50, 'Prusa MK4': 320 };
    expect(printersDueForMaintenance(hours, settings)).toEqual(['Ender 3', 'Prusa MK4']);
  });

  it('varsayılan aralık 300 saattir', () => {
    expect(DEFAULT_MAINTENANCE.intervalHours).toBe(300);
  });

  it('sıfır aralık bölme hatası yapmaz', () => {
    const status = maintenanceStatus('x', 10, { intervalHours: 0, done: {} });
    expect(Number.isFinite(status.ratio)).toBe(true);
  });
});

describe('bildirim şablonları', () => {
  const vars = templateVarsOf(order, '₺1.250,00', 'Ahmet Yılmaz');

  it('sipariş bilgilerini toplar', () => {
    expect(vars.siparisNo).toBe('SIP-0042');
    expect(vars.urunler).toBe('Ejderha x2');
    expect(vars.kargoKodu).toBe('AB123456789TR');
    expect(vars.kargoFirma).toBe('Yurtiçi Kargo');
  });

  it('kargo şablonunu doldurur', () => {
    const text = renderTemplate(NOTIFY_TEMPLATES.delivered!.body, vars);
    expect(text).toContain('Sayın Ahmet Yılmaz');
    expect(text).toContain('SIP-0042');
    expect(text).toContain('AB123456789TR');
    expect(text).toContain('Yurtiçi Kargo');
    // Doldurulmamış yer tutucu kalmamalı.
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it('eksik değişkeni müşteriye göstermez', () => {
    const bare = templateVarsOf(
      { ...order, trackingCode: '', shippingCarrier: '' },
      '₺0,00',
      'Ali',
    );
    const text = renderTemplate(NOTIFY_TEMPLATES.delivered!.body, bare);
    expect(text).not.toContain('{kargoKodu}');
    expect(text).not.toContain('  ');
  });

  it('müşteri adı yoksa nazik bir varsayılan kullanır', () => {
    const anon = templateVarsOf({ ...order, customer: '' }, '₺0,00', '');
    expect(anon.musteriAd).toBe('Müşterimiz');
  });

  it('her durum için şablon vardır', () => {
    expect(NOTIFY_TEMPLATES.printing?.label).toBe('Baskıya alındı');
    expect(NOTIFY_TEMPLATES.ready?.label).toBe('Tamamlandı');
    expect(NOTIFY_TEMPLATES.delivered?.label).toBe('Kargolandı');
  });
});

describe('whatsappLink', () => {
  it('Türkiye numarasını uluslararası biçime çevirir', () => {
    const link = whatsappLink('0532 111 22 33', 'merhaba');
    expect(link).toContain('https://wa.me/905321112233');
    expect(link).toContain('merhaba');
  });

  it('zaten 90 ile başlayanı bozmaz', () => {
    expect(whatsappLink('905321112233', 'x')).toContain('wa.me/905321112233');
  });

  it('mesajı kaçırır', () => {
    expect(whatsappLink('05321112233', 'a&b c')).toContain('a%26b%20c');
  });

  it('geçersiz numarada null döner', () => {
    expect(whatsappLink('123', 'x')).toBeNull();
    expect(whatsappLink('', 'x')).toBeNull();
  });
});
