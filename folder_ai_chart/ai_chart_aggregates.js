/**
 * ai_chart_aggregates.js
 * 
 * Core aggregation, chart configuration, and table rendering functionality
 * extracted from index.html inline script.
 * 
 * Exports:
 * - groupAgg: Core aggregation function
 * - bucketDate: Date bucketing helper
 * - normalizeGroupKey: Group key normalization
 * - computeChartConfig: Chart.js configuration builder
 * - ensureChart: Chart lifecycle management
 * - renderChartCard: Chart card DOM creation and management
 * - renderAggTable: Aggregate table rendering with pagination
 * - addMissingDataWarning: Missing data warning UI
 * - canonicalJobKey: Job deduplication helper
 * - deduplicateJobs: Job array deduplication
 */

import { parseCsvNumber, parseDateSafe, isNum, toNum } from './ai_chart_utils.js';

// ========= UTILITY FUNCTIONS =========

// toNum is imported from ai_chart_utils.js

/**
 * Format numbers nicely for display
 */
export function nice(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n ?? '');
  if (n === 0) return '0';
  
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (abs < 1) return n.toFixed(3);
  return n.toLocaleString();
}

/**
 * Format numbers with full precision for detailed views
 */
function formatNumberFull(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n ?? '');
  return n.toLocaleString();
}

/**
 * Get column type from profile
 */
function columnType(colName, profile) {
  if (!profile?.columns) return 'string';
  const col = profile.columns.find(c => c.name === colName);
  return col?.type || 'string';
}

/**
 * Select best metric column for count aggregations
 */
function selectBestMetricColumn(numericCols) {
  if (!numericCols || numericCols.length === 0) return null;
  // Simple heuristic: pick first numeric column
  return numericCols[0];
}

// ========= DATE BUCKETING =========

/**
 * Bucket date values into time periods
 * @param {*} d - Date value to bucket
 * @param {string} bucket - Bucket type: 'year'|'quarter'|'month'|'week'|'day'
 * @returns {string|null} Formatted bucket string or null if invalid
 */
