/**
 * Remote storage client for learn-service.
 * When logged in, data is saved to and loaded from the server.
 * Local storage is a read cache — populated from the server on startup.
 */

import { authenticatedFetch, isLoggedIn } from './auth.js';
import {
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary,
  getPreferences, savePreferences,
  getWorkProducts,
  getUnitProgress, saveUnitProgress, getAllProgress,
} from './storage.js';

// In-memory version map — tracks the server's version per key for optimistic locking.
// Populated on load, updated on save. Not persisted (rebuilt each session from the server).
const _versions = {};

/**
 * Save a key to the remote server.
 * Reads the current local value and PUTs it.
 */
export async function save(syncKey) {
  if (!await isLoggedIn()) return;

  const data = await getLocalData(syncKey);
  if (data === null || data === undefined) return;

  const version = _versions[syncKey] || 0;

  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, version }),
  });

  if (res.ok) {
    _versions[syncKey] = (await res.json()).version;
  } else if (res.status === 409) {
    // Version mismatch — get the server's current version and retry
    const current = await fetchOne(syncKey);
    if (current) {
      const retry = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, version: current.version }),
      });
      if (retry.ok) {
        _versions[syncKey] = (await retry.json()).version;
      }
    }
  }
}

/**
 * Load all data from the server and write it into local storage.
 * Removes any local data the server doesn't have.
 */
export async function loadAll() {
  if (!await isLoggedIn()) return;

  const res = await authenticatedFetch('/v1/sync');
  if (!res.ok) return;

  const items = await res.json();
  const serverKeys = new Set();

  for (const { dataKey, data, version } of items) {
    await saveLocalData(dataKey, data);
    _versions[dataKey] = version;
    serverKeys.add(dataKey);
  }

  // Remove local data the server doesn't have
  const allProgress = await getAllProgress();
  for (const unitId of Object.keys(allProgress)) {
    if (!serverKeys.has(`unit:${unitId}`)) {
      await removeLocalData(`unit:${unitId}`);
    }
  }
  for (const key of ['profile', 'profileSummary', 'work']) {
    if (!serverKeys.has(key)) {
      const d = await getLocalData(key);
      if (d !== null && d !== undefined) await removeLocalData(key);
    }
  }
}

// -- Internal helpers ---------------------------------------------------------

async function fetchOne(syncKey) {
  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
  if (!res.ok) return null;
  return res.json();
}

function getLocalData(syncKey) {
  if (syncKey === 'profile') return getLearnerProfile();
  if (syncKey === 'profileSummary') return getLearnerProfileSummary().then(s => s || null);
  if (syncKey === 'preferences') return getPreferences();
  if (syncKey === 'work') return getWorkProducts();
  if (syncKey.startsWith('unit:')) {
    return getUnitProgress(syncKey.slice('unit:'.length));
  }
  return Promise.resolve(null);
}

function saveLocalData(syncKey, data) {
  if (syncKey === 'profile') return saveLearnerProfile(data);
  if (syncKey === 'profileSummary') return saveLearnerProfileSummary(data);
  if (syncKey === 'preferences') return savePreferences(data);
  if (syncKey === 'work') return chrome.storage.local.set({ work: data });
  if (syncKey.startsWith('unit:')) {
    return saveUnitProgress(syncKey.slice('unit:'.length), data);
  }
}

function removeLocalData(syncKey) {
  if (syncKey === 'profile') return chrome.storage.local.remove('learnerProfile');
  if (syncKey === 'profileSummary') return chrome.storage.local.remove('learnerProfileSummary');
  if (syncKey === 'preferences') return chrome.storage.local.remove('preferences');
  if (syncKey === 'work') return chrome.storage.local.remove('work');
  if (syncKey.startsWith('unit:')) {
    return chrome.storage.local.remove(`unit-${syncKey.slice('unit:'.length)}`);
  }
}
