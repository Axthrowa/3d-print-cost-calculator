/**
 * Kalıcı depolama.
 *
 * Üç arka uç vardır, şu sırayla denenir:
 *   1. Tauri kabuğu  → `tauri-plugin-store` (disk).
 *   2. Yerel sunucu  → `/api/data` (%APPDATA%\3D Baski Maliyet\veri.json).
 *   3. localStorage  → köprü yoksa son çare.
 *
 * İkincisi önemlidir: localStorage adrese ve tarayıcı profiline bağlıdır, bu
 * yüzden tarayıcı kipiyle kendi penceresi kipi AYRI veri görürdü ve port
 * değişince kayıtlar kaybolurdu. Disk dosyası bu tuzakların ikisini de
 * kapatır; güncelleme yapıldığında yalnızca dist/ ve exe değişir, veri durur.
 *
 * Her durumda arayüz aynı API'yi görür: açılışta tek okuma, sonra
 * geciktirilmiş yazmalar.
 */

import { migrateOrders } from './catalog';
import { migrateJobs } from './inventory';
import type { RunHours } from './tracking';
import { DEFAULT_WATCH_SETTINGS } from './priceWatcher';
import { isTauri } from './runtime';
import type {
  Branding,
  Customer,
  DockApp,
  Invoice,
  SellerInfo,
  BackupSettings,
  CalculatorInputs,
  CatalogProduct,
  FilamentSpool,
  Order,
  PrintJob,
  PrinterProfile,
  WatchSettings,
} from '../types';
import { EMPTY_SELLER } from './invoice';
import { DEFAULT_MAINTENANCE, type MaintenanceSettings } from './workshop';
import type { User } from './auth';
import { isEnvelope, seal, unseal } from './vault';
import type { PrinterLink } from './printerLink';
import type { CatalogPrinter } from './printerCatalog';

const STORE_FILE = 'baski-maliyet.json';
const LEGACY_PREFIX = 'p3dcc.';
const WRITE_DELAY_MS = 250;

export const DEFAULT_INPUTS: CalculatorInputs = {
  usages: [{ id: 'u1', spoolId: null, grams: 50 }],
  printHours: 4,
  printMinutes: 30,
  quantity: 1,
  printerWatts: 200,
  kwhPrice: 3.5,
  depreciationPerHour: 2,
  failureRatePct: 5,
  laborRatePerHour: 150,
  laborMinutes: 10,
  extraCost: 0,
  marginPct: 40,
  vatEnabled: false,
  vatPct: 20,
};

/** Bos kurumsal kimlik; kullanici doldurana kadar varsayilanlar gorunur. */
export const EMPTY_BRANDING: Branding = {
  businessName: '',
  logo: '',
  signature: '',
  signatureLabel: '',
};

const DEFAULT_BACKUP: BackupSettings = {
  enabled: true,
  intervalMinutes: 30,
  lastAt: null,
};

export interface AppData {
  spools: FilamentSpool[];
  inputs: CalculatorInputs;
  printer: PrinterProfile | null;
  orders: Order[];
  jobs: PrintJob[];
  watch: WatchSettings;
  catalog: CatalogProduct[];
  /** Tanimli yazici baglantilari. */
  printers: PrinterLink[];
  /** Cari (musteri) kartlari. */
  customers: Customer[];
  invoices: Invoice[];
  /** Faturayi kesen tarafin bilgileri. */
  seller: SellerInfo;
  /** Yazici adi -> toplam calisma saati. */
  printerHours: RunHours;
  /** Bakim araligi ve son bakim sayaclari. */
  maintenance: MaintenanceSettings;
  /** Kurumsal kimlik: isletme adi, logo, imza. */
  branding: Branding;
  /** Hizli baslatici kisayollari. */
  dock: DockApp[];
  /** Kullanicinin elle ekledigi yazici profilleri. */
  customPrinters: CatalogPrinter[];
  /** Giris yapabilen kullanicilar. Bos ise giris kapalidir. */
  users: User[];
  backup: BackupSettings;
  theme: 'dark' | 'light';
}

