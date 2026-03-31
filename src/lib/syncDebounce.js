/**
 * Debounced sync — accumulates keys and pushes to server after 500ms.
 * Fire-and-forget, never blocks UI.
 */

import * as sync from '../../js/sync.js';

const _pendingSyncKeys = new Set();
let _syncTimer = null;

// -- Sync failure event ------------------------------------------------------
const _syncFailureListeners = new Set();

/**
 * Register a listener called when background sync fails.
 * Receives { syncKey, error } as the argument.
 * Returns an unsubscribe function.
 */
export function onSyncFailure(fn) {
  _syncFailureListeners.add(fn);
  return () => _syncFailureListeners.delete(fn);
}

/** Trigger sync failure listeners directly (for use by loadAll callers). */
export function notifySyncFailure(syncKey, error) {
  _notifySyncFailure(syncKey, error);
}

function _notifySyncFailure(syncKey, error) {
  for (const fn of _syncFailureListeners) {
    try { fn({ syncKey, error }); } catch { /* listener errors must not propagate */ }
  }
}

/**
 * Immediately process all pending sync keys (cancel debounce timer).
 * Awaits all saves before returning. Used before logout to ensure data reaches the server.
 */
export async function flushPendingSync() {
  if (_syncTimer) {
    clearTimeout(_syncTimer);
    _syncTimer = null;
  }
  const keys = [..._pendingSyncKeys];
  _pendingSyncKeys.clear();
  for (const key of keys) {
    try {
      await sync.save(key);
    } catch (err) {
      console.warn(`[sync] Failed to save "${key}":`, err.message || err);
      _notifySyncFailure(key, err);
    }
  }
}

export function syncInBackground(...syncKeys) {
  for (const key of syncKeys) _pendingSyncKeys.add(key);
  if (_syncTimer) return;
  _syncTimer = setTimeout(() => {
    const keys = [..._pendingSyncKeys];
    _pendingSyncKeys.clear();
    _syncTimer = null;
    Promise.resolve().then(async () => {
      for (const key of keys) {
        try {
          await sync.save(key);
        } catch (err) {
          console.warn(`[sync] Failed to save "${key}":`, err.message || err);
          _notifySyncFailure(key, err);
        }
      }
    });
  }, 500);
}
