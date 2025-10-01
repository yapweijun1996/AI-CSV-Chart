// Cross-tab detector and transformer (unpivot) for CSV datasets
// Produces canonical long format: { Code, Description, ProjectId, ProjectName, Value, RawValue } 

import { toNum } from './ai_chart_utils.js';

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === '';
}

function isLikelyProjectColumnName(name) {
  const s = String(name || '');
  return /^(?:\d{3,}|[A-Z][A-Z0-9_]+|Total)$/i.test(s);
}

function nonNumericStringRatio(obj, keys) {
  let count = 0, nonNumeric = 0;
  for (const k of keys) {
    if (!(k in obj)) continue;
    const v = obj[k];
    count++;
    const n = toNum(v);
    if (!Number.isFinite(n) && !isBlank(v)) nonNumeric++;
  }
  return count ? (nonNumeric / count) : 0;
}

export function detectCrossTab(rows) {
  // Safe no-op detector: always treat input as long format to disable cross-tab flow.
  try {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
      return { type: 'long', isCrossTab: false, confidence: 1, headerRows: 1, idCols: [], projectCols: [] };
    }
    const keys = Object.keys(rows[0] || {});
    const keyLowerMap = new Map(keys.map(k => [k.toLowerCase().trim(), k]));
    const idCols = [];
    if (keyLowerMap.get('code')) idCols.push(keyLowerMap.get('code'));
    if (keyLowerMap.get('description')) idCols.push(keyLowerMap.get('description'));
    return {
      type: 'long',
      isCrossTab: false,
      confidence: 1,
      headerRows: 1,
      idCols,
      projectCols: []
    };
  } catch (e) {
    return { type: 'long', isCrossTab: false, confidence: 1, headerRows: 1, idCols: [], projectCols: [], error: String(e) };
  }
}

/**
 * Convert detected cross-tab (wide) rows to canonical long format.
 * Options:
 *  - idCols: string[] column names to keep as identifiers (default ['Code','Description'])
 *  - labelRowIndex: number, which data row carries column labels for projects (default 0)
 *  - dataStartRow: number, index where actual data rows start (default 1)
 *  - excludeCols: string[] column names to exclude from project columns (e.g. ['Total','CORP_EC'])
 *  - includeCols: string[] column names to strictly include as project columns (takes precedence over excludeCols)
 */
export function convertCrossTabToLong(rows, detection = null, options = {}) {
  // Safe no-op converter: return input rows unchanged and infer columns from first row.
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
    return { rows: [], columns: [] };
  }
  const columns = Object.keys(rows[0] || {});
  return { rows, columns };
}