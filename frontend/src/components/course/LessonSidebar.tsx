import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Lock, CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressBar } from './ProgressBar';
import { CapstoneTracker } from './CapstoneTracker';
import { Button } from '@/components/ui/button';
import type { CourseResponse } from '@/api/types';
import { useLessonNavStore } from '@/stores/lesson-nav-store';

interface LessonSidebarProps {
  course: CourseResponse;
  onNavigate?: () => void;
}

export function LessonSidebar({ course, onNavigate }: LessonSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { sections, currentPage, setCurrentPage } = useLessonNavStore();

  // Parse current route state from URL
  const lessonMatch = location.pathname.match(/\/lessons\/(\d+)/);
  const activeLessonIdx = lessonMatch ? Number(lessonMatch[1]) : -1;
  const onActivityPage = location.pathname.endsWith('/activity');

  // Lesson data
  const totalLessons = course.lesson_titles?.length ?? course.lessons.length;
  const lessonMap = new Map(
    course.lessons.map((l) => [l.objective_index, l]),
  );
  const completed = course.lessons.filter(
    (l) => l.status === 'completed',
  ).length;
  const allDone = completed === totalLessons && totalLessons > 0;

  return (
    <aside className="w-64 shrink-0 space-y-4" aria-label="Course navigation">
      {course.professional_role && (
        <div className="rounded-md bg-primary/10 px-3 py-2 text-xs">
          <span className="font-medium">Role:</span>{' '}
          <span>{course.professional_role}</span>
        </div>
      )}
      {course.final_portfolio_outcome && (
        <div className="rounded-md bg-muted px-3 py-2 text-xs">
          <span className="font-medium">Building:</span>{' '}
          <span>{course.final_portfolio_outcome}</span>
        </div>
      )}
      <ProgressBar completed={completed} total={totalLessons} />

      <nav>
        <ol className="space-y-0.5" role="list">
          {Array.from({ length: totalLessons }, (_, i) => {
            const lesson = lessonMap.get(i);
            const status = lesson?.status ?? 'locked';
            const isLocked = status === 'locked';
            const isCompleted = status === 'completed';
            const isCurrent = activeLessonIdx === i;

            const activity = lesson?.activity;
            const hasActivity = activity?.activity_spec != null;
            const activityPassed =
              activity?.mastery_decision === 'meets' ||
              activity?.mastery_decision === 'exceeds';
            const activityAttempted =
              (activity?.attempt_count ?? 0) > 0 && !activityPassed;

            const title =
              course.lesson_titles?.[i]?.lesson_title ?? `Lesson ${i + 1}`;

            // Show section sub-nav only when viewing this lesson's content (not activity)
            const showSections =
              isCurrent && !onActivityPage && sections.length > 1;
            // Show activity link for any accessible lesson that has one
            const showActivity = hasActivity && !isLocked;

            return (
              <li key={i}>
                {/* ── Lesson link ── */}
                <NavLink
                  to={`/courses/${course.id}/lessons/${i}`}
                  end
                  onClick={() => onNavigate?.()}
                  aria-disabled={isLocked || undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                      // Highlight when on the lesson page OR its activity page
                      isActive || (isCurrent && onActivityPage)
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'hover:bg-muted',
                      isLocked && 'pointer-events-none opacity-40',
                    )
                  }
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                  ) : isLocked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{title}</span>
                </NavLink>

                {/* ── Sub-items: sections + activity ── */}
                {(showSections || showActivity) && (
                  <ol className="mb-1" role="list">
                    {showSections &&
                      sections.map((section, si) => (
                        <li key={si}>
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentPage(si);
                              onNavigate?.();
                            }}
                            aria-current={
                              currentPage === si ? 'true' : undefined
                            }
                            className={cn(
                              'ml-5 flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                              currentPage === si
                                ? 'font-medium text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <ChevronRight
                              className={cn(
                                'h-3 w-3 shrink-0',
                                currentPage === si && 'text-primary',
                              )}
                            />
                            <span className="truncate">
                              {section.title || `Section ${si + 1}`}
                            </span>
                          </button>
                        </li>
                      ))}

                    {showActivity && (
                      <li>
                        <NavLink
                          to={`/courses/${course.id}/lessons/${i}/activity`}
                          onClick={() => onNavigate?.()}
                          className={({ isActive }) =>
                            cn(
                              'ml-5 flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                              isActive
                                ? 'font-medium text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                            )
                          }
                        >
                          {activityPassed ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-green-600" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <span>
                            Activity
                            {activityAttempted && (
                              <span className="ml-1 font-medium text-yellow-600">
                                · retry
                              </span>
                            )}
                          </span>
                        </NavLink>
                      </li>
                    )}
                  </ol>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <CapstoneTracker course={course} />

      {allDone && (
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
