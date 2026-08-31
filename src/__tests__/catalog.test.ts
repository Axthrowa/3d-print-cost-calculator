import { describe, expect, it } from 'vitest';
import {
  defaultAssignment,
  itemFromProduct,
  migrateOrders,
  priceItem,
  priceOrder,
  priceProduct,
  productModelGrams,
  productTotalGrams,
  productWasteGrams,
  toInputs,
} from '../lib/catalog';
import { sortOrders } from '../lib/tracking';
import type {
  CalculatorInputs,
  CatalogProduct,
  CatalogTool,
  FilamentSpool,
  Order,
  OrderItem,
} from '../types';

const spools: FilamentSpool[] = [
  {
    id: 'pla',
    brand: 'Bambu Lab',
    material: 'PLA',
    color: 'Turuncu',
    rollPrice: 900,
    rollWeight: 1000,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: 'petg',
    brand: 'eSUN',
    material: 'PETG',
    color: 'Siyah',
    rollPrice: 1200,
    rollWeight: 1000,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

/** 0,90 TL/g ve 1,20 TL/g gram fiyatları. */
const base: CalculatorInputs = {
  usages: [],
  printHours: 0,
  printMinutes: 0,
  quantity: 1,
  printerWatts: 100,
  kwhPrice: 4,
  depreciationPerHour: 2,
  failureRatePct: 0,
  laborRatePerHour: 0,
  laborMinutes: 0,
  extraCost: 0,
  marginPct: 50,
  vatEnabled: false,
  vatPct: 20,
};

const tools: CatalogTool[] = [
  { toolIndex: 0, colorHex: '#FF6A13', filamentType: 'PLA', modelGrams: 36, wasteGrams: 4 },
  { toolIndex: 1, colorHex: '#0A0A0A', filamentType: 'PETG', modelGrams: 15, wasteGrams: 10 },
];

const product: CatalogProduct = {
  id: 'p1',
  name: 'Hareketli Ejderha',
  notes: '',
  source: 'gcode',
  printSeconds: 7200, // 2 saat
  tools,
  createdAt: '2026-08-20T00:00:00.000Z',
};

describe('ürün gramajları', () => {
  it('model, atık ve toplamı ayırır', () => {
    expect(productModelGrams(product)).toBe(51);
    expect(productWasteGrams(product)).toBe(14);
    expect(productTotalGrams(product)).toBe(65);
  });

  it('negatif değerleri saymaz', () => {
    const bad = { tools: [{ ...tools[0], modelGrams: -5, wasteGrams: -2 }] };
    expect(productModelGrams(bad)).toBe(0);
    expect(productWasteGrams(bad)).toBe(0);
  });
});

describe('defaultAssignment', () => {
  it('malzeme türüne göre makara eşler', () => {
    expect(defaultAssignment(tools, spools)).toEqual({ 0: 'pla', 1: 'petg' });
  });

  it('tür eşleşmezse ilk makarayı verir', () => {
    const odd: CatalogTool[] = [{ ...tools[0], filamentType: 'ASA' }];
    expect(defaultAssignment(odd, spools)).toEqual({ 0: 'pla' });
  });

  it('envanter boşsa null atar', () => {
    expect(defaultAssignment(tools, [])).toEqual({ 0: null, 1: null });
  });
});

describe('toInputs', () => {
  it('süreyi saat/dakikaya böler ve satırları kurar', () => {
    const inputs = toInputs(tools, 9000, 3, { 0: 'pla', 1: 'petg' }, base);
    expect(inputs.printHours).toBe(2);
    expect(inputs.printMinutes).toBe(30);
    expect(inputs.quantity).toBe(3);
    expect(inputs.usages).toHaveLength(2);
    expect(inputs.usages[0]).toMatchObject({ spoolId: 'pla', grams: 36, wasteGrams: 4 });
    expect(inputs.usages[1]).toMatchObject({ spoolId: 'petg', grams: 15, wasteGrams: 10 });
  });

  it('güncel ayarları korur', () => {
    const inputs = toInputs(tools, 3600, 1, {}, { ...base, printerWatts: 250, kwhPrice: 5 });
    expect(inputs.printerWatts).toBe(250);
    expect(inputs.kwhPrice).toBe(5);
  });

  it('adedi en az 1 yapar', () => {
    expect(toInputs(tools, 3600, 0, {}, base).quantity).toBe(1);
  });
});

describe('priceProduct — güncel fiyatlarla', () => {
  const assignment = { 0: 'pla', 1: 'petg' };

  it('malzeme, atık ve elektriği doğru hesaplar', () => {
    const result = priceProduct(product, 1, assignment, spools, base);
    // model: 36*0.9 + 15*1.2 = 32.4 + 18 = 50.4
    expect(result.modelFilamentCost).toBeCloseTo(50.4, 6);
    // atık: 4*0.9 + 10*1.2 = 3.6 + 12 = 15.6
    expect(result.wasteFilamentCost).toBeCloseTo(15.6, 6);
    // elektrik: 0.1 kW * 2 sa * 4 = 0.8 ; amortisman: 2*2 = 4
    expect(result.electricityCost).toBeCloseTo(0.8, 6);
    expect(result.depreciationCost).toBeCloseTo(4, 6);
    expect(result.netCost).toBeCloseTo(70.8, 6);
    expect(result.salePrice).toBeCloseTo(106.2, 6); // %50 marj
  });

  it('filament zamlanınca fiyat kendiliğinden artar', () => {
    const zamli = spools.map((s) => (s.id === 'pla' ? { ...s, rollPrice: 1800 } : s));
    const before = priceProduct(product, 1, assignment, spools, base);
    const after = priceProduct(product, 1, assignment, zamli, base);
    // PLA gram fiyatı 0.9 -> 1.8 ; 40 g PLA kullanılıyor => +36 TL
    expect(after.netCost - before.netCost).toBeCloseTo(36, 6);
  });

  it('elektrik zammı da yansır', () => {
    const before = priceProduct(product, 1, assignment, spools, base);
    const after = priceProduct(product, 1, assignment, spools, { ...base, kwhPrice: 8 });
    expect(after.netCost - before.netCost).toBeCloseTo(0.8, 6);
  });

  it('adet tüm kalemleri ölçekler', () => {
    const single = priceProduct(product, 1, assignment, spools, base);
    const triple = priceProduct(product, 3, assignment, spools, base);
    expect(triple.netCost).toBeCloseTo(single.netCost * 3, 6);
  });

  it('farklı makara seçimi maliyeti değiştirir', () => {
    const ucuz = priceProduct(product, 1, { 0: 'pla', 1: 'pla' }, spools, base);
    const pahali = priceProduct(product, 1, { 0: 'petg', 1: 'petg' }, spools, base);
    expect(pahali.netCost).toBeGreaterThan(ucuz.netCost);
  });
});

// ---------------------------------------------------------------------------

const item = (over: Partial<OrderItem> = {}): OrderItem => ({
  id: 'i1',
  productId: 'p1',
  name: 'Hareketli Ejderha',
  quantity: 1,
  printSeconds: 7200,
  tools,
  assignment: { 0: 'pla', 1: 'petg' },
  ...over,
});

const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  code: 'SIP-001',
  customer: 'Ahmet Yılmaz',
  status: 'pending',
  dueDate: '2026-09-05',
  notes: '',
  createdAt: '2026-08-20T10:00:00.000Z',
  marginPct: 50,
  items: [item()],
  ...over,
});

