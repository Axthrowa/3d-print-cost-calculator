import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import {
  defaultAssignment,
  priceProduct,
  productModelGrams,
  productTotalGrams,
  productWasteGrams,
} from '../lib/catalog';
import { formatDate, formatDuration, formatNumber, formatTRY } from '../lib/format';
import type { CalculatorInputs, CatalogProduct, FilamentSpool } from '../types';
import { Banner, Section, TextField } from './ui';

interface CatalogPanelProps {
  catalog: CatalogProduct[];
  onChange: (catalog: CatalogProduct[]) => void;
  spools: FilamentSpool[];
  inputs: CalculatorInputs;
  /** Ürünü hesaplayıcıya yükler. */
  onLoadIntoCalculator: (product: CatalogProduct) => void;
  /** Ürünü yeni bir siparişe ekler. */
  onAddToOrder: (product: CatalogProduct) => void;
}

const CATALOG_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinejoin="round" d="M4 16V8l8-4 8 4v8l-8 4z" />
    <path strokeLinejoin="round" d="M4 8l8 4 8-4M12 12v8" />
  </svg>
);

/**
 * Elle girilen fiyati okur.
 *
 * Bos alan "otomatik hesapla" demektir (null). Turkce klavyede virgul
 * yaygin oldugu icin "150,50" da kabul edilir. Gecersiz girdi otomatige
 * dusurulur; sessizce 0 yazip urunu bedava gostermek daha kotu olurdu.
 */
