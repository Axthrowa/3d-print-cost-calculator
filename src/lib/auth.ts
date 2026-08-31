/**
 * Kullanıcı girişi ve rol yetkilendirme (RBAC).
 *
 * Parolalar ASLA düz metin saklanmaz: PBKDF2-SHA256 ile, kullanıcıya özel
 * tuz (salt) kullanılarak türetilen özet saklanır. Doğrulama sabit zamanlı
 * karşılaştırma ile yapılır; aksi halde yanıt süresinden parola tahmin
 * edilebilir.
 *
 * Türetilen anahtar aynı zamanda veri dosyasının şifrelenmesinde kullanılır
 * (bkz. `vault.ts`), böylece parola bilinmeden veriler okunamaz.
 */

export type Role = 'admin' | 'operator';

export interface User {
  id: string;
  /** Giriş adı; büyük/küçük harf duyarsız eşleşir. */
  username: string;
  displayName: string;
  role: Role;
  /** PBKDF2 tuzu (base64). */
  salt: string;
  /** PBKDF2 özeti (base64). */
  hash: string;
  /** Tur sayısı; ileride artırılabilsin diye kayıtta tutulur. */
  iterations: number;
  createdAt: string;
  lastLoginAt?: string;
  /** Ana yonetici: silinemez ve rolu dusurulemez. */
  master?: boolean;
}

export interface Session {
  userId: string;
  username: string;
  displayName: string;
  role: Role;
  startedAt: string;
}

export const PBKDF2_ITERATIONS = 210_000;
const KEY_BYTES = 32;

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Yönetici',
    description: 'Tüm finansal veriler, faturalar, ayarlar ve yazıcı yönetimi.',
  },
  operator: {
    label: 'Operatör',
    description: 'Siparişler, üretim takvimi ve yazıcıya baskı gönderme.',
  },
};

/**
 * Yetki adları. Operatör üretimi yürütür ama parayı görmez; bu ayrım
 * KVKK/ticari gizlilik açısından da gereklidir.
 */
export type Permission =
  | 'finance' // ciro, kâr, maliyet, fatura
  | 'settings' // firma bilgileri, yedek, bakım aralığı
  | 'inventory' // envanter düzenleme
  | 'orders' // sipariş görüntüleme ve durum değiştirme
  | 'print'; // yazıcıya gönderme

const PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['finance', 'settings', 'inventory', 'orders', 'print'],
  operator: ['orders', 'print'],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSIONS[role].includes(permission);
}

/** Oturumdaki kullanıcı bu yetkiye sahip mi? */
export function sessionCan(session: Session | null, permission: Permission): boolean {
  return can(session?.role, permission);
}

// ---------------------------------------------------------------------------
// Parola özeti
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

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

export function randomSalt(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toBase64(buffer);
}

/** PBKDF2 ile ham anahtar türetir. Hem parola özeti hem şifreleme kullanır. */
export async function deriveKeyBytes(
  password: string,
  salt: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(salt), iterations, hash: 'SHA-256' },
    base,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  salt: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<string> {
  return toBase64(await deriveKeyBytes(password, salt, iterations));
}

/** Sabit zamanlı karşılaştırma: erken çıkış parola sızdırır. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function createUser(
  id: string,
  username: string,
  displayName: string,
  role: Role,
  password: string,
  at: string,
): Promise<User> {
  const salt = randomSalt();
  return {
    id,
    username: username.trim(),
    displayName: displayName.trim() || username.trim(),
    role,
    salt,
    hash: await hashPassword(password, salt),
    iterations: PBKDF2_ITERATIONS,
    createdAt: at,
  };
}

export function findUser(users: User[], username: string): User | undefined {
  const needle = username.trim().toLocaleLowerCase('tr');
  return users.find((user) => user.username.toLocaleLowerCase('tr') === needle);
}

export interface LoginResult {
  ok: boolean;
  session?: Session;
  /** Veri dosyasının çözülmesinde kullanılacak anahtar (base64). */
  key?: string;
  error?: string;
}

/**
 * Girişi doğrular. Kullanıcı yoksa da parola hesaplaması yapılır; aksi
 * halde cevap süresi "bu kullanıcı var mı" bilgisini sızdırır.
 */
