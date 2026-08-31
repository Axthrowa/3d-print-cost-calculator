import { describe, expect, it } from 'vitest';
import { GcodeScanner, readParam, scanGcode } from '../lib/gcodeScanner';
import { buildBreakdown, normalizeHex, parseGcode, parseList } from '../lib/gcodeParser';

describe('readParam', () => {
  it('parametre değerini okur', () => {
    expect(readParam('G1 X10 Y20 E3.5 F1200', 'E')).toBeCloseTo(3.5, 6);
    expect(readParam('G1 X10 E-0.8', 'E')).toBeCloseTo(-0.8, 6);
    expect(readParam('G92 E0', 'E')).toBe(0);
  });

  it('satır başındaki harfi de okur', () => {
    expect(readParam('T2', 'T')).toBe(2);
  });

  it('kelime içindeki harfi parametre sanmaz', () => {
    // "SET_VELOCITY" içindeki E, parametre değil (öncesinde boşluk yok).
    expect(readParam('SET_VELOCITY_LIMIT ACCEL=500', 'E')).toBeNull();
  });

  it('değeri olmayan parametre için null döner', () => {
    expect(readParam('G1 X10 Y20', 'E')).toBeNull();
    expect(readParam('', 'E')).toBeNull();
  });
});

describe('scanGcode — tek renk', () => {
  it('mutlak ekstrüzyonda artışları toplar', () => {
    const gcode = ['M82', 'G92 E0', 'G1 X10 E1', 'G1 X20 E3', 'G1 X30 E7.5'].join('\n');
    const result = scanGcode(gcode);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].extrudedMm).toBeCloseTo(7.5, 6);
    expect(result.toolChanges).toBe(0);
  });

  it('geri çekme + geri verme çiftini iki kez saymaz', () => {
    const gcode = ['M82', 'G92 E0', 'G1 E5', 'G1 E3', 'G1 E8'].join('\n');
    // Mutlak modda son konum 8 => gerçekte 8 mm malzeme çıkmıştır.
    // Geri çekilen 2 mm sonraki harekette yalnızca geri verilmiştir.
    expect(scanGcode(gcode).tools[0].extrudedMm).toBeCloseTo(8, 6);
  });

  it('göreli modda geri çekme borcunu mahsup eder', () => {
    // 5 mm bas, 1 mm geri çek, 1 mm geri ver, 2 mm bas => 7 mm
    const gcode = ['M83', 'G1 E5', 'G1 E-1', 'G1 E1', 'G1 E2'].join('\n');
    expect(scanGcode(gcode).tools[0].extrudedMm).toBeCloseTo(7, 6);
  });

  it('geri çekme borcu araç bazında tutulur', () => {
    const gcode = ['M83', 'T0', 'G1 E5', 'G1 E-2', 'T1', 'G1 E4', 'T0', 'G1 E2'].join('\n');
    const result = scanGcode(gcode);
    // T0: 5 bastı, 2 borçlandı, sonra 2 geri verdi => 5. T1 borçtan etkilenmez.
    expect(result.tools[0].extrudedMm).toBeCloseTo(5, 6);
    expect(result.tools[1].extrudedMm).toBeCloseTo(4, 6);
  });

  it('göreli ekstrüzyonda (M83) değerleri doğrudan toplar', () => {
    const gcode = ['M83', 'G1 X1 E2', 'G1 X2 E3', 'G1 X3 E-1', 'G1 X4 E1'].join('\n');
    const result = scanGcode(gcode);
    // 2 + 3 = 5 ; sondaki -1/+1 çifti birbirini götürür.
    expect(result.tools[0].extrudedMm).toBeCloseTo(5, 6);
    expect(result.relativeExtrusion).toBe(true);
  });

  it('G92 sayacı sıfırlar, sahte tüketim üretmez', () => {
    const gcode = ['M82', 'G1 E100', 'G92 E0', 'G1 E5'].join('\n');
    expect(scanGcode(gcode).tools[0].extrudedMm).toBeCloseTo(105, 6);
  });

  it('hareket olmayan komutları yok sayar', () => {
    const gcode = ['M104 S200', 'M109 S200', 'G28', 'G1 X10 E1'].join('\n');
    expect(scanGcode(gcode).tools[0].extrudedMm).toBeCloseTo(1, 6);
  });
});

