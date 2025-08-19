// AI Settings Handlers
// Note: This module assumes the existence of global functions like $, showToast,
// and that the DOM structure from index.html is present.

let $;
let showToast;

export function openAiSettings() {
  const modal = $('#aiSettingsModal');
  const apiKeyInput = $('#apiKeyInput');
  const modelSelect = $('#modelSelect');
  const languageSelect = $('#languageSelect');
  const testResult = $('#testResult');
  
  // Load saved API key, model, and language
  const savedKey = localStorage.getItem('gemini_api_key');
  const savedModel = localStorage.getItem('gemini_model') || 'gemini-1.5-flash';
  const savedLanguage = localStorage.getItem('ai_language') || 'English';
  
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
  modelSelect.value = savedModel;
  languageSelect.value = savedLanguage;
  
  // Hide test result
  testResult.style.display = 'none';
  
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

        localStorage.setItem('gemini_api_key', apiKey);
        localStorage.setItem('gemini_model', model);
        localStorage.setItem('ai_language', language);
        showToast('AI settings saved successfully!', 'success');
        $('#aiSettingsModal').classList.remove('open');
    };

    $('#clearApiKeyBtn').onclick = () => {
        localStorage.removeItem('gemini_api_key');
        localStorage.removeItem('gemini_model');
        localStorage.removeItem('ai_language');
        $('#apiKeyInput').value = '';
        $('#modelSelect').value = 'gemini-1.5-flash';
        $('#languageSelect').value = 'English';
        $('#testResult').style.display = 'none';
        showToast('AI settings cleared.', 'success');
    };
}