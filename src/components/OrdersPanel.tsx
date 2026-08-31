import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { itemFromProduct, priceOrder } from '../lib/catalog';
import {
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSpoolLabel,
  formatTRY,
} from '../lib/format';
import { displayName } from '../lib/invoice';
import {
  DEFAULT_HOURLY_RATE,
  LABOUR_PRESETS,
  NOTIFY_TEMPLATES,
  labourCost,
  newLabour,
  renderTemplate,
  templateVarsOf,
  whatsappLink,
} from '../lib/workshop';
import { uid } from '../lib/storage';
import {
  itemStatusMeta,
  ORDER_STATUSES,
  orderStatusMeta,
  itemStatus,
  daysUntilDue,
  isOverdue,
  nextOrderCode,
  searchOrders,
  sortOrders,
  summarizeOrders,
} from '../lib/tracking';
import type {
  CalculatorInputs,
  CatalogProduct,
  Customer,
  FilamentSpool,
  Order,
  OrderItem,
  OrderStatus,
} from '../types';
import { STATE_META, canPrint, type LiveStatus, type PrinterLink } from '../lib/printerLink';
import { KanbanBoard } from './KanbanBoard';
import { Banner, NumberField, Section, Slider, TextField } from './ui';

interface OrdersPanelProps {
  orders: Order[];
  onChange: (orders: Order[]) => void;
  catalog: CatalogProduct[];
  spools: FilamentSpool[];
  inputs: CalculatorInputs;
  now: number;
  /** Katalogdan "siparişe ekle" ile açılan sipariş. */
  focusOrderId: string | null;
  onGoToCalculator: () => void;
  /** Tanımlı yazıcılar ve son okunan durumları (baskıya gönderme için). */
  printers: PrinterLink[];
  printerStatuses: Record<string, LiveStatus>;
  /** Kalemi seçilen yazıcıya gönderir; sonucu App bildirir. */
  onSendToPrint: (order: Order, item: OrderItem, printer: PrinterLink) => Promise<void>;
  /** Cari kartları; fatura kesilirken bilgiler buradan gelir. */
  customers: Customer[];
  /** Siparişten fatura/proforma üretir. */
  onCreateInvoice: (order: Order) => void;
}

const ORDER_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h12l1 5H5l1-5z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8" />
    <path strokeLinecap="round" d="M10 12h4" />
  </svg>
);

type Filter = OrderStatus | 'all';

/**
 * Elle girilen birim fiyati okur.
 *
 * Bos alan "otomatik hesapla" demek oldugu icin `undefined` doner. Turkce
 * klavyede virgul yaygin oldugundan "150,50" da kabul edilir.
 */
function parseManualPrice(text: string): number | undefined {
  const clean = text.trim().replace(',', '.');
  if (!clean) return undefined;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100) / 100;
}

