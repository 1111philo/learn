import { CheckCircle2, Circle } from 'lucide-react';
import type { CourseResponse } from '@/api/types';

interface CapstoneTrackerProps {
  course: CourseResponse;
}

export function CapstoneTracker({ course }: CapstoneTrackerProps) {
  if (!course.final_portfolio_outcome) return null;

  const lessonTitles = course.lesson_titles ?? [];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold">Capstone Progress</h3>
      <p className="text-xs text-muted-foreground">{course.final_portfolio_outcome}</p>

      <ol className="space-y-1.5">
        {lessonTitles.map((lt, i) => {
          const lesson = course.lessons.find((l) => l.objective_index === i);
          const isCompleted = lesson?.status === 'completed';
          const completedActivities = lesson?.completed_activities ?? 0;
          const totalActivities = lesson?.total_activities ?? 0;

          return (
            <li key={i} className="flex items-center gap-2 text-xs">
              {isCompleted ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" />
              ) : (
                <Circle className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate flex-1">{lt.lesson_title}</span>
              {totalActivities > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {completedActivities}/{totalActivities}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
