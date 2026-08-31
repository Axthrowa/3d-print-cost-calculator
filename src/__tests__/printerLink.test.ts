import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORTS,
  authHeaders,
  baseUrl,
  canCommand,
  canPrint,
  cleanHost,
  commandRequest,
  describeTarget,
  formatEta,
  formatTemp,
  heatRatio,
  hostPort,
  isNetworkKind,
  needsApiKey,
  newLink,
  normalizeMoonraker,
  normalizeOctoprint,
  normalizeSerial,
  normalizeSnapmaker,
  normalizeStatus,
  offlineStatus,
  parseMarlinProgress,
  parseMarlinTemps,
  statusPaths,
  uploadTarget,
  validateLink,
  type PrinterLink,
} from '../lib/printerLink';

const link = (over: Partial<PrinterLink> = {}): PrinterLink => ({
  ...newLink('p1', '2026-08-29T00:00:00.000Z'),
  name: 'Salon',
  host: '192.168.1.50',
  ...over,
});

describe('cleanHost / hostPort', () => {
  it('şema ve yolu atar', () => {
    expect(cleanHost('http://192.168.1.50:7125/printer')).toBe('192.168.1.50');
    expect(cleanHost('  octopi.local/  ')).toBe('octopi.local');
  });

  it('adreste yazılı portu okur', () => {
    expect(hostPort('192.168.1.50:5000')).toBe(5000);
    expect(hostPort('http://octopi.local:80/x')).toBe(80);
  });

  it('port yoksa null döner', () => {
    expect(hostPort('192.168.1.50')).toBeNull();
    expect(hostPort('octopi.local')).toBeNull();
  });

  it('geçersiz portu almaz', () => {
    expect(hostPort('192.168.1.50:99999')).toBeNull();
  });
});

describe('baseUrl / describeTarget', () => {
  it('portu adrese ekler', () => {
    expect(baseUrl(link({ port: 7125 }))).toBe('http://192.168.1.50:7125');
  });

  it('80 portunu yazmaz', () => {
    expect(baseUrl(link({ kind: 'octoprint', port: 80 }))).toBe('http://192.168.1.50');
  });

  it('adres yoksa boş döner', () => {
    expect(baseUrl(link({ host: '' }))).toBe('');
    expect(describeTarget(link({ host: '' }))).toBe('adres girilmedi');
  });

  it('seri bağlantıyı port ve hızla anlatır', () => {
    expect(describeTarget(link({ kind: 'serial', serialPath: 'COM3', baudRate: 115200 }))).toBe(
      'COM3 · 115200 baud',
    );
  });
});

describe('validateLink', () => {
  it('doğru ağ yazıcısında sorun bulmaz', () => {
    expect(validateLink(link())).toEqual([]);
  });

  it('adı boş bırakılamaz', () => {
    expect(validateLink(link({ name: '  ' })).join(' ')).toContain('ad verin');
  });

  it('ağ yazıcısında adres ister', () => {
    expect(validateLink(link({ host: '' })).join(' ')).toContain('IP adresi');
  });

  it('OctoPrint için anahtar zorunlu', () => {
    expect(validateLink(link({ kind: 'octoprint', apiKey: '' })).join(' ')).toContain(
      'API anahtarı',
    );
    expect(validateLink(link({ kind: 'octoprint', apiKey: 'abc' }))).toEqual([]);
  });

  it('Moonraker anahtarsız kabul edilir', () => {
    expect(needsApiKey('moonraker')).toBe(false);
    expect(validateLink(link({ kind: 'moonraker', apiKey: '' }))).toEqual([]);
  });

  it('seri bağlantıda port adı ister', () => {
    expect(validateLink(link({ kind: 'serial', serialPath: '' })).join(' ')).toContain('COM3');
    expect(validateLink(link({ kind: 'serial', serialPath: 'COM4' }))).toEqual([]);
  });

  it('geçersiz portu yakalar', () => {
    expect(validateLink(link({ port: 0 })).join(' ')).toContain('1-65535');
  });
});

describe('normalizeMoonraker', () => {
  const payload = {
    result: {
      status: {
        print_stats: {
          state: 'printing',
          filename: 'parts/kapak.gcode',
          print_duration: 600,
          message: '',
        },
        extruder: { temperature: 210.4, target: 210 },
        heater_bed: { temperature: 59.8, target: 60 },
        virtual_sdcard: { progress: 0.25 },
        display_status: { progress: 0.24 },
      },
    },
  };

  it('durumu ve ilerlemeyi okur', () => {
    const status = normalizeMoonraker(payload);
    expect(status.state).toBe('printing');
    expect(status.progress).toBeCloseTo(0.25, 6);
    expect(status.jobName).toBe('kapak.gcode');
    expect(status.nozzle).toEqual({ current: 210.4, target: 210 });
    expect(status.bed).toEqual({ current: 59.8, target: 60 });
  });

  it('kalan süreyi geçen süre ve orandan tahmin eder', () => {
    // 600 sn'de %25 -> toplam 2400 sn, kalan 1800 sn.
    expect(normalizeMoonraker(payload).remainingSeconds).toBe(1800);
  });

  it('ilerleme yokken kalan süre tahmin etmez', () => {
    const idle = { result: { status: { print_stats: { state: 'standby', print_duration: 0 } } } };
    const status = normalizeMoonraker(idle);
    expect(status.state).toBe('idle');
    expect(status.remainingSeconds).toBeNull();
  });

  it('bilinmeyen durumu uydurmaz', () => {
    expect(
      normalizeMoonraker({ result: { status: { print_stats: { state: 'zzz' } } } }).state,
    ).toBe('unknown');
  });

  it('bozuk cevapta çökmez', () => {
    expect(normalizeMoonraker(null).state).toBe('unknown');
    expect(normalizeMoonraker({ result: 'yok' }).nozzle).toBeNull();
  });
});

