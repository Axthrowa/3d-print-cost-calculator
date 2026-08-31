// src/lib/filamentParser.ts
var KNOWN_BRANDS = [
  "Porima",
  "Filameon",
  "Microzey",
  "eSUN",
  "Sunlu",
  "Bambu Lab",
  "Bambulab",
  "Prusament",
  "Polymaker",
  "Fillamentum",
  "Filamentum",
  "Overture",
  "Elegoo",
  "Creality",
  "Anycubic",
  "Hatchbox",
  "Kexcelled",
  "Tinmorry",
  "Eryone",
  "AzureFilm",
  "FormFutura",
  "ColorFabb",
  "Devil Design",
  "Spectrum",
  "Filamix",
  "Abakus",
  "Yousu",
  "Jayo",
  "Geeetech",
  "Amolen"
];
var MATERIAL_PATTERNS = [
  [/\bPLA\s*\+|\bPLA\s*PLUS\b/i, "PLA+"],
  [/\bPLA[\s-]*SILK\b|\bSILK[\s-]*PLA\b/i, "PLA Silk"],
  [/\bPET[\s-]?CF\b/i, "PET-CF"],
  [/\bPA[\s-]?CF\b|\bNYLON[\s-]?CF\b/i, "PA-CF"],
  [/\bPETG\b/i, "PETG"],
  [/\bASA\b/i, "ASA"],
  [/\bABS\b/i, "ABS"],
  [/\bTPU\b|\bFLEX\b/i, "TPU"],
  [/\bNYLON\b|\bPA12\b|\bPA6\b/i, "NYLON"],
  [/\bPVA\b/i, "PVA"],
  [/\bHIPS\b/i, "HIPS"],
  [/\bPC\b|\bPOLYCARBONATE\b|\bPOLIKARBON\b/i, "PC"],
  [/\bPLA\b/i, "PLA"]
];
var CURRENCY_MAP = [
  [/₺|\bTL\b|\bTRY\b/i, "TRY"],
  [/\$|\bUSD\b/i, "USD"],
  [/€|\bEUR\b/i, "EUR"],
  [/£|\bGBP\b/i, "GBP"]
];
function parseLocaleNumber(raw) {
  if (raw === null || raw === void 0) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/\s/g, "").replace(/[^\d.,-]/g, "").replace(/(?!^)-/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = cleaned.split(sep);
    const decimals = parts[parts.length - 1].length;
    const isThousands = parts.length > 2 || decimals === 3 && parts[0].replace("-", "").length <= 3;
    normalized = isThousands ? parts.join("") : parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
  } else {
    normalized = cleaned;
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: String.fromCharCode(39),
  nbsp: " ",
  euro: "\u20AC",
  pound: "\xA3"
};
function codePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 1114111) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => codePoint(Number.parseInt(dec, 10))).replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}
function stripHtml(html) {
  return decodeEntities(
    html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}
function extractWeightGrams(text) {
  if (!text) return null;
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kilogram|kg|gram|gr|g)\b/gi)];
  const candidates = [];
  for (const match of matches) {
    const value = parseLocaleNumber(match[1]);
    if (value === null || value <= 0) continue;
    const unit = match[2].toLowerCase();
    const grams = unit === "kg" || unit === "kilogram" ? value * 1e3 : value;
    if (grams >= 50 && grams <= 25e3) candidates.push(grams);
  }
  if (candidates.length === 0) return null;
  const common = [250, 500, 750, 800, 1e3, 2e3, 2300, 3e3, 5e3];
  const preferred = candidates.find((c) => common.includes(Math.round(c)));
  return preferred ?? candidates[0];
}
function detectMaterial(text) {
  if (!text) return null;
  for (const [pattern, label] of MATERIAL_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}
var TR_FOLD = {
  \u0131: "i",
  \u0130: "i",
  \u015F: "s",
  \u015E: "s",
  \u011F: "g",
  \u011E: "g",
  \u00FC: "u",
  \u00DC: "u",
  \u00F6: "o",
  \u00D6: "o",
  \u00E7: "c",
  \u00C7: "c"
};
function fold(text) {
  return text.replace(/[ıİşŞğĞüÜöÖçÇ]/g, (ch) => TR_FOLD[ch] ?? ch).toLowerCase();
}
var COLOR_MODIFIERS = [
  [/\bmat\b|\bmatte\b/, "Mat"],
  [/\bparlak\b|\bglossy\b/, "Parlak"],
  [/\bneon\b/, "Neon"],
  [/\bmetalik\b|\bmetallic\b/, "Metalik"],
  [/\bfosforlu\b|\bglow\b/, "Fosforlu"],
  [/\bsilk\b|\bipeksi\b/, "Silk"],
  [/\bacik\b|\blight\b/, "A\xE7\u0131k"],
  [/\bkoyu\b|\bdark\b/, "Koyu"]
];
var COLOR_WORDS = [
  { words: ["kahverengi", "brown"], label: "Kahverengi", hex: "#8B5A2B" },
  { words: ["kahve"], label: "Kahve", hex: "#8B5A2B" },
  { words: ["lacivert", "navy"], label: "Lacivert", hex: "#1E3A8A" },
  { words: ["turkuaz", "turquoise", "cyan"], label: "Turkuaz", hex: "#14B8A6" },
  { words: ["seffaf", "transparent", "clear"], label: "\u015Eeffaf", hex: "#CBD5E1" },
  { words: ["dogal", "natural"], label: "Do\u011Fal", hex: "#E8DCC8" },
  { words: ["siyah", "black"], label: "Siyah", hex: "#1F2937" },
  { words: ["beyaz", "white"], label: "Beyaz", hex: "#F8FAFC" },
  { words: ["kirmizi", "red"], label: "K\u0131rm\u0131z\u0131", hex: "#DC2626" },
  { words: ["mavi", "blue"], label: "Mavi", hex: "#2563EB" },
  { words: ["yesil", "green"], label: "Ye\u015Fil", hex: "#16A34A" },
  { words: ["sari", "yellow"], label: "Sar\u0131", hex: "#EAB308" },
  { words: ["turuncu", "orange"], label: "Turuncu", hex: "#EA580C" },
  { words: ["mor", "purple", "violet"], label: "Mor", hex: "#7C3AED" },
  { words: ["pembe", "pink", "magenta"], label: "Pembe", hex: "#EC4899" },
  { words: ["gri", "grey", "gray"], label: "Gri", hex: "#6B7280" },
  { words: ["altin", "gold"], label: "Alt\u0131n", hex: "#D4AF37" },
  { words: ["gumus", "silver"], label: "G\xFCm\xFC\u015F", hex: "#B9BEC6" },
  { words: ["bronz", "bronze"], label: "Bronz", hex: "#A97142" },
  { words: ["bakir", "copper"], label: "Bak\u0131r", hex: "#B87333" },
  { words: ["bej", "beige"], label: "Bej", hex: "#D8C3A5" },
  { words: ["krem", "cream", "ivory"], label: "Krem", hex: "#F5EBDC" },
  { words: ["mint"], label: "Mint", hex: "#6EE7B7" },
  { words: ["lila", "lilac"], label: "Lila", hex: "#C4B5FD" },
  { words: ["fusya", "fuchsia"], label: "Fu\u015Fya", hex: "#D946EF" },
  { words: ["bordo", "burgundy", "maroon"], label: "Bordo", hex: "#7B1E2B" },
  { words: ["antrasit", "anthracite", "charcoal"], label: "Antrasit", hex: "#3B3F45" },
  { words: ["haki", "khaki"], label: "Haki", hex: "#78866B" },
  { words: ["zeytin", "olive"], label: "Zeytin", hex: "#6B7A3A" },
  { words: ["somon", "salmon"], label: "Somon", hex: "#FA8072" },
  { words: ["vizon", "taupe"], label: "Vizon", hex: "#9C8574" },
  { words: ["petrol", "teal"], label: "Petrol", hex: "#0E5C63" },
  { words: ["kiremit", "terracotta"], label: "Kiremit", hex: "#B75A3C" },
  { words: ["sampanya", "champagne"], label: "\u015Eampanya", hex: "#E6D5A8" },
  { words: ["fildisi"], label: "Fildi\u015Fi", hex: "#F5F0E1" },
  { words: ["ekru", "ecru"], label: "Ekru", hex: "#D8CDBA" },
  { words: ["gokkusagi", "rainbow"], label: "G\xF6kku\u015Fa\u011F\u0131", hex: "#A78BFA" },
  { words: ["lavanta", "lavender"], label: "Lavanta", hex: "#B39DDB" },
  { words: ["papatya", "daisy"], label: "Papatya", hex: "#F7F3E3" },
  { words: ["marsala"], label: "Marsala", hex: "#8D4C57" },
  { words: ["titanyum", "titanium"], label: "Titanyum", hex: "#8A8D8F" },
  { words: ["ten", "nude"], label: "Ten", hex: "#E8C4A0" },
  { words: ["peach"], label: "Peach", hex: "#FFCBA4" },
  { words: ["fuzz"], label: "Fuzz", hex: "#FFDAB9" }
];
var GENERIC_PAGE_NAMES = /* @__PURE__ */ new Set([
  "anasayfa",
  "home",
  "homepage",
  "index",
  "urun",
  "product",
  "products",
  "shop",
  "store",
  "kategori",
  "category"
]);
var COLOR_SUFFIXES = ["", "i", "si", "u", "su", "li", "lu", "ler", "lar", "msi", "imsi"];
var SUFFIX_GROUP = [...COLOR_SUFFIXES].filter(Boolean).sort((a, b) => b.length - a.length).join("|");
var COLOR_PATTERNS = COLOR_WORDS.map(({ words, label }) => [
  new RegExp("(?<![a-z0-9])(" + words.join("|") + ")(?:" + SUFFIX_GROUP + ")?(?![a-z0-9])", "i"),
  label
]);
function colorToHex(name) {
  if (!name) return null;
  const folded = fold(name);
  for (const { words, hex } of COLOR_WORDS) {
    for (const word of words) {
      for (const suffix of COLOR_SUFFIXES) {
        const pattern = new RegExp("(?<![a-z0-9])" + word + suffix + "(?![a-z0-9])");
        if (pattern.test(folded)) return hex;
      }
    }
  }
  return null;
}
function detectColor(text) {
  if (!text) return null;
  const folded = fold(text);
  let base = null;
  for (const [pattern, label] of COLOR_PATTERNS) {
    if (pattern.test(folded)) {
      base = label;
      break;
    }
  }
  if (!base) return null;
  for (const [pattern, label] of COLOR_MODIFIERS) {
    if (pattern.test(folded)) return `${label} ${base}`;
  }
  return base;
}
var PHRASE_STOP = /* @__PURE__ */ new Set([
  "filament",
  "filamenti",
  "filamentler",
  "makara",
  "spool",
  "roll",
  "rulo",
  "pla",
  "pla+",
  "petg+",
  "abs+",
  "hyper",
  "multicolor",
  "multi",
  "dual",
  "matte",
  "series",
  "petg",
  "abs",
  "asa",
  "tpu",
  "nylon",
  "naylon",
  "pc",
  "pva",
  "hips",
  "pa",
  "pet",
  "cf",
  "silk",
  "high",
  "speed",
  "premium",
  "pro",
  "plus",
  "basic",
  "seri",
  "serisi",
  "yazici",
  "yazicilar",
  "printer",
  "baski",
  "satin",
  "al",
  "urun",
  "adet",
  "renk",
  "renkli",
  "color",
  "colour",
  "ve",
  "ile",
  "icin",
  "kg",
  "gr",
  "gram",
  "mm",
  "cm",
  "lt",
  "the",
  "for",
  "with"
]);
function isWordChar(ch) {
  if (!ch) return false;
  return /[a-z0-9+]/.test(ch);
}
function isQualifier(word) {
  if (word.length < 2 || word.length > 20) return false;
  if (PHRASE_STOP.has(word)) return false;
  if (/[0-9]/.test(word)) return false;
  return /^[a-z+]+$/.test(word);
}
function tokenize(folded) {
  const tokens = [];
  let start = -1;
  for (let i = 0; i <= folded.length; i += 1) {
    const isWord = i < folded.length && isWordChar(folded[i]);
    if (isWord && start === -1) start = i;
    else if (!isWord && start !== -1) {
      tokens.push({ word: folded.slice(start, i), start, end: i });
      start = -1;
    }
  }
  return tokens;
}
function matchesColorWord(word) {
  for (const { words } of COLOR_WORDS) {
    for (const base of words) {
      if (!word.startsWith(base)) continue;
      if (COLOR_SUFFIXES.includes(word.slice(base.length))) return true;
    }
  }
  return false;
}
function extractColorPhrase(text) {
  if (!text) return null;
  const folded = fold(text);
  if (folded.length !== text.length) return null;
  const tokens = tokenize(folded);
  const index = tokens.findIndex((token) => matchesColorWord(token.word));
  if (index === -1) return null;
  let start = tokens[index].start;
  let end = tokens[index].end;
  const onlySpace = (from, to) => /^[ \t]+$/.test(folded.slice(from, to));
  for (let next = index + 1; next < tokens.length; next += 1) {
    const token = tokens[next];
    const isColor = matchesColorWord(token.word);
    const isRengi = /^reng(i|inde)$/.test(token.word);
    if (!isColor && !isRengi) break;
    if (!onlySpace(end, token.start)) break;
    end = token.end;
    if (isRengi) break;
  }
  for (let taken = 0; taken < 2; taken += 1) {
    const before = tokens[tokens.findIndex((t) => t.start === start) - 1];
    if (!before) break;
    if (!isQualifier(before.word) || matchesColorWord(before.word)) break;
    if (!onlySpace(before.end, start)) break;
    start = before.start;
  }
  const phrase = text.slice(start, end).trim();
  return phrase.length > 0 ? phrase : null;
}
function detectAllColors(text) {
  const folded = fold(text);
  const found = [];
  for (const [pattern, label] of COLOR_PATTERNS) {
    if (pattern.test(folded) && !found.includes(label)) found.push(label);
  }
  return found;
}
function colorFromLabel(text) {
  if (!text) return null;
  const bases = /* @__PURE__ */ new Set();
  let result = null;
  for (const match of text.matchAll(/\b(?:renk|colou?r)\b/gi)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 24), index);
    if (/filament\s*$/i.test(before.trim())) continue;
    const start = index + match[0].length;
    const window = text.slice(start, start + 60);
    const inWindow = detectAllColors(window);
    for (const color of inWindow) bases.add(color);
    if (bases.size > 1) return null;
    if (inWindow.length === 1 && result === null) {
      result = extractColorPhrase(window) ?? detectColor(window);
    }
  }
  return bases.size === 1 ? result : null;
}
function colorFromSpecLabel(text) {
  if (!text) return null;
  for (const match of text.matchAll(/(?<![\w])Renk\s*:\s*([^\n,|]+)/gi)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 24), index);
    if (/filament\s*$/i.test(before.trim())) continue;
    const value = match[1].trim().split(/\s+Filament\s+Renk/i)[0]?.trim();
    if (value && value.length >= 2 && value.length <= 48 && !/[\d]{3,}/.test(value)) return value;
  }
  return null;
}
var URL_SLUG_STOP = /* @__PURE__ */ new Set([
  "rfid",
  "hyper",
  "pla",
  "plap",
  "petg",
  "abs",
  "asa",
  "tpu",
  "nylon",
  "pc",
  "creality",
  "porima",
  "esun",
  "bambu",
  "filament",
  "filamenti",
  "basic",
  "plus",
  "pro",
  "175mm",
  "1000gr",
  "1kg",
  "175",
  "1000",
  "mm",
  "gr",
  "kg",
  "175mm",
  "1000gr"
]);
function colorFromUrl(url) {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.toLowerCase();
    const match = path.match(/-([a-z0-9]+(?:-[a-z0-9]+){0,3})-filament-\d/i) ?? path.match(/-([a-z0-9]+(?:-[a-z0-9]+){0,3})-filament$/i);
    if (!match) return null;
    const words = match[1].split("-").filter((word) => word && !URL_SLUG_STOP.has(word) && !/^\d+$/.test(word));
    if (words.length === 0 || words.length > 3) return null;
    return words.slice(-2).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  } catch {
    return null;
  }
}
function isGenericPageName(name) {
  if (!name) return true;
  const trimmed = name.trim();
  if (trimmed.length < 4) return true;
  return GENERIC_PAGE_NAMES.has(fold(trimmed));
}
function jsonLdTypes(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((item) => String(item));
}
function shouldPreferJsonLdName(name, type) {
  if (isGenericPageName(name)) return false;
  const types = jsonLdTypes(type);
  if (types.some((t) => /Brand|Breadcrumb|ListItem|WebSite|Organization|Store/i.test(t))) {
    return false;
  }
  if (types.some((t) => /Product/i.test(t))) return true;
  return types.length === 0;
}
function pickProductTitle(htmlTitle, jsonLdName, pageUrl) {
  const fromUrl = (() => {
    if (!pageUrl) return null;
    try {
      const slug = decodeURIComponent(new URL(pageUrl).pathname.split("/").pop() ?? "");
      if (!slug || slug.length < 8) return null;
      return slug.split("-").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ").replace(/\b(\d+)mm\b/gi, "$1mm").replace(/\b(\d+)gr\b/gi, "$1gr");
    } catch {
      return null;
    }
  })();
  const candidates = [
    shouldPreferJsonLdName(jsonLdName ?? "", "Product") ? jsonLdName : null,
    htmlTitle,
    jsonLdName && !isGenericPageName(jsonLdName) ? jsonLdName : null,
    fromUrl
  ].filter((value) => Boolean(value?.trim()));
  for (const candidate of candidates) {
    if (!isGenericPageName(candidate) && /filament|filamentti|spool|rulo/i.test(candidate)) {
      return candidate.trim();
    }
  }
  for (const candidate of candidates) {
    if (!isGenericPageName(candidate) && candidate.length >= 12) return candidate.trim();
  }
  return candidates[0]?.trim() ?? null;
}
function detectBrand(text) {
  if (!text) return null;
  for (const brand of KNOWN_BRANDS) {
    const pattern = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) return brand;
  }
  return null;
}
function detectCurrency(text) {
  for (const [pattern, code] of CURRENCY_MAP) {
    if (pattern.test(text)) return code;
  }
  return null;
}
function isPlausiblePrice(value) {
  return value !== null && value > 0 && value < 1e6;
}
function walkJsonLd(node, hit, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, hit, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node;
  if (hit.price === void 0) {
    const priceRaw = obj.price ?? obj.lowPrice ?? obj.highPrice;
    if (typeof priceRaw === "string" || typeof priceRaw === "number") {
      const parsed = parseLocaleNumber(priceRaw);
      if (isPlausiblePrice(parsed)) hit.price = parsed;
    }
  }
  if (hit.currency === void 0 && typeof obj.priceCurrency === "string") {
    hit.currency = obj.priceCurrency;
  }
  if (typeof obj.name === "string") {
    const types = jsonLdTypes(obj["@type"]);
    const isProduct = types.some((t) => /Product/i.test(t));
    if (isProduct && shouldPreferJsonLdName(obj.name, obj["@type"])) {
      hit.name = obj.name;
    } else if (hit.name === void 0 && shouldPreferJsonLdName(obj.name, obj["@type"])) {
      hit.name = obj.name;
    }
  }
  if (hit.brand === void 0) {
    if (typeof obj.brand === "string") hit.brand = obj.brand;
    else if (obj.brand && typeof obj.brand === "object") {
      const brandName = obj.brand.name;
      if (typeof brandName === "string") hit.brand = brandName;
    }
  }
  if (hit.color === void 0 && typeof obj.color === "string" && obj.color.trim()) {
    hit.color = obj.color.trim();
  }
  if (hit.weight === void 0 && obj.weight) {
    if (typeof obj.weight === "string") hit.weight = obj.weight;
    else if (typeof obj.weight === "object") {
      const w = obj.weight;
      const value = w.value ?? w.minValue;
      if (value !== void 0) {
        hit.weight = `${String(value)} ${String(w.unitText ?? w.unitCode ?? "")}`;
      }
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") walkJsonLd(value, hit, depth + 1);
  }
}
function fromJsonLd(html) {
  const blocks = [
    ...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  ];
  const hit = {};
  for (const block of blocks) {
    const raw = decodeEntities(block[1]).trim();
    try {
      walkJsonLd(JSON.parse(raw), hit);
    } catch {
    }
  }
  return hit.price !== void 0 || hit.name !== void 0 ? hit : null;
}
function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match ? decodeEntities(match[1]) : null;
}
function fromMetaTags(html) {
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const priceKeys = [
    "product:price:amount",
    "og:price:amount",
    "product:sale_price:amount",
    "twitter:data1"
  ];
  let price = null;
  let currency = null;
  for (const tag of metas) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "").toLowerCase();
    const content = attr(tag, "content");
    if (!content) continue;
    if (price === null && priceKeys.includes(key)) {
      const parsed = parseLocaleNumber(content);
      if (isPlausiblePrice(parsed)) {
        price = parsed;
        currency = currency ?? detectCurrency(content);
      }
    }
    if (currency === null && ["product:price:currency", "og:price:currency", "product:sale_price:currency"].includes(key)) {
      currency = content.trim().toUpperCase();
    }
  }
  return { price, currency };
}
function colorPhraseFromMeta(html) {
  for (const tag of [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0])) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? "").toLowerCase();
    if (key !== "product:color" && key !== "og:color" && key !== "color") continue;
    const content = attr(tag, "content");
    if (!content) continue;
    const trimmed = content.trim();
    if (trimmed && detectColor(trimmed)) return trimmed;
  }
  return null;
}
function fromMicrodata(html) {
  const tags = [...html.matchAll(/<[a-z]+\b[^>]*itemprop\s*=\s*["'][^"']*price[^"']*["'][^>]*>/gi)];
  for (const tag of tags) {
    const content = attr(tag[0], "content") ?? attr(tag[0], "data-price") ?? attr(tag[0], "value");
    const parsed = parseLocaleNumber(content);
    if (isPlausiblePrice(parsed)) return parsed;
  }
  return null;
}
var PRICE_CLASS_HINTS = /(prc-dsc|prc-slg|discounted-?price|campaign-?price|product-?price|price-?value|current-?price|sale-?price|urun-?fiyat|fiyat|price)/i;
function mostFrequent(values) {
  const counts = /* @__PURE__ */ new Map();
  for (const value of values) {
    const key = Math.round(value * 100) / 100;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || count === bestCount && value < best) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
function fromClassHeuristic(html) {
  const pattern = /<(span|div|p|b|strong|ins|bdi)\b([^>]*)>([\s\S]{0,240}?)<\/\1>/gi;
  const candidates = [];
  for (const match of html.matchAll(pattern)) {
    const attrs = match[2];
    if (!PRICE_CLASS_HINTS.test(attrs)) continue;
    const text = stripHtml(match[3]);
    if (!text || text.length > 40) continue;
    const parsed = parseLocaleNumber(text);
    if (isPlausiblePrice(parsed)) candidates.push(parsed);
  }
  if (candidates.length === 0) return null;
  return mostFrequent(candidates);
}
function fromTextScan(text) {
  const pattern = /(?:₺|\$|€|£)\s*(\d[\d.,]*)|(\d[\d.,]*)\s*(?:₺|TL\b|USD\b|EUR\b|\$|€)/gi;
  const candidates = [];
  for (const match of text.matchAll(pattern)) {
    const parsed = parseLocaleNumber(match[1] ?? match[2]);
    if (isPlausiblePrice(parsed) && parsed >= 1) candidates.push(parsed);
  }
  if (candidates.length === 0) return null;
  return mostFrequent(candidates);
}
function extractTitle(html) {
  const og = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((tag) => (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase() === "og:title");
  if (og) {
    const content = attr(og, "content");
    if (content) return content.trim();
  }
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = stripHtml(h1[1]);
    if (text) return text;
  }
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripHtml(title[1]) || null : null;
}
var PARSE_HTML_LIMIT = 35e4;
function parseFilamentPage(html, pageUrl) {
  const result = {
    ok: false,
    price: null,
    currency: null,
    weightGrams: null,
    title: null,
    brand: null,
    material: null,
    color: null,
    method: "none",
    confidence: 0,
    warnings: []
  };
  if (typeof html !== "string" || html.trim().length === 0) {
    result.warnings.push("Sayfa i\xE7eri\u011Fi bo\u015F geldi.");
    return result;
  }
  if (html.length > PARSE_HTML_LIMIT) {
    html = html.slice(0, PARSE_HTML_LIMIT);
  }
  try {
    const title = extractTitle(html);
    const bodyText = stripHtml(html).slice(0, 2e4);
    const jsonLd = fromJsonLd(html);
    result.title = pickProductTitle(title, jsonLd?.name, pageUrl);
    const jsonLdPrice = jsonLd?.price ?? null;
    if (isPlausiblePrice(jsonLdPrice)) {
      result.price = jsonLdPrice;
      result.currency = jsonLd?.currency ?? null;
      result.method = "json-ld";
      result.confidence = 0.95;
    }
    if (result.price === null) {
      const meta = fromMetaTags(html);
      if (isPlausiblePrice(meta.price)) {
        result.price = meta.price;
        result.currency = meta.currency;
        result.method = "meta-tag";
        result.confidence = 0.85;
      }
    }
    if (result.price === null) {
      const micro = fromMicrodata(html);
      if (isPlausiblePrice(micro)) {
        result.price = micro;
        result.method = "microdata";
        result.confidence = 0.75;
      }
    }
    if (result.price === null) {
      const heuristic = fromClassHeuristic(html);
      if (isPlausiblePrice(heuristic)) {
        result.price = heuristic;
        result.method = "class-heuristic";
        result.confidence = 0.6;
      }
    }
    if (result.price === null) {
      const scanned = fromTextScan(bodyText);
      if (isPlausiblePrice(scanned)) {
        result.price = scanned;
        result.method = "text-scan";
        result.confidence = 0.35;
        result.warnings.push(
          "Fiyat yaln\u0131zca metin taramas\u0131yla bulundu, l\xFCtfen do\u011Frulu\u011Funu kontrol edin."
        );
      }
    }
    if (!result.currency) {
      result.currency = detectCurrency(jsonLd?.currency ?? "") ?? detectCurrency(bodyText.slice(0, 4e3));
    }
    const weightSources = [result.title ?? "", jsonLd?.weight ?? "", bodyText.slice(0, 6e3)];
    for (const source of weightSources) {
      const weight = extractWeightGrams(source);
      if (weight !== null) {
        result.weightGrams = weight;
        break;
      }
    }
    if (result.weightGrams === null) {
      result.warnings.push("Rulo gramaj\u0131 bulunamad\u0131, varsay\u0131lan 1000 g kullanabilirsiniz.");
    }
    const identityText = `${result.title ?? ""} ${jsonLd?.brand ?? ""} ${pageUrl ?? ""}`;
    result.brand = jsonLd?.brand?.trim() || detectBrand(identityText) || detectBrand(bodyText.slice(0, 3e3));
    result.material = detectMaterial(identityText) ?? detectMaterial(bodyText.slice(0, 3e3));
    const titleText = result.title ?? "";
    result.color = (jsonLd?.color?.trim() || null) ?? colorPhraseFromMeta(html) ?? colorFromSpecLabel(bodyText.slice(0, 12e3)) ?? extractColorPhrase(titleText) ?? colorFromUrl(pageUrl) ?? colorFromLabel(bodyText.slice(0, 8e3)) ?? detectColor(identityText);
    result.ok = result.price !== null;
    if (!result.ok) {
      result.warnings.push("Sayfada fiyat bilgisi tespit edilemedi. L\xFCtfen manuel girin.");
    }
  } catch (error) {
    result.warnings.push(
      `Ayr\u0131\u015Ft\u0131rma hatas\u0131: ${error instanceof Error ? error.message : "bilinmeyen hata"}`
    );
  }
  return result;
}
export {
  colorFromLabel,
  colorFromSpecLabel,
  colorFromUrl,
  colorToHex,
  decodeEntities,
  detectBrand,
  detectColor,
  detectMaterial,
  extractColorPhrase,
  extractWeightGrams,
  parseFilamentPage,
  parseLocaleNumber,
  stripHtml
};
