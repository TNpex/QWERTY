import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorePicker, ALL_STORES_LABEL } from './StorePicker';
import type { Store } from '../types';

const stores: Store[] = [
  { id: '1', name: 'Екатеринбург (Елизаветинское шоссе)' },
  { id: '2', name: 'Екатеринбург (Основной склад)' },
  { id: '3', name: 'Санкт-Петербург (Ярослава Гашека)' },
  { id: '4', name: 'Уфа' },
];

function render(value: string): string {
  return renderToStaticMarkup(
    createElement(StorePicker, { stores, value, onChange: () => {} })
  );
}

describe('StorePicker — название магазина читается полностью', () => {
  it('длинное название видно целиком (не обрезается, как в родном <select>)', () => {
    const html = render('Екатеринбург (Елизаветинское шоссе)');
    expect(html).toContain('Екатеринбург (Елизаветинское шоссе)');
    // никаких truncate/nowrap, которые резали бы текст
    expect(html).not.toContain('truncate');
    expect(html).toContain('break-words');
  });

  it('склад помечен 📦, обычный магазин — 📍', () => {
    expect(render('Екатеринбург (Основной склад)')).toContain('📦');
    expect(render('Уфа')).toContain('📍');
  });

  it('пустое значение — «Вся сеть (не выбран)» с 🌐', () => {
    const html = render('');
    expect(html).toContain(ALL_STORES_LABEL);
    expect(html).toContain('🌐');
  });

  it('неизвестное имя тоже показывается как «Вся сеть»', () => {
    expect(render('Такого магазина нет')).toContain(ALL_STORES_LABEL);
  });

  it('кнопка-раскрывашка доступна (aria-haspopup / aria-expanded)', () => {
    const html = render('Уфа');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
  });
});
