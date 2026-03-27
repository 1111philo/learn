/**
 * Course + unit lifecycle — summative assessment, gap analysis, journey generation,
 * formative activity generation, draft recording, dispute, Q&A.
 */

import {
  getUnitProgress, saveUnitProgress, getLearnerProfileSummary,
  saveWorkProduct, saveScreenshot, getScreenshot,
  getSummative, saveSummative, getSummativeAttempts, saveSummativeAttempt,
  getGapAnalysis, saveGapAnalysis,
  getJourney, saveJourney, updateJourneyPhase,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';
import {
  updateProfileInBackground, updateProfileFromFeedbackInBackground,
  updateProfileOnSummativeAttemptInBackground,
  ensureProfileExists,
} from './profileQueue.js';

// -- Course-level functions ---------------------------------------------------

/** Collect all learning objectives across all units in a course group. */
function collectObjectives(courseGroup) {
  return (courseGroup.units || []).flatMap(u => u.learningObjectives || []);
}

/** Initialize a course: generate the summative assessment. */
export async function initCourse(courseGroup) {
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();
  const allObjectives = collectObjectives(courseGroup);

  const summativeResult = await orchestrator.generateSummative(
    courseGroup, allObjectives, profileSummary
  );

  const summativeData = {
    task: summativeResult.task,
    rubric: summativeResult.rubric,
    exemplar: summativeResult.exemplar,
    tool: summativeResult.task?.tool || null,
    courseIntro: summativeResult.courseIntro || null,
    summaryForLearner: summativeResult.summaryForLearner || null,
    createdAt: Date.now(),
  };
  await saveSummative(courseGroup.courseId, summativeData);
  await saveJourney(courseGroup.courseId, { plan: {}, phase: 'course_intro' });
  syncInBackground(`summative:${courseGroup.courseId}`);

  return summativeData;
}

/** Advance past an orientation screen to the next phase. */
export async function advancePhase(courseId, nextPhase) {
  await updateJourneyPhase(courseId, nextPhase);
  syncInBackground(`journey:${courseId}`);
}

/**
 * Call the Guide Agent at an orientation checkpoint.
 * First call (no prior messages): generates the initial greeting.
 * Subsequent calls: answers follow-up questions.
 * Returns { message } from the agent.
 */
export async function callGuide(courseGroup, checkpoint, messages, extraContext) {
  const profileSummary = await getLearnerProfileSummary();

  // Build context as the first user message
  const context = JSON.stringify({
    checkpoint,
    courseName: courseGroup.name,
    learnerProfile: profileSummary || 'No profile yet',
    ...extraContext,
  });

  // First call: context → assistant ack → "Begin" trigger
  // Follow-up: context → assistant ack → prior messages → new user message
  const fullMessages = [
    { role: 'user', content: context },
    { role: 'assistant', content: 'Ready.' },
    ...messages,
  ];

  // If no prior conversation, add a trigger for the initial greeting
  if (messages.length === 0) {
    fullMessages.push({ role: 'user', content: 'Orient me.' });
  }

  const result = await orchestrator.converse('guide', fullMessages, 512);
  return result;
}

/** Capture a screenshot for one step of the multi-step summative. */
export async function recordSummativeCapture(courseId, stepIndex) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url || '';

  if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:') || pageUrl.startsWith('edge://')) {
    throw new Error('Navigate to a webpage before capturing.');
  }

  const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!hasPermission) {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) throw new Error('Permission needed to capture screenshots.');
  }

  const response = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
  if (!response?.dataUrl) throw new Error('Screenshot capture failed.');

  const screenshotKey = `summative-${courseId}-step${stepIndex}-${Date.now()}`;
  await saveScreenshot(screenshotKey, response.dataUrl);

  return { screenshotKey, dataUrl: response.dataUrl, stepIndex, url: pageUrl };
}

