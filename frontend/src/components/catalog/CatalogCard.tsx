import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { startCatalogCourse } from '@/api/catalog';
import { triggerGeneration, deleteCourse } from '@/api/courses';
import { useCatalogStore } from '@/stores/catalog-store';
import type { CatalogCourse } from '@/api/types';
import { Lock, RotateCcw } from 'lucide-react';

interface CatalogCardProps {
  course: CatalogCourse;
  dependencyName?: string;
}

export function CatalogCard({ course, dependencyName }: CatalogCardProps) {
  const navigate = useNavigate();
  const reload = useCatalogStore((s) => s.load);
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState(false);

  const hasInstance = !!course.instance_id;
  const isGenerating = course.instance_status === 'generating';
  const isActive = hasInstance && !course.completed;

  async function handleStart() {
    setStarting(true);
    try {
      const { id, status } = await startCatalogCourse(course.course_id);
      if (status === 'draft') {
        await triggerGeneration(id);
        navigate(`/courses/${id}/generate`);
      } else if (status === 'generating') {
        navigate(`/courses/${id}/generate`);
      } else {
        navigate(`/courses/${id}`);
      }
    } catch {
      setStarting(false);
    }
  }

  function handleContinue() {
    if (!course.instance_id) return;
    if (isGenerating) {
      navigate(`/courses/${course.instance_id}/generate`);
    } else {
      navigate(`/courses/${course.instance_id}`);
    }
  }

  async function handleReset() {
    if (!course.instance_id) return;
    setResetting(true);
    try {
      await deleteCourse(course.instance_id);
      await reload();
    } catch {
      setResetting(false);
    }
  }

  return (
    <Card className={`flex flex-col${course.locked ? ' opacity-60' : ''}`}>
      <CardHeader>
        <CardTitle className="text-base">{course.name}</CardTitle>
        <CardDescription className="line-clamp-2">
          {course.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="flex flex-wrap gap-1">
          {course.tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs">
              {t}
            </Badge>
          ))}
        </div>
        {course.estimated_hours && (
          <p className="mt-2 text-xs text-muted-foreground">
            ~{course.estimated_hours}h
          </p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-1">
        {course.locked ? (
          <>
            <Button className="w-full" disabled>
              <Lock className="mr-2 h-3.5 w-3.5" />
              Locked
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Complete {dependencyName ?? course.depends_on} first
            </p>
          </>
        ) : isActive ? (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={handleContinue}
            >
              Continue
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" disabled={resetting}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset course?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will delete all your progress for "{course.name}" including
                    completed activities and submissions. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleReset}>
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <Button
            className="w-full"
            onClick={handleStart}
            disabled={starting}
          >
            {starting ? 'Starting...' : 'Start Course'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
