import { describe, expect, it } from 'vitest';
import {
  actualHours,
  daysUntilDue,
  isOverdue,
  jobProgress,
  jobProgressLive,
  nextOrderCode,
  sortJobs,
  sortOrders,
  searchOrders,
  summarizeJobs,
  summarizeOrders,
} from '../lib/tracking';
import type { CalculatorInputs, Customer, FilamentSpool, Order, PrintJob } from '../types';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

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
];

const base: CalculatorInputs = {
  usages: [],
  printHours: 0,
  printMinutes: 0,
  quantity: 1,
  printerWatts: 0,
  kwhPrice: 0,
  depreciationPerHour: 0,
  failureRatePct: 0,
  laborRatePerHour: 0,
  laborMinutes: 0,
  extraCost: 0,
  marginPct: 50,
  vatEnabled: false,
  vatPct: 20,
};

/** Maliyeti 90 TL, satisi 135 TL olan tek kalemli sipariş. */
const order = (over: Partial<Order> = {}): Order => ({
  id: 'o1',
  code: 'SIP-001',
  customer: 'Ahmet Yılmaz',
  status: 'pending',
  dueDate: '2026-09-05',
  notes: '',
  createdAt: '2026-08-20T10:00:00.000Z',
  marginPct: 50,
  items: [
    {
      id: 'i1',
      productId: null,
      name: 'Vazo',
      quantity: 2,
      printSeconds: 0,
      tools: [],
      assignment: {},
      manualUnitCost: 90,
      manualUnitPrice: 150,
    },
  ],
  ...over,
});

const job = (over: Partial<PrintJob> = {}): PrintJob => ({
  id: 'j1',
  name: 'Vazo',
  printerName: 'Bambu Lab P1S',
  materials: [{ spoolId: 's1', grams: 50 }],
  grams: 50,
  estimatedHours: 4,
  status: 'queued',
  startedAt: null,
  finishedAt: null,
  orderId: null,
  notes: '',
  ...over,
});

describe('teslim tarihi', () => {
  it('geçmiş tarihli açık sipariş gecikmiştir', () => {
    expect(isOverdue(order({ dueDate: '2026-08-20' }), NOW)).toBe(true);
  });

  it('gelecek tarihli sipariş gecikmiş değildir', () => {
    expect(isOverdue(order({ dueDate: '2026-09-05' }), NOW)).toBe(false);
  });

  it('teslim edilen veya iptal edilen sipariş gecikmiş sayılmaz', () => {
    expect(isOverdue(order({ dueDate: '2026-08-01', status: 'delivered' }), NOW)).toBe(false);
    expect(isOverdue(order({ dueDate: '2026-08-01', status: 'cancelled' }), NOW)).toBe(false);
  });

  it('tarih boşsa gecikme yoktur', () => {
    expect(isOverdue(order({ dueDate: '' }), NOW)).toBe(false);
    expect(daysUntilDue(order({ dueDate: '' }), NOW)).toBeNull();
  });

  it('kalan gün sayısını verir', () => {
    expect(daysUntilDue(order({ dueDate: '2026-08-31' }), NOW)).toBe(2);
    expect(daysUntilDue(order({ dueDate: '2026-08-27' }), NOW)).toBeLessThan(0);
  });
});

describe('nextOrderCode', () => {
  it('boş listede ilk kodu üretir', () => {
    expect(nextOrderCode([])).toBe('SIP-001');
  });

  it('en yüksek numaradan devam eder', () => {
    expect(nextOrderCode([order({ code: 'SIP-003' }), order({ code: 'SIP-007' })])).toBe('SIP-008');
  });

  it('bozuk kodları yok sayar', () => {
    expect(nextOrderCode([order({ code: 'ozel-kod' }), order({ code: 'SIP-002' })])).toBe(
      'SIP-003',
    );
  });
});

describe('summarizeOrders', () => {
  it('durumlara göre sayar ve ciroyu ayırır', () => {
    const summary = summarizeOrders(
      [
        order({ id: 'a', status: 'pending' }),
        order({ id: 'b', status: 'delivered' }),
        order({ id: 'c', status: 'cancelled' }),
        order({ id: 'd', status: 'printing', dueDate: '2026-08-01' }),
      ],
      NOW,
      spools,
      base,
    );
    expect(summary.total).toBe(4);
    expect(summary.counts.pending).toBe(1);
    expect(summary.counts.cancelled).toBe(1);
    expect(summary.openCount).toBe(2);
    expect(summary.openRevenue).toBe(600);
    expect(summary.deliveredRevenue).toBe(300);
    expect(summary.overdue).toBe(1);
  });

  it('iptal edilen siparişi kâra katmaz', () => {
    const summary = summarizeOrders([order({ status: 'cancelled' })], NOW, spools, base);
    expect(summary.profit).toBe(0);
  });

  it('boş listede çökmez', () => {
    const summary = summarizeOrders([], NOW, spools, base);
    expect(summary.total).toBe(0);
    expect(summary.profit).toBe(0);
  });
});

