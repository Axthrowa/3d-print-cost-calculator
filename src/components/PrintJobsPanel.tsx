import { useMemo, useState } from 'react';
import { cx, cx as classNames } from '../lib/cx';
import { pricePerGram } from '../lib/costEngine';
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSpoolLabel,
  formatTRY,
} from '../lib/format';
import { uid } from '../lib/storage';
import {
  JOB_STATUS_META,
  jobProgressLive,
  jobRunHours,
  sortJobs,
  sortRunHours,
  summarizeJobs,
  totalRunHours,
  type RunHours,
} from '../lib/tracking';
import { checkAvailability, remainingOf } from '../lib/inventory';
import type { LiveStatus } from '../lib/printerLink';
import type { FilamentSpool, JobMaterial, JobStatus, Order, PrintJob } from '../types';
import { NumberField, Section, TextField, EmptyState } from './ui';

interface PrintJobsPanelProps {
  jobs: PrintJob[];
  onChange: (jobs: PrintJob[]) => void;
  spools: FilamentSpool[];
  orders: Order[];
  now: number;
  /** Hesaplayıcıdaki güncel değerler — yeni iş formunu doldurmak için. */
  defaults: { printerName: string; materials: JobMaterial[]; hours: number };
  /** Gerçekleşen fire oranını hesaplayıcıya uygular. */
  onApplyFailureRate: (pct: number) => void;
  /** Durum değişimi: stok düşümü/iadesi App tarafında yapılır. */
  onStatusChange: (job: PrintJob, status: JobStatus) => void;
  /** Yazıcı adı -> biriken çalışma saati. */
  printerHours: RunHours;
  /** Boş kuyruk CTA — hesaplamaya git. */
  onGoToCalc?: () => void;
  /** Bağlı yazıcıların canlı durumu (ilerleme çubuğu için). */
  printerStatuses?: Record<string, LiveStatus>;
}

interface Draft {
  id: string | null;
  name: string;
  printerName: string;
  materials: JobMaterial[];
  hours: number;
  minutes: number;
  orderId: string | null;
  notes: string;
}

const JOB_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v4M12 21v-4" />
    <circle cx="12" cy="12" r="4" />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4.2 7.5l3.4 2M16.4 14.5l3.4 2M4.2 16.5l3.4-2M16.4 9.5l3.4-2"
    />
  </svg>
);

