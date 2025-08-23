/**
 * @module key_manager
 * Manages API requests to the Gemini API, incorporating a retry mechanism
 * for handling rate limit errors (HTTP 429).
 */

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY = 1000; // 1 second base delay
const MAX_RETRY_DELAY = 30000; // 30 seconds max delay
const BACKOFF_MULTIPLIER = 2;

/**
 * Fetches content from the Gemini API with a built-in retry mechanism.
 *
 * @param {string} apiKey - The Gemini API key.
 * @param {string} model - The model to use (e.g., 'gemini-1.5-flash').
 * @param {string} prompt - The prompt to send to the model.
 * @param {function(string, string, number): void} showToast - A function to display toast notifications.
 * @returns {Promise<string>} A promise that resolves with the generated text content.
 * @throws {Error} Throws an error if the request fails after all retries.
 */
export async function fetchWithRetry(apiKey, model, prompt, showToast) {
  let attempt = 1;

  while (attempt <= MAX_RETRIES) {
    try {
      const language = localStorage.getItem('ai_language') || 'English';
      const finalPrompt = `${prompt}\n\nPlease respond in ${language}.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not extract explanation from API response.';
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt < MAX_RETRIES) {
          // Different delay strategies based on error type
          let delay;
          if (response.status === 429) {
            // Rate limiting: use exponential backoff with longer delays
            delay = Math.min(BASE_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt - 1), MAX_RETRY_DELAY);
          } else {
            // Service overloaded: shorter delays for faster recovery
            delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.5, attempt - 1), MAX_RETRY_DELAY / 2);
          }
          
          const jitter = Math.random() * 0.1 * delay;
          const totalDelay = delay + jitter;
          
          const statusText = response.status === 429 ? 'Rate limit exceeded' : 'Service temporarily overloaded';
          const retryReason = response.status === 429 ? 'quota limits' : 'high server load';
          
          console.warn(`${statusText} (${retryReason}). Retrying in ${Math.round(totalDelay)}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
          showToast(`${statusText}. Retrying in ${Math.round(totalDelay / 1000)} seconds...`, 'info', totalDelay);
          
          await new Promise(resolve => setTimeout(resolve, totalDelay));
          attempt++;
          continue;
        } else {
          const statusText = response.status === 429 ? 'rate limiting' : 'service unavailability';
          const errorCode = `HTTP ${response.status}`;
          throw new Error(`API request failed after ${MAX_RETRIES} retries due to ${statusText} (${errorCode}). Please try again later.`);
        }
      }

      // Handle other non-ok responses
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
      throw new Error(errorData.error.message);

    } catch (error) {
      // Categorize errors for different retry strategies
      const isNetworkError = error.name === 'TypeError' || error.message.includes('fetch');
      const isTimeoutError = error.message.includes('timeout') || error.code === 'ECONNRESET';
      
      if (attempt < MAX_RETRIES) {
        let delay;
        if (isTimeoutError) {
          // Timeout errors: use shorter delays
          delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.3, attempt - 1), MAX_RETRY_DELAY / 3);
        } else if (isNetworkError) {
          // Network errors: use moderate delays
          delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.7, attempt - 1), MAX_RETRY_DELAY / 2);
        } else {
          // Other errors: use full exponential backoff
          delay = Math.min(BASE_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt - 1), MAX_RETRY_DELAY);
        }
        
        const jitter = Math.random() * 0.1 * delay;
        const totalDelay = delay + jitter;
        
        const errorType = isTimeoutError ? 'Timeout' : isNetworkError ? 'Network' : 'Request';
        console.warn(`${errorType} error occurred. Retrying in ${Math.round(totalDelay)}ms... (Attempt ${attempt}/${MAX_RETRIES}) Error: ${error.message}`);
        showToast(`${errorType} error. Retrying in ${Math.round(totalDelay / 1000)} seconds...`, 'info', totalDelay);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        attempt++;
      } else {
        // Enhanced error context for final failure
        const enhancedError = new Error(`API request failed after ${MAX_RETRIES} attempts. Last error: ${error.message}`);
        enhancedError.originalError = error;
        enhancedError.attemptCount = attempt;
        throw enhancedError;
      }
    }
  }
  throw new Error(`API request failed after ${MAX_RETRIES} retry attempts. Please check your connection and try again.`);
}