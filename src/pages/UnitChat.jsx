import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { TYPE_LABELS } from '../lib/constants.js';
import { renderMd, esc, formatDuration } from '../lib/helpers.js';
import { getUnitProgress, saveUnitProgress, getJourney } from '../../js/storage.js';
import { syncInBackground } from '../lib/syncDebounce.js';
import {
  generateFirstActivity, generateNextActivity,
  recordDraft, recordTextDraft, submitDispute, askAboutActivity,
} from '../lib/unitEngine.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import InstructionMessage from '../components/chat/InstructionMessage.jsx';
import DraftMessage from '../components/chat/DraftMessage.jsx';
import FeedbackCard from '../components/chat/FeedbackCard.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import DisputeModal from '../components/modals/DisputeModal.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';

export default function UnitChat() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { state, dispatch } = useApp();
  const { show: showModal } = useModal();
  const unit = state.units.find(u => u.unitId === unitId);
  const courseGroup = state.courseGroups.find(cg => cg.units?.some(u => u.unitId === unitId));

  const [progress, setProgress] = useState(null);
  const [journeyPlan, setJourneyPlan] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Load progress and journey on mount
  useEffect(() => {
    let cancelled = false;
    setProgress(null);
    setJourneyPlan(null);
    setLoading('');
    setError('');

    (async () => {
      const p = await getUnitProgress(unitId);
      if (cancelled) return;

      if (p) {
        setProgress(p);

        // Load journey plan for this course
        if (courseGroup) {
          const j = await getJourney(courseGroup.courseId);
          if (j?.plan) setJourneyPlan(j.plan);
        }

        // Generate first activity if none exist
        if (!p.activities?.length && courseGroup) {
          setLoading('generating');
          try {
            const j = await getJourney(courseGroup.courseId);
            if (j?.plan) {
              setJourneyPlan(j.plan);
              const firstActivity = await generateFirstActivity(unit, j.plan, courseGroup);
              const newProgress = {
                ...p,
                status: 'in_progress',
                activities: [firstActivity],
                startedAt: p.startedAt || Date.now(),
              };
              await saveUnitProgress(unitId, newProgress);
              dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
              syncInBackground(`progress:${unitId}`);
              if (!cancelled) setProgress(newProgress);
            }
          } catch (e) {
            if (!cancelled) setError(e.message || 'Failed to generate activity.');
          }
          if (!cancelled) setLoading('');
        }

        // Scroll to specific draft if navigated from portfolio
        const scrollTo = searchParams.get('scrollTo');
        if (scrollTo) {
          setTimeout(() => {
            document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      } else {
        // No progress — shouldn't happen in normal flow (UnitsList creates the record)
        setError('No progress found for this unit. Return to the course page to start.');
      }
    })();

    return () => { cancelled = true; };
  }, [unitId]);

  // Determine format from course unit definition
  const unitDef = courseGroup?.units?.find(u => u.unitId === unitId);
  const unitFormat = unitDef?.format || 'screenshot';

  // Activity Q&A or text submission
  const handleActivitySend = useCallback(async (text, isSubmit = false) => {
    if (!progress) return;
    const activity = progress.activities[progress.currentActivityIndex];
    if (!activity) return;

    // Text submission for assessment
    if (isSubmit) {
      setLoading('recording');
      try {
        const { newProgress } = await recordTextDraft(unit, progress, activity, text);
        setProgress(newProgress);
        dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
      } catch (e) {
        setError(e.message || 'Submission failed.');
      }
      setLoading('');
      return;
    }

    // Q&A flow
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    const updatedActivities = progress.activities.map(a =>
      a.id === activity.id ? { ...a, messages: [...(a.messages || []), userMsg] } : a
    );
    const optimistic = { ...progress, activities: updatedActivities };
    setProgress(optimistic);

    setLoading('qa');
    try {
      const { newProgress } = await askAboutActivity(unit, progress, activity, text, courseGroup);
      setProgress(newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
    } catch { /* silent */ }
    setLoading('');
  }, [progress, unit, unitId, dispatch, courseGroup]);

  // Record screenshot draft
  const handleRecord = useCallback(async () => {
    if (!progress) return;
    const activity = progress.activities[progress.currentActivityIndex];
    if (!activity) return;
    setLoading('recording');
    try {
      const { newProgress } = await recordDraft(unit, progress, activity);
      setProgress(newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
    } catch (e) {
      setError(e.message || 'Recording failed.');
    }
    setLoading('');
  }, [progress, unit, unitId, dispatch]);

  // Advance to next activity
  const handleNextActivity = useCallback(async () => {
    if (!progress || !journeyPlan) return;
    const nextIndex = progress.currentActivityIndex + 1;
    let newProgress = { ...progress, currentActivityIndex: nextIndex };

    if (!newProgress.activities[nextIndex]) {
      setLoading('generating');
      try {
        const nextActivity = await generateNextActivity(unit, newProgress, journeyPlan, courseGroup);
        newProgress = { ...newProgress, activities: [...newProgress.activities, nextActivity] };
      } catch (e) {
        setError(e.message || 'Failed to generate next activity.');
        setLoading('');
        return;
      }
      setLoading('');
    }

    await saveUnitProgress(unitId, newProgress);
    dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
    syncInBackground(`progress:${unitId}`);
    setProgress(newProgress);
  }, [progress, journeyPlan, unit, unitId, dispatch]);

  // Dispute
  const handleDispute = useCallback((draft) => {
    const activity = progress.activities[progress.currentActivityIndex];
    showModal(
      <DisputeModal onSubmit={async (text) => {
        setLoading('dispute');
        try {
          const { newProgress } = await submitDispute(unit, progress, activity, draft, text);
          setProgress(newProgress);
          dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
        } catch (e) {
          setError(e.message || 'Dispute failed.');
        }
        setLoading('');
      }} />
    );
  }, [progress, unit, unitId, dispatch, showModal]);

  // Reset unit
  const handleReset = () => {
    showModal(
      <ConfirmModal
        title="Reset Unit?"
        message="This will delete all progress for this unit. You'll start from scratch."
        confirmLabel="Reset Unit"
        onConfirm={async () => {
          const { deleteUnitProgress } = await import('../../js/storage.js');
          await deleteUnitProgress(unitId);
          dispatch({ type: 'RESET_UNIT', unitId });
          navigate(courseGroup ? `/courses/${courseGroup.courseId}` : '/courses');
        }}
      />
    );
  };

  if (!unit) return <p>Unit not found.</p>;

  // --- Render ---
  const activity = progress?.activities?.[progress.currentActivityIndex];
  const journeyUnit = journeyPlan?.units?.find(u => u.unitId === unitId);
  const totalActivities = journeyUnit?.activities?.length || progress?.activities?.length || 0;
  const isUnitDone = progress?.currentActivityIndex >= totalActivities && totalActivities > 0
    && progress?.drafts?.some(d => {
      const lastAct = progress.activities[progress.activities.length - 1];
      return lastAct && d.activityId === lastAct.id && d.recommendation === 'advance';
    });
  const activityDrafts = activity ? (progress?.drafts?.filter(d => d.activityId === activity.id) || []) : [];
  const latestDraft = activityDrafts[activityDrafts.length - 1];
  const isPassed = latestDraft?.recommendation === 'advance';
  const remaining = totalActivities - (progress?.currentActivityIndex || 0) - 1;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button
          className="back-btn"
          aria-label={courseGroup ? 'Back to course' : 'Back to courses'}
          onClick={() => navigate(courseGroup ? `/courses/${courseGroup.courseId}` : '/courses')}
        >&larr;</button>
        <div className="course-header-info">
          {courseGroup && <span className="course-header-group">{courseGroup.name}</span>}
          <h2>{unit.name}</h2>
        </div>
        {progress && <button className="reset-btn" onClick={handleReset} aria-label="Reset unit" title="Reset unit">&#8635;</button>}
      </div>

      <ChatArea>
        {loading === 'generating' && !progress?.activities?.length && <ThinkingSpinner text="Preparing your first activity..." />}

        {/* Completed activities */}
        {progress?.activities?.slice(0, progress.currentActivityIndex).map((a, ai) => {
          const drafts = progress.drafts.filter(d => d.activityId === a.id);
          return (
            <div key={ai}>
              <div className="chat-section-heading" role="separator">
                {TYPE_LABELS[a.type] || a.type}: {a.goal}
              </div>
              <InstructionMessage text={a.instruction} rubricCriteria={a.rubricCriteria} />
              {renderTimeline(a, drafts)}
            </div>
          );
        })}

        {/* Current activity */}
        {activity && !isUnitDone && (
          <>
            <div className="chat-section-heading" role="separator">
              {TYPE_LABELS[activity.type] || activity.type}: {activity.goal}
            </div>
            <InstructionMessage text={activity.instruction} rubricCriteria={activity.rubricCriteria} />
            {renderTimeline(activity, activityDrafts, true, handleDispute, handleRecord)}

            {loading === 'recording' && <ThinkingSpinner text="Evaluating your work..." />}
            {loading === 'qa' && <ThinkingSpinner />}
            {loading === 'generating' && progress?.activities?.length > 0 && <ThinkingSpinner text="Preparing next activity..." />}

            {isPassed && remaining > 0 && (
              <button className="primary-btn" onClick={handleNextActivity}>
                Continue to next activity ({remaining} remaining)
              </button>
            )}
            {isPassed && remaining <= 0 && (
              <div className="msg msg-response" style={{ textAlign: 'center' }}>
                <p>Unit complete! Return to the course page to retake the summative assessment.</p>
                <button className="primary-btn" onClick={() => navigate(courseGroup ? `/courses/${courseGroup.courseId}` : '/courses')}>
                  Back to Course
                </button>
              </div>
            )}
          </>
        )}

        {/* Unit done */}
        {isUnitDone && (
          <div className="msg msg-response" style={{ textAlign: 'center' }}>
            <h3>Unit Complete</h3>
            <p>Return to the course page to continue your journey or retake the summative.</p>
            <button className="primary-btn" onClick={() => navigate(courseGroup ? `/courses/${courseGroup.courseId}` : '/courses')}>
              Back to Course
            </button>
          </div>
        )}

        {error && <div className="msg msg-response" role="alert" aria-live="assertive" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      {/* Compose bar — capture + text always available */}
      {activity && !isUnitDone && !loading && (
        <ComposeBar
          placeholder={!isPassed ? 'Write a response or ask a question...' : 'Ask a question about this activity...'}
          onSend={handleActivitySend}
          disabled={!!loading}
          showSubmit={!isPassed}
          onCapture={handleRecord}
        />
      )}
    </div>
  );
}

/** Render timeline of drafts + Q&A messages for an activity. */
function renderTimeline(activity, drafts, isCurrent = false, onDispute, onRerecord) {
  const items = [];
  for (const d of drafts) {
    items.push({ type: 'draft', data: d, ts: d.timestamp });
  }
  for (const m of activity.messages || []) {
    items.push({ type: 'message', data: m, ts: m.timestamp });
  }
  items.sort((a, b) => a.ts - b.ts);

  const lastDraft = drafts[drafts.length - 1];
  const isPassed = lastDraft?.recommendation === 'advance';

  return items.map((item, i) => {
    if (item.type === 'draft') {
      const isLatest = isCurrent && item.data.id === lastDraft?.id;
      return (
        <div key={`d-${i}`} id={item.data.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <DraftMessage draft={item.data} />
          <FeedbackCard
            draft={item.data}
            isLatest={isLatest}
            isPassed={isPassed}
            onDispute={isLatest && onDispute ? () => onDispute(item.data) : null}
            onRerecord={isLatest && onRerecord ? onRerecord : null}
          />
        </div>
      );
    }
    if (item.data.role === 'user') return <UserMessage key={`m-${i}`} content={item.data.content} />;
    return <AssistantMessage key={`m-${i}`} content={item.data.content} />;
  });
}
