// AI Chart Engine: Core logic for parsing, aggregation, and API handling.

const stripBOM = s => (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s;

// Enhanced Gemini API integration with task tracking
function createGeminiAPIWrapper() {
    const originalFetch = window.fetch;
    
    return {
        async callGemini(agentId, taskId, endpoint, payload, apiType = 'gemini-generate') {
            // This function's dependency on WorkflowManager will be handled in the UI file
            // For now, we provide a basic fetch implementation.
            // The UI will pass its WorkflowManager instance or a callback.
            console.warn('GeminiAPI.callGemini is a placeholder in the engine. The UI must provide tracking hooks.');
            
            try {
                const response = await originalFetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return await response.json();
                
            } catch (error) {
                console.error('Gemini API call failed:', error);
                throw error;
            }
        }
    };
}

export const GeminiAPI = createGeminiAPIWrapper();

// Enhanced Workflow Timer
export class WorkflowTimer {
    constructor() {
        this.startTime = null;
        this.intervalId = null;
        this.callbacks = [];
    }

    start() {
        this.startTime = Date.now();
        this.intervalId = setInterval(() => {
            const elapsed = this.getElapsed();
            this.callbacks.forEach(callback => callback(elapsed));
        }, 1000);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    getElapsed() {
        if (!this.startTime) return '00:00:00';
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const hours = Math.floor(elapsed / 3600);
        const minutes = Math.floor((elapsed % 3600) / 60);
        const seconds = elapsed % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    onUpdate(callback) {
        this.callbacks.push(callback);
    }

    getEstimatedTimeRemaining(currentTaskIndex, totalTasks) {
        if (!this.startTime || currentTaskIndex <= 0) return null;
        
        const elapsedMs = Date.now() - this.startTime;
        const avgTimePerTask = elapsedMs / (currentTaskIndex + 1);
        const remainingTasks = totalTasks - currentTaskIndex - 1;
        const estimatedRemainingMs = avgTimePerTask * remainingTasks;
        
        if (estimatedRemainingMs <= 0) return null;
        
        const minutes = Math.floor(estimatedRemainingMs / 60000);
        const seconds = Math.floor((estimatedRemainingMs % 60000) / 1000);
        
        if (minutes > 0) {
            return `~${minutes}m ${seconds}s remaining`;
        } else {
            return `~${seconds}s remaining`;
        }
    }

    reset() {
        this.stop();
        this.startTime = null;
        this.callbacks = [];
    }
}

// Enhanced API Retry Logic
export class EnhancedAPIHandler {
    constructor() {
        this.maxRetries = 5;
        this.baseDelay = 1000;
        this.maxDelay = 30000;
        this.backoffMultiplier = 2;
    }

    async fetchWithExponentialBackoff(url, options, attempt = 1) {
        try {
            const response = await fetch(url, options);
            
            if (response.status === 503 || response.status === 429) {
                throw new Error(`Server overloaded (${response.status}): ${response.statusText}`);
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error) {
            if (attempt >= this.maxRetries) {
                throw new Error(`Max retries (${this.maxRetries}) exceeded: ${error.message}`);
            }
            
            const delay = Math.min(this.baseDelay * Math.pow(this.backoffMultiplier, attempt - 1), this.maxDelay);
            const jitter = Math.random() * 0.1 * delay;
            const totalDelay = delay + jitter;
            
            console.warn(`Request failed (attempt ${attempt}/${this.maxRetries}). Retrying in ${Math.round(totalDelay)}ms... Error: ${error.message}`);
            
            await new Promise(resolve => setTimeout(resolve, totalDelay));
            return this.fetchWithExponentialBackoff(url, options, attempt + 1);
        }
    }
}

// Global instances
export const workflowTimer = new WorkflowTimer();
export const apiHandler = new EnhancedAPIHandler();


/* ========= parsing with smart delimiter + worker + progress ========= */
async function sniffText(file, bytes=256*1024){ const blob = await file.slice(0, bytes).text(); return stripBOM(blob || ''); }
function tryParsePreview(text, opt){
  return Papa.parse(text, { header: !!opt.header, preview: 25, skipEmptyLines: 'greedy', delimiter: opt.delimiter ?? "", quoteChar: '"', escapeChar: '"' });
}
function countNonEmptyCells(row){
  if (!Array.isArray(row)) return 0;
  let count = 0;
  for (const value of row){
    if (value == null) continue;
    if (String(value).trim() === '') continue;
    count++;
  }
  return count;
}
function estimateFieldCount(line, delimiter){
  if (!line || !delimiter) return 0;
  try {
    const parsed = Papa.parse(line, { header:false, delimiter, dynamicTyping:false, skipEmptyLines:false, quoteChar:'"', escapeChar:'"' });
    if (!parsed || !Array.isArray(parsed.data) || !parsed.data.length) return 0;
    return countNonEmptyCells(parsed.data[0]);
  } catch (e) {
    console.warn('estimateFieldCount failed:', e);
    return 0;
  }
}
async function prepareFileForParsing(file, delimiter){
  try {
    if (!file || !file.size || !delimiter) return { fileToParse: file, skippedRows: 0, leadingLines: [] };
    const headText = await sniffText(file);
    if (!headText) return { fileToParse: file, skippedRows: 0, leadingLines: [] };
    const newline = headText.includes('\r\n') ? '\r\n' : '\n';
    const lines = headText.split(/\r?\n/);
    let skipLines = 0;
    const leadingLines = [];
    let headerDetected = false;
    for (let i = 0; i < lines.length; i++){
      const rawLine = lines[i];
      if (rawLine == null) break;
      const trimmed = String(rawLine).trim();
      if (trimmed === '') {
        leadingLines.push(rawLine);
        skipLines++;
        continue;
      }
      const fieldCount = estimateFieldCount(rawLine, delimiter);
      if (fieldCount >= 2) {
        headerDetected = true;
        break;
      }
      leadingLines.push(rawLine);
      skipLines++;
    }
    if (!headerDetected || skipLines === 0) return { fileToParse: file, skippedRows: 0, leadingLines: [] };
    const headerLine = lines[skipLines] ?? '';
    if (estimateFieldCount(headerLine, delimiter) < 2) return { fileToParse: file, skippedRows: 0, leadingLines: [] };
    const prefixText = leadingLines.join(newline) + newline;
    const bytesToSkip = new Blob([prefixText]).size;
    if (!bytesToSkip || bytesToSkip >= file.size) return { fileToParse: file, skippedRows: 0, leadingLines: [] };
    const trimmedBlob = file.slice(bytesToSkip);
    const trimmedFile = new File([trimmedBlob], file.name, { type: file.type, lastModified: file.lastModified });
    return { fileToParse: trimmedFile, skippedRows: skipLines, leadingLines };
  } catch (e) {
    console.warn('prepareFileForParsing failed:', e);
    return { fileToParse: file, skippedRows: 0, leadingLines: [] };
  }
}
function scorePreview(res){ const rows = res.data || []; const lens = rows.map(r => Array.isArray(r) ? r.length : (typeof r==='object' ? Object.keys(r).length : 0)); const modal = lens.length ? mode(lens) : 0; const err = (res.errors || []).length; return { modalCols: modal, errors: err }; }
function mode(arr){ const m=new Map(); let best=0, v=0; for(const x of arr){const c=(m.get(x)||0)+1; m.set(x,c); if(c>best){best=c; v=x}} return v; }
async function autoDetect(file, header=true){
  const text = await sniffText(file);
  const candidates = [",",";","\t","|"];
  let best = { delimiter:",", score:{modalCols:0, errors:Infinity} };
  for (const d of candidates){
    const res = tryParsePreview(text, { delimiter:d, header });
    const s = scorePreview(res);
    const better = (s.modalCols > best.score.modalCols) || (s.modalCols===best.score.modalCols && s.errors < best.score.errors);
    if (better) best = { delimiter:d, score:s };
  }
  return best;
}
export async function parseCSV(file, delimiterChoice, header=true, onProgress = null){
  if (!file || !file.size) {
    throw new Error('No file selected or file is empty');
  }
  
  let delimiter = ",";
  if (delimiterChoice === 'auto'){
    try {
      const autod = await autoDetect(file, header);
      delimiter = autod.delimiter;
    } catch (err) {
      console.warn('Auto-detection failed, using comma:', err);
      delimiter = ",";
    }
  } else {
    delimiter = (delimiterChoice === '\t' || delimiterChoice === '	') ? '	' : delimiterChoice;
  }

  let parseTarget = file;
  let skippedRowsInfo = { skippedRows: 0, leadingLines: [] };
  if (header) {
    try {
      const prep = await prepareFileForParsing(file, delimiter);
      parseTarget = prep.fileToParse || file;
      skippedRowsInfo = {
        skippedRows: prep.skippedRows || 0,
        leadingLines: Array.isArray(prep.leadingLines) ? prep.leadingLines : []
      };
      if (skippedRowsInfo.skippedRows > 0) {
        onProgress?.({ type: 'meta', text: `Skipping ${skippedRowsInfo.skippedRows} leading metadata row(s)…` });
        console.log('Detected leading metadata rows to skip:', skippedRowsInfo);
      }
    } catch (trimErr) {
      console.warn('prepareFileForParsing failed, continuing without trimming:', trimErr);
      parseTarget = file;
      skippedRowsInfo = { skippedRows: 0, leadingLines: [] };
    }
  }

  onProgress?.({ type: 'meta', text: `Parsing… (worker) delim="${delimiter}"` });
  console.log('Starting parse with config:', { customWorker: true, header, delimiter, fileSize: file.size, parseSize: parseTarget.size, fileName: file.name });
  
  return new Promise((resolve,reject)=>{
    let rowCount = 0;
    let hasCalledComplete = false;
    let isUsingWorker = true;
    const collectedRows = [];
    
    const timeout = setTimeout(() => {
      if (!hasCalledComplete) {
        console.error('Parse timeout - no response from parser (non-fatal, will rely on internal fallbacks)');
      }
    }, 30000);
    
    const completeHandler = (results)=>{
      if (hasCalledComplete) {
        console.warn('Complete callback called multiple times, ignoring');
        return;
      }
      hasCalledComplete = true;
      clearTimeout(timeout);
      
      console.log('Parse complete callback received:', results, 'isUsingWorker:', isUsingWorker);
      
      try {
        if (!results) {
          if (isUsingWorker) {
            console.log('Worker returned undefined, trying non-worker fallback...');
            hasCalledComplete = false;
            isUsingWorker = false;
            
            const fallbackConfig = { 
              worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
              quoteChar:'"', escapeChar:'"',
              step: (results)=>{
                rowCount++;
                if (results && 'data' in results) collectedRows.push(results.data);
                if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
              },
              complete: completeHandler,
              error: errorHandler
            };
            
            try {
              Papa.parse(parseTarget, fallbackConfig);
              return;
            } catch (fallbackErr) {
              console.error('Fallback parse failed to start:', fallbackErr);
              reject(new Error('Both worker and non-worker parsing failed to start'));
              return;
            }
          }
          
          reject(new Error('Parser returned no result - both worker and non-worker modes failed'));
          return;
        }
        
        if (typeof results !== 'object') {
          reject(new Error('Parser returned invalid result type: ' + typeof results));
          return;
        }
        
        let data = (results.data && Array.isArray(results.data)) ? results.data : [];
        let meta = (results.meta && typeof results.meta === 'object') ? results.meta : {};
        let errors = (results.errors && Array.isArray(results.errors)) ? results.errors : [];
        if (!data.length && collectedRows.length) {
          data = collectedRows;
        }
        if (!meta || typeof meta !== 'object') meta = {};
        if (!('delimiter' in meta)) meta.delimiter = delimiter;
        if (skippedRowsInfo.skippedRows > 0) {
          meta.skippedRows = skippedRowsInfo.skippedRows;
          if (!meta.leadingRows || !Array.isArray(meta.leadingRows)) {
            meta.leadingRows = skippedRowsInfo.leadingLines.slice();
          }
        }
        
        onProgress?.({ type: 'meta', text: `Parsed ${data.length.toLocaleString()} rows` });
        
        if (errors.length > 0) {
          console.warn('Parse errors:', errors);
          if (!data.length) {
            reject(new Error(errors[0]?.message || 'Parse failed with errors'));
            return;
          }
        }
        
        if (!data.length) {
          reject(new Error('No rows parsed - check file format and delimiter'));
          return;
        }
        
        // Pass-through worker-provided detection result and preview when available
        const detectionResult = results.detectionResult || null;
        const preview = results.preview || null;
        resolve({ data, meta, errors, detectionResult, preview });
      } catch (err) {
        console.error('Error in complete callback:', err);
        reject(new Error('Error processing parse results: ' + (err.message || err)));
      }
    };
    
    const errorHandler = (err, file, inputElem, reason)=>{
      clearTimeout(timeout);
      console.error('PapaParse error callback:', { err, file, inputElem, reason });
      reject(err || new Error(reason || 'Unknown parse error'));
    };

    try {
      const workerUrl = new URL('./ai_chart_parser_worker.js', import.meta.url);
      if (window.VERSION) {
        workerUrl.searchParams.set('v', window.VERSION);
      }
      const worker = new Worker(workerUrl);
      isUsingWorker = true;
      const workerTimeout = setTimeout(()=>{
        console.error('Worker timeout - switching to non-worker fallback');
        try{ worker.terminate(); }catch{}
        const fallbackConfig = {
          worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
          quoteChar:'"', escapeChar:'"',
          step: (results)=>{
            rowCount++;
            if (results && 'data' in results) collectedRows.push(results.data);
            if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
          },
          complete: completeHandler,
          error: errorHandler
        };
        try{ Papa.parse(parseTarget, fallbackConfig); }catch(fallbackErr){
          console.error('Fallback parse failed to start after worker timeout:', fallbackErr);
          reject(new Error('Both worker and non-worker parsing failed to start'));
        }
      }, 30000);
      
      worker.onmessage = (e)=>{
        clearTimeout(workerTimeout);
        if (!e || !e.data){
          console.warn('Worker sent empty message; falling back');
          const fallbackConfig = {
            worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
            quoteChar:'"', escapeChar:'"',
            step: (results)=>{
              rowCount++;
              if (results && 'data' in results) collectedRows.push(results.data);
              if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
            },
            complete: completeHandler,
            error: errorHandler
          };
          try{ Papa.parse(parseTarget, fallbackConfig); }catch(fallbackErr){
            console.error('Fallback parse failed to start:', fallbackErr);
            reject(new Error('Both worker and non-worker parsing failed to start'));
          }
          return;
        }
        const msg = e.data;
        if (msg.error){
          console.warn('Worker error:', msg.message);
          const fallbackConfig = {
            worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
            quoteChar:'"', escapeChar:'"',
            step: (results)=>{
              rowCount++;
              if (results && 'data' in results) collectedRows.push(results.data);
              if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
            },
            complete: completeHandler,
            error: errorHandler
          };
          try{ Papa.parse(parseTarget, fallbackConfig); }catch(fallbackErr){
            console.error('Fallback parse failed to start:', fallbackErr);
            reject(new Error('Both worker and non-worker parsing failed to start'));
          }
          return;
        }
        if ('progress' in msg){
          onProgress?.({ type: 'meta', text: `Parsing… ${Number(msg.progress||0).toLocaleString()} rows (worker)` });
          return;
        }
        try{
          const results = {
            data: Array.isArray(msg.data)?msg.data:[],
            meta: msg.meta||{},
            errors: Array.isArray(msg.errors)?msg.errors:[],
            detectionResult: ('detectionResult' in msg) ? msg.detectionResult : null,
            preview: ('preview' in msg) ? msg.preview : null
          };
          completeHandler(results);
        } finally {
          try{ worker.terminate(); }catch{}
        }
      };
      
      worker.onerror = (err)=>{
        clearTimeout(workerTimeout);
        console.error('Worker onerror:', err?.message || err);
        const fallbackConfig = {
          worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
          quoteChar:'"', escapeChar:'"',
          step: (results)=>{
            rowCount++;
            if (results && 'data' in results) collectedRows.push(results.data);
            if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
          },
          complete: completeHandler,
          error: errorHandler
        };
        try{ Papa.parse(parseTarget, fallbackConfig); }catch(fallbackErr){
          console.error('Fallback parse failed to start after worker error:', fallbackErr);
          reject(new Error('Both worker and non-worker parsing failed to start'));
        }
      };
      
      const workerConfig = {
        header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
        quoteChar:'"', escapeChar:'"'
      };
      worker.postMessage({ file: parseTarget, config: workerConfig });
    } catch (err) {
      clearTimeout(timeout);
      console.error('Error starting custom worker:', err);
      const fallbackConfig = {
        worker: false, header, skipEmptyLines:'greedy', dynamicTyping:false, delimiter,
        quoteChar:'"', escapeChar:'"',
        step: (results)=>{
          rowCount++;
          if (results && 'data' in results) collectedRows.push(results.data);
          if ((rowCount % 1000)===0) onProgress?.({ type: 'meta', text: `Parsing… ${rowCount.toLocaleString()} rows (fallback)` });
        },
        complete: completeHandler,
        error: errorHandler
      };
      try{ Papa.parse(parseTarget, fallbackConfig); }catch(fallbackErr){
        console.error('Fallback parse failed to start after worker constructor error:', fallbackErr);
        reject(new Error('Both worker and non-worker parsing failed to start'));
      }
    }
  });
}

export async function workerAggregateWithFallback(rows, profile, plan, timeoutMs = 15000, onProgress = null) {
  const localAggregate = () => {
    onProgress?.({ stage: 'fallback', info: 'Executing local fallback for aggregation.' });
    console.log('Executing local fallback for aggregation.');
    return plan.jobs.map(j => groupAgg(rows, j.groupBy, j.metric, j.agg, j.dateBucket || '', { mode: 'share', value: 0 }, true, profile));
  };

  if (typeof Worker === 'undefined') {
    console.warn('Worker not supported, falling back to main thread.');
    return localAggregate();
  }

  let w;
  try {
    const workerUrl = new URL('./ai_chart_parser_worker.js', import.meta.url);
    if (window.VERSION) {
      workerUrl.searchParams.set('v', window.VERSION);
    }
    w = new Worker(workerUrl);
    onProgress?.({ stage: 'worker-start', info: 'Aggregation worker started.' });
  } catch (e) {
    console.warn('Worker creation failed:', e);
    onProgress?.({ stage: 'fallback', info: 'Could not start worker, falling back to main thread.' });
    return localAggregate();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { w.terminate(); } catch {}
      console.warn('Worker timed out, falling back to main thread.');
      onProgress?.({ stage: 'fallback', info: 'Worker timed out — falling back to main thread.' });
      resolve(localAggregate());
    }, timeoutMs);

    w.onmessage = (e) => {
      clearTimeout(timer);
      if (e.data && !e.data.error) {
        onProgress?.({ stage: 'done', info: 'Worker aggregation complete.' });
        resolve(e.data.aggregated);
      } else {
        console.warn('Worker returned an error, falling back:', e.data?.message || 'worker error');
        onProgress?.({ stage: 'fallback', info: 'Worker failed — falling back to main thread.' });
        resolve(localAggregate());
      }
      try { w.terminate(); } catch {}
    };

    w.onerror = (err) => {
      clearTimeout(timer);
      console.warn('Worker onerror, falling back:', err?.message || 'worker error');
      onProgress?.({ stage: 'fallback', info: 'Worker failed — falling back to main thread.' });
      resolve(localAggregate());
      try { w.terminate(); } catch {}
    };

    w.postMessage({
      action: 'aggregate',
      rows: rows,
      profile: profile,
      plan: plan,
      config: {
        showMissing: false,
        minGroupShare: 0
      }
    });
  });
}
