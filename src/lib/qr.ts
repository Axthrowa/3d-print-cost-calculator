/**
 * QR kodu üreteci (bayt kipi, hata düzeltme seviyesi M).
 *
 * Üçüncü parti kütüphane eklenmedi: kargo etiketi için tek bir küçük modül
 * uğruna paketi büyütmek istemedik. ISO/IEC 18004'ün bayt kipi, sürüm 1-10
 * aralığı uygulanmıştır; sipariş kodu / takip numarası gibi kısa metinler
 * fazlasıyla sığar.
 *
 * Akış: veri kodsözcükleri → Reed-Solomon hata düzeltme → blok serpiştirme
 * → matris yerleşimi → 8 maskenin ceza puanı → en iyisinin seçimi.
 */

export type QrMatrix = boolean[][];

/** Sürüm başına: [toplam kodsözcüğü, blok başına EC, [blok, veri] grupları]. */
interface VersionSpec {
  ecPerBlock: number;
  groups: Array<{ blocks: number; dataCodewords: number }>;
}

// Hata düzeltme seviyesi M tablosu (ISO/IEC 18004 Tablo 13-22).
const VERSIONS: Record<number, VersionSpec> = {
  1: { ecPerBlock: 10, groups: [{ blocks: 1, dataCodewords: 16 }] },
  2: { ecPerBlock: 16, groups: [{ blocks: 1, dataCodewords: 28 }] },
  3: { ecPerBlock: 26, groups: [{ blocks: 1, dataCodewords: 44 }] },
  4: { ecPerBlock: 18, groups: [{ blocks: 2, dataCodewords: 32 }] },
  5: { ecPerBlock: 24, groups: [{ blocks: 2, dataCodewords: 43 }] },
  6: { ecPerBlock: 16, groups: [{ blocks: 4, dataCodewords: 27 }] },
  7: { ecPerBlock: 18, groups: [{ blocks: 4, dataCodewords: 31 }] },
  8: {
    ecPerBlock: 22,
    groups: [
      { blocks: 2, dataCodewords: 38 },
      { blocks: 2, dataCodewords: 39 },
    ],
  },
  9: {
    ecPerBlock: 22,
    groups: [
      { blocks: 3, dataCodewords: 36 },
      { blocks: 2, dataCodewords: 37 },
    ],
  },
  10: {
    ecPerBlock: 26,
    groups: [
      { blocks: 4, dataCodewords: 43 },
      { blocks: 1, dataCodewords: 44 },
    ],
  },
};

const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

function dataCapacity(version: number): number {
  return VERSIONS[version].groups.reduce(
    (sum, group) => sum + group.blocks * group.dataCodewords,
    0,
  );
}

// --------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d; // QR'in ilkel polinomu
  }
  for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Verilen dereceden üretici polinom. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let position = 0; position < poly.length; position += 1) {
      next[position] ^= poly[position];
      next[position + 1] ^= gfMul(poly[position], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecLength: number): number[] {
  const generator = generatorPoly(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let index = 0; index < generator.length - 1; index += 1) {
        remainder[index] ^= gfMul(generator[index + 1], factor);
      }
    }
  }
  return remainder;
}

// ------------------------------------------------------------ Bit yığını

class BitBuffer {
  private bits: number[] = [];

  put(value: number, length: number): void {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.bits.push((value >>> index) & 1);
    }
  }

  get length(): number {
    return this.bits.length;
  }

  toCodewords(): number[] {
    const out: number[] = [];
    for (let index = 0; index < this.bits.length; index += 8) {
      let byte = 0;
      for (let offset = 0; offset < 8; offset += 1) {
        byte = (byte << 1) | (this.bits[index + offset] ?? 0);
      }
      out.push(byte);
    }
    return out;
  }
}

// ---------------------------------------------------------------- Matris

function emptyMatrix(size: number): Array<Array<boolean | null>> {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(matrix: Array<Array<boolean | null>>, row: number, col: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const y = row + dy;
      const x = col + dx;
      if (y < 0 || x < 0 || y >= matrix.length || x >= matrix.length) continue;
      const border = dy === -1 || dy === 7 || dx === -1 || dx === 7;
      const ring = dy === 0 || dy === 6 || dx === 0 || dx === 6;
      const core = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
      matrix[y][x] = !border && (ring || core);
    }
  }
}

