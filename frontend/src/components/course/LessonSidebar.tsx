import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ProgressBar } from './ProgressBar';
import type { CourseResponse } from '@/api/types';

interface LessonSidebarProps {
  course: CourseResponse;
  onNavigate?: () => void;
}

export function LessonSidebar({ course, onNavigate }: LessonSidebarProps) {
  const navigate = useNavigate();
  const completed = course.lessons.filter((l) => l.status === 'completed').length;
  const allCompleted = completed === course.lessons.length && course.lessons.length > 0;

  return (
    <aside className="w-64 shrink-0 space-y-4">
      <ProgressBar completed={completed} total={course.lessons.length} />

      <nav aria-label="Course lessons" className="space-y-0.5">
        {course.lessons.map((lesson, i) => {
          const activity = lesson.activity;
          const hasActivity = activity?.activity_spec != null;
          const activityPassed =
            activity?.mastery_decision === 'meets' ||
            activity?.mastery_decision === 'exceeds';
          const activityAttempted = (activity?.attempt_count ?? 0) > 0 && !activityPassed;

          return (
            <div key={lesson.id}>
              <NavLink
                to={`/courses/${course.id}/lessons/${i}`}
                end
                onClick={() => onNavigate?.()}
                aria-disabled={lesson.status === 'locked' ? 'true' : undefined}
                aria-label={`Lesson ${i + 1}${lesson.status === 'completed' ? ', completed' : lesson.status === 'locked' ? ', locked' : ''}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'hover:bg-muted',
                    lesson.status === 'locked' && 'pointer-events-none opacity-50',
                  )
                }
              >
                <span aria-hidden="true" className="text-xs">
                  {lesson.status === 'completed'
                    ? '✓'
                    : lesson.status === 'locked'
                      ? '🔒'
                      : '○'}
                </span>
                <span className="truncate">Lesson {i + 1}</span>
              </NavLink>

              {hasActivity && lesson.status !== 'locked' && (
                <NavLink
                  to={`/courses/${course.id}/lessons/${i}/activity`}
                  onClick={() => onNavigate?.()}
                  aria-label={`Lesson ${i + 1} activity${activityPassed ? ', completed' : activityAttempted ? ', in progress' : ''}`}
                  className={({ isActive }) =>
                    cn(
                      'ml-5 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors border-l border-border',
                      isActive
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <span aria-hidden="true" className="text-xs">
                    {activityPassed ? '✓' : activityAttempted ? '◷' : '◇'}
                  </span>
                  <span className="truncate">
                    Activity
                    {activityAttempted && (
                      <span className="ml-1 text-yellow-600 font-medium">· retry</span>
                    )}
                  </span>
                </NavLink>
              )}
            </div>
          );
        })}
      </nav>

      {allCompleted && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            onNavigate?.();
            navigate(`/courses/${course.id}/assessment`);
          }}
        >
          Take Assessment
        </Button>
      )}
    </aside>
  );
}
