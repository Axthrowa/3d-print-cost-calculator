import { cx } from '../lib/cx';
import { VIEW_META, WORKFLOW_TIP, type ViewMeta } from '../lib/viewMeta';
import type { View } from './Sidebar';

interface PageHeaderProps {
  view: View;
  onSearch: () => void;
  /** Hesaplama ekranında adım göstergesi. */
  showWorkflowTip?: boolean;
}

export function PageHeader({ view, onSearch, showWorkflowTip = false }: PageHeaderProps) {
  const meta: ViewMeta = VIEW_META[view];

  return (
    <header className="mb-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
            {meta.title}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {meta.description}
          </p>
        </div>
        <button
          type="button"
          onClick={onSearch}
          className={cx(
            'flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-[12px] font-medium text-slate-500 transition',
            'hover:border-accent-500/40 hover:text-accent-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-accent-300',
          )}
          aria-label="Hızlı arama (Ctrl+K)"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="M20 20l-3-3" />
          </svg>
          <span className="hidden sm:inline">Ara…</span>
          <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:inline dark:border-white/10 dark:bg-white/[0.06]">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {view === 'calc' && (
        <ol className="flex flex-wrap gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {['Dosya yükle', 'Filament seç', 'Fiyatı gör'].map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 dark:bg-white/[0.06]"
            >
              <span className="grid size-4 place-items-center rounded-full bg-accent-500/15 text-[10px] font-bold text-accent-600 dark:text-accent-300">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      )}

      {showWorkflowTip && (
        <p className="rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-[11px] leading-relaxed text-sky-800 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
          {WORKFLOW_TIP}
        </p>
      )}
    </header>
  );
}
