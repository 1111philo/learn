import { useEffect, useState } from 'react';
import { useParams, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useCourseStore } from '@/stores/course-store';
import { LessonSidebar } from '@/components/course/LessonSidebar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

export function CoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { course, loadCourse } = useCourseStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (courseId) loadCourse(courseId);
  }, [courseId, loadCourse]);

  // Redirect to first incomplete lesson if at /courses/:id
  useEffect(() => {
    if (!course || !courseId) return;
    const isRoot = location.pathname === `/courses/${courseId}`;
    if (!isRoot) return;

    const firstIncomplete = course.lessons.findIndex(
      (l) => l.status !== 'completed',
    );
    const idx = firstIncomplete >= 0 ? firstIncomplete : 0;
    navigate(`/courses/${courseId}/lessons/${idx}`, { replace: true });
  }, [course, courseId, location.pathname, navigate]);

  if (!course) {
    return <p className="text-muted-foreground">Loading course...</p>;
  }

  return (
    <div className="flex gap-6">
      {/* Persistent sidebar — hidden on mobile */}
      <div className="hidden sm:block">
        <LessonSidebar course={course} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Mobile sidebar trigger — visible on mobile only */}
        <div className="mb-4 sm:hidden">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Menu className="h-4 w-4" />
                Lessons
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 pt-10">
              <LessonSidebar
                course={course}
                onNavigate={() => setSidebarOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
