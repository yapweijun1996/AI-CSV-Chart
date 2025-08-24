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
import { buildAggCard, getAiAnalysisPlan, getIntelligentAiAnalysisPlan, renderAggregates, setGenerateButtonState } from './ai_chart_ui_helpers.js';
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

function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// NOTE: nice function moved to ai_chart_aggregates.js; formatNumberFull kept here for backwards compatibility
function formatNumberFull(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
const debouncedRenderAggregates = debounce(() => { renderAggregates(); }, 300);
window.debouncedRenderAggregates = debouncedRenderAggregates;

// Debounced auto-save function
const debouncedAutoSave = debounce(() => {
  console.log(`🔍 Auto-save check: currentHistoryId=${!!window.currentHistoryId}, ROWS=${!!ROWS}`);
  if (!window.currentHistoryId || !ROWS) {
    console.log(`❌ Auto-save skipped: missing currentHistoryId=${!!window.currentHistoryId} or ROWS=${!!ROWS}`);
    return;
  }
  
  // Don't auto-save if workflow is still running to prevent loops
  if (typeof WorkflowManager !== 'undefined') {
    const workflowState = WorkflowManager.getState();
    if (workflowState.status === 'running') {
      console.log('⏸️ Auto-save paused: workflow still running');
      return;
    }
  }
  
  const currentName = $('#history-list .history-item[data-id="' + window.currentHistoryId + '"] .name')?.textContent || 'current report';
  console.log(`💾 Auto-saving changes to "${currentName}"...`);
  saveCurrentStateToHistory(currentName, false); // false = update existing
}, 1500);

function forceAutoSave(reason = 'manual-action') {
  try {
    if (!window.currentHistoryId || !ROWS) {
      console.log(`❌ Force save skipped (${reason}): missing currentHistoryId=${!!window.currentHistoryId} or ROWS=${!!ROWS}`);
      return;
    }
    const li = document.querySelector('#history-list .history-item[data-id="' + window.currentHistoryId + '"] .name');
    const currentName = li?.textContent || 'current report';
    console.log(`💾 Force-saving (${reason}) "${currentName}"...`);
    saveCurrentStateToHistory(currentName, false);
  } catch (e) {
    console.error('Force save failed:', e);
  }
}
window.forceAutoSave = forceAutoSave;
window.debouncedAutoSave = debouncedAutoSave;
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
function signatureFromHeaders(){
  if (!DATA_COLUMNS.length) return '';
  return DATA_COLUMNS.join('|') + '::' + (ROWS?ROWS.length:0);
}
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
      MANUAL_ROLES = s.MANUAL_ROLES || {};
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
  const dims = roles.filter(x => x.role==='dimension' && !x.unsuitable).map(x => ({ ...x, col: x.col }))
    .sort((a, b) => b.completeness - a.completeness || a.cardinality - b.cardinality);
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
    ...businessDims.temporal.slice(0,1),    // Temporal categories
    ...businessDims.general.slice(0,2)      // General dimensions
  ].slice(0,3);
  
  prioritizedDims.forEach(d => {
    if (primary && d.col) {
      // Financial metrics use sum, others use appropriate aggregation
      const aggType = d.category === 'financial' ? 'sum' : 'sum';
      jobs.push({
        groupBy: d.col.name,
        metric: primary.name,
        agg: aggType,
        category: d.category,
        priority: d.priority
      });
      
      // Smart chart type selection based on data category
      let chartType = 'bar';
      if (d.category === 'status' && d.col.unique <= 8) chartType = 'pie';
      else if (d.category === 'location') chartType = 'bar';
      else if (d.category === 'hierarchy') chartType = 'hbar';
      else if (d.col.unique <= 8) chartType = 'pie';
      
      charts.push({
        useJob: jobs.length-1,
        preferredType: chartType,
        title: `${primary.name} by ${d.col.name}`,
        category: d.category,
        priority: d.priority === 'high' ? 'high' : 'normal'
      });
      
      // Add average analysis for high-value dimensions
      if (d.priority === 'high' || d.category === 'location') {
        jobs.push({
          groupBy: d.col.name,
          metric: primary.name,
          agg: 'avg',
          category: d.category,
          priority: d.priority
        });
        charts.push({
          useJob: jobs.length-1,
          preferredType: 'hbar',
          title: `avg ${primary.name} by ${d.col.name}`,
          category: d.category,
          priority: 'normal'
        });
      }
    }
    
    // Count analysis for all dimensions (only when no primary metric is available)
    if (d.col && !primary) {
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
  
  // Secondary metric analysis with business context
  const secondaryMetrics = [
    ...quantityMetrics.filter(m => m.col.name !== primary?.name).slice(0,1),
    ...generalMetrics.filter(m => m.col.name !== primary?.name).slice(0,1)
  ];
  
  if (secondaryMetrics.length && prioritizedDims.length) {
    const secondMetric = secondaryMetrics[0];
    const topDim = prioritizedDims[0];
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
  const modal = $('#roleModal'); const tb = $('#roleTBody'); tb.innerHTML='';
  PROFILE.columns.forEach(c=>{
    const tr=document.createElement('tr');
    const roleAuto = inferRole(c, PROFILE, ROWS).role;
    const current = MANUAL_ROLES[c.name] || roleAuto;
    const tdName = document.createElement('td'); tdName.textContent = c.name;
    const tdType = document.createElement('td'); tdType.textContent = c.type;
    const tdUniq = document.createElement('td'); tdUniq.textContent = c.unique;
    const tdRole = document.createElement('td');
    const sel = document.createElement('select'); sel.setAttribute('data-col', c.name);
    ['dimension','metric','date','id','ignore'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
    sel.value = current.replace('metric:strong','metric'); tdRole.appendChild(sel);
    const tdSample = document.createElement('td'); tdSample.className='muted small'; tdSample.textContent = (c.samples||[]).join(' | ');
    tr.append(tdName, tdType, tdUniq, tdRole, tdSample); tb.appendChild(tr);
  });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  modal.focus();
}
$('#closeRoleModal').onclick = ()=>{
  const modal = $('#roleModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  try { document.getElementById('editRolesBtn')?.focus(); } catch {}
};
$('#saveRoles').onclick = ()=>{
  MANUAL_ROLES = {};
  $('#roleTBody').querySelectorAll('select').forEach(sel=>{ MANUAL_ROLES[ sel.getAttribute('data-col') ] = sel.value; });
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
      jobs.push({ groupBy:d.name, metric:primary.name, agg:'avg' });
      charts.push({ useJob: jobs.length-1, preferredType:'hbar', title:`avg ${primary.name} by ${d.name}` });
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
  const bucket = $('#aggBucket'); gb.innerHTML=''; mt.innerHTML=''; bucket.value='';

  // Build candidate lists. In Manual mode prefer MANUAL_ROLES, but fall back to inferred types if empty.
  let dims = [];
  let nums = [];

  if (MODE === 'manual') {
    const dimsByRoles = PROFILE.columns.filter(c => (MANUAL_ROLES[c.name]||'')==='dimension' || (MANUAL_ROLES[c.name]||'')==='date');
    const numsByRoles = PROFILE.columns.filter(c => (MANUAL_ROLES[c.name]||'')==='metric');
    const inferredDims = PROFILE.columns.filter(c => ['string','date'].includes(c.type));
    const inferredNums = PROFILE.columns.filter(c => c.type==='number');

    dims = dimsByRoles.length ? dimsByRoles : inferredDims;
    nums = numsByRoles.length ? numsByRoles : inferredNums;
  } else {
    dims = PROFILE.columns.filter(c => ['string','date'].includes(c.type));
    nums = PROFILE.columns.filter(c => c.type==='number');
  }

  // Populate selects
  dims.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; gb.appendChild(o); });
  nums.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=c.name; mt.appendChild(o); });

  // Enable/disable bucket based on selected groupBy type
  const setBucketAvailability = () => {
    const selectedGb = gb.value;
    const col = PROFILE.columns.find(c => c.name === selectedGb);
    if (col && col.type === 'date') {
      bucket.disabled = false;
    } else {
      bucket.disabled = true;
      bucket.value = '';
    }
  };
  setBucketAvailability();
  gb.addEventListener('change', setBucketAvailability);

  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
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
    const {data, meta}=await parseCSV(f, choice, header, progress => {
        if (progress.type === 'meta') {
            $('#meta').textContent = progress.text;
        }
    });
    if(!data.length) throw new Error('No rows detected (check delimiter/header).');
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
    $('#meta').textContent=`Loaded ${PROFILE.rowCount.toLocaleString()} rows, ${PROFILE.columns.length} columns. (delimiter="${meta.delimiter}")`;
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
    MANUAL_ROLES = {}; MANUAL_JOBS = [];
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
  $('#editRolesBtn').style.display = manual ? '' : 'none';
  $('#addAggBtn').style.display   = manual ? '' : 'none';
  $('#clearManualBtn').style.display = manual ? '' : 'none';
  $('#recalcBtn').style.display = manual ? '' : 'none';
}
$('#mode').addEventListener('change', e=>{ switchMode(e.target.value); renderAggregates(); });
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
$('#clearManualBtn').onclick = ()=>{ MANUAL_ROLES={}; MANUAL_JOBS=[]; renderAggregates(); showToast('Manual overrides cleared.', 'info'); debouncedAutoSave(); };
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
const sidebar = $('#sidebar');
const toggleBtn = $('#sidebar-toggle');
// Accessibility: link button with sidebar and manage expanded state
toggleBtn.setAttribute('aria-controls', 'sidebar');

const SIDEBAR_COLLAPSE_KEY = 'csv-chart-v5:sidebar-collapsed';
function updateSidebarToggleA11y(){
  const expanded = !sidebar.classList.contains('collapsed');
  toggleBtn.setAttribute('aria-expanded', String(expanded));
  toggleBtn.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.textContent = expanded ? 'Sidebar expanded' : 'Sidebar collapsed';
  }
}
function applyStoredSidebarState(){
  try {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    sidebar.classList.toggle('collapsed', collapsed);
  } catch {}
  updateSidebarToggleA11y();
}
toggleBtn.addEventListener('click', () => {
  const hadFocusInside = sidebar.contains(document.activeElement);
  const prevFocus = document.activeElement;

  sidebar.classList.toggle('collapsed');

  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebar.classList.contains('collapsed') ? '1' : '0');
  } catch {}

  updateSidebarToggleA11y();

  if (hadFocusInside) {
    requestAnimationFrame(() => {
      try {
        if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
          prevFocus.focus();
          return;
        }
      } catch {}
      const list = document.getElementById('history-list');
      const fallback = list?.querySelector('.history-item.active') || list?.querySelector('.history-item') || toggleBtn;
      fallback?.focus();
    });
  }
});
// Initialize from storage on load
applyStoredSidebarState();

