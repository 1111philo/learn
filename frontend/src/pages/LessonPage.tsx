import { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCourseStore } from '@/stores/course-store';
import { useLessonNavStore } from '@/stores/lesson-nav-store';
import { MarkdownRenderer } from '@/components/lesson/MarkdownRenderer';
import { Button } from '@/components/ui/button';

/**
 * Split lesson markdown into sections on top-level headings (# or ## if no #).
 * Each section includes its heading line so MarkdownRenderer can style it.
 */
function splitIntoSections(content: string) {
  const hasH1 = /^# /m.test(content);
  const pattern = hasH1 ? /^(?=# )/m : /^(?=## )/m;
  const parts = content.split(pattern).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ title: '', content: content.trim() }];
  return parts.map((part) => {
    const firstLine = part.split('\n')[0];
    const title = firstLine.replace(/^#{1,6}\s+/, '');
    return { title, content: part };
  });
}

function lessonPageKey(courseId: string, lessonIndex: number) {
  return `lesson-page:${courseId}:${lessonIndex}`;
}

export function LessonPage() {
  const { courseId, index } = useParams<{ courseId: string; index: string }>();
  const navigate = useNavigate();
  const { course, loadCourse } = useCourseStore();
  const { sections, currentPage, setSections, setCurrentPage } = useLessonNavStore();
  const lessonIndex = Number(index ?? 0);

  const lesson = course?.lessons.find((l) => l.objective_index === lessonIndex);
  const generating = lesson && !lesson.lesson_content && lesson.status === 'unlocked';

  const parsedSections = useMemo(
    () => (lesson?.lesson_content ? splitIntoSections(lesson.lesson_content) : []),
    [lesson?.lesson_content],
  );

  // Clear sections immediately when switching lessons
  useEffect(() => {
    setSections([]);
    setCurrentPage(0);
  }, [lessonIndex, setSections, setCurrentPage]);

  // Sync parsed sections to store + restore saved page position
  useEffect(() => {
    if (!courseId || parsedSections.length === 0) return;
    setSections(parsedSections);
    const saved = localStorage.getItem(lessonPageKey(courseId, lessonIndex));
    const savedPage = saved !== null ? Math.min(Number(saved), parsedSections.length - 1) : 0;
    setCurrentPage(savedPage);
  }, [courseId, lessonIndex, parsedSections, setSections, setCurrentPage]);

  // Persist current page to localStorage whenever it changes
  useEffect(() => {
    if (!courseId || parsedSections.length === 0) return;
    localStorage.setItem(lessonPageKey(courseId, lessonIndex), String(currentPage));
  }, [currentPage, courseId, lessonIndex, parsedSections.length]);

  // Poll until on-demand lesson content arrives
  useEffect(() => {
    if (!generating || !courseId) return;
    const id = setInterval(() => loadCourse(courseId), 3000);
    return () => clearInterval(id);
  }, [generating, courseId, loadCourse]);

  if (!course) return null;

  if (!lesson) {
    return <p className="text-muted-foreground">Lesson not found.</p>;
  }

  const lessonTitle = course.lesson_titles?.[lessonIndex]?.lesson_title;

  if (lesson.status === 'locked') {
    return (
      <div>
        {lessonTitle && <h1 className="mb-4 text-2xl font-bold">{lessonTitle}</h1>}
        <p className="text-muted-foreground">
          Complete the previous lesson to unlock this one.
        </p>
      </div>
    );
  }

  // Navigation state
  const totalContentPages = sections.length || 1;
  const isFirstSection = currentPage === 0;
  const isLastSection = currentPage >= totalContentPages - 1;
  const isFirstLesson = lessonIndex === 0;
  const totalLessons = course.lesson_titles?.length ?? course.lessons.length;
  const isLastLesson = lessonIndex === totalLessons - 1;
  const hasActivity = lesson.activity?.activity_spec != null;
  const activityDone =
    lesson.activity?.mastery_decision === 'meets' ||
    lesson.activity?.mastery_decision === 'exceeds';

  const prevDisabled = isFirstSection && isFirstLesson;

  const nextLabel = !isLastSection
    ? 'Next'
    : hasActivity && !activityDone
      ? 'Complete Activity'
      : !isLastLesson
        ? 'Next Lesson'
        : 'Take Assessment';

  function goToPage(page: number) {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goPrev() {
    if (!isFirstSection) {
      goToPage(currentPage - 1);
    } else if (!isFirstLesson) {
      navigate(`/courses/${courseId}/lessons/${lessonIndex - 1}`);
    }
  }

  function goNext() {
    if (!isLastSection) {
      goToPage(currentPage + 1);
      return;
    }
    if (hasActivity && !activityDone) {
      navigate(`/courses/${courseId}/lessons/${lessonIndex}/activity`);
      return;
    }
    if (!isLastLesson) {
      navigate(`/courses/${courseId}/lessons/${lessonIndex + 1}`);
      return;
    }
    navigate(`/courses/${courseId}/assessment`);
  }

  const currentSection = sections[currentPage];

  return (
    <div>
      {lessonTitle && <h1 className="mb-4 text-2xl font-bold">{lessonTitle}</h1>}

      {lesson.lesson_content ? (
        <>
          {sections.length > 1 && (
            <p className="mb-4 text-xs text-muted-foreground" aria-live="polite">
              Section {currentPage + 1} of {sections.length}
              {currentSection?.title && (
                <span className="ml-1 font-medium text-foreground">
                  — {currentSection.title}
                </span>
              )}
            </p>
          )}

          <MarkdownRenderer content={currentSection?.content ?? lesson.lesson_content} />
        </>
      ) : (
        <div role="status" aria-live="polite" className="flex items-center gap-3 text-muted-foreground">
          <div aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Generating lesson content...
        </div>
      )}

      <nav
        aria-label="Lesson navigation"
        className="mt-8 flex items-center justify-between"
      >
        <Button
          variant="outline"
          size="sm"
          disabled={prevDisabled}
          onClick={goPrev}
          aria-label={isFirstSection ? 'Previous lesson' : 'Previous section'}
        >
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Previous
        </Button>

        {sections.length > 1 && (
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {currentPage + 1} / {sections.length}
          </span>
        )}

        <Button
          size="sm"
          onClick={goNext}
          aria-label={nextLabel}
        >
          {nextLabel}
          <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
