import { isNum, toNum, parseDateSafe } from './ai_chart_utils.js';
import { nice } from './ai_chart_aggregates.js';
import { showToast } from './ai_chart_toast_system.js';

// Utility function from ai_chart_ui.js
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }

// DOM selector utility 
const $ = s => document.querySelector(s);

// Helper functions for data table management
function isLikelyCodeColumn(name){ return /(code|id|sku|account|acct|phone|tel|zip|postal|nr|no|number)$/i.test(String(name).trim()); }

function columnType(name){ 
  // Access global PROFILE variable from main ui
  const c = window.PROFILE?.columns?.find(x=>x.name===name); 
  return c ? c.type : 'string'; 
}

// Detect rows that are likely subtotals, grand totals, or non-data rows
function isLikelyNonDataRow(row, index) {
  if (!row) return { result: true, reason: 'Row is empty' };

  const values = Object.values(row).map(v => String(v || '').trim());
  const lowerValues = values.map(v => v.toLowerCase());
  const allText = lowerValues.join(' ');

  // Rule 1: Explicit total keywords (enhanced to catch "Grand Total (SGD)")
  const totalPatterns = [
    /\b(grand\s+)?(sub)?total\b/i,
    /\bgrand\s+total\s*\(.+\)/i, // Catches "Grand Total (SGD)"
    /\bsum\b/i,
    /\btotal\s*(amount|qty|quantity|value|cost|price)\b/i,
    /\b(overall|final|net)\s+total\b/i,
    /^\s*(total|subtotal|sum)\s*:?\s*$/i
  ];
  const hasTotal = totalPatterns.some(pattern => pattern.test(allText));
  if (hasTotal) {
    const matchedValue = values.find(v => totalPatterns.some(p => p.test(v))) || 'total keyword';
    return { result: true, reason: `Contains total keyword: "${matchedValue}"` };
  }

  // Access global variables from main ui
  const CURRENCY_TOKENS = window.CURRENCY_TOKENS || [];
  const CURRENCY_COLUMN_HINTS = window.CURRENCY_COLUMN_HINTS || [];
  const DATA_COLUMNS = window.DATA_COLUMNS || [];

  // Rule 2: Currency-only subtotal rows
  const currencyPatterns = new RegExp(`^(${CURRENCY_TOKENS.join('|')})$`, 'i');
  const metricPatterns = /^(price|amount|total|cost|value|sum|subtotal|qty|quantity)$/i;

  let currencyCount = 0;
  let metricCount = 0;
  let numberCount = 0;
  let meaningfulTextCount = 0;
  let currencyInfo = null;

  values.forEach((val, i) => {
    const lowerVal = lowerValues[i];
    if (!lowerVal) return;

    if (currencyPatterns.test(lowerVal)) {
      currencyCount++;
      if (!currencyInfo) {
        const colName = DATA_COLUMNS[i] || '';
        currencyInfo = {
          token: val,
          colIndex: i,
          colName: colName,
          isCurrencyHintColumn: CURRENCY_COLUMN_HINTS.some(hint => colName.toLowerCase().includes(hint)),
          isTrailingColumn: i >= (values.length - 3)
        };
      }
    } else if (metricPatterns.test(lowerVal)) {
      metricCount++;
    } else if (isNum(val) && val !== '0') {
      numberCount++;
    } else if (val.length > 3) { // A bit more strict on "meaningful"
      meaningfulTextCount++;
    }
  });

  // Condition for currency-only subtotal
  const isCurrencySubtotal = currencyCount === 1 &&
                             numberCount >= 1 &&
                             meaningfulTextCount === 0 &&
                             currencyInfo && (currencyInfo.isCurrencyHintColumn || currencyInfo.isTrailingColumn);

  if (isCurrencySubtotal) {
    return { result: true, reason: `Currency subtotal (CCY='${currencyInfo.token}')` };
  }

  // Keep original checks for separators and mostly empty rows as fallbacks
  const hasAllCapsTotal = values.some(v => /^[A-Z\s]{3,}(TOTAL|SUM|SUBTOTAL)[A-Z\s]*$/.test(v));
  const isSeparator = values.some(v => /^[-=_]{3,}$/.test(v));

  if (hasAllCapsTotal) return { result: true, reason: 'Contains ALL CAPS total keywords' };
  if (isSeparator) return { result: true, reason: 'Appears to be a separator row' };
  
  return { result: false, reason: '' };
}

