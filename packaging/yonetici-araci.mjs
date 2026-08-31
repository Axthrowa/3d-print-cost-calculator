/**
 * Yönetici Hesap Aracı — uygulamadan bağımsız çalışır.
 *
 * Kullanıcı adını ve parolasını uygulamaya girmeden değiştirmek için. Parolayı
 * unuttuysanız veya kullanıcı adını değiştirmek istiyorsanız bunu kullanın.
 *
 * ÖNEMLİ — şifreleme:
 * Uygulamada "Veri şifreleme" açıksa parola aynı zamanda veri dosyasının
 * ANAHTARIDIR. Bu yüzden şifreli bir dosyada parola değiştirmek için ESKİ
 * PAROLA gerekir: dosya eski parolayla açılır, yeni parolayla yeniden
 * kapatılır. Eski parola olmadan bu mümkün değildir — veriler matematiksel
 * olarak açılamaz. Şifreleme kapalıysa parola serbestçe sıfırlanabilir.
 *
 * Kullanım:  node yonetici-araci.mjs
 * Hiçbir üçüncü parti bağımlılık yoktur.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile, writeFile, rename, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { webcrypto as crypto } from 'node:crypto';

// Uygulamayla BİREBİR aynı olmalı (src/lib/auth.ts ve src/lib/vault.ts).
const PBKDF2_ITERATIONS = 210_000;
const KEY_BYTES = 32;
const IV_BYTES = 12;

const DATA_DIR = join(process.env.APPDATA || homedir(), '3D Baski Maliyet');
const DATA_FILE = join(DATA_DIR, 'veri.json');

const rl = createInterface({ input: stdin, output: stdout });

/**
 * Satirlari TEK bir async yineleyiciden okuruz.
 *
 * readline'a birden fazla yerden dokunmak (ham kip, ayri question cagrilari)
 * borulanmis girdide satirlarin kaybolmasina yol aciyordu. Tek yineleyici
 * hem terminalde hem "echo ... | node" bicinde dogru calisir.
 */
const satirlar = rl[Symbol.asyncIterator]();

async function sor(soru) {
  stdout.write(soru);
  const { value, done } = await satirlar.next();
  if (done) throw new Error('Girdi beklenmedik sekilde bitti.');
  return String(value ?? '').trim();
}

const yaz = (satir = '') => stdout.write(`${satir}\n`);
const cizgi = () => yaz('─'.repeat(58));

/**
 * Parolayı ekranda göstermeden okur.
 *
 * Terminalde readline'ın kendi yankısı geçici olarak susturulur; borulanmış
 * girdide zaten yankı yoktur.
 */
