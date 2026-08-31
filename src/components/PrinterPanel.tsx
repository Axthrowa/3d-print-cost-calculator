import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchPrinterSpecs, ApiError } from '../lib/api';
import { GENERIC_PROFILES, searchPrinters, type CatalogPrinter } from '../lib/printerCatalog';
import { suggestDepreciation } from '../lib/costEngine';
import { formatDuration, formatNumber, formatPercent, formatTRY } from '../lib/format';
import { lifetimeUsed } from '../lib/tracking';
import {
  MAINTENANCE_CHECKLIST,
  maintenanceStatus,
  type MaintenanceSettings,
} from '../lib/workshop';
import { cx } from '../lib/cx';
import type { PrinterProfile } from '../types';
import { Banner, NumberField, Section, Spinner, TextField, Toggle } from './ui';

interface PrinterPanelProps {
  printer: PrinterProfile | null;
  onPrinterChange: (printer: PrinterProfile | null) => void;
  watts: number;
  onWattsChange: (watts: number) => void;
  depreciationPerHour: number;
  onDepreciationChange: (value: number) => void;
  /** Bu yazıcının biriken toplam çalışma saati. */
  runHours: number;
  /** Bakım aralığı ve son bakım sayaçları. */
  maintenance: MaintenanceSettings;
  /** Bakım yapıldı: sayaç sıfırlanır. */
  onMaintenanceDone: () => void;
  onMaintenanceInterval: (hours: number) => void;
  /** Kullanicinin elle ekledigi yazicilar. */
  customPrinters: CatalogPrinter[];
  onCustomPrintersChange: (list: CatalogPrinter[]) => void;
}

function toProfile(match: CatalogPrinter): PrinterProfile {
  return {
    id: `${match.brand}-${match.model}`.toLowerCase().replace(/\s+/g, '-'),
    brand: match.brand,
    model: match.model,
    avgPowerW: match.avgPowerW,
    maxPowerW: match.maxPowerW,
    idlePowerW: match.idlePowerW,
    technology: match.technology,
    buildVolume: match.buildVolume,
    heatedBed: match.heatedBed,
    enclosure: match.enclosure,
    lifetimeHours: match.lifetimeHours,
    source: 'catalog',
  };
}

const PRINTER_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h12v5M6 18v2h12v-2" />
    <rect x="3" y="9" width="18" height="9" rx="2" />
    <path strokeLinecap="round" d="M7 13h4" />
  </svg>
);

