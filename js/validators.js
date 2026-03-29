/**
 * Output validators — pure functions for validating agent responses.
 */

export const UNSAFE_PATTERNS = /\b(kill\s+(yourself|your)|self[- ]?harm|suicide\s+method|how\s+to\s+(hack|steal|attack))\b/i;
export const PLATFORM_SHORTCUTS = /\b(F12|Ctrl\s*\+\s*Shift\s*\+\s*I|Cmd\s*\+\s*Option\s*\+\s*I|Ctrl\s*\+\s*Shift\s*\+\s*J|Ctrl\s*\+\s*Shift\s*\+\s*C)\b/i;
export const MULTI_SITE = /\b(visit\s+.{3,30}then\s+visit|compare\s+.{3,30}with|open\s+.{3,30}and\s+.{3,30}open|go\s+to\s+.{3,30}then\s+go\s+to|navigate\s+to\s+.{3,30}then\s+navigate)\b/i;
export const NON_BROWSER_APP = /\b(open\s+(your\s+)?(text\s+editor|terminal|command\s+(line|prompt)|file\s+(manager|explorer)|finder|notepad|textedit|sublime|atom|vim|emacs|nano)|VS\s*Code|Visual\s+Studio|IntelliJ|PyCharm|Xcode|Android\s+Studio|PowerShell)\b/i;
export const DEVTOOLS_PATTERN = /\b(DevTools|dev\s+tools|Inspect\s+Element|Lighthouse|open\s+(the\s+)?console|right[- ]click.{0,20}inspect|Elements?\s+(panel|tab)|Network\s+(panel|tab)|Sources?\s+(panel|tab)|F12)\b/i;
export const PRODUCES_WORK = /\b(write|type|create|build|draft|compose|summarize|list|outline|note|annotate|describe|explain|fill\s+(in|out)|enter|paste|edit|modify|change|add|code|implement|design)\b/i;

export function validateSafety(text) {
  if (UNSAFE_PATTERNS.test(text)) return 'Response contains unsafe content.';
  return null;
}

/**
 * Validate an activity creator response.
 */
export function validateActivity(parsed) {
  if (!parsed.instruction || typeof parsed.instruction !== 'string') return 'Missing instruction.';
  if (!Array.isArray(parsed.tips)) return 'Missing tips array.';

  const instr = parsed.instruction;

  // Safety
  const safety = validateSafety(instr + ' ' + parsed.tips.join(' '));
  if (safety) return safety;

  const lines = instr.split('\n').filter(l => l.trim());

  // Max 5 total steps (4 content + final)
  const steps = instr.match(/^\d+\.\s/gm);
  if (steps && steps.length > 5) return 'Too many steps (max 4 plus final step).';

  // No platform-specific shortcuts
  if (PLATFORM_SHORTCUTS.test(instr)) return 'Contains platform-specific keyboard shortcuts.';

  // No multi-site instructions
  if (MULTI_SITE.test(instr)) return 'Activity must focus on a single page.';

  // No non-browser apps
  if (NON_BROWSER_APP.test(instr)) return 'Activity must happen entirely in the browser.';

  // No DevTools
  if (DEVTOOLS_PATTERN.test(instr)) return 'Activity must not use DevTools.';

  // Must require visible work
  const stepsBeforeRecord = lines.slice(0, -1).join(' ');
  if (!PRODUCES_WORK.test(stepsBeforeRecord)) return 'Activity must require the learner to produce visible work.';

  return null;
}

/**
 * Validate an activity assessment response (exemplar-driven).
 */
export function validateAssessment(parsed) {
  if (typeof parsed.achieved !== 'boolean') return 'achieved must be a boolean.';
  if (!parsed.demonstrates || typeof parsed.demonstrates !== 'string') return 'Missing demonstrates.';
  if (!Array.isArray(parsed.strengths)) return 'Missing strengths array.';
  if (parsed.moved === undefined) return 'Missing moved (use null for first activity).';
  if (!parsed.needed || typeof parsed.needed !== 'string') return 'Missing needed.';
  if (!parsed.courseKBUpdate || typeof parsed.courseKBUpdate !== 'object') return 'Missing courseKBUpdate.';
  if (!Array.isArray(parsed.courseKBUpdate.insights)) return 'Missing courseKBUpdate.insights array.';
  if (!parsed.courseKBUpdate.learnerPosition || typeof parsed.courseKBUpdate.learnerPosition !== 'string') {
    return 'Missing courseKBUpdate.learnerPosition.';
  }

  const allText = parsed.demonstrates + ' ' + parsed.strengths.join(' ') + ' ' + parsed.needed;
  const safety = validateSafety(allText);
  if (safety) return safety;

  return null;
}

/**
 * Validate a course owner response (course KB initialization).
 */
export function validateCourseKB(parsed) {
  if (!parsed.exemplar || typeof parsed.exemplar !== 'string') return 'Missing exemplar.';
  if (!Array.isArray(parsed.objectives) || parsed.objectives.length === 0) return 'Missing objectives array.';
  for (let i = 0; i < parsed.objectives.length; i++) {
    const obj = parsed.objectives[i];
    if (!obj.objective || typeof obj.objective !== 'string') return `Objective ${i + 1} missing objective.`;
    if (!obj.evidence || typeof obj.evidence !== 'string') return `Objective ${i + 1} missing evidence.`;
  }
  if (!parsed.learnerPosition || typeof parsed.learnerPosition !== 'string') return 'Missing learnerPosition.';
  if (!Array.isArray(parsed.insights)) return 'Missing insights array.';
  if (typeof parsed.activitiesCompleted !== 'number') return 'Missing activitiesCompleted.';
  if (!parsed.status || typeof parsed.status !== 'string') return 'Missing status.';

  const safety = validateSafety(parsed.exemplar + ' ' + parsed.learnerPosition);
  if (safety) return safety;

  return null;
}
