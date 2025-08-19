// Number parsing: handle commas, dots, percents, spaces
export function parseCsvNumber(cell, { locale = 'en-US' } = {}) {
  if (cell === null || cell === undefined) return NaN;
  let s = String(cell).trim();
  if (s === '') return NaN;

  const isPercent = s.endsWith('%');
  if (isPercent) {
    s = s.slice(0, -1).trim();
  }

  // 1) Remove leading spreadsheet text marker (single quote)
  let CLEAN_LEADING_APOSTROPHE = true;
  if (CLEAN_LEADING_APOSTROPHE) {
    // Remove zero-width and BOM-like chars then any leading apostrophes (ASCII + common Unicode variants)
    s = s.replace(/^[\u200B-\u200D\uFEFF\u00A0]*/,''); // strip invisible leading chars
    s = s.replace(/^[\'\u2018\u2019\u201B]+/, '');     // strip any leading apostrophe variants
    // Normalize unicode minus (U+2212) to ASCII minus
    s = s.replace(/\u2212/g, '-');
  }

  // 2) Remove surrounding quotes (CSV may give quoted string)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }

  // 3) Handle parentheses as negative numbers: "(1,000)" => -1000
  const parenMatch = s.match(/^\((.*)\)$/);
  if (parenMatch) {
    s = '-' + parenMatch[1];
  }

  // 4) Remove currency symbols and spaces (expand this list as needed)
  s = s.replace(/[$£¥€\s]/g, '');

  // 5) Locale handling:
  // - For en-US style: thousands separator = ',', decimal = '.'
  // - For many European locales: thousands = '.', decimal = ','
  if (locale === 'eu') {
    // common heuristic: if there is a comma and dot, determine which is decimal
    if (/[.,]/.test(s)) {
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      if (lastComma > lastDot) {
        // comma likely decimal separator: remove dots (thousands), replace comma with dot
        s = s.replace(/\./g, '').replace(/,/g, '.');
      } else if (lastDot > lastComma) {
        // dot likely decimal: remove commas
        s = s.replace(/,/g, '');
      } else {
        // only commas or only dots
        if (s.includes(',')) {
          s = s.replace(/\./g, '').replace(/,/g, '.');
        } else {
          s = s.replace(/,/g, '');
        }
      }
    }
  } else {
    // default en-US style — remove commas used as thousands separators
    s = s.replace(/,/g, '');
  }

  // 6) Validate numeric token without stripping letters (preserve codes like 'SGD'/'A25992')
  // Require at least one digit; if any disallowed chars remain (letters other than exponent markers, symbols), treat as non-numeric
  if (!/\d/.test(s)) return NaN;
  if (/[^0-9\-\.\+eE]/.test(s)) return NaN;

  // 7) Parse
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;

  return isPercent ? n / 100 : n;
}
export const isNum = v => { const n = parseCsvNumber(v); return !Number.isNaN(n) && isFinite(n); };
export const toNum = v => parseCsvNumber(v);

/* ========= safer date parsing ========= */
export function parseDateSafe(v, format = 'auto') {
  if (!v) return NaN;
  let s = String(v).trim();

  // Normalize separators: hyphens and dots to slashes
  s = s.replace(/[-.]/g, '/');

  let day, month, year;

  // ISO format (YYYY/MM/DD)
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
    const parts = s.split('/');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    const parts = s.split('/');
    if (parts.length === 3) {
      let p1 = parseInt(parts[0], 10);
      let p2 = parseInt(parts[1], 10);
      let p3 = parseInt(parts[2], 10);

      // Handle 2-digit year
      if (p3 < 100) {
        p3 = p3 < 50 ? 2000 + p3 : 1900 + p3;
      }
      year = p3;

      if (format === 'dd/mm/yyyy') {
        day = p1;
        month = p2;
      } else if (format === 'mm/dd/yyyy') {
        month = p1;
        day = p2;
      } else { // auto-detect
        if (p1 > 12) { // First part is likely day
          day = p1;
          month = p2;
        } else if (p2 > 12) { // Second part is likely day
          day = p2;
          month = p1;
        } else { // Ambiguous, default to dd/mm/yyyy
          day = p1;
          month = p2;
        }
      }
    }
  }

  if (year && month && day && !isNaN(year) && !isNaN(month) && !isNaN(day)) {
    // Basic validation
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return NaN;
    }
    return Date.UTC(year, month - 1, day);
  }

  // Fallback to Date.parse for other formats
  const u = Date.parse(v); // Use original string for Date.parse
  return isNaN(u) ? NaN : u;
}