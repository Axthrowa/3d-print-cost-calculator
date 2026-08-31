import { useId, type ReactNode } from 'react';
import { cx } from '../lib/cx';

interface SectionProps {
  title: string;
  icon?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Section({ title, icon, description, action, children }: SectionProps) {
  return (
    <section className="panel p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && (
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-500/10 text-accent-500 dark:bg-accent-500/15 dark:text-accent-400">
              {icon}
            </span>
          )}
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max,
  step = 1,
  hint,
}: NumberFieldProps) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={cx('field-input', suffix && 'pr-14')}
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const next = event.target.value === '' ? 0 : Number(event.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400 dark:text-slate-500">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}

export function TextField({ label, value, onChange, placeholder, hint }: TextFieldProps) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="field-input"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<T | { value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: SelectFieldProps<T>) {
  const id = useId();
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field-input appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
        }}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => {
          const opt = typeof option === 'string' ? { value: option, label: option } : option;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
      {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  hint?: string;
}

export function Slider({ label, value, onChange, min, max, step = 1, format, hint }: SliderProps) {
  const id = useId();
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="field-label mb-0" htmlFor={id}>
          {label}
        </label>
        <span className="rounded-lg bg-accent-500/10 px-2 py-0.5 text-xs font-bold tabular-nums text-accent-600 dark:bg-accent-500/15 dark:text-accent-400">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-[13px] font-medium text-slate-600 dark:text-slate-300">
          {label}
        </span>
        {hint && (
          <span className="block text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-accent-500' : 'bg-slate-300 dark:bg-white/15',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      className={cx('animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

type BannerTone = 'info' | 'success' | 'warning' | 'error';

const BANNER_TONES: Record<BannerTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200',
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200',
  error:
    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200',
};

interface ToastProps {
  tone: BannerTone;
  message: string;
  onClose: () => void;
}

/** Ekranin sag altinda beliren kısa bildirim. */
export function Toast({ tone, message, onClose }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed bottom-4 right-4 z-[60] max-w-sm rounded-xl border px-4 py-3 text-xs leading-relaxed shadow-2xl backdrop-blur-md',
        BANNER_TONES[tone],
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Bildirimi kapat"
          className="-mr-1 -mt-0.5 grid size-5 shrink-0 place-items-center rounded opacity-60 transition hover:opacity-100"
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
      </div>
    </div>
  );
}

export function Banner({ tone = 'info', children }: { tone?: BannerTone; children: ReactNode }) {
  return (
    <div
      className={cx('rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed', BANNER_TONES[tone])}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
}

/** Boş liste durumları için tutarlı görünüm. */
export function EmptyState({ title, description, actionLabel, onAction, icon }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-white/10 dark:bg-white/[0.02]">
      {icon && (
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-accent-500/10 text-accent-500 dark:bg-accent-500/15 dark:text-accent-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button type="button" className="btn-primary mt-4 !px-4 !py-2 !text-xs" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
