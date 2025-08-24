import * as Store from './ai_chart_store.js';
import { fetchWithRetry } from './ai_chart_api.js';
import { isValidApiKey } from './ai_chart_ai_settings_handlers.js';
import { groupAgg, renderChartCard, renderAggTable, addMissingDataWarning, computeChartConfig, canonicalJobKey, deduplicateJobs, ensureChart } from './ai_chart_aggregates.js';
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
const ROWS = () => window.ROWS;
const PROFILE = () => window.PROFILE;
const MODE = () => window.MODE;
const autoPlan = (profile, rows, excluded) => window.autoPlan ? window.autoPlan(profile, rows, excluded) : { jobs: [] };
const marked = window.marked || { parse: (text) => text };
const debounce = window.debounce || ((fn, delay) => fn);
const debouncedAutoSave = window.debouncedAutoSave || (() => {});

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
        }, newShowMissing, PROFILE());

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
    }, showMissing, PROFILE());
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
            profile: PROFILE(),
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

// Export the functions for use in the main file
export {
    buildAggCard,
    getAiAnalysisPlan, 
    getIntelligentAiAnalysisPlan,
    renderAggregates,
    setGenerateButtonState
};