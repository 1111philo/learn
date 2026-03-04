import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useCourseStore } from '@/stores/course-store';
import { MarkdownRenderer } from '@/components/lesson/MarkdownRenderer';
import { LessonNav } from '@/components/lesson/LessonNav';

export function LessonPage() {
  const { courseId, index } = useParams<{ courseId: string; index: string }>();
  const { course, loadCourse } = useCourseStore();
  const lessonIndex = Number(index ?? 0);

  const lesson = course?.lessons[lessonIndex];
  const generating = lesson && !lesson.lesson_content && lesson.status === 'unlocked';

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

  if (lesson.status === 'locked') {
    return (
      <p className="text-muted-foreground">
        Complete the previous lesson to unlock this one.
      </p>
    );
  }

  return (
    <div>
      {lesson.lesson_content ? (
        <MarkdownRenderer content={lesson.lesson_content} />
      ) : (
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Generating lesson content...
        </div>
      )}
      <LessonNav course={course} currentIndex={lessonIndex} />
    </div>
  );
}
