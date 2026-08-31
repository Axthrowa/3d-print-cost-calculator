import { useMemo } from 'react';
import { cx } from '../lib/cx';
import {
  lastMonths,
  monthKey,
  monthLabel,
  monthlyRevenue,
  printerLoad,
  summarizeMoney,
  topFilaments,
  topProducts,
  type RankedItem,
} from '../lib/analytics';
import { formatDuration, formatNumber, formatPercent, formatTRY } from '../lib/format';
import { remainingOf, stockLevel } from '../lib/inventory';
import { printersDueForMaintenance, type MaintenanceSettings } from '../lib/workshop';
import { Section, EmptyState } from './ui';
import type { CalculatorInputs, FilamentSpool, Order, PrintJob } from '../types';

interface DashboardPanelProps {
  orders: Order[];
  jobs: PrintJob[];
  spools: FilamentSpool[];
  inputs: CalculatorInputs;
  printerHours: Record<string, number>;
  maintenance: MaintenanceSettings;
  now: number;
  onGoTo: (view: 'orders' | 'inventory' | 'printers' | 'jobs') => void;
}

const CHART_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

/** Grafiklerde renk verilmemiş dilimler için sabit palet. */
const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7'];

/** Çubuk grafik: değerleri en büyüğe göre ölçekler. */
function BarChart({
  data,
  format,
  emptyTitle = 'Henüz veri yok',
  emptyDescription,
  emptyAction,
}: {
  data: RankedItem[];
  format: (value: number) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
}) {
  const max = Math.max(1, ...data.map((entry) => entry.value));
  if (data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyAction?.label}
        onAction={emptyAction?.onClick}
      />
    );
  }
  return (
    <div className="space-y-2">
      {data.map((entry, index) => (
        <div key={entry.label}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">
              {entry.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {format(entry.value)}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max((entry.value / max) * 100, entry.value > 0 ? 3 : 0)}%`,
                background: entry.color ?? PALETTE[index % PALETTE.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Halka dilimlerini hesaplar. Bilesenin disinda durur: render sirasinda
 * degisken guncellemek React'te tutarsizlik kaynagidir.
 */
function donutSegments(data: RankedItem[], total: number, circumference: number) {
  const dashes = data.map((entry) => (entry.value / total) * circumference);
  return data.map((entry, index) => ({
    key: entry.label,
    dash: dashes[index],
    offset: dashes.slice(0, index).reduce((sum, value) => sum + value, 0),
    color: entry.color ?? PALETTE[index % PALETTE.length],
  }));
}

/** Halka grafik: paylar toplam üzerinden hesaplanır. */
function DonutChart({
  data,
  format,
  emptyTitle = 'Henüz veri yok',
  emptyDescription,
  emptyAction,
}: {
  data: RankedItem[];
  format: (value: number) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
}) {
  const total = data.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyAction?.label}
        onAction={emptyAction?.onClick}
      />
    );
  }

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const segments = donutSegments(data, total, circumference);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 140 140" className="size-[132px] shrink-0 -rotate-90">
        {segments.map((segment) => (
          <circle
            key={segment.key}
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            strokeWidth="20"
            stroke={segment.color}
            strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
            strokeDashoffset={-segment.offset}
          />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((entry, index) => (
          <li key={entry.label} className="flex items-center gap-2 text-[11px]">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: entry.color ?? PALETTE[index % PALETTE.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
              {entry.label}
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {format(entry.value)}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-slate-400">
              {formatPercent((entry.value / total) * 100, 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardPanel({
  orders,
  jobs,
  spools,
  inputs,
  printerHours,
  maintenance,
  now,
  onGoTo,
}: DashboardPanelProps) {
  const thisMonth = monthKey(new Date(now).toISOString());

  const month = useMemo(
    () => summarizeMoney(orders, spools, inputs, thisMonth),
    [orders, spools, inputs, thisMonth],
  );
  const allTime = useMemo(
    () => summarizeMoney(orders, spools, inputs, null),
    [orders, spools, inputs],
  );
  const revenueSeries = useMemo(
    () =>
      monthlyRevenue(orders, spools, inputs, lastMonths(now, 6)).map((entry) => ({
        ...entry,
        label: monthLabel(entry.label),
      })),
    [orders, spools, inputs, now],
  );
  const products = useMemo(() => topProducts(orders), [orders]);
  const filaments = useMemo(() => topFilaments(jobs, spools), [jobs, spools]);
  const load = useMemo(() => printerLoad(printerHours), [printerHours]);

  const lowStock = spools.filter((spool) => stockLevel(spool) !== 'ok');
  const dueMaintenance = printersDueForMaintenance(printerHours, maintenance);
  const openOrders = orders.filter(
    (order) => order.status === 'pending' || order.status === 'printing',
  ).length;

  const cards = [
    {
      label: 'Bu ay ciro',
      value: formatTRY(month.revenue),
      sub: `${month.orderCount} sipariş`,
    },
    {
      label: 'Bu ay net kâr',
      value: formatTRY(month.profit),
      sub: month.margin === null ? 'ciro yok' : `%${formatNumber(month.margin * 100, 1)} marj`,
      accent: true,
    },
    {
      label: 'Açık sipariş',
      value: String(openOrders),
      sub: 'bekleyen + baskıda',
    },
    {
      label: 'Toplam ciro',
      value: formatTRY(allTime.revenue),
      sub: `tüm zamanlar · kâr ${formatTRY(allTime.profit)}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="panel p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p
              className={cx(
                'mt-1 text-2xl font-bold tabular-nums',
                card.accent
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-slate-900 dark:text-white',
              )}
            >
              {card.value}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{card.sub}</p>
          </div>
        ))}
      </div>

      {(lowStock.length > 0 || dueMaintenance.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {lowStock.length > 0 && (
            <button
              type="button"
              onClick={() => onGoTo('inventory')}
              className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-left transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
            >
              <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-300">
                Kritik stok: {lowStock.length} makara
              </p>
              <p className="mt-0.5 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                {lowStock
                  .slice(0, 3)
                  .map((spool) => `${spool.color || spool.material} (${remainingOf(spool)} g)`)
                  .join(' · ')}
              </p>
            </button>
          )}
          {dueMaintenance.length > 0 && (
            <button
              type="button"
              onClick={() => onGoTo('printers')}
              className="rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-left transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:hover:bg-rose-500/15"
            >
              <p className="text-[12px] font-semibold text-rose-700 dark:text-rose-300">
                Bakım zamanı: {dueMaintenance.length} yazıcı
              </p>
              <p className="mt-0.5 text-[11px] text-rose-700/80 dark:text-rose-300/80">
                {dueMaintenance.join(' · ')} — mil yağlama ve kayış kontrolü
              </p>
            </button>
          )}
        </div>
      )}

      <Section
        title="Aylık Ciro"
        icon={CHART_ICON}
        description="Son altı ayın satış toplamı (iptaller hariç)."
      >
        <BarChart
          data={revenueSeries}
          format={formatTRY}
          emptyTitle="Henüz ciro yok"
          emptyDescription="İlk siparişinizi oluşturduğunuzda aylık grafik burada görünür."
          emptyAction={{ label: 'Siparişlere git', onClick: () => onGoTo('orders') }}
        />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="En Çok Satan Ürünler"
          icon={CHART_ICON}
          description="Siparişlerdeki toplam adet."
          action={
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => onGoTo('orders')}
            >
              Siparişler
            </button>
          }
        >
          <BarChart
            data={products}
            format={(value) => `${value} adet`}
            emptyTitle="Henüz satış yok"
            emptyDescription="Sipariş kalemleri eklendikçe en çok satanlar listelenir."
            emptyAction={{ label: 'Sipariş oluştur', onClick: () => onGoTo('orders') }}
          />
        </Section>

        <Section
          title="En Çok Kullanılan Filamentler"
          icon={CHART_ICON}
          description="Tamamlanan baskılarda gerçekten harcanan gram."
        >
          <DonutChart
            data={filaments}
            format={(value) => `${formatNumber(value, 0)} g`}
            emptyTitle="Henüz baskı kaydı yok"
            emptyDescription="Tamamlanan baskılar filament dağılımını burada gösterir."
            emptyAction={{ label: 'Baskılara git', onClick: () => onGoTo('jobs') }}
          />
        </Section>
      </div>

      <Section
        title="Yazıcı Doluluğu"
        icon={CHART_ICON}
        description="Toplam çalışma süresine göre yazıcı payları."
      >
        <DonutChart data={load} format={(value) => formatDuration(value)} />
      </Section>
    </div>
  );
}