async function renderHistorySidebar() {
  const list = $('#history-list');
  const searchInput = $('#history-search');
  const searchTerm = (searchInput.value || '').toLowerCase();
  list.innerHTML = '<li>Loading...</li>';
  try {
    let historyItems = await Store.listHistory();
    
    if (searchTerm) {
      historyItems = historyItems.filter(item =>
        (item.name || '').toLowerCase().includes(searchTerm)
      );
    }

    list.innerHTML = '';
    if (!historyItems.length) {
      list.innerHTML = `<li class="muted small" style="padding: 0 var(--s-4);">${searchTerm ? 'No matching reports found.' : 'No history yet.'}</li>`;
      return;
    }
    for (const item of historyItems) {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.setAttribute('data-id', item.id);
      li.setAttribute('data-tooltip', item.name || 'Untitled');
      // a11y + keyboard: make entire item focusable and operable
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-label', item.name || 'Untitled');
      li.title = item.name || 'Untitled';
      if (item.id === window.currentHistoryId) {
        li.classList.add('active');
        li.setAttribute('aria-current', 'true');
        li.setAttribute('aria-selected', 'true');
      } else {
        li.removeAttribute('aria-selected');
      }

      const nameSpan = document.createElement('div');
      nameSpan.className = 'name';
      nameSpan.textContent = item.name || 'Untitled';
      nameSpan.title = item.name || 'Untitled';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'meta';
      
      const dateSpan = document.createElement('span');
      dateSpan.innerHTML = `📅 ${new Date(item.updatedAt).toLocaleDateString()}`;
      
      const rowsSpan = document.createElement('span');
      rowsSpan.innerHTML = `≡ ${item.rowCount.toLocaleString()} rows`;

      const colsSpan = document.createElement('span');
      colsSpan.innerHTML = `📊 ${item.columns.length} cols`;

      metaDiv.append(dateSpan, rowsSpan, colsSpan);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'load-btn';
      loadBtn.textContent = 'Load';
      loadBtn.onclick = (e) => {
        e.stopPropagation(); // prevent li click
        loadHistoryState(item.id);
      };
      
      if (item.status && item.status !== 'ready') {
        loadBtn.textContent = `Saving...`;
        loadBtn.disabled = true;
      }

      actionsDiv.appendChild(loadBtn);
      
      // Click anywhere on the item to load (buttons stop propagation)
      li.addEventListener('click', () => { loadHistoryState(item.id); });
      // Keyboard support: Enter/Space to load; ArrowUp/Down/Home/End to navigate
      li.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          loadHistoryState(item.id);
          return;
        }
        const items = Array.from(list.querySelectorAll('.history-item'));
        const i = items.indexOf(li);
        if (key === 'ArrowDown') {
          e.preventDefault();
          const next = items[Math.min(items.length - 1, i + 1)];
          next?.focus();
        } else if (key === 'ArrowUp') {
          e.preventDefault();
          const prev = items[Math.max(0, i - 1)];
          prev?.focus();
        } else if (key === 'Home') {
          e.preventDefault();
          items[0]?.focus();
        } else if (key === 'End') {
          e.preventDefault();
          items[items.length - 1]?.focus();
        }
      });
      
      li.append(nameSpan, metaDiv, actionsDiv);
      list.appendChild(li);
    }
  } catch (e) {
    console.error('Failed to render history', e);
    list.innerHTML = '<li class="muted small error">Could not load history.</li>';
  }
}

