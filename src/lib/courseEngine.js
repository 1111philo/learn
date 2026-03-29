/**
 * Course engine — the exemplar-driven learning loop.
 *
 * 0. Course starts: Course Owner generates KB, Guide welcomes
 * 1. Learner clicks "Start Activity" → Activity Creator generates activity
 * 2. Learner submits work
 * 3. Assessor evaluates, writes insights back to course KB
 * 4. Learner clicks "Next Activity" → Activity Creator generates next activity
 * 5. Repeat until exemplar achieved
 * 6. Guide celebrates, profile deep update
 */

import {
  getLearnerProfileSummary,
  getCourseKB, saveCourseKB,
  getActivityKB, saveActivityKB,
  getActivities, saveActivity,
  getDrafts, getDraftsForActivity, saveDraft,
  saveScreenshot,
  saveCourseMessages, getCourseMessages,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { updateCourseKBFromAssessment } from '../../js/courseOwner.js';
import { syncInBackground } from './syncDebounce.js';
import { ensureProfileExists, updateProfileInBackground, updateProfileOnCompletionInBackground } from './profileQueue.js';
import { COURSE_PHASES, MSG_TYPES } from './constants.js';

function ts() { return Date.now(); }

const MAX_ACTIVITIES = 20;

// -- Guide helpers ------------------------------------------------------------

async function buildGuideMessages(course, courseKB, checkpoint, conversationTail, extraContext) {
  const profileSummary = await getLearnerProfileSummary();
  const context = JSON.stringify({
    checkpoint,
    courseName: course.name,
    courseDescription: course.description,
    exemplar: course.exemplar,
    objectives: courseKB?.objectives || [],
    insights: courseKB?.insights || [],
    learnerProfile: profileSummary || 'No profile yet',
    learnerPosition: courseKB?.learnerPosition || 'New learner',
    activitiesCompleted: courseKB?.activitiesCompleted || 0,
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
  return fullMessages;
}

async function callGuide(course, courseKB, checkpoint, conversationTail, extraContext, onChunk) {
  const messages = await buildGuideMessages(course, courseKB, checkpoint, conversationTail, extraContext);
  try {
    return await orchestrator.converseStream('guide', messages, onChunk || (() => {}), 512);
  } catch (err) {
    console.error('[guide] first attempt failed:', err.message || err);
    // Retry once
    try {
      return await orchestrator.converseStream('guide', messages, onChunk || (() => {}), 512);
    } catch (retryErr) {
      console.error('[guide] retry failed:', retryErr.message || retryErr);
      return null;
    }
  }
}

// -- Build activity summary for the Activity Creator --------------------------

function buildPriorActivitiesSummary(activities, drafts) {
  if (!activities.length) return 'None';
  return activities.map(a => {
    const actDrafts = drafts.filter(d => d.activityId === a.id);
    const demonstrates = actDrafts.map(d => d.demonstrates).filter(Boolean).join('; ');
    return `Activity ${a.activityNumber}: ${a.instruction?.split('\n')[0] || 'completed'} — ${demonstrates || 'no submission yet'}`;
  }).join('\n');
}

// -- Course lifecycle ---------------------------------------------------------

/**
 * Start a new course: Course Owner generates KB, Guide welcomes.
 * Does NOT generate the first activity — learner clicks "Start First Activity" for that.
 */
export async function startCourse(courseId, course, onGuideStream) {
  await ensureProfileExists();
  const profileSummary = await getLearnerProfileSummary();

  // Course Owner generates the course KB
  const courseKB = await orchestrator.initializeCourseKB(course, profileSummary);
  courseKB.courseId = courseId;
  courseKB.name = course.name;
  await saveCourseKB(courseId, courseKB);
  syncInBackground(`courseKB:${courseId}`);

  // Guide welcomes
  const guideMsg = await callGuide(course, courseKB, 'course_start', [], {}, onGuideStream);

  const messages = [];
  if (guideMsg) {
    messages.push({
      role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE,
      phase: COURSE_PHASES.COURSE_INTRO, timestamp: ts(),
    });
  }
  messages.push({
    role: 'assistant', content: 'Start First Activity', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.COURSE_INTRO,
    metadata: { action: 'start_activity', label: 'Start First Activity' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  syncInBackground(`messages:${courseId}`);
  return { messages, courseKB, phase: COURSE_PHASES.COURSE_INTRO };
}

/**
 * Generate and display the next activity. Called when learner clicks an action button.
 */
export async function generateNextActivity(courseId, course) {
  const courseKB = await getCourseKB(courseId);
  const profileSummary = await getLearnerProfileSummary();
  const allActivities = await getActivities(courseId);
  const allDrafts = await getDrafts(courseId);
  const nextNum = allActivities.length + 1;
  const priorSummary = buildPriorActivitiesSummary(allActivities, allDrafts);

  const generated = await orchestrator.createActivity(courseKB, profileSummary, nextNum, priorSummary);
  const activityId = `${courseId}-act-${nextNum}`;
  const activity = {
    id: activityId, courseId, activityNumber: nextNum,
    instruction: generated.instruction, tips: generated.tips, createdAt: ts(),
  };
  await saveActivity(activity);
  await saveActivityKB(activityId, courseId, {
    courseId, activityNumber: nextNum,
    instruction: generated.instruction, tips: generated.tips, attempts: [],
  });
  syncInBackground(`activities:${courseId}`, `activityKBs:${courseId}`);

  const messages = [
    {
      role: 'assistant', content: `Activity ${nextNum}`,
      msgType: MSG_TYPES.SECTION, phase: COURSE_PHASES.LEARNING, timestamp: ts(),
    },
    {
      role: 'assistant', content: generated.instruction, msgType: MSG_TYPES.INSTRUCTION,
      phase: COURSE_PHASES.LEARNING,
      metadata: { activityId, activityNumber: nextNum, tips: generated.tips },
      timestamp: ts(),
    },
  ];

  await saveCourseMessages(courseId, messages);
  syncInBackground(`messages:${courseId}`);
  return { messages, activity, phase: COURSE_PHASES.LEARNING };
}

/**
 * Handle a submission (screenshot or text). Assess → enrich KB → show feedback + action.
 */
export async function handleSubmission(courseId, course, activityId, screenshot, textResponse) {
  const courseKB = await getCourseKB(courseId);
  const activities = await getActivities(courseId);
  const currentActivity = activities.find(a => a.id === activityId);
  if (!currentActivity) throw new Error('Activity not found.');

  const profileSummary = await getLearnerProfileSummary();
  const priorDrafts = await getDraftsForActivity(activityId);

  // Save screenshot if provided
  let screenshotKey = null;
  let screenshotDataUrl = null;
  if (screenshot?.dataUrl) {
    screenshotKey = `activity-${activityId}-${ts()}`;
    await saveScreenshot(screenshotKey, screenshot.dataUrl);
    screenshotDataUrl = screenshot.dataUrl;
  }

  // Assess
  const result = await orchestrator.assessSubmission(
    courseKB,
    currentActivity.instruction,
    priorDrafts,
    profileSummary,
    screenshotDataUrl,
    textResponse
  );

  // Save draft
  const draft = {
    id: `draft-${ts()}`,
    activityId,
    courseId,
    screenshotKey,
    textResponse: textResponse || null,
    url: screenshot?.url || null,
    achieved: result.achieved,
    demonstrates: result.demonstrates,
    moved: result.moved || null,
    needed: result.needed,
    strengths: result.strengths,
    attempt: priorDrafts.length + 1,
    timestamp: ts(),
  };
  await saveDraft(draft);
  syncInBackground(`drafts:${courseId}`);

  // Update activity KB (stores attempt history for assessor context)
  const actKB = await getActivityKB(activityId) || {
    courseId, activityNumber: currentActivity.activityNumber,
    instruction: currentActivity.instruction, tips: currentActivity.tips, attempts: [],
  };
  actKB.attempts.push({
    attempt: draft.attempt, achieved: result.achieved,
    demonstrates: result.demonstrates, strengths: result.strengths,
    moved: result.moved, needed: result.needed,
  });
  await saveActivityKB(activityId, courseId, actKB);
  syncInBackground(`activityKBs:${courseId}`);

  // Enrich course KB
  const enrichedKB = updateCourseKBFromAssessment(courseKB, result);
  await saveCourseKB(courseId, enrichedKB);
  syncInBackground(`courseKB:${courseId}`);

  // Incremental profile update (code, no LLM call)
  updateProfileInBackground(courseId, result);

  // Build messages
  const messages = [];
  messages.push({
    role: 'user', content: textResponse || '', msgType: MSG_TYPES.SUBMISSION,
    phase: COURSE_PHASES.LEARNING,
    metadata: { screenshotKey, url: screenshot?.url, textResponse, timestamp: draft.timestamp },
    timestamp: draft.timestamp,
  });
  messages.push({
    role: 'assistant', content: '', msgType: MSG_TYPES.FEEDBACK,
    phase: COURSE_PHASES.LEARNING,
    metadata: draft,
    timestamp: ts(),
  });

  // Check completion: assessor says achieved, or hit activity cap
  const achieved = result.achieved || enrichedKB.activitiesCompleted >= MAX_ACTIVITIES;

  if (achieved) {
    if (enrichedKB.status !== 'completed') {
      enrichedKB.status = 'completed';
      await saveCourseKB(courseId, enrichedKB);
      syncInBackground(`courseKB:${courseId}`);
    }
    const guideMsg = await callGuide(course, enrichedKB, 'course_complete', [], {});
    if (guideMsg) {
      messages.push({
        role: 'assistant', content: guideMsg, msgType: MSG_TYPES.GUIDE,
        phase: COURSE_PHASES.COMPLETED, timestamp: ts(),
      });
    }
    messages.push({
      role: 'assistant', content: 'Next Course', msgType: MSG_TYPES.ACTION,
      phase: COURSE_PHASES.COMPLETED,
      metadata: { action: 'back_to_courses', label: 'Next Course' },
      timestamp: ts(),
    });

    updateProfileOnCompletionInBackground(enrichedKB, course);

    await saveCourseMessages(courseId, messages);
    syncInBackground(`messages:${courseId}`);
    return { messages, draft, phase: COURSE_PHASES.COMPLETED, achieved: true };
  }

  // Guide gives brief advice after assessment
  const guideAdvice = await callGuide(course, enrichedKB, 'post_assessment', [], {
    demonstrates: result.demonstrates,
    strengths: result.strengths,
    needed: result.needed,
    moved: result.moved,
    activityNumber: currentActivity.activityNumber,
  });
  if (guideAdvice) {
    messages.push({
      role: 'assistant', content: guideAdvice, msgType: MSG_TYPES.GUIDE,
      phase: COURSE_PHASES.LEARNING, timestamp: ts(),
    });
  }

  // Not achieved → "Next Activity" button
  messages.push({
    role: 'assistant', content: 'Next Activity', msgType: MSG_TYPES.ACTION,
    phase: COURSE_PHASES.LEARNING,
    metadata: { action: 'next_activity', label: 'Next Activity' },
    timestamp: ts(),
  });

  await saveCourseMessages(courseId, messages);
  syncInBackground(`messages:${courseId}`);
  return { messages, draft, phase: COURSE_PHASES.LEARNING, achieved: false };
}

/**
 * Ask the guide a question. Streams the response.
 */
export async function askGuide(courseId, course, text, currentActivity, onStream) {
  const courseKB = await getCourseKB(courseId);

  const allMsgs = await getCourseMessages(courseId);
  const recentMsgs = allMsgs.slice(-10).map(m => ({ role: m.role, content: m.content }));
  const conversationTail = [...recentMsgs, { role: 'user', content: text }];

  const extraContext = {};
  if (currentActivity) {
    extraContext.currentActivity = {
      instruction: currentActivity.instruction,
      tips: currentActivity.tips,
    };
  }

  const guideMsg = await callGuide(course, courseKB, 'followup', conversationTail, extraContext, onStream);

  const messages = [
    { role: 'user', content: text, msgType: MSG_TYPES.USER, phase: COURSE_PHASES.LEARNING, timestamp: ts() },
    { role: 'assistant', content: guideMsg || 'Sorry, I wasn\'t able to respond. Please try again.', msgType: MSG_TYPES.GUIDE, phase: COURSE_PHASES.LEARNING, timestamp: ts() },
  ];
  await saveCourseMessages(courseId, messages);
  syncInBackground(`messages:${courseId}`);
  return { messages };
}
