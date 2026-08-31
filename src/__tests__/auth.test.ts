import { describe, expect, it } from 'vitest';
import {
  ROLE_META,
  can,
  canRemoveUser,
  createUser,
  findUser,
  hashPassword,
  login,
  loginByUsername,
  randomSalt,
  sessionCan,
  timingSafeEqual,
  validatePassword,
  validateUsername,
  type User,
} from '../lib/auth';
import { isEnvelope, seal, unseal } from '../lib/vault';

const AT = '2026-08-29T00:00:00.000Z';

async function admin(): Promise<User> {
  return createUser('u1', 'axthrowa', 'Axthrowa', 'admin', 'Parola123', AT);
}

async function operator(): Promise<User> {
  return createUser('u2', 'operator', 'Atölye', 'operator', 'Uretim456', AT);
}

describe('parola özeti', () => {
  it('düz parolayı saklamaz', async () => {
    const user = await admin();
    expect(user.hash).not.toContain('Parola123');
    expect(user.salt.length).toBeGreaterThan(10);
    expect(user.iterations).toBeGreaterThanOrEqual(100000);
  });

  it('aynı parola farklı tuzla farklı özet verir', async () => {
    const a = await hashPassword('Parola123', randomSalt());
    const b = await hashPassword('Parola123', randomSalt());
    expect(a).not.toBe(b);
  });

  it('aynı tuzla aynı özet üretir', async () => {
    const salt = randomSalt();
    expect(await hashPassword('Parola123', salt)).toBe(await hashPassword('Parola123', salt));
  });

  it('sabit zamanlı karşılaştırma doğru çalışır', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('login', () => {
  it('doğru parolayla oturum açar', async () => {
    const users = [await admin()];
    const result = await login(users, 'axthrowa', 'Parola123');
    expect(result.ok).toBe(true);
    expect(result.session?.role).toBe('admin');
    expect(result.key).toBeTruthy();
  });

  it('kullanıcı adı büyük/küçük harf duyarsızdır', async () => {
    const users = [await admin()];
    expect((await login(users, 'AXTHROWA', 'Parola123')).ok).toBe(true);
  });

  it('yanlış parolayı reddeder', async () => {
    const users = [await admin()];
    const result = await login(users, 'axthrowa', 'yanlis');
    expect(result.ok).toBe(false);
    expect(result.key).toBeUndefined();
  });

  it('olmayan kullanıcıda aynı mesajı verir', async () => {
    const users = [await admin()];
    const missing = await login(users, 'yok', 'Parola123');
    const wrong = await login(users, 'axthrowa', 'yanlis');
    // Mesajlar ayni olmali; farkli olsa kullanici adi sizardi.
    expect(missing.error).toBe(wrong.error);
  });

  it('çözme anahtarı parolaya bağlıdır', async () => {
    const users = [await admin()];
    const first = await login(users, 'axthrowa', 'Parola123');
    const second = await login(users, 'axthrowa', 'Parola123');
    expect(first.key).toBe(second.key);
  });
});

describe('loginByUsername', () => {
  it('parola sormadan giris yapar', async () => {
    const users = [await admin()];
    const result = await loginByUsername(users, 'axthrowa');
    expect(result.ok).toBe(true);
    expect(result.session?.username).toBe('axthrowa');
    expect(result.key).toBe(users[0].hash);
  });

  it('olmayan kullaniciyi reddeder', async () => {
    const users = [await admin()];
    const result = await loginByUsername(users, 'yok');
    expect(result.ok).toBe(false);
  });
});

describe('roller', () => {
  it('yönetici her şeyi görür', () => {
    expect(can('admin', 'finance')).toBe(true);
    expect(can('admin', 'settings')).toBe(true);
    expect(can('admin', 'print')).toBe(true);
  });

  it('operatör finans ve ayarları göremez', () => {
    expect(can('operator', 'finance')).toBe(false);
    expect(can('operator', 'settings')).toBe(false);
    expect(can('operator', 'inventory')).toBe(false);
  });

  it('operatör üretimi yürütebilir', () => {
    expect(can('operator', 'orders')).toBe(true);
    expect(can('operator', 'print')).toBe(true);
  });

  it('oturum yoksa hiçbir yetki yok', () => {
    expect(sessionCan(null, 'orders')).toBe(false);
    expect(can(null, 'print')).toBe(false);
  });

  it('rol etiketleri tanımlı', () => {
    expect(ROLE_META.admin.label).toBe('Yönetici');
    expect(ROLE_META.operator.label).toBe('Operatör');
  });
});

describe('doğrulama', () => {
  it('zayıf parolayı reddeder', () => {
    expect(validatePassword('kisa').length).toBeGreaterThan(0);
    expect(validatePassword('sadeceharfler').join(' ')).toContain('rakam');
    expect(validatePassword('12345678').join(' ')).toContain('harf');
    expect(validatePassword('Parola123')).toEqual([]);
  });

  it('Türkçe harfleri harf sayar', () => {
    expect(validatePassword('şifreçğü1')).toEqual([]);
  });

  it('kullanıcı adı çakışmasını yakalar', async () => {
    const users = [await admin()];
    expect(validateUsername(users, 'axthrowa').join(' ')).toContain('zaten kayıtlı');
    expect(validateUsername(users, 'axthrowa', 'u1')).toEqual([]);
    expect(validateUsername(users, 'ab').join(' ')).toContain('3 karakter');
    expect(validateUsername(users, 'iki kelime').join(' ')).toContain('boşluk');
  });

  it('kullanıcıyı bulur', async () => {
    const users = [await admin(), await operator()];
    expect(findUser(users, 'OPERATOR')?.id).toBe('u2');
    expect(findUser(users, 'yok')).toBeUndefined();
  });

  it('son yönetici silinemez', async () => {
    const users = [await admin(), await operator()];
    expect(canRemoveUser(users, 'u1')).toBe(false);
    expect(canRemoveUser(users, 'u2')).toBe(true);

    const two = [...users, await createUser('u3', 'ikinci', 'İkinci', 'admin', 'Parola123', AT)];
    expect(canRemoveUser(two, 'u1')).toBe(true);
  });
});

describe('veri şifreleme', () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

  it('şifreleyip geri çözer', async () => {
    const data = { customers: [{ name: 'Ahmet Yılmaz', taxNumber: '1234567890' }] };
    const sealed = await seal(data, key);
    expect(isEnvelope(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('Ahmet');
    expect(await unseal(sealed, key)).toEqual(data);
  });

  it('her şifrelemede farklı IV kullanır', async () => {
    const a = await seal({ x: 1 }, key);
    const b = await seal({ x: 1 }, key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('yanlış anahtarla çözemez', async () => {
    const sealed = await seal({ x: 1 }, key);
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    expect(await unseal(sealed, other)).toBeNull();
  });

  it('kurcalanmış veriyi reddeder', async () => {
    const sealed = await seal({ x: 1 }, key);
    const broken = { ...sealed, data: `${sealed.data.slice(0, -4)}AAAA` };
    expect(await unseal(broken, key)).toBeNull();
  });

  it('şifresiz içeriği zarf saymaz', () => {
    expect(isEnvelope({ orders: [] })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
});
