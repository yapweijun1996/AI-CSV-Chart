// AI Settings Handlers
// Note: This module assumes the existence of global functions like $, showToast,
// and that the DOM structure from index.html is present.

let $;
let showToast;

export function isValidApiKey(val) {
    if (val == null) return false;
    const s = String(val).trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (lower === 'null' || lower === 'undefined') return false;
    if (s.length < 8) return false;
    return true;
}

// Ensure display rules use isValidApiKey in downstream modules as well
export function updateAIFeaturesVisibility() {
    const apiKey = localStorage.getItem('gemini_api_key');
    const hasValidKey = isValidApiKey(apiKey);
    const aiWorkflowSection = document.getElementById('ai-todo-list-section');
    const aiAnalysisSection = document.getElementById('ai-analysis-section');
    const aiSummarySection = document.getElementById('ai-summary-section');

    // Toggle AI workflow, analysis, and summary sections
    if (aiWorkflowSection) {
        aiWorkflowSection.style.display = hasValidKey ? 'block' : 'none';
    }
    if (aiAnalysisSection) {
        aiAnalysisSection.style.display = hasValidKey ? 'block' : 'none';
    }
    if (aiSummarySection) {
        aiSummarySection.style.display = hasValidKey ? 'block' : 'none';
    }

    // Toggle "AI Agent" option in main Mode selector
    const modeSelect = document.getElementById('mode');
    let aiAgentOption = null;
    if (modeSelect) {
        aiAgentOption = modeSelect.querySelector('option[value="ai_agent"]');
    }
    if (aiAgentOption) {
        aiAgentOption.style.display = hasValidKey ? '' : 'none';
        // If currently selected but no valid key, fallback to Auto and trigger change
        if (!hasValidKey && modeSelect && modeSelect.value === 'ai_agent') {
            modeSelect.value = 'auto';
            try {
                modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
        }
    }

    // Toggle "AI Agent" option in Default Generate Mode selector (AI Settings)
    const defaultModeSelect = document.getElementById('defaultModeSelect');
    let defaultAiOption = null;
    if (defaultModeSelect) {
        defaultAiOption = defaultModeSelect.querySelector('option[value="ai_agent"]');
    }
    if (defaultAiOption) {
        defaultAiOption.style.display = hasValidKey ? '' : 'none';
        // If preference was ai_agent but key is missing/invalid, reset preference to auto
        if (!hasValidKey) {
            try {
                if (localStorage.getItem('default_generate_mode') === 'ai_agent') {
                    localStorage.setItem('default_generate_mode', 'auto');
                }
            } catch {}
            if (defaultModeSelect) defaultModeSelect.value = 'auto';
        }
    }
}

export function openAiSettings() {
  const modal = $('#aiSettingsModal');
  const apiKeyInput = $('#apiKeyInput');
  const modelSelect = $('#modelSelect');
  const languageSelect = $('#languageSelect');
  const testResult = $('#testResult');
  
  // Load saved API key, model, and language
  const savedKey = localStorage.getItem('gemini_api_key');
  const savedModel = localStorage.getItem('gemini_model') || 'gemini-2.5-flash';
  const savedLanguage = localStorage.getItem('ai_language') || 'English';
  
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
  modelSelect.value = savedModel;
  languageSelect.value = savedLanguage;
  
  // Hide test result
  testResult.style.display = 'none';

// Load saved Default Generate Mode
const defaultModeSelect = document.getElementById('defaultModeSelect');
if (defaultModeSelect) {
  const savedDefaultMode = localStorage.getItem('default_generate_mode') || 'auto';
  defaultModeSelect.value = savedDefaultMode;
}
  
  modal.classList.add('open');
  modal.focus();
}

export async function testGeminiAPI() {
  const apiKey = $('#apiKeyInput').value.trim();
  const model = $('#modelSelect').value;
  const testResult = $('#testResult');
  const testBtn = $('#testApiBtn');
  
  if (!apiKey) {
    showToast('Please enter an API key first.', 'error');
    return;
  }
  
  // Show loading state
  testBtn.disabled = true;
  testBtn.textContent = '🔄 Testing...';
  testResult.style.display = 'block';
  testResult.innerHTML = '<div style="color: var(--muted);">Testing API connection...</div>';
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: 'Hello, respond with just "API test successful"' }]
        }]
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      testResult.innerHTML = '<div style="color: #059669; background: #ecfdf5; border: 1px solid #a7f3d0;">✅ API connection successful! Model is alive and responding.</div>';
      showToast('API test successful!', 'success');
    } else {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || `HTTP ${response.status}`;
      testResult.innerHTML = `<div style="color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;">❌ API test failed: ${errorMsg}</div>`;
      showToast('API test failed. Check your key and model selection.', 'error');
    }
  } catch (error) {
    testResult.innerHTML = '<div style="color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;">❌ Network error. Check your internet connection.</div>';
    showToast('Network error during API test.', 'error');
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '🧪 Test API Connection';
  }
}

export function initializeAiSettingsHandlers(dependencies) {
    $ = dependencies.$;
    showToast = dependencies.showToast;

    $('#aiSettingsBtn').onclick = openAiSettings;
    $('#closeAiSettingsModal').onclick = () => $('#aiSettingsModal').classList.remove('open');
    $('#testApiBtn').onclick = testGeminiAPI;

    $('#saveApiKeyBtn').onclick = () => {
        const apiKey = $('#apiKeyInput').value.trim();
        const model = $('#modelSelect').value;
        const language = $('#languageSelect').value;
        const defaultModeSelect = document.getElementById('defaultModeSelect');
        const defaultMode = defaultModeSelect ? defaultModeSelect.value : 'auto';

        localStorage.setItem('gemini_api_key', apiKey);
        localStorage.setItem('gemini_model', model);
        localStorage.setItem('ai_language', language);
        localStorage.setItem('default_generate_mode', defaultMode);

        showToast('AI settings saved successfully!', 'success');
        $('#aiSettingsModal').classList.remove('open');
        updateAIFeaturesVisibility();
        // Notify listeners that settings changed (e.g., summary/logic can react)
        try { window.dispatchEvent(new StorageEvent('storage', { key: 'default_generate_mode', newValue: defaultMode })); } catch(e) {}
        try { document.dispatchEvent(new CustomEvent('apiKeySaved')); } catch(e) {}
    };

    $('#clearApiKeyBtn').onclick = () => {
        localStorage.removeItem('gemini_api_key');
        localStorage.removeItem('gemini_model');
        localStorage.removeItem('ai_language');
        localStorage.removeItem('default_generate_mode');

        $('#apiKeyInput').value = '';
        $('#modelSelect').value = 'gemini-2.5-flash';
        $('#languageSelect').value = 'English';

        const defaultModeSelect = document.getElementById('defaultModeSelect');
        if (defaultModeSelect) defaultModeSelect.value = 'auto';

        $('#testResult').style.display = 'none';
        showToast('AI settings cleared.', 'success');

        // Notify listeners that default mode preference was cleared
        try { window.dispatchEvent(new StorageEvent('storage', { key: 'default_generate_mode', newValue: null })); } catch(e) {}
        updateAIFeaturesVisibility();
        try { document.dispatchEvent(new CustomEvent('apiKeySaved')); } catch(e) {}
    };
}