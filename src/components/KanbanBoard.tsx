import { useState } from 'react';
import { cx } from '../lib/cx';
import { formatDate, formatTRY } from '../lib/format';
import { ORDER_STATUSES, orderStatusMeta, daysUntilDue, isOverdue } from '../lib/tracking';
import type { Order, OrderStatus } from '../types';

interface KanbanBoardProps {
  orders: Order[];
  /** Sipariş kimliği -> satış tutarı. */
  totals: Map<string, number>;
  now: number;
  onStatusChange: (order: Order, status: OrderStatus) => void;
  onOpen: (orderId: string) => void;
}

/** Sütun renkleri; durum çipiyle uyumlu. */
const COLUMN_TONE: Record<OrderStatus, string> = {
  pending: 'border-slate-300 dark:border-white/10',
  printing: 'border-accent-400/60',
  ready: 'border-emerald-400/60',
  delivered: 'border-sky-400/60',
  cancelled: 'border-rose-400/50',
};

/**
 * Sürükle-bırak sipariş panosu.
 *
 * HTML5 sürükle-bırak kullanılır; ek kütüphane yoktur. Klavyeyle
 * kullanabilmek için her kartta durum seçici de bulunur — sürükle-bırak tek
 * erişim yolu olmamalı.
 */
export function KanbanBoard({ orders, totals, now, onStatusChange, onOpen }: KanbanBoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<OrderStatus | null>(null);

  const drop = (status: OrderStatus) => {
    const order = orders.find((entry) => entry.id === dragId);
    setDragId(null);
    setOverStatus(null);
    if (order && order.status !== status) onStatusChange(order, status);
  };

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
      {ORDER_STATUSES.map((status) => {
        const column = orders.filter((order) => order.status === status);
        const sum = column.reduce((total, order) => total + (totals.get(order.id) ?? 0), 0);

        return (
          <div
            key={status}
            onDragOver={(event) => {
              event.preventDefault();
              setOverStatus(status);
            }}
            onDragLeave={() => setOverStatus((current) => (current === status ? null : current))}
            onDrop={() => drop(status)}
            className={cx(
              'flex min-h-[8rem] flex-col rounded-xl border-2 border-dashed p-2 transition',
              COLUMN_TONE[status],
              overStatus === status && 'bg-accent-500/10 ring-2 ring-accent-500/40',
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <span className={cx('chip', orderStatusMeta(status).chip)}>
                {orderStatusMeta(status).label}
              </span>
              <span className="text-[10px] tabular-nums text-slate-400">{column.length}</span>
            </div>

            <div className="flex-1 space-y-1.5">
              {column.map((order) => {
                const late = isOverdue(order, now);
                const days = daysUntilDue(order, now);
                return (
                  <div
                    key={order.id}
                    draggable
                    onDragStart={() => setDragId(order.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStatus(null);
                    }}
                    className={cx(
                      'cursor-grab rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition active:cursor-grabbing dark:border-white/10 dark:bg-white/[0.05]',
                      dragId === order.id && 'opacity-50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(order.id)}
                      className="block w-full text-left"
                    >
                      <p className="text-[12px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {order.code}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {order.customer || 'Müşteri yok'}
                      </p>
                      <p className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                          {formatTRY(totals.get(order.id) ?? 0)}
                        </span>
                        {order.dueDate && (
                          <span
                            className={cx(
                              'tabular-nums',
                              late
                                ? 'font-semibold text-rose-600 dark:text-rose-400'
                                : 'text-slate-400',
                            )}
                          >
                            {late
                              ? 'gecikti'
                              : days !== null && days <= 3
                                ? `${days} gün`
                                : formatDate(order.dueDate)}
                          </span>
                        )}
                      </p>
                    </button>

                    {/* Klavye erisimi: surukleyemeyenler icin. */}
                    <select
                      aria-label={`${order.code} durumu`}
                      className="field-input mt-1.5 !py-1 !text-[10px]"
                      value={order.status}
                      onChange={(event) => onStatusChange(order, event.target.value as OrderStatus)}
                    >
                      {ORDER_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {orderStatusMeta(value).label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}

              {column.length === 0 && (
                <p className="px-1 py-4 text-center text-[10px] text-slate-400">
                  Buraya sürükleyin
                </p>
              )}
            </div>

            {sum > 0 && (
              <p className="mt-2 border-t border-slate-200 pt-1.5 text-right text-[10px] font-semibold tabular-nums text-slate-500 dark:border-white/10 dark:text-slate-400">
                {formatTRY(sum)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
