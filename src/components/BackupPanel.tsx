import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storedGcodeSummary } from '../lib/printerClient';
import { cx } from '../lib/cx';
import {
  backupFileName,
  createSnapshot,
  parseSnapshot,
  summarize,
  type BackupSnapshot,
} from '../lib/backup';
import { formatDateTime, formatNumber, formatRelative } from '../lib/format';
import { diskBackupSupported, type BackupFileInfo } from '../lib/runtime';
import type { AppData } from '../lib/storage';
import type { BackupSettings } from '../types';
import { Banner, Section, Spinner, Toggle } from './ui';

interface BackupPanelProps {
  data: AppData;
  settings: BackupSettings;
  onSettingsChange: (settings: BackupSettings) => void;
  /** Diske yedek alır; yazıldığı dizini döndürür. */
  onBackupNow: () => Promise<string>;
  /** Yedeği yükleyip tüm veriyi değiştirir. */
  onRestore: (data: AppData) => void;
  files: BackupFileInfo[];
  dir: string;
  busy: boolean;
  /** Listeyi tazeler. */
  onRefresh: () => void;
  /** Diskteki bir yedeğin içeriğini okur. */
  onReadBackup: (name: string) => Promise<string>;
  appVersion: string;
  now: number;
}

const BACKUP_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path strokeLinecap="round" d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path strokeLinecap="round" d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

const INTERVALS = [
  { value: 15, label: '15 dakikada bir' },
  { value: 30, label: 'Yarım saatte bir' },
  { value: 60, label: 'Saatte bir' },
  { value: 180, label: '3 saatte bir' },
  { value: 720, label: '12 saatte bir' },
];

