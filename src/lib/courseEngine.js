/**
 * Course engine — unified state machine for the single-chat course experience.
 * Manages phase transitions, calls agents via orchestrator, appends messages
 * to the course conversation, and calls the guide to narrate transitions.
 */

import {
  getUnitProgress, saveUnitProgress, getLearnerProfileSummary,
  saveScreenshot, getScreenshot,
  getSummative, saveSummative, getSummativeAttempts, saveSummativeAttempt,
  saveGapAnalysis, getJourney, saveJourney, updateJourneyPhase,
  saveCourseMessage, saveCourseMessages, getCourseMessages, clearCourseMessages,
  getSummativeCaptureState, saveSummativeCaptureState, clearSummativeCaptureState,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from './syncDebounce.js';
import {
  updateProfileInBackground, updateProfileOnSummativeAttemptInBackground,
  updateProfileOnMasteryInBackground, ensureProfileExists,
} from './profileQueue.js';
import { COURSE_PHASES, GUIDE_CHECKPOINTS, MSG_TYPES } from './constants.js';

// -- Helpers ------------------------------------------------------------------

function collectObjectives(courseGroup) {
  return (courseGroup.units || []).flatMap(u => u.learningObjectives || []);
}

function ts() { return Date.now(); }

/** Call the guide agent and return its message text. Falls back to a default on error. */
async function callGuide(courseGroup, checkpoint, conversationTail, extraContext) {
  const profileSummary = await getLearnerProfileSummary();
  const context = JSON.stringify({
    checkpoint,
    courseName: courseGroup.name,
    learnerProfile: profileSummary || 'No profile yet',
    ...extraContext,
  });
  const fullMessages = [
    { role: 'user', content: context },
    { role: 'assistant', content: 'Ready.' },
    ...conversationTail,
  ];
  if (conversationTail.length === 0) {
    fullMessages.push({ role: 'user', content: 'Orient me.' });
  }
  try {
    const result = await orchestrator.converse('guide', fullMessages, 512);
    return result.message;
  } catch {
    return null; // caller decides fallback
  }
}

/** Build a guide context object from available course state. */
function buildGuideContext(courseGroup, opts = {}) {
  const ctx = {
    courseDescription: courseGroup.description,
    units: (courseGroup.units || []).map(u => ({
      name: u.name, format: u.format, objectiveCount: u.learningObjectives.length,
    })),
  };
  if (opts.summative) {
    ctx.rubricCriteria = opts.summative.rubric?.map(c => c.name);
    ctx.exemplar = opts.summative.exemplar;
  }
  if (opts.attempt) {
    ctx.latestScores = opts.attempt.criteriaScores;
    ctx.overallScore = opts.attempt.overallScore;
    ctx.mastery = opts.attempt.mastery;
    ctx.isBaseline = opts.attempt.isBaseline;
  }
  if (opts.journey) {
    ctx.journeyUnits = opts.journey.plan?.units?.map(u => ({
      unitId: u.unitId, activities: u.activities?.length || 0,
    }));
  }
  if (opts.unit) {
    ctx.currentUnit = { name: opts.unit.name, format: opts.unit.format };
  }
  if (opts.activity) {
    ctx.currentActivity = { type: opts.activity.type, goal: opts.activity.goal };
  }
  return ctx;
}

// -- Course lifecycle ---------------------------------------------------------

/** Initialize a new course conversation with the guide intro. No API calls except guide. */
export async function startCourse(courseId, courseGroup) {
  await ensureProfileExists();

  const guideMsg = await callGuide(courseGroup, GUIDE_CHECKPOINTS.COURSE_INTRO, [], buildGuideContext(courseGroup));

  const messages = [];
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.COURSE_INTRO, timestamp: ts() });
  }
  messages.push({
    role: 'assistant', content: 'Start Diagnostic Assessment', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.COURSE_INTRO,
    metadata: { action: 'start_diagnostic', label: 'Start Diagnostic Assessment' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  await saveJourney(courseId, { plan: {}, phase: COURSE_PHASES.COURSE_INTRO });
  syncInBackground(`journey:${courseId}`);

  return { messages, phase: COURSE_PHASES.COURSE_INTRO };
}

/** Generate summative + begin diagnostic. Returns new messages to append. */
export async function startDiagnostic(courseId, courseGroup) {
  const profileSummary = await getLearnerProfileSummary();
  const allObjectives = collectObjectives(courseGroup);

  // Generate summative
  const summativeResult = await orchestrator.generateSummative(courseGroup, allObjectives, profileSummary);
  const summativeData = {
    task: summativeResult.task,
    rubric: summativeResult.rubric,
    exemplar: summativeResult.exemplar,
    tool: summativeResult.task?.tool || null,
    courseIntro: summativeResult.courseIntro || null,
    summaryForLearner: summativeResult.summaryForLearner || null,
    createdAt: ts(),
  };
  await saveSummative(courseId, summativeData);
  syncInBackground(`summative:${courseId}`);

  await updateJourneyPhase(courseId, COURSE_PHASES.BASELINE_ATTEMPT);
  syncInBackground(`journey:${courseId}`);

  const steps = summativeData.task?.steps || [];
  const messages = [];

  messages.push({ role: 'assistant', content: 'Diagnostic Assessment', msgType: MSG_TYPES.SECTION, phase: COURSE_PHASES.BASELINE_ATTEMPT, timestamp: ts() });

  // Present first step
  if (steps.length > 0) {
    const step = steps[0];
    messages.push({
      role: 'assistant',
      content: `Step 1 of ${steps.length}: ${step.instruction}`,
      msgType: MSG_TYPES.INSTRUCTION,
      phase: COURSE_PHASES.BASELINE_ATTEMPT,
      metadata: { stepIndex: 0, totalSteps: steps.length, format: step.format },
      timestamp: ts(),
    });
  }

  await saveCourseMessages(courseId, messages);
  return { messages, summative: summativeData, phase: COURSE_PHASES.BASELINE_ATTEMPT };
}

/** Submit all summative captures/text for assessment. Returns new messages. */
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
    id: `attempt-${courseId}-${ts()}`,
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
    timestamp: ts(),
  };

  await saveSummativeAttempt(courseId, attempt);
  syncInBackground(`summative-attempts:${courseId}`);
  updateProfileOnSummativeAttemptInBackground(courseGroup, attempt);

  // Build result messages
  const messages = [];
  const checkpoint = attempt.isBaseline ? GUIDE_CHECKPOINTS.BASELINE_RESULTS : GUIDE_CHECKPOINTS.RETAKE_RESULTS;
  const phase = attempt.isBaseline ? COURSE_PHASES.BASELINE_RESULTS : (result.mastery ? COURSE_PHASES.COMPLETED : COURSE_PHASES.JOURNEY_OVERVIEW);

  messages.push({
    role: 'assistant', content: '', msgType: MSG_TYPES.RUBRIC_RESULT,
    phase, metadata: attempt, timestamp: ts(),
  });

  const guideMsg = await callGuide(courseGroup, checkpoint, [],
    buildGuideContext(courseGroup, { summative, attempt }));
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase, timestamp: ts() });
  }

  if (result.mastery) {
    await updateJourneyPhase(courseId, COURSE_PHASES.COMPLETED);
    updateProfileOnMasteryInBackground(courseGroup, attempt, []);
    messages.push({
      role: 'assistant', content: 'Next Course', msgType: MSG_TYPES.ACTION,
      phase: COURSE_PHASES.COMPLETED,
      metadata: { action: 'back_to_courses', label: 'Next Course' },
      timestamp: ts(),
    });
  } else if (attempt.isBaseline) {
    await updateJourneyPhase(courseId, COURSE_PHASES.BASELINE_RESULTS);
    messages.push({
      role: 'assistant', content: 'Build My Learning Path', msgType: MSG_TYPES.ACTION,
      phase: COURSE_PHASES.BASELINE_RESULTS,
      metadata: { action: 'build_journey', label: 'Build My Learning Path' },
      timestamp: ts(),
    });
  }

  await saveCourseMessages(courseId, messages);
  syncInBackground(`journey:${courseId}`);

  return { messages, attempt, phase };
}