function placeAlignment(matrix: Array<Array<boolean | null>>, version: number): void {
  const centers = ALIGNMENT[version];
  for (const row of centers) {
    for (const col of centers) {
      // Bulucu desenlerin oldugu koseler atlanir.
      const size = matrix.length;
      const nearFinder =
        (row <= 8 && col <= 8) || (row <= 8 && col >= size - 9) || (row >= size - 9 && col <= 8);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          matrix[row + dy][col + dx] = Math.max(Math.abs(dy), Math.abs(dx)) !== 1;
        }
      }
    }
  }
}

/** BCH(15,5) biçim bilgisi; maskeyle karıştırılır. */
function formatBits(maskIndex: number): number {
  // 0b00 = seviye M
  let value = (0b00 << 3) | maskIndex;
  let bch = value << 10;
  for (let index = 14; index >= 10; index -= 1) {
    if ((bch >>> index) & 1) bch ^= 0b10100110111 << (index - 10);
  }
  value = ((value << 10) | bch) ^ 0b101010000010010;
  return value;
}

/** BCH(18,6) sürüm bilgisi (sürüm 7 ve üzeri). */
function versionBits(version: number): number {
  let bch = version << 12;
  for (let index = 17; index >= 12; index -= 1) {
    if ((bch >>> index) & 1) bch ^= 0b1111100100101 << (index - 12);
  }
  return (version << 12) | bch;
}

function maskAt(pattern: number, row: number, col: number): boolean {
  switch (pattern) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

/** Standardın ceza kuralları; en düşük puanlı maske seçilir. */
function penalty(matrix: QrMatrix): number {
  const size = matrix.length;
  let score = 0;

  // Kural 1: aynı renkte 5+ ardışık modül.
  for (let axis = 0; axis < 2; axis += 1) {
    for (let a = 0; a < size; a += 1) {
      let run = 1;
      for (let b = 1; b < size; b += 1) {
        const current = axis === 0 ? matrix[a][b] : matrix[b][a];
        const previous = axis === 0 ? matrix[a][b - 1] : matrix[b - 1][a];
        if (current === previous) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Kural 2: 2x2 aynı renk blokları.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const value = matrix[row][col];
      if (
        value === matrix[row][col + 1] &&
        value === matrix[row + 1][col] &&
        value === matrix[row + 1][col + 1]
      ) {
        score += 3;
      }
    }
  }

  // Kural 3: bulucu desene benzeyen 1:1:3:1:1 dizileri.
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line: boolean[], start: number, pattern: boolean[]) =>
    pattern.every((value, index) => line[start + index] === value);

  for (let axis = 0; axis < 2; axis += 1) {
    for (let a = 0; a < size; a += 1) {
      const line: boolean[] = [];
      for (let b = 0; b < size; b += 1) line.push(axis === 0 ? matrix[a][b] : matrix[b][a]);
      for (let start = 0; start + 11 <= size; start += 1) {
        if (matches(line, start, patternA) || matches(line, start, patternB)) score += 40;
      }
    }
  }

  // Kural 4: koyu modül oranının %50'den sapması.
  const dark = matrix.flat().filter(Boolean).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/** Metni UTF-8 bayt dizisine çevirir. */
function toBytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataCapacity(version)) return version;
  }
  throw new Error('Metin QR kodu için çok uzun (en fazla 10. sürüm).');
}