describe('priceItem', () => {
  it('dökümlü kalemi hesaplar', () => {
    const priced = priceItem(item({ quantity: 2 }), spools, base);
    expect(priced.netCost).toBeCloseTo(141.6, 6);
    expect(priced.modelGrams).toBe(102);
    expect(priced.wasteGrams).toBe(28);
  });

  it('elle girilen kalemde doğrudan tutarları kullanır', () => {
    const manual = item({
      tools: [],
      quantity: 3,
      manualUnitCost: 20,
      manualUnitPrice: 35,
      printSeconds: 0,
    });
    const priced = priceItem(manual, spools, base);
    expect(priced.netCost).toBe(60);
    expect(priced.salePrice).toBe(105);
    expect(priced.result).toBeNull();
  });

  it('elle kalemde fiyat yoksa maliyeti kullanır', () => {
    const priced = priceItem(item({ tools: [], manualUnitCost: 40 }), spools, base);
    expect(priced.salePrice).toBe(40);
  });
});

describe('priceOrder', () => {
  it('çok kalemli fişi toplar', () => {
    const pricing = priceOrder(
      order({
        items: [
          item({ id: 'a', quantity: 2 }),
          item({ id: 'b', tools: [], manualUnitCost: 10, manualUnitPrice: 25, printSeconds: 0 }),
        ],
      }),
      spools,
      base,
    );
    expect(pricing.items).toHaveLength(2);
    expect(pricing.netCost).toBeCloseTo(151.6, 6); // 141.6 + 10
    expect(pricing.salePrice).toBeCloseTo(237.4, 6); // 212.4 + 25
    expect(pricing.profit).toBeCloseTo(85.8, 6);
    expect(pricing.itemCount).toBe(3);
  });

  it('siparişin kendi kâr marjını uygular', () => {
    const yuzde100 = priceOrder(order({ marginPct: 100 }), spools, base);
    expect(yuzde100.salePrice).toBeCloseTo(yuzde100.netCost * 2, 6);
  });

  it('model ve atık maliyetini ayrı toplar', () => {
    const pricing = priceOrder(order(), spools, base);
    expect(pricing.modelFilamentCost).toBeCloseTo(50.4, 6);
    expect(pricing.wasteFilamentCost).toBeCloseTo(15.6, 6);
    expect(pricing.modelGrams).toBe(51);
    expect(pricing.wasteGrams).toBe(14);
  });

  it('makara seçilmemiş kalemi uyarır', () => {
    const pricing = priceOrder(
      order({ items: [item({ assignment: { 0: null, 1: null } })] }),
      spools,
      base,
    );
    expect(pricing.warnings.join(' ')).toContain('filament seçilmemiş');
  });

  it('boş siparişte çökmez', () => {
    const pricing = priceOrder(order({ items: [] }), spools, base);
    expect(pricing.netCost).toBe(0);
    expect(pricing.warnings.join(' ')).toContain('hiç kalem yok');
  });
});

