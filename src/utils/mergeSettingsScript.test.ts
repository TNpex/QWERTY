import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeSettings, parseSettings, type ProductSettings } from './settings';

/**
 * Скрипт админа `npm run merge-settings` обязан сливать настройки ТОЧНО так же,
 * как приложение при импорте файла (mergeSettings) — иначе общий
 * product-settings.json и локальные настройки разъезжались бы.
 */
function run(args: string[]): string {
  return execFileSync(process.execPath, [join('scripts', 'merge-settings.mjs'), ...args], {
    encoding: 'utf-8',
  });
}

describe('scripts/merge-settings.mjs', () => {
  it('сливает профиль одного магазина в общий файл, не затирая остальное', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-settings-'));
    const target = join(dir, 'product-settings.json');
    const incoming = join(dir, 'store.json');
    try {
      writeFileSync(
        target,
        JSON.stringify({
          sportOverrides: { 'ts76-bkwh': 'tennis' },
          excludedProducts: { 'услуга-1': 'услуга' },
          suppliedProducts: { 'ts76-bkwh': true },
          hotProducts: {},
          storeMinimums: { Уфа: { 'nt76-4104': 2 }, Ижевск: { k: 3 } },
          storeProfiles: {
            Уфа: { sport: 'padel', hiddenCategories: ['Струны'], bannedProducts: { 'старый': true }, note: '' },
          },
        })
      );
      // профиль Елизаветинского шоссе, скачанный на сайте кнопкой «Профиль магазина (JSON)»
      writeFileSync(
        incoming,
        JSON.stringify({
          sportOverrides: {},
          excludedProducts: {},
          suppliedProducts: {},
          hotProducts: {},
          storeMinimums: { 'Екатеринбург (Елизаветинское шоссе)': { 'nt76-4104': 4 } },
          storeProfiles: {
            'Екатеринбург (Елизаветинское шоссе)': {
              sport: 'all',
              hiddenCategories: ['Теннисные струны'],
              transfersDisabled: false,
              defaultMinimum: 2,
              bannedProducts: { 'nt76-4104': true },
              note: 'точка в ТЦ',
            },
          },
        })
      );

      const out = join(dir, 'out.json');
      const log = run([incoming, '--base', target, '--out', out]);
      expect(log).toContain('✅ Записано');

      const merged = parseSettings(readFileSync(out, 'utf-8')) as ProductSettings;
      // чужие настройки не пострадали
      expect(merged.sportOverrides).toEqual({ 'ts76-bkwh': 'tennis' });
      expect(merged.excludedProducts).toEqual({ 'услуга-1': 'услуга' });
      expect(merged.suppliedProducts).toEqual({ 'ts76-bkwh': true });
      // профиль Уфы остался, профиль новой точки добавился
      expect(merged.storeProfiles['Уфа'].sport).toBe('padel');
      expect(merged.storeProfiles['Екатеринбург (Елизаветинское шоссе)'].bannedProducts).toEqual({
        'nt76-4104': true,
      });
      // минимумы чужих магазинов не тронуты
      expect(merged.storeMinimums['Ижевск']).toEqual({ k: 3 });
      expect(merged.storeMinimums['Екатеринбург (Елизаветинское шоссе)']).toEqual({ 'nt76-4104': 4 });

      // и главное: результат скрипта = результат mergeSettings в приложении
      const expected = mergeSettings(
        parseSettings(readFileSync(target, 'utf-8')) as ProductSettings,
        parseSettings(readFileSync(incoming, 'utf-8')) as ProductSettings
      );
      expect(merged).toEqual(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('магазин, описанный во входящем файле, заменяет свой профиль и минимумы целиком', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-settings-'));
    const target = join(dir, 'target.json');
    const incoming = join(dir, 'ufa.json');
    try {
      writeFileSync(
        target,
        JSON.stringify({
          storeMinimums: { Уфа: { a: 3, b: 2 } },
          storeProfiles: { Уфа: { bannedProducts: { 'старый-запрет': true }, note: 'было' } },
        })
      );
      writeFileSync(
        incoming,
        JSON.stringify({
          storeMinimums: { Уфа: { a: 5 } },
          storeProfiles: { Уфа: { sport: 'padel', bannedProducts: {} } },
        })
      );
      const out = join(dir, 'out.json');
      run([incoming, '--base', target, '--out', out]);
      const merged = parseSettings(readFileSync(out, 'utf-8')) as ProductSettings;
      // снятый магазином запрет не воскрес, лишние минимумы не остались
      expect(merged.storeProfiles['Уфа'].bannedProducts).toEqual({});
      expect(merged.storeProfiles['Уфа'].sport).toBe('padel');
      expect(merged.storeMinimums['Уфа']).toEqual({ a: 5 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--dry ничего не записывает, битый JSON — ошибка', () => {
    const dir = mkdtempSync(join(tmpdir(), 'merge-settings-'));
    try {
      const incoming = join(dir, 'in.json');
      writeFileSync(incoming, JSON.stringify({ storeProfiles: { Уфа: { sport: 'padel' } } }));
      const out = join(dir, 'out.json');
      const log = run([incoming, '--base', join(dir, 'нет-такого.json'), '--out', out, '--dry']);
      expect(log).toContain('--dry: файл не записан');
      expect(() => readFileSync(out, 'utf-8')).toThrow();

      writeFileSync(incoming, '{ это не json');
      expect(() => run([incoming, '--base', join(dir, 'нет-такого.json'), '--out', out])).toThrow(/не JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