/** Submit a summative attempt (all steps captured/submitted). Supports mixed screenshot + text. */
export async function submitSummativeAttempt(courseId, courseGroup, captures, textResponses) {
  const summative = await getSummative(courseId);
  const priorAttempts = await getSummativeAttempts(courseId);
  const profileSummary = await getLearnerProfileSummary();

  const screenshots = (captures || []).map(c => ({ dataUrl: c.dataUrl, stepIndex: c.stepIndex }));
  const texts = (textResponses || []).map(t => ({ text: t.text, stepIndex: t.stepIndex }));

  const result = await orchestrator.assessSummativeAttempt(
    courseGroup, summative, screenshots, priorAttempts, profileSummary, texts
  );

  const attempt = {
    id: `attempt-${courseId}-${Date.now()}`,
    attemptNumber: priorAttempts.length + 1,
    screenshots: (captures || []).map(c => ({ screenshot_key: c.screenshotKey, step_index: c.stepIndex, url: c.url })),
    textResponses: texts,
    criteriaScores: result.criteriaScores,
    overallScore: result.overallScore,
    mastery: result.mastery,
    feedback: result.feedback,
    nextSteps: result.nextSteps || [],
    isBaseline: priorAttempts.length === 0,
    summaryForLearner: result.summaryForLearner || null,
    timestamp: Date.now(),
  };

  await saveSummativeAttempt(courseId, attempt);
  syncInBackground(`summative-attempts:${courseId}`);

  // Update profile in background
  updateProfileOnSummativeAttemptInBackground(courseGroup, attempt);

  return { attempt, mastery: result.mastery };
}

/** Run gap analysis and generate the learning journey. */
export async function generateGapAndJourney(courseId, courseGroup) {
  const summative = await getSummative(courseId);
  const attempts = await getSummativeAttempts(courseId);
  const latestAttempt = attempts[attempts.length - 1];
  const profileSummary = await getLearnerProfileSummary();

  // Gap analysis
  await updateJourneyPhase(courseId, 'gap_analysis');
  const gapResult = await orchestrator.analyzeGaps(
    courseGroup, summative.rubric, latestAttempt, profileSummary
  );
  await saveGapAnalysis(courseId, {
    gaps: gapResult.gaps,
    suggestedFocus: gapResult.suggestedFocus || [],
  });
  syncInBackground(`gap:${courseId}`);

  // Journey generation
  await updateJourneyPhase(courseId, 'journey_generation');
  const journeyResult = await orchestrator.generateJourney(
    courseGroup, courseGroup.units, gapResult, summative.rubric, profileSummary
  );

  await saveJourney(courseId, {
    plan: journeyResult,
    phase: 'journey_overview',
  });
  syncInBackground(`journey:${courseId}`);

  // Initialize unit records for each journey unit
  for (let i = 0; i < journeyResult.units.length; i++) {
    const ju = journeyResult.units[i];
    await saveUnitProgress(ju.unitId, {
      status: 'not_started',
      currentActivityIndex: 0,
      journeyOrder: i,
      rubricCriteria: ju.activities.flatMap(a => a.rubricCriteria || []).filter((v, idx, arr) => arr.indexOf(v) === idx),
      activities: [],
      drafts: [],
    });
  }

  return { gapAnalysis: gapResult, journey: journeyResult };
}

/** Transition to retake orientation (learner sees progress before retaking). */
export async function requestSummativeRetake(courseId) {
  await updateJourneyPhase(courseId, 'retake_ready');
  syncInBackground(`journey:${courseId}`);
}

