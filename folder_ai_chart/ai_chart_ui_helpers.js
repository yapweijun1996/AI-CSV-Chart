import * as Store from './ai_chart_store.js';
import { fetchWithRetry } from './ai_chart_api.js';
import { isValidApiKey } from './ai_chart_ai_settings_handlers.js';
import { groupAgg, renderChartCard, renderAggTable, addMissingDataWarning, computeChartConfig, canonicalJobKey, deduplicateJobs, ensureChart, pivotAgg, computePivotChartConfig } from './ai_chart_aggregates.js';
import { showToast } from './ai_chart_toast_system.js';
import { GeminiAPI, workflowTimer } from './ai_chart_engine.js';
import { getErpAnalysisPriority } from './ai_chart_erp_logic.js';
import { applyMasonryLayout } from './ai_chart_masonry.js';
import { renderExplanationCard, generateExplanation, runAiWorkflow, checkAndGenerateAISummary, updateAiTodoList } from './ai_chart_ui_workflow.js';

// Helper functions extracted from ai_chart_ui.js
// This file contains the largest, most complex functions dealing with DOM manipulation and AI integration

// Utility functions that need access to globals
const $ = s => document.querySelector(s);
const formatNumberFull = window.formatNumberFull || ((n) => n.toLocaleString());
const getIncludedRows = () => window.getIncludedRows ? window.getIncludedRows() : [];
// When cross-tab is detected, aggregate against converted long rows (AGG_ROWS) if available.
const aggregationRows = () =>
  (window.AGG_ROWS && Array.isArray(window.AGG_ROWS))
    ? window.AGG_ROWS
    : (window.getIncludedRows ? window.getIncludedRows() : []);
const ROWS = () => window.ROWS;
// Prefer aggregation profile when present (for converted long format), fallback to original profile
const PROFILE = () => window.AGG_PROFILE || window.PROFILE;
const MODE = () => window.MODE;
const autoPlan = (profile, rows, excluded) => window.autoPlan ? window.autoPlan(profile, rows, excluded) : { jobs: [] };
const marked = window.marked || { parse: (text) => text };
const debounce = window.debounce || ((fn, delay) => fn);
const debouncedAutoSave = window.debouncedAutoSave || (() => {});

// ===== Helper: where filtering and labeling =====
function filterRowsByWhere(rows, where) {
  if (!where || typeof where !== 'object') return rows;
  const entries = Object.entries(where);
  if (entries.length === 0) return rows;
  return rows.filter(r => {
    for (const [k, v] of entries) {
      const rv = r[k];
      if (Array.isArray(v)) {
        const set = new Set(v.map(x => String(x ?? '').trim()));
        if (!set.has(String(rv ?? '').trim())) return false;
      } else {
        if (String(rv ?? '').trim() !== String(v ?? '').trim()) return false;
      }
    }
    return true;
  });
}

function formatWhereLabel(where) {
  if (!where || typeof where !== 'object') return '';
  try {
    const parts = Object.entries(where).map(([k, v]) => {
      if (Array.isArray(v)) return `${k} in [${v.join(', ')}]`;
      return `${k}=${v}`;
    });
    return parts.join(' & ');
  } catch {
    return '';
  }
}

/**
* Sanitize raw rows for aggregation (no-op to honor "exclude, don't remove"):
* - Return rows unchanged so totals still appear in aggregates, but we can auto-uncheck them.
*/
function sanitizeRows(rows) {
  try {
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('sanitizeRows failed:', e);
    return Array.isArray(rows) ? rows : [];
  }
}

/**
* Prefer financial metric names for non-long schema datasets.
* Order of preference (case-insensitive):
*   amount local, amount, total amount, total, value, sales, revenue, price, unit price, qty, quantity
*/
function preferFinancialMetric(columnNames = []) {
 const names = (columnNames || []).map(n => String(n || ''));
 const lc = names.map(n => n.toLowerCase());
 const prefer = (...candidates) => {
   for (const c of candidates) {
     const idx = lc.indexOf(c.toLowerCase());
     if (idx >= 0) return names[idx];
   }
   return null;
 };
 return (
   prefer('amount local') ||
   prefer('amount') ||
   prefer('total amount') ||
   prefer('total') ||
   prefer('value') ||
   prefer('sales') ||
   prefer('revenue') ||
   prefer('price') ||
   prefer('unit price') ||
   prefer('qty') ||
   prefer('quantity')
 );
}

// Use window-scoped render flags to avoid duplication with main UI

// Button state management for workflow prevention
function setGenerateButtonState(isRunning) {
    const autoBtn = document.getElementById('autoBtn');
    if (!autoBtn) return;
    
    if (isRunning) {
        autoBtn.disabled = true;
        autoBtn.textContent = 'Workflow Running...';
        autoBtn.style.opacity = '0.6';
        autoBtn.style.cursor = 'not-allowed';
    } else {
        autoBtn.disabled = false;
        autoBtn.textContent = 'Generate Cards';
        autoBtn.style.opacity = '1';
        autoBtn.style.cursor = 'pointer';
    }
}

