/**
 * Output validators — pure functions for validating agent responses.
 * Extracted from orchestrator.js so they can be tested independently.
 */

export const UNSAFE_PATTERNS = /\b(kill\s+(yourself|your)|self[- ]?harm|suicide\s+method|how\s+to\s+(hack|steal|attack))\b/i;
export const PLATFORM_SHORTCUTS = /\b(F12|Ctrl\s*\+\s*Shift\s*\+\s*I|Cmd\s*\+\s*Option\s*\+\s*I|Ctrl\s*\+\s*Shift\s*\+\s*J|Ctrl\s*\+\s*Shift\s*\+\s*C)\b/i;
export const MULTI_SITE = /\b(visit\s+.{3,30}then\s+visit|compare\s+.{3,30}with|open\s+.{3,30}and\s+.{3,30}open|go\s+to\s+.{3,30}then\s+go\s+to|navigate\s+to\s+.{3,30}then\s+navigate)\b/i;
export const NON_BROWSER_APP = /\b(open\s+(your\s+)?(text\s+editor|terminal|command\s+(line|prompt)|file\s+(manager|explorer)|finder|notepad|textedit|sublime|atom|vim|emacs|nano)|VS\s*Code|Visual\s+Studio|IntelliJ|PyCharm|Xcode|Android\s+Studio|PowerShell)\b/i;
export const DEVTOOLS_PATTERN = /\b(DevTools|dev\s+tools|Inspect\s+Element|Lighthouse|open\s+(the\s+)?console|right[- ]click.{0,20}inspect|Elements?\s+(panel|tab)|Network\s+(panel|tab)|Sources?\s+(panel|tab)|F12)\b/i;
export const PRODUCES_WORK = /\b(write|type|create|build|draft|compose|summarize|list|outline|note|annotate|describe|explain|fill\s+(in|out)|enter|paste|edit|modify|change|add|code|implement|design)\b/i;

const VALID_MASTERY_LEVELS = ['incomplete', 'approaching', 'meets', 'exceeds'];

export function validateSafety(text) {
  if (UNSAFE_PATTERNS.test(text)) return 'Response contains unsafe content.';
  return null;
}

export function validateActivity(parsed) {
  if (!parsed.instruction || typeof parsed.instruction !== 'string') return 'Missing instruction.';
  if (!Array.isArray(parsed.tips)) return 'Missing tips array.';

  const instr = parsed.instruction;

  // Safety
  const safety = validateSafety(instr + ' ' + parsed.tips.join(' '));
  if (safety) return safety;

  // Must end with "Capture"
  const lines = instr.split('\n').filter(l => l.trim());
  const lastLine = lines[lines.length - 1]?.toLowerCase() || '';
  if (!lastLine.includes('capture')) return 'Last step must tell the learner to hit Capture.';

  // Max 4 content steps + the mandatory Capture step = 5 total
  const steps = instr.match(/^\d+\.\s/gm);
  if (steps && steps.length > 5) return 'Too many steps (max 4 plus Capture).';

  // No platform-specific shortcuts
  if (PLATFORM_SHORTCUTS.test(instr)) return 'Contains platform-specific keyboard shortcuts.';

  // No multi-site instructions
  if (MULTI_SITE.test(instr)) return 'Activity must focus on a single page.';

  // No non-browser apps
  if (NON_BROWSER_APP.test(instr)) return 'Activity must happen entirely in the browser.';

  // No DevTools (not captured in screenshots)
  if (DEVTOOLS_PATTERN.test(instr)) return 'Activity must not use DevTools — screenshots cannot capture browser panels.';

  // Must require the learner to produce something (not just visit a page)
  // Check the steps before the final "Record" step
  const stepsBeforeRecord = lines.slice(0, -1).join(' ');
  if (!PRODUCES_WORK.test(stepsBeforeRecord)) return 'Activity must require the learner to produce visible work, not just visit a page.';

  return null;
}

export function validateAssessment(parsed) {
  if (typeof parsed.score !== 'number' || parsed.score < 0 || parsed.score > 1) return 'Score must be 0.0-1.0.';
  if (!['advance', 'revise', 'continue'].includes(parsed.recommendation)) return 'Invalid recommendation.';
  if (!parsed.feedback || typeof parsed.feedback !== 'string') return 'Missing feedback.';
  if (!Array.isArray(parsed.strengths)) return 'Missing strengths array.';
  if (!Array.isArray(parsed.improvements)) return 'Missing improvements array.';

  const allText = parsed.feedback + ' ' + parsed.strengths.join(' ') + ' ' + parsed.improvements.join(' ');
  const safety = validateSafety(allText);
  if (safety) return safety;

  return null;
}

// -- Summative validators -----------------------------------------------------