describe('normalizeOctoprint', () => {
  const payload = {
    printer: {
      state: { text: 'Printing', flags: { operational: true, printing: true, paused: false } },
      temperature: { tool0: { actual: 205.1, target: 205 }, bed: { actual: 60.2, target: 60 } },
    },
    job: {
      job: { file: { name: 'kutu.gcode' } },
      progress: { completion: 42.5, printTime: 900, printTimeLeft: 1200 },
    },
  };

  it('bayraklardan durumu çıkarır', () => {
    const status = normalizeOctoprint(payload);
    expect(status.state).toBe('printing');
    expect(status.progress).toBeCloseTo(0.425, 6);
    expect(status.remainingSeconds).toBe(1200);
    expect(status.jobName).toBe('kutu.gcode');
  });

  it('duraklatma yazdırmadan önce gelir', () => {
    const paused = {
      printer: { state: { text: 'Paused', flags: { printing: true, paused: true } } },
      job: {},
    };
    expect(normalizeOctoprint(paused).state).toBe('paused');
  });

  it('hata bayrağı her şeyi bastırır', () => {
    const failed = {
      printer: { state: { text: 'Error', flags: { printing: true, error: true } } },
      job: {},
    };
    expect(normalizeOctoprint(failed).state).toBe('error');
  });

  it('boştaki yazıcıyı tanır', () => {
    const idle = {
      printer: { state: { text: 'Operational', flags: { operational: true, printing: false } } },
      job: {},
    };
    expect(normalizeOctoprint(idle).state).toBe('idle');
  });

  it('yüzdeyi orana çevirirken sınırları korur', () => {
    const over = { printer: {}, job: { progress: { completion: 140 } } };
    expect(normalizeOctoprint(over).progress).toBe(1);
  });
});

describe('normalizeSnapmaker', () => {
  it('alanları eşler', () => {
    const status = normalizeSnapmaker({
      status: 'RUNNING',
      nozzleTemperature: 200,
      nozzleTargetTemperature: 200,
      heatedBedTemperature: 55,
      heatedBedTargetTemperature: 60,
      progress: 0.6,
      fileName: 'D:/isler/govde.gcode',
      remainingTime: 300,
      elapsedTime: 450,
    });
    expect(status.state).toBe('printing');
    expect(status.bed).toEqual({ current: 55, target: 60 });
    expect(status.jobName).toBe('govde.gcode');
    expect(status.remainingSeconds).toBe(300);
  });

  it('boştaki durumu tanır', () => {
    expect(normalizeSnapmaker({ status: 'IDLE' }).state).toBe('idle');
  });
});

describe('Marlin seri çıktısı', () => {
  it('sıcaklık satırını okur', () => {
    const temps = parseMarlinTemps('ok T:210.24 /210.00 B:59.80 /60.00 @:64 B@:32');
    expect(temps.nozzle).toEqual({ current: 210.24, target: 210 });
    expect(temps.bed).toEqual({ current: 59.8, target: 60 });
  });

  it('çok kafalı yazıcıda T0 önceliklidir', () => {
    const temps = parseMarlinTemps('ok T:20.0 /0.0 T0:215.0 /215.0 B:60.0 /60.0');
    expect(temps.nozzle).toEqual({ current: 215, target: 215 });
  });

  it('ilgisiz satırda boş döner', () => {
    expect(parseMarlinTemps('echo:busy processing')).toEqual({ nozzle: null, bed: null });
  });

  it('SD ilerlemesini okur', () => {
    expect(parseMarlinProgress('SD printing byte 2048/8192')).toBeCloseTo(0.25, 6);
  });

  it('sıfır uzunlukta bölme yapmaz', () => {
    expect(parseMarlinProgress('SD printing byte 0/0')).toBeNull();
  });

  it('satırlardan durum üretir', () => {
    const status = normalizeSerial({
      lines: ['ok T:205.0 /205.0 B:60.0 /60.0', 'SD printing byte 100/400'],
    });
    expect(status.state).toBe('printing');
    expect(status.progress).toBeCloseTo(0.25, 6);
  });

  it('SD baskısı yoksa boşta sayar', () => {
    const status = normalizeSerial({
      lines: ['ok T:25.0 /0.0 B:24.0 /0.0', 'Not SD printing'],
    });
    expect(status.state).toBe('idle');
  });

  it('akıtma sırasında kendi ilerlemesini kullanır', () => {
    const status = normalizeSerial({ lines: [], streaming: true, streamProgress: 0.4 });
    expect(status.state).toBe('printing');
    expect(status.progress).toBeCloseTo(0.4, 6);
  });

  it('hiç veri yoksa çevrimdışıdır', () => {
    expect(normalizeSerial({ lines: [] }).state).toBe('offline');
  });
});

