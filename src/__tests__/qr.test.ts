import { describe, expect, it } from 'vitest';
import { encodeQr, qrSvg, qrToSvg, type QrMatrix } from '../lib/qr';

/**
 * Testte BAĞIMSIZ bir okuyucu var: üretilen matris geri çözülüp özgün metinle
 * karşılaştırılır. Yalnızca yapısal kontrol yapsaydık, yerleşimdeki bir hatayı
 * fark edemezdik.
 */

const MASK_FN = [
  (r: number, c: number) => (r + c) % 2 === 0,
  (r: number) => r % 2 === 0,
  (_r: number, c: number) => c % 3 === 0,
  (r: number, c: number) => (r + c) % 3 === 0,
  (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** ISO/IEC 18004 Tablo C.1, hata düzeltme seviyesi M. */
const FORMAT_M = [
  '101010000010010',
  '101000100100101',
  '101111001111100',
  '101101101001011',
  '100010111111001',
  '100000011001110',
  '100111110010111',
  '100101010100000',
];

const VERSION_SPEC: Record<number, { ec: number; groups: Array<[number, number]> }> = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
};

/** Matristen okunan biçim bitleriyle maskeyi bulur. */
function readMask(matrix: QrMatrix): number {
  let bits = '';
  // Sol üst kopyanin dikey yarisi (i = 14..8 ters sirada okunur).
  for (let index = 14; index >= 0; index -= 1) {
    let value: boolean;
    if (index < 6) value = matrix[index][8];
    else if (index < 8) value = matrix[index + 1][8];
    else if (index === 8) value = matrix[8][7];
    else value = matrix[8][14 - index];
    bits += value ? '1' : '0';
  }
  const found = FORMAT_M.indexOf(bits);
  if (found < 0) throw new Error(`Bilinmeyen biçim bilgisi: ${bits}`);
  return found;
}

/** Veri modüllerinin kapladığı alanı işaretler (sabit desenler hariç). */
function reservedMap(size: number, version: number): boolean[][] {
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (row: number, col: number) => {
    if (row >= 0 && col >= 0 && row < size && col < size) reserved[row][col] = true;
  };

  for (const [top, left] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let dy = -1; dy <= 7; dy += 1)
      for (let dx = -1; dx <= 7; dx += 1) mark(top + dy, left + dx);
  }
  for (let index = 0; index < size; index += 1) {
    mark(6, index);
    mark(index, 6);
  }
  for (let index = 0; index < 9; index += 1) {
    mark(8, index);
    mark(index, 8);
  }
  for (let index = 0; index < 8; index += 1) {
    mark(8, size - 1 - index);
    mark(size - 1 - index, 8);
  }
  for (const row of ALIGNMENT[version]) {
    for (const col of ALIGNMENT[version]) {
      const nearFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1)
        for (let dx = -2; dx <= 2; dx += 1) mark(row + dy, col + dx);
    }
  }
  return reserved;
}

/** Matrisi çözüp özgün metni geri verir. */
function decodeQr(matrix: QrMatrix): string {
  const size = matrix.length;
  const version = (size - 17) / 4;
  const spec = VERSION_SPEC[version];
  if (!spec) throw new Error(`Test okuyucusu ${version}. sürümü desteklemiyor`);

  const mask = readMask(matrix);
  const reserved = reservedMap(size, version);

  // Zikzak okuma: kodlayıcıyla aynı sıra, maske geri alınarak.
  const bits: number[] = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    const column = col === 6 ? col - 1 : col;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const offset of [0, 1]) {
        const x = column - offset;
        if (reserved[row][x]) continue;
        const value = matrix[row][x] !== MASK_FN[mask](row, x);
        bits.push(value ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const codewords: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset];
    codewords.push(byte);
  }

  // Serpiştirmeyi geri al.
  const blockSizes: number[] = [];
  for (const [blocks, dataCount] of spec.groups) {
    for (let index = 0; index < blocks; index += 1) blockSizes.push(dataCount);
  }
  const blocks: number[][] = blockSizes.map(() => []);
  let cursor = 0;
  const maxData = Math.max(...blockSizes);
  for (let index = 0; index < maxData; index += 1) {
    for (let block = 0; block < blocks.length; block += 1) {
      if (index < blockSizes[block]) blocks[block].push(codewords[cursor++]);
    }
  }

  const data = blocks.flat();
  const mode = data[0] >> 4;
  if (mode !== 0b0100) throw new Error(`Beklenmeyen kip: ${mode}`);

  // 4 bit kip + 8 bit uzunluk (surum <= 9) hizalamasi.
  const length = ((data[0] & 0x0f) << 4) | (data[1] >> 4);
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    bytes.push(((data[1 + index] & 0x0f) << 4) | (data[2 + index] >> 4));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe('QR üretimi', () => {
  it('kısa metni 1. sürümde kodlar', () => {
    const matrix = encodeQr('SIP-0001');
    expect(matrix.length).toBe(21);
  });

  it('üretilen kod geri çözülünce aynı metni verir', () => {
    const text = 'SIP-0042';
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it('kargo takip kodunu doğru taşır', () => {
    const text = 'AB123456789TR';
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it('Türkçe karakterleri UTF-8 olarak taşır', () => {
    const text = 'Ejderha Figürü — SIP-0007';
    expect(decodeQr(encodeQr(text))).toBe(text);
  });

  it('uzun metin için daha büyük sürüm seçer', () => {
    const small = encodeQr('kisa');
    const large = encodeQr('x'.repeat(60));
    expect(large.length).toBeGreaterThan(small.length);
    expect(decodeQr(large)).toBe('x'.repeat(60));
  });

  it('URL kodlar ve geri okur', () => {
    const url = 'https://kargo.example/takip/AB123456789TR';
    expect(decodeQr(encodeQr(url))).toBe(url);
  });
});

describe('QR yapısı', () => {
  const matrix = encodeQr('SIP-0001');
  const size = matrix.length;

  it('üç köşede bulucu deseni vardır', () => {
    for (const [top, left] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      // Dis halka koyu, ici acik, cekirdek koyu.
      expect(matrix[top][left]).toBe(true);
      expect(matrix[top + 1][left + 1]).toBe(false);
      expect(matrix[top + 3][left + 3]).toBe(true);
    }
  });

  it('zamanlama desenleri değişimlidir', () => {
    for (let index = 8; index < size - 8; index += 1) {
      expect(matrix[6][index]).toBe(index % 2 === 0);
      expect(matrix[index][6]).toBe(index % 2 === 0);
    }
  });

  it('her zaman koyu olan modül işaretlidir', () => {
    expect(matrix[size - 8][8]).toBe(true);
  });

  it('biçim bilgisi ISO tablosuyla uyuşur', () => {
    // readMask tabloda bulamazsa hata firlatir.
    expect(() => readMask(matrix)).not.toThrow();
    expect(readMask(matrix)).toBeGreaterThanOrEqual(0);
    expect(readMask(matrix)).toBeLessThan(8);
  });
});

describe('SVG çıktısı', () => {
  it('sessiz alan bırakır', () => {
    const svg = qrToSvg(encodeQr('SIP-0001'), { quiet: 4 });
    // 21 modul + iki yanda 4 modul = 29
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#000"');
  });

  it('boyut verilince genişlik yazar', () => {
    expect(qrSvg('SIP-0001', 120)).toContain('width="120"');
  });

  it('boş metni reddeder', () => {
    expect(() => encodeQr('')).toThrow();
  });

  it('çok uzun metni reddeder', () => {
    expect(() => encodeQr('x'.repeat(500))).toThrow(/çok uzun/);
  });
});
