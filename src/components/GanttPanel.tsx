import { useMemo } from 'react';
import { cx } from '../lib/cx';
import { formatDate, formatDateTime, formatDuration } from '../lib/format';
import { buildSchedule, groupByPrinter } from '../lib/production';
import { Banner, EmptyState, Section } from './ui';
import type { Order } from '../types';

interface GanttPanelProps {
  orders: Order[];
  /** Planlamaya dahil edilecek yazıcı adları. */
  printerNames: string[];
  /** Yazıcı adı -> meşgul olduğu ana kadar (ms). */
  busyUntil: Record<string, number>;
  now: number;
  onOpenOrder: (orderId: string) => void;
  onGoToOrders: () => void;
}

const CALENDAR = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#a855f7', '#ec4899'];
const DAY_MS = 24 * 60 * 60 * 1000;

export function GanttPanel({
  orders,
  printerNames,
  busyUntil,
  now,
  onOpenOrder,
  onGoToOrders,
}: GanttPanelProps) {
  const schedule = useMemo(
    () => buildSchedule(orders, printerNames, now, busyUntil),
    [orders, printerNames, now, busyUntil],
  );
  const rows = useMemo(() => groupByPrinter(schedule), [schedule]);

  if (schedule.tasks.length === 0) {
    return (
      <Section
        title="Üretim Takvimi"
        icon={CALENDAR}
        description="Bekleyen siparişlerin yazıcılara dağılımı."
      >
        <EmptyState
          title="Planlanacak iş yok"
          description="Bekleyen siparişler burada yazıcılara dağıtılır. Önce siparişe süreli bir kalem ekleyin."
          actionLabel="Siparişlere git"
          onAction={onGoToOrders}
          icon={CALENDAR}
        />
      </Section>
    );
  }

  // Zaman ekseni: şimdiden son işin bitimine.
  const start = now;
  const end = Math.max(schedule.finishesAt, now + DAY_MS);
  const span = end - start;
  const pct = (value: number) => ((value - start) / span) * 100;

  // Gün çizgileri.
  const ticks: number[] = [];
  const firstDay = new Date(start);
  firstDay.setHours(0, 0, 0, 0);
  for (let time = firstDay.getTime(); time <= end; time += DAY_MS) {
    if (time >= start) ticks.push(time);
  }

  const colorOf = (orderId: string) => {
    const index = [...new Set(schedule.tasks.map((task) => task.orderId))].indexOf(orderId);
    return PALETTE[index % PALETTE.length];
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Planlanan iş', value: String(schedule.tasks.length), sub: 'kalem' },
          {
            label: 'Tahmini bitiş',
            value: formatDate(new Date(schedule.finishesAt).toISOString()),
            sub: formatDuration((schedule.finishesAt - now) / 3600000) + ' sonra',
          },
          {
            label: 'Geciken sipariş',
            value: String(schedule.lateOrders),
            sub: schedule.lateOrders > 0 ? 'teslim tarihi kaçıyor' : 'takvim uygun',
            warn: schedule.lateOrders > 0,
          },
        ].map((card) => (
          <div key={card.label} className="panel p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">
              {card.value}
            </p>
            <p
              className={cx(
                'mt-0.5 text-[11px]',
                card.warn
                  ? 'font-semibold text-rose-600 dark:text-rose-400'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {card.sub}
            </p>
          </div>
        ))}
      </div>

      {schedule.lateOrders > 0 && (
        <Banner tone="warning">
          {schedule.lateOrders} siparişin teslim tarihi mevcut yazıcı kapasitesiyle tutturulamıyor.
          Yazıcı ekleyin veya teslim tarihini güncelleyin.
        </Banner>
      )}

      <Section
        title="Üretim Takvimi"
        icon={CALENDAR}
        description="Her kalem, o an en erken boşalacak yazıcıya yerleştirilir. Teslim tarihi yakın siparişler önce girer."
      >
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {/* Gün başlıkları */}
            <div className="relative mb-1 h-5">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute -translate-x-1/2 text-[10px] text-slate-400"
                  style={{ left: `${pct(tick)}%` }}
                >
                  {formatDate(new Date(tick).toISOString())}
                </span>
              ))}
            </div>

            {rows.map((row) => (
              <div key={row.printer} className="mb-2">
                <p className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {row.printer}
                </p>
                <div className="relative h-9 rounded-lg bg-slate-100 dark:bg-white/[0.05]">
                  {ticks.map((tick) => (
                    <span
                      key={tick}
                      className="absolute top-0 h-full w-px bg-slate-300/60 dark:bg-white/10"
                      style={{ left: `${pct(tick)}%` }}
                    />
                  ))}
                  {row.tasks.map((task) => (
                    <button
                      key={task.itemId}
                      type="button"
                      onClick={() => onOpenOrder(task.orderId)}
                      title={`${task.label}\n${formatDateTime(task.start)} → ${formatDateTime(task.end)}\n${formatDuration(task.hours)}`}
                      className={cx(
                        'absolute top-1 h-7 overflow-hidden rounded-md px-2 text-left text-[10px] font-semibold text-white transition hover:brightness-110',
                        task.late && 'ring-2 ring-rose-500',
                      )}
                      style={{
                        left: `${pct(task.start)}%`,
                        width: `${Math.max(pct(task.end) - pct(task.start), 1.5)}%`,
                        background: colorOf(task.orderId),
                      }}
                    >
                      <span className="block truncate leading-7">{task.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}
