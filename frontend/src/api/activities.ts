import { get, post } from './client';
import { sseUrl } from './sse-auth';
import type {
  ActivityDetail,
  ActivitySubmitResponse,
  ReviewCompleteEvent,
  ReviewErrorEvent,
} from './types';

export function getActivity(activityId: string): Promise<ActivityDetail> {
  return get<ActivityDetail>(`/api/activities/${activityId}`);
}

export function submitActivity(
  activityId: string,
  text: string,
): Promise<ActivitySubmitResponse> {
  return post<ActivitySubmitResponse>(`/api/activities/${activityId}/submit`, {
    text,
  });
}

export type ActivityReviewEvent =
  | { type: 'review_complete'; data: ReviewCompleteEvent }
  | { type: 'review_error'; data: ReviewErrorEvent };

export function connectReviewStream(
  activityId: string,
  onEvent: (event: ActivityReviewEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const evtSource = new EventSource(
    sseUrl(`/api/activities/${activityId}/review-stream`),
  );

  for (const type of ['review_complete', 'review_error'] as const) {
    evtSource.addEventListener(type, (e: MessageEvent) => {
      const event = { type, data: JSON.parse(e.data) } as ActivityReviewEvent;
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
