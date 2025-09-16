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
    const keyLowerMap = new Map(keys.map(k => [k.toLowerCase().trim(), k]));
    const codeKey = keyLowerMap.get('code');
    const descKey = keyLowerMap.get('description');

    const hasCode = !!codeKey;
    const hasDesc = !!descKey;

    // Candidate project columns = keys - idCols (case-insensitive)
    const projectCols = keys.filter(k => {
      const lk = k.toLowerCase().trim();
      return lk !== 'code' && lk !== 'description';
    });
    const projLike = projectCols.filter(isLikelyProjectColumnName);
    const projLikeRatio = projectCols.length ? (projLike.length / projectCols.length) : 0;

    // Heuristics: first data row carries textual labels in project columns,
    // while id columns in first row are blank (double-header pattern).
    const codeBlank = hasCode ? isBlank(first[codeKey]) : false;
    const descBlank = hasDesc ? isBlank(first[descKey]) : false;
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

    const idCols = [];
    if (codeKey) idCols.push(codeKey);
    if (descKey) idCols.push(descKey);

    return {
      type: isCross ? 'cross-tab' : 'unknown',
      isCrossTab: isCross,
      confidence,
      headerRows: isCross ? 2 : 1,
      idCols,
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

  let {
    idCols = ['Code','Description'],
    labelRowIndex = 0,
    dataStartRow = 1,
    excludeCols = [],
    includeCols = null
  } = options || {};

  // Determine base keys and build case-insensitive map
  const keys = Object.keys(rows[0] || {});
  const keyLowerMap = new Map(keys.map(k => [k.toLowerCase().trim(), k]));

  // Resolve id columns: prefer detection.idCols (actual keys), else map options.idCols case-insensitively
  let resolvedIdCols = Array.isArray(det?.idCols) && det.idCols.length
    ? det.idCols.map(k => keyLowerMap.get(String(k).toLowerCase().trim()) || k).filter(Boolean)
    : idCols.map(k => keyLowerMap.get(String(k).toLowerCase().trim()) || k).filter(Boolean);

  // Fallback if still empty
  if (!resolvedIdCols.length) {
    if (keyLowerMap.get('code')) resolvedIdCols.push(keyLowerMap.get('code'));
    if (keyLowerMap.get('description')) resolvedIdCols.push(keyLowerMap.get('description'));
  }

  // Candidate project columns = keys - resolvedIdCols
  const idLowerSet = new Set(resolvedIdCols.map(x => String(x).toLowerCase().trim()));
  let projectCols = keys.filter(k => !idLowerSet.has(String(k).toLowerCase().trim()));

  // Apply include/exclude (case-insensitive)
  if (Array.isArray(includeCols) && includeCols.length > 0) {
    const inc = new Set(includeCols.map(x => String(x).toLowerCase().trim()));
    projectCols = projectCols.filter(c => inc.has(c.toLowerCase().trim()));
  } else if (Array.isArray(excludeCols) && excludeCols.length > 0) {
    const exc = new Set(excludeCols.map(x => String(x).toLowerCase().trim()));
    projectCols = projectCols.filter(c => !exc.has(c.toLowerCase().trim()));
  }

  // Label row and data rows
  const safeLabelIdx = Math.max(0, Math.min(labelRowIndex, rows.length - 1));
  const labelRow = rows[safeLabelIdx] || {};
  const dataRows = rows.slice(Math.max(0, dataStartRow));

  const long = [];
  for (const r of dataRows) {
    const Code = resolvedIdCols[0]
      ? r[resolvedIdCols[0]]
      : (keyLowerMap.get('code') ? r[keyLowerMap.get('code')] : r['Code']);
    const Description = resolvedIdCols[1]
      ? r[resolvedIdCols[1]]
      : (keyLowerMap.get('description') ? r[keyLowerMap.get('description')] : r['Description']);

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