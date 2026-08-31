/**
 * Veri dosyası şifrelemesi (KVKK/GDPR).
 *
 * Müşteri kişisel verileri, finansal kayıtlar ve yazıcı API anahtarları
 * diskte AES-256-GCM ile şifrelenir. Anahtar, kullanıcının parolasından
 * PBKDF2 ile türetilir ve YALNIZCA bellekte tutulur; diskte hiçbir yerde
 * anahtar yazılı değildir. Parola bilinmeden dosya çözülemez.
 *
 * GCM seçildi çünkü şifrelemenin yanında bütünlük de doğrular: dosya
 * kurcalanırsa çözme başarısız olur, sessizce bozuk veri dönmez.
 */

const ALGO = 'AES-GCM';
const IV_BYTES = 12;

/** Şifreli dosyanın diskteki biçimi. */
export interface VaultEnvelope {
  /** Biçim işareti; ileride sürüm yükseltmesi için. */
  v: 1;
  enc: 'AES-GCM';
  /** Base64 rastgele başlangıç vektörü. */
  iv: string;
  /** Base64 şifreli gövde. */
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out.buffer;
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(keyBase64), ALGO, false, ['encrypt', 'decrypt']);
}

/** Verilen nesneyi şifreleyip diske yazılabilir zarfa koyar. */
export async function seal(value: unknown, keyBase64: string): Promise<VaultEnvelope> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: ALGO, iv }, key, plain);
  return { v: 1, enc: 'AES-GCM', iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

/** Zarfı çözer. Parola yanlışsa veya dosya kurcalanmışsa null döner. */
export async function unseal<T>(envelope: unknown, keyBase64: string): Promise<T | null> {
  if (!isEnvelope(envelope)) return null;
  try {
    const key = await importKey(keyBase64);
    const plain = await crypto.subtle.decrypt(
      { name: ALGO, iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

/** Diskteki içerik şifreli mi, düz mü? */
export function isEnvelope(value: unknown): value is VaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VaultEnvelope>;
  return (
    candidate.enc === 'AES-GCM' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.data === 'string'
  );
}

/**
 * Hassas alanların adları. Şifreleme kapalıyken bu alanların diskte düz
 * durduğunu kullanıcıya söylemek için kullanılır.
 */
export const SENSITIVE_FIELDS = [
  'customers (ad, adres, telefon, VKN)',
  'invoices (fatura tutarları ve müşteri kopyaları)',
  'printers (API anahtarları)',
  'users (parola özetleri)',
];
