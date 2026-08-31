import { formatDuration, formatNumber, formatPercent, formatTRY } from '../lib/format';
import { cx } from '../lib/cx';
import type { CostResult } from '../types';
import { CostChart } from './CostChart';
import { Banner } from './ui';

interface ResultPanelProps {
  result: CostResult;
  marginPct: number;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  accent?: 'sky' | 'amber' | 'violet' | 'emerald' | 'slate';
}

const ACCENTS: Record<NonNullable<CardProps['accent']>, string> = {
  sky: 'from-sky-500/15 to-sky-500/[0.02] text-sky-600 dark:text-sky-300',
  amber: 'from-amber-500/15 to-amber-500/[0.02] text-amber-600 dark:text-amber-300',
  violet: 'from-violet-500/15 to-violet-500/[0.02] text-violet-600 dark:text-violet-300',
  emerald: 'from-emerald-500/15 to-emerald-500/[0.02] text-emerald-600 dark:text-emerald-300',
  slate: 'from-slate-500/10 to-slate-500/[0.02] text-slate-600 dark:text-slate-300',
};

function Card({ label, value, sub, accent = 'slate' }: CardProps) {
  return (
    <div className="panel relative overflow-hidden p-4">
      <div
        className={cx('absolute inset-0 bg-gradient-to-br', ACCENTS[accent])}
        aria-hidden="true"
      />
      <div className="relative">
        <p
          className={cx(
            'text-[11px] font-semibold uppercase tracking-wide',
            ACCENTS[accent].split(' ').slice(2).join(' '),
          )}
        >
          {label}
        </p>
        <p className={cx('mt-1 font-bold tabular-nums text-slate-900 dark:text-white', 'text-xl')}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

export function ResultPanel({ result, marginPct }: ResultPanelProps) {
  const perGram = result.totalGrams > 0 ? result.netCost / result.totalGrams : 0;
  const perHour = result.totalHours > 0 ? result.netCost / result.totalHours : 0;
  const multi = result.quantity > 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          label="Filament maliyeti"
          value={formatTRY(result.filamentCost)}
          sub={
            result.wasteGrams > 0
              ? `${formatNumber(result.modelGrams, 1)} g model + ${formatNumber(
                  result.wasteGrams,
                  1,
                )} g atık`
              : `${formatNumber(result.totalGrams)} g malzeme`
          }
          accent="sky"
        />
        <Card
          label="Elektrik maliyeti"
          value={formatTRY(result.electricityCost)}
          sub={`${formatNumber(result.energyKwh, 3)} kWh · ${formatDuration(result.totalHours)}`}
          accent="amber"
        />
        <Card
          label="Amortisman & risk"
          value={formatTRY(result.riskAndDepreciationCost)}
          sub={`Amortisman ${formatTRY(result.depreciationCost)} + fire ${formatTRY(result.failureCost)}`}
          accent="violet"
        />
        <Card
          label="İşçilik & ek gider"
          value={formatTRY(result.laborCost + result.extraCost)}
          sub={`İşçilik ${formatTRY(result.laborCost)} + ek ${formatTRY(result.extraCost)}`}
          accent="emerald"
        />
      </div>

      {result.wasteGrams > 0 && (
        <div className="panel relative overflow-hidden border-rose-300/50 p-4 dark:border-rose-500/25">
          <div
            className="absolute inset-0 bg-gradient-to-br from-rose-500/15 to-transparent"
            aria-hidden="true"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-300">
                Atık / temizleme kulesi maliyeti
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {formatTRY(result.wasteFilamentCost)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-right">
              <div className="rounded-lg bg-white/70 px-3 py-1.5 dark:bg-white/[0.06]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Net model</p>
                <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {formatNumber(result.modelGrams, 1)} g · {formatTRY(result.modelFilamentCost)}
                </p>
              </div>
              <div className="rounded-lg bg-white/70 px-3 py-1.5 dark:bg-white/[0.06]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Temizleme kulesi
                </p>
                <p className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-300">
                  {formatNumber(result.wasteGrams, 1)} g · {formatTRY(result.wasteFilamentCost)}
                </p>
              </div>
              <div className="rounded-lg bg-white/70 px-3 py-1.5 dark:bg-white/[0.06]">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Atık payı</p>
                <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {formatPercent(
                    result.totalGrams > 0 ? (result.wasteGrams / result.totalGrams) * 100 : 0,
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="panel relative overflow-hidden p-5">
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-500/10 to-transparent"
            aria-hidden="true"
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Toplam net maliyet
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
              {formatTRY(result.netCost)}
            </p>
            {multi && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Adet başına {formatTRY(result.unit.netCost)} × {result.quantity}
              </p>
            )}
          </div>
        </div>

        <div className="panel relative overflow-hidden border-accent-500/30 p-5 dark:border-accent-500/30">
          <div
            className="absolute inset-0 bg-gradient-to-br from-accent-500/25 via-accent-500/10 to-transparent"
            aria-hidden="true"
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-400">
              Tavsiye edilen satış fiyatı
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">
              {formatTRY(result.salePrice)}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {formatPercent(marginPct, 0)} kâr ={' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {formatTRY(result.profit)}
              </span>
              {result.vatAmount > 0 && ` · KDV ${formatTRY(result.vatAmount)} dahil`}
            </p>
            {multi && (
              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                Adet başına {formatTRY(result.unit.salePrice)}
              </p>
            )}
          </div>
        </div>
      </div>

      <section className="panel p-5">
        <h2 className="mb-4 text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Maliyet Dağılımı
        </h2>
        <CostChart segments={result.segments} total={result.netCost} />
      </section>

      <section className="panel p-5">
        <h2 className="mb-3.5 text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Özet Göstergeler
        </h2>
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: 'Gram başına', value: `${formatTRY(perGram)}` },
            { label: 'Saat başına', value: `${formatTRY(perHour)}` },
            { label: 'Enerji', value: `${formatNumber(result.energyKwh, 3)} kWh` },
            { label: 'Toplam süre', value: formatDuration(result.totalHours) },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{item.label}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        <table className="mt-4 w-full text-xs">
          <tbody className="divide-y divide-slate-200 dark:divide-white/[0.07]">
            {[
              ['Filament (model)', result.modelFilamentCost],
              ...(result.wasteFilamentCost > 0
                ? ([['Atık (temizleme kulesi)', result.wasteFilamentCost]] as Array<
                    [string, number]
                  >)
                : []),
              ['Elektrik', result.electricityCost],
              ['Amortisman', result.depreciationCost],
              ['Fire riski', result.failureCost],
              ['İşçilik', result.laborCost],
              ['Ek giderler', result.extraCost],
            ].map(([label, value]) => (
              <tr key={label as string}>
                <td className="py-1.5 text-slate-500 dark:text-slate-400">{label}</td>
                <td className="py-1.5 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                  {formatTRY(value as number)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 text-slate-700 dark:text-slate-200">Net maliyet</td>
              <td className="py-2 text-right tabular-nums text-slate-900 dark:text-white">
                {formatTRY(result.netCost)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-slate-500 dark:text-slate-400">
                Kâr marjı ({formatPercent(marginPct, 0)})
              </td>
              <td className="py-1.5 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                +{formatTRY(result.marginAmount)}
              </td>
            </tr>
            {result.vatAmount > 0 && (
              <tr>
                <td className="py-1.5 text-slate-500 dark:text-slate-400">KDV</td>
                <td className="py-1.5 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">
                  +{formatTRY(result.vatAmount)}
                </td>
              </tr>
            )}
            <tr className="font-bold">
              <td className="pt-2 text-accent-600 dark:text-accent-400">Satış fiyatı</td>
              <td className="pt-2 text-right tabular-nums text-accent-600 dark:text-accent-400">
                {formatTRY(result.salePrice)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {result.warnings.length > 0 && (
        <Banner tone="warning">
          <ul className="list-inside list-disc space-y-0.5">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Banner>
      )}
    </div>
  );
}
