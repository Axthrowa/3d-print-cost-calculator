import { pricePerGram } from '../lib/costEngine';
import { formatPerGram, formatSpoolLabel, formatTRY } from '../lib/format';
import { colorToHex } from '../lib/filamentParser';
import { normalizeHex } from '../lib/gcodeParser';
import { uid } from '../lib/storage';
import { cx } from '../lib/cx';
import { useRef } from 'react';
import type { CalculatorInputs, FilamentSpool } from '../types';
import { NumberField, Section, Slider, Toggle } from './ui';

interface ParameterPanelProps {
  inputs: CalculatorInputs;
  onChange: (patch: Partial<CalculatorInputs>) => void;
  spools: FilamentSpool[];
  onOpenLibrary: () => void;
}

const SPOOL_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path strokeLinecap="round" d="M12 4v3M12 17v3M4 12h3M17 12h3" />
  </svg>
);

const CLOCK_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3.5 2" />
  </svg>
);

const BOLT_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
  </svg>
);

const TUNE_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

/** Renk kodunu saydam bir tona çevirir (arka plan için). */
function tint(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ParameterPanel({ inputs, onChange, spools, onOpenLibrary }: ParameterPanelProps) {
  const colorInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const openColorPicker = (usageId: string) => {
    const input = colorInputs.current[usageId];
    if (!input) return;
    try {
      input.showPicker?.();
    } catch {
      input.click();
    }
  };

  const updateUsage = (id: string, patch: Partial<CalculatorInputs['usages'][number]>) => {
    onChange({ usages: inputs.usages.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  };

  const addUsage = () => {
    onChange({
      usages: [...inputs.usages, { id: uid('use'), spoolId: spools[0]?.id ?? null, grams: 0 }],
    });
  };

  const removeUsage = (id: string) => {
    const next = inputs.usages.filter((u) => u.id !== id);
    onChange({ usages: next.length > 0 ? next : [{ id: uid('use'), spoolId: null, grams: 0 }] });
  };

  return (
    <div className="space-y-4">
      <Section
        title="Filament Kullanımı"
        icon={SPOOL_ICON}
        description="Basılacak parçada kullanılan filament(ler) ve gramajı."
        action={
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={onOpenLibrary}
          >
            Envanter
          </button>
        }
      >
        {spools.length === 0 ? (
          <button
            type="button"
            onClick={onOpenLibrary}
            className="w-full rounded-xl border border-dashed border-accent-500/40 bg-accent-500/[0.06] px-4 py-6 text-center transition hover:bg-accent-500/[0.12]"
          >
            <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">
              Önce bir filament ekleyin
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              URL ile otomatik fiyat çekebilir veya manuel girebilirsiniz.
            </p>
          </button>
        ) : (
          <div className="space-y-2.5">
            {inputs.usages.map((usage, index) => {
              const spool = spools.find((s) => s.id === usage.spoolId);
              const lineCost = spool
                ? pricePerGram(spool) * (usage.grams + (usage.wasteGrams ?? 0))
                : 0;
              // Renk kaynağı: g-code'dan gelen hex, yoksa makaranın renk adı.
              const spoolHex = colorToHex(spool?.color);
              const swatch = usage.colorHex ?? spoolHex;
              // Makaranın kendi renginden ayrılmışsa geri dönülebilsin.
              const overridden = Boolean(usage.colorHex && spoolHex && usage.colorHex !== spoolHex);
              return (
                <div
                  key={usage.id}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 transition-colors dark:border-white/10 dark:bg-white/[0.03]"
                  style={
                    swatch
                      ? { background: tint(swatch, 0.14), borderColor: tint(swatch, 0.4) }
                      : undefined
                  }
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => openColorPicker(usage.id)}
                      className="relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg transition hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-white/10"
                      title={
                        swatch
                          ? `${usage.toolIndex !== undefined ? `Renk ${usage.toolIndex} · ` : ''}${swatch}${spool?.color ? ` · ${spool.color}` : ''} — değiştirmek için tıklayın`
                          : 'Satır rengini seçmek için tıklayın'
                      }
                      aria-label={`Filament ${index + 1} rengi`}
                    >
                      <span
                        className={cx(
                          'size-5 rounded-md border shadow-inner',
                          swatch
                            ? 'border-black/20 dark:border-white/25'
                            : 'border-dashed border-slate-400 dark:border-white/30',
                        )}
                        style={swatch ? { background: swatch } : undefined}
                      />
                    </button>
                    <input
                      ref={(node) => {
                        colorInputs.current[usage.id] = node;
                      }}
                      type="color"
                      tabIndex={-1}
                      aria-hidden="true"
                      value={swatch ?? '#9CA3AF'}
                      onChange={(event) =>
                        updateUsage(usage.id, {
                          colorHex: normalizeHex(event.target.value) ?? undefined,
                        })
                      }
                      className="pointer-events-none absolute size-0 opacity-0"
                    />
                    {overridden && (
                      <button
                        type="button"
                        onClick={() => updateUsage(usage.id, { colorHex: undefined })}
                        aria-label="Makaranın rengine dön"
                        title={`Makaranın rengine dön (${spool?.color ?? ''})`}
                        className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-black/[0.07] hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="size-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4 9h9a5 5 0 010 10H8M4 9l3.5-3.5M4 9l3.5 3.5"
                          />
                        </svg>
                      </button>
                    )}
                    <select
                      aria-label={`Filament ${index + 1}`}
                      className="field-input flex-1 !py-2 !text-[13px]"
                      value={usage.spoolId ?? ''}
                      onChange={(event) =>
                        updateUsage(usage.id, { spoolId: event.target.value || null })
                      }
                    >
                      <option value="">Filament seçin…</option>
                      {spools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {formatSpoolLabel(s, `${formatPerGram(pricePerGram(s))}/g`)}
                        </option>
                      ))}
                    </select>
                    <div className="relative w-28 shrink-0">
                      <input
                        type="number"
                        aria-label="Gram"
                        min={0}
                        step={1}
                        className="field-input !py-2 pr-7 !text-[13px]"
                        value={usage.grams || ''}
                        placeholder="0"
                        onChange={(event) =>
                          updateUsage(usage.id, { grams: Number(event.target.value) || 0 })
                        }
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-slate-400">
                        g
                      </span>
                    </div>
                    {inputs.usages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeUsage(usage.id)}
                        aria-label="Satırı sil"
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="size-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path strokeLinecap="round" d="M6 12h12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {spool && (usage.grams > 0 || (usage.wasteGrams ?? 0) > 0) && (
                    <p className="mt-2 text-right text-[11px] text-slate-500 dark:text-slate-400">
                      {usage.grams} g
                      {(usage.wasteGrams ?? 0) > 0 && (
                        <span className="text-rose-500 dark:text-rose-400">
                          {' '}
                          + {usage.wasteGrams} g atık
                        </span>
                      )}{' '}
                      × {formatPerGram(pricePerGram(spool))} ={' '}
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {formatTRY(lineCost)}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={addUsage}
              className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition hover:border-accent-500 hover:text-accent-600 dark:border-white/10 dark:text-slate-400 dark:hover:border-accent-500 dark:hover:text-accent-400"
            >
              + Filament satırı ekle
            </button>
          </div>
        )}
      </Section>

      <Section
        title="Baskı Süresi"
        icon={CLOCK_ICON}
        description="Dilimleyicinin verdiği tahmini süre."
      >
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Saat"
            value={inputs.printHours}
            onChange={(value) => onChange({ printHours: value })}
            suffix="sa"
            max={999}
          />
          <NumberField
            label="Dakika"
            value={inputs.printMinutes}
            onChange={(value) => onChange({ printMinutes: value })}
            suffix="dk"
            max={59}
          />
          <NumberField
            label="Adet"
            value={inputs.quantity}
            onChange={(value) => onChange({ quantity: Math.max(1, Math.round(value)) })}
            suffix="ad"
            min={1}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
          Gramaj ve süre <strong>tek parça</strong> içindir; toplam maliyet adet ile çarpılır.
        </p>
      </Section>

      <Section title="Elektrik" icon={BOLT_ICON} description="Güç tüketimi ve kWh birim fiyatı.">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Güç tüketimi"
            value={inputs.printerWatts}
            onChange={(value) => onChange({ printerWatts: value })}
            suffix="W"
            step={5}
            max={5000}
          />
          <NumberField
            label="Elektrik birim fiyatı"
            value={inputs.kwhPrice}
            onChange={(value) => onChange({ kwhPrice: value })}
            suffix="TL"
            step={0.1}
            hint="kWh başına, dağıtım ve vergiler dahil."
          />
        </div>
      </Section>

      <Section
        title="Gelişmiş Ayarlar"
        icon={TUNE_ICON}
        description="Amortisman, fire riski, işçilik ve kar marjı."
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Amortisman"
              value={inputs.depreciationPerHour}
              onChange={(value) => onChange({ depreciationPerHour: value })}
              suffix="TL/sa"
              step={0.5}
              hint="Yıpranma + bakım payı."
            />
            <NumberField
              label="Ek giderler"
              value={inputs.extraCost}
              onChange={(value) => onChange({ extraCost: value })}
              suffix="TL"
              step={5}
              hint="Yapıştırıcı, zımpara, boya, ambalaj…"
            />
          </div>

          <Slider
            label="Başarısız baskı / fire oranı"
            value={inputs.failureRatePct}
            onChange={(value) => onChange({ failureRatePct: value })}
            min={0}
            max={50}
            step={1}
            format={(value) => `%${value}`}
            hint="Malzeme + enerji + amortisman toplamına risk payı olarak eklenir."
          />

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="İşçilik ücreti"
              value={inputs.laborRatePerHour}
              onChange={(value) => onChange({ laborRatePerHour: value })}
              suffix="TL/sa"
              step={10}
            />
            <NumberField
              label="Harcanan işçilik"
              value={inputs.laborMinutes}
              onChange={(value) => onChange({ laborMinutes: value })}
              suffix="dk"
              step={5}
              hint="Hazırlık, destek temizliği, montaj."
            />
          </div>

          <Slider
            label="Kâr marjı"
            value={inputs.marginPct}
            onChange={(value) => onChange({ marginPct: value })}
            min={0}
            max={300}
            step={5}
            format={(value) => `%${value}`}
            hint="Net maliyet üzerine eklenerek satış fiyatı önerilir."
          />

          <div
            className={cx(
              'rounded-xl border p-3.5 transition',
              inputs.vatEnabled
                ? 'border-accent-500/30 bg-accent-500/[0.06]'
                : 'border-slate-200 dark:border-white/10',
            )}
          >
            <Toggle
              label="KDV ekle"
              checked={inputs.vatEnabled}
              onChange={(checked) => onChange({ vatEnabled: checked })}
              hint="Satış fiyatına KDV dahil edilsin mi?"
            />
            {inputs.vatEnabled && (
              <div className="mt-3">
                <NumberField
                  label="KDV oranı"
                  value={inputs.vatPct}
                  onChange={(value) => onChange({ vatPct: value })}
                  suffix="%"
                  max={100}
                />
              </div>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