/** Run gap analysis + journey generation. Returns new messages. */
export async function buildJourney(courseId, courseGroup) {
  const summative = await getSummative(courseId);
  const attempts = await getSummativeAttempts(courseId);
  const latestAttempt = attempts[attempts.length - 1];
  const profileSummary = await getLearnerProfileSummary();

  // Gap analysis
  const gapResult = await orchestrator.analyzeGaps(courseGroup, summative.rubric, latestAttempt, profileSummary);
  await saveGapAnalysis(courseId, { gaps: gapResult.gaps, suggestedFocus: gapResult.suggestedFocus || [] });
  syncInBackground(`gap:${courseId}`);

  // Journey generation
  const journeyResult = await orchestrator.generateJourney(
    courseGroup, courseGroup.units, gapResult, summative.rubric, profileSummary
  );
  await saveJourney(courseId, { plan: journeyResult, phase: COURSE_PHASES.JOURNEY_OVERVIEW });
  syncInBackground(`journey:${courseId}`);

  // Initialize unit records
  for (let i = 0; i < journeyResult.units.length; i++) {
    const ju = journeyResult.units[i];
    await saveUnitProgress(ju.unitId, {
      status: 'not_started', currentActivityIndex: 0, journeyOrder: i,
      rubricCriteria: ju.activities.flatMap(a => a.rubricCriteria || []).filter((v, idx, arr) => arr.indexOf(v) === idx),
      activities: [], drafts: [],
    });
  }

  const messages = [];
  messages.push({ role: 'assistant', content: 'Your Learning Path', msgType: MSG_TYPES.SECTION, phase: COURSE_PHASES.JOURNEY_OVERVIEW, timestamp: ts() });

  const guideMsg = await callGuide(courseGroup, GUIDE_CHECKPOINTS.JOURNEY_OVERVIEW, [],
    buildGuideContext(courseGroup, { summative, attempt: latestAttempt, journey: { plan: journeyResult } }));
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.JOURNEY_OVERVIEW, timestamp: ts() });
  }

  messages.push({
    role: 'assistant', content: 'Start Learning', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.JOURNEY_OVERVIEW,
    metadata: { action: 'start_learning', label: 'Start Learning' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, journey: journeyResult, phase: COURSE_PHASES.JOURNEY_OVERVIEW };
}

/** Begin formative learning — generate and present first activity of first unit. */
export async function startLearning(courseId, courseGroup) {
  await updateJourneyPhase(courseId, COURSE_PHASES.FORMATIVE_LEARNING);
  syncInBackground(`journey:${courseId}`);

  const journey = await getJourney(courseId);
  if (!journey?.plan?.units?.length) throw new Error('No learning journey found.');

  const firstJU = journey.plan.units[0];
  const unit = courseGroup.units?.find(u => u.unitId === firstJU.unitId);
  if (!unit) throw new Error('Unit not found in course.');

  return await startUnit(courseId, courseGroup, unit, journey.plan);
}

/** Start a specific unit — generate first activity, guide intro. */
export async function startUnit(courseId, courseGroup, unit, journeyPlan) {
  const profileSummary = await getLearnerProfileSummary();
  const journeyUnit = journeyPlan.units?.find(u => u.unitId === unit.unitId);
  if (!journeyUnit?.activities?.length) throw new Error('No activities planned for this unit.');

  const slot = journeyUnit.activities[0];
  const summative = await getSummative(courseId);
  const summativeContext = summative ? { exemplar: summative.exemplar, task: summative.task, rubric: summative.rubric } : null;
  const planContext = { workProductDescription: journeyPlan.workProductDescription, workProductTool: journeyPlan.workProductTool };

  const generated = await orchestrator.generateNextActivity(
    unit, slot, [], profileSummary, planContext, null, summativeContext, { format: unit.format || 'screenshot' }
  );

  const activity = { ...slot, instruction: generated.instruction, tips: generated.tips, messages: [] };

  // Save unit progress with this first activity
  const progress = await getUnitProgress(unit.unitId) || {
    status: 'not_started', currentActivityIndex: 0, activities: [], drafts: [],
  };
  progress.status = 'in_progress';
  progress.startedAt = progress.startedAt || ts();
  progress.activities = [activity];
  progress.currentActivityIndex = 0;
  await saveUnitProgress(unit.unitId, progress);
  syncInBackground(`progress:${unit.unitId}`);

  // Build messages
  const messages = [];
  messages.push({
    role: 'assistant', content: unit.name, msgType: MSG_TYPES.SECTION,
    phase: COURSE_PHASES.FORMATIVE_LEARNING, metadata: { unitId: unit.unitId },
    timestamp: ts(),
  });

  const guideMsg = await callGuide(courseGroup, GUIDE_CHECKPOINTS.UNIT_START, [],
    buildGuideContext(courseGroup, { summative, unit, activity }));
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.FORMATIVE_LEARNING, timestamp: ts() });
  }

  messages.push({
    role: 'assistant', content: activity.instruction, msgType: MSG_TYPES.INSTRUCTION,
    phase: COURSE_PHASES.FORMATIVE_LEARNING,
    metadata: { unitId: unit.unitId, activityId: activity.id, type: activity.type, goal: activity.goal, rubricCriteria: activity.rubricCriteria, tips: activity.tips },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, unit, activity, progress, phase: COURSE_PHASES.FORMATIVE_LEARNING };
}