describe('sortOrders', () => {
  it('baskıdakini öne, iptali sona alır', () => {
    const sorted = sortOrders(
      [
        order({ id: 'iptal', status: 'cancelled' }),
        order({ id: 'teslim', status: 'delivered' }),
        order({ id: 'baski', status: 'printing' }),
        order({ id: 'bekle', status: 'pending' }),
      ],
      NOW,
    );
    expect(sorted.map((o) => o.id)).toEqual(['baski', 'bekle', 'teslim', 'iptal']);
  });

  it('aynı durumda teslimi yakın olanı öne alır', () => {
    const sorted = sortOrders(
      [order({ id: 'gec', dueDate: '2026-09-20' }), order({ id: 'yakin', dueDate: '2026-08-30' })],
      NOW,
    );
    expect(sorted[0].id).toBe('yakin');
  });
});

describe('jobProgress', () => {
  it('kuyruktaki iş için ilerleme sıfırdır', () => {
    const progress = jobProgress(job(), NOW);
    expect(progress.ratio).toBe(0);
    expect(progress.remainingHours).toBe(4);
    expect(progress.etaAt).toBeNull();
  });

  it('basılan işin ilerlemesini geçen süreden hesaplar', () => {
    const started = new Date(NOW - 1 * HOUR).toISOString();
    const progress = jobProgress(job({ status: 'printing', startedAt: started }), NOW);
    expect(progress.ratio).toBeCloseTo(0.25, 6);
    expect(progress.elapsedHours).toBeCloseTo(1, 6);
    expect(progress.remainingHours).toBeCloseTo(3, 6);
    expect(progress.etaAt).toBe(Date.parse(started) + 4 * HOUR);
    expect(progress.overrun).toBe(false);
  });

  it('tahmini süre aşıldığında oranı 1 ile sınırlar ve aşımı bildirir', () => {
    const started = new Date(NOW - 6 * HOUR).toISOString();
    const progress = jobProgress(job({ status: 'printing', startedAt: started }), NOW);
    expect(progress.ratio).toBe(1);
    expect(progress.remainingHours).toBe(0);
    expect(progress.overrun).toBe(true);
  });

  it('tamamlanan iş %100, başarısız iş %0 gösterir', () => {
    expect(jobProgress(job({ status: 'done' }), NOW).ratio).toBe(1);
    expect(jobProgress(job({ status: 'failed' }), NOW).ratio).toBe(0);
  });

  it('bozuk başlangıç zamanında çökmez', () => {
    const progress = jobProgress(job({ status: 'printing', startedAt: 'gecersiz' }), NOW);
    expect(progress.ratio).toBe(0);
  });

  it('tahmini süre sıfırsa sıfıra bölme yapmaz', () => {
    const started = new Date(NOW - HOUR).toISOString();
    const progress = jobProgress(
      job({ status: 'printing', startedAt: started, estimatedHours: 0 }),
      NOW,
    );
    expect(progress.ratio).toBe(0);
    expect(Number.isFinite(progress.elapsedHours)).toBe(true);
  });
});

describe('actualHours', () => {
  it('gerçek süreyi hesaplar', () => {
    expect(
      actualHours(
        job({
          startedAt: '2026-08-29T08:00:00.000Z',
          finishedAt: '2026-08-29T12:30:00.000Z',
        }),
      ),
    ).toBeCloseTo(4.5, 6);
  });

  it('eksik veya tutarsız zamanlarda null döner', () => {
    expect(actualHours(job())).toBeNull();
    expect(
      actualHours(
        job({ startedAt: '2026-08-29T12:00:00.000Z', finishedAt: '2026-08-29T08:00:00.000Z' }),
      ),
    ).toBeNull();
  });
});

describe('summarizeJobs', () => {
  it('gerçekleşen fire oranını biten işlerden hesaplar', () => {
    const jobs = [
      job({ id: '1', status: 'done', grams: 100 }),
      job({ id: '2', status: 'done', grams: 100 }),
      job({ id: '3', status: 'done', grams: 100 }),
      job({ id: '4', status: 'failed', grams: 50 }),
      job({ id: '5', status: 'queued' }),
    ];
    const summary = summarizeJobs(jobs, NOW);
    expect(summary.counts.done).toBe(3);
    expect(summary.counts.failed).toBe(1);
    expect(summary.failureRatePct).toBeCloseTo(25, 6);
    expect(summary.totalGrams).toBe(350);
    expect(summary.wastedGrams).toBe(50);
    expect(summary.activeCount).toBe(1);
  });

  it('yeterli veri yoksa bunu bildirir', () => {
    expect(summarizeJobs([job({ status: 'done' })], NOW).hasEnoughData).toBe(false);
  });

  it('hiç biten iş yoksa fire oranı sıfırdır', () => {
    expect(summarizeJobs([job()], NOW).failureRatePct).toBe(0);
    expect(summarizeJobs([], NOW).failureRatePct).toBe(0);
  });

  it('bekleyen süreyi kuyruk ve kalan süreden toplar', () => {
    const started = new Date(NOW - HOUR).toISOString();
    const summary = summarizeJobs(
      [
        job({ id: 'a', status: 'queued', estimatedHours: 2 }),
        job({ id: 'b', status: 'printing', startedAt: started }),
      ],
      NOW,
    );
    expect(summary.pendingHours).toBeCloseTo(5, 6);
  });
});

