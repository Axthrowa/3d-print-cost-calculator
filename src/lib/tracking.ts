/**
 * Sipariş ve baskı işi takibi için saf yardımcılar.
 * Tarih/saat her zaman dışarıdan `now` olarak verilir; böylece test edilebilir.
 */

import { priceOrder } from './catalog';
import { formatDuration } from './format';
import { consume, restore } from './inventory';
import type { LiveStatus } from './printerLink';
import type {
  Customer,
  CalculatorInputs,
  FilamentSpool,
  JobStatus,
  Order,
  OrderItem,
  OrderItemStatus,
  OrderStatus,
  PrintJob,
} from '../types';

// ---------------------------------------------------------------------------
// Siparişler
// ---------------------------------------------------------------------------

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'printing',
  'ready',
  'delivered',
  'cancelled',
];

const ORDER_STATUS_META: Record<OrderStatus, { label: string; chip: string }> = {
  pending: {
    label: 'Beklemede',
    chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  },
  printing: {
    label: 'Baskıda',
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  },
  ready: {
    label: 'Hazır',
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  },
  delivered: {
    label: 'Teslim edildi',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  },
  cancelled: {
    label: 'İptal',
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  },
};

/**
 * Teslime kalan gün sayısı (bugün 0, geçmişse negatif).
 * Saat farkı değil takvim günü farkı ölçülür: 29 Ağustos'ta 31 Ağustos "2 gün"dür.
 */
export function daysUntilDue(order: Order, now: number): number | null {
  if (!order.dueDate) return null;
  const due = Date.parse(`${order.dueDate}T00:00:00`);
  if (!Number.isFinite(due)) return null;
  const today = new Date(now);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((due - todayStart) / (24 * 60 * 60 * 1000));
}

/** Teslim tarihi geçmiş ve hâlâ kapanmamış mı? */
export function isOverdue(order: Order, now: number): boolean {
  if (order.status === 'delivered' || order.status === 'cancelled') return false;
  const days = daysUntilDue(order, now);
  return days !== null && days < 0;
}

/** Sıradaki sipariş numarasını üretir (SIP-001, SIP-002 …). */
export function nextOrderCode(orders: Order[]): string {
  let max = 0;
  for (const order of orders) {
    const match = /^SIP-(\d+)$/.exec(order.code ?? '');
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `SIP-${String(max + 1).padStart(3, '0')}`;
}

export interface OrderSummary {
  counts: Record<OrderStatus, number>;
  total: number;
  openCount: number;
  openRevenue: number;
  deliveredRevenue: number;
  profit: number;
  overdue: number;
}

/**
 * Sipariş listesinin özet göstergeleri.
 *
 * Tutarlar kayıtlı değil, GÜNCEL envanter fiyatlarıyla yeniden hesaplanır;
 * filament zamlandığında bekleyen siparişlerin kârı da anında güncellenir.
 */
export function summarizeOrders(
  orders: Order[],
  now: number,
  spools: FilamentSpool[],
  base: CalculatorInputs,
): OrderSummary {
  const counts = ORDER_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<OrderStatus, number>,
  );

  let openRevenue = 0;
  let deliveredRevenue = 0;
  let profit = 0;
  let overdue = 0;

  for (const order of orders) {
    counts[order.status] += 1;
    if (order.status === 'cancelled') continue;
    const pricing = priceOrder(order, spools, base);
    profit += pricing.profit;
    if (order.status === 'delivered') deliveredRevenue += pricing.salePrice;
    else openRevenue += pricing.salePrice;
    if (isOverdue(order, now)) overdue += 1;
  }

  const openCount = counts.pending + counts.printing + counts.ready;
  return {
    counts,
    total: orders.length,
    openCount,
    openRevenue,
    deliveredRevenue,
    profit,
    overdue,
  };
}

/** Siparişleri aciliyet sırasına dizer: açık ve teslimi yakın olan üstte. */
export function sortOrders(orders: Order[], now: number): Order[] {
  const rank: Record<OrderStatus, number> = {
    printing: 0,
    pending: 1,
    ready: 2,
    delivered: 3,
    cancelled: 4,
  };
  return [...orders].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const aDue = daysUntilDue(a, now);
    const bDue = daysUntilDue(b, now);
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    if (aDue !== null && bDue === null) return -1;
    if (aDue === null && bDue !== null) return 1;
    // Eski kayitta tarih bos olabilir; dogrudan cagri ekrani coldururdu.
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
}

// ---------------------------------------------------------------------------
// Baskı işleri
// ---------------------------------------------------------------------------

const JOB_STATUSES: JobStatus[] = ['queued', 'printing', 'done', 'failed'];