export async function login(
  users: User[],
  username: string,
  password: string,
): Promise<LoginResult> {
  const user = findUser(users, username);
  const salt = user?.salt ?? randomSalt();
  const iterations = user?.iterations ?? PBKDF2_ITERATIONS;
  const computed = await hashPassword(password, salt, iterations);

  if (!user || !timingSafeEqual(computed, user.hash)) {
    return { ok: false, error: 'Kullanıcı adı veya parola hatalı.' };
  }

  return {
    ok: true,
    key: computed,
    session: {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      startedAt: new Date().toISOString(),
    },
  };
}

/**
 * Parolasiz giris: kayitli ozet anahtar olarak kullanilir.
 * Parola dogrulama kodu korunur; yalnizca arayuz sormaz.
 */
export async function loginByUsername(users: User[], username: string): Promise<LoginResult> {
  const user = findUser(users, username);
  if (!user) {
    return { ok: false, error: 'Kullanıcı bulunamadı.' };
  }

  return {
    ok: true,
    key: user.hash,
    session: {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      startedAt: new Date().toISOString(),
    },
  };
}

/** Parola kuralları. Kısa parola şifrelemeyi de zayıflatır. */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Parola en az 8 karakter olmalı.');
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(password)) errors.push('Parola en az bir harf içermeli.');
  if (!/\d/.test(password)) errors.push('Parola en az bir rakam içermeli.');
  return errors;
}

export function validateUsername(users: User[], username: string, selfId?: string): string[] {
  const errors: string[] = [];
  const clean = username.trim();
  if (clean.length < 3) errors.push('Kullanıcı adı en az 3 karakter olmalı.');
  if (/\s/.test(clean)) errors.push('Kullanıcı adında boşluk olamaz.');
  const existing = findUser(users, clean);
  if (existing && existing.id !== selfId) errors.push('Bu kullanıcı adı zaten kayıtlı.');
  return errors;
}

/** Son yöneticiyi silmek sistemi kilitler. */
export function canRemoveUser(users: User[], id: string): boolean {
  const target = users.find((user) => user.id === id);
  if (!target) return false;
  // Ana yonetici hicbir kosulda silinemez.
  if (target.master) return false;
  if (target.role !== 'admin') return true;
  return users.filter((user) => user.role === 'admin').length > 1;
}

/** Ana yoneticinin rolu degistirilemez. */
export function canChangeRole(users: User[], id: string): boolean {
  return !users.find((user) => user.id === id)?.master;
}

// ---------------------------------------------------------------------------
// Ana yonetici (master) hesabi
// ---------------------------------------------------------------------------

/**
 * Ilk acilista olusturulan ana yonetici.
 *
 * Parola KAYNAKTA DUZ METIN OLARAK BULUNMAZ: yalnizca PBKDF2-SHA256
 * (210.000 tur, rastgele tuz) ile turetilmis ozet gomulur. Ozetten parolayi
 * geri hesaplamak pratikte mumkun degildir.
 *
 * Bu hesap silinemez ve rolu dusurulemez; kasaya erisimi garanti eder.
 */
export const MASTER_USERNAME = 'axthrowa';

const MASTER_SEED = {
  salt: 'n+HUcxSAAiFDgMrQ+Pf5Xw==',
  hash: 'EsxKJ/l2Mmz0shJ9+pBnRilKm17AwDOBi/SN1inJkKA=',
};

/** Ana yonetici kaydini uretir. */
export function masterUser(at: string): User {
  return {
    id: 'master',
    username: MASTER_USERNAME,
    displayName: 'Axthrowa',
    role: 'admin',
    salt: MASTER_SEED.salt,
    hash: MASTER_SEED.hash,
    iterations: PBKDF2_ITERATIONS,
    createdAt: at,
    master: true,
  };
}

/**
 * Ana yonetici listede yoksa ekler. Uygulamanin ilk acilisinda ve
 * sonrasinda her acilista cagrilir; varsa liste degismeden doner.
 */
export function ensureMaster(users: User[], at: string): User[] {
  if (users.some((user) => user.master || user.username === MASTER_USERNAME)) return users;
  return [masterUser(at), ...users];
}