describe('itemFromProduct', () => {
  it('üründen kalem üretir ve makara atar', () => {
    const created = itemFromProduct(product, 2, spools, 'yeni');
    expect(created).toMatchObject({ productId: 'p1', name: 'Hareketli Ejderha', quantity: 2 });
    expect(created.assignment).toEqual({ 0: 'pla', 1: 'petg' });
    // Araçlar kopyalanmalı; ürün sonradan değişirse sipariş etkilenmemeli.
    expect(created.tools).not.toBe(product.tools);
    expect(created.tools[0]).not.toBe(product.tools[0]);
  });
});

describe('migrateOrders', () => {
  it('eski tek kalemli siparişi fişe çevirir', () => {
    const legacy = [
      {
        id: 'o9',
        code: 'SIP-009',
        customer: 'Ayşe',
        status: 'pending',
        dueDate: '2026-09-01',
        notes: 'not',
        createdAt: '2026-08-01T00:00:00.000Z',
        title: 'Vazo',
        quantity: 2,
        unitPrice: 150,
        unitCost: 100,
      },
    ];
    const [migrated] = migrateOrders(legacy, 40);
    expect(migrated.items).toHaveLength(1);
    expect(migrated.items[0]).toMatchObject({
      name: 'Vazo',
      quantity: 2,
      manualUnitCost: 100,
      manualUnitPrice: 150,
    });
    expect(migrated.marginPct).toBe(50); // (150-100)/100
    const pricing = priceOrder(migrated, spools, base);
    expect(pricing.netCost).toBe(200);
    expect(pricing.salePrice).toBe(300);
  });

  it('yeni biçimi olduğu gibi bırakır', () => {
    const [kept] = migrateOrders([order()], 40);
    expect(kept.items).toHaveLength(1);
    expect(kept.marginPct).toBe(50);
  });

  it('bozuk girdide çökmez', () => {
    expect(migrateOrders(null, 40)).toEqual([]);
    expect(migrateOrders('bozuk', 40)).toEqual([]);
    expect(migrateOrders([null, undefined], 40)).toEqual([]);
  });
});

describe('migrateOrders — cari bağlantısı', () => {
  it('customerId taşınır', () => {
    const raw = [
      {
        id: 'o1',
        code: 'SIP-0001',
        customer: 'Akyıldız Ltd.',
        customerId: 'c1',
        status: 'pending',
        dueDate: '2026-09-05',
        notes: '',
        createdAt: '2026-08-28T00:00:00.000Z',
        marginPct: 35,
        items: [],
      },
    ];
    expect(migrateOrders(raw, 40)[0].customerId).toBe('c1');
  });

  it('cari yoksa alan eklenmez', () => {
    const raw = [
      {
        id: 'o1',
        code: 'SIP-0001',
        customer: 'Elle yazıldı',
        status: 'pending',
        dueDate: '',
        notes: '',
        createdAt: '2026-08-28T00:00:00.000Z',
        items: [],
      },
    ];
    expect(migrateOrders(raw, 40)[0].customerId).toBeUndefined();
  });
});

