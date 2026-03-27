export const TYPE_LABELS = {
  explore: 'Research Activity',
  apply: 'Practice Activity',
  create: 'Draft Activity',
  final: 'Deliver Activity',
};

export const TYPE_LETTERS = {
  explore: 'R',
  apply: 'P',
  create: 'D',
  final: 'F',
};

export const VIEW_DEPTH = {
  '/onboarding': 0,
  '/courses': 1,
  '/units': 2,
  '/unit': 3,
  '/work': 1,
  '/work-detail': 2,
  '/settings': 1,
};

export const COURSE_PHASES = {
  SUMMATIVE_SETUP: 'summative_setup',
  COURSE_INTRO: 'course_intro',
  BASELINE_ATTEMPT: 'baseline_attempt',
  BASELINE_RESULTS: 'baseline_results',
  GAP_ANALYSIS: 'gap_analysis',
  JOURNEY_GENERATION: 'journey_generation',
  JOURNEY_OVERVIEW: 'journey_overview',
  FORMATIVE_LEARNING: 'formative_learning',
  RETAKE_READY: 'retake_ready',
  SUMMATIVE_RETAKE: 'summative_retake',
  COMPLETED: 'completed',
};

/** Guide checkpoint names — used by the guide prompt and courseEngine. */
export const GUIDE_CHECKPOINTS = {
  COURSE_INTRO: 'course_intro',
  PRE_DIAGNOSTIC: 'pre_diagnostic',
  DIAGNOSTIC_STEP: 'diagnostic_step',
  BASELINE_RESULTS: 'baseline_results',
  JOURNEY_OVERVIEW: 'journey_overview',
  UNIT_START: 'unit_start',
  ACTIVITY_INTRO: 'activity_intro',
  ACTIVITY_COMPLETE: 'activity_complete',
  UNIT_COMPLETE: 'unit_complete',
  RETAKE_READY: 'retake_ready',
  RETAKE_STEP: 'retake_step',
  RETAKE_RESULTS: 'retake_results',
  REMEDIATION_START: 'remediation_start',
  MASTERY_ACHIEVED: 'mastery_achieved',
};

/** Message types in the course conversation. */
export const MSG_TYPES = {
  GUIDE: 'guide',
  USER: 'user',
  INSTRUCTION: 'instruction',
  SUBMISSION: 'submission',
  FEEDBACK: 'feedback',
  RUBRIC_RESULT: 'rubric_result',
  ACTION: 'action',
  SECTION: 'section',
  THINKING: 'thinking',
};

export const MASTERY_LEVELS = {
  BEGINNING: 'beginning',
  DEVELOPING: 'developing',
  PROFICIENT: 'proficient',
  MASTERY: 'mastery',
};

export const MASTERY_LABELS = {
  beginning: 'Incomplete',
  developing: 'Approaching',
  proficient: 'Meets',
  mastery: 'Exceeds',
};

export function scoreToLabel(score) {
  if (score >= 0.76) return 'Exceeds';
  if (score >= 0.51) return 'Meets';
  if (score >= 0.26) return 'Approaching';
  return 'Incomplete';
}

export function levelToLabel(level) {
  return MASTERY_LABELS[level] || level;
}
