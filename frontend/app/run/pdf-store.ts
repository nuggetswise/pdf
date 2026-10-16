// The original PDFs, kept in this browser (IndexedDB) by their SHA-256 so the page view survives a reload (D58).
// They never leave the browser. Storage can be blocked (private windows, strict settings): every call fails soft
// and the app then shows the page text it already holds.

const DB = "order-agent-pdfs";
const STORE = "pdfs";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req ? (req.result as T) ?? null : null); };
      t.onerror = () => { db.close(); resolve(null); };
      t.onabort = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  }));
}

export const savePdf = (sha256: string, bytes: Uint8Array) => tx<void>("readwrite", (s) => s.put(bytes, sha256));
export const loadPdf = (sha256: string) => tx<Uint8Array>("readonly", (s) => s.get(sha256));
export const clearPdfs = () => tx<void>("readwrite", (s) => s.clear());