describe('priceOrder — baskı sonrası işçilik', () => {
  const order = (labour?: Order['labour']): Order => ({
    id: 'o1',
    code: 'SIP-0001',
    customer: 'Ahmet',
    status: 'pending',
    dueDate: '',
    notes: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    marginPct: 50,
    items: [],
    ...(labour ? { labour } : {}),
  });

  it('işçilik yoksa toplamı değiştirmez', () => {
    const pricing = priceOrder(order(), spools, base);
    expect(pricing.labourCost).toBe(0);
    expect(pricing.netCost).toBe(0);
  });

  it('işçilik hem maliyete hem satışa eklenir', () => {
    const pricing = priceOrder(
      order([{ id: 'l1', name: 'Boyama', hours: 2, hourlyRate: 200 }]),
      spools,
      base,
    );
    expect(pricing.labourCost).toBe(400);
    expect(pricing.netCost).toBe(400);
    expect(pricing.salePrice).toBe(400);
  });

  it('işçiliğe kâr marjı bindirilmez', () => {
    // %50 marja rağmen işçilik 1:1 geçer; kâr yalnızca üretimden gelir.
    const pricing = priceOrder(
      order([{ id: 'l1', name: 'Zımpara', hours: 1, hourlyRate: 150 }]),
      spools,
      base,
    );
    expect(pricing.salePrice - pricing.netCost).toBe(0);
  });

  it('toplam işçilik saatini bildirir', () => {
    const pricing = priceOrder(
      order([
        { id: 'l1', name: 'Boyama', hours: 2, hourlyRate: 200 },
        { id: 'l2', name: 'Montaj', hours: 0.5, hourlyRate: 200 },
      ]),
      spools,
      base,
    );
    expect(pricing.labourHours).toBe(2.5);
    expect(pricing.labourCost).toBe(500);
  });
});

describe('bozuk durum değerleri uygulamayı çökertmez', () => {
  it('null/bilinmeyen sipariş durumunu "pending" yapar', () => {
    const raw = [
      { ...order(), status: null },
      { ...order(), id: 'o2', status: 'uydurma' },
      { ...order(), id: 'o3' },
    ];
    const migrated = migrateOrders(raw, 40);
    expect(migrated.map((o) => o.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('durumu olan siparişi olduğu gibi bırakır', () => {
    const raw = [{ ...order(), status: 'delivered' }];
    expect(migrateOrders(raw, 40)[0].status).toBe('delivered');
  });

  it('kalem durumlarını da temizler', () => {
    const raw = [
      {
        ...order(),
        items: [
          { ...item({ id: 'a' }), status: null },
          { ...item({ id: 'b' }), status: 'saçma' },
          { ...item({ id: 'c' }), status: 'printing' },
        ],
      },
    ];
    const [migrated] = migrateOrders(raw, 40);
    expect(migrated.items.map((i) => i.status)).toEqual(['waiting', 'waiting', 'printing']);
  });
});

describe('elle girilen satış fiyatı', () => {
  it('malzemeli kalemde hesaplanan fiyatın yerine geçer', () => {
    const otomatik = priceItem(item({ quantity: 2 }), spools, base);
    const elle = priceItem(item({ quantity: 2, manualUnitPrice: 500 }), spools, base);

    expect(elle.salePrice).toBe(1000);
    expect(elle.salePrice).not.toBe(otomatik.salePrice);
    // Maliyet malzemeden hesaplanmaya devam eder; kâr marjı gerçekçi kalsın.
    expect(elle.netCost).toBeCloseTo(otomatik.netCost, 6);
  });

  it('ürünün elle fiyatı sipariş kalemine taşınır', () => {
    const withPrice: CatalogProduct = { ...product, manualPrice: 750 };
    const created = itemFromProduct(withPrice, 2, spools, 'i1');
    expect(created.manualUnitPrice).toBe(750);
    expect(priceItem(created, spools, base).salePrice).toBe(1500);
  });

  it('fiyat girilmemiş üründe alan hiç oluşmaz', () => {
    expect('manualUnitPrice' in itemFromProduct(product, 1, spools, 'i2')).toBe(false);
  });

  it('negatif fiyatı sıfıra çeker', () => {
    expect(priceItem(item({ manualUnitPrice: -10 }), spools, base).salePrice).toBe(0);
  });
});

describe('eksik metin alanları sıralamayı çökertmez', () => {
  it('null createdAt/code/customer değerlerini boşa çevirir', () => {
    const raw = [{ ...order(), createdAt: null, code: null, customer: null, notes: null }];
    const [migrated] = migrateOrders(raw, 40);
    expect(migrated.createdAt).toBe('');
    // Kod boş kalırsa kart başlıksız görünür; kimlik yedek olarak kullanılır.
    expect(migrated.code).toBe(migrated.id);
    expect(migrated.customer).toBe('');
    expect(migrated.notes).toBe('');
  });

  it('kimliksiz kaydı almaz', () => {
    const raw = [{ ...order(), id: null }, { ...order() }];
    expect(migrateOrders(raw, 40)).toHaveLength(1);
  });

  it('göçürülen siparişler sıralanabilir', () => {
    const raw = [
      { ...order(), id: 'a', createdAt: null },
      { ...order(), id: 'b', createdAt: '2026-08-01T00:00:00.000Z' },
    ];
    const migrated = migrateOrders(raw, 40);
    expect(() => sortOrders(migrated, Date.parse('2026-08-30T00:00:00.000Z'))).not.toThrow();
    expect(sortOrders(migrated, Date.parse('2026-08-30T00:00:00.000Z'))[0].id).toBe('b');
  });
});
