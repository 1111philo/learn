// ---- Catalog ----
export interface CatalogCourse {
  course_id: string;
  name: string;
  description: string;
  learning_objectives: string[];
  tags: string[];
  estimated_hours: number | null;
  depends_on: string | null;
  locked: boolean;
  completed: boolean;
}

export interface CatalogResponse {
  courses: CatalogCourse[];
  all_completed: boolean;
}

// ---- Course ----
export interface CourseCreateRequest {
  description: string;
  objectives: string[];
}

export interface CourseListItem {
  id: string;
  source_type: 'custom' | 'predefined';
  input_description: string | null;
  status: CourseStatus;
  lesson_count: number;
  lessons_completed: number;
}

export interface CourseResponse {
  id: string;
  source_type: 'custom' | 'predefined';
  input_description: string | null;
  input_objectives: string[];
  generated_description: string | null;
  lesson_titles: { lesson_title: string; lesson_summary: string }[] | null;
  status: CourseStatus;
  professional_role: string | null;
  career_context: string | null;
  final_portfolio_outcome: string | null;
  portfolio_artifact_id: string | null;
  lessons: LessonResponse[];
  assessments: AssessmentSummary[];
}

export type CourseStatus =
  | 'draft'
  | 'generating'
  | 'active'
  | 'in_progress'
  | 'awaiting_assessment'
  | 'generating_assessment'
  | 'assessment_ready'
  | 'completed'
  | 'generation_failed';

// ---- Lesson ----
export interface LessonResponse {
  id: string;
  objective_index: number;
  lesson_content: string | null;
  status: 'locked' | 'unlocked' | 'completed';
  activities: ActivitySummary[];
  total_activities: number;
  completed_activities: number;
}

// ---- Activity ----
export interface ActivitySpec {
  activity_type: string;
  instructions: string;
  prompt: string;
  scoring_rubric: string[];
  hints: string[];
  artifact_type?: string;
  employer_skill_signals?: string[];
  portfolio_eligible?: boolean;
  revision_required?: boolean;
  professional_quality_checklist?: string[];
}

export interface ActivityFeedback {
  rationale: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
}

export type ActivityStatus = 'pending' | 'active' | 'completed';

export interface ActivitySummary {
  id: string;
  activity_index: number;
  activity_status: ActivityStatus;
  activity_spec: ActivitySpec | null;
  latest_score: number | null;
  latest_feedback: ActivityFeedback | null;
  mastery_decision: 'not_yet' | 'meets' | 'exceeds' | null;
  attempt_count: number;
  portfolio_readiness: string | null;
  revision_count: number;
  portfolio_artifact_id: string | null;
}

export interface ActivityDetail extends ActivitySummary {
  submissions: { text: string; submitted_at: string }[];
  reviewing: boolean;
}

export interface ActivitySubmitResponse {
  id: string;
  status: 'reviewing';
}

export interface ActivityReviewResult {
  score: number;
  mastery_decision: 'not_yet' | 'meets' | 'exceeds';
  rationale: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
  portfolio_readiness?: string;
  employer_relevance_notes?: string;
  revision_priority?: string;
  resume_bullet_seed?: string;
  revision_encouraged?: boolean;
}

// ---- Assessment ----
export interface AssessmentItem {
  objective: string;
  prompt: string;
  rubric: string[];
}

export interface AssessmentSpec {
  assessment_title: string;
  items: AssessmentItem[];
}

export interface AssessmentResponse {
  id: string;
  status: 'pending' | 'submitted' | 'reviewed' | 'failed';
  score: number | null;
  passed: boolean | null;
  feedback: Record<string, unknown> | null;
  assessment_spec: AssessmentSpec | null;
}

export interface AssessmentSummary {
  id: string;
  status: string;
  score: number | null;
  passed: boolean | null;
}

export interface AssessmentSubmitRequest {
  responses: { objective: string; text: string }[];
}

// ---- SSE Events ----
export interface CourseDescribedEvent {
  lesson_previews: { index: number; title: string; summary: string }[];
  narrative_description: string;
}

export interface LessonPlannedEvent {
  objective_index: number;
  lesson_title: string;
  skipped?: boolean;
}

export interface LessonWrittenEvent {
  objective_index: number;
  skipped?: boolean;
}

export interface ActivityCreatedEvent {
  objective_index: number;
  activity_id: string;
  activity_index: number;
  skipped?: boolean;
}

export interface GenerationCompleteEvent {
  course_id: string;
  lesson_count: number;
}

export interface GenerationErrorEvent {
  objective_index: number;
  error: string;
}

// ---- Review SSE Events ----
export interface ReviewCompleteEvent extends ActivityReviewResult {}

export interface ReviewErrorEvent {
  error: string;
}

export interface AssessmentReviewCompleteEvent {
  assessment_id: string;
}

export interface AssessmentReviewErrorEvent {
  error: string;
}

// ---- Portfolio ----
export interface PortfolioArtifact {
  id: string;
  course_instance_id: string;
  lesson_id: string | null;
  artifact_type: string;
  title: string;
  content_pointer: string | null;
  status: 'draft' | 'revised' | 'portfolio_ready' | 'tool_ready';
  skills: string[];
  audience: string | null;
  employer_use_case: string | null;
  resume_bullet_seed: string | null;
  created_at: string;
  updated_at: string;
}

export interface PortfolioSummary {
  artifacts: PortfolioArtifact[];
  total: number;
  by_status: Record<string, number>;
}