export const DEFAULT_DATA: AppData = {
  spools: [],
  inputs: DEFAULT_INPUTS,
  printer: null,
  orders: [],
  jobs: [],
  watch: DEFAULT_WATCH_SETTINGS,
  catalog: [],
  printers: [],
  customers: [],
  invoices: [],
  seller: EMPTY_SELLER,
  printerHours: {},
  maintenance: DEFAULT_MAINTENANCE,
  branding: EMPTY_BRANDING,
  dock: [],
  customPrinters: [],
  users: [],
  backup: DEFAULT_BACKUP,
  theme: 'dark',
};

/** Eski localStorage anahtarları (v1.3 ve öncesi). */
const LEGACY_KEYS: Record<keyof AppData, string> = {
  spools: 'spools.v1',
  inputs: 'inputs.v1',
  printer: 'printer.v1',
  orders: 'orders.v1',
  jobs: 'jobs.v1',
  watch: 'watch.v1',
  catalog: 'catalog.v1',
  printers: 'printers.v1',
  customers: 'customers.v1',
  invoices: 'invoices.v1',
  seller: 'seller.v1',
  printerHours: 'printerHours.v1',
  maintenance: 'maintenance.v1',
  branding: 'branding.v1',
  dock: 'dock.v1',
  customPrinters: 'customPrinters.v1',
  users: 'users.v1',
  backup: 'backup.v1',
  theme: 'theme.v1',
};

type StoreHandle = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreHandle> | null = null;

/**
 * Hangi arka ucun kullanildigi ilk okumada belirlenir ve oturum boyunca
 * degismez; boylece yazmalar okumadan farkli bir yere gitmez.
 */
type Backend = 'tauri' | 'server' | 'local';
let backend: Backend = 'local';

/** Sunucudaki veri dosyasinin son hali; yazarken tamami gonderilir. */
let mirror: AppData | null = null;

interface DataReply {
  ok?: boolean;
  data?: Partial<Record<keyof AppData, unknown>> | null;
  error?: string;
}

/**
 * Sunucuya hic ulasilamadi mi, yoksa boyle bir sunucu yok mu?
 *
 * 404 = kopru yok (ornegin `vite dev`); tarayici deposu dogru yer.
 * Zaman asimi / ag hatasi / 5xx = sunucu var ama cevap veremedi; bu
 * durumda tarayici deposuna dusmek KAYITLI VERIYI YOK GOSTERIR.
 */
let serverMissing = false;

const READ_RETRY_MS = [250, 750];

/**
 * Veri dosyasini sunucudan okur.
 *
 * Tek denemede pes etmek acilista bos bir uygulama demekti: exe/bat
 * kalkarken ilk istek bazen dusuyor ve envanter, siparisler kayitsiz
 * gorunuyordu. Bu yuzden birkac kez denenir.
 */
async function readServerData(): Promise<DataReply | null> {
  serverMissing = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('/api/data', { signal: AbortSignal.timeout(10000) });
      if (response.ok) return (await response.json()) as DataReply;
      // Uc nokta yoksa yeniden denemenin anlami yok.
      if (response.status === 404) {
        serverMissing = true;
        return null;
      }
    } catch {
      // Ag hatasi veya zaman asimi: sunucu heniiz hazir olmayabilir.
    }
    if (attempt >= READ_RETRY_MS.length) return null;
    await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS[attempt]));
  }
}