/** Record a screenshot draft for the current formative activity.
 *  screenshot: { dataUrl, url } — pre-captured by ComposeBar.
 */
export async function recordScreenshotDraft(courseId, unit, progress, activity, screenshot) {
  const { dataUrl, url: pageUrl } = screenshot;
  const screenshotKey = `activity-${unit.unitId}-${activity.id}-${ts()}`;
  await saveScreenshot(screenshotKey, dataUrl);

  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id);
  const result = await orchestrator.assessDraft(unit, activity, dataUrl, pageUrl, priorDrafts, profileSummary);

  const draft = {
    id: `draft-${ts()}`, activityId: activity.id, screenshotKey, url: pageUrl,
    feedback: result.feedback, strengths: result.strengths, improvements: result.improvements,
    score: result.score, recommendation: result.recommendation,
    rubricCriteriaScores: result.rubricCriteriaScores || null, timestamp: ts(),
  };

  const newProgress = { ...progress, drafts: [...progress.drafts, draft] };
  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  updateProfileInBackground(result, unit, activity);

  // Build messages
  const messages = [];
  messages.push({
    role: 'user', content: '', msgType: MSG_TYPES.SUBMISSION,
    phase: COURSE_PHASES.FORMATIVE_LEARNING,
    metadata: { screenshotKey, url: pageUrl, timestamp: draft.timestamp },
    timestamp: draft.timestamp,
  });
  messages.push({
    role: 'assistant', content: '', msgType: MSG_TYPES.FEEDBACK,
    phase: COURSE_PHASES.FORMATIVE_LEARNING,
    metadata: draft,
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, draft, newProgress };
}