export function BackupPanel({
  data,
  settings,
  onSettingsChange,
  onBackupNow,
  onRestore,
  files,
  dir,
  busy,
  onRefresh,
  onReadBackup,
  appVersion,
  now,
}: BackupPanelProps) {
  const [message, setMessage] = useState<{
    tone: 'info' | 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [gcodeStore, setGcodeStore] = useState({ dir: '', count: 0, totalBytes: 0 });

  // Yedege girmeyen g-code deposunun boyutu, panel acilinca bir kez okunur.
  useEffect(() => {
    let alive = true;
    storedGcodeSummary().then((summary) => {
      if (alive) setGcodeStore(summary);
    });
    return () => {
      alive = false;
    };
  }, []);

  const current = useMemo(
    () => summarize(createSnapshot(data, appVersion, new Date(now).toISOString())),
    [data, appVersion, now],
  );

  const applySnapshot = useCallback(
    (snapshot: BackupSnapshot, source: string) => {
      const stats = summarize(snapshot);
      const ok = confirm(
        `"${source}" yedeği geri yüklenecek.\n\n` +
          `Yedek içeriği: ${stats.spools} filament, ${stats.catalog} ürün, ` +
          `${stats.orders} sipariş, ${stats.jobs} baskı.\n\n` +
          'MEVCUT VERİLERİNİZİN ÜZERİNE YAZILACAK. Devam edilsin mi?',
      );
      if (!ok) return;
      onRestore(snapshot.data);
      setMessage({ tone: 'success', text: `"${source}" geri yüklendi.` });
    },
    [onRestore],
  );

  const restoreFromDisk = async (name: string) => {
    try {
      const text = await onReadBackup(name);
      const result = parseSnapshot(text);
      if (!result.ok || !result.snapshot) {
        setMessage({ tone: 'error', text: result.error ?? 'Yedek okunamadı.' });
        return;
      }
      applySnapshot(result.snapshot, name);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Yedek okunamadı.',
      });
    }
  };

  const backupNow = async () => {
    setMessage(null);
    try {
      const where = await onBackupNow();
      setMessage({
        tone: 'success',
        text: where ? `Yedek alındı: ${where}` : 'Yedek alındı.',
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Yedek alınamadı.',
      });
    }
  };

  /** Yedeği kullanıcının seçtiği bir konuma indirir. */
  const download = () => {
    const at = new Date(now).toISOString();
    const snapshot = createSnapshot(data, appVersion, at);
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName(at);
    link.click();
    URL.revokeObjectURL(url);
    setMessage({ tone: 'success', text: 'Yedek dosyası indirildi.' });
  };

  const onFilePicked = async (file: File) => {
    const result = parseSnapshot(await file.text());
    if (!result.ok || !result.snapshot) {
      setMessage({ tone: 'error', text: result.error ?? 'Dosya okunamadı.' });
      return;
    }
    applySnapshot(result.snapshot, file.name);
    if (fileInput.current) fileInput.current.value = '';
  };

  const diskOk = diskBackupSupported();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: 'Diskteki yedek',
            value: String(files.length),
            sub: files[0] ? `son: ${formatRelative(files[0].at, now)}` : 'henüz yok',
          },
          {
            label: 'Otomatik yedek',
            value: settings.enabled ? 'Açık' : 'Kapalı',
            sub: settings.enabled
              ? (INTERVALS.find((i) => i.value === settings.intervalMinutes)?.label ??
                `${settings.intervalMinutes} dakikada bir`)
              : 'elle yedekleyin',
          },
          {
            label: 'Şu anki veri',
            value: String(current.total),
            sub: `${current.spools} filament · ${current.catalog} ürün · ${current.orders} sipariş`,
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
        title="Yedekleme"
        icon={BACKUP_ICON}
        description="Veriler düzenli aralıklarla diske kopyalanır. Bir şey silinirse buradan geri yükleyebilirsiniz."
        action={
          <button
            type="button"
            className="btn-primary !px-3 !py-1.5 !text-xs"
            onClick={backupNow}
            disabled={busy || !diskOk}
          >
            {busy ? <Spinner /> : 'Şimdi yedekle'}
          </button>
        }
      >
        <div className="space-y-4">
          {message && <Banner tone={message.tone}>{message.text}</Banner>}

          {!diskOk && (
            <Banner tone="warning">
              Bu ortamda diske otomatik yedek alınamıyor. Aşağıdaki "Dosyaya indir" ile elle yedek
              alabilirsiniz.
            </Banner>
          )}

          <div
            className={cx(
              'rounded-xl border p-4 transition',
              settings.enabled
                ? 'border-emerald-400/40 bg-emerald-500/[0.06]'
                : 'border-slate-200 dark:border-white/10',
            )}
          >
            <Toggle
              label="Otomatik yedekleme"
              checked={settings.enabled}
              onChange={(enabled) => onSettingsChange({ ...settings, enabled })}
              hint="Uygulama açıkken belirli aralıklarla ve kapatırken yedek alınır."
            />

            {settings.enabled && (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="field-label" htmlFor="backup-interval">
                    Yedek sıklığı
                  </label>
                  <select
                    id="backup-interval"
                    className="field-input"
                    value={settings.intervalMinutes}
                    onChange={(event) =>
                      onSettingsChange({ ...settings, intervalMinutes: Number(event.target.value) })
                    }
                  >
                    {INTERVALS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Son yedek: {formatRelative(settings.lastAt, now)}. Veri değişmediyse yeni dosya
                  yazılmaz. En fazla 20 yedek tutulur, eskiler kendiliğinden silinir.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost !py-2 !text-xs" onClick={download}>
              Dosyaya indir
            </button>
            <button
              type="button"
              className="btn-ghost !py-2 !text-xs"
              onClick={() => fileInput.current?.click()}
            >
              Dosyadan geri yükle
            </button>
            {diskOk && (
              <button type="button" className="btn-ghost !py-2 !text-xs" onClick={onRefresh}>
                Listeyi yenile
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFilePicked(file);
              }}
            />
          </div>

          {dir && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Yedek klasörü: <span className="font-mono">{dir}</span>
            </p>
          )}

          {/* G-code dosyalari yedege girmez; kullanici nerede durduklarini gormeli. */}
          {gcodeStore.count > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              {gcodeStore.count} adet g-code ({formatNumber(gcodeStore.totalBytes / 1024 / 1024, 1)}{' '}
              MB) yedeğe DAHİL DEĞİL:{' '}
              <span className="font-mono text-slate-400 dark:text-slate-500">{gcodeStore.dir}</span>
            </p>
          )}
        </div>
      </Section>

      {diskOk && (
        <Section
          title="Diskteki Yedekler"
          icon={BACKUP_ICON}
          description="En yeniden eskiye. Geri yüklemek mevcut verinin üzerine yazar."
        >
          {files.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-white/10">
              <p className="text-sm text-slate-500 dark:text-slate-400">Henüz yedek alınmadı.</p>
              <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                "Şimdi yedekle" ile ilk yedeği alabilirsiniz.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {files.map((file, index) => (
                <li
                  key={file.name}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                      <span className="font-mono">{file.name}</span>
                      {index === 0 && (
                        <span className="chip bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                          en yeni
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {formatDateTime(file.at)} · {formatNumber(file.size / 1024, 1)} KB ·{' '}
                      {formatRelative(file.at, now)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !px-2.5 !py-1.5 !text-[11px]"
                    onClick={() => void restoreFromDisk(file.name)}
                  >
                    Geri yükle
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