async function writeServerData(data: AppData): Promise<boolean> {
  try {
    // Kullanicilar disarida kalir; kalan her sey istege bagli sifrelenir.
    const { users, ...rest } = data;
    const payload =
      vaultKey && encryptedOnDisk
        ? { users, vault: await seal(rest, vaultKey) }
        : { users, data: rest };

    const response = await fetch('/api/data', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Kayit nerede tutuluyor? Arayuzde bilgi notu icin. */
export function storageBackend(): Backend {
  return backend;
}

async function getStore(): Promise<StoreHandle> {
  if (!storePromise) {
    storePromise = import('@tauri-apps/plugin-store').then((mod) =>
      mod.load(STORE_FILE, { autoSave: false }),
    ) as Promise<StoreHandle>;
  }
  return storePromise;
}

function readLocal<T>(key: keyof AppData, fallback: T): T {
  try {
    const raw = localStorage.getItem(LEGACY_PREFIX + LEGACY_KEYS[key]);
    if (!raw) return fallback;
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Girdileri varsayılanlarla birleştirir; eksik alanlar tamamlanır. */
function normalizeInputs(raw: unknown): CalculatorInputs {
  const stored = (raw ?? {}) as Partial<CalculatorInputs>;
  const merged = { ...DEFAULT_INPUTS, ...stored };
  if (!Array.isArray(merged.usages) || merged.usages.length === 0) {
    merged.usages = DEFAULT_INPUTS.usages;
  }
  return merged as CalculatorInputs;
}

function normalize(partial: Partial<Record<keyof AppData, unknown>>): AppData {
  const inputs = normalizeInputs(partial.inputs);
  return {
    spools: Array.isArray(partial.spools) ? (partial.spools as FilamentSpool[]) : [],
    inputs,
    printer: (partial.printer as PrinterProfile | null) ?? null,
    orders: migrateOrders(partial.orders, inputs.marginPct),
    jobs: migrateJobs(partial.jobs),
    watch: { ...DEFAULT_WATCH_SETTINGS, ...((partial.watch as WatchSettings) ?? {}) },
    catalog: Array.isArray(partial.catalog) ? (partial.catalog as CatalogProduct[]) : [],
    printers: Array.isArray(partial.printers) ? (partial.printers as PrinterLink[]) : [],
    customers: Array.isArray(partial.customers) ? (partial.customers as Customer[]) : [],
    invoices: Array.isArray(partial.invoices) ? (partial.invoices as Invoice[]) : [],
    seller: { ...EMPTY_SELLER, ...((partial.seller as SellerInfo) ?? {}) },
    printerHours:
      partial.printerHours && typeof partial.printerHours === 'object'
        ? (partial.printerHours as RunHours)
        : {},
    maintenance: {
      ...DEFAULT_MAINTENANCE,
      ...((partial.maintenance as MaintenanceSettings) ?? {}),
      done: {
        ...DEFAULT_MAINTENANCE.done,
        ...(((partial.maintenance as MaintenanceSettings) ?? {}).done ?? {}),
      },
    },
    branding: { ...EMPTY_BRANDING, ...((partial.branding as Branding) ?? {}) },
    dock: Array.isArray(partial.dock) ? (partial.dock as DockApp[]) : [],
    customPrinters: Array.isArray(partial.customPrinters)
      ? (partial.customPrinters as CatalogPrinter[])
      : [],
    users: Array.isArray(partial.users) ? (partial.users as User[]) : [],
    backup: { ...DEFAULT_BACKUP, ...((partial.backup as BackupSettings) ?? {}) },
    theme: partial.theme === 'light' ? 'light' : 'dark',
  };
}

/**
 * Tüm veriyi tek seferde okur.
 *
 * Masaüstünde store dosyası boşsa (ilk açılış veya tarayıcı sürümünden geçiş)
 * localStorage'daki eski kayıtlar bir kez içeri alınır.
 */
export async function loadAll(): Promise<AppData> {
  const keys = Object.keys(DEFAULT_DATA) as Array<keyof AppData>;

  if (isTauri()) {
    try {
      const store = await getStore();
      const collected: Partial<Record<keyof AppData, unknown>> = {};
      let found = false;
      for (const key of keys) {
        const value = await store.get<unknown>(key);
        if (value !== undefined && value !== null) {
          collected[key] = value;
          found = true;
        }
      }
      if (found) {
        backend = 'tauri';
        mirror = normalize(collected);
        return mirror;
      }

      // İlk açılış: varsa tarayıcı kayıtlarını taşı.
      const imported: Partial<Record<keyof AppData, unknown>> = {};
      for (const key of keys) imported[key] = readLocal(key, undefined);
      const data = normalize(imported);
      for (const key of keys) await store.set(key, data[key]);
      await store.save();
      backend = 'tauri';
      mirror = data;
      return data;
    } catch {
      // Store açılamazsa tarayıcı deposuna düş.
    }
  }

  // Yerel sunucu varsa tek kaynak odur.
  const reply = await readServerData();
  if (reply?.ok) {
    backend = 'server';
    if (reply.data && Object.keys(reply.data).length > 0) {
      mirror = normalize(reply.data);
      return mirror;
    }

    // Dosya henuz yoksa: eski tarayici kayitlari bir kez diske tasinir.
    const imported: Partial<Record<keyof AppData, unknown>> = {};
    for (const key of keys) imported[key] = readLocal(key, undefined);
    mirror = normalize(imported);
    await writeServerData(mirror);
    return mirror;
  }

  backend = 'local';
  const collected: Partial<Record<keyof AppData, unknown>> = {};
  for (const key of keys) collected[key] = readLocal(key, undefined);
  mirror = normalize(collected);
  return mirror;
}

// --- Geciktirilmiş yazma ---------------------------------------------------

const pending = new Map<keyof AppData, unknown>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  const batch = [...pending.entries()];
  pending.clear();
  if (batch.length === 0) return;

  if (isTauri()) {
    try {
      const store = await getStore();
      for (const [key, value] of batch) await store.set(key, value);
      await store.save();
      return;
    } catch {
      // Disk yazımı başarısızsa tarayıcı deposuna yaz.
    }
  }

  if (backend === 'server' && mirror) {
    // Dosyanin tamami yazilir; parcali yazma dosyayi tutarsiz birakabilir.
    if (await writeServerData(mirror)) return;
    // Sunucuya ulasilamadi: veri kaybolmasin diye tarayici deposuna dusulur.
  }

  for (const [key, value] of batch) {
    try {
      localStorage.setItem(LEGACY_PREFIX + LEGACY_KEYS[key], JSON.stringify(value));
    } catch {
      // Kota dolu veya gizli mod: sessizce yoksay.
    }
  }
}

/** Bir alanı kaydeder. Ardışık çağrılar tek yazmada birleştirilir. */
export function save<K extends keyof AppData>(key: K, value: AppData[K]): void {
  if (mirror) mirror = { ...mirror, [key]: value };
  pending.set(key, value);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, WRITE_DELAY_MS);
}

/** Bekleyen yazmaları hemen diske indirir (pencere kapanırken). */
export async function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}

/** Güvenli benzersiz kimlik üretici. */
export function uid(prefix = 'id'): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Şifreli kasa ve açılış akışı
// ---------------------------------------------------------------------------

/**
 * Diskteki dosyanın biçimi.
 *
 * `users` HER ZAMAN düz metindir; içinde yalnızca PBKDF2 özetleri vardır ve
 * giriş ekranını çizebilmek için şifre çözmeden okunabilmesi gerekir
 * (yumurta-tavuk sorunu). Geri kalan her şey `vault` içinde şifrelenir.
 *
 * Eski sürümlerden kalan dosyalar sarmalayıcısız düz `AppData` içerir; bunlar
 * ilk okumada yeni biçime alınır.
 */
interface DiskFile {
  users?: User[];
  data?: Partial<Record<keyof AppData, unknown>>;
  vault?: unknown;
}

let vaultKey: string | null = null;
let encryptedOnDisk = false;

export function setVaultKey(key: string | null): void {
  vaultKey = key;
}

/** Diskteki dosya şifreli mi? */
export function isEncrypted(): boolean {
  return encryptedOnDisk;
}

export interface BootState {
  /** Giriş ekranı için kullanıcı listesi (boşsa ilk kurulum). */
  users: User[];
  /** Şifreli ve henüz açılmadı. */
  locked: boolean;
  /** Kilitli değilse hazır veri. */
  data: AppData | null;
  /**
   * Sunucu var ama veri dosyası okunamadı.
   *
   * Bu durumda tarayıcı deposuna düşmek kayıtlı envanteri ve siparişleri
   * yok gösterir; üstelik sonraki yazmalar diske değil tarayıcıya gider.
   * Arayüz bunun yerine uyarı gösterip yeniden denemelidir.
   */
  unreachable?: boolean;
}

function isLegacyShape(value: Partial<Record<string, unknown>>): boolean {
  // Eski dosyalarda AppData alanlari dogrudan kokte durur.
  return 'orders' in value || 'spools' in value || 'inputs' in value;
}

/**
 * Açılışta çağrılır: kullanıcıları okur, dosya şifresizse veriyi de döner.
 * Şifreliyse `locked` gelir; parolayla `unlock()` çağrılmalıdır.
 */
export async function boot(): Promise<BootState> {
  const keys = Object.keys(DEFAULT_DATA) as Array<keyof AppData>;

  if (isTauri()) {
    backend = 'tauri';
    const data = await loadAll();
    mirror = data;
    return { users: data.users, locked: false, data };
  }

  const reply = await readServerData();
  if (!reply?.ok) {
    // Sunucu var ama cevap vermedi: tarayici deposuna dusmek kayitli
    // veriyi yok gosterir ve sonraki yazmalari diskten koparir.
    if (!serverMissing) {
      return { users: [], locked: false, data: null, unreachable: true };
    }
    // Köprü yok: tarayıcı deposuna düş, şifreleme kullanılamaz.
    backend = 'local';
    const collected: Partial<Record<keyof AppData, unknown>> = {};
    for (const key of keys) collected[key] = readLocal(key, undefined);
    mirror = normalize(collected);
    return { users: mirror.users, locked: false, data: mirror };
  }

  backend = 'server';
  const file = (reply.data ?? {}) as DiskFile;

  // Hiç dosya yok: eski tarayıcı kayıtlarını içeri al.
  if (!file || Object.keys(file).length === 0) {
    const imported: Partial<Record<keyof AppData, unknown>> = {};
    for (const key of keys) imported[key] = readLocal(key, undefined);
    mirror = normalize(imported);
    encryptedOnDisk = false;
    await writeServerData(mirror);
    return { users: mirror.users, locked: false, data: mirror };
  }

  if (isLegacyShape(file as Record<string, unknown>)) {
    mirror = normalize(file as Partial<Record<keyof AppData, unknown>>);
    encryptedOnDisk = false;
    return { users: mirror.users, locked: false, data: mirror };
  }

  const users = Array.isArray(file.users) ? file.users : [];
  if (isEnvelope(file.vault)) {
    encryptedOnDisk = true;
    return { users, locked: true, data: null };
  }

  encryptedOnDisk = false;
  mirror = normalize({ ...(file.data ?? {}), users });
  return { users, locked: false, data: mirror };
}

/** Şifreli dosyayı verilen anahtarla açar. Anahtar yanlışsa null döner. */
export async function unlock(key: string): Promise<AppData | null> {
  const reply = await readServerData();
  const file = (reply?.data ?? {}) as DiskFile;
  if (!isEnvelope(file.vault)) return null;

  const inner = await unseal<Partial<Record<keyof AppData, unknown>>>(file.vault, key);
  if (!inner) return null;

  vaultKey = key;
  encryptedOnDisk = true;
  mirror = normalize({ ...inner, users: file.users ?? [] });
  return mirror;
}

/** Şifrelemeyi açar: bundan sonraki yazmalar kasaya gider. */
export async function enableEncryption(key: string): Promise<boolean> {
  if (backend !== 'server' || !mirror) return false;
  vaultKey = key;
  encryptedOnDisk = true;
  return writeServerData(mirror);
}

/** Şifrelemeyi kapatır; dosya düz metne döner. */
export async function disableEncryption(): Promise<boolean> {
  if (backend !== 'server' || !mirror) return false;
  vaultKey = null;
  encryptedOnDisk = false;
  return writeServerData(mirror);
}