function parsePrice(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

export function CatalogPanel({
  catalog,
  onChange,
  spools,
  inputs,
  onLoadIntoCalculator,
  onAddToOrder,
}: CatalogPanelProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  // Bos string "otomatik fiyat" demek; bu yuzden sayi degil metin tutulur.
  const [draftPrice, setDraftPrice] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    const sorted = [...catalog].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!needle) return sorted;
    return sorted.filter((p) => p.name.toLocaleLowerCase('tr-TR').includes(needle));
  }, [catalog, query]);

  /** Her ürün güncel envanter fiyatlarıyla yeniden fiyatlandırılır. */
  const priced = useMemo(
    () =>
      visible.map((product) => {
        const result = priceProduct(
          product,
          1,
          defaultAssignment(product.tools, spools),
          spools,
          inputs,
        );
        return {
          product,
          result,
          salePrice: product.manualPrice ?? result.salePrice,
        };
      }),
    [visible, spools, inputs],
  );

  const startEdit = (product: CatalogProduct) => {
    setEditingId(product.id);
    setDraftName(product.name);
    setDraftNotes(product.notes);
    setDraftPrice(product.manualPrice !== undefined ? String(product.manualPrice) : '');
  };

  const saveEdit = () => {
    if (!editingId) return;
    const manualPrice = parsePrice(draftPrice);
    onChange(
      catalog.map((p) => {
        if (p.id !== editingId) return p;
        const next: CatalogProduct = {
          ...p,
          name: draftName.trim() || p.name,
          notes: draftNotes.trim(),
        };
        // Alan bosaltilirsa otomatik fiyata donulur.
        if (manualPrice === null) delete next.manualPrice;
        else next.manualPrice = manualPrice;
        return next;
      }),
    );
    setEditingId(null);
  };

  const remove = (id: string) => onChange(catalog.filter((p) => p.id !== id));

  const totalGrams = catalog.reduce((sum, p) => sum + productTotalGrams(p), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Kayıtlı ürün', value: String(catalog.length), sub: 'Hazır ürünler' },
          {
            label: 'Çok renkli',
            value: String(catalog.filter((p) => p.tools.length > 1).length),
            sub: 'AMS / MMU baskısı',
          },
          {
            label: 'Toplam malzeme',
            value: `${formatNumber(totalGrams, 0)} g`,
            sub: 'Tüm ürünlerin tek adedi',
          },
        ].map((card) => (
          <div key={card.label} className="panel p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
              {card.value}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{card.sub}</p>
          </div>
        ))}
      </div>

      <Section
        title="Hazır Ürünler"
        icon={CATALOG_ICON}
        description="Kaydedilen ürünler yalnızca malzeme ve süre bilgisini tutar; fiyat her görüntülemede güncel envanterle yeniden hesaplanır."
        action={
          catalog.length > 0 && (
            <input
              className="field-input !w-44 !py-1.5 !text-xs"
              placeholder="Ürün ara…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )
        }
      >
        {catalog.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-white/10">
            <p className="text-sm text-slate-500 dark:text-slate-400">Henüz hazır ürün yok.</p>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              "Yeni Hesaplama" sayfasında bir .gcode veya .stl yükleyip "Hazır ürün olarak kaydet"
              deyin.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <Banner tone="info">Aramanıza uyan ürün bulunamadı.</Banner>
        ) : (
          <ul className="space-y-2">
            {priced.map(({ product, result, salePrice }) => (
              <li
                key={product.id}
                className={cx(
                  'rounded-xl border p-3.5 transition',
                  editingId === product.id
                    ? 'border-accent-500/50 bg-accent-500/[0.07]'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20',
                )}
              >
                {editingId === product.id ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField label="Ürün adı" value={draftName} onChange={setDraftName} />
                      <TextField label="Not" value={draftNotes} onChange={setDraftNotes} />
                      <TextField
                        label="Satış fiyatı (₺)"
                        value={draftPrice}
                        onChange={setDraftPrice}
                        placeholder="Otomatik"
                        hint="Elle fiyat girmek için yazın. Boş bırakırsanız fiyat malzeme ve süreden hesaplanır."
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-ghost !py-2 !text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        Vazgeç
                      </button>
                      <button
                        type="button"
                        className="btn-primary !py-2 !text-xs"
                        onClick={saveEdit}
                      >
                        Kaydet
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {product.name}
                        </p>
                        <span className="chip bg-slate-500/15 text-slate-500 dark:text-slate-400">
                          {product.source === 'gcode'
                            ? 'G-code'
                            : product.source === 'stl'
                              ? 'STL'
                              : 'Manuel'}
                        </span>
                        {product.manualPrice !== undefined && (
                          <span
                            className="chip bg-amber-500/15 text-amber-600 dark:text-amber-300"
                            title="Satış fiyatı elle girildi; envanter değişse de sabit kalır."
                          >
                            Elle fiyat
                          </span>
                        )}
                        {product.tools.length > 1 && (
                          <span className="chip bg-violet-500/15 text-violet-600 dark:text-violet-300">
                            {product.tools.length} renk
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {product.tools.map((tool) => (
                          <span
                            key={tool.toolIndex}
                            className="size-4 rounded border border-black/10 dark:border-white/20"
                            style={{ background: tool.colorHex }}
                            title={`Renk ${tool.toolIndex} · ${tool.colorHex} · ${formatNumber(
                              tool.modelGrams,
                              1,
                            )} g`}
                          />
                        ))}
                        <span className="ml-1 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                          {formatDuration(product.printSeconds / 3600)} ·{' '}
                          {formatNumber(productModelGrams(product), 1)} g
                          {productWasteGrams(product) > 0 && (
                            <span className="text-rose-500 dark:text-rose-400">
                              {' '}
                              + {formatNumber(productWasteGrams(product), 1)} g atık
                            </span>
                          )}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                        {formatDate(product.createdAt)} tarihinde eklendi
                        {product.sourceFile && ` · ${product.sourceFile}`}
                        {product.notes && ` · ${product.notes}`}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                          {formatTRY(result.netCost)}
                        </p>
                        <p className="text-[11px] tabular-nums text-accent-600 dark:text-accent-400">
                          satış {formatTRY(salePrice)}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-primary !px-2.5 !py-1.5 !text-[11px]"
                          onClick={() => onAddToOrder(product)}
                        >
                          Siparişe ekle
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !px-2.5 !py-1.5 !text-[11px]"
                          onClick={() => onLoadIntoCalculator(product)}
                        >
                          Hesaplayıcıya yükle
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(product)}
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
                          onClick={() => remove(product.id)}
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
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
