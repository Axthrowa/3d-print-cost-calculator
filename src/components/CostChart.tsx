import { useMemo, useState } from 'react';
import { formatPercent, formatTRY } from '../lib/format';
import { cx } from '../lib/cx';
import type { CostSegment } from '../types';

interface CostChartProps {
  segments: CostSegment[];
  total: number;
}

const SIZE = 220;
const RADIUS = 88;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Pasta (donut) grafiği + ayristirilmis cubuk dağılım. */
export function CostChart({ segments, total }: CostChartProps) {
  const [active, setActive] = useState<string | null>(null);

  const arcs = useMemo(() => {
    if (total <= 0) return [];
    let offset = 0;
    return segments.map((segment) => {
      const ratio = segment.value / total;
      const arc = {
        ...segment,
        ratio,
        dash: ratio * CIRCUMFERENCE,
        offset: -offset * CIRCUMFERENCE,
      };
      offset += ratio;
      return arc;
    });
  }, [segments, total]);

  const focused = arcs.find((arc) => arc.key === active) ?? null;

  if (total <= 0 || arcs.length === 0) {
    return (
      <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 text-center dark:border-white/10">
        <svg
          viewBox="0 0 24 24"
          className="size-8 text-slate-300 dark:text-slate-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a9 9 0 109 9h-9V3z" />
        </svg>
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
          Girdileri doldurun, dağılım burada görünecek.
        </p>
      </div>
    );
  }

  return (
    <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="-rotate-90"
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label="Maliyet dağılım grafiği"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            className="stroke-slate-200 dark:stroke-white/[0.06]"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={arc.color}
              strokeWidth={active === arc.key ? STROKE + 6 : STROKE}
              strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
              strokeDashoffset={arc.offset}
              strokeLinecap="butt"
              className="cursor-pointer transition-[stroke-width,opacity] duration-200"
              opacity={active && active !== arc.key ? 0.35 : 1}
              onMouseEnter={() => setActive(arc.key)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {focused ? focused.label : 'Net maliyet'}
          </span>
          <span className="mt-0.5 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
            {formatTRY(focused ? focused.value : total)}
          </span>
          {focused && (
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {formatPercent(focused.ratio * 100)}
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-2.5">
        {arcs.map((arc) => (
          <li
            key={arc.key}
            onMouseEnter={() => setActive(arc.key)}
            onMouseLeave={() => setActive(null)}
            className={cx(
              'cursor-default rounded-lg px-2 py-1.5 transition',
              active === arc.key && 'bg-slate-100 dark:bg-white/[0.06]',
            )}
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: arc.color }} />
                <span className="truncate font-medium text-slate-600 dark:text-slate-300">
                  {arc.label}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {formatTRY(arc.value)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(arc.ratio * 100, 1.5)}%`, background: arc.color }}
                />
              </div>
              <span className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-400">
                {formatPercent(arc.ratio * 100)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
