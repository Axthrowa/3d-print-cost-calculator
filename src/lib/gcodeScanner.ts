/**
 * G-code gövdesini satır satır tarayarak her araç (tool / ekstrüder) için
 * harcanan filamenti ve temizleme kulesine giden atığı ayrı ayrı toplar.
 *
 * Durum makinesi olarak yazılmıştır: `feedLine` ile beslenir, `result` ile
 * sonuç alınır. Böylece hem Web Worker'da akış hâlinde hem de testte
 * senkron çalışabilir. Bağımlılıksız ve saftır.
 */

export interface ToolScan {
  tool: number;
  /** Toplam gerçek ekstrüzyon (mm) — geri çekmeler düşülmüş hâlde. */
  extrudedMm: number;
  /** Bunun temizleme kulesi / purge bloklarında harcanan kısmı (mm). */
  wasteMm: number;
}

/** Araç başına tutulan iç durum. */
interface ToolState extends ToolScan {
  /** Geri çekilip henüz geri verilmemiş filament (mm). */
  retracted: number;
}

export interface ScanResult {
  tools: ToolScan[];
  /** Araç değiştirme sayısı. */
  toolChanges: number;
  linesRead: number;
  /** Göreli ekstrüzyon (M83) kullanılmış mı? */
  relativeExtrusion: boolean;
  /** Atık bloğu etiketi hiç görüldü mü? */
  sawWasteSection: boolean;
}

/** Atık (temizleme kulesi / purge) sayılan bölüm adları. */
const WASTE_SECTION =
  /(wipe[\s_-]*tower|prime[\s_-]*tower|purge|priming|skirt[\s_-]*brim[\s_-]*purge)/i;

