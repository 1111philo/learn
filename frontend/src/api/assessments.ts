import { get, post } from './client';
import type {
  AssessmentResponse,
  AssessmentReviewCompleteEvent,
  AssessmentReviewErrorEvent,
  AssessmentSubmitRequest,
} from './types';

export function generateAssessment(
  courseId: string,
): Promise<{ id: string; status: string }> {
  return post<{ id: string; status: string }>(
    `/api/assessments/${courseId}/generate`,
  );
}

export function getAssessment(
  courseId: string,
): Promise<AssessmentResponse> {
  return get<AssessmentResponse>(`/api/assessments/${courseId}/assessment`);
}

export function submitAssessment(
  assessmentId: string,
  data: AssessmentSubmitRequest,
): Promise<{ id: string; status: string }> {
  return post<{ id: string; status: string }>(
    `/api/assessments/${assessmentId}/submit`,
    data,
  );
}

export type AssessmentReviewEvent =
  | { type: 'review_complete'; data: AssessmentReviewCompleteEvent }
  | { type: 'review_error'; data: AssessmentReviewErrorEvent };

export function connectAssessmentReviewStream(
  assessmentId: string,
  onEvent: (event: AssessmentReviewEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const evtSource = new EventSource(
    `/api/assessments/${assessmentId}/review-stream`,
  );

  for (const type of ['review_complete', 'review_error'] as const) {
    evtSource.addEventListener(type, (e: MessageEvent) => {
      const event = { type, data: JSON.parse(e.data) } as AssessmentReviewEvent;
      onEvent(event);
      evtSource.close();
    });
  }

  evtSource.onerror = (e) => {
    if (evtSource.readyState === EventSource.CLOSED) {
      onError?.(e);
    }
  };

  return () => evtSource.close();
}
