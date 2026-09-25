import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Store } from '../types';
import { isWarehouse } from '../utils/storeGroups';

/**
 * Выбор «Моего магазина» без обрезки названий.
 *
 * Родной <select> в узком сайдбаре (w-64) показывал выбранное значение в одну
 * строку и обрезал длинные названия («Екатеринбург (Елизаветинское шоссе)» →
 * «Екатеринбург (Елизавет…»). Здесь — кнопка с пол названием, которое
 * переносится на несколько строк, и выпадающий список, где названия тоже
 * читаются полностью.
 */
interface StorePickerProps {
  stores: Store[];
  /** '' = «Вся сеть (не выбран)» */
  value: string;
  onChange: (name: string) => void;
}

export const ALL_STORES_LABEL = 'Вся сеть (не выбран)';

function icon(name: string): string {
  if (!name) return '🌐';
  return isWarehouse(name) ? '📦' : '📍';
}

export function StorePicker({ stores, value, onChange }: StorePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = stores.find((s) => s.name === value);
  const label = selected ? selected.name : ALL_STORES_LABEL;

  // Клик снаружи и Escape закрывают список
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const options: { value: string; label: string }[] = [
    { value: '', label: ALL_STORES_LABEL },
    ...stores.map((s) => ({ value: s.name, label: s.name })),
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full mt-1 flex items-start gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-left cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="«Обзор» и «Инвентарь» откроются на этом магазине, «Перемещения» покажут только ваши входящие/исходящие. Выбор виден в адресе страницы (?scope=…), поэтому ссылку можно скопировать. Сам профиль «Мой магазин» хранится только на этом устройстве."
      >
        <span className="mt-px shrink-0 leading-snug">{icon(value)}</span>
        <span className="flex-1 break-words leading-snug text-gray-800">{label}</span>
        <ChevronDown
          className={`mt-0.5 w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Мой магазин"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value || '__all'} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => pick(opt.value)}
                  className={`w-full flex items-start gap-2 px-3 py-2 text-sm text-left break-words leading-snug transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="mt-px shrink-0">{icon(opt.value)}</span>
                  <span className="flex-1">{opt.label}</span>
                  {active && <Check className="mt-0.5 w-4 h-4 shrink-0 text-blue-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
