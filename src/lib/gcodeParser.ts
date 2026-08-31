/**
 * G-code başlık/altbilgi yorumlarından baskı süresi, filament tüketimi,
 * araç (ekstrüder) başına gramaj ve renk bilgisini çıkaran ayrıştırıcı.
 *
 * PrusaSlicer / SuperSlicer, OrcaSlicer, Bambu Studio, Cura, Simplify3D,
 * ideaMaker, Snapmaker Luban ve KISSlicer çıktıları desteklenir. Saf ve
 * bağımlılıksızdır; hiçbir fonksiyon exception fırlatmaz.
 */

import type { ScanResult } from './gcodeScanner';

/** Tek bir araç (ekstrüder / AMS yuvası) için başlıktan okunan bilgiler. */
export interface GcodeTool {
  index: number;
  colorHex: string | null;
  filamentType: string | null;
  /** Başlıkta yazan gramaj (varsa). */
  grams: number | null;
  lengthMm: number | null;
  density: number | null;
  diameterMm: number | null;
}

export interface GcodeInfo {
  ok: boolean;
  slicer: string | null;
  /** Tahmini baskı süresi (saniye). */
  printSeconds: number | null;
  /** Toplam kullanılan filament (gram). */
  grams: number | null;
  /** Toplam filament uzunluğu (mm). */
  lengthMm: number | null;
  filamentType: string | null;
  density: number | null;
  diameterMm: number | null;
  layerHeightMm: number | null;
  gramsSource: 'file' | 'computed' | null;
  /** Araç başına bilgiler (tek renkte tek eleman). */
  tools: GcodeTool[];
  /** Dosya çoklu malzeme (AMS / MMU) kullanıyor mu? */
  isMultiMaterial: boolean;
  /** Başlıkta bildirilen temizleme kulesi atığı (gram). */
  wipeTowerGrams: number | null;
  warnings: string[];
}

const EMPTY: GcodeInfo = {
  ok: false,
  slicer: null,
  printSeconds: null,
  grams: null,
  lengthMm: null,
  filamentType: null,
  density: null,
  diameterMm: null,
  layerHeightMm: null,
  gramsSource: null,
  tools: [],
  isMultiMaterial: false,
  wipeTowerGrams: null,
  warnings: [],
};

/** Renk atanmamış araçlar için ayırt edici yedek palet. */
export const FALLBACK_COLORS = [
  '#38BDF8',
  '#FB7185',
  '#34D399',
  '#FACC15',
  '#A78BFA',
  '#FB923C',
  '#22D3EE',
  '#F472B6',
];

/**
 * "2h 4m 33s", "1 hours 23 minutes", "01:15:23", "16320" gibi süre
 * gösterimlerini saniyeye çevirir.
 */
