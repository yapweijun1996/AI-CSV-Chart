/**
 * CSV Parser Worker using PapaParse (self-hosted).
 * Avoids cross-origin worker issues by hosting on same origin.
 */
/* global self, Papa */

try {
  // Load PapaParse inside the worker scope; jsDelivr sends proper CORS headers
  const version = new URLSearchParams(self.location.search).get('v');
  const scriptUrl = version
    ? `https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js?v=${version}`
    : 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js';
  self.importScripts(scriptUrl);
} catch (e) {
  // importScripts errors are fatal for worker usage
  self.postMessage({ error: true, message: 'Failed to load PapaParse in worker: ' + (e.message || String(e)) });
}

// --- Start of aggregation logic ---

// Number parsing: handle commas, dots, percents, spaces
function parseCsvNumber(cell, { locale = 'en-US' } = {}) {
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

/* ========= ERP Metric Priority Logic ========= */
function getMetricPriority(columnName) {
  const name = String(columnName || '').toLowerCase();
  if (/\bamount\b|total.*amount|net.*amount|gross.*amount/.test(name)) return 1;
  if (/\bprice\b|unit.*price|selling.*price|cost.*price|retail.*price/.test(name)) return 2;
  if (/\bqty\b|\bquantity\b|units?|pieces?|count/.test(name)) return 3;
  if (/cost|value|sum|total|revenue|sales/.test(name)) return 4;
  return 5;
}

function selectBestMetricColumn(columns) {
  if (!columns || !columns.length) return null;
  const sortedColumns = columns.sort((a, b) => {
    const priorityA = getMetricPriority(a);
    const priorityB = getMetricPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    const aHasAmount = /amount/i.test(a);
    const bHasAmount = /amount/i.test(b);
    if (aHasAmount && !bHasAmount) return -1;
    if (bHasAmount && !aHasAmount) return 1;
    return a.localeCompare(b);
  });
  return sortedColumns[0];
}

/* ========= safer date parsing ========= */
function parseDateSafe(v, format = 'auto') {
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

function bucketDate(d, bucket){
  const t = parseDateSafe(d); if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth()+1, day = dt.getUTCDate();
  if (bucket==='year') return `${y}`;
  if (bucket==='quarter') return `${y}-Q${Math.floor((m-1)/3)+1}`;
  if (bucket==='month') return `${y}-${String(m).padStart(2,'0')}`;
  if (bucket==='week'){
    // Calculate ISO 8601 week number
    // Create a new date for the given date (to avoid modifying the original)
    const date = new Date(Date.UTC(y, m-1, day));
    
    // Set to nearest Thursday (current date + 4 - current day number)
    // Make Sunday's day number 7 (convert Sunday from 0 to 7)
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + (4 - dayNum));
    
    // Get first day of year
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    
    // Calculate full weeks to nearest Thursday
    const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    
    // Return week number in format YYYY-WXX
    return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
  }
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`; // day
}

let WORKER_PROFILE = null;
const toNum = v => parseCsvNumber(v);
const columnType = (name) => { const c = WORKER_PROFILE?.columns?.find(x=>x.name===name); return c ? c.type : 'string'; };

function normalizeGroupKey(v, type) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    if (/^(n\/a|na|unknown|null|-|none)$/i.test(s)) return null;
    return s;
  }
  if (type === 'date') {
    const d = parseDateSafe(v);
    return isNaN(d) ? null : new Date(d).toISOString().split('T')[0];
  }
  return v;
}
function groupAgg(rows, groupBy, metric, agg, dateBucket='', config = { filter: { mode: 'share', value: 0 } }){
  const m = new Map();
  const isDateCol = columnType(groupBy)==='date';
  const showMissing = !!config.showMissing;
  let missingCount = 0;

  for (const r of rows){
    let g = r[groupBy];
    if (isDateCol && dateBucket){
        const b = bucketDate(g, dateBucket);
        if (b === null) {
            missingCount++;
            if (!showMissing) continue;
        }
        g = b;
    }
    const key = normalizeGroupKey(g, isDateCol && !dateBucket ? 'date' : 'string');
    if (key === null) {
        missingCount++;
        if (!showMissing) continue;
    }
    const finalKey = key === null ? '(Missing)' : key;
    if (agg==='count'){
      if (!metric) {
        const numericCols = Object.keys(r).filter(col => { const val = r[col]; return val !== null && val !== '' && isFinite(toNum(val)); });
        const firstNumeric = selectBestMetricColumn(numericCols);
        if (firstNumeric) {
          const v = toNum(r[firstNumeric]);
          if (isFinite(v)){
            if (!m.has(finalKey)) m.set(finalKey, []);
            m.get(finalKey).push(v);
          }
        } else {
          m.set(finalKey, (m.get(finalKey)||0) + 1);
        }
      } else {
        m.set(finalKey, (m.get(finalKey)||0) + 1);
      }
    } else {
      const v = toNum(r[metric]);
      if (isFinite(v)){
        if (!m.has(finalKey)) m.set(finalKey, []);
        m.get(finalKey).push(v);
      }
    }
  }
  const out = [];
  for (const [k, arr] of m){
    let val = 0;
    if (agg==='count') {
      if (Array.isArray(arr)) {
        val = arr.reduce((a,b)=>a+b,0);
      } else {
        val = arr;
      }
    }
    else if (!arr.length) continue;
    else if (agg==='sum') val = arr.reduce((a,b)=>a+b,0);
    else if (agg==='avg') val = arr.reduce((a,b)=>a+b,0)/arr.length;
    else if (agg==='min') val = Math.min(...arr);
    else if (agg==='max') val = Math.max(...arr);
    else if (agg==='distinct_count') val = new Set(arr).size;
    out.push([k, val]);
  }
  if (isDateCol || dateBucket) {
    out.sort((a, b) => {
      const ak = String(a[0] ?? '');
      const bk = String(b[0] ?? '');
      if (dateBucket) {
        let dateA, dateB;
        if (dateBucket === 'year') { dateA = new Date(`${ak}-01-01`); dateB = new Date(`${bk}-01-01`); }
        else if (dateBucket === 'quarter') { const [, yA, qA] = ak.match(/^(\d+)-Q(\d)$/) || []; const [, yB, qB] = bk.match(/^(\d+)-Q(\d)$/) || []; if (yA && qA && yB && qB) { dateA = new Date(Date.UTC(+yA, (+qA - 1) * 3, 1)); dateB = new Date(Date.UTC(+yB, (+qB - 1) * 3, 1)); } else { return ak < bk ? -1 : ak > bk ? 1 : 0; } }
        else if (dateBucket === 'month') { const [, yA, mA] = ak.match(/^(\d+)-(\d{2})$/) || []; const [, yB, mB] = bk.match(/^(\d+)-(\d{2})$/) || []; if (yA && mA && yB && mB) { dateA = new Date(Date.UTC(+yA, +mA - 1, 1)); dateB = new Date(Date.UTC(+yB, +mB - 1, 1)); } else { return ak < bk ? -1 : ak > bk ? 1 : 0; } }
        else if (dateBucket === 'week') { const [, yA, wA] = ak.match(/^(\d+)-W(\d{2})$/) || []; const [, yB, wB] = bk.match(/^(\d+)-W(\d{2})$/) || []; if (yA && wA && yB && wB) { dateA = new Date(Date.UTC(+yA, 0, 4)); dateA.setDate(dateA.getDate() - ((dateA.getDay() + 6) % 7) + (+wA - 1) * 7); dateB = new Date(Date.UTC(+yB, 0, 4)); dateB.setDate(dateB.getDate() - ((dateB.getDay() + 6) % 7) + (+wB - 1) * 7); } else { return ak < bk ? -1 : ak > bk ? 1 : 0; } }
        else { const pA = ak.split('-'); const pB = bk.split('-'); if (pA.length === 3 && pB.length === 3) { dateA = new Date(Date.UTC(+pA[0], +pA[1] - 1, +pA[2])); dateB = new Date(Date.UTC(+pB[0], +pB[1] - 1, +pB[2])); } else { return ak < bk ? -1 : ak > bk ? 1 : 0; } }
        if (dateA && dateB) { return dateA.getTime() - dateB.getTime(); } else { return ak < bk ? -1 : ak > bk ? 1 : 0; }
      } else {
        const dateA = parseDateSafe(ak); const dateB = parseDateSafe(bk);
        if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) { return dateA - dateB; } else { return ak < bk ? -1 : ak > bk ? 1 : 0; }
      }
    });
  } else {
    out.sort((a,b)=> (Number(b[1]||0) - Number(a[1]||0)));
  }
  let headerAgg;
  if (agg === 'count' && !metric) {
    const firstRow = rows.length > 0 ? rows[0] : {};
    const numericCols = Object.keys(firstRow).filter(col => { const val = firstRow[col]; return val !== null && val !== '' && isFinite(toNum(val)); });
    const detectedMetric = selectBestMetricColumn(numericCols);
    if (detectedMetric) { headerAgg = `sum(${detectedMetric})`; } else { headerAgg = 'count(*)'; }
  } else {
    if (!metric && agg === 'sum') {
      const firstRow = rows.length > 0 ? rows[0] : {};
      const numericCols = Object.keys(firstRow).filter(col => { const val = firstRow[col]; return val !== null && val !== '' && isFinite(toNum(val)); });
      const bestMetric = selectBestMetricColumn(numericCols);
      headerAgg = bestMetric ? `sum(${bestMetric})` : 'sum(amount)';
    } else {
      headerAgg = `${agg}(${metric||'amount'})`;
    }
  }
  const totalSum = out.reduce((sum, row) => sum + (row[1] || 0), 0);
  const filterConfig = config.filter || { mode: 'share', value: 0 };
  let filteredOut = out;
  let removedRows = [];

  if (filterConfig && filterConfig.value > 0) {
    if (filterConfig.mode === 'share') {
      const minGroupShare = filterConfig.value;
      filteredOut = out.filter(row => (row[1] / (totalSum || 1)) >= minGroupShare);
      removedRows = out.filter(row => (row[1] / (totalSum || 1)) < minGroupShare);
    } else if (filterConfig.mode === 'value') {
      const minValue = filterConfig.value;
      filteredOut = out.filter(row => row[1] >= minValue);
      removedRows = out.filter(row => row[1] < minValue);
    }
  }

  // Compute missingSum in worker as well to match main thread transparency
  // We recompute it here similarly to the main thread logic for parity
  let missingSum = 0;
  const metricForMissing = (row) => {
    if (agg === 'sum' || (agg === 'count' && !metric)) {
      if (!metric) {
        const numericCols = Object.keys(row).filter(col => {
          const val = row[col];
          return val !== null && val !== '' && isFinite(toNum(val));
        });
        const firstNumeric = selectBestMetricColumn(numericCols);
        if (firstNumeric) return toNum(row[firstNumeric]);
        return NaN;
      } else {
        return toNum(row[metric]);
      }
    } else if (agg === 'avg' || agg === 'min' || agg === 'max') {
      return toNum(row[metric]);
    }
    return NaN;
  };

  // Calculate raw data sum from all rows before any processing
  let rawDataSum = 0;
  for (const r of rows) {
    const v = metricForMissing(r);
    if (isFinite(v)) rawDataSum += v;
  }

  // Recompute missingSum by scanning raw rows; independent of visibility
  for (const r of rows) {
    let g = r[groupBy];
    if (isDateCol && dateBucket) {
      const b = bucketDate(g, dateBucket);
      if (b === null) {
        // bucket produced null => missing
        const v = metricForMissing(r);
        if (isFinite(v)) missingSum += v;
        // even if showMissing2 is true, this still contributes to missingSum;
        // counting missingSum is independent of visibility
        continue;
      }
      g = b;
    }
    const key = normalizeGroupKey(g, isDateCol && !dateBucket ? 'date' : 'string');
    if (key === null) {
      const v = metricForMissing(r);
      if (isFinite(v)) missingSum += v;
      // visibility controlled elsewhere; we always include in missingSum
      continue;
    }
  }

  return {
    header:[isDateCol && dateBucket ? `${groupBy} (${dateBucket})` : groupBy, headerAgg],
    rows: filteredOut,
    missingCount,
    totalSum,
    missingSum,
    rawDataSum,
    rawRowsCount: rows.length,
    groupsBeforeFilter: out.length,
    removedRows
  };
}

function aggregateForCharts(rows, profile, plan, config = {}) {
  WORKER_PROFILE = profile;
  if (!plan || !Array.isArray(plan.jobs)) {
    throw new Error('Invalid aggregation plan provided to worker.');
  }
  const aggregates = plan.jobs.map(j => groupAgg(rows, j.groupBy, j.metric, j.agg, j.dateBucket||'', config));
  return aggregates;
}

// --- End of aggregation logic ---

// --- CSV type detection and preview helpers ---
function isBlankWorker(v) {
  return v === null || v === undefined || String(v).trim() === '';
}
function isLikelyProjectColumnNameWorker(name) {
  const s = String(name || '');
  return /^(?:\d{3,}|[A-Z][A-Z0-9_]+|Total)$/i.test(s);
}
function nonNumericStringRatioWorker(obj, keys) {
  if (!obj || typeof obj !== 'object') return 0;
  let count = 0, nonNumeric = 0;
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = obj[k];
    count++;
    const n = parseCsvNumber(v);
    if (!Number.isFinite(n) && !isBlankWorker(v)) nonNumeric++;
  }
  return count ? (nonNumeric / count) : 0;
}
/**
 * Heuristic CSV type detection on parsed rows (object rows expected when header=true).
 * Returns:
 * { type: 'long'|'cross-tab'|'unknown', isCrossTab, confidence, headerRows, idCols, dataStartRow, projectCols }
 */
function detectCSVType(rows) {
  try {
    if (!Array.isArray(rows) || !rows.length) {
      return { type: 'unknown', isCrossTab: false, confidence: 0, headerRows: 1, idCols: [], dataStartRow: 0, projectCols: [] };
    }
    const r0 = rows[0];
    if (!r0 || typeof r0 !== 'object') {
      return { type: 'unknown', isCrossTab: false, confidence: 0, headerRows: 1, idCols: [], dataStartRow: 0, projectCols: [] };
    }
    const keys = Object.keys(r0);
    const hasCode = keys.includes('Code');
    const hasDesc = keys.includes('Description');
    const idCols = [];
    if (hasCode) idCols.push('Code');
    if (hasDesc) idCols.push('Description');

    // Consider all non-id columns as potential project columns
    const projectCandidates = keys.filter(k => !idCols.includes(k));
    const projLike = projectCandidates.filter(isLikelyProjectColumnNameWorker);
    const projLikeRatio = projectCandidates.length ? (projLike.length / projectCandidates.length) : 0;

    // Cross-tab heuristic: first data row carries textual labels in project columns,
    // while id columns in first row are blank (double-header pattern).
    const codeBlank = hasCode ? isBlankWorker(r0['Code']) : false;
    const descBlank = hasDesc ? isBlankWorker(r0['Description']) : false;
    const labelRatio = nonNumericStringRatioWorker(r0, projLike);

    const isCross =
      hasCode && hasDesc &&
      projectCandidates.length >= 5 &&
      projLikeRatio >= 0.4 &&
      codeBlank && descBlank &&
      labelRatio >= 0.3;

    const confParts = [
      hasCode ? 0.2 : 0,
      hasDesc ? 0.2 : 0,
      Math.min(0.2, projLikeRatio * 0.2 / 0.6),
      codeBlank ? 0.2 : 0,
      descBlank ? 0.1 : 0,
      Math.min(0.1, labelRatio * 0.1 / 0.5)
    ];
    const confidence = confParts.reduce((a,b)=>a+b, 0);

    if (isCross) {
      return {
        type: 'cross-tab',
        isCrossTab: true,
        confidence,
        headerRows: 2,
        idCols: ['Code', 'Description'],
        dataStartRow: 1, // after label row (row 0)
        projectCols: projLike
      };
    }

    // Attempt to classify as long if we have a canonical long schema subset
    const hasLongCore = ['Code','Description'].every(k => keys.includes(k))
                      && (keys.includes('Value') || keys.some(k => /amount|total|value|sales|revenue/i.test(k)));
    if (hasLongCore) {
      return {
        type: 'long',
        isCrossTab: false,
        confidence: Math.max(0.4, confidence), // bump a bit if it looks structured
        headerRows: 1,
        idCols: ['Code','Description'].filter(k => keys.includes(k)),
        dataStartRow: 0,
        projectCols: []
      };
    }

    return {
      type: 'unknown',
      isCrossTab: false,
      confidence,
      headerRows: 1,
      idCols,
      dataStartRow: 0,
      projectCols: []
    };
  } catch (e) {
    return { type: 'unknown', isCrossTab: false, confidence: 0, headerRows: 1, idCols: [], dataStartRow: 0, projectCols: [], error: String(e) };
  }
}

function buildPreview(rows, limit = 20) {
  try {
    if (!Array.isArray(rows) || !rows.length) {
      return { columns: [], sample: [], rowCount: 0 };
    }
    const first = rows[0];
    const columns = typeof first === 'object' && first !== null ? Object.keys(first) : [];
    const n = Math.min(limit, rows.length);
    const sample = rows.slice(0, n).map(r => {
      if (typeof r !== 'object' || r === null) return r;
      const o = {};
      for (const c of columns) o[c] = r[c];
      return o;
    });
    return { columns, sample, rowCount: rows.length };
  } catch (e) {
    return { columns: [], sample: [], rowCount: 0, error: String(e) };
  }
}

self.onmessage = function(event){
  try {
    const payload = event.data || {};

    // Route message to either parser or aggregator
    if (payload.action === 'aggregate') {
      try {
        const result = aggregateForCharts(payload.rows, payload.profile, payload.plan, payload.config);
        self.postMessage({ error: false, aggregated: result });
      } catch (e) {
        self.postMessage({ error: true, message: 'Aggregation error in worker: ' + (e.message || String(e)) });
      }
      return;
    }

    // Default action is parsing
    const file = payload.file;
    const cfg = payload.config || {};
    if (!file) {
      self.postMessage({ error: true, message: 'No file received by worker' });
      return;
    }
    if (typeof Papa === 'undefined') {
      self.postMessage({ error: true, message: 'PapaParse not available in worker' });
      return;
    }

    const collectedRows = [];
    const workerConfig = {
      header: !!cfg.header,
      skipEmptyLines: cfg.skipEmptyLines || 'greedy',
      dynamicTyping: !!cfg.dynamicTyping,
      delimiter: cfg.delimiter || ',',
      quoteChar: cfg.quoteChar || '"',
      escapeChar: cfg.escapeChar || '"',
      step: (results)=>{
        if (results && 'data' in results) collectedRows.push(results.data);
      },
      complete: (results)=>{
        try{
          const meta = results && results.meta ? results.meta : {};
          const errors = results && Array.isArray(results.errors) ? results.errors : [];
          const data = (results && Array.isArray(results.data) && results.data.length) ? results.data : collectedRows;
 
          // Compute detection + preview safely (object rows expected when header=true)
          let detectionResult = null;
          try {
            detectionResult = detectCSVType(data);
          } catch (e) {
            detectionResult = { type: 'unknown', isCrossTab: false, confidence: 0, headerRows: 1, idCols: [], dataStartRow: 0, projectCols: [], error: String(e) };
          }
          let preview = null;
          try {
            preview = buildPreview(data, 20);
          } catch (e) {
            preview = { columns: [], sample: [], rowCount: Array.isArray(data)?data.length:0, error: String(e) };
          }
 
          self.postMessage({ error:false, data, meta, errors, detectionResult, preview });
        }catch(err){
          self.postMessage({ error:true, message: 'Worker complete handler error: ' + (err.message || String(err)) });
        }
      },
      error: (err, f, inputElem, reason)=>{
        self.postMessage({ error:true, message: (err && err.message) || reason || 'Unknown parse error in worker' });
      }
    };

    Papa.parse(file, workerConfig);
  } catch (e) {
    self.postMessage({ error: true, message: 'Worker runtime error: ' + (e.message || String(e)) });
  }
};