// Initialize row inclusion array with smart defaults
function initializeRowInclusion() {
  const ROWS = window.ROWS;
  if (!ROWS) return;
  
  window.ROW_EXCLUSION_REASONS = {};
  const AUTO_EXCLUDE = window.AUTO_EXCLUDE;

  if (!AUTO_EXCLUDE) {
    window.ROW_INCLUDED = ROWS.map(() => true);
    console.log('Auto-exclude disabled. Including all rows.');
    return;
  }
  
  let excludedCount = 0;
  window.ROW_INCLUDED = ROWS.map((row, index) => {
    const exclusion = isLikelyNonDataRow(row, index);
    if (exclusion.result) {
      window.ROW_EXCLUSION_REASONS[index] = exclusion.reason;
      excludedCount++;
    }
    return !exclusion.result;
  });
  
  const message = `Auto-excluded ${excludedCount} rows.`;
  console.log(`🔍 ${message}`);
  showToast(message, 'info');
}

// Get only the rows that are included for aggregation
function getIncludedRows() {
  const ROWS = window.ROWS;
  const ROW_INCLUDED = window.ROW_INCLUDED;
  
  if (!ROWS || !ROW_INCLUDED || ROW_INCLUDED.length !== ROWS.length) {
    return Array.isArray(ROWS) ? ROWS : []; // safe fallback: always return an array
  }
  
  const includedRows = ROWS.filter((row, index) => ROW_INCLUDED[index]);
  console.log(`📊 Using ${includedRows.length} included rows out of ${ROWS.length} total rows for aggregation`);
  return includedRows;
}

