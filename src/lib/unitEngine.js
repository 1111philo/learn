/**
 * Async unit lifecycle — diagnostic, plan generation, activity generation,
 * draft recording, dispute, Q&A. Extracted from app.js so React components stay thin.
 */

import {
  getUnitProgress, saveUnitProgress, getLearnerProfileSummary,
  saveWorkProduct, saveScreenshot, getScreenshot,
  getDiagnosticState, saveDiagnosticState, clearDiagnosticState,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';
import {
  updateProfileInBackground, updateProfileFromFeedbackInBackground,
  updateProfileOnUnitCompletionInBackground, ensureProfileExists,
} from './profileQueue.js';

/** Build course scope context for agent calls. */
export function buildCourseScope(unitId, courseGroups, units, allProgress) {
  const group = courseGroups.find(cg => cg.units?.some(u => u.unitId === unitId));
  if (!group) return null;
  const groupUnits = group.units || [];
  return {
    courseName: group.name,
    isRequired: !groupUnits.find(u => u.unitId === unitId)?.optional,
    siblingUnits: groupUnits.map(u => ({
      name: u.name, unitId: u.unitId, description: u.description,
      completed: allProgress[u.unitId]?.status === 'completed',
    })),
  };
}

/** Start the diagnostic conversation for a unit. Returns the initial result. */
export async function startDiagnostic(unit, courseGroups, units, allProgress) {
  const profileSummary = await getLearnerProfileSummary();
  const courseScope = buildCourseScope(unit.unitId, courseGroups, units, allProgress);

  const context = JSON.stringify({
    unitName: unit.name,
    unitDescription: unit.description,
    learningObjectives: unit.learningObjectives,
    learnerProfile: profileSummary,
    courseScope,
  });

  const result = await orchestrator.converse('diagnostic-conversation', [
    { role: 'user', content: context },
  ], 1024);

  const activity = {
    id: `diagnostic-${unit.unitId}`,
    type: 'final',
    goal: unit.learningObjectives?.[unit.learningObjectives.length - 1] || '',
    instruction: result.message,
    tips: [],
  };

  return { result, activity };
}

/** Send a message in the diagnostic conversation. */
export async function sendDiagnosticMessage(text, unit, diagnosticActivity, messages, courseGroups, units, allProgress) {
  const profileSummary = await getLearnerProfileSummary();
  const courseScope = buildCourseScope(unit.unitId, courseGroups, units, allProgress);

  const context = JSON.stringify({
    unitName: unit.name,
    unitDescription: unit.description,
    learningObjectives: unit.learningObjectives,
    learnerProfile: profileSummary,
    courseScope,
  });

  const fullMessages = [
    { role: 'user', content: context },
    ...messages,
    { role: 'user', content: text },
  ];

  const result = await orchestrator.converse('diagnostic-conversation', fullMessages, 1024);
  return result;
}

/** Generate a learning plan and first activity for a unit. */
export async function generatePlanAndFirstActivity(unit, diagnosticResult, courseGroups, units, allProgress, preferences) {
  const profileSummary = await getLearnerProfileSummary();
  const completedUnitNames = Object.entries(allProgress)
    .filter(([, p]) => p.status === 'completed')
    .map(([id]) => units.find(c => c.unitId === id)?.name)
    .filter(Boolean);
  const courseScope = buildCourseScope(unit.unitId, courseGroups, units, allProgress);

  const plan = await orchestrator.createLearningPlan(
    unit, preferences, profileSummary, completedUnitNames, diagnosticResult, courseScope
  );

  const firstSlot = plan.activities[0];
  const generated = await orchestrator.generateNextActivity(
    unit, firstSlot, [], profileSummary, plan, courseScope
  );

  return { plan, firstActivity: { ...firstSlot, instruction: generated.instruction, tips: generated.tips, messages: [] } };
}

/** Generate the next activity for a unit. */
export async function generateNextActivity(unit, progress, courseGroups, units, allProgress) {
  const profileSummary = await getLearnerProfileSummary();
  const courseScope = buildCourseScope(unit.unitId, courseGroups, units, allProgress);
  const plan = progress.learningPlan;
  const slot = plan.activities[progress.currentActivityIndex];

  const progressSummary = progress.activities
    .slice(0, progress.currentActivityIndex)
    .map((a, i) => {
      const drafts = progress.drafts.filter(d => d.activityId === a.id);
      const best = drafts.reduce((max, d) => d.score > max ? d.score : max, 0);
      return `${a.type}: ${a.goal} (best score: ${Math.round(best * 100)}%)`;
    }).join('\n');

  const generated = await orchestrator.generateNextActivity(
    unit, slot, progressSummary, profileSummary, plan, courseScope
  );

  return { ...slot, instruction: generated.instruction, tips: generated.tips, messages: [] };
}

/** Record a draft (capture screenshot + assess). */
export async function recordDraft(unit, progress, activity) {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url || '';

  if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:') || pageUrl.startsWith('edge://')) {
    throw new Error('Navigate to a webpage before recording.');
  }

  // Request permission if needed
  const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!hasPermission) {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) throw new Error('Permission needed to capture screenshots.');
  }

  // Capture screenshot
  const response = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
  if (!response?.dataUrl) throw new Error('Screenshot capture failed.');
  const dataUrl = response.dataUrl;

  const screenshotKey = `activity-${unit.unitId}-${activity.id}-${Date.now()}`;
  await saveScreenshot(screenshotKey, dataUrl);

  // Assess
  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id);
  const result = await orchestrator.assessDraft(unit, activity, dataUrl, pageUrl, priorDrafts, profileSummary);

  const draft = {
    id: `draft-${Date.now()}`,
    activityId: activity.id,
    screenshotKey,
    url: pageUrl,
    feedback: result.feedback,
    strengths: result.strengths,
    improvements: result.improvements,
    score: result.score,
    recommendation: result.recommendation,
    timestamp: Date.now(),
  };

  // Update progress
  const newProgress = { ...progress };
  newProgress.drafts = [...newProgress.drafts, draft];

  const justCompleted = activity.type === 'final' && result.passed;
  if (justCompleted) {
    newProgress.status = 'completed';
    newProgress.completedAt = Date.now();
    newProgress.finalWorkProductUrl = pageUrl;
    await saveWorkProduct({ unitId: unit.unitId, courseName: unit.name, url: pageUrl, completedAt: newProgress.completedAt });
  }

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  if (justCompleted) { syncInBackground('work'); updateProfileOnUnitCompletionInBackground(unit, newProgress); }
  updateProfileInBackground(result, unit, activity);

  return { newProgress, draft, justCompleted };
}