describe('scanGcode — çoklu renk ve atık', () => {
  const multi = [
    'M83',
    'T0',
    ';TYPE:External perimeter',
    'G1 X1 E10',
    'T1',
    ';TYPE:Wipe tower',
    'G1 X2 E4',
    ';TYPE:Internal infill',
    'G1 X3 E20',
    'T0',
    ';TYPE:Wipe tower',
    'G1 X4 E3',
    ';TYPE:Solid infill',
    'G1 X5 E5',
  ].join('\n');

  it('araç başına tüketimi ayırır', () => {
    const result = scanGcode(multi);
    expect(result.tools.map((t) => t.tool)).toEqual([0, 1]);
    expect(result.tools[0].extrudedMm).toBeCloseTo(18, 6); // 10 + 3 + 5
    expect(result.tools[1].extrudedMm).toBeCloseTo(24, 6); // 4 + 20
    // T0 zaten baslangic araci; yalnizca T0->T1 ve T1->T0 degisim sayilir.
    expect(result.toolChanges).toBe(2);
  });

  it('temizleme kulesindeki ekstrüzyonu araç bazında ayırır', () => {
    const result = scanGcode(multi);
    expect(result.tools[0].wasteMm).toBeCloseTo(3, 6);
    expect(result.tools[1].wasteMm).toBeCloseTo(4, 6);
    expect(result.sawWasteSection).toBe(true);
  });

  it('Bambu/Orca "; FEATURE:" etiketini de tanır', () => {
    const gcode = [
      'M83',
      'T0',
      '; FEATURE: Outer wall',
      'G1 E10',
      '; FEATURE: Prime tower',
      'G1 E6',
      '; FEATURE: Inner wall',
      'G1 E4',
    ].join('\n');
    const result = scanGcode(gcode);
    expect(result.tools[0].extrudedMm).toBeCloseTo(20, 6);
    expect(result.tools[0].wasteMm).toBeCloseTo(6, 6);
  });

  it('Cura PRIME-TOWER etiketini tanır', () => {
    const gcode = ['M83', ';TYPE:PRIME-TOWER', 'G1 E7', ';TYPE:WALL-OUTER', 'G1 E3'].join('\n');
    const result = scanGcode(gcode);
    expect(result.tools[0].wasteMm).toBeCloseTo(7, 6);
  });

  it('PrusaSlicer araç değişim temizliğini yakalar', () => {
    const gcode = [
      'M83',
      'T0',
      ';TYPE:Perimeter',
      'G1 E5',
      '; CP TOOLCHANGE WIPE',
      'G1 E2',
      '; CP TOOLCHANGE END',
      'G1 E1',
    ].join('\n');
    const result = scanGcode(gcode);
    expect(result.tools[0].extrudedMm).toBeCloseTo(8, 6);
    expect(result.tools[0].wasteMm).toBeCloseTo(2, 6);
  });

  it('atık etiketi yoksa atık sıfır kalır', () => {
    const result = scanGcode(['M83', 'T0', 'G1 E5', 'T1', 'G1 E5'].join('\n'));
    expect(result.sawWasteSection).toBe(false);
    expect(result.tools.every((t) => t.wasteMm === 0)).toBe(true);
  });

  it('geçersiz araç numarasını yok sayar', () => {
    const result = scanGcode(['M83', 'T99', 'G1 E5'].join('\n'));
    expect(result.tools[0].tool).toBe(0);
    expect(result.toolChanges).toBe(0);
  });

  it('parça parça beslendiğinde aynı sonucu verir', () => {
    const scanner = new GcodeScanner();
    scanner.feedChunk('M83\nT0\n;TYPE:Wipe tower\nG1 E4\n');
    scanner.feedChunk(';TYPE:Perimeter\nG1 E6\n');
    const result = scanner.result();
    expect(result.tools[0].extrudedMm).toBeCloseTo(10, 6);
    expect(result.tools[0].wasteMm).toBeCloseTo(4, 6);
  });

  it('CRLF satır sonlarını işler', () => {
    const result = scanGcode('M83\r\nT0\r\nG1 X1 E5\r\n');
    expect(result.tools[0].extrudedMm).toBeCloseTo(5, 6);
  });
});