export function validateSummative(parsed) {
  if (!parsed.task) return 'Missing task.';
  if (!Array.isArray(parsed.task.steps) || parsed.task.steps.length === 0) return 'Task must have a steps array with at least one step.';
  for (let i = 0; i < parsed.task.steps.length; i++) {
    const step = parsed.task.steps[i];
    if (!step.instruction || typeof step.instruction !== 'string') return `Step ${i + 1} missing instruction.`;
  }
  if (!Array.isArray(parsed.rubric) || parsed.rubric.length === 0) return 'Rubric must be a non-empty array of criteria.';
  for (let i = 0; i < parsed.rubric.length; i++) {
    const c = parsed.rubric[i];
    if (!c.name || typeof c.name !== 'string') return `Rubric criterion ${i + 1} missing name.`;
    if (!c.levels || typeof c.levels !== 'object') return `Rubric criterion "${c.name}" missing levels.`;
    for (const level of VALID_MASTERY_LEVELS) {
      if (!c.levels[level] || typeof c.levels[level] !== 'string') {
        return `Rubric criterion "${c.name}" missing "${level}" level description.`;
      }
    }
  }
  if (!parsed.exemplar || typeof parsed.exemplar !== 'string') return 'Missing exemplar.';
  if (!parsed.courseIntro || typeof parsed.courseIntro !== 'string') return 'Missing courseIntro.';
  if (!parsed.summaryForLearner || typeof parsed.summaryForLearner !== 'string') return 'Missing summaryForLearner.';

  const allText = parsed.exemplar + ' ' + parsed.courseIntro + ' ' + parsed.summaryForLearner + ' ' + parsed.task.steps.map(s => s.instruction).join(' ');
  const safety = validateSafety(allText);
  if (safety) return safety;

  return null;
}

export function validateSummativeAssessment(parsed, priorAttempt) {
  if (!Array.isArray(parsed.criteriaScores) || parsed.criteriaScores.length === 0) {
    return 'Missing criteriaScores array.';
  }
  for (let i = 0; i < parsed.criteriaScores.length; i++) {
    const cs = parsed.criteriaScores[i];
    if (!cs.criterion || typeof cs.criterion !== 'string') return `Criterion score ${i + 1} missing criterion name.`;
    if (!VALID_MASTERY_LEVELS.includes(cs.level)) return `Criterion "${cs.criterion}" has invalid level "${cs.level}".`;
    if (typeof cs.score !== 'number' || cs.score < 0 || cs.score > 1) return `Criterion "${cs.criterion}" score must be 0.0-1.0.`;
  }
  if (typeof parsed.overallScore !== 'number' || parsed.overallScore < 0 || parsed.overallScore > 1) {
    return 'overallScore must be 0.0-1.0.';
  }
  if (typeof parsed.mastery !== 'boolean') return 'mastery must be a boolean.';
  if (!parsed.feedback || typeof parsed.feedback !== 'string') return 'Missing feedback.';
  if (!parsed.summaryForLearner || typeof parsed.summaryForLearner !== 'string') return 'Missing summaryForLearner.';

  // Ratchet rule: no criterion score can be lower than the prior attempt
  if (priorAttempt?.criteriaScores) {
    const priorMap = {};
    for (const ps of priorAttempt.criteriaScores) {
      priorMap[ps.criterion] = ps.score;
    }
    for (const cs of parsed.criteriaScores) {
      const priorScore = priorMap[cs.criterion];
      if (priorScore != null && cs.score < priorScore) {
        return `Criterion "${cs.criterion}" score ${cs.score} is lower than prior ${priorScore} — scores can only go up.`;
      }
    }
  }

  const safety = validateSafety(parsed.feedback + ' ' + parsed.summaryForLearner);
  if (safety) return safety;

  return null;
}

export function validateGapAnalysis(parsed) {
  if (!Array.isArray(parsed.gaps) || parsed.gaps.length === 0) return 'Missing gaps array.';
  for (let i = 0; i < parsed.gaps.length; i++) {
    const g = parsed.gaps[i];
    if (!g.criterion || typeof g.criterion !== 'string') return `Gap ${i + 1} missing criterion.`;
    if (!VALID_MASTERY_LEVELS.includes(g.currentLevel)) return `Gap "${g.criterion}" has invalid currentLevel.`;
    if (!VALID_MASTERY_LEVELS.includes(g.targetLevel)) return `Gap "${g.criterion}" has invalid targetLevel.`;
    if (!['high', 'medium', 'low'].includes(g.priority)) return `Gap "${g.criterion}" has invalid priority.`;
  }
  return null;
}

export function validateJourney(parsed) {
  if (!Array.isArray(parsed.units) || parsed.units.length === 0) return 'Missing units array.';
  for (let i = 0; i < parsed.units.length; i++) {
    const u = parsed.units[i];
    if (!u.unitId || typeof u.unitId !== 'string') return `Journey unit ${i + 1} missing unitId.`;
    if (!Array.isArray(u.activities) || u.activities.length === 0) {
      return `Journey unit "${u.unitId}" must have at least one activity.`;
    }
    for (let j = 0; j < u.activities.length; j++) {
      const a = u.activities[j];
      if (!a.type || typeof a.type !== 'string') return `Activity ${j + 1} in unit "${u.unitId}" missing type.`;
      if (!a.goal || typeof a.goal !== 'string') return `Activity ${j + 1} in unit "${u.unitId}" missing goal.`;
      if (!Array.isArray(a.rubricCriteria) || a.rubricCriteria.length === 0) {
        return `Activity ${j + 1} in unit "${u.unitId}" must target at least one rubric criterion.`;
      }
    }
  }
  return null;
}
