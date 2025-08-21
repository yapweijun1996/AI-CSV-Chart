/**
 * IndexedDB-based history and chunked storage for CSV datasets.
 * - DB: csvCache
 * - Stores:
 *   - history (key: id) => { id, sig, name, createdAt, updatedAt, columns, rowCount, meta, uiSnapshot, chunkSize, version }
 *   - chunks (key: id#chunkIndex) => { key, id, chunkIndex, rows }
 *
 * Public API (all promise-based):
 * - openDB() => IDBDatabase
 * - saveHistory(historyItem) => id
 * - updateHistory(id, updates)
 * - listHistory() => [historyItem]
 * - getHistory(id) => historyItem
 * - deleteHistory(id)
 * - appendChunk(id, chunkIndex, rows)
 * - loadChunks(id, onChunk)
 * - restoreHistory(id) => { history, rows }
 */

const DB_NAME = 'csvCache';
const DB_VERSION = 2; // Bump version for schema change
const STORE_HISTORY = 'history';
const STORE_CHUNKS = 'chunks';

// Small helper for promisified IDB requests
function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB request error'));
  });
}

export async function openDB() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const tx = req.transaction;

      // Create stores if they don't exist
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
        chunkStore.createIndex('by_id', 'id', { unique: false });
      }

      // Perform migrations based on old version
      if (e.oldVersion < 2) {
        // Migration from v1 to v2
        if (db.objectStoreNames.contains('manifests')) {
          db.deleteObjectStore('manifests');
        }
        
        // Now that we are sure STORE_CHUNKS exists, we can get it.
        const chunkStore = tx.objectStore(STORE_CHUNKS);
        if (chunkStore.indexNames.contains('by_sig')) {
          chunkStore.deleteIndex('by_sig');
        }
        if (!chunkStore.indexNames.contains('by_id')) {
          // This index is now created by default, so this check is for safety.
          // If for some reason it wasn't created, this would fail.
          // The new structure ensures it's created before this migration runs.
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
  });
}

export async function saveHistory(historyItem) {
  const db = await openDB();
  const tx = db.transaction(STORE_HISTORY, 'readwrite');
  const store = tx.objectStore(STORE_HISTORY);
  const id = historyItem.id || crypto.randomUUID();
  const now = Date.now();
  const record = {
    ...historyItem,
    id,
    createdAt: historyItem.createdAt || now,
    updatedAt: now,
    status: historyItem.status || 'ready', // Default to ready
  };
  await idbReq(store.put(record));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  return id;
}

export async function updateHistory(id, updates) {
  const db = await openDB();
  const tx = db.transaction(STORE_HISTORY, 'readwrite');
  const store = tx.objectStore(STORE_HISTORY);
  const existing = await idbReq(store.get(id));
  if (existing) {
    const updatedRecord = { ...existing, ...updates, updatedAt: Date.now() };
    await idbReq(store.put(updatedRecord));
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function listHistory() {
  const db = await openDB();
  const tx = db.transaction(STORE_HISTORY, 'readonly');
  const store = tx.objectStore(STORE_HISTORY);
  const records = await idbReq(store.getAll());
  // Sort by most recently updated
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getHistory(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_HISTORY, 'readonly');
  const store = tx.objectStore(STORE_HISTORY);
  return await idbReq(store.get(id));
}

export async function deleteHistory(id) {
  const db = await openDB();
  // Delete history record
  let tx = db.transaction(STORE_HISTORY, 'readwrite');
  await idbReq(tx.objectStore(STORE_HISTORY).delete(id));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });

  // Delete associated chunks
  tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const chunksStore = tx.objectStore(STORE_CHUNKS);
  const idx = chunksStore.index('by_id');
  const range = IDBKeyRange.only(id);
  const keysToDelete = await idbReq(idx.getAllKeys(range));
  for (const key of keysToDelete) {
    await idbReq(chunksStore.delete(key));
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function appendChunk(id, chunkIndex, rows) {
  const db = await openDB();
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  const store = tx.objectStore(STORE_CHUNKS);
  const key = `${id}#${chunkIndex}`;
  await idbReq(store.put({ key, id, chunkIndex, rows }));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

export async function countChunks(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_CHUNKS, 'readonly');
  const store = tx.objectStore(STORE_CHUNKS);
  const idx = store.index('by_id');
  const range = IDBKeyRange.only(id);
  return await idbReq(idx.count(range));
}

export async function loadChunks(id, onChunk, onProgress) {
  const db = await openDB();
  const tx = db.transaction(STORE_CHUNKS, 'readonly');
  const store = tx.objectStore(STORE_CHUNKS);
  const idx = store.index('by_id');
  const range = IDBKeyRange.only(id);

  const allChunks = await idbReq(idx.getAll(range));
  
  // Sort chunks numerically by chunkIndex to ensure correct order
  allChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const totalChunks = allChunks.length;
  let loadedChunks = 0;

  for (const chunk of allChunks) {
    await onChunk(chunk.rows, chunk.chunkIndex);
    loadedChunks++;
    if (onProgress) {
      onProgress(loadedChunks, totalChunks);
    }
  }
}

async function loadAllRows(id, onProgress) {
    const rows = [];
    await loadChunks(id, (chunkRows) => {
        rows.push(...chunkRows);
    }, onProgress);
    return rows;
}

/**
 * Reconstructs a full history item, including its dataset rows.
 * WARNING: May be memory-heavy for large datasets.
 */
export async function restoreHistory(id, onProgress) {
  const history = await getHistory(id);
  if (!history) return null;
  const rows = await loadAllRows(id, onProgress);
  return { history, rows };
}