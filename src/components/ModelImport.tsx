import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { formatDuration, formatNumber, formatSpoolLabel, formatTRY } from '../lib/format';
import { pricePerGram } from '../lib/costEngine';
import {
  FALLBACK_COLORS,
  buildBreakdown,
  parseGcode,
  splitDuration,
  type GcodeInfo,
  type ToolBreakdown,
} from '../lib/gcodeParser';
import { scanGcodeFile } from '../lib/gcodeScanRunner';
import type { ScanResult } from '../lib/gcodeScanner';
import { DENSITIES, densityOf, estimateWeight } from '../lib/materials';
import { computeStats, parseStl, type StlStats } from '../lib/stlParser';
import { uid } from '../lib/storage';
import {
  MATERIALS,
  type CatalogProduct,
  type CatalogTool,
  type FilamentSpool,
  type FilamentUsage,
  type Material,
} from '../types';
import { Banner, NumberField, Section, SelectField, Slider, Spinner, TextField } from './ui';

const StlViewer = lazy(() => import('./StlViewer'));

/** Büyük g-code dosyalarında başlık için yalnızca baş ve son bölüm okunur. */
const GCODE_EDGE_BYTES = 256 * 1024;
const MAX_STL_BYTES = 120 * 1024 * 1024;

export interface ImportPatch {
  printHours?: number;
  printMinutes?: number;
  grams?: number;
  usages?: FilamentUsage[];
}

interface ModelImportProps {
  spools: FilamentSpool[];
  /** Hesaplayıcıdaki mevcut satırlar — makara seçimlerini korumak için. */
  currentUsages: FilamentUsage[];
  dark: boolean;
  /** Hesaplayıcıdaki güncel baskı süresi (saniye) — STL kaydında kullanılır. */
  currentPrintSeconds: number;
  onApply: (patch: ImportPatch) => void;
  /** Okunan g-code dosyasi; yaziciya dogrudan gonderebilmek icin saklanir. */
  onGcodeFile?: (file: File | null) => void;
  /** Pencereye sürüklenip bırakılan dosya; gelince otomatik işlenir. */
  incomingFile?: File | null;
  onIncomingHandled?: () => void;
  /** Hesaplamayı katalog ürünü olarak kaydeder. */
  onSaveProduct: (product: Omit<CatalogProduct, 'id' | 'createdAt'>) => void;
}

interface StlResult {
  fileName: string;
  stats: StlStats;
  positions: Float32Array;
}

const UPLOAD_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4l4 4" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </svg>
);

/** Dosyanın baş ve son bölümünü metin olarak okur. */
async function readGcodeEdges(file: File): Promise<string> {
  if (file.size <= GCODE_EDGE_BYTES * 2) return file.text();
  const head = await file.slice(0, GCODE_EDGE_BYTES).text();
  const tail = await file.slice(file.size - GCODE_EDGE_BYTES).text();
  return `${head}\n${tail}`;
}

