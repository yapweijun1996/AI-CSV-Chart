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

    getNextTask() {
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
        if (!agent) return;
        
        const task = agent.todos.find(t => t.id === taskId);
        if (task) {
            task.status = 'completed';
            task.message = message;
            task.completedAt = new Date();
            
            // Add follow-up tasks
            followUpTasks.forEach(followUp => {
                this.addTask(agentId, followUp.description, followUp.type || 'general', taskId);
            });
        }
        
        this.notify();
    }

    // Mark task as failed
    failTask(agentId, taskId, error) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) return;
        
        const task = agent.todos.find(t => t.id === taskId);
        if (task) {
            task.status = 'error';
            task.message = error.message || error;
            task.failedAt = new Date();
        }
        
        agent.status = 'error';
        this.notify();
    }

    // Start working on next pending task
    startNextTask(agentId) {
        const agent = this.agentTasks.get(agentId);
        if (!agent) return null;

        const nextTask = this.getNextTask();
        if (nextTask) {
            nextTask.status = 'in-progress';
            nextTask.startedAt = new Date();
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
        try {
            // Simple task execution dispatcher
            switch (task.type) {
                case 'data-validation':
                    // Placeholder for data validation logic
                    console.log(`Executing data validation: ${task.description}`);
                    break;
                case 'exploratory-analysis':
                    // Placeholder for exploratory analysis
                    console.log(`Executing exploratory analysis: ${task.description}`);
                    break;
                case 'visualization':
                    // Placeholder for visualization
                    console.log(`Executing visualization: ${task.description}`);
                    break;
                case 'auto-analysis':
                    // Don't auto-complete this task - it will be completed manually when cards are built
                    console.log(`Started auto-analysis task: ${task.description} (will be completed during card building)`);
                    return; // Don't complete automatically
                default:
                    console.log(`Executing general task: ${task.description}`);
            }
            // Simulate async work
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.completeTask(task.agentId, task.id, 'Task completed successfully.');
        } catch (error) {
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
            aiTasks.reset();
            currentAgentId = aiTasks.createLegacyWorkflow(mode);
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
                    const currentTask = agent.todos.find(t => t.status === 'in-progress');
                    if (currentTask) {
                        currentTask.message = message;
                        aiTasks.notify();
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