export function PrintJobsPanel({
  jobs,
  onChange,
  spools,
  orders,
  now,
  defaults,
  onApplyFailureRate,
  onStatusChange,
  printerHours,
  onGoToCalc,
  printerStatuses = {},
}: PrintJobsPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const summary = useMemo(() => summarizeJobs(jobs, now), [jobs, now]);
  const sorted = useMemo(() => sortJobs(jobs), [jobs]);

  const startNew = () =>
    setDraft({
      id: null,
      name: '',
      printerName: defaults.printerName,
      materials:
        defaults.materials.length > 0
          ? defaults.materials.map((m) => ({ ...m }))
          : [{ spoolId: spools[0]?.id ?? null, grams: 0 }],
      hours: Math.floor(defaults.hours),
      minutes: Math.round((defaults.hours - Math.floor(defaults.hours)) * 60),
      orderId: null,
      notes: '',
    });

  const save = () => {
    if (!draft) return;
    const estimatedHours = Math.max(0, draft.hours) + Math.max(0, draft.minutes) / 60;
    const name = draft.name.trim() || 'İsimsiz baskı';
    const materials = draft.materials
      .filter((m) => m.grams > 0)
      .map((m) => ({ ...m, grams: Math.max(0, m.grams) }));
    const totalGrams = materials.reduce((sum, m) => sum + m.grams, 0);

    if (draft.id) {
      onChange(
        jobs.map((j) =>
          j.id === draft.id
            ? {
                ...j,
                name,
                printerName: draft.printerName.trim(),
                materials,
                grams: totalGrams,
                estimatedHours,
                orderId: draft.orderId,
                notes: draft.notes.trim(),
              }
            : j,
        ),
      );
    } else {
      onChange([
        ...jobs,
        {
          id: uid('job'),
          name,
          printerName: draft.printerName.trim(),
          materials,
          grams: totalGrams,
          estimatedHours,
          status: 'queued',
          startedAt: null,
          finishedAt: null,
          orderId: draft.orderId,
          notes: draft.notes.trim(),
        },
      ]);
    }
    setDraft(null);
  };

  // Durum değişimi stok düşümüyle birlikte yapıldığı için App'e devredilir.
  const setStatus = (job: PrintJob, status: JobStatus) => onStatusChange(job, status);

  const remove = (id: string) => onChange(jobs.filter((j) => j.id !== id));

  const jobMaterialCost = (job: PrintJob) =>
    job.materials.reduce((sum, material) => {
      const spool = spools.find((s) => s.id === material.spoolId);
      return sum + (spool ? pricePerGram(spool) * material.grams : 0);
    }, 0);

  /** İş kuyruktan çıkmadan önce stok yetiyor mu? */
  const shortageOf = (job: PrintJob) =>
    job.consumed ? { ok: true, shortages: [] } : checkAvailability(spools, job.materials);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Aktif iş
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {summary.activeCount}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {summary.counts.printing} basılıyor · {summary.counts.queued} kuyrukta
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Kalan süre
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatDuration(summary.pendingHours)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Kuyruğun tamamı</p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Gerçekleşen fire
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatPercent(summary.failureRatePct)}
          </p>
          {summary.hasEnoughData ? (
            <button
              type="button"
              onClick={() => onApplyFailureRate(Math.round(summary.failureRatePct))}
              className="mt-1 text-[11px] font-semibold text-accent-600 underline-offset-2 hover:underline dark:text-accent-400"
            >
              Hesaplayıcıya uygula
            </button>
          ) : (
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              En az 5 biten iş gerekir
            </p>
          )}
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Ziyan olan filament
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(summary.wastedGrams)} g
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {formatNumber(summary.totalGrams)} g toplam basıldı
          </p>
        </div>
        <div className="panel p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Toplam çalışma süresi
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatDuration(totalRunHours(printerHours))}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {sortRunHours(printerHours)
              .slice(0, 2)
              .map((entry) => `${entry.name}: ${formatDuration(entry.hours)}`)
              .join(' · ') || 'tamamlanan baskılardan birikir'}
          </p>
        </div>
      </div>

      <Section
        title="Baskı Kuyruğu"
        icon={JOB_ICON}
        description="Bağlı yazıcıdaki devam eden baskılar otomatik eklenir; ilerleme yazıcıdan okunur."
        action={
          <button type="button" className="btn-primary !px-3 !py-1.5 !text-xs" onClick={startNew}>
            + Baskı ekle
          </button>
        }
      >
        {draft && (
          <div className="mb-4 rounded-xl border border-accent-500/30 bg-accent-500/[0.06] p-4">
            <p className="mb-3 text-[12px] font-semibold text-accent-600 dark:text-accent-400">
              {draft.id ? 'Baskıyı düzenle' : 'Yeni baskı — hesaplayıcıdaki değerlerle dolduruldu'}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TextField
                label="Baskı adı"
                value={draft.name}
                onChange={(name) => setDraft({ ...draft, name })}
                placeholder="örn. Vazo — 2. deneme"
              />
              <TextField
                label="Yazıcı"
                value={draft.printerName}
                onChange={(printerName) => setDraft({ ...draft, printerName })}
                placeholder="örn. Bambu Lab P1S"
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="field-label">Kullanılan filamentler</p>
                <div className="space-y-2">
                  {draft.materials.map((material, index) => {
                    const spool = spools.find((sp) => sp.id === material.spoolId);
                    const left = spool ? remainingOf(spool) : null;
                    const short = left !== null && material.grams > left;
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          aria-label={`Filament ${index + 1}`}
                          className="field-input flex-1 !py-2 !text-[12px]"
                          value={material.spoolId ?? ''}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              materials: draft.materials.map((m, i) =>
                                i === index ? { ...m, spoolId: event.target.value || null } : m,
                              ),
                            })
                          }
                        >
                          <option value="">Seçilmedi</option>
                          {spools.map((spool2) => (
                            <option key={spool2.id} value={spool2.id}>
                              {formatSpoolLabel(spool2)} — {formatNumber(remainingOf(spool2), 0)} g
                            </option>
                          ))}
                        </select>
                        <div className="w-24 shrink-0">
                          <NumberField
                            label=""
                            value={material.grams}
                            onChange={(grams) =>
                              setDraft({
                                ...draft,
                                materials: draft.materials.map((m, i) =>
                                  i === index ? { ...m, grams } : m,
                                ),
                              })
                            }
                            suffix="g"
                          />
                        </div>
                        {draft.materials.length > 1 && (
                          <button
                            type="button"
                            aria-label="Satırı sil"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                materials: draft.materials.filter((_, i) => i !== index),
                              })
                            }
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
                        {short && (
                          <span className="chip shrink-0 bg-amber-500/15 text-amber-600 dark:text-amber-300">
                            stok {formatNumber(left ?? 0, 0)} g
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        materials: [...draft.materials, { spoolId: null, grams: 0 }],
                      })
                    }
                    className="w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-medium text-slate-500 transition hover:border-accent-500 hover:text-accent-600 dark:border-white/10 dark:text-slate-400"
                  >
                    + filament ekle
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Süre (saat)"
                  value={draft.hours}
                  onChange={(hours) => setDraft({ ...draft, hours })}
                  suffix="sa"
                />
                <NumberField
                  label="Dakika"
                  value={draft.minutes}
                  onChange={(minutes) => setDraft({ ...draft, minutes })}
                  suffix="dk"
                  max={59}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="job-order">
                  Bağlı sipariş
                </label>
                <select
                  id="job-order"
                  className="field-input"
                  value={draft.orderId ?? ''}
                  onChange={(event) => setDraft({ ...draft, orderId: event.target.value || null })}
                >
                  <option value="">Yok</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.code} — {order.customer || `${order.items.length} kalem`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <TextField
                  label="Not"
                  value={draft.notes}
                  onChange={(notes) => setDraft({ ...draft, notes })}
                  placeholder="Katman yüksekliği, destek ayarı…"
                />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost !py-2 !text-xs"
                onClick={() => setDraft(null)}
              >
                Vazgeç
              </button>
              <button type="button" className="btn-primary !py-2 !text-xs" onClick={save}>
                Kaydet
              </button>
            </div>
          </div>
        )}

        {sorted.length === 0 ? (
          <EmptyState
            title="Baskı kuyruğu boş"
            description="Hesaplayıcıdan baskı ekleyebilir veya bağlı yazıcıdaki işler otomatik buraya düşer."
            actionLabel={onGoToCalc ? 'Hesaplamaya git' : undefined}
            onAction={onGoToCalc}
            icon={JOB_ICON}
          />
        ) : (
          <ul className="space-y-2">
            {sorted.map((job) => {
              const live = job.printerLinkId ? printerStatuses[job.printerLinkId] : undefined;
              const progress = jobProgressLive(job, now, live);
              const meta = JOB_STATUS_META[job.status];
              const order = orders.find((o) => o.id === job.orderId);
              const shortage = shortageOf(job);
              return (
                <li
                  key={job.id}
                  className="rounded-xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cx('chip', meta.chip)}>{meta.label}</span>
                        {progress.overrun && job.status === 'printing' && (
                          <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300">
                            Süre aşıldı
                          </span>
                        )}
                        {job.printerLinkId && job.status === 'printing' && live && (
                          <span className="chip bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                            {live.state === 'paused' ? 'Duraklatıldı' : 'Yazıcıdan'} · %
                            {((live.progress ?? progress.ratio) * 100).toFixed(0)}
                          </span>
                        )}
                        {order && (
                          <span className="chip bg-violet-500/15 text-violet-600 dark:text-violet-300">
                            {order.code}
                          </span>
                        )}
                        {job.consumed && (
                          <span className="chip bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                            stoktan düşüldü
                          </span>
                        )}
                        {!shortage.ok && (
                          <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300">
                            stok yetersiz
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {job.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {job.printerName || 'Yazıcı belirtilmedi'} · {formatNumber(job.grams)} g ·{' '}
                        {formatDuration(job.estimatedHours)}
                        {jobMaterialCost(job) > 0 && ` · ${formatTRY(jobMaterialCost(job))}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {job.status === 'queued' && (
                        <button
                          type="button"
                          className="btn-primary !px-2.5 !py-1.5 !text-[11px]"
                          onClick={() => setStatus(job, 'printing')}
                        >
                          Başlat
                        </button>
                      )}
                      {job.status === 'printing' && (
                        <>
                          <button
                            type="button"
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-600 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                            onClick={() => setStatus(job, 'done')}
                          >
                            Tamamlandı
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                            onClick={() => setStatus(job, 'failed')}
                          >
                            Başarısız
                          </button>
                        </>
                      )}
                      {(job.status === 'done' || job.status === 'failed') && (
                        <button
                          type="button"
                          className="btn-ghost !px-2.5 !py-1.5 !text-[11px]"
                          onClick={() => setStatus(job, 'queued')}
                        >
                          Kuyruğa al
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(job.id)}
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

                  {job.materials.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {job.materials.map((material, index) => {
                        const spool = spools.find((sp) => sp.id === material.spoolId);
                        return (
                          <li
                            key={index}
                            className={classNames(
                              'flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]',
                              'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300',
                            )}
                          >
                            {material.colorHex && (
                              <span
                                className="size-3 rounded-sm border border-black/20 dark:border-white/25"
                                style={{ background: material.colorHex }}
                              />
                            )}
                            <span className="tabular-nums">
                              {spool ? formatSpoolLabel(spool) : 'makara yok'} ·{' '}
                              {formatNumber(material.grams, 1)} g
                            </span>
                            {spool && (
                              <span className="text-slate-400">
                                (kalan {formatNumber(remainingOf(spool), 0)} g)
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {job.status === 'printing' && (
                    <div className="mt-3">
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                        <div
                          className="h-full rounded-full transition-[width] duration-1000"
                          style={{
                            width: `${Math.max(progress.ratio * 100, 2)}%`,
                            background: progress.overrun ? '#facc15' : meta.color,
                          }}
                        />
                      </div>
                      <p className="mt-1.5 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {formatPercent(progress.ratio * 100, 0)} ·{' '}
                          {formatDuration(progress.elapsedHours)} geçti
                          {live?.jobName ? ` · ${live.jobName}` : ''}
                        </span>
                        <span>
                          {progress.overrun
                            ? 'Tahmini süre doldu'
                            : `${formatDuration(progress.remainingHours)} kaldı · bitiş ${formatDateTime(progress.etaAt)}`}
                        </span>
                      </p>
                    </div>
                  )}

                  {(job.status === 'done' || job.status === 'failed') && job.finishedAt && (
                    <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                      {formatDateTime(job.finishedAt)} tarihinde{' '}
                      {job.status === 'done' ? 'tamamlandı' : 'başarısız oldu'} ·{' '}
                      {formatDuration(jobRunHours(job))} çalıştı
                      {job.notes && ` · ${job.notes}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
