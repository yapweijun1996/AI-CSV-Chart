// History Manager Module - extracted from ai_chart_ui.js

// Dependency placeholders and injection
let _deps = {};
let $ = (s) => document.querySelector(s);
let showToast = (msg, type = 'info', duration = 3000, id = null) => {
  try {
    if (typeof window.showToast === 'function') return window.showToast(msg, type, duration, id);
    console[type === 'error' ? 'error' : 'log'](msg);
  } catch (e) { console.log(msg); }
};

// Simple debounce utility (local)
function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Sidebar state key
const SIDEBAR_COLLAPSE_KEY = 'csv-chart-v5:sidebar-collapsed';

// Internal refs
let sidebarEl = null;
let toggleBtnEl = null;

function updateSidebarToggleA11y() {
  if (!sidebarEl || !toggleBtnEl) return;
  const expanded = !sidebarEl.classList.contains('collapsed');
  toggleBtnEl.setAttribute('aria-expanded', String(expanded));
  toggleBtnEl.setAttribute('aria-label', expanded ? 'Collapse sidebar' : 'Expand sidebar');
  const announcer = document.getElementById('sr-announcer');
  if (announcer) announcer.textContent = expanded ? 'Sidebar expanded' : 'Sidebar collapsed';
}

function applyStoredSidebarState() {
  try {
    const collapsed = localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
    if (sidebarEl) sidebarEl.classList.toggle('collapsed', collapsed);
  } catch {}
  updateSidebarToggleA11y();
}

function attachSidebarListeners() {
  sidebarEl = $('#sidebar');
  toggleBtnEl = $('#sidebar-toggle');
  if (!toggleBtnEl || !sidebarEl) return;
  toggleBtnEl.setAttribute('aria-controls', 'sidebar');
  toggleBtnEl.addEventListener('click', () => {
    const hadFocusInside = sidebarEl.contains(document.activeElement);
    const prevFocus = document.activeElement;
    sidebarEl.classList.toggle('collapsed');
    try {
      localStorage.setItem(SIDEBAR_COLLAPSE_KEY, sidebarEl.classList.contains('collapsed') ? '1' : '0');
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
       const fallback = list?.querySelector('.history-item.active') || list?.querySelector('.history-item') || toggleBtnEl;
        fallback?.focus();
      });
    }
  });
  applyStoredSidebarState();
}

// Helpers to access global state safely
const G = {
  get ROWS() { return window.ROWS; },
  set ROWS(v) { window.ROWS = v; },
  get PROFILE() { return window.PROFILE; },
  set PROFILE(v) { window.PROFILE = v; },
  get DATA_COLUMNS() { return window.DATA_COLUMNS || []; },
  set DATA_COLUMNS(v) { window.DATA_COLUMNS = v; },
  get LAST_PARSE_META() { return window.LAST_PARSE_META || {}; },
  set LAST_PARSE_META(v) { window.LAST_PARSE_META = v; },
  get MODE() { return window.MODE || 'auto'; },
  set MODE(v) { window.MODE = v; },
  get MANUAL_ROLES() { return window.MANUAL_ROLES || {}; },
  set MANUAL_ROLES(v) { window.MANUAL_ROLES = v; },
  get MANUAL_JOBS() { return window.MANUAL_JOBS || []; },
  set MANUAL_JOBS(v) { window.MANUAL_JOBS = v; },
  get SORT() { return window.SORT || { col: null, dir: 'asc' }; },
  set SORT(v) { window.SORT = v; },
  get QUERY() { return window.QUERY || ''; },
  set QUERY(v) { window.QUERY = v; },
  get PAGE() { return window.PAGE || 1; },
  set PAGE(v) { window.PAGE = v; },
  get RPP() { return window.RPP || 25; },
  set RPP(v) { window.RPP = v; },
  get AUTO_EXCLUDE() { return window.AUTO_EXCLUDE ?? true; },
  set AUTO_EXCLUDE(v) { window.AUTO_EXCLUDE = v; },
  get CURRENCY_TOKENS() { return window.CURRENCY_TOKENS || []; },
  set CURRENCY_TOKENS(v) { window.CURRENCY_TOKENS = v; },
  get ROW_INCLUDED() { return window.ROW_INCLUDED || []; },
  set ROW_INCLUDED(v) { window.ROW_INCLUDED = v; }
};

