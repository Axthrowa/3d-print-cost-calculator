/**
 * Üretim planlama: fire istatistiği ve baskı takvimi (Gantt).
 *
 * Fire oranı GEÇMİŞ baskılardan ölçülür; tahmin değil, gerçekleşen veridir.
 * Az sayıda kayıtla oran güvenilmez olacağı için Laplace düzeltmesi
 * uygulanır: 1 baskı 1 kez başarısız olduysa "%100 fire" demek yanlış olur.
 */

import { UNKNOWN_PRINTER } from './tracking';
import type { Order, PrintJob } from '../types';

// ---------------------------------------------------------------------------
// Fire istatistiği
// ---------------------------------------------------------------------------

export interface FailureStat {
  key: string;
  total: number;
  failed: number;
  /** Düzeltilmiş başarısızlık oranı (0..1). */
  rate: number;
}

/** En az bu kadar kayıt olmadan öneri gösterilmez. */
export const MIN_SAMPLES = 3;

/**
 * Laplace (add-one) düzeltmesi: (fail + 1) / (total + 2).
 * Tek denemede tek başarısızlık %100 değil, %66 verir; 50 denemede
 * gerçek orana yakınsar.
 */
export function smoothedRate(failed: number, total: number): number {
  if (total <= 0) return 0;
  return (failed + 1) / (total + 2);
}

function tally(jobs: PrintJob[], keyOf: (job: PrintJob) => string | null): FailureStat[] {
  const totals = new Map<string, { total: number; failed: number }>();
  for (const job of jobs) {
    if (job.status !== 'done' && job.status !== 'failed') continue;
    const key = keyOf(job);
    if (!key) continue;
    const entry = totals.get(key) ?? { total: 0, failed: 0 };
    entry.total += 1;
    if (job.status === 'failed') entry.failed += 1;
    totals.set(key, entry);
  }

  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      total: value.total,
      failed: value.failed,
      rate: smoothedRate(value.failed, value.total),
    }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
}

/** Model adına göre fire oranları. */
export function failuresByProduct(jobs: PrintJob[]): FailureStat[] {
  return tally(jobs, (job) => job.name.trim() || null);
}

/** Makaraya göre fire oranları; bir filament sürekli patlıyorsa görünür. */
export function failuresBySpool(jobs: PrintJob[]): FailureStat[] {
  return tally(jobs, (job) => job.materials[0]?.spoolId ?? null);
}

/** Yazıcıya göre fire oranları. */
export function failuresByPrinter(jobs: PrintJob[]): FailureStat[] {
  return tally(jobs, (job) => job.printerName.trim() || UNKNOWN_PRINTER);
}

export interface RiskSuggestion {
  /** Önerilen fire payı yüzdesi (0-100). */
  percent: number;
  /** Kaç kayda dayanıyor? */
  samples: number;
  reason: string;
}

/**
 * Bir model için fire payı önerir. Önce modelin kendi geçmişine, yoksa
 * atölyenin genel ortalamasına bakar.
 */
export function suggestRisk(jobs: PrintJob[], productName: string): RiskSuggestion | null {
  const byProduct = failuresByProduct(jobs).find(
    (stat) => stat.key.toLocaleLowerCase('tr') === productName.trim().toLocaleLowerCase('tr'),
  );

  if (byProduct && byProduct.total >= MIN_SAMPLES) {
    return {
      percent: Math.round(byProduct.rate * 1000) / 10,
      samples: byProduct.total,
      reason: `"${byProduct.key}" için ${byProduct.total} baskıda ${byProduct.failed} başarısızlık`,
    };
  }

  const finished = jobs.filter((job) => job.status === 'done' || job.status === 'failed');
  if (finished.length < MIN_SAMPLES) return null;
  const failed = finished.filter((job) => job.status === 'failed').length;
  return {
    percent: Math.round(smoothedRate(failed, finished.length) * 1000) / 10,
    samples: finished.length,
    reason: `Atölye ortalaması: ${finished.length} baskıda ${failed} başarısızlık`,
  };
}

// ---------------------------------------------------------------------------
// Üretim takvimi (Gantt)
// ---------------------------------------------------------------------------

export interface ScheduleTask {
  orderId: string;
  orderCode: string;
  itemId: string;
  label: string;
  printerName: string;
  /** Milisaniye cinsinden başlangıç ve bitiş. */
  start: number;
  end: number;
  hours: number;
  /** Teslim tarihini aşıyor mu? */
  late: boolean;
}

export interface ScheduleResult {
  tasks: ScheduleTask[];
  /** Yazıcı adı -> o yazıcının son biteceği an. */
  finishByPrinter: Record<string, number>;
  /** Tüm işlerin biteceği an. */
  finishesAt: number;
  /** Teslim tarihi kaçacak sipariş sayısı. */
  lateOrders: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Bekleyen sipariş kalemlerini yazıcılara dağıtır.
 *
 * Basit ama gerçekçi bir kural: her kalem, o an EN ERKEN boşalacak yazıcıya
 * verilir (list scheduling). Siparişler teslim tarihine göre sıralanır, yani
 * en acil olan önce yerleşir. Zaten baskıda olan işler yazıcıyı meşgul kabul
 * eder.
 */
export function buildSchedule(
  orders: Order[],
  printerNames: string[],
  now: number,
  busyUntil: Record<string, number> = {},
): ScheduleResult {
  const printers = printerNames.length > 0 ? printerNames : [UNKNOWN_PRINTER];
  const free: Record<string, number> = {};
  for (const name of printers) free[name] = Math.max(now, busyUntil[name] ?? now);

  const queue = orders
    .filter((order) => order.status === 'pending' || order.status === 'printing')
    .slice()
    .sort((a, b) => {
      // Teslim tarihi olmayanlar sona.
      if (!a.dueDate) return b.dueDate ? 1 : 0;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

  const tasks: ScheduleTask[] = [];
  const lateOrderIds = new Set<string>();

  for (const order of queue) {
    const due = order.dueDate ? Date.parse(`${order.dueDate}T23:59:59`) : Number.POSITIVE_INFINITY;

    for (const item of order.items) {
      const hours = (item.printSeconds / 3600) * Math.max(1, item.quantity);
      if (hours <= 0) continue;

      // En erken boşalan yazıcıyı seç.
      const target = printers.reduce((best, name) => (free[name] < free[best] ? name : best));
      const start = free[target];
      const end = start + hours * HOUR_MS;
      free[target] = end;

      const late = end > due;
      if (late) lateOrderIds.add(order.id);

      tasks.push({
        orderId: order.id,
        orderCode: order.code,
        itemId: item.id,
        label: `${order.code} · ${item.name}`,
        printerName: target,
        start,
        end,
        hours,
        late,
      });
    }
  }

  return {
    tasks,
    finishByPrinter: free,
    finishesAt: tasks.reduce((latest, task) => Math.max(latest, task.end), now),
    lateOrders: lateOrderIds.size,
  };
}

/** Takvimi yazıcı satırlarına böler (Gantt çizimi için). */
export function groupByPrinter(
  result: ScheduleResult,
): Array<{ printer: string; tasks: ScheduleTask[] }> {
  const rows = new Map<string, ScheduleTask[]>();
  for (const task of result.tasks) {
    const list = rows.get(task.printerName) ?? [];
    list.push(task);
    rows.set(task.printerName, list);
  }
  return [...rows.entries()]
    .map(([printer, tasks]) => ({ printer, tasks }))
    .sort((a, b) => a.printer.localeCompare(b.printer, 'tr'));
}
