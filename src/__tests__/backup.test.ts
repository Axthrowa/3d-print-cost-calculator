import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  createSnapshot,
  isBackupDue,
  isSameContent,
  parseSnapshot,
  rotate,
  summarize,
} from '../lib/backup';
import { DEFAULT_DATA, type AppData } from '../lib/storage';

const data = (over: Partial<AppData> = {}): AppData => ({ ...DEFAULT_DATA, ...over });

const spool = {
  id: 's1',
  brand: 'Porima',
  material: 'PLA' as const,
  color: 'Siyah',
  rollPrice: 600,
  rollWeight: 1000,
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('createSnapshot / summarize', () => {
  it('anlık görüntü biçimi doğrudur', () => {
    const snap = createSnapshot(data(), '1.4.0', '2026-08-29T12:00:00.000Z');
    expect(snap.format).toBe(BACKUP_FORMAT);
    expect(snap.version).toBe(BACKUP_VERSION);
    expect(snap.app).toBe('1.4.0');
    expect(snap.createdAt).toBe('2026-08-29T12:00:00.000Z');
  });

  it('içeriği sayar', () => {
    const snap = createSnapshot(
      data({
        spools: [spool],
        catalog: [
          {
            id: 'p1',
            name: 'Vazo',
            notes: '',
            source: 'gcode',
            printSeconds: 3600,
            tools: [],
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
      }),
      '1.4.0',
      '2026-08-29T12:00:00.000Z',
    );
    const s = summarize(snap);
    expect(s.spools).toBe(1);
    expect(s.catalog).toBe(1);
    expect(s.orders).toBe(0);
    expect(s.total).toBe(2);
  });

  it('boş veride toplam sıfırdır', () => {
    expect(summarize(createSnapshot(data(), '1.4.0', '2026-08-29T12:00:00.000Z')).total).toBe(0);
  });
});

describe('parseSnapshot', () => {
  const valid = JSON.stringify(
    createSnapshot(data({ spools: [spool] }), '1.4.0', '2026-08-29T12:00:00.000Z'),
  );

  it('geçerli yedeği kabul eder', () => {
    const result = parseSnapshot(valid);
    expect(result.ok).toBe(true);
    expect(result.snapshot?.data.spools).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('bozuk JSON reddedilir', () => {
    const result = parseSnapshot('{bu json degil');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('JSON');
  });

  it('başka uygulamanın dosyası reddedilir', () => {
    const result = parseSnapshot(JSON.stringify({ format: 'baska-uygulama', data: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('bu uygulamanın yedeği değil');
  });

  it('daha yeni sürümün yedeği reddedilir', () => {
    const result = parseSnapshot(JSON.stringify({ format: BACKUP_FORMAT, version: 99, data: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('daha yeni');
  });

  it('veri bölümü yoksa reddedilir', () => {
    const result = parseSnapshot(JSON.stringify({ format: BACKUP_FORMAT, version: 1 }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('veri bölümü');
  });

  it('boş metin ve saçma girdide çökmez', () => {
    expect(parseSnapshot('').ok).toBe(false);
    expect(parseSnapshot('null').ok).toBe(false);
    expect(parseSnapshot('[]').ok).toBe(false);
  });
});

describe('backupFileName', () => {
  it('tarihli ad üretir', () => {
    const name = backupFileName('2026-08-29T12:00:00.000Z');
    expect(name).toMatch(/^yedek-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  });

  it('adlar kronolojik sıralanır', () => {
    const a = backupFileName('2026-08-29T10:00:00.000Z');
    const b = backupFileName('2026-08-29T11:00:00.000Z');
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe('rotate', () => {
  const names = [
    'yedek-2026-08-01-100000.json',
    'yedek-2026-08-03-100000.json',
    'yedek-2026-08-02-100000.json',
  ];

  it('en yenileri tutar', () => {
    const { keep, drop } = rotate(names, 2);
    expect(keep).toEqual(['yedek-2026-08-03-100000.json', 'yedek-2026-08-02-100000.json']);
    expect(drop).toEqual(['yedek-2026-08-01-100000.json']);
  });

  it('sınırın altındaysa hiçbirini atmaz', () => {
    expect(rotate(names, 10).drop).toEqual([]);
  });

  it('boş listede çökmez', () => {
    expect(rotate([], 5)).toEqual({ keep: [], drop: [] });
  });
});

describe('isBackupDue', () => {
  const NOW = Date.parse('2026-08-29T12:00:00.000Z');

  it('veri yoksa yedek almaz', () => {
    expect(isBackupDue(null, 30, NOW, false)).toBe(false);
  });

  it('hiç yedek yoksa hemen alır', () => {
    expect(isBackupDue(null, 30, NOW, true)).toBe(true);
  });

  it('süre dolmadan almaz', () => {
    const recent = new Date(NOW - 10 * 60_000).toISOString();
    expect(isBackupDue(recent, 30, NOW, true)).toBe(false);
  });

  it('süre dolunca alır', () => {
    const old = new Date(NOW - 31 * 60_000).toISOString();
    expect(isBackupDue(old, 30, NOW, true)).toBe(true);
  });

  it('bozuk tarihte alır', () => {
    expect(isBackupDue('gecersiz', 30, NOW, true)).toBe(true);
  });
});

describe('isSameContent', () => {
  it('aynı veriyi yakalar (gereksiz yedeği önler)', () => {
    expect(isSameContent(data({ spools: [spool] }), data({ spools: [spool] }))).toBe(true);
  });

  it('farkı görür', () => {
    expect(isSameContent(data({ spools: [spool] }), data())).toBe(false);
    expect(isSameContent(data(), null)).toBe(false);
  });
});
