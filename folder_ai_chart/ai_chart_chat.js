// ========= AI Analysis Chat Module =========

// Import dependencies from other modules
import { fetchWithRetry } from './ai_chart_api.js';
import { isValidApiKey } from './ai_chart_ai_settings_handlers.js';
import { getUiSnapshot } from './ai_chart_ui.js';
import { getClientContextPrompt } from './ai_chart_context.js';

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
        // Try multiple ways to detect chart data - use official Chart.js API first
        const chartInstance = window.Chart?.getChart(canvas) || canvas.chart || canvas._chartInstance;
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
  if (window.currentHistoryId && typeof window.Store !== 'undefined') {
    try {
      console.log('💾 Auto-saving chat message to history...');
      window.Store.updateHistory(window.currentHistoryId, { 
        uiSnapshot: getUiSnapshot(), 
        updatedAt: Date.now() 
      }).then(() => {
        console.log('✅ Chat message auto-saved successfully');
      }).catch(error => {
        console.warn('Failed to auto-save chat message:', error);
      });
    } catch (error) {
      console.warn('Failed to auto-save chat message:', error);
    }
  } else {
    console.warn('⚠️ Cannot auto-save chat: missing currentHistoryId or Store', {
      hasHistoryId: !!window.currentHistoryId,
      hasStore: typeof window.Store !== 'undefined'
    });
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
You speak with me in a polished, authoritative, and business-oriented tone, as if briefing the CEO in conversation.
Avoid starting responses with generic greetings like "Good morning", "Hello", or "Hi".

${getClientContextPrompt()}

Tone:
- Executive-level: confident, concise, and professional.  
- Conversational: natural back-and-forth, not just long reports.  
- Action-oriented: highlight what matters for leadership.  
- Polished: maintain professionalism, but keep it interactive.  

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
Engage in a conversational executive briefing.  
- Answer my question directly with clear insights.  
- Highlight the most relevant perspectives based on the dataset. This could include ERP, CRM, finance, operations, customer behavior, or general analytics, depending on what the data supports. 
- If a perspective (ERP/CRM/etc.) is not applicable, skip it and focus on the most meaningful insights and business implications. 
- Always adapt your analysis dynamically to the dataset content, emphasizing what is actionable for decision-making.
- Keep responses concise (1–10 short paragraphs or bullets).  
- If helpful, ask me follow-up questions to clarify priorities or next steps.  
- Always sound polished and professional, like an executive aide in discussion. 

Format:
- structured paragraphs (executive briefing style).  
- Use markdown for readability.  
- Quote specific numbers when possible.  
- Keep the focus on decision-making impact.
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
      if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
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
    
    // Additional auto-save as backup to ensure AI responses are preserved
    setTimeout(() => {
      if (window.currentHistoryId && typeof window.Store !== 'undefined') {
        console.log('💾 Backup auto-save after AI response...');
        window.Store.updateHistory(window.currentHistoryId, { 
          uiSnapshot: getUiSnapshot(), 
          updatedAt: Date.now() 
        }).catch(error => {
          console.warn('Failed backup auto-save after AI response:', error);
        });
      }
    }, 1000); // 1 second delay to ensure the message was fully processed

  } catch (error) {
    console.error('Chat error:', error);
    hideTypingIndicator();
    addChatMessage(`Error: ${error.message}`, false);
    
    // Backup auto-save for error messages too
    setTimeout(() => {
      if (window.currentHistoryId && typeof window.Store !== 'undefined') {
        console.log('💾 Backup auto-save after error message...');
        window.Store.updateHistory(window.currentHistoryId, { 
          uiSnapshot: getUiSnapshot(), 
          updatedAt: Date.now() 
        }).catch(error => {
          console.warn('Failed backup auto-save after error message:', error);
        });
      }
    }, 1000);
  }
}

// Initialize chat functionality
function initializeChat() {
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
      if (typeof window.showToast === 'function') {
        window.showToast('Context refreshed successfully!');
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
      if (window.currentHistoryId && typeof window.Store !== 'undefined') {
        try {
          console.log('💾 Auto-saving cleared chat state...');
          window.Store.updateHistory(window.currentHistoryId, { 
            uiSnapshot: getUiSnapshot(), 
            updatedAt: Date.now() 
          }).then(() => {
            console.log('✅ Cleared chat state auto-saved successfully');
          }).catch(error => {
            console.warn('Failed to auto-save cleared chat:', error);
          });
        } catch (error) {
          console.warn('Failed to auto-save cleared chat:', error);
        }
      }
      
      if (typeof window.showToast === 'function') {
        window.showToast('Chat history cleared!');
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
function refreshChatUI() {
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
}

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
        initializeChat();
      }
    }, 500);
    
    return result;
  };
}

// Initialize chat on page load if data exists
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.currentData && window.currentData.length > 0) {
      initializeChat();
    }
  }, 1000);
});

// Export the main functions that need to be accessible
window.initializeChat = initializeChat;
window.refreshChatUI = refreshChatUI;

export { initializeChat, refreshChatUI };