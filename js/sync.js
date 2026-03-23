/**
 * Cloud sync module — pushes and pulls data to/from learn-service.
 * Only active when the user is logged in. Fire-and-forget, never blocks UI.
 */

import { authenticatedFetch, isLoggedIn } from './auth.js';
import {
  getLearnerProfile, saveLearnerProfile,
  getLearnerProfileSummary, saveLearnerProfileSummary,
  getPreferences, savePreferences,
  getWorkProducts,
  getCourseProgress, saveCourseProgress, getAllProgress,
  getSyncVersions, saveSyncVersions,
  saveLastSync
} from './storage.js';

/**
 * Push a single data key to the server.
 * Uses optimistic locking via version numbers.
 */
export async function pushData(syncKey) {
  if (!await isLoggedIn()) return;

  const data = await getLocalData(syncKey);
  if (data === null || data === undefined) return;

  const versions = await getSyncVersions();
  const version = versions[syncKey] || 0;

  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, version }),
  });

  if (res.ok) {
    const { version: newVersion } = await res.json();
    versions[syncKey] = newVersion;
    await saveSyncVersions(versions);
  } else if (res.status === 409) {
    // Version conflict — pull server version and force-push merged data
    const serverItem = await pullOne(syncKey);
    if (serverItem) {
      const merged = mergeData(syncKey, data, serverItem.data);
      await saveLocalData(syncKey, merged);
      const retryRes = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: merged, version: serverItem.version }),
      });
      if (retryRes.ok) {
        const { version: newVersion } = await retryRes.json();
        versions[syncKey] = newVersion;
        await saveSyncVersions(versions);
      }
    }
  }
}

/**
 * Pull all data from the server and merge with local.
 * Keys that exist locally but were deleted on the server are removed.
 * Returns the set of keys that were removed (so syncAll can skip re-pushing them).
 */
export async function pullAll() {
  if (!await isLoggedIn()) return new Set();

  const res = await authenticatedFetch('/v1/sync');
  if (!res.ok) return new Set();

  const items = await res.json();
  const versions = await getSyncVersions();
  const serverKeys = new Set(items.map(i => i.dataKey));

  for (const { dataKey, data, version } of items) {
    const localData = await getLocalData(dataKey);
    if (localData !== null && localData !== undefined) {
      const merged = mergeData(dataKey, localData, data);
      await saveLocalData(dataKey, merged);
    } else {
      await saveLocalData(dataKey, data);
    }
    versions[dataKey] = version;
  }

  // Remove local data for keys that no longer exist on the server
  const removedKeys = new Set();
  for (const localKey of Object.keys(versions)) {
    if (!serverKeys.has(localKey)) {
      await removeLocalData(localKey);
      delete versions[localKey];
      removedKeys.add(localKey);
    }
  }

  await saveSyncVersions(versions);
  await saveLastSync();
  return removedKeys;
}

/**
 * Full sync: pull from server, merge, then push all local data back.
 * Keys deleted on the server are not re-pushed.
 */
export async function syncAll() {
  if (!await isLoggedIn()) return;

  const removedKeys = await pullAll();

  // Push all syncable keys, skipping any that were just deleted by the server
  const keys = ['profile', 'profileSummary', 'preferences', 'work'];

  const allProgress = await getAllProgress();
  for (const courseId of Object.keys(allProgress)) {
    keys.push(`progress:${courseId}`);
  }

  for (const key of keys) {
    if (removedKeys.has(key)) continue;
    try { await pushData(key); } catch { /* silent */ }
  }

  await saveLastSync();
}

// -- Internal helpers ---------------------------------------------------------

async function pullOne(syncKey) {
  const res = await authenticatedFetch(`/v1/sync/${encodeURIComponent(syncKey)}`);
  if (!res.ok) return null;
  return res.json();
}

async function getLocalData(syncKey) {
  if (syncKey === 'profile') return await getLearnerProfile();
  if (syncKey === 'profileSummary') return await getLearnerProfileSummary() || null;
  if (syncKey === 'preferences') return await getPreferences();
  if (syncKey === 'work') return await getWorkProducts();
  if (syncKey.startsWith('progress:')) {
    const courseId = syncKey.slice('progress:'.length);
    return await getCourseProgress(courseId);
  }
  return null;
}

async function saveLocalData(syncKey, data) {
  if (syncKey === 'profile') return await saveLearnerProfile(data);
  if (syncKey === 'profileSummary') return await saveLearnerProfileSummary(data);
  if (syncKey === 'preferences') return await savePreferences(data);
  if (syncKey === 'work') return await chrome.storage.local.set({ work: data });
  if (syncKey.startsWith('progress:')) {
    const courseId = syncKey.slice('progress:'.length);
    return await saveCourseProgress(courseId, data);
  }
}

async function removeLocalData(syncKey) {
  if (syncKey === 'profile') return await chrome.storage.local.remove('learnerProfile');
  if (syncKey === 'profileSummary') return await chrome.storage.local.remove('learnerProfileSummary');
  if (syncKey === 'preferences') return await chrome.storage.local.remove('preferences');
  if (syncKey === 'work') return await chrome.storage.local.remove('work');
  if (syncKey.startsWith('progress:')) {
    const courseId = syncKey.slice('progress:'.length);
    return await chrome.storage.local.remove(`progress-${courseId}`);
  }
}

function mergeData(syncKey, local, server) {
  if (!local) return server;
  if (!server) return local;

  if (syncKey === 'profile') return mergeProfile(local, server);
  if (syncKey === 'work') return mergeWork(local, server);
  if (syncKey.startsWith('progress:')) return mergeProgress(local, server);

  // For preferences, profileSummary: prefer local (most recent edit wins)
  return local;
}

/** Merge learner profiles — union arrays, keep latest strings. */
function mergeProfile(local, server) {
  const merged = { ...server };
  for (const key of ['name', 'goal', 'revisionPatterns', 'pacing']) {
    merged[key] = local[key] || server[key];
  }
  for (const key of ['completedCourses', 'activeCourses']) {
    const combined = [...(local[key] || []), ...(server[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  for (const key of ['strengths', 'weaknesses', 'accessibilityNeeds', 'recurringSupport']) {
    merged[key] = (local[key]?.length > 0) ? local[key] : (server[key] || []);
  }
  merged.preferences = { ...(server.preferences || {}), ...(local.preferences || {}) };
  merged.createdAt = Math.min(local.createdAt || Infinity, server.createdAt || Infinity);
  merged.updatedAt = Math.max(local.updatedAt || 0, server.updatedAt || 0);
  return merged;
}

/** Merge work products — union by courseId, local wins on conflict. */
function mergeWork(local, server) {
  const map = new Map();
  for (const w of server) map.set(w.courseId, w);
  for (const w of local) map.set(w.courseId, w);
  return [...map.values()];
}

/** Merge course progress — prefer the more advanced version. */
function mergeProgress(local, server) {
  if (local.status === 'completed') return local;
  if (server.status === 'completed') return server;
  if ((local.currentActivityIndex || 0) >= (server.currentActivityIndex || 0)) return local;
  return server;
}
