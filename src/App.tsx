import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackupPanel } from './components/BackupPanel';
import { CatalogPanel } from './components/CatalogPanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { DashboardPanel } from './components/DashboardPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GanttPanel } from './components/GanttPanel';
import { LoginScreen } from './components/LoginScreen';
import { SettingsPanel } from './components/SettingsPanel';
import { InventoryPanel } from './components/InventoryPanel';
import { InvoicesPanel } from './components/InvoicesPanel';
import { ModelImport, type ImportPatch } from './components/ModelImport';
import { OrdersPanel } from './components/OrdersPanel';
import { PageHeader } from './components/PageHeader';
import { ParameterPanel } from './components/ParameterPanel';
import { PrintJobsPanel } from './components/PrintJobsPanel';
import { PrinterPanel } from './components/PrinterPanel';
import { PrintersPanel } from './components/PrintersPanel';
import { ResultPanel } from './components/ResultPanel';
import { Sidebar, type View } from './components/Sidebar';
import { Spinner, Toast, Banner } from './components/ui';
import { fetchFilamentFromUrl } from './lib/api';
import { backupFileName, createSnapshot, isBackupDue, isSameContent } from './lib/backup';
import { defaultAssignment, itemFromProduct, priceOrder } from './lib/catalog';
import { calculateCost, toHours } from './lib/costEngine';
import { buildInvoice, newCustomer, nextInvoiceNumber } from './lib/invoice';
import { readStatus, removeGcode, saveGcode, sendStoredToPrint } from './lib/printerClient';
import { markMaintenanceDone } from './lib/workshop';
import { setCustomPrinters } from './lib/printerCatalog';
import { ROLE_META, ensureMaster, sessionCan, type Session, type User } from './lib/auth';
import type { LiveStatus, PrinterLink } from './lib/printerLink';
import { formatDuration, formatTRY } from './lib/format';
import { splitDuration } from './lib/gcodeParser';
import { selectSpoolsToRefresh } from './lib/priceWatcher';
import { mergeSpools, refreshSpools, type FetchedPrice } from './lib/refreshRunner';
import {
  diskBackupSupported,
  isDesktopShell,
  listBackups,
  pullBackup,
  pushBackup,
  type BackupFileInfo,
} from './lib/runtime';
import {
  DEFAULT_DATA,
  DEFAULT_INPUTS,
  boot,
  disableEncryption,
  enableEncryption,
  flushNow,
  isEncrypted,
  save,
  setVaultKey,
  unlock,
  storageBackend,
  uid,
  type AppData,
} from './lib/storage';
import {
  applyPrinterSync,
  jobFromOrderItem,
  shouldAddSentJob,
  type PrinterSyncState,
} from './lib/printerSync';
import {
  patchJobStatus,
  runHoursOf,
  nextOrderCode,
  summarizeJobs,
  summarizeOrders,
} from './lib/tracking';
import type {
  CalculatorInputs,
  CatalogProduct,
  FilamentSpool,
  OrderItem,
  JobStatus,
  Order,
  PrintJob,
} from './types';

/** Baskı ilerleme çubukları ve "x dk önce" metinleri için tik aralığı. */
const TICK_MS = 30_000;

/** Gantt'a sabit referans; her render'da yeni nesne uretmemek icin. */
const EMPTY_BUSY: Record<string, number> = {};
/** Otomatik fiyat kontrolünün değerlendirilme sıklığı. */
const WATCH_CHECK_MS = 60_000;
/** Otomatik yedeğin değerlendirilme sıklığı. */
const BACKUP_CHECK_MS = 60_000;
/** Yedek dosyalarına yazılan sürüm etiketi. */
/** Verinin nerede durduğunu kullanıcıya tek cümleyle anlatır. */
const STORAGE_NOTE: Record<ReturnType<typeof storageBackend>, string> = {
  tauri: 'Veriler bu bilgisayarda bir JSON dosyasında saklanır.',
  server: 'Veriler bu bilgisayarda bir JSON dosyasında saklanır; güncellemelerde korunur.',
  local:
    'Yerel sunucuya ulaşılamadı: veriler geçici olarak tarayıcı deposunda tutuluyor. Uygulamayı Baslat.bat veya exe ile açın.',
};

const APP_VERSION = '2.4.1';