/** Generate remediation formative activities after a failed retake. */
export async function generateRemediationActivities(courseId, courseGroup, weakCriteria) {
  const summative = await getSummative(courseId);
  const profileSummary = await getLearnerProfileSummary();
  const existingJourney = await getJourney(courseId);

  // Get completed formative summaries
  const completedFormatives = [];
  if (existingJourney?.plan?.units) {
    for (const ju of existingJourney.plan.units) {
      const progress = await getUnitProgress(ju.unitId);
      if (progress) {
        for (const a of progress.activities || []) {
          const drafts = (progress.drafts || []).filter(d => d.activityId === a.id);
          const best = drafts.reduce((max, d) => d.score > max ? d.score : max, 0);
          completedFormatives.push({ type: a.type, goal: a.goal, bestScore: best });
        }
      }
    }
  }

  // Re-analyze gaps with latest attempt
  const attempts = await getSummativeAttempts(courseId);
  const latestAttempt = attempts[attempts.length - 1];
  const gapResult = await orchestrator.analyzeGaps(
    courseGroup, summative.rubric, latestAttempt, profileSummary
  );
  await saveGapAnalysis(courseId, {
    gaps: gapResult.gaps,
    suggestedFocus: gapResult.suggestedFocus || [],
  });

  // Generate new journey segment targeting weak criteria
  const journeyResult = await orchestrator.generateJourney(
    courseGroup, courseGroup.units, gapResult, summative.rubric,
    profileSummary, completedFormatives
  );

  await saveJourney(courseId, {
    plan: journeyResult,
    phase: 'formative_learning',
  });
  syncInBackground(`journey:${courseId}`);

  return { gapAnalysis: gapResult, journey: journeyResult };
}

// -- Unit-level functions (formative activities) ------------------------------

/** Generate the first formative activity for a unit from the journey plan. */
export async function generateFirstActivity(unit, journeyPlan, courseGroup) {
  const profileSummary = await getLearnerProfileSummary();
  const journeyUnit = journeyPlan.units?.find(u => u.unitId === unit.unitId);
  if (!journeyUnit?.activities?.length) throw new Error('No activities planned for this unit.');

  const slot = journeyUnit.activities[0];
  const planContext = {
    workProductDescription: journeyPlan.workProductDescription,
    workProductTool: journeyPlan.workProductTool,
  };

  // Load summative context so activities build toward the exemplar
  const summative = courseGroup ? await getSummative(courseGroup.courseId) : null;
  const summativeContext = summative ? { exemplar: summative.exemplar, task: summative.task, rubric: summative.rubric } : null;

  const generated = await orchestrator.generateNextActivity(
    unit, slot, [], profileSummary, planContext, null, summativeContext, { format: unit.format || 'screenshot' }
  );

  return {
    ...slot,
    instruction: generated.instruction,
    tips: generated.tips,
    messages: [],
  };
}

/** Generate the next formative activity for a unit. */
export async function generateNextActivity(unit, progress, journeyPlan, courseGroup) {
  const profileSummary = await getLearnerProfileSummary();
  const journeyUnit = journeyPlan.units?.find(u => u.unitId === unit.unitId);
  if (!journeyUnit) throw new Error('Unit not found in journey plan.');

  const slot = journeyUnit.activities[progress.currentActivityIndex];
  if (!slot) throw new Error('No more activities planned for this unit.');

  const planContext = {
    workProductDescription: journeyPlan.workProductDescription,
    workProductTool: journeyPlan.workProductTool,
  };

  // Load summative context so activities build toward the exemplar
  const summative = courseGroup ? await getSummative(courseGroup.courseId) : null;
  const summativeContext = summative ? { exemplar: summative.exemplar, task: summative.task, rubric: summative.rubric } : null;

  const progressSummary = progress.activities
    .slice(0, progress.currentActivityIndex)
    .map(a => {
      const drafts = progress.drafts.filter(d => d.activityId === a.id);
      const best = drafts.reduce((max, d) => d.score > max ? d.score : max, 0);
      return `${a.type}: ${a.goal} (best score: ${Math.round(best * 100)}%)`;
    }).join('\n');

  const generated = await orchestrator.generateNextActivity(
    unit, slot, progressSummary, profileSummary, planContext, null, summativeContext, { format: unit.format || 'screenshot' }
  );

  return { ...slot, instruction: generated.instruction, tips: generated.tips, messages: [] };
}

/** Record a formative draft (capture screenshot + assess). */
export async function recordDraft(unit, progress, activity) {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tab?.url || '';

  if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:') || pageUrl.startsWith('edge://')) {
    throw new Error('Navigate to a webpage before recording.');
  }

  const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (!hasPermission) {
    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
    if (!granted) throw new Error('Permission needed to capture screenshots.');
  }

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
    rubricCriteriaScores: result.rubricCriteriaScores || null,
    timestamp: Date.now(),
  };

  // Update progress
  const newProgress = { ...progress };
  newProgress.drafts = [...newProgress.drafts, draft];

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  updateProfileInBackground(result, unit, activity);

  return { newProgress, draft };
}