async function parolaSor(soru) {
  stdout.write(soru);
  let sessiz = true;
  const orijinal = rl._writeToOutput?.bind(rl);
  if (orijinal) {
    rl._writeToOutput = (metin) => {
      if (!sessiz) orijinal(metin);
    };
  }
  try {
    const { value, done } = await satirlar.next();
    if (done) throw new Error('Girdi beklenmedik sekilde bitti.');
    return String(value ?? '');
  } finally {
    sessiz = false;
    if (orijinal) rl._writeToOutput = orijinal;
    stdout.write('\n');
  }
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromB64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

async function anahtarTuret(parola, saltB64, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(parola),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(saltB64), iterations, hash: 'SHA-256' },
    base,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

const ozet = async (parola, salt, iterations) => b64(await anahtarTuret(parola, salt, iterations));

function yeniSalt() {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

async function kasaAc(zarf, anahtarB64) {
  const key = await crypto.subtle.importKey('raw', fromB64(anahtarB64), 'AES-GCM', false, [
    'decrypt',
  ]);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(zarf.iv) },
    key,
    fromB64(zarf.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function kasaKapat(veri, anahtarB64) {
  const key = await crypto.subtle.importKey('raw', fromB64(anahtarB64), 'AES-GCM', false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(veri)),
  );
  return { v: 1, enc: 'AES-GCM', iv: b64(iv), data: b64(new Uint8Array(cipher)) };
}

/** Dosyayı atomik yazar; önce yedek alır. */
async function dosyayaYaz(icerik) {
  await mkdir(DATA_DIR, { recursive: true });
  const yedek = join(DATA_DIR, `veri.yedek-${Date.now()}.json`);
  if (existsSync(DATA_FILE)) await copyFile(DATA_FILE, yedek);
  const gecici = join(DATA_DIR, 'veri.arac.json');
  await writeFile(gecici, JSON.stringify(icerik), 'utf-8');
  await rename(gecici, DATA_FILE);
  return yedek;
}

function parolaKurallari(parola) {
  const hatalar = [];
  if (parola.length < 8) hatalar.push('en az 8 karakter');
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(parola)) hatalar.push('en az bir harf');
  if (!/\d/.test(parola)) hatalar.push('en az bir rakam');
  return hatalar;
}

async function main() {
  cizgi();
  yaz('  3D Baskı Maliyet — Yönetici Hesap Aracı');
  cizgi();
  yaz(`  Veri dosyası: ${DATA_FILE}`);
  yaz('');

  if (!existsSync(DATA_FILE)) {
    yaz('  Veri dosyası bulunamadı.');
    yaz('  Uygulamayı bir kez açıp kapatın, sonra bu aracı tekrar çalıştırın.');
    return;
  }

  let dosya;
  try {
    dosya = JSON.parse(await readFile(DATA_FILE, 'utf-8'));
  } catch {
    yaz('  Veri dosyası okunamadı (bozuk olabilir).');
    yaz(`  "veri.onceki.json" dosyasını "veri.json" yapıp deneyebilirsiniz.`);
    return;
  }

  const sifreli = Boolean(dosya?.vault);
  const kullanicilar = Array.isArray(dosya?.users) ? dosya.users : [];

  if (kullanicilar.length === 0) {
    yaz('  Kayıtlı kullanıcı yok. Uygulama ilk açılışta yöneticiyi oluşturur.');
    return;
  }

  yaz(`  Şifreleme: ${sifreli ? 'AÇIK' : 'kapalı'}`);
  yaz('');
  yaz('  Kayıtlı kullanıcılar:');
  kullanicilar.forEach((u, i) => {
    const etiket = u.master ? ' (ana yönetici)' : '';
    yaz(`    ${i + 1}. ${u.username} — ${u.displayName} · ${u.role}${etiket}`);
  });
  yaz('');

  const secim = await sor(`  Hangi kullanıcı? (1-${kullanicilar.length}, iptal için Enter): `);
  const index = Number(secim) - 1;
  const kullanici = kullanicilar[index];
  if (!kullanici) {
    yaz('  İşlem iptal edildi.');
    return;
  }

  yaz('');
  yaz('  Ne yapmak istiyorsunuz?');
  yaz('    1. Kullanıcı adını değiştir');
  yaz('    2. Parolayı değiştir');
  yaz('    3. Her ikisi');
  const islem = await sor('  Seçim (1-3): ');
  if (!['1', '2', '3'].includes(islem.trim())) {
    yaz('  İşlem iptal edildi.');
    return;
  }

  const adDegisecek = islem.trim() === '1' || islem.trim() === '3';
  const parolaDegisecek = islem.trim() === '2' || islem.trim() === '3';

  let yeniAd = kullanici.username;
  if (adDegisecek) {
    yeniAd = await sor(`  Yeni kullanıcı adı [${kullanici.username}]: `);
    if (!yeniAd) yeniAd = kullanici.username;
    if (yeniAd.length < 3 || /\s/.test(yeniAd)) {
      yaz('  Kullanıcı adı en az 3 karakter olmalı ve boşluk içermemeli.');
      return;
    }
    const cakisma = kullanicilar.some(
      (u) => u !== kullanici && u.username.toLowerCase() === yeniAd.toLowerCase(),
    );
    if (cakisma) {
      yaz('  Bu kullanıcı adı zaten kayıtlı.');
      return;
    }
  }

  // --- Şifreli dosyada eski parola şart: anahtar ondan türüyor. ---
  let icerik = null;
  let eskiAnahtar = null;
  if (sifreli) {
    yaz('');
    yaz('  Veri dosyası şifreli. Açabilmek için bu kullanıcının MEVCUT parolası gerekli.');
    const eski = await parolaSor('  Mevcut parola: ');
    eskiAnahtar = await ozet(eski, kullanici.salt, kullanici.iterations ?? PBKDF2_ITERATIONS);
    if (eskiAnahtar !== kullanici.hash) {
      yaz('  Parola hatalı. Hiçbir değişiklik yapılmadı.');
      return;
    }
    icerik = await kasaAc(dosya.vault, eskiAnahtar);
    if (!icerik) {
      yaz('  Dosya bu parolayla açılamadı. Hiçbir değişiklik yapılmadı.');
      return;
    }
    yaz('  Dosya açıldı.');
  }

  let yeniSaltDeger = kullanici.salt;
  let yeniOzet = kullanici.hash;
  let yeniAnahtar = eskiAnahtar;

  if (parolaDegisecek) {
    yaz('');
    const p1 = await parolaSor('  Yeni parola: ');
    const hatalar = parolaKurallari(p1);
    if (hatalar.length > 0) {
      yaz(`  Parola şu kurallara uymalı: ${hatalar.join(', ')}.`);
      return;
    }
    const p2 = await parolaSor('  Yeni parola (tekrar): ');
    if (p1 !== p2) {
      yaz('  Parolalar aynı değil. Hiçbir değişiklik yapılmadı.');
      return;
    }
    yeniSaltDeger = yeniSalt();
    yeniOzet = await ozet(p1, yeniSaltDeger, PBKDF2_ITERATIONS);
    yeniAnahtar = yeniOzet;
  }

  // --- Kaydı güncelle ---
  const guncel = {
    ...kullanici,
    username: yeniAd,
    salt: yeniSaltDeger,
    hash: yeniOzet,
    iterations: PBKDF2_ITERATIONS,
  };
  const yeniKullanicilar = kullanicilar.map((u) => (u === kullanici ? guncel : u));

  let yeniDosya;
  if (sifreli) {
    // Parola degistiyse kasa YENI anahtarla yeniden kapatilir.
    yeniDosya = { users: yeniKullanicilar, vault: await kasaKapat(icerik, yeniAnahtar) };
  } else {
    yeniDosya = { ...dosya, users: yeniKullanicilar };
  }

  const yedek = await dosyayaYaz(yeniDosya);

  yaz('');
  cizgi();
  yaz('  Tamamlandı.');
  if (adDegisecek) yaz(`  Kullanıcı adı: ${kullanici.username} → ${yeniAd}`);
  if (parolaDegisecek) yaz('  Parola değiştirildi.');
  if (sifreli && parolaDegisecek) yaz('  Veri dosyası yeni parolayla yeniden şifrelendi.');
  yaz(`  Yedek: ${yedek}`);
  cizgi();
}

try {
  await main();
} catch (error) {
  yaz('');
  yaz(`  Beklenmeyen hata: ${error?.message ?? error}`);
  yaz('  Veri dosyasına dokunulmadı.');
} finally {
  rl.close();
}
