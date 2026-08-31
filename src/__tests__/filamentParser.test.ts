import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  detectBrand,
  colorFromLabel,
  colorFromSpecLabel,
  colorFromUrl,
  extractColorPhrase,
  detectColor,
  detectMaterial,
  extractWeightGrams,
  parseFilamentPage,
  parseLocaleNumber,
  stripHtml,
} from '../lib/filamentParser';

describe('parseLocaleNumber', () => {
  it('Turkce bicimi cozer', () => {
    expect(parseLocaleNumber('1.234,56')).toBeCloseTo(1234.56);
    expect(parseLocaleNumber('749,90')).toBeCloseTo(749.9);
    expect(parseLocaleNumber('12.500')).toBe(12500);
  });

  it('Ingilizce bicimi cozer', () => {
    expect(parseLocaleNumber('1,234.56')).toBeCloseTo(1234.56);
    expect(parseLocaleNumber('1,234')).toBe(1234);
    expect(parseLocaleNumber('899.99')).toBeCloseTo(899.99);
  });

  it('para birimi simgelerini ve bosluklari temizler', () => {
    expect(parseLocaleNumber('₺ 1.299,00')).toBeCloseTo(1299);
    expect(parseLocaleNumber('749,90 TL')).toBeCloseTo(749.9);
    expect(parseLocaleNumber('$1,049.90')).toBeCloseTo(1049.9);
  });

  it('sayi ve null girdileri dogru isler', () => {
    expect(parseLocaleNumber(42)).toBe(42);
    expect(parseLocaleNumber(null)).toBeNull();
    expect(parseLocaleNumber(undefined)).toBeNull();
    expect(parseLocaleNumber('')).toBeNull();
    expect(parseLocaleNumber('fiyat yok')).toBeNull();
    expect(parseLocaleNumber(Number.NaN)).toBeNull();
  });

  it('coklu binlik ayraclarini cozer', () => {
    expect(parseLocaleNumber('1.234.567,89')).toBeCloseTo(1234567.89);
    expect(parseLocaleNumber('1,234,567.89')).toBeCloseTo(1234567.89);
  });
});

describe('stripHtml / decodeEntities', () => {
  it('script ve style bloklarini atar', () => {
    const html = '<div>Fiyat<script>var x=1;</script><style>.a{}</style> 100 TL</div>';
    expect(stripHtml(html)).toBe('Fiyat 100 TL');
  });

  it('HTML entity cozer', () => {
    expect(decodeEntities('Fiyat&nbsp;100&amp;200')).toBe('Fiyat 100&200');
    expect(decodeEntities('&#8378;500')).toBe('₺500');
    expect(decodeEntities('&#x20BA;500')).toBe('₺500');
  });

  it('bilinmeyen entity aynen birakir', () => {
    expect(decodeEntities('&foobar;')).toBe('&foobar;');
  });
});

describe('extractWeightGrams', () => {
  it('kg ve gram birimlerini cozer', () => {
    expect(extractWeightGrams('Porima PLA 1 kg Siyah')).toBe(1000);
    expect(extractWeightGrams('Filament 750 g makara')).toBe(750);
    expect(extractWeightGrams('Numune 250gr')).toBe(250);
    expect(extractWeightGrams('Buyuk makara 2.3 kg')).toBe(2300);
  });

  it('yaygin makara gramajini onceler', () => {
    expect(extractWeightGrams('Kargo agirligi 1350 g, makara 1000 g')).toBe(1000);
  });

  it('mantiksiz degerleri eler', () => {
    expect(extractWeightGrams('Katman 0.2 g')).toBeNull();
    expect(extractWeightGrams('Paket 900000 kg')).toBeNull();
    expect(extractWeightGrams('')).toBeNull();
    expect(extractWeightGrams('bilgi yok')).toBeNull();
  });
});