export function PrinterPanel({
  printer,
  onPrinterChange,
  watts,
  onWattsChange,
  depreciationPerHour,
  onDepreciationChange,
  runHours,
  maintenance,
  onMaintenanceDone,
  onMaintenanceInterval,
  customPrinters,
  onCustomPrintersChange,
}: PrinterPanelProps) {
  const [query, setQuery] = useState(printer ? `${printer.brand} ${printer.model}` : '');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [devicePrice, setDevicePrice] = useState(0);
  const [lifetimeHours, setLifetimeHours] = useState(printer?.lifetimeHours ?? 4000);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Bulunamayan yazici icin elle giris formu. */
  const [draft, setDraft] = useState<CatalogPrinter | null>(null);

  const suggestions = useMemo(() => searchPrinters(query, 6), [query]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const applyProfile = (profile: PrinterProfile) => {
    onPrinterChange(profile);
    onWattsChange(profile.avgPowerW);
    if (profile.lifetimeHours) setLifetimeHours(profile.lifetimeHours);
    setQuery(`${profile.brand} ${profile.model}`);
    setOpen(false);
  };

  const selectCatalog = (match: CatalogPrinter) => {
    applyProfile(toProfile(match));
    setMessage({
      tone: 'info',
      text: `${match.brand} ${match.model} katalogdan yüklendi. Ortalama tüketim ${match.avgPowerW} W olarak ayarlandı.`,
    });
  };

  const lookupOnline = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setMessage({ tone: 'warning', text: 'Önce yazıcının marka ve modelini yazın.' });
      return;
    }
    // Katalogda guclu bir eslesme varsa internete cikmaya gerek yok.
    const best = suggestions[0];
    if (best && best.score >= 0.8) {
      selectCatalog(best.printer);
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const result = await fetchPrinterSpecs(trimmed);
      if (result.ok && (result.powerW || result.peakW)) {
        applyProfile({
          id: trimmed.toLowerCase().replace(/\s+/g, '-'),
          brand: result.brand ?? trimmed.split(' ')[0],
          model: result.model ?? trimmed,
          // Katalogdan geldiyse gercek ortalama vardir; internetten
          // geldiyse etiket degerinin ~%45'i makul bir baski ortalamasidir.
          avgPowerW: Math.round(result.powerW ?? (result.peakW ?? 0) * 0.45),
          maxPowerW: Math.round(result.peakW ?? result.powerW ?? 0),
          idlePowerW: 10,
          technology: 'FDM',
          buildVolume: result.buildVolume ?? undefined,
          source: 'online',
          sourceUrl: result.sourceUrl ?? undefined,
        });
        setMessage({
          tone: 'warning',
          text: result.powerW
            ? `${result.brand ?? ''} ${result.model} katalogdan yüklendi. Ortalama tüketim ${formatNumber(result.powerW)} W.`
            : `İnternetten ${formatNumber(result.peakW ?? 0)} W etiket değeri bulundu. Baskıdaki ortalama tüketim genelde bunun yarısı kadardır; aşağıdaki değeri kontrol edin.`,
        });
      } else {
        // Bulunamadi: kullanici kendi degerlerini girip kalici olarak
        // kaydedebilsin. Statik katalog yeni modellere hicbir zaman
        // yetisemez; tek saglam cozum budur.
        const words = trimmed.split(/\s+/);
        setDraft({
          brand: words[0] ?? trimmed,
          model: words.slice(1).join(' ') || trimmed,
          avgPowerW: 120,
          maxPowerW: 350,
          idlePowerW: 10,
          technology: 'FDM',
          buildVolume: '220x220x250 mm',
          heatedBed: true,
          enclosure: false,
          lifetimeHours: 3500,
        });
        setMessage({
          tone: 'warning',
          text:
            result.warnings[0] ??
            'Bu model katalogda yok. Bilgileri aşağıya girip kaydedin; bundan sonra aramada çıkacak.',
        });
      }
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof ApiError ? error.message : 'Beklenmeyen bir hata oluştu.',
      });
    } finally {
      setLoading(false);
    }
  };

  const suggestedDepreciation = suggestDepreciation(devicePrice, lifetimeHours);

  return (
    <Section
      title="Yazıcı Profili"
      icon={PRINTER_ICON}
      description="Marka ve modeli yazin; güç tüketimi ve teknik bilgiler otomatik gelsin."
    >
      <div className="space-y-4">
        <div ref={boxRef} className="relative">
          <label className="field-label" htmlFor="printer-search">
            Marka / Model
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="printer-search"
                className="field-input pr-9"
                placeholder="orn. Bambu Lab P1S, Ender 3 V2, Creality K1 Max"
                value={query}
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                  setMessage(null);
                }}
                onFocus={() => setOpen(true)}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                </svg>
              </span>
            </div>
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={lookupOnline}
              disabled={loading}
              title="Katalogda yoksa internetten teknik bilgi ara"
            >
              {loading ? <Spinner /> : 'Bul'}
            </button>
          </div>

          {/* Hicbir oneri yoksa kullaniciyi elle eklemeye yonlendir. */}
          {open && suggestions.length === 0 && query.trim().length >= 3 && !draft && (
            <div className="panel absolute z-30 mt-2 w-full p-3 shadow-xl dark:bg-ink-850">
              <p className="text-[12px] text-slate-600 dark:text-slate-300">
                "{query.trim()}" katalogda yok.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    setOpen(false);
                    void lookupOnline();
                  }}
                >
                  İnternetten ara
                </button>
                <button
                  type="button"
                  className="btn-primary !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    const words = query.trim().split(/\s+/);
                    setOpen(false);
                    setDraft({
                      brand: words[0] ?? query.trim(),
                      model: words.slice(1).join(' ') || query.trim(),
                      avgPowerW: 120,
                      maxPowerW: 350,
                      idlePowerW: 10,
                      technology: 'FDM',
                      buildVolume: '220x220x250 mm',
                      heatedBed: true,
                      enclosure: false,
                      lifetimeHours: 3500,
                    });
                  }}
                >
                  Kendim ekleyeyim
                </button>
              </div>
            </div>
          )}

          {open && suggestions.length > 0 && (
            <ul className="panel absolute z-30 mt-2 max-h-72 w-full overflow-y-auto p-1.5 shadow-xl dark:bg-ink-850">
              {suggestions.map(({ printer: item, score }) => (
                <li key={`${item.brand}-${item.model}`}>
                  <button
                    type="button"
                    onClick={() => selectCatalog(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.07]"
                  >
                    <span>
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                        {item.brand} {item.model}
                      </span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        {item.technology} · {item.buildVolume} · ort. {item.avgPowerW} W
                      </span>
                    </span>
                    <span
                      className={cx(
                        'chip shrink-0',
                        score >= 0.8
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
                      )}
                    >
                      %{Math.round(score * 100)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message && <Banner tone={message.tone}>{message.text}</Banner>}

        {printer && (
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {printer.brand} {printer.model}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {printer.source === 'catalog'
                    ? 'Yerleşik katalog verisi'
                    : printer.source === 'online'
                      ? 'İnternetten alındı'
                      : 'Manuel giriş'}
                  {printer.buildVolume ? ` · ${printer.buildVolume}` : ''}
                </p>
                <p className="mt-1 flex flex-wrap gap-1">
                  <span className="chip bg-slate-500/15 text-slate-500 dark:text-slate-400">
                    {printer.technology}
                  </span>
                  {printer.heatedBed && (
                    <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      Isıtmalı tabla
                    </span>
                  )}
                  {printer.enclosure && (
                    <span className="chip bg-violet-500/15 text-violet-600 dark:text-violet-400">
                      Kapalı kabin
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onPrinterChange(null);
                  setQuery('');
                  setMessage(null);
                }}
                className="text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-rose-500 hover:underline"
              >
                temizle
              </button>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Ortalama', value: `${printer.avgPowerW} W` },
                { label: 'Pik', value: `${printer.maxPowerW} W` },
                { label: 'Bekleme', value: `${printer.idlePowerW} W` },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg bg-white px-2 py-1.5 dark:bg-white/[0.05]"
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
            {printer.avgPowerW !== watts && (
              <button
                type="button"
                onClick={() => onWattsChange(printer.avgPowerW)}
                className="mt-2.5 w-full rounded-lg border border-accent-500/30 bg-accent-500/10 px-2 py-1.5 text-[11px] font-semibold text-accent-600 transition hover:bg-accent-500/20 dark:text-accent-400"
              >
                Hesaplamada {printer.avgPowerW} W kullan
              </button>
            )}
          </div>
        )}

        {!printer && (
          <div>
            <p className="field-label">Modeliniz listede yok mu? Hazır profil seçin</p>
            <div className="flex flex-wrap gap-2">
              {GENERIC_PROFILES.map((profile) => (
                <button
                  key={profile.label}
                  type="button"
                  onClick={() => {
                    onWattsChange(profile.avgPowerW);
                    setMessage({
                      tone: 'info',
                      text: `"${profile.label}" profili uygulandı: ${profile.avgPowerW} W.`,
                    });
                  }}
                  className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-accent-500 hover:text-accent-600 dark:border-white/10 dark:text-slate-300 dark:hover:border-accent-500 dark:hover:text-accent-400"
                >
                  {profile.label} · {profile.avgPowerW} W
                </button>
              ))}
            </div>
          </div>
        )}

        <NumberField
          label="Hesaplamada kullanılacak güç"
          value={watts}
          onChange={onWattsChange}
          suffix="W"
          min={0}
          max={5000}
          step={5}
          hint="Baskı boyunca gözlenen ortalama çekiş. Etiket (pik) değeri değil."
        />

        <div className="rounded-xl border border-dashed border-slate-300 p-3.5 dark:border-white/10">
          <p className="mb-3 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
            Amortisman hesaplayıcı
          </p>

          {/* Bakim takibi: son bakimdan bu yana gecen sure. */}
          {(() => {
            const name = printer ? `${printer.brand} ${printer.model}` : '';
            if (!name) return null;
            const status = maintenanceStatus(name, runHours, maintenance);
            return (
              <div
                className={cx(
                  'mb-3 rounded-lg p-2.5',
                  status.due
                    ? 'bg-rose-500/10 ring-1 ring-rose-400/30'
                    : 'bg-slate-100/70 dark:bg-white/[0.05]',
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span
                    className={cx(
                      status.due
                        ? 'font-semibold text-rose-600 dark:text-rose-300'
                        : 'text-slate-500 dark:text-slate-400',
                    )}
                  >
                    {status.due ? 'Bakim zamani geldi' : 'Bakima kalan'}
                  </span>
                  <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                    {status.due
                      ? `${formatDuration(-status.remainingHours)} gecikti`
                      : formatDuration(status.remainingHours)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                  <div
                    className={cx(
                      'h-full rounded-full transition-[width] duration-300',
                      status.due ? 'bg-rose-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.max(status.ratio * 100, 1)}%` }}
                  />
                </div>

                {status.due && (
                  <ul className="mt-2 list-inside list-disc text-[10px] text-rose-600/90 dark:text-rose-300/90">
                    {MAINTENANCE_CHECKLIST.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                    onClick={onMaintenanceDone}
                  >
                    Bakim yapildi
                  </button>
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                    her
                    <input
                      type="number"
                      aria-label="Bakim araligi"
                      min={1}
                      step={10}
                      className="field-input w-20 !py-1 !text-[11px]"
                      value={maintenance.intervalHours || ''}
                      onChange={(event) => onMaintenanceInterval(Number(event.target.value) || 0)}
                    />
                    saatte bir
                  </label>
                </div>
              </div>
            );
          })()}

          {/* Tamamlanan baskılardan biriken gerçek çalışma süresi. */}
          <div className="mb-3 rounded-lg bg-slate-100/70 p-2.5 dark:bg-white/[0.05]">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">Toplam çalışma süresi</span>
              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {formatDuration(runHours)}
              </span>
            </div>
            {(() => {
              const used = lifetimeUsed(runHours, lifetimeHours);
              if (used === null) return null;
              return (
                <>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
                      style={{ width: `${Math.max(used * 100, 1)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    Beklenen ömrün {formatPercent(used * 100)}
                    'i · kalan {formatDuration(Math.max(0, lifetimeHours - runHours))}
                  </p>
                </>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Cihaz bedeli"
              value={devicePrice}
              onChange={setDevicePrice}
              suffix="TL"
              step={500}
            />
            <NumberField
              label="Beklenen ömür"
              value={lifetimeHours}
              onChange={setLifetimeHours}
              suffix="sa"
              step={500}
            />
          </div>
          {suggestedDepreciation > 0 && (
            <button
              type="button"
              onClick={() => onDepreciationChange(Number(suggestedDepreciation.toFixed(2)))}
              className="mt-3 w-full rounded-lg border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-xs font-semibold text-accent-600 transition hover:bg-accent-500/20 dark:text-accent-400"
            >
              Önerilen: {formatTRY(suggestedDepreciation)} / saat — uygula
              {depreciationPerHour > 0 && ` (şu an ${formatTRY(depreciationPerHour)})`}
            </button>
          )}
        </div>
      </div>

      {draft && (
        <div className="mt-3 space-y-3 rounded-xl border border-accent-500/30 bg-accent-500/[0.04] p-3.5">
          <div>
            <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              Yazıcıyı kendim ekleyeyim
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Bir kez girin; bundan sonra aramada çıkar. Değerleri yazıcının kullanım kılavuzundan
              veya etiketinden alabilirsiniz.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Marka"
              value={draft.brand}
              onChange={(brand) => setDraft({ ...draft, brand })}
              placeholder="Snapmaker"
            />
            <TextField
              label="Model"
              value={draft.model}
              onChange={(model) => setDraft({ ...draft, model })}
              placeholder="U1"
            />
            <NumberField
              label="Ortalama güç"
              value={draft.avgPowerW}
              onChange={(avgPowerW) => setDraft({ ...draft, avgPowerW })}
              suffix="W"
              hint="Baskı sırasındaki tüketim. Hesaplamada bu kullanılır."
            />
            <NumberField
              label="Pik güç"
              value={draft.maxPowerW}
              onChange={(maxPowerW) => setDraft({ ...draft, maxPowerW })}
              suffix="W"
              hint="Güç kaynağı etiketindeki değer."
            />
            <NumberField
              label="Bekleme"
              value={draft.idlePowerW}
              onChange={(idlePowerW) => setDraft({ ...draft, idlePowerW })}
              suffix="W"
            />
            <TextField
              label="Baskı hacmi"
              value={draft.buildVolume}
              onChange={(buildVolume) => setDraft({ ...draft, buildVolume })}
              placeholder="220x220x250 mm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              label="Isıtmalı tabla"
              checked={draft.heatedBed}
              onChange={(heatedBed) => setDraft({ ...draft, heatedBed })}
            />
            <Toggle
              label="Kapalı kabin"
              checked={draft.enclosure}
              onChange={(enclosure) => setDraft({ ...draft, enclosure })}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => setDraft(null)}
            >
              Vazgeç
            </button>
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 !text-xs"
              disabled={!draft.brand.trim() || !draft.model.trim() || draft.avgPowerW <= 0}
              onClick={() => {
                const clean: CatalogPrinter = {
                  ...draft,
                  brand: draft.brand.trim(),
                  model: draft.model.trim(),
                  // Ortalama pikten buyuk olamaz.
                  maxPowerW: Math.max(draft.maxPowerW, draft.avgPowerW),
                  idlePowerW: Math.min(draft.idlePowerW, draft.avgPowerW),
                };
                const key = `${clean.brand}|${clean.model}`.toLowerCase();
                onCustomPrintersChange([
                  ...customPrinters.filter((p) => `${p.brand}|${p.model}`.toLowerCase() !== key),
                  clean,
                ]);
                selectCatalog(clean);
                setDraft(null);
                setMessage({
                  tone: 'success',
                  text: `${clean.brand} ${clean.model} kaydedildi; bundan sonra aramada çıkacak.`,
                });
              }}
            >
              Kaydet ve kullan
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