export function bucketDate(d, bucket) {
  const t = parseDateSafe(d);
  if (Number.isNaN(t)) return null;
  
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const day = dt.getUTCDate();
  
  if (bucket === 'year') return `${y}`;
  if (bucket === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (bucket === 'month') return `${y}-${String(m).padStart(2, '0')}`;
  if (bucket === 'week') {
    // Calculate ISO 8601 week number
    const date = new Date(Date.UTC(y, dt.getUTCMonth(), day));
    
    // Set to nearest Thursday (current date + 4 - current day number)
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + (4 - dayNum));
    
    // Get first day of year
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    
    // Calculate full weeks to nearest Thursday
    const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    
    return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; // day
}

// ========= GROUP KEY NORMALIZATION =========

/**
 * Normalize group keys and handle NA/null tokens
 * @param {*} v - Value to normalize
 * @param {string} type - Column type hint
 * @returns {*} Normalized value or null for missing data
 */
export function normalizeGroupKey(v, type) {
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

// ========= CORE AGGREGATION =========

/**
 * Core aggregation function
 * @param {Array} rows - Data rows to aggregate
 * @param {string} groupBy - Column to group by
 * @param {string} metric - Column to aggregate (or null for count)
 * @param {string} agg - Aggregation function: 'count'|'sum'|'avg'|'min'|'max'|'distinct_count'
 * @param {string} dateBucket - Date bucket for time series
 * @param {Object} filterConfig - Filtering configuration
 * @param {boolean} showMissing - Include missing values in results
 * @param {Object} profile - Column profile information
 * @returns {Object} Aggregation result with header, rows, metadata
 */
export function groupAgg(rows, groupBy, metric, agg, dateBucket = '', filterConfig = { mode: 'share', value: 0 }, showMissing = true, profile = null) {
  console.log(`[Debug] groupAgg called with:`, { groupBy, metric, agg, dateBucket });
  
  if (metric && profile && !profile.columns.some(c => c.name === metric)) {
    console.warn(`[Debug] groupAgg: Metric "${metric}" not found in profile columns. Aggregation may fail.`);
  }
  
  const m = new Map();
  const isDateCol = columnType(groupBy, profile) === 'date';
  let missingCount = 0;
  const missingRows = [];
  let rawRowsCount = rows.length;
  let missingSum = 0;
  
  const collectForMissing = (r) => {
    if (agg === 'sum' || (agg === 'count' && !metric)) {
      if (!metric) {
        const numericCols = Object.keys(r).filter(col => {
          const val = r[col];
          return val !== null && val !== '' && isFinite(toNum(val));
        });
        const firstNumeric = selectBestMetricColumn(numericCols);
        if (firstNumeric) {
          const v = toNum(r[firstNumeric]);
          if (isFinite(v)) missingSum += v;
        }
      } else {
        const v = toNum(r[metric]);
        if (isFinite(v)) missingSum += v;
      }
    } else if (agg === 'avg' || agg === 'min' || agg === 'max') {
      const v = toNum(r[metric]);
      if (isFinite(v)) missingSum += v;
    }
  };

  for (const r of rows) {
    let g = r[groupBy];
    if (isDateCol && dateBucket) {
      const b = bucketDate(g, dateBucket);
      if (b == null) {
        missingCount++;
        missingRows.push(r);
        collectForMissing(r);
        if (!showMissing) continue;
      }
      g = b;
    }
    
    const key = normalizeGroupKey(g, isDateCol && !dateBucket ? 'date' : 'string');
    if (key === null) {
      missingCount++;
      missingRows.push(r);
      collectForMissing(r);
      if (!showMissing) continue;
    }
    
    const finalKey = key === null ? '(Missing)' : key;
    if (agg === 'count') {
      m.set(finalKey, (m.get(finalKey) || 0) + 1);
    } else {
      const v = toNum(r[metric]);
      if (isFinite(v)) {
        if (!m.has(finalKey)) m.set(finalKey, []);
        m.get(finalKey).push(v);
      }
    }
  }
  
  const out = [];
  for (const [k, arr] of m) {
    let val = 0;
    if (agg === 'count') {
      if (Array.isArray(arr)) {
        val = arr.reduce((a, b) => a + b, 0);
      } else {
        val = arr;
      }
    } else if (!arr.length) continue;
    else if (agg === 'sum') val = arr.reduce((a, b) => a + b, 0);
    else if (agg === 'avg') val = arr.reduce((a, b) => a + b, 0) / arr.length;
    else if (agg === 'min') val = Math.min(...arr);
    else if (agg === 'max') val = Math.max(...arr);
    else if (agg === 'distinct_count') val = new Set(arr).size;
    out.push([k, val]);
  }
  
  // Sort results
  if (isDateCol || dateBucket) {
    // Chronological order for date columns and date buckets
    out.sort((a, b) => {
      const ak = String(a[0] ?? '');
      const bk = String(b[0] ?? '');
      
      if (dateBucket) {
        let dateA, dateB;
        
        if (dateBucket === 'year') {
          dateA = new Date(`${ak}-01-01`);
          dateB = new Date(`${bk}-01-01`);
        } else if (dateBucket === 'quarter') {
          const [, yearA, quarterA] = ak.match(/^(\d+)-Q(\d)$/) || [];
          const [, yearB, quarterB] = bk.match(/^(\d+)-Q(\d)$/) || [];
          if (yearA && quarterA && yearB && quarterB) {
            dateA = new Date(Date.UTC(parseInt(yearA), (parseInt(quarterA) - 1) * 3, 1));
            dateB = new Date(Date.UTC(parseInt(yearB), (parseInt(quarterB) - 1) * 3, 1));
          } else {
            return ak < bk ? -1 : ak > bk ? 1 : 0;
          }
        } else if (dateBucket === 'month') {
          const [, yearA, monthA] = ak.match(/^(\d+)-(\d{2})$/) || [];
          const [, yearB, monthB] = bk.match(/^(\d+)-(\d{2})$/) || [];
          if (yearA && monthA && yearB && monthB) {
            dateA = new Date(Date.UTC(parseInt(yearA), parseInt(monthA) - 1, 1));
            dateB = new Date(Date.UTC(parseInt(yearB), parseInt(monthB) - 1, 1));
          } else {
            return ak < bk ? -1 : ak > bk ? 1 : 0;
          }
        } else if (dateBucket === 'week') {
          const [, yearA, weekA] = ak.match(/^(\d+)-W(\d{2})$/) || [];
          const [, yearB, weekB] = bk.match(/^(\d+)-W(\d{2})$/) || [];
          if (yearA && weekA && yearB && weekB) {
            dateA = new Date(Date.UTC(parseInt(yearA), 0, 4));
            dateA.setDate(dateA.getDate() - ((dateA.getDay() + 6) % 7) + (parseInt(weekA) - 1) * 7);
            
            dateB = new Date(Date.UTC(parseInt(yearB), 0, 4));
            dateB.setDate(dateB.getDate() - ((dateB.getDay() + 6) % 7) + (parseInt(weekB) - 1) * 7);
          } else {
            return ak < bk ? -1 : ak > bk ? 1 : 0;
          }
        } else {
          // Day format
          const partsA = ak.split('-');
          const partsB = bk.split('-');
          if (partsA.length === 3 && partsB.length === 3) {
            dateA = new Date(Date.UTC(parseInt(partsA[0]), parseInt(partsA[1]) - 1, parseInt(partsA[2])));
            dateB = new Date(Date.UTC(parseInt(partsB[0]), parseInt(partsB[1]) - 1, parseInt(partsB[2])));
          } else {
            return ak < bk ? -1 : ak > bk ? 1 : 0;
          }
        }
        
        if (dateA && dateB) {
          return dateA.getTime() - dateB.getTime();
        } else {
          return ak < bk ? -1 : ak > bk ? 1 : 0;
        }
      } else {
        const dateA = parseDateSafe(ak);
        const dateB = parseDateSafe(bk);
        
        if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) {
          return dateA - dateB;
        } else {
          return ak < bk ? -1 : ak > bk ? 1 : 0;
        }
      }
    });
  } else {
    // Default: sort by metric descending for non-date columns
    out.sort((a, b) => (Number(b[1] || 0) - Number(a[1] || 0)));
  }
  
  // Calculate header and sums
  let headerAgg = `${agg}(${metric || '*'})`;
  
  // Calculate raw data sum
  let rawDataSum = 0;
  const metricForRawSum = (row) => {
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
  
  for (const r of rows) {
    const v = metricForRawSum(r);
    if (isFinite(v)) rawDataSum += v;
  }
  
  const totalSum = out.reduce((sum, row) => sum + row[1], 0);
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

  return {
    header: [isDateCol && dateBucket ? `${groupBy} (${dateBucket})` : groupBy, headerAgg],
    rows: filteredOut,
    missingCount,
    missingRows,
    totalSum,
    missingSum,
    rawDataSum,
    rawRowsCount,
    groupsBeforeFilter: out.length,
    removedRows
  };
}

// ========= CHART CONFIGURATION =========

const chartRegistry = new WeakMap(); // canvas -> { chart, ro }

/**
 * Build Chart.js configuration object
 * @param {Object} agg - Aggregation result
 * @param {string} typePref - Chart type preference
 * @param {number} topN - Top N limit
 * @param {Object} options - Additional options
 * @returns {Object} Chart.js configuration
 */
export function computeChartConfig(agg, typePref, topN, options = {}) {
  const { noAnimation = false } = options;
  const total = agg.rows.length;
 
  // Determine type first
  let type = 'bar', indexAxis = 'x', fill = false;
  if (typePref === 'hbar') { type = 'bar'; indexAxis = 'y'; }
  else if (typePref === 'line') { type = 'line'; }
  else if (typePref === 'area') { type = 'line'; fill = true; }
  else if (['pie', 'doughnut', 'polarArea', 'radar'].includes(typePref)) { type = typePref; }
  else if (typePref === 'auto') { type = (total <= 8 ? 'pie' : 'bar'); }
 
  const isCircular = (type === 'pie' || type === 'doughnut' || type === 'polarArea' || type === 'radar');
 
  // Limit categories when Top-N provided
  let rows = [...agg.rows];
  const limit = Number(topN);
  if (Number.isFinite(limit) && limit > 0 && rows.length > limit && (isCircular || type === 'bar')) {
    const head = rows.slice(0, limit);
    const other = rows.slice(limit).reduce((a, b) => a + (+b[1] || 0), 0);
    rows = other ? [...head, ['Other', other]] : head;
  }
 
  const labels = rows.map(r => String(r[0]));
  const values = rows.map(r => { const n = toNum(r[1]); return Number.isFinite(n) ? n : 0; });
 
  return {
    type,
    data: {
      labels,
      datasets: [{
        label: agg.header[1],
        data: values,
        fill,
        tension: 0.4,
        borderColor: '#2563eb',
        backgroundColor: (type === 'pie' || type === 'doughnut')
          ? [
            '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe',
            '#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5',
            '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe',
            '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7'
          ]
          : 'rgba(37, 99, 235, 0.1)',
        pointBackgroundColor: '#2563eb',
        pointRadius: 4,
        borderWidth: 2,
        borderRadius: type === 'bar' ? 4 : 0,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: noAnimation ? false : {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      devicePixelRatio: 1,
      indexAxis,
      plugins: {
        legend: {
          display: isCircular || labels.length <= 20,
          labels: {
            font: {
              size: 12,
              family: 'system-ui, Segoe UI, Arial, sans-serif'
            },
            padding: 20,
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          titleColor: '#0b1220',
          bodyColor: '#0b1220',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            label: ctx => {
              const v = ctx.parsed?.y ?? ctx.parsed ?? ctx.raw;
              return `${ctx.dataset.label}: ${nice(v)}`;
            }
          }
        },
        decimation: { enabled: (type === 'line'), algorithm: 'lttb' }
      },
      scales: isCircular ? {} : {
        x: {
          beginAtZero: true,
          grid: {
            color: 'rgba(226, 232, 240, 0.3)',
            drawBorder: true
          },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            font: {
              size: 11,
              family: 'system-ui, Segoe UI, Arial, sans-serif'
            },
            callback: (indexAxis === 'x') ? undefined : function(value) {
              return nice(value);
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(226, 232, 240, 0.3)',
            drawBorder: true
          },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            font: {
              size: 11,
              family: 'system-ui, Segoe UI, Arial, sans-serif'
            },
            callback: (indexAxis === 'y') ? undefined : function(value) {
              return nice(value);
            }
          }
        }
      }
    }
  };
}

// ========= CHART LIFECYCLE =========

/**
 * Manage Chart.js instance lifecycle with ResizeObserver
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {Object} cfg - Chart.js configuration
 * @param {boolean} shouldResize - Force resize
 * @returns {Chart} Chart.js instance
 */
export function ensureChart(canvas, cfg, shouldResize = false) {
  const rec = chartRegistry.get(canvas);
  let chart = rec ? rec.chart : null;
  let ro = rec ? rec.ro : null;

  // Check if chart type has changed or if chart doesn't exist
  if (!chart || chart.config.type !== cfg.type) {
    if (chart) {
      try { chart.destroy(); } catch {}
      if (ro) { try { ro.disconnect(); } catch {} }
      chartRegistry.delete(canvas);
    }
    // Create new chart
    chart = new Chart(canvas.getContext('2d'), cfg);
    ro = new ResizeObserver(() => { if (chart) chart.resize(); });
    const parent = canvas.parentElement;
    if (parent) ro.observe(parent);
    chartRegistry.set(canvas, { chart, ro });
  } else {
    // Update existing chart
    chart.data.labels = cfg.data.labels;
    chart.data.datasets[0].data = cfg.data.datasets[0].data;
    
    // Update dataset properties that might change
    Object.assign(chart.data.datasets[0], cfg.data.datasets[0]);
    
    // Merge options to allow for dynamic updates
    Object.assign(chart.options, cfg.options);
    
    if (shouldResize) chart.resize();
    chart.update('none'); // snappier redraw without animation
  }
  return chart;
}

// ========= CHART CARD RENDERING =========

/**
 * Create chart card DOM with controls and canvas
 * @param {Object} agg - Aggregation result
 * @param {HTMLElement} chartsContainer - Container element
 * @param {string} defaultType - Default chart type
 * @param {number} defaultTopN - Default top N limit
 * @param {string} titleForFile - Title for file downloads
 * @param {Object} options - Dependencies and options
 * @returns {HTMLElement} Created chart card element
 */
export function renderChartCard(agg, chartsContainer, defaultType = 'auto', defaultTopN = 20, titleForFile = 'chart', options = {}) {
  const { 
    noAnimation = false,
    profile = null,
    showToast = () => {},
    applyMasonryLayout = () => {},
    generateExplanation = () => {}
  } = options;
  
  const c = document.createElement('div');
  c.className = 'chart-card';
  const head = document.createElement('div');
  head.className = 'chart-head';
  const left = document.createElement('div');
  left.className = 'small muted';
  left.textContent = `Chart for: ${agg.header[1]} by ${agg.header[0]}`;
  
  // Create chart controls container
  const controls = document.createElement('div');
  controls.className = 'chart-controls';
  
  const typeSel = document.createElement('select');
  typeSel.innerHTML = `
    <option value="auto">Auto</option>
    <option value="bar">Bar (vertical)</option>
    <option value="hbar">Bar (horizontal)</option>
    <option value="line">Line</option>
    <option value="area">Area</option>
    <option value="pie">Pie</option>
    <option value="doughnut">Doughnut</option>
    <option value="polarArea">Polar Area</option>
    <option value="radar">Radar</option>`;
  typeSel.value = defaultType;
  
  const topNInput = document.createElement('input');
  topNInput.type = 'number';
  topNInput.min = '3';
  topNInput.max = '999';
  topNInput.value = String(defaultTopN);
  topNInput.placeholder = 'Top-N';
  
  const editBtn = document.createElement('button');
  editBtn.textContent = 'Edit';
  editBtn.className = 'btn-secondary';
  editBtn.title = 'Edit chart configuration';
  
  const redrawBtn = document.createElement('button');
  redrawBtn.textContent = 'Redraw';
  const pngBtn = document.createElement('button');
  pngBtn.textContent = 'Download PNG';
  const addChartBtn = document.createElement('button');
  addChartBtn.textContent = 'Add Chart';
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';

  controls.append(typeSel, topNInput, editBtn, redrawBtn, pngBtn, addChartBtn, deleteBtn);
  head.append(left, controls);
  
  // Create canvas
  c.appendChild(head);
  const box = document.createElement('div');
  box.className = 'chart-box';
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  c.appendChild(box);
  chartsContainer.appendChild(c);
  
  // Auto redraw + auto-save on control changes
  typeSel.addEventListener('change', () => { draw(); if (typeof debouncedAutoSave !== 'undefined') debouncedAutoSave(); });
  topNInput.addEventListener('change', () => { draw(); if (typeof debouncedAutoSave !== 'undefined') debouncedAutoSave(); });

  addChartBtn.onclick = () => {
    const t = typeSel.value;
    const n = Math.max(3, Math.min(999, Number(topNInput.value) || 20));
    const parentCard = c.closest('.card');
    const chartsContainer = parentCard.querySelector('.chart-cards');
    const title = parentCard.querySelector('.card-title').textContent;
    renderChartCard(agg, chartsContainer, t, n, title.replace(/\s+/, '_'), options);
    showToast('New chart card added.', 'success');
    if (typeof debouncedAutoSave !== 'undefined') debouncedAutoSave();
  };

  deleteBtn.onclick = () => {
    const chartCard = c;
    const rec = chartRegistry.get(canvas);
    if (rec) {
      if (rec.ro) {
        try { rec.ro.disconnect(); } catch {}
      }
      if (rec.chart) {
        try { rec.chart.destroy(); } catch {}
      }
      chartRegistry.delete(canvas);
    }
    chartCard.remove();
    showToast('Chart deleted.', 'info');
    if (typeof debouncedAutoSave !== 'undefined') debouncedAutoSave();
  };
  
  function draw() {
    const topN = Number(topNInput.value) || 20;
    const cfg = computeChartConfig(agg, typeSel.value, topN, { noAnimation });
    const isCircular = (cfg.type === 'pie' || cfg.type === 'doughnut' || cfg.type === 'polarArea' || cfg.type === 'radar');

    // Keep previously applied dims to detect changes
    const prevW = canvas.dataset.w || '';
    const prevH = canvas.dataset.h || '';

    // Completely reset all inline styles to avoid conflicts
    canvas.setAttribute('style', '');
    
    // Force container-based sizing first
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    // Determine target size
    let shouldResize = false;

    // Let all charts use container sizing for responsive design
    shouldResize = (prevW || prevH); // trigger resize if we had custom sizing before
    
    // Clear any previous custom sizing
    delete canvas.dataset.w;
    delete canvas.dataset.h;

    ensureChart(canvas, cfg, shouldResize);
    if (!noAnimation) showToast('Chart redrawn.', 'info');
  }
  
  // PNG download
  pngBtn.onclick = () => {
    const filename = `${titleForFile.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    showToast(`Downloaded ${filename}`, 'success');
  };
  
  redrawBtn.onclick = draw;
  
  // Initial draw
  draw();
  
  return c;
}

// ========= TABLE RENDERING =========

/**
 * Render sortable/paginated aggregate table with CSV download
 * @param {Object} agg - Aggregation result
 * @param {HTMLElement} container - Container element
 * @param {number} previewN - Default rows per page
 * @param {boolean} showMissing - Show missing data
 * @param {Object} options - Additional options and formatters
 */
export function renderAggTable(agg, container, previewN = 10, showMissing = false, options = {}) {
  const { formatNumberFull = formatNumberFull } = options;
  
  container.innerHTML = '';
  
  // State variables for this table
  let currentPage = 1;
  let rowsPerPage = previewN;
  let searchQuery = '';
  let sortIdx = /\((day|week|month|quarter|year)\)/i.test(agg.header[0] || '') ? 0 : 1;
  let sortDir = sortIdx === 0 ? 'asc' : 'desc';
  let filteredRows = [...agg.rows];
  
  // Create table elements
  const tableControls = document.createElement('div');
  tableControls.className = 'table-controls';
  
  const tableWrap = document.createElement('div');
  tableWrap.className = 'data-table-wrap';
  
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  const tfoot = document.createElement('tfoot');
  
  // Create search input
  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Search: ';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Type to filter...';
  searchInput.style.minWidth = '150px';
  searchLabel.appendChild(searchInput);
  
  // Create rows per page selector
  const rowsPerPageLabel = document.createElement('label');
  rowsPerPageLabel.textContent = 'Rows per page: ';
  const rowsPerPageSelect = document.createElement('select');
  rowsPerPageSelect.innerHTML = `
    <option value="10">10</option>
    <option value="25">25</option>
    <option value="50">50</option>
    <option value="100">100</option>
    <option value="0">All</option>
  `;
  rowsPerPageSelect.value = String(previewN);
  rowsPerPageLabel.appendChild(rowsPerPageSelect);
  
  // Create pager
  const pager = document.createElement('div');
  pager.className = 'pager';
  const prevButton = document.createElement('button');
  prevButton.textContent = 'Prev';
  const pageInfo = document.createElement('span');
  pageInfo.className = 'count';
  pageInfo.textContent = 'Page 1 / 1';
  const nextButton = document.createElement('button');
  nextButton.textContent = 'Next';
  pager.append(prevButton, pageInfo, nextButton);
  
  tableControls.append(searchLabel, rowsPerPageLabel, pager);
  container.appendChild(tableControls);
  
  // Create table header
  const trh = document.createElement('tr');
  const headerSortSpans = [];
  agg.header.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    const s = document.createElement('span');
    s.className = 'sort';
    s.textContent = '';
    th.appendChild(s);
    headerSortSpans[i] = s;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      if (sortIdx === i) {
        sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        sortIdx = i;
        sortDir = i === 0 ? 'asc' : 'desc';
      }
      currentPage = 1;
      updateTable();
    });
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);
  table.appendChild(tbody);
  table.appendChild(tfoot);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
  
  // Create footer with download button
  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const dl = document.createElement('button');
  dl.textContent = 'Download CSV';
  dl.onclick = () => {
    const csv = [agg.header, ...agg.rows].map(r => r.map(s => {
      const z = String(s ?? '');
      return z.includes(',') || z.includes('"') ? `"${z.replace(/"/g, '""')}"` : z;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aggregate_data.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  foot.appendChild(dl);
  container.appendChild(foot);
  
  // Event listeners
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.toLowerCase();
    currentPage = 1;
    updateTable();
  });
  
  rowsPerPageSelect.addEventListener('change', () => {
    rowsPerPage = parseInt(rowsPerPageSelect.value) || 0;
    currentPage = 1;
    updateTable();
  });
  
  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      updateTable();
    }
  });
  
  nextButton.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / Math.max(1, rowsPerPage)));
    if (currentPage < totalPages) {
      currentPage++;
      updateTable();
    }
  });
  
  function updateTable() {
    // Filter rows
    if (searchQuery) {
      filteredRows = agg.rows.filter(row => 
        row.some(cell => String(cell || '').toLowerCase().includes(searchQuery))
      );
    } else {
      filteredRows = [...agg.rows];
    }
    
    // Sort rows
    filteredRows.sort((a, b) => {
      const aVal = a[sortIdx];
      const bVal = b[sortIdx];
      
      const aNum = Number(aVal);
      const bNum = Number(bVal);
      
      let comparison = 0;
      if (!isNaN(aNum) && !isNaN(bNum)) {
        comparison = aNum - bNum;
      } else {
        comparison = String(aVal || '').localeCompare(String(bVal || ''));
      }
      
      return sortDir === 'asc' ? comparison : -comparison;
    });
    
    // Update sort indicators
    headerSortSpans.forEach((span, i) => {
      if (i === sortIdx) {
        span.textContent = sortDir === 'asc' ? ' ↑' : ' ↓';
      } else {
        span.textContent = '';
      }
    });
    
    // Paginate
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / Math.max(1, rowsPerPage)));
    currentPage = Math.min(currentPage, totalPages);
    
    const startIdx = rowsPerPage === 0 ? 0 : (currentPage - 1) * rowsPerPage;
    const endIdx = rowsPerPage === 0 ? filteredRows.length : Math.min(startIdx + rowsPerPage, filteredRows.length);
    const pageRows = filteredRows.slice(startIdx, endIdx);
    
    // Update table body
    tbody.innerHTML = '';
    pageRows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach((cell, i) => {
        const td = document.createElement('td');
        if (i === 1 && typeof cell === 'number') {
          td.textContent = formatNumberFull(cell);
        } else {
          td.textContent = String(cell ?? '');
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    
    // Update pager
    pageInfo.textContent = rowsPerPage === 0 
      ? `Showing all ${filteredRows.length} rows`
      : `Page ${currentPage} / ${totalPages} (${filteredRows.length} total)`;
    
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages || rowsPerPage === 0;
  }
  
  // Initial render
  updateTable();
}

// ========= MISSING DATA WARNING =========

/**
 * Add missing data warning UI to card
 * @param {HTMLElement} card - Card element
 * @param {Object} aggResult - Aggregation result
 * @param {number} totalRows - Total row count
 * @param {boolean} showMissing - Whether missing data is shown
 */
export function addMissingDataWarning(card, aggResult, totalRows, showMissing) {
  if (aggResult.missingCount > 0) {
    const missingShare = aggResult.missingCount / (totalRows || 1);
    const missingWarningThreshold = 0.1;
    
    if (missingShare > missingWarningThreshold) {
      const warning = document.createElement('div');
      warning.className = 'missing-data-warning';
      warning.style.padding = '8px 12px';
      warning.style.background = '#fffbeb';
      warning.style.border = '1px solid #fef3c7';
      warning.style.color = '#b45309';
      warning.style.fontSize = '13px';

      if (showMissing) {
        warning.innerHTML = `<strong>Note:</strong> ${aggResult.missingCount.toLocaleString()} rows (${(missingShare * 100).toFixed(1)}%) with missing group values are included in the '(Missing)' category.`;
      } else {
        warning.innerHTML = `<strong>Warning:</strong> ${aggResult.missingCount.toLocaleString()} rows (${(missingShare * 100).toFixed(1)}%) had missing values for grouping and were excluded. Use the card control "Include '(Missing)' group" to include them.`;
      }

      if (card.firstChild) {
        card.insertBefore(warning, card.firstChild);
      } else {
        card.appendChild(warning);
      }
    }
  }
}

// ========= JOB DEDUPLICATION =========

/**
 * Generate canonical key for job deduplication
 * @param {Object} job - Job object with groupBy, metric, agg, dateBucket
 * @returns {string} Canonical key
 */
export function canonicalJobKey(job) {
  const { groupBy, metric, agg, dateBucket } = job;
  
  const normalizeString = (str) => {
    if (!str || str === null || str === undefined) return '';
    return String(str).trim().toLowerCase();
  };
  
  const normalizedMetric = !metric || metric === '' ? 'count' : normalizeString(metric);
  
  return `${normalizeString(agg)}|${normalizedMetric}|${normalizeString(groupBy)}|${normalizeString(dateBucket)}`;
}

/**
 * Deduplicate jobs array using canonical keys
 * @param {Array} jobs - Array of job objects
 * @returns {Array} Deduplicated jobs
 */
export function deduplicateJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  
  const uniqueJobs = [];
  const seenKeys = new Set();
  
  for (const job of jobs) {
    const key = canonicalJobKey(job);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueJobs.push(job);
    } else {
      console.log(`🚫 Deduplicating job: ${key}`);
    }
  }
  
  if (uniqueJobs.length !== jobs.length) {
    console.log(`📉 Deduplicated ${jobs.length - uniqueJobs.length} jobs, ${uniqueJobs.length} remain`);
  }
  
  return uniqueJobs;
}