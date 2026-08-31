import { afterEach, describe, expect, it } from 'vitest';
import {
  PRINTER_CATALOG,
  allPrinters,
  findPrinter,
  isConfidentMatch,
  searchPrinters,
  setCustomPrinters,
} from '../lib/printerCatalog';

/** Aramanın ilk sırada döndürdüğü "Marka Model". */
function top(query: string): string {
  const match = findPrinter(query);
  return match ? `${match.printer.brand} ${match.printer.model}` : '(bulunamadı)';
}

/** Katalog değeri kullanıcıya sorulmadan uygulanır mı? */
function confident(query: string): boolean {
  const match = findPrinter(query);
  return match ? isConfidentMatch(match, query) : false;
}

describe('yazıcı arama — doğru model', () => {
  const cases: Array<[string, string]> = [
    ['Ender 3', 'Creality Ender 3'],
    ['ender 3 v2', 'Creality Ender 3 V2'],
    ['Ender-3 S1 Pro', 'Creality Ender 3 S1 Pro'],
    ['Creality K1', 'Creality K1'],
    ['Creality K1 Max', 'Creality K1 Max'],
    ['K1C', 'Creality K1C'],
    ['Bambu Lab P1S', 'Bambu Lab P1S'],
    ['Bambu Lab A1', 'Bambu Lab A1'],
    ['A1 mini', 'Bambu Lab A1 mini'],
    ['X1C', 'Bambu Lab X1 Carbon'],
    ['Prusa MK4', 'Prusa MK4'],
    ['prusa mk3s+', 'Prusa MK3S+'],
    ['Anycubic Kobra 2', 'Anycubic Kobra 2'],
    ['Kobra 2 Neo', 'Anycubic Kobra 2 Neo'],
    ['Elegoo Neptune 4', 'Elegoo Neptune 4'],
    ['Neptune 4 Pro', 'Elegoo Neptune 4 Pro'],
    ['Snapmaker 2.0 A350', 'Snapmaker 2.0 A350'],
    ['Flashforge Guider 3', 'Flashforge Guider 3'],
    ['AnkerMake M5C', 'AnkerMake M5C'],
    ['Kingroon KP3S', 'Kingroon KP3S'],
  ];

  it.each(cases)('%s -> %s', (query, expected) => {
    expect(top(query)).toBe(expected);
  });
});

describe('daha spesifik model daha genelini gölgelememeli', () => {
  /**
   * Eski puanlama tek yönlüydü: sorgunun tamamı eşleşiyorsa 1.00 veriyordu.
   * Bu yüzden "K1" araması "K1 Max" için de 1.00 alıyor ve sıralama tesadüfe
   * kalıyordu. Puan artık simetrik: modelde bulunup sorguda geçmeyen kelime
   * de cezalandırılır.
   */
  const pairs: Array<[string, string, string]> = [
    ['K1', 'K1', 'K1 Max'],
    ['Ender 3', 'Ender 3', 'Ender 3 S1'],
    ['A1', 'A1', 'A1 mini'],
    ['Kobra 2', 'Kobra 2', 'Kobra 2 Max'],
    ['Neptune 4', 'Neptune 4', 'Neptune 4 Pro'],
    ['SV06', 'SV06', 'SV06 Plus'],
  ];

  it.each(pairs)('"%s" aramasında %s, %s modelinden önce gelir', (query, winner, loser) => {
    const results = searchPrinters(query, 8);
    const winnerIndex = results.findIndex((m) => m.printer.model === winner);
    const loserIndex = results.findIndex((m) => m.printer.model === loser);
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    if (loserIndex >= 0) {
      expect(results[winnerIndex].score).toBeGreaterThan(results[loserIndex].score);
    }
  });
});

describe('yanlış modeli sessizce uygulamama', () => {
  it('"Ender 3 Pro" gerçek Ender 3 Pro kaydını bulur', () => {
    // Katalogda bu model yokken arama "Ender 3 S1 Pro" veriyor ve onun
    // güç değerlerini sessizce uyguluyordu.
    expect(top('Ender 3 Pro')).toBe('Creality Ender 3 Pro');
    expect(confident('Ender 3 Pro')).toBe(true);
  });

  it('katalogda olmayan model için güvenli eşleşme iddia etmez', () => {
    expect(confident('Creality Zephyr 9000')).toBe(false);
    expect(confident('bilinmeyen yazici 12345')).toBe(false);
  });

  it('yalnızca marka yazınca rastgele model seçmez', () => {
    expect(confident('Creality')).toBe(false);
    expect(confident('Bambu Lab')).toBe(false);
  });

  it('çok kısa sorguyu reddeder', () => {
    expect(searchPrinters('a')).toEqual([]);
    expect(searchPrinters('')).toEqual([]);
  });
});

