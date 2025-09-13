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
  try {
    if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
      return { type: 'unknown', isCrossTab: false, confidence: 0 };
    }
    const first = rows[0];
    const keys = Object.keys(first);
    const hasCode = keys.includes('Code');
    const hasDesc = keys.includes('Description');
    const projectCols = keys.filter(k => k !== 'Code' && k !== 'Description');
    const projLike = projectCols.filter(isLikelyProjectColumnName);
    const projLikeRatio = projectCols.length ? (projLike.length / projectCols.length) : 0;

    // Heuristics: needs Code+Description, many project-like columns,
    // and the first data row (row 0) carries textual labels for those columns.
    const codeBlank = isBlank(first['Code']);
    const descBlank = isBlank(first['Description']);
    const labelRatio = nonNumericStringRatio(first, projLike);

    const isCross = hasCode && hasDesc && projectCols.length >= 5 && projLikeRatio >= 0.4 && codeBlank && descBlank && labelRatio >= 0.3;
    const confParts = [
      hasCode ? 0.2 : 0,
      hasDesc ? 0.2 : 0,
      Math.min(0.2, projLikeRatio * 0.2 / 0.6),
      codeBlank ? 0.2 : 0,
      descBlank ? 0.1 : 0,
      Math.min(0.1, labelRatio * 0.1 / 0.5)
    ];
    const confidence = confParts.reduce((a,b)=>a+b, 0);
    return {
      type: isCross ? 'cross-tab' : 'unknown',
      isCrossTab: isCross,
      confidence,
      headerRows: isCross ? 2 : 1,
      idCols: ['Code','Description'],
      projectCols: projLike
    };
  } catch (e) {
    return { type: 'unknown', isCrossTab: false, confidence: 0, error: String(e) };
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
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== 'object') {
    return { rows: [], columns: [] };
  }
  const det = detection || detectCrossTab(rows);

  const {
    idCols = ['Code','Description'],
    labelRowIndex = 0,
    dataStartRow = 1,
    excludeCols = [],
    includeCols = null
  } = options || {};

  // Determine base keys from the first parsed row
  const keys = Object.keys(rows[0] || {});

  // Resolve id columns by name
  const idSet = new Set(idCols.filter(k => keys.includes(k)));

  // Candidate project columns = keys - idCols
  let projectCols = keys.filter(k => !idSet.has(k));

  // Apply include/exclude
  if (Array.isArray(includeCols) && includeCols.length > 0) {
    const inc = new Set(includeCols);
    projectCols = projectCols.filter(c => inc.has(c));
  } else if (Array.isArray(excludeCols) && excludeCols.length > 0) {
    const exc = new Set(excludeCols);
    projectCols = projectCols.filter(c => !exc.has(c));
  }

  // Label row and data rows
  const safeLabelIdx = Math.max(0, Math.min(labelRowIndex, rows.length - 1));
  const labelRow = rows[safeLabelIdx] || {};
  const dataRows = rows.slice(Math.max(0, dataStartRow));

  const long = [];
  for (let ri = 0; ri < dataRows.length; ri++) {
    const r = dataRows[ri];
    const Code = r['Code'];
    const Description = r['Description'];

    for (const col of projectCols) {
      const ProjectId = col;
      const ProjectName = labelRow[col] ?? '';
      const raw = r[col];
      const n = toNum(raw);
      const Value = Number.isFinite(n) ? n : null;

      // Skip fully empty cells (but keep zeros)
      if (Value === null && (raw === undefined || String(raw).trim() === '')) continue;

      long.push({ Code, Description, ProjectId, ProjectName, Value, RawValue: raw });
    }
  }

  const columns = ['Code','Description','ProjectId','ProjectName','Value','RawValue'];
  return { rows: long, columns };
}