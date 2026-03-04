import { useEffect, useRef, useState } from "react";

const DB_NAME = "designtoucher";
const STORE = "kv";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

(window as any).clearAllData = () => {
  indexedDB.deleteDatabase(DB_NAME);
  dbPromise = null;
  console.log("All data cleared. Reloading…");
  location.reload();
};

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Like useLocalStorage, but backed by IndexedDB.
 * Loads the initial value asynchronously; uses `init()` until loaded.
 */
export function useIDB<T>(key: string, init: () => T) {
  const [value, setValue] = useState<T>(init);
  const loaded = useRef(false);

  // Load from IDB on mount
  useEffect(() => {
    let cancelled = false;
    idbGet<T>(key).then((stored) => {
      if (cancelled) return;
      if (stored !== undefined) {
        setValue(stored);
      }
      loaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Save to IDB on change, throttled (skip until initial load)
  const pendingValue = useRef(value);
  const timerRunning = useRef(false);
  useEffect(() => {
    if (!loaded.current) return;
    pendingValue.current = value;
    if (!timerRunning.current) {
      timerRunning.current = true;
      setTimeout(() => {
        timerRunning.current = false;
        idbSet(key, pendingValue.current).catch((e) =>
          console.warn("error saving to IndexedDB", e),
        );
      }, 500);
    }
  }, [key, value]);

  return [value, setValue] as const;
}
