import { useState } from 'react';
import { ApiError, fetchFilamentFromUrl } from '../lib/api';
import { pricePerGram } from '../lib/costEngine';
import { cx } from '../lib/cx';
import {
  formatDateTime,
  formatNumber,
  formatPerGram,
  formatRelative,
  formatTRY,
} from '../lib/format';
import { INTERVAL_OPTIONS, isWatchable, nextRunAt } from '../lib/priceWatcher';
import {
  refill,
  remainingOf,
  remainingRatio,
  setRemaining,
  stockLevel,
  summarizeStock,
} from '../lib/inventory';
import { uid } from '../lib/storage';
import { MATERIALS, type FilamentSpool, type Material, type WatchSettings } from '../types';
import { Banner, NumberField, Section, SelectField, Spinner, TextField, Toggle } from './ui';

interface InventoryPanelProps {
  spools: FilamentSpool[];
  onChange: (spools: FilamentSpool[]) => void;
  watch: WatchSettings;
  onWatchChange: (settings: WatchSettings) => void;
  onRefreshNow: (spoolIds?: string[]) => void;
  refreshing: boolean;
  now: number;
}

interface DraftSpool {
  id: string | null;
  brand: string;
  material: Material;
  color: string;
  rollPrice: number;
  rollWeight: number;
  sourceUrl: string;
}

/** Bulunamayan makara icin guvenli varsayilan. */
const EMPTY_SPOOL: FilamentSpool = {
  id: '',
  brand: '',
  material: 'PLA',
  color: '',
  rollPrice: 0,
  rollWeight: 0,
  updatedAt: '',
};

const EMPTY_DRAFT: DraftSpool = {
  id: null,
  brand: '',
  material: 'PLA',
  color: '',
  rollPrice: 0,
  rollWeight: 1000,
  sourceUrl: '',
};

const SPOOL_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path strokeLinecap="round" d="M12 4v3M12 17v3M4 12h3M17 12h3" />
  </svg>
);

const METHOD_LABELS: Record<string, string> = {
  'json-ld': 'yapısal veri (JSON-LD)',
  'meta-tag': 'meta etiketi',
  microdata: 'microdata',
  'class-heuristic': 'sayfa içi fiyat alanı',
  'text-scan': 'metin taraması',
  none: 'bulunamadı',
};

