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
import { AITaskManager, createWorkflowManager } from './ai_chart_task_manager.js';
import { initWorkflowUI, runAiWorkflow, generateExplanation, checkAndGenerateAISummary, renderExplanationCard } from './ai_chart_ui_workflow.js';
/* ========= utils ========= */
const $ = s => document.querySelector(s);
const stripBOM = s => (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;

// Global AI Task Manager instance
const AITasks = new AITaskManager();

// Enhanced Workflow Manager with AI Agent Integration
const WorkflowManager = createWorkflowManager(AITasks);

function updateAiTodoList(data) {
    // Handle both legacy state format and new agent format
    let state;
    if (data.agents && Array.isArray(data.agents)) {
        // New agent format - convert to legacy for backward compatibility
        const mainAgent = data.agents.find(([id, agent]) => id.includes('main_agent'));
        if (mainAgent) {
            const [agentId, agent] = mainAgent;
            const currentTaskIndex = agent.todos.findIndex(t => t.status === 'in-progress');
            const hasError = agent.todos.some(t => t.status === 'error');
            const error = hasError ? agent.todos.find(t => t.status === 'error')?.message : null;
            
            state = {
                status: agent.status,
                tasks: agent.todos.map(t => ({
                    id: t.type || t.id,
                    description: t.description,
                    status: t.status,
                    message: t.message,
                    timestamp: t.timestamp,
                    type: t.type
                })),
                currentTaskIndex,
                error: error ? new Error(error) : null,
                agents: data.agents,
                apiCalls: data.apiCalls
            };
        } else {
            return; // No main agent found
        }
    } else {
        // Legacy format
        state = data;
    }
    
    const { tasks, status, error, currentTaskIndex } = state;
    const todoList = $('#ai-todo-list');
    const container = $('#ai-todo-list-section');
    const progressBar = $('#ai-progress-bar');
    const currentTaskDetails = $('#ai-current-task-details');

    // Debug logging to check if elements are found
    console.log('🔍 updateAiTodoList debug:', {
        todoList: !!todoList,
        container: !!container,
        progressBar: !!progressBar,
        currentTaskDetails: !!currentTaskDetails,
        status,
        tasksLength: tasks.length,
        mode: MODE
    });

    if (!todoList || !container || !progressBar || !currentTaskDetails) {
        console.error('❌ Missing UI elements in updateAiTodoList');
        return;
    }

    // Don't hide section for AI Agent mode when agent is running (tasks may still be loading)
    if (status === 'idle' || (tasks.length === 0 && !(MODE === 'ai_agent' && status === 'running'))) {
        container.style.display = 'none';
        return;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    if (isValidApiKey(apiKey)) {
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        return;
    }

    // Special handling for AI Agent mode with empty tasks (loading state)
    if (MODE === 'ai_agent' && tasks.length === 0 && status === 'running') {
        progressBar.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', 0);
        progressBar.className = 'progress-active';
        
        currentTaskDetails.innerHTML = `
            <div class="current-task-info">
                <div class="task-spinner">🤖</div>
                <div class="task-description">AI Agent is analyzing your data and generating intelligent analysis plan...</div>
                <div class="task-timing">Please wait while tasks are being created</div>
            </div>
        `;
        
        todoList.innerHTML = `
            <li class="task-item task-in-progress" style="display: block !important; visibility: visible !important; opacity: 1 !important; height: auto !important; overflow: visible !important;">
                <div class="task-content">
                    <span class="task-icon in-progress">🤖</span>
                    <div class="task-info">
                        <div class="task-description">Generating AI Agent analysis plan...</div>
                        <div class="task-timestamp">${new Date().toLocaleTimeString()}</div>
                    </div>
                </div>
            </li>
        `;
        
        // Override CSS !important rules that hide the todo list
        todoList.style.setProperty('display', 'block', 'important');
        todoList.style.setProperty('visibility', 'visible', 'important');
        todoList.style.setProperty('opacity', '1', 'important');
        todoList.style.setProperty('height', 'auto', 'important');
        todoList.style.setProperty('overflow', 'visible', 'important');
        console.log('🔧 Overriding CSS !important rules to show todoList');
        
        console.log('🤖 Showing AI Agent loading state, todoList innerHTML length:', todoList.innerHTML.length);
        console.log('🔍 todoList computed styles:', window.getComputedStyle(todoList).display);
        return;
    }

    // Enhanced progress calculation - include in-progress tasks as partial progress
    const completedTasks = tasks.filter(task => task.status === 'completed').length;
    const inProgressTasks = tasks.filter(task => task.status === 'in-progress').length;
    const failedTasks = tasks.filter(task => task.status === 'error').length;
    
    // Calculate progress: completed = 100%, in-progress = 50%, pending = 0%
    const progressPoints = completedTasks * 1.0 + inProgressTasks * 0.5;
    const progress = tasks.length > 0 ? (progressPoints / tasks.length) * 100 : 0;
    
    progressBar.style.width = `${progress}%`;
    progressBar.setAttribute('aria-valuenow', progress);
    
    // Debug progress bar updates
    console.log(`🔄 Progress Bar Update: ${Math.round(progress)}% (${completedTasks} completed, ${inProgressTasks} in-progress, ${tasks.length} total)`);
    
    // Color code progress bar based on status
    progressBar.className = failedTasks > 0 ? 'progress-error' : 
                           status === 'completed' ? 'progress-complete' : 'progress-active';

    // Enhanced current task details with timing
    if (currentTaskIndex >= 0 && currentTaskIndex < tasks.length) {
        const currentTask = tasks[currentTaskIndex];
        const timeInfo = currentTask.timestamp ? 
            `Started: ${new Date(currentTask.timestamp).toLocaleTimeString()}` : '';
        
        currentTaskDetails.innerHTML = `
            <div class="current-task-info">
                <div class="task-spinner ${currentTask.type || ''}">
                    ${currentTask.type === 'api-call' ? '🌐' : 
                      currentTask.type === 'ai-generation' ? '🤖' : 
                      currentTask.type === 'analysis' ? '📊' : '🔄'}
                </div>
                <div class="task-details">
                    <div class="current-task-title">${currentTask.description}</div>
                    ${currentTask.message ? `<div class="current-task-message">${currentTask.message}</div>` : ''}
                    ${timeInfo ? `<div class="current-task-time">${timeInfo}</div>` : ''}
                </div>
            </div>
        `;
    } else {
        currentTaskDetails.innerHTML = '';
    }

    // Enhanced todo list with better UI
    todoList.innerHTML = '';
    
    // Override CSS !important rules that hide the todo list
    todoList.style.setProperty('display', 'block', 'important');
    todoList.style.setProperty('visibility', 'visible', 'important');
    todoList.style.setProperty('opacity', '1', 'important');
    todoList.style.setProperty('height', 'auto', 'important');
    todoList.style.setProperty('overflow', 'visible', 'important');
    
    console.log('📝 Populating regular todo list with', tasks.length, 'tasks');
    
    // Group tasks by type for better organization
    const taskGroups = tasks.reduce((groups, task) => {
        const type = task.type || 'general';
        if (!groups[type]) groups[type] = [];
        groups[type].push(task);
        return groups;
    }, {});
    
    Object.entries(taskGroups).forEach(([type, typeTasks]) => {
        // Add group header for multi-type workflows
        if (Object.keys(taskGroups).length > 1 && type !== 'general') {
            const groupHeader = document.createElement('li');
            groupHeader.className = 'task-group-header';
            
            // ✅ CRITICAL: Override CSS !important rules for group headers too
            groupHeader.style.setProperty('display', 'list-item', 'important');
            groupHeader.style.setProperty('visibility', 'visible', 'important');
            groupHeader.style.setProperty('opacity', '1', 'important');
            groupHeader.style.setProperty('height', 'auto', 'important');
            groupHeader.style.setProperty('overflow', 'visible', 'important');
            groupHeader.style.setProperty('margin', '12px 0 4px 0', 'important');
            groupHeader.style.setProperty('padding', '0', 'important');
            groupHeader.style.setProperty('font-weight', 'bold', 'important');
            groupHeader.style.setProperty('color', '#666', 'important');
            
            groupHeader.innerHTML = `<div class="group-title">${type.toUpperCase().replace('-', ' ')}</div>`;
            todoList.appendChild(groupHeader);
            console.log(`📂 Added group header with !important overrides: ${type.toUpperCase()}`);
        }
        
        typeTasks.forEach((task, index) => {
            const li = document.createElement('li');
            li.className = `task-item task-${task.status} task-type-${task.type || 'general'}`;
            
            // ✅ CRITICAL: Override CSS !important rules for each task item
            li.style.setProperty('display', 'list-item', 'important');
            li.style.setProperty('visibility', 'visible', 'important');
            li.style.setProperty('opacity', '1', 'important');
            li.style.setProperty('height', 'auto', 'important');
            li.style.setProperty('overflow', 'visible', 'important');
            li.style.setProperty('margin', '0', 'important');
            li.style.setProperty('padding', '8px 0', 'important');
            
            const statusIcon = {
                'pending': '⏳',
                'in-progress': task.type === 'api-call' ? '🌐' : 
                              task.type === 'ai-generation' ? '🤖' : 
                              task.type === 'analysis' ? '📊' : '🔄',
                'completed': '✅',
                'error': '❌',
                'cancelled': '⏹️',
                'retrying': '🔄'
            }[task.status] || '❓';
            
            const timeInfo = task.timestamp ? 
                new Date(task.timestamp).toLocaleTimeString() : '';
            
            li.innerHTML = `
                <div class="task-content">
                    <span class="task-icon ${task.status}">${statusIcon}</span>
                    <div class="task-info">
                        <div class="task-description">${task.description}</div>
                        ${task.message ? `<div class="task-message">${task.message}</div>` : ''}
                        ${timeInfo ? `<div class="task-timestamp">${timeInfo}</div>` : ''}
                    </div>
                    ${task.type === 'api-call' ? '<div class="task-badge api-badge">API</div>' : ''}
                </div>
            `;
            
            todoList.appendChild(li);
            console.log(`📋 Added AI Agent task with !important overrides: ${task.description}`);
        });
    });

    // Enhanced status section with API call tracking
    const existingStatus = container.querySelector('.workflow-status');
    if (existingStatus) existingStatus.remove();
    
    const statusDiv = document.createElement('div');
    statusDiv.className = 'workflow-status';
    
    // Add enhanced API call statistics if available
    let apiStats = '';
    if (state.apiCalls && state.apiCalls.length > 0) {
        const totalCalls = state.apiCalls.length;
        const completedCalls = state.apiCalls.filter(([id, call]) => call.status === 'completed').length;
        const failedCalls = state.apiCalls.filter(([id, call]) => call.status === 'failed').length;
        const pendingCalls = state.apiCalls.filter(([id, call]) => call.status === 'pending').length;
        const retryCalls = state.apiCalls.filter(([id, call]) => call.status === 'retrying').length;
        
        // Find most recent active call for additional context
        const activeCalls = state.apiCalls.filter(([id, call]) => call.status === 'pending' || call.status === 'retrying');
        const recentActiveCall = activeCalls.length > 0 ? activeCalls[activeCalls.length - 1][1] : null;
        
        // Calculate success rate
        const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;
        
        apiStats = `
            <div class="api-stats">
                <div class="api-stats-header">
                    <div class="api-stats-title">🌐 API Activity</div>
                    ${successRate >= 0 ? `<div class="success-rate">${successRate}% success</div>` : ''}
                </div>
                <div class="api-stats-info">
                    <div class="stat-row">
                        <span class="stat-item">Total: ${totalCalls}</span>
                        <span class="stat-item success">✅ ${completedCalls}</span>
                        ${pendingCalls > 0 ? `<span class="stat-item pending">⏳ ${pendingCalls}</span>` : ''}
                        ${retryCalls > 0 ? `<span class="stat-item retry">🔄 ${retryCalls}</span>` : ''}
                        ${failedCalls > 0 ? `<span class="stat-item error">❌ ${failedCalls}</span>` : ''}
                    </div>
                    ${recentActiveCall ? `
                        <div class="active-call-info">
                            <span class="active-call-label">Current:</span>
                            <span class="active-call-type">${recentActiveCall.apiType || 'API call'}</span>
                            ${recentActiveCall.status === 'retrying' ? '<span class="retry-indicator">Retrying...</span>' : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    if (status === 'completed') {
        const totalTime = tasks.length > 0 && tasks[0].timestamp ? 
            ((new Date() - new Date(tasks[0].timestamp)) / 1000).toFixed(1) : 'N/A';
        statusDiv.innerHTML = `
            <p style="color:var(--success)"><strong>✅ Analysis completed successfully!</strong></p>
            <div class="completion-stats">
                <span>Total time: ${totalTime}s</span>
                <span>Tasks completed: ${completedTasks}/${tasks.length}</span>
            </div>
            ${apiStats}
        `;
        container.appendChild(statusDiv);
        
        // Hide the workflow section after 5 seconds, but only if no new workflow starts
        const hideTimeout = setTimeout(() => {
            // Double-check the workflow is still completed and no new tasks are running
            const currentState = WorkflowManager.getState();
            // Don't hide during AI Agent mode - tasks may still be loading
            if (currentState.status === 'completed' && MODE !== 'ai_agent') {
                console.log('🫥 Hiding completed workflow section');
                container.style.display = 'none';
            } else {
                console.log('🔄 Workflow reactivated, keeping section visible');
            }
        }, 5000);
        
        // Store timeout ID so it can be cleared if workflow restarts
        container.hideTimeout = hideTimeout;
    } else if (status === 'error') {
        const errorDetails = error?.message || 'Unknown error occurred';
        statusDiv.innerHTML = `
            <p style="color:var(--danger)"><strong>❌ Workflow failed:</strong> ${errorDetails}</p>
            ${apiStats}
            <div class="error-actions">
                <button class="retry-button primary" data-action="retry">Retry Analysis</button>
                <button class="retry-button secondary" data-action="reset-restart">Reset & Restart</button>
            </div>
        `;
        container.appendChild(statusDiv);
    } else if (status === 'running' && currentTaskIndex > -1) {
        // Clear any pending hide timeout since workflow is active again
        if (container.hideTimeout) {
            clearTimeout(container.hideTimeout);
            container.hideTimeout = null;
            console.log('🔄 Cleared workflow hide timeout - workflow is running again');
        }
        
        const currentTime = new Date().toLocaleTimeString();
        const elapsedTime = workflowTimer.getElapsed();
        const currentTask = state.tasks[currentTaskIndex];
        
        // Dynamic progress text based on current task
        const getProgressText = (task) => {
            if (!task) return 'Analysis in progress...';
            
            const taskType = task.type || '';
            const description = task.description || '';
            
            // Create dynamic text based on task type and description
            if (taskType === 'init') {
                return '🚀 Initializing analysis session...';
            } else if (taskType === 'analysis') {
                return '📊 Analyzing data structure and patterns...';
            } else if (taskType === 'ai-generation') {
                return '🤖 Generating intelligent recommendations...';
            } else if (taskType === 'config') {
                return '⚙️ Applying configuration settings...';
            } else if (taskType === 'rendering') {
                return '🎨 Rendering charts and visualizations...';
            } else if (taskType === 'ai-explanation') {
                return '💡 Generating AI-powered explanations...';
            } else if (taskType === 'completion') {
                return '✨ Finalizing analysis workflow...';
            } else if (taskType === 'api-call') {
                return '🌐 Processing API request...';
            } else if (description.toLowerCase().includes('chart')) {
                return '📈 Building interactive charts...';
            } else if (description.toLowerCase().includes('explanation')) {
                return '💡 Crafting detailed explanations...';
            } else if (description.toLowerCase().includes('data')) {
                return '📊 Processing data insights...';
            } else {
                // Use the task description or fallback to generic message
                return description ? `🔄 ${description}...` : 'Analysis in progress...';
            }
        };
        
        const progressText = getProgressText(currentTask);
        const taskIcon = {
            'init': '🚀',
            'analysis': '📊', 
            'ai-generation': '🤖',
            'config': '⚙️',
            'rendering': '🎨',
            'ai-explanation': '💡',
            'completion': '✨',
            'api-call': '🌐'
        }[currentTask?.type] || '🔄';
        
        statusDiv.innerHTML = `
            <div class="running-status">
                <div class="running-info">
                    <div class="task-header">
                        <span class="task-icon">${taskIcon}</span>
                        <span class="running-text">${progressText}</span>
                    </div>
                    ${currentTask?.message ? `<div class="task-submessage">${currentTask.message}</div>` : ''}
                    <div class="time-display">
                        <span class="current-time">${currentTime}</span>
                        <span class="elapsed-time">Elapsed: ${elapsedTime}</span>
                        ${(() => {
                            const eta = workflowTimer.getEstimatedTimeRemaining(currentTaskIndex, state.tasks.length);
                            return eta ? `<span class="eta-time">${eta}</span>` : '';
                        })()}
                    </div>
                </div>
                <div class="progress-indicators">
                    <div class="task-progress">
                        <span>Step ${currentTaskIndex + 1} of ${state.tasks.length}: ${currentTask?.description || 'Processing...'}</span>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${((currentTaskIndex + 1) / state.tasks.length) * 100}%"></div>
                        </div>
                        <div class="progress-percentage">${Math.round(((currentTaskIndex + 1) / state.tasks.length) * 100)}% complete</div>
                    </div>
                </div>
                ${apiStats}
                <div class="action-buttons">
                    <button class="pause-button" data-action="pause">Pause Analysis</button>
                    <button class="cancel-button" data-action="cancel">Cancel Analysis</button>
                </div>
            </div>
        `;
        container.appendChild(statusDiv);
        
        // Update time display every second
        if (!workflowTimer.intervalId) {
            workflowTimer.onUpdate((elapsed) => {
                // Check if workflow is still running before updating UI
                const currentState = WorkflowManager.getState();
                if (currentState.status !== 'running') {
                    console.log('⏹️ Stopping timer updates - workflow no longer running');
                    workflowTimer.stop();
                    return;
                }
                
                const elapsedSpan = statusDiv.querySelector('.elapsed-time');
                const currentTimeSpan = statusDiv.querySelector('.current-time');
                if (elapsedSpan) elapsedSpan.textContent = `Elapsed: ${elapsed}`;
                if (currentTimeSpan) currentTimeSpan.textContent = new Date().toLocaleTimeString();
            });
        }
    } else if (status === 'paused') {
        const currentTime = new Date().toLocaleTimeString();
        const elapsedTime = workflowTimer.getElapsed();
        statusDiv.innerHTML = `
            <div class="paused-status">
                <p style="color:var(--warning)"><strong>⏸️ Analysis paused</strong></p>
                <div class="time-display">
                    <span class="elapsed-time">Elapsed: ${elapsedTime}</span>
                </div>
                ${apiStats}
                <div class="action-buttons">
                    <button class="resume-button" data-action="resume">Resume Analysis</button>
                    <button class="cancel-button" data-action="cancel">Cancel Analysis</button>
                </div>
            </div>
        `;
        container.appendChild(statusDiv);
    } else if (status === 'cancelled') {
        statusDiv.innerHTML = `
            <p style="color:var(--muted)"><strong>⏹️ Workflow cancelled by user.</strong></p>
            ${apiStats}
            <button class="retry-button" data-action="restart">Restart Analysis</button>
        `;
        container.appendChild(statusDiv);
    } else {
        // Default catch-all: Clear the status message if the workflow is idle or in an unknown state
        const existingStatus = container.querySelector('.workflow-status');
        if (existingStatus) {
            existingStatus.remove();
        }
    }
    
    // Final visibility check - override CSS !important rules
    if (todoList && container.style.display === 'block') {
        todoList.style.setProperty('display', 'block', 'important');
        todoList.style.setProperty('visibility', 'visible', 'important');
        todoList.style.setProperty('opacity', '1', 'important');
        todoList.style.setProperty('height', 'auto', 'important');
        todoList.style.setProperty('overflow', 'visible', 'important');
        console.log('🔧 Final todoList visibility check - overriding CSS !important rules');
    }
}

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
    console.log(`💾 Force-saving (${reason}) "\${currentName}"...`);
    saveCurrentStateToHistory(currentName, false);
  } catch (e) {
    console.error('Force save failed:', e);
  }
}
window.forceAutoSave = forceAutoSave;
window.debouncedAutoSave = debouncedAutoSave;
window.getAiAnalysisPlan = getAiAnalysisPlan;

/* ========= state ========= */
let ROWS=null, PROFILE=null, LAST_PARSE_META=null;
let DATA_COLUMNS=[], FILTERED_ROWS=[], PAGE=1, RPP=25, QUERY="";
let SORT = { col:null, dir:'asc' };
let ROW_INCLUDED = []; // Track which rows are included in aggregations (true/false for each row)
let ROW_EXCLUSION_REASONS = {}; // Map of rowIndex to reason string
let AUTO_EXCLUDE = true;

let MODE = 'auto';
let MANUAL_ROLES = {};   // { colName: 'dimension'|'metric'|'date'|'id'|'ignore' }
let MANUAL_JOBS  = [];   // [{groupBy, metric, agg, chart, topN, dateBucket?}]
let CURRENCY_TOKENS = ['MYR','RM','Malaysian Ringgit','USD','US Dollar','SGD','SG Dollar','EUR','Euro','GBP','British Pound','JPY','Japanese Yen','CNY','Chinese Yuan','AUD','Australian Dollar','CAD','Canadian Dollar','CHF','Swiss Franc','HKD','Hong Kong Dollar','INR','Indian Rupee','KRW','South Korean Won','THB','Thai Baht','VND','Vietnamese Dong','PHP','Philippine Peso','IDR','Indonesian Rupiah'];
const CURRENCY_COLUMN_HINTS = ['ccy', 'currency', 'cur', 'curr'];

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
      switchMode(MODE);
    }
  }catch{}
}
['change','click','input'].forEach(ev=>{ document.addEventListener(ev, debounce(saveState, 300), true); });



/* ========= raw data table: header, sorting, filter, pagination, tfoot sums ========= */
function isLikelyCodeColumn(name){ return /(code|id|sku|account|acct|phone|tel|zip|postal|nr|no|number)$/i.test(String(name).trim()); }
function columnType(name){ const c = PROFILE?.columns?.find(x=>x.name===name); return c ? c.type : 'string'; }

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
  if (!ROWS) return;
  ROW_EXCLUSION_REASONS = {};

  if (!AUTO_EXCLUDE) {
    ROW_INCLUDED = ROWS.map(() => true);
    console.log('Auto-exclude disabled. Including all rows.');
    return;
  }
  
  let excludedCount = 0;
  ROW_INCLUDED = ROWS.map((row, index) => {
    const exclusion = isLikelyNonDataRow(row, index);
    if (exclusion.result) {
      ROW_EXCLUSION_REASONS[index] = exclusion.reason;
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
  if (!ROWS || !ROW_INCLUDED || ROW_INCLUDED.length !== ROWS.length) {
    return ROWS; // Fallback to all rows if inclusion array not set up
  }
  
  const includedRows = ROWS.filter((row, index) => ROW_INCLUDED[index]);
  console.log(`📊 Using ${includedRows.length} included rows out of ${ROWS.length} total rows for aggregation`);
  return includedRows;
}
window.getIncludedRows = getIncludedRows;
function buildRawHeader(columns){
  const thead = $('#dataThead'); thead.innerHTML='';
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
    ROW_INCLUDED.fill(checked);
    renderRawBody();
    // For bulk selection prefer immediate update
    renderAggregates();
    debouncedAutoSave();
    console.log(`${checked ? 'Selected' : 'Deselected'} all ${ROWS.length} rows`);
  });
  
  tr.appendChild(checkboxTh);
  
  // Add data column headers
  columns.forEach(col=>{
    const th=document.createElement('th'); th.className='sticky'; th.textContent=col;
    const s = document.createElement('span'); s.className='sort'; s.textContent='';
    th.appendChild(s);
    th.addEventListener('click', ()=>{
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
  ths.forEach(th=>{
    const col = th.firstChild?.nodeValue || th.childNodes[0]?.textContent || '';
    const span = th.querySelector('.sort');
    if (!span) return;
    if (SORT.col===col) span.textContent = SORT.dir==='asc' ? '↑' : '↓';
    else span.textContent = '';
  });
}
function applyFilter(){
  const q = QUERY.trim().toLowerCase();
  if (!q){ FILTERED_ROWS = ROWS; return; }
  FILTERED_ROWS = ROWS.filter(row=>{
    for (const c of DATA_COLUMNS){
      const v = row[c];
      if (v!=null && String(v).toLowerCase().includes(q)) return true;
    }
    return false;
  });
}
function sortRows(rows){
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
  const tfoot = $('#dataTFoot'); tfoot.innerHTML='';
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
function renderRawBody(){
  const tbody = $('#dataTbody'); tbody.innerHTML='';
  const total = FILTERED_ROWS.length, pages = Math.max(1, Math.ceil(total / RPP));
  PAGE = Math.min(PAGE, pages);
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
      ROW_INCLUDED[originalIndex] = e.target.checked;
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
const onSearch = debounce(()=>{ QUERY = $('#searchInput').value; PAGE=1; applyFilter(); renderRawBody(); }, 200);

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
  modal.focus();
}
$('#closeRoleModal').onclick = ()=> $('#roleModal').classList.remove('open');
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
}
$('#closeAggModal').onclick = ()=> $('#aggModal').classList.remove('open');
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
  $('#aggModal').classList.remove('open');

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
  sessionStorage.setItem('isNewFileLoad', 'true');
  const f=$('#file').files[0]; if(!f) return showToast('Choose a CSV first.', 'error');
  $('#meta').textContent='Parsing…';
  try{
    const choice=$('#delimiter').value, header=$('#hasHeader').checked;
    const {data, meta}=await parseCSV(f, choice, header, progress => {
        if (progress.type === 'meta') {
            $('#meta').textContent = progress.text;
        }
    });
    if(!data.length) throw new Error('No rows detected (check delimiter/header).');
    ROWS=data; window.currentData = data; DATA_COLUMNS = Object.keys(ROWS[0] || {});
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
    QUERY = ''; $('#searchInput').value='';
    SORT = { col:null, dir:'asc' };
    RPP = Number($('#rowsPerPage').value)||25; PAGE=1;
    applyFilter(); renderRawBody();
    MANUAL_ROLES = {}; MANUAL_JOBS = [];
    const smart = getDefaultMode();
    $('#mode').value = smart;
    switchMode(smart);
    loadState(); // restore per-header state if available
    WorkflowManager.reset(MODE); // Reset AI todo list on new load
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
          if (typeof window.initializeChat === 'function') {
            if (!window.currentData || window.currentData.length === 0) {
              window.currentData = ROWS;
            }
            const apiKey = localStorage.getItem('gemini_api_key');
            if (typeof window.initializeChat === 'function' && isValidApiKey(apiKey)) {
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                window.initializeChat();
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
          if (typeof window.initializeChat === 'function') {
            if (!window.currentData || window.currentData.length === 0) {
              window.currentData = ROWS;
            }
            const apiKey = localStorage.getItem('gemini_api_key');
            if (typeof window.initializeChat === 'function' && isValidApiKey(apiKey)) {
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                window.initializeChat();
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
$('#rowsPerPage').addEventListener('change', ()=>{ RPP = Number($('#rowsPerPage').value)||25; PAGE=1; renderRawBody(); });
$('#prevPage').addEventListener('click', ()=>{ if(PAGE>1){ PAGE--; renderRawBody(); } });
$('#nextPage').addEventListener('click', ()=>{ const pages=Math.max(1, Math.ceil(FILTERED_ROWS.length / RPP)); if(PAGE<pages){ PAGE++; renderRawBody(); } });
$('#resetExclusion').addEventListener('click', () => {
  if (ROWS) {
    initializeRowInclusion();
    renderRawBody();
    renderAggregates();
  }
});
$('#downloadFiltered').addEventListener('click', ()=>{
  if (!FILTERED_ROWS?.length) return;
  const esc = s => { const str = String(s ?? ''); return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str; };
  const header = DATA_COLUMNS.map(esc).join(',');
  const sorted = sortRows(FILTERED_ROWS);
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
    if (isRenderingAggregates) {
        showToast('Analysis is already in progress. Please wait for completion.', 'warning');
        return;
    }
    
    renderAggregates();
};



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
    if (sessionId) card.dataset.sessionId = sessionId;

    const title = `${job.agg}(${job.metric || ''}) by ${job.groupBy}`;
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

        const newAgg = groupAgg(getIncludedRows(), currentGroupBy, currentMetric, currentAgg, currentDateBucket, {
            mode: currentFilterMode,
            value: currentFilterValue
        }, newShowMissing, PROFILE);

        card.dataset.showMissing = String(newShowMissing);

        // Clear and re-add warning
        const existingWarnings = card.querySelectorAll('.missing-data-warning');
        existingWarnings.forEach(warning => warning.remove());
        addMissingDataWarning(card, newAgg, getIncludedRows().length, newShowMissing);

        sub.textContent = `${newAgg.rows.length} groups · ${newAgg.header[1]}`;
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
    const initialAgg = groupAgg(getIncludedRows(), job.groupBy, job.metric, job.agg, job.dateBucket || '', {
        mode: filterMode,
        value: filterValue
    }, showMissing, PROFILE);
    console.timeEnd(`buildAggCard:compute:${card.dataset.canonicalKey}`);
 
    addMissingDataWarning(card, initialAgg, getIncludedRows().length, showMissing);
    sub.textContent = `${initialAgg.rows.length} groups · ${initialAgg.header[1]}`;
 
    console.time(`buildAggCard:renderTable:${card.dataset.canonicalKey}`);
    renderAggTable(initialAgg, tableBox, 20, showMissing, { formatNumberFull });
    console.timeEnd(`buildAggCard:renderTable:${card.dataset.canonicalKey}`);
 
    // Log chart render start and end times per chart card
    charts.forEach((chartSnap, ci) => {
        const chartLabel = `buildAggCard:renderChart:${card.dataset.canonicalKey}:chart${ci}`;
        console.time(chartLabel);
        const chartCard = renderChartCard(initialAgg, chartsContainer, chartSnap.type, chartSnap.topN, title.replace(/\s+/g, '_'), { 
            noAnimation,
            profile: PROFILE,
            showToast,
            applyMasonryLayout,
            generateExplanation
        });
        // If renderChartCard returns synchronously, end the timer immediately; otherwise end in ensureChart callbacks
        console.timeEnd(chartLabel);
    });

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
    const plan = autoPlan(context.profile, context.includedRows, context.excludedDimensions);
    return {
        tasks: [{
            description: 'Run standard automatic analysis',
            type: 'auto-analysis'
        }],
        jobs: plan.jobs,
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
            sampleRows: context.includedRows.slice(0, 3)
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
        
        // Parse AI response
        let aiPlan;
        try {
            // Extract JSON from response (in case there's extra text)
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : response;
            aiPlan = JSON.parse(jsonString);
            
            // Validate the plan structure
            if (!aiPlan.jobs || !Array.isArray(aiPlan.jobs)) {
                throw new Error('Invalid plan structure from AI');
            }

            // Validate that columns exist in the dataset
            const columnNames = context.profile.columns.map(c => c.name);
            aiPlan.jobs = aiPlan.jobs.filter(job => 
                columnNames.includes(job.groupBy) && 
                columnNames.includes(job.metric) &&
                ['sum', 'avg', 'count', 'max', 'min'].includes(job.agg)
            );

            console.log('[Debug] AI Generated Plan:', JSON.stringify(aiPlan, null, 2));
            
            // Generate concrete workflow tasks based on the actual jobs that will be executed
            const limitedJobs = aiPlan.jobs.slice(0, 8); // Limit to 8 charts
            const workflowTasks = [];
            
            // Add chart generation tasks
            limitedJobs.forEach((job, index) => {
                const chartType = job.agg === 'count' ? 'bar chart' : 
                                job.agg === 'sum' || job.agg === 'avg' ? 'bar chart' : 'data table';
                workflowTasks.push({
                    description: `Building ${chartType}: ${job.agg}(${job.metric}) by ${job.groupBy}`,
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

// runAiWorkflow function moved to ai_chart_ui_workflow.js

// Global flag to prevent concurrent executions
let isRenderingAggregates = false;
let pendingRender = false;
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

async function renderAggregates(chartsSnapshot = null, excludedDimensions = [], fallbackDepth = 0, retry = false) {
    if (!ROWS) return showToast('Load a CSV first.', 'error');
    // Ensure AI Chat has access to the latest dataset
    if (!window.currentData || window.currentData.length === 0) {
        window.currentData = ROWS;
    }

     // Enhanced concurrent execution prevention
    if (isRenderingAggregates && !retry && MODE !== 'manual') {
        console.log('⏸️ renderAggregates already running, queueing next run');
        pendingRender = true;
        return;
    }
    
    // Check WorkflowManager state for additional protection
    const workflowState = WorkflowManager.getState();
    if (workflowState.status === 'running' && !retry && MODE !== 'manual') {
        console.log('⏸️ WorkflowManager indicates workflow is running, skipping new execution');
        showToast('Workflow is already running. Please wait for completion.', 'warning');
        return;
    }
    
    isRenderingAggregates = true;
    setGenerateButtonState(true); // Disable button when workflow starts
    console.log('🚀 Starting renderAggregates', { chartsSnapshot: !!chartsSnapshot, retry });

    try {
        const includedRows = getIncludedRows();
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
            WorkflowManager.reset();
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
                        if (WorkflowManager.getState().status !== 'running' || window.currentAggregationSession !== aggregationSessionId) {
                            break;
                        }
                        
                        console.log(`🔨 Building card ${i + 1}/${plan.jobs.length}: ${job.agg}(${job.metric}) by ${job.groupBy} [session: ${aggregationSessionId}]`);
                        const result = await buildAggCard(job, {}, aggregationSessionId);
                        
                        if (result && window.currentAggregationSession === aggregationSessionId) {
                            grid.appendChild(result.card);
                            if (result.explanationTask) {
                                explanationQueue.push(result.explanationTask);
                            }
                            
                            // Complete AI Agent chart generation task if in AI Agent mode
                            if (MODE === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                                const chartTaskDescription = `Building ${job.agg === 'count' ? 'bar chart' : job.agg === 'sum' || job.agg === 'avg' ? 'bar chart' : 'data table'}: ${job.agg}(${job.metric}) by ${job.groupBy}`;
                                console.log(`✅ Completing AI Agent chart task: ${chartTaskDescription}`);
                                AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), chartTaskDescription);
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
                        if (MODE === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                            const explanationTaskDescription = `Generating AI explanation for ${task.job.groupBy} analysis`;
                            console.log(`✅ Completing AI Agent explanation task: ${explanationTaskDescription}`);
                            AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), explanationTaskDescription);
                        }
                        
                        console.log(`🔄 Triggering auto-save after explanation ${i + 1}...`);
                        debouncedAutoSave();
                    }
                    console.log('✅ All explanations completed sequentially.');
                } else {
                    console.log('ℹ️ No explanations to generate');
                }
                
                // Complete AI Agent workflow completion task if in AI Agent mode
                if (MODE === 'ai_agent' && plan.planType === 'intelligent-analysis') {
                    console.log('✅ Completing AI Agent workflow completion task');
                    AITasks.completeTaskByDescription(WorkflowManager.getCurrentAgentId(), 'Completing AI Agent analysis workflow');
                    
                    // Ensure WorkflowManager is also completed for AI Agent mode
                    console.log('✅ Ensuring WorkflowManager completion for AI Agent mode');
                    if (WorkflowManager.getState().status === 'running') {
                        // Complete any remaining WorkflowManager tasks for AI Agent mode
                        const currentState = WorkflowManager.getState();
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
                isRenderingAggregates = false;
                setGenerateButtonState(false); // Re-enable button when workflow completes
                
                // Process any pending renders
                if (pendingRender) {
                    const wasPending = pendingRender;
                    pendingRender = false;
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
                
                if (WorkflowManager.getState().status === 'running') {
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
                        const finalState = WorkflowManager.getState();
                        console.log('🔍 Final workflow state:', finalState.status, finalState.tasks.map(t => `${t.description}: ${t.status}`));
                        updateAiTodoList(finalState);
                    }, 100);
                    
                    showToast('Analysis completed successfully.', 'success');
                    
                    // Auto-save after successful card generation
                    debouncedAutoSave();
                }
                setTimeout(applyMasonryLayout, 150);
                setTimeout(applyMasonryLayout, 500);
            } else {
                // Fallback when AI workflow fails: use basic auto plan
                console.log('🔄 AI workflow failed, falling back to basic auto plan');
                const fallbackPlan = autoPlan(PROFILE, includedRows, excludedDimensions);
                
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
                    isRenderingAggregates = false;
                    setGenerateButtonState(false); // Re-enable button after fallback
                    
                    // Process any pending renders
                    if (pendingRender) {
                        const wasPending = pendingRender;
                        pendingRender = false;
                        console.log('🔁 Running queued renderAggregates after fallback');
                        setTimeout(() => {
                            try { renderAggregates(null, [], 0, true); } catch (e) { console.error(e); }
                        }, 100);
                    }
                } else {
                    // No fallback plan available
                    console.log('🏁 No fallback plan available, releasing render lock');
                    isRenderingAggregates = false;
                    setGenerateButtonState(false); // Re-enable button when no fallback available
                    
                    if (pendingRender) {
                        const wasPending = pendingRender;
                        pendingRender = false;
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
        // Don't reset isRenderingAggregates here if explanations are still running
        // The flag will be reset after explanations complete (see explanation completion logic above)
        console.log('✅ renderAggregates main phase completed, keeping render lock for explanations');
    }
}

/* ========= Modal accessibility: ESC & backdrop ========= */
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open')); }});

['roleModal','aggModal', 'historyModal', 'removedRowsModal', 'aiSettingsModal'].forEach(id=>{ const m = document.getElementById(id); m?.addEventListener('click', (e)=>{ if (e.target===m) m.classList.remove('open'); }); });
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
  const isNewFile = sessionStorage.getItem('isNewFileLoad') === 'true';
  if (isNewFile) {
    console.log('[Workflow] New file load detected, aborting history load and forcing fresh analysis.');
    sessionStorage.removeItem('isNewFileLoad');
    if (ROWS && PROFILE) {
        renderAggregates();
    } else {
        showToast('Cannot perform fresh analysis: data not loaded.', 'error');
    }
    return;
  }
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
    DATA_COLUMNS = history.columns || [];
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
    if (Array.isArray(snapshot.rowInclusion)) {
       if (snapshot.rowInclusion.length === ROWS.length) {
         ROW_INCLUDED = snapshot.rowInclusion;
       } else {
         console.warn('history rowInclusion length mismatch; adjusting saved inclusion to current rows');
         const arr = snapshot.rowInclusion.slice(0, ROWS.length);
         while (arr.length < ROWS.length) arr.push(true);
         ROW_INCLUDED = arr;
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
      if (typeof window.refreshChatUI === 'function') {
        window.refreshChatUI();
      } else {
        // Fallback: if refresh helper isn't available yet, avoid early-return by re-init once
        if (chatSectionEl && chatSectionEl.hasAttribute('data-chat-initialized')) {
          chatSectionEl.removeAttribute('data-chat-initialized');
        }
        if (typeof window.initializeChat === 'function') {
          window.initializeChat();
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
        WorkflowManager.reset('auto');
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
        if (typeof window.initializeChat === 'function') {
          window.initializeChat();
          console.log('📱 AI Analysis Chat initialized after history restore');
        } else {
          console.log('⚠️ initializeChat function not available yet, will retry...');
          // Retry after a short delay
          setTimeout(() => {
            if (typeof window.initializeChat === 'function') {
              window.initializeChat();
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
$('#closeHistoryModal').onclick = () => $('#historyModal').classList.remove('open');

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
        sessionStorage.setItem('isNewFileLoad', 'true');
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
        ROWS = data; window.currentData = data;
        DATA_COLUMNS = Object.keys(ROWS[0] || {});
        
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
        QUERY = ''; 
        $('#searchInput').value = '';
        SORT = { col: null, dir: 'asc' };
        RPP = Number($('#rowsPerPage').value) || 25; 
        PAGE = 1;
        
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
        WorkflowManager.reset(MODE); // Clear AI todo list on new load
        
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
              if (typeof window.initializeChat === 'function') {
                if (!window.currentData || window.currentData.length === 0) {
                  window.currentData = ROWS;
                }
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                window.initializeChat();
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
              if (typeof window.initializeChat === 'function') {
                if (!window.currentData || window.currentData.length === 0) {
                  window.currentData = ROWS;
                }
                const chatSection = document.getElementById('ai-analysis-section');
                if (chatSection) chatSection.style.display = 'block';
                window.initializeChat();
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

// Chat state management (make it global for snapshot saving)
  window.chatState = {
    messages: [],
    isTyping: false,
    lastContextRefresh: null
  };

  // Context gathering system
  function gatherAnalysisContext() {
    const context = {
      timestamp: Date.now(),
      dataset: null,
      charts: [],
      summary: null
    };

    // Gather dataset information
    if (window.currentData && window.currentData.length > 0) {
      const sampleSize = Math.min(5, window.currentData.length);
      context.dataset = {
        rowCount: window.currentData.length,
        columns: Object.keys(window.currentData[0] || {}),
        sampleData: window.currentData.slice(0, sampleSize)
      };
    }

    // Gather chart configurations and data
    const chartCards = document.querySelectorAll('.card');
    console.log('🔍 Context gathering debug:', {
      cardElements: chartCards.length,
      totalElements: document.querySelectorAll('*').length
    });
    
    chartCards.forEach((card, index) => {
      const titleElement = card.querySelector('h4');
      const title = titleElement ? titleElement.textContent : `Chart ${index + 1}`;
      
      const chartElements = card.querySelectorAll('.chart-card');
      console.log(`🔍 Card ${index}: title="${title}", chartElements=${chartElements.length}`);
      
      const charts = [];
      
      chartElements.forEach((chartCard, chartIndex) => {
        const canvas = chartCard.querySelector('canvas');
        const chartTypeSelect = chartCard.querySelector('.chart-type-select');
        const topNSelect = chartCard.querySelector('.chart-topn-select');
        
        console.log(`🔍 Chart ${chartIndex}: canvas=${!!canvas}, hasChart=${!!(canvas && canvas.chart)}`);
        
        if (canvas) {
          // Try multiple ways to detect chart data
          const chartInstance = canvas.chart || canvas._chartInstance;
          const hasChartData = !!(chartInstance || canvas.dataset.chartType);
          
          if (chartInstance) {
            charts.push({
              type: chartTypeSelect ? chartTypeSelect.value : 'unknown',
              topN: topNSelect ? topNSelect.value : null,
              data: chartInstance.data,
              options: chartInstance.options
            });
          } else if (hasChartData) {
            // Fallback: basic chart info without full Chart.js data
            charts.push({
              type: chartTypeSelect ? chartTypeSelect.value : 'unknown',
              topN: topNSelect ? topNSelect.value : null,
              title: title,
              hasCanvas: true
            });
          }
        }
      });

      console.log(`🔍 Card ${index} final: ${charts.length} charts added`);
      
      // Always add the card to context, gathering available data from DOM
      if (chartElements.length > 0) {
        // Gather rich context from DOM elements
        const tableData = [];
        const table = card.querySelector('table');
        if (table) {
          const rows = table.querySelectorAll('tbody tr');
          const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
          
          Array.from(rows).slice(0, 5).forEach(row => { // Get first 5 rows
            const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
            if (cells.length > 0) {
              tableData.push(cells);
            }
          });
        }

        // Get chart type selector values
        const chartTypeSelects = card.querySelectorAll('.chart-type-select');
        const chartTypes = Array.from(chartTypeSelects).map(select => select.value);
        
        // Get card subtitle for additional context
        const subtitle = card.querySelector('.card-sub');
        const subtitleText = subtitle ? subtitle.textContent.trim() : '';

        // Reconstruct aggregation data using stored job parameters
        let aggregationData = null;
        try {
          if (card.dataset.groupBy && card.dataset.metric && card.dataset.agg && window.currentData) {
            const filterValue = Number(card.querySelector('.filter-input')?.value || 0);
            const filterMode = card.querySelector('.filter-mode-select')?.value || 'share';
            const showMissing = card.dataset.showMissing === 'true';
            
            // Use the same groupAgg function that builds the charts
            if (typeof groupAgg === 'function' && typeof getIncludedRows === 'function') {
              aggregationData = groupAgg(
                getIncludedRows(), 
                card.dataset.groupBy, 
                card.dataset.metric, 
                card.dataset.agg, 
                card.dataset.dateBucket || '', 
                { mode: filterMode, value: filterValue }, 
                showMissing,
                PROFILE
              );
            }
          }
        } catch (error) {
          console.warn('Could not reconstruct aggregation data:', error);
        }

        // Get AI explanation if stored (check both dataset and rendered content)
        const explanationEl = card.querySelector('.ai-explanation-content');
        const explanation = card.dataset.explanationMarkdown || (explanationEl ? explanationEl.innerHTML : '') || '';
        
        console.log(`🔍 Explanation check for card "${title}":`, {
          hasDatasetMarkdown: !!card.dataset.explanationMarkdown,
          hasContentElement: !!explanationEl,
          contentLength: explanationEl ? explanationEl.innerHTML.length : 0,
          finalExplanation: !!explanation && explanation.trim().length > 0
        });

        const chartContext = {
          title: title,
          subtitle: subtitleText,
          chartTypes: chartTypes.length > 0 ? chartTypes : ['unknown'],
          tableHeaders: table ? Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim()) : [],
          sampleData: tableData,
          chartCount: chartElements.length,
          hasData: tableData.length > 0,
          // Rich aggregation data
          aggregation: (aggregationData && aggregationData.rows) ? {
            groupBy: card.dataset.groupBy,
            metric: card.dataset.metric,
            aggregation: card.dataset.agg,
            dateBucket: card.dataset.dateBucket,
            rowCount: aggregationData.rows.length,
            sampleRows: aggregationData.rows.slice(0, 5),
            headers: aggregationData.header
          } : null,
          aiExplanation: explanation
        };
        
        console.log(`🔍 Rich context for card ${index}:`, {
          title: chartContext.title,
          subtitle: chartContext.subtitle,
          chartTypes: chartContext.chartTypes,
          headerCount: chartContext.tableHeaders.length,
          dataRows: chartContext.sampleData.length,
          hasTable: !!table,
          hasAggregation: !!chartContext.aggregation,
          aggregationRows: chartContext.aggregation ? chartContext.aggregation.rowCount : 0,
          hasAIExplanation: !!chartContext.aiExplanation,
          jobParams: {
            groupBy: card.dataset.groupBy,
            metric: card.dataset.metric,
            agg: card.dataset.agg
          }
        });
        
        context.charts.push(chartContext);
      }
    });
    
    console.log('🔍 Final context:', {
      datasetExists: !!context.dataset,
      totalCharts: context.charts.length,
      chartTitles: context.charts.map(c => c.title)
    });

    // Gather AI summary if available
    const summaryElement = document.getElementById('ai-summary-text');
    if (summaryElement && summaryElement.textContent.trim()) {
      context.summary = summaryElement.textContent.trim();
    }

    return context;
  }

  // Update context status UI
  function updateContextStatus(context) {
    const contextText = document.getElementById('context-text');
    const chartsCount = document.getElementById('charts-count');
    const lastUpdated = document.getElementById('context-last-updated');
    
    if (contextText) {
      const status = context.dataset ? 'Ready' : 'No data loaded';
      contextText.textContent = `Context: ${status}`;
    }
    
    if (chartsCount) {
      const chartsArray = context.charts || [];
      chartsCount.textContent = `Charts: ${chartsArray.length}`;
    }
    
    if (lastUpdated) {
      lastUpdated.textContent = `Last updated: ${new Date(context.timestamp).toLocaleTimeString()}`;
    }

    // Update detailed breakdown sections
    updateChartBreakdown(context.charts || []);
    updateExplanationBreakdown(context.charts || []);
    updateSummaryBreakdown(context.summary || null);
    updateDatasetBreakdown(context.dataset || null);
    
    window.chatState.lastContextRefresh = context.timestamp;
  }

  // Update chart data breakdown
  function updateChartBreakdown(charts) {
    const breakdown = document.getElementById('chart-breakdown-list');
    if (!breakdown) return;

    if (!charts || charts.length === 0) {
      breakdown.innerHTML = '<div class="context-item-empty">No charts available</div>';
      return;
    }

    const chartItems = charts.map((chart, index) => {
      const hasData = chart.aggregation && chart.aggregation.rowCount > 0;
      const dataStatus = hasData 
        ? `✅ ${chart.aggregation.rowCount} data rows`
        : chart.hasData 
        ? `⚠️ Table data only`
        : `❌ No data`;
        
      return `
        <div class="context-item">
          <div class="context-item-title">${chart.title}</div>
          <div class="context-item-details">
            <span class="context-badge">${chart.chartTypes.join(', ')}</span>
            <span class="context-status">${dataStatus}</span>
          </div>
          ${hasData ? `<div class="context-item-meta">${chart.aggregation.groupBy} → ${chart.aggregation.metric}</div>` : ''}
        </div>
      `;
    }).join('');

    breakdown.innerHTML = chartItems;
  }

  // Update AI explanations breakdown
  function updateExplanationBreakdown(charts) {
    const breakdown = document.getElementById('explanation-breakdown');
    if (!breakdown) return;

    if (!charts) {
      breakdown.innerHTML = '<div class="context-item-empty">No AI explanations available</div>';
      return;
    }

    const explanations = charts.filter(chart => chart.aiExplanation && chart.aiExplanation.trim());
    
    if (explanations.length === 0) {
      breakdown.innerHTML = '<div class="context-item-empty">No AI explanations available</div>';
      return;
    }

    const explanationItems = explanations.map((chart, index) => {
      const wordCount = chart.aiExplanation.split(/\s+/).length;
      return `
        <div class="context-item">
          <div class="context-item-title">${chart.title}</div>
          <div class="context-item-details">
            <span class="context-status">✅ ${wordCount} words</span>
          </div>
        </div>
      `;
    }).join('');

    breakdown.innerHTML = `
      <div class="context-summary-stat">
        <strong>${explanations.length}</strong> of <strong>${charts.length}</strong> charts have explanations
      </div>
      ${explanationItems}
    `;
  }

  // Update AI summary breakdown  
  function updateSummaryBreakdown(summary) {
    const breakdown = document.getElementById('summary-breakdown');
    if (!breakdown) return;

    if (!summary || !summary.trim()) {
      breakdown.innerHTML = '<div class="context-item-empty">No AI summary available</div>';
      return;
    }

    const wordCount = summary.split(/\s+/).length;
    breakdown.innerHTML = `
      <div class="context-item">
        <div class="context-item-title">Final Analysis Summary</div>
        <div class="context-item-details">
          <span class="context-status">✅ ${wordCount} words</span>
        </div>
      </div>
    `;
  }

  // Update dataset breakdown
  function updateDatasetBreakdown(dataset) {
    const breakdown = document.getElementById('dataset-breakdown');
    if (!breakdown) return;

    if (!dataset) {
      breakdown.innerHTML = '<div class="context-item-empty">No dataset loaded</div>';
      return;
    }

    breakdown.innerHTML = `
      <div class="context-item">
        <div class="context-item-title">Dataset Overview</div>
        <div class="context-item-details">
          <span class="context-badge">${dataset.rowCount || 0} rows</span>
          <span class="context-badge">${(dataset.columns || []).length} columns</span>
        </div>
        <div class="context-item-meta">Columns: ${(dataset.columns || []).join(', ')}</div>
      </div>
    `;
  }

  // Add message to chat
  function addChatMessage(content, isUser = false) {
    const message = {
      id: Date.now(),
      content: content,
      isUser: isUser,
      timestamp: new Date()
    };
    
    window.chatState.messages.push(message);
    renderChatMessage(message);
    
    // Auto-save chat history to current report
    if (window.currentHistoryId && typeof Store !== 'undefined') {
      try {
        Store.updateHistory(window.currentHistoryId, { 
          uiSnapshot: getUiSnapshot(), 
          updatedAt: Date.now() 
        }).catch(error => {
          console.warn('Failed to auto-save chat message:', error);
        });
      } catch (error) {
        console.warn('Failed to auto-save chat message:', error);
      }
    }
    
    // Scroll to bottom
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    return message;
  }

  // Render a chat message
  function renderChatMessage(message) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = message.isUser ? 'user-message' : 'ai-message';
    
    // Process content based on message type
    let processedContent;
    if (message.isUser) {
      // User messages: simple text, escape HTML
      processedContent = `<p>${message.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
    } else {
      // AI messages: render as Markdown
      try {
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
          processedContent = marked.parse(message.content);
        } else {
          // Fallback: basic formatting if marked.js isn't available
          processedContent = message.content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
          processedContent = `<p>${processedContent}</p>`;
        }
      } catch (error) {
        console.warn('Markdown rendering failed:', error);
        processedContent = `<p>${message.content}</p>`;
      }
    }
    
    messageDiv.innerHTML = `
      <div class="message-avatar">${message.isUser ? '👤' : '🤖'}</div>
      <div class="message-content">
        ${processedContent}
      </div>
    `;

    messagesContainer.appendChild(messageDiv);
  }

  // Show typing indicator
  function showTypingIndicator() {
    const typingIndicator = document.getElementById('chat-typing-indicator');
    if (typingIndicator) {
      typingIndicator.style.display = 'flex';
    }
    window.chatState.isTyping = true;
  }

  // Hide typing indicator
  function hideTypingIndicator() {
    const typingIndicator = document.getElementById('chat-typing-indicator');
    if (typingIndicator) {
      typingIndicator.style.display = 'none';
    }
    window.chatState.isTyping = false;
  }

  // Send chat message to AI
  async function sendChatMessage(userMessage) {
    try {
      // Gather fresh context
      const context = gatherAnalysisContext();
      updateContextStatus(context);

      // Add user message to chat
      addChatMessage(userMessage, true);
      
      // Show typing indicator
      showTypingIndicator();

      // Prepare context for AI
      const contextPrompt = `
System: You are my professional executive assistant with expertise in ERP systems, CRM platforms, and data analytics. 
Your role is to brief me (the CEO) on the following dataset and chart analysis. 
You deliver insights in a polished, authoritative, and business-oriented tone — suitable for executive decision-making.

Tone:
- Executive-level: confident, concise, and professional.  
- Polished: structured like a boardroom briefing.  
- Action-oriented: focus on what matters for leadership, not raw technical detail.  
- No filler, no casual phrasing. Deliver clarity and impact.  

=== DATASET OVERVIEW ===
${context.dataset ? `
- Total Records: ${context.dataset.rowCount}
- Columns (${context.dataset.columns.length}): ${context.dataset.columns.join(', ')}
- Sample Data Preview:
${context.dataset.sampleData ? context.dataset.sampleData.slice(0, 3).map(row => '  ' + Object.entries(row).map(([k,v]) => `${k}: ${v}`).join(', ')).join('\n') : 'No sample data available'}
` : 'No dataset loaded'}

=== CHART ANALYSIS (${(context.charts || []).length} charts) ===
${(context.charts || []).map(chart => {
  let chartInfo = `\n📊 ${chart.title}`;
  if (chart.subtitle) chartInfo += `\n   Subtitle: ${chart.subtitle}`;
  chartInfo += `\n   Type: ${(chart.chartTypes || []).join(', ')}`;
  
  // Add aggregation details if available
  if (chart.aggregation) {
    chartInfo += `\n   Analysis: ${chart.aggregation.aggregation}(${chart.aggregation.metric}) grouped by ${chart.aggregation.groupBy}`;
    chartInfo += `\n   Data Points: ${chart.aggregation.rowCount} rows`;
    
    // Include sample aggregated data
    if (chart.aggregation.sampleRows && chart.aggregation.headers) {
      chartInfo += `\n   Top Results:`;
      chart.aggregation.sampleRows.slice(0, 5).forEach(row => {
        chartInfo += `\n     • ${row[0]}: ${row[1]}`;
      });
    }
  }
  
  // Add table data if available
  if (chart.sampleData && chart.sampleData.length > 0) {
    chartInfo += `\n   Table Data (${chart.sampleData.length} rows shown):`;
    if (chart.tableHeaders && chart.tableHeaders.length > 0) {
      chartInfo += `\n     Headers: ${chart.tableHeaders.join(' | ')}`;
      chart.sampleData.slice(0, 3).forEach(row => {
        chartInfo += `\n     ${row.join(' | ')}`;
      });
    }
  }
  
  // Add AI explanation if available
  if (chart.aiExplanation && chart.aiExplanation.trim()) {
    const cleanExplanation = chart.aiExplanation.replace(/<[^>]*>/g, '').trim();
    if (cleanExplanation) {
      chartInfo += `\n   AI Insight: ${cleanExplanation.substring(0, 200)}${cleanExplanation.length > 200 ? '...' : ''}`;
    }
  }
  
  return chartInfo;
}).join('\n')}

${context.summary ? `
=== AI SUMMARY ===
${context.summary.substring(0, 500)}${context.summary.length > 500 ? '...' : ''}
` : ''}

=== USER QUESTION ===
${userMessage}

Task:
Provide a structured executive response that includes:  
1. **ERP Perspective** — operational efficiency, finance, or supply chain impacts.  
2. **CRM Perspective** — customer trends, sales behavior, or retention insights.  
3. **Analytics Perspective** — anomalies, KPIs, or emerging patterns.  
4. **Business Implications** — what this means for strategy and operations.  
5. **Recommendations** — prioritized actions or further analyses.  

Format:
- 2–4 short, structured paragraphs (executive briefing style).  
- Use markdown for readability.  
- Quote specific numbers when possible.  
- Keep the focus on decision-making impact, not raw technical details.  
`;

      // Get API key from settings (using same pattern as existing AI features)
      const apiKey = localStorage.getItem('gemini_api_key');
      const model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
      const baseUrl = localStorage.getItem('gemini_base_url') || 'https://generativelanguage.googleapis.com/v1beta';
      
      console.log('🔍 Chat API Settings:', {
        hasApiKey: !!apiKey,
        model: model,
        baseUrl: baseUrl,
        apiKeyLength: apiKey ? apiKey.length : 0
      });
      
      if (!isValidApiKey(apiKey)) {
        console.log('❌ No API key found in settings');
        hideTypingIndicator();
        addChatMessage("Please set your API key in AI Settings first.", false);
        return;
      }

      console.log('🌐 Making API call:', {
        model: model,
        apiKeyLength: apiKey.length,
        contextLength: contextPrompt.length
      });

      // Call Gemini API using the same pattern as existing AI features
      const prompt = `System: You are a helpful data analysis assistant. Provide insights about charts, data patterns, and analytics. Be conversational and helpful.\n\nUser: ${contextPrompt}`;
      
      const response = await fetchWithRetry(apiKey, model, prompt, (msg, type) => {
        if (typeof showToast === 'function') {
          showToast(msg, type);
        }
      });

      console.log('✅ API Response received:', {
        responseType: typeof response,
        responseLength: response ? response.length : 0,
        firstChars: response ? response.substring(0, 100) : 'No response'
      });
      
      const aiResponse = response || 'Sorry, I could not generate a response.';
      
      hideTypingIndicator();
      addChatMessage(aiResponse, false);

    } catch (error) {
      console.error('Chat error:', error);
      hideTypingIndicator();
      addChatMessage(`Error: ${error.message}`, false);
    }
  }

  // Initialize chat functionality
  window.initializeChat = function initializeChat() {
    const chatSection = document.getElementById('ai-analysis-section');
    const sendBtn = document.getElementById('send-chat-btn');
    const chatInput = document.getElementById('chat-input');
    const refreshContextBtn = document.getElementById('refresh-context-btn');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const toggleContextBtn = document.getElementById('toggle-context-details');

    if (!chatSection || !sendBtn || !chatInput) return;
    
    // Prevent duplicate initialization
    if (chatSection.hasAttribute('data-chat-initialized')) return;
    chatSection.setAttribute('data-chat-initialized', 'true');

    // Show chat section when data is loaded
    const apiKey = localStorage.getItem('gemini_api_key');
    if (window.currentData && window.currentData.length > 0 && isValidApiKey(apiKey)) {
      chatSection.style.display = 'block';
      console.log('📱 AI Analysis Chat section shown');
    } else {
      console.log('📱 AI Analysis Chat section hidden - no data loaded');
    }

    // Send message on button click
    sendBtn.addEventListener('click', () => {
      const message = chatInput.value.trim();
      if (message && !window.chatState.isTyping) {
        chatInput.value = '';
        sendBtn.disabled = true;
        sendChatMessage(message);
      }
    });

    // Send message on Enter (Shift+Enter for new line)
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    // Enable/disable send button based on input
    chatInput.addEventListener('input', () => {
      sendBtn.disabled = !chatInput.value.trim() || window.chatState.isTyping;
    });

    // Refresh context button
    if (refreshContextBtn) {
      refreshContextBtn.addEventListener('click', () => {
        const context = gatherAnalysisContext();
        updateContextStatus(context);
        if (typeof showToast === 'function') {
          showToast('Context refreshed successfully!');
        }
      });
    }

    // Clear chat button
    if (clearChatBtn) {
      clearChatBtn.addEventListener('click', () => {
        window.chatState.messages = [];
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
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
        
        // Auto-save the cleared chat state to history
        if (window.currentHistoryId && typeof Store !== 'undefined') {
          try {
            Store.updateHistory(window.currentHistoryId, { 
              uiSnapshot: getUiSnapshot(), 
              updatedAt: Date.now() 
            }).catch(error => {
              console.warn('Failed to auto-save cleared chat:', error);
            });
          } catch (error) {
            console.warn('Failed to auto-save cleared chat:', error);
          }
        }
        
        if (typeof showToast === 'function') {
          showToast('Chat history cleared!');
        }
      });
    }

    // Toggle context details
    if (toggleContextBtn) {
      toggleContextBtn.addEventListener('click', () => {
        const contextDetails = document.getElementById('context-details');
        if (contextDetails) {
          const isHidden = contextDetails.style.display === 'none';
          contextDetails.style.display = isHidden ? 'block' : 'none';
          toggleContextBtn.textContent = isHidden ? '▲' : '▼';
        }
      });
    }

    // Restore chat messages if they exist
    restoreChatMessages();
    
    // Initialize context
    const context = gatherAnalysisContext();
    updateContextStatus(context);
  }

  // Function to restore chat messages from saved state
  function restoreChatMessages() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer || !window.chatState || !window.chatState.messages) return;
    
    // Clear existing messages
    messagesContainer.innerHTML = '';
    
    if (window.chatState.messages.length === 0) {
      // Show welcome message if no saved messages
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
    } else {
      // Restore all saved messages
      console.log('💬 Rendering', window.chatState.messages.length, 'restored chat messages');
      window.chatState.messages.forEach(message => {
        renderChatMessage(message);
      });
      
      // Scroll to bottom
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }

  // Expose a safe, idempotent UI refresh that bypasses init guard
  window.refreshChatUI = function refreshChatUI() {
    try {
      const chatSection = document.getElementById('ai-analysis-section');
      const apiKey = localStorage.getItem('gemini_api_key');
      if (chatSection && window.currentData && window.currentData.length > 0 && isValidApiKey(apiKey)) {
        chatSection.style.display = 'block';
      } else if (chatSection) {
        chatSection.style.display = 'none';
      }
      // Ensure state exists
      if (!window.chatState || !Array.isArray(window.chatState.messages)) {
        window.chatState = { messages: [], isTyping: false, lastContextRefresh: null };
      }
      // Re-render messages from state without re-binding listeners
      restoreChatMessages();
    } catch (e) {
      console.warn('refreshChatUI failed:', e);
    }
  };

  // Hook into existing data loading to show chat
  const originalRenderAggregates = window.renderAggregates;
  if (originalRenderAggregates) {
    window.renderAggregates = async function(...args) {
      const result = await originalRenderAggregates.apply(this, args);
      
      // Show chat section after charts are rendered
      setTimeout(() => {
        const chatSection = document.getElementById('ai-analysis-section');
        if (chatSection && window.currentData && window.currentData.length > 0) {
          chatSection.style.display = 'block';
          window.initializeChat();
        }
      }, 500);
      
      return result;
    };
  }

  // Initialize chat on page load if data exists
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (window.currentData && window.currentData.length > 0) {
        window.initializeChat();
      }
    }, 1000);
  });