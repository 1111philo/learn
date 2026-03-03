// ---- Catalog ----
export interface CatalogCourse {
  course_id: string;
  name: string;
  description: string;
  learning_objectives: string[];
  tags: string[];
  estimated_hours: number | null;
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

// ---- Diagnostic ----
export interface DiagnosticQuestion {
  question: string;
  rationale: string;
}

export interface DiagnosticSpec {
  questions: DiagnosticQuestion[];
}

export interface CourseResponse {
  id: string;
  source_type: 'custom' | 'predefined';
  input_description: string | null;
  input_objectives: string[];
  generated_description: string | null;
  status: CourseStatus;
  diagnostic_spec: DiagnosticSpec | null;
  lessons: LessonResponse[];
  assessments: AssessmentSummary[];
}

export type CourseStatus =
  | 'draft'
  | 'awaiting_diagnostic'
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
  sub_lesson_index: number;
  lesson_role: 'focused' | 'capstone';
  lesson_title: string | null;
  lesson_content: string | null;
  status: 'locked' | 'unlocked' | 'completed';
  activity: ActivitySummary | null;
}

// ---- Activity ----
export interface ActivitySpec {
  activity_type: string;
  instructions: string;
  prompt: string;
  scoring_rubric: string[];
  hints: string[];
}

export interface ActivityFeedback {
  rationale: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
}

/** Activity as embedded in the course response (no submissions/reviewing). */
export interface ActivitySummary {
  id: string;
  activity_spec: ActivitySpec | null;
  latest_score: number | null;
  latest_feedback: ActivityFeedback | null;
  mastery_decision: 'not_yet' | 'meets' | 'exceeds' | null;
  attempt_count: number;
}

/** Full activity from GET /activities/{id} (includes submissions + reviewing). */
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

// ---- Agent Logs ----
export interface AgentLog {
  id: string;
  course_instance_id: string;
  agent_name: string;
  prompt: string;
  output: string | null;
  status: 'success' | 'error';
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model_name: string | null;
  created_at: string;
}

// ---- SSE Events ----
export interface LessonPlannedEvent {
  objective_index: number;
  objective_title?: string;
  sub_lesson_count?: number;
  skipped?: boolean;
}

export interface LessonWrittenEvent {
  objective_index: number;
  sub_lesson_index?: number;
  skipped?: boolean;
}

export interface ActivityCreatedEvent {
  objective_index: number;
  sub_lesson_index?: number;
  activity_id: string;
  lesson_role?: 'focused' | 'capstone';
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
