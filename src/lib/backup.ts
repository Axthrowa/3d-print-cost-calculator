/**
 * Yedekleme.
 *
 * Verinin tamamı tek bir JSON anlık görüntüsüne alınır. Anlık görüntü hem
 * diske (uygulama sunucusu üzerinden), hem tarayıcı deposuna, hem de
 * kullanıcının indirebileceği bir dosyaya yazılabilir.
 *
 * Buradaki her şey saf ve zaman parametrelidir; test edilebilir.
 */

import type { AppData } from './storage';

export const BACKUP_FORMAT = 'baski-maliyet-yedek';
export const BACKUP_VERSION = 1;
/** Diskte/depoda tutulacak en fazla yedek sayısı. */
const KEEP_BACKUPS = 20;

export interface BackupSnapshot {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: string;
  data: AppData;
}

export interface BackupSummary {
  spools: number;
  catalog: number;
  orders: number;
  jobs: number;
  /** Toplam kayıt sayısı — "boş yedek" ayırt etmek için. */
  total: number;
}

/** Anlık görüntü üretir. */
export function createSnapshot(data: AppData, appVersion: string, at: string): BackupSnapshot {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: at,
    app: appVersion,
    data,
  };
}

/** Bir anlık görüntünün içeriğini özetler. */
export function summarize(snapshot: BackupSnapshot): BackupSummary {
  const d = snapshot.data;
  const spools = d.spools?.length ?? 0;
  const catalog = d.catalog?.length ?? 0;
  const orders = d.orders?.length ?? 0;
  const jobs = d.jobs?.length ?? 0;
  return { spools, catalog, orders, jobs, total: spools + catalog + orders + jobs };
}

export interface ParseResult {
  ok: boolean;
  snapshot: BackupSnapshot | null;
  error: string | null;
}

/**
 * Bir yedek dosyasını çözer ve biçimini doğrular.
 * Yanlış bir dosyayla verinin üzerine yazılmasını engellemek için
 * doğrulama bilerek katıdır.
 */
export function parseSnapshot(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, snapshot: null, error: 'Dosya geçerli bir JSON değil.' };
  }

  if (!raw || typeof raw !== 'object') {
    return { ok: false, snapshot: null, error: 'Dosya içeriği tanınmadı.' };
  }

  const candidate = raw as Partial<BackupSnapshot>;
  if (candidate.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      snapshot: null,
      error: 'Bu dosya bu uygulamanın yedeği değil.',
    };
  }
  if (typeof candidate.version !== 'number' || candidate.version > BACKUP_VERSION) {
    return {
      ok: false,
      snapshot: null,
      error: 'Yedek, uygulamanın bu sürümünden daha yeni. Önce uygulamayı güncelleyin.',
    };
  }
  if (!candidate.data || typeof candidate.data !== 'object') {
    return { ok: false, snapshot: null, error: 'Yedekte veri bölümü yok.' };
  }

  return { ok: true, snapshot: candidate as BackupSnapshot, error: null };
}

/** Yedek dosyası adı: yedek-2026-08-29-1530.json */
export function backupFileName(at: string): string {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `yedek-${stamp}.json`;
}

/**
 * Saklanacak yedekleri seçer: en yeniler kalır, fazlası silinir.
 * Adlar tarih içerdiği için alfabetik sıralama kronolojiktir.
 */
export function rotate(names: string[], keep = KEEP_BACKUPS): { keep: string[]; drop: string[] } {
  const sorted = [...names].sort((a, b) => b.localeCompare(a));
  return { keep: sorted.slice(0, keep), drop: sorted.slice(keep) };
}

/**
 * Yeni bir yedek almanın zamanı geldi mi?
 * Hem süre dolmuş olmalı hem de kaydedilecek bir veri bulunmalı.
 */
export function isBackupDue(
  lastAt: string | null,
  intervalMinutes: number,
  now: number,
  hasData: boolean,
): boolean {
  if (!hasData) return false;
  if (!lastAt) return true;
  const last = Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= Math.max(1, intervalMinutes) * 60_000;
}

/** İki anlık görüntünün içeriği aynı mı? (gereksiz yedeği önler) */
export function isSameContent(a: AppData, b: AppData | null): boolean {
  if (!b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