async function buildAggCard(job, cardState = {}, sessionId = null, options = {}) {
    const {
        showMissing = false,
        filterValue = 0,
        filterMode = 'share',
        charts = [{ type: 'auto', topN: 20 }],
        explanation = null,
        noAnimation = false // Pass noAnimation through cardState
    } = cardState;
    const { skipExplanation = false } = options;

    // Generate canonical key for deduplication and state management
    const canonicalKey = canonicalJobKey(job);
    console.log('[Debug] buildAggCard: Building card for job:', { job, canonicalKey });
    
    // Session validation - prevent stale results
    if (sessionId && window.currentAggregationSession && window.currentAggregationSession !== sessionId) {
        console.log(`⏹️ Skipping buildAggCard due to session mismatch: current=${window.currentAggregationSession}, expected=${sessionId}`);
        const dummyCard = document.createElement('div');
        dummyCard.style.display = 'none';
        return dummyCard; // Return invisible dummy to prevent breaking code flow
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.style.gridRowEnd = 'span 35'; // Pre-allocate space to prevent overlap

    // Persist job definition, canonical key, and state on the card
    card.dataset.groupBy = job.groupBy || '';
    card.dataset.metric = job.metric || '';
    card.dataset.agg = job.agg || '';
    card.dataset.dateBucket = job.dateBucket || '';
    card.dataset.showMissing = String(showMissing);
    card.dataset.canonicalKey = canonicalKey;
    // Determine effective where from job or snapshot state
    let __effectiveWhere = null;
    try {
      __effectiveWhere = job.where || (cardState && cardState.cardJobKey && cardState.cardJobKey.where) || (cardState && cardState.where) || null;
    } catch {}
    if (__effectiveWhere) {
      job.where = job.where || __effectiveWhere;
      try { card.dataset.where = JSON.stringify(__effectiveWhere); } catch {}
    }
    // Restore per-card row exclusion state from snapshot (for Include column in table)
    if (Array.isArray(cardState.excludedKeys)) {
      try { card.dataset.excludedKeys = JSON.stringify(cardState.excludedKeys); } catch {}
    }
    if (job.type === 'pivot') {
      card.dataset.pivot = 'true';
      if (job.rowsDim) card.dataset.rowsDim = job.rowsDim;
      if (job.colsDim) card.dataset.colsDim = job.colsDim;
    }
    if (sessionId) card.dataset.sessionId = sessionId;

    const whereTitle = formatWhereLabel(job.where);
    let title = '';
    if (job.type === 'pivot') {
      const rowsDim = job.rowsDim || 'Description';
      const colsDim = job.colsDim || 'ProjectId';
      title = `${job.agg}(${job.metric || 'Value'}) by ${rowsDim} × ${colsDim}${whereTitle ? ' — ' + whereTitle : ''}`;
    } else {
      title = `${job.agg}(${job.metric || ''}) by ${job.groupBy}${whereTitle ? ' — ' + whereTitle : ''}`;
    }
    const head = document.createElement('div');
    head.className = 'card-head';
    const left = document.createElement('div');
    const h = document.createElement('h4');
    h.className = 'card-title';
    h.textContent = title;
    const sub = document.createElement('div');
    sub.className = 'card-sub';
    left.append(h, sub);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'card-toggle';
    toggleBtn.innerHTML = '<span class="chev"></span>';
    toggleBtn.setAttribute('aria-label', 'Toggle card content');

    head.append(left, toggleBtn);
    card.appendChild(head);

    const cardContent = document.createElement('div');
    cardContent.className = 'card-content';
    card.appendChild(cardContent);

    const controls = document.createElement('div');
    controls.className = 'card-controls';
    cardContent.appendChild(controls);

    // Add filter controls
    const filterLabel = document.createElement('label');
    filterLabel.textContent = 'Min Group Share/Value: ';
    const filterInput = document.createElement('input');
    filterInput.type = 'number';
    filterInput.className = 'filter-input';
    filterInput.value = String(filterValue);
    filterInput.min = '0';
    filterInput.step = '0.01';
    filterInput.style.width = '80px';
    
    const filterModeSelect = document.createElement('select');
    filterModeSelect.className = 'filter-mode-select';
    filterModeSelect.innerHTML = `
        <option value="share" ${filterMode === 'share' ? 'selected' : ''}>% Share</option>
        <option value="value" ${filterMode === 'value' ? 'selected' : ''}>Absolute Value</option>
    `;

    controls.append(filterLabel, filterInput, filterModeSelect);
    
    // Add per-card missing data toggle control (default Off)
    const missingToggleWrap = document.createElement('label');
    missingToggleWrap.style.marginRight = '12px';
    const missingToggle = document.createElement('input');
    missingToggle.type = 'checkbox';
    missingToggle.checked = !!showMissing;
    missingToggle.style.marginRight = '6px';
    missingToggle.addEventListener('change', () => {
        reRenderCard(!!missingToggle.checked);
        debouncedAutoSave();
    });
    missingToggleWrap.appendChild(missingToggle);
    missingToggleWrap.appendChild(document.createTextNode("Include '(Missing)' group"));
    // Place toggle before other controls
    controls.prepend(missingToggleWrap);

    const applyFilterOnChange = () => {
        reRenderCard(card.dataset.showMissing === 'true');
        debouncedAutoSave();
    };

    filterInput.addEventListener('change', applyFilterOnChange);
    filterInput.addEventListener('input', debounce(applyFilterOnChange, 300));
    filterModeSelect.addEventListener('change', applyFilterOnChange);

    // Pivot-specific controls (unified with other cards)
    // Expose rows/cols/metric/top limits + orientation similar to other edit controls
    if (job.type === 'pivot' || card.dataset.pivot === 'true') {
      const prof = PROFILE?.() || window.AGG_PROFILE || window.PROFILE || {};
      const cols = Array.isArray(prof.columns) ? prof.columns : [];
      const strCols = cols.filter(c => ['string','date'].includes(c.type)).map(c => c.name);
      const numCols = cols.filter(c => c.type === 'number').map(c => c.name);

      const prefRows = card.dataset.rowsDim || job.rowsDim || (strCols.includes('Description') ? 'Description' : (strCols[0] || ''));
      const prefCols = card.dataset.colsDim || job.colsDim || (strCols.includes('ProjectId') ? 'ProjectId' : (strCols[1] || strCols[0] || ''));
      const prefMetric = card.dataset.metric || job.metric || (numCols.includes('Value') ? 'Value' : (numCols[0] || 'Value'));
      const prefTopCols = Number(card.dataset.pivotTopCols || (job.pivotOptions && job.pivotOptions.topCols) || 8);
      const prefTopRows = Number(card.dataset.pivotTopRows || (job.pivotOptions && job.pivotOptions.topRows) || 20);
      const prefOrientation = card.dataset.pivotOrientation || 'horizontal';

      const pivotWrap = document.createElement('div');
      pivotWrap.className = 'pivot-controls';
      pivotWrap.style.display = 'flex';
      pivotWrap.style.flexWrap = 'wrap';
      pivotWrap.style.gap = '8px';
      pivotWrap.style.alignItems = 'center';
      pivotWrap.style.margin = '6px 0';

      const optionsHtml = (arr, sel) => arr.map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

      pivotWrap.innerHTML = `
        <label>Rows:
          <select class="pivot-rows" style="min-width:140px">${optionsHtml(strCols, prefRows)}</select>
        </label>
        <label>Cols:
          <select class="pivot-cols" style="min-width:140px">${optionsHtml(strCols, prefCols)}</select>
        </label>
        <label>Metric:
          <select class="pivot-metric" style="min-width:140px">${optionsHtml(numCols, prefMetric)}</select>
        </label>
        <label>Top Cols:
          <input class="pivot-topcols" type="number" min="1" max="50" value="${prefTopCols}" style="width:72px"/>
        </label>
        <label>Top Rows:
          <input class="pivot-toprows" type="number" min="1" max="500" value="${prefTopRows}" style="width:80px"/>
        </label>
        <label>Orientation:
          <select class="pivot-orientation" style="min-width:120px">
            <option value="horizontal" ${prefOrientation === 'horizontal' ? 'selected' : ''}>Horizontal</option>
            <option value="vertical" ${prefOrientation === 'vertical' ? 'selected' : ''}>Vertical</option>
          </select>
        </label>
        <button class="pivot-apply btn-secondary">Apply Pivot</button>
      `;
      controls.appendChild(pivotWrap);

      pivotWrap.querySelector('.pivot-apply').onclick = () => {
        const r = pivotWrap.querySelector('.pivot-rows').value;
        const c = pivotWrap.querySelector('.pivot-cols').value;
        const m = pivotWrap.querySelector('.pivot-metric').value;
        const tc = Math.max(1, Math.min(50, Number(pivotWrap.querySelector('.pivot-topcols').value) || prefTopCols));
        const tr = Math.max(1, Math.min(500, Number(pivotWrap.querySelector('.pivot-toprows').value) || prefTopRows));
        const or = pivotWrap.querySelector('.pivot-orientation').value === 'vertical' ? 'vertical' : 'horizontal';

        card.dataset.pivot = 'true';
        card.dataset.rowsDim = r || '';
        card.dataset.colsDim = c || '';
        card.dataset.metric = m || '';
        card.dataset.agg = 'sum';
        card.dataset.pivotTopCols = String(tc);
        card.dataset.pivotTopRows = String(tr);
        card.dataset.pivotOrientation = or;

        reRenderCard(card.dataset.showMissing === 'true');
        debouncedAutoSave();
      };
    }

    // Manual Description controls moved to global CSV Input section (initGlobalDescControls).
    // No per-card controls here to avoid duplication and UX clutter.

    const chartsContainer = document.createElement('div');
    chartsContainer.className = 'chart-cards';
    cardContent.appendChild(chartsContainer);

    const tableBox = document.createElement('div');
    tableBox.className = 'table-wrap';
    cardContent.appendChild(tableBox);

    toggleBtn.addEventListener('click', () => {
        card.classList.toggle('is-collapsed');
        
        // Wait for the CSS transition to finish before applying masonry layout
        card.querySelector('.card-content').addEventListener('transitionend', () => {
            applyMasonryLayout();
        }, { once: true });

        // Fallback in case transitionend doesn't fire
        setTimeout(applyMasonryLayout, 550);
    });

    function reRenderCard(newShowMissing) {
        const currentFilterValue = Number(card.querySelector('.filter-input')?.value || 0);
        const currentFilterMode = card.querySelector('.filter-mode-select')?.value || 'share';

        // Read current settings from card dataset (which may have been manually edited)
        // Fall back to original job settings if not found
        const currentGroupBy = card.dataset.groupBy || job.groupBy;
        const currentMetric = card.dataset.metric || job.metric;
        const currentAgg = card.dataset.agg || job.agg;
        const currentDateBucket = card.dataset.dateBucket || job.dateBucket || '';
        
        console.log('🔄 reRenderCard using settings:', { 
            currentGroupBy, currentMetric, currentAgg, currentDateBucket,
            fromDataset: { groupBy: card.dataset.groupBy, metric: card.dataset.metric, agg: card.dataset.agg },
            originalJob: { groupBy: job.groupBy, metric: job.metric, agg: job.agg }
        });

        const baseRows = aggregationRows();
        let whereObj = null;
        try { whereObj = card.dataset.where ? JSON.parse(card.dataset.where) : (job.where || null); } catch { whereObj = job.where || null; }
        let usedRows = whereObj ? filterRowsByWhere(baseRows, whereObj) : baseRows;
        usedRows = sanitizeRows(usedRows);

        if (card.dataset.pivot === 'true' || job.type === 'pivot') {
            const rowsDim = card.dataset.rowsDim || job.rowsDim || 'Description';
            const colsDim = card.dataset.colsDim || job.colsDim || 'ProjectId';
            const metric = card.dataset.metric || job.metric || 'Value';
            const fn = card.dataset.agg || job.agg || 'sum';
            const topCols = Number(card.dataset.pivotTopCols || (job.pivotOptions && job.pivotOptions.topCols) || 8);
            const topRows = Number(card.dataset.pivotTopRows || (job.pivotOptions && job.pivotOptions.topRows) || 20);
            const pvt = pivotAgg(usedRows, rowsDim, colsDim, metric, fn, { topCols, topRows });

            // Re-render pivot table
            (function renderPivotTable() {
              tableBox.innerHTML = '';
              const table = document.createElement('table');
              const thead = document.createElement('thead');
              const tbody = document.createElement('tbody');
              const trh = document.createElement('tr');

              const th0 = document.createElement('th');
              th0.textContent = rowsDim;
              th0.className = 'sticky';
              trh.appendChild(th0);
              for (const c of pvt.cols) {
                const th = document.createElement('th');
                th.textContent = c;
                th.className = 'sticky';
                trh.appendChild(th);
              }
              const thTot = document.createElement('th');
              thTot.textContent = 'Total';
              thTot.className = 'sticky';
              trh.appendChild(thTot);
              thead.appendChild(trh);

              for (const r of pvt.rows) {
                const tr = document.createElement('tr');
                const tdKey = document.createElement('td');
                tdKey.textContent = r.key;
                tr.appendChild(tdKey);
                r.values.forEach(v => {
                  const td = document.createElement('td');
                  td.textContent = formatNumberFull(v);
                  tr.appendChild(td);
                });
                const tdSum = document.createElement('td');
                tdSum.textContent = formatNumberFull(r.total);
                tr.appendChild(tdSum);
                tbody.appendChild(tr);
              }

              table.appendChild(thead);
              table.appendChild(tbody);
              tableBox.appendChild(table);
            })();

            // Re-render pivot chart
            (function renderPivotChart() {
              // Create a pivot chart card with unified controls (orientation, redraw, PNG, add, delete)
              const createChartCard = () => {
                const chartCard = document.createElement('div');
                chartCard.className = 'chart-card';

                const chartHead = document.createElement('div');
                chartHead.className = 'chart-head';
                const small = document.createElement('div');
                small.className = 'small muted';
                small.textContent = `Chart for: ${fn}(${metric}) by ${rowsDim} × ${colsDim}`;

                const controls = document.createElement('div');
                controls.className = 'chart-controls';
                const orientationSel = document.createElement('select');
                orientationSel.innerHTML = `
                  <option value="horizontal">Bar (horizontal)</option>
                  <option value="vertical">Bar (vertical)</option>
                `;
                orientationSel.value = (card.dataset.pivotOrientation === 'vertical') ? 'vertical' : 'horizontal';
                const redrawBtn = document.createElement('button'); redrawBtn.textContent = 'Redraw';
                const pngBtn = document.createElement('button'); pngBtn.textContent = 'Download PNG';
                const addChartBtn = document.createElement('button'); addChartBtn.textContent = 'Add Chart';
                const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete';

                controls.append(orientationSel, redrawBtn, pngBtn, addChartBtn, deleteBtn);
                chartHead.append(small, controls);
                chartCard.appendChild(chartHead);

                const chartBox = document.createElement('div');
                chartBox.className = 'chart-box';
                const canvas = document.createElement('canvas');
                chartBox.appendChild(canvas);
                chartCard.appendChild(chartBox);
                chartsContainer.appendChild(chartCard);

                const draw = (resize = true) => {
                  const orientation = (orientationSel.value === 'vertical') ? 'vertical' : 'horizontal';
                  card.dataset.pivotOrientation = orientation;
                  const cfg = computePivotChartConfig(pvt, orientation);
                  ensureChart(canvas, cfg, !!resize);
                };

                orientationSel.addEventListener('change', () => { draw(true); debouncedAutoSave(); });
                redrawBtn.onclick = () => { draw(true); debouncedAutoSave(); };
                pngBtn.onclick = () => {
                  const filename = `pivot_${rowsDim}_x_${colsDim}.png`;
                  const url = canvas.toDataURL('image/png');
                  const a = document.createElement('a');
                  a.href = url; a.download = filename; a.click();
                };
                addChartBtn.onclick = () => {
                  // Create a new chart card (not clone) to avoid copying listeners incorrectly
                  const newCard = createChartCard();
                  // Trigger initial draw for the new card
                  const newCanvas = newCard.querySelector('canvas');
                  const newSel = newCard.querySelector('select');
                  const orientation = (newSel.value === 'vertical') ? 'vertical' : 'horizontal';
                  const cfg = computePivotChartConfig(pvt, orientation);
                  ensureChart(newCanvas, cfg, true);
                  applyMasonryLayout();
                  debouncedAutoSave();
                  showToast('New chart card added.', 'success');
                };
                deleteBtn.onclick = () => {
                  try {
                    const inst = (window.Chart && typeof window.Chart.getChart === 'function') ? window.Chart.getChart(canvas) : null;
                    if (inst) inst.destroy();
                  } catch {}
                  chartCard.remove();
                  applyMasonryLayout();
                  debouncedAutoSave();
                  showToast('Chart deleted.', 'info');
                };

                draw(true);
                return chartCard;
              };

              // Ensure at least one chart exists
              if (chartsContainer.querySelectorAll('.chart-card').length === 0) {
                createChartCard();
              }

              // Redraw all existing pivot charts based on their own controls
              chartsContainer.querySelectorAll('.chart-card').forEach(chartCard => {
                const canvas = chartCard.querySelector('canvas');
                const orientationSel = chartCard.querySelector('select');
                const o = (orientationSel && orientationSel.value === 'vertical') ? 'vertical' : 'horizontal';
                const cfg = computePivotChartConfig(pvt, o);
                ensureChart(canvas, cfg, true);
              });
            })();

            sub.textContent = `${pvt.rows.length} rows × ${pvt.cols.length} cols · ${fn}(${metric})`;

            // Avoid generic re-rendering path for pivot
            return;
        }

        // Normalize share filter: if user/snapshot saved "20" (meaning 20%), convert to 0.20
        let normalizedFilterValue = (currentFilterMode === 'share' && Number(currentFilterValue) > 1)
          ? Number(currentFilterValue) / 100
          : Number(currentFilterValue) || 0;

        // Clamp to [0,1] for share mode
        if (currentFilterMode === 'share') {
          normalizedFilterValue = Math.max(0, Math.min(1, normalizedFilterValue));
        }

        console.debug('[HistoryFix] reRenderCard params', {
          where: whereObj, usedRows: Array.isArray(usedRows) ? usedRows.length : -1,
          currentGroupBy, currentMetric, currentAgg, currentDateBucket,
          filterMode: currentFilterMode, filterValue: currentFilterValue, normalizedFilterValue
        });

        let newAgg = groupAgg(usedRows, currentGroupBy, currentMetric, currentAgg, currentDateBucket, {
            mode: currentFilterMode,
            value: normalizedFilterValue
        }, newShowMissing, PROFILE());

        // Fallback 1: if filter removes all groups, relax to 0 and retry once (any mode)
        if (Array.isArray(newAgg?.rows) && newAgg.rows.length === 0 && normalizedFilterValue > 0) {
          console.warn('[Fallback] Empty result after filter =', normalizedFilterValue, 'mode=', currentFilterMode, '→ retry with 0');
          normalizedFilterValue = 0;
          try { const inp = card.querySelector('.filter-input'); if (inp) inp.value = '0'; } catch {}
          newAgg = groupAgg(usedRows, currentGroupBy, currentMetric, currentAgg, currentDateBucket, {
            mode: currentFilterMode,
            value: 0
          }, newShowMissing, PROFILE());
        }

        // Fallback 2: if仍然为空，直接关闭最小份额/阈值过滤
        if (Array.isArray(newAgg?.rows) && newAgg.rows.length === 0) {
          console.warn('[Fallback-2] Still empty after reset, disabling minGroupShare/threshold for preview render');
          newAgg = groupAgg(usedRows, currentGroupBy, currentMetric, currentAgg, currentDateBucket, {
            mode: currentFilterMode,
            value: 0
          }, newShowMissing, PROFILE());
        }

        card.dataset.showMissing = String(newShowMissing);

        const existingWarnings = card.querySelectorAll('.missing-data-warning');
        existingWarnings.forEach(warning => warning.remove());
        addMissingDataWarning(card, newAgg, (typeof usedRows !== 'undefined' ? usedRows.length : aggregationRows().length), newShowMissing);

        sub.textContent = `${newAgg.rows.length} groups · ${newAgg.header[1]}`;
        
        // Auto-uncheck obvious total-like groups (do not remove; only pre-populate excluded set)
        try {
          const patExactTotal = /^\s*(?:\(\s*[A-Za-z]{2,4}\s*\)\s*)?(?:grand\s+)?(?:sub\s*)?total\s*$/i; // "Total", "Grand Total", "(SGD) Total"
          const patExactSum   = /^\s*sum\s*$/i;
          const patNetTotal   = /^\s*net\s*total\s*$/i;
          const patCN         = /^(合计|小计|总计|總計|合計|小計)\s*$/;
        
          let existing = [];
          try { existing = card.dataset.excludedKeys ? JSON.parse(card.dataset.excludedKeys) : []; } catch {}
          const set = new Set(Array.isArray(existing) ? existing.map(x => String(x)) : []);
        
          for (const r of (newAgg.rows || [])) {
            const key = String(r?.[0] ?? '').trim();
            if (patExactTotal.test(key) || patExactSum.test(key) || patNetTotal.test(key) || patCN.test(key)) {
              set.add(key);
            }
          }
          card.dataset.excludedKeys = JSON.stringify(Array.from(set));
        } catch (e) { console.warn('auto-uncheck totals (reRender) failed:', e); }
        
        renderAggTable(newAgg, tableBox, 20, newShowMissing, { formatNumberFull });
        
        chartsContainer.querySelectorAll('.chart-card').forEach(chartCard => {
            const canvas = chartCard.querySelector('canvas');
            const typeSel = chartCard.querySelector('select');
            const topNInput = chartCard.querySelector('input[type="number"]');
            if (canvas && typeSel && topNInput) {
                const cfg = computeChartConfig(newAgg, typeSel.value, Number(topNInput.value) || 20);
                ensureChart(canvas, cfg, true);
            }
        });

        const mainContent = $('#main-content');
        const grid = $('#results');
        const scrollY = mainContent.scrollTop;

        grid.style.opacity = '0.5';

        requestAnimationFrame(() => {
            mainContent.scrollTop = scrollY;
            grid.style.opacity = '1';
            applyMasonryLayout();
        });

        // After re-rendering, regenerate the explanation
        generateExplanation(newAgg, job, card);
    }

    // Initial render
    // Add a final session check before expensive aggregation
    if (sessionId && window.currentAggregationSession && window.currentAggregationSession !== sessionId) {
        console.log(`⏹️ Skipping groupAgg due to session mismatch before initial aggregation`);
        const dummyCard = document.createElement('div');
        dummyCard.style.display = 'none';
        return dummyCard;
    }
    
    console.time(`buildAggCard:compute:${card.dataset.canonicalKey}`);
    const baseRows = aggregationRows();
    const usedRows = job.where ? filterRowsByWhere(baseRows, job.where) : baseRows;

    let initialAgg = null;
    if (job.type === 'pivot' || card.dataset.pivot === 'true') {
      // Render Pivot (Description × ProjectId) or as specified
      const rowsDim = card.dataset.rowsDim || job.rowsDim || 'Description';
      const colsDim = card.dataset.colsDim || job.colsDim || 'ProjectId';
      const metric = card.dataset.metric || job.metric || 'Value';
      const fn = card.dataset.agg || job.agg || 'sum';
      const topCols = Number(card.dataset.pivotTopCols || (job.pivotOptions && job.pivotOptions.topCols) || 8);
      const topRows = Number(card.dataset.pivotTopRows || (job.pivotOptions && job.pivotOptions.topRows) || 20);
      const pvt = pivotAgg(usedRows, rowsDim, colsDim, metric, fn, { topCols, topRows });
      console.timeEnd(`buildAggCard:compute:${card.dataset.canonicalKey}`);

      // Sub header
      sub.textContent = `${pvt.rows.length} rows × ${pvt.cols.length} cols · ${fn}(${metric})`;

      // Render Pivot Table
      (function renderPivotTable() {
        tableBox.innerHTML = '';
        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');
        const trh = document.createElement('tr');

        // Header cells
        const th0 = document.createElement('th');
        th0.textContent = rowsDim;
        th0.className = 'sticky';
        trh.appendChild(th0);
        for (const c of pvt.cols) {
          const th = document.createElement('th');
          th.textContent = c;
          th.className = 'sticky';
          trh.appendChild(th);
        }
        const thTot = document.createElement('th');
        thTot.textContent = 'Total';
        thTot.className = 'sticky';
        trh.appendChild(thTot);
        thead.appendChild(trh);

        // Body rows
        for (const r of pvt.rows) {
          const tr = document.createElement('tr');
          const tdKey = document.createElement('td');
          tdKey.textContent = r.key;
          tr.appendChild(tdKey);
          r.values.forEach(v => {
            const td = document.createElement('td');
            td.textContent = formatNumberFull(v);
            tr.appendChild(td);
          });
          const tdSum = document.createElement('td');
          tdSum.textContent = formatNumberFull(r.total);
          tr.appendChild(tdSum);
          tbody.appendChild(tr);
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        tableBox.appendChild(table);
      })();

      // Render stacked chart for pivot
      (function renderPivotChart() {
        // Create a pivot chart card with unified controls (orientation, redraw, PNG, add, delete)
        const createChartCard = () => {
          const chartCard = document.createElement('div');
          chartCard.className = 'chart-card';

          const chartHead = document.createElement('div');
          chartHead.className = 'chart-head';
          const small = document.createElement('div');
          small.className = 'small muted';
          small.textContent = `Chart for: ${fn}(${metric}) by ${rowsDim} × ${colsDim}`;

          const controls = document.createElement('div');
          controls.className = 'chart-controls';
          const orientationSel = document.createElement('select');
          orientationSel.innerHTML = `
            <option value="horizontal">Bar (horizontal)</option>
            <option value="vertical">Bar (vertical)</option>
          `;
          orientationSel.value = (card.dataset.pivotOrientation === 'vertical') ? 'vertical' : 'horizontal';
          const redrawBtn = document.createElement('button'); redrawBtn.textContent = 'Redraw';
          const pngBtn = document.createElement('button'); pngBtn.textContent = 'Download PNG';
          const addChartBtn = document.createElement('button'); addChartBtn.textContent = 'Add Chart';
          const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete';

          controls.append(orientationSel, redrawBtn, pngBtn, addChartBtn, deleteBtn);
          chartHead.append(small, controls);
          chartCard.appendChild(chartHead);

          const chartBox = document.createElement('div');
          chartBox.className = 'chart-box';
          const canvas = document.createElement('canvas');
          chartBox.appendChild(canvas);
          chartCard.appendChild(chartBox);
          chartsContainer.appendChild(chartCard);

          const draw = (resize = true) => {
            const orientation = (orientationSel.value === 'vertical') ? 'vertical' : 'horizontal';
            card.dataset.pivotOrientation = orientation;
            const cfg = computePivotChartConfig(pvt, orientation);
            ensureChart(canvas, cfg, !!resize);
          };

          orientationSel.addEventListener('change', () => { draw(true); debouncedAutoSave(); });
          redrawBtn.onclick = () => { draw(true); debouncedAutoSave(); };
          pngBtn.onclick = () => {
            const filename = `pivot_${rowsDim}_x_${colsDim}.png`;
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
          };
          addChartBtn.onclick = () => {
            // Create a new chart card (not clone) to avoid copying listeners incorrectly
            const newCard = createChartCard();
            // Trigger initial draw for the new card
            const newCanvas = newCard.querySelector('canvas');
            const newSel = newCard.querySelector('select');
            const orientation = (newSel.value === 'vertical') ? 'vertical' : 'horizontal';
            const cfg = computePivotChartConfig(pvt, orientation);
            ensureChart(newCanvas, cfg, true);
            applyMasonryLayout();
            debouncedAutoSave();
            showToast('New chart card added.', 'success');
          };
          deleteBtn.onclick = () => {
            try {
              const inst = (window.Chart && typeof window.Chart.getChart === 'function') ? window.Chart.getChart(canvas) : null;
              if (inst) inst.destroy();
            } catch {}
            chartCard.remove();
            applyMasonryLayout();
            debouncedAutoSave();
            showToast('Chart deleted.', 'info');
          };

          draw(true);
          return chartCard;
        };

        // Ensure at least one chart exists
        if (chartsContainer.querySelectorAll('.chart-card').length === 0) {
          createChartCard();
        }

        // Redraw all existing pivot charts based on their own controls
        chartsContainer.querySelectorAll('.chart-card').forEach(chartCard => {
          const canvas = chartCard.querySelector('canvas');
          const orientationSel = chartCard.querySelector('select');
          const o = (orientationSel && orientationSel.value === 'vertical') ? 'vertical' : 'horizontal';
          const cfg = computePivotChartConfig(pvt, o);
          ensureChart(canvas, cfg, true);
        });
      })();

      // Build a lightweight initialAgg for downstream (explanations can still work roughly)
      initialAgg = {
        header: [rowsDim, `${fn}(${metric})`],
        rows: pvt.rows.map(r => [r.key, r.total]),
        totalSum: pvt.grandTotal,
        rawRowsCount: usedRows.length,
        missingCount: 0,
        missingSum: 0,
        removedRows: []
      };
    } else {
      // Standard (non-pivot) aggregation path
      // Normalize share filter from snapshot: if "20" (20%), convert to 0.20
      let __normalizedFilterValue = (filterMode === 'share' && Number(filterValue) > 1)
        ? Number(filterValue) / 100
        : Number(filterValue) || 0;

      // Clamp to [0,1] for share mode
      if (filterMode === 'share') {
        __normalizedFilterValue = Math.max(0, Math.min(1, __normalizedFilterValue));
      }

      console.debug('[HistoryFix] initial render params', {
        where: job.where, usedRows: Array.isArray(usedRows) ? usedRows.length : -1,
        groupBy: job.groupBy, metric: job.metric, agg: job.agg, dateBucket: job.dateBucket || '',
        filterMode, filterValue, normalizedFilterValue: __normalizedFilterValue
      });

      initialAgg = groupAgg(usedRows, job.groupBy, job.metric, job.agg, job.dateBucket || '', {
        mode: filterMode,
        value: __normalizedFilterValue
      }, showMissing, PROFILE());

      // Fallback 1: if filter eliminates all groups, relax to 0 and retry once (any mode)
      if (Array.isArray(initialAgg?.rows) && initialAgg.rows.length === 0 && __normalizedFilterValue > 0) {
        console.warn('[Fallback] Empty initialAgg after filter =', __normalizedFilterValue, 'mode=', filterMode, '→ retry with 0');
        __normalizedFilterValue = 0;
        try { const inp = card.querySelector('.filter-input'); if (inp) inp.value = '0'; } catch {}
        initialAgg = groupAgg(usedRows, job.groupBy, job.metric, job.agg, job.dateBucket || '', {
          mode: filterMode,
          value: 0
        }, showMissing, PROFILE());
      }

      // Fallback 2: still empty → disable min share/threshold for preview
      if (Array.isArray(initialAgg?.rows) && initialAgg.rows.length === 0) {
        console.warn('[Fallback-2] Still empty after reset, disabling minGroupShare/threshold for preview render');
        initialAgg = groupAgg(usedRows, job.groupBy, job.metric, job.agg, job.dateBucket || '', {
          mode: filterMode,
          value: 0
        }, showMissing, PROFILE());
      }
      console.timeEnd(`buildAggCard:compute:${card.dataset.canonicalKey}`);

      addMissingDataWarning(card, initialAgg, (typeof usedRows !== 'undefined' ? usedRows.length : aggregationRows().length), showMissing);
      sub.textContent = `${initialAgg.rows.length} groups · ${initialAgg.header[1]}`;
      
      // Auto-uncheck obvious total-like groups on first render (do not remove; only pre-populate excluded set)
      try {
        const patExactTotal = /^\s*(?:\(\s*[A-Za-z]{2,4}\s*\)\s*)?(?:grand\s+)?(?:sub\s*)?total\s*$/i;
        const patExactSum   = /^\s*sum\s*$/i;
        const patNetTotal   = /^\s*net\s*total\s*$/i;
        const patCN         = /^(合计|小计|总计|總計|合計|小計)\s*$/;
      
        let existing = [];
        try { existing = card.dataset.excludedKeys ? JSON.parse(card.dataset.excludedKeys) : []; } catch {}
        const set = new Set(Array.isArray(existing) ? existing.map(x => String(x)) : []);
      
        for (const r of (initialAgg.rows || [])) {
          const key = String(r?.[0] ?? '').trim();
          if (patExactTotal.test(key) || patExactSum.test(key) || patNetTotal.test(key) || patCN.test(key)) {
            set.add(key);
          }
        }
        card.dataset.excludedKeys = JSON.stringify(Array.from(set));
      } catch (e) { console.warn('auto-uncheck totals (initial) failed:', e); }
      
      console.time(`buildAggCard:renderTable:${card.dataset.canonicalKey}`);
      renderAggTable(initialAgg, tableBox, 20, showMissing, { formatNumberFull });
      console.timeEnd(`buildAggCard:renderTable:${card.dataset.canonicalKey}`);

      // Log chart render start and end times per chart card
      charts.forEach((chartSnap, ci) => {
        const chartLabel = `buildAggCard:renderChart:${card.dataset.canonicalKey}:chart${ci}`;
        console.time(chartLabel);
        renderChartCard(initialAgg, chartsContainer, chartSnap.type, chartSnap.topN, title.replace(/\s+/g, '_'), {
          noAnimation,
          profile: PROFILE(),
          showToast,
          applyMasonryLayout,
          generateExplanation
        });
        console.timeEnd(chartLabel);
      });
    }

    if (explanation) {
        console.log(`📄 Using existing explanation for card: ${canonicalKey}`);
        const { contentEl, regenerateBtn } = renderExplanationCard(card, `AI Explanation for ${title}`, marked.parse(explanation));
        regenerateBtn.onclick = () => {
            contentEl.innerHTML = '<p>Generating explanation...</p>';
            regenerateBtn.disabled = true;
            generateExplanation(initialAgg, job, card);
        };
    } else if (!skipExplanation) {
        // Don't generate explanation here, instead return the task to be queued
        console.log(`📝 Creating explanation task for card: ${canonicalKey}`);
        const explanationTask = { agg: initialAgg, job, card };
        return { card, initialAgg, job, explanationTask };
    } else {
        console.log(`⏭️ Skipping explanation for card: ${canonicalKey} (skipExplanation: ${skipExplanation})`);
    }
 
    return { card, initialAgg, job };
}

async function getAiAnalysisPlan(context) {
    const columns = context.profile.columns.map(c => c.name);
    const erpPriority = getErpAnalysisPriority(columns);

    if (erpPriority && erpPriority.metrics.length > 0 && erpPriority.dimensions.length > 0) {
        console.log('[Debug] getAiAnalysisPlan: ERP priority plan detected:', JSON.stringify(erpPriority, null, 2));
        const jobs = [];
        const primaryMetric = erpPriority.metrics[0];
        console.log('[Debug] getAiAnalysisPlan: Primary metric selected:', JSON.stringify(primaryMetric, null, 2));
        
        // Create jobs based on the prioritized dimensions
        erpPriority.dimensions.forEach(dim => {
            if (dim && columns.includes(dim)) {
                jobs.push({
                    groupBy: dim,
                    metric: primaryMetric.type === 'derived' ? primaryMetric.baseMetric : primaryMetric.name,
                    agg: 'sum' // Default to sum for ERP metrics
                });
            }
        });

        return {
            tasks: [{
                description: 'Run ERP-specific analysis based on metric priorities',
                type: 'erp-analysis'
            }],
            jobs: jobs,
            planType: 'erp-analysis'
        };
    }

    // Fallback to a generic plan if no ERP pattern is matched.
    console.log('No specific ERP plan matched. Using generic fallback.');
    const plan0 = autoPlan(context.profile, context.includedRows, context.excludedDimensions);
    let jobs = (plan0 && Array.isArray(plan0.jobs)) ? plan0.jobs : [];

    // Defensive fallback for cross-tab → long pipeline:
    // If autoPlan produced 0 jobs but we have converted long rows (AGG_ROWS),
    // seed a minimal but useful plan on canonical schema.
    const hasAggRows = Array.isArray(window.AGG_ROWS) && window.AGG_ROWS.length > 0;
    // Prefer AGG_PROFILE columns; if missing expected long-schema names, fall back to AGG_ROWS keys
    let names = (context.profile?.columns || []).map(c => c.name);
    let hasValue = names.includes('Value');
    let hasPid = names.includes('ProjectId');
    let hasPname = names.includes('ProjectName');
    let hasDesc = names.includes('Description');

    if (hasAggRows && (!hasValue || !hasPid || !hasPname || !hasDesc)) {
        const row0 = (Array.isArray(window.AGG_ROWS) && window.AGG_ROWS.length) ? window.AGG_ROWS[0] : null;
        const rowNames = row0 ? Object.keys(row0) : [];
        if (!names || names.length === 0) names = rowNames;
        hasValue = hasValue || rowNames.includes('Value');
        hasPid = hasPid || rowNames.includes('ProjectId');
        hasPname = hasPname || rowNames.includes('ProjectName');
        hasDesc = hasDesc || rowNames.includes('Description');
    }

    if ((!jobs || jobs.length === 0) && hasAggRows && hasValue) {
        console.log('[Fallback] autoPlan returned 0 jobs; using canonical long-schema defaults');
        const seeded = [];
        if (hasPid)   seeded.push({ groupBy: 'ProjectId',   metric: 'Value', agg: 'sum' });
        if (hasPname) seeded.push({ groupBy: 'ProjectName', metric: 'Value', agg: 'sum' });
        if (hasDesc)  seeded.push({ groupBy: 'Description', metric: 'Value', agg: 'sum' });
        // Deduplicate defensively and cap at 6
        jobs = deduplicateJobs(seeded).slice(0, 6);
    }

    // Prefer Value as metric in long schema; demote Code/ProjectId/RawValue as metrics
    if (hasAggRows && hasValue && Array.isArray(jobs) && jobs.length > 0) {
        const bannedMetrics = new Set(['Code','ProjectId','RawValue','CORP_EC','CORP_RE','RE','EC','EC_P','Msia','Total']);
        jobs = jobs.map(j => {
            const metric = (!j.metric || bannedMetrics.has(String(j.metric))) ? 'Value' : j.metric;
            return { ...j, metric, agg: j.agg || 'sum' };
        });
        jobs = deduplicateJobs(jobs).slice(0, 10);
    }

    // Final guard: still empty → pick best-guess numeric metric and first dimension
    if (!jobs || jobs.length === 0) {
        console.warn('[Fallback] Canonical defaults unavailable; deriving a minimal job from current profile');
        const dims = (context.profile?.columns || []).filter(c => c.type === 'string').map(c => c.name);
        const nums = (context.profile?.columns || []).filter(c => c.type === 'number').map(c => c.name);
        const g = dims[0] || (columns[0] || '');
        let m = nums[0] || (hasValue ? 'Value' : '');
        if (['Code','ProjectId','RawValue'].includes(m) && hasValue) m = 'Value';
        if (g && m) jobs = [{ groupBy: g, metric: m, agg: 'sum' }];
    }

    // Enrich plan with filtered breakdowns for top Description categories (cross-tab long schema)
    try {
        if (hasAggRows && hasValue && hasDesc) {
            // Use full converted long rows for robust Top-K (context.includedRows is a tiny sample)
            const rowsSource = (Array.isArray(window.AGG_ROWS) && window.AGG_ROWS.length)
              ? window.AGG_ROWS
              : (Array.isArray(context.includedRows) ? context.includedRows : []);
            const rows = sanitizeRows(rowsSource);

            const sums = new Map();
            for (const r of rows) {
                const d = r && r.Description;
                if (d === null || d === undefined) continue;
                const dn = String(d).trim();
                if (!dn || /^total$/i.test(dn)) continue;
                let v = Number(r?.Value);
                if (!Number.isFinite(v)) {
                    const parsed = parseFloat(String(r?.Value ?? '').replace(/,/g, ''));
                    v = Number.isFinite(parsed) ? parsed : NaN;
                }
                if (!Number.isFinite(v)) continue;
                sums.set(dn, (sums.get(dn) || 0) + v);
            }

            // Top-K by Value (auto Top-10 when cross-tab → long is present)
            const topK = Array.from(sums.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);

            // Ensure common revenue terms included if present
            ['Revenue','CONSTRUCTION CONTRACT REVENUE'].forEach(label => {
                if (sums.has(label) && !topK.includes(label)) topK.push(label);
            });

            const filtered = [];
            for (const desc of topK) {
                filtered.push({ groupBy: 'ProjectId', metric: 'Value', agg: 'sum', where: { Description: desc } });
            }
            if (filtered.length) {
                jobs = deduplicateJobs([...(jobs || []), ...filtered]).slice(0, 12);
            }
        }
    } catch (e) {
        console.warn('Top-K Description breakdown planning failed:', e);
    }

    // Add a Pivot template (Description × ProjectId) for long schema
    try {
        if (hasAggRows && hasValue && hasDesc && hasPid) {
            const pivotJob = {
                type: 'pivot',
                rowsDim: 'Description',
                colsDim: 'ProjectId',
                metric: 'Value',
                agg: 'sum',
                pivotOptions: { topCols: 12, topRows: 30 }
            };
            jobs = deduplicateJobs([...(jobs || []), pivotJob]).slice(0, 12);
        }
    } catch (e) {
        console.warn('Pivot job planning failed:', e);
    }

    return {
        tasks: [{
            description: 'Run standard automatic analysis',
            type: 'auto-analysis'
        }],
        jobs,
        planType: 'auto-analysis'
    };
}

async function getIntelligentAiAnalysisPlan(context) {
    console.log('[Debug] getIntelligentAiAnalysisPlan: Starting AI Agent analysis');
    
    // Get API settings
    const apiKey = localStorage.getItem('gemini_api_key');
    const model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
    
    if (!isValidApiKey(apiKey)) {
        console.log('[Debug] No valid API key found, falling back to standard auto plan');
        const plan = autoPlan(context.profile, context.includedRows, context.excludedDimensions);
        return {
            tasks: [{
                description: 'Running standard analysis (no valid API key provided)',
                type: 'auto-analysis-fallback'
            }],
            jobs: plan.jobs,
            planType: 'auto-analysis-fallback'
        };
    }

    try {
        // Prepare data profile for AI analysis
        const dataProfile = {
            columns: context.profile.columns.map(col => ({
                name: col.name,
                type: col.type,
                uniqueValues: col.uniqueValues,
                sampleValues: col.values ? col.values.slice(0, 5) : []
            })),
            rowCount: context.profile.rowCount,
            // Use a larger sample so the model can infer schema/patterns better
            sampleRows: context.includedRows.slice(0, 50)
        };

        const prompt = `You are an expert data analyst. Analyze this dataset and create a comprehensive analysis plan.

Dataset Profile:
${JSON.stringify(dataProfile, null, 2)}

Create an analysis plan with the following structure:
1. Identify key metrics (numerical columns for calculations)
2. Identify key dimensions (categorical columns for grouping)
3. Suggest 3-5 meaningful aggregations that will reveal insights
4. For each aggregation, specify: groupBy column, metric column, aggregation type (sum/avg/count/max/min)

Return your response as JSON in this exact format:
{
    "jobs": [
        {"groupBy": "column_name", "metric": "metric_column", "agg": "sum|avg|count|max|min"}
    ],
    "planType": "intelligent-analysis",
    "reasoning": "Brief explanation of why these aggregations were chosen"
}

IMPORTANT: Do NOT include a "tasks" array in your response. The system will automatically generate appropriate workflow tasks based on the jobs you specify.

Focus on creating meaningful business insights. Prioritize aggregations that will show trends, comparisons, and patterns in the data.`;

        console.log('[Debug] Calling Gemini API for intelligent analysis plan');
        
        // ✅ UPDATE UI: Show API call in progress
        const container = document.getElementById('ai-todo-list-section');
        const todoList = document.getElementById('ai-todo-list');
        const progressBar = document.getElementById('ai-progress-bar');
        const currentTaskDetails = document.getElementById('ai-current-task-details');
        
        if (container && todoList && progressBar && currentTaskDetails) {
            // Update progress to show API call
            progressBar.style.width = '15%';
            progressBar.setAttribute('aria-valuenow', 15);
            
            currentTaskDetails.innerHTML = `
                <div class="current-task-info">
                    <div class="task-spinner">🌐</div>
                    <div class="task-description">Calling Gemini API for intelligent analysis...</div>
                    <div class="task-timing">Analyzing your data structure and generating plan</div>
                </div>
            `;
            
            // Override CSS !important rules
            todoList.style.setProperty('display', 'block', 'important');
            todoList.style.setProperty('visibility', 'visible', 'important');
            todoList.style.setProperty('opacity', '1', 'important');
            todoList.style.setProperty('height', 'auto', 'important');
            todoList.style.setProperty('overflow', 'visible', 'important');
            
            todoList.innerHTML = `
                <li class="task-item task-in-progress" style="display: block !important; visibility: visible !important; opacity: 1 !important; height: auto !important; overflow: visible !important;">
                    <div class="task-content">
                        <span class="task-icon in-progress">🌐</span>
                        <div class="task-info">
                            <div class="task-description">Calling Gemini API for intelligent analysis...</div>
                            <div class="task-timestamp">${new Date().toLocaleTimeString()}</div>
                        </div>
                    </div>
                </li>
            `;
            
            console.log('🌐 Updated UI to show Gemini API call in progress');
        }
        
        const response = await fetchWithRetry(apiKey, model, prompt, (msg, type) => {
            if (typeof showToast === 'function') {
                showToast(msg, type);
            }
        });

        // ✅ UPDATE UI: Show response processing
        if (container && todoList && progressBar && currentTaskDetails) {
            progressBar.style.width = '25%';
            progressBar.setAttribute('aria-valuenow', 25);
            
            currentTaskDetails.innerHTML = `
                <div class="current-task-info">
                    <div class="task-spinner">⚙️</div>
                    <div class="task-description">Processing AI response and generating tasks...</div>
                    <div class="task-timing">Creating concrete workflow tasks</div>
                </div>
            `;
            
            // Override CSS !important rules  
            todoList.style.setProperty('display', 'block', 'important');
            todoList.style.setProperty('visibility', 'visible', 'important');
            todoList.style.setProperty('opacity', '1', 'important');
            todoList.style.setProperty('height', 'auto', 'important');
            todoList.style.setProperty('overflow', 'visible', 'important');
            
            todoList.innerHTML = `
                <li class="task-item task-in-progress" style="display: block !important; visibility: visible !important; opacity: 1 !important; height: auto !important; overflow: visible !important;">
                    <div class="task-content">
                        <span class="task-icon in-progress">⚙️</span>
                        <div class="task-info">
                            <div class="task-description">Processing AI response and generating tasks...</div>
                            <div class="task-timestamp">${new Date().toLocaleTimeString()}</div>
                        </div>
                    </div>
                </li>
            `;
            
            console.log('⚙️ Updated UI to show response processing');
        }
        
        // Parse AI response — Robust extraction (code-fence + fallback + light cleanup)
        let aiPlan;
        let __aiRawJobsCount = 0;
        try {
            const extractJson = (text) => {
                if (typeof text !== 'string') return null;
                // 1) Prefer fenced ```json ... ```
                let m = text.match(/```json\s*([\s\S]*?)\s*```/i);
                if (m && m[1]) return m[1].trim();
                // 2) Any fenced ``` ... ```
                m = text.match(/```\s*([\s\S]*?)\s*```/);
                if (m && m[1]) return m[1].trim();
                // 3) First {...} to last } slice
                const first = text.indexOf('{');
                const last = text.lastIndexOf('}');
                if (first !== -1 && last !== -1 && last > first) {
                    return text.slice(first, last + 1).trim();
                }
                return text.trim();
            };
            let jsonString = extractJson(response);
            try {
                aiPlan = JSON.parse(jsonString);
            } catch (e1) {
                // Light cleanup: strip stray backticks + trailing commas before } or ]
                const cleaned = (jsonString || '')
                    .replace(/^[`]+|[`]+$/g, '')
                    .replace(/,\s*([}\]])/g, '$1');
                aiPlan = JSON.parse(cleaned);
            }
            __aiRawJobsCount = Array.isArray(aiPlan?.jobs) ? aiPlan.jobs.length : 0;
            
            // Validate the plan structure
            if (!aiPlan.jobs || !Array.isArray(aiPlan.jobs)) {
                throw new Error('Invalid plan structure from AI');
            }

            // Validate + normalize jobs (relaxed rules):
            // - allow count without metric
            // - map avg -> sum (business-friendly default)
            // - for sum/min/max, backfill a reasonable numeric metric if missing/invalid
            const columnNames = context.profile.columns.map(c => c.name);
            const numericCols = context.profile.columns.filter(c => c.type === 'number').map(c => c.name);
            let __validJobsCount = 0;
            const normalizedJobs = (aiPlan.jobs || [])
                .map(job => {
                    let agg = String(job.agg || '').toLowerCase();
                    const groupBy = job.groupBy;
                    let metric = job.metric;

                    // map avg -> sum by default (avg is often misleading for transactional data)
                    if (agg === 'avg') agg = 'sum';

                    if ((!metric || !columnNames.includes(metric)) && ['sum','min','max'].includes(agg)) {
                        metric = preferFinancialMetric(numericCols) || numericCols[0] || metric || null;
                    }

                    return { ...job, agg, groupBy, metric: metric || null };
                })
                .filter(job =>
                    columnNames.includes(job.groupBy) &&
                    (job.agg === 'count' || (job.metric && columnNames.includes(job.metric))) &&
                    ['sum', 'count', 'max', 'min'].includes(job.agg)
                );
            aiPlan.jobs = normalizedJobs;
            __validJobsCount = normalizedJobs.length;

            console.log('[Debug] AI Generated Plan:', JSON.stringify(aiPlan, null, 2));
            
            // Build additional Top-K Description filtered jobs (cross-tab → long) as reinforcement
            let additionalJobs = [];
            try {
                const names = (context.profile?.columns || []).map(c => c.name);
                const hasDesc = names.includes('Description');
                const hasValue = names.includes('Value');
                const hasPid = names.includes('ProjectId');

                if (hasDesc) {
                    // Prefer converted long rows for robust Top-K
                    const rowsSource = (Array.isArray(window.AGG_ROWS) && window.AGG_ROWS.length)
                        ? window.AGG_ROWS
                        : (Array.isArray(context.includedRows) ? context.includedRows : []);

                    const numCols = (context.profile?.columns || []).filter(c => c.type === 'number').map(c => c.name);
                    const metricName = hasValue ? 'Value' : (preferFinancialMetric(numCols) || numCols[0] || null);
                    const groupByName = hasPid ? 'ProjectId' : ((context.profile?.columns || []).find(c => c.type === 'string')?.name || 'Description');

                    if (metricName) {
                        const sums = new Map();
                        for (const r of rowsSource || []) {
                            const d = (r && r.Description != null) ? String(r.Description).trim() : '';
                            if (!d || /^total$/i.test(d)) continue;
                            let v = Number(r?.[metricName]);
                            if (!Number.isFinite(v)) {
                                const parsed = parseFloat(String(r?.[metricName] ?? '').replace(/,/g, ''));
                                v = Number.isFinite(parsed) ? parsed : NaN;
                            }
                            if (!Number.isFinite(v)) continue;
                            sums.set(d, (sums.get(d) || 0) + v);
                        }
                        const topK = Array.from(sums.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);
                        additionalJobs = topK.map(desc => ({
                            groupBy: groupByName,
                            metric: metricName,
                            agg: 'sum',
                            where: { Description: desc }
                        }));
                    }
                }
            } catch (e) {
                console.warn('Top-K Description reinforcement failed:', e);
            }

            // Merge AI plan with auto plan and reinforcement, then cap by context.maxCharts
            const fallbackPlan = autoPlan(context.profile, context.includedRows, context.excludedDimensions) || { jobs: [] };
            const mergedJobs = deduplicateJobs([
                ...(aiPlan.jobs || []),
                ...((fallbackPlan.jobs || [])),
                ...additionalJobs
            ]);
            const limit = Number(context.maxCharts) || 12;
            const limitedJobs = mergedJobs.slice(0, limit);

            // Expose pipeline stats for Workflow UI
            try {
                window.__AI_PLAN_STATS = {
                    ai: __aiRawJobsCount,
                    valid: __validJobsCount,
                    auto: Array.isArray(fallbackPlan.jobs) ? fallbackPlan.jobs.length : 0,
                    desc: additionalJobs.length,
                    merged: mergedJobs.length,
                    final: limitedJobs.length
                };
                if (window.WorkflowManager && typeof window.WorkflowManager.updateCurrentTaskMessage === 'function') {
                    const s = window.__AI_PLAN_STATS;
                    window.WorkflowManager.updateCurrentTaskMessage(
                        `Jobs pipeline: AI ${s.ai} → valid ${s.valid} + auto ${s.auto} + desc ${s.desc} ⇒ merged ${s.merged}, limited ${s.final}`
                    );
                }
            } catch (e) { console.warn('Failed to update AI plan stats:', e); }

            const workflowTasks = [];
            
            // Add chart generation tasks
            limitedJobs.forEach((job, index) => {
                const chartType = job.agg === 'count'
                    ? 'bar chart'
                    : (job.agg === 'sum' || job.agg === 'avg' ? 'bar chart' : 'data table');
                workflowTasks.push({
                    description: `Building ${chartType}: ${job.agg}(${job.metric ?? '*'}) by ${job.groupBy}`,
                    type: 'chart-generation',
                    jobIndex: index
                });
            });
            
            // Add AI explanation tasks
            limitedJobs.forEach((job, index) => {
                workflowTasks.push({
                    description: `Generating AI explanation for ${job.groupBy} analysis`,
                    type: 'ai-explanation',
                    jobIndex: index
                });
            });
            
            // Add completion task
            workflowTasks.push({
                description: 'Completing AI Agent analysis workflow',
                type: 'workflow-completion'
            });
            
            console.log('[Debug] Generated concrete workflow tasks:', workflowTasks.map(t => t.description));
            
            // ✅ FINAL UPDATE: Show tasks ready to load
            if (container && todoList && progressBar && currentTaskDetails) {
                progressBar.style.width = '35%';
                progressBar.setAttribute('aria-valuenow', 35);
                
                currentTaskDetails.innerHTML = `
                    <div class="current-task-info">
                        <div class="task-spinner">✅</div>
                        <div class="task-description">AI Agent plan ready - loading ${workflowTasks.length} tasks...</div>
                        <div class="task-timing">About to start chart generation</div>
                    </div>
                `;
                
                // Override CSS !important rules
                todoList.style.setProperty('display', 'block', 'important');
                todoList.style.setProperty('visibility', 'visible', 'important');
                todoList.style.setProperty('opacity', '1', 'important');
                todoList.style.setProperty('height', 'auto', 'important');
                todoList.style.setProperty('overflow', 'visible', 'important');
                
                todoList.innerHTML = `
                    <li class="task-item task-completed" style="display: block !important; visibility: visible !important; opacity: 1 !important; height: auto !important; overflow: visible !important;">
                        <div class="task-content">
                            <span class="task-icon completed">✅</span>
                            <div class="task-info">
                                <div class="task-description">AI Agent plan generated - ${workflowTasks.length} tasks ready</div>
                                <div class="task-timestamp">${new Date().toLocaleTimeString()}</div>
                            </div>
                        </div>
                    </li>
                `;
                
                console.log('✅ AI Agent plan ready - about to load tasks');
            }
            
            return {
                tasks: workflowTasks,
                jobs: limitedJobs,
                planType: aiPlan.planType || 'intelligent-analysis',
                reasoning: aiPlan.reasoning
            };

        } catch (parseError) {
            console.error('[Debug] Failed to parse AI response:', parseError);
            throw new Error('Failed to parse AI analysis plan');
        }

    } catch (error) {
        console.error('[Debug] Error in intelligent AI analysis:', error);
        console.log('[Debug] Falling back to standard auto plan');
        
        // Fallback to standard auto plan
        const plan = autoPlan(context.profile, context.includedRows, context.excludedDimensions);
        return {
            tasks: [{
                description: 'Running standard analysis (AI analysis failed)',
                type: 'auto-analysis-fallback'
            }],
            jobs: plan.jobs,
            planType: 'auto-analysis-fallback'
        };
    }
}