/** Submit a dispute on a draft assessment. */
export async function submitDispute(unit, progress, activity, draft, feedbackText) {
  const screenshotDataUrl = await getScreenshot(draft.screenshotKey);
  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id && d.id !== draft.id);
  const previousAssessment = {
    feedback: draft.feedback, strengths: draft.strengths,
    improvements: draft.improvements, score: draft.score,
    recommendation: draft.recommendation, passed: draft.passed || false,
  };

  const result = await orchestrator.reassessDraft(
    unit, activity, screenshotDataUrl, draft.url,
    priorDrafts, profileSummary, previousAssessment, feedbackText
  );

  // Update draft in place
  const newDrafts = progress.drafts.map(d => d.id === draft.id ? {
    ...d, feedback: result.feedback, strengths: result.strengths,
    improvements: result.improvements, score: result.score,
    recommendation: result.recommendation, disputed: true,
  } : d);

  const newProgress = { ...progress, drafts: newDrafts };

  const justCompleted = activity.type === 'final' && result.passed && progress.status !== 'completed';
  if (justCompleted) {
    newProgress.status = 'completed';
    newProgress.completedAt = Date.now();
    newProgress.finalWorkProductUrl = draft.url;
    await saveWorkProduct({ unitId: unit.unitId, courseName: unit.name, url: draft.url, completedAt: newProgress.completedAt });
  }

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  if (justCompleted) { syncInBackground('work'); updateProfileOnUnitCompletionInBackground(unit, newProgress); }
  updateProfileFromFeedbackInBackground(feedbackText, unit, activity);

  return { newProgress, justCompleted };
}

/** Ask a Q&A question about an activity. */
export async function askAboutActivity(unit, progress, activity, text) {
  const profileSummary = await getLearnerProfileSummary();
  const latestDraft = progress.drafts.filter(d => d.activityId === activity.id).pop();

  const systemPrompt = `You are a helpful learning assistant for 1111 Learn. The learner is working on an activity and has a question. Answer concisely and helpfully.

Activity: ${activity.instruction}
${latestDraft ? `\nLatest feedback: ${latestDraft.feedback}` : ''}
Learner profile: ${profileSummary}

Respond in plain text (not JSON). Be brief and direct.`;

  const history = (activity.messages || []).map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: `Learner name: ${progress.unitId}\n\nLearner question: ${text}` });

  const response = await orchestrator.chatWithContext(systemPrompt, history);

  // Update activity messages
  const now = Date.now();
  const newMessages = [...(activity.messages || []),
    { role: 'user', content: text, timestamp: now },
    { role: 'assistant', content: response, timestamp: now + 1 },
  ];

  // Update progress with new messages
  const newActivities = progress.activities.map(a =>
    a.id === activity.id ? { ...a, messages: newMessages } : a
  );
  const newProgress = { ...progress, activities: newActivities };

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);

  return { newProgress, response };
}
