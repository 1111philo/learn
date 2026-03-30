/**
 * Platform abstraction layer for 1111 Learn.
 * Provides cross-platform replacements for Chrome extension APIs:
 * - resolveAssetURL  → replaces chrome.runtime.getURL
 * - kvStorage        → replaces chrome.storage.local
 * - getPlatform      → detects runtime environment
 */

// -- Platform detection -------------------------------------------------------

let _platform = null;

export function getPlatform() {
  if (_platform) return _platform;
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    _platform = 'extension';
  } else if (globalThis.Capacitor) {
    _platform = 'capacitor';
  } else if (globalThis.electronAPI) {
    _platform = 'electron';
  } else {
    _platform = 'web';
  }
  return _platform;
}

// -- Asset URL resolution -----------------------------------------------------

/**
 * Resolve a relative asset path to a fetchable URL.
 * In the Chrome extension, this wraps chrome.runtime.getURL.
 * On other platforms, assets live alongside the HTML in dist/, so relative paths work.
 */
export function resolveAssetURL(relativePath) {
  if (getPlatform() === 'extension') {
    return chrome.runtime.getURL(relativePath);
  }
  // Capacitor, Electron, and web: assets are served from the same directory as index.html
  return relativePath;
}

// -- Key-value storage (for SQLite DB binary) ---------------------------------

/**
 * Platform-agnostic key-value storage for persisting the SQLite database binary.
 *
 * Extension: chrome.storage.local
 * Capacitor: @capacitor/filesystem (base64-encoded binary in app data dir)
 * Electron:  IPC to main process (Node fs in userData dir)
 * Web/dev:   IndexedDB (supports large binary blobs without the ~5MB localStorage limit)
 */
export const kvStorage = {
  async get(key) {
    const platform = getPlatform();

    if (platform === 'extension') {
      return chrome.storage.local.get(key);
    }

    if (platform === 'capacitor') {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const result = await Filesystem.readFile({
          path: `${key}.bin`,
          directory: Directory.Data,
        });
        // result.data is base64 on native
        const binary = atob(result.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { [key]: Array.from(bytes) };
      } catch {
        return {};
      }
    }

    if (platform === 'electron') {
      try {
        const data = await window.electronAPI.kvGet(key);
        return data != null ? { [key]: data } : {};
      } catch {
        return {};
      }
    }

    // Web fallback: IndexedDB
    return _idbGet(key);
  },

  async set(data) {
    const platform = getPlatform();
    const key = Object.keys(data)[0];
    const value = data[key];

    if (platform === 'extension') {
      return chrome.storage.local.set(data);
    }

    if (platform === 'capacitor') {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const bytes = new Uint8Array(value);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      await Filesystem.writeFile({
        path: `${key}.bin`,
        data: btoa(binary),
        directory: Directory.Data,
      });
      return;
    }

    if (platform === 'electron') {
      return window.electronAPI.kvSet(key, value);
    }

    // Web fallback: IndexedDB
    return _idbSet(key, value);
  },

  async remove(key) {
    const platform = getPlatform();

    if (platform === 'extension') {
      return chrome.storage.local.remove(key);
    }

    if (platform === 'capacitor') {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.deleteFile({
          path: `${key}.bin`,
          directory: Directory.Data,
        });
      } catch { /* file may not exist */ }
      return;
    }

    if (platform === 'electron') {
      return window.electronAPI.kvRemove(key);
    }

    // Web fallback: IndexedDB
    return _idbRemove(key);
  },
};

// -- IndexedDB fallback for web platform --------------------------------------

const IDB_NAME = '1111-kv';
const IDB_STORE = 'kv';

function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _idbGet(key) {
  const db = await _openIdb();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result != null ? { [key]: req.result } : {});
    req.onerror = () => resolve({});
  });
}

async function _idbSet(key, value) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function _idbRemove(key) {
  const db = await _openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
