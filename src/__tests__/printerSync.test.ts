import { describe, expect, it } from 'vitest';
import {
  applyPrinterSync,
  estimateHoursFromStatus,
  namesMatch,
  normalizeJobKey,
  resolveJobMeta,
  shouldAddSentJob,
} from '../lib/printerSync';
import { offlineStatus } from '../lib/printerLink';
import type { LiveStatus, PrinterLink } from '../lib/printerLink';
import type { FilamentSpool, Order, PrintJob } from '../types';

const NOW = Date.parse('2026-08-30T10:00:00.000Z');

const link = (over: Partial<PrinterLink> = {}): PrinterLink => ({
  id: 'p1',
  name: 'K1 Max',
  kind: 'moonraker',
  host: '192.168.1.10',
  port: 7125,
  apiKey: '',
  serialPath: '',
  baudRate: 115200,
  profileName: '',
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const printingStatus = (over: Partial<LiveStatus> = {}): LiveStatus => ({
  state: 'printing',
  raw: 'printing',
  nozzle: { current: 210, target: 210 },
  bed: { current: 60, target: 60 },
  progress: 0.35,
  jobName: 'vazo.gcode',
  remainingSeconds: 1800,
  elapsedSeconds: 900,
  message: null,
  ...over,
});

const spools: FilamentSpool[] = [
  {
    id: 'pla',
    brand: 'Bambu',
    material: 'PLA',
    color: 'Turuncu',
    rollPrice: 900,
    rollWeight: 1000,
    updatedAt: '2026-08-01T00:00:00.000Z',
  },
];

describe('normalizeJobKey', () => {
  it('gcode uzantısını ve boşlukları temizler', () => {
    expect(normalizeJobKey('  Vazo.gcode ')).toBe('vazo');
  });
});

describe('namesMatch', () => {
  it('dosya adı ile ürün adını eşleştirir', () => {
    expect(namesMatch('vazo.gcode', 'Vazo')).toBe(true);
  });
});

describe('estimateHoursFromStatus', () => {
  it('geçen + kalan süreden saat hesaplar', () => {
    const hours = estimateHoursFromStatus(printingStatus());
    expect(hours).toBeCloseTo(0.75, 2);
  });
});

describe('applyPrinterSync', () => {
  it('baskı başlayınca yeni iş oluşturur', () => {
    const result = applyPrinterSync({
      links: [link()],
      statuses: { p1: printingStatus() },
      jobs: [],
      orders: [],
      catalog: [],
      spools,
      prev: {},
      now: NOW,
      createId: () => 'job-1',
    });

    expect(result.changed).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].status).toBe('printing');
    expect(result.jobs[0].name).toBe('vazo');
    expect(result.jobs[0].printerLinkId).toBe('p1');
  });

  it('baskı bitince tamamlandı işaretler', () => {
    const jobs: PrintJob[] = [
      {
        id: 'job-1',
        name: 'vazo',
        printerName: 'K1 Max',
        printerLinkId: 'p1',
        remoteJobName: 'vazo.gcode',
        materials: [],
        grams: 0,
        estimatedHours: 1,
        status: 'printing',
        startedAt: '2026-08-30T09:00:00.000Z',
        finishedAt: null,
        orderId: null,
        notes: '',
      },
    ];

    const result = applyPrinterSync({
      links: [link()],
      statuses: { p1: printingStatus({ state: 'idle', raw: 'complete', progress: 1 }) },
      jobs,
      orders: [],
      catalog: [],
      spools,
      prev: { p1: { active: true, jobName: 'vazo.gcode', raw: 'printing' } },
      now: NOW,
      createId: () => 'job-x',
    });

    expect(result.pendingFinishes).toEqual([{ jobId: 'job-1', status: 'done' }]);
  });

  it('aynı baskı için çift kayıt oluşturmaz', () => {
    const jobs: PrintJob[] = [
      {
        id: 'job-1',
        name: 'vazo',
        printerName: 'K1 Max',
        printerLinkId: 'p1',
        remoteJobName: 'vazo.gcode',
        materials: [],
        grams: 0,
        estimatedHours: 1,
        status: 'printing',
        startedAt: '2026-08-30T09:00:00.000Z',
        finishedAt: null,
        orderId: null,
        notes: '',
      },
    ];

    const result = applyPrinterSync({
      links: [link()],
      statuses: { p1: printingStatus({ progress: 0.5 }) },
      jobs,
      orders: [],
      catalog: [],
      spools,
      prev: { p1: { active: true, jobName: 'vazo.gcode', raw: 'printing' } },
      now: NOW,
      createId: () => 'job-2',
    });

    expect(result.createdCount).toBe(0);
    expect(result.jobs).toHaveLength(1);
  });

  it('siparişten malzeme bilgisini doldurur', () => {
    const orders: Order[] = [
      {
        id: 'ord-1',
        code: 'SIP-001',
        customer: 'Ali',
        status: 'printing',
        dueDate: '',
        notes: '',
        createdAt: '2026-08-01T00:00:00.000Z',
        marginPct: 50,
        items: [
          {
            id: 'item-1',
            productId: null,
            name: 'Vazo',
            quantity: 1,
            printSeconds: 3600,
            tools: [
              {
                toolIndex: 0,
                colorHex: '#ff0000',
                filamentType: 'PLA',
                modelGrams: 40,
                wasteGrams: 5,
              },
            ],
            assignment: { 0: 'pla' },
            status: 'printing',
            printerName: 'K1 Max',
          },
        ],
      },
    ];

    const meta = resolveJobMeta(link(), printingStatus(), orders, [], spools);
    expect(meta.orderId).toBe('ord-1');
    expect(meta.materials[0].grams).toBe(45);
  });
});

describe('shouldAddSentJob', () => {
  it('zaten basılan iş varsa false döner', () => {
    const jobs: PrintJob[] = [
      {
        id: 'job-1',
        name: 'Vazo',
        printerName: 'K1 Max',
        printerLinkId: 'p1',
        remoteJobName: 'Vazo.gcode',
        materials: [],
        grams: 0,
        estimatedHours: 1,
        status: 'printing',
        startedAt: null,
        finishedAt: null,
        orderId: null,
        notes: '',
      },
    ];
    expect(
      shouldAddSentJob(jobs, link(), {
        id: 'i1',
        productId: null,
        name: 'Vazo',
        quantity: 1,
        printSeconds: 0,
        tools: [],
        assignment: {},
      }),
    ).toBe(false);
  });
});

describe('offline yazici', () => {
  it('çevrimdışı yazıcıda iş oluşturmaz', () => {
    const result = applyPrinterSync({
      links: [link()],
      statuses: { p1: offlineStatus('Bağlantı yok') },
      jobs: [],
      orders: [],
      catalog: [],
      spools,
      prev: {},
      now: NOW,
      createId: () => 'job-1',
    });
    expect(result.jobs).toHaveLength(0);
  });
});
