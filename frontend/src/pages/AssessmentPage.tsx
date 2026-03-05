import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCourseStore } from '@/stores/course-store';
import {
  generateAssessment,
  getAssessment,
  submitAssessment,
  connectAssessmentReviewStream,
} from '@/api/assessments';
import { AssessmentForm } from '@/components/assessment/AssessmentForm';
import { AssessmentResults } from '@/components/assessment/AssessmentResults';
import type { AssessmentResponse } from '@/api/types';
import { ApiError } from '@/api/client';
import { sseUrl } from '@/api/sse-auth';

export function AssessmentPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { course, loadCourse } = useCourseStore();
  const [assessment, setAssessment] = useState<AssessmentResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reviewCleanupRef = useRef<(() => void) | null>(null);

  // Load course on mount
  useEffect(() => {
    if (courseId) loadCourse(courseId);
  }, [courseId, loadCourse]);

  // Check for existing assessment from REST-fetched course data
  useEffect(() => {
    if (!course || !courseId) return;

    const existing = course.assessments.find(
      (a) => a.status === 'pending' || a.status === 'reviewed' || a.status === 'submitted',
    );

    if (existing) {
      // Assessment exists — fetch full data via REST
      getAssessment(courseId).then((result) => {
        setAssessment(result);
        // If assessment is submitted (review in flight), connect SSE
        if (result.status === 'submitted') {
          setReviewing(true);
          connectReviewSSE(result.id);
        }
      }).catch(() => {
        // If fetch fails, let user trigger generation
      });
    } else if (
      course.status === 'generating_assessment' ||
      course.status === 'awaiting_assessment'
    ) {
      if (course.status === 'generating_assessment') {
        setGenerating(true);
        connectGenerationSSE(courseId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      reviewCleanupRef.current?.();
    };
  }, []);

  function connectGenerationSSE(id: string) {
    eventSourceRef.current?.close();

    const evtSource = new EventSource(
      sseUrl(`/api/assessments/${id}/assessment-stream`),
    );
    eventSourceRef.current = evtSource;

    evtSource.addEventListener('assessment_complete', async () => {
      evtSource.close();
      eventSourceRef.current = null;
      try {
        const result = await getAssessment(id);
        setAssessment(result);
      } catch {
        setError('Assessment was generated but could not be loaded.');
      }
      setGenerating(false);
    });

    evtSource.addEventListener('assessment_error', (e) => {
      evtSource.close();
      eventSourceRef.current = null;
      const data = JSON.parse(e.data);
      setError(data.error || 'Assessment generation failed');
      setGenerating(false);
    });

    evtSource.onerror = () => {
      if (evtSource.readyState === EventSource.CLOSED) {
        eventSourceRef.current = null;
        setError('Lost connection during assessment generation');
        setGenerating(false);
      }
    };
  }

  function connectReviewSSE(assessmentId: string) {
    reviewCleanupRef.current?.();
    reviewCleanupRef.current = connectAssessmentReviewStream(
      assessmentId,
      async (event) => {
        if (event.type === 'review_complete') {
          // Fetch updated assessment with full results
          try {
            if (courseId) {
              const result = await getAssessment(courseId);
              setAssessment(result);
              await loadCourse(courseId);
            }
          } catch {
            setError('Review completed but could not load results.');
          }
          setReviewing(false);
        } else if (event.type === 'review_error') {
          setError(event.data.error);
          setReviewing(false);
          // Reset assessment status to pending for retry
          if (assessment) {
            setAssessment({ ...assessment, status: 'pending' });
          }
        }
      },
      () => {
        setError('Lost connection during review');
        setReviewing(false);
      },
    );
  }

  async function handleGenerate() {
    if (!courseId) return;
    setGenerating(true);
    setError(null);
    try {
      await generateAssessment(courseId);
      connectGenerationSSE(courseId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        connectGenerationSSE(courseId);
      } else {
        setError((e as Error).message);
        setGenerating(false);
      }
    }
  }

  async function handleSubmit(
    responses: { objective: string; text: string }[],
  ) {
    if (!assessment) return;
    setReviewing(true);
    setError(null);
    try {
      await submitAssessment(assessment.id, { responses });
      connectReviewSSE(assessment.id);
    } catch (e) {
      setError((e as Error).message);
      setReviewing(false);
    }
  }

  async function handleRetry() {
    setAssessment(null);
    await handleGenerate();
  }

  if (!course) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  // Show results if reviewed
  if (assessment?.status === 'reviewed') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Assessment Results</h1>
        <AssessmentResults assessment={assessment} />
        <div className="flex flex-wrap gap-3">
          {assessment.passed ? (
            <Button onClick={() => navigate('/my-courses')}>
              Back to My Courses
            </Button>
          ) : (
            <Button onClick={handleRetry}>Retry Assessment</Button>
          )}
        </div>
      </div>
    );
  }

  // Show reviewing state
  if (reviewing) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Assessment</h1>
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Reviewing your assessment...
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Show form if assessment spec is loaded
  if (assessment?.assessment_spec && assessment.status === 'pending') {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl sm:text-2xl font-bold">Assessment</h1>
        <AssessmentForm
          spec={assessment.assessment_spec}
          onSubmit={handleSubmit}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Generating state
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Assessment</h1>
      <p className="text-muted-foreground">
        {generating
          ? 'Generating your assessment...'
          : 'Ready to test your knowledge?'}
      </p>
      {generating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="animate-spin">&#9696;</span>
          <span>This may take a few seconds</span>
        </div>
      )}
      {!generating && !assessment && (
        <Button onClick={handleGenerate}>Generate Assessment</Button>
      )}
      {error && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" onClick={handleGenerate}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