describe('yazım toleransı', () => {
  it('marka bitişik yazılabilir', () => {
    expect(top('bambulab p1s')).toBe('Bambu Lab P1S');
    expect(confident('bambulab p1s')).toBe(true);
  });

  it('marka kısaltılabilir', () => {
    expect(top('Anker M5')).toBe('AnkerMake M5');
  });

  it('tire ve büyük harf önemsiz', () => {
    expect(top('ENDER-3 V2')).toBe('Creality Ender 3 V2');
    expect(top('ender3')).toBe('Creality Ender 3');
  });

  it('takma adlar çalışır', () => {
    expect(top('X1C')).toBe('Bambu Lab X1 Carbon');
  });
});

describe('katalog bütünlüğü', () => {
  it('kayıtlar makul güç değerleri taşır', () => {
    for (const printer of PRINTER_CATALOG) {
      const label = `${printer.brand} ${printer.model}`;
      // Ortalama, pikten büyük olamaz; boşta, ortalamadan büyük olamaz.
      expect(printer.avgPowerW, label).toBeLessThanOrEqual(printer.maxPowerW);
      expect(printer.idlePowerW, label).toBeLessThanOrEqual(printer.avgPowerW);
      expect(printer.avgPowerW, label).toBeGreaterThan(0);
    }
  });

  it('baskı hacmi biçimi tutarlı', () => {
    for (const printer of PRINTER_CATALOG) {
      expect(printer.buildVolume, `${printer.brand} ${printer.model}`).toMatch(/^\d+x\d+x\d+ mm$/);
    }
  });

  it('aynı marka+model iki kez geçmez', () => {
    const seen = new Set<string>();
    for (const printer of PRINTER_CATALOG) {
      const key = `${printer.brand}|${printer.model}`.toLowerCase();
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('her kayıt aranabilir', () => {
    // Kendi adıyla aranan her yazıcı ilk sırada kendisi olmalı.
    for (const printer of PRINTER_CATALOG) {
      const query = `${printer.brand} ${printer.model}`;
      expect(top(query), query).toBe(query);
    }
  });
});

describe('kullanıcının eklediği yazıcılar', () => {
  const custom = {
    brand: 'Snapmaker',
    model: 'U1',
    aliases: ['u1', 'snapmaker u1'],
    avgPowerW: 150,
    maxPowerW: 400,
    idlePowerW: 12,
    technology: 'FDM' as const,
    buildVolume: '200x200x200 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  };

  afterEach(() => setCustomPrinters([]));

  it('eklenen yazıcı aramada çıkar', () => {
    expect(top('Zeta Marka Model9')).toBe('(bulunamadı)');
    setCustomPrinters([{ ...custom, brand: 'Zeta Marka', model: 'Model9', aliases: [] }]);
    expect(top('Zeta Marka Model9')).toBe('Zeta Marka Model9');
    expect(confident('Zeta Marka Model9')).toBe(true);
  });

  it('takma adla da bulunur', () => {
    setCustomPrinters([{ ...custom, brand: 'Zeta Marka', model: 'Model9', aliases: ['zm9'] }]);
    expect(top('zm9')).toBe('Zeta Marka Model9');
  });

  it('yerleşik katalogla birlikte aranır', () => {
    setCustomPrinters([custom]);
    // Kullanici kaydi yerlesik kayitlari gizlememeli.
    expect(top('Snapmaker J1')).toBe('Snapmaker J1');
    expect(allPrinters().length).toBe(PRINTER_CATALOG.length + 1);
  });

  it('liste temizlenince arama da temizlenir', () => {
    setCustomPrinters([{ ...custom, brand: 'Zeta Marka', model: 'Model9', aliases: [] }]);
    setCustomPrinters([]);
    expect(top('Zeta Marka Model9')).toBe('(bulunamadı)');
  });
});

describe('Snapmaker U1 (yerleşik katalogda)', () => {
  it('aranınca bulunur', () => {
    expect(top('Snapmaker U1')).toBe('Snapmaker U1');
    expect(top('u1')).toBe('Snapmaker U1');
    expect(confident('Snapmaker U1')).toBe(true);
  });

  it('J1 ile karışmaz', () => {
    expect(top('Snapmaker J1')).toBe('Snapmaker J1');
    expect(top('Snapmaker J1s')).toBe('Snapmaker J1s');
  });

  it('resmi değerleri taşır', () => {
    const u1 = PRINTER_CATALOG.find((p) => p.brand === 'Snapmaker' && p.model === 'U1');
    // Uretici sayfasindan dogrulanan degerler.
    expect(u1?.buildVolume).toBe('270x270x270 mm');
    expect(u1?.maxPowerW).toBe(1150);
    expect(u1?.enclosure).toBe(false);
    expect(u1?.heatedBed).toBe(true);
  });
});