// Date/Time format
function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// Header signature for state binding
function signatureFromHeaders() {
  const cols = G.DATA_COLUMNS;
  return (cols.length ? cols.join('|') : '') + '::' + (G.ROWS ? G.ROWS.length : 0);
}

// Charts snapshot
function getChartsSnapshot() {
  const charts = [];
  document.querySelectorAll('#results .card').forEach(card => {
    const cardTitle = card.querySelector('.card-title')?.textContent || '';
    const cardCharts = [];
    const explanationEl = card.querySelector('.ai-explanation-content');
    const explanation = card.dataset.explanationMarkdown || (explanationEl ? explanationEl.innerHTML : null);
    const ds = card.dataset || {};
    // Restore 'where' filter if it was present on the card (e.g., Description=Revenue)
    let where = null;
    try { where = ds.where ? JSON.parse(ds.where) : null; } catch { where = null; }
    const jobKey = {
      groupBy: ds.groupBy || '',
      metric: ds.metric || null,
      agg: ds.agg || 'sum',
      dateBucket: ds.dateBucket || '',
      ...(where ? { where } : {})
    };
    card.querySelectorAll('.chart-card').forEach(chartCard => {
      const type = chartCard.querySelector('select')?.value || 'auto';
      const topN = chartCard.querySelector('input[type="number"]')?.value || '20';
      cardCharts.push({ type, topN });
    });
    const filterInput = card.querySelector('.filter-input');
    const filterModeSelect = card.querySelector('.filter-mode-select');
    // Persist per-card excluded keys (for Include column) if any
    let excludedKeys = null;
    try {
      excludedKeys = ds.excludedKeys ? JSON.parse(ds.excludedKeys) : null;
      if (!Array.isArray(excludedKeys)) excludedKeys = null;
    } catch { excludedKeys = null; }

    charts.push({
      title: cardTitle,
      cardJobKey: jobKey,
      charts: cardCharts,
      filterValue: filterInput ? filterInput.value : 0,
      filterMode: filterModeSelect ? filterModeSelect.value : 'share',
      explanation,
      showMissing: card.dataset.showMissing === 'true',
      ...(excludedKeys ? { excludedKeys } : {})
    });
  });
  return charts;
}

// UI snapshot
function getUiSnapshot() {
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
  const aiSummaryText = document.getElementById('ai-summary-text');
  const aiSummaryContent = aiSummaryText ? aiSummaryText.innerHTML : null;
  const aiSummaryVisible = document.getElementById('ai-summary-section')?.style.display !== 'none';
  const chatHistory = window.chatState ? {
    messages: window.chatState.messages || [],
    lastContextRefresh: window.chatState.lastContextRefresh || null,
    timestamp: Date.now()
  } : null;
  return {
    mode: G.MODE,
    manualRoles: G.MANUAL_ROLES,
    manualJobs: G.MANUAL_JOBS,
    sort: G.SORT,
    query: G.QUERY,
    page: G.PAGE,
    rpp: G.RPP,
    autoExclude: G.AUTO_EXCLUDE,
    currencyTokens: G.CURRENCY_TOKENS,
    rowInclusion: G.ROW_INCLUDED,
    charts: getChartsSnapshot(),
    sectionCollapsedState: sectionStates,
    aiSummary: {
      content: aiSummaryContent,
      visible: aiSummaryVisible,
      timestamp: aiSummaryContent ? Date.now() : null
    },
    chatHistory
  };
}

// Render history sidebar
async function renderHistorySidebar() {
  const list = $('#history-list');
  const searchInput = $('#history-search');
  if (!list || !_deps.Store) return;
  console.debug('[History] renderHistorySidebar:start', { currentHistoryId: window.currentHistoryId });
  const searchTerm = ((searchInput?.value) || '').toLowerCase();
  list.innerHTML = '<li>Loading...</li>';
  try {
    let historyItems = await _deps.Store.listHistory();
    if (searchTerm) {
      historyItems = historyItems.filter(item => (item.name || '').toLowerCase().includes(searchTerm));
    }
    console.debug('[History] renderHistorySidebar:list', { count: historyItems.length, searchTerm });
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
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-label', item.name || 'Untitled');
      li.title = item.name || 'Untitled';
      if (item.id === window.currentHistoryId) {
        li.classList.add('active');
        li.setAttribute('aria-current', 'true');
        li.setAttribute('aria-selected', 'true');
        console.debug('[History] renderHistorySidebar:item', { id: item.id, active: true });
      } else {
        li.removeAttribute('aria-selected');
        console.debug('[History] renderHistorySidebar:item', { id: item.id, active: false, currentHistoryId: window.currentHistoryId });
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
      loadBtn.textContent = item.status && item.status !== 'ready' ? 'Saving...' : 'Load';
      if (item.status && item.status !== 'ready') loadBtn.disabled = true;
      loadBtn.onclick = (e) => { e.stopPropagation(); console.debug('[History] click:load-btn', { id: item.id, currentHistoryId: window.currentHistoryId }); loadHistoryState(item.id); };
      actionsDiv.appendChild(loadBtn);
      li.addEventListener('click', () => { console.debug('[History] click:list-item', { id: item.id, currentHistoryId: window.currentHistoryId }); loadHistoryState(item.id); });
      li.addEventListener('keydown', (e) => {
        const key = e.key;
        if (key === 'Enter' || key === ' ') {
          e.preventDefault(); loadHistoryState(item.id); return;
        }
        const items = Array.from(list.querySelectorAll('.history-item'));
        const i = items.indexOf(li);
        if (key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
        else if (key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
        else if (key === 'Home') { e.preventDefault(); items[0]?.focus(); }
        else if (key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
      });
      li.append(nameSpan, metaDiv, actionsDiv);
      list.appendChild(li);
    }
  } catch (e) {
    console.error('Failed to render history', e);
    list.innerHTML = '<li class="muted small error">Could not load history.</li>';
  }
}

// Auto-save handlers
const debouncedAutoSave = debounce(() => {
  if (!window.currentHistoryId || !G.ROWS) return;
  if (_deps.WorkflowManager && typeof _deps.WorkflowManager.getState === 'function') {
    const workflowState = _deps.WorkflowManager.getState();
    if (workflowState.status === 'running') return;
  }
  const nameSel = `#history-list .history-item[data-id="${window.currentHistoryId}"] .name`;
  const currentName = document.querySelector(nameSel)?.textContent || 'current report';
  saveCurrentStateToHistory(currentName, false);
}, 1500);

function forceAutoSave(reason = 'manual-action') {
  try {
    if (!window.currentHistoryId || !G.ROWS) return;
    const li = document.querySelector(`#history-list .history-item[data-id="${window.currentHistoryId}"] .name`);
    const currentName = li?.textContent || 'current report';
    saveCurrentStateToHistory(currentName, false);
  } catch (e) { console.error('Force save failed:', e); }
}

// Save current state/report
async function saveCurrentStateToHistory(fileName, forceNew = false) {
  if (!G.ROWS || !G.PROFILE) return;
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
      columns: G.DATA_COLUMNS,
      rowCount: G.ROWS.length,
      meta: G.LAST_PARSE_META,
      uiSnapshot: getUiSnapshot(),
      status: 'saving',
    };
    const id = await _deps.Store.saveHistory(historyItem);
    window.currentHistoryId = id;
    await renderHistorySidebar();
    if (isUpdating) {
      const existing = await _deps.Store.getHistory(id);
      const sameRows = existing && existing.rowCount === G.ROWS.length && existing.sig === signatureFromHeaders();
      if (sameRows) {
        await _deps.Store.updateHistory(id, { uiSnapshot: getUiSnapshot(), updatedAt: Date.now(), status: 'ready' });
        await renderHistorySidebar();
        showToast('Report updated (UI settings saved).', 'success', 3000, toastId);
        return;
      }
    }
    try {
      const chunkSize = 5000;
      const totalChunks = Math.ceil(G.ROWS.length / chunkSize);
      let idx = 0;
      for (let i = 0; i < G.ROWS.length; i += chunkSize) {
        const chunk = G.ROWS.slice(i, i + chunkSize);
        await _deps.Store.appendChunk(id, idx++, chunk);
        const progress = Math.round((idx / totalChunks) * 100);
        showToast(`Saving report... ${progress}%`, 'info', 999999, toastId);
        if (idx % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
      await _deps.Store.updateHistory(id, { status: 'ready' });
      showToast('Report saved successfully!', 'success', 3000, toastId);
    } catch (e) {
      console.error('Chunk saving failed:', e);
      await _deps.Store.updateHistory(id, { status: 'error' });
      showToast('Failed to save report data.', 'error', 3000, toastId);
    } finally {
      await renderHistorySidebar();
    }
  } catch (e) {
    console.error('Failed to save history', e);
    showToast('Failed to save history.', 'error', 3000, toastId);
  }
}

// Load history state
async function loadHistoryState(id) {
  if (!id) return;
  console.debug('[History] loadHistoryState:start', { id, beforeCurrentHistoryId: window.currentHistoryId });
  console.log('[Workflow] Starting history load - resetting UI and state first');
  if (typeof window.resetUIAndState === 'function') {
    try { window.resetUIAndState('auto'); } catch {}
  }
  console.debug('[History] loadHistoryState:afterReset', { currentHistoryId: window.currentHistoryId });
  const toastId = `toast-${Date.now()}`;
  showToast('Loading report... 0%', 'info', 999999, toastId);
  let result, history, rows, snapshot;
  try {
    const onProgress = (loaded, total) => {
      const progress = total > 0 ? Math.round((loaded / total) * 100) : 100;
      showToast(`Loading report... ${progress}%`, 'info', 999999, toastId);
    };
    result = await _deps.Store.restoreHistory(id, onProgress);
    if (!result) { showToast('History item not found.', 'error', 3000, toastId); return; }
    ({ history, rows } = result);
    console.debug('[History] loadHistoryState:restored', { id, status: history?.status, rowCount: rows ? rows.length : 0 });
    if (history.status === 'saving') { showToast('This report is still saving. Please wait.', 'info', 3000, toastId); return; }
    if (history.status === 'error') { showToast('This report is corrupted and cannot be loaded.', 'error', 3000, toastId); return; }
    if (!rows || !Array.isArray(rows)) { showToast('Failed to load report data.', 'error', 3000, toastId); return; }
    snapshot = history.uiSnapshot || {};
    if (!history.columns || !Array.isArray(history.columns)) { showToast('Report data is corrupted (missing columns).', 'error', 3000, toastId); return; }
    window.currentData = rows;
  } catch (error) {
    console.error('Failed to load or validate history:', error);
    showToast('Error loading report: ' + (error.message || 'Unknown error'), 'error', 3000, toastId);
    return;
  }
  const backup = {
    rows: G.ROWS, columns: G.DATA_COLUMNS, meta: G.LAST_PARSE_META, profile: G.PROFILE, mode: G.MODE,
    manualRoles: G.MANUAL_ROLES, manualJobs: G.MANUAL_JOBS, sort: G.SORT, query: G.QUERY, page: G.PAGE,
    rpp: G.RPP, autoExclude: G.AUTO_EXCLUDE, currencyTokens: G.CURRENCY_TOKENS, rowInclusion: G.ROW_INCLUDED,
    currentHistoryId: window.currentHistoryId
  };
  try {
    showToast(`Restoring "${history.name || 'Untitled'}"...`, 'info', 999999, toastId);
    G.ROWS = rows;
    window.currentData = G.ROWS;
    G.DATA_COLUMNS = history.columns || [];
    G.LAST_PARSE_META = history.meta || {};
    G.PROFILE = _deps.profile ? _deps.profile(G.ROWS) : (window.profile ? window.profile(G.ROWS) : null);

    // Ensure AGG_ROWS/AGG_PROFILE are initialized for history loads.
    // Many saved cards expect canonical long schema (Value/Description/ProjectId).
    // If dataset is already long → use it directly; else try cross-tab detection + convert.
    try {
      window.AGG_ROWS = null;
      window.AGG_PROFILE = null;

      const row0 = (Array.isArray(G.ROWS) && G.ROWS.length) ? G.ROWS[0] : null;
      const looksLong = !!(row0 && Object.prototype.hasOwnProperty.call(row0, 'Value') && Object.prototype.hasOwnProperty.call(row0, 'Description'));

      if (looksLong) {
        console.debug('[HistoryFix] Detected long schema in history rows → using as AGG_ROWS');
        window.AGG_ROWS = G.ROWS;
        window.AGG_PROFILE = G.PROFILE;
        try { _deps.updateGlobalDescControls && _deps.updateGlobalDescControls(); } catch (e) { console.warn('[History] updateGlobalDescControls (looksLong) failed:', e); }
      } else {
        try {
          const mod = await import('./ai_chart_transformers.js');
          const detect = (mod && typeof mod.detectCrossTab === 'function') ? mod.detectCrossTab : null;
          const convert = (mod && typeof mod.convertCrossTabToLong === 'function') ? mod.convertCrossTabToLong : null;

          if (detect && convert) {
            const detection = detect(G.ROWS);
            if (detection && (detection.isCrossTab || detection.type === 'cross-tab')) {
              console.debug('[HistoryFix] Cross-tab detected on history load → converting to long');
              const options = window.CROSSTAB_OPTIONS || {};
              const { rows: longRows } = convert(G.ROWS, detection, options);
              window.AGG_ROWS = longRows;
              const dateFormatConv = document.getElementById('dateFormat')?.value || 'auto';
              window.AGG_PROFILE = _deps.profile ? _deps.profile(longRows, dateFormatConv) : (window.profile ? window.profile(longRows, dateFormatConv) : null);
              try { _deps.updateGlobalDescControls && _deps.updateGlobalDescControls(); } catch (e) { console.warn('[History] updateGlobalDescControls (converted long) failed:', e); }
            } else {
              console.debug('[HistoryFix] Not cross-tab. Proceeding without AGG_ROWS.');
            }
          }
        } catch (e2) {
          console.warn('[HistoryFix] ai_chart_transformers dynamic import failed:', e2);
        }
      }
    } catch (e1) {
      console.warn('[HistoryFix] Failed to initialize AGG_ROWS/AGG_PROFILE for history:', e1);
    }

    G.MODE = snapshot.mode || 'auto';
    G.MANUAL_ROLES = snapshot.manualRoles || {};
    G.MANUAL_JOBS = snapshot.manualJobs || [];
    G.SORT = snapshot.sort || { col: null, dir: 'asc' };
    G.QUERY = snapshot.query || '';
    G.PAGE = snapshot.page || 1;
    G.RPP = snapshot.rpp || 25;
    G.AUTO_EXCLUDE = (typeof snapshot.autoExclude === 'boolean') ? snapshot.autoExclude : true;
    if (Array.isArray(snapshot.currencyTokens) && snapshot.currencyTokens.length > 0) {
      G.CURRENCY_TOKENS = snapshot.currencyTokens;
    }
    if (Array.isArray(snapshot.rowInclusion)) {
      if (snapshot.rowInclusion.length === G.ROWS.length) {
        G.ROW_INCLUDED = snapshot.rowInclusion;
      } else {
        const arr = snapshot.rowInclusion.slice(0, G.ROWS.length);
        while (arr.length < G.ROWS.length) arr.push(true);
        G.ROW_INCLUDED = arr;
      }
    } else if (_deps.initializeRowInclusion) {
      _deps.initializeRowInclusion();
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
              if (btn) {
                btn.setAttribute('aria-expanded', 'false');
                btn.setAttribute('aria-label', `Show ${headingText}`);
                const buttonTextEl = btn.querySelector('.button-text');
                if (buttonTextEl) buttonTextEl.textContent = 'Show'; else btn.textContent = 'Show';
                const content = section.querySelector('.section-content');
                if (content) content.setAttribute('aria-hidden', 'true');
              }
            }
          }
        }
      });
    }
    if (snapshot.aiSummary) {
      const aiSummarySection = document.getElementById('ai-summary-section');
      const aiSummaryText = document.getElementById('ai-summary-text');
      if (aiSummarySection && aiSummaryText && snapshot.aiSummary.content) {
        aiSummaryText.innerHTML = snapshot.aiSummary.content;
        const apiKey = localStorage.getItem('gemini_api_key');
        const ok = _deps.isValidApiKey ? _deps.isValidApiKey(apiKey) : !!(apiKey && apiKey.trim());
        aiSummarySection.style.display = (snapshot.aiSummary.visible && ok) ? 'block' : 'none';
      }
    }
    if (snapshot.chatHistory && snapshot.chatHistory.messages && Array.isArray(snapshot.chatHistory.messages)) {
      if (!window.chatState) {
        window.chatState = { messages: [], isTyping: false, lastContextRefresh: null };
      }
      window.chatState.messages = snapshot.chatHistory.messages;
      window.chatState.lastContextRefresh = snapshot.chatHistory.lastContextRefresh;
    } else {
      if (!window.chatState) window.chatState = { messages: [], isTyping: false, lastContextRefresh: null };
    }
    try {
      const chatSectionEl = document.getElementById('ai-analysis-section');
      if (chatSectionEl) chatSectionEl.style.display = 'block';
      if (typeof _deps.refreshChatUI === 'function') {
        _deps.refreshChatUI();
      } else if (chatSectionEl && chatSectionEl.hasAttribute('data-chat-initialized')) {
        chatSectionEl.removeAttribute('data-chat-initialized');
        if (typeof _deps.initializeChat === 'function') _deps.initializeChat();
      }
    } catch (e) { console.warn('Chat UI refresh failed:', e); }
    $('#meta').textContent = `Loaded ${G.PROFILE.rowCount.toLocaleString()} rows from history.`;
    $('#searchInput').value = G.QUERY;
    $('#rowsPerPage').value = G.RPP;
    $('#autoExclude').checked = !!G.AUTO_EXCLUDE;
    $('#mode').value = G.MODE;
    if (typeof window.switchMode === 'function') window.switchMode(G.MODE);
    if (_deps.renderProfile) _deps.renderProfile(G.PROFILE, G.LAST_PARSE_META);
    if (_deps.buildRawHeader) _deps.buildRawHeader(G.DATA_COLUMNS);
    if (_deps.applyFilter) _deps.applyFilter();
    if (_deps.renderRawBody) _deps.renderRawBody();
    try { _deps.updateGlobalDescControls && _deps.updateGlobalDescControls(); } catch (e) { console.warn('[History] updateGlobalDescControls after table render failed:', e); }
    const restoreSessionId = `restore_${Date.now()}`;
    const grid = $('#results'); if (grid) grid.innerHTML = '';
    const snapshotCharts = snapshot.charts;
    if (snapshotCharts && Array.isArray(snapshotCharts) && snapshotCharts.length > 0) {
      const cardBuildPromises = snapshotCharts.map((cardSnap) => {
        const jobKey = cardSnap.cardJobKey || {};
        return _deps.buildAggCard(jobKey, { ...cardSnap, noAnimation: true }, null, { skipExplanation: true });
      });
      const cardDataArray = await Promise.all(cardBuildPromises);
      cardDataArray.forEach(({ card }) => { grid.appendChild(card); });
      setTimeout(() => _deps.applyMasonryLayout && _deps.applyMasonryLayout(), 150);
      setTimeout(() => _deps.applyMasonryLayout && _deps.applyMasonryLayout(), 500);
      if (_deps.WorkflowManager && typeof _deps.WorkflowManager.start === 'function') {
        if (typeof window.safeReset === 'function') window.safeReset('auto');
        _deps.WorkflowManager.start();
      }
      await new Promise(r => setTimeout(r, 50)); _deps.WorkflowManager?.completeTask?.('init', 'Session initialized from history.');
      await new Promise(r => setTimeout(r, 50)); _deps.WorkflowManager?.completeTask?.('analysis', 'Data profile loaded from history.');
      await new Promise(r => setTimeout(r, 50)); _deps.WorkflowManager?.completeTask?.('ai-generation', 'Chart recommendations loaded from history.');
      await new Promise(r => setTimeout(r, 50)); _deps.WorkflowManager?.completeTask?.('rendering', 'Charts and tables rendered.');
      const explanationTasks = [];
      for (let i = 0; i < cardDataArray.length; i++) {
        const { card, initialAgg, job } = cardDataArray[i];
        const cardSnap = snapshotCharts[i];
        if (!cardSnap.explanation) {
          explanationTasks.push({ agg: initialAgg, jobKey: job, card, index: i });
        }
      }
      if (explanationTasks.length > 0) {
        _deps.WorkflowManager?.updateCurrentTaskMessage?.(`Generating ${explanationTasks.length} new explanations...`);
       for (const [index, task] of explanationTasks.entries()) {
          _deps.WorkflowManager?.updateCurrentTaskMessage?.(`Generating explanation ${index + 1} of ${explanationTasks.length}...`);
          await _deps.generateExplanation(task.agg, task.jobKey, task.card);
          debouncedAutoSave();
        }
        _deps.WorkflowManager?.completeTask?.('ai-explanation', `${explanationTasks.length} explanations generated.`);
        debouncedAutoSave();
      } else {
        _deps.WorkflowManager?.completeTask?.('ai-explanation', 'All explanations were loaded from history.');
      }
      await new Promise(r => setTimeout(r, 50));
      _deps.WorkflowManager?.completeTask?.('completion', 'Workflow finished.');
      if (typeof _deps.checkAndGenerateAISummary === 'function') _deps.checkAndGenerateAISummary();
      _deps.workflowTimer?.stop?.();
      setTimeout(() => {
        try {
          const finalState = _deps.WorkflowManager?.getState?.() || { status: 'idle', tasks: [] };
          _deps.updateAiTodoList?.(finalState);
        } catch {}
      }, 100);
    }
    window.currentHistoryId = id;
    console.debug('[History] loadHistoryState:setCurrentId', { id });
    showToast(`Loaded "${history.name || 'Untitled'}"`, 'success', 3000, toastId);
    renderHistorySidebar();
    console.debug('[History] loadHistoryState:renderedSidebar', { currentHistoryId: window.currentHistoryId });
    setTimeout(() => {
      const chatSection = document.getElementById('ai-analysis-section');
      const apiKey = localStorage.getItem('gemini_api_key');
      const ok = _deps.isValidApiKey ? _deps.isValidApiKey(apiKey) : !!(apiKey && apiKey.trim());
      if (chatSection && window.currentData && window.currentData.length > 0 && ok) {
        chatSection.style.display = 'block';
        if (typeof _deps.initializeChat === 'function') _deps.initializeChat();
      }
    }, 600);
  } catch (restoreError) {
    console.error('Failed during restore - rolling back:', restoreError);
    try {
      G.ROWS = backup.rows; window.currentData = G.ROWS;
      G.DATA_COLUMNS = backup.columns; G.LAST_PARSE_META = backup.meta; G.PROFILE = backup.profile;
      G.MODE = backup.mode; G.MANUAL_ROLES = backup.manualRoles; G.MANUAL_JOBS = backup.manualJobs;
      G.SORT = backup.sort; G.QUERY = backup.query; G.PAGE = backup.page; G.RPP = backup.rpp;
      G.AUTO_EXCLUDE = backup.autoExclude; G.CURRENCY_TOKENS = backup.currencyTokens; G.ROW_INCLUDED = backup.rowInclusion;
      window.currentHistoryId = backup.currentHistoryId;
      if (G.ROWS && G.DATA_COLUMNS) {
        $('#meta').textContent = `${G.ROWS.length.toLocaleString()} rows loaded.`;
        _deps.renderProfile?.(G.PROFILE);
        _deps.buildRawHeader?.(G.DATA_COLUMNS);
        _deps.applyFilter?.();
        _deps.renderRawBody?.();
      }
      showToast(`Failed to restore report. Previous state recovered. Error: ${restoreError.message}`, 'error', 5000, toastId);
    } catch (rollbackError) {
      console.error('Critical: Rollback failed!', rollbackError);
      showToast('Critical error: Failed to restore report and rollback failed. Please refresh the page.', 'error', 10000, toastId);
    }
  }
}

// History management modal
async function openHistoryManager() {
  const modal = $('#historyModal');
  const listContainer = $('#history-management-list');
  const selectAllCheckbox = $('#history-select-all');
  const deleteSelectedBtn = $('#deleteSelectedBtn');
  if (!modal || !listContainer) return;
  listContainer.innerHTML = 'Loading...';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  try {
    const historyItems = await _deps.Store.listHistory();
    listContainer.innerHTML = '';
    if (!historyItems.length) {
      listContainer.innerHTML = '<div class="muted small" style="padding: 8px;">No history to manage.</div>';
      if (selectAllCheckbox) selectAllCheckbox.disabled = true;
      return;
    }
    if (selectAllCheckbox) { selectAllCheckbox.disabled = false; selectAllCheckbox.checked = false; }
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
          await _deps.Store.updateHistory(item.id, { name: newName.trim() });
          showToast('Report renamed.', 'success');
          await renderHistorySidebar();
          openHistoryManager();
        }
      };
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.background = '#fee2e2';
      deleteBtn.style.color = '#b91c1c';
      deleteBtn.style.border = '1px solid #fecaca';
      deleteBtn.onclick = async () => {
        if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
          await _deps.Store.deleteHistory(item.id);
          showToast('Report deleted.', 'success');
          await renderHistorySidebar();
          openHistoryManager();
        }
      };
      div.append(checkbox, nameSpan, renameBtn, deleteBtn);
      listContainer.appendChild(div);
    });
    const checkboxes = listContainer.querySelectorAll('.history-item-checkbox');
    function updateDeleteButtonState() {
      const selected = listContainer.querySelectorAll('.history-item-checkbox:checked');
      if (deleteSelectedBtn) {
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
    }
    checkboxes.forEach(cb => cb.addEventListener('change', updateDeleteButtonState));
    if (selectAllCheckbox) {
      selectAllCheckbox.onchange = () => {
        checkboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        updateDeleteButtonState();
      };
    }
    updateDeleteButtonState();
  } catch (e) {
    console.error('Failed to load history for management', e);
    listContainer.innerHTML = '<div class="muted small error" style="padding: 8px;">Could not load history.</div>';
  }
}

function attachHistoryEventListeners() {
  const manageBtn = $('#manageHistoryBtn');
  if (manageBtn) manageBtn.onclick = openHistoryManager;
  const closeBtn = $('#closeHistoryModal');
  if (closeBtn) closeBtn.onclick = () => {
    const modal = $('#historyModal');
    if (modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden','true');
      try { document.getElementById('manageHistoryBtn')?.focus(); } catch {}
    }
  };
  const deleteSelectedBtn = $('#deleteSelectedBtn');
  if (deleteSelectedBtn) deleteSelectedBtn.onclick = async () => {
    const selected = document.querySelectorAll('#history-management-list .history-item-checkbox:checked');
    if (selected.length === 0) return;
    if (confirm(`Are you sure you want to delete ${selected.length} selected report(s)?`)) {
      for (const cb of selected) {
        const id = cb.getAttribute('data-id');
        await _deps.Store.deleteHistory(id);
      }
      showToast(`${selected.length} report(s) deleted.`, 'success');
      await renderHistorySidebar();
      openHistoryManager();
    }
  };
  const clearAllBtn = $('#clearAllHistoryBtn');
  if (clearAllBtn) clearAllBtn.onclick = async () => {
    if (confirm('Are you sure you want to delete ALL saved reports? This action cannot be undone.')) {
      const historyItems = await _deps.Store.listHistory();
      for (const item of historyItems) { await _deps.Store.deleteHistory(item.id); }
      showToast('All history has been cleared.', 'success');
      await renderHistorySidebar();
      const modal = $('#historyModal'); if (modal) modal.classList.remove('open');
    }
  };
  const historySearch = $('#history-search');
  if (historySearch) historySearch.addEventListener('input', debounce(renderHistorySidebar, 250));
}

function initializeHistoryManager(dependencies = {}) {
  _deps = {
    ..._deps,
    ...dependencies
  };
  if (dependencies.$) $ = dependencies.$;
  if (dependencies.showToast) showToast = dependencies.showToast;
  // Expose public functions on window for backward compatibility
  window.debouncedAutoSave = debouncedAutoSave;
  window.forceAutoSave = forceAutoSave;
  window.getUiSnapshot = getUiSnapshot;
  // Setup sidebar and history listeners
  attachSidebarListeners();
  attachHistoryEventListeners();
  // Initial render
  renderHistorySidebar();
  return {
    saveCurrentStateToHistory,
    loadHistoryState,
    renderHistorySidebar,
    debouncedAutoSave,
    forceAutoSave,
    getUiSnapshot,
    getChartsSnapshot,
    getFormattedDateTime,
    signatureFromHeaders,
    openHistoryManager
  };
}

export {
  initializeHistoryManager,
  saveCurrentStateToHistory,
  loadHistoryState,
  renderHistorySidebar,
  debouncedAutoSave,
  forceAutoSave,
  getUiSnapshot,
  getChartsSnapshot,
  getFormattedDateTime,
  signatureFromHeaders,
  openHistoryManager
};