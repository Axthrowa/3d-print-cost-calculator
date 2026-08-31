/**
 * Yazıcı bağlantı katmanı.
 *
 * Burada yalnızca SAF dönüşümler bulunur: hangi adrese ne sorulacağı ve gelen
 * cevabın ortak `LiveStatus` biçimine nasıl çevrileceği. Ağ çağrısının kendisi
 * arka planda (Node sunucusu veya Tauri/Rust) yapılır; tarayıcı doğrudan
 * yazıcıya bağlanamaz (CORS + karışık içerik). Böylece protokol bilgisi tek
 * yerde durur ve donanım olmadan test edilebilir.
 */

export type PrinterKind = 'moonraker' | 'octoprint' | 'snapmaker' | 'serial';

export type PrinterState = 'idle' | 'printing' | 'paused' | 'error' | 'offline' | 'unknown';

export type PrinterCommand = 'pause' | 'resume' | 'cancel';

export interface PrinterLink {
  id: string;
  /** Kullanıcının verdiği ad. */
  name: string;
  kind: PrinterKind;
  /** Ağ yazıcıları için IP veya sunucu adı. */
  host: string;
  port: number;
  apiKey: string;
  /** Seri bağlantı için port adı (Windows'ta COM3 gibi). */
  serialPath: string;
  baudRate: number;
  /**
   * Hesaplamadaki yazıcı profilinin adı. Doldurulursa canlı baskılar bu
   * profilin çalışma süresine yazılabilir.
   */
  profileName: string;
  enabled: boolean;
  createdAt: string;
}

export interface TempReading {
  current: number;
  target: number;
}

export interface LiveStatus {
  state: PrinterState;
  /** Yazıcıdan gelen ham durum metni (tanılama için). */
  raw: string;
  nozzle: TempReading | null;
  bed: TempReading | null;
  /** 0..1 aralığında tamamlanma oranı. */
  progress: number | null;
  jobName: string | null;
  remainingSeconds: number | null;
  elapsedSeconds: number | null;
  /** Hata veya bilgi mesajı. */
  message: string | null;
}

export const PRINTER_KINDS: Array<{ id: PrinterKind; label: string; hint: string }> = [
  { id: 'moonraker', label: 'Klipper / Moonraker', hint: 'Fluidd, Mainsail, Creality K1' },
  { id: 'octoprint', label: 'OctoPrint', hint: 'OctoPi ve türevleri' },
  { id: 'snapmaker', label: 'Snapmaker', hint: 'Snapmaker 2.0 / Artisan' },
  { id: 'serial', label: 'USB seri port', hint: 'Marlin, Ender, Prusa (deneysel)' },
];

export const DEFAULT_PORTS: Record<PrinterKind, number> = {
  moonraker: 7125,
  octoprint: 80,
  snapmaker: 8080,
  serial: 0,
};

const DEFAULT_BAUD = 115200;

export const BAUD_RATES = [250000, 115200, 57600, 38400, 19200, 9600];

/** Ağ üzerinden konuşulan türler; seri port dışındakiler. */
export function isNetworkKind(kind: PrinterKind): boolean {
  return kind !== 'serial';
}

/** API anahtarı zorunlu mu? */
export function needsApiKey(kind: PrinterKind): boolean {
  return kind === 'octoprint' || kind === 'snapmaker';
}

export function newLink(id: string, at: string): PrinterLink {
  return {
    id,
    name: '',
    kind: 'moonraker',
    host: '',
    port: DEFAULT_PORTS.moonraker,
    apiKey: '',
    serialPath: '',
    baudRate: DEFAULT_BAUD,
    profileName: '',
    enabled: true,
    createdAt: at,
  };
}

/** Kullanıcının yazdığı adresten şema ve fazlalıkları ayıklar. */
export function cleanHost(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^[a-z]+:\/\//i, '');
  value = value.replace(/\/.*$/, '');
  value = value.replace(/:\d+$/, '');
  return value;
}

