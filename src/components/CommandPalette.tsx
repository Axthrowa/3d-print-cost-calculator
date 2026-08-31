import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { displayName } from '../lib/invoice';
import { searchOrders } from '../lib/tracking';
import type { Customer, Invoice, Order } from '../types';
import type { PrinterLink } from '../lib/printerLink';
import type { View } from './Sidebar';

export interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  orders: Order[];
  customers: Customer[];
  invoices: Invoice[];
  printers: PrinterLink[];
  /** Sekmeye git. */
  onGo: (view: View, focusOrderId?: string) => void;
  /** Ek eylemler (yeni sipariş, yedekle...). */
  actions: Command[];
}

/**
 * Ctrl+K komut paleti.
 *
 * Sipariş, cari, fatura ve yazıcı aramasını tek yerde toplar; sonuca
 * tıklayınca ilgili sekmeye gider. Klavyeyle tam kullanılabilir.
 */
export function CommandPalette({
  onClose,
  orders,
  customers,
  invoices,
  printers,
  onGo,
  actions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bilesen yalnizca acikken monte edildigi icin durum sifirlamaya gerek yok;
  // burada sadece odak verilir.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const results = useMemo<Command[]>(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    const out: Command[] = [];

    const matched = actions.filter(
      (action) => !needle || action.label.toLocaleLowerCase('tr').includes(needle),
    );
    out.push(...matched.slice(0, 6));

    if (needle) {
      for (const order of searchOrders(orders, query, customers).slice(0, 6)) {
        out.push({
          id: `order-${order.id}`,
          label: `${order.code} · ${order.customer || 'Müşteri yok'}`,
          hint: 'Sipariş',
          group: 'Siparişler',
          run: () => onGo('orders', order.id),
        });
      }

      for (const customer of customers.slice(0, 30)) {
        const haystack = [customer.name, customer.company, customer.phone, customer.taxNumber]
          .join(' ')
          .toLocaleLowerCase('tr');
        if (!haystack.includes(needle)) continue;
        out.push({
          id: `cust-${customer.id}`,
          label: displayName(customer),
          hint: customer.phone || 'Cari',
          group: 'Cariler',
          run: () => onGo('invoices'),
        });
        if (out.length > 18) break;
      }

      for (const invoice of invoices.slice(0, 30)) {
        if (!invoice.number.toLocaleLowerCase('tr').includes(needle)) continue;
        out.push({
          id: `inv-${invoice.id}`,
          label: invoice.number,
          hint: displayName(invoice.customer),
          group: 'Faturalar',
          run: () => onGo('invoices'),
        });
        if (out.length > 22) break;
      }

      for (const printer of printers) {
        if (!printer.name.toLocaleLowerCase('tr').includes(needle)) continue;
        out.push({
          id: `prn-${printer.id}`,
          label: printer.name,
          hint: 'Yazıcı',
          group: 'Yazıcılar',
          run: () => onGo('printers'),
        });
      }
    }

    return out.slice(0, 24);
  }, [query, actions, orders, customers, invoices, printers, onGo]);

  const choose = (command: Command) => {
    command.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Komut paleti"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-900">
        <div className="flex items-center gap-2 border-b border-slate-200 px-3.5 dark:border-white/10">
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            className="w-full bg-transparent py-3 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
            placeholder="Sipariş no, müşteri, fatura, yazıcı veya komut ara…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && results[active]) {
                event.preventDefault();
                choose(results[active]);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
          />
          <kbd className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-white/15">
            Esc
          </kbd>
        </div>

        <ul className="max-h-[46vh] overflow-y-auto py-1.5">
          {results.length === 0 && (
            <li className="px-3.5 py-6 text-center text-[12px] text-slate-400">Sonuç yok.</li>
          )}
          {results.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(command)}
                className={cx(
                  'flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12px]',
                  index === active
                    ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                    : 'text-slate-700 dark:text-slate-200',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{command.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