export function OrdersPanel({
  orders,
  onChange,
  catalog,
  spools,
  inputs,
  now,
  focusOrderId,
  onGoToCalculator,
  printers,
  printerStatuses,
  onSendToPrint,
  customers,
  onCreateInvoice,
}: OrdersPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [productToAdd, setProductToAdd] = useState('');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [board, setBoard] = useState(false);
  /** Yazıcı seçimi açık olan kalem. */
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);
  const [sendingItemId, setSendingItemId] = useState<string | null>(null);

  const send = async (order: Order, item: OrderItem, printer: PrinterLink) => {
    setPickerItemId(null);
    setSendingItemId(item.id);
    try {
      await onSendToPrint(order, item, printer);
    } finally {
      setSendingItemId(null);
    }
  };

  // Katalogdan gelen sipariş, kullanıcı başkasını açana kadar açık kalır.
  const expandedId = openId ?? focusOrderId;

  const summary = useMemo(
    () => summarizeOrders(orders, now, spools, inputs),
    [orders, now, spools, inputs],
  );

  const visible = useMemo(() => {
    // Önce arama, sonra statü: iki ölçüt birlikte çalışır.
    const found = searchOrders(orders, query, customers);
    const sorted = sortOrders(found, now);
    return filter === 'all' ? sorted : sorted.filter((o) => o.status === filter);
  }, [orders, query, customers, filter, now]);

  const pricings = useMemo(() => {
    const map = new Map<string, ReturnType<typeof priceOrder>>();
    for (const order of orders) map.set(order.id, priceOrder(order, spools, inputs));
    return map;
  }, [orders, spools, inputs]);

  const patchLabour = (order: Order, next: NonNullable<Order['labour']>) =>
    patchOrder(order.id, { labour: next });

  /** Bildirim metnini panoya alır; başarıyı kısa süre gösterir. */
  const copyText = (text: string, tag: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => setCopied(tag))
      .catch(() => setCopied('hata'));
    setTimeout(() => setCopied(null), 2200);
  };

  const patchOrder = (id: string, changes: Partial<Order>) =>
    onChange(orders.map((o) => (o.id === id ? { ...o, ...changes } : o)));

  const patchItem = (orderId: string, itemId: string, changes: Partial<OrderItem>) =>
    onChange(
      orders.map((o) =>
        o.id === orderId
          ? { ...o, items: o.items.map((i) => (i.id === itemId ? { ...i, ...changes } : i)) }
          : o,
      ),
    );

  const createOrder = () => {
    const order: Order = {
      id: uid('ord'),
      code: nextOrderCode(orders),
      customer: '',
      status: 'pending',
      dueDate: '',
      notes: '',
      createdAt: new Date(now).toISOString(),
      items: [],
      marginPct: inputs.marginPct,
    };
    onChange([...orders, order]);
    setOpenId(order.id);
  };

  const addCatalogItem = (order: Order) => {
    const product = catalog.find((p) => p.id === productToAdd);
    if (!product) return;
    patchOrder(order.id, {
      items: [...order.items, itemFromProduct(product, 1, spools, uid('item'))],
    });
    setProductToAdd('');
  };

  const addManualItem = (order: Order) =>
    patchOrder(order.id, {
      items: [
        ...order.items,
        {
          id: uid('item'),
          productId: null,
          name: 'Elle kalem',
          quantity: 1,
          printSeconds: 0,
          tools: [],
          assignment: {},
          manualUnitCost: 0,
          manualUnitPrice: 0,
        },
      ],
    });

  const removeItem = (order: Order, itemId: string) =>
    patchOrder(order.id, { items: order.items.filter((i) => i.id !== itemId) });

  const removeOrder = (id: string) => {
    onChange(orders.filter((o) => o.id !== id));
    if (expandedId === id) setOpenId('');
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'Açık sipariş',
            value: String(summary.openCount),
            sub: `${summary.total} kayıttan`,
          },
          {
            label: 'Bekleyen ciro',
            value: formatTRY(summary.openRevenue),
            sub: 'Teslim edilmemiş',
          },
          {
            label: 'Teslim edilen',
            value: formatTRY(summary.deliveredRevenue),
            sub: `${summary.counts.delivered} sipariş`,
          },
          {
            label: 'Toplam kâr',
            value: formatTRY(summary.profit),
            sub: summary.overdue > 0 ? `${summary.overdue} sipariş gecikti` : 'Güncel fiyatlarla',
            warn: summary.overdue > 0,
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
                  ? 'font-semibold text-rose-500 dark:text-rose-400'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {card.sub}
            </p>
          </div>
        ))}
      </div>

      <Section
        title="Siparişler"
        icon={ORDER_ICON}
        description="Bir fişe birden fazla ürün ekleyin. Tutarlar her açılışta güncel filament ve elektrik fiyatlarıyla yeniden hesaplanır."
        action={
          <button
            type="button"
            className="btn-primary !px-3 !py-1.5 !text-xs"
            onClick={createOrder}
          >
            + Yeni sipariş
          </button>
        }
      >
        <div className="mb-3">
          <div className="relative">
            <input
              type="search"
              aria-label="Siparişlerde ara"
              className="field-input pl-9"
              value={query}
              placeholder="Sipariş no, müşteri, telefon, vergi no veya ürün adı"
              onChange={(event) => setQuery(event.target.value)}
            />
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
            </svg>
            {query && (
              <button
                type="button"
                aria-label="Aramayı temizle"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
          {query && (
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              "{query}" için {visible.length} sipariş bulundu
              {filter !== 'all' && ' (statü filtresi de uygulanıyor)'}
            </p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <div className="mr-auto flex gap-1">
            {[
              [false, 'Liste'],
              [true, 'Pano'],
            ].map(([value, label]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => setBoard(Boolean(value))}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  board === value
                    ? 'bg-accent-500/15 text-accent-600 dark:bg-accent-500/20 dark:text-accent-300'
                    : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {(['all', ...ORDER_STATUSES] as Filter[]).map((value) => {
            const count = value === 'all' ? orders.length : summary.counts[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cx(
                  'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition',
                  filter === value
                    ? 'bg-accent-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.12]',
                )}
              >
                {value === 'all' ? 'Tümü' : orderStatusMeta(value).label} ({count})
              </button>
            );
          })}
        </div>

        {board ? (
          <KanbanBoard
            orders={visible}
            totals={
              new Map(orders.map((order) => [order.id, pricings.get(order.id)?.salePrice ?? 0]))
            }
            now={now}
            onStatusChange={(order, status) => patchOrder(order.id, { status })}
            onOpen={(orderId) => {
              setBoard(false);
              setOpenId(orderId);
            }}
          />
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-white/10">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {orders.length === 0 ? 'Henüz sipariş yok.' : 'Bu durumda sipariş yok.'}
            </p>
            {orders.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                "Yeni sipariş" ile bir fiş açıp içine hazır ürün ekleyin.
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((order) => {
              const pricing = pricings.get(order.id);
              const late = isOverdue(order, now);
              const days = daysUntilDue(order, now);
              const expanded = expandedId === order.id;

              return (
                <li
                  key={order.id}
                  className={cx(
                    'rounded-xl border transition',
                    late
                      ? 'border-rose-300 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/[0.07]'
                      : expanded
                        ? 'border-accent-500/40 bg-accent-500/[0.04] dark:border-accent-500/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 p-3.5">
                    <button
                      type="button"
                      onClick={() => setOpenId(expanded ? '' : order.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-slate-400">
                          {order.code}
                        </span>
                        <span className={cx('chip', orderStatusMeta(order.status).chip)}>
                          {orderStatusMeta(order.status).label}
                        </span>
                        {late && (
                          <span className="chip bg-rose-500/15 text-rose-600 dark:text-rose-300">
                            {Math.abs(days ?? 0)} gün gecikti
                          </span>
                        )}
                        {!late && days !== null && days <= 3 && order.status !== 'delivered' && (
                          <span className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300">
                            {days === 0 ? 'Bugün teslim' : `${days} gün kaldı`}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {order.customer || 'Müşteri belirtilmedi'}
                        <span className="font-normal text-slate-500 dark:text-slate-400">
                          {' '}
                          — {pricing?.itemCount ?? 0} parça / {order.items.length} kalem
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {order.dueDate
                          ? `teslim ${formatDate(order.dueDate)}`
                          : 'teslim tarihi yok'}
                        {pricing && pricing.totalHours > 0
                          ? ` · ${formatDuration(pricing.totalHours)} baskı`
                          : ''}
                      </p>
                    </button>

                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                          {formatTRY(pricing?.salePrice ?? 0)}
                        </p>
                        <p className="text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          +{formatTRY(pricing?.profit ?? 0)} · {formatPercent(order.marginPct, 0)}
                        </p>
                      </div>
                      <select
                        aria-label={`${order.code} durumu`}
                        className="field-input !w-auto !py-1.5 !text-[11px]"
                        value={order.status}
                        onChange={(event) =>
                          patchOrder(order.id, { status: event.target.value as OrderStatus })
                        }
                      >
                        {ORDER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {orderStatusMeta(status).label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeOrder(order.id)}
                        aria-label="Siparişi sil"
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

                  {expanded && pricing && (
                    <div className="space-y-4 border-t border-slate-200 p-3.5 dark:border-white/10">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="field-label" htmlFor={`musteri-${order.id}`}>
                            Müşteri
                          </label>
                          <input
                            id={`musteri-${order.id}`}
                            list={`cari-listesi-${order.id}`}
                            className="field-input"
                            value={order.customer}
                            placeholder="örn. Ahmet Yılmaz"
                            onChange={(event) => {
                              // Kayıtlı bir cariyle birebir eşleşirse kart bağlanır.
                              const written = event.target.value;
                              const match = customers.find((c) => displayName(c) === written);
                              patchOrder(order.id, {
                                customer: written,
                                customerId: match?.id,
                              });
                            }}
                          />
                          <datalist id={`cari-listesi-${order.id}`}>
                            {customers.map((customer) => (
                              <option key={customer.id} value={displayName(customer)} />
                            ))}
                          </datalist>
                          <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                            {order.customerId
                              ? 'Cari kartı bağlı; fatura bilgileri oradan gelir.'
                              : customers.length > 0
                                ? 'Listeden seçerseniz fatura bilgileri otomatik dolar.'
                                : 'Faturalar sekmesinden cari ekleyebilirsiniz.'}
                          </p>
                        </div>
                        <div>
                          <label className="field-label" htmlFor={`due-${order.id}`}>
                            Teslim tarihi
                          </label>
                          <input
                            id={`due-${order.id}`}
                            type="date"
                            className="field-input"
                            value={order.dueDate}
                            onChange={(event) =>
                              patchOrder(order.id, { dueDate: event.target.value })
                            }
                          />
                        </div>
                        <TextField
                          label="Not"
                          value={order.notes}
                          onChange={(notes) => patchOrder(order.id, { notes })}
                          placeholder="Kargo, renk tercihi…"
                        />
                      </div>

                      <Slider
                        label="Bu sipariş için kâr marjı"
                        value={order.marginPct}
                        onChange={(marginPct) => patchOrder(order.id, { marginPct })}
                        min={0}
                        max={300}
                        step={5}
                        format={(value) => `%${value}`}
                      />

                      <div className="space-y-2">
                        <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                          Kalemler ({order.items.length})
                        </p>

                        {order.items.length === 0 && (
                          <Banner tone="info">
                            Fiş boş. Aşağıdan hazır ürün ekleyin ya da yeni bir dosya yükleyip hazır
                            ürün olarak kaydedin.
                          </Banner>
                        )}

                        {pricing.items.map(({ item, netCost, salePrice }) => (
                          <div
                            key={item.id}
                            className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.04]"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {item.tools.map((tool) => (
                                    <span
                                      key={tool.toolIndex}
                                      className="size-4 rounded border border-black/10 dark:border-white/20"
                                      style={{ background: tool.colorHex }}
                                      title={`Renk ${tool.toolIndex} · ${tool.colorHex}`}
                                    />
                                  ))}
                                  <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                                    {item.name}
                                  </p>
                                  {item.productId === null && (
                                    <span className="chip bg-slate-500/15 text-slate-500 dark:text-slate-400">
                                      elle
                                    </span>
                                  )}
                                  <span
                                    className={cx('chip', itemStatusMeta(itemStatus(item)).chip)}
                                  >
                                    {itemStatusMeta(itemStatus(item)).label}
                                  </span>
                                </div>
                                {item.tools.length > 0 && (
                                  <p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                                    {formatDuration(item.printSeconds / 3600)} ·{' '}
                                    {formatNumber(
                                      item.tools.reduce((s, t) => s + t.modelGrams, 0),
                                      1,
                                    )}{' '}
                                    g
                                  </p>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-2">
                                <div className="w-20">
                                  <NumberField
                                    label="Adet"
                                    value={item.quantity}
                                    onChange={(quantity) =>
                                      patchItem(order.id, item.id, { quantity })
                                    }
                                    min={1}
                                  />
                                </div>
                                <div className="text-right">
                                  <p className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                                    {formatTRY(salePrice)}
                                  </p>
                                  <p className="text-[10px] tabular-nums text-slate-400">
                                    maliyet {formatTRY(netCost)}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeItem(order, item.id)}
                                  aria-label="Kalemi sil"
                                  className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15"
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
                              </div>
                            </div>

                            {item.gcodeId && (
                              <div className="mt-2 rounded-lg bg-slate-100/70 p-2 dark:bg-white/[0.05]">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                    {itemStatus(item) === 'printing' && item.printerName
                                      ? `${item.printerName} yazıcısında üretimde`
                                      : 'G-code kayıtlı · doğrudan yazıcıya gönderilebilir'}
                                  </p>
                                  <div className="flex items-center gap-1.5">
                                    {itemStatus(item) === 'printing' && (
                                      <button
                                        type="button"
                                        className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                                        onClick={() =>
                                          patchItem(order.id, item.id, { status: 'done' })
                                        }
                                      >
                                        Tamamlandı
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="btn-primary !px-3 !py-1 !text-[11px]"
                                      disabled={sendingItemId === item.id}
                                      onClick={() =>
                                        setPickerItemId((prev) =>
                                          prev === item.id ? null : item.id,
                                        )
                                      }
                                    >
                                      {sendingItemId === item.id
                                        ? 'Gönderiliyor…'
                                        : 'Yazıcıya Gönder'}
                                    </button>
                                  </div>
                                </div>

                                {pickerItemId === item.id && (
                                  <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-white/10">
                                    {printers.length === 0 && (
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                        Önce "Yazıcılar" sekmesinden bir yazıcı tanımlayın.
                                      </p>
                                    )}
                                    {printers.map((printer) => {
                                      const state = printerStatuses[printer.id]?.state ?? 'unknown';
                                      const meta = STATE_META[state];
                                      const ready = canPrint(state);
                                      return (
                                        <button
                                          key={printer.id}
                                          type="button"
                                          disabled={!ready}
                                          onClick={() => void send(order, item, printer)}
                                          className={cx(
                                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] transition',
                                            ready
                                              ? 'hover:bg-accent-500/10'
                                              : 'cursor-not-allowed opacity-50',
                                          )}
                                        >
                                          <span className={cx('size-1.5 rounded-full', meta.dot)} />
                                          <span className="flex-1 truncate font-semibold text-slate-700 dark:text-slate-200">
                                            {printer.name}
                                          </span>
                                          <span className="shrink-0 text-slate-400 dark:text-slate-500">
                                            {meta.label}
                                          </span>
                                        </button>
                                      );
                                    })}
                                    {printers.length > 0 &&
                                      !printers.some((p) =>
                                        canPrint(printerStatuses[p.id]?.state ?? 'unknown'),
                                      ) && (
                                        <p className="pt-1 text-[11px] text-amber-600 dark:text-amber-400">
                                          Boşta yazıcı yok. Baskı bitince tekrar deneyin.
                                        </p>
                                      )}
                                  </div>
                                )}
                              </div>
                            )}

                            {item.tools.length > 0 && (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {item.tools.map((tool) => (
                                  <label
                                    key={tool.toolIndex}
                                    className="flex items-center gap-2 text-[11px]"
                                  >
                                    <span
                                      className="size-4 shrink-0 rounded border border-black/10 dark:border-white/20"
                                      style={{ background: tool.colorHex }}
                                    />
                                    <select
                                      aria-label={`${item.name} renk ${tool.toolIndex} filamenti`}
                                      className="field-input !py-1.5 !text-[11px]"
                                      value={item.assignment[tool.toolIndex] ?? ''}
                                      onChange={(event) =>
                                        patchItem(order.id, item.id, {
                                          assignment: {
                                            ...item.assignment,
                                            [tool.toolIndex]: event.target.value || null,
                                          },
                                        })
                                      }
                                    >
                                      <option value="">Filament seçin…</option>
                                      {spools.map((spool) => (
                                        <option key={spool.id} value={spool.id}>
                                          {formatSpoolLabel(spool)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                ))}
                              </div>
                            )}

                            {item.tools.length > 0 && (
                              <div className="mt-2">
                                <TextField
                                  label="Satış fiyatı — birim (₺)"
                                  value={
                                    item.manualUnitPrice !== undefined
                                      ? String(item.manualUnitPrice)
                                      : ''
                                  }
                                  onChange={(text) =>
                                    patchItem(order.id, item.id, {
                                      manualUnitPrice: parseManualPrice(text),
                                    })
                                  }
                                  placeholder="Otomatik"
                                  hint="Boş bırakılırsa fiyat malzeme ve süreden hesaplanır."
                                />
                              </div>
                            )}

                            {item.tools.length === 0 && (
                              <div className="mt-2 grid grid-cols-3 gap-2">
                                <TextField
                                  label="Ad"
                                  value={item.name}
                                  onChange={(name) => patchItem(order.id, item.id, { name })}
                                />
                                <NumberField
                                  label="Birim maliyet"
                                  value={item.manualUnitCost ?? 0}
                                  onChange={(manualUnitCost) =>
                                    patchItem(order.id, item.id, { manualUnitCost })
                                  }
                                  suffix="TL"
                                  step={5}
                                />
                                <NumberField
                                  label="Birim fiyat"
                                  value={item.manualUnitPrice ?? 0}
                                  onChange={(manualUnitPrice) =>
                                    patchItem(order.id, item.id, { manualUnitPrice })
                                  }
                                  suffix="TL"
                                  step={5}
                                />
                              </div>
                            )}
                          </div>
                        ))}

                        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3 dark:border-white/10">
                          <div className="min-w-[12rem] flex-1">
                            <label className="field-label" htmlFor={`add-${order.id}`}>
                              Hazır ürünlerden seç
                            </label>
                            <select
                              id={`add-${order.id}`}
                              className="field-input !py-2 !text-[12px]"
                              value={productToAdd}
                              onChange={(event) => setProductToAdd(event.target.value)}
                              disabled={catalog.length === 0}
                            >
                              <option value="">
                                {catalog.length === 0 ? 'Katalog boş' : 'Ürün seçin…'}
                              </option>
                              {catalog.map((product) => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                  {product.tools.length > 1
                                    ? ` (${product.tools.length} renk)`
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="btn-primary !py-2 !text-xs"
                            onClick={() => addCatalogItem(order)}
                            disabled={!productToAdd}
                          >
                            Ekle
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !py-2 !text-xs"
                            onClick={() => addManualItem(order)}
                          >
                            Elle kalem
                          </button>
                          <button
                            type="button"
                            className="btn-ghost !py-2 !text-xs"
                            onClick={onGoToCalculator}
                          >
                            Yeni dosya yükle
                          </button>
                        </div>
                      </div>

                      {pricing.warnings.length > 0 && (
                        <Banner tone="warning">
                          <ul className="list-inside list-disc space-y-0.5">
                            {pricing.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </Banner>
                      )}

                      <div className="rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                              Baski sonrasi iscilik
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Saatlik ucretle hesaplanir; maliyete ve satisa birebir eklenir.
                            </p>
                          </div>
                          <p className="text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                            {formatTRY(pricing.labourCost)}
                          </p>
                        </div>

                        {(order.labour ?? []).length > 0 && (
                          <div className="mt-2.5 space-y-1.5">
                            {(order.labour ?? []).map((item) => (
                              <div key={item.id} className="flex flex-wrap items-center gap-2">
                                <input
                                  aria-label="Iscilik adi"
                                  className="field-input min-w-[8rem] flex-1 !py-1.5 !text-[12px]"
                                  value={item.name}
                                  placeholder="Boyama"
                                  onChange={(event) =>
                                    patchLabour(
                                      order,
                                      (order.labour ?? []).map((l) =>
                                        l.id === item.id ? { ...l, name: event.target.value } : l,
                                      ),
                                    )
                                  }
                                />
                                <div className="relative w-20">
                                  <input
                                    aria-label="Saat"
                                    type="number"
                                    min={0}
                                    step={0.25}
                                    className="field-input !py-1.5 pr-7 !text-[12px]"
                                    value={item.hours || ''}
                                    onChange={(event) =>
                                      patchLabour(
                                        order,
                                        (order.labour ?? []).map((l) =>
                                          l.id === item.id
                                            ? { ...l, hours: Number(event.target.value) || 0 }
                                            : l,
                                        ),
                                      )
                                    }
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-400">
                                    sa
                                  </span>
                                </div>
                                <div className="relative w-24">
                                  <input
                                    aria-label="Saatlik ucret"
                                    type="number"
                                    min={0}
                                    step={10}
                                    className="field-input !py-1.5 pr-8 !text-[12px]"
                                    value={item.hourlyRate || ''}
                                    onChange={(event) =>
                                      patchLabour(
                                        order,
                                        (order.labour ?? []).map((l) =>
                                          l.id === item.id
                                            ? { ...l, hourlyRate: Number(event.target.value) || 0 }
                                            : l,
                                        ),
                                      )
                                    }
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-slate-400">
                                    TL
                                  </span>
                                </div>
                                <span className="w-20 shrink-0 text-right text-[12px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                                  {formatTRY(labourCost(item))}
                                </span>
                                <button
                                  type="button"
                                  aria-label="Iscilik kalemini sil"
                                  onClick={() =>
                                    patchLabour(
                                      order,
                                      (order.labour ?? []).filter((l) => l.id !== item.id),
                                    )
                                  }
                                  className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/15"
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
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {LABOUR_PRESETS.map((preset) => (
                            <button
                              key={preset.name}
                              type="button"
                              className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                              onClick={() =>
                                patchLabour(order, [
                                  ...(order.labour ?? []),
                                  newLabour(
                                    uid('isc'),
                                    preset.name,
                                    preset.hours,
                                    DEFAULT_HOURLY_RATE,
                                  ),
                                ])
                              }
                            >
                              + {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-xl bg-slate-100/70 p-3 sm:grid-cols-4 dark:bg-white/[0.05]">
                        {[
                          { label: 'Malzeme (model)', value: formatTRY(pricing.modelFilamentCost) },
                          { label: 'Atık', value: formatTRY(pricing.wasteFilamentCost) },
                          { label: 'Net maliyet', value: formatTRY(pricing.netCost) },
                          { label: 'Satış', value: formatTRY(pricing.salePrice), accent: true },
                        ].map((cell) => (
                          <div key={cell.label}>
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">
                              {cell.label}
                            </p>
                            <p
                              className={cx(
                                'text-sm font-bold tabular-nums',
                                cell.accent
                                  ? 'text-accent-600 dark:text-accent-400'
                                  : 'text-slate-800 dark:text-slate-100',
                              )}
                            >
                              {cell.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {(() => {
                        // Sablon siparisin GUNCEL statusune gore secilir; kargo
                        // alanlari yalnizca gerektiginde gosterilir.
                        const template = NOTIFY_TEMPLATES[order.status];
                        if (!template) return null;
                        const linked = customers.find((c) => c.id === order.customerId);
                        const message = renderTemplate(
                          template.body,
                          templateVarsOf(
                            order,
                            formatTRY(pricing.salePrice),
                            linked ? displayName(linked) : order.customer,
                          ),
                        );
                        const wa = linked?.phone ? whatsappLink(linked.phone, message) : null;

                        return (
                          <div className="rounded-xl border border-slate-200 p-3.5 dark:border-white/10">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                                Musteri bildirimi - {template.label}
                              </p>
                              {copied === order.id && (
                                <span className="chip bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                                  panoya kopyalandi
                                </span>
                              )}
                              {copied === 'hata' && (
                                <span className="chip bg-rose-500/15 text-rose-600 dark:text-rose-300">
                                  kopyalanamadi
                                </span>
                              )}
                            </div>

                            {order.status === 'delivered' && (
                              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                                <input
                                  aria-label="Kargo firmasi"
                                  className="field-input !py-1.5 !text-[12px]"
                                  value={order.shippingCarrier ?? ''}
                                  placeholder="Kargo firmasi (orn. Yurtici)"
                                  onChange={(event) =>
                                    patchOrder(order.id, { shippingCarrier: event.target.value })
                                  }
                                />
                                <input
                                  aria-label="Kargo takip kodu"
                                  className="field-input !py-1.5 !text-[12px]"
                                  value={order.trackingCode ?? ''}
                                  placeholder="Takip kodu"
                                  onChange={(event) =>
                                    patchOrder(order.id, { trackingCode: event.target.value })
                                  }
                                />
                              </div>
                            )}

                            <p className="mt-2.5 whitespace-pre-line rounded-lg bg-slate-100/70 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
                              {message}
                            </p>

                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                className="btn-primary !px-3 !py-1 !text-[11px]"
                                onClick={() => copyText(message, order.id)}
                              >
                                Kopyala
                              </button>
                              {wa && (
                                <a
                                  href={wa}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn-ghost !px-3 !py-1 !text-[11px]"
                                >
                                  WhatsApp ile gonder
                                </a>
                              )}
                              {!wa && (
                                <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">
                                  WhatsApp icin cari kartinda telefon gerekli.
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Fatura, bu satış fiyatlarını ve müşteri bilgilerini kopyalar; sonradan
                          fiyat değişse bile belge sabit kalır.
                        </p>
                        <button
                          type="button"
                          className="btn-primary !px-3 !py-1.5 !text-xs"
                          onClick={() => onCreateInvoice(order)}
                          disabled={order.items.length === 0}
                        >
                          Fatura Oluştur
                        </button>
                      </div>
                    </div>
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
