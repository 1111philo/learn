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
  RUBRIC_REVIEW: 'rubric_review',
  BASELINE_ATTEMPT: 'baseline_attempt',
  GAP_ANALYSIS: 'gap_analysis',
  JOURNEY_GENERATION: 'journey_generation',
  FORMATIVE_LEARNING: 'formative_learning',
  SUMMATIVE_RETAKE: 'summative_retake',
  COMPLETED: 'completed',
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
