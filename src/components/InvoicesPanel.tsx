import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { formatDate, formatTRY } from '../lib/format';
import {
  INVOICE_KIND_META,
  VAT_RATES,
  displayName,
  invoiceTotals,
  newCustomer,
  searchCustomers,
  sortInvoices,
  summarizeInvoices,
  validateCustomer,
  validateInvoice,
  invoiceFileName,
} from '../lib/invoice';
import { renderInvoiceHtml } from '../lib/invoiceHtml';
import { exportPdf, pdfSupported, revealPdf } from '../lib/pdf';
import { uid } from '../lib/storage';
import type { Branding, Customer, Invoice, InvoiceKind, SellerInfo } from '../types';
import { Banner, NumberField, Section, SelectField, Spinner, TextField } from './ui';

interface InvoicesPanelProps {
  invoices: Invoice[];
  onInvoicesChange: (invoices: Invoice[]) => void;
  customers: Customer[];
  onCustomersChange: (customers: Customer[]) => void;
  seller: SellerInfo;
  onSellerChange: (seller: SellerInfo) => void;
  /** Katalogdan/siparişten açılan fatura. */
  focusInvoiceId: string | null;
  /** Kurumsal kimlik: logo ve imza faturaya basılır. */
  branding: Branding;
  onToast: (tone: 'success' | 'warning' | 'error', text: string) => void;
}

const INVOICE_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinejoin="round" d="M6 3h9l4 4v14H6z" />
    <path strokeLinejoin="round" d="M15 3v4h4" />
    <path strokeLinecap="round" d="M9 12h6M9 16h4" />
  </svg>
);

const CUSTOMER_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="8" r="3.5" />
    <path strokeLinecap="round" d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </svg>
);

type Tab = 'invoices' | 'customers' | 'seller';