export function ModelImport({
  spools,
  currentUsages,
  dark,
  currentPrintSeconds,
  onApply,
  onGcodeFile,
  incomingFile,
  onIncomingHandled,
  onSaveProduct,
}: ModelImportProps) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gcode, setGcode] = useState<(GcodeInfo & { fileName: string }) | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [stl, setStl] = useState<StlResult | null>(null);
  const [applied, setApplied] = useState(false);
  /** Kullanıcının elle değiştirdiği araç→makara eşleşmeleri. */
  const [spoolOverrides, setSpoolOverrides] = useState<Record<number, string | null>>({});
  const [productName, setProductName] = useState('');
  const [savedName, setSavedName] = useState<string | null>(null);

  const selectedSpool = spools.find((s) => s.id === currentUsages.find((u) => u.spoolId)?.spoolId);
  const [material, setMaterial] = useState<Material>(selectedSpool?.material ?? 'PLA');
  const [infillPct, setInfillPct] = useState(20);
  const [wallThicknessMm, setWallThicknessMm] = useState(1.2);

  const inputRef = useRef<HTMLInputElement>(null);
  const scanHandle = useRef<{ cancel: () => void } | null>(null);

  const breakdown = useMemo(() => (gcode ? buildBreakdown(gcode, scan) : null), [gcode, scan]);

  /**
   * Araç → makara eşleşmesi. Kullanıcı seçim yapmadıysa sırasıyla: aynı
   * sıradaki mevcut satırın makarası, malzeme türü tutan ilk makara,
   * kütüphanedeki ilk makara. Effect yerine türetilir; render sırasında
   * hesaplandığı için ek bir yeniden çizim doğurmaz.
   */
  const assignments = useMemo(() => {
    if (!breakdown) return [];
    return breakdown.tools.map((tool, position) => {
      const override = spoolOverrides[tool.index];
      if (override !== undefined) return { tool, spoolId: override };
      const existing = currentUsages[position]?.spoolId ?? null;
      const byType = tool.filamentType
        ? (spools.find((s) => s.material.toUpperCase() === tool.filamentType)?.id ?? null)
        : null;
      return { tool, spoolId: existing ?? byType ?? spools[0]?.id ?? null };
    });
  }, [breakdown, spoolOverrides, currentUsages, spools]);

  const estimate = useMemo(() => {
    if (!stl) return null;
    return estimateWeight({
      volumeCm3: stl.stats.volumeCm3,
      surfaceAreaCm2: stl.stats.surfaceAreaCm2,
      wallThicknessMm,
      infillPct,
      density: densityOf(material),
    });
  }, [stl, wallThicknessMm, infillPct, material]);

  const resetState = () => {
    scanHandle.current?.cancel();
    scanHandle.current = null;
    setScan(null);
    setScanning(false);
    setScanProgress(0);
    setSpoolOverrides({});
    setApplied(false);
    setSavedName(null);
  };

  const startDeepScan = useCallback((file: File) => {
    setScanning(true);
    setScanProgress(0);
    const handle = scanGcodeFile(file, setScanProgress);
    scanHandle.current = handle;
    handle.promise
      .then((result) => setScan(result))
      .catch((err: unknown) => {
        setError(
          `Ayrıntılı tarama başarısız: ${
            err instanceof Error ? err.message : 'bilinmeyen hata'
          }. Başlık bilgisiyle devam ediliyor.`,
        );
      })
      .finally(() => {
        setScanning(false);
        scanHandle.current = null;
      });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      resetState();
      setBusy(true);
      const name = file.name.toLowerCase();

      try {
        if (name.endsWith('.stl')) {
          if (file.size > MAX_STL_BYTES) throw new Error('STL dosyası 120 MB sınırını aşıyor.');
          const buffer = await file.arrayBuffer();
          const mesh = parseStl(buffer);
          setStl({ fileName: file.name, stats: computeStats(mesh), positions: mesh.positions });
          setGcode(null);
          onGcodeFile?.(null);
        } else if (/\.(gcode|gco|g|nc|bgcode)$/.test(name)) {
          const text = await readGcodeEdges(file);
          const info = parseGcode(text);
          setGcode({ ...info, fileName: file.name });
          setStl(null);
          onGcodeFile?.(file);
          // Çoklu malzemede atık ayrımı yalnızca gövde taramasıyla bulunur.
          if (info.isMultiMaterial) startDeepScan(file);
        } else {
          throw new Error('Yalnızca .gcode ve .stl dosyaları desteklenir.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dosya okunamadı.');
        setGcode(null);
        setStl(null);
        onGcodeFile?.(null);
      } finally {
        setBusy(false);
      }
    },
    [startDeepScan, onGcodeFile],
  );

  // Genel sürükle-bırak katmanından gelen dosya burada işlenir.
  useEffect(() => {
    if (!incomingFile) return;
    // Bir sonraki dongude islenir: efekt govdesinde dogrudan durum
    // guncellemek zincirleme render'a yol acar.
    const timer = setTimeout(() => {
      void handleFile(incomingFile);
      onIncomingHandled?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [incomingFile, handleFile, onIncomingHandled]);

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const applyGcode = () => {
    if (!gcode) return;
    const patch: ImportPatch = {};
    if (gcode.printSeconds !== null) {
      const { hours, minutes } = splitDuration(gcode.printSeconds);
      patch.printHours = hours;
      patch.printMinutes = minutes;
    }

    if (assignments.length > 0) {
      patch.usages = assignments.map(({ tool, spoolId }) => ({
        id: uid('use'),
        spoolId,
        grams: Number(tool.modelGrams.toFixed(2)),
        wasteGrams: Number(tool.wasteGrams.toFixed(2)),
        toolIndex: tool.index,
        colorHex: tool.colorHex,
      }));
    } else if (gcode.grams !== null) {
      patch.grams = Number(gcode.grams.toFixed(1));
    }

    onApply(patch);
    setApplied(true);
  };

  const applyStl = () => {
    if (!estimate) return;
    onApply({ grams: Number(estimate.grams.toFixed(1)) });
    setApplied(true);
  };

  const clear = () => {
    resetState();
    setGcode(null);
    setStl(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  /** Mevcut hesaplamadan katalog ürünü üretir. */
  const buildProduct = (): Omit<CatalogProduct, 'id' | 'createdAt'> | null => {
    const name = productName.trim();
    if (!name) return null;

    if (gcode && breakdown && breakdown.tools.length > 0) {
      return {
        name,
        notes: '',
        source: 'gcode',
        sourceFile: gcode.fileName,
        printSeconds: gcode.printSeconds ?? currentPrintSeconds,
        tools: breakdown.tools.map<CatalogTool>((tool) => ({
          toolIndex: tool.index,
          colorHex: tool.colorHex,
          filamentType: tool.filamentType,
          modelGrams: Number(tool.modelGrams.toFixed(2)),
          wasteGrams: Number(tool.wasteGrams.toFixed(2)),
        })),
      };
    }

    if (stl && estimate) {
      return {
        name,
        notes: `${formatNumber(stl.stats.volumeCm3, 2)} cm³ · %${infillPct} dolgu`,
        source: 'stl',
        sourceFile: stl.fileName,
        printSeconds: currentPrintSeconds,
        tools: [
          {
            toolIndex: 0,
            colorHex: FALLBACK_COLORS[0],
            filamentType: material,
            modelGrams: Number(estimate.grams.toFixed(2)),
            wasteGrams: 0,
          },
        ],
      };
    }
    return null;
  };

  const saveProduct = () => {
    const product = buildProduct();
    if (!product) return;
    onSaveProduct(product);
    setSavedName(product.name);
    setProductName('');
  };

  const canSave = Boolean((gcode?.ok && breakdown?.tools.length) || (stl && estimate));

  const toolCost = (tool: ToolBreakdown, spoolId: string | null) => {
    const spool = spools.find((s) => s.id === spoolId);
    if (!spool) return null;
    const perGram = pricePerGram(spool);
    return { model: perGram * tool.modelGrams, waste: perGram * tool.wasteGrams };
  };

  const isMulti = (breakdown?.tools.length ?? 0) > 1;

  return (
    <Section
      title="Dosyadan İçe Aktar"
      icon={UPLOAD_ICON}
      description="G-code'dan süre, gramaj, renk ve atık analizi; STL'den hacim ve tahmini ağırlık."
      action={
        (gcode || stl) && (
          <button type="button" className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={clear}>
            Temizle
          </button>
        )
      }
    >
      <div className="space-y-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition',
            dragging
              ? 'border-accent-500 bg-accent-500/10'
              : 'border-slate-300 hover:border-accent-500/60 hover:bg-slate-50 dark:border-white/10 dark:hover:border-accent-500/60 dark:hover:bg-white/[0.04]',
          )}
        >
          {busy ? (
            <Spinner className="size-6 text-accent-500" />
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="size-7 text-slate-400 dark:text-slate-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15V3m0 0L8 7m4-4l4 4" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 15v3a3 3 0 003 3h10a3 3 0 003-3v-3"
              />
            </svg>
          )}
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {busy ? 'Dosya okunuyor…' : 'Dosyayı buraya sürükleyin'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            veya tıklayıp seçin · .gcode, .gco, .stl
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.gco,.g,.nc,.bgcode,.stl"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>

        {error && <Banner tone="error">{error}</Banner>}

        {/* --- G-code sonucu --- */}
        {gcode && (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {gcode.fileName}
                </p>
                <div className="flex shrink-0 gap-1.5">
                  {gcode.slicer && (
                    <span className="chip bg-accent-500/15 text-accent-600 dark:text-accent-400">
                      {gcode.slicer}
                    </span>
                  )}
                  {isMulti && (
                    <span className="chip bg-violet-500/15 text-violet-600 dark:text-violet-300">
                      {breakdown?.tools.length} renk · AMS/MMU
                    </span>
                  )}
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  {
                    label: 'Baskı süresi',
                    value:
                      gcode.printSeconds !== null
                        ? formatDuration(gcode.printSeconds / 3600)
                        : 'yok',
                  },
                  {
                    label: 'Model',
                    value: breakdown
                      ? `${formatNumber(breakdown.modelGrams, 1)} g`
                      : gcode.grams !== null
                        ? `${formatNumber(gcode.grams, 1)} g`
                        : 'yok',
                  },
                  {
                    label: 'Atık',
                    value: breakdown ? `${formatNumber(breakdown.wasteGrams, 1)} g` : '—',
                  },
                  {
                    label: 'Katman',
                    value:
                      gcode.layerHeightMm !== null
                        ? `${gcode.layerHeightMm} mm`
                        : (gcode.filamentType ?? 'yok'),
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg bg-white px-2 py-1.5 text-center dark:bg-white/[0.05]"
                  >
                    <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                      {item.label}
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {scanning && (
              <div className="rounded-xl border border-accent-500/30 bg-accent-500/[0.06] p-3">
                <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-accent-600 dark:text-accent-400">
                  <span className="flex items-center gap-2">
                    <Spinner className="size-3.5" />
                    Atık analizi için dosya taranıyor…
                  </span>
                  <span className="tabular-nums">%{Math.round(scanProgress * 100)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/60 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent-500 transition-[width] duration-200"
                    style={{ width: `${Math.max(scanProgress * 100, 2)}%` }}
                  />
                </div>
              </div>
            )}

            {/* --- Araç (renk) satırları --- */}
            {breakdown && breakdown.tools.length > 0 && (
              <div className="space-y-2">
                <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                  {isMulti ? 'Renk başına filament ataması' : 'Filament ataması'}
                </p>
                {assignments.map(({ tool, spoolId }) => {
                  const cost = toolCost(tool, spoolId);
                  return (
                    <div
                      key={tool.index}
                      className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="size-6 shrink-0 rounded-md border border-black/10 shadow-inner dark:border-white/20"
                          style={{ background: tool.colorHex }}
                          title={tool.colorHex}
                          aria-label={`Araç ${tool.index} rengi ${tool.colorHex}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                            Renk {tool.index}
                            {tool.filamentType && (
                              <span className="font-normal text-slate-500 dark:text-slate-400">
                                {' '}
                                · {tool.filamentType}
                              </span>
                            )}
                            <span className="font-mono text-[10px] font-normal text-slate-400">
                              {' '}
                              {tool.colorHex}
                            </span>
                          </p>
                          <p className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                            model {formatNumber(tool.modelGrams, 1)} g
                            {tool.wasteGrams > 0 && (
                              <span className="text-rose-500 dark:text-rose-400">
                                {' '}
                                + atık {formatNumber(tool.wasteGrams, 1)} g
                              </span>
                            )}
                            {cost && (
                              <span className="text-slate-400">
                                {' '}
                                = {formatTRY(cost.model + cost.waste)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <select
                        aria-label={`Renk ${tool.index} filamenti`}
                        className="field-input mt-2 !py-1.5 !text-[12px]"
                        value={spoolId ?? ''}
                        onChange={(event) =>
                          setSpoolOverrides((prev) => ({
                            ...prev,
                            [tool.index]: event.target.value || null,
                          }))
                        }
                      >
                        <option value="">Filament seçin…</option>
                        {spools.map((spool) => (
                          <option key={spool.id} value={spool.id}>
                            {formatSpoolLabel(spool)}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

            {(gcode.warnings.length > 0 || (breakdown?.warnings.length ?? 0) > 0) && (
              <Banner tone={gcode.ok ? 'warning' : 'error'}>
                <ul className="list-inside list-disc space-y-0.5">
                  {[...gcode.warnings, ...(breakdown?.warnings ?? [])].map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </Banner>
            )}

            {gcode.ok && (
              <button
                type="button"
                className="btn-primary w-full !py-2 !text-xs"
                onClick={applyGcode}
                disabled={scanning}
              >
                {applied
                  ? 'Hesaplayıcıya uygulandı ✓'
                  : isMulti
                    ? 'Süre ve renk dağılımını hesaplayıcıya uygula'
                    : 'Süre ve gramajı hesaplayıcıya uygula'}
              </button>
            )}
          </div>
        )}

        {/* --- STL sonucu --- */}
        {stl && (
          <div className="space-y-3">
            <Suspense
              fallback={
                <div className="flex h-56 items-center justify-center rounded-xl border border-slate-200 dark:border-white/10">
                  <Spinner className="size-5 text-accent-500" />
                </div>
              }
            >
              <StlViewer positions={stl.positions} dark={dark} />
            </Suspense>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {stl.fileName}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Hacim', value: `${formatNumber(stl.stats.volumeCm3, 2)} cm³` },
                  { label: 'Yüzey', value: `${formatNumber(stl.stats.surfaceAreaCm2, 1)} cm²` },
                  {
                    label: 'Boyut',
                    value: `${formatNumber(stl.stats.size.x, 0)}×${formatNumber(
                      stl.stats.size.y,
                      0,
                    )}×${formatNumber(stl.stats.size.z, 0)}`,
                  },
                  { label: 'Üçgen', value: formatNumber(stl.stats.triangleCount, 0) },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg bg-white px-2 py-1.5 text-center dark:bg-white/[0.05]"
                  >
                    <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                      {item.label}
                    </dt>
                    <dd className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="space-y-4 rounded-xl border border-dashed border-slate-300 p-3.5 dark:border-white/10">
              <Slider
                label="İç dolgu oranı"
                value={infillPct}
                onChange={setInfillPct}
                min={0}
                max={100}
                step={5}
                format={(value) => `%${value}`}
              />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Malzeme"
                  value={material}
                  options={MATERIALS}
                  onChange={setMaterial}
                  hint={`Özkütle ${DENSITIES[material]} g/cm³`}
                />
                <NumberField
                  label="Kabuk kalınlığı"
                  value={wallThicknessMm}
                  onChange={setWallThicknessMm}
                  suffix="mm"
                  step={0.2}
                  hint="Duvar + üst/alt katmanlar."
                />
              </div>

              {estimate && (
                <div className="rounded-lg bg-accent-500/[0.08] p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">
                      Tahmini gramaj
                    </span>
                    <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                      {formatNumber(estimate.grams, 1)} g
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Kabuk {formatNumber(estimate.shellCm3, 2)} cm³ + dolgu{' '}
                    {formatNumber(estimate.infillCm3, 2)} cm³ ={' '}
                    {formatNumber(estimate.materialCm3, 2)} cm³ × {DENSITIES[material]} g/cm³.
                    Tamamı dolu basılsaydı {formatNumber(estimate.solidGrams, 1)} g olurdu.
                  </p>
                </div>
              )}

              <button
                type="button"
                className="btn-primary w-full !py-2 !text-xs"
                onClick={applyStl}
              >
                {applied ? 'Hesaplayıcıya uygulandı ✓' : 'Gramajı hesaplayıcıya uygula'}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                Bu bir tahmindir; destek, kenar (brim) ve değişken dolgu deseni hesaba katılmaz.
                Kesin sonuç için dilimleyiciden aldığınız .gcode dosyasını yükleyin.
              </p>
            </div>
          </div>
        )}
        {canSave && (
          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/[0.06] p-3.5">
            <p className="mb-2.5 text-[12px] font-semibold text-emerald-600 dark:text-emerald-400">
              Hazır ürün olarak kaydet
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <TextField
                  label="Ürün adı"
                  value={productName}
                  onChange={setProductName}
                  placeholder="örn. Hareketli Ejderha"
                />
              </div>
              <button
                type="button"
                className="btn-primary !py-2.5 !text-xs"
                onClick={saveProduct}
                disabled={!productName.trim()}
              >
                Katalog'a kaydet
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {savedName
                ? `"${savedName}" katalog'a eklendi. Siparişlerde seçip güncel fiyatlarla yeniden hesaplayabilirsiniz.`
                : stl
                  ? 'STL kaydında baskı süresi bilinmediği için hesaplayıcıdaki süre kullanılır.'
                  : 'Malzeme ve süre saklanır; fiyat her kullanımda güncel envanterle yeniden hesaplanır.'}
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
