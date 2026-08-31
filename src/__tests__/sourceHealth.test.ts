import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kaynak dosyalarının sağlık kontrolü.
 *
 * Bu proje geliştirilirken birkaç kez şu hata yaşandı: dosyaya yazarken
 * `\b` gibi kaçış dizileri gerçek denetim karakterine (backspace, 0x08)
 * dönüştü. Sonuç sessizdi — kod derleniyor, tip denetimi geçiyor, ama
 * düzenli ifade hiçbir zaman eşleşmiyordu. Bu test o sınıf hatayı yakalar.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const SOURCE_DIRS = ['src', 'server', 'packaging'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js', '.css']);
const SKIP = new Set(['node_modules', 'dist', 'build', 'generated', 'target']);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => {
  const full = join(ROOT, dir);
  return statSync(full, { throwIfNoEntry: false }) ? collect(full) : [];
});

describe('kaynak dosya sağlığı', () => {
  it('taranacak dosya bulur', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('hiçbir dosyada denetim karakteri yok', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, index) => {
        for (const char of line) {
          const code = char.codePointAt(0) ?? 0;
          // Sekme dışındaki tüm C0 denetim karakterleri ve DEL şüphelidir.
          if ((code < 32 && code !== 9) || code === 127) {
            offenders.push(
              `${relative(ROOT, file)}:${index + 1} -> U+${code.toString(16).padStart(4, '0')}`,
            );
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('hiçbir dosyada düzensiz boşluk yok (NBSP, BOM)', () => {
    const offenders: string[] = [];
    const irregular = new Set([0x00a0, 0x202f, 0xfeff, 0x200b]);

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, index) => {
        for (const char of line) {
          if (irregular.has(char.codePointAt(0) ?? 0)) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