export default function App() {
  const [data, setData] = useState<AppData>(DEFAULT_DATA);
  const [ready, setReady] = useState(false);
  /** Sunucu var ama veri dosyası okunamadı; boş uygulama açmak yanıltıcı olur. */
  const [dataUnreachable, setDataUnreachable] = useState(false);
  /** Giriş yapılmadıysa uygulama gövdesi çizilmez. */
  const [session, setSession] = useState<Session | null>(null);
  const [bootUsers, setBootUsers] = useState<User[]>([]);
  const [locked, setLocked] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** Pencereye bırakılan dosya; içe aktarma bileşenine iletilir. */
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  /** Oturumun veri anahtarı; yalnızca bellekte, diske hiç yazılmaz. */
  const vaultKeyRef = useRef<string | null>(null);

  const [view, setView] = useState<View>('calc');
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{
    tone: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const {
    spools,
    inputs,
    printer,
    orders,
    jobs,
    watch,
    catalog,
    printers,
    customers,
    invoices,
    seller,
    printerHours,
    maintenance,
    branding,
    dock,
    customPrinters,
    users,
    backup,
    theme,
  } = data;

  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [backupDir, setBackupDir] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  /** Tek bir alanı günceller ve diske yazar. */
  const update = useCallback(
    <K extends keyof AppData>(key: K, value: AppData[K] | ((prev: AppData[K]) => AppData[K])) => {
      setData((prev) => {
        const next =
          typeof value === 'function' ? (value as (p: AppData[K]) => AppData[K])(prev[key]) : value;
        if (next === prev[key]) return prev;
        save(key, next);
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  /** Zamanlayıcıların bayat veriye bakmaması için güncel referans. */
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // --- Açılışta tek okuma ---
  useEffect(() => {
    let cancelled = false;
    void boot().then((state) => {
      if (cancelled) return;
      if (state.unreachable) {
        // Kayitli envanteri/siparisi bos gostermektense durumu soyle.
        setDataUnreachable(true);
        setReady(true);
        return;
      }
      // Ana yönetici her açılışta garanti edilir; yoksa eklenir.
      const withMaster = ensureMaster(state.users, new Date().toISOString());
      setBootUsers(withMaster);
      setLocked(state.locked);
      if (state.data) setData({ ...state.data, users: withMaster });
      if (withMaster.length !== state.users.length) save('users', withMaster);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Tema ---
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // --- Pencere kapanırken bekleyen yazmaları indir ---
  useEffect(() => {
    const onLeave = () => {
      void flushNow();
      // Kapanışta son bir yedek denemesi (tarayıcı izin verdiği kadar).
      if (dataRef.current.backup.enabled && diskBackupSupported()) {
        const at = new Date().toISOString();
        const snapshot = createSnapshot(dataRef.current, APP_VERSION, at);
        navigator.sendBeacon?.(
          '/api/backup',
          new Blob([JSON.stringify({ name: backupFileName(at), snapshot })], {
            type: 'application/json',
          }),
        );
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  // Kullanicinin ekledigi yazicilar arama modulune bildirilir; katalog
  // fonksiyonlari saf kaldigi icin listeyi disaridan almalari gerekiyor.
  useEffect(() => {
    setCustomPrinters(customPrinters);
  }, [customPrinters]);

  // --- Zaman tiki ---
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // --- Anlık hesaplama ---
  const printerName = printer ? `${printer.brand} ${printer.model}` : '';
  // Satir ici dizi/nesne her render'da yeni referans uretir ve alt
  // bilesenlerdeki useMemo'yu bosuna gecersiz kilar.
  const schedulePrinters = useMemo(
    () => [...new Set([printerName, ...Object.keys(printerHours)].filter(Boolean))],
    [printerName, printerHours],
  );
  const result = useMemo(() => calculateCost(inputs, spools), [inputs, spools]);
  const orderSummary = useMemo(
    () => summarizeOrders(orders, now, spools, inputs),
    [orders, now, spools, inputs],
  );
  const jobSummary = useMemo(() => summarizeJobs(jobs, now), [jobs, now]);

  const patchInputs = useCallback(
    (patch: Partial<CalculatorInputs>) => update('inputs', (prev) => ({ ...prev, ...patch })),
    [update],
  );

  const handleSpoolsChange = useCallback(
    (next: FilamentSpool[]) => {
      update('spools', next);
      // Silinen makaralara bağlı satırları temizle.
      update('inputs', (prev) => ({
        ...prev,
        usages: prev.usages.map((usage) =>
          usage.spoolId && !next.some((s) => s.id === usage.spoolId)
            ? { ...usage, spoolId: null }
            : usage,
        ),
      }));
    },
    [update],
  );

  // --- Fiyat güncelleme ---
  const refreshingRef = useRef(false);

  const runRefresh = useCallback(
    async (targets: FilamentSpool[], silentWhenEmpty: boolean) => {
      if (refreshingRef.current) return;
      if (targets.length === 0) {
        if (!silentWhenEmpty) {
          setToast({ tone: 'info', text: 'Güncellenecek adresi olan filament bulunamadı.' });
        }
        return;
      }

      refreshingRef.current = true;
      setRefreshing(true);
      const at = new Date().toISOString();

      const fetcher = async (url: string): Promise<FetchedPrice> => {
        const response = await fetchFilamentFromUrl(url);
        return {
          ok: response.ok,
          price: response.price,
          weightGrams: response.weightGrams,
          warnings: response.warnings,
        };
      };

      try {
        const { updated, changes, summary } = await refreshSpools(targets, fetcher, at);
        update('spools', (prev) => mergeSpools(prev, updated));
        update('watch', (prev) => ({ ...prev, lastRunAt: at }));

        const detail = changes
          .slice(0, 3)
          .map(
            (change) =>
              `${change.spool.brand} ${change.spool.material}: ${formatTRY(
                change.previousPrice,
              )} → ${formatTRY(change.spool.rollPrice)}`,
          )
          .join(' · ');

        setToast({
          tone: summary.failed > 0 ? 'warning' : summary.updated > 0 ? 'success' : 'info',
          text: detail ? `${summary.message} ${detail}` : summary.message,
        });
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
      }
    },
    [update],
  );

  const refreshNow = useCallback(
    (spoolIds?: string[]) => {
      const targets = spoolIds
        ? spools.filter((s) => spoolIds.includes(s.id) && s.sourceUrl)
        : spools.filter((s) => s.sourceUrl);
      void runRefresh(targets, false);
    },
    [spools, runRefresh],
  );

  // --- Otomatik takip döngüsü ---
  useEffect(() => {
    if (!ready || !watch.enabled) return;
    const check = () => {
      const due = selectSpoolsToRefresh(spools, watch, Date.now());
      if (due.length > 0) void runRefresh(due, true);
    };
    check();
    const timer = setInterval(check, WATCH_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, watch, spools, runRefresh]);

  // --- Bildirimi otomatik kapat ---
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);

  // --- Dosyadan içe aktarma ---
  const applyImported = useCallback(
    (patch: ImportPatch) => {
      const parts: string[] = [];
      update('inputs', (prev) => {
        const next: CalculatorInputs = { ...prev };
        if (patch.printHours !== undefined) next.printHours = patch.printHours;
        if (patch.printMinutes !== undefined) next.printMinutes = patch.printMinutes;

        if (patch.usages !== undefined) {
          next.usages = patch.usages;
        } else if (patch.grams !== undefined) {
          next.usages =
            prev.usages.length > 0
              ? prev.usages.map((usage, index) =>
                  index === 0 ? { ...usage, grams: patch.grams as number } : usage,
                )
              : [{ id: uid('use'), spoolId: null, grams: patch.grams }];
          if (prev.usages.length > 1) parts.push('(ilk filament satırına yazıldı)');
        }
        return next;
      });

      if (patch.printHours !== undefined || patch.printMinutes !== undefined) {
        parts.unshift(
          `süre ${formatDuration(toHours(patch.printHours ?? 0, patch.printMinutes ?? 0))}`,
        );
      }
      if (patch.usages !== undefined) {
        const model = patch.usages.reduce((sum, u) => sum + u.grams, 0);
        const waste = patch.usages.reduce((sum, u) => sum + (u.wasteGrams ?? 0), 0);
        parts.push(
          `${patch.usages.length} renk · model ${model.toFixed(1)} g` +
            (waste > 0 ? ` · atık ${waste.toFixed(1)} g` : ''),
        );
      } else if (patch.grams !== undefined) {
        parts.push(`gramaj ${patch.grams} g`);
      }
      setToast({ tone: 'success', text: `Dosyadan alındı: ${parts.join(', ')}.` });
    },
    [update],
  );

  // --- Katalog ---
  /** İçe aktarılan g-code dosyası; katalog kaydı ve baskıya gönderme kullanır. */
  const [gcodeFile, setGcodeFile] = useState<File | null>(null);

  const saveProduct = useCallback(
    (product: Omit<CatalogProduct, 'id' | 'createdAt'>) => {
      const created: CatalogProduct = {
        ...product,
        id: uid('prod'),
        createdAt: new Date().toISOString(),
      };
      update('catalog', (prev) => [...prev, created]);
      setToast({
        tone: 'success',
        text: `"${created.name}" hazır ürünlere eklendi. Siparişlerde seçebilirsiniz.`,
      });

      // G-code'dan gelen ürünün dosyası saklanır; sipariş ekranından
      // doğrudan yazıcıya gönderilebilsin diye.
      if (product.source === 'gcode' && gcodeFile) {
        void saveGcode(gcodeFile).then((stored) => {
          if (!stored) return;
          update('catalog', (prev) =>
            prev.map((p) =>
              p.id === created.id ? { ...p, gcodeId: stored.id, gcodeSize: stored.size } : p,
            ),
          );
          setToast({
            tone: 'success',
            text: `"${created.name}" için g-code kaydedildi; siparişten yazıcıya gönderebilirsiniz.`,
          });
        });
      }
    },
    [gcodeFile, update],
  );

  const loadProductIntoCalculator = useCallback(
    (product: CatalogProduct) => {
      const { hours, minutes } = splitDuration(product.printSeconds);
      const assignment = defaultAssignment(product.tools, spools);
      update('inputs', (prev) => ({
        ...prev,
        printHours: hours,
        printMinutes: minutes,
        quantity: 1,
        usages: product.tools.map((tool) => ({
          id: uid('use'),
          spoolId: assignment[tool.toolIndex] ?? null,
          grams: tool.modelGrams,
          wasteGrams: tool.wasteGrams,
          toolIndex: tool.toolIndex,
          colorHex: tool.colorHex,
        })),
      }));
      setView('calc');
      setToast({ tone: 'success', text: `"${product.name}" hesaplayıcıya yüklendi.` });
    },
    [spools, update],
  );

  const addProductToOrder = useCallback(
    (product: CatalogProduct) => {
      const order: Order = {
        id: uid('ord'),
        code: nextOrderCode(orders),
        customer: '',
        status: 'pending',
        dueDate: '',
        notes: '',
        createdAt: new Date().toISOString(),
        marginPct: inputs.marginPct,
        items: [itemFromProduct(product, 1, spools, uid('item'))],
      };
      update('orders', (prev) => [...prev, order]);
      setFocusOrderId(order.id);
      setView('orders');
      setToast({ tone: 'success', text: `${order.code} açıldı ve "${product.name}" eklendi.` });
    },
    [orders, spools, inputs.marginPct, update],
  );

  // --- Yedekleme ---
  const lastBackupData = useRef<AppData | null>(null);

  const refreshBackups = useCallback(async () => {
    if (!diskBackupSupported()) return;
    const { dir, files } = await listBackups();
    setBackupDir(dir);
    setBackupFiles(files);
  }, []);

  /** Anlık veriyi diske yazar. Değişiklik yoksa yazmaz. */
  const runBackup = useCallback(
    async (force: boolean): Promise<string> => {
      if (!diskBackupSupported()) throw new Error('Bu ortamda diske yedek alınamıyor.');
      if (!force && isSameContent(dataRef.current, lastBackupData.current)) return '';

      setBackupBusy(true);
      try {
        const at = new Date().toISOString();
        const snapshot = createSnapshot(dataRef.current, APP_VERSION, at);
        const dir = await pushBackup(backupFileName(at), snapshot);
        lastBackupData.current = dataRef.current;
        update('backup', (prev) => ({ ...prev, lastAt: at }));
        await refreshBackups();
        return dir;
      } finally {
        setBackupBusy(false);
      }
    },
    [update, refreshBackups],
  );

  // Açılışta yedek listesini doldur. setState, effect gövdesinde değil
  // tamamlanan isteğin geri çağrısında yapılır.
  useEffect(() => {
    if (!ready || !diskBackupSupported()) return;
    let cancelled = false;
    listBackups().then(({ dir, files }) => {
      if (cancelled) return;
      setBackupDir(dir);
      setBackupFiles(files);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Düzenli yedek turu.
  useEffect(() => {
    if (!ready || !backup.enabled || !diskBackupSupported()) return;
    const check = () => {
      const hasData =
        dataRef.current.spools.length > 0 ||
        dataRef.current.catalog.length > 0 ||
        dataRef.current.orders.length > 0 ||
        dataRef.current.jobs.length > 0;
      if (isBackupDue(backup.lastAt, backup.intervalMinutes, Date.now(), hasData)) {
        void runBackup(false).catch(() => {
          // Yedek alınamazsa sessiz geç; bir sonraki turda tekrar denenir.
        });
      }
    };
    check();
    const timer = setInterval(check, BACKUP_CHECK_MS);
    return () => clearInterval(timer);
  }, [ready, backup, runBackup]);

  const restoreData = useCallback((restored: AppData) => {
    setData(restored);
    (Object.keys(restored) as Array<keyof AppData>).forEach((key) => save(key, restored[key]));
    lastBackupData.current = restored;
    setToast({ tone: 'success', text: 'Yedek geri yüklendi.' });
  }, []);

  // --- Canlı yazıcı takibi ---
  /**
   * Bağlı yazıcıların durumu düzenli aralıkla okunur. Yazıcılar sekmesi
   * açıkken sık, arka planda seyrek sorulur; böylece cihaz gereksiz yere
   * meşgul edilmez. Sorgular sırayla yapılır ki tek bir yavaş yazıcı
   * diğerlerini bekletsin ama ağ aynı anda dolmasın.
   */
  const [printerStatuses, setPrinterStatuses] = useState<Record<string, LiveStatus>>({});
  const printerSyncPrev = useRef<Record<string, PrinterSyncState>>({});

  const commitPrinterSync = useCallback((statuses: Record<string, LiveStatus>) => {
    const active = dataRef.current.printers.filter((p) => p.enabled);
    if (active.length === 0) return;

    const syncResult = applyPrinterSync({
      links: active,
      statuses,
      jobs: dataRef.current.jobs,
      orders: dataRef.current.orders,
      catalog: dataRef.current.catalog,
      spools: dataRef.current.spools,
      prev: printerSyncPrev.current,
      now: Date.now(),
      createId: () => uid('job'),
    });
    printerSyncPrev.current = syncResult.prev;

    if (!syncResult.changed && syncResult.pendingFinishes.length === 0) return;

    let jobs = syncResult.jobs;
    let spools = dataRef.current.spools;
    let printerHours = dataRef.current.printerHours;
    const finishNotes: string[] = [];

    for (const finish of syncResult.pendingFinishes) {
      const job = jobs.find((entry) => entry.id === finish.jobId);
      if (!job) continue;
      const patch = patchJobStatus(job, finish.status, spools, printerHours);
      jobs = jobs.map((entry) => (entry.id === job.id ? patch.job : entry));
      spools = patch.spools;
      printerHours = patch.printerHours;
      if (patch.notes.length > 0) {
        finishNotes.push(`${job.name}: ${patch.notes.join(' · ')}`);
      }
    }

    setData((prev) => {
      const next = { ...prev, jobs, spools, printerHours };
      save('jobs', jobs);
      if (spools !== prev.spools) save('spools', spools);
      if (printerHours !== prev.printerHours) save('printerHours', printerHours);
      return next;
    });

    if (syncResult.createdCount > 0) {
      setToast({
        tone: 'info',
        text:
          syncResult.createdCount === 1
            ? 'Yazıcıdaki devam eden baskı kuyruğa eklendi.'
            : `${syncResult.createdCount} baskı yazıcıdan eklendi.`,
      });
    } else if (finishNotes.length > 0) {
      setToast({
        tone: finishNotes.some((note) => note.includes('yetersiz')) ? 'warning' : 'success',
        text: finishNotes[0],
      });
    }
  }, []);

  const refreshPrinter = useCallback(
    (link: PrinterLink) => {
      void readStatus(link).then((status) => {
        setPrinterStatuses((prev) => {
          const merged = { ...prev, [link.id]: status };
          queueMicrotask(() => commitPrinterSync(merged));
          return merged;
        });
      });
    },
    [commitPrinterSync],
  );

  useEffect(() => {
    const active = printers.filter((p) => p.enabled);
    if (active.length === 0) return;

    let cancelled = false;
    // Bir tur bitmeden yenisi baslamamali: ulasilamayan yazicida her istek
    // zaman asimina kadar bekler, ust uste binen turlar istek yigar.
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const nextStatuses: Record<string, LiveStatus> = {};
        for (const link of active) {
          const status = await readStatus(link);
          if (cancelled) return;
          nextStatuses[link.id] = status;
        }
        if (cancelled) return;
        setPrinterStatuses((prev) => {
          const merged = { ...prev, ...nextStatuses };
          commitPrinterSync(merged);
          return merged;
        });
      } finally {
        running = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), view === 'printers' ? 5000 : 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [printers, view, commitPrinterSync]);

  // --- Oturum ---
  /**
   * Giriş başarılı: şifreli dosya varsa parolayla açılır, yoksa yalnızca
   * oturum kurulur. Anahtar bellekte tutulur; diske hiç yazılmaz.
   */
  const handleLogin = useCallback(
    async (next: Session, key: string) => {
      if (locked) {
        const opened = await unlock(key);
        if (!opened) {
          setToast({ tone: 'error', text: 'Veri dosyası bu parolayla açılamadı.' });
          return;
        }
        setData(opened);
        setLocked(false);
      } else if (isEncrypted()) {
        setVaultKey(key);
      }
      setSession(next);
      setVaultKey(key);
      vaultKeyRef.current = key;
    },
    [locked],
  );

  const handleLogout = useCallback(() => {
    void flushNow().then(() => {
      setVaultKey(null);
      vaultKeyRef.current = null;
      setSession(null);
      setPaletteOpen(false);
    });
  }, []);

  // --- Fatura ---
  /**
   * Siparişten fatura/proforma üretir. Kalem fiyatları ve müşteri bilgisi
   * fatura üstüne KOPYALANIR: envanter fiyatı veya cari kartı sonradan
   * değişse bile kesilmiş belge değişmez.
   */
  const [focusInvoiceId, setFocusInvoiceId] = useState<string | null>(null);

  const createInvoiceFromOrder = useCallback(
    (order: Order) => {
      const pricing = priceOrder(order, spools, inputs);
      const lines = pricing.items
        .filter(({ item }) => item.quantity > 0)
        .map(({ item, salePrice }) => ({
          name: item.name,
          quantity: item.quantity,
          // priceOrder satır toplamını verir; faturada birim fiyat gerekir.
          unitPrice: salePrice / item.quantity,
        }));

      if (lines.length === 0) {
        setToast({ tone: 'warning', text: `${order.code}: faturalanacak kalem yok.` });
        return;
      }

      const now = new Date();
      const customer =
        customers.find((c) => c.id === order.customerId) ??
        (order.customer.trim()
          ? { ...newCustomer(uid('cari'), now.toISOString()), name: order.customer.trim() }
          : null);

      const invoice = buildInvoice({
        id: uid('ftr'),
        number: nextInvoiceNumber(invoices, now.getFullYear()),
        kind: 'proforma',
        orderId: order.id,
        customer,
        lines,
        vatRate: seller.vatRate,
        today: now.toISOString().slice(0, 10),
        at: now.toISOString(),
      });

      update('invoices', (prev) => [...prev, invoice]);
      setFocusInvoiceId(invoice.id);
      setView('invoices');
      setToast({
        tone: 'success',
        text: `${invoice.number} oluşturuldu. Belge türünü ve KDV'yi kontrol edip PDF alabilirsiniz.`,
      });
    },
    [customers, inputs, invoices, seller.vatRate, spools, update],
  );

  // --- Siparişten baskıya gönderme ---
  /**
   * Sipariş kalemini seçilen yazıcıya yükleyip baskıyı başlatır. Dosya
   * tarayıcıya uğramaz; sunucu diskteki kopyayı doğrudan yazıcıya akıtır.
   * Gönderim başarılıysa kalem "Üretimde" olur ve bekleyen sipariş de
   * baskıya alınmış sayılır.
   */
  const sendItemToPrint = useCallback(
    async (order: Order, item: OrderItem, link: PrinterLink) => {
      if (!item.gcodeId) {
        setToast({ tone: 'warning', text: `${item.name}: kayıtlı g-code yok.` });
        return;
      }
      const result = await sendStoredToPrint(link, item.gcodeId, `${item.name}.gcode`);
      if (result.ok) {
        const iso = new Date().toISOString();
        update('orders', (prev) =>
          prev.map((o) =>
            o.id !== order.id
              ? o
              : {
                  ...o,
                  status: o.status === 'pending' ? 'printing' : o.status,
                  items: o.items.map((i) =>
                    i.id === item.id
                      ? { ...i, status: 'printing', printerName: link.name, sentAt: iso }
                      : i,
                  ),
                },
          ),
        );
        update('jobs', (prev) => {
          if (!shouldAddSentJob(prev, link, item)) return prev;
          const created = jobFromOrderItem(order, item, link, () => uid('job'), iso);
          return created ? [...prev, created] : prev;
        });
      }
      setToast({
        tone: result.ok ? 'success' : 'error',
        text: `${item.name} → ${link.name}: ${result.message}`,
      });
      refreshPrinter(link);
    },
    [refreshPrinter, update],
  );

  /** Katalogdan ürün silinince, başka kayıt kullanmıyorsa dosyası da silinir. */
  const changeCatalog = useCallback(
    (next: CatalogProduct[]) => {
      for (const product of catalog) {
        if (!product.gcodeId) continue;
        if (next.some((p) => p.id === product.id)) continue;
        const stillUsed =
          next.some((p) => p.gcodeId === product.gcodeId) ||
          orders.some((o) => o.items.some((i) => i.gcodeId === product.gcodeId));
        if (!stillUsed) void removeGcode(product.gcodeId);
      }
      update('catalog', next);
    },
    [catalog, orders, update],
  );

  // --- Baskı durumu ve stok düşümü ---
  /**
   * Bir baskı işi kapandığında (tamamlandı/başarısız) kullandığı filament
   * envanterden düşülür. Başarısız baskı da malzemeyi harcadığı için düşülür.
   * İş yeniden kuyruğa alınırsa düşülen miktar iade edilir. `consumed`
   * bayrağı sayesinde aynı iş iki kez düşürülmez.
   */
  const changeJobStatus = useCallback(
    (job: PrintJob, status: JobStatus) => {
      const patch = patchJobStatus(job, status, spools, printerHours);
      update('jobs', (prev) => prev.map((j) => (j.id === job.id ? patch.job : j)));
      if (patch.spools !== spools) update('spools', patch.spools);
      if (patch.printerHours !== printerHours) update('printerHours', patch.printerHours);

      if (patch.notes.length > 0) {
        setToast({
          tone: patch.notes.length > 1 ? 'warning' : 'success',
          text: `${job.name}: ${patch.notes.join(' · ')}`,
        });
      }
    },
    [spools, printerHours, update],
  );

  // --- Rapor ---
  const copyReport = async () => {
    const lines = [
      '3D BASKI MALİYET RAPORU',
      '========================',
      printer
        ? `Yazıcı        : ${printer.brand} ${printer.model} (${inputs.printerWatts} W)`
        : null,
      `Süre          : ${formatDuration(result.totalHours)} · ${result.quantity} adet`,
      `Malzeme       : ${result.modelGrams} g model + ${result.wasteGrams} g atık`,
      '',
      `Filament      : ${formatTRY(result.modelFilamentCost)}`,
      result.wasteFilamentCost > 0
        ? `Atık          : ${formatTRY(result.wasteFilamentCost)}`
        : null,
      `Elektrik      : ${formatTRY(result.electricityCost)}`,
      `Amortisman    : ${formatTRY(result.depreciationCost)}`,
      `Fire riski    : ${formatTRY(result.failureCost)}`,
      `İşçilik       : ${formatTRY(result.laborCost)}`,
      `Ek giderler   : ${formatTRY(result.extraCost)}`,
      '------------------------',
      `NET MALİYET   : ${formatTRY(result.netCost)}`,
      `Kâr marjı %${inputs.marginPct} : ${formatTRY(result.marginAmount)}`,
      inputs.vatEnabled ? `KDV %${inputs.vatPct}      : ${formatTRY(result.vatAmount)}` : null,
      `SATIŞ FİYATI  : ${formatTRY(result.salePrice)}`,
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // --- Klavye kısayolları ---
  /**
   * Ctrl+K palet, Ctrl+B yeni sipariş, Ctrl+S anında kayıt, Ctrl+P yazdır.
   * Bir metin kutusundayken yalnızca palet ve kayıt çalışır; diğerleri
   * yazmayı bölmemeli.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;

      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === 's') {
        event.preventDefault();
        void flushNow().then(() => setToast({ tone: 'success', text: 'Kaydedildi.' }));
      } else if (key === 'b' && !typing) {
        event.preventDefault();
        setView('orders');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- Genel sürükle-bırak ---
  /**
   * Pencerenin herhangi bir yerine .gcode/.stl bırakılınca hesaplama
   * ekranına geçilir ve dosya oraya iletilir.
   */
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      const file = event.dataTransfer?.files?.[0];
      setDragging(false);
      if (!file) return;
      if (!/\.(gcode|gco|g|nc|bgcode|stl)$/i.test(file.name)) return;
      event.preventDefault();
      setView('calc');
      setDroppedFile(file);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const paletteCommands = useMemo<Command[]>(
    () => [
      {
        id: 'go-dashboard',
        label: 'Panele git',
        hint: 'Ctrl+K',
        group: 'Git',
        run: () => setView('dashboard'),
      },
      {
        id: 'go-calc',
        label: 'Yeni hesaplama',
        hint: '',
        group: 'Git',
        run: () => setView('calc'),
      },
      {
        id: 'go-orders',
        label: 'Siparişler',
        hint: 'Ctrl+B',
        group: 'Git',
        run: () => setView('orders'),
      },
      {
        id: 'go-gantt',
        label: 'Üretim takvimi',
        hint: '',
        group: 'Git',
        run: () => setView('gantt'),
      },
      { id: 'go-inv', label: 'Envanter', hint: '', group: 'Git', run: () => setView('inventory') },
      {
        id: 'go-invoices',
        label: 'Faturalar',
        hint: '',
        group: 'Git',
        run: () => setView('invoices'),
      },
      {
        id: 'go-printers',
        label: 'Yazıcılar',
        hint: '',
        group: 'Git',
        run: () => setView('printers'),
      },
      {
        id: 'go-settings',
        label: 'Ayarlar',
        hint: '',
        group: 'Git',
        run: () => setView('settings'),
      },
      {
        id: 'save-now',
        label: 'Şimdi kaydet',
        hint: 'Ctrl+S',
        group: 'Eylem',
        run: () => void flushNow(),
      },
      { id: 'logout', label: 'Oturumu kapat', hint: '', group: 'Eylem', run: handleLogout },
    ],
    [handleLogout],
  );

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6 text-accent-500" />
      </div>
    );
  }

  if (dataUnreachable) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-500/25 dark:bg-amber-500/10">
          <h1 className="text-base font-bold text-amber-800 dark:text-amber-200">
            Veri dosyası okunamadı
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-amber-800/90 dark:text-amber-100/90">
            Kayıtlı envanteriniz ve siparişleriniz yerinde; uygulama şu an dosyaya ulaşamıyor. Boş
            bir ekranla çalışmaya başlamanız verinizi bozabileceği için burada durduruldu.
          </p>
          <p className="mt-3 text-[12px] text-amber-700/80 dark:text-amber-200/70">
            Dosya: %APPDATA%\3D Baski Maliyet\veri.json
          </p>
          <button
            type="button"
            className="btn-primary mt-4 !py-2 !text-xs"
            onClick={() => window.location.reload()}
          >
            Tekrar dene
          </button>
        </div>
      </div>
    );
  }

  // Kullanıcı tanımlıysa veya dosya kilitliyse önce giriş.
  if (!session && (bootUsers.length > 0 || locked)) {
    return (
      <LoginScreen
        users={bootUsers}
        onCreateFirstUser={(user) => update('users', [user])}
        onLogin={(next, key) => void handleLogin(next, key)}
        businessName={branding.businessName}
        logo={branding.logo}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar
        view={view}
        onChange={(next) => {
          setView(next);
          if (next !== 'orders') setFocusOrderId(null);
        }}
        badges={{
          orders: orderSummary.openCount,
          jobs: jobSummary.activeCount,
          printers: printers.filter((p) => printerStatuses[p.id]?.state === 'printing').length,
        }}
        theme={theme}
        onToggleTheme={() => update('theme', theme === 'dark' ? 'light' : 'dark')}
        desktop={isDesktopShell()}
        businessName={branding.businessName}
        logo={branding.logo}
        userLabel={session ? `${session.displayName} · ${ROLE_META[session.role].label}` : null}
        onLogout={session ? handleLogout : null}
        dock={dock}
        onLaunch={(app) => {
          void fetch('/api/launch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: app.path }),
          })
            .then((response) => response.json())
            .then((body: { ok?: boolean; error?: string }) => {
              if (!body.ok) {
                setToast({ tone: 'error', text: body.error ?? 'Program açılamadı.' });
              }
            })
            .catch(() => setToast({ tone: 'error', text: 'Program açılamadı.' }));
        }}
        allowed={(target) => {
          // Giriş kapalıysa her şey açık; açıksa role göre süzülür.
          if (!session) return true;
          if (target === 'dashboard' || target === 'invoices' || target === 'backup') {
            return sessionCan(session, 'finance');
          }
          if (target === 'settings') return sessionCan(session, 'settings');
          if (target === 'inventory' || target === 'catalog' || target === 'calc') {
            return sessionCan(session, 'inventory');
          }
          return true;
        }}
      />

      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:h-screen lg:overflow-y-auto">
        <PageHeader
          view={view}
          onSearch={() => setPaletteOpen(true)}
          showWorkflowTip={view === 'jobs' || view === 'orders' || view === 'gantt'}
        />

        <ErrorBoundary resetKey={view}>
          {storageBackend() === 'local' && (
            <div className="mb-4">
              <Banner tone="warning">
                Veriler geçici olarak tarayıcıda tutuluyor. Kalıcı kayıt için uygulamayı{' '}
                <strong>Baslat.bat</strong> veya <strong>exe</strong> ile açın.
              </Banner>
            </div>
          )}
          {view === 'dashboard' && (
            <DashboardPanel
              orders={orders}
              jobs={jobs}
              spools={spools}
              inputs={inputs}
              printerHours={printerHours}
              maintenance={maintenance}
              now={now}
              onGoTo={setView}
            />
          )}

          {view === 'calc' && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
              <div className="space-y-4">
                <ModelImport
                  spools={spools}
                  currentUsages={inputs.usages}
                  dark={theme === 'dark'}
                  currentPrintSeconds={toHours(inputs.printHours, inputs.printMinutes) * 3600}
                  onApply={applyImported}
                  onGcodeFile={setGcodeFile}
                  incomingFile={droppedFile}
                  onIncomingHandled={() => setDroppedFile(null)}
                  onSaveProduct={saveProduct}
                />
                <PrinterPanel
                  runHours={runHoursOf(printerHours, printerName)}
                  customPrinters={customPrinters}
                  onCustomPrintersChange={(next) => update('customPrinters', next)}
                  maintenance={maintenance}
                  onMaintenanceDone={() => {
                    update(
                      'maintenance',
                      markMaintenanceDone(
                        maintenance,
                        printerName,
                        runHoursOf(printerHours, printerName),
                      ),
                    );
                    setToast({
                      tone: 'success',
                      text: `${printerName}: bakım kaydedildi, sayaç sıfırlandı.`,
                    });
                  }}
                  onMaintenanceInterval={(hours) =>
                    update('maintenance', { ...maintenance, intervalHours: hours })
                  }
                  printer={printer}
                  onPrinterChange={(next) => update('printer', next)}
                  watts={inputs.printerWatts}
                  onWattsChange={(watts) => patchInputs({ printerWatts: watts })}
                  depreciationPerHour={inputs.depreciationPerHour}
                  onDepreciationChange={(value) => patchInputs({ depreciationPerHour: value })}
                />
                <ParameterPanel
                  inputs={inputs}
                  onChange={patchInputs}
                  spools={spools}
                  onOpenLibrary={() => setView('inventory')}
                />
              </div>

              <div className="space-y-3 xl:sticky xl:top-0 xl:self-start">
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={copyReport}
                    className="btn-ghost !px-3 !py-2 !text-xs"
                    title="Raporu panoya kopyala"
                  >
                    {copied ? 'Kopyalandı' : 'Rapor'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Hesaplayıcı girdileri varsayılana dönecek. Devam edilsin mi?')) {
                        update('inputs', DEFAULT_INPUTS);
                      }
                    }}
                    className="btn-ghost !px-3 !py-2 !text-xs"
                  >
                    Sıfırla
                  </button>
                </div>
                <ResultPanel result={result} marginPct={inputs.marginPct} />
              </div>
            </div>
          )}

          {view === 'inventory' && (
            <InventoryPanel
              spools={spools}
              onChange={handleSpoolsChange}
              watch={watch}
              onWatchChange={(next) => update('watch', next)}
              onRefreshNow={refreshNow}
              refreshing={refreshing}
              now={now}
            />
          )}

          {view === 'catalog' && (
            <CatalogPanel
              catalog={catalog}
              onChange={changeCatalog}
              spools={spools}
              inputs={inputs}
              onLoadIntoCalculator={loadProductIntoCalculator}
              onAddToOrder={addProductToOrder}
            />
          )}

          {view === 'orders' && (
            <OrdersPanel
              orders={orders}
              onChange={(next) => update('orders', next)}
              catalog={catalog}
              spools={spools}
              inputs={inputs}
              now={now}
              focusOrderId={focusOrderId}
              onGoToCalculator={() => setView('calc')}
              printers={printers}
              printerStatuses={printerStatuses}
              onSendToPrint={sendItemToPrint}
              customers={customers}
              onCreateInvoice={createInvoiceFromOrder}
            />
          )}

          {view === 'invoices' && (
            <InvoicesPanel
              invoices={invoices}
              onInvoicesChange={(next) => update('invoices', next)}
              customers={customers}
              onCustomersChange={(next) => update('customers', next)}
              seller={seller}
              onSellerChange={(next) => update('seller', next)}
              focusInvoiceId={focusInvoiceId}
              branding={branding}
              onToast={(tone, text) => setToast({ tone, text })}
            />
          )}

          {view === 'gantt' && (
            <GanttPanel
              orders={orders}
              printerNames={schedulePrinters}
              busyUntil={EMPTY_BUSY}
              now={now}
              onOpenOrder={(orderId) => {
                setFocusOrderId(orderId);
                setView('orders');
              }}
              onGoToOrders={() => setView('orders')}
            />
          )}

          {view === 'settings' && (
            <SettingsPanel
              branding={branding}
              onBrandingChange={(next) => update('branding', next)}
              dock={dock}
              onDockChange={(next) => update('dock', next)}
              users={users}
              onUsersChange={(next) => update('users', next)}
              session={session}
              maintenance={maintenance}
              onMaintenanceChange={(next) => update('maintenance', next)}
              encrypted={isEncrypted()}
              onToggleEncryption={(on) => {
                const key = vaultKeyRef.current;
                if (on && !key) {
                  setToast({
                    tone: 'warning',
                    text: 'Şifreleme için önce giriş yapmalısınız (parola anahtarı gerekir).',
                  });
                  return;
                }
                const work = on && key ? enableEncryption(key) : disableEncryption();
                void work.then((ok) =>
                  setToast({
                    tone: ok ? 'success' : 'error',
                    text: ok
                      ? on
                        ? 'Veri dosyası şifrelendi.'
                        : 'Şifreleme kapatıldı.'
                      : 'İşlem yapılamadı.',
                  }),
                );
              }}
              onToast={(tone, text) => setToast({ tone, text })}
            />
          )}

          {view === 'printers' && (
            <PrintersPanel
              links={printers}
              onChange={(next) => update('printers', next)}
              statuses={printerStatuses}
              onRefresh={refreshPrinter}
              onToast={(tone, text) => setToast({ tone, text })}
              gcodeFile={gcodeFile}
            />
          )}

          {view === 'backup' && (
            <BackupPanel
              data={data}
              settings={backup}
              onSettingsChange={(next) => update('backup', next)}
              onBackupNow={() => runBackup(true)}
              onRestore={restoreData}
              files={backupFiles}
              dir={backupDir}
              busy={backupBusy}
              onRefresh={() => void refreshBackups()}
              onReadBackup={pullBackup}
              appVersion={APP_VERSION}
              now={now}
            />
          )}

          {view === 'jobs' && (
            <PrintJobsPanel
              jobs={jobs}
              onChange={(next) => update('jobs', next)}
              spools={spools}
              orders={orders}
              now={now}
              defaults={{
                printerName: printer ? `${printer.brand} ${printer.model}` : '',
                materials: inputs.usages
                  .filter((u) => u.grams > 0 || (u.wasteGrams ?? 0) > 0)
                  .map((u) => ({
                    spoolId: u.spoolId,
                    // Atık da makaradan çıktığı için stok düşümüne dahildir.
                    grams: u.grams + (u.wasteGrams ?? 0),
                    toolIndex: u.toolIndex,
                    colorHex: u.colorHex,
                  })),
                hours: toHours(inputs.printHours, inputs.printMinutes),
              }}
              printerHours={printerHours}
              printerStatuses={printerStatuses}
              onStatusChange={changeJobStatus}
              onApplyFailureRate={(pct) => {
                patchInputs({ failureRatePct: pct });
                setView('calc');
                setToast({
                  tone: 'success',
                  text: `Gerçekleşen fire oranı (%${pct}) hesaplayıcıya uygulandı.`,
                });
              }}
              onGoToCalc={() => setView('calc')}
            />
          )}

          <footer className="mt-8 pb-6 text-center text-[11px] text-slate-400 dark:text-slate-600">
            {STORAGE_NOTE[storageBackend()]}
          </footer>
        </ErrorBoundary>
      </main>

      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          orders={orders}
          customers={customers}
          invoices={invoices}
          printers={printers}
          onGo={(target, orderId) => {
            if (orderId) setFocusOrderId(orderId);
            setView(target);
          }}
          actions={paletteCommands}
        />
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-accent-500/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent-500 bg-white/90 px-8 py-6 text-center shadow-2xl dark:bg-ink-900/90">
            <p className="text-sm font-semibold text-accent-600 dark:text-accent-300">
              Dosyayı bırakın
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              .gcode veya .stl · hesaplama ekranına aktarılır
            </p>
          </div>
        </div>
      )}

      {toast && <Toast tone={toast.tone} message={toast.text} onClose={() => setToast(null)} />}
    </div>
  );
}