describe('detectColor', () => {
  it('Türkçe renk adlarını tanır', () => {
    expect(detectColor('Porima PLA Siyah 1kg')).toBe('Siyah');
    expect(detectColor('Filament Kırmızı')).toBe('Kırmızı');
    expect(detectColor('PETG Yeşil 750g')).toBe('Yeşil');
    expect(detectColor('PLA Gümüş')).toBe('Gümüş');
  });

  it('İngilizce renk adlarını tanır', () => {
    expect(detectColor('eSUN PLA+ Black 1kg')).toBe('Siyah');
    expect(detectColor('Bambu Lab PLA Basic Blue')).toBe('Mavi');
    expect(detectColor('Transparent PETG')).toBe('Şeffaf');
  });

  it('ön ekleri renge ekler', () => {
    expect(detectColor('Mat Siyah PLA')).toBe('Mat Siyah');
    expect(detectColor('Matte Black PLA')).toBe('Mat Siyah');
    expect(detectColor('Neon Yeşil TPU')).toBe('Neon Yeşil');
    expect(detectColor('Metallic Gold PLA')).toBe('Metalik Altın');
  });

  it('URL parçasından da okur', () => {
    expect(detectColor('https://ornek.com/porima-pla-filament-lacivert-1kg')).toBe('Lacivert');
  });

  it('renk yoksa null döner', () => {
    expect(detectColor('PLA Filament 1kg')).toBeNull();
    expect(detectColor('')).toBeNull();
  });

  it('bileşik renkleri tek renkten önce eşler', () => {
    expect(detectColor('Kahverengi PLA')).toBe('Kahverengi');
    expect(detectColor('Turkuaz PETG')).toBe('Turkuaz');
  });
});

describe('extractColorPhrase', () => {
  it('özel renk adını olduğu gibi korur', () => {
    expect(extractColorPhrase('Flashforge - High Speed PLA Karmin Kırmızı Filament 1Kg')).toBe(
      'Karmin Kırmızı',
    );
    expect(extractColorPhrase('Porima PLA Mat Siyah 1kg')).toBe('Mat Siyah');
    expect(extractColorPhrase('eSUN PETG Buz Mavisi 1kg')).toBe('Buz Mavisi');
  });

  it('Türkçe ekleri kelimeye dahil eder', () => {
    expect(extractColorPhrase('Ateş Kırmızısı Filament')).toBe('Ateş Kırmızısı');
  });

  it('marka, malzeme ve ürün sözcüklerinde durur', () => {
    expect(extractColorPhrase('Porima PLA Siyah 1kg')).toBe('Siyah');
    expect(extractColorPhrase('Bambu Lab PLA Basic Beyaz')).toBe('Beyaz');
    expect(extractColorPhrase('Filament Turuncu')).toBe('Turuncu');
  });

  it('sayı içeren kelimeyi niteleyici saymaz', () => {
    expect(extractColorPhrase('PLA 1.75mm Mavi')).toBe('Mavi');
  });

  it('en fazla iki niteleyici alır', () => {
    // "Gün Batımı Mavisi" gibi iki kelimeli adlar için iki niteleyici gerekir.
    expect(extractColorPhrase('Cok Parlak Koyu Kırmızı')).toBe('Parlak Koyu Kırmızı');
  });

  it('gerçek mağaza başlıklarını doğru okur', () => {
    const cases: Array<[string, string]> = [
      ['Creality Soleyin Basic PETG Filament Altın Sarısı - 1 Kg', 'Altın Sarısı'],
      ['Creality Soleyin Basic PETG Filament Gün Batımı Mavisi - 1 Kg', 'Gün Batımı Mavisi'],
      ['Creality Soleyin Basic PETG Filament Kiremit Kırmızısı - 1 Kg', 'Kiremit Kırmızısı'],
      ['Creality Soleyin Basic PETG Filament Orman Yeşili - 1 Kg', 'Orman Yeşili'],
      ['Creality Soleyin Basic PETG Filament Lavanta - 1 Kg', 'Lavanta'],
      ['Creality Soleyin Basic PETG Filament Papatya - 1 Kg', 'Papatya'],
      ['Marka Filament Hyper PLA Ten 1.75mm 1 Kg', 'Ten'],
      ['Flashforge - PLA Multicolor Marsala Filament 1KG', 'Marsala'],
      ['Flashforge - High Speed PLA Multicolor Burnt Titanium Filament 1KG', 'Burnt Titanium'],
      ['Flashforge - High Speed PLA Demir Gri Filament 1Kg', 'Demir Gri'],
      ['Flashforge - High Speed PLA Açık Yeşil Filament 1Kg', 'Açık Yeşil'],
      ['eSUN PLA+ Beyaz Filament 1kg', 'Beyaz'],
      ['eSUN PLA+ Turkuaz Yeşil Filament 1kg', 'Turkuaz Yeşil'],
    ];
    for (const [title, expected] of cases) {
      expect(extractColorPhrase(title), title).toBe(expected);
    }
  });

  it('Türkçe filament renk adlarını tanır', () => {
    expect(extractColorPhrase('Creality Soleyin Basic PETG Filament Sütlü Kahve - 1 Kg')).toBe(
      'Sütlü Kahve',
    );
    expect(extractColorPhrase('Porima PLA Bordo 1kg')).toBe('Bordo');
    expect(extractColorPhrase('PETG Antrasit Gri')).toBe('Antrasit Gri');
    expect(extractColorPhrase('PLA Fildişi 1kg')).toBe('Fildişi');
  });

  it('"Kahve Rengi" gibi yazımlarda son kelimeyi de alır', () => {
    expect(extractColorPhrase('Porima PLA Kahve Rengi 1kg')).toBe('Kahve Rengi');
    expect(extractColorPhrase('Filament Bordo Renginde')).toBe('Bordo Renginde');
  });

  it('"kahverengi" ile "kahve" karışmaz', () => {
    expect(extractColorPhrase('Porima PLA Kahverengi 1kg')).toBe('Kahverengi');
    expect(detectColor('Porima PLA Kahverengi')).toBe('Kahverengi');
    expect(detectColor('Sütlü Kahve PETG')).toBe('Kahve');
  });

  it('renk yoksa null döner', () => {
    expect(extractColorPhrase('Porima PLA Filament 1kg')).toBeNull();
    expect(extractColorPhrase('')).toBeNull();
  });
});

