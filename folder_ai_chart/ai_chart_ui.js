import * as Store from './ai_chart_store.js';
import { fetchWithRetry } from './ai_chart_api.js';
import { initializeAiSettingsHandlers, updateAIFeaturesVisibility, isValidApiKey } from './ai_chart_ai_settings_handlers.js';
import { initializeSectionToggles } from './ai_chart_section_toggle_logic.js';
import { getErpSpecificAutoPlan, getErpMetricPriority, getErpAnalysisPriority } from './ai_chart_erp_logic.js';
import { applyMasonryLayout } from './ai_chart_masonry.js';
import { getMetricPriority, selectBestMetricColumn, pickPrimaryMetric, buildErpPlan } from './ai_chart_erp_metrics.js';
import { inferType, profile, renderProfile, inferRole, detectTemporalPatterns, detectHierarchicalRelationships } from './ai_chart_profile.js';
import { parseCsvNumber, isNum, toNum, parseDateSafe } from './ai_chart_utils.js';
import { groupAgg, bucketDate, normalizeGroupKey, computeChartConfig, ensureChart, renderChartCard, renderAggTable, addMissingDataWarning, canonicalJobKey, deduplicateJobs, nice } from './ai_chart_aggregates.js';
import { parseCSV, workerAggregateWithFallback, workflowTimer, apiHandler, GeminiAPI } from './ai_chart_engine.js';
import { updateAiTodoList } from './ai_chart_ui_workflow.js';
// Smart default mode selector
function getDefaultMode() {
  const hasApiKey = isValidApiKey(localStorage.getItem('gemini_api_key'));
  const userPreference = localStorage.getItem('default_generate_mode');
  if (hasApiKey && userPreference === 'ai_agent') {
    return 'ai_agent';
  }
  return 'auto';
}
import { showToast } from './ai_chart_toast_system.js';
import { initializeChat, refreshChatUI } from './ai_chart_chat.js';
import { AITaskManager, createWorkflowManager } from './ai_chart_task_manager.js';
import { initWorkflowUI, runAiWorkflow, generateExplanation, checkAndGenerateAISummary, renderExplanationCard } from './ai_chart_ui_workflow.js';
import { buildAggCard, getAiAnalysisPlan, getIntelligentAiAnalysisPlan, renderAggregates, setGenerateButtonState, initGlobalDescControls, updateGlobalDescControls, buildLongFormatEnhancements } from './ai_chart_ui_helpers.js';
import { detectCrossTab, convertCrossTabToLong } from './ai_chart_transformers.js';
// Moved raw data table implementation to separate module
import {
  initializeRowInclusion,
  getIncludedRows,
  buildRawHeader as buildRawHeaderImpl,
  renderRawBody as renderRawBodyImpl,
  renderSortIndicators,
  renderTFootSums,
  applyFilter,
  sortRows,
  isLikelyNonDataRow,
  isLikelyCodeColumn,
  columnType,
  createOnSearchHandler
} from './ai_chart_data_table.js';
import { initializeHistoryManager, saveCurrentStateToHistory, loadHistoryState, debouncedAutoSave, forceAutoSave, getFormattedDateTime, signatureFromHeaders } from './ai_chart_history_manager.js';
export { getUiSnapshot } from './ai_chart_history_manager.js';

// Expose select helpers to global window for compatibility
window.getIncludedRows = getIncludedRows;
window.isLikelyNonDataRow = isLikelyNonDataRow;
window.isLikelyCodeColumn = isLikelyCodeColumn;
window.columnType = columnType;
/* ========= utils ========= */
const $ = s => document.querySelector(s);
const stripBOM = s => (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;

// Global AI Task Manager instance
const AITasks = new AITaskManager();
window.AITasks = AITasks; // Make available to helper modules

// Enhanced Workflow Manager with AI Agent Integration
const WorkflowManager = createWorkflowManager(AITasks);
window.WorkflowManager = WorkflowManager; // Make available to helper modules

// Guarded reset to prevent wiping running workflows
function safeReset(mode = 'auto') {
  try {
    const targetMode = mode || window.MODE || 'auto';
    if (!WorkflowManager || typeof WorkflowManager.getState !== 'function' || typeof WorkflowManager.reset !== 'function') {
      console.warn('safeReset: WorkflowManager not ready');
      return false;
    }
    const state = WorkflowManager.getState();
    if (state && state.status === 'running') {
      console.log('⏸️ safeReset: Skipping reset while workflow is running', state);
      return false;
    }
    WorkflowManager.reset(targetMode);
    return true;
  } catch (e) {
    console.error('safeReset failed:', e);
    return false;
  }
}
window.safeReset = safeReset;

// Comprehensive UI and state reset function
function resetUIAndState(mode = 'auto') {
  console.log('🔄 resetUIAndState: Starting comprehensive reset');
  
  try {
    // 1. Reset workflow manager (using existing safeReset)
    const resetSuccess = safeReset(mode);
    if (!resetSuccess) {
      console.log('resetUIAndState: WorkflowManager not ready or busy, continuing with UI reset');
      // If WorkflowManager is not ready, try to reset it directly when it becomes available
      if (window.WorkflowManager && typeof window.WorkflowManager.reset === 'function') {
        try {
          window.WorkflowManager.reset(mode);
          console.log('resetUIAndState: Successfully reset WorkflowManager directly');
        } catch (e) {
          console.log('resetUIAndState: Direct WorkflowManager reset also failed, proceeding anyway');
        }
      }
      
      // Also reset AITasks directly to clear any pending tasks
      if (window.AITasks && typeof window.AITasks.clearAllTasks === 'function') {
        try {
          window.AITasks.clearAllTasks();
          console.log('resetUIAndState: Successfully cleared AITasks');
        } catch (e) {
          console.log('resetUIAndState: Failed to clear AITasks:', e);
        }
      }
    }
    
    // 2. Clear global state variables
    window.ROWS = null;
    window.PROFILE = null;
    window.currentData = null;
    window.DATA_COLUMNS = [];
    
    // Clear module-level variables if they exist
    if (typeof ROWS !== 'undefined') ROWS = null;
    if (typeof PROFILE !== 'undefined') PROFILE = null;
    if (typeof DATA_COLUMNS !== 'undefined') DATA_COLUMNS = [];
    
    // 3. Clear main UI containers (preserving essential structure)
    const resultsGrid = $('#results');
    if (resultsGrid) {
      // Clear chart cards but preserve the grid container
      resultsGrid.innerHTML = '';
    }
    
    // Clear AI summary section content but preserve structure
    const aiSummarySection = $('#ai-summary-section');
    if (aiSummarySection) {
      aiSummarySection.style.display = 'none';
    }
    
    // Clear AI summary text content but preserve the container elements
    const aiSummaryText = $('#ai-summary-text');
    if (aiSummaryText) {
      aiSummaryText.innerHTML = '';
    }
    
    const aiSummaryLoading = $('#ai-summary-loading');
    if (aiSummaryLoading) {
      aiSummaryLoading.style.display = 'none';
    }
    
    // Clear AI todo list
    const aiTodoList = $('#ai-todo-list');
    if (aiTodoList) {
      aiTodoList.innerHTML = '';
    }
    
    const aiTodoListSection = $('#ai-todo-list-section');
    if (aiTodoListSection) {
      aiTodoListSection.style.display = 'none';
    }
    
    // 4. Clear any existing charts (destroy Chart.js instances)
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      if (window.Chart?.getChart) {
        const chart = window.Chart.getChart(canvas);
        if (chart) {
          chart.destroy();
        }
      }
      // Clear any direct references
      if (canvas.chart) {
        if (typeof canvas.chart.destroy === 'function') {
          canvas.chart.destroy();
        }
        canvas.chart = null;
      }
      if (canvas._chartInstance) {
        if (typeof canvas._chartInstance.destroy === 'function') {
          canvas._chartInstance.destroy();
        }
        canvas._chartInstance = null;
      }
    });
    
    // 5. Clear analysis cards container if it exists
    const analysisCards = document.querySelector('.analysis-cards') || document.querySelector('#analysis-cards');
    if (analysisCards) {
      analysisCards.innerHTML = '';
    }
    
    // 6. Clear any toast notifications related to old state
    // Note: We don't clear all toasts as some might be relevant to the reset process
    
    // 7. Reset UI mode
    const modeSelect = $('#mode');
    if (modeSelect) {
      modeSelect.value = mode;
    }
    window.MODE = mode;
    
    // 8. Clear session storage flags that might interfere with new state
    sessionStorage.removeItem('isNewFileLoad');
    
    console.log('✅ resetUIAndState: Comprehensive reset completed successfully');
    return true;
    
  } catch (error) {
    console.error('❌ resetUIAndState: Error during reset:', error);
    return false;
  }
}
window.resetUIAndState = resetUIAndState;

// Export helper functions to global window for compatibility
window.buildAggCard = buildAggCard;
window.getAiAnalysisPlan = getAiAnalysisPlan;
window.getIntelligentAiAnalysisPlan = getIntelligentAiAnalysisPlan;
window.renderAggregates = renderAggregates;
window.setGenerateButtonState = setGenerateButtonState;
// Removed duplicate updateAiTodoList function - using the one from ai_chart_ui_workflow.js

// Subscribe the UI update function to the manager


// NOTE: nice function moved to ai_chart_aggregates.js; formatNumberFull kept here for backwards compatibility
function formatNumberFull(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ----- Converted Raw Data (Long) Preview Helpers -----
function toCSVString(rows, columns){
  const esc = s => {
    const str = String(s ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
  };
  const header = columns.map(esc).join(',');
  const body = rows.map(r => columns.map(c => esc(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

function renderConvertedPreview(columns, rows, limit = 100){
  const thead = document.getElementById('convertedThead');
  const tbody = document.getElementById('convertedTbody');
  const rowInfo = document.getElementById('convertedRowInfo');
  if (!thead || !tbody) return;

  thead.innerHTML = '';
  const trh = document.createElement('tr');
  for (const c of columns){
    const th = document.createElement('th');
    th.className = 'sticky';
    th.textContent = c;
    trh.appendChild(th);
  }
  thead.appendChild(trh);

  tbody.innerHTML = '';
  const n = Math.min(limit, rows.length);
  for (let i=0;i<n;i++){
    const r = rows[i];
    const tr = document.createElement('tr');
    for (const c of columns){
      const td = document.createElement('td');
      td.textContent = String(r[c] ?? '');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  if (rowInfo){
    rowInfo.textContent = `Showing 1–${n} of ${rows.length} (converted long rows)`;
  }

  const dlBtn = document.getElementById('downloadConverted');
  if (dlBtn){
    dlBtn.onclick = () => {
      const csv = toCSVString(rows, columns);
      const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'converted_long.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }
}

function showConvertedSection(columns, rows){
  const sec = document.getElementById('converted-raw-data-section');
  if (!sec) return;
  sec.style.display = '';
  renderConvertedPreview(columns, rows, 100);
}

function hideConvertedSection(){
  const sec = document.getElementById('converted-raw-data-section');
  if (sec) sec.style.display = 'none';
}

// ===== Schema Mapping UI (Cross-tab) =====
function getSelectedOptionsFromSelect(sel) {
  const arr = [];
  if (!sel) return arr;
  for (const opt of Array.from(sel.options)) {
    if (opt.selected) arr.push(opt.value);
  }
  return arr;
}

function openSchemaMappingModal(){
  // Cross-tab Schema Mapping is deprecated/disabled.
  showToast('Schema Mapping has been disabled. Please provide long-format CSV input.', 'warning');
  return;
}

function closeSchemaMappingModal(){
  const modal = document.getElementById('schemaMappingModal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
}

function populateSchemaMappingUI(){
  const labelInput = document.getElementById('mappingLabelRowInput');
  const dataStartInput = document.getElementById('mappingDataStartRowInput');
  const startColInput = document.getElementById('mappingStartColInput');
  const idCode = document.getElementById('mappingIdCode');
  const idDesc = document.getElementById('mappingIdDescription');
  const includeSel = document.getElementById('mappingIncludeSelect');
  const excludeSel = document.getElementById('mappingExcludeSelect');

  if (!window.ROWS || !window.ROWS.length) return;
  const keys = Object.keys(window.ROWS[0] || {});
  const detection = window.CROSSTAB_DETECTION || {};
  const opt = window.CROSSTAB_OPTIONS || {
    idCols: ['Code','Description'],
    labelRowIndex: detection.headerRows === 2 ? 0 : 0,
    dataStartRow: detection.headerRows === 2 ? 1 : 1,
    includeCols: Array.isArray(detection.projectCols) ? detection.projectCols : null,
    excludeCols: []
  };

  // Set numeric inputs (1-based)
  if (labelInput) labelInput.value = String((opt.labelRowIndex ?? 0) + 1);
  if (dataStartInput) dataStartInput.value = String((opt.dataStartRow ?? 1) + 1);

  // Compute suggested start column from includeCols or detection.projectCols
  const indicesFrom = (cols) => (Array.isArray(cols) ? cols : []).map(c => keys.indexOf(c)).filter(i => i >= 0);
  let minIdx = -1;
  const incIdxs = indicesFrom(opt.includeCols?.length ? opt.includeCols : detection.projectCols);
  if (incIdxs.length) minIdx = Math.min(...incIdxs);
  if (startColInput) startColInput.value = minIdx >= 0 ? String(minIdx + 1) : '';

  // ID checkboxes
  const idCols = new Set(opt.idCols || ['Code','Description']);
  if (idCode) idCode.checked = idCols.has('Code');
  if (idDesc) idDesc.checked = idCols.has('Description');

  // Build include/exclude option lists using non-ID columns
  if (includeSel) includeSel.innerHTML = '';
  if (excludeSel) excludeSel.innerHTML = '';
  const nonIdCols = keys.filter(k => !idCols.has(k));

  nonIdCols.forEach(name => {
    const o1 = document.createElement('option'); o1.value = name; o1.textContent = name;
    const o2 = document.createElement('option'); o2.value = name; o2.textContent = name;
    includeSel?.appendChild(o1);
    excludeSel?.appendChild(o2);
  });

  // Preselect include based on current options or detection
  const preInclude = Array.isArray(opt.includeCols) && opt.includeCols.length ? opt.includeCols
                    : (Array.isArray(detection.projectCols) ? detection.projectCols : []);
  if (includeSel && preInclude && preInclude.length) {
    const set = new Set(preInclude);
    Array.from(includeSel.options).forEach(o => { if (set.has(o.value)) o.selected = true; });
  }

  // Preselect exclude based on options
  const preExclude = Array.isArray(opt.excludeCols) ? opt.excludeCols : [];
  if (excludeSel && preExclude.length) {
    const set = new Set(preExclude);
    Array.from(excludeSel.options).forEach(o => { if (set.has(o.value)) o.selected = true; });
  }
}

function computeOptionsFromMappingUI(){
  const labelInput = document.getElementById('mappingLabelRowInput');
  const dataStartInput = document.getElementById('mappingDataStartRowInput');
  const startColInput = document.getElementById('mappingStartColInput');
  const idCode = document.getElementById('mappingIdCode');
  const idDesc = document.getElementById('mappingIdDescription');
  const includeSel = document.getElementById('mappingIncludeSelect');
  const excludeSel = document.getElementById('mappingExcludeSelect');

  const idCols = [];
  if (idCode?.checked) idCols.push('Code');
  if (idDesc?.checked) idCols.push('Description');

  const labelRowIndex = Math.max(0, (parseInt(labelInput?.value || '1', 10) || 1) - 1);
  const dataStartRow = Math.max(0, (parseInt(dataStartInput?.value || '2', 10) || 2) - 1);

  const keys = Object.keys((window.ROWS && window.ROWS[0]) || {});
  const startIdxInput = parseInt(startColInput?.value || '', 10);
  let includeCols = getSelectedOptionsFromSelect(includeSel);
  const excludeCols = getSelectedOptionsFromSelect(excludeSel);

  // If start column is given, derive includeCols from that position onward (excluding ID cols)
  if (Number.isInteger(startIdxInput) && startIdxInput >= 1) {
    const startIdx0 = Math.min(Math.max(0, startIdxInput - 1), keys.length - 1);
    const idSet = new Set(idCols);
    includeCols = keys.slice(startIdx0).filter(k => !idSet.has(k));
  }

  const options = {
    idCols,
    labelRowIndex,
    dataStartRow,
    includeCols: includeCols && includeCols.length ? includeCols : null,
    excludeCols: (!includeCols || includeCols.length === 0) ? excludeCols : []
  };
  return options;
}

function previewSchemaMapping(){
  if (!window.ROWS) return showToast('Load a CSV first.', 'error');
  const detection = window.CROSSTAB_DETECTION || detectCrossTab(window.ROWS);
  const options = computeOptionsFromMappingUI();
  try {
    const { rows: longRows, columns } = convertCrossTabToLong(window.ROWS, detection, options);
    renderConvertedPreview(columns, longRows, 100);
    showToast('Preview updated.', 'success');
  } catch (e) {
    console.warn('Mapping preview failed:', e);
    showToast('Preview failed: ' + (e?.message || e), 'error');
  }
}

function applySchemaMapping(){
  if (!window.ROWS) return showToast('Load a CSV first.', 'error');
  const detection = window.CROSSTAB_DETECTION || detectCrossTab(window.ROWS);
  const options = computeOptionsFromMappingUI();
  try {
    const { rows: longRows, columns } = convertCrossTabToLong(window.ROWS, detection, options);
    window.CROSSTAB_OPTIONS = options;
    window.AGG_ROWS = longRows;
    const dateFormatConv = document.getElementById('dateFormat')?.value || 'auto';
    window.AGG_PROFILE = profile(longRows, dateFormatConv);
    showConvertedSection(columns, longRows);
    closeSchemaMappingModal();
    renderAggregates();
    showToast('Mapping applied.', 'success');
  } catch (e) {
    console.warn('Apply mapping failed:', e);
    showToast('Apply failed: ' + (e?.message || e), 'error');
  }
}

// Bind mapping UI handlers
(function bindSchemaMappingHandlers(){
  const adjustBtn = document.getElementById('adjustMappingBtn');
  const closeBtn = document.getElementById('closeSchemaMappingModal');
  const previewBtn = document.getElementById('mappingPreviewBtn');
  const applyBtn = document.getElementById('mappingApplyBtn');

  // Disable Schema Mapping UI controls (deprecated)
  if (adjustBtn) {
    adjustBtn.onclick = () => showToast('Schema Mapping has been disabled. Please provide long-format CSV input.', 'warning');
    try { adjustBtn.disabled = true; adjustBtn.style.display = 'none'; } catch {}
  }
  if (previewBtn) {
    previewBtn.onclick = () => showToast('Schema Mapping preview disabled.', 'warning');
    try { previewBtn.disabled = true; previewBtn.style.display = 'none'; } catch {}
  }
  if (applyBtn) {
    applyBtn.onclick = () => showToast('Schema Mapping apply disabled.', 'warning');
    try { applyBtn.disabled = true; applyBtn.style.display = 'none'; } catch {}
  }
  if (closeBtn) {
    closeBtn.onclick = () => { try { closeSchemaMappingModal(); } catch {} };
  }
})();

function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
const debouncedRenderAggregates = debounce(() => { renderAggregates(); }, 300);
window.debouncedRenderAggregates = debouncedRenderAggregates;

window.getAiAnalysisPlan = getAiAnalysisPlan;
window.getIntelligentAiAnalysisPlan = getIntelligentAiAnalysisPlan;

/* ========= state ========= */
let ROWS=null, PROFILE=null, LAST_PARSE_META=null;
let DATA_COLUMNS=[], FILTERED_ROWS=[], PAGE=1, RPP=25, QUERY="";
let SORT = { col:null, dir:'asc' };
let ROW_INCLUDED = []; // Track which rows are included in aggregations (true/false for each row)
let ROW_EXCLUSION_REASONS = {}; // Map of rowIndex to reason string
let AUTO_EXCLUDE = true;

let MODE = 'auto';
window.MODE = MODE;
let MANUAL_ROLES = {};   // { colName: 'dimension'|'metric'|'date'|'id'|'ignore' }
let MANUAL_JOBS  = [];   // [{groupBy, metric, agg, chart, topN, dateBucket?}]

function setManualRoles(next) {
  MANUAL_ROLES = next ? { ...next } : {};
  window.MANUAL_ROLES = MANUAL_ROLES;
}

function getManualRoles() {
  return MANUAL_ROLES;
}

setManualRoles(MANUAL_ROLES);
window.setManualRoles = setManualRoles;
window.getManualRoles = getManualRoles;
let CURRENCY_TOKENS = ['MYR','RM','Malaysian Ringgit','USD','US Dollar','SGD','SG Dollar','EUR','Euro','GBP','British Pound','JPY','Japanese Yen','CNY','Chinese Yuan','AUD','Australian Dollar','CAD','Canadian Dollar','CHF','Swiss Franc','HKD','Hong Kong Dollar','INR','Indian Rupee','KRW','South Korean Won','THB','Thai Baht','VND','Vietnamese Dong','PHP','Philippine Peso','IDR','Indonesian Rupiah'];
const CURRENCY_COLUMN_HINTS = ['ccy', 'currency', 'cur', 'curr'];

// Sync critical state to window for module interop
window.ROWS = ROWS;
window.PROFILE = PROFILE;
window.DATA_COLUMNS = DATA_COLUMNS;
window.FILTERED_ROWS = FILTERED_ROWS;
window.PAGE = PAGE;
window.RPP = RPP;
window.QUERY = QUERY;
window.SORT = SORT;
window.ROW_INCLUDED = ROW_INCLUDED;
window.ROW_EXCLUSION_REASONS = ROW_EXCLUSION_REASONS;
window.AUTO_EXCLUDE = AUTO_EXCLUDE;
window.CURRENCY_TOKENS = CURRENCY_TOKENS;
window.CURRENCY_COLUMN_HINTS = CURRENCY_COLUMN_HINTS;

 /* ========= persistence ========= */
const STORAGE_KEY = 'csv-agg-state-v2';
function saveState(){
  try{
    const key = signatureFromHeaders();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ MODE, MANUAL_ROLES, MANUAL_JOBS, AUTO_EXCLUDE, CURRENCY_TOKENS, dateFormat: $('#dateFormat').value, key }));
  }catch{}
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return;
    const s = JSON.parse(raw);
    if (s.key && s.key === signatureFromHeaders()){
      MODE = s.MODE || MODE;
      setManualRoles(s.MANUAL_ROLES || {});
      MANUAL_JOBS = s.MANUAL_JOBS || [];
      AUTO_EXCLUDE = (typeof s.AUTO_EXCLUDE === 'boolean') ? s.AUTO_EXCLUDE : true;
      if (Array.isArray(s.CURRENCY_TOKENS) && s.CURRENCY_TOKENS.length > 0) {
        CURRENCY_TOKENS = s.CURRENCY_TOKENS;
      }
      $('#mode').value = MODE;
      $('#autoExclude').checked = AUTO_EXCLUDE;
      $('#dateFormat').value = s.dateFormat || 'auto';
      // Sync to window for data-table module
      window.MODE = MODE;
      window.AUTO_EXCLUDE = AUTO_EXCLUDE;
      window.CURRENCY_TOKENS = CURRENCY_TOKENS;
      switchMode(MODE);
    }
  }catch{}
}
['change','click','input'].forEach(ev=>{ document.addEventListener(ev, debounce(saveState, 300), true); });

/* ========= raw data table: header, sorting, filter, pagination, tfoot sums ========= */

// Bridge to ai_chart_data_table.js implementations via thin wrappers

function buildRawHeader(columns){
  // Pass UI callbacks to data-table module
  return buildRawHeaderImpl(columns, renderAggregates, debouncedAutoSave, renderRawBody, renderSortIndicators);
}

function renderRawBody(){
  // Provide debounced callbacks required by the module
  return renderRawBodyImpl(window.debouncedRenderAggregates || debouncedRenderAggregates, debouncedAutoSave);
}

/* ========= raw data table: header, sorting, filter, pagination, tfoot sums ========= */

// Bridge to ai_chart_data_table.js implementations via thin wrappers

/* duplicate wrapper removed */

// Debounced search handler using module helper
const onSearch = createOnSearchHandler(applyFilter, renderRawBody);

/* ========= roles + auto plan (no-AI) ========= */
// Enhanced Pattern Recognition for Business Data Types

function autoPlan(profile, rows, excludedDimensions = []) {
    const columns = profile.columns.map(c => c.name);
    const erpPriority = getErpAnalysisPriority(columns);

    if (erpPriority && erpPriority.metrics.length > 0 && erpPriority.dimensions.length > 0) {
        console.log('[Debug] autoPlan: Using ERP priority plan:', JSON.stringify(erpPriority, null, 2));
        const jobs = [];
        const primaryMetric = erpPriority.metrics[0];
        console.log('[Debug] autoPlan: Primary metric selected:', JSON.stringify(primaryMetric, null, 2));
        
        erpPriority.dimensions.forEach(dim => {
            if (dim && columns.includes(dim)) {
                jobs.push({
                    groupBy: dim,
                    metric: primaryMetric.type === 'derived' ? primaryMetric.baseMetric : primaryMetric.name,
                    agg: 'sum'
                });
            }
        });
        return { jobs: deduplicateJobs(jobs).slice(0, 10), charts: [] };
    }

    console.log('[autoPlan] Starting plan, excluding:', excludedDimensions);
  console.log('[Debug] autoPlan: Available columns for metric selection:', profile.columns.map(c => c.name));
  let roles = profile.columns.map(c => ({ col:c, ...inferRole(c, profile, rows) }));
  console.log('[Debug] autoPlan: All inferred roles:', roles.map(r => ({ name: r.col.name, role: r.role, category: r.category, priority: r.priority, erp: r.erp })));
  if (excludedDimensions.length > 0) {
    roles = roles.filter(r => !excludedDimensions.includes(r.col.name));
  }
  
  // Enhanced role categorization with business intelligence
  const dimensionCompletenessMin = 0.75;
  const dimensionUniqueMax = 120;
  const dims = roles
    .filter(x => x.role==='dimension' && !x.unsuitable)
    .map(x => ({ ...x, col: x.col }))
    .filter(d => {
      const name = String((d.col && d.col.name) || '').trim();
      const completeness = Number(d.col.completeness ?? d.completeness ?? 0);
      const unique = Number(d.col.unique ?? d.cardinality ?? 0);
      if (completeness && completeness < dimensionCompletenessMin) return false;
      if (unique && unique > dimensionUniqueMax) return false;
      if (/^_+\d*/.test(name) && d.col.hint !== 'currencyToken') return false;
      if (d.col.hint === 'unitToken') return false;
      return true;
    })
    .sort((a, b) => {
      const compDiff = (b.completeness ?? Number(b.col.completeness ?? 0)) - (a.completeness ?? Number(a.col.completeness ?? 0));
      if (Math.abs(compDiff) > 0.05) return compDiff;
      return (a.cardinality ?? Number(a.col.unique ?? 0)) - (b.cardinality ?? Number(b.col.unique ?? 0));
    });
  const dates = roles.filter(x => x.role==='date' && !x.unsuitable && x.completeness > 0.2).map(x => ({ ...x, col: x.col }))
    .sort((a, b) => b.completeness - a.completeness);
  const metricsStrong = roles.filter(x => x.role==='metric:strong').map(x => ({ ...x, col: x.col }));
  const metrics = roles.filter(x => x.role==='metric' || x.role==='metric:strong').map(x => ({ ...x, col: x.col }));
  
  // Sort strong metrics by the priority assigned in inferRole
  metricsStrong.sort((a, b) => {
    const priorities = { critical: 3, high: 2, normal: 1, low: 0 };
    const priorityA = priorities[a.priority] || 0;
    const priorityB = priorities[b.priority] || 0;
    return priorityB - priorityA;
  });
  console.log('[Debug] autoPlan: Sorted strong metrics:', metricsStrong.map(m => `${m.col.name} (priority: ${m.priority})`));
  
  // Detect hierarchical relationships
  const hierarchicalRels = detectHierarchicalRelationships(profile);
  
  // Categorize dimensions by business context
  const businessDims = {
    financial: dims.filter(d => d.category === 'financial'),
    location: dims.filter(d => d.category === 'location'),
    contact: dims.filter(d => d.category === 'contact'),
    status: dims.filter(d => d.category === 'status'),
    hierarchy: dims.filter(d => d.category === 'hierarchy'),
    code: dims.filter(d => d.category === 'code' || d.identifier),
    temporal: dims.filter(d => d.category === 'temporal'),
    general: dims.filter(d => d.category === 'general' || !d.category)
  };
  
  // Prioritize metrics by business importance
  const financialMetrics = metricsStrong.filter(m => m.category === 'financial');
  const quantityMetrics = metricsStrong.filter(m => m.category === 'quantity');
  const generalMetrics = metricsStrong.filter(m => m.category === 'general' || !m.category);
  
  // Select primary metric with enhanced business logic
  const primary = financialMetrics[0]?.col || quantityMetrics[0]?.col ||
                  metricsStrong[0]?.col || pickPrimaryMetric(profile, rows);
  console.log('[autoPlan] Final primary metric selected:', primary?.name);
  const jobs = []; const charts = [];
  
  // Enhanced temporal analysis with business patterns - only if date has good data
  if (dates.length && primary && dates[0].completeness >= 0.5) {
    const dateCol = dates[0];
    const bucket = autoBucket(rows, dateCol.col.name);
    jobs.push({
      groupBy: dateCol.col.name,
      metric: primary.name,
      agg: dateCol.category === 'financial' ? 'sum' : 'sum',
      dateBucket: bucket,
      temporal: dateCol.temporal
    });
    charts.push({
      useJob: jobs.length-1,
      preferredType: 'line',
      title: `${primary.name} over ${dateCol.col.name}`,
      priority: 'critical'
    });
  }
  
  // Prioritized dimension analysis based on business context
  const prioritizedDims = [
    ...businessDims.status.slice(0,1),      // Status/Category (highest business value)
    ...businessDims.location.slice(0,1),    // Geographic analysis
    ...businessDims.hierarchy.slice(0,1),   // Organizational structure
    ...businessDims.code.slice(0,2),        // Identifier/code columns that still behave dimensionally
    ...businessDims.temporal.slice(0,1),    // Temporal categories
    ...businessDims.general.slice(0,2)      // General dimensions
  ].filter(Boolean);

  const limitedDims = [];
  const seenDimNames = new Set();
  const categoryUseLimits = new Map([
    ['code', 1],
    ['hierarchy', 1],
    ['status', 2],
    ['general', 2],
    ['location', 1]
  ]);
  const categoryCounts = new Map();
  for (const dim of prioritizedDims) {
    const name = String(dim?.col?.name || '').trim();
    if (!name || seenDimNames.has(name)) continue;
    const completeness = Number(dim?.col?.completeness ?? dim.completeness ?? 0);
    const unique = Number(dim?.col?.unique ?? dim.cardinality ?? 0);
    if (completeness && completeness < dimensionCompletenessMin) continue;
    if (unique && unique > dimensionUniqueMax) continue;
    const cat = dim.category || 'general';
    const maxPerCat = categoryUseLimits.get(cat) ?? 2;
    const used = categoryCounts.get(cat) || 0;
    if (used >= maxPerCat) continue;
    limitedDims.push(dim);
    seenDimNames.add(name);
    categoryCounts.set(cat, used + 1);
    if (limitedDims.length >= 4) break; // keep auto mode tidy but allow more coverage for long tables
  }

  if (limitedDims.length === 0 && dims.length) {
    limitedDims.push(dims[0]);
  }

  limitedDims.forEach(d => {
    if (!d || !d.col) return;
    const uniqueCount = Number(d.col.unique ?? 0);
    if (Number.isFinite(uniqueCount) && uniqueCount <= 1) return;

    if (primary) {
      const aggType = 'sum';
      jobs.push({
        groupBy: d.col.name,
        metric: primary.name,
        agg: aggType,
        category: d.category,
        priority: d.priority
      });

      let chartType = 'bar';
      if (d.category === 'status' && d.col.unique <= 8) chartType = 'pie';
      else if (d.category === 'location') chartType = 'bar';
      else if (d.category === 'hierarchy') chartType = 'hbar';
      else if (d.col.unique <= 8) chartType = 'pie';

      charts.push({
        useJob: jobs.length - 1,
        preferredType: chartType,
        title: `${primary.name} by ${d.col.name}`,
        category: d.category,
        priority: d.priority === 'high' ? 'high' : 'normal'
      });
    } else {
      jobs.push({
        groupBy: d.col.name,
        metric: null,
        agg: 'count',
        category: d.category
      });
      charts.push({
        useJob: jobs.length - 1,
        preferredType: d.col.unique <= 8 ? 'pie' : 'bar',
        title: `count(*) by ${d.col.name}`,
        category: d.category,
        priority: 'low'
      });
    }
  });

  try {
    const enhancements = buildLongFormatEnhancements(profile, rows, {
      metricKey: primary?.name || 'Value',
      rowEstimate: profile?.rowCount || rows.length
    });
    const extraTopJobs = (enhancements.topKJobs || []).slice(0, 5);
    for (const job of extraTopJobs) {
      if (jobs.length >= 10) break;
      jobs.push(job);
      const jobIndex = jobs.length - 1;
      if (jobIndex < 10) {
        const metricLabel = job.metric || primary?.name || 'Value';
        const whereLabel = job.where ? Object.values(job.where)[0] : '';
        charts.push({
          useJob: jobIndex,
          preferredType: 'bar',
          title: `${metricLabel} by ${job.groupBy}${whereLabel ? ` — ${whereLabel}` : ''}`,
          priority: 'normal'
        });
      }
    }
    if (enhancements.pivotJob && jobs.length < 10) {
      jobs.push(enhancements.pivotJob);
    }
  } catch (e) {
    console.warn('buildLongFormatEnhancements failed in autoPlan:', e);
  }

  // Secondary metric analysis with business context
  const secondaryMetrics = [
    ...quantityMetrics.filter(m => m.col.name !== primary?.name).slice(0,1),
    ...generalMetrics.filter(m => m.col.name !== primary?.name).slice(0,1)
  ];
  
  if (secondaryMetrics.length && limitedDims.length) {
    const secondMetric = secondaryMetrics[0];
    const topDim = limitedDims[0];
    if (secondMetric.col && topDim.col) {
      jobs.push({
        groupBy: topDim.col.name,
        metric: secondMetric.col.name,
        agg: secondMetric.category === 'financial' ? 'sum' : 'sum',
        category: secondMetric.category
      });
      charts.push({
        useJob: jobs.length-1,
        preferredType: 'bar',
        title: `${secondMetric.col.name} by ${topDim.col.name}`,
        category: secondMetric.category,
        priority: 'normal'
      });
    }
  }
  
  // Apply canonical deduplication before returning
  const deduplicatedJobs = deduplicateJobs(jobs);
  console.log('[Debug] autoPlan: Final generated jobs:', JSON.stringify(deduplicatedJobs.slice(0,10), null, 2));
  return { jobs: deduplicatedJobs.slice(0,10), charts, hierarchicalRels, businessContext: businessDims };
}

// Make autoPlan function available globally
window.autoPlan = autoPlan;

function autoBucket(rows, dateCol){
  const ds = rows.map(r=>parseDateSafe(r[dateCol])).filter(x=>!Number.isNaN(x));
  if (!ds.length) return '';
  const spanDays = (Math.max(...ds)-Math.min(...ds))/86400000;
  if (spanDays > 400) return 'month';
  if (spanDays > 120) return 'week';
  return 'day';
}

/* ========= Manual Mode: Role Editor + Add Aggregate ========= */
function openRoleEditor(){
  const modal = $('#roleModal');
  const tb = $('#roleTBody');
  if (tb) tb.innerHTML='';
  // Prefer window-scoped state restored by history manager; fall back to module vars
  const prof = window.PROFILE || PROFILE;
  const rows = window.ROWS || ROWS;

  if (!prof || !Array.isArray(prof.columns)) {
    showToast('No dataset loaded or profile unavailable. Load a report before editing column roles.', 'error');
    return;
  }

  prof.columns.forEach(c=>{
    const tr=document.createElement('tr');
    const roleAuto = inferRole(c, prof, rows).role;
    const current = MANUAL_ROLES[c.name] || roleAuto;
    const tdName = document.createElement('td'); tdName.textContent = c.name;
    const tdType = document.createElement('td'); tdType.textContent = c.type;
    const tdUniq = document.createElement('td'); tdUniq.textContent = c.unique;
    const tdRole = document.createElement('td');
    const sel = document.createElement('select'); sel.setAttribute('data-col', c.name);
    ['dimension','metric','date','id','ignore'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
    sel.value = String(current || '').replace('metric:strong','metric'); tdRole.appendChild(sel);
    const tdSample = document.createElement('td'); tdSample.className='muted small'; tdSample.textContent = (c.samples||[]).join(' | ');
    tr.append(tdName, tdType, tdUniq, tdRole, tdSample); tb.appendChild(tr);
  });
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    modal.focus();
  }
}
$('#closeRoleModal').onclick = ()=>{
  const modal = $('#roleModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  try { document.getElementById('editRolesBtn')?.focus(); } catch {}
};
$('#saveRoles').onclick = ()=>{
  const nextRoles = {};
  $('#roleTBody').querySelectorAll('select').forEach(sel=>{ nextRoles[ sel.getAttribute('data-col') ] = sel.value; });
  setManualRoles(nextRoles);
  $('#roleModal').classList.remove('open');
  renderAggregates();
  showToast('Column roles saved.', 'success');
  debouncedAutoSave();
};

function planFromManualRoles(profile){
  const getCols = (role)=> profile.columns.filter(c => (MANUAL_ROLES[c.name]||'')===role);
  const dims = getCols('dimension');
  const dates = getCols('date');
  const metrics = getCols('metric');
  const primary = metrics[0] || pickPrimaryMetric(profile, ROWS);
  const jobs=[], charts=[];
  if (dates.length && primary){
    jobs.push({ groupBy: dates[0].name, metric: primary.name, agg:'sum', dateBucket:autoBucket(ROWS, dates[0].name) });
    charts.push({ useJob: jobs.length-1, preferredType:'line', title:`${primary.name} over ${dates[0].name}` });
  }
  dims.slice(0,3).forEach(d=>{
    if (primary){
      jobs.push({ groupBy:d.name, metric:primary.name, agg:'sum' });
      charts.push({ useJob: jobs.length-1, preferredType:d.unique<=8?'pie':'bar', title:`${primary.name} by ${d.name}` });
      // 移除默认 avg 聚合，avg 在多数业务场景（金额/交易）意义不大，避免噪声建议。
    }
    // For ERP: Skip count, focus only on sum-based metrics
    if (!primary) {
      // If no primary metric, still create sum aggregation but show warning
      jobs.push({ groupBy:d.name, metric:null, agg:'sum' });
      charts.push({ useJob: jobs.length-1, preferredType:d.unique<=8?'pie':'bar', title:`sum by ${d.name}` });
    }
  });
  // Apply canonical deduplication before returning
  const deduplicatedJobs = deduplicateJobs(jobs);
  return { jobs: deduplicatedJobs.slice(0,10), charts };
}

function openAddAgg(){
  const modal = $('#aggModal');
  const gb = $('#aggGroupBy'), mt = $('#aggMetric');
  const bucket = $('#aggBucket');
  if (!gb || !mt || !bucket) {
    showToast('Aggregate dialog not available.', 'error');
    return;
  }
  gb.innerHTML=''; mt.innerHTML=''; bucket.value='';

  // Prefer window-scoped profile restored by history manager
  const prof = window.PROFILE || PROFILE;
  if (!prof || !Array.isArray(prof.columns) || prof.columns.length === 0) {
    showToast('No dataset loaded or profile unavailable. Load a report before adding an aggregate.', 'error');
    return;
  }

  // Build candidate lists. In Manual mode prefer MANUAL_ROLES, but fall back to inferred types if empty.
  let dims = [];
  let nums = [];

  if (MODE === 'manual') {
    const dimsByRoles = prof.columns.filter(c => (MANUAL_ROLES[c.name]||'')==='dimension' || (MANUAL_ROLES[c.name]||'')==='date');
    const numsByRoles = prof.columns.filter(c => (MANUAL_ROLES[c.name]||'')==='metric');
    const inferredDims = prof.columns.filter(c => ['string','date'].includes(c.type));
    const inferredNums = prof.columns.filter(c => c.type==='number');

    dims = dimsByRoles.length ? dimsByRoles : inferredDims;
    nums = numsByRoles.length ? numsByRoles : inferredNums;
  } else {
    dims = prof.columns.filter(c => ['string','date'].includes(c.type));
    nums = prof.columns.filter(c => c.type==='number');
  }

  // Populate selects
  dims.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; gb.appendChild(o); });
  nums.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; mt.appendChild(o); });

  // Enable/disable bucket based on selected groupBy type
  const setBucketAvailability = () => {
    const selectedGb = gb.value;
    const col = prof.columns.find(c => c.name === selectedGb);
    if (col && col.type === 'date') {
      bucket.disabled = false;
    } else {
      bucket.disabled = true;
      bucket.value = '';
    }
  };
  setBucketAvailability();
  gb.addEventListener('change', setBucketAvailability);

  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }
}
$('#closeAggModal').onclick = ()=>{
  const modal = $('#aggModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  try { document.getElementById('addAggBtn')?.focus(); } catch {}
};
$('#addAggConfirm').onclick = ()=>{
  const groupBy = $('#aggGroupBy').value;
  const metricRaw  = $('#aggMetric').value;
  const agg     = $('#aggFunc').value;
  const chart   = $('#aggChart').value;
  const topN    = Math.max(3, Math.min(999, Number($('#aggTopN').value)||20));
  const dateBucket = $('#aggBucket').value || '';

  if (!groupBy) {
    showToast('Please select a "Group by" column.', 'error');
    return;
  }

  // Normalize metric: allow null only for count
  let metric = (metricRaw && metricRaw.trim()) ? metricRaw : null;

  if (agg !== 'count' && !metric) {
    showToast('Please select a Metric for this aggregation function.', 'error');
    return;
  }

  // For count with empty metric, explicitly set null
  if (agg === 'count' && !metric) {
    metric = null;
  }

  MANUAL_JOBS.push({ groupBy, metric, agg, chart, topN, dateBucket });
  { const modal = $('#aggModal'); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); }
  try { document.getElementById('addAggBtn')?.focus(); } catch {}

  // If in Manual mode, build and append just this card immediately without restarting the workflow
  if (MODE === 'manual') {
    const grid = $('#results');
    if (grid) {
      (async () => {
        try {
          const { card } = await buildAggCard(
            { groupBy, metric, agg, dateBucket },
            { charts: [{ type: chart, topN }] }
          );
          grid.appendChild(card);
          applyMasonryLayout();
          showToast('New aggregate added.', 'success');
          debouncedAutoSave();
          forceAutoSave('add-aggregate');
        } catch (e) {
          console.error('Failed to build manual aggregate card:', e);
          showToast('Failed to add aggregate: ' + (e?.message || e), 'error');
        }
      })();
    }
  } else {
    // For non-manual modes, force a render even if a workflow is running
    renderAggregates(null, [], 0, true);
    showToast('New aggregate added.', 'success');
          debouncedAutoSave();
          forceAutoSave('add-aggregate');
  }
};

/* ========= UI glue ========= */
$('#loadBtn').onclick = async ()=>{
  const f=$('#file').files[0]; if(!f) return showToast('Choose a CSV first.', 'error');
  
  // Reset UI and state to ensure clean slate before loading new data
  console.log('[Workflow] Starting new file load - resetting UI and state first');
  resetUIAndState('auto');
  
  $('#meta').textContent='Parsing…';
  try{
    const choice=$('#delimiter').value, header=$('#hasHeader').checked;
    const { data, meta, detectionResult, preview } = await parseCSV(f, choice, header, progress => {
        if (progress.type === 'meta') {
            $('#meta').textContent = progress.text;
        }
    });
    if(!data.length) throw new Error('No rows detected (check delimiter/header).');
    // Persist meta/preview/detection from worker
    window.PARSE_PREVIEW = preview || null;
    window.CSV_DETECTION = detectionResult || null;
    LAST_PARSE_META = meta || null;

    ROWS=data; window.ROWS = ROWS; window.currentData = data; DATA_COLUMNS = Object.keys(ROWS[0] || {}); window.DATA_COLUMNS = DATA_COLUMNS;
    const dateFormat = $('#dateFormat').value;
    PROFILE=profile(ROWS, dateFormat); window.PROFILE = PROFILE; renderProfile(PROFILE, LAST_PARSE_META);

    // Coerce numeric columns into numbers to avoid leftover leading-apostrophes in strings
    if (PROFILE && PROFILE.columns) {
      const numericCols = PROFILE.columns.filter(c => c.type === 'number').map(c => c.name);
      if (numericCols.length) {
        for (const r of ROWS) {
          for (const col of numericCols) {
            const cleaned = toNum(r[col]);
            // Only coerce when parsed is finite AND the original contains at least one digit
            if (Number.isFinite(cleaned) && /[0-9]/.test(String(r[col]))) {
              r[col] = cleaned;
            }
          }
        }
      }
    }
    // Detect cross-tab and convert to long for aggregation
    try {
      const workerDetection = window.CSV_DETECTION;
      const detection = workerDetection || detectCrossTab(ROWS);
      window.CROSSTAB_DETECTION = detection;
      // Cross-tab conversion disabled: treat all inputs as long-format (no conversion).
      window.AGG_ROWS = null;
      window.AGG_PROFILE = null;
      window.CROSSTAB_OPTIONS = null;
      hideConvertedSection();
    } catch (e) {
      console.warn('Cross-tab detect/convert disabled (manual load):', e);
      window.AGG_ROWS = null;
      window.AGG_PROFILE = null;
      window.CROSSTAB_OPTIONS = null;
      hideConvertedSection();
    }

    {
      const det = window.CROSSTAB_DETECTION;
      const detTxt = det ? `, detected="${det.type || (det.isCrossTab ? 'cross-tab' : 'unknown')}"${typeof det.confidence === 'number' ? ` (${(det.confidence*100).toFixed(0)}%)` : ''}` : '';
      const skipTxt = meta && meta.skippedRows ? `, skippedMetaRows=${meta.skippedRows}` : '';
      $('#meta').textContent = `Loaded ${PROFILE.rowCount.toLocaleString()} rows, ${PROFILE.columns.length} columns. (delimiter="${meta.delimiter}"${detTxt}${skipTxt})`;
    }
    const resultsEl = $('#results');
    if (resultsEl) {
        resultsEl.innerHTML = '';
    }
    
    // Initialize row inclusion for manual file loading too
    initializeRowInclusion();
    buildRawHeader(DATA_COLUMNS);
    QUERY = ''; window.QUERY = QUERY; $('#searchInput').value='';
    SORT = { col:null, dir:'asc' }; window.SORT = SORT;
    RPP = Number($('#rowsPerPage').value)||25; PAGE=1; window.RPP = RPP; window.PAGE = PAGE;
    applyFilter(); renderRawBody();
    // Refresh global Description controls after new CSV has been loaded
    try { updateGlobalDescControls(); } catch (e) { console.warn('updateGlobalDescControls (manual load) failed:', e); }
    setManualRoles({}); MANUAL_JOBS = [];
    const smart = getDefaultMode();
    $('#mode').value = smart;
    switchMode(smart);
    loadState(); // restore per-header state if available
    safeReset(window.MODE); // Reset AI todo list on new load (guarded)
    showToast('CSV data loaded successfully.', 'success');

    // Auto-save the initial load as a new history item
    await saveCurrentStateToHistory(f.name, true); // Pass true to force new entry

    // Enable the update and save as new buttons
    $('#updateReportBtn').disabled = false;
    $('#saveAsNewBtn').disabled = false;
    
    // Auto-render aggregates if in auto mode (same logic as message handler)
    if ($('#mode').value === 'auto') {
      console.log('🎯 Auto-rendering aggregates after manual CSV load...');
      renderAggregates();

      // Ensure AI Analysis Chat is initialized after aggregates render
      setTimeout(() => {
        try {
          if (typeof initializeChat === 'function') {
            if (!window.currentData || window.currentData.length === 0) {
              window.currentData = ROWS;
            }
            const apiKey = localStorage.getItem('gemini_api_key');
            if (typeof initializeChat === 'function' && isValidApiKey(apiKey)) {
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                initializeChat();
            }
          }
        } catch (e) {
          console.warn('AI Analysis Chat init after manual load failed:', e);
        }
      }, 400);
    } else if ($('#mode').value === 'ai_agent') {
      console.log('🎯 Auto-starting AI Agent workflow after manual CSV load...');
      const btn = document.getElementById('autoBtn');
      if (btn && typeof btn.click === 'function') {
        btn.click();
      } else {
        renderAggregates();
      }

      // Ensure AI Analysis Chat is initialized after aggregates render
      setTimeout(() => {
        try {
          if (typeof initializeChat === 'function') {
            if (!window.currentData || window.currentData.length === 0) {
              window.currentData = ROWS;
            }
            const apiKey = localStorage.getItem('gemini_api_key');
            if (typeof initializeChat === 'function' && isValidApiKey(apiKey)) {
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                initializeChat();
            }
          }
        } catch (e) {
          console.warn('AI Analysis Chat init after manual load (AI Agent) failed:', e);
        }
      }, 400);
    }

  }catch(e){ console.error(e); showToast('Parse error: '+(e?.message||e), 'error'); $('#meta').textContent='Parse failed.'; }
};

$('#fileSelectBtn').onclick = () => $('#file').click();
$('#file').onchange = () => $('#loadBtn').click();

function switchMode(val){
  MODE = val;
  window.MODE = MODE;
  console.log('🔁 Mode switched to', window.MODE);
  const manual = MODE==='manual';
  const editBtn = $('#editRolesBtn');
  const addBtn = $('#addAggBtn');
  const clearBtn = $('#clearManualBtn');
  const recalcBtn = $('#recalcBtn');

  if (editBtn) editBtn.style.display = manual ? '' : 'none';
  if (addBtn) addBtn.style.display   = manual ? '' : 'none';
  if (clearBtn) clearBtn.style.display = manual ? '' : 'none';
  if (recalcBtn) recalcBtn.style.display = manual ? '' : 'none';

  // Disable manual actions when no profile is available (e.g., after reset or before load)
  const hasProfile = !!(window.PROFILE && Array.isArray(window.PROFILE.columns) && window.PROFILE.columns.length);
  if (editBtn) editBtn.disabled = manual && !hasProfile;
  if (addBtn) addBtn.disabled = manual && !hasProfile;
}
$('#mode').addEventListener('change', e=>{
  switchMode(e.target.value);
  renderAggregates(null, [], 0, false, { preserveExisting: true });
});
$('#dateFormat').addEventListener('change', ()=>{
  if (ROWS) {
    const dateFormat = $('#dateFormat').value;
    PROFILE = profile(ROWS, dateFormat); window.PROFILE = PROFILE;
    renderProfile(PROFILE, LAST_PARSE_META);
    renderAggregates();
    showToast(`Date format changed to ${dateFormat}. Re-profiling data.`, 'info');
    debouncedAutoSave();
  }
});
$('#autoExclude').addEventListener('change', e => {
  AUTO_EXCLUDE = e.target.checked;
  window.AUTO_EXCLUDE = AUTO_EXCLUDE;
  if (ROWS) {
    initializeRowInclusion();
    renderRawBody();
    // Re-render aggregates as the included rows have changed
    renderAggregates();
  }
  showToast(`Auto-exclude ${AUTO_EXCLUDE ? 'enabled' : 'disabled'}.`, 'info');
  debouncedAutoSave();
});
$('#editRolesBtn').onclick = openRoleEditor;
$('#addAggBtn').onclick = openAddAgg;
$('#clearManualBtn').onclick = ()=>{
  setManualRoles({});
  MANUAL_JOBS=[];
  renderAggregates();
  showToast('Manual overrides cleared.', 'info');
  debouncedAutoSave();
};
$('#recalcBtn').onclick = ()=>{ renderAggregates(); showToast('Recalculated with current roles', 'success'); debouncedAutoSave(); };

$('#searchInput').addEventListener('input', onSearch);
$('#rowsPerPage').addEventListener('change', ()=>{
  RPP = Number($('#rowsPerPage').value)||25;
  PAGE=1;
  window.RPP = RPP;
  window.PAGE = PAGE;
  renderRawBody();
});
$('#prevPage').addEventListener('click', ()=>{
  if(PAGE>1){
    PAGE--;
    window.PAGE = PAGE;
    renderRawBody();
  }
});
$('#nextPage').addEventListener('click', ()=>{
  const pages=Math.max(1, Math.ceil((window.FILTERED_ROWS?.length || 0) / (window.RPP || RPP)));
  if(PAGE<pages){
    PAGE++;
    window.PAGE = PAGE;
    renderRawBody();
  }
});
$('#resetExclusion').addEventListener('click', () => {
  if (ROWS) {
    initializeRowInclusion();
    renderRawBody();
    renderAggregates();
  }
});
$('#downloadFiltered').addEventListener('click', ()=>{
  const filtered = window.FILTERED_ROWS || FILTERED_ROWS || [];
  if (!filtered.length) return;
  const esc = s => { const str = String(s ?? ''); return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str; };
  const header = DATA_COLUMNS.map(esc).join(',');
  const sorted = sortRows(filtered);
  const body = sorted.map(r => DATA_COLUMNS.map(c => esc(r[c])).join(',')).join('\n');
  const blob = new Blob([header+'\n'+body], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'filtered_rows.csv'; a.click(); URL.revokeObjectURL(a.href);
  showToast('Filtered CSV downloaded', 'success');
});

$('#autoBtn').onclick = () => {
    // Check if workflow is already running
    const workflowState = WorkflowManager.getState();
    if (workflowState.status === 'running') {
        showToast('Workflow is already running. Please wait for completion.', 'warning');
        return;
    }
    
    // Check if renderAggregates is already running
    if (window.isRenderingAggregates) {
        showToast('Analysis is already in progress. Please wait for completion.', 'warning');
        return;
    }
    
    renderAggregates();
};

// buildAggCard, getAiAnalysisPlan, and getIntelligentAiAnalysisPlan moved to ai_chart_ui_helpers.js

// runAiWorkflow function moved to ai_chart_ui_workflow.js

// Initialize window-scoped render flags (shared with helpers)
window.isRenderingAggregates = false;
window.pendingRender = false;
// Button state management for workflow prevention - moved to ai_chart_ui_helpers.js

// renderAggregates moved to ai_chart_ui_helpers.js

/* ========= Modal accessibility: ESC & backdrop ========= */
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open')); }});

['roleModal','aggModal', 'historyModal', 'removedRowsModal', 'aiSettingsModal'].forEach(id=>{
  const m = document.getElementById(id);
  m?.addEventListener('click', (e)=>{
    if (e.target===m) {
      // If focus is inside an element we're about to hide from AT, move focus first
      try {
        if (m.contains(document.activeElement)) {
          const fallback = document.getElementById('mode') || document.getElementById('sidebar-toggle') || document.body;
          if (fallback && typeof fallback.focus === 'function') fallback.focus();
        }
      } catch {}
      m.classList.remove('open');
      m.setAttribute('aria-hidden','true');
    }
  });
});
$('#closeRemovedRowsModal').onclick = () => $('#removedRowsModal').classList.remove('open');

/* ========= Manual Save Handlers ========= */
$('#updateReportBtn').onclick = () => {
  if (!ROWS) return showToast('No data loaded to update.', 'error');
  if (!window.currentHistoryId) return showToast('No active report selected to update.', 'error');
  
  const currentName = $('#history-list .history-item[data-id="' + window.currentHistoryId + '"] .name')?.textContent || 'current report';
  if (confirm(`Are you sure you want to overwrite "${currentName}" with the current view?`)) {
    saveCurrentStateToHistory(currentName, false); // false = update existing
  }
};

$('#saveAsNewBtn').onclick = () => {
  if (!ROWS) return showToast('No data loaded to save.', 'error');
  
  const baseName = (LAST_PARSE_META && LAST_PARSE_META.fileName)
    ? LAST_PARSE_META.fileName.replace(/\.csv$/i, '')
    : 'Report';
  const defaultName = `${baseName} (copy) ${getFormattedDateTime()}`;
    
  const reportName = prompt('Enter a name for the new report:', defaultName);
  
  if (reportName) {
    saveCurrentStateToHistory(reportName, true); // true = force new entry
  }
};
/* ========= History Sidebar ========= */



// Make Store available globally for the chat module
window.Store = Store;






document.addEventListener('DOMContentLoaded', () => {
    // Initialize History Manager with dependencies
    initializeHistoryManager({
        $,
        showToast,
        Store,
        profile,
        renderProfile,
        buildRawHeader,
        applyFilter,
        renderRawBody,
        applyMasonryLayout,
        generateExplanation,
        checkAndGenerateAISummary,
        initializeChat,
        refreshChatUI,
        WorkflowManager,
        AITasks,
        workflowTimer,
        isValidApiKey,
        initializeRowInclusion,
        buildAggCard,
        updateAiTodoList,
        updateGlobalDescControls
    });

    initializeAiSettingsHandlers({ $, showToast });
    initializeSectionToggles();
    updateAIFeaturesVisibility();

    // Initialize global Description filter controls in CSV Input section
    try {
      const gdc = document.getElementById('global-desc-filter-controls');
      if (gdc && typeof initGlobalDescControls === 'function') {
        initGlobalDescControls(gdc);
      }
    } catch (e) { console.warn('initGlobalDescControls init failed:', e); }
    
    // Initialize workflow UI with dependencies
    initWorkflowUI({
        WorkflowManager,
        AITasks,
        workflowTimer,
        renderAggregates,
        getIncludedRows,
        applyMasonryLayout
    });
    const grid = $('#results');
    if (grid) {
        // The grid is populated dynamically when data is loaded.
    }
});

// Message listener for receiving CSV data from parent window
let csvProcessed = false;
window.addEventListener('message', async (event) => {
  // Verify origin matches current location
  if (event.origin !== window.location.origin) return;
  
  if (event.data && event.data.type === 'table_csv') {
    const { csv, header } = event.data;
    
    console.log('🔍 DEBUG: Received table_csv message');
    console.log('📋 Header data:', header);
    console.log('📊 CSV data length:', csv ? csv.length : 'null');
    console.log('📊 CSV data first 200 chars:', csv ? csv.substring(0, 200) : 'null');
    
    // Prevent duplicate processing
    if (csvProcessed) {
      console.log('⚠️ CSV already processed, ignoring duplicate message');
      return;
    }
    
    // Process the CSV data
    if (csv) {
      try {
        // Reset UI and state to ensure clean slate before loading new data
        console.log('[Workflow] Starting new file load - resetting UI and state first');
        resetUIAndState('auto');
        
        csvProcessed = true; // Mark as processing to prevent duplicates
        
        // The header parameter contains the report title/description (from headerTableEl)
        // The csv parameter contains: reportHeader + "\r\n\r\n" + actualCSVData
        
        console.log('🔄 Processing CSV data extraction...');
        
        // The CSV data comes from openAiTableBtn's tableToCsv() function which properly 
        // converts HTML tables to CSV. The structure is: reportHeader + "\r\n\r\n" + properCSV
        let csvData = csv;
        
        // Check for BOM first  
        const hasBOM = csvData.charCodeAt(0) === 0xFEFF;
        console.log('🔍 Has BOM:', hasBOM);
        if (hasBOM) {
          csvData = csvData.substring(1);
          console.log('✅ Removed BOM, new length:', csvData.length);
        }
        
        // Since openAiTableBtn creates: headerData + '\r\n\r\n' + csvBody
        // We need to remove the report header part to get clean CSV
        if (header && header.trim()) {
          // Find where the CSV actually starts by looking for the double newline after header
          const headerEndPattern = header.trim() + '\r\n\r\n';
          const headerEndIndex = csvData.indexOf(headerEndPattern);
          
          if (headerEndIndex >= 0) {
            // Extract CSV data after the header and double newlines
            csvData = csvData.substring(headerEndIndex + headerEndPattern.length);
            console.log('✅ Successfully removed report header section');
            console.log('📊 Clean CSV data length:', csvData.length);
          } else {
            // Try alternative patterns that might be in the data
            const patterns = [
              header.trim() + '\n\n',
              header.trim() + '\r\n', 
              header.trim()
            ];
            
            let found = false;
            for (const pattern of patterns) {
              const index = csvData.indexOf(pattern);
              if (index >= 0) {
                csvData = csvData.substring(index + pattern.length);
                // Skip any leading whitespace/newlines
                csvData = csvData.replace(/^[\s\r\n]+/, '');
                console.log(`✅ Removed header using pattern: "${pattern.substring(0, 30)}..."`);
                console.log('📊 Clean CSV data length:', csvData.length);
                found = true;
                break;
              }
            }
            
            if (!found) {
              console.log('⚠️ Could not find header pattern, using original CSV');
            }
          }
        }
        
        // Show first few lines for debugging
        const lines = csvData.split(/\r?\n/);
        console.log('📄 Final CSV lines count:', lines.length);
        console.log('📄 First 5 CSV lines:');
        for (let i = 0; i < Math.min(5, lines.length); i++) {
          console.log(`  Line ${i + 1}: "${lines[i]}"`);
        }
        
        // The tableToCsv function should have created proper CSV with headers
        // Trust that the table structure from rowHeaderEl and row1,row2... is correct
        
        // Create a File object from the pure CSV string for parseCSV function
        const csvBlob = new Blob([csvData], { type: 'text/csv' });
        const csvFile = new File([csvBlob], 'table_data.csv', { type: 'text/csv' });
        console.log('📦 Created File object:', csvFile.name, 'Size:', csvFile.size);
        
        // Update UI to show loading and report header
        $('#meta').textContent = 'Processing received table data...';
        
        // Display the report header if available
        if (header) {
          console.log('📋 Displaying report header');
          // Find or create a place to display the report title
          let reportTitleEl = document.getElementById('report-title');
          if (!reportTitleEl) {
            reportTitleEl = document.createElement('div');
            reportTitleEl.id = 'report-title';
            reportTitleEl.style.cssText = 'background: #f8fafc; padding: 12px; border-radius: 8px; margin: 16px 0px; border-left: 4px solid #2563eb; font-weight: 500;';
            // Insert after the section-content
            const mainSection = document.querySelector('.section');
            if (mainSection) {
              const sectionContent = mainSection.querySelector('.section-content');
              if (sectionContent) {
                sectionContent.insertAdjacentElement('afterend', reportTitleEl);
              }
            }
          }
          function formatHeaderForDisplay(rawHeader) {
            if (!rawHeader) return '';
            // Normalize newlines &nbsp; and tabs
            let s = rawHeader.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,' ').replace(/\u00A0/g,' ');
            // Split and keep only lines that contain visible characters after trimming
            const lines = s.split('\n').map(l => l.replace(/\s+/g,' ').trim()).filter(l => l.length > 0);
            // Escape HTML (if header may contain user input) — keep simple escaping here
            const esc = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
            return lines.map(esc).join('<br>');
          }
          reportTitleEl.innerHTML = `<strong>Report:</strong> ` + formatHeaderForDisplay(header);
        }
        
        // Use the same logic as the Load CSV button
        const choice = $('#delimiter').value || 'auto';
        const hasHeader = $('#hasHeader').checked;
        console.log('⚙️ Parse settings - Delimiter:', choice, 'Has header:', hasHeader);
        
        console.log('🚀 Starting parseCSV...');
        const { data, meta, detectionResult, preview } = await parseCSV(csvFile, choice, hasHeader);
        
        console.log('✅ parseCSV completed');
        console.log('📊 Parse results:');
        console.log('  - Data rows:', data ? data.length : 'null');
        console.log('  - Meta info:', meta);
        
        if (data && data.length > 0) {
          console.log('📋 First row structure:');
          console.log('  - Keys:', Object.keys(data[0]));
          console.log('  - Values:', Object.values(data[0]));
          console.log('📋 Sample of first 3 rows:');
          for (let i = 0; i < Math.min(3, data.length); i++) {
            console.log(`  Row ${i + 1}:`, data[i]);
          }
        }
        
        if (!data.length) throw new Error('No rows detected in received data.');
        
        // Set global variables same as loadBtn onclick
        console.log('🔧 Setting global variables...');
        window.PARSE_PREVIEW = preview || null;
        window.CSV_DETECTION = detectionResult || null;

        ROWS = data; window.ROWS = ROWS; window.currentData = data;
        DATA_COLUMNS = Object.keys(ROWS[0] || {}); window.DATA_COLUMNS = DATA_COLUMNS;
        
        console.log('📊 DATA_COLUMNS:', DATA_COLUMNS);
        
        PROFILE = profile(ROWS); window.PROFILE = PROFILE;
        console.log('📊 PROFILE generated:', PROFILE);
        
        // Coerce numeric columns into numbers to avoid leftover leading-apostrophes in strings
        if (PROFILE && PROFILE.columns) {
          const numericCols = PROFILE.columns.filter(c => c.type === 'number').map(c => c.name);
          if (numericCols.length) {
            for (const r of ROWS) {
              for (const col of numericCols) {
                const cleaned = toNum(r[col]);
                // Only coerce when parsed is finite AND the original contains at least one digit
                if (Number.isFinite(cleaned) && /[0-9]/.test(String(r[col]))) {
                  r[col] = cleaned;
                }
              }
            }
          }
        }
        
        renderProfile(PROFILE);
        
        {
          const det = window.CROSSTAB_DETECTION;
          const detTxt = det ? `, detected="${det.type || (det.isCrossTab ? 'cross-tab' : 'unknown')}"${typeof det.confidence === 'number' ? ` (${(det.confidence*100).toFixed(0)}%)` : ''}` : '';
          const skipTxt = meta && meta.skippedRows ? `, skippedMetaRows=${meta.skippedRows}` : '';
          $('#meta').textContent = `Loaded ${PROFILE.rowCount.toLocaleString()} rows, ${PROFILE.columns.length} columns from table data. (delimiter="${meta.delimiter}"${detTxt}${skipTxt})`;
        }
        $('#results').innerHTML = '';
        
        // Initialize row inclusion with smart detection
        console.log('🔧 Initializing row inclusion...');
        initializeRowInclusion();
        
        // Build Raw Data table - this was missing!
        console.log('🔧 Building Raw Data table...');
        buildRawHeader(DATA_COLUMNS);
        
        // Reset search and pagination
        QUERY = ''; window.QUERY = QUERY;
        $('#searchInput').value = '';
        SORT = { col: null, dir: 'asc' }; window.SORT = SORT;
        RPP = Number($('#rowsPerPage').value) || 25; window.RPP = RPP;
        PAGE = 1; window.PAGE = PAGE;
        
        // Apply filter and render the raw data table
        applyFilter();
        renderRawBody();
        // Refresh global Description controls after table stream load (pre-conversion)
        try { updateGlobalDescControls(); } catch (e) { console.warn('updateGlobalDescControls (table stream pre-conv) failed:', e); }

        // Detect cross-tab and convert to long for aggregation (table_csv path)
        try {
          const workerDetection = window.CSV_DETECTION;
          const detection = workerDetection || detectCrossTab(ROWS);
          window.CROSSTAB_DETECTION = detection;
          // Cross-tab conversion disabled (table stream path): always use long-format as-is.
          window.AGG_ROWS = null;
          window.AGG_PROFILE = null;
          window.CROSSTAB_OPTIONS = null;
          hideConvertedSection();
        } catch (e) {
          console.warn('Cross-tab detect/convert disabled (table stream):', e);
          window.AGG_ROWS = null;
          window.AGG_PROFILE = null;
          window.CROSSTAB_OPTIONS = null;
          hideConvertedSection();
        }

        // Refresh global Description controls after cross-tab conversion decision
        try { updateGlobalDescControls(); } catch (e) { console.warn('updateGlobalDescControls (table stream post-conv) failed:', e); }
        console.log('✅ Raw Data table rendered');
        
        // Reset manual overrides (same as loadBtn)
        setManualRoles({});
        MANUAL_JOBS = [];
        const smart = getDefaultMode();
        $('#mode').value = smart;
        switchMode(smart);
        safeReset(window.MODE); // Clear AI todo list on new load (guarded)
        
        // Enable other buttons
        $('#updateReportBtn').disabled = false;
        $('#saveAsNewBtn').disabled = false;
        
        // Auto-render aggregates if in auto mode
        if ($('#mode').value === 'auto') {
          console.log('🎯 Auto-rendering aggregates...');
          renderAggregates();

          // Ensure AI Analysis Chat is initialized after aggregates render
          setTimeout(() => {
            try {
              if (typeof initializeChat === 'function') {
                if (!window.currentData || window.currentData.length === 0) {
                  window.currentData = ROWS;
                }
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                initializeChat();
              }
            } catch (e) {
              console.warn('AI Analysis Chat init after table_csv processing failed:', e);
            }
          }, 400);
        } else if ($('#mode').value === 'ai_agent') {
          console.log('🎯 Auto-starting AI Agent workflow after table_csv load...');
          const btn = document.getElementById('autoBtn');
          if (btn && typeof btn.click === 'function') {
            btn.click();
          } else {
            renderAggregates();
          }

          // Ensure AI Analysis Chat is initialized after aggregates render
          setTimeout(() => {
            try {
              if (typeof initializeChat === 'function') {
                if (!window.currentData || window.currentData.length === 0) {
                  window.currentData = ROWS;
                }
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                initializeChat();
              }
            } catch (e) {
              console.warn('AI Analysis Chat init after table_csv processing (AI Agent) failed:', e);
            }
          }, 400);
        }

        console.log('🎉 Successfully processed table data');
        showToast('Table data received and loaded successfully', 'success');
        
        // Auto-save the initial load as a new history item (same as loadBtn)
        try {
          console.log('💾 Auto-saving initial table data load...');
          await saveCurrentStateToHistory('Table Data Report', true); // true = force new entry
          console.log('✅ Initial auto-save completed');
        } catch (saveError) {
          console.warn('⚠️ Auto-save failed:', saveError);
        }
      } catch (error) {
        console.error('❌ Error processing received CSV data:', error);
        console.error('❌ Error stack:', error.stack);
        $('#meta').textContent = 'Error processing received table data: ' + error.message;
        showToast('Failed to process table data: ' + error.message, 'error');
      }
    } else {
      console.warn('⚠️ No CSV data received in message');
    }
  }
});

// Send ready message to parent window
window.addEventListener('load', () => {
  if (window.opener && window.opener !== window) {
    try {
      window.opener.postMessage({ type: 'ready' }, window.location.origin);
    } catch (e) {
      console.log('Could not send ready message to parent:', e);
    }
  }
});

// AI Summary functionality
// checkAndGenerateAISummary function moved to ai_chart_ui_workflow.js

// generateAISummary function moved to ai_chart_ui_workflow.js

// collectAggregateData function moved to ai_chart_ui_workflow.js

// createSummaryPrompt function moved to ai_chart_ui_workflow.js

// AI Summary event listeners moved to ai_chart_ui_workflow.js

// Regenerate button functionality moved to ai_chart_ui_workflow.js

// ========= AI Analysis Chat Implementation =========
// Chat functionality has been moved to ai_chart_chat.js
