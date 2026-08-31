/** Türkçe yerel biçimlendirme yardımcıları. */

const currencyFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1234.5 -> "₺1.234,50" */
export function formatTRY(value: number): string {
  if (!Number.isFinite(value)) return currencyFormatter.format(0);
  return currencyFormatter.format(value);
}

/** Ondalıklı sayıyı yerel biçimde döndürür. */
export function formatNumber(value: number, maxDigits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: maxDigits }).format(value);
}

/** Gram başına fiyat gibi küçük değerler için 3 hane hassasiyet. */
export function formatPerGram(value: number): string {
  if (!Number.isFinite(value)) return '0,000 TL';
  return `${new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)} TL`;
}

/** 2.5 -> "2 sa 30 dk" */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '0 dk';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

/** Yüzde biçimi. */
export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '%0';
  return `%${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value)}`;
}

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO tarihi "05 Eki 2026" biçiminde gösterir. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const value = Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(value)) return '—';
  return dateFormatter.format(new Date(value));
}

/** ISO tarihi "05 Eki 14:30" biçiminde gösterir. */
export function formatDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const value = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(value)) return '—';
  return dateTimeFormatter.format(new Date(value));
}

/** "3 saat önce", "az önce" gibi göreli zaman metni. */
export function formatRelative(iso: string | number | null | undefined, now: number): string {
  if (iso === null || iso === undefined) return 'hiç';
  const value = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(value)) return 'hiç';

  const diffMinutes = Math.round((now - value) / 60000);
  if (diffMinutes < 1) return 'az önce';
  if (diffMinutes < 60) return `${diffMinutes} dk önce`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} saat önce`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} gün önce`;
  return formatDate(new Date(value).toISOString());
}

/** Renk adını Türkçe kurallara göre büyük harfe çevirir ("i" -> "İ"). */
function upperTR(text: string): string {
  return text.toLocaleUpperCase('tr-TR');
}

/**
 * Filament seçim listelerinde kullanılan tek biçim:
 * "Porima · PLA · KARMİN KIRMIZI". Renk ayırt ediciliği artsın diye
 * büyük harfle yazılır.
 */
export function formatSpoolLabel(
  spool: { brand: string; material: string; color?: string },
  extra?: string,
): string {
  const parts = [spool.brand, spool.material];
  if (spool.color?.trim()) parts.push(upperTR(spool.color.trim()));
  const label = parts.join(' · ');
  return extra ? `${label} (${extra})` : label;
}
