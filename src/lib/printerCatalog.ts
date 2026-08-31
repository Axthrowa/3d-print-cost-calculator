/**
 * Yazici katalogu: marka/model yazildiginda teknik bilgileri (ozellikle guc
 * tuketimini) otomatik dolduran yerlesik veri tabani ve bulanik arama motoru.
 *
 * Guc degerleri uretici beyanlari ve saha olcumlerine dayali *tipik* degerlerdir:
 *  - avgPowerW : PLA baskisinda gozlenen ortalama cekis (maliyet icin dogru olan)
 *  - maxPowerW : isinma anindaki pik / etiket degeri
 *  - idlePowerW: bekleme tuketimi
 *
 * Bagimliliksiz ve saf; hem tarayicida hem Node sunucusunda calisir.
 */

export interface CatalogPrinter {
  brand: string;
  model: string;
  aliases?: string[];
  avgPowerW: number;
  maxPowerW: number;
  idlePowerW: number;
  technology: 'FDM' | 'RESIN';
  buildVolume: string;
  heatedBed: boolean;
  enclosure: boolean;
  /** Onerilen amortisman omru (saat). */
  lifetimeHours: number;
}

export const PRINTER_CATALOG: CatalogPrinter[] = [
  // --- Bambu Lab ---------------------------------------------------------
  {
    brand: 'Bambu Lab',
    model: 'X1 Carbon',
    aliases: ['x1c', 'x1-carbon'],
    avgPowerW: 105,
    maxPowerW: 1000,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 6000,
  },
  {
    brand: 'Bambu Lab',
    model: 'X1E',
    avgPowerW: 185,
    maxPowerW: 1400,
    idlePowerW: 18,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 6000,
  },
  {
    brand: 'Bambu Lab',
    model: 'P1S',
    avgPowerW: 115,
    maxPowerW: 1000,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Bambu Lab',
    model: 'P1P',
    avgPowerW: 105,
    maxPowerW: 1000,
    idlePowerW: 5.5,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 5000,
  },
  {
    brand: 'Bambu Lab',
    model: 'A1',
    avgPowerW: 95,
    maxPowerW: 1300,
    idlePowerW: 5,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Bambu Lab',
    model: 'A1 mini',
    aliases: ['a1mini'],
    avgPowerW: 80,
    maxPowerW: 150,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '180x180x180 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Bambu Lab',
    model: 'H2D',
    avgPowerW: 190,
    maxPowerW: 1210,
    idlePowerW: 26,
    technology: 'FDM',
    buildVolume: '350x320x320 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 6000,
  },

  // --- Creality ----------------------------------------------------------
  {
    brand: 'Creality',
    model: 'Ender 3',
    aliases: ['ender3'],
    avgPowerW: 110,
    maxPowerW: 270,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 V2',
    avgPowerW: 110,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 S1',
    avgPowerW: 120,
    maxPowerW: 350,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x270 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 S1 Pro',
    avgPowerW: 135,
    maxPowerW: 350,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '220x220x270 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 V3 SE',
    avgPowerW: 110,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 V3 KE',
    avgPowerW: 125,
    maxPowerW: 350,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x240 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 V3',
    avgPowerW: 140,
    maxPowerW: 400,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 5 Plus',
    avgPowerW: 200,
    maxPowerW: 500,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '350x350x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Creality',
    model: 'CR-10 Smart Pro',
    aliases: ['cr10'],
    avgPowerW: 190,
    maxPowerW: 350,
    idlePowerW: 18,
    technology: 'FDM',
    buildVolume: '300x300x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Creality',
    model: 'K1',
    avgPowerW: 140,
    maxPowerW: 400,
    idlePowerW: 20,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Creality',
    model: 'K1C',
    avgPowerW: 150,
    maxPowerW: 400,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Creality',
    model: 'K1 Max',
    avgPowerW: 185,
    maxPowerW: 1000,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '300x300x300 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Creality',
    model: 'K2 Plus',
    avgPowerW: 220,
    maxPowerW: 1200,
    idlePowerW: 14,
    technology: 'FDM',
    buildVolume: '350x350x350 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5500,
  },

  // --- Prusa -------------------------------------------------------------
  {
    brand: 'Prusa',
    model: 'MK3S+',
    aliases: ['mk3', 'mk3s'],
    avgPowerW: 80,
    maxPowerW: 240,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '250x210x210 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 8000,
  },
  {
    brand: 'Prusa',
    model: 'MK4S',
    // 'mk4' takma adi kaldirildi: MK4 ayri bir model olarak katalogda.
    aliases: ['mk4s'],
    avgPowerW: 90,
    maxPowerW: 240,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '250x210x220 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 8000,
  },
  {
    brand: 'Prusa',
    model: 'MINI+',
    aliases: ['mini'],
    avgPowerW: 55,
    maxPowerW: 160,
    idlePowerW: 5,
    technology: 'FDM',
    buildVolume: '180x180x180 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 6000,
  },
  {
    brand: 'Prusa',
    model: 'CORE One',
    avgPowerW: 90,
    maxPowerW: 240,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '250x220x270 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 8000,
  },
  {
    brand: 'Prusa',
    model: 'XL',
    avgPowerW: 210,
    maxPowerW: 600,
    idlePowerW: 80,
    technology: 'FDM',
    buildVolume: '360x360x360 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 9000,
  },

  // --- Anycubic ----------------------------------------------------------
  {
    brand: 'Anycubic',
    model: 'Kobra 2',
    avgPowerW: 150,
    maxPowerW: 400,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Anycubic',
    model: 'Kobra 2 Pro',
    avgPowerW: 130,
    maxPowerW: 400,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Anycubic',
    model: 'Kobra 2 Max',
    avgPowerW: 200,
    maxPowerW: 500,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '420x420x500 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Anycubic',
    model: 'Kobra 3',
    avgPowerW: 135,
    maxPowerW: 400,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '250x250x260 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Anycubic',
    model: 'Kobra S1',
    avgPowerW: 145,
    maxPowerW: 450,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '250x250x250 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 4000,
  },
  {
    brand: 'Anycubic',
    model: 'i3 Mega S',
    avgPowerW: 120,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '210x210x205 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Anycubic',
    model: 'Photon Mono M5s',
    avgPowerW: 90,
    maxPowerW: 120,
    idlePowerW: 5,
    technology: 'RESIN',
    buildVolume: '218x123x200 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 2500,
  },

  // --- Elegoo ------------------------------------------------------------
  {
    brand: 'Elegoo',
    model: 'Neptune 3 Pro',
    avgPowerW: 65,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '225x225x280 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Elegoo',
    model: 'Neptune 4',
    avgPowerW: 130,
    maxPowerW: 400,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '225x225x265 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Elegoo',
    model: 'Neptune 4 Pro',
    avgPowerW: 100,
    maxPowerW: 450,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '225x225x265 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Elegoo',
    model: 'Neptune 4 Plus',
    avgPowerW: 180,
    maxPowerW: 400,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '320x320x385 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Elegoo',
    model: 'Neptune 4 Max',
    avgPowerW: 220,
    maxPowerW: 400,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '420x420x480 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Elegoo',
    model: 'Centauri Carbon',
    avgPowerW: 125,
    maxPowerW: 400,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 4500,
  },
  {
    brand: 'Elegoo',
    model: 'Mars 4 Ultra',
    avgPowerW: 55,
    maxPowerW: 90,
    idlePowerW: 4,
    technology: 'RESIN',
    buildVolume: '153x77x165 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 2500,
  },
  {
    brand: 'Elegoo',
    model: 'Saturn 4 Ultra',
    avgPowerW: 95,
    maxPowerW: 150,
    idlePowerW: 5,
    technology: 'RESIN',
    buildVolume: '218x123x220 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 2500,
  },

  // --- Sovol / Artillery / Flashforge / Qidi -----------------------------
  {
    brand: 'Sovol',
    model: 'SV06',
    avgPowerW: 105,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Sovol',
    model: 'SV06 Plus',
    avgPowerW: 140,
    maxPowerW: 450,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '300x300x340 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Sovol',
    model: 'SV07',
    avgPowerW: 130,
    maxPowerW: 400,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Sovol',
    model: 'SV08',
    avgPowerW: 200,
    maxPowerW: 700,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '350x350x345 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Artillery',
    model: 'Sidewinder X2',
    avgPowerW: 80,
    maxPowerW: 560,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '300x300x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3000,
  },
  {
    brand: 'Artillery',
    model: 'Sidewinder X4 Pro',
    avgPowerW: 160,
    maxPowerW: 300,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '240x240x260 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Flashforge',
    model: 'Adventurer 5M',
    aliases: ['ad5m'],
    avgPowerW: 115,
    maxPowerW: 400,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '220x220x220 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 4000,
  },
  {
    brand: 'Flashforge',
    model: 'Adventurer 5M Pro',
    aliases: ['ad5m pro'],
    avgPowerW: 125,
    maxPowerW: 400,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '220x220x220 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 4000,
  },
  {
    brand: 'Qidi',
    model: 'X-Plus 3',
    avgPowerW: 210,
    maxPowerW: 800,
    idlePowerW: 18.5,
    technology: 'FDM',
    buildVolume: '280x280x270 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Qidi',
    model: 'X-Max 3',
    avgPowerW: 250,
    maxPowerW: 800,
    idlePowerW: 20,
    technology: 'FDM',
    buildVolume: '325x325x315 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Qidi',
    model: 'Q1 Pro',
    avgPowerW: 165,
    maxPowerW: 600,
    idlePowerW: 11,
    technology: 'FDM',
    buildVolume: '245x245x240 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Qidi',
    model: 'Plus4',
    avgPowerW: 230,
    maxPowerW: 900,
    idlePowerW: 14,
    technology: 'FDM',
    buildVolume: '305x305x280 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },

  // --- Kurumsal / DIY ----------------------------------------------------
  {
    brand: 'Voron',
    model: '2.4 (350mm)',
    aliases: ['voron24', 'voron 2.4'],
    avgPowerW: 250,
    maxPowerW: 900,
    idlePowerW: 15,
    technology: 'FDM',
    buildVolume: '350x350x350 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 8000,
  },
  {
    brand: 'Voron',
    model: 'Trident (300mm)',
    avgPowerW: 220,
    maxPowerW: 800,
    idlePowerW: 14,
    technology: 'FDM',
    buildVolume: '300x300x250 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 8000,
  },
  {
    brand: 'Ultimaker',
    model: 'S3',
    avgPowerW: 160,
    maxPowerW: 350,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '230x190x200 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 10000,
  },
  {
    brand: 'Ultimaker',
    model: 'S5',
    avgPowerW: 230,
    maxPowerW: 500,
    idlePowerW: 15,
    technology: 'FDM',
    buildVolume: '330x240x300 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 10000,
  },
  {
    brand: 'Raise3D',
    model: 'Pro3',
    avgPowerW: 260,
    maxPowerW: 600,
    idlePowerW: 18,
    technology: 'FDM',
    buildVolume: '300x300x300 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 12000,
  },
  {
    brand: 'Snapmaker',
    model: 'U1',
    aliases: ['u1', 'snapmaker u1', 'snapmakeru1'],
    // avgPowerW ve idlePowerW TAHMINDIR: uretici ortalama tuketim
    // yayinlamiyor ve bagimsiz bir olcum bulunamadi. Dayanak: sebekeden
    // beslenen tabla mimarisi (X1C 105 W @256mm tabla), U1'in %11 buyuk
    // tablasi ve surekli sicak tutulan 4 nozul. Prizden olcup
    // duzeltebilirsiniz.
    avgPowerW: 150,
    // Resmi: 1150 W @220-240V, 400 W @100-120V. Turkiye 220V oldugu icin
    // 1150 W alindi (kaynak: us.snapmaker.com urun sayfasi).
    maxPowerW: 1150,
    idlePowerW: 15,
    technology: 'FDM',
    buildVolume: '270x270x270 mm',
    heatedBed: true,
    // Acik govde; ust kapak ayri satilan bir aksesuar.
    enclosure: false,
    lifetimeHours: 5000,
  },
  {
    brand: 'Snapmaker',
    model: 'J1s',
    avgPowerW: 150,
    maxPowerW: 400,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '300x200x200 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 Pro',
    aliases: ['ender3pro', 'ender 3pro', 'e3pro', 'ender3 pro'],
    avgPowerW: 125,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 3 Max',
    aliases: ['ender3max', 'e3max', 'ender3 max'],
    avgPowerW: 170,
    maxPowerW: 350,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '300x300x340 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 5 S1',
    aliases: ['ender5s1', 'e5s1', 'ender5 s1', 'ender 5s1'],
    avgPowerW: 125,
    maxPowerW: 350,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x280 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Ender 7',
    aliases: ['ender7', 'e7', 'ender 7'],
    avgPowerW: 145,
    maxPowerW: 350,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '250x250x300 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'CR-10 V3',
    aliases: ['cr10v3', 'cr-10v3', 'cr10 v3', 'cr 10 v3'],
    avgPowerW: 180,
    maxPowerW: 350,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '300x300x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'CR-6 SE',
    aliases: ['cr6se', 'cr-6se', 'cr6 se', 'cr 6 se'],
    avgPowerW: 120,
    maxPowerW: 350,
    idlePowerW: 6,
    technology: 'FDM',
    buildVolume: '235x235x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Creality',
    model: 'Halot Mage',
    aliases: ['halotmage', 'halot-mage', 'halot mage 8k', 'mage 8k'],
    avgPowerW: 55,
    maxPowerW: 100,
    idlePowerW: 5,
    technology: 'RESIN',
    buildVolume: '228x128x230 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Creality',
    model: 'Halot Mage Pro',
    aliases: ['halotmagepro', 'halot-mage-pro', 'halot mage pro', 'magepro'],
    avgPowerW: 75,
    maxPowerW: 150,
    idlePowerW: 6,
    technology: 'RESIN',
    buildVolume: '228x128x230 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Anycubic',
    model: 'Kobra 2 Neo',
    aliases: ['kobra2neo', 'kobra 2neo', 'k2neo', 'kobra neo 2'],
    avgPowerW: 110,
    maxPowerW: 400,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Anycubic',
    model: 'Photon Mono X',
    aliases: ['photonmonox', 'mono x', 'monox', 'photon mono x'],
    avgPowerW: 65,
    maxPowerW: 120,
    idlePowerW: 5,
    technology: 'RESIN',
    buildVolume: '192x120x245 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Anycubic',
    model: 'Photon Mono X 6Ks',
    aliases: ['monox6ks', 'mono x 6ks', 'photon mono x 6ks', '6ks', 'x6ks'],
    avgPowerW: 50,
    maxPowerW: 80,
    idlePowerW: 4,
    technology: 'RESIN',
    buildVolume: '196x122x200 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Elegoo',
    model: 'Saturn 3',
    aliases: ['saturn3', 'saturn 3 12k', 'saturn3 12k'],
    avgPowerW: 80,
    maxPowerW: 144,
    idlePowerW: 5,
    technology: 'RESIN',
    buildVolume: '219x123x250 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Elegoo',
    model: 'Saturn 3 Ultra',
    aliases: ['saturn3ultra', 'saturn 3 ultra', 's3 ultra', 'saturn3u'],
    avgPowerW: 90,
    maxPowerW: 180,
    idlePowerW: 6,
    technology: 'RESIN',
    buildVolume: '219x123x260 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Prusa',
    model: 'MK4',
    aliases: ['mk4', 'prusa mk4', 'i3 mk4', 'mk4 original'],
    avgPowerW: 90,
    maxPowerW: 240,
    idlePowerW: 13,
    technology: 'FDM',
    buildVolume: '250x210x220 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Bambu Lab',
    model: 'P1S Combo (AMS)',
    aliases: ['p1s combo', 'p1scombo', 'p1s ams', 'p1s + ams'],
    avgPowerW: 120,
    maxPowerW: 1000,
    idlePowerW: 13,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Bambu Lab',
    model: 'A1 Combo (AMS lite)',
    aliases: ['a1 combo', 'a1combo', 'a1 ams lite', 'a1 + ams lite'],
    avgPowerW: 100,
    maxPowerW: 1300,
    idlePowerW: 11,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'AnkerMake',
    model: 'M5',
    aliases: ['m5', 'ankermake m5', 'ankerm5', 'eufymake m5'],
    avgPowerW: 110,
    maxPowerW: 350,
    idlePowerW: 11,
    technology: 'FDM',
    buildVolume: '235x235x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'AnkerMake',
    model: 'M5C',
    aliases: ['m5c', 'ankerm5c', 'anker m5c'],
    avgPowerW: 85,
    maxPowerW: 300,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Kingroon',
    model: 'KP3S',
    aliases: ['kp3s', 'kingroon kp3s'],
    avgPowerW: 75,
    maxPowerW: 220,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '180x180x180 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Kingroon',
    model: 'KP3S Pro',
    aliases: ['kp3s pro', 'kp3spro', 'kp3s pro v2'],
    avgPowerW: 90,
    maxPowerW: 300,
    idlePowerW: 11,
    technology: 'FDM',
    buildVolume: '200x200x200 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Two Trees',
    model: 'SK1',
    aliases: ['sk1', 'twotrees sk1', 'two trees sk1'],
    avgPowerW: 190,
    maxPowerW: 350,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '256x256x256 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Tronxy',
    model: 'X5SA',
    aliases: ['x5sa', 'tronxy x5sa'],
    avgPowerW: 190,
    maxPowerW: 360,
    idlePowerW: 9,
    technology: 'FDM',
    buildVolume: '330x330x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Longer',
    model: 'LK5 Pro',
    aliases: ['lk5', 'lk5pro', 'lk5 pro', 'longer lk5'],
    avgPowerW: 170,
    maxPowerW: 360,
    idlePowerW: 8,
    technology: 'FDM',
    buildVolume: '300x300x400 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'RatRig',
    model: 'V-Core 3 (300mm)',
    aliases: ['vcore3', 'v-core 3', 'vcore 3', 'ratrig vcore', 'ratrig v core 3'],
    avgPowerW: 125,
    maxPowerW: 665,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '300x300x300 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'VzBot',
    model: 'Vz235',
    aliases: ['vzbot', 'vz235', 'vzbot235', 'vzbot 235'],
    avgPowerW: 140,
    maxPowerW: 500,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '235x235x205 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Artillery',
    model: 'Genius Pro',
    aliases: ['genius pro', 'geniuspro', 'artillery genius'],
    avgPowerW: 75,
    maxPowerW: 380,
    idlePowerW: 7,
    technology: 'FDM',
    buildVolume: '220x220x250 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Peopoly',
    model: 'Phenom',
    aliases: ['phenom', 'peopoly phenom'],
    avgPowerW: 130,
    maxPowerW: 200,
    idlePowerW: 15,
    technology: 'RESIN',
    buildVolume: '276x155x400 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Phrozen',
    model: 'Sonic Mini 8K',
    aliases: ['sonic mini 8k', 'sonicmini8k', 'mini 8k', 'phrozen mini 8k'],
    avgPowerW: 40,
    maxPowerW: 60,
    idlePowerW: 6,
    technology: 'RESIN',
    buildVolume: '165x72x180 mm',
    heatedBed: false,
    enclosure: true,
    lifetimeHours: 3000,
  },
  {
    brand: 'Snapmaker',
    model: '2.0 A250',
    aliases: ['a250', 'snapmaker a250', 'sm2 a250', 'snapmaker2 a250', '2.0 a250'],
    avgPowerW: 100,
    maxPowerW: 320,
    idlePowerW: 35,
    technology: 'FDM',
    buildVolume: '230x250x235 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Snapmaker',
    model: '2.0 A350',
    aliases: ['a350', 'snapmaker a350', 'sm2 a350', 'snapmaker2 a350', '2.0 a350'],
    avgPowerW: 130,
    maxPowerW: 320,
    idlePowerW: 40,
    technology: 'FDM',
    buildVolume: '320x350x330 mm',
    heatedBed: true,
    enclosure: false,
    lifetimeHours: 3500,
  },
  {
    brand: 'Snapmaker',
    model: 'Artisan',
    aliases: ['artisan', 'snapmaker artisan'],
    avgPowerW: 230,
    maxPowerW: 750,
    idlePowerW: 45,
    technology: 'FDM',
    buildVolume: '400x400x400 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Snapmaker',
    model: 'J1',
    aliases: ['j1', 'snapmaker j1'],
    avgPowerW: 145,
    maxPowerW: 400,
    idlePowerW: 10,
    technology: 'FDM',
    buildVolume: '324x200x200 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Flashforge',
    model: 'Guider 3',
    aliases: ['guider3', 'guider 3', 'ff guider 3'],
    avgPowerW: 200,
    maxPowerW: 650,
    idlePowerW: 20,
    technology: 'FDM',
    buildVolume: '300x250x340 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Flashforge',
    model: 'Adventurer 3',
    aliases: ['adventurer3', 'ad3', 'adv3', 'adventurer 3'],
    avgPowerW: 65,
    maxPowerW: 150,
    idlePowerW: 5,
    technology: 'FDM',
    buildVolume: '150x150x150 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
  {
    brand: 'Flashforge',
    model: 'Creator Pro 2',
    aliases: ['creator pro 2', 'creatorpro2', 'cp2', 'creator pro2'],
    avgPowerW: 85,
    maxPowerW: 320,
    idlePowerW: 12,
    technology: 'FDM',
    buildVolume: '200x148x150 mm',
    heatedBed: true,
    enclosure: true,
    lifetimeHours: 5000,
  },
];

/** Katalogda olmayan yazicilar icin teknoloji/boyut bazli tahmin sablonlari. */
export const GENERIC_PROFILES: Array<{ label: string; avgPowerW: number; maxPowerW: number }> = [
  { label: 'Küçük FDM (180-220 mm, kabinsiz)', avgPowerW: 90, maxPowerW: 270 },
  { label: 'Orta FDM (220-300 mm)', avgPowerW: 130, maxPowerW: 400 },
  { label: 'Büyük FDM (300 mm+)', avgPowerW: 200, maxPowerW: 700 },
  { label: 'Kapalı kabinli / CoreXY', avgPowerW: 160, maxPowerW: 800 },
  { label: 'Reçine (MSLA)', avgPowerW: 70, maxPowerW: 120 },
];

export interface PrinterMatch {
  printer: CatalogPrinter;
  /** 0..1 arasi eslesme skoru. */
  score: number;
}

/** Turkce harfleri ASCII karsiliklarina esler. */
const TR_MAP: Record<string, string> = {
  ı: 'i',
  İ: 'i',
  ş: 's',
  Ş: 's',
  ğ: 'g',
  Ğ: 'g',
  ü: 'u',
  Ü: 'u',
  ö: 'o',
  Ö: 'o',
  ç: 'c',
  Ç: 'c',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Arama icin metni sadelestirir: kucuk harf, ASCII, tek bosluk. */
export function normalizeQuery(text: string): string {
  return text
    .replace(/[ıİşŞğĞüÜöÖçÇâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  return normalizeQuery(text).split(' ').filter(Boolean);
}

/**
 * Bir yazici kaydinin arama havuzu: marka + model + takma adlar.
 */

/**
 * Sorgu ile katalog kaydi arasindaki benzerligi 0..1 arasinda puanlar.
 * Token kapsamasi + tam ifade eslesmesi + marka eslesmesi birlikte degerlendirilir.
 */
/**
 * Sorgu ile katalog kaydı arasındaki benzerlik (0..1).
 *
 * ÖNEMLİ: puan SİMETRİKTİR. Eski sürüm yalnızca sorgu belirteçlerinin ne
 * kadarının eşleştiğine bakıyordu; bu yüzden "K1" araması "K1 Max" için de
 * 1.00 veriyor, "Ender 3" ise "Ender 3 S1 Pro" ile berabere kalıyordu.
 * Modelde bulunup sorguda geçmeyen belirteçler de cezalandırılınca
 * ("K1 Max" için "max") doğru kayıt öne çıkar.
 *
 * Marka adı yalnızca küçük bir bonus verir: tek başına eşleşme yaratmamalı,
 * yoksa "Creality" yazınca rastgele bir Creality modeli seçilir.
 */
function scorePrinter(query: string, printer: CatalogPrinter): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;

  const modelTokens = tokens(printer.model);
  const brandWords = tokens(printer.brand);
  const brandTokens = new Set(brandWords);
  // Marka bitisik yazilabilir ("bambulab") veya kisaltilabilir ("anker").
  const brandGlued = brandWords.join('');
  const isBrandToken = (token: string) =>
    brandTokens.has(token) ||
    token === brandGlued ||
    brandWords.some(
      (word) => word.length >= 4 && (word.startsWith(token) || token.startsWith(word)),
    );
  const aliasForms = (printer.aliases ?? []).map((alias) => normalizeQuery(alias));
  const normalizedQuery = normalizeQuery(query);

  // Tam model adı veya takma ad: tartışmasız eşleşme.
  const modelOnly = queryTokens.filter((token) => !isBrandToken(token));
  const modelPhrase = modelOnly.join(' ');
  if (modelPhrase && modelPhrase === normalizeQuery(printer.model)) return 1;
  if (aliasForms.includes(normalizedQuery) || aliasForms.includes(modelPhrase)) return 1;

  // Marka dışı belirteçler üzerinden simetrik örtüşme (F1).
  const left = modelOnly.length > 0 ? modelOnly : queryTokens;
  const right = modelTokens;
  if (right.length === 0) return 0;

  let shared = 0;
  const used = new Set<number>();
  for (const token of left) {
    let bestIndex = -1;
    let bestWeight = 0;
    right.forEach((candidate, index) => {
      if (used.has(index)) return;
      // Tam eşleşme tam puan, ön ek kısmi puan alır ("mk4" ~ "mk4s").
      const weight =
        candidate === token
          ? 1
          : candidate.startsWith(token) || token.startsWith(candidate)
            ? 0.7
            : 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) {
      used.add(bestIndex);
      shared += bestWeight;
    }
  }

  const f1 = (2 * shared) / (left.length + right.length);

  // Marka da yazılmışsa küçük bir güven artışı.
  const brandHit = queryTokens.some(isBrandToken);
  return Math.min(1, f1 + (brandHit ? 0.06 : 0));
}

/**
 * Katalog değeri sorgusuz sualsiz uygulanabilir mi?
 *
 * Yalnızca yüksek puan yetmez: sorgudaki HER belirteç modelde karşılanmalı.
 * "Ender 3 Pro" araması "Ender 3 S1 Pro" ile yüksek puan alır ama "pro"
 * dışındaki farkı gizler; böyle bir eşleşme kullanıcıya sorulmadan
 * uygulanmamalıdır.
 */
export function isConfidentMatch(match: PrinterMatch, query: string): boolean {
  if (match.score < CONFIDENT_SCORE) return false;
  const brandWords = tokens(match.printer.brand);
  const brandTokens = new Set(brandWords);
  const brandGlued = brandWords.join('');
  const modelTokens = new Set(tokens(match.printer.model));
  const aliasTokens = new Set((match.printer.aliases ?? []).flatMap((alias) => tokens(alias)));
  return tokens(query).every(
    (token) =>
      brandTokens.has(token) ||
      token === brandGlued ||
      brandWords.some(
        (word) => word.length >= 4 && (word.startsWith(token) || token.startsWith(word)),
      ) ||
      modelTokens.has(token) ||
      aliasTokens.has(token) ||
      [...modelTokens].some((m) => m.startsWith(token) || token.startsWith(m)),
  );
}

/**
 * Serbest metinden ("bambu lab p1s", "ender 3 v2") en olasi yazicilari dondurur.
 */
/** Oneri listesine girme esigi. */
const SUGGEST_SCORE = 0.45;
/** Kullaniciya sormadan uygulama esigi. */
const CONFIDENT_SCORE = 0.9;

/**
 * Kullanicinin kendi ekledigi yazicilar.
 *
 * Hicbir statik liste yeni cikan modellere yetisemez; bulunamayan bir yazici
 * bir kez elle girilince buraya kaydedilir ve sonraki aramalarda cikar.
 * Kayitlar veri dosyasindan gelir, uygulama acilisinda buraya yuklenir.
 */
let customPrinters: CatalogPrinter[] = [];

export function setCustomPrinters(list: CatalogPrinter[]): void {
  customPrinters = list;
}

/** Yerlesik katalog + kullanicinin ekledikleri. */
export function allPrinters(): CatalogPrinter[] {
  return [...PRINTER_CATALOG, ...customPrinters];
}

export function searchPrinters(query: string, limit = 6): PrinterMatch[] {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];
  return allPrinters()
    .map((printer) => ({ printer, score: scorePrinter(query, printer) }))
    .filter((match) => match.score >= SUGGEST_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Esit puanda daha kisa model adi daha spesifiktir.
        a.printer.model.length - b.printer.model.length ||
        a.printer.model.localeCompare(b.printer.model, 'tr'),
    )
    .slice(0, limit);
}

/** En iyi tek eslesmeyi dondurur (yoksa null). */
export function findPrinter(query: string): PrinterMatch | null {
  return searchPrinters(query, 1)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Cevrimici spec ayristirma (sunucu tarafinda kullanilir)
// ---------------------------------------------------------------------------

export interface ScrapedPrinterSpec {
  powerW: number | null;
  buildVolume: string | null;
  warnings: string[];
}

const POWER_CONTEXT =
  /(power|guc|güç|consumption|tuketim|tüketim|wattage|rated|nominal|input|elektrik)/i;

/**
 * Serbest metinden yazici guc tuketimini (W) cikarmayi dener.
 * Sadece "power/guc" baglaminda gecen watt degerlerini kabul eder ki
 * lazer/motor gibi alakasiz sayilar yakalanmasin.
 */
export function extractPowerWatts(text: string): number | null {
  if (!text) return null;
  const candidates: number[] = [];
  const pattern = /(\d{2,4}(?:[.,]\d+)?)\s*(?:w\b|watt|watts)/gi;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 90), index + 40);
    if (!POWER_CONTEXT.test(context)) continue;
    const value = Number.parseFloat(match[1].replace(',', '.'));
    // 3D yazicilar icin makul aralik.
    if (Number.isFinite(value) && value >= 30 && value <= 3000) candidates.push(value);
  }
  if (candidates.length === 0) return null;
  // Birden fazla aday varsa en dusuk makul deger genelde nominal tuketimdir.
  return Math.min(...candidates);
}

/** Serbest metinden baski hacmini (mm) yakalar. */
export function extractBuildVolume(text: string): string | null {
  if (!text) return null;
  const match = text.match(/(\d{2,3})\s*[x×*]\s*(\d{2,3})\s*[x×*]\s*(\d{2,3})\s*(?:mm)?/i);
  if (!match) return null;
  return `${match[1]}x${match[2]}x${match[3]} mm`;
}

/**
 * Bir yazici urun/spec sayfasinin duz metninden teknik bilgi cikarir.
 * Asla exception firlatmaz.
 */
export function parsePrinterSpecText(text: string): ScrapedPrinterSpec {
  const warnings: string[] = [];
  let powerW: number | null = null;
  let buildVolume: string | null = null;
  try {
    powerW = extractPowerWatts(text);
    buildVolume = extractBuildVolume(text);
    if (powerW === null) warnings.push('Sayfada güç tüketimi (W) bilgisi bulunamadı.');
  } catch (error) {
    warnings.push(
      `Teknik bilgi ayrıştırma hatası: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`,
    );
  }
  return { powerW, buildVolume, warnings };
}
