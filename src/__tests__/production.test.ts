import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES,
  buildSchedule,
  failuresByPrinter,
  failuresByProduct,
  failuresBySpool,
  groupByPrinter,
  smoothedRate,
  suggestRisk,
} from '../lib/production';
import type { Order, PrintJob } from '../types';

const job = (over: Partial<PrintJob>): PrintJob => ({
  id: 'j1',
  name: 'Ejderha',
  orderId: null,
  printerName: 'Ender 3',
  materials: [{ spoolId: 's1', grams: 40 }],
  grams: 40,
  estimatedHours: 4,
  status: 'done',
  startedAt: null,
  finishedAt: null,
  notes: '',
  ...over,
});

describe('smoothedRate', () => {
  it('tek başarısızlıkta %100 demez', () => {
    // Laplace: (1+1)/(1+2) = 0,667
    expect(smoothedRate(1, 1)).toBeCloseTo(0.667, 3);
  });

  it('çok kayıtta gerçek orana yakınsar', () => {
    expect(smoothedRate(10, 100)).toBeCloseTo(0.108, 3);
    expect(smoothedRate(0, 100)).toBeCloseTo(0.0098, 3);
  });

  it('kayıt yoksa sıfır döner', () => {
    expect(smoothedRate(0, 0)).toBe(0);
  });
});

describe('fire istatistiği', () => {
  const jobs = [
    job({ id: 'a', name: 'Ejderha', status: 'done' }),
    job({ id: 'b', name: 'Ejderha', status: 'failed' }),
    job({ id: 'c', name: 'Ejderha', status: 'done' }),
    job({ id: 'd', name: 'Kutu', status: 'done' }),
    job({ id: 'e', name: 'Kutu', status: 'queued' }),
  ];

  it('modele göre sayar', () => {
    const stats = failuresByProduct(jobs);
    const dragon = stats.find((s) => s.key === 'Ejderha');
    expect(dragon?.total).toBe(3);
    expect(dragon?.failed).toBe(1);
  });

  it('bitmemiş işleri saymaz', () => {
    expect(failuresByProduct(jobs).find((s) => s.key === 'Kutu')?.total).toBe(1);
  });

  it('makaraya göre sayar', () => {
    const stats = failuresBySpool(jobs);
    expect(stats[0].key).toBe('s1');
    expect(stats[0].total).toBe(4);
  });

  it('yazıcıya göre sayar', () => {
    expect(failuresByPrinter(jobs)[0].key).toBe('Ender 3');
  });

  it('en riskli önce sıralanır', () => {
    const stats = failuresByProduct(jobs);
    expect(stats[0].key).toBe('Ejderha');
  });
});

describe('suggestRisk', () => {
  const jobs = [
    job({ id: 'a', name: 'Ejderha', status: 'done' }),
    job({ id: 'b', name: 'Ejderha', status: 'failed' }),
    job({ id: 'c', name: 'Ejderha', status: 'done' }),
  ];

  it('modelin kendi geçmişini kullanır', () => {
    const suggestion = suggestRisk(jobs, 'Ejderha');
    expect(suggestion?.samples).toBe(3);
    expect(suggestion?.reason).toContain('Ejderha');
    // (1+1)/(3+2) = %40
    expect(suggestion?.percent).toBe(40);
  });

  it('model adı büyük/küçük harf duyarsızdır', () => {
    expect(suggestRisk(jobs, 'EJDERHA')?.samples).toBe(3);
  });

  it('modelde kayıt yoksa atölye ortalamasına düşer', () => {
    const suggestion = suggestRisk(jobs, 'Yeni Model');
    expect(suggestion?.reason).toContain('Atölye ortalaması');
    expect(suggestion?.samples).toBe(3);
  });

  it('yeterli kayıt yoksa öneri vermez', () => {
    expect(suggestRisk([job({ status: 'done' })], 'Ejderha')).toBeNull();
    expect(MIN_SAMPLES).toBeGreaterThan(1);
  });
});

