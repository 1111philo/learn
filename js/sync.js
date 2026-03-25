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
  deleteProfile, deleteProfileSummary, deletePreferences,
  deleteWorkProducts, deleteUnitProgress,
  getSummative, saveSummative,
  getSummativeAttempts, saveSummativeAttempt,
  getGapAnalysis, saveGapAnalysis,
  getJourney, saveJourney,
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
    if (!serverKeys.has(`progress:${unitId}`)) {
      await removeLocalData(`progress:${unitId}`);
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

async function getLocalData(syncKey) {
  if (syncKey === 'profile') return getLearnerProfile();
  if (syncKey === 'profileSummary') return getLearnerProfileSummary().then(s => s || null);
  if (syncKey === 'preferences') return getPreferences();
  if (syncKey === 'work') return getWorkProducts();
  if (syncKey.startsWith('summative:')) return getSummative(syncKey.slice('summative:'.length));
  if (syncKey.startsWith('summative-attempts:')) return getSummativeAttempts(syncKey.slice('summative-attempts:'.length));
  if (syncKey.startsWith('gap:')) return getGapAnalysis(syncKey.slice('gap:'.length));
  if (syncKey.startsWith('journey:')) return getJourney(syncKey.slice('journey:'.length));
  if (syncKey.startsWith('progress:')) {
    const progress = await getUnitProgress(syncKey.slice('progress:'.length));
    if (!progress) return null;
    // Embed screenshots in drafts for cloud sync
    const { getScreenshot } = await import('./storage.js');
    const draftsWithScreenshots = await Promise.all(
      (progress.drafts || []).map(async (d) => {
        if (!d.screenshotKey) return d;
        const dataUrl = await getScreenshot(d.screenshotKey);
        return dataUrl ? { ...d, screenshotDataUrl: dataUrl } : d;
      })
    );
    return { ...progress, drafts: draftsWithScreenshots };
  }
  return null;
}

async function saveLocalData(syncKey, data) {
  if (syncKey === 'profile') return saveLearnerProfile(data);
  if (syncKey === 'profileSummary') return saveLearnerProfileSummary(data);
  if (syncKey === 'preferences') return savePreferences(data);
  if (syncKey === 'work') {
    // Work is an array — replace all work products
    return (async () => {
      const { deleteWorkProducts, saveWorkProduct } = await import('./storage.js');
      await deleteWorkProducts();
      for (const product of data) await saveWorkProduct(product);
    })();
  }
  if (syncKey.startsWith('summative:')) return saveSummative(syncKey.slice('summative:'.length), data);
  if (syncKey.startsWith('summative-attempts:')) {
    // Attempts come as an array — save each one
    for (const attempt of (Array.isArray(data) ? data : [data])) {
      await saveSummativeAttempt(syncKey.slice('summative-attempts:'.length), attempt);
    }
    return;
  }
  if (syncKey.startsWith('gap:')) return saveGapAnalysis(syncKey.slice('gap:'.length), data);
  if (syncKey.startsWith('journey:')) return saveJourney(syncKey.slice('journey:'.length), data);
  if (syncKey.startsWith('progress:')) {
    // Extract and store embedded screenshots, then save progress without them
    const { saveScreenshot } = await import('./storage.js');
    const cleanDrafts = await Promise.all(
      (data.drafts || []).map(async (d) => {
        if (d.screenshotDataUrl && d.screenshotKey) {
          await saveScreenshot(d.screenshotKey, d.screenshotDataUrl);
        }
        const { screenshotDataUrl, ...rest } = d;
        return rest;
      })
    );
    return saveUnitProgress(syncKey.slice('progress:'.length), { ...data, drafts: cleanDrafts });
  }
}

function removeLocalData(syncKey) {
  if (syncKey === 'profile') return deleteProfile();
  if (syncKey === 'profileSummary') return deleteProfileSummary();
  if (syncKey === 'preferences') return deletePreferences();
  if (syncKey === 'work') return deleteWorkProducts();
  if (syncKey.startsWith('progress:')) {
    return deleteUnitProgress(syncKey.slice('progress:'.length));
  }
}