describe('colorFromLabel', () => {
  it('etiketli renkleri okur', () => {
    expect(colorFromLabel('Marka: Porima Renk: Siyah Agirlik: 1 kg')).toBe('Siyah');
    expect(colorFromLabel('Renk Kırmızı')).toBe('Kırmızı');
    // Sayfada nasıl yazıyorsa öyle alınır; sözlüğe indirgenmez.
    expect(colorFromLabel('Color: Black')).toBe('Black');
    expect(colorFromLabel('Renk: Karmin Kırmızı')).toBe('Karmin Kırmızı');
  });

  it('varyant listesinde birden fazla renk varsa tahmin yurutmez', () => {
    // Acilir listede tum secenekler goruntulenir; hangisinin secili oldugu
    // bilinemez, yanlis renk doldurmaktansa bos birakmak dogrudur.
    expect(colorFromLabel('Renk: Siyah Renk: Beyaz Renk: Kirmizi')).toBeNull();
  });

  it('renk icermeyen etikette null doner', () => {
    expect(colorFromLabel('Renk: Seciniz')).toBeNull();
    expect(colorFromLabel('Agirlik: 1 kg')).toBeNull();
    expect(colorFromLabel('')).toBeNull();
  });
});

describe('detectMaterial / detectBrand', () => {
  it('malzeme turunu tanir', () => {
    expect(detectMaterial('Porima PETG Filament')).toBe('PETG');
    expect(detectMaterial('eSUN PLA+ 1kg')).toBe('PLA+');
    expect(detectMaterial('Esnek TPU filament')).toBe('TPU');
    expect(detectMaterial('ASA filament')).toBe('ASA');
    expect(detectMaterial('Duz PLA')).toBe('PLA');
    expect(detectMaterial('bilinmeyen urun')).toBeNull();
  });

  it('marka tanir', () => {
    expect(detectBrand('PORIMA PLA 1KG')).toBe('Porima');
    expect(detectBrand('Bambu Lab PLA Basic')).toBe('Bambu Lab');
    expect(detectBrand('rastgele urun')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

const jsonLdPage = `<!doctype html><html><head>
<title>Porima PLA Filament 1KG</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Porima PLA Filament 1KG Siyah",
"brand":{"@type":"Brand","name":"Porima"},
"offers":{"@type":"Offer","price":"749.90","priceCurrency":"TRY","availability":"InStock"}}
</script></head><body><h1>Porima PLA Filament 1KG</h1></body></html>`;

const metaPage = `<!doctype html><html><head>
<meta property="og:title" content="eSUN PETG 1kg Beyaz" />
<meta property="product:price:amount" content="899,50" />
<meta property="product:price:currency" content="TRY" />
</head><body><p>eSUN PETG filament 1 kg</p></body></html>`;

const microdataPage = `<html><body>
<h1>Filamentum ABS 750 g</h1>
<div itemprop="offers"><span itemprop="price" content="1250.00">1.250,00 TL</span></div>
</body></html>`;

const classPage = `<html><body><h1>Microzey PLA 1000 g Kirmizi</h1>
<div class="product-price"><span class="prc-dsc">1.099,00 TL</span></div>
<div class="prc-dsc">1.099,00 TL</div>
<div class="old-price">1.499,00 TL</div>
</body></html>`;

const textPage = `<html><body><h1>Jenerik PLA 1 kg</h1>
<div><p>Sepette 649,90 TL</p><p>649,90 TL</p></div></body></html>`;

describe('parseFilamentPage', () => {
  it('JSON-LD yapisal verisini en yuksek oncelikle okur', () => {
    const result = parseFilamentPage(jsonLdPage, 'https://ornek.com/porima-pla');
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(749.9);
    expect(result.currency).toBe('TRY');
    expect(result.method).toBe('json-ld');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.weightGrams).toBe(1000);
    expect(result.brand).toBe('Porima');
    expect(result.material).toBe('PLA');
    expect(result.color).toBe('Siyah');
  });

  it('meta etiketlerinden Turkce ondalikli fiyat okur', () => {
    const result = parseFilamentPage(metaPage);
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(899.5);
    expect(result.currency).toBe('TRY');
    expect(result.method).toBe('meta-tag');
    expect(result.weightGrams).toBe(1000);
    expect(result.material).toBe('PETG');
  });

  it('microdata content ozniteliginden okur', () => {
    const result = parseFilamentPage(microdataPage);
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(1250);
    expect(result.method).toBe('microdata');
    expect(result.weightGrams).toBe(750);
    expect(result.material).toBe('ABS');
  });

  it('sinif adi sezgisiyle indirimli fiyati bulur', () => {
    const result = parseFilamentPage(classPage);
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(1099);
    expect(result.method).toBe('class-heuristic');
    expect(result.weightGrams).toBe(1000);
  });

  it('son care olarak metin taramasi yapar ve uyari ekler', () => {
    const result = parseFilamentPage(textPage);
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(649.9);
    expect(result.method).toBe('text-scan');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.warnings.join(' ')).toContain('metin taramasıyla');
  });

  it('JSON-LD color alanini basliktan once kullanir', () => {
    const page = `<html><head><script type="application/ld+json">
      {"@type":"Product","name":"Porima PLA Filament 1kg","color":"Turuncu",
      "offers":{"price":"749.90","priceCurrency":"TRY"}}</script></head><body></body></html>`;
    const result = parseFilamentPage(page);
    expect(result.color).toBe('Turuncu');
  });

  it('meta product:color etiketini okur', () => {
    const page = `<html><head>
      <meta property="og:title" content="Porima PLA Filament 1kg" />
      <meta property="product:color" content="Karmin Kırmızı" />
      <meta property="og:price:amount" content="749.90" /></head><body></body></html>`;
    expect(parseFilamentPage(page).color).toBe('Karmin Kırmızı');
  });

  it('baslikta renk yoksa govdedeki etiketten okur', () => {
    const page = `<html><head><meta property="og:price:amount" content="700">
      <title>Porima PLA Filament 1kg</title></head>
      <body><h1>Porima PLA Filament 1kg</h1>
      <table><tr><th>Renk</th><td>Fıstık Yeşili</td></tr></table></body></html>`;
    expect(parseFilamentPage(page).color).toBe('Fıstık Yeşili');
  });

  it('varyant sayfasinda renk bos birakilir', () => {
    const page = `<html><head><meta property="og:price:amount" content="700">
      <title>Porima PLA Filament</title></head><body>
      <label>Renk: Siyah</label><label>Renk: Beyaz</label><label>Renk: Mavi</label>
      </body></html>`;
    expect(parseFilamentPage(page).color).toBeNull();
  });

  it('robolink: ozel renk adini spec satirindan okur, kategori alanini yok sayar', () => {
    const page = `<html><head>
      <script type="application/ld+json">{"@type":"ListItem","name":"Anasayfa"}
      {"@type":"Product","name":"Anasayfa","offers":{"price":"897","priceCurrency":"TRY"}}</script>
      <meta property="og:price:amount" content="897.00" /></head>
      <body><h1>Creality Hyper PLA RFID Peach Fuzz Filament 1.75mm 1000gr</h1>
      <p>Renk: Peach Fuzz</p>
      <p>Filament Renk Bej, Ten Rengi</p>
      <p>Kingroon Petg Basic Turuncu Filament 1.75mm 1000gr</p>
      </body></html>`;
    const url =
      'https://www.robolinkmarket.com/creality-hyper-pla-rfid-peach-fuzz-filament-175mm-1000gr';
    const result = parseFilamentPage(page, url);
    expect(result.title).toContain('Peach Fuzz');
    expect(result.color).toBe('Peach Fuzz');
    expect(result.price).toBeCloseTo(897);
  });

  it('colorFromSpecLabel ozel renk adini oldugu gibi dondurur', () => {
    expect(colorFromSpecLabel('Seri: Hyper PLA\nRenk: Peach Fuzz\nCap: 1.75mm')).toBe('Peach Fuzz');
    expect(colorFromSpecLabel('Filament Renk Bej, Ten Rengi')).toBeNull();
  });

  it('colorFromUrl slug icinden renk cikarir', () => {
    expect(
      colorFromUrl(
        'https://www.robolinkmarket.com/creality-hyper-pla-rfid-peach-fuzz-filament-175mm-1000gr',
      ),
    ).toBe('Peach Fuzz');
  });

  // --- Hata toleransi ---

  it('bos icerikte cokmez', () => {
    const result = parseFilamentPage('');
    expect(result.ok).toBe(false);
    expect(result.price).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('gecersiz tipte girdide cokmez', () => {
    const result = parseFilamentPage(null as unknown as string);
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('boş');
  });

  it('bozuk JSON-LD blogunu atlayip diger stratejilere duser', () => {
    const broken = `<html><head><script type="application/ld+json">{bozuk json,,}</script>
      <meta property="og:price:amount" content="450.00"></head>
      <body><h1>PLA 1 kg</h1></body></html>`;
    const result = parseFilamentPage(broken);
    expect(result.ok).toBe(true);
    expect(result.price).toBeCloseTo(450);
    expect(result.method).toBe('meta-tag');
  });

  it('fiyat yoksa ok=false doner ve manuel girise yonlendirir', () => {
    const result = parseFilamentPage('<html><body><h1>Sadece baslik</h1></body></html>');
    expect(result.ok).toBe(false);
    expect(result.price).toBeNull();
    expect(result.warnings.join(' ')).toContain('manuel');
  });

  it('gramaj bulunamazsa uyari verir ama fiyati korur', () => {
    const page = `<html><head><meta property="og:price:amount" content="300"></head>
      <body><h1>Filament</h1></body></html>`;
    const result = parseFilamentPage(page);
    expect(result.price).toBeCloseTo(300);
    expect(result.weightGrams).toBeNull();
    expect(result.warnings.join(' ')).toContain('gramajı bulunamadı');
  });

  it('sacma yuksek fiyatlari eler', () => {
    const page = `<html><head><meta property="og:price:amount" content="99999999"></head>
      <body><h1>PLA 1 kg</h1></body></html>`;
    const result = parseFilamentPage(page);
    expect(result.method).not.toBe('meta-tag');
  });

  it('yabanci para birimini tespit eder', () => {
    const page = `<html><head>
      <script type="application/ld+json">{"@type":"Product","name":"eSUN PLA 1kg",
      "offers":{"price":"19.99","priceCurrency":"USD"}}</script></head><body></body></html>`;
    const result = parseFilamentPage(page);
    expect(result.currency).toBe('USD');
    expect(result.price).toBeCloseTo(19.99);
  });

  it('cok buyuk sayfalarda makul surede tamamlanir', () => {
    const filler = '<div class="x">lorem ipsum dolor</div>'.repeat(20000);
    const page = `<html><head><meta property="og:price:amount" content="500"></head><body><h1>PLA 1 kg</h1>${filler}</body></html>`;
    const started = performance.now();
    const result = parseFilamentPage(page);
    expect(result.price).toBeCloseTo(500);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