/** Record a text-based formative draft (submit text + assess). */
export async function recordTextDraft(unit, progress, activity, textResponse) {
  if (!textResponse?.trim()) throw new Error('Please write a response before submitting.');

  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id);
  const result = await orchestrator.assessDraft(unit, activity, null, null, priorDrafts, profileSummary, 'activity-assessment', textResponse);

  const draft = {
    id: `draft-${Date.now()}`,
    activityId: activity.id,
    textResponse,
    feedback: result.feedback,
    strengths: result.strengths,
    improvements: result.improvements,
    score: result.score,
    recommendation: result.recommendation,
    rubricCriteriaScores: result.rubricCriteriaScores || null,
    timestamp: Date.now(),
  };

  const newProgress = { ...progress };
  newProgress.drafts = [...newProgress.drafts, draft];

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  updateProfileInBackground(result, unit, activity);

  return { newProgress, draft };
}

/** Submit a dispute on a draft assessment. */
export async function submitDispute(unit, progress, activity, draft, feedbackText) {
  const screenshotDataUrl = draft.screenshotKey ? await getScreenshot(draft.screenshotKey) : null;
  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id && d.id !== draft.id);
  const previousAssessment = {
    feedback: draft.feedback, strengths: draft.strengths,
    improvements: draft.improvements, score: draft.score,
    recommendation: draft.recommendation, passed: draft.passed || false,
  };

  const result = await orchestrator.reassessDraft(
    unit, activity, screenshotDataUrl, draft.url,
    priorDrafts, profileSummary, previousAssessment, feedbackText,
    'activity-assessment', draft.textResponse || null
  );

  const newDrafts = progress.drafts.map(d => d.id === draft.id ? {
    ...d, feedback: result.feedback, strengths: result.strengths,
    improvements: result.improvements, score: result.score,
    recommendation: result.recommendation, disputed: true,
  } : d);

  const newProgress = { ...progress, drafts: newDrafts };

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  updateProfileFromFeedbackInBackground(feedbackText, unit, activity);

  return { newProgress };
}

/** Ask a Q&A question about an activity. */
export async function askAboutActivity(unit, progress, activity, text, courseGroup) {
  const profileSummary = await getLearnerProfileSummary();
  const latestDraft = progress.drafts.filter(d => d.activityId === activity.id).pop();

  // Load summative context for richer Q&A
  const summative = courseGroup ? await getSummative(courseGroup.courseId) : null;

  const systemPrompt = `You are a helpful learning assistant for 1111 Learn. The learner is working on an activity and has a question. Answer concisely and helpfully.

Activity: ${activity.instruction}
${activity.rubricCriteria ? `\nThis activity targets these rubric criteria: ${activity.rubricCriteria.join(', ')}` : ''}
${summative?.exemplar ? `\nCourse exemplar (what mastery looks like): ${summative.exemplar}` : ''}
${latestDraft ? `\nLatest feedback: ${latestDraft.feedback}` : ''}
${latestDraft?.rubricCriteriaScores ? `\nRubric criteria scores: ${JSON.stringify(latestDraft.rubricCriteriaScores)}` : ''}
Learner profile: ${profileSummary}

Respond in plain text (not JSON). Be brief and direct.`;

  const history = (activity.messages || []).map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: `Learner question: ${text}` });

  const response = await orchestrator.chatWithContext(systemPrompt, history);

  // Update activity messages
  const now = Date.now();
  const newMessages = [...(activity.messages || []),
    { role: 'user', content: text, timestamp: now },
    { role: 'assistant', content: response, timestamp: now + 1 },
  ];

  const newActivities = progress.activities.map(a =>
    a.id === activity.id ? { ...a, messages: newMessages } : a
  );
  const newProgress = { ...progress, activities: newActivities };

  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);

  return { newProgress, response };
}
