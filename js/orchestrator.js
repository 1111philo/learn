/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { callClaude, parseResponse, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { isLoggedIn, authenticatedFetch } from './auth.js';
import { getApiKey } from './storage.js';
import {
  validateSafety, validateActivity, validateAssessment,
  validateSummative, validateSummativeAssessment, validateGapAnalysis, validateJourney,
} from './validators.js';

// Prompt cache (loaded once per session)
const promptCache = {};

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const url = chrome.runtime.getURL(`prompts/${name}.md`);
  const resp = await fetch(url);
  const text = await resp.text();
  promptCache[name] = text;
  return text;
}

function parseJSON(text) {
  // Try parsing as-is first
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  // Strip markdown fencing
  const fenced = trimmed.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  try { return JSON.parse(fenced); } catch { /* continue */ }

  // Extract first JSON object from anywhere in the text
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }

  throw new ApiError('parse', 'Failed to parse agent JSON response.');
}

/** Call an agent function with validation. Retries once on validation failure. */
async function callWithValidation(agentFn, validator, agentName) {
  const parsed = await agentFn();
  const error = validator(parsed);
  if (!error) {

    return parsed;
  }
  console.error(`[1111] Validation failed (retrying): ${error}`);

  // Retry once
  const retry = await agentFn();
  const retryError = validator(retry);
  if (retryError) {
    console.error(`[1111] Validation failed after retry: ${retryError}`);
    if (retryError.includes('unsafe')) throw new ApiError('safety', retryError);
  }
  return retry;
}

/**
 * Route an API call to the right backend based on auth state and configuration.
 * Priority: logged in (learn-service Bedrock) > direct Anthropic API key.
 */
async function callApi({ model, systemPrompt, messages, maxTokens = 1024 }) {
  // 1. Logged in → learn-service Bedrock proxy (JWT auth)
  if (await isLoggedIn()) {
    const resp = await authenticatedFetch('/v1/ai/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
    });
    return parseResponse(resp);
  }

  // 2. Direct Anthropic API with user's key
  const apiKey = await getApiKey();
  if (apiKey) {
    return callClaude({ apiKey, model, systemPrompt, messages, maxTokens });
  }

  throw new ApiError('invalid_key', 'No AI provider configured. Sign in or add your API key in Settings.');
}

/**
 * Check if the orchestrator is ready (has a usable AI provider).
 */
export async function isReady() {
  if (await isLoggedIn()) return true;
  const key = await getApiKey();
  return !!key;
}

/**
 * Multi-turn conversation agent. Send a system prompt + message history,
 * get back a parsed JSON response (typically { message, done, ...extras }).
 */
export async function converse(promptName, messages, maxTokens = 512, { model } = {}) {
  const systemPrompt = await loadPrompt(promptName);

  const { content } = await callApi({
    model: model || MODEL_LIGHT,
    systemPrompt,
    messages,
    maxTokens
  });

  const parsed = parseJSON(content);
  return parsed;
}

/**
 * Free-form chat with an inline system prompt. Returns raw text (not parsed JSON).
 */
export async function chatWithContext(systemPrompt, messages, maxTokens = 512) {
  const { content } = await callApi({ model: MODEL_LIGHT, systemPrompt, messages, maxTokens });
  return content;
}

/**
 * Initialize a learner profile from onboarding name + statement.
 */
export async function initializeLearnerProfile(name, statement) {
  const systemPrompt = await loadPrompt('onboarding-profile');

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: JSON.stringify({ name, statement }) }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  return parsed;
}

// -- Summative ----------------------------------------------------------------

/**
 * Generate a summative assessment (task + rubric + exemplar) for a course.
 */
export async function generateSummative(course, allObjectives, profileSummary, personalizationNotes) {
  const systemPrompt = await loadPrompt('summative-generation');

  const userContent = JSON.stringify({
    courseName: course.name,
    courseDescription: course.description,
    learningObjectives: allObjectives,
    learnerProfile: profileSummary || 'No profile yet',
    personalizationNotes: personalizationNotes || null,
  });

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateSummative, 'summative-generation');
}

/**
 * Assess a summative attempt (multi-capture, vision-based).
 * screenshots is an array of { dataUrl, stepIndex }.
 */
