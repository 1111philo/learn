/**
 * Agent orchestration — loads prompts, assembles context, routes to models,
 * parses structured JSON responses.
 */

import { callClaude, streamClaude, parseResponse, MODEL_LIGHT, MODEL_HEAVY, ApiError } from './api.js';
import { isLoggedIn, authenticatedFetch } from './auth.js';
import { getApiKey } from './storage.js';
import { validateSafety, validateActivity, validateAssessment, validateCourseKB } from './validators.js';

// Prompt cache (loaded once per session)
const promptCache = {};
let knowledgeBase = null;

async function loadPrompt(name) {
  if (promptCache[name]) return promptCache[name];
  const url = chrome.runtime.getURL(`prompts/${name}.md`);
  const resp = await fetch(url);
  const text = await resp.text();
  promptCache[name] = text;
  return text;
}

async function loadKnowledgeBase() {
  if (knowledgeBase) return knowledgeBase;
  try {
    const url = chrome.runtime.getURL('data/knowledge-base.md');
    const resp = await fetch(url);
    knowledgeBase = await resp.text();
  } catch {
    knowledgeBase = '';
  }
  return knowledgeBase;
}

/** Agents that get the knowledge base injected into their system prompt. */
const KB_AGENTS = ['guide', 'course-creator'];

function parseJSON(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }

  const fenced = trimmed.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  try { return JSON.parse(fenced); } catch { /* continue */ }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch { /* fall through */ }
  }

  const preview = trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
  console.error('[1111] Unparseable agent response:', preview);
  throw new ApiError('parse', 'Failed to parse agent JSON response.');
}

async function callWithValidation(agentFn, validator) {
  const parsed = await agentFn();
  const error = validator(parsed);
  if (!error) return parsed;
  console.error(`[1111] Validation failed (retrying): ${error}`);

  const retry = await agentFn();
  const retryError = validator(retry);
  if (retryError) {
    console.error(`[1111] Validation failed after retry: ${retryError}`);
    if (retryError.includes('unsafe')) throw new ApiError('safety', retryError);
  }
  return retry;
}

async function callApi({ model, systemPrompt, messages, maxTokens = 1024 }) {
  const attempt = async () => {
    if (await isLoggedIn()) {
      const resp = await authenticatedFetch('/v1/ai/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
      });
      return parseResponse(resp);
    }

    const apiKey = await getApiKey();
    if (apiKey) {
      return callClaude({ apiKey, model, systemPrompt, messages, maxTokens });
    }

    throw new ApiError('invalid_key', 'No AI provider configured. Sign in or add your API key in Settings.');
  };

  const RETRIES = 2;
  const DELAYS = [3000, 6000];

  let lastError;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastError = e;
      const isRetryable = e.type === 'overloaded' || (e.type === 'api' && e.status === 500);
      if (!isRetryable || i === RETRIES) throw e;
      console.error(`[1111] API ${e.status} -- retry ${i + 1}/${RETRIES} in ${DELAYS[i] / 1000}s...`);
      await new Promise(r => setTimeout(r, DELAYS[i]));
    }
  }
  throw lastError;
}

export async function isReady() {
  if (await isLoggedIn()) return true;
  const key = await getApiKey();
  return !!key;
}

// -- Guide (streaming) --------------------------------------------------------

export async function converseStream(promptName, messages, onChunk, maxTokens = 512) {
  let systemPrompt = await loadPrompt(promptName);
  if (KB_AGENTS.includes(promptName)) {
    const kb = await loadKnowledgeBase();
    if (kb) systemPrompt = `${systemPrompt}\n\n---\n\n## Program Knowledge Base\n\n${kb}`;
  }

  const apiKey = await getApiKey();
  if (apiKey) {
    let full = '';
    const stream = await streamClaude({
      apiKey,
      model: MODEL_LIGHT,
      systemPrompt,
      messages,
      maxTokens
    });
    for await (const chunk of stream) {
      full += chunk;
      onChunk(full);
    }
    return full;
  }

  // Fallback: non-streaming
  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages,
    maxTokens
  });
  onChunk(content);
  return content;
}

// -- Course Owner (LLM) -------------------------------------------------------