describe('istek üreticileri', () => {
  it('her tür için durum yolu verir', () => {
    expect(statusPaths('moonraker', '')[0].path).toContain('/printer/objects/query');
    expect(statusPaths('octoprint', 'k').map((p) => p.key)).toEqual(['printer', 'job']);
    expect(statusPaths('snapmaker', 'a b')[0].path).toContain('token=a%20b');
    expect(statusPaths('serial', '')).toEqual([]);
  });

  it('Moonraker cevabı sarmalanmadan birleşir', () => {
    // Moonraker zaten {result:{status}} döner; anahtar verilseydi iki kat sarılırdı.
    expect(statusPaths('moonraker', '')[0].key).toBe('');
  });

  it('OctoPrint anahtarı başlıkla gider', () => {
    expect(authHeaders('octoprint', 'gizli')).toEqual({ 'X-Api-Key': 'gizli' });
    expect(authHeaders('snapmaker', 'gizli')).toEqual({});
    expect(authHeaders('octoprint', '')).toEqual({});
  });

  it('komutları protokole çevirir', () => {
    expect(commandRequest('moonraker', 'pause', '').path).toBe('/printer/print/pause');
    expect(commandRequest('octoprint', 'resume', '').body).toEqual({
      command: 'pause',
      action: 'resume',
    });
    expect(commandRequest('octoprint', 'cancel', '').body).toEqual({ command: 'cancel' });
    expect(commandRequest('snapmaker', 'cancel', 'tok').path).toContain('/api/v1/stop');
    expect(commandRequest('serial', 'pause', '').gcode).toEqual(['M25']);
    expect(commandRequest('serial', 'cancel', '').gcode).toEqual(['M524']);
  });

  it('yükleme hedefini ve başlat bayrağını kurar', () => {
    expect(uploadTarget('moonraker', '', true).fields).toEqual({ root: 'gcodes', print: 'true' });
    expect(uploadTarget('octoprint', '', false).fields).toEqual({
      select: 'true',
      print: 'false',
    });
    expect(uploadTarget('snapmaker', 'tok', true).path).toContain('token=tok');
  });
});

describe('görüntüleme yardımcıları', () => {
  it('süreyi kısa yazar', () => {
    expect(formatEta(null)).toBe('—');
    expect(formatEta(45)).toBe('45 sn');
    expect(formatEta(600)).toBe('10 dk');
    expect(formatEta(7200)).toBe('2 sa');
    expect(formatEta(5400)).toBe('1 sa 30 dk');
  });

  it('negatif süreyi göstermez', () => {
    expect(formatEta(-5)).toBe('—');
  });

  it('sıcaklığı hedefiyle yazar', () => {
    expect(formatTemp(null)).toBe('—');
    expect(formatTemp({ current: 210.4, target: 210 })).toBe('210° / 210°');
    expect(formatTemp({ current: 24.2, target: 0 })).toBe('24°');
  });

  it('ısınma oranını sınırlar', () => {
    expect(heatRatio(null)).toBeNull();
    expect(heatRatio({ current: 105, target: 100 })).toBe(1);
    expect(heatRatio({ current: 50, target: 100 })).toBeCloseTo(0.5, 6);
    expect(heatRatio({ current: 30, target: 0 })).toBeNull();
  });

  it('komut düğmelerini duruma göre açar', () => {
    expect(canCommand('printing', 'pause')).toBe(true);
    expect(canCommand('idle', 'pause')).toBe(false);
    expect(canCommand('paused', 'resume')).toBe(true);
    expect(canCommand('paused', 'cancel')).toBe(true);
    expect(canCommand('offline', 'cancel')).toBe(false);
  });

  it('baskıya gönderme yalnızca boştayken açıktır', () => {
    expect(canPrint('idle')).toBe(true);
    expect(canPrint('printing')).toBe(false);
    expect(canPrint('offline')).toBe(false);
  });
});

describe('genel davranış', () => {
  it('çevrimdışı durum mesajı taşır', () => {
    const status = offlineStatus('Kapalı');
    expect(status.state).toBe('offline');
    expect(status.message).toBe('Kapalı');
    expect(status.progress).toBeNull();
  });

  it('normalizeStatus türe göre dağıtır', () => {
    expect(normalizeStatus('snapmaker', { status: 'PAUSED' }).state).toBe('paused');
    expect(normalizeStatus('serial', { lines: [] }).state).toBe('offline');
  });

  it('yeni kayıt varsayılan portla gelir', () => {
    const fresh = newLink('x', '2026-08-29T00:00:00.000Z');
    expect(fresh.port).toBe(DEFAULT_PORTS.moonraker);
    expect(fresh.enabled).toBe(true);
    expect(isNetworkKind(fresh.kind)).toBe(true);
  });
});
