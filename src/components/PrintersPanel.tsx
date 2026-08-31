import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import { uid } from '../lib/storage';
import {
  BAUD_RATES,
  DEFAULT_PORTS,
  PRINTER_KINDS,
  STATE_META,
  canCommand,
  canPrint,
  cleanHost,
  describeTarget,
  formatEta,
  formatTemp,
  heatRatio,
  hostPort,
  isNetworkKind,
  needsApiKey,
  newLink,
  validateLink,
  type LiveStatus,
  type PrinterCommand,
  type PrinterKind,
  type PrinterLink,
} from '../lib/printerLink';
import {
  listSerialPorts,
  runPrinterCommand,
  sendToPrint,
  testConnection,
} from '../lib/printerClient';
import { Banner, Section, SelectField, Spinner, TextField, Toggle } from './ui';

interface PrintersPanelProps {
  links: PrinterLink[];
  onChange: (links: PrinterLink[]) => void;
  /** Yazıcı kimliği -> son okunan durum. */
  statuses: Record<string, LiveStatus>;
  /** Tek bir yazıcının durumunu hemen tazeler. */
  onRefresh: (link: PrinterLink) => void;
  onToast: (tone: 'success' | 'warning' | 'error', text: string) => void;
  /** Hesaplama ekranında içe aktarılan g-code; varsa doğrudan gönderilebilir. */
  gcodeFile: File | null;
}

const PRINTER_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path strokeLinejoin="round" d="M7 8V4h10v4" />
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <path strokeLinejoin="round" d="M7 14h10v6H7z" />
  </svg>
);