/** Bir bölüm etiketi satırından bölüm adını çıkarır. */
function sectionName(line: string): string | null {
  // ;TYPE:Wipe tower   /   ; FEATURE: Prime tower   /   ;TYPE:PRIME-TOWER
  const match = line.match(/^;\s*(?:TYPE|FEATURE)\s*:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Bir G-code satırından parametre değerini okur (örn. 'E' → 12.34).
 * Regex yerine elle tarama kullanılır; milyonlarca satırda belirgin hızlıdır.
 */
export function readParam(line: string, letter: string): number | null {
  const code = letter.charCodeAt(0);
  const lower = code + 32;

  for (let i = 0; i < line.length; i += 1) {
    const c = line.charCodeAt(i);
    if (c !== code && c !== lower) continue;
    // Parametre harfi ya satır başında ya da boşluktan sonra gelmeli.
    if (i > 0) {
      const prev = line.charCodeAt(i - 1);
      if (prev !== 32 && prev !== 9) continue;
    }

    let j = i + 1;
    const start = j;
    if (line[j] === '-' || line[j] === '+') j += 1;
    let digits = 0;
    let dots = 0;
    while (j < line.length) {
      const ch = line.charCodeAt(j);
      if (ch >= 48 && ch <= 57) {
        digits += 1;
        j += 1;
      } else if (ch === 46 && dots === 0) {
        dots += 1;
        j += 1;
      } else {
        break;
      }
    }
    if (digits === 0) continue;
    const value = Number.parseFloat(line.slice(start, j));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export class GcodeScanner {
  private tools = new Map<number, ToolState>();
  private currentTool = 0;
  private absoluteE = true;
  private lastE = 0;
  private inWaste = false;
  private toolChanges = 0;
  private lines = 0;
  private relative = false;
  private sawWaste = false;

  private bucket(tool: number): ToolState {
    let entry = this.tools.get(tool);
    if (!entry) {
      entry = { tool, extrudedMm: 0, wasteMm: 0, retracted: 0 };
      this.tools.set(tool, entry);
    }
    return entry;
  }

  /** Tek bir G-code satırını işler. */
  feedLine(raw: string): void {
    this.lines += 1;
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    if (line.length === 0) return;

    const first = line.charCodeAt(0);

    // --- Yorum satırları: bölüm etiketleri ---
    if (first === 59 /* ; */) {
      const name = sectionName(line);
      if (name !== null) {
        this.inWaste = WASTE_SECTION.test(name);
        if (this.inWaste) this.sawWaste = true;
        return;
      }
      // PrusaSlicer araç değişimi temizliği: "; CP TOOLCHANGE WIPE"
      if (/^;\s*CP\s+TOOLCHANGE\s+WIPE/i.test(line)) {
        this.inWaste = true;
        this.sawWaste = true;
        return;
      }
      if (/^;\s*CP\s+TOOLCHANGE\s+END/i.test(line)) {
        this.inWaste = false;
        return;
      }
      // Serbest "purge" yorumları
      if (/^;\s*purge\b/i.test(line)) {
        this.inWaste = true;
        this.sawWaste = true;
      }
      return;
    }

    // --- Araç değişimi: T0, T1, ... ---
    if (first === 84 /* T */) {
      const tool = readParam(line, 'T') ?? Number.parseInt(line.slice(1), 10);
      if (Number.isFinite(tool) && tool >= 0 && tool <= 15) {
        if (tool !== this.currentTool) this.toolChanges += 1;
        this.currentTool = tool;
        this.bucket(tool);
      }
      return;
    }

    // --- M komutları ---
    if (first === 77 /* M */) {
      if (line.startsWith('M82')) this.absoluteE = true;
      else if (line.startsWith('M83')) {
        this.absoluteE = false;
        this.relative = true;
      }
      return;
    }

    if (first !== 71 /* G */) return;

    // --- G92: ekstrüzyon sayacını sıfırla ---
    if (line.startsWith('G92')) {
      const e = readParam(line, 'E');
      if (e !== null) this.lastE = e;
      return;
    }

    // --- G0/G1/G2/G3: hareket ---
    const second = line.charCodeAt(1);
    if (second !== 48 && second !== 49 && second !== 50 && second !== 51) return;
    // G10/G17 gibi komutları ele: ikinci karakterden sonra rakam gelmemeli.
    const third = line.charCodeAt(2);
    if (third >= 48 && third <= 57) return;

    const e = readParam(line, 'E');
    if (e === null) return;

    let delta: number;
    if (this.absoluteE) {
      delta = e - this.lastE;
      this.lastE = e;
    } else {
      delta = e;
    }

    const entry = this.bucket(this.currentTool);

    // Geri çekme: tüketim değil, borç. Sonraki pozitif hareketin bu kadarı
    // yalnızca geri verme olduğu için yeni malzeme sayılmaz.
    if (delta < 0) {
      entry.retracted += -delta;
      return;
    }
    if (entry.retracted > 0) {
      const repaid = Math.min(entry.retracted, delta);
      entry.retracted -= repaid;
      delta -= repaid;
    }
    if (delta <= 0) return;

    entry.extrudedMm += delta;
    if (this.inWaste) entry.wasteMm += delta;
  }

  /** Bir metin bloğunu satırlara ayırarak işler. */
  feedChunk(text: string): void {
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10 /* \n */) {
        this.feedLine(text.slice(start, i));
        start = i + 1;
      }
    }
    if (start < text.length) this.feedLine(text.slice(start));
  }

  result(): ScanResult {
    return {
      tools: [...this.tools.values()]
        .filter((t) => t.extrudedMm > 0)
        .sort((a, b) => a.tool - b.tool)
        .map(({ tool, extrudedMm, wasteMm }) => ({ tool, extrudedMm, wasteMm })),
      toolChanges: this.toolChanges,
      linesRead: this.lines,
      relativeExtrusion: this.relative,
      sawWasteSection: this.sawWaste,
    };
  }
}

/** Tek seferde bir metni tarar (test ve küçük dosyalar için). */
export function scanGcode(text: string): ScanResult {
  const scanner = new GcodeScanner();
  scanner.feedChunk(text);
  return scanner.result();
}
