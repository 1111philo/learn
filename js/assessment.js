/**
 * Draft assessment.
 *
 * Without an LLM, assessment is criteria-based: for each criterion the learner
 * marks whether they met it, and the app generates structured feedback.
 * The module exposes a clean interface so an AI-backed assessor can replace
 * the heuristic later without changing the rest of the app.
 */

/**
 * Assess a draft against an activity's criteria.
 * @param {object} activity - the current activity (has .criteria, optionally .passingThreshold)
 * @param {boolean[]} criteriaResults - one boolean per criterion (true = met)
 * @param {object[]} priorDrafts - previous drafts for context
 * @returns {{ score: number, passed: boolean, feedback: string }}
 */
export function assessDraft(activity, criteriaResults, priorDrafts) {
  const met = criteriaResults.filter(Boolean).length;
  const total = activity.criteria.length;
  const score = total > 0 ? met / total : 0;
  const threshold = activity.passingThreshold || 0;
  const passed = score >= threshold;
  const attempt = priorDrafts.length + 1;

  let feedback = '';
  if (met === total) {
    feedback = 'All criteria met. Great work!';
  } else {
    const missed = activity.criteria.filter((_, i) => !criteriaResults[i]);
    feedback = `You met ${met} of ${total} criteria. `;
    feedback += 'Focus on: ' + missed.join('; ') + '.';
  }

  if (activity.type === 'final' && !passed) {
    feedback += ` You need at least ${Math.round(threshold * 100)}% to complete this course. Keep revising.`;
  }

  if (attempt > 1) {
    feedback += ` This is revision ${attempt} — each attempt strengthens your work.`;
  }

  return { score, passed, feedback };
}

/**
 * Check if a final activity's draft meets the passing threshold.
 */
export function meetsThreshold(activity, score) {
  return score >= (activity.passingThreshold || 0);
}