export function InventoryPanel({
  spools,
  onChange,
  watch,
  onWatchChange,
  onRefreshNow,
  refreshing,
  now,
}: InventoryPanelProps) {
  const [draft, setDraft] = useState<DraftSpool>(EMPTY_DRAFT);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const patch = (partial: Partial<DraftSpool>) => setDraft((prev) => ({ ...prev, ...partial }));

  const handleFetch = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setFeedback({
        tone: 'warning',
        text: 'Lütfen http:// veya https:// ile başlayan bir adres girin.',
      });
      return;
    }
    setLoading(true);
    setFeedback(null);
    try {
      const result = await fetchFilamentFromUrl(trimmed);
      const next: Partial<DraftSpool> = { sourceUrl: trimmed };
      if (result.price !== null) next.rollPrice = Number(result.price.toFixed(2));
      if (result.weightGrams !== null) next.rollWeight = Math.round(result.weightGrams);
      if (result.brand) next.brand = result.brand;
      if (result.color) next.color = result.color;
      if (result.material && (MATERIALS as readonly string[]).includes(result.material)) {
        next.material = result.material as Material;
      }
      patch(next);

      if (result.ok) {
        const currencyNote =
          result.currency && result.currency !== 'TRY'
            ? ` Dikkat: sayfanın para birimi ${result.currency} görünüyor, TL karşılığını kendiniz girin.`
            : '';
        const colorNote = result.color ? ` Renk: ${result.color}.` : '';
        setFeedback({
          tone: result.confidence >= 0.6 ? 'success' : 'warning',
          text: `Fiyat ${METHOD_LABELS[result.method] ?? result.method} üzerinden bulundu (güven %${Math.round(
            result.confidence * 100,
          )}).${colorNote}${currencyNote} ${result.warnings.join(' ')}`.trim(),
        });
      } else {
        setFeedback({
          tone: 'warning',
          text: `${result.warnings.join(' ')} Aşağıdaki alanları elle doldurabilirsiniz.`,
        });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof ApiError
            ? `${error.message}${error.offline ? ' Bu sırada fiyat ve gramajı manuel girebilirsiniz.' : ''}`
            : 'Beklenmeyen bir hata oluştu, lütfen manuel girin.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (!draft.brand.trim()) {
      setFeedback({ tone: 'warning', text: 'Marka alanı zorunludur.' });
      return;
    }
    if (draft.rollPrice <= 0 || draft.rollWeight <= 0) {
      setFeedback({ tone: 'warning', text: 'Rulo fiyatı ve gramajı sıfırdan büyük olmalıdır.' });
      return;
    }
    const existing = draft.id ? spools.find((s) => s.id === draft.id) : undefined;
    const spool: FilamentSpool = {
      ...existing,
      id: draft.id ?? uid('spool'),
      brand: draft.brand.trim(),
      material: draft.material,
      color: draft.color.trim(),
      rollPrice: draft.rollPrice,
      rollWeight: draft.rollWeight,
      sourceUrl: draft.sourceUrl.trim() || undefined,
      updatedAt: new Date(now).toISOString(),
    };
    onChange(draft.id ? spools.map((s) => (s.id === draft.id ? spool : s)) : [...spools, spool]);
    setDraft(EMPTY_DRAFT);
    setUrl('');
    setFeedback({ tone: 'success', text: `${spool.brand} ${spool.material} kaydedildi.` });
  };

  const startEdit = (spool: FilamentSpool) => {
    setDraft({
      id: spool.id,
      brand: spool.brand,
      material: spool.material,
      color: spool.color,
      rollPrice: spool.rollPrice,
      rollWeight: spool.rollWeight,
      sourceUrl: spool.sourceUrl ?? '',
    });
    setUrl(spool.sourceUrl ?? '');
    setFeedback(null);
  };

  const remove = (id: string) => {
    onChange(spools.filter((s) => s.id !== id));
    if (draft.id === id) setDraft(EMPTY_DRAFT);
  };

  const toggleAuto = (spool: FilamentSpool) =>
    onChange(
      spools.map((s) => (s.id === spool.id ? { ...s, autoUpdate: !isWatchable(spool) } : s)),
    );

  const watchableCount = spools.filter(isWatchable).length;
  const nextCheckAt = nextRunAt(spools, watch, now);

  /** Son iki fiyat örneğinden değişim yüzdesi. */
  const priceDelta = (spool: FilamentSpool): number | null => {
    const history = spool.priceHistory ?? [];
    if (history.length < 2) return null;
    const previous = history[history.length - 2].price;
    if (previous <= 0) return null;
    return ((spool.rollPrice - previous) / previous) * 100;
  };

  const stock = summarizeStock(spools);

  return (
    <div className="space-y-4">
      {spools.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              label: 'Kalan filament',
              value: `${formatNumber(stock.totalRemaining / 1000, 2)} kg`,
              sub: `${formatNumber(stock.totalCapacity / 1000, 1)} kg kapasitede`,
            },
            {
              label: 'Stok değeri',
              value: formatTRY(stock.value),
              sub: 'güncel fiyatlarla',
            },
            {
              label: 'Uyarı',
              value: String(stock.low + stock.empty),
              sub:
                stock.empty > 0
                  ? `${stock.empty} makara boş, ${stock.low} az kaldı`
                  : stock.low > 0
                    ? `${stock.low} makarada az kaldı`
                    : 'stok yeterli',
              warn: stock.empty > 0 || stock.low > 0,
            },
          ].map((card) => (
            <div key={card.label} className="panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {card.value}
              </p>
              <p
                className={cx(
                  'mt-0.5 text-[11px]',
                  card.warn
                    ? 'font-semibold text-amber-600 dark:text-amber-400'
                    : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {card.sub}
              </p>
            </div>
          ))}
        </div>
      )}

      <Section
        title="Filament Envanteri"
        icon={SPOOL_ICON}
        description="Makaralarınızı ekleyin; fiyatlar ürün adresinden otomatik çekilebilir ve düzenli olarak güncellenebilir."
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* --- Ekleme / düzenleme formu --- */}
          <div className="space-y-4">
            <div className="rounded-xl border border-accent-500/25 bg-accent-500/[0.06] p-4">
              <p className="mb-2.5 text-[12px] font-semibold text-accent-600 dark:text-accent-400">
                URL ile otomatik doldur
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  className="field-input flex-1"
                  placeholder="https://… ürün sayfası adresi"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleFetch();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0"
                  onClick={handleFetch}
                  disabled={loading}
                >
                  {loading ? <Spinner /> : 'Çek'}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Fiyat, gramaj, marka, malzeme türü ve renk sayfadan otomatik okunur. Site engel
                koyarsa veya sayfa yapısı değiştiyse alanları aşağıdan elle doldurun.
              </p>
            </div>

            {feedback && <Banner tone={feedback.tone}>{feedback.text}</Banner>}

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Marka"
                value={draft.brand}
                onChange={(value) => patch({ brand: value })}
                placeholder="örn. Porima"
              />
              <SelectField
                label="Tür"
                value={draft.material}
                options={MATERIALS}
                onChange={(value) => patch({ material: value })}
              />
              <TextField
                label="Renk"
                value={draft.color}
                onChange={(value) => patch({ color: value })}
                placeholder="örn. Siyah"
              />
              <NumberField
                label="Rulo fiyatı"
                value={draft.rollPrice}
                onChange={(value) => patch({ rollPrice: value })}
                suffix="TL"
                step={10}
              />
              <NumberField
                label="Rulo ağırlığı"
                value={draft.rollWeight}
                onChange={(value) => patch({ rollWeight: value })}
                suffix="g"
                step={50}
              />
              {draft.id && (
                <NumberField
                  label="Kalan"
                  value={remainingOf(spools.find((sp) => sp.id === draft.id) ?? EMPTY_SPOOL)}
                  onChange={(value) => onChange(setRemaining(spools, draft.id as string, value))}
                  suffix="g"
                  step={10}
                  hint="Elle sayım sonrası düzeltmek için."
                />
              )}
              <div className="flex items-end">
                <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center dark:border-white/10 dark:bg-white/[0.04]">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">Gram fiyatı</p>
                  <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                    {formatPerGram(pricePerGram(draft))}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1" onClick={handleSave}>
                {draft.id ? 'Değişiklikleri kaydet' : 'Envantere ekle'}
              </button>
              {draft.id && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setDraft(EMPTY_DRAFT);
                    setUrl('');
                  }}
                >
                  Vazgeç
                </button>
              )}
            </div>

            {/* --- Otomatik fiyat takibi --- */}
            <div
              className={cx(
                'rounded-xl border p-4 transition',
                watch.enabled
                  ? 'border-emerald-400/40 bg-emerald-500/[0.06]'
                  : 'border-slate-200 dark:border-white/10',
              )}
            >
              <Toggle
                label="Otomatik fiyat takibi"
                checked={watch.enabled}
                onChange={(enabled) => onWatchChange({ ...watch, enabled })}
                hint={`Kayıtlı adreslerden fiyatlar düzenli olarak yeniden okunur (${watchableCount} filament).`}
              />

              {watch.enabled && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="field-label" htmlFor="watch-interval">
                      Kontrol sıklığı
                    </label>
                    <select
                      id="watch-interval"
                      className="field-input"
                      value={watch.intervalHours}
                      onChange={(event) =>
                        onWatchChange({ ...watch, intervalHours: Number(event.target.value) })
                      }
                    >
                      {INTERVAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Son kontrol: {formatRelative(watch.lastRunAt, now)}
                    {nextCheckAt !== null && nextCheckAt > now
                      ? ` · sıradaki: ${formatDateTime(nextCheckAt)}`
                      : ' · sıradaki kontrol bekliyor'}
                    . Uygulama açıkken arka planda çalışır; kapalıyken bir sonraki açılışta
                    güncellenir.
                  </p>
                </div>
              )}

              <button
                type="button"
                className="btn-ghost mt-3 w-full !py-2 !text-xs"
                onClick={() => onRefreshNow()}
                disabled={refreshing || watchableCount === 0}
              >
                {refreshing ? <Spinner /> : `Tüm fiyatları şimdi güncelle (${watchableCount})`}
              </button>
            </div>
          </div>

          {/* --- Kayıtlı filamentler --- */}
          <div>
            <p className="mb-3 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
              Kayıtlı filamentler ({spools.length})
            </p>
            {spools.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-white/10">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Henüz filament eklenmedi.
                </p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Bir ürün adresi yapıştırıp "Çek" deyin ya da soldaki formu doldurun.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {spools.map((spool) => {
                  const delta = priceDelta(spool);
                  return (
                    <li
                      key={spool.id}
                      className={cx(
                        'rounded-xl border p-3 transition',
                        draft.id === spool.id
                          ? 'border-accent-500/50 bg-accent-500/[0.07]'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {spool.brand} · {spool.material}
                            {spool.color && (
                              <span className="font-normal text-slate-500 dark:text-slate-400">
                                {' '}
                                ({spool.color})
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>
                              {formatTRY(spool.rollPrice)} / {spool.rollWeight} g =
                            </span>
                            <span className="font-semibold text-accent-600 dark:text-accent-400">
                              {formatPerGram(pricePerGram(spool))}/g
                            </span>
                            {delta !== null && Math.abs(delta) >= 0.1 && (
                              <span
                                className={cx(
                                  'chip',
                                  delta > 0
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
                                )}
                              >
                                {delta > 0 ? '▲' : '▼'} %{Math.abs(delta).toFixed(1)}
                              </span>
                            )}
                          </p>
                          {(() => {
                            const left = remainingOf(spool);
                            const ratio = remainingRatio(spool);
                            const level = stockLevel(spool);
                            const barColor =
                              level === 'empty'
                                ? '#fb7185'
                                : level === 'low'
                                  ? '#facc15'
                                  : '#34d399';
                            return (
                              <div className="mt-1.5">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-slate-500 dark:text-slate-400">
                                    Kalan{' '}
                                    <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                      {formatNumber(left, 0)} g
                                    </span>{' '}
                                    / {formatNumber(spool.rollWeight, 0)} g
                                  </span>
                                  {level !== 'ok' && (
                                    <span
                                      className={cx(
                                        'chip',
                                        level === 'empty'
                                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300'
                                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
                                      )}
                                    >
                                      {level === 'empty' ? 'boş' : 'az kaldı'}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                                  <div
                                    className="h-full rounded-full transition-[width] duration-300"
                                    style={{
                                      width: `${Math.max(ratio * 100, level === 'empty' ? 0 : 2)}%`,
                                      background: barColor,
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })()}
                          {spool.sourceUrl && (
                            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                              <span>Kontrol: {formatRelative(spool.lastCheckedAt, now)}</span>
                              {spool.lastCheckStatus === 'failed' && (
                                <span className="font-semibold text-rose-500">
                                  · okunamadı
                                  {spool.lastCheckError ? ` (${spool.lastCheckError})` : ''}
                                </span>
                              )}
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 gap-1">
                          {spool.sourceUrl && (
                            <>
                              <button
                                type="button"
                                onClick={() => onRefreshNow([spool.id])}
                                disabled={refreshing}
                                aria-label="Fiyatı şimdi güncelle"
                                title="Fiyatı şimdi güncelle"
                                className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-accent-600 disabled:opacity-40 dark:hover:bg-white/10"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="size-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleAuto(spool)}
                                aria-label="Otomatik takibi aç/kapat"
                                title={
                                  isWatchable(spool)
                                    ? 'Otomatik takip açık'
                                    : 'Otomatik takip kapalı'
                                }
                                className={cx(
                                  'grid size-7 place-items-center rounded-lg transition hover:bg-slate-100 dark:hover:bg-white/10',
                                  isWatchable(spool)
                                    ? 'text-emerald-500'
                                    : 'text-slate-300 dark:text-slate-600',
                                )}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  className="size-4"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <circle cx="12" cy="12" r="9" />
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 7v5l3 2"
                                  />
                                </svg>
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onChange(refill(spools, spool.id))}
                            aria-label="Makarayı doldur"
                            title="Yeni makara: kalanı rulo ağırlığına çek"
                            className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-white/10"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 20V8m0 0l-4 4m4-4l4 4"
                              />
                              <path strokeLinecap="round" d="M5 4h14" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(spool)}
                            aria-label="Düzenle"
                            className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-accent-600 dark:hover:bg-white/10"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4 20h4l10-10-4-4L4 16v4zM14 6l4 4"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(spool.id)}
                            aria-label="Sil"
                            className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