/** Adreste port yazılmışsa onu okur. */
export function hostPort(raw: string): number | null {
  const match = raw.trim().match(/:(\d{1,5})(?:\/|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port > 0 && port <= 65535 ? port : null;
}

export function baseUrl(link: PrinterLink): string {
  const host = cleanHost(link.host);
  const port = link.port || DEFAULT_PORTS[link.kind];
  if (!host) return '';
  return port === 80 ? `http://${host}` : `http://${host}:${port}`;
}

/** Yazıcı ekranındaki kısa adres özeti. */
export function describeTarget(link: PrinterLink): string {
  if (link.kind === 'serial') {
    return link.serialPath ? `${link.serialPath} · ${link.baudRate} baud` : 'port seçilmedi';
  }
  return baseUrl(link) || 'adres girilmedi';
}

/** Kaydetmeden önceki doğrulama. Boş dizi = sorun yok. */
export function validateLink(link: PrinterLink): string[] {
  const errors: string[] = [];
  if (!link.name.trim()) errors.push('Yazıcıya bir ad verin.');
  if (isNetworkKind(link.kind)) {
    if (!cleanHost(link.host)) errors.push('IP adresi veya sunucu adı gerekli.');
    if (!link.port || link.port < 1 || link.port > 65535)
      errors.push('Port 1-65535 arasında olmalı.');
    if (needsApiKey(link.kind) && !link.apiKey.trim()) errors.push('API anahtarı gerekli.');
  } else {
    if (!link.serialPath.trim()) errors.push('Seri port adı gerekli (örn. COM3).');
    if (!link.baudRate || link.baudRate < 1200) errors.push('Geçerli bir baud hızı seçin.');
  }
  return errors;
}

const EMPTY_STATUS: LiveStatus = {
  state: 'unknown',
  raw: '',
  nozzle: null,
  bed: null,
  progress: null,
  jobName: null,
  remainingSeconds: null,
  elapsedSeconds: null,
  message: null,
};

export function offlineStatus(message: string): LiveStatus {
  return { ...EMPTY_STATUS, state: 'offline', message };
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function temp(current: unknown, target: unknown): TempReading | null {
  const c = num(current);
  if (c === null) return null;
  return { current: c, target: num(target) ?? 0 };
}

function clamp01(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(1, Math.max(0, value));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Dosya yolundan yalnızca dosya adını alır. */
function fileName(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

// --------------------------------------------------------------- Moonraker

const MOONRAKER_QUERY =
  '/printer/objects/query?print_stats&extruder&heater_bed&display_status&virtual_sdcard';

const MOONRAKER_STATES: Record<string, PrinterState> = {
  standby: 'idle',
  printing: 'printing',
  paused: 'paused',
  complete: 'idle',
  cancelled: 'idle',
  error: 'error',
};

export function normalizeMoonraker(payload: unknown): LiveStatus {
  const status = obj(obj(obj(payload).result).status);
  const stats = obj(status.print_stats);
  const raw = text(stats.state) ?? '';
  const progress =
    clamp01(num(obj(status.virtual_sdcard).progress)) ??
    clamp01(num(obj(status.display_status).progress));
  const elapsed = num(stats.print_duration);

  // Moonraker kalan süreyi vermez; ilerleme ve geçen süreden tahmin edilir.
  let remaining: number | null = null;
  if (elapsed !== null && progress !== null && progress > 0.01) {
    remaining = Math.max(0, Math.round(elapsed / progress - elapsed));
  }

  return {
    state: MOONRAKER_STATES[raw.toLowerCase()] ?? 'unknown',
    raw,
    nozzle: temp(obj(status.extruder).temperature, obj(status.extruder).target),
    bed: temp(obj(status.heater_bed).temperature, obj(status.heater_bed).target),
    progress,
    jobName: fileName(stats.filename),
    remainingSeconds: remaining,
    elapsedSeconds: elapsed === null ? null : Math.round(elapsed),
    message: text(stats.message),
  };
}

// --------------------------------------------------------------- OctoPrint

export function normalizeOctoprint(payload: unknown): LiveStatus {
  const root = obj(payload);
  const printer = obj(root.printer);
  const job = obj(root.job);
  const flags = obj(obj(printer.state).flags);
  const raw = text(obj(printer.state).text) ?? text(job.state) ?? '';

  let state: PrinterState = 'unknown';
  if (flags.error === true || flags.closedOrError === true) state = 'error';
  else if (flags.paused === true || flags.pausing === true) state = 'paused';
  else if (flags.printing === true || flags.cancelling === true) state = 'printing';
  else if (flags.ready === true || flags.operational === true) state = 'idle';
  else if (/print/i.test(raw)) state = 'printing';

  const temps = obj(printer.temperature);
  const progress = obj(job.progress);
  const completion = num(progress.completion);

  return {
    state,
    raw,
    nozzle: temp(obj(temps.tool0).actual, obj(temps.tool0).target),
    bed: temp(obj(temps.bed).actual, obj(temps.bed).target),
    progress: completion === null ? null : clamp01(completion / 100),
    jobName: fileName(obj(obj(job.job).file).name),
    remainingSeconds: num(progress.printTimeLeft),
    elapsedSeconds: num(progress.printTime),
    message: null,
  };
}

// --------------------------------------------------------------- Snapmaker

const SNAPMAKER_STATES: Record<string, PrinterState> = {
  idle: 'idle',
  ready: 'idle',
  running: 'printing',
  paused: 'paused',
  pausing: 'paused',
  stopped: 'idle',
  finished: 'idle',
};

export function normalizeSnapmaker(payload: unknown): LiveStatus {
  const root = obj(payload);
  const raw = text(root.status) ?? '';
  const progress = clamp01(num(root.progress));

  return {
    state: SNAPMAKER_STATES[raw.toLowerCase()] ?? 'unknown',
    raw,
    nozzle: temp(root.nozzleTemperature, root.nozzleTargetTemperature),
    bed: temp(root.heatedBedTemperature, root.heatedBedTargetTemperature),
    progress,
    jobName: fileName(root.fileName),
    remainingSeconds: num(root.remainingTime),
    elapsedSeconds: num(root.elapsedTime),
    message: text(root.err),
  };
}

// ------------------------------------------------------------- Seri (Marlin)

/** `ok T:210.2 /210.0 B:60.1 /60.0` biçimindeki M105 cevabını okur. */
export function parseMarlinTemps(line: string): {
  nozzle: TempReading | null;
  bed: TempReading | null;
} {
  const read = (key: string): TempReading | null => {
    const match = line.match(
      new RegExp(key + ':\\s*(-?\\d+(?:\\.\\d+)?)\\s*/\\s*(-?\\d+(?:\\.\\d+)?)'),
    );
    if (!match) return null;
    return { current: Number(match[1]), target: Number(match[2]) };
  };
  return { nozzle: read('T0') ?? read('T'), bed: read('B') };
}

/** `SD printing byte 1234/5678` biçimindeki M27 cevabını okur. */
export function parseMarlinProgress(line: string): number | null {
  const match = line.match(/byte\s+(\d+)\s*\/\s*(\d+)/i);
  if (!match) return null;
  const total = Number(match[2]);
  if (!total) return null;
  return clamp01(Number(match[1]) / total);
}

export function normalizeSerial(payload: unknown): LiveStatus {
  const root = obj(payload);
  const lines = Array.isArray(root.lines)
    ? root.lines.filter((l): l is string => typeof l === 'string')
    : [];
  const joined = lines.join('\n');

  let nozzle: TempReading | null = null;
  let bed: TempReading | null = null;
  let progress: number | null = null;
  let printing = false;

  for (const line of lines) {
    const temps = parseMarlinTemps(line);
    if (temps.nozzle) nozzle = temps.nozzle;
    if (temps.bed) bed = temps.bed;
    const p = parseMarlinProgress(line);
    if (p !== null) {
      progress = p;
      printing = true;
    }
    if (/not sd printing/i.test(line)) printing = false;
  }

  const streaming = root.streaming === true;
  const streamProgress = clamp01(num(root.streamProgress));

  return {
    state: streaming || printing ? 'printing' : nozzle || bed ? 'idle' : 'offline',
    raw: joined.slice(0, 400),
    nozzle,
    bed,
    progress: streaming ? streamProgress : progress,
    jobName: fileName(root.jobName),
    remainingSeconds: null,
    elapsedSeconds: null,
    message: text(root.error),
  };
}

// ------------------------------------------------------------------ Ortak

export function normalizeStatus(kind: PrinterKind, payload: unknown): LiveStatus {
  switch (kind) {
    case 'moonraker':
      return normalizeMoonraker(payload);
    case 'octoprint':
      return normalizeOctoprint(payload);
    case 'snapmaker':
      return normalizeSnapmaker(payload);
    case 'serial':
      return normalizeSerial(payload);
  }
}

/** Durum sorgusu için istenecek yollar (sunucu tarafında birleştirilir). */
export function statusPaths(
  kind: PrinterKind,
  apiKey: string,
): Array<{ key: string; path: string }> {
  switch (kind) {
    case 'moonraker':
      return [{ key: '', path: MOONRAKER_QUERY }];
    case 'octoprint':
      return [
        { key: 'printer', path: '/api/printer' },
        { key: 'job', path: '/api/job' },
      ];
    case 'snapmaker':
      return [{ key: '', path: `/api/v1/status?token=${encodeURIComponent(apiKey)}` }];
    case 'serial':
      return [];
  }
}

/** Yazıcıya gönderilecek kimlik başlıkları. */
export function authHeaders(kind: PrinterKind, apiKey: string): Record<string, string> {
  if (!apiKey) return {};
  if (kind === 'octoprint') return { 'X-Api-Key': apiKey };
  if (kind === 'moonraker') return { 'X-Api-Key': apiKey };
  return {};
}

export interface CommandRequest {
  path: string;
  method: 'POST';
  /** JSON gövdesi; yoksa boş istek gönderilir. */
  body: Json | null;
  /** Seri bağlantıda gönderilecek G-code satırları. */
  gcode: string[] | null;
}

export function commandRequest(
  kind: PrinterKind,
  command: PrinterCommand,
  apiKey: string,
): CommandRequest {
  const token = encodeURIComponent(apiKey);
  switch (kind) {
    case 'moonraker':
      return {
        path: `/printer/print/${command === 'cancel' ? 'cancel' : command}`,
        method: 'POST',
        body: null,
        gcode: null,
      };
    case 'octoprint':
      return {
        path: '/api/job',
        method: 'POST',
        body:
          command === 'cancel'
            ? { command: 'cancel' }
            : { command: 'pause', action: command === 'pause' ? 'pause' : 'resume' },
        gcode: null,
      };
    case 'snapmaker': {
      const verb = command === 'cancel' ? 'stop' : command;
      return { path: `/api/v1/${verb}?token=${token}`, method: 'POST', body: null, gcode: null };
    }
    case 'serial':
      return {
        path: '',
        method: 'POST',
        body: null,
        // M25 duraklat, M24 devam, M524 iptal (Marlin).
        gcode: [command === 'pause' ? 'M25' : command === 'resume' ? 'M24' : 'M524'],
      };
  }
}

export interface UploadTarget {
  path: string;
  /** Dosyanın gideceği form alanı adı. */
  field: string;
  /** Yüklemeyle birlikte gönderilecek ek alanlar. */
  fields: Record<string, string>;
}

export function uploadTarget(kind: PrinterKind, apiKey: string, start: boolean): UploadTarget {
  switch (kind) {
    case 'moonraker':
      return {
        path: '/server/files/upload',
        field: 'file',
        fields: { root: 'gcodes', print: start ? 'true' : 'false' },
      };
    case 'octoprint':
      return {
        path: '/api/files/local',
        field: 'file',
        fields: { select: 'true', print: start ? 'true' : 'false' },
      };
    case 'snapmaker':
      return {
        path: `/api/v1/upload?token=${encodeURIComponent(apiKey)}`,
        field: 'file',
        fields: {},
      };
    case 'serial':
      return { path: '', field: 'file', fields: {} };
  }
}

// -------------------------------------------------------------- Görselleme

export const STATE_META: Record<PrinterState, { label: string; tone: string; dot: string }> = {
  idle: {
    label: 'Boşta',
    tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  printing: {
    label: 'Baskı yapıyor',
    tone: 'bg-accent-500/15 text-accent-600 dark:text-accent-300',
    dot: 'bg-accent-500',
  },
  paused: {
    label: 'Duraklatıldı',
    tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  error: {
    label: 'Hata',
    tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  offline: {
    label: 'Bağlanamadı',
    tone: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    dot: 'bg-slate-400',
  },
  unknown: {
    label: 'Bilinmiyor',
    tone: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    dot: 'bg-slate-400',
  },
};

/** Saniyeyi "2 sa 5 dk" gibi kısa metne çevirir. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  if (total < 60) return `${total} sn`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours === 0) return `${minutes} dk`;
  return minutes === 0 ? `${hours} sa` : `${hours} sa ${minutes} dk`;
}

/** Sıcaklığı hedefiyle birlikte yazar. */
export function formatTemp(reading: TempReading | null): string {
  if (!reading) return '—';
  const current = reading.current.toFixed(0);
  return reading.target > 0 ? `${current}° / ${reading.target.toFixed(0)}°` : `${current}°`;
}

/** Isıtıcı hedefe ne kadar yaklaşmış? 0..1 */
export function heatRatio(reading: TempReading | null): number | null {
  if (!reading || reading.target <= 0) return null;
  return clamp01(reading.current / reading.target);
}

/** Bir baskıyı durdurmak/duraklatmak anlamlı mı? */
export function canCommand(state: PrinterState, command: PrinterCommand): boolean {
  if (command === 'pause') return state === 'printing';
  if (command === 'resume') return state === 'paused';
  return state === 'printing' || state === 'paused';
}

/** Baskıya gönderme sadece boştaki yazıcılarda mantıklı. */
export function canPrint(state: PrinterState): boolean {
  return state === 'idle' || state === 'unknown';
}
