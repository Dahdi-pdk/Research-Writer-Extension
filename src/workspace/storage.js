// Penyimpanan lokal.
//  - IndexedDB (docs)    : isi dokumen Markdown (bisa besar)
//  - IndexedDB (sources) : daftar sumber; di sini karena handle file lokal hanya bisa disimpan di IndexedDB
//  - chrome.storage.local: preferensi ringan (panel, tema, dokumen aktif)

const DB_NAME = 'researchwriter';
const DB_VERSION = 4;
const DOCS = 'docs';
const SOURCES = 'sources';
const FOLDERS = 'folders';
const SNAPS = 'snapshots';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of [DOCS, SOURCES, FOLDERS]) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
        }
        if (!req.result.objectStoreNames.contains(SNAPS)) req.result.createObjectStore(SNAPS, { keyPath: 'id' }).createIndex('docId', 'docId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let result;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaksi dibatalkan'));
  }));
}

export const putDoc = (doc) => run(DOCS, 'readwrite', (s) => s.put(doc));
export const getDoc = (id) => run(DOCS, 'readonly', (s) => s.get(id));
export const getAllDocs = () => run(DOCS, 'readonly', (s) => s.getAll());
export const deleteDoc = (id) => run(DOCS, 'readwrite', (s) => s.delete(id));

export function createDoc(title = 'Tanpa judul', content = '') {
  const now = Date.now();
  return { id: crypto.randomUUID(), title, content, fileName: null, handle: null, fileHash: null, fileModified: null, createdAt: now, updatedAt: now };
}

export const putSource = (src) => run(SOURCES, 'readwrite', (s) => s.put(src));
export const getAllSources = () => run(SOURCES, 'readonly', (s) => s.getAll());
export const deleteSource = (id) => run(SOURCES, 'readwrite', (s) => s.delete(id));
// Satu transaksi untuk banyak sumber (impor folder): jauh lebih cepat daripada put satu per satu.
export const putSources = (list) => run(SOURCES, 'readwrite', (s) => { for (const x of list) s.put(x); });
export const deleteSources = (ids) => run(SOURCES, 'readwrite', (s) => { for (const id of ids) s.delete(id); });

// Titik pemulihan (riwayat versi) per dokumen
export const putSnapshot = (x) => run(SNAPS, 'readwrite', (s) => s.put(x));
export const getSnapshots = (docId) => run(SNAPS, 'readonly', (s) => s.index('docId').getAll(docId));
export const deleteSnapshots = (ids) => run(SNAPS, 'readwrite', (s) => { for (const id of ids) s.delete(id); });

// Folder PDF terdaftar: { id, name, handle(FileSystemDirectoryHandle), addedAt }
export const putFolder = (f) => run(FOLDERS, 'readwrite', (s) => s.put(f));
export const getAllFolders = () => run(FOLDERS, 'readonly', (s) => s.getAll());
export const deleteFolder = (id) => run(FOLDERS, 'readwrite', (s) => s.delete(id));

// kind: 'web' | 'pdf-url' | 'pdf-local'
export function createSource(fields) {
  return { id: crypto.randomUUID(), addedAt: Date.now(), autoTitle: true, authors: [], year: '', venue: '', doi: '', citeKey: '', ...fields };
}

export const DEFAULT_PREFS = { panelVisible: true, panelWidth: 260, theme: 'auto', activeDocId: null, panelTab: 'docs', views: {} };

export async function loadPrefs() {
  const r = await chrome.storage.local.get('prefs');
  return { ...DEFAULT_PREFS, ...(r.prefs || {}) };
}
export async function savePrefs(prefs) {
  await chrome.storage.local.set({ prefs });
}