export function getUiSnapshot() {
  const sectionStates = {};
  document.querySelectorAll('.section').forEach(section => {
    const header = section.querySelector('.section-header');
    if (header) {
      const headingEl = header.querySelector('h2, h3, h4');
      const headingText = headingEl ? headingEl.textContent.trim() : '';
      if (headingText) {
        const sectionId = headingText.replace(/\s+/g, '-').toLowerCase();
        sectionStates[sectionId] = section.classList.contains('is-collapsed');
      }
    }
  });

  // Capture AI Summary content if it exists
  const aiSummaryText = document.getElementById('ai-summary-text');
  const aiSummaryContent = aiSummaryText ? aiSummaryText.innerHTML : null;
  const aiSummaryVisible = document.getElementById('ai-summary-section')?.style.display !== 'none';

  // Capture AI Analysis Chat history if it exists
  const chatHistory = window.chatState ? {
    messages: window.chatState.messages || [],
    lastContextRefresh: window.chatState.lastContextRefresh || null,
    timestamp: Date.now()
  } : null;

  return {
    mode: MODE,
    manualRoles: MANUAL_ROLES,
    manualJobs: MANUAL_JOBS,
    sort: SORT,
    query: QUERY,
    page: PAGE,
    rpp: RPP,
    autoExclude: AUTO_EXCLUDE,
    currencyTokens: CURRENCY_TOKENS,
    rowInclusion: ROW_INCLUDED,
    charts: getChartsSnapshot(), // Capture the state of all rendered charts
    sectionCollapsedState: sectionStates,
    aiSummary: {
      content: aiSummaryContent,
      visible: aiSummaryVisible,
      timestamp: aiSummaryContent ? Date.now() : null
    },
    chatHistory: chatHistory
  };
}

// Make getUiSnapshot and Store available globally for the chat module
window.getUiSnapshot = getUiSnapshot;
window.Store = Store;