/**
 * Metni QR matrisine çevirir. Dönen dizi satır satır `true` = koyu modül.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = toBytes(text);
  if (bytes.length === 0) throw new Error('QR için metin boş olamaz.');
  const version = pickVersion(bytes.length);
  const spec = VERSIONS[version];
  const capacity = dataCapacity(version);

  // 1) Bit akışı: kip + uzunluk + veri + sonlandırıcı + dolgu.
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);

  const capacityBits = capacity * 8;
  buffer.put(0, Math.min(4, capacityBits - buffer.length));
  if (buffer.length % 8 !== 0) buffer.put(0, 8 - (buffer.length % 8));

  const codewords = buffer.toCodewords();
  const PAD = [0xec, 0x11];
  while (codewords.length < capacity)
    codewords.push(PAD[(codewords.length - buffer.length / 8) % 2]);

  // 2) Bloklara böl, her bloğa Reed-Solomon ekle.
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let cursor = 0;
  for (const group of spec.groups) {
    for (let index = 0; index < group.blocks; index += 1) {
      const block = codewords.slice(cursor, cursor + group.dataCodewords);
      cursor += group.dataCodewords;
      dataBlocks.push(block);
      ecBlocks.push(reedSolomon(block, spec.ecPerBlock));
    }
  }

  // 3) Serpiştirme.
  const interleaved: number[] = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let index = 0; index < maxData; index += 1) {
    for (const block of dataBlocks) if (index < block.length) interleaved.push(block[index]);
  }
  for (let index = 0; index < spec.ecPerBlock; index += 1) {
    for (const block of ecBlocks) interleaved.push(block[index]);
  }

  // 4) Sabit desenler.
  const size = version * 4 + 17;
  const base = emptyMatrix(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  for (let index = 8; index < size - 8; index += 1) {
    base[6][index] = index % 2 === 0;
    base[index][6] = index % 2 === 0;
  }
  base[size - 8][8] = true; // her zaman koyu olan modül

  // Biçim ve sürüm alanları veri yerleşiminde atlanmalı.
  const reserved = base.map((row) => row.map((cell) => cell !== null));
  for (let index = 0; index < 9; index += 1) {
    reserved[8][index] = true;
    reserved[index][8] = true;
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][size - 1 - index] = true;
    reserved[size - 1 - index][8] = true;
  }
  if (version >= 7) {
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        reserved[row][size - 11 + col] = true;
        reserved[size - 11 + col][row] = true;
      }
    }
  }

  // 5) Veriyi zikzak yerleştir.
  const bitsOf = (list: number[]) => {
    const out: boolean[] = [];
    for (const byte of list) for (let i = 7; i >= 0; i -= 1) out.push(((byte >> i) & 1) === 1);
    return out;
  };
  const stream = bitsOf(interleaved);
  let bitIndex = 0;
  let upward = true;

  for (let col = size - 1; col > 0; col -= 2) {
    const column = col === 6 ? col - 1 : col; // 6. sütun zamanlama deseni
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const offset of [0, 1]) {
        const x = column - offset;
        if (reserved[row][x]) continue;
        base[row][x] = bitIndex < stream.length ? stream[bitIndex] : false;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  // 6) Maskeleri dene, en düşük cezalıyı seç.
  let best: QrMatrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate: QrMatrix = base.map((row, y) =>
      row.map((cell, x) => {
        const value = cell === null ? false : cell;
        return reserved[y][x] ? value : value !== maskAt(mask, y, x);
      }),
    );

    const format = formatBits(mask);
    for (let index = 0; index < 15; index += 1) {
      const bit = ((format >> index) & 1) === 1;
      // Sol üst
      if (index < 6) candidate[index][8] = bit;
      else if (index < 8) candidate[index + 1][8] = bit;
      else if (index === 8) candidate[8][7] = bit;
      else candidate[8][14 - index] = bit;
      // Sağ üst / sol alt
      if (index < 8) candidate[8][size - 1 - index] = bit;
      else candidate[size - 15 + index][8] = bit;
    }
    candidate[size - 8][8] = true;

    if (version >= 7) {
      const info = versionBits(version);
      for (let index = 0; index < 18; index += 1) {
        const bit = ((info >> index) & 1) === 1;
        const row = Math.floor(index / 3);
        const col = index % 3;
        candidate[row][size - 11 + col] = bit;
        candidate[size - 11 + col][row] = bit;
      }
    }

    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best as QrMatrix;
}

/** QR matrisini ölçeklenebilir SVG'ye çevirir (yazdırma için). */
export function qrToSvg(matrix: QrMatrix, options: { quiet?: number; size?: number } = {}): string {
  const quiet = options.quiet ?? 4;
  const modules = matrix.length;
  const total = modules + quiet * 2;
  const path: string[] = [];

  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (matrix[row][col]) path.push(`M${col + quiet} ${row + quiet}h1v1h-1z`);
    }
  }

  const size = options.size ? ` width="${options.size}" height="${options.size}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${size} shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path.join('')}" fill="#000"/>` +
    `</svg>`
  );
}

/** Tek adımda: metin → SVG. */
export function qrSvg(text: string, size?: number): string {
  return qrToSvg(encodeQr(text), size ? { size } : {});
}
