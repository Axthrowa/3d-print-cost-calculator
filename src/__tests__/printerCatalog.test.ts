import { describe, expect, it } from 'vitest';
import {
  PRINTER_CATALOG,
  extractBuildVolume,
  extractPowerWatts,
  findPrinter,
  normalizeQuery,
  parsePrinterSpecText,
  searchPrinters,
} from '../lib/printerCatalog';
import { formatDuration, formatPercent, formatTRY } from '../lib/format';

describe('katalog butunlugu', () => {
  it('tum kayitlar tutarli guc degerlerine sahiptir', () => {
    for (const printer of PRINTER_CATALOG) {
      expect(printer.avgPowerW).toBeGreaterThan(0);
      expect(printer.maxPowerW).toBeGreaterThanOrEqual(printer.avgPowerW);
      expect(printer.idlePowerW).toBeLessThan(printer.avgPowerW);
      expect(printer.lifetimeHours).toBeGreaterThan(0);
      expect(printer.buildVolume).toMatch(/\d+x\d+x\d+ mm/);
    }
  });

  it('ayni marka+model iki kez gecmez', () => {
    const keys = PRINTER_CATALOG.map((p) => `${p.brand}|${p.model}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('normalizeQuery', () => {
  it('buyuk harf, Turkce karakter ve noktalama temizler', () => {
    expect(normalizeQuery('Bambu Lab  X1-Carbon!')).toBe('bambu lab x1 carbon');
    expect(normalizeQuery('YAZICI Işık')).toBe('yazici isik');
  });
});

describe('searchPrinters', () => {
  it('tam marka+model yazimini bulur', () => {
    const match = findPrinter('Bambu Lab P1S');
    expect(match?.printer.model).toBe('P1S');
    expect(match?.score).toBeGreaterThan(0.8);
  });

  it('kisaltma (alias) ile bulur', () => {
    expect(findPrinter('x1c')?.printer.model).toBe('X1 Carbon');
    expect(findPrinter('ender3')?.printer.brand).toBe('Creality');
  });

  it('markasiz model yaziminda calisir', () => {
    const match = findPrinter('ender 3 v2');
    expect(match?.printer.model).toBe('Ender 3 V2');
  });

  it('kucuk/buyuk harf farkini yok sayar', () => {
    expect(findPrinter('CREALITY K1 MAX')?.printer.model).toBe('K1 Max');
  });

  it('alakasiz sorguda sonuc dondurmez', () => {
    expect(searchPrinters('buzdolabi arcelik')).toHaveLength(0);
    expect(searchPrinters('a')).toHaveLength(0);
    expect(searchPrinters('')).toHaveLength(0);
  });

  it('sonuclari skora gore siralar ve limiti asmaz', () => {
    const results = searchPrinters('creality ender', 3);
    expect(results.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });
});

describe('extractPowerWatts', () => {
  it('guc baglamindaki watt degerini alir', () => {
    expect(extractPowerWatts('Rated Power: 350 W')).toBe(350);
    expect(extractPowerWatts('Guc tuketimi 220W')).toBe(220);
    expect(extractPowerWatts('Power consumption: 1000 watts max')).toBe(1000);
  });

  it('baglam disi watt degerlerini yok sayar', () => {
    expect(extractPowerWatts('Lazer modulu 10 W')).toBeNull();
    expect(extractPowerWatts('Hoparlor 50 W ses cikisi')).toBeNull();
  });

  it('makul olmayan degerleri eler', () => {
    expect(extractPowerWatts('Rated power 5 W')).toBeNull();
    expect(extractPowerWatts('Power: 99999 W')).toBeNull();
  });

  it('birden fazla aday varsa nominal (en dusuk) degeri secer', () => {
    expect(extractPowerWatts('Rated power 350 W, peak power 1000 W input')).toBe(350);
  });

  it('bos girdide null doner', () => {
    expect(extractPowerWatts('')).toBeNull();
  });
});

describe('extractBuildVolume', () => {
  it('baski hacmini yakalar', () => {
    expect(extractBuildVolume('Build volume 256 x 256 x 256 mm')).toBe('256x256x256 mm');
    expect(extractBuildVolume('220×220×250')).toBe('220x220x250 mm');
  });

  it('bulunamazsa null doner', () => {
    expect(extractBuildVolume('teknik bilgi yok')).toBeNull();
  });
});

describe('parsePrinterSpecText', () => {
  it('guc ve hacmi birlikte cikarir', () => {
    const spec = parsePrinterSpecText(
      'Specifications: Rated Power 350W, Build volume 220x220x250 mm',
    );
    expect(spec.powerW).toBe(350);
    expect(spec.buildVolume).toBe('220x220x250 mm');
    expect(spec.warnings).toHaveLength(0);
  });

  it('guc yoksa uyari ekler, cokmez', () => {
    const spec = parsePrinterSpecText('Bu sayfada teknik bilgi yok');
    expect(spec.powerW).toBeNull();
    expect(spec.warnings.length).toBeGreaterThan(0);
  });
});

describe('bicimlendirme', () => {
  it('TL bicimlendirir', () => {
    expect(formatTRY(1234.5)).toContain('1.234,50');
    expect(formatTRY(Number.NaN)).toContain('0,00');
  });

  it('sure bicimlendirir', () => {
    expect(formatDuration(4.5)).toBe('4 sa 30 dk');
    expect(formatDuration(2)).toBe('2 sa');
    expect(formatDuration(0.25)).toBe('15 dk');
    expect(formatDuration(0)).toBe('0 dk');
  });

  it('yuzde bicimlendirir', () => {
    expect(formatPercent(42.56)).toBe('%42,6');
    expect(formatPercent(42.44)).toBe('%42,4');
    expect(formatPercent(40, 0)).toBe('%40');
  });
});