export async function initializeCourseKB(course, profileSummary) {
  const systemPrompt = await loadPrompt('course-owner');

  const userContent = JSON.stringify({
    courseId: course.courseId,
    courseName: course.name,
    courseDescription: course.description,
    exemplar: course.exemplar,
    learningObjectives: course.learningObjectives,
    learnerProfile: profileSummary || 'New learner, no profile yet.',
  });

  const callAgent = async () => {
    const { content } = await callApi({
      model: MODEL_LIGHT,
      systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1536
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateCourseKB);
}

// -- Activity Creator ---------------------------------------------------------

export async function createActivity(courseKB, profileSummary, activityNumber, priorActivitiesSummary) {
  const systemPrompt = await loadPrompt('activity-creation');

  const priorLines = (priorActivitiesSummary || 'None').split('\n');
  const cappedPrior = priorLines.length > 5
    ? `[${priorLines.length - 5} earlier activities omitted]\n${priorLines.slice(-5).join('\n')}`
    : priorActivitiesSummary || 'None';

  const userContent = JSON.stringify({
    courseKB: {
      exemplar: courseKB.exemplar,
      objectives: courseKB.objectives,
      insights: courseKB.insights,
      learnerPosition: courseKB.learnerPosition,
      activitiesCompleted: courseKB.activitiesCompleted,
    },
    learnerProfile: profileSummary || 'No profile yet',
    activityNumber,
    priorActivities: cappedPrior,
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

  return callWithValidation(callAgent, validateActivity);
}

// -- Activity Assessor --------------------------------------------------------

export async function assessSubmission(courseKB, activityInstruction, priorAttempts, profileSummary, screenshotDataUrl, textResponse) {
  const systemPrompt = await loadPrompt('activity-assessment');

  const contentParts = [];

  contentParts.push({
    type: 'text',
    text: JSON.stringify({
      courseKB: {
        exemplar: courseKB.exemplar,
        objectives: courseKB.objectives,
        insights: courseKB.insights,
        learnerPosition: courseKB.learnerPosition,
        activitiesCompleted: courseKB.activitiesCompleted,
        totalObjectives: courseKB.objectives?.length || 0,
      },
      activityInstruction,
      priorAttempts: priorAttempts.map(a => ({
        demonstrates: a.demonstrates,
        strengths: a.strengths,
        moved: a.moved,
        needed: a.needed,
      })),
      learnerProfile: profileSummary || 'No profile yet',
    })
  });

  if (screenshotDataUrl) {
    const match = screenshotDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      contentParts.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] }
      });
    }
  }

  if (textResponse) {
    contentParts.push({
      type: 'text',
      text: `Learner's text response:\n\n${textResponse}`
    });
  }

  const model = screenshotDataUrl ? MODEL_HEAVY : MODEL_LIGHT;

  const callAgent = async () => {
    const { content } = await callApi({
      model,
      systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
      maxTokens: 1024
    });
    return parseJSON(content);
  };

  return callWithValidation(callAgent, validateAssessment);
}

// -- Learner Profile Owner (LLM — deep update on course completion) -----------

export async function updateProfileOnCompletion(fullProfile, courseKB, courseName, courseId, activitiesCompleted) {
  const systemPrompt = await loadPrompt('learner-profile-owner');

  const userContent = JSON.stringify({
    currentProfile: fullProfile,
    courseKB,
    activitiesCompleted,
    courseName,
    courseId,
  });

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    maxTokens: 1024
  });

  return parseJSON(content);
}

// -- Learner Profile Owner (code — incremental merge after assessment) --------

export function incrementalProfileUpdate(profile, courseId, assessmentResult) {
  const updated = { ...profile };

  if (!updated.activeCourses) updated.activeCourses = [];
  if (!updated.activeCourses.includes(courseId)) {
    updated.activeCourses.push(courseId);
  }

  if (assessmentResult.strengths?.length) {
    updated.latestStrengths = assessmentResult.strengths;
  }

  updated.updatedAt = Date.now();
  return updated;
}

// -- Profile feedback (reuses learner-profile-update prompt) ------------------

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

  return parseJSON(content);
}

// -- Course markdown extraction (from conversation) ---------------------------

/**
 * Extract structured course markdown from a creation conversation.
 * One-shot call — reads the conversation and synthesizes the course.
 */
export async function extractCourseMarkdown(conversationText) {
  const systemPrompt = await loadPrompt('course-extractor');

  const { content } = await callApi({
    model: MODEL_LIGHT,
    systemPrompt,
    messages: [{ role: 'user', content: conversationText }],
    maxTokens: 1536,
  });

  return content.trim();
}
