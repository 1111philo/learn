/**
 * Sequential profile update queue — prevents concurrent updates from overwriting each other.
 */

import {
  getLearnerProfile, saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';

let _profileUpdateQueue = Promise.resolve();

export function queueProfileUpdate(fn) {
  _profileUpdateQueue = _profileUpdateQueue.then(fn).catch(e => {
    console.error('Profile update failed:', e?.message || e, e?.stack);
  });
  return _profileUpdateQueue;
}

function defaultProfile() {
  return {
    name: '', goal: '',
    completedUnits: [], activeUnits: [],
    strengths: [], weaknesses: [],
    revisionPatterns: '', pacing: '',
    preferences: {},
    accessibilityNeeds: [], recurringSupport: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

export function mergeProfile(existing, returned) {
  const merged = { ...existing };
  for (const key of ['name', 'goal', 'revisionPatterns', 'pacing']) {
    if (returned[key]) merged[key] = returned[key];
  }
  for (const key of ['completedUnits', 'activeUnits', 'masteredCourses']) {
    const combined = [...(existing[key] || []), ...(returned[key] || [])];
    merged[key] = [...new Set(combined)];
  }
  for (const key of ['strengths', 'weaknesses', 'accessibilityNeeds', 'recurringSupport']) {
    merged[key] = (returned[key]?.length > 0) ? returned[key] : (existing[key] || []);
  }
  merged.preferences = { ...(existing.preferences || {}), ...(returned.preferences || {}) };
  // Merge rubricProgress (per-course, per-criterion levels)
  if (returned.rubricProgress) {
    merged.rubricProgress = { ...(existing.rubricProgress || {}) };
    for (const [courseId, criteria] of Object.entries(returned.rubricProgress)) {
      merged.rubricProgress[courseId] = { ...(merged.rubricProgress[courseId] || {}), ...criteria };
    }
  }
  merged.createdAt = existing.createdAt || returned.createdAt;
  merged.updatedAt = returned.updatedAt || Date.now();
  return merged;
}

async function saveProfileResult(existing, result) {
  if (!result?.profile) {
    console.warn('Profile update agent returned no profile:', result);
    return;
  }
  const merged = mergeProfile(existing, result.profile);
  await saveLearnerProfile(merged);
  if (result.summary) await saveLearnerProfileSummary(result.summary);
  syncInBackground('profile', 'profileSummary');
}

export async function ensureProfileExists(name = '') {
  let profile = await getLearnerProfile();
  if (!profile) {
    profile = defaultProfile();
    profile.name = name;
    await saveLearnerProfile(profile);
    await saveLearnerProfileSummary('New learner — profile will be built as they learn.');
  }
  return profile;
}

export function updateProfileInBackground(assessmentResult, unit, activity) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateLearnerProfile(profile, assessmentResult, {
      courseName: unit.name, activityType: activity.type, activityGoal: activity.goal,
    });
    await saveProfileResult(profile, result);
  });
}

export function updateProfileFromFeedbackInBackground(feedbackText, unit, activity) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileFromFeedback(profile, feedbackText, {
      courseName: unit.name, activityType: activity.type, activityGoal: activity.goal,
    });
    await saveProfileResult(profile, result);
  });
}

export function updateProfileOnSummativeAttemptInBackground(course, attempt) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnSummativeAttempt(profile, course, attempt);
    await saveProfileResult(profile, result);
  });
}

export function updateProfileOnMasteryInBackground(course, finalResult, formativeSummaries) {
  queueProfileUpdate(async () => {
    const profile = await ensureProfileExists();
    const result = await orchestrator.updateProfileOnMastery(profile, course, finalResult, formativeSummaries);
    await saveProfileResult(profile, result);
  });
}