export async function assessSummativeAttempt(course, summative, screenshots, priorAttempts, profileSummary) {
  const systemPrompt = await loadPrompt('diagnostic-assessment');

  const contentParts = [];

  // Text context
  contentParts.push({
    type: 'text',
    text: JSON.stringify({
      courseName: course.name,
      task: summative.task,
      rubric: summative.rubric,
      attemptNumber: (priorAttempts?.length || 0) + 1,
      isBaseline: !priorAttempts?.length,
      priorAttemptScores: priorAttempts?.length
        ? priorAttempts[priorAttempts.length - 1].criteriaScores
        : null,
      learnerProfile: profileSummary || 'No profile yet',
    })
  });

  // Add image blocks for each step screenshot
  for (const ss of screenshots) {
    if (ss.dataUrl) {
      const match = ss.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        contentParts.push({
          type: 'text',
          text: `Screenshot for step ${ss.stepIndex + 1}:`
        });
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2]
          }
        });
      }
    }
  }

  const bestPrior = priorAttempts?.length ? priorAttempts[priorAttempts.length - 1] : null;

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_HEAVY,
      systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
      maxTokens: 2048
    });
    return parseJSON(content);
  };

  return callWithValidation(
    callAgent,
    (p) => validateSummativeAssessment(p, bestPrior),
    'summative-assessment'
  );
}

/**
 * Analyze gaps between baseline summative attempt and mastery.
 */
export async function analyzeGaps(course, rubric, baselineResult, profileSummary) {
  const systemPrompt = await loadPrompt('gap-analysis');

  const userContent = JSON.stringify({
    courseName: course.name,
    rubric,
    baselineScores: baselineResult.criteriaScores,
    overallScore: baselineResult.overallScore,
    learnerProfile: profileSummary || 'No profile yet',
  });

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 2048
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateGapAnalysis, 'gap-analysis');
}

// -- Journey ------------------------------------------------------------------

/**
 * Generate a personalized learning journey from gap analysis.
 */
export async function generateJourney(course, units, gapAnalysis, rubric, profileSummary, completedFormatives) {
  const systemPrompt = await loadPrompt('course-creation');

  const userContent = JSON.stringify({
    courseName: course.name,
    units: units.map(u => ({
      unitId: u.unitId, name: u.name, description: u.description,
      learningObjectives: u.learningObjectives, dependsOn: u.dependsOn,
    })),
    gapAnalysis,
    rubric,
    learnerProfile: profileSummary || 'No profile yet',
    completedFormatives: completedFormatives || [],
  });

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 4096
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateJourney, 'journey-generation');
}

// -- Formative activities -----------------------------------------------------

/**
 * Generate the next formative activity's instruction.
 */
export async function generateNextActivity(unit, planSlot, progressSummary, profileSummary, planContext, courseScope) {
  const systemPrompt = await loadPrompt('activity-creation');

  const userContent = JSON.stringify({
    course: { name: unit.name, learningObjectives: unit.learningObjectives },
    activity: { type: planSlot.type, goal: planSlot.goal },
    rubricCriteria: planSlot.rubricCriteria || null,
    gapObservation: planSlot.gapObservation || null,
    workProduct: planContext?.workProductDescription || planContext?.finalWorkProductDescription || '',
    workProductTool: planContext?.workProductTool || '',
    priorActivities: progressSummary,
    learnerProfile: profileSummary || 'No profile yet',
    courseScope: courseScope || null
  });

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateActivity, 'activity-creation');
}

/**
 * Assess a formative draft submission with vision.
 */
export async function assessDraft(unit, activity, screenshotDataUrl, pageUrl, priorDrafts, profileSummary, promptName = 'activity-assessment') {
  const systemPrompt = await loadPrompt(promptName);

  const compressedDrafts = priorDrafts.map(d => ({
    score: d.score,
    feedback: d.feedback,
    recommendation: d.recommendation
  }));

  // Build message content with image block if screenshot available
  const contentParts = [];

  contentParts.push({
    type: 'text',
    text: JSON.stringify({
      course: { name: unit.name, learningObjectives: unit.learningObjectives },
      activity: {
        id: activity.id,
        type: activity.type,
        goal: activity.goal,
        instruction: activity.instruction
      },
      rubricCriteria: activity.rubricCriteria || null,
      pageUrl,
      priorDrafts: compressedDrafts,
      learnerProfile: profileSummary || 'No profile yet'
    })
  });

  if (screenshotDataUrl) {
    // Extract base64 and media type from data URL
    const match = screenshotDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1],
          data: match[2]
        }
      });
    }
  }

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_HEAVY,
      systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateAssessment, 'activity-assessment');
}

