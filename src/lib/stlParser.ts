/**
 * STL (ikili ve ASCII) okuyucu ve geometri hesapları.
 *
 * Hacim, ıraksama teoremiyle (signed tetrahedron toplamı) hesaplanır; kapalı
 * bir kabuk için doğru sonucu verir. Bağımlılıksız ve saftır.
 */

export interface StlMesh {
  /** Üçgen köşeleri, üçlü gruplar hâlinde: [x,y,z, x,y,z, x,y,z, ...] */
  positions: Float32Array;
  triangleCount: number;
  format: 'binary' | 'ascii';
}

export interface StlStats {
  /** Hacim (cm³). */
  volumeCm3: number;
  /** Yüzey alanı (cm²). */
  surfaceAreaCm2: number;
  /** Sınır kutusu (mm). */
  size: { x: number; y: number; z: number };
  triangleCount: number;
}

export class StlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StlParseError';
  }
}

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;

/** Dosyanın ikili STL olup olmadığını boyut tutarlılığından anlar. */
function looksBinary(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < HEADER_BYTES + 4) return false;
  const view = new DataView(buffer);
  const count = view.getUint32(HEADER_BYTES, true);
  const expected = HEADER_BYTES + 4 + count * TRIANGLE_BYTES;
  if (expected === buffer.byteLength) return true;

  // Bazı yazılımlar sonuna fazladan bayt ekler; yine de ikili sayılır.
  if (count > 0 && expected <= buffer.byteLength && buffer.byteLength - expected < 128) return true;

  // "solid" ile başlıyorsa ve boyut tutmuyorsa ASCII kabul et.
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)));
  return head.trim().toLowerCase() !== 'solid';
}

function parseBinary(buffer: ArrayBuffer): StlMesh {
  const view = new DataView(buffer);
  const count = view.getUint32(HEADER_BYTES, true);
  const available = Math.floor((buffer.byteLength - HEADER_BYTES - 4) / TRIANGLE_BYTES);
  const triangleCount = Math.min(count, available);

  if (triangleCount <= 0) throw new StlParseError('Dosyada üçgen bulunamadı.');

  const positions = new Float32Array(triangleCount * 9);
  let offset = HEADER_BYTES + 4;
  let cursor = 0;

  for (let i = 0; i < triangleCount; i += 1) {
    offset += 12; // normal vektörü atlanır, kendimiz hesaplarız
    for (let v = 0; v < 9; v += 1) {
      positions[cursor++] = view.getFloat32(offset, true);
      offset += 4;
    }
    offset += 2; // öznitelik bayt sayısı
  }

  return { positions, triangleCount, format: 'binary' };
}

function parseAscii(text: string): StlMesh {
  const values: number[] = [];
  const pattern = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;

  for (const match of text.matchAll(pattern)) {
    const x = Number.parseFloat(match[1]);
    const y = Number.parseFloat(match[2]);
    const z = Number.parseFloat(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    values.push(x, y, z);
  }

  const triangleCount = Math.floor(values.length / 9);
  if (triangleCount <= 0) throw new StlParseError('ASCII STL içinde geçerli üçgen bulunamadı.');

  return {
    positions: new Float32Array(values.slice(0, triangleCount * 9)),
    triangleCount,
    format: 'ascii',
  };
}

/** STL dosyasını okur. Biçimi kendisi tespit eder. */
export function parseStl(buffer: ArrayBuffer): StlMesh {
  if (!buffer || buffer.byteLength < 15) {
    throw new StlParseError('Dosya bir STL modeli için fazla küçük.');
  }
  if (looksBinary(buffer)) return parseBinary(buffer);
  return parseAscii(new TextDecoder().decode(buffer));
}

/**
 * Hacim, yüzey alanı ve sınır kutusunu tek geçişte hesaplar.
 * STL birimi milimetre kabul edilir (dilimleyicilerin varsayılanı).
 */
export function computeStats(mesh: StlMesh): StlStats {
  const p = mesh.positions;
  let volumeMm3 = 0;
  let areaMm2 = 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i];
    const ay = p[i + 1];
    const az = p[i + 2];
    const bx = p[i + 3];
    const by = p[i + 4];
    const bz = p[i + 5];
    const cx = p[i + 6];
    const cy = p[i + 7];
    const cz = p[i + 8];

    // İşaretli tetrahedron hacmi: a · (b × c) / 6
    volumeMm3 +=
      (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;

    // Üçgen alanı: |(b-a) × (c-a)| / 2
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    areaMm2 += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;

    if (ax < minX) minX = ax;
    if (bx < minX) minX = bx;
    if (cx < minX) minX = cx;
    if (ay < minY) minY = ay;
    if (by < minY) minY = by;
    if (cy < minY) minY = cy;
    if (az < minZ) minZ = az;
    if (bz < minZ) minZ = bz;
    if (cz < minZ) minZ = cz;

    if (ax > maxX) maxX = ax;
    if (bx > maxX) maxX = bx;
    if (cx > maxX) maxX = cx;
    if (ay > maxY) maxY = ay;
    if (by > maxY) maxY = by;
    if (cy > maxY) maxY = cy;
    if (az > maxZ) maxZ = az;
    if (bz > maxZ) maxZ = bz;
    if (cz > maxZ) maxZ = cz;
  }

  const finite = Number.isFinite(minX);
  return {
    volumeCm3: Math.abs(volumeMm3) / 1000,
    surfaceAreaCm2: areaMm2 / 100,
    size: finite ? { x: maxX - minX, y: maxY - minY, z: maxZ - minZ } : { x: 0, y: 0, z: 0 },
    triangleCount: mesh.triangleCount,
  };
}
