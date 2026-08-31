import { cx } from '../lib/cx';
import { VIEW_META } from '../lib/viewMeta';
import type { DockApp } from '../types';

export type View =
  | 'dashboard'
  | 'calc'
  | 'inventory'
  | 'catalog'
  | 'orders'
  | 'gantt'
  | 'jobs'
  | 'printers'
  | 'invoices'
  | 'settings'
  | 'backup';

interface SidebarProps {
  view: View;
  onChange: (view: View) => void;
  badges: Partial<Record<View, number>>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  /** Masaüstü kabuğunda mı çalışıyor? */
  desktop: boolean;
  /** Kurumsal görünüm: işletme adı ve logo. */
  businessName: string;
  logo: string;
  /** Oturumdaki kullanıcının adı ve rolü (giriş kapalıysa null). */
  userLabel: string | null;
  onLogout: (() => void) | null;
  /** Hızlı başlatıcı kısayolları. */
  dock: DockApp[];
  onLaunch: (app: DockApp) => void;
  /** Yalnızca yetkili olunan sekmeler gösterilir. */
  allowed: (view: View) => boolean;
}

const ICONS: Record<View, React.ReactNode> = {
  dashboard: (
    <>
      <path strokeLinecap="round" d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  calc: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path strokeLinecap="round" d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3" />
    </>
  ),
  inventory: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path strokeLinecap="round" d="M12 4v3M12 17v3M4 12h3M17 12h3" />
    </>
  ),
  catalog: (
    <>
      <path strokeLinejoin="round" d="M4 16V8l8-4 8 4v8l-8 4z" />
      <path strokeLinejoin="round" d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
  orders: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3h12l1 5H5l1-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8" />
      <path strokeLinecap="round" d="M10 12h4" />
    </>
  ),
  backup: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path strokeLinecap="round" d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path strokeLinecap="round" d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  gantt: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4M7 14h5M7 17h8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"
      />
    </>
  ),
  invoices: (
    <>
      <path strokeLinejoin="round" d="M6 3h9l4 4v14H6z" />
      <path strokeLinejoin="round" d="M15 3v4h4" />
      <path strokeLinecap="round" d="M9 12h6M9 16h4" />
    </>
  ),
  printers: (
    <>
      <path strokeLinejoin="round" d="M7 8V4h10v4" />
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path strokeLinejoin="round" d="M7 14h10v6H7z" />
    </>
  ),
  jobs: (
    <>
      <path strokeLinecap="round" d="M12 3v4M12 21v-4" />
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M4.2 7.5l3.4 2M16.4 14.5l3.4 2M4.2 16.5l3.4-2M16.4 9.5l3.4-2"
      />
    </>
  ),
};

const ITEMS: Array<{ id: View; label: string }> = [
  { id: 'dashboard', label: 'Panel' },
  { id: 'calc', label: 'Yeni Hesaplama' },
  { id: 'inventory', label: 'Envanter' },
  { id: 'catalog', label: 'Hazır Ürünler' },
  { id: 'orders', label: 'Siparişler' },
  { id: 'gantt', label: 'Üretim Takvimi' },
  { id: 'jobs', label: 'Baskılar' },
  { id: 'invoices', label: 'Faturalar' },
  { id: 'printers', label: 'Yazıcılar' },
  { id: 'backup', label: 'Yedekler' },
  { id: 'settings', label: 'Ayarlar' },
];

export function Sidebar({
  view,
  onChange,
  badges,
  theme,
  onToggleTheme,
  desktop,
  businessName,
  logo,
  userLabel,
  onLogout,
  dock,
  onLaunch,
  allowed,
}: SidebarProps) {
  return (
    <aside className="flex shrink-0 flex-row gap-2 border-b border-slate-200/80 bg-white/80 p-3 backdrop-blur-xl lg:h-screen lg:w-60 lg:flex-col lg:border-b-0 lg:border-r dark:border-white/[0.07] dark:bg-ink-950/75">
      <div className="hidden items-center gap-3 px-2 py-3 lg:flex">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="size-10 shrink-0 rounded-xl bg-white object-contain p-1"
          />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-lg shadow-accent-500/25">
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinejoin="round" d="M4 16V8l8-4 8 4v8l-8 4z" />
              <path strokeLinejoin="round" d="M4 8l8 4 8-4M12 12v8" />
            </svg>
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold leading-tight text-slate-900 dark:text-white">
            {businessName || 'Baskı Maliyet'}
          </p>
          <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
            {userLabel ?? (desktop ? 'Masaüstü sürümü' : 'Tarayıcı sürümü')}
          </p>
        </div>
      </div>

      <nav className="flex flex-1 flex-row gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {ITEMS.filter((item) => allowed(item.id)).map((item) => {
          const badge = badges[item.id] ?? 0;
          const active = view === item.id;
          const meta = VIEW_META[item.id];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={`${item.label} — ${meta.description}`}
              title={meta.description}
              className={cx(
                'flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-left transition sm:flex-row sm:gap-2.5 sm:px-3 sm:py-2.5 lg:w-full lg:flex-row lg:items-center',
                active
                  ? 'bg-accent-500/15 text-accent-600 dark:bg-accent-500/20 dark:text-accent-300'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-slate-100',
              )}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-[18px] shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                {ICONS[item.id]}
              </svg>
              <span className="max-w-[3.5rem] truncate text-[10px] font-semibold leading-tight sm:max-w-none sm:text-[13px] lg:inline">
                <span className="lg:hidden">{meta.short}</span>
                <span className="hidden lg:inline">{item.label}</span>
              </span>
              {badge > 0 && (
                <span className="rounded-md bg-accent-500 px-1.5 text-[10px] font-bold text-white sm:ml-auto">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {dock.length > 0 && (
        <div className="hidden flex-wrap gap-1.5 border-t border-slate-200/80 pt-3 lg:flex dark:border-white/[0.07]">
          {dock
            .filter((app) => app.path.trim())
            .map((app) => (
              <button
                key={app.id}
                type="button"
                title={`${app.label || app.path} — aç`}
                onClick={() => onLaunch(app)}
                className="grid size-9 place-items-center rounded-lg border border-slate-200 text-sm transition hover:border-accent-500 hover:bg-accent-500/10 dark:border-white/10"
              >
                {app.icon || '⚙'}
              </button>
            ))}
        </div>
      )}

      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="hidden items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-rose-600 lg:flex dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-rose-400"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-[18px] shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path strokeLinecap="round" d="M15 12H4m0 0l3-3m-3 3l3 3" />
            <path
              strokeLinecap="round"
              d="M11 6V5a2 2 0 012-2h5a2 2 0 012 2v14a2 2 0 01-2 2h-5a2 2 0 01-2-2v-1"
            />
          </svg>
          Oturumu kapat
        </button>
      )}

      <p className="hidden px-2 text-[10px] leading-relaxed text-slate-400 lg:block dark:text-slate-600">
        Hızlı arama: <kbd className="font-mono">Ctrl+K</kbd>
      </p>

      <button
        type="button"
        onClick={onToggleTheme}
        aria-label="Tema değiştir"
        className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-300 text-slate-500 transition hover:text-accent-600 lg:w-full dark:border-white/10 dark:text-slate-400 dark:hover:text-accent-400"
      >
        {theme === 'dark' ? (
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="4" />
            <path
              strokeLinecap="round"
              d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
            />
          </svg>
        ) : (
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
              d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
            />
          </svg>
        )}
      </button>
    </aside>
  );
}
