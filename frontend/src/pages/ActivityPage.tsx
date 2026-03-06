import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCourseStore } from '@/stores/course-store';
import { submitActivity, getActivity, connectReviewStream } from '@/api/activities';
import { getArtifact } from '@/api/portfolio';
import { ActivityPanel } from '@/components/activity/ActivityPanel';
import { SubmissionForm } from '@/components/activity/SubmissionForm';
import { FeedbackDisplay } from '@/components/activity/FeedbackDisplay';
import { CelebrationOverlay } from '@/components/gamification/CelebrationOverlay';
import type { ActivityReviewResult } from '@/api/types';

export function ActivityPage() {
  const { courseId, index, activityIndex: activityIndexParam } = useParams<{
    courseId: string;
    index: string;
    activityIndex: string;
  }>();
  const navigate = useNavigate();
  const { course, loadCourse } = useCourseStore();
  const lessonIndex = Number(index ?? 0);
  const activityIndex = Number(activityIndexParam ?? 0);
  const [reviewing, setReviewing] = useState(false);
  const [feedback, setFeedback] = useState<ActivityReviewResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portfolioContent, setPortfolioContent] = useState<string | undefined>(undefined);
  const cleanupRef = useRef<(() => void) | null>(null);

  const lesson = course?.lessons.find((l) => l.objective_index === lessonIndex);
  const activities = lesson?.activities ?? [];
  const activity = activities.find((a) => a.activity_index === activityIndex);
  const totalActivities = lesson?.total_activities ?? activities.length;

  // Reset state when activity changes
  useEffect(() => {
    setFeedback(null);
    setRetrying(false);
    setError(null);
    setReviewing(false);
  }, [activityIndex, lessonIndex]);

  // Check if a review is in-flight
  useEffect(() => {
    if (!activity?.id) return;
    let cancelled = false;

    getActivity(activity.id).then((detail) => {
      if (cancelled) return;
      if (detail.reviewing) {
        setReviewing(true);
        connectSSE(detail.id);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  // Load portfolio content
  useEffect(() => {
    if (!course?.portfolio_artifact_id) return;
    let cancelled = false;
    setPortfolioContent(undefined);
    getArtifact(course.portfolio_artifact_id).then((artifact) => {
      if (!cancelled) {
        setPortfolioContent(artifact.content_pointer ?? undefined);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [course?.portfolio_artifact_id, lessonIndex, activityIndex]);

  if (!course) return null;

  if (!activity?.activity_spec) {
    return <p className="text-muted-foreground">Activity not available yet.</p>;
  }

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

  const isLastActivity = activityIndex >= totalActivities - 1;
  const isLastLesson = lessonIndex === course.input_objectives.length - 1;

  function connectSSE(activityId: string) {
    cleanupRef.current?.();
    cleanupRef.current = connectReviewStream(
      activityId,
      (event) => {
        if (event.type === 'review_complete') {
          setFeedback(event.data);
          setReviewing(false);
          setRetrying(false);
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
    if (!isLastActivity) {
      navigate(`/courses/${courseId}/lessons/${lessonIndex}/activity/${activityIndex + 1}`);
    } else if (isLastLesson) {
      navigate(`/courses/${courseId}/assessment`);
    } else {
      navigate(`/courses/${courseId}/lessons/${lessonIndex + 1}`);
    }
  }

  const lessonTitle = course?.lesson_titles?.[lessonIndex]?.lesson_title;

  return (
    <div className="space-y-6">
      <div>
        <button
          onClick={() => navigate(`/courses/${courseId}/lessons/${lessonIndex}`)}
          className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3 w-3" aria-hidden="true" />
          Back to lesson
        </button>
        <h2 className="text-lg font-semibold">
          {lessonTitle
            ? `${lessonTitle} — Activity ${activityIndex + 1}`
            : `Lesson ${lessonIndex + 1} — Activity ${activityIndex + 1}`}
        </h2>

        {/* Activity progress dots */}
        <div className="mt-2 flex items-center gap-1.5" role="navigation" aria-label="Activity progress">
          {activities.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate(`/courses/${courseId}/lessons/${lessonIndex}/activity/${a.activity_index}`)}
              className="p-0.5"
              aria-label={`Activity ${a.activity_index + 1}: ${a.activity_status}`}
              aria-current={a.activity_index === activityIndex ? 'step' : undefined}
            >
              {a.activity_status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : a.activity_index === activityIndex ? (
                <Circle className="h-4 w-4 text-primary fill-primary" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            {activityIndex + 1} of {totalActivities}
          </span>
        </div>
      </div>

      <section aria-labelledby="task-heading">
        <h3 id="task-heading" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Task</h3>
        <ActivityPanel spec={activity.activity_spec} />
      </section>

      {/* Celebration when feedback arrives with mastery */}
      {displayFeedback && passed && !retrying && (
        <CelebrationOverlay
          tier={isLastActivity ? (isLastLesson ? 'course' : 'lesson') : 'activity'}
          message={
            isLastActivity && isLastLesson
              ? 'All lessons complete! Time for your capstone.'
              : isLastActivity
                ? 'Lesson complete! On to the next one.'
                : 'Activity complete! Keep building.'
          }
        />
      )}

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
            portfolioReadiness={displayFeedback.portfolio_readiness}
            employerRelevanceNotes={displayFeedback.employer_relevance_notes}
            resumeBulletSeed={displayFeedback.resume_bullet_seed}
          />
          <div className="flex flex-wrap gap-3 mt-4">
            {passed ? (
              <>
                <Button onClick={handleContinue}>
                  {!isLastActivity
                    ? 'Next Activity'
                    : isLastLesson
                      ? 'Take Assessment'
                      : 'Next Lesson'}
                </Button>
                {displayFeedback.revision_encouraged && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFeedback(null);
                      setRetrying(true);
                    }}
                  >
                    Revise for Portfolio Quality
                  </Button>
                )}
              </>
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
          <SubmissionForm onSubmit={handleSubmit} initialValue={portfolioContent} />
          {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
        </section>
      )}
    </div>
  );
}