export function parseDuration(raw: string): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();

  const clock = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (clock) {
    const a = Number(clock[1]);
    const b = Number(clock[2]);
    const c = clock[3] === undefined ? null : Number(clock[3]);
    return c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  }

  const unitPattern =
    /(\d+(?:[.,]\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
  let total = 0;
  let matched = false;
  for (const match of text.matchAll(unitPattern)) {
    const value = Number.parseFloat(match[1].replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    matched = true;
    const unit = match[2];
    if (unit.startsWith('d')) total += value * 86400;
    else if (unit.startsWith('h')) total += value * 3600;
    else if (unit.startsWith('m')) total += value * 60;
    else total += value;
  }
  if (matched) return total;

  const plain = text.match(/^(\d+(?:\.\d+)?)$/);
  if (plain) {
    const value = Number.parseFloat(plain[1]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/** "#f80", "FF8000", "0xFF8000" → "#FF8000". Geçersizse null. */
export function normalizeHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/^0x/i, '').replace(/^#/, '');
  if (/^[0-9a-f]{8}$/i.test(value)) value = value.slice(0, 6); // RGBA → RGB
  if (/^[0-9a-f]{3}$/i.test(value)) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return `#${value.toUpperCase()}`;
}

/** ";" veya "," ile ayrılmış listeyi parçalar. */
export function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function readNumber(text: string, patterns: RegExp[]): number | null {
  const raw = firstMatch(text, patterns);
  if (raw === null) return null;
  const value = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Listedeki sayıları döndürür (çok ekstrüderli alanlar için). */
function readNumberList(text: string, patterns: RegExp[]): number[] {
  return parseList(firstMatch(text, patterns))
    .map((part) => Number.parseFloat(part.replace(',', '.')))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function readSum(text: string, patterns: RegExp[]): number | null {
  const values = readNumberList(text, patterns).filter((v) => v > 0);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

const SLICERS: Array<[RegExp, string]> = [
  [/prusaslicer/i, 'PrusaSlicer'],
  [/superslicer/i, 'SuperSlicer'],
  [/orcaslicer/i, 'OrcaSlicer'],
  [/bambustudio|bambu studio/i, 'Bambu Studio'],
  [/snapmaker|luban/i, 'Snapmaker Luban'],
  [/cura/i, 'Cura'],
  [/simplify3d/i, 'Simplify3D'],
  [/ideamaker/i, 'ideaMaker'],
  [/kisslicer/i, 'KISSlicer'],
  [/slic3r/i, 'Slic3r'],
];

const GRAM_PATTERNS = [
  /;\s*total filament weight \[g\]\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*total filament used \[g\]\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*filament used \[g\]\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*Plastic weight\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*filament_weight\s*[=:]\s*([\d.,;\s]+)/i,
];

const LENGTH_PATTERNS = [
  /;\s*total filament used \[mm\]\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*filament used \[mm\]\s*[=:]\s*([\d.,;\s]+)/i,
  /;\s*Filament length\s*[=:]\s*([\d.,;\s]+)\s*mm/i,
  /;\s*Material#\d+ Used\s*[=:]\s*([\d.,;\s]+)/i,
];

const COLOR_PATTERNS = [
  /;\s*filament_colour\s*[=:]\s*([^\r\n]+)/i,
  /;\s*filament_color\s*[=:]\s*([^\r\n]+)/i,
  /;\s*extruder_colour\s*[=:]\s*([^\r\n]+)/i,
  /;\s*extruder_color\s*[=:]\s*([^\r\n]+)/i,
  /;\s*filament colour\s*[=:]\s*([^\r\n]+)/i,
];

/** Filament uzunluğu ve çapından gramaj hesaplar. */
export function gramsFromLength(lengthMm: number, diameterMm: number, density: number): number {
  if (!(lengthMm > 0) || !(diameterMm > 0) || !(density > 0)) return 0;
  const radius = diameterMm / 2;
  const volumeMm3 = Math.PI * radius * radius * lengthMm;
  return (volumeMm3 / 1000) * density;
}

/** Bir aracın rengi: dosyadan gelen ya da yedek paletten. */
function toolColor(tool: GcodeTool): string {
  return tool.colorHex ?? FALLBACK_COLORS[tool.index % FALLBACK_COLORS.length];
}

/**
 * G-code metnini ayrıştırır. Büyük dosyalarda yalnızca baş ve son bölümün
 * verilmesi yeterlidir; tüm slicer'lar bu bilgileri yorum satırlarına yazar.
 */
export function parseGcode(text: string): GcodeInfo {
  const result: GcodeInfo = { ...EMPTY, tools: [], warnings: [] };
  if (typeof text !== 'string' || text.trim().length === 0) {
    result.warnings.push('Dosya boş görünüyor.');
    return result;
  }

  try {
    for (const [pattern, name] of SLICERS) {
      if (pattern.test(text)) {
        result.slicer = name;
        break;
      }
    }

    // --- Süre ---
    const timeRaw = firstMatch(text, [
      /;\s*estimated printing time \(normal mode\)\s*[=:]\s*([^\r\n;]+)/i,
      /;\s*estimated printing time[^=:\r\n]*[=:]\s*([^\r\n;]+)/i,
      /;\s*total estimated time\s*[=:]\s*([^\r\n;]+)/i,
      /;\s*model printing time\s*[=:]\s*([^\r\n;]+)/i,
      /;\s*Build time\s*[=:]\s*([^\r\n;]+)/i,
      /;\s*Estimated Build Time\s*[=:]\s*([^\r\n;]+)/i,
      /;\s*Print Time\s*[=:]\s*([^\r\n;]+)/i,
      /;TIME:\s*([^\r\n]+)/i,
      /;\s*PRINT\.TIME\s*[=:]\s*([^\r\n]+)/i,
    ]);
    if (timeRaw !== null) result.printSeconds = parseDuration(timeRaw);

    // --- Araç bazlı diziler ---
    const typeList = parseList(
      firstMatch(text, [
        /;\s*filament_type\s*[=:]\s*([^\r\n]+)/i,
        /;\s*filament type\s*[=:]\s*([^\r\n]+)/i,
        /;\s*Material\s*[=:]\s*([A-Za-z0-9+\-; ,]+)/i,
      ]),
    ).map((value) => value.toUpperCase());

    const colorList = parseList(firstMatch(text, COLOR_PATTERNS))
      .map(normalizeHex)
      .filter((value): value is string => value !== null);

    const densityList = readNumberList(text, [
      /;\s*filament_density\s*[=:]\s*([\d.,;\s]+)/i,
      /;\s*filament density\s*[=:]\s*([\d.,;\s]+)/i,
    ]);
    const diameterList = readNumberList(text, [
      /;\s*filament_diameter\s*[=:]\s*([\d.,;\s]+)/i,
      /;\s*filament diameter\s*[=:]\s*([\d.,;\s]+)/i,
    ]);
    const gramList = readNumberList(text, GRAM_PATTERNS);
    const lengthList = readNumberList(text, LENGTH_PATTERNS);

    result.filamentType = typeList[0] ?? null;
    result.density = densityList[0] ?? null;
    result.diameterMm = diameterList[0] ?? null;

    result.layerHeightMm = readNumber(text, [
      /;\s*layer_height\s*[=:]\s*([\d.,]+)/i,
      /;\s*Layer height\s*[=:]\s*([\d.,]+)/i,
      /;\s*layerHeight\s*[=:]\s*([\d.,]+)/i,
    ]);

    result.wipeTowerGrams = readNumber(text, [
      /;\s*total filament used for wipe tower \[g\]\s*[=:]\s*([\d.,]+)/i,
      /;\s*wipe tower filament \[g\]\s*[=:]\s*([\d.,]+)/i,
    ]);

    // --- Toplamlar ---
    const grams = readSum(text, GRAM_PATTERNS);
    if (grams !== null) {
      result.grams = grams;
      result.gramsSource = 'file';
    }

    const lengthMm = readSum(text, LENGTH_PATTERNS);
    if (lengthMm !== null) {
      result.lengthMm = lengthMm;
    } else {
      // Cura metre cinsinden yazar: ";Filament used: 8.20343m, 1.2m"
      const meters = readSum(text, [/;\s*Filament used\s*[=:]\s*([\d.,m;\s]+)/i]);
      if (meters !== null) result.lengthMm = meters * 1000;
    }

    if (result.grams === null && result.lengthMm !== null) {
      const diameter = result.diameterMm ?? 1.75;
      const density = result.density ?? 1.24;
      const computed = gramsFromLength(result.lengthMm, diameter, density);
      if (computed > 0) {
        result.grams = computed;
        result.gramsSource = 'computed';
        result.warnings.push(
          `Gramaj dosyada yoktu; ${result.lengthMm.toFixed(0)} mm uzunluktan ` +
            `${diameter} mm çap ve ${density} g/cm³ özkütle ile hesaplandı.`,
        );
      }
    }

    // --- Araç listesi ---
    const toolCount = Math.max(
      1,
      typeList.length,
      colorList.length,
      gramList.length,
      lengthList.length,
      densityList.length,
      diameterList.length,
    );

    for (let i = 0; i < toolCount; i += 1) {
      const toolLength = lengthList[i] ?? null;
      const density = densityList[i] ?? densityList[0] ?? null;
      const diameter = diameterList[i] ?? diameterList[0] ?? null;
      let toolGrams: number | null = gramList[i] ?? null;
      if (toolGrams === null && toolLength !== null) {
        const computed = gramsFromLength(toolLength, diameter ?? 1.75, density ?? 1.24);
        toolGrams = computed > 0 ? computed : null;
      }
      result.tools.push({
        index: i,
        colorHex: colorList[i] ?? null,
        filamentType: typeList[i] ?? typeList[0] ?? null,
        grams: toolGrams,
        lengthMm: toolLength,
        density,
        diameterMm: diameter,
      });
    }

    // Kullanılmayan yuvaları ele: birden fazla araç varsa yalnızca tüketimi
    // olanları tut (AMS profilleri çoğu zaman 4 yuvayı da listeler).
    const used = result.tools.filter((tool) => (tool.grams ?? 0) > 0 || (tool.lengthMm ?? 0) > 0);
    if (used.length > 0 && used.length < result.tools.length) result.tools = used;

    result.isMultiMaterial = result.tools.length > 1;

    if (result.printSeconds === null) {
      result.warnings.push('Baskı süresi bulunamadı, elle girmeniz gerekiyor.');
    }
    if (result.grams === null) {
      result.warnings.push('Filament tüketimi bulunamadı, elle girmeniz gerekiyor.');
    }

    result.ok = result.printSeconds !== null || result.grams !== null;
    if (!result.ok) {
      result.warnings.push(
        'Bu dosyada dilimleyici özet bilgisi bulunamadı. Dilimleyicide "yorum satırlarını dahil et" seçeneğinin açık olduğundan emin olun.',
      );
    }
  } catch (error) {
    result.warnings.push(
      `G-code ayrıştırma hatası: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
    );
  }

  return result;
}

/** Saniyeyi hesaplayıcının saat/dakika alanlarına böler. */
export function splitDuration(totalSeconds: number): { hours: number; minutes: number } {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.round(totalSeconds / 60);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

// ---------------------------------------------------------------------------
// Araç bazlı döküm
// ---------------------------------------------------------------------------

export interface ToolBreakdown {
  index: number;
  colorHex: string;
  filamentType: string | null;
  /** Modele giden filament (gram). */
  modelGrams: number;
  /** Temizleme kulesine giden atık (gram). */
  wasteGrams: number;
  totalGrams: number;
}

export interface BreakdownResult {
  tools: ToolBreakdown[];
  modelGrams: number;
  wasteGrams: number;
  totalGrams: number;
  /** Atık verisi nereden geldi? */
  wasteSource: 'scan' | 'header' | 'none';
  warnings: string[];
}

/**
 * Başlık bilgisi ile gövde taramasını birleştirip araç başına model/atık
 * dökümünü üretir.
 *
 * Tarama varsa atık ayrımı ondan gelir; toplamlar başlıkta da bildirilmişse
 * tarama sonucu başlığa göre ölçeklenir (başlık dilimleyicinin kendi
 * hesabıdır ve daha güvenilirdir), atık oranı korunur.
 */
export function buildBreakdown(info: GcodeInfo, scan: ScanResult | null): BreakdownResult {
  const warnings: string[] = [];
  const tools: ToolBreakdown[] = [];

  const headerTool = (index: number): GcodeTool | undefined =>
    info.tools.find((t) => t.index === index);

  const colorFor = (index: number): string => {
    const tool = headerTool(index);
    return tool ? toolColor(tool) : FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  };

  if (scan && scan.tools.length > 0) {
    for (const entry of scan.tools) {
      const header = headerTool(entry.tool);
      const density = header?.density ?? info.density ?? 1.24;
      const diameter = header?.diameterMm ?? info.diameterMm ?? 1.75;

      let total = gramsFromLength(entry.extrudedMm, diameter, density);
      let waste = gramsFromLength(entry.wasteMm, diameter, density);

      // Başlıkta bu araç için gramaj varsa taramayı ona göre ölçekle.
      const headerGrams = header?.grams ?? null;
      if (headerGrams !== null && total > 0) {
        const factor = headerGrams / total;
        // Aşırı sapma ölçekleme değil, veri uyumsuzluğu demektir.
        if (factor > 0.5 && factor < 2) {
          total *= factor;
          waste *= factor;
        }
      }

      tools.push({
        index: entry.tool,
        colorHex: colorFor(entry.tool),
        filamentType: header?.filamentType ?? info.filamentType,
        modelGrams: Math.max(0, total - waste),
        wasteGrams: waste,
        totalGrams: total,
      });
    }

    if (!scan.sawWasteSection && scan.tools.length > 1) {
      warnings.push(
        'Dosyada temizleme kulesi etiketi bulunamadı; atık ayrımı yapılamadı. Dilimleyicide "prime/wipe tower" kapalı olabilir.',
      );
    }
  } else {
    // Tarama yok: yalnızca başlık bilgisi.
    const headerWaste = info.wipeTowerGrams ?? 0;
    const totalHeaderGrams = info.tools.reduce((sum, t) => sum + (t.grams ?? 0), 0);

    for (const tool of info.tools) {
      const total = tool.grams ?? 0;
      // Başlık atığı araçlara tüketim oranında paylaştırılır.
      const share = totalHeaderGrams > 0 ? total / totalHeaderGrams : 0;
      const waste = headerWaste * share;
      tools.push({
        index: tool.index,
        colorHex: toolColor(tool),
        filamentType: tool.filamentType,
        modelGrams: Math.max(0, total - waste),
        wasteGrams: waste,
        totalGrams: total,
      });
    }
    if (headerWaste > 0) {
      warnings.push('Atık, başlıktaki toplam kule değerinden orantılı paylaştırıldı.');
    }
  }

  const modelGrams = tools.reduce((sum, t) => sum + t.modelGrams, 0);
  const wasteGrams = tools.reduce((sum, t) => sum + t.wasteGrams, 0);

  return {
    tools,
    modelGrams,
    wasteGrams,
    totalGrams: modelGrams + wasteGrams,
    wasteSource:
      scan && scan.sawWasteSection ? 'scan' : info.wipeTowerGrams !== null ? 'header' : 'none',
    warnings,
  };
}