async function renderAggregates(chartsSnapshot = null, excludedDimensions = [], fallbackDepth = 0, retry = false) {
    if (!ROWS()) return showToast('Load a CSV first.', 'error');
    // Ensure AI Chat has access to the latest dataset
    if (!window.currentData || window.currentData.length === 0) {
        window.currentData = ROWS();
    }

     // Enhanced concurrent execution prevention
    if (window.window.isRenderingAggregates && !retry && MODE() !== 'manual') {
        console.log('⏸️ renderAggregates already running, queueing next run');
        window.window.pendingRender = true;
        return;
    }
    
    // Check WorkflowManager state for additional protection
    const WorkflowManager = window.WorkflowManager;
    const AITasks = window.AITasks;
    if (WorkflowManager && typeof WorkflowManager.getState === 'function') {
        const workflowState = (WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' });
        if (workflowState.status === 'running' && !retry && MODE() !== 'manual') {
            console.log('⏸️ WorkflowManager indicates workflow is running, skipping new execution');
            showToast('Workflow is already running. Please wait for completion.', 'warning');
            return;
        }
    }
    
    window.window.isRenderingAggregates = true;
    setGenerateButtonState(true); // Disable button when workflow starts
    console.log('🚀 Starting renderAggregates', { chartsSnapshot: !!chartsSnapshot, retry });

    try {
        const includedRows = (window.AGG_ROWS && Array.isArray(window.AGG_ROWS)) ? window.AGG_ROWS : getIncludedRows();
        try { updateGlobalDescControls(); } catch {}
        if (includedRows.length === 0) {
            showToast('No rows selected for aggregation. Please check some rows in the Raw Data table.', 'warning');
            return;
        }

        const grid = $('#results');
        if (!grid) {
            console.error('Results container not found');
            showToast('Results container not found. Please refresh the page.', 'error');
            return;
        }
        
        // Always clear the grid when starting fresh (not a retry)
        if (!retry) {
            console.log('🧹 Clearing existing aggregates');
            grid.innerHTML = '';
        }

        if (chartsSnapshot && chartsSnapshot.length > 0) {
            window.safeReset(window.MODE);
            for (const cardSnap of chartsSnapshot) {
                const jobKey = cardSnap.cardJobKey || {};
                const result = await buildAggCard(jobKey, cardSnap);
                const newCard = result.card || result;
                grid.appendChild(newCard);
            }
            setTimeout(applyMasonryLayout, 150);
            setTimeout(applyMasonryLayout, 500);
        } else {
            const plan = await runAiWorkflow(includedRows, excludedDimensions);
            
            if (plan && plan.jobs) {
                // Create session ID for this aggregation batch
                const aggregationSessionId = `agg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                window.currentAggregationSession = aggregationSessionId;
                console.log(`🆔 Starting aggregation session: ${aggregationSessionId}`);
                
                // Use canonical deduplication (more robust than manual dedup)
                const uniqueJobs = deduplicateJobs(plan.jobs);
                if (uniqueJobs.length !== plan.jobs.length) {
                    plan.jobs = uniqueJobs;
                }
                
                const explanationQueue = [];
                
                const processJobsIncrementally = async () => {
                    for (let i = 0; i < plan.jobs.length; i++) {
                        const job = plan.jobs[i];
                        if ((WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' }).status !== 'running' || window.currentAggregationSession !== aggregationSessionId) {
                            break;
                        }
                        
                        console.log(`🔨 Building card ${i + 1}/${plan.jobs.length}: ${job.agg}(${job.metric}) by ${job.groupBy} [session: ${aggregationSessionId}]`);
                        const result = await buildAggCard(job, {}, aggregationSessionId);
                        
                        if (result && window.currentAggregationSession === aggregationSessionId) {
                            grid.appendChild(result.card);
            try { window.forceAutoSave && window.forceAutoSave('card-built', true); } catch {}
                            if (result.explanationTask) {
                                explanationQueue.push(result.explanationTask);
                            }
                            
                            // Complete AI Agent chart generation task if in AI Agent mode
                            if (MODE() === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                                const chartTaskDescription = `Building ${job.agg === 'count' ? 'bar chart' : job.agg === 'sum' || job.agg === 'avg' ? 'bar chart' : 'data table'}: ${job.agg}(${job.metric}) by ${job.groupBy}`;
                                console.log(`✅ Completing AI Agent chart task: ${chartTaskDescription}`);
                                try {
                                    const completed = AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), chartTaskDescription);
                                    if (!completed) {
                                        console.log(`⚠️ Chart task not found for completion: ${chartTaskDescription} - this is normal if workflow was reset`);
                                    }
                                } catch (error) {
                                    console.log(`⚠️ Failed to complete chart task ${chartTaskDescription}:`, error.message);
                                }
                            }
                        }
                    }
                };

                await processJobsIncrementally();

                // Process explanation queue BEFORE completing analysis tasks
                if (explanationQueue.length > 0) {
                    console.log(`⏳ Starting sequential generation of ${explanationQueue.length} explanation(s)...`);
                    for (let i = 0; i < explanationQueue.length; i++) {
                        const task = explanationQueue[i];
                        WorkflowManager.updateCurrentTaskMessage(`Generating explanation ${i + 1} of ${explanationQueue.length}...`);
                        await generateExplanation(task.agg, task.job, task.card);
                        console.log(`✅ Explanation ${i + 1} completed.`);
                        
                        // Complete AI Agent explanation task if in AI Agent mode
                        if (MODE() === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                            const explanationTaskDescription = `Generating AI explanation for ${task.job.groupBy} analysis`;
                            console.log(`✅ Completing AI Agent explanation task: ${explanationTaskDescription}`);
                            try {
                                const completed = AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), explanationTaskDescription);
                                if (!completed) {
                                    console.log(`⚠️ Task not found for completion: ${explanationTaskDescription} - this is normal if workflow was reset`);
                                }
                            } catch (error) {
                                console.log(`⚠️ Failed to complete task ${explanationTaskDescription}:`, error.message);
                            }
                        }
                        
                        console.log(`🔄 Triggering auto-save after explanation ${i + 1}...`);
                        debouncedAutoSave();
                    }
                    console.log('✅ All explanations completed sequentially.');
                } else {
                    console.log('ℹ️ No explanations to generate');
                }
                
                // Complete AI Agent workflow completion task if in AI Agent mode
                if (MODE() === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                    console.log('✅ Completing AI Agent workflow completion task');
                    try {
                        const completed = AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), 'Completing AI Agent analysis workflow');
                        if (!completed) {
                            console.log(`⚠️ Workflow completion task not found - this is normal if workflow was reset`);
                        }
                    } catch (error) {
                        console.log(`⚠️ Failed to complete workflow task:`, error.message);
                    }
                    
                    // Ensure WorkflowManager is also completed for AI Agent mode
                    console.log('✅ Ensuring WorkflowManager completion for AI Agent mode');
                    if ((WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' }).status === 'running') {
                        // Complete any remaining WorkflowManager tasks for AI Agent mode
                        const currentState = (WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' });
                        const pendingTasks = currentState.tasks.filter(t => t.status === 'pending' || t.status === 'in-progress');
                        
                        pendingTasks.forEach(task => {
                            if (task.id !== 'ai-analysis') { // ai-analysis is completed above
                                console.log(`✅ Auto-completing WorkflowManager task: ${task.id}`);
                                WorkflowManager.completeTask(task.id, 'Completed as part of AI Agent workflow');
                            }
                        });
                    }
                }
                
                // Mark rendering as complete now that explanations are done
                console.log('🏁 All work including explanations completed, releasing render lock');
                window.isRenderingAggregates = false;
                setGenerateButtonState(false); // Re-enable button when workflow completes
                
                // Process any pending renders
                if (window.pendingRender) {
                    const wasPending = window.pendingRender;
                    window.pendingRender = false;
                    console.log('🔁 Running queued renderAggregates after explanations');
                    setTimeout(() => {
                        try { renderAggregates(null, [], 0, true); } catch (e) { console.error(e); }
                    }, 100);
                }

                // Complete analysis task now that we're ready to build cards
                if (plan.planType === 'auto-analysis') {
                   WorkflowManager.completeTask('auto-analysis', 'AI analysis plan created. Building cards...');
                } else if (plan.planType === 'erp-analysis') {
                   WorkflowManager.completeTask('erp-analysis', 'ERP analysis completed. Building cards...');
                } else if (plan.planType === 'intelligent-analysis') {
                   WorkflowManager.completeTask('ai-analysis', 'Intelligent AI analysis completed. Building cards...');
                } else if (plan.planType === 'auto-analysis-fallback') {
                   WorkflowManager.completeTask('auto-analysis', 'Fallback analysis completed. Building cards...');
                }
                
                if ((WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' }).status === 'running') {
                    // Complete rendering task only if it exists (not in ERP workflow)
                    console.log(`🔍 Checking rendering task completion: planType = ${plan.planType}`);
                    if (plan.planType !== 'erp-analysis') {
                        console.log('📝 Completing rendering task (non-ERP workflow)');
                        WorkflowManager.completeTask('rendering');
                    } else {
                        console.log('⏭️ Skipping rendering task (ERP workflow)');
                    }
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    WorkflowManager.completeTask('ai-explanation');
                    await new Promise(resolve => setTimeout(resolve, 50));
                    WorkflowManager.completeTask('completion');
                    
                    
                    // Stop timer and cleanup on completion
                    workflowTimer.stop();
                    console.log('⏹️ Workflow timer stopped on completion');
                    
                    // Force a final UI update to show completion state
                    setTimeout(() => {
                        const finalState = (WorkflowManager && WorkflowManager.getState ? WorkflowManager.getState() : { status: 'idle' });
                        console.log('🔍 Final workflow state:', finalState.status, finalState.tasks.map(t => `${t.description}: ${t.status}`));
                        updateAiTodoList(finalState);
                    }, 100);
                    
                    showToast('Analysis completed successfully.', 'success');
                    
                    // Auto-save after successful card generation (force save to bypass workflow running check)
                    console.log('💾 Force-saving after AI Agent workflow completion...');
                    setTimeout(() => {
                        if (typeof window.forceAutoSave === 'function') {
                            window.forceAutoSave('ai-agent-completion');
                        } else {
                            debouncedAutoSave();
                        }
                    }, 200); // Wait for WorkflowManager state to fully update
                }
                setTimeout(applyMasonryLayout, 150);
                setTimeout(applyMasonryLayout, 500);
            } else {
                // Fallback when AI workflow fails: use basic auto plan
                console.log('🔄 AI workflow failed, falling back to basic auto plan');
                const fallbackPlan = autoPlan(PROFILE(), includedRows, excludedDimensions);
                
                if (fallbackPlan && fallbackPlan.jobs) {
                    // Create session ID for this aggregation batch
                    const aggregationSessionId = `agg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    window.currentAggregationSession = aggregationSessionId;
                    console.log(`🆔 Starting fallback aggregation session: ${aggregationSessionId}`);
                    
                    // Use canonical deduplication
                    const uniqueJobs = deduplicateJobs(fallbackPlan.jobs);
                    if (uniqueJobs.length !== fallbackPlan.jobs.length) {
                        fallbackPlan.jobs = uniqueJobs;
                    }
                    
                    // Build cards for fallback plan (without AI explanations)
                    for (let i = 0; i < fallbackPlan.jobs.length; i++) {
                        const job = fallbackPlan.jobs[i];
                        console.log(`🔨 Building fallback card ${i + 1}/${fallbackPlan.jobs.length}: ${job.agg}(${job.metric}) by ${job.groupBy}`);
                        const result = await buildAggCard(job, {}, aggregationSessionId, { skipExplanation: true });
                        
                        if (window.currentAggregationSession === aggregationSessionId) {
                            grid.appendChild(result.card);
            try { window.forceAutoSave && window.forceAutoSave('card-built', true); } catch {}
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    
                    setTimeout(applyMasonryLayout, 150);
                    setTimeout(applyMasonryLayout, 500);
                    showToast('Analysis completed using basic plan (AI workflow failed).', 'warning');
                    
                    // Auto-save after fallback card generation
                    debouncedAutoSave();
                    
                    // Release render lock for fallback path
                    console.log('🏁 Fallback plan completed, releasing render lock');
                    window.isRenderingAggregates = false;
                    setGenerateButtonState(false); // Re-enable button after fallback
                    
                    // Process any pending renders
                    if (window.pendingRender) {
                        const wasPending = window.pendingRender;
                        window.pendingRender = false;
                        console.log('🔁 Running queued renderAggregates after fallback');
                        setTimeout(() => {
                            try { renderAggregates(null, [], 0, true); } catch (e) { console.error(e); }
                        }, 100);
                    }
                } else {
                    // No fallback plan available
                    console.log('🏁 No fallback plan available, releasing render lock');
                    window.isRenderingAggregates = false;
                    setGenerateButtonState(false); // Re-enable button when no fallback available
                    
                    if (window.pendingRender) {
                        const wasPending = window.pendingRender;
                        window.pendingRender = false;
                        console.log('🔁 Running queued renderAggregates after no-plan scenario');
                        setTimeout(() => {
                            try { renderAggregates(null, [], 0, true); } catch (e) { console.error(e); }
                        }, 100);
                    }
                }
            }
        }
        
        // After all cards are rendered (either from snapshot or new plan), generate the summary
        checkAndGenerateAISummary();

        // Initialize AI Analysis Chat after aggregates are ready
        setTimeout(() => {
            try {
                const apiKey = localStorage.getItem('gemini_api_key');
                if (typeof window.initializeChat === 'function' && window.currentData && window.currentData.length > 0 && isValidApiKey(apiKey)) {
                    const chatSection = document.getElementById('ai-analysis-section');
                    if (chatSection) {
                        chatSection.style.display = 'block';
                    }
                    window.initializeChat();
                }
            } catch (e) {
                console.warn('AI Analysis Chat initialization failed:', e);
            }
        }, 400);
        
    } finally {
        // Don't reset window.isRenderingAggregates here if explanations are still running
        // The flag will be reset after explanations complete (see explanation completion logic above)
        console.log('✅ renderAggregates main phase completed, keeping render lock for explanations');
    }
}

// Global Description filter utilities for CSV Input section
function computeDescValues() {
  try {
    const prof2 = PROFILE?.() || window.AGG_PROFILE || window.PROFILE || {};
    const hasDesc = Array.isArray(prof2.columns) && prof2.columns.some(c => c.name === 'Description');
    if (!hasDesc) return { descValues: [], sums: new Map(), hasDesc: false, profile: prof2 };

    const baseRows = (window.AGG_ROWS && Array.isArray(window.AGG_ROWS)) ? window.AGG_ROWS : aggregationRows();
    const sums = new Map();
    const set = new Set();
    for (const r of baseRows) {
      const d = (r && r.Description != null) ? String(r.Description).trim() : '';
      if (!d || /^total$/i.test(d)) continue;
      set.add(d);
      let v = Number(r?.Value);
      if (!Number.isFinite(v)) {
        const parsed = parseFloat(String(r?.Value ?? '').replace(/,/g, ''));
        v = Number.isFinite(parsed) ? parsed : 0;
      }
      sums.set(d, (sums.get(d) || 0) + v);
    }
    const descValues = Array.from(set.values())
      .sort((a, b) => (sums.get(b) || 0) - (sums.get(a) || 0))
      .slice(0, 200);
    return { descValues, sums, hasDesc: true, profile: prof2 };
  } catch (e) {
    console.warn('computeDescValues failed:', e);
    return { descValues: [], sums: new Map(), hasDesc: false, profile: {} };
  }
}

function initGlobalDescControls(containerEl = null) {
  try {
    const container = containerEl || document.getElementById('global-desc-filter-controls');
    const bar = document.getElementById('global-desc-filter-bar') || (container && container.closest('#global-desc-filter-bar')) || null;
    if (!container) return false;

    const { descValues, sums, hasDesc, profile: prof2 } = computeDescValues();
    if (!hasDesc || descValues.length === 0) {
      if (bar) bar.style.display = 'none';
      container.innerHTML = '';
      return false;
    }

    if (bar) bar.style.display = '';
    container.innerHTML = `
      <label>Filter by Description:
        <select class="desc-select" style="min-width:220px">
          <option value="">— choose —</option>
          ${descValues.map(v => `<option value="${v}">${v}</option>`).join('')}
        </select>
      </label>
      <button class="desc-add btn-secondary">Add Filtered Card</button>
      <button class="desc-gen btn-secondary" title="Generate Top 10 Description cards">Generate Top 10</button>
    `;

    const buildFilteredJob = (desc) => {
      const names = (prof2.columns || []).map(c => c.name);
      const groupBy = names.includes('ProjectId')
        ? 'ProjectId'
        : ((prof2.columns || []).find(c => c.type === 'string')?.name || 'Description');
      const metric = names.includes('Value')
        ? 'Value'
        : ((prof2.columns || []).find(c => c.type === 'number')?.name || '');
      return { groupBy, metric, agg: metric ? 'sum' : 'count', where: { Description: desc } };
    };

    const selectEl = container.querySelector('.desc-select');
    const addBtn = container.querySelector('.desc-add');
    const genBtn = container.querySelector('.desc-gen');

    addBtn.onclick = async () => {
      const val = selectEl.value;
      if (!val) { showToast('Select a Description first.', 'warning'); return; }
      const job2 = buildFilteredJob(val);
      const grid = document.querySelector('#results');
      const res = await buildAggCard(job2, {}, window.currentAggregationSession || null);
      if (res && res.card) {
        grid.appendChild(res.card);
            try { window.forceAutoSave && window.forceAutoSave('card-built', true); } catch {}
        try {
          if (res.explanationTask) {
            await generateExplanation(res.explanationTask.agg, res.explanationTask.job, res.explanationTask.card);
          } else if (res.initialAgg) {
            await generateExplanation(res.initialAgg, job2, res.card);
          }
        } catch (e) {
          console.warn('Global desc-add explanation generation failed:', e);
        }
        try { checkAndGenerateAISummary(); } catch {}
        applyMasonryLayout();
        debouncedAutoSave();
        showToast(`Added filtered card for Description=${val}`, 'success');
      }
    };

    genBtn.onclick = async () => {
      const topList = Array.from(sums.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 10).map(([k])=>k);
      const grid = document.querySelector('#results');
      const explanationTasks = [];
      for (const label of topList) {
        const job2 = buildFilteredJob(label);
        const res = await buildAggCard(job2, {}, window.currentAggregationSession || null);
        if (res && res.card) {
          grid.appendChild(res.card);
            try { window.forceAutoSave && window.forceAutoSave('card-built', true); } catch {}
          if (res.explanationTask) {
            explanationTasks.push(res.explanationTask);
          } else if (res.initialAgg) {
            explanationTasks.push({ agg: res.initialAgg, job: job2, card: res.card });
          }
        }
      }
      try {
        for (const task of explanationTasks) {
          await generateExplanation(task.agg, task.job, task.card);
        }
      } catch (e) {
        console.warn('Global desc-gen explanation generation failed:', e);
      }
      try { checkAndGenerateAISummary(); } catch {}
      applyMasonryLayout();
      debouncedAutoSave();
      showToast('Generated top 10 Description filtered cards.', 'success');
    };
    return true;
  } catch (e) {
    console.warn('initGlobalDescControls failed:', e);
    return false;
  }
}

function updateGlobalDescControls(containerEl = null) {
  try {
    const container = containerEl || document.getElementById('global-desc-filter-controls');
    const bar = document.getElementById('global-desc-filter-bar') || (container && container.closest('#global-desc-filter-bar')) || null;
    if (!container) return false;

    const { descValues, hasDesc } = computeDescValues();
    if (!hasDesc || descValues.length === 0) {
      if (bar) bar.style.display = 'none';
      container.innerHTML = '';
      return false;
    }

    const selectEl = container.querySelector('.desc-select');
    if (!selectEl) {
      // Not initialized yet; create from scratch
      return initGlobalDescControls(container);
    }

    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">— choose —</option>` + descValues.map(v => `<option value="${v}">${v}</option>`).join('');
    if (current && descValues.includes(current)) {
      selectEl.value = current;
    }
    if (bar) bar.style.display = '';
    return true;
  } catch (e) {
    console.warn('updateGlobalDescControls failed:', e);
    return false;
  }
}

// Export the functions for use in the main file
export {
    buildAggCard,
    getAiAnalysisPlan,
    getIntelligentAiAnalysisPlan,
    renderAggregates,
    setGenerateButtonState,
    initGlobalDescControls,
    updateGlobalDescControls,
    computeDescValues
};