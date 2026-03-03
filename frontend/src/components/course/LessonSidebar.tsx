import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ProgressBar } from './ProgressBar';
import type { CourseResponse } from '@/api/types';

interface LessonSidebarProps {
  course: CourseResponse;
}

export function LessonSidebar({ course }: LessonSidebarProps) {
  const navigate = useNavigate();
  const completed = course.lessons.filter((l) => l.status === 'completed').length;
  const allCompleted = completed === course.lessons.length && course.lessons.length > 0;

  // Group lessons by objective_index, preserving flat array index for routes
  const byObjective = course.lessons.reduce<
    Map<number, { lesson: CourseResponse['lessons'][number]; flatIndex: number }[]>
  >((acc, lesson, i) => {
    const key = lesson.objective_index;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push({ lesson, flatIndex: i });
    return acc;
  }, new Map());

  const objectives = Array.from(byObjective.entries()).sort(([a], [b]) => a - b);

  return (
    <aside className="w-64 shrink-0 space-y-4">
      <ProgressBar completed={completed} total={course.lessons.length} />

      <nav className="space-y-3">
        {objectives.map(([objIdx, entries]) => (
          <div key={objIdx} className="space-y-1">
            <p className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Objective {objIdx + 1}
            </p>
            {entries.map(({ lesson, flatIndex }) => (
              <NavLink
                key={lesson.id}
                to={`/courses/${course.id}/lessons/${flatIndex}`}
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
                <span className="text-xs shrink-0">
                  {lesson.status === 'completed'
                    ? '✓'
                    : lesson.status === 'locked'
                      ? '🔒'
                      : lesson.lesson_role === 'capstone'
                        ? '◇'
                        : '○'}
                </span>
                <span className="truncate">
                  {lesson.lesson_title ??
                    (lesson.lesson_role === 'capstone'
                      ? 'Capstone'
                      : `Lesson ${flatIndex + 1}`)}
                </span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {allCompleted && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => navigate(`/courses/${course.id}/assessment`)}
        >
          Take Assessment
        </Button>
      )}
    </aside>
  );
}