export function InvoicesPanel({
  invoices,
  onInvoicesChange,
  customers,
  onCustomersChange,
  seller,
  onSellerChange,
  focusInvoiceId,
  branding,
  onToast,
}: InvoicesPanelProps) {
  const [tab, setTab] = useState<Tab>('invoices');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Customer | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; path: string } | null>(null);

  const expandedId = openId ?? focusInvoiceId;
  const ordered = useMemo(() => sortInvoices(invoices), [invoices]);
  const summary = useMemo(() => summarizeInvoices(invoices), [invoices]);
  const found = useMemo(() => searchCustomers(customers, query), [customers, query]);

  const patchInvoice = (id: string, changes: Partial<Invoice>) =>
    onInvoicesChange(invoices.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const removeInvoice = (invoice: Invoice) => {
    onInvoicesChange(invoices.filter((i) => i.id !== invoice.id));
    onToast('warning', `${invoice.number} silindi.`);
  };

  /** Önizleme, yazdırma ve PDF aynı belgeyi kullanır. */
  const documentOf = (invoice: Invoice) => renderInvoiceHtml(invoice, seller, branding);

  const printInvoice = (invoice: Invoice) => {
    const frame = document.getElementById(`fatura-${invoice.id}`) as HTMLIFrameElement | null;
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };

  const savePdf = async (invoice: Invoice) => {
    setBusyId(invoice.id);
    setSaved(null);
    try {
      const result = await exportPdf(documentOf(invoice), invoiceFileName(invoice));
      if (result.ok && result.path) {
        setSaved({ id: invoice.id, path: result.path });
        onToast('success', `${invoice.number} PDF olarak kaydedildi.`);
      } else {
        onToast('error', result.error ?? 'PDF üretilemedi.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveCustomer = () => {
    if (!draft) return;
    const problems = validateCustomer(draft);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    const exists = customers.some((c) => c.id === draft.id);
    onCustomersChange(
      exists ? customers.map((c) => (c.id === draft.id ? draft : c)) : [...customers, draft],
    );
    setDraft(null);
    setErrors([]);
    onToast('success', `${displayName(draft)} kaydedildi.`);
  };

  const removeCustomer = (customer: Customer) => {
    const used = invoices.some((i) => i.customerId === customer.id);
    onCustomersChange(customers.filter((c) => c.id !== customer.id));
    onToast(
      'warning',
      used
        ? `${displayName(customer)} silindi. Kesilmiş faturalardaki bilgiler korunur.`
        : `${displayName(customer)} silindi.`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Fatura', value: String(summary.invoiced), sub: `${summary.proforma} proforma` },
          { label: 'Kesilen tutar', value: formatTRY(summary.total), sub: 'KDV dahil' },
          { label: 'Toplam KDV', value: formatTRY(summary.vat), sub: 'beyan edilecek' },
          { label: 'Cari', value: String(customers.length), sub: 'kayıtlı müşteri' },
        ].map((card) => (
          <div key={card.label} className="panel p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">
              {card.value}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['invoices', `Faturalar (${invoices.length})`],
            ['customers', `Cariler (${customers.length})`],
            ['seller', 'Firma bilgilerim'],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cx(
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              tab === id
                ? 'bg-accent-500/15 text-accent-600 dark:bg-accent-500/20 dark:text-accent-300'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && (
        <Section
          title="Faturalar"
          icon={INVOICE_ICON}
          description="Siparişten oluşturulan fatura ve proformalar. PDF olarak kaydedebilirsiniz."
        >
          {invoices.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-[12px] text-slate-500 dark:border-white/10 dark:text-slate-400">
              Henüz fatura yok. Siparişler sekmesinde bir siparişi açıp{' '}
              <span className="font-semibold">Fatura Oluştur</span> deyin.
            </p>
          ) : (
            <div className="space-y-2.5">
              {ordered.map((invoice) => {
                const totals = invoiceTotals(invoice);
                const meta = INVOICE_KIND_META[invoice.kind];
                const open = expandedId === invoice.id;
                const problems = validateInvoice(invoice);

                return (
                  <div
                    key={invoice.id}
                    className="rounded-xl border border-slate-200 dark:border-white/10"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? '' : invoice.id)}
                      className="flex w-full flex-wrap items-center gap-2 px-3.5 py-3 text-left"
                    >
                      <span className={cx('chip', meta.chip)}>{meta.label}</span>
                      <span className="text-[13px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                        {invoice.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500 dark:text-slate-400">
                        {displayName(invoice.customer)} · {formatDate(invoice.issuedAt)}
                      </span>
                      <span className="text-[13px] font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatTRY(totals.grand)}
                      </span>
                    </button>

                    {open && (
                      <div className="space-y-3 border-t border-slate-200 p-3.5 dark:border-white/10">
                        {problems.length > 0 && (
                          <Banner tone="warning">
                            <ul className="list-inside list-disc">
                              {problems.map((problem) => (
                                <li key={problem}>{problem}</li>
                              ))}
                            </ul>
                          </Banner>
                        )}

                        <div className="grid gap-3 sm:grid-cols-4">
                          <SelectField<InvoiceKind>
                            label="Belge türü"
                            value={invoice.kind}
                            options={[
                              { value: 'proforma', label: 'Proforma' },
                              { value: 'invoice', label: 'Fatura' },
                            ]}
                            onChange={(kind) => patchInvoice(invoice.id, { kind })}
                          />
                          <SelectField
                            label="KDV oranı"
                            value={String(invoice.vatRate)}
                            options={VAT_RATES.map((rate) => ({
                              value: String(rate),
                              label: `%${rate}`,
                            }))}
                            onChange={(value) =>
                              patchInvoice(invoice.id, { vatRate: Number(value) })
                            }
                          />
                          <SelectField
                            label="Fiyatlar"
                            value={invoice.vatIncluded ? 'dahil' : 'haric'}
                            options={[
                              { value: 'haric', label: 'KDV hariç' },
                              { value: 'dahil', label: 'KDV dahil' },
                            ]}
                            onChange={(value) =>
                              patchInvoice(invoice.id, { vatIncluded: value === 'dahil' })
                            }
                          />
                          <NumberField
                            label="İskonto"
                            value={invoice.discount}
                            onChange={(discount) => patchInvoice(invoice.id, { discount })}
                            suffix="TL"
                            min={0}
                          />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <label className="field-label" htmlFor={`tarih-${invoice.id}`}>
                              Düzenlenme
                            </label>
                            <input
                              id={`tarih-${invoice.id}`}
                              type="date"
                              className="field-input"
                              value={invoice.issuedAt}
                              onChange={(event) =>
                                patchInvoice(invoice.id, { issuedAt: event.target.value })
                              }
                            />
                          </div>
                          <div>
                            <label className="field-label" htmlFor={`vade-${invoice.id}`}>
                              Vade
                            </label>
                            <input
                              id={`vade-${invoice.id}`}
                              type="date"
                              className="field-input"
                              value={invoice.dueDate}
                              onChange={(event) =>
                                patchInvoice(invoice.id, { dueDate: event.target.value })
                              }
                            />
                          </div>
                          <TextField
                            label="Not"
                            value={invoice.notes}
                            onChange={(notes) => patchInvoice(invoice.id, { notes })}
                            placeholder="Teslim / ödeme notu"
                          />
                        </div>

                        {/* Önizleme, yazdırma ve PDF aynı belgeyi kullanır. */}
                        <iframe
                          id={`fatura-${invoice.id}`}
                          title={`${invoice.number} önizleme`}
                          srcDoc={documentOf(invoice)}
                          className="h-[520px] w-full rounded-xl border border-slate-200 bg-white dark:border-white/10"
                        />

                        {saved?.id === invoice.id && (
                          <Banner tone="success">
                            Kaydedildi: <span className="font-mono text-[10px]">{saved.path}</span>{' '}
                            <button
                              type="button"
                              className="underline"
                              onClick={() => void revealPdf(saved.path)}
                            >
                              klasörü aç
                            </button>
                          </Banner>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="btn-primary !px-3 !py-1.5 !text-xs"
                            disabled={busyId === invoice.id || !pdfSupported()}
                            onClick={() => void savePdf(invoice)}
                          >
                            {busyId === invoice.id ? 'Hazırlanıyor…' : 'PDF olarak kaydet'}
                          </button>
                          {busyId === invoice.id && <Spinner className="size-4 text-accent-500" />}
                          <button
                            type="button"
                            className="btn-ghost !px-3 !py-1.5 !text-xs"
                            onClick={() => printInvoice(invoice)}
                          >
                            Yazdır
                          </button>
                          <span className="flex-1" />
                          <button
                            type="button"
                            className="btn-ghost !px-3 !py-1.5 !text-xs"
                            onClick={() => removeInvoice(invoice)}
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {tab === 'customers' && (
        <Section
          title="Cari Kartları"
          icon={CUSTOMER_ICON}
          description="Müşteri bilgileri; fatura kesilirken buradan alınır."
          action={
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 !text-xs"
              onClick={() => {
                setErrors([]);
                setDraft(newCustomer(uid('cari'), new Date().toISOString()));
              }}
            >
              Cari ekle
            </button>
          }
        >
          {customers.length > 3 && (
            <div className="mb-3">
              <TextField
                label="Ara"
                value={query}
                onChange={setQuery}
                placeholder="Ad, firma, telefon veya vergi no"
              />
            </div>
          )}

          <div className="space-y-2">
            {found.map((customer) => (
              <div
                key={customer.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-white/10"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    {displayName(customer)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {[customer.taxNumber, customer.phone, customer.email]
                      .filter((part) => part.trim())
                      .join(' · ') || 'ek bilgi girilmedi'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                    onClick={() => {
                      setErrors([]);
                      setDraft(customer);
                    }}
                  >
                    Düzenle
                  </button>
                  <button
                    type="button"
                    aria-label="Cariyi sil"
                    onClick={() => removeCustomer(customer)}
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
            ))}
            {found.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-[12px] text-slate-500 dark:border-white/10 dark:text-slate-400">
                {customers.length === 0 ? 'Henüz cari yok.' : 'Aramaya uyan cari bulunamadı.'}
              </p>
            )}
          </div>

          {draft && (
            <div className="mt-3 space-y-3 rounded-xl border border-accent-500/30 bg-accent-500/[0.04] p-3.5">
              {errors.length > 0 && (
                <Banner tone="warning">
                  <ul className="list-inside list-disc">
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </Banner>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Ad Soyad"
                  value={draft.name}
                  onChange={(name) => setDraft({ ...draft, name })}
                  placeholder="Ahmet Yılmaz"
                />
                <TextField
                  label="Firma unvanı"
                  value={draft.company}
                  onChange={(company) => setDraft({ ...draft, company })}
                  placeholder="Akyıldız Tasarım Ltd. Şti."
                />
                <TextField
                  label="Vergi dairesi"
                  value={draft.taxOffice}
                  onChange={(taxOffice) => setDraft({ ...draft, taxOffice })}
                />
                <TextField
                  label="VKN / TCKN"
                  value={draft.taxNumber}
                  onChange={(taxNumber) => setDraft({ ...draft, taxNumber })}
                  hint="10 hane VKN, 11 hane TCKN"
                />
                <TextField
                  label="Telefon"
                  value={draft.phone}
                  onChange={(phone) => setDraft({ ...draft, phone })}
                  placeholder="0532 000 00 00"
                />
                <TextField
                  label="E-posta"
                  value={draft.email}
                  onChange={(email) => setDraft({ ...draft, email })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="cari-adres">
                  Adres
                </label>
                <textarea
                  id="cari-adres"
                  className="field-input min-h-[68px]"
                  value={draft.address}
                  onChange={(event) => setDraft({ ...draft, address: event.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    setDraft(null);
                    setErrors([]);
                  }}
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  className="btn-primary !px-3 !py-1.5 !text-xs"
                  onClick={saveCustomer}
                >
                  Kaydet
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {tab === 'seller' && (
        <Section
          title="Firma Bilgilerim"
          icon={CUSTOMER_ICON}
          description="Faturanın üst kısmında görünen bilgiler. Bir kez doldurmanız yeterli."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Unvan"
              value={seller.name}
              onChange={(name) => onSellerChange({ ...seller, name })}
              placeholder="Axthrowa 3D Baskı"
            />
            <TextField
              label="Vergi dairesi"
              value={seller.taxOffice}
              onChange={(taxOffice) => onSellerChange({ ...seller, taxOffice })}
            />
            <TextField
              label="VKN / TCKN"
              value={seller.taxNumber}
              onChange={(taxNumber) => onSellerChange({ ...seller, taxNumber })}
            />
            <TextField
              label="Telefon"
              value={seller.phone}
              onChange={(phone) => onSellerChange({ ...seller, phone })}
            />
            <TextField
              label="E-posta"
              value={seller.email}
              onChange={(email) => onSellerChange({ ...seller, email })}
            />
            <TextField
              label="IBAN"
              value={seller.iban}
              onChange={(iban) => onSellerChange({ ...seller, iban })}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
            />
            <SelectField
              label="Varsayılan KDV"
              value={String(seller.vatRate)}
              options={VAT_RATES.map((rate) => ({ value: String(rate), label: `%${rate}` }))}
              onChange={(value) => onSellerChange({ ...seller, vatRate: Number(value) })}
            />
          </div>
          <div className="mt-3">
            <label className="field-label" htmlFor="satici-adres">
              Adres
            </label>
            <textarea
              id="satici-adres"
              className="field-input min-h-[68px]"
              value={seller.address}
              onChange={(event) => onSellerChange({ ...seller, address: event.target.value })}
            />
          </div>
        </Section>
      )}
    </div>
  );
}
