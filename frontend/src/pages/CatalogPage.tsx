import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCatalogStore } from '@/stores/catalog-store';
import { CatalogCard } from '@/components/catalog/CatalogCard';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Lock } from 'lucide-react';

export function CatalogPage() {
  const { courses, allCompleted, loading, error, load } = useCatalogStore();
  const navigate = useNavigate();

  useEffect(() => { load(); }, [load]);

  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    courses.forEach((c) => { map[c.course_id] = c.name; });
    return map;
  }, [courses]);

  const sorted = useMemo(() =>
    [...courses].sort((a, b) => Number(a.locked) - Number(b.locked)),
    [courses],
  );

  const customLocked = courses.length > 0 && !allCompleted;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Courses</h1>
        <p className="text-muted-foreground">
          Browse courses or create your own
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((course) => (
          <CatalogCard
            key={course.course_id}
            course={course}
            dependencyName={course.depends_on ? nameById[course.depends_on] : undefined}
          />
        ))}

        <Card
          className={`flex flex-col border-dashed${customLocked ? ' opacity-60' : ' cursor-pointer hover:border-primary'}`}
          onClick={customLocked ? undefined : () => navigate('/courses/new')}
        >
          <CardHeader className="flex-1">
            <CardTitle className="text-base">
              {customLocked && <Lock className="mr-1.5 inline h-3.5 w-3.5" />}
              Create Your Own
            </CardTitle>
            <CardDescription>
              {customLocked
                ? 'Complete all courses above to unlock custom course creation'
                : "Describe what you want to learn and we'll build a custom course"}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {loading && courses.length === 0 && (
        <p className="text-center text-muted-foreground">Loading...</p>
      )}
    </div>
  );
}