async function saveCurrentStateToHistory(fileName, forceNew = false) {
  if (!ROWS || !PROFILE) return;

  const toastId = `toast-${Date.now()}`;
  showToast('Saving report... 0%', 'info', 999999, toastId);

  try {
    const isUpdating = !forceNew && window.currentHistoryId;
    
    let finalName = fileName || 'Untitled Report';
    if (!isUpdating) {
      finalName = `${finalName.replace(/\s\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/, '')} ${getFormattedDateTime()}`;
    }

    const historyItem = {
      id: isUpdating ? window.currentHistoryId : crypto.randomUUID(),
      sig: signatureFromHeaders(),
      name: finalName,
      columns: DATA_COLUMNS,
      rowCount: ROWS.length,
      meta: LAST_PARSE_META,
      uiSnapshot: getUiSnapshot(),
      status: 'saving',
    };

    const id = await Store.saveHistory(historyItem);
    window.currentHistoryId = id;
    await renderHistorySidebar();

    // Optimization: If updating, check if rows have changed. If not, only update metadata.
    if (isUpdating) {
      const existing = await Store.getHistory(id);
      const sameRows = existing && existing.rowCount === ROWS.length && existing.sig === signatureFromHeaders();
      if (sameRows) {
        console.log('Optimization: UI-only change detected. Updating snapshot without re-uploading chunks.');
        await Store.updateHistory(id, { uiSnapshot: getUiSnapshot(), updatedAt: Date.now(), status: 'ready' });
        await renderHistorySidebar();
        showToast('Report updated (UI settings saved).', 'success', 3000, toastId);
        return; // Skip chunk re-upload
      }
    }

    try {
      const chunkSize = 5000;
      const totalChunks = Math.ceil(ROWS.length / chunkSize);
      let idx = 0;
      for (let i = 0; i < ROWS.length; i += chunkSize) {
        const chunk = ROWS.slice(i, i + chunkSize);
        await Store.appendChunk(id, idx++, chunk);
        const progress = Math.round((idx / totalChunks) * 100);
        showToast(`Saving report... ${progress}%`, 'info', 999999, toastId);
        if (idx % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      
      await Store.updateHistory(id, { status: 'ready' });
      showToast('Report saved successfully!', 'success', 3000, toastId);
    } catch (e) {
      console.error('Chunk saving failed:', e);
      await Store.updateHistory(id, { status: 'error' });
      showToast('Failed to save report data.', 'error', 3000, toastId);
    } finally {
      await renderHistorySidebar();
    }
  } catch (e) {
    console.error('Failed to save history', e);
    showToast('Failed to save history.', 'error', 3000, toastId);
  }
}

function getChartsSnapshot() {
  const charts = [];
  document.querySelectorAll('#results .card').forEach(card => {
    const cardTitle = card.querySelector('.card-title')?.textContent || '';
    const cardCharts = [];
    const explanationEl = card.querySelector('.ai-explanation-content');
    // Get the raw markdown/text if stored, otherwise get the rendered HTML
    const explanation = card.dataset.explanationMarkdown || (explanationEl ? explanationEl.innerHTML : null);

    // The job key is stored directly on the card's dataset
    const ds = card.dataset || {};
    const jobKey = {
      groupBy: ds.groupBy || '',
      metric: ds.metric || null,
      agg: ds.agg || 'sum',
      dateBucket: ds.dateBucket || ''
    };

    card.querySelectorAll('.chart-card').forEach(chartCard => {
      const type = chartCard.querySelector('select')?.value || 'auto';
      const topN = chartCard.querySelector('input[type="number"]')?.value || '20';
      cardCharts.push({ type, topN });
    });

    const filterInput = card.querySelector('.filter-input');
    const filterModeSelect = card.querySelector('.filter-mode-select');

    charts.push({
      title: cardTitle,
      cardJobKey: jobKey,
      charts: cardCharts,
      filterValue: filterInput ? filterInput.value : 0,
      filterMode: filterModeSelect ? filterModeSelect.value : 'share',
      explanation: explanation,
      showMissing: card.dataset.showMissing === 'true'
    });
  });
  return charts;
}

async function loadHistoryState(id) {
  // Reset UI and state to ensure clean slate before loading history
  console.log('[Workflow] Starting history load - resetting UI and state first');
  resetUIAndState('auto');
  const toastId = `toast-${Date.now()}`;
  showToast('Loading report... 0%', 'info', 999999, toastId);
  
  // Stage 1: Read and validate snapshot WITHOUT touching current UI
  let result, history, rows, snapshot;
  try {
    const onProgress = (loaded, total) => {
      const progress = total > 0 ? Math.round((loaded / total) * 100) : 100;
      showToast(`Loading report... ${progress}%`, 'info', 999999, toastId);
    };

    result = await Store.restoreHistory(id, onProgress);
    if (!result) {
      showToast('History item not found.', 'error', 3000, toastId);
      return;
    }
    
    ({ history, rows } = result);

    if (history.status === 'saving') {
      showToast('This report is still saving. Please wait.', 'info', 3000, toastId);
      return;
    }
    if (history.status === 'error') {
      showToast('This report is corrupted and cannot be loaded.', 'error', 3000, toastId);
      return;
    }
    if (!rows || !Array.isArray(rows)) {
      showToast('Failed to load report data.', 'error', 3000, toastId);
      return;
    }
    
    // Validate critical snapshot data
    snapshot = history.uiSnapshot || {};
    if (!history.columns || !Array.isArray(history.columns)) {
      showToast('Report data is corrupted (missing columns).', 'error', 3000, toastId);
      return;
    }
    
    console.log('✅ Snapshot validation passed:', { 
      rows: rows.length, 
      columns: history.columns.length, 
      hasCharts: !!(snapshot.charts && Array.isArray(snapshot.charts))
    });
    
    // Set global data for chat and other components
    window.currentData = rows;
    
  } catch (error) {
    console.error('Failed to load or validate history:', error);
    showToast('Error loading report: ' + (error.message || 'Unknown error'), 'error', 3000, toastId);
    return;
  }
  
  // Stage 2: Backup current state for rollback
  const backup = {
    rows: ROWS,
    columns: DATA_COLUMNS,
    meta: LAST_PARSE_META,
    profile: PROFILE,
    mode: MODE,
    manualRoles: MANUAL_ROLES,
    manualJobs: MANUAL_JOBS,
    sort: SORT,
    query: QUERY,
    page: PAGE,
    rpp: RPP,
    autoExclude: AUTO_EXCLUDE,
    currencyTokens: CURRENCY_TOKENS,
    rowInclusion: ROW_INCLUDED,
    currentHistoryId: window.currentHistoryId
  };
  
  // Stage 3: Apply new state with error recovery
  try {

    showToast(`Restoring "${history.name || 'Untitled'}"...`, 'info', 999999, toastId);
    
    // Restore data
    ROWS = rows;
    window.ROWS = ROWS; // Make ROWS accessible to helper modules
    window.currentData = ROWS; // Ensure AI Chat has access to dataset
    DATA_COLUMNS = history.columns || [];
    window.DATA_COLUMNS = DATA_COLUMNS;
    LAST_PARSE_META = history.meta || {};
    PROFILE = profile(ROWS); window.PROFILE = PROFILE;
    
    // Restore UI state from snapshot
    MODE = snapshot.mode || 'auto';
    MANUAL_ROLES = snapshot.manualRoles || {};
    MANUAL_JOBS = snapshot.manualJobs || [];
    SORT = snapshot.sort || { col: null, dir: 'asc' };
    QUERY = snapshot.query || '';
    PAGE = snapshot.page || 1;
    RPP = snapshot.rpp || 25;
    AUTO_EXCLUDE = (typeof snapshot.autoExclude === 'boolean') ? snapshot.autoExclude : true;
    if (Array.isArray(snapshot.currencyTokens) && snapshot.currencyTokens.length > 0) {
      CURRENCY_TOKENS = snapshot.currencyTokens;
    }
    // Sync critical state to window for data-table module
    window.MODE = MODE;
    window.AUTO_EXCLUDE = AUTO_EXCLUDE;
    window.QUERY = QUERY;
    window.SORT = SORT;
    window.PAGE = PAGE;
    window.RPP = RPP;
    window.CURRENCY_TOKENS = CURRENCY_TOKENS;
    if (Array.isArray(snapshot.rowInclusion)) {
       if (snapshot.rowInclusion.length === ROWS.length) {
         ROW_INCLUDED = snapshot.rowInclusion;
          window.ROW_INCLUDED = ROW_INCLUDED;
       } else {
         console.warn('history rowInclusion length mismatch; adjusting saved inclusion to current rows');
         const arr = snapshot.rowInclusion.slice(0, ROWS.length);
         while (arr.length < ROWS.length) arr.push(true);
         ROW_INCLUDED = arr;
          window.ROW_INCLUDED = ROW_INCLUDED;
       }
     } else {
      initializeRowInclusion();
     }
    
    if (snapshot.sectionCollapsedState) {
      document.querySelectorAll('.section').forEach(section => {
        const header = section.querySelector('.section-header');
        if (header) {
          const headingEl = header.querySelector('h2, h3, h4');
          const headingText = headingEl ? headingEl.textContent.trim() : '';
          if (headingText) {
            const sectionId = headingText.replace(/\s+/g, '-').toLowerCase();
            if (snapshot.sectionCollapsedState[sectionId] === true) {
              section.classList.add('is-collapsed');
              const btn = header.querySelector('.section-toggle');
              if(btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('aria-label', `Show ${headingText}`);
                
                // Update button text properly without breaking structure
                const buttonTextEl = btn.querySelector('.button-text');
                if (buttonTextEl) {
                  buttonTextEl.textContent = 'Show';
                } else {
                  // Fallback: if button doesn't have proper structure, set textContent
                  btn.textContent = 'Show';
                }
                
                const content = section.querySelector('.section-content');
                if(content) content.setAttribute('aria-hidden', 'true');
              }
            }
          }
        }
      });
    }

    // Restore AI Summary if it was saved
    if (snapshot.aiSummary) {
      const aiSummarySection = document.getElementById('ai-summary-section');
      const aiSummaryText = document.getElementById('ai-summary-text');
      
      if (aiSummarySection && aiSummaryText && snapshot.aiSummary.content) {
        console.log('📄 Restoring saved AI Summary');
        aiSummaryText.innerHTML = snapshot.aiSummary.content;
        
        // Show the section if it was visible and API key is available
        const apiKey = localStorage.getItem('gemini_api_key');
        if (snapshot.aiSummary.visible && apiKey && apiKey.trim()) {
          aiSummarySection.style.display = 'block';
          console.log('✅ AI Summary section restored and shown');
        } else {
          aiSummarySection.style.display = 'none';
          console.log('🔒 AI Summary content restored but section hidden (no API key or was not visible)');
        }
      }
    }

    // Restore AI Analysis Chat history if it exists
    if (snapshot.chatHistory && snapshot.chatHistory.messages && Array.isArray(snapshot.chatHistory.messages)) {
      console.log('💬 Restoring saved chat history:', snapshot.chatHistory.messages.length, 'messages');
      
      // Initialize chat state if not already done
      if (!window.chatState) {
        window.chatState = {
          messages: [],
          isTyping: false,
          lastContextRefresh: null
        };
      }
      
      // Restore messages and state
      window.chatState.messages = snapshot.chatHistory.messages;
      window.chatState.lastContextRefresh = snapshot.chatHistory.lastContextRefresh;
      
      console.log('✅ Chat history restored successfully');
    } else {
      console.log('📝 No chat history found in snapshot');
      // Initialize empty chat state
      if (!window.chatState) {
        window.chatState = {
          messages: [],
          isTyping: false,
          lastContextRefresh: null
        };
      }
    }

    // === Force AI Analysis Chat UI refresh after state restoration ===
    try {
      const chatSectionEl = document.getElementById('ai-analysis-section');
      if (chatSectionEl) {
        chatSectionEl.style.display = 'block';
      }

      // Normalize state for empty or missing histories
      if (!window.chatState || !Array.isArray(window.chatState.messages)) {
        window.chatState = { messages: [], isTyping: false, lastContextRefresh: null };
      }

      // Preferred path: refresh UI without re-initializing listeners
      if (typeof refreshChatUI === 'function') {
        refreshChatUI();
      } else {
        // Fallback: if refresh helper isn't available yet, avoid early-return by re-init once
        if (chatSectionEl && chatSectionEl.hasAttribute('data-chat-initialized')) {
          chatSectionEl.removeAttribute('data-chat-initialized');
        }
        if (typeof initializeChat === 'function') {
          initializeChat();
        } else {
          // Minimal fallback: ensure container isn't stale
          const messagesContainer = document.getElementById('chat-messages');
          if (messagesContainer) {
            const msgs = Array.isArray(window.chatState.messages) ? window.chatState.messages : [];
            messagesContainer.innerHTML = '';
            if (msgs.length === 0) {
              messagesContainer.innerHTML = `
                <div class="welcome-message">
                  <div class="ai-message">
                    <div class="message-avatar">🤖</div>
                    <div class="message-content">
                      <p>Hello! I'm your AI assistant for data analysis. I have access to your current charts, aggregations, and data patterns. Ask me anything about your data!</p>
                    </div>
                  </div>
                </div>
              `;
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Chat UI force-refresh failed:', e);
    }

    // Update UI elements
    $('#meta').textContent = `Loaded ${PROFILE.rowCount.toLocaleString()} rows from history.`;
    $('#searchInput').value = QUERY;
    $('#rowsPerPage').value = RPP;
    $('#autoExclude').checked = AUTO_EXCLUDE;
    $('#mode').value = MODE;
    switchMode(MODE);
    
    // Render everything safely  
    renderProfile(PROFILE, LAST_PARSE_META);
    buildRawHeader(DATA_COLUMNS);
    applyFilter();
    renderRawBody();
    
    // Safe aggregates restoration with validation
    const restoreSessionId = `restore_${Date.now()}`;
    console.log(`🔄 Starting aggregates restore with session: ${restoreSessionId}`);
    
    const grid = $('#results');
    if (grid) grid.innerHTML = ''; // Clear grid for both cases

    if (snapshot.charts && Array.isArray(snapshot.charts) && snapshot.charts.length > 0) {
        console.log(`📊 Restoring ${snapshot.charts.length} saved charts`);
 
        // Step 1: Build all cards in parallel without generating new explanations
        const cardBuildPromises = snapshot.charts.map((cardSnap, idx) => {
            const jobKey = cardSnap.cardJobKey || {};
            console.log(`⏱ buildPhase start: card#${idx} key=${(jobKey.groupBy||'')}/${(jobKey.metric||'')}/${(jobKey.agg||'')}`);
            // Pass noAnimation flag down to buildAggCard
            return buildAggCard(jobKey, { ...cardSnap, noAnimation: true }, null, { skipExplanation: true })
              .then(res => {
                console.log(`⏱ buildPhase done: card#${idx} key=${res.card.dataset.canonicalKey}`);
                return res;
              });
        });
 
        console.time('restore:PromiseAll:cards');
        const cardDataArray = await Promise.all(cardBuildPromises);
        console.timeEnd('restore:PromiseAll:cards');
        console.log('⏱ All card builds resolved (Promise.all). Appending cards to DOM now.');
 
        // Append all cards to the DOM at once so they appear together
        const appendStart = Date.now();
        cardDataArray.forEach((data, i) => {
            grid.appendChild(data.card);
        });
        const appendEnd = Date.now();
        console.log(`⏱ Appended ${cardDataArray.length} cards to DOM (took ${appendEnd - appendStart} ms)`);
 
        // Apply layout after cards are in the DOM
        setTimeout(() => {
            console.log('⏱ applyMasonryLayout scheduled (150ms)');
            applyMasonryLayout();
        }, 150);
        setTimeout(() => {
            console.log('⏱ applyMasonryLayout scheduled (500ms)');
            applyMasonryLayout();
        }, 500);
 
        // Step 2: Sequentially generate explanations for cards that don't have one
        console.log('🤖 Starting sequential AI explanation generation for cards missing it...');
        // Step 2: Sequentially update the workflow UI and generate explanations
        console.log('🤖 Starting sequential UI update and AI explanation generation...');
        safeReset('auto');
        WorkflowManager.start();

        // Use small delays to make the UI progression feel natural
        await new Promise(r => setTimeout(r, 50));
        WorkflowManager.completeTask('init', 'Session initialized from history.');
        
        await new Promise(r => setTimeout(r, 50));
        WorkflowManager.completeTask('analysis', 'Data profile loaded from history.');
        
        await new Promise(r => setTimeout(r, 50));
        WorkflowManager.completeTask('ai-generation', 'Chart recommendations loaded from history.');
        
        await new Promise(r => setTimeout(r, 50));
        WorkflowManager.completeTask('rendering', 'Charts and tables rendered.');

        const explanationTasks = [];
        for (let i = 0; i < cardDataArray.length; i++) {
            const { card, initialAgg, job } = cardDataArray[i];
            const cardSnap = snapshot.charts[i];
            
            if (!cardSnap.explanation) {
                explanationTasks.push({ agg: initialAgg, jobKey: job, card, index: i });
            } else {
                console.log(`ℹ️ Card #${i} already has explanation in snapshot; skipping generation.`);
            }
        }

        if (explanationTasks.length > 0) {
            // This task is now 'in-progress'
            WorkflowManager.updateCurrentTaskMessage(`Generating ${explanationTasks.length} new explanations...`);
            for (const [index, task] of explanationTasks.entries()) {
                console.log(`⏱ generateExplanation queued start: card#${task.index}`);
                WorkflowManager.updateCurrentTaskMessage(`Generating explanation ${index + 1} of ${explanationTasks.length}...`);
                await generateExplanation(task.agg, task.jobKey, task.card);
                console.log(`⏱ generateExplanation completed: card#${task.index}`);
                
                // Auto-save after each explanation is generated
                console.log(`🔄 Triggering auto-save after explanation ${index + 1}...`);
                debouncedAutoSave();
            }
            WorkflowManager.completeTask('ai-explanation', `${explanationTasks.length} explanations generated.`);
            
            // Auto-save after all explanations are completed
            console.log(`🔄 Triggering auto-save after all explanations completed...`);
            debouncedAutoSave();
        } else {
            WorkflowManager.completeTask('ai-explanation', 'All explanations were loaded from history.');
        }
        
        await new Promise(r => setTimeout(r, 50));
        WorkflowManager.completeTask('completion', 'Workflow finished.');
        
        // Check if we should show and generate AI Summary
        checkAndGenerateAISummary();
        
        // Stop timer and cleanup on completion
        workflowTimer.stop();
        console.log('⏹️ Workflow timer stopped on completion (history restore)');
        
        // Force a final UI update to show completion state
        setTimeout(() => {
            const finalState = WorkflowManager.getState();
            console.log('🔍 Final workflow state (history restore):', finalState.status, finalState.tasks.map(t => `${t.description}: ${t.status}`));
            updateAiTodoList(finalState);
        }, 100);
        
        console.log('✅ AI explanations completed.');
    } else {
        console.log('📊 No saved charts found, generating fresh aggregates');
    }

    window.currentHistoryId = id;
    showToast(`Loaded "${history.name || 'Untitled'}"`, 'success', 3000, toastId);
    renderHistorySidebar(); // To update active state
    
    // Initialize chat section after history restore
    setTimeout(() => {
      console.log('🔍 Chat restore check:', {
        chatSection: !!document.getElementById('ai-analysis-section'),
        hasCurrentData: !!(window.currentData && window.currentData.length > 0),
        dataLength: window.currentData ? window.currentData.length : 0
      });
      
      const chatSection = document.getElementById('ai-analysis-section');
      const apiKey = localStorage.getItem('gemini_api_key');
      if (chatSection && window.currentData && window.currentData.length > 0 && isValidApiKey(apiKey)) {
        chatSection.style.display = 'block';
        
        // Try to initialize chat - check if function exists in scope
        if (typeof initializeChat === 'function') {
          initializeChat();
          console.log('📱 AI Analysis Chat initialized after history restore');
        } else {
          console.log('⚠️ initializeChat function not available yet, will retry...');
          // Retry after a short delay
          setTimeout(() => {
            if (typeof initializeChat === 'function') {
              initializeChat();
              console.log('📱 AI Analysis Chat initialized after retry');
            } else {
              console.log('❌ initializeChat still not available');
            }
          }, 200);
        }
      } else {
        console.log('❌ Chat initialization failed - missing requirements');
      }
    }, 600);
    
  } catch (restoreError) {
    console.error('Failed during restore - rolling back:', restoreError);
    
    // Rollback to previous state
    try {
      ROWS = backup.rows;
      window.ROWS = ROWS; // Restore window access
      window.currentData = ROWS; // Restore window access for AI Chat
      DATA_COLUMNS = backup.columns;
      LAST_PARSE_META = backup.meta;
      PROFILE = backup.profile; window.PROFILE = PROFILE;
      MODE = backup.mode;
      MANUAL_ROLES = backup.manualRoles;
      MANUAL_JOBS = backup.manualJobs;
      SORT = backup.sort;
      QUERY = backup.query;
      PAGE = backup.page;
      RPP = backup.rpp;
      AUTO_EXCLUDE = backup.autoExclude;
      CURRENCY_TOKENS = backup.currencyTokens;
      ROW_INCLUDED = backup.rowInclusion;
      window.currentHistoryId = backup.currentHistoryId;
      
      // Restore UI to previous state
      if (ROWS && DATA_COLUMNS) {
        $('#meta').textContent = `${ROWS.length.toLocaleString()} rows loaded.`;
        renderProfile(PROFILE);
        buildRawHeader(DATA_COLUMNS);
        applyFilter();
        renderRawBody();
      }
      
      showToast(`Failed to restore report. Previous state recovered. Error: ${restoreError.message}`, 'error', 5000, toastId);
      console.log('✅ Rollback completed successfully');
    } catch (rollbackError) {
      console.error('Critical: Rollback failed!', rollbackError);
      showToast('Critical error: Failed to restore report and rollback failed. Please refresh the page.', 'error', 10000, toastId);
    }
  }
}

// Initial render
async function openHistoryManager() {
  const modal = $('#historyModal');
  const listContainer = $('#history-management-list');
  const selectAllCheckbox = $('#history-select-all');
  const deleteSelectedBtn = $('#deleteSelectedBtn');
  
  listContainer.innerHTML = 'Loading...';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');

  try {
    const historyItems = await Store.listHistory();
    listContainer.innerHTML = '';
    if (!historyItems.length) {
      listContainer.innerHTML = '<div class="muted small" style="padding: 8px;">No history to manage.</div>';
      selectAllCheckbox.disabled = true;
      return;
    }
    selectAllCheckbox.disabled = false;
    selectAllCheckbox.checked = false;

    historyItems.forEach(item => {
      const div = document.createElement('div');
      div.className = 'history-manage-item';
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '8px';
      div.style.padding = '8px';
      div.style.border = '1px solid var(--border)';
      div.style.borderRadius = 'var(--radius-xs)';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('data-id', item.id);
      checkbox.className = 'history-item-checkbox';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.name;
      nameSpan.style.flexGrow = '1';

      const renameBtn = document.createElement('button');
      renameBtn.textContent = 'Rename';
      renameBtn.onclick = async () => {
        const newName = prompt('Enter new name for this report:', item.name);
        if (newName && newName.trim() !== '') {
          await Store.updateHistory(item.id, { name: newName.trim() });
          showToast('Report renamed.', 'success');
          await renderHistorySidebar();
          openHistoryManager(); // Refresh the modal list
        }
      };

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.background = '#fee2e2';
      deleteBtn.style.color = '#b91c1c';
      deleteBtn.style.border = '1px solid #fecaca';
      deleteBtn.onclick = async () => {
        if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
          await Store.deleteHistory(item.id);
          showToast('Report deleted.', 'success');
          await renderHistorySidebar();
          openHistoryManager(); // Refresh the modal list
        }
      };

      div.append(checkbox, nameSpan, renameBtn, deleteBtn);
      listContainer.appendChild(div);
    });

    // Add event listeners for bulk actions
    const checkboxes = listContainer.querySelectorAll('.history-item-checkbox');
    
    function updateDeleteButtonState() {
      const selected = listContainer.querySelectorAll('.history-item-checkbox:checked');
      deleteSelectedBtn.disabled = selected.length === 0;
      if (!deleteSelectedBtn.disabled) {
        deleteSelectedBtn.style.background = '#f87171';
        deleteSelectedBtn.style.color = '#7f1d1d';
        deleteSelectedBtn.style.cursor = 'pointer';
      } else {
        deleteSelectedBtn.style.background = '#fca5a5';
        deleteSelectedBtn.style.color = '#7f1d1d';
        deleteSelectedBtn.style.cursor = 'not-allowed';
      }
    }

    checkboxes.forEach(cb => cb.addEventListener('change', updateDeleteButtonState));
    
    selectAllCheckbox.onchange = () => {
      checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
      updateDeleteButtonState();
    };
    
    updateDeleteButtonState();

  } catch (e) {
    console.error('Failed to load history for management', e);
    listContainer.innerHTML = '<div class="muted small error" style="padding: 8px;">Could not load history.</div>';
  }
}

$('#manageHistoryBtn').onclick = openHistoryManager;
$('#closeHistoryModal').onclick = () => {
  const modal = $('#historyModal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  try { document.getElementById('manageHistoryBtn')?.focus(); } catch {}
};

$('#deleteSelectedBtn').onclick = async () => {
  const selected = document.querySelectorAll('#history-management-list .history-item-checkbox:checked');
  if (selected.length === 0) return;

  if (confirm(`Are you sure you want to delete ${selected.length} selected report(s)?`)) {
    for (const cb of selected) {
      const id = cb.getAttribute('data-id');
      await Store.deleteHistory(id);
    }
    showToast(`${selected.length} report(s) deleted.`, 'success');
    await renderHistorySidebar();
    openHistoryManager(); // Refresh modal
  }
};

$('#clearAllHistoryBtn').onclick = async () => {
  if (confirm('Are you sure you want to delete ALL saved reports? This action cannot be undone.')) {
    const historyItems = await Store.listHistory();
    for (const item of historyItems) {
      await Store.deleteHistory(item.id);
    }
    showToast('All history has been cleared.', 'success');
    await renderHistorySidebar();
    $('#historyModal').classList.remove('open');
  }
};

document.addEventListener('DOMContentLoaded', () => {
    renderHistorySidebar();
    initializeAiSettingsHandlers({ $, showToast });
    initializeSectionToggles();
    updateAIFeaturesVisibility();
    
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
$('#history-search').addEventListener('input', debounce(renderHistorySidebar, 250));

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
        const {data, meta} = await parseCSV(csvFile, choice, hasHeader);
        
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
        
        $('#meta').textContent = `Loaded ${PROFILE.rowCount.toLocaleString()} rows, ${PROFILE.columns.length} columns from table data. (delimiter="${meta.delimiter}")`;
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
        console.log('✅ Raw Data table rendered');
        
        // Reset manual overrides (same as loadBtn)
        MANUAL_ROLES = {}; 
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

