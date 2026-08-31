import { describe, expect, it } from 'vitest';
import { StlParseError, computeStats, parseStl } from '../lib/stlParser';
import { DENSITIES, densityOf, estimateWeight } from '../lib/materials';

/** Kenar uzunluğu `s` olan bir küpün 12 üçgeni (dışa bakan sıralama). */
function cubeTriangles(s: number): number[][] {
  const v = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 2, 1],
    [0, 3, 2], // alt
    [4, 5, 6],
    [4, 6, 7], // üst
    [0, 1, 5],
    [0, 5, 4], // ön
    [1, 2, 6],
    [1, 6, 5], // sağ
    [2, 3, 7],
    [2, 7, 6], // arka
    [3, 0, 4],
    [3, 4, 7], // sol
  ];
  return faces.map((f) => [...v[f[0]], ...v[f[1]], ...v[f[2]]]);
}

function binaryCube(s: number): ArrayBuffer {
  const tris = cubeTriangles(s);
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, tris.length, true);
  let offset = 84;
  for (const t of tris) {
    for (let i = 0; i < 3; i += 1) {
      view.setFloat32(offset, 0, true);
      offset += 4;
    }
    for (const value of t) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
}

function asciiCube(s: number): ArrayBuffer {
  const tris = cubeTriangles(s);
  let text = 'solid cube\n';
  for (const t of tris) {
    text += 'facet normal 0 0 0\n  outer loop\n';
    for (let i = 0; i < 9; i += 3) {
      text += `    vertex ${t[i]} ${t[i + 1]} ${t[i + 2]}\n`;
    }
    text += '  endloop\nendfacet\n';
  }
  text += 'endsolid cube\n';
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('parseStl', () => {
  it('ikili STL okur', () => {
    const mesh = parseStl(binaryCube(20));
    expect(mesh.format).toBe('binary');
    expect(mesh.triangleCount).toBe(12);
    expect(mesh.positions).toHaveLength(12 * 9);
  });

  it('ASCII STL okur', () => {
    const mesh = parseStl(asciiCube(20));
    expect(mesh.format).toBe('ascii');
    expect(mesh.triangleCount).toBe(12);
  });

  it('çok küçük dosyada anlamlı hata verir', () => {
    expect(() => parseStl(new ArrayBuffer(4))).toThrow(StlParseError);
  });

  it('üçgen içermeyen ASCII dosyada hata verir', () => {
    const empty = new TextEncoder().encode('solid bos\nendsolid bos\n').buffer as ArrayBuffer;
    expect(() => parseStl(empty)).toThrow(StlParseError);
  });

  it('sonuna fazladan bayt eklenmiş ikili dosyayı da okur', () => {
    const base = binaryCube(10);
    const padded = new Uint8Array(base.byteLength + 16);
    padded.set(new Uint8Array(base));
    const mesh = parseStl(padded.buffer);
    expect(mesh.triangleCount).toBe(12);
  });
});

describe('computeStats', () => {
  it('20 mm küpün hacmini ve alanını doğru hesaplar', () => {
    const stats = computeStats(parseStl(binaryCube(20)));
    // 20^3 = 8000 mm3 = 8 cm3 ; yüzey 6*400 = 2400 mm2 = 24 cm2
    expect(stats.volumeCm3).toBeCloseTo(8, 6);
    expect(stats.surfaceAreaCm2).toBeCloseTo(24, 6);
    expect(stats.size).toEqual({ x: 20, y: 20, z: 20 });
    expect(stats.triangleCount).toBe(12);
  });

  it('ASCII ve ikili aynı sonucu verir', () => {
    const a = computeStats(parseStl(binaryCube(15)));
    const b = computeStats(parseStl(asciiCube(15)));
    expect(a.volumeCm3).toBeCloseTo(b.volumeCm3, 6);
    expect(a.surfaceAreaCm2).toBeCloseTo(b.surfaceAreaCm2, 6);
  });

  it('ters sıralı üçgenlerde de pozitif hacim verir', () => {
    const mesh = parseStl(binaryCube(10));
    // Köşe sırasını ters çevirerek normalleri içe döndür
    const flipped = new Float32Array(mesh.positions);
    for (let i = 0; i < flipped.length; i += 9) {
      for (let k = 0; k < 3; k += 1) {
        const tmp = flipped[i + 3 + k];
        flipped[i + 3 + k] = flipped[i + 6 + k];
        flipped[i + 6 + k] = tmp;
      }
    }
    const stats = computeStats({ ...mesh, positions: flipped });
    expect(stats.volumeCm3).toBeCloseTo(1, 6);
  });
});

describe('densityOf', () => {
  it('bilinen malzemeleri bulur', () => {
    expect(densityOf('PLA')).toBe(DENSITIES.PLA);
    expect(densityOf('petg')).toBe(DENSITIES.PETG);
    expect(densityOf('ABS')).toBe(DENSITIES.ABS);
  });

  it('bilinmeyende PLA değerine düşer', () => {
    expect(densityOf('bilinmeyen')).toBe(DENSITIES.PLA);
    expect(densityOf(null)).toBe(DENSITIES.PLA);
    expect(densityOf('')).toBe(DENSITIES.PLA);
  });
});

describe('estimateWeight', () => {
  const cube = { volumeCm3: 8, surfaceAreaCm2: 24, density: 1.24 };

  it('%100 dolguda tüm hacmi malzeme sayar', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 1.2, infillPct: 100 });
    expect(result.materialCm3).toBeCloseTo(8, 6);
    expect(result.grams).toBeCloseTo(8 * 1.24, 6);
  });

  it('%0 dolguda yalnızca kabuk kalır', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 1.2, infillPct: 0 });
    // kabuk = 24 cm2 * 0.12 cm = 2.88 cm3
    expect(result.shellCm3).toBeCloseTo(2.88, 6);
    expect(result.infillCm3).toBe(0);
    expect(result.grams).toBeCloseTo(2.88 * 1.24, 6);
  });

  it('%20 dolguyu kabuğun üstüne ekler', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 1.2, infillPct: 20 });
    // iç = 8 - 2.88 = 5.12 ; dolgu = 1.024 ; toplam = 3.904
    expect(result.infillCm3).toBeCloseTo(1.024, 6);
    expect(result.materialCm3).toBeCloseTo(3.904, 6);
  });

  it('düz "hacim x dolgu" çarpımından daha yüksek sonuç verir', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 1.2, infillPct: 10 });
    expect(result.grams).toBeGreaterThan(8 * 0.1 * 1.24);
  });

  it('kabuk hacmi toplam hacmi aşamaz', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 50, infillPct: 100 });
    expect(result.shellCm3).toBeCloseTo(8, 6);
    expect(result.materialCm3).toBeCloseTo(8, 6);
  });

  it('negatif ve sıfır girdilerde çökmez', () => {
    const result = estimateWeight({
      volumeCm3: -5,
      surfaceAreaCm2: -1,
      wallThicknessMm: -2,
      infillPct: -10,
      density: -1,
    });
    expect(result.grams).toBe(0);
    expect(result.materialCm3).toBe(0);
  });

  it('solidGrams tüm hacmin ağırlığını verir', () => {
    const result = estimateWeight({ ...cube, wallThicknessMm: 1.2, infillPct: 15 });
    expect(result.solidGrams).toBeCloseTo(9.92, 6);
    expect(result.grams).toBeLessThan(result.solidGrams);
  });
});