export const JOB_STATUS_META: Record<JobStatus, { label: string; chip: string; color: string }> = {
  queued: {
    label: 'Kuyrukta',
    chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    color: '#94a3b8',
  },
  printing: {
    label: 'Basılıyor',
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    color: '#38bdf8',
  },
  done: {
    label: 'Tamamlandı',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    color: '#34d399',
  },
  failed: {
    label: 'Başarısız',
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    color: '#fb7185',
  },
};

export interface JobProgress {
  /** 0..1 arası tamamlanma oranı. */
  ratio: number;
  elapsedHours: number;
  remainingHours: number;
  /** Tahmini bitiş zamanı (ms) — başlamamışsa null. */
  etaAt: number | null;
  /** Tahmini süreyi aştı mı? */
  overrun: boolean;
}

/** Bir baskı işinin anlık ilerlemesini hesaplar. */
export function jobProgress(job: PrintJob, now: number): JobProgress {
  const estimated = Math.max(0, job.estimatedHours);

  if (job.status === 'done' || job.status === 'failed') {
    return {
      ratio: job.status === 'done' ? 1 : 0,
      elapsedHours: actualHours(job) ?? estimated,
      remainingHours: 0,
      etaAt: null,
      overrun: false,
    };
  }

  const started = job.startedAt ? Date.parse(job.startedAt) : null;
  if (job.status !== 'printing' || started === null || !Number.isFinite(started)) {
    return {
      ratio: 0,
      elapsedHours: 0,
      remainingHours: estimated,
      etaAt: null,
      overrun: false,
    };
  }

  const elapsedHours = Math.max(0, (now - started) / (60 * 60 * 1000));
  const ratio = estimated > 0 ? Math.min(1, elapsedHours / estimated) : 0;
  return {
    ratio,
    elapsedHours,
    remainingHours: Math.max(0, estimated - elapsedHours),
    etaAt: started + estimated * 60 * 60 * 1000,
    overrun: estimated > 0 && elapsedHours > estimated,
  };
}

/**
 * Yazıcıdan canlı ilerleme geliyorsa onu kullanır; yoksa saat tahminine düşer.
 */
export function jobProgressLive(job: PrintJob, now: number, live?: LiveStatus | null): JobProgress {
  const fallback = jobProgress(job, now);
  if (job.status !== 'printing' || !live) return fallback;
  if (live.state !== 'printing' && live.state !== 'paused') return fallback;
  if (live.progress === null) return fallback;

  const elapsedHours =
    live.elapsedSeconds !== null && live.elapsedSeconds > 0
      ? live.elapsedSeconds / 3600
      : fallback.elapsedHours;
  const remainingHours =
    live.remainingSeconds !== null
      ? live.remainingSeconds / 3600
      : Math.max(0, job.estimatedHours - elapsedHours);
  const etaAt =
    live.remainingSeconds !== null ? now + live.remainingSeconds * 1000 : fallback.etaAt;

  return {
    ratio: live.progress,
    elapsedHours,
    remainingHours,
    etaAt,
    overrun: job.estimatedHours > 0 && elapsedHours > job.estimatedHours,
  };
}

/** Tamamlanmış bir işin gerçek süresi (saat). */
export function actualHours(job: PrintJob): number | null {
  if (!job.startedAt || !job.finishedAt) return null;
  const start = Date.parse(job.startedAt);
  const end = Date.parse(job.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / (60 * 60 * 1000);
}

export interface JobSummary {
  counts: Record<JobStatus, number>;
  activeCount: number;
  /** Kuyruktaki + basılan işlerin toplam tahmini süresi (saat). */
  pendingHours: number;
  /** Tamamlanan + başarısız işlerden hesaplanan gerçek fire oranı (%). */
  failureRatePct: number;
  /** Fire oranının anlamlı olması için yeterli veri var mı? */
  hasEnoughData: boolean;
  totalGrams: number;
  wastedGrams: number;
}

/** Baskı kuyruğunun özeti ve gerçekleşen fire oranı. */
export function summarizeJobs(jobs: PrintJob[], now: number): JobSummary {
  const counts = JOB_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {} as Record<JobStatus, number>,
  );

  let pendingHours = 0;
  let totalGrams = 0;
  let wastedGrams = 0;

  for (const job of jobs) {
    counts[job.status] += 1;
    if (job.status === 'queued') pendingHours += Math.max(0, job.estimatedHours);
    if (job.status === 'printing') pendingHours += jobProgress(job, now).remainingHours;
    if (job.status === 'done' || job.status === 'failed') totalGrams += Math.max(0, job.grams);
    if (job.status === 'failed') wastedGrams += Math.max(0, job.grams);
  }

  const finished = counts.done + counts.failed;
  return {
    counts,
    activeCount: counts.queued + counts.printing,
    pendingHours,
    failureRatePct: finished > 0 ? (counts.failed / finished) * 100 : 0,
    hasEnoughData: finished >= 5,
    totalGrams,
    wastedGrams,
  };
}