// ---------------------------------------------------------------------------

describe('normalizeHex', () => {
  it('farklı yazımları normalleştirir', () => {
    expect(normalizeHex('#ff8000')).toBe('#FF8000');
    expect(normalizeHex('FF8000')).toBe('#FF8000');
    expect(normalizeHex('0xFF8000')).toBe('#FF8000');
    expect(normalizeHex('#f80')).toBe('#FF8800');
    expect(normalizeHex('#FF8000FF')).toBe('#FF8000');
  });

  it('geçersizde null döner', () => {
    expect(normalizeHex('kirmizi')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('parseList', () => {
  it('hem noktalı virgül hem virgülle ayırır', () => {
    expect(parseList('PLA;PETG;ABS')).toEqual(['PLA', 'PETG', 'ABS']);
    expect(parseList('1.24, 1.27')).toEqual(['1.24', '1.27']);
    expect(parseList(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const amsHeader = `; generated by BambuStudio 01.09.05.51
; filament_type = PLA;PETG;PLA
; filament_colour = #FF6A13;#0A0A0A;#1B7F3B
; filament_density = 1.24;1.27;1.24
; filament_diameter = 1.75;1.75;1.75
; total filament used [g] = 40.0,25.0,10.0
; total estimated time: 3h 10m 0s
`;

describe('parseGcode — çoklu malzeme başlığı', () => {
  it('renkleri, türleri ve araç gramajlarını okur', () => {
    const info = parseGcode(amsHeader);
    expect(info.isMultiMaterial).toBe(true);
    expect(info.tools).toHaveLength(3);
    expect(info.tools.map((t) => t.colorHex)).toEqual(['#FF6A13', '#0A0A0A', '#1B7F3B']);
    expect(info.tools.map((t) => t.filamentType)).toEqual(['PLA', 'PETG', 'PLA']);
    expect(info.tools.map((t) => t.grams)).toEqual([40, 25, 10]);
    expect(info.grams).toBeCloseTo(75, 6);
  });

  it('PrusaSlicer extruder_colour alanını da okur', () => {
    const info = parseGcode(
      '; generated by PrusaSlicer\n; extruder_colour = #FF0000;#00FF00\n; filament used [g] = 5,6\n;TIME:100\n',
    );
    expect(info.tools.map((t) => t.colorHex)).toEqual(['#FF0000', '#00FF00']);
  });

  it('kullanılmayan AMS yuvalarını eler', () => {
    const info = parseGcode(
      '; filament_colour = #FF0000;#00FF00;#0000FF;#FFFFFF\n; filament used [g] = 10,5,0,0\n;TIME:100\n',
    );
    expect(info.tools).toHaveLength(2);
  });

  it('tek renkli dosyada tek araç üretir', () => {
    const info = parseGcode('; filament used [g] = 24.5\n;TIME:100\n');
    expect(info.isMultiMaterial).toBe(false);
    expect(info.tools).toHaveLength(1);
  });

  it('temizleme kulesi gramajını okur', () => {
    const info = parseGcode(
      '; total filament used for wipe tower [g] = 12.3\n; filament used [g] = 40,25\n;TIME:100\n',
    );
    expect(info.wipeTowerGrams).toBeCloseTo(12.3, 6);
  });
});

describe('buildBreakdown', () => {
  const info = parseGcode(amsHeader);

  it('tarama verisiyle model ve atığı ayırır', () => {
    // 1.75 mm PLA'da 1 g ≈ 335 mm. T0 ≈ 40 g (%10 atık), T1 ≈ 25 g (%40 atık).
    const scan = {
      tools: [
        { tool: 0, extrudedMm: 13411, wasteMm: 1341.1 },
        { tool: 1, extrudedMm: 8184, wasteMm: 3273.6 },
      ],
      toolChanges: 4,
      linesRead: 100,
      relativeExtrusion: true,
      sawWasteSection: true,
    };
    const result = buildBreakdown(info, scan);
    expect(result.tools).toHaveLength(2);
    expect(result.wasteSource).toBe('scan');
    // Başlık T0 için 40 g diyor; tarama buna ölçeklenir, atık oranı korunur.
    expect(result.tools[0].totalGrams).toBeCloseTo(40, 1);
    expect(result.tools[0].wasteGrams).toBeCloseTo(4, 1); // %10
    expect(result.tools[0].modelGrams).toBeCloseTo(36, 1);
    expect(result.tools[1].totalGrams).toBeCloseTo(25, 1);
    expect(result.tools[1].wasteGrams).toBeCloseTo(10, 1); // %40
    expect(result.modelGrams).toBeCloseTo(51, 1);
    expect(result.wasteGrams).toBeCloseTo(14, 1);
  });

  it('renkleri araçlara taşır', () => {
    const scan = {
      tools: [{ tool: 1, extrudedMm: 100, wasteMm: 0 }],
      toolChanges: 0,
      linesRead: 1,
      relativeExtrusion: true,
      sawWasteSection: true,
    };
    expect(buildBreakdown(info, scan).tools[0].colorHex).toBe('#0A0A0A');
  });

  it('renk yoksa yedek palet kullanır', () => {
    const plain = parseGcode('; filament used [g] = 10,5\n;TIME:100\n');
    const result = buildBreakdown(plain, null);
    expect(result.tools[0].colorHex).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.tools[0].colorHex).not.toBe(result.tools[1].colorHex);
  });

  it('tarama yokken başlık atığını orantılı paylaştırır', () => {
    const withWaste = parseGcode(
      '; total filament used for wipe tower [g] = 15\n; filament used [g] = 60,40\n;TIME:100\n',
    );
    const result = buildBreakdown(withWaste, null);
    expect(result.wasteSource).toBe('header');
    expect(result.tools[0].wasteGrams).toBeCloseTo(9, 6); // 15 * 0.6
    expect(result.tools[1].wasteGrams).toBeCloseTo(6, 6); // 15 * 0.4
    expect(result.warnings.join(' ')).toContain('orantılı');
  });

  it('atık etiketi görülmediyse uyarır', () => {
    const scan = {
      tools: [
        { tool: 0, extrudedMm: 100, wasteMm: 0 },
        { tool: 1, extrudedMm: 100, wasteMm: 0 },
      ],
      toolChanges: 2,
      linesRead: 10,
      relativeExtrusion: true,
      sawWasteSection: false,
    };
    expect(buildBreakdown(info, scan).warnings.join(' ')).toContain('temizleme kulesi etiketi');
  });

  it('başlık ile tarama çok farklıysa ölçekleme yapmaz', () => {
    const scan = {
      tools: [{ tool: 0, extrudedMm: 100000, wasteMm: 0 }],
      toolChanges: 0,
      linesRead: 10,
      relativeExtrusion: true,
      sawWasteSection: true,
    };
    const result = buildBreakdown(info, scan);
    // 100 m PLA ≈ 298 g; başlıktaki 40 g'a zorla çekilmez.
    expect(result.tools[0].totalGrams).toBeGreaterThan(200);
  });

  it('boş girdide çökmez', () => {
    const result = buildBreakdown(parseGcode(''), null);
    expect(result.tools).toHaveLength(0);
    expect(result.totalGrams).toBe(0);
  });
});
