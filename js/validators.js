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

export function validateSafety(text) {
  if (UNSAFE_PATTERNS.test(text)) return 'Response contains unsafe content.';
  return null;
}

export function validateDiagnosticActivity(parsed) {
  if (!parsed.instruction || typeof parsed.instruction !== 'string') return 'Missing instruction.';
  if (!Array.isArray(parsed.tips)) return 'Missing tips array.';
  const safety = validateSafety(parsed.instruction + ' ' + parsed.tips.join(' '));
  if (safety) return safety;
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

export function validatePlan(parsed, expectedCount) {
  if (!Array.isArray(parsed.activities)) return 'Missing activities array.';
  if (parsed.activities.length !== expectedCount) return `Expected ${expectedCount} activities (one per objective), got ${parsed.activities.length}.`;
  if (!parsed.finalWorkProductDescription || typeof parsed.finalWorkProductDescription !== 'string') return 'Missing finalWorkProductDescription.';
  if (!parsed.workProductTool || typeof parsed.workProductTool !== 'string') return 'Missing workProductTool.';
  const last = parsed.activities[parsed.activities.length - 1];
  if (last.type !== 'final') return 'Last activity must be type "final".';
  // No two consecutive activities should have the same type
  for (let i = 1; i < parsed.activities.length; i++) {
    if (parsed.activities[i].type === parsed.activities[i - 1].type) {
      return `Activities ${i} and ${i + 1} have the same type "${parsed.activities[i].type}" — each must be different from the previous.`;
    }
  }
  return null;
}