/** İşleri kuyruk mantığına göre sıralar: basılan, kuyruk, sonra bitenler. */
export function sortJobs(jobs: PrintJob[]): PrintJob[] {
  const rank: Record<JobStatus, number> = { printing: 0, queued: 1, failed: 2, done: 3 };
  return [...jobs].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const aTime = a.finishedAt ?? a.startedAt ?? '';
    const bTime = b.finishedAt ?? b.startedAt ?? '';
    return bTime.localeCompare(aTime);
  });
}

// ---------------------------------------------------------------------------
// Yazıcı çalışma süresi
// ---------------------------------------------------------------------------

/** Yazıcı adı -> toplam çalışma saati. */
export type RunHours = Record<string, number>;

/** Adı olmayan işler için ortak anahtar. */
export const UNKNOWN_PRINTER = 'Belirtilmemiş';

/** Yazıcı adını anahtara çevirir. */
export function runKey(printerName: string | null | undefined): string {
  const name = (printerName ?? '').trim();
  return name.length > 0 ? name : UNKNOWN_PRINTER;
}

/**
 * Gerçek süreyi anlamlı saymak için alt sınır (1 dakika).
 *
 * Kullanıcılar çoğu zaman baskı fiilen bittikten sonra "Başlat" ve hemen
 * ardından "Tamamlandı" der. Böyle bir durumda ölçülen süre saniyeler
 * mertebesindedir ve gerçeği yansıtmaz; tahmini süre daha doğrudur.
 */
const MIN_MEASURED_HOURS = 1 / 60;

/**
 * Bir işin yazıcıyı ne kadar meşgul ettiği.
 * Ölçülen süre anlamlıysa o, değilse dilimleyicinin tahmini kullanılır.
 */
export function jobRunHours(job: PrintJob): number {
  const actual = actualHours(job);
  if (actual !== null && actual >= MIN_MEASURED_HOURS) return actual;
  return Math.max(0, job.estimatedHours);
}

/** Süreyi yazıcının toplamına ekler (negatif değer düşer). */
export function addRunHours(map: RunHours, printerName: string, hours: number): RunHours {
  if (!Number.isFinite(hours) || hours === 0) return map;
  const key = runKey(printerName);
  const next = { ...map };
  next[key] = Math.max(0, Number(((next[key] ?? 0) + hours).toFixed(3)));
  if (next[key] === 0) delete next[key];
  return next;
}

/** Tüm yazıcıların toplamı. */
export function totalRunHours(map: RunHours): number {
  return Object.values(map).reduce((sum, hours) => sum + (Number.isFinite(hours) ? hours : 0), 0);
}

/** Bir yazıcının çalışma saati. */
export function runHoursOf(map: RunHours, printerName: string | null | undefined): number {
  const value = map[runKey(printerName)];
  return Number.isFinite(value) ? value : 0;
}

/** Yazıcıları çok çalışandan aza sıralar. */
export function sortRunHours(map: RunHours): Array<{ name: string; hours: number }> {
  return Object.entries(map)
    .filter(([, hours]) => Number.isFinite(hours) && hours > 0)
    .map(([name, hours]) => ({ name, hours }))
    .sort((a, b) => b.hours - a.hours);
}

/** Ömrünün ne kadarı tüketildi (0..1)? Ömür bilinmiyorsa null. */
export function lifetimeUsed(hours: number, lifetimeHours: number | undefined): number | null {
  if (!lifetimeHours || lifetimeHours <= 0) return null;
  return Math.min(1, Math.max(0, hours / lifetimeHours));
}

// ---------------------------------------------------------------------------
// Siparis kalemlerinin uretim durumu
// ---------------------------------------------------------------------------

const ITEM_STATUS_META: Record<OrderItemStatus, { label: string; chip: string }> = {
  waiting: {
    label: 'Bekliyor',
    chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
  },
  printing: {
    label: 'Üretimde',
    chip: 'bg-accent-500/15 text-accent-600 dark:text-accent-300',
  },
  done: {
    label: 'Tamamlandı',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  },
};

/** Eski kayitlarda durum alani yoktur; bekliyor sayilir. */
/**
 * Durum etiketini guvenle dondurur.
 *
 * Meta tablosuna dogrudan indeksleme, veri bozuksa `undefined` donuyor ve
 * `.chip` erisimi tum uygulamayi karartiyordu. Tek bir bozuk kayit yuzunden
 * ekranin komple gitmemesi icin erisim buradan yapilir.
 */
export function orderStatusMeta(status: unknown): { label: string; chip: string } {
  return ORDER_STATUS_META[status as OrderStatus] ?? ORDER_STATUS_META.pending;
}

