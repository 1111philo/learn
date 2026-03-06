import { cn } from '@/lib/utils';
import { StepperItem } from './StepperItem';
import type { LessonPreview, ObjectiveProgress } from '@/stores/generation-store';

interface GenerationStepperProps {
  objectives: string[];
  lessonPreviews: LessonPreview[];
  courseDescribed: boolean;
  progress: Map<number, ObjectiveProgress>;
  generating?: boolean;
}

export function GenerationStepper({ objectives, lessonPreviews, courseDescribed, progress, generating }: GenerationStepperProps) {
  // When SSE events arrive before the REST fetch, objectives may be empty but
  // progress has entries keyed by objective_index. Build a display list from
  // whichever source has more items so the stepper is visible immediately.
  const maxIndex = progress.size > 0
    ? Math.max(...progress.keys(), objectives.length - 1)
    : objectives.length - 1;
  const count = Math.max(objectives.length, maxIndex + 1);
  const indices = Array.from({ length: count }, (_, i) => i);

  // Infer which objective is currently in progress.
  // Generation is sequential, so it's the first one without full completion
  // (planned + written + activityCreated) after the last completed one.
  let inferredActiveIndex = -1;
  if (generating) {
    for (const i of indices) {
      const p = progress.get(i);
      if (!p || !p.planned || !p.written || !p.activityCreated) {
        inferredActiveIndex = i;
        break;
      }
    }
  }

  return (
    <div aria-label="Generation progress">
      {/* Phase 0: Describe step */}
      <div className="flex gap-3 mb-1">
        <div className="flex flex-col items-center">
          {courseDescribed ? (
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs text-white">
              &#10003;
            </span>
          ) : generating ? (
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            </span>
          ) : (
            <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted-foreground/30" />
          )}
          <div className="w-px flex-1 bg-border" />
        </div>
        <div className="pb-4">
          <p className={cn('text-sm font-medium', courseDescribed && 'text-green-700')}>
            {courseDescribed ? 'Course described' : 'Describing your course...'}
          </p>
        </div>
      </div>

      <ol className="space-y-0">
        {indices.map((i) => (
          <StepperItem
            key={i}
            index={i}
            objectiveLabel={
              courseDescribed && lessonPreviews[i]
                ? lessonPreviews[i].title
                : (objectives[i] ?? `Objective ${i + 1}`)
            }
            progress={progress.get(i)}
            inferActive={i === inferredActiveIndex}
          />
        ))}
      </ol>
    </div>
  );
}
