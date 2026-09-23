/**
 * CSV-парсер с автоопределением разделителя и полной поддержкой кавычек (RFC 4180).
 *
 * Решает проблемы наивного split(','):
 * - русский Excel сохраняет CSV с разделителем ';' — разделитель определяется автоматически;
 * - поля в кавычках могут содержать разделитель, переводы строк и экранированные кавычки ("");
 * - поддерживаются переносы \r\n (Windows), \n (Unix) и BOM (UTF-8).
 */

const DELIMITER_CANDIDATES = [',', ';', '\t', '|'];

/** Считает вхождения разделителя вне кавычек */
function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') i++; // экранированная кавычка
        else inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      count++;
    }
  }
  return count;
}

/** Автоопределение разделителя по первой строке файла */
export function sniffDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITER_CANDIDATES) {
    const count = countDelimiterOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * Разбирает текст с разделителями в массив строк-массивов ячеек.
 * Корректно обрабатывает кавычки, экранирование "" и любые переносы строк.
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^\uFEFF/, ''); // убираем BOM
  const firstLine = clean.split(/\r\n|\n|\r/, 1)[0] ?? '';
  const delim = delimiter ?? sniffDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    field = '';
    // Пропускаем полностью пустые строки
    if (row.length > 1 || row[0].trim() !== '') rows.push(row);
    row = [];
  };

  while (i < clean.length) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++; // \r\n
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Хвост файла без завершающего перевода строки
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/**
 * Парсит CSV-текст в массив объектов «заголовок колонки → значение».
 * Пустые строки и строки без единого значения пропускаются.
 */
export function parseCSVText(text: string): Record<string, string>[] {
  const rows = parseDelimited(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const result: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      const value = (cells[idx] ?? '').trim();
      if (value !== '') hasValue = true;
      obj[header] = value;
    });
    if (hasValue) result.push(obj);
  }
  return result;
}