export function itemStatusMeta(status: unknown): { label: string; chip: string } {
  return ITEM_STATUS_META[status as OrderItemStatus] ?? ITEM_STATUS_META.waiting;
}

export function itemStatus(item: OrderItem): OrderItemStatus {
  return item.status === 'printing' || item.status === 'done' ? item.status : 'waiting';
}

/**
 * Siparişlerde arama.
 *
 * Sipariş numarası, müşteri adı, not ve kalem adları taranır. Sipariş bir
 * cari kartına bağlıysa o kartın telefonu, firma unvanı, vergi numarası ve
 * e-postası da aramaya girer; müşteriyi telefondan bulmak sık gereken bir
 * iştir ve bu bilgiler siparişin kendisinde tutulmaz.
 *
 * Türkçe'de "I/ı" ve "İ/i" ayrımı İngilizceden farklı olduğu için
 * karşılaştırma Türkçe yerel ayarıyla yapılır; aksi halde "IŞIL" araması
 * "ışıl" ile eşleşmez. Telefonlarda boşluk ve parantez yok sayılır, böylece
 * "05321112233" yazınca "0532 111 22 33" da bulunur.
 */
export function searchOrders(orders: Order[], query: string, customers: Customer[] = []): Order[] {
  const raw = query.trim();
  if (!raw) return orders;

  const needle = raw.toLocaleLowerCase('tr');
  const digits = raw.replace(/\D/g, '');
  const byId = new Map(customers.map((customer) => [customer.id, customer]));

  return orders.filter((order) => {
    const customer = order.customerId ? byId.get(order.customerId) : undefined;
    const haystack = [
      order.code,
      order.customer,
      order.notes,
      ...order.items.map((item) => item.name),
      customer?.name ?? '',
      customer?.company ?? '',
      customer?.phone ?? '',
      customer?.email ?? '',
      customer?.taxNumber ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase('tr');

    if (haystack.includes(needle)) return true;

    // Telefon/vergi no: yazım biçimi tutmasa da rakamlar tutsun.
    if (digits.length >= 3) {
      const phoneDigits =
        `${customer?.phone ?? ''}${customer?.taxNumber ?? ''}${order.code}`.replace(/\D/g, '');
      if (phoneDigits.includes(digits)) return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Baskı durumu güncelleme (stok + çalışma süresi)
// ---------------------------------------------------------------------------

export interface JobStatusPatch {
  job: PrintJob;
  spools: FilamentSpool[];
  printerHours: RunHours;
  notes: string[];
}

/** Bir baskının durumunu değiştirir; stok ve çalışma süresini hesaplar. */
export function patchJobStatus(
  job: PrintJob,
  status: JobStatus,
  spools: FilamentSpool[],
  printerHours: RunHours,
  iso = new Date().toISOString(),
): JobStatusPatch {
  const finishing = status === 'done' || status === 'failed';
  const wasConsumed = job.consumed ?? false;

  let nextSpools = spools;
  let nextHours = printerHours;
  let consumed = wasConsumed;
  let consumedHours = job.consumedHours ?? 0;
  const notes: string[] = [];

  const finishedJob: PrintJob = {
    ...job,
    startedAt: job.startedAt ?? iso,
    finishedAt: iso,
  };

  if (finishing && !wasConsumed) {
    const result = consume(spools, job.materials);
    nextSpools = result.spools;
    consumed = true;
    if (result.appliedGrams > 0) {
      notes.push(`${result.appliedGrams.toFixed(0)} g stoktan düşüldü`);
    }
    notes.push(...result.warnings);

    consumedHours = jobRunHours(finishedJob);
    if (consumedHours > 0) {
      nextHours = addRunHours(printerHours, job.printerName, consumedHours);
      notes.push(`${formatDuration(consumedHours)} çalışma süresine eklendi`);
    }
  } else if (!finishing && wasConsumed) {
    const result = restore(spools, job.materials);
    nextSpools = result.spools;
    consumed = false;
    if (result.appliedGrams > 0) {
      notes.push(`${result.appliedGrams.toFixed(0)} g stoğa iade edildi`);
    }
    if (consumedHours > 0) {
      nextHours = addRunHours(printerHours, job.printerName, -consumedHours);
      notes.push(`${formatDuration(consumedHours)} çalışma süresinden düşüldü`);
    }
    consumedHours = 0;
  }

  const patched: PrintJob = {
    ...job,
    status,
    consumed,
    consumedHours,
    startedAt: status === 'queued' ? null : (job.startedAt ?? iso),
    finishedAt: finishing ? iso : null,
  };

  return { job: patched, spools: nextSpools, printerHours: nextHours, notes };
}