/**
 * Reassess a draft with learner feedback on the assessment.
 * Re-evaluates the same screenshot, factoring in the learner's dispute.
 */
export async function reassessDraft(unit, activity, screenshotDataUrl, pageUrl, priorDrafts, profileSummary, previousAssessment, learnerFeedback, promptName = 'activity-assessment') {
  const systemPrompt = await loadPrompt(promptName);

  const compressedDrafts = priorDrafts.map(d => ({
    score: d.score,
    feedback: d.feedback,
    recommendation: d.recommendation
  }));

  const contentParts = [];

  contentParts.push({
    type: 'text',
    text: JSON.stringify({
      course: { name: unit.name, learningObjectives: unit.learningObjectives },
      activity: {
        id: activity.id,
        type: activity.type,
        goal: activity.goal,
        instruction: activity.instruction
      },
      rubricCriteria: activity.rubricCriteria || null,
      pageUrl,
      priorDrafts: compressedDrafts,
      learnerProfile: profileSummary || 'No profile yet'
    })
  });

  if (screenshotDataUrl) {
    const match = screenshotDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1],
          data: match[2]
        }
      });
    }
  }

  const messages = [
    { role: 'user', content: contentParts },
    { role: 'assistant', content: JSON.stringify(previousAssessment) },
    { role: 'user', content: `The learner disputes this assessment: "${learnerFeedback}"\n\nRe-evaluate the same screenshot, taking their feedback into account. You may adjust your score, recommendation, and feedback if their point is valid. Respond with the same JSON format.` }
  ];

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_HEAVY,
      systemPrompt,
      messages,
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateAssessment, 'assessment-reassess');
}

// -- Profile updates ----------------------------------------------------------

/**
 * Update the learner profile after learner feedback on an activity.
 */
export async function updateProfileFromFeedback(fullProfile, feedbackText, activityContext) {
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    learnerFeedback: feedbackText,
    context: {
      courseName: activityContext.courseName,
      activityType: activityContext.activityType,
      activityGoal: activityContext.activityGoal,
      timestamp: Date.now()
    }
  });

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  return parsed;
}

/**
 * Update the learner profile after a formative assessment.
 */
export async function updateLearnerProfile(fullProfile, assessmentResult, activityContext) {
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    assessment: {
      score: assessmentResult.score,
      feedback: assessmentResult.feedback,
      strengths: assessmentResult.strengths,
      improvements: assessmentResult.improvements,
      recommendation: assessmentResult.recommendation
    },
    context: {
      courseName: activityContext.courseName,
      activityType: activityContext.activityType,
      activityGoal: activityContext.activityGoal,
      timestamp: Date.now()
    }
  });

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  return parsed;
}

/**
 * Update the learner profile after a summative attempt.
 */
export async function updateProfileOnSummativeAttempt(fullProfile, course, attemptResult) {
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    summativeAttempt: {
      courseId: course.courseId,
      courseName: course.name,
      isBaseline: attemptResult.isBaseline,
      mastery: attemptResult.mastery,
      criteriaScores: attemptResult.criteriaScores,
      overallScore: attemptResult.overallScore,
      feedback: attemptResult.feedback,
    },
    context: {
      event: attemptResult.mastery ? 'summative_mastery' : (attemptResult.isBaseline ? 'summative_baseline' : 'summative_retake'),
      courseName: course.name,
      timestamp: Date.now()
    }
  });

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  return parsed;
}

/**
 * Update the learner profile after achieving mastery on a course.
 */
export async function updateProfileOnMastery(fullProfile, course, finalResult, formativeSummaries) {
  const systemPrompt = await loadPrompt('learner-profile-update');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    courseCompletion: {
      courseId: course.courseId,
      courseName: course.name,
      rubricCriteriaScores: finalResult.criteriaScores,
      overallScore: finalResult.overallScore,
      formativeSummaries,
    },
    context: {
      event: 'course_mastery',
      courseName: course.name,
      timestamp: Date.now()
    }
  });

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  const parsed = parseJSON(content);
  return parsed;
}
