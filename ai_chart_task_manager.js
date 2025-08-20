export class AITaskManager {
    constructor() {
        this.agentTasks = new Map(); // Per-agent task tracking
        this.apiCalls = new Map(); // Track Gemini API calls
        this.globalTasks = [];
        this.listeners = [];
        this.taskIdCounter = 0;
        this.currentPlan = [];
    }

    loadPlan(agentId, plan) {
        const agent = this.agentTasks.get(agentId);
        if (agent) {
            agent.todos = plan.map(task => ({
                id: this.generateTaskId(),
                description: task.description,
                status: 'pending',
                message: null,
                timestamp: new Date(),
                agentId,
                type: task.type || 'general'
            }));
            this.currentPlan = agent.todos;
            this.notify();
        }
    }

    getNextTask(agentId = null) {
        if (agentId) {
            const agent = this.agentTasks.get(agentId);
            if (!agent) return null;
            return agent.todos.find(task => task.status === 'pending');
        }
        return this.currentPlan.find(task => task.status === 'pending');
    }

    // Create a new AI agent instance with its own todo list
    createAgent(agentId, agentName, initialTasks = []) {
        const agentTodos = initialTasks.map(task => ({
            id: this.generateTaskId(),
            description: task.description,
            status: 'pending',
            message: null,
            timestamp: new Date(),
            agentId,
            type: task.type || 'general'
        }));
        
        this.agentTasks.set(agentId, {
            name: agentName,
            todos: agentTodos,
            status: 'idle',
            created: new Date()
        });
        
        this.notify();
        return agentId;
    }

    // Add dynamic task to specific agent
    addTask(agentId, description, type = 'general', parentTaskId = null) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) return null;
        
        const newTask = {
            id: this.generateTaskId(),
            description,
            status: 'pending',
            message: null,
            timestamp: new Date(),
            agentId,
            type,
            parentTaskId
        };
        
        agent.todos.push(newTask);
        this.notify();
        return newTask.id;
    }

    // Track Gemini API calls
    trackApiCall(agentId, taskId, apiType, endpoint, payload = null) {
        const callId = this.generateTaskId();
        const apiCall = {
            id: callId,
            agentId,
            taskId,
            apiType, // 'gemini-generate', 'gemini-analyze', etc.
            endpoint,
            payload,
            status: 'pending',
            startTime: new Date(),
            endTime: null,
            response: null,
            error: null,
            retryCount: 0
        };
        
        this.apiCalls.set(callId, apiCall);
        
        // Add API call as subtask
        this.addTask(agentId, `API Call: ${apiType}`, 'api-call', taskId);
        
        return callId;
    }

    // Update API call status
    updateApiCall(callId, status, response = null, error = null) {
        const apiCall = this.apiCalls.get(callId);
        if (!apiCall) return;
        
        apiCall.status = status;
        apiCall.endTime = new Date();
        apiCall.response = response;
        apiCall.error = error;
        
        if (status === 'failed' && apiCall.retryCount < 3) {
            apiCall.retryCount++;
            apiCall.status = 'retrying';
            setTimeout(() => {
                this.updateApiCall(callId, 'pending');
            }, 10000); // 10 second retry delay
        }
        
        // Update corresponding task
        const agent = this.agentTasks.get(apiCall.agentId);
        if (agent) {
            const task = agent.todos.find(t => t.parentTaskId === apiCall.taskId && t.type === 'api-call');
            if (task) {
                task.status = status === 'completed' ? 'completed' : status === 'failed' ? 'error' : 'in-progress';
                task.message = error ? error.message : response ? 'API call successful' : null;
            }
        }
        
        this.notify();
    }

    // Complete a task and optionally add follow-up tasks
    completeTask(agentId, taskId, message = null, followUpTasks = []) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) {
            console.warn(`⚠️ TaskManager.completeTask: Agent ${agentId} not found (likely reset)`);
            return;
        }
        
        const task = agent.todos.find(t => t.id === taskId);
        if (task) {
            task.status = 'completed';
            task.message = message;
            task.completedAt = new Date();
            
            // Clear timeout if set
            if (task.timeoutId) {
                clearTimeout(task.timeoutId);
                delete task.timeoutId;
            }
            
            console.log(`✅ TaskManager: Task ${taskId} completed for agent ${agentId}`);
            
            // Add follow-up tasks
            followUpTasks.forEach(followUp => {
                this.addTask(agentId, followUp.description, followUp.type || 'general', taskId);
            });
        } else {
            console.warn(`⚠️ TaskManager.completeTask: Task ${taskId} not found for agent ${agentId}`);
        }
        
        this.notify();
    }

    // Mark task as failed
    failTask(agentId, taskId, error) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) {
            console.warn(`⚠️ TaskManager.failTask: Agent ${agentId} not found`);
            return;
        }
        
        const task = agent.todos.find(t => t.id === taskId);
        if (task) {
            task.status = 'error';
            task.message = error.message || error;
            task.failedAt = new Date();
            
            // Clear timeout if set
            if (task.timeoutId) {
                clearTimeout(task.timeoutId);
                delete task.timeoutId;
            }
            
            console.error(`❌ TaskManager: Task ${taskId} failed for agent ${agentId}:`, error);
        } else {
            console.warn(`⚠️ TaskManager.failTask: Task ${taskId} not found for agent ${agentId}`);
        }
        
        agent.status = 'error';
        this.notify();
    }

    // Start working on next pending task
    startNextTask(agentId) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) {
            console.warn(`⚠️ TaskManager: Agent ${agentId} not found`);
            return null;
        }

        const nextTask = this.getNextTask(agentId);
        if (nextTask) {
            nextTask.status = 'in-progress';
            nextTask.startedAt = new Date();
            nextTask.timeoutId = this.setTaskTimeout(agentId, nextTask.id);
            agent.status = 'running';
            this.notify();
            this.executeTask(nextTask);
            return nextTask;
        }

        // No more pending tasks
        if (agent.todos.every(t => t.status === 'completed')) {
            agent.status = 'completed';
            console.log(`🎉 WorkflowManager: Agent ${agentId} completed all tasks`);
            this.notify();
        }

        return null;
    }

    async executeTask(task) {
        console.log(`🔄 TaskManager: Executing task ${task.id} (${task.type}): ${task.description}`);
        
        try {
            // Task execution dispatcher with proper completion logic
            switch (task.type) {
                case 'data-validation':
                    console.log(`Executing data validation: ${task.description}`);
                    await this.simulateWork(500);
                    this.completeTask(task.agentId, task.id, 'Data validation completed');
                    break;
                case 'exploratory-analysis':
                    console.log(`Executing exploratory analysis: ${task.description}`);
                    await this.simulateWork(1000);
                    this.completeTask(task.agentId, task.id, 'Exploratory analysis completed');
                    break;
                case 'visualization':
                    console.log(`Executing visualization: ${task.description}`);
                    await this.simulateWork(800);
                    this.completeTask(task.agentId, task.id, 'Visualization task completed');
                    break;
                case 'auto-analysis':
                    // Don't auto-complete this task - it will be completed manually when cards are built
                    console.log(`Started auto-analysis task: ${task.description} (will be completed during card building)`);
                    this.updateCurrentTaskMessage(task.agentId, task.id, 'Auto-analysis in progress, awaiting card generation');
                    return; // Don't complete automatically
                case 'erp-analysis':
                    // Don't auto-complete this task - it will be completed manually when ERP cards are built
                    console.log(`Started ERP-analysis task: ${task.description} (will be completed during card building)`);
                    this.updateCurrentTaskMessage(task.agentId, task.id, 'ERP analysis in progress, awaiting card generation');
                    return; // Don't complete automatically
                case 'init':
                case 'analysis':
                case 'ai-generation':
                case 'config':
                case 'rendering':
                case 'ai-explanation':
                case 'completion':
                    console.log(`Executing ${task.type} task: ${task.description}`);
                    await this.simulateWork(600);
                    // Check if agent and task still exist before completing (might be reset)
                    const agent = this.agentTasks.get(task.agentId);
                    const taskStillExists = agent && agent.todos.find(t => t.id === task.id);
                    if (taskStillExists) {
                        this.completeTask(task.agentId, task.id, `${task.type} task completed`);
                    } else {
                        console.log(`⏹️ TaskManager: Skipping completion for ${task.id} - task or agent was reset`);
                    }
                    break;
                default:
                    console.log(`Executing general task: ${task.description}`);
                    await this.simulateWork(500);
                    // Check if agent and task still exist before completing (might be reset)
                    const currentAgent = this.agentTasks.get(task.agentId);
                    const taskExists = currentAgent && currentAgent.todos.find(t => t.id === task.id);
                    if (taskExists) {
                        this.completeTask(task.agentId, task.id, 'Task completed successfully');
                    } else {
                        console.log(`⏹️ TaskManager: Skipping completion for ${task.id} - task or agent was reset`);
                    }
            }
        } catch (error) {
            console.error(`❌ TaskManager: Task ${task.id} failed:`, error);
            this.failTask(task.agentId, task.id, error);
        }
    }

    // Get agent progress statistics
    getAgentProgress(agentId) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) return null;
        
        const total = agent.todos.length;
        const completed = agent.todos.filter(t => t.status === 'completed').length;
        const failed = agent.todos.filter(t => t.status === 'error').length;
        const inProgress = agent.todos.filter(t => t.status === 'in-progress').length;
        
        return {
            total,
            completed,
            failed,
            inProgress,
            pending: total - completed - failed - inProgress,
            progress: total > 0 ? (completed / total) * 100 : 0
        };
    }

    // Set timeout for a task
    setTaskTimeout(agentId, taskId, timeoutMs = 300000) { // 5 minutes default
        return setTimeout(() => {
            console.warn(`⏰ TaskManager: Task ${taskId} timed out for agent ${agentId}`);
            this.failTask(agentId, taskId, new Error(`Task timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    }
    
    // Update task message
    updateCurrentTaskMessage(agentId, taskId, message) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) return;
        
        const task = agent.todos.find(t => t.id === taskId);
        if (task) {
            task.message = message;
            this.notify();
        }
    }
    
    // Helper for simulating async work
    async simulateWork(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    generateTaskId() {
        return `task_${++this.taskIdCounter}_${Date.now()}`;
    }

    subscribe(listener) {
        this.listeners.push(listener);
    }

    notify() {
        this.listeners.forEach(listener => {
            listener({
                agents: Array.from(this.agentTasks.entries()),
                apiCalls: Array.from(this.apiCalls.entries()),
                timestamp: new Date()
            });
        });
    }

    reset() {
        this.agentTasks.clear();
        this.apiCalls.clear();
        this.globalTasks = [];
        this.notify();
    }

    // Legacy compatibility - creates a simple workflow
    createLegacyWorkflow(mode) {
        const agentId = this.createAgent('main_agent', 'Data Analysis Agent', [
            { description: 'Initialize data analysis session', type: 'init' },
            { description: 'Profile and analyze data columns', type: 'analysis' },
            mode === 'auto' 
                ? { description: 'Generate intelligent chart recommendations', type: 'ai-generation' }
                : { description: 'Apply manual configuration settings', type: 'config' },
            { description: 'Render interactive charts and tables', type: 'rendering' },
            { description: 'Generate AI-powered explanations', type: 'ai-explanation' },
            { description: 'Finalize analysis workflow', type: 'completion' }
        ]);
        
        return agentId;
    }
}

export function createWorkflowManager(aiTasks) {
    let currentAgentId = null;
    let legacyMode = true; // For backward compatibility
    let lastStatus = null; // For debug logging
    
    return {
        // Legacy API compatibility
        subscribe(listener) {
            aiTasks.subscribe(listener);
        },

        reset(mode = 'auto') {
            // Clear any existing timeouts for old agents
            if (currentAgentId) {
                const oldAgent = aiTasks.agentTasks.get(currentAgentId);
                if (oldAgent) {
                    oldAgent.todos.forEach(task => {
                        if (task.timeoutId) {
                            clearTimeout(task.timeoutId);
                        }
                    });
                }
            }
            
            console.log(`🔄 WorkflowManager: Resetting workflow (mode: ${mode}), old agent: ${currentAgentId}`);
            aiTasks.reset();
            currentAgentId = aiTasks.createLegacyWorkflow(mode);
            console.log(`🔄 WorkflowManager: New agent created: ${currentAgentId}`);
            legacyMode = true;
        },

        start() {
            if (currentAgentId) {
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    agent.status = 'running';
                    aiTasks.startNextTask(currentAgentId);
                }
            }
        },

        completeTask(taskId, message = null, followUpTasks = []) {
            if (currentAgentId) {
                // In legacy mode, find task by description matching taskId
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    const task = agent.todos.find(t => t.type === taskId) || 
                                agent.todos.find(t => t.description.toLowerCase().includes(taskId.toLowerCase()));
                    if (task) {
                        console.log(`✅ WorkflowManager.completeTask: ${taskId} (${task.description})`);
                        aiTasks.completeTask(currentAgentId, task.id, message, followUpTasks);
                        const nextTask = aiTasks.startNextTask(currentAgentId);
                        if (!nextTask) {
                            console.log(`🎯 WorkflowManager: No more tasks for ${taskId}, checking completion...`);
                        }
                    } else {
                        console.warn(`⚠️ WorkflowManager.completeTask: Task not found: ${taskId}`);
                        console.log(`🔍 Available tasks:`, agent.todos.map(t => `${t.type}:${t.status}`));
                    }
                } else {
                    console.warn(`⚠️ WorkflowManager.completeTask: Agent not found for ${taskId}`);
                }
            } else {
                console.warn(`⚠️ WorkflowManager.completeTask: No current agent for ${taskId}`);
            }
        },

        fail(error, taskId = null) {
            if (currentAgentId) {
                if (taskId) {
                    const agent = aiTasks.agentTasks.get(currentAgentId);
                    if (agent) {
                        const task = agent.todos.find(t => 
                            t.description.toLowerCase().includes(taskId.toLowerCase()) ||
                            t.type === taskId
                        );
                        if (task) {
                            aiTasks.failTask(currentAgentId, task.id, error);
                        }
                    }
                } else {
                    // Fail current task
                    const agent = aiTasks.agentTasks.get(currentAgentId);
                    if (agent) {
                        const currentTask = agent.todos.find(t => t.status === 'in-progress');
                        if (currentTask) {
                            aiTasks.failTask(currentAgentId, currentTask.id, error);
                        }
                    }
                }
            }
        },

        cancel() {
            if (currentAgentId) {
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    agent.status = 'cancelled';
                    const currentTask = agent.todos.find(t => t.status === 'in-progress');
                    if (currentTask) {
                        currentTask.status = 'cancelled';
                    }
                    aiTasks.notify();
                }
            }
        },

        pause() {
            if (currentAgentId) {
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    agent.status = 'paused';
                    aiTasks.notify();
                }
            }
        },

        resume() {
            if (currentAgentId) {
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    agent.status = 'running';
                    aiTasks.notify();
                }
            }
        },

        getState() {
            if (!currentAgentId) {
                return { status: 'idle', tasks: [], currentTaskIndex: -1, error: null };
            }
            
            const agent = aiTasks.agentTasks.get(currentAgentId);
            if (!agent) {
                return { status: 'idle', tasks: [], currentTaskIndex: -1, error: null };
            }
            
            const currentTaskIndex = agent.todos.findIndex(t => t.status === 'in-progress');
            const hasError = agent.todos.some(t => t.status === 'error');
            const error = hasError ? agent.todos.find(t => t.status === 'error')?.message : null;
            
            const state = {
                status: agent.status,
                tasks: agent.todos.map(t => ({
                    id: t.type || t.id,
                    description: t.description,
                    status: t.status,
                    message: t.message
                })),
                currentTaskIndex,
                error: error ? new Error(error) : null
            };
            
            // Debug logging for state changes
            if (lastStatus !== agent.status) {
                console.log(`🔄 WorkflowManager state change: ${lastStatus || 'undefined'} → ${agent.status}`);
                lastStatus = agent.status;
            }
            
            return state;
        },

        updateCurrentTaskMessage(message) {
            if (currentAgentId) {
                const agent = aiTasks.agentTasks.get(currentAgentId);
                if (agent) {
                    let currentTask = agent.todos.find(t => t.status === 'in-progress');
                    
                    // If no in-progress task, try to start the next pending task
                    if (!currentTask) {
                        console.log(`🔄 WorkflowManager.updateCurrentTaskMessage: No in-progress task, trying to start next task`);
                        const nextTask = aiTasks.startNextTask(currentAgentId);
                        currentTask = nextTask;
                    }
                    
                    if (currentTask) {
                        currentTask.message = message;
                        console.log(`🔄 WorkflowManager: Updated task ${currentTask.type} message: ${message}`);
                        aiTasks.notify();
                    } else {
                        console.warn(`⚠️ WorkflowManager.updateCurrentTaskMessage: Still no in-progress task found`);
                        console.log(`🔍 Available tasks:`, agent.todos.map(t => `${t.type}:${t.status}`));
                    }
                }
            }
        },

        // New AI Agent Methods
        createAgent(name, initialTasks = []) {
            legacyMode = false;
            return aiTasks.createAgent(`agent_${Date.now()}`, name, initialTasks);
        },

        addTaskToAgent(agentId, description, type = 'general') {
            return aiTasks.addTask(agentId, description, type);
        },

        trackGeminiCall(agentId, taskId, apiType, endpoint, payload) {
            return aiTasks.trackApiCall(agentId, taskId, apiType, endpoint, payload);
        },

        updateGeminiCall(callId, status, response, error) {
            aiTasks.updateApiCall(callId, status, response, error);
        },

        getAgentProgress(agentId) {
            return aiTasks.getAgentProgress(agentId);
        },

        getCurrentAgentId() {
            return currentAgentId;
        }
    };
}