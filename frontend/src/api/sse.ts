import { sseUrl } from './sse-auth';
import type {
  CourseDescribedEvent,
  LessonPlannedEvent,
  LessonWrittenEvent,
  ActivityCreatedEvent,
  GenerationCompleteEvent,
  GenerationErrorEvent,
} from './types';

export type GenerationEvent =
  | { type: 'course_described'; data: CourseDescribedEvent }
  | { type: 'lesson_planned'; data: LessonPlannedEvent }
  | { type: 'lesson_written'; data: LessonWrittenEvent }
  | { type: 'activity_created'; data: ActivityCreatedEvent }
  | { type: 'generation_complete'; data: GenerationCompleteEvent }
  | { type: 'generation_error'; data: GenerationErrorEvent };

const EVENT_TYPES = [
  'course_described',
  'lesson_planned',
  'lesson_written',
  'activity_created',
  'generation_complete',
  'generation_error',
] as const;

export function connectGenerationStream(
  courseId: string,
  onEvent: (event: GenerationEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const evtSource = new EventSource(
    sseUrl(`/api/courses/${courseId}/generation-stream`),
  );

  for (const type of EVENT_TYPES) {
    evtSource.addEventListener(type, (e: MessageEvent) => {
      const event = { type, data: JSON.parse(e.data) } as GenerationEvent;
      onEvent(event);
      // Close connection after generation completes
      if (type === 'generation_complete') {
        evtSource.close();
      }
    });
  }

  evtSource.onerror = (e) => {
    // Only notify on terminal errors (CLOSED state means no auto-reconnect)
    if (evtSource.readyState === EventSource.CLOSED) {
      onError?.(e);
    }
  };

  return () => evtSource.close();
}