function buildRawHeader(columns, renderAggregates, debouncedAutoSave, renderRawBody, renderSortIndicators){
  const thead = $('#dataThead'); 
  thead.innerHTML='';
  const tr = document.createElement('tr');
  
  // Add checkbox column header
  const checkboxTh = document.createElement('th');
  checkboxTh.className = 'sticky';
  checkboxTh.style.width = '60px';
  checkboxTh.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
      <input type="checkbox" id="selectAllRows" title="Select/Deselect All" style="margin: 0;">
      <small style="font-size: 10px; color: #666;">Include</small>
    </div>
  `;
  
  // Select all functionality
  const selectAllCheckbox = checkboxTh.querySelector('#selectAllRows');
  selectAllCheckbox.addEventListener('change', (e) => {
    const checked = e.target.checked;
    const ROWS = window.ROWS;
    window.ROW_INCLUDED.fill(checked);
    renderRawBody();
    // For bulk selection prefer immediate update
    renderAggregates();
    debouncedAutoSave();
    console.log(`${checked ? 'Selected' : 'Deselected'} all ${ROWS.length} rows`);
  });
  
  tr.appendChild(checkboxTh);
  
  // Add data column headers
  columns.forEach(col=>{
    const th=document.createElement('th'); 
    th.className='sticky'; 
    th.dataset.col = col;
    const titleSpan = document.createElement('span');
    titleSpan.className = 'col-title';
    titleSpan.textContent = col;
    th.appendChild(titleSpan);
    const s = document.createElement('span'); s.className='sort'; s.textContent='';
    th.appendChild(s);
    th.addEventListener('click', ()=>{
      const SORT = window.SORT;
      if (SORT.col===col){ SORT.dir = (SORT.dir==='asc'?'desc':'asc'); }
      else { SORT.col=col; SORT.dir='asc'; }
      renderSortIndicators(); renderRawBody();
    });
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  renderSortIndicators();
}

function renderSortIndicators(){
  const ths = Array.from($('#dataThead').querySelectorAll('th'));
  const SORT = window.SORT;
  ths.forEach(th=>{
    const col = th.dataset?.col || th.querySelector('.col-title')?.textContent?.trim() || th.textContent?.trim() || '';
    const span = th.querySelector('.sort');
    if (!span) return;
    if (SORT.col===col) span.textContent = SORT.dir==='asc' ? '↑' : '↓';
    else span.textContent = '';
  });
}

function applyFilter(){
  const ROWS = window.ROWS;
  const DATA_COLUMNS = window.DATA_COLUMNS;
  const QUERY = window.QUERY;
  
  const q = QUERY.trim().toLowerCase();
  if (!q){ 
    window.FILTERED_ROWS = ROWS; 
    return; 
  }
  window.FILTERED_ROWS = ROWS.filter(row=>{
    for (const c of DATA_COLUMNS){
      const v = row[c];
      if (v!=null && String(v).toLowerCase().includes(q)) return true;
    }
    return false;
  });
}

function sortRows(rows){
  const SORT = window.SORT;
  if (!SORT.col) return rows;
  const name = SORT.col;
  const t = columnType(name);
  const dir = SORT.dir==='asc' ? 1 : -1;
  const cmp = (a,b)=>{
    const av = a[name], bv = b[name];
    if (t==='number'){
      const an = toNum(av), bn = toNum(bv);
      if (isNaN(an) && isNaN(bn)) return 0; if (isNaN(an)) return -dir; if (isNaN(bn)) return dir;
      return an < bn ? -dir : an > bn ? dir : 0;
    } else if (t==='date'){
      const an = parseDateSafe(av), bn = parseDateSafe(bv);
      if (isNaN(an) && isNaN(bn)) return 0; if (isNaN(an)) return -dir; if (isNaN(bn)) return dir;
      return an < bn ? -dir : an > bn ? dir : 0;
    } else {
      const as = (av==null?'':String(av)).toLowerCase();
      const bs = (bv==null?'':String(bv)).toLowerCase();
      return as < bs ? -dir : as > bs ? dir : 0;
    }
  };
  return rows.map((r,i)=>({r,i})).sort((A,B)=> cmp(A.r,B.r) || (A.i - B.i)).map(A=>A.r);
}

function renderTFootSums(){
  const tfoot = $('#dataTFoot'); 
  tfoot.innerHTML='';
  const FILTERED_ROWS = window.FILTERED_ROWS;
  const DATA_COLUMNS = window.DATA_COLUMNS;
  const ROWS = window.ROWS;
  const ROW_INCLUDED = window.ROW_INCLUDED;
  
  if (!FILTERED_ROWS?.length){ return; }
  const tr = document.createElement('tr');
  
  // Add placeholder for checkbox column
  const placeholderTd = document.createElement('td');
  placeholderTd.style.width = '60px'; // Match header checkbox column
  tr.appendChild(placeholderTd);

  DATA_COLUMNS.forEach(col=>{
    const td = document.createElement('td');
    const t = columnType(col);
    if (t==='number' && !isLikelyCodeColumn(col)){
      let sum = 0;
      // Only sum rows that are both filtered AND included
      for (const r of FILTERED_ROWS){ 
        const originalIndex = ROWS.findIndex(row => row === r);
        if (originalIndex !== -1 && ROW_INCLUDED[originalIndex]) {
          const n = toNum(r[col]); 
          if (!isNaN(n)) sum += n; 
        }
      }
      td.textContent = 'Σ ' + nice(sum);
    } else { td.textContent = ''; }
    tr.appendChild(td);
  });
  tfoot.appendChild(tr);
}

function renderRawBody(debouncedRenderAggregates, debouncedAutoSave){
  const tbody = $('#dataTbody'); 
  tbody.innerHTML='';
  const FILTERED_ROWS = window.FILTERED_ROWS;
  const RPP = window.RPP;
  const DATA_COLUMNS = window.DATA_COLUMNS;
  const ROWS = window.ROWS;
  const ROW_INCLUDED = window.ROW_INCLUDED;
  const ROW_EXCLUSION_REASONS = window.ROW_EXCLUSION_REASONS;
  const QUERY = window.QUERY;
  
  let PAGE = window.PAGE;
  const total = FILTERED_ROWS.length, pages = Math.max(1, Math.ceil(total / RPP));
  PAGE = Math.min(PAGE, pages);
  window.PAGE = PAGE;
  const sorted = sortRows(FILTERED_ROWS);
  const start = (PAGE-1)*RPP, end = Math.min(start+RPP, total);
  
  // Function to highlight search terms in text
  function highlightText(text, query) {
    if (!query || !query.trim()) return text;
    // Escape HTML in the text first to prevent XSS
    const safeText = String(text).replace(/[&<>"']/g, function(m) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
    });
    const escapedQuery = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(regex, '<mark>$1</mark>');
  }
  
  for (let i=start;i<end;i++){
    const r = sorted[i];
    const originalIndex = ROWS.indexOf(r); // Find original index for checkbox state
    const tr = document.createElement('tr');
    
    // Add checkbox column
    const checkboxTd = document.createElement('td');
    checkboxTd.style.textAlign = 'center';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = ROW_INCLUDED[originalIndex] || false;
    checkbox.style.margin = '0';
    
    // Add visual indicator for auto-detected non-data rows
    const exclusionReason = ROW_EXCLUSION_REASONS[originalIndex];
    if (exclusionReason) {
      checkboxTd.style.backgroundColor = '#fff3cd';
      checkboxTd.title = `Excluded: ${exclusionReason}`;
      tr.style.backgroundColor = '#fff3cd';
      tr.style.opacity = '0.7';
    }
    
    checkbox.addEventListener('change', (e) => {
      window.ROW_INCLUDED[originalIndex] = e.target.checked;
      console.log(`Row ${originalIndex + 1} ${e.target.checked ? 'included' : 'excluded'} for aggregation`);
      
      // Update select all checkbox state
      const allChecked = ROW_INCLUDED.every(inc => inc);
      const noneChecked = ROW_INCLUDED.every(inc => !inc);
      const selectAllCheckbox = document.getElementById('selectAllRows');
      if (selectAllCheckbox) {
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
      }
      
      // Update Raw Data table footer sums when inclusion changes
      renderTFootSums();
      
      debouncedRenderAggregates();
      debouncedAutoSave();
    });
    
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);
    
    // Add data columns
    DATA_COLUMNS.forEach(c=>{
      const td = document.createElement('td');
      let v = r[c];
      const textValue = (v==null? '' : String(v));
      
      // Apply highlighting if there's a search query
      const searchTerm = QUERY ? QUERY.trim() : '';
      if (searchTerm) {
        td.innerHTML = highlightText(textValue, searchTerm);
      } else {
        td.textContent = textValue;
      }
      
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  $('#pageInfo').textContent = `Page ${PAGE} / ${pages}`;
  $('#rowInfo').textContent = `Showing ${total? start+1:0}–${end} of ${total}${(ROWS && ROWS.length!==total) ? ` (filtered from ${ROWS.length})` : ''}`;
  $('#prevPage').disabled = PAGE<=1;
  $('#nextPage').disabled = PAGE>=pages;
  renderTFootSums();
}

// Create debounced search handler
const createOnSearchHandler = (applyFilterFn, renderRawBodyFn) => {
  return debounce(()=>{ 
    window.QUERY = $('#searchInput').value; 
    window.PAGE = 1; 
    applyFilterFn(); 
    renderRawBodyFn(); 
  }, 200);
};

export {
  isLikelyCodeColumn,
  columnType,
  isLikelyNonDataRow,
  initializeRowInclusion,
  getIncludedRows,
  buildRawHeader,
  renderSortIndicators,
  applyFilter,
  sortRows,
  renderTFootSums,
  renderRawBody,
  createOnSearchHandler
};