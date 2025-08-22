// AI Workflow UI Module - extracted from ai_chart_ui.js
// Handles AI/workflow, explanation, AI-summary and chat UI logic

// Imports for workflow functionality
import { fetchWithRetry } from './ai_chart_api.js';
import * as Store from './ai_chart_store.js';
import { addMissingDataWarning, groupAgg, computeChartConfig, ensureChart, renderChartCard, renderAggTable } from './ai_chart_aggregates.js';
import { isValidApiKey, initializeAiSettingsHandlers } from './ai_chart_ai_settings_handlers.js';

// Module-level state
let workflowDeps = null;
let isInitialized = false;

// AI Todo List UI & Subscription Functions
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
    const todoList = document.getElementById('ai-todo-list');
    const container = document.getElementById('ai-todo-list-section');
    const progressBar = document.getElementById('ai-progress-bar');
    const currentTaskDetails = document.getElementById('ai-current-task-details');

    // Debug logging to check if elements are found
    console.log('🔍 updateAiTodoList debug:', {
        todoList: !!todoList,
        container: !!container,
        progressBar: !!progressBar,
        currentTaskDetails: !!currentTaskDetails,
        status,
        tasksLength: tasks.length,
        mode: window.MODE
    });

    if (!todoList || !container || !progressBar || !currentTaskDetails) {
        console.error('❌ Missing UI elements in updateAiTodoList');
        return;
    }

    // Don't hide section for AI Agent mode when agent is running (tasks may still be loading)
    if (status === 'idle' || (tasks.length === 0 && !(window.MODE === 'ai_agent' && status === 'running'))) {
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
    if (window.MODE === 'ai_agent' && tasks.length === 0 && status === 'running') {
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
            const currentState = workflowDeps.WorkflowManager.getState();
            // Don't hide during AI Agent mode - tasks may still be loading
            if (currentState.status === 'completed' && window.MODE !== 'ai_agent') {
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
        const elapsedTime = workflowDeps.workflowTimer.getElapsed();
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
                            const eta = workflowDeps.workflowTimer.getEstimatedTimeRemaining(currentTaskIndex, state.tasks.length);
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
        if (!workflowDeps.workflowTimer.intervalId) {
            workflowDeps.workflowTimer.onUpdate((elapsed) => {
                // Check if workflow is still running before updating UI
                const currentState = workflowDeps.WorkflowManager.getState();
                if (currentState.status !== 'running') {
                    console.log('⏹️ Stopping timer updates - workflow no longer running');
                    workflowDeps.workflowTimer.stop();
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
        const elapsedTime = workflowDeps.workflowTimer.getElapsed();
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

// CSS Overrides & Workflow Stylesheet Injection
function injectCSSOverrides() {
    // Add comprehensive CSS override to defeat the problematic hiding rules
    if (!document.getElementById('ai-todo-list-override-styles')) {
        const styleOverride = document.createElement('style');
        styleOverride.id = 'ai-todo-list-override-styles';
        styleOverride.innerHTML = `
            /* Override problematic CSS rules with highest specificity */
            #ai-todo-list, 
            #ai-todo-list li, 
            #ai-todo-list .task-item,
            #ai-todo-list .task-group-header,
            #ai-todo-list .task-completed,
            #ai-todo-list .task-pending,
            #ai-todo-list .task-in-progress,
            #ai-todo-list .task-type-chart-generation,
            #ai-todo-list .task-type-ai-explanation,
            #ai-todo-list .task-type-workflow-completion,
            .workflow-status .running-status,
            .workflow-status .running-status .progress-indicators,
            .workflow-status .running-status .action-buttons,
            .workflow-status .running-status .running-info .task-header,
            .workflow-status .running-status .running-info .task-submessage,
            .workflow-status .running-status .running-info .time-display,
            .running-status,
            .running-info,
            .task-header,
            .task-submessage,
            .time-display,
            .progress-indicators,
            .action-buttons {
                display: list-item !important;
                visibility: visible !important;
                opacity: 1 !important;
                height: auto !important;
                overflow: visible !important;
            }
            
            #ai-todo-list {
                display: block !important;
                list-style: none !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            
            #ai-todo-list .task-group-header {
                font-weight: bold !important;
                color: #666 !important;
                margin-top: 12px !important;
                margin-bottom: 4px !important;
                padding: 4px 0 !important;
                background: #f5f5f5 !important;
                border-radius: 4px !important;
            }
            
            #ai-todo-list .task-item {
                border: 1px solid #e1e5e9 !important;
                border-radius: 6px !important;
                margin-bottom: 8px !important;
                padding: 12px !important;
                background: #fff !important;
            }
            
            #ai-todo-list .task-content {
                display: flex !important;
                align-items: flex-start !important;
                gap: 12px !important;
            }
            
            #ai-todo-list .task-icon {
                font-size: 16px !important;
                line-height: 1 !important;
            }
            
            #ai-todo-list .task-info {
                flex: 1 !important;
            }
            
            #ai-todo-list .task-description {
                font-weight: 500 !important;
                color: #24292f !important;
                margin-bottom: 4px !important;
            }
            
            #ai-todo-list .task-message {
                color: #656d76 !important;
                font-size: 14px !important;
                margin-bottom: 4px !important;
            }
            
            #ai-todo-list .task-timestamp {
                color: #656d76 !important;
                font-size: 12px !important;
            }
        `;
        document.head.appendChild(styleOverride);
        console.log('🎨 Added comprehensive CSS override styles for AI todo list');
    }
}

function injectWorkflowStylesheet() {
    // Inject enhanced styles
    if (!document.querySelector('#ai-workflow-enhanced-styles')) {
        const link = document.createElement('link');
        link.id = 'ai-workflow-enhanced-styles';
        link.rel = 'stylesheet';
        link.href = new URL('./ai_chart_workflow.css', import.meta.url).href;
        document.head.appendChild(link);
    }
}

// Global Workflow Button Handling (Event Delegation)
function setupWorkflowEventHandlers() {
    // Event delegation for WorkflowManager buttons to prevent "undefined" errors
    document.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        
        // Handle regenerate summary button specifically
        if (e.target.id === 'regenerate-summary-btn') {
            e.preventDefault();
            generateAISummary();
            return;
        }
        
        if (!action) return;
        
        try {
            switch (action) {
                case 'retry':
                    // Disable the button to prevent multiple clicks
                    e.target.disabled = true;
                    e.target.textContent = 'Retrying...';
                    workflowDeps.renderAggregates();
                    // Re-enable button after a delay
                    setTimeout(() => {
                        e.target.disabled = false;
                        e.target.textContent = 'Retry Analysis';
                    }, 2000);
                    break;
                case 'restart':
                    console.log('🔄 Restarting workflow...');
                    // Disable the button to prevent multiple clicks
                    e.target.disabled = true;
                    e.target.textContent = 'Restarting...';
                    workflowDeps.renderAggregates();
                    // Re-enable button after a delay
                    setTimeout(() => {
                        e.target.disabled = false;
                        e.target.textContent = 'Restart Analysis';
                    }, 2000);
                    break;
                case 'reset-restart':
                    workflowDeps.WorkflowManager.reset();
                    workflowDeps.WorkflowManager.start();
                    break;
                case 'cancel':
                    workflowDeps.workflowTimer.stop();
                    workflowDeps.WorkflowManager.cancel();
                    break;
                case 'pause':
                    workflowDeps.workflowTimer.stop();
                    workflowDeps.WorkflowManager.pause();
                    window.showToast?.('Analysis paused', 'info');
                    break;
                case 'resume':
                    workflowDeps.workflowTimer.start();
                    workflowDeps.WorkflowManager.resume();
                    window.showToast?.('Analysis resumed', 'info');
                    break;
            }
        } catch (error) {
            console.error('WorkflowManager action failed:', error);
            window.showToast?.('Action failed: ' + error.message, 'error');
        }
    });
}

// Explanation Rendering & AI Explanation Generation
export function renderExplanationCard(parentCard, title, contentHTML) {
    const explanationContainer = document.createElement('div');
    explanationContainer.className = 'ai-explanation';
    explanationContainer.style.borderTop = '1px solid #eee';

    const head = document.createElement('div');
    head.className = 'card-head';
    
    const h = document.createElement('h4');
    h.className = 'card-title';
    h.textContent = title;
    
    const regenerateBtn = document.createElement('button');
    regenerateBtn.textContent = 'Regenerate';
    regenerateBtn.className = 'regenerate-btn';

    head.appendChild(h);
    head.appendChild(regenerateBtn);
    explanationContainer.appendChild(head);

    const contentEl = document.createElement('div');
    contentEl.className = 'ai-explanation-content';
    contentEl.style.padding = '16px';
    contentEl.innerHTML = contentHTML;
    explanationContainer.appendChild(contentEl);

    // Prefer a stable slot inside card-content so re-rendering the table doesn't remove the explanation
    const cardContent = parentCard.querySelector('.card-content');
    let explanationSlot = parentCard.querySelector('.explanation-slot');
    if (!explanationSlot && cardContent) {
        explanationSlot = document.createElement('div');
        explanationSlot.className = 'explanation-slot';
        cardContent.appendChild(explanationSlot);
    }
    (explanationSlot || cardContent || parentCard).appendChild(explanationContainer);
    
    return { explanationContainer, contentEl, regenerateBtn };
}


/**
 * Initialize workflow UI with dependencies
 * @param {Object} deps - Dependencies object
 * @param {Object} deps.WorkflowManager - Workflow manager instance
 * @param {Object} deps.AITasks - AI tasks instance
 * @param {Object} deps.workflowTimer - Workflow timer instance
 * @param {Function} deps.renderAggregates - Function to render aggregates
 * @param {Function} deps.getIncludedRows - Function to get included rows
 * @param {Function} deps.applyMasonryLayout - Function to apply masonry layout
 */
export function initWorkflowUI(deps) {
    // Guard against double initialization
    if (isInitialized) {
        console.log('Workflow UI already initialized');
        return;
    }
    
    workflowDeps = deps;
    
    // Inject CSS override/style block
    injectCSSOverrides();
    
    // Inject workflow stylesheet link
    injectWorkflowStylesheet();
    
    // Bind document click event handler for workflow controls
    setupWorkflowEventHandlers();
    
    // Subscribe to WorkflowManager
    deps.WorkflowManager.subscribe(updateAiTodoList);
    
    // Attach initializeChat to window for compatibility (will be set later when chat is moved)
    // window.initializeChat = initializeChat;
    
    isInitialized = true;
    console.log('Workflow UI initialized');
}

/**
 * Run AI workflow orchestration
 * @param {Array} includedRows - Rows to include in analysis
 * @param {Array} excludedDimensions - Dimensions to exclude
 * @returns {Object} Plan object for renderAggregates
 */
export async function runAiWorkflow(includedRows, excludedDimensions = []) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!isValidApiKey(apiKey)) {
        console.log('No valid API key found, skipping AI workflow.');
        // Hide all AI explanation sections if no API key is present
        document.querySelectorAll('.ai-explanation').forEach(el => el.style.display = 'none');
        // Fallback to a default, non-AI plan if necessary
        // Initialize workflow even for non-AI fallback
        workflowDeps.WorkflowManager.reset(window.MODE);
        workflowDeps.WorkflowManager.start();
        workflowDeps.workflowTimer.start();
        
        workflowDeps.WorkflowManager.completeTask('init');
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const plan = window.autoPlan(window.PROFILE, includedRows, excludedDimensions);
        workflowDeps.WorkflowManager.completeTask('analysis', 'Using non-AI fallback.');
        workflowDeps.WorkflowManager.completeTask('ai-generation', 'Using automatic plan generation.');
        return plan;
    } else {
        workflowDeps.WorkflowManager.reset(window.MODE);
        workflowDeps.WorkflowManager.start();
        workflowDeps.workflowTimer.start();
        
        try {
            // For AI Agent mode, skip legacy init completion - tasks will be loaded dynamically
            if (window.MODE !== 'ai_agent') {
                workflowDeps.WorkflowManager.completeTask('init');
            }
            
            await new Promise(resolve => setTimeout(resolve, 50)); // Brief pause for UI update
            
            let plan;
            if (window.MODE === 'manual') {
                plan = (window.MANUAL_JOBS && window.MANUAL_JOBS.length) ? { jobs: window.MANUAL_JOBS.slice(0, 10) } : window.planFromManualRoles(window.PROFILE);
                workflowDeps.WorkflowManager.completeTask('analysis', 'Using manual roles.');
                workflowDeps.WorkflowManager.completeTask('config');
            } else if (window.MODE === 'ai_agent') {
                const context = {
                    profile: window.PROFILE,
                    includedRows: includedRows ? includedRows.slice(0, 5) : [], // Sample rows
                    excludedDimensions,
                    maxCharts: 10
                };
                
                // ✅ IMMEDIATE UI FEEDBACK: Show AI Agent is starting before API call
                console.log('🚀 AI Agent starting - showing immediate UI feedback');
                const container = document.getElementById('ai-todo-list-section');
                const todoList = document.getElementById('ai-todo-list');
                const progressBar = document.getElementById('ai-progress-bar');
                const currentTaskDetails = document.getElementById('ai-current-task-details');
                
                if (container && todoList && progressBar && currentTaskDetails) {
                    // Force show the workflow section immediately
                    container.style.display = 'block';
                    
                    // Show starting state
                    progressBar.style.width = '5%';
                    progressBar.setAttribute('aria-valuenow', 5);
                    progressBar.className = 'progress-active';
                    
                    currentTaskDetails.innerHTML = `
                        <div class="current-task-info">
                            <div class="task-spinner">🤖</div>
                            <div class="task-description">AI Agent is starting intelligent analysis...</div>
                            <div class="task-timing">Preparing to call Gemini API</div>
                        </div>
                    `;
                    
                    // Override the CSS !important rules that hide the todo list
                    todoList.style.setProperty('display', 'block', 'important');
                    todoList.style.setProperty('visibility', 'visible', 'important');
                    todoList.style.setProperty('opacity', '1', 'important');
                    todoList.style.setProperty('height', 'auto', 'important');
                    todoList.style.setProperty('overflow', 'visible', 'important');
                    
                    todoList.innerHTML = `
                        <li class="task-item task-in-progress" style="display: block !important; visibility: visible !important; opacity: 1 !important; height: auto !important; overflow: visible !important;">
                            <div class="task-content">
                                <span class="task-icon in-progress">🚀</span>
                                <div class="task-info">
                                    <div class="task-description">AI Agent starting analysis...</div>
                                    <div class="task-timestamp">${new Date().toLocaleTimeString()}</div>
                                </div>
                            </div>
                        </li>
                    `;
                    
                    console.log('✅ AI Agent starting state displayed to user');
                }
                
                const dynamicPlan = await window.getIntelligentAiAnalysisPlan(context);
                console.log('🔄 About to load AI Agent tasks:', dynamicPlan.tasks.length, 'tasks');
                workflowDeps.AITasks.loadPlan(workflowDeps.WorkflowManager.getCurrentAgentId(), dynamicPlan.tasks);
                
                // Force immediate UI update after tasks are loaded
                setTimeout(() => {
                    console.log('🔍 Checking UI state after AI tasks loaded');
                    const todoListCheck = document.getElementById('ai-todo-list');
                    if (todoListCheck) {
                        console.log('📋 TodoList innerHTML length after load:', todoListCheck.innerHTML.length);
                        console.log('📋 TodoList display style:', todoListCheck.style.display);
                        console.log('📋 TodoList computed display:', window.getComputedStyle(todoListCheck).display);
                    }
                }, 100);
                
                // For AI Agent mode, don't use legacy WorkflowManager task completion
                // The AI Agent tasks will be completed as actual work progresses
                console.log('🤖 AI Agent tasks loaded, skipping legacy task completion');
                
                plan = {
                    jobs: dynamicPlan.jobs,
                    charts: [],
                    planType: dynamicPlan.planType
                }; // Include planType for proper workflow handling
                
                // Don't complete analysis task yet - wait until after cards are built
            } else {
                const context = {
                    profile: window.PROFILE,
                    includedRows: includedRows ? includedRows.slice(0, 5) : [], // Sample rows
                    excludedDimensions,
                    maxCharts: 10
                };
                
                const dynamicPlan = await window.getAiAnalysisPlan(context);
                workflowDeps.AITasks.loadPlan(workflowDeps.WorkflowManager.getCurrentAgentId(), dynamicPlan.tasks);
                
                plan = {
                    jobs: dynamicPlan.jobs,
                    charts: [],
                    planType: dynamicPlan.planType
                }; // Include planType for proper workflow handling
                
                // Don't complete analysis task yet - wait until after cards are built
            }

            window.CURRENT_PLAN = plan;
            workflowDeps.workflowTimer.stop();
            return plan;

        } catch (error) {
            console.error("AI workflow failed:", error);
            workflowDeps.workflowTimer.stop();
            workflowDeps.WorkflowManager.fail(error);
            window.showToast?.(`An error occurred during AI analysis: ${error.message}`, 'error');
            return null;
        } finally {
            // Cleanup resources
            workflowDeps.workflowTimer.stop();
        }
    }
}

/**
 * Generate explanation for aggregation
 * @param {Object} agg - Aggregation object
 * @param {Object} job - Job object
 * @param {Object} parentCard - Parent card element
 */
export async function generateExplanation(agg, job, parentCard) {
    const apiKey = localStorage.getItem('gemini_api_key');
    const model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';

    // Do not render anything if the API key is invalid
    if (!isValidApiKey(apiKey)) {
        const existingExplanation = parentCard.querySelector('.ai-explanation');
        if (existingExplanation) {
            existingExplanation.style.display = 'none';
        }
        return;
    }
 
    // Render/replace explanation container first
    const existingExplanation = parentCard.querySelector('.ai-explanation');
    if (existingExplanation) {
        existingExplanation.remove();
    }
 
    const title = `AI Explanation for ${agg.header[1]} by ${agg.header[0]}`;
    const loaderHTML = '<p>Generating explanation...</p>';
    const { contentEl, regenerateBtn } = renderExplanationCard(parentCard, title, loaderHTML);
 
    regenerateBtn.onclick = () => {
        contentEl.innerHTML = loaderHTML;
        regenerateBtn.disabled = true;
        generateExplanation(agg, job, parentCard);
    };
 
    const timingLabel = `generateExplanation:${parentCard.dataset.canonicalKey || Math.random().toString(36).slice(2)}:${Date.now()}`;
    console.time(timingLabel);
    console.log(`⏱ generateExplanation start: ${timingLabel}`);
    try {
        const context = {
            agg,
            job,
            profile: window.PROFILE,
            rows: window.ROWS ? window.ROWS.slice(0, 5) : []
        };
 
        const prompt = `
You are my professional executive assistant with expertise in ERP systems, CRM platforms, and data analytics. 
You brief me, delivering insights in a confident, polished, and efficient manner.

Tone:
- Executive-level: clear, authoritative, and professional.
- Concise: no filler, no casual phrasing, no unnecessary detail.
- Action-oriented: emphasize what matters for decision-making.
- Polished: write in a business briefing style, as if preparing notes for a board meeting.

Task:
Review the aggregated business data and provide a summary in 3-8 short, well-structured paragraphs. 
Your explanation must include:
1. ERP Perspective — operational patterns (inventory, supply chain, finance) and their business impact.  
2. CRM Perspective — customer trends (sales, retention, engagement) and notable anomalies.  
3. Data Analytics Perspective — anomalies, KPI shifts, and recommended follow-up analyses.  

Always conclude with prioritized recommendations that guide executive action.  

            Context:
            ${JSON.stringify(context, null, 2)}
        `;
 
        const explanation = await fetchWithRetry(apiKey, model, prompt, window.showToast);
        contentEl.innerHTML = marked.parse(explanation);
        parentCard.dataset.explanationMarkdown = explanation; // Store raw explanation
 
        // Save explanation to history
        if (window.currentHistoryId) {
            const historyItem = await Store.getHistory(window.currentHistoryId);
            if (historyItem && historyItem.uiSnapshot && historyItem.uiSnapshot.charts) {
                const chartSnapshot = historyItem.uiSnapshot.charts.find(c =>
                    c.cardJobKey &&
                    c.cardJobKey.groupBy === job.groupBy &&
                    c.cardJobKey.metric === job.metric &&
                    c.cardJobKey.agg === job.agg &&
                    c.cardJobKey.dateBucket === job.dateBucket
                );
                if (chartSnapshot) {
                    chartSnapshot.explanation = explanation;
                    await Store.updateHistory(window.currentHistoryId, { uiSnapshot: historyItem.uiSnapshot });
                }
            }
        }
        console.timeEnd(timingLabel);
        console.log(`⏱ generateExplanation end: ${timingLabel}`);
        
        // Auto-save after explanation is successfully generated
        console.log(`🔄 Triggering auto-save after explanation completion...`);
        window.debouncedAutoSave?.();
    } catch (error) {
        console.timeEnd(timingLabel);
        console.error(`⏱ generateExplanation error (${timingLabel}):`, error);
        contentEl.innerHTML = `<p style="color: red;">Error generating explanation: ${error.message}</p>`;
        window.showToast?.(`AI Error: ${error.message}`, 'error');
    } finally {
        regenerateBtn.disabled = false;
    }
}

/**
 * Check and generate AI summary if needed
 */
export function checkAndGenerateAISummary() {
    const aiSummarySection = document.getElementById('ai-summary-section');
    const aiSummaryText = document.getElementById('ai-summary-text');
    const apiKey = localStorage.getItem('gemini_api_key');
    
    console.log('🤖 checkAndGenerateAISummary called');
    console.log('🤖 localStorage apiKey:', apiKey ? `"${apiKey.substring(0, 10)}..."` : 'null');
    console.log('🤖 aiSummarySection element:', aiSummarySection);
    
    // Only show AI Summary section if API key is present
    if (isValidApiKey(apiKey)) {
        console.log('🤖 API key detected, showing AI Summary section');
        if (aiSummarySection) {
            aiSummarySection.style.display = 'block';
            
            // Check if AI Summary already exists (from restored history)
            const existingSummary = aiSummaryText && aiSummaryText.innerHTML.trim();
            if (existingSummary && existingSummary.length > 0) {
                console.log('📄 AI Summary already exists from history, skipping generation');
                return;
            }
            
            // Generate new summary only if none exists
            console.log('🆕 No existing summary found, generating new one');
            generateAISummary();
        }
    } else {
        console.log('🤖 No API key, hiding AI Summary section');
        if (aiSummarySection) {
            aiSummarySection.style.display = 'none';
        }
    }
}

async function generateAISummary() {
    const loadingDiv = document.getElementById('ai-summary-loading');
    const textDiv = document.getElementById('ai-summary-text');
    const regenerateBtn = document.getElementById('regenerate-summary-btn');
    const apiKey = localStorage.getItem('gemini_api_key');
    
    try {
        // Show loading and disable button
        loadingDiv.style.display = 'block';
        textDiv.innerHTML = '';
        if (regenerateBtn) {
            regenerateBtn.disabled = true;
            regenerateBtn.textContent = '🔄 Generating...';
        }
        
        console.log('🤖 Starting AI Summary generation...');
        
        const aggregateData = collectAggregateData();
        console.log('📊 Collected aggregate data:', aggregateData);
        
        if (aggregateData.length === 0) {
            textDiv.innerHTML = '<p style="color: #666; font-style: italic;">No data available for summary generation.</p>';
            return;
        }
        
        const prompt = createSummaryPrompt(aggregateData);
        console.log('📝 Generated prompt for AI summary');
        
        const model = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
        const summary = await fetchWithRetry(apiKey, model, prompt, window.showToast);
        
        // Parse and display the summary
        textDiv.innerHTML = marked.parse(summary);
        console.log('✅ AI Summary generated and displayed');
        
        // Auto-save the summary
        window.debouncedAutoSave?.();
        
    } catch (error) {
        console.error('❌ AI Summary generation failed:', error);
        textDiv.innerHTML = `<p style="color: #d32f2f;">Failed to generate summary: ${error.message}</p>`;
        window.showToast?.(`AI Summary Error: ${error.message}`, 'error');
    } finally {
        // Hide loading and re-enable button
        loadingDiv.style.display = 'none';
        if (regenerateBtn) {
            regenerateBtn.disabled = false;
            regenerateBtn.textContent = '🔄 Regenerate Summary';
        }
    }
}

function collectAggregateData() {
    const aggregateData = [];
    
    // Collect data from all rendered cards
    const cards = document.querySelectorAll('.card');
    console.log('🔍 Found', cards.length, 'cards to analyze for summary');
    
    cards.forEach((card, index) => {
        try {
            const title = card.querySelector('.card-title')?.textContent || `Chart ${index + 1}`;
            const chartCanvas = card.querySelector('canvas');
            const tableData = card.querySelector('table');
            
            if (chartCanvas || tableData) {
                let insights = '';
                
                // Extract chart data if available
                if (chartCanvas && window.Chart) {
                    const chartInstance = window.Chart.getChart(chartCanvas);
                    if (chartInstance && chartInstance.data) {
                        const data = chartInstance.data;
                        const labels = data.labels || [];
                        const datasets = data.datasets || [];
                        
                        insights += `Chart Type: ${chartInstance.config.type || 'unknown'}. `;
                        insights += `Data Points: ${labels.length}. `;
                        
                        if (datasets.length > 0) {
                            const values = datasets[0].data || [];
                            if (values.length > 0) {
                                const max = Math.max(...values);
                                const min = Math.min(...values);
                                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                                insights += `Value Range: ${min.toFixed(2)} to ${max.toFixed(2)}, Average: ${avg.toFixed(2)}. `;
                            }
                        }
                    }
                }
                
                // Extract table data if available
                if (tableData) {
                    const rows = tableData.querySelectorAll('tbody tr');
                    insights += `Table with ${rows.length} rows. `;
                }
                
                aggregateData.push({
                    title,
                    insights: insights.trim(),
                    cardIndex: index
                });
            }
        } catch (error) {
            console.warn('⚠️ Error processing card', index, ':', error);
        }
    });
    
    console.log('🤖 Collected', aggregateData.length, 'aggregate data items');
    return aggregateData;
}

function createSummaryPrompt(aggregateData) {
    const totalCards = aggregateData.length;
    const cardSummaries = aggregateData.map(item => 
        `${item.title}: ${item.insights}`
    ).join('\n');
    
    const prompt = `
You are my professional executive assistant with expertise in ERP systems, CRM platforms, and data analytics. 
Your role is to deliver a polished executive summary.

Tone:
- Executive-level: confident, authoritative, and professional.  
- Concise: avoid filler or technical jargon; focus on clarity and impact.  
- Action-oriented: emphasize business implications and next steps.  
- Polished: structured like an executive briefing note for senior stakeholders.  

Task:
Based on the following ${totalCards} data visualization(s) and their insights:

${cardSummaries}

Provide a comprehensive executive summary (3-8 short, structured paragraphs) that includes:  
1. **Key Findings** — most important insights and trends.  
2. **Data Overview** — scope and nature of the analysis (ERP, CRM, or operational context).  
3. **Notable Patterns** — correlations, anomalies, or emerging trends.  
4. **Business Implications** — relevance to operations, customers, or strategy.  
5. **Recommendations** — prioritized actions or follow-up analyses.  

Formatting:
- Use markdown for readability (headings, bullet points).  
- Write in concise, business-oriented language suitable for board-level communication.  
- Deliver insights as an executive summary — no raw data or technical detail.  

`;

    return prompt;
}