/**
 * Bağlı yazıcıların canlı durumunu Baskılar kuyruğuyla eşleştirir.
 *
 * Yazıcı baskıya geçince otomatik kayıt oluşturulur; bittiğinde veya hata
 * aldığında iş kapatılır. Sipariş/katalog eşleşmesi varsa malzeme bilgisi
 * de doldurulur.
 */

import { defaultAssignment } from './catalog';
import type { LiveStatus, PrinterLink, PrinterState } from './printerLink';
import type {
  CatalogProduct,
  FilamentSpool,
  JobMaterial,
  Order,
  OrderItem,
  PrintJob,
} from '../types';

export interface PrinterSyncState {
  /** Yazıcı baskı yapıyor veya duraklatılmış mıydı? */
  active: boolean;
  jobName: string | null;
  raw: string;
}

export interface PrinterSyncInput {
  links: PrinterLink[];
  statuses: Record<string, LiveStatus>;
  jobs: PrintJob[];
  orders: Order[];
  catalog: CatalogProduct[];
  spools: FilamentSpool[];
  prev: Record<string, PrinterSyncState>;
  now: number;
  createId: () => string;
}

export interface PendingFinish {
  jobId: string;
  status: 'done' | 'failed';
}

export interface PrinterSyncResult {
  jobs: PrintJob[];
  prev: Record<string, PrinterSyncState>;
  changed: boolean;
  pendingFinishes: PendingFinish[];
  createdCount: number;
}

/** Dosya adını eşleştirme anahtarına çevirir. */
export function normalizeJobKey(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\.gcode$/i, '')
    .toLocaleLowerCase('tr');
}

/** İki baskı adı aynı işi mi gösteriyor? */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeJobKey(a);
  const right = normalizeJobKey(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function printerDisplayName(link: PrinterLink): string {
  const profile = link.profileName.trim();
  if (profile) return profile;
  return link.name.trim() || 'Yazıcı';
}

function isActivePrint(state: PrinterState): boolean {
  return state === 'printing' || state === 'paused';
}

/** Yazıcıdan gelen süre bilgisinden tahmini toplam saat. */
export function estimateHoursFromStatus(status: LiveStatus): number {
  const elapsed = status.elapsedSeconds ?? 0;
  const remaining = status.remainingSeconds ?? 0;
  if (elapsed + remaining > 0) return (elapsed + remaining) / 3600;
  if (status.progress !== null && status.progress > 0.02 && elapsed > 0) {
    return elapsed / status.progress / 3600;
  }
  return 0.5;
}

export function materialsFromOrderItem(item: OrderItem): JobMaterial[] {
  return item.tools
    .map((tool) => ({
      spoolId: item.assignment[tool.toolIndex] ?? null,
      grams: (tool.modelGrams + tool.wasteGrams) * Math.max(1, item.quantity),
      toolIndex: tool.toolIndex,
      colorHex: tool.colorHex,
    }))
    .filter((material) => material.grams > 0);
}

export function materialsFromCatalog(
  product: CatalogProduct,
  spools: FilamentSpool[],
): JobMaterial[] {
  const assignment = defaultAssignment(product.tools, spools);
  return product.tools
    .map((tool) => ({
      spoolId: assignment[tool.toolIndex] ?? null,
      grams: tool.modelGrams + tool.wasteGrams,
      toolIndex: tool.toolIndex,
      colorHex: tool.colorHex,
    }))
    .filter((material) => material.grams > 0);
}

export interface ResolvedJobMeta {
  name: string;
  materials: JobMaterial[];
  orderId: string | null;
  estimatedHours: number;
}

/** Sipariş ve katalogdan malzeme/süre eşleştirmesi dener. */
export function resolveJobMeta(
  link: PrinterLink,
  status: LiveStatus,
  orders: Order[],
  catalog: CatalogProduct[],
  spools: FilamentSpool[],
): ResolvedJobMeta {
  const remoteName = status.jobName?.replace(/\.gcode$/i, '') ?? 'Yazıcı baskısı';

  for (const order of orders) {
    for (const item of order.items) {
      const printing = (item.status ?? 'waiting') === 'printing';
      const samePrinter =
        !item.printerName ||
        item.printerName === link.name ||
        item.printerName === link.profileName;
      if (!printing || !samePrinter) continue;
      if (!namesMatch(item.name, status.jobName) && !namesMatch(item.name, remoteName)) continue;
      const materials = materialsFromOrderItem(item);
      return {
        name: item.name,
        materials,
        orderId: order.id,
        estimatedHours: Math.max(
          estimateHoursFromStatus(status),
          item.printSeconds > 0 ? item.printSeconds / 3600 : 0,
        ),
      };
    }
  }

  for (const product of catalog) {
    if (!namesMatch(product.name, status.jobName) && !namesMatch(product.name, remoteName))
      continue;
    const materials = materialsFromCatalog(product, spools);
    return {
      name: product.name,
      materials,
      orderId: null,
      estimatedHours: Math.max(
        estimateHoursFromStatus(status),
        product.printSeconds > 0 ? product.printSeconds / 3600 : 0,
      ),
    };
  }

  return {
    name: remoteName,
    materials: [],
    orderId: null,
    estimatedHours: estimateHoursFromStatus(status),
  };
}

function inferFinishStatus(prev: PrinterSyncState, status: LiveStatus): 'done' | 'failed' | null {
  if (status.state === 'error') return 'failed';
  const raw = status.raw.toLowerCase();
  if (/cancel/.test(raw)) return 'failed';
  if (/error|fail|abort/.test(raw)) return 'failed';
  if (/complete|standby/.test(raw) && prev.active) return 'done';
  if (status.progress !== null && status.progress >= 0.98 && prev.active) return 'done';
  if (prev.active && !isActivePrint(status.state) && status.state === 'idle') return 'done';
  return null;
}

function findOpenJob(
  jobs: PrintJob[],
  linkId: string,
  jobName: string | null,
): PrintJob | undefined {
  const key = normalizeJobKey(jobName);
  return jobs.find((job) => {
    if (job.printerLinkId !== linkId) return false;
    if (job.status !== 'printing' && job.status !== 'queued') return false;
    if (!key) return true;
    return (
      namesMatch(job.remoteJobName, jobName) ||
      namesMatch(job.name, jobName) ||
      namesMatch(job.remoteJobName, job.name)
    );
  });
}

function startedAtFromStatus(status: LiveStatus, now: number): string {
  const elapsed = status.elapsedSeconds ?? 0;
  if (elapsed > 0) return new Date(now - elapsed * 1000).toISOString();
  return new Date(now).toISOString();
}

function createJob(
  link: PrinterLink,
  status: LiveStatus,
  meta: ResolvedJobMeta,
  createId: () => string,
  now: number,
): PrintJob {
  const grams = meta.materials.reduce((sum, material) => sum + material.grams, 0);
  return {
    id: createId(),
    name: meta.name,
    printerName: printerDisplayName(link),
    printerLinkId: link.id,
    remoteJobName: status.jobName,
    materials: meta.materials,
    grams,
    estimatedHours: meta.estimatedHours,
    status: 'printing',
    startedAt: startedAtFromStatus(status, now),
    finishedAt: null,
    orderId: meta.orderId,
    notes: 'Yazıcıdan otomatik eklendi',
  };
}

function promoteQueuedJob(job: PrintJob, status: LiveStatus, now: number): PrintJob {
  return {
    ...job,
    status: 'printing',
    remoteJobName: status.jobName ?? job.remoteJobName,
    startedAt: job.startedAt ?? startedAtFromStatus(status, now),
    estimatedHours: Math.max(job.estimatedHours, estimateHoursFromStatus(status)),
  };
}

function updateActiveJob(job: PrintJob, status: LiveStatus): PrintJob {
  const estimated = Math.max(job.estimatedHours, estimateHoursFromStatus(status));
  if (job.remoteJobName === status.jobName && Math.abs(job.estimatedHours - estimated) < 0.01) {
    return job;
  }
  return {
    ...job,
    remoteJobName: status.jobName ?? job.remoteJobName,
    estimatedHours: estimated,
  };
}

/** Canlı yazıcı durumunu baskı kuyruğuyla senkronize eder. */
export function applyPrinterSync(input: PrinterSyncInput): PrinterSyncResult {
  const {
    links,
    statuses,
    jobs: initialJobs,
    orders,
    catalog,
    spools,
    prev,
    now,
    createId,
  } = input;

  let jobs = initialJobs;
  let changed = false;
  let createdCount = 0;
  const pendingFinishes: PendingFinish[] = [];
  const nextPrev: Record<string, PrinterSyncState> = { ...prev };

  for (const link of links) {
    if (!link.enabled) continue;
    const status = statuses[link.id];
    if (!status) continue;

    const was = prev[link.id] ?? { active: false, jobName: null, raw: '' };
    const activeNow = isActivePrint(status.state);

    if (activeNow) {
      const meta = resolveJobMeta(link, status, orders, catalog, spools);
      const existing = findOpenJob(jobs, link.id, status.jobName);

      if (existing) {
        const next =
          existing.status === 'queued'
            ? promoteQueuedJob(existing, status, now)
            : updateActiveJob(existing, status);
        if (next !== existing) {
          jobs = jobs.map((job) => (job.id === existing.id ? next : job));
          changed = true;
        }
      } else if (!was.active || !namesMatch(was.jobName, status.jobName)) {
        const created = createJob(link, status, meta, createId, now);
        jobs = [...jobs, created];
        createdCount += 1;
        changed = true;
      }
    } else if (was.active) {
      const finishStatus = inferFinishStatus(was, status);
      const open = findOpenJob(jobs, link.id, was.jobName ?? status.jobName);
      if (open && finishStatus) {
        pendingFinishes.push({ jobId: open.id, status: finishStatus });
      }
    }

    nextPrev[link.id] = {
      active: activeNow,
      jobName: status.jobName ?? was.jobName,
      raw: status.raw,
    };
  }

  return { jobs, prev: nextPrev, changed, pendingFinishes, createdCount };
}

/** Siparişten gönderilen baskı için kayıt oluşturur (çift kaydı önler). */
export function jobFromOrderItem(
  order: Order,
  item: OrderItem,
  link: PrinterLink,
  createId: () => string,
  startedAt: string,
): PrintJob | null {
  const materials = materialsFromOrderItem(item);
  const grams = materials.reduce((sum, material) => sum + material.grams, 0);
  return {
    id: createId(),
    name: item.name,
    printerName: printerDisplayName(link),
    printerLinkId: link.id,
    remoteJobName: `${item.name}.gcode`,
    materials,
    grams,
    estimatedHours: item.printSeconds > 0 ? item.printSeconds / 3600 : 0.5,
    status: 'printing',
    startedAt,
    finishedAt: null,
    orderId: order.id,
    notes: 'Siparişten gönderildi',
  };
}

export function shouldAddSentJob(jobs: PrintJob[], link: PrinterLink, item: OrderItem): boolean {
  return !jobs.some(
    (job) =>
      job.printerLinkId === link.id &&
      job.status === 'printing' &&
      (namesMatch(job.name, item.name) || namesMatch(job.remoteJobName, `${item.name}.gcode`)),
  );
}