/** Record a text draft for the current formative activity. */
export async function recordTextDraft(courseId, unit, progress, activity, textResponse) {
  if (!textResponse?.trim()) throw new Error('Please write a response before submitting.');

  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = progress.drafts.filter(d => d.activityId === activity.id);
  const result = await orchestrator.assessDraft(unit, activity, null, null, priorDrafts, profileSummary, 'activity-assessment', textResponse);

  const draft = {
    id: `draft-${ts()}`, activityId: activity.id, textResponse,
    feedback: result.feedback, strengths: result.strengths, improvements: result.improvements,
    score: result.score, recommendation: result.recommendation,
    rubricCriteriaScores: result.rubricCriteriaScores || null, timestamp: ts(),
  };

  const newProgress = { ...progress, drafts: [...progress.drafts, draft] };
  await saveUnitProgress(unit.unitId, newProgress);
  syncInBackground(`progress:${unit.unitId}`);
  updateProfileInBackground(result, unit, activity);

  const messages = [];
  messages.push({
    role: 'user', content: textResponse, msgType: MSG_TYPES.SUBMISSION,
    phase: COURSE_PHASES.FORMATIVE_LEARNING, metadata: { textResponse, timestamp: draft.timestamp },
    timestamp: draft.timestamp,
  });
  messages.push({
    role: 'assistant', content: '', msgType: MSG_TYPES.FEEDBACK,
    phase: COURSE_PHASES.FORMATIVE_LEARNING, metadata: draft, timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, draft, newProgress };
}

/** Advance to next activity in unit, or next unit, or retake ready. Returns new messages. */
export async function advanceActivity(courseId, courseGroup, unitId, progress, journeyPlan) {
  const journeyUnit = journeyPlan.units?.find(u => u.unitId === unitId);
  if (!journeyUnit) throw new Error('Unit not found in journey.');

  const nextIndex = progress.currentActivityIndex + 1;
  const unit = courseGroup.units?.find(u => u.unitId === unitId);

  // More activities in this unit?
  if (nextIndex < journeyUnit.activities.length) {
    const slot = journeyUnit.activities[nextIndex];
    const profileSummary = await getLearnerProfileSummary();
    const summative = await getSummative(courseId);
    const summativeContext = summative ? { exemplar: summative.exemplar, task: summative.task, rubric: summative.rubric } : null;
    const planContext = { workProductDescription: journeyPlan.workProductDescription, workProductTool: journeyPlan.workProductTool };

    const progressSummary = progress.activities.slice(0, nextIndex).map(a => {
      const drafts = progress.drafts.filter(d => d.activityId === a.id);
      const best = drafts.reduce((max, d) => d.score > max ? d.score : max, 0);
      return `${a.type}: ${a.goal} (best score: ${Math.round(best * 100)}%)`;
    }).join('\n');

    const generated = await orchestrator.generateNextActivity(
      unit, slot, progressSummary, profileSummary, planContext, null, summativeContext, { format: unit.format || 'screenshot' }
    );

    const activity = { ...slot, instruction: generated.instruction, tips: generated.tips, messages: [] };
    const newProgress = { ...progress, currentActivityIndex: nextIndex, activities: [...progress.activities, activity] };
    await saveUnitProgress(unitId, newProgress);
    syncInBackground(`progress:${unitId}`);

    const messages = [];
    messages.push({
      role: 'assistant', content: activity.instruction, msgType: MSG_TYPES.INSTRUCTION,
      phase: COURSE_PHASES.FORMATIVE_LEARNING,
      metadata: { unitId, activityId: activity.id, type: activity.type, goal: activity.goal, rubricCriteria: activity.rubricCriteria, tips: activity.tips },
      timestamp: ts(),
    });

    await saveCourseMessages(courseId, messages);
    return { messages, activity, progress: newProgress, done: false };
  }

  // Unit complete — mark it
  const completedProgress = { ...progress, status: 'completed', completedAt: ts() };
  await saveUnitProgress(unitId, completedProgress);
  syncInBackground(`progress:${unitId}`);

  // Find next unit in journey
  const currentJourneyIndex = journeyPlan.units.findIndex(u => u.unitId === unitId);
  const nextJU = journeyPlan.units[currentJourneyIndex + 1];

  if (nextJU) {
    const nextUnit = courseGroup.units?.find(u => u.unitId === nextJU.unitId);
    if (nextUnit) {
      return await startUnit(courseId, courseGroup, nextUnit, journeyPlan);
    }
  }

  // All units done — retake ready
  await updateJourneyPhase(courseId, COURSE_PHASES.RETAKE_READY);
  syncInBackground(`journey:${courseId}`);

  const messages = [];
  const summative = await getSummative(courseId);
  const attempts = await getSummativeAttempts(courseId);
  const guideMsg = await callGuide(courseGroup, GUIDE_CHECKPOINTS.RETAKE_READY, [],
    buildGuideContext(courseGroup, { summative, attempt: attempts[attempts.length - 1] }));
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.RETAKE_READY, timestamp: ts() });
  }
  messages.push({
    role: 'assistant', content: 'Start Assessment', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.RETAKE_READY,
    metadata: { action: 'start_retake', label: 'Start Assessment' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, done: true, phase: COURSE_PHASES.RETAKE_READY };
}

/** Start a summative retake. */
export async function startRetake(courseId) {
  await updateJourneyPhase(courseId, COURSE_PHASES.SUMMATIVE_RETAKE);
  syncInBackground(`journey:${courseId}`);

  const summative = await getSummative(courseId);
  const steps = summative?.task?.steps || [];
  const messages = [];

  messages.push({ role: 'assistant', content: 'Summative Assessment', msgType: MSG_TYPES.SECTION, phase: COURSE_PHASES.SUMMATIVE_RETAKE, timestamp: ts() });

  if (steps.length > 0) {
    messages.push({
      role: 'assistant', content: `Step 1 of ${steps.length}: ${steps[0].instruction}`,
      msgType: MSG_TYPES.INSTRUCTION, phase: COURSE_PHASES.SUMMATIVE_RETAKE,
      metadata: { stepIndex: 0, totalSteps: steps.length, format: steps[0].format },
      timestamp: ts(),
    });
  }

  await saveCourseMessages(courseId, messages);
  return { messages, summative, phase: COURSE_PHASES.SUMMATIVE_RETAKE };
}

/** Generate remediation activities after a failed retake. */
export async function buildRemediation(courseId, courseGroup, attempt) {
  const summative = await getSummative(courseId);
  const profileSummary = await getLearnerProfileSummary();
  const existingJourney = await getJourney(courseId);

  const completedFormatives = [];
  if (existingJourney?.plan?.units) {
    for (const ju of existingJourney.plan.units) {
      const prog = await getUnitProgress(ju.unitId);
      if (prog) {
        for (const a of prog.activities || []) {
          const drafts = (prog.drafts || []).filter(d => d.activityId === a.id);
          const best = drafts.reduce((max, d) => d.score > max ? d.score : max, 0);
          completedFormatives.push({ type: a.type, goal: a.goal, bestScore: best });
        }
      }
    }
  }

  const gapResult = await orchestrator.analyzeGaps(courseGroup, summative.rubric, attempt, profileSummary);
  await saveGapAnalysis(courseId, { gaps: gapResult.gaps, suggestedFocus: gapResult.suggestedFocus || [] });

  const journeyResult = await orchestrator.generateJourney(
    courseGroup, courseGroup.units, gapResult, summative.rubric, profileSummary, completedFormatives
  );
  await saveJourney(courseId, { plan: journeyResult, phase: COURSE_PHASES.JOURNEY_OVERVIEW });
  syncInBackground(`journey:${courseId}`);

  for (let i = 0; i < journeyResult.units.length; i++) {
    const ju = journeyResult.units[i];
    await saveUnitProgress(ju.unitId, {
      status: 'not_started', currentActivityIndex: 0, journeyOrder: i,
      rubricCriteria: ju.activities.flatMap(a => a.rubricCriteria || []).filter((v, idx, arr) => arr.indexOf(v) === idx),
      activities: [], drafts: [],
    });
  }

  const messages = [];
  const guideMsg = await callGuide(courseGroup, GUIDE_CHECKPOINTS.REMEDIATION_START, [],
    buildGuideContext(courseGroup, { summative, attempt, journey: { plan: journeyResult } }));
  if (guideMsg) {
    messages.push({ role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.JOURNEY_OVERVIEW, timestamp: ts() });
  }
  messages.push({
    role: 'assistant', content: 'Continue Learning', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.JOURNEY_OVERVIEW,
    metadata: { action: 'start_learning', label: 'Continue Learning' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  return { messages, journey: journeyResult, phase: COURSE_PHASES.JOURNEY_OVERVIEW };
}

/** Ask a Q&A question during formative learning (routes to activity Q&A agent). */
export async function askQuestion(courseId, courseGroup, unit, activity, text, progress) {
  const profileSummary = await getLearnerProfileSummary();
  const latestDraft = progress.drafts.filter(d => d.activityId === activity.id).pop();
  const summative = await getSummative(courseId);

  const systemPrompt = `You are a helpful learning assistant for 1111 Learn. The learner is working on an activity and has a question. Answer concisely and helpfully.

Activity: ${activity.instruction}
${activity.rubricCriteria ? `\nThis activity targets these rubric criteria: ${activity.rubricCriteria.join(', ')}` : ''}
${summative?.exemplar ? `\nCourse exemplar: ${summative.exemplar}` : ''}
${latestDraft ? `\nLatest feedback: ${latestDraft.feedback}` : ''}
Learner profile: ${profileSummary}

Respond in plain text (not JSON). Be brief and direct.`;

  const history = [{ role: 'user', content: text }];
  const response = await orchestrator.chatWithContext(systemPrompt, history);

  const messages = [
    { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: COURSE_PHASES.FORMATIVE_LEARNING, timestamp: ts() },
    { role: 'assistant', content: response, msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.FORMATIVE_LEARNING, timestamp: ts() },
  ];
  await saveCourseMessages(courseId, messages);
  return { messages, response };
}

/** Ask a Q&A question during orientation (routes to guide agent). */
export async function askGuide(courseId, courseGroup, text, priorGuideMessages, guideContext) {
  const userMsg = { role: 'user', content: text, timestamp: ts() };
  const conversationTail = [...priorGuideMessages, userMsg];

  const guideMsg = await callGuide(courseGroup, 'followup', conversationTail, guideContext);

  const messages = [
    { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: null, timestamp: ts() },
    { role: 'assistant', content: guideMsg || 'I\'m not sure about that. Try clicking the action button to continue.', msgType: MSG_TYPES.GUIDE, phase: null, timestamp: ts() },
  ];
  await saveCourseMessages(courseId, messages);
  return { messages };
}
