import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Hata sonrası "tekrar dene" için sıfırlanacak anahtar (örn. aktif sekme). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Çizim hatalarını yakalar.
 *
 * Bir bileşen çizim sırasında hata atarsa React tüm ağacı söküyor ve ekran
 * bembeyaz kalıyor — kullanıcı için "her şey kayboldu" demek. Tek bir bozuk
 * kaydın uygulamayı kullanılamaz hâle getirmemesi için hata burada durur,
 * anlaşılır bir mesaja dönüşür ve diğer sekmeler çalışmaya devam eder.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Tarayıcı konsoluna bırakılır; teşhis için gerekli.
    console.error('Arayüz hatası:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    // Kullanıcı başka sekmeye geçtiğinde yeniden denenir.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-6 dark:border-rose-500/25 dark:bg-rose-500/10">
          <h2 className="text-base font-bold text-rose-700 dark:text-rose-300">
            Bu bölüm açılamadı
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-rose-700/90 dark:text-rose-200/90">
            Sayfa çizilirken bir hata oluştu. Verileriniz yerinde duruyor; başka bir sekmeye
            geçebilir veya tekrar deneyebilirsiniz.
          </p>
          <p className="mt-3 break-words rounded-lg bg-rose-100/70 p-2.5 font-mono text-[11px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
            {error.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 !text-xs"
              onClick={() => this.setState({ error: null })}
            >
              Tekrar dene
            </button>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => window.location.reload()}
            >
              Uygulamayı yenile
            </button>
          </div>
        </div>
      </div>
    );
  }
}