describe('sortJobs', () => {
  it('basılanı öne, tamamlananı sona alır', () => {
    const sorted = sortJobs([
      job({ id: 'done', status: 'done' }),
      job({ id: 'queued', status: 'queued' }),
      job({ id: 'printing', status: 'printing' }),
      job({ id: 'failed', status: 'failed' }),
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['printing', 'queued', 'failed', 'done']);
  });
});

describe('searchOrders', () => {
  const make = (over: Partial<Order>): Order => ({
    id: 'o1',
    code: 'SIP-0001',
    customer: 'Ahmet Yılmaz',
    status: 'pending',
    dueDate: '2026-09-05',
    notes: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    marginPct: 35,
    items: [],
    ...over,
  });

  const list = [
    make({ id: 'a', code: 'SIP-0001', customer: 'Ahmet Yılmaz' }),
    make({ id: 'b', code: 'SIP-0002', customer: 'Zeynep Kaya', notes: 'acele' }),
    make({
      id: 'c',
      code: 'SIP-0013',
      customer: 'IŞIL Tasarım',
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'Ejderha Figürü',
          quantity: 1,
          printSeconds: 0,
          tools: [],
          assignment: {},
        },
      ],
    }),
  ];

  const customers: Customer[] = [
    {
      id: 'cust-b',
      name: 'Zeynep Kaya',
      company: 'Kaya Tasarım',
      taxOffice: '',
      taxNumber: '9876543210',
      phone: '0532 111 22 33',
      email: 'zeynep@kaya.com',
      address: '',
      notes: '',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  it('boş aramada hepsini döner', () => {
    expect(searchOrders(list, '   ')).toHaveLength(3);
  });

  it('sipariş numarasıyla bulur', () => {
    expect(searchOrders(list, 'SIP-0002').map((o) => o.id)).toEqual(['b']);
  });

  it('numaranın parçasıyla bulur', () => {
    expect(searchOrders(list, '13').map((o) => o.id)).toEqual(['c']);
  });

  it('müşteri adıyla bulur', () => {
    expect(searchOrders(list, 'zeynep').map((o) => o.id)).toEqual(['b']);
  });

  it('Türkçe büyük/küçük harf ayrımını gözetir', () => {
    // "IŞIL" ingilizce küçültmeyle "ışıl" olmaz; Türkçe yerel ayarı şart.
    expect(searchOrders(list, 'ışıl').map((o) => o.id)).toEqual(['c']);
  });

  it('kalem adıyla bulur', () => {
    expect(searchOrders(list, 'ejderha').map((o) => o.id)).toEqual(['c']);
  });

  it('notta arar', () => {
    expect(searchOrders(list, 'acele').map((o) => o.id)).toEqual(['b']);
  });

  it('eşleşme yoksa boş döner', () => {
    expect(searchOrders(list, 'bulunmaz')).toEqual([]);
  });

  it('telefon numarasıyla bulur', () => {
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, '0532 111', customers).map((o) => o.id)).toEqual(['b']);
  });

  it('boşluksuz yazılan telefonu da bulur', () => {
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, '05321112233', customers).map((o) => o.id)).toEqual(['b']);
  });

  it('cari firma unvanıyla bulur', () => {
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, 'kaya tasarım', customers).map((o) => o.id)).toEqual(['b']);
  });

  it('vergi numarasıyla bulur', () => {
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, '9876543210', customers).map((o) => o.id)).toEqual(['b']);
  });

  it('cari bağlı değilse cari alanları taranmaz', () => {
    const loose = [make({ id: 'x', code: 'SIP-0009' })];
    expect(searchOrders(loose, '0532', customers)).toEqual([]);
  });

  it('boşluğu aşan rakam dizisini yakalar', () => {
    // Telefon "0532 111 22 33"; "1122" metinde geçmez, rakamlarda geçer.
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, '1122', customers).map((o) => o.id)).toEqual(['b']);
  });

  it('çok kısa rakam girdisinde normalleştirme yapmaz', () => {
    // "12" metinde yok; iki hane için rakam eşleşmesi açılsaydı yanlış bulurdu.
    const linked = [make({ id: 'b', code: 'SIP-0002', customerId: 'cust-b' })];
    expect(searchOrders(linked, '12', customers)).toEqual([]);
  });
});

describe('jobProgressLive', () => {
  it('yazıcıdan gelen yüzdeyi kullanır', () => {
    const progress = jobProgressLive(
      {
        ...job(),
        status: 'printing',
        startedAt: '2026-08-30T08:00:00.000Z',
        estimatedHours: 2,
        printerLinkId: 'p1',
      },
      NOW,
      {
        state: 'printing',
        raw: 'printing',
        nozzle: null,
        bed: null,
        progress: 0.42,
        jobName: 'vazo.gcode',
        remainingSeconds: 3600,
        elapsedSeconds: 1800,
        message: null,
      },
    );
    expect(progress.ratio).toBe(0.42);
    expect(progress.remainingHours).toBeCloseTo(1, 2);
  });
});