/** Sıcaklık göstergesi: değer + hedefe yaklaşma çubuğu. */
function TempCell({ label, reading }: { label: string; reading: LiveStatus['nozzle'] }) {
  const ratio = heatRatio(reading);
  return (
    <div className="rounded-lg bg-slate-100/70 p-2.5 dark:bg-white/[0.05]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {formatTemp(reading)}
      </p>
      {ratio !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
          <div
            className="h-full rounded-full bg-orange-500 transition-[width] duration-500"
            style={{ width: `${Math.max(ratio * 100, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function PrintersPanel({
  links,
  onChange,
  statuses,
  onRefresh,
  onToast,
  gcodeFile,
}: PrintersPanelProps) {
  const [draft, setDraft] = useState<PrinterLink | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Seri port listesi yalnızca form açıkken gerekir.
  const draftKind = draft?.kind ?? null;
  useEffect(() => {
    if (draftKind === null || isNetworkKind(draftKind)) return;
    let alive = true;
    listSerialPorts().then((found) => {
      if (alive) setPorts(found);
    });
    return () => {
      alive = false;
    };
  }, [draftKind]);

  // Yalnizca hala listede olan yazicilarin durumlari sayilir.
  const live = links.map((link) => statuses[link.id]);

  const patch = (values: Partial<PrinterLink>) => {
    setDraft((prev) => (prev ? { ...prev, ...values } : prev));
  };

  const startAdd = () => {
    setErrors([]);
    setDraft(newLink(uid('prn'), new Date().toISOString()));
  };

  const save = () => {
    if (!draft) return;
    const problems = validateLink(draft);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    const cleaned: PrinterLink = {
      ...draft,
      name: draft.name.trim(),
      host: cleanHost(draft.host),
      apiKey: draft.apiKey.trim(),
      serialPath: draft.serialPath.trim().toUpperCase(),
      profileName: draft.profileName.trim(),
    };
    const exists = links.some((l) => l.id === cleaned.id);
    onChange(exists ? links.map((l) => (l.id === cleaned.id ? cleaned : l)) : [...links, cleaned]);
    setDraft(null);
    setErrors([]);
    onToast('success', `${cleaned.name} kaydedildi.`);
    if (cleaned.enabled) onRefresh(cleaned);
  };

  const remove = (link: PrinterLink) => {
    onChange(links.filter((l) => l.id !== link.id));
    if (draft?.id === link.id) setDraft(null);
    onToast('warning', `${link.name} listeden kaldırıldı.`);
  };

  const withBusy = async (id: string, work: () => Promise<void>) => {
    setBusyId(id);
    try {
      await work();
    } finally {
      setBusyId(null);
    }
  };

  const test = (link: PrinterLink) =>
    withBusy(link.id, async () => {
      const result = await testConnection(link);
      onToast(result.ok ? 'success' : 'error', `${link.name}: ${result.message}`);
      if (result.ok) onRefresh(link);
    });

  const command = (link: PrinterLink, cmd: PrinterCommand) =>
    withBusy(link.id, async () => {
      const result = await runPrinterCommand(link, cmd);
      onToast(result.ok ? 'success' : 'error', `${link.name}: ${result.message}`);
      onRefresh(link);
    });

  const print = (link: PrinterLink, file: File) =>
    withBusy(link.id, async () => {
      onToast('success', `${file.name} gönderiliyor…`);
      const result = await sendToPrint(link, file, true);
      onToast(result.ok ? 'success' : 'error', `${link.name}: ${result.message}`);
      onRefresh(link);
    });

  const pickAndPrint = (link: PrinterLink) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gcode,.gco,.g,.bgcode';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void print(link, file);
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      {links.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Tanımlı yazıcı', value: String(links.length), sub: 'ağ ve USB toplamı' },
            {
              label: 'Baskıda',
              value: String(live.filter((s) => s?.state === 'printing').length),
              sub: 'şu an çalışan',
            },
            {
              label: 'Ulaşılamayan',
              value: String(live.filter((s) => s?.state === 'offline').length),
              sub: 'bağlantı kurulamadı',
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
      )}

      <Section
        title="Yazıcılar"
        icon={PRINTER_ICON}
        description="Ağdaki veya USB'ye bağlı yazıcıları tanımlayın. Devam eden baskı dosya adı, yüzde ve kalan süre ile görünür."
        action={
          <button type="button" className="btn-primary !px-3 !py-1.5 !text-xs" onClick={startAdd}>
            Yazıcı ekle
          </button>
        }
      >
        {links.length === 0 && !draft && (
          <button
            type="button"
            onClick={startAdd}
            className="w-full rounded-xl border border-dashed border-accent-500/40 bg-accent-500/[0.06] px-4 py-6 text-center transition hover:bg-accent-500/[0.12]"
          >
            <p className="text-sm font-semibold text-accent-600 dark:text-accent-400">
              Henüz yazıcı tanımlanmadı
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Klipper/Moonraker, OctoPrint, Snapmaker veya USB seri port desteklenir.
            </p>
          </button>
        )}

        <div className="space-y-3">
          {links.map((link) => {
            const status = statuses[link.id];
            const state = status?.state ?? 'unknown';
            const meta = STATE_META[state];
            const busy = busyId === link.id;
            const percent = status?.progress === null ? null : (status?.progress ?? null);

            return (
              <div
                key={link.id}
                className="rounded-xl border border-slate-200 p-3.5 dark:border-white/10"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {link.name}
                      </span>
                      <span className={cx('chip inline-flex items-center gap-1.5', meta.tone)}>
                        <span
                          className={cx(
                            'size-1.5 rounded-full',
                            meta.dot,
                            state === 'printing' && 'animate-pulse',
                          )}
                        />
                        {meta.label}
                      </span>
                      {!link.enabled && (
                        <span className="chip bg-slate-500/15 text-slate-500 dark:text-slate-400">
                          takip kapalı
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {PRINTER_KINDS.find((k) => k.id === link.kind)?.label} ·{' '}
                      {describeTarget(link)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {busy && <Spinner className="size-4 text-accent-500" />}
                    <button
                      type="button"
                      className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                      onClick={() => void test(link)}
                      disabled={busy}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                      onClick={() => {
                        setErrors([]);
                        setDraft(link);
                      }}
                    >
                      Düzenle
                    </button>
                    <button
                      type="button"
                      aria-label="Yazıcıyı sil"
                      onClick={() => remove(link)}
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

                {status ? (
                  <>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <TempCell label="Nozul" reading={status.nozzle} />
                      <TempCell label="Yatak" reading={status.bed} />
                      <div className="rounded-lg bg-slate-100/70 p-2.5 dark:bg-white/[0.05]">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Kalan süre
                        </p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-800 dark:text-slate-100">
                          {formatEta(status.remainingSeconds)}
                        </p>
                      </div>
                    </div>

                    {percent !== null && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="truncate text-slate-500 dark:text-slate-400">
                            {status.jobName ?? 'Baskı'}
                          </span>
                          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                            %{(percent * 100).toFixed(0)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
                          <div
                            className="h-full rounded-full bg-accent-500 transition-[width] duration-500"
                            style={{ width: `${Math.max(percent * 100, 1)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {status.message && (
                      <p className="mt-2 text-[11px] text-rose-500 dark:text-rose-400">
                        {status.message}
                      </p>
                    )}
                  </>
                ) : link.enabled ? (
                  <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
                    Durum okunuyor…
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                    onClick={() => void command(link, 'pause')}
                    disabled={busy || !canCommand(state, 'pause')}
                  >
                    Duraklat
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                    onClick={() => void command(link, 'resume')}
                    disabled={busy || !canCommand(state, 'resume')}
                  >
                    Devam et
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                    onClick={() => void command(link, 'cancel')}
                    disabled={busy || !canCommand(state, 'cancel')}
                  >
                    İptal
                  </button>
                  <span className="flex-1" />
                  {gcodeFile && (
                    <button
                      type="button"
                      className="btn-primary !px-3 !py-1 !text-[11px]"
                      onClick={() => void print(link, gcodeFile)}
                      disabled={busy || !canPrint(state)}
                      title={`${gcodeFile.name} dosyasını gönder`}
                    >
                      {gcodeFile.name.slice(0, 22)} yazdır
                    </button>
                  )}
                  <button
                    type="button"
                    className={cx(
                      gcodeFile ? 'btn-ghost' : 'btn-primary',
                      '!px-3 !py-1 !text-[11px]',
                    )}
                    onClick={() => pickAndPrint(link)}
                    disabled={busy || !canPrint(state)}
                  >
                    Dosya seçip yazdır
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {draft && (
          <div className="mt-3 space-y-3 rounded-xl border border-accent-500/30 bg-accent-500/[0.04] p-3.5">
            <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              {links.some((l) => l.id === draft.id) ? 'Yazıcıyı düzenle' : 'Yeni yazıcı'}
            </p>

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
                label="Ad"
                value={draft.name}
                onChange={(value) => patch({ name: value })}
                placeholder="Salon - Ender 3"
              />
              <SelectField<PrinterKind>
                label="Bağlantı türü"
                value={draft.kind}
                options={PRINTER_KINDS.map((k) => ({ value: k.id, label: k.label }))}
                onChange={(kind) => patch({ kind, port: DEFAULT_PORTS[kind] })}
                hint={PRINTER_KINDS.find((k) => k.id === draft.kind)?.hint}
              />

              {isNetworkKind(draft.kind) ? (
                <>
                  <TextField
                    label="IP adresi veya sunucu adı"
                    value={draft.host}
                    onChange={(value) => {
                      const written = hostPort(value);
                      patch(written ? { host: value, port: written } : { host: value });
                    }}
                    placeholder="192.168.1.50"
                    hint="Adrese port yazarsanız otomatik ayrılır."
                  />
                  <div>
                    <label className="field-label" htmlFor="printer-port">
                      Port
                    </label>
                    <input
                      id="printer-port"
                      type="number"
                      className="field-input"
                      value={draft.port || ''}
                      min={1}
                      max={65535}
                      onChange={(event) => patch({ port: Number(event.target.value) || 0 })}
                    />
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      Varsayılan: {DEFAULT_PORTS[draft.kind]}
                    </p>
                  </div>
                  <TextField
                    label={needsApiKey(draft.kind) ? 'API anahtarı' : 'API anahtarı (isteğe bağlı)'}
                    value={draft.apiKey}
                    onChange={(value) => patch({ apiKey: value })}
                    placeholder={
                      draft.kind === 'snapmaker' ? 'Ekrandaki token' : 'OctoPrint > Ayarlar > API'
                    }
                    hint="Yalnızca bu bilgisayarda saklanır."
                  />
                </>
              ) : (
                <>
                  <div>
                    <label className="field-label" htmlFor="serial-port">
                      Seri port
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="serial-port"
                        list="serial-port-list"
                        className="field-input"
                        value={draft.serialPath}
                        placeholder="COM3"
                        onChange={(event) => patch({ serialPath: event.target.value })}
                      />
                      <datalist id="serial-port-list">
                        {ports.map((port) => (
                          <option key={port} value={port} />
                        ))}
                      </datalist>
                      <button
                        type="button"
                        className="btn-ghost shrink-0 !px-3 !py-1.5 !text-xs"
                        onClick={() => void listSerialPorts().then(setPorts)}
                      >
                        Tara
                      </button>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      {ports.length > 0 ? `Bulunanlar: ${ports.join(', ')}` : 'Port bulunamadı.'}
                    </p>
                  </div>
                  <SelectField
                    label="Baud hızı"
                    value={String(draft.baudRate)}
                    options={BAUD_RATES.map((rate) => ({
                      value: String(rate),
                      label: String(rate),
                    }))}
                    onChange={(value) => patch({ baudRate: Number(value) })}
                    hint="Marlin çoğunlukla 115200 kullanır."
                  />
                </>
              )}
            </div>

            {draft.kind === 'serial' && (
              <Banner tone="warning">
                USB seri bağlantı deneyseldir ve yalnızca Windows'ta çalışır. Baskı sırasında
                uygulamayı kapatmayın; dosya satır satır yazıcıya gönderilir.
              </Banner>
            )}

            <Toggle
              label="Durumu düzenli olarak sorgula"
              checked={draft.enabled}
              onChange={(checked) => patch({ enabled: checked })}
              hint="Kapatılırsa yazıcı listede kalır ama ağa istek gitmez."
            />

            <div className="flex flex-wrap justify-end gap-2">
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
                className="btn-ghost !px-3 !py-1.5 !text-xs"
                onClick={() => void test(draft)}
              >
                Bağlantıyı sına
              </button>
              <button type="button" className="btn-primary !px-3 !py-1.5 !text-xs" onClick={save}>
                Kaydet
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