describe('buildSchedule', () => {
  const NOW = Date.parse('2026-08-29T09:00:00.000Z');

  const order = (over: Partial<Order>): Order => ({
    id: 'o1',
    code: 'SIP-0001',
    customer: 'Ahmet',
    status: 'pending',
    dueDate: '2026-09-05',
    notes: '',
    createdAt: '2026-08-28T00:00:00.000Z',
    marginPct: 35,
    items: [
      {
        id: 'i1',
        productId: null,
        name: 'Ejderha',
        quantity: 1,
        printSeconds: 4 * 3600,
        tools: [],
        assignment: {},
      },
    ],
    ...over,
  });

  it('işi boş yazıcıya yerleştirir', () => {
    const result = buildSchedule([order({})], ['Ender 3'], NOW);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].printerName).toBe('Ender 3');
    expect(result.tasks[0].start).toBe(NOW);
    expect(result.tasks[0].hours).toBe(4);
  });

  it('adet süreyi çarpar', () => {
    const many = order({
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'Ejderha',
          quantity: 3,
          printSeconds: 3600,
          tools: [],
          assignment: {},
        },
      ],
    });
    expect(buildSchedule([many], ['A'], NOW).tasks[0].hours).toBe(3);
  });

  it('işleri en erken boşalan yazıcıya dağıtır', () => {
    const two = order({
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'A',
          quantity: 1,
          printSeconds: 7200,
          tools: [],
          assignment: {},
        },
        {
          id: 'i2',
          productId: null,
          name: 'B',
          quantity: 1,
          printSeconds: 3600,
          tools: [],
          assignment: {},
        },
      ],
    });
    const result = buildSchedule([two], ['P1', 'P2'], NOW);
    // Iki farkli yaziciya dagilmali, ikisi de simdi baslamali.
    expect(new Set(result.tasks.map((t) => t.printerName)).size).toBe(2);
    expect(result.tasks.every((t) => t.start === NOW)).toBe(true);
  });

  it('meşgul yazıcıyı bekletir', () => {
    const busy = { 'Ender 3': NOW + 5 * 3600 * 1000 };
    const result = buildSchedule([order({})], ['Ender 3'], NOW, busy);
    expect(result.tasks[0].start).toBe(busy['Ender 3']);
  });

  it('teslim tarihi yakın siparişi öne alır', () => {
    const urgent = order({ id: 'o2', code: 'SIP-0002', dueDate: '2026-08-30' });
    const relaxed = order({ id: 'o1', code: 'SIP-0001', dueDate: '2026-12-01' });
    const result = buildSchedule([relaxed, urgent], ['P1'], NOW);
    expect(result.tasks[0].orderCode).toBe('SIP-0002');
  });

  it('teslim tarihini aşanı işaretler', () => {
    const tight = order({
      dueDate: '2026-08-29',
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'Uzun',
          quantity: 1,
          printSeconds: 40 * 3600,
          tools: [],
          assignment: {},
        },
      ],
    });
    const result = buildSchedule([tight], ['P1'], NOW);
    expect(result.tasks[0].late).toBe(true);
    expect(result.lateOrders).toBe(1);
  });

  it('tamamlanmış siparişi planlamaz', () => {
    expect(buildSchedule([order({ status: 'delivered' })], ['P1'], NOW).tasks).toHaveLength(0);
  });

  it('süresi olmayan kalemi atlar', () => {
    const zero = order({
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'Elle',
          quantity: 1,
          printSeconds: 0,
          tools: [],
          assignment: {},
        },
      ],
    });
    expect(buildSchedule([zero], ['P1'], NOW).tasks).toHaveLength(0);
  });

  it('yazıcı tanımlı değilse yine plan üretir', () => {
    const result = buildSchedule([order({})], [], NOW);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].printerName).toBe('Belirtilmemiş');
  });

  it('yazıcı satırlarına böler', () => {
    const two = order({
      items: [
        {
          id: 'i1',
          productId: null,
          name: 'A',
          quantity: 1,
          printSeconds: 3600,
          tools: [],
          assignment: {},
        },
        {
          id: 'i2',
          productId: null,
          name: 'B',
          quantity: 1,
          printSeconds: 3600,
          tools: [],
          assignment: {},
        },
      ],
    });
    const rows = groupByPrinter(buildSchedule([two], ['P1', 'P2'], NOW));
    expect(rows.map((r) => r.printer)).toEqual(['P1', 'P2']);
  });
});
