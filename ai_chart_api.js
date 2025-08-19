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
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    attempt++;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Could not extract explanation from API response.';
      }

      if (response.status === 429 || response.status === 503) {
        if (attempt <= MAX_RETRIES) {
          const delay = Math.min(BASE_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt - 1), MAX_RETRY_DELAY);
          const jitter = Math.random() * 0.1 * delay;
          const totalDelay = delay + jitter;
          
          const statusText = response.status === 429 ? 'Rate limit' : 'Service overloaded';
          console.warn(`${statusText}. Retrying in ${Math.round(totalDelay)}ms... (Attempt ${attempt}/${MAX_RETRIES})`);
          showToast(`${statusText}. Retrying in ${Math.round(totalDelay / 1000)} seconds...`, 'info', totalDelay);
          
          await new Promise(resolve => setTimeout(resolve, totalDelay));
          continue; // Continue to the next iteration to retry
        } else {
          const statusText = response.status === 429 ? 'rate limiting' : 'service unavailability';
          throw new Error(`The request failed after ${MAX_RETRIES} retries due to ${statusText}.`);
        }
      }

      // Handle other non-ok responses
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
      throw new Error(errorData.error.message);

    } catch (error) {
      if (attempt <= MAX_RETRIES) {
        const delay = Math.min(BASE_RETRY_DELAY * Math.pow(BACKOFF_MULTIPLIER, attempt - 1), MAX_RETRY_DELAY);
        const jitter = Math.random() * 0.1 * delay;
        const totalDelay = delay + jitter;
        
        console.warn(`Request failed. Retrying in ${Math.round(totalDelay)}ms... (Attempt ${attempt}/${MAX_RETRIES}) Error: ${error.message}`);
        showToast(`Request failed. Retrying in ${Math.round(totalDelay / 1000)} seconds...`, 'info', totalDelay);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      } else {
        throw error; // Rethrow the last error after all retries have failed
      }
    }
  }
  throw new Error('The request failed after all retry attempts.');
}