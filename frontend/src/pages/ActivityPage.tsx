import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCourseStore } from '@/stores/course-store';
import { submitActivity, getActivity, connectReviewStream } from '@/api/activities';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { SubmissionForm } from '@/components/activity/SubmissionForm';
import { FeedbackDisplay } from '@/components/activity/FeedbackDisplay';
import type { ActivityReviewResult } from '@/api/types';

export function ActivityPage() {
  const { courseId, index } = useParams<{ courseId: string; index: string }>();
  const navigate = useNavigate();
  const { course, loadCourse } = useCourseStore();
  const lessonIndex = Number(index ?? 0);
  const [reviewing, setReviewing] = useState(false);
  const [feedback, setFeedback] = useState<ActivityReviewResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const lesson = course?.lessons[lessonIndex];
  const activity = lesson?.activity;

  // On mount, check if a review is in-flight via the REST endpoint
  useEffect(() => {
    if (!activity?.id) return;
    let cancelled = false;

    getActivity(activity.id).then((detail) => {
      if (cancelled) return;
      if (detail.reviewing) {
        setReviewing(true);
        connectSSE(detail.id);
      }
    }).catch(() => {
      // Standalone endpoint unavailable — fall back to course data
    });

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  if (!course) return null;

  if (!activity?.activity_spec) {
    return <p className="text-muted-foreground">No activity for this lesson.</p>;
  }

  // Show previous feedback if already submitted and no new feedback (and not retrying)
  const existingFeedback = activity.latest_feedback;
  const displayFeedback = retrying
    ? null
    : feedback ?? (existingFeedback && activity.latest_score != null
      ? {
          score: activity.latest_score,
          mastery_decision: activity.mastery_decision ?? 'not_yet',
          rationale: existingFeedback.rationale,
          strengths: existingFeedback.strengths,
          improvements: existingFeedback.improvements,
          tips: existingFeedback.tips,
        } as ActivityReviewResult
      : null);

  const passed =
    feedback?.mastery_decision === 'meets' ||
    feedback?.mastery_decision === 'exceeds' ||
    activity.mastery_decision === 'meets' ||
    activity.mastery_decision === 'exceeds';

  const isLast = lessonIndex === course.input_objectives.length - 1;

  function connectSSE(activityId: string) {
    cleanupRef.current?.();
    cleanupRef.current = connectReviewStream(
      activityId,
      (event) => {
        if (event.type === 'review_complete') {
          setFeedback(event.data);
          setReviewing(false);
          setRetrying(false);
          // Refetch course to update sidebar lock states
          if (courseId) loadCourse(courseId);
        } else if (event.type === 'review_error') {
          setError(event.data.error);
          setReviewing(false);
        }
      },
      () => {
        setError('Lost connection to server');
        setReviewing(false);
      },
    );
  }

  async function handleSubmit(text: string) {
    setReviewing(true);
    setError(null);
    try {
      await submitActivity(activity!.id, text);
      connectSSE(activity!.id);
    } catch (e) {
      setError((e as Error).message);
      setReviewing(false);
    }
  }

  function handleContinue() {
    if (isLast) {
      navigate(`/courses/${courseId}/assessment`);
    } else {
      navigate(`/courses/${courseId}/lessons/${lessonIndex + 1}`);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Lesson {lessonIndex + 1} Activity</h2>
      </div>

      <section aria-labelledby="task-heading">
        <h3 id="task-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Task</h3>
        <ActivityPanel spec={activity.activity_spec} />
      </section>

      {reviewing ? (
        <div role="status" aria-live="polite" className="flex items-center gap-3 text-muted-foreground">
          <div aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Reviewing your submission...
        </div>
      ) : displayFeedback ? (
        <section aria-labelledby="feedback-heading">
          <h3 id="feedback-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Feedback</h3>
          <FeedbackDisplay
            score={displayFeedback.score}
            mastery={displayFeedback.mastery_decision}
            rationale={displayFeedback.rationale}
            strengths={displayFeedback.strengths}
            improvements={displayFeedback.improvements}
            tips={displayFeedback.tips}
          />
          <div className="flex flex-wrap gap-3 mt-4">
            {passed ? (
              <Button onClick={handleContinue}>
                {isLast ? 'Take Assessment' : 'Continue'}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  setFeedback(null);
                  setRetrying(true);
                }}
              >
                Retry
              </Button>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="response-heading">
          <h3 id="response-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Response</h3>
          <SubmissionForm onSubmit={handleSubmit} />
          {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
        </section>
      )}
    </div>
  );
}
