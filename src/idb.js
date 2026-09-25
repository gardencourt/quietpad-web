// A tiny key/value store in IndexedDB. Used to remember the chosen local folder between
// visits: a FileSystemDirectoryHandle can be stored there (localStorage can't hold one).
const DB = "quietpad-web";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const idbGet = (key) => run("readonly", (s) => s.get(key)).catch(() => undefined);
export const idbSet = (key, value) => run("readwrite", (s) => s.put(value, key)).catch(() => {});
export const idbDelete = (key) => run("readwrite", (s) => s.delete(key)).catch(() => {});
