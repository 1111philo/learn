import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { TYPE_LABELS } from '../lib/constants.js';
import { renderMd, esc, formatDuration } from '../lib/helpers.js';
import {
  getUnitProgress, saveUnitProgress,
  clearDiagnosticState, saveDiagnosticState,
} from '../../js/storage.js';
import { syncInBackground } from '../lib/syncDebounce.js';
import { updateProfileFromFeedbackInBackground, updateProfileInBackground } from '../lib/profileQueue.js';
import {
  startDiagnostic, sendDiagnosticMessage, generatePlanAndFirstActivity,
  generateNextActivity, recordDraft, submitDispute, askAboutActivity,
} from '../lib/unitEngine.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import InstructionMessage from '../components/chat/InstructionMessage.jsx';
import DraftMessage from '../components/chat/DraftMessage.jsx';
import FeedbackCard from '../components/chat/FeedbackCard.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import CompletionSummary from '../components/chat/CompletionSummary.jsx';
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
  const [diagnostic, setDiagnostic] = useState({ phase: null, activity: null, messages: [], result: null });
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Load progress on mount or unit change
  useEffect(() => {
    let cancelled = false;
    setDiagnostic({ phase: null, activity: null, messages: [], result: null });
    setProgress(null);
    setLoading('');
    setError('');

    (async () => {
      const p = await getUnitProgress(unitId);
      if (cancelled) return;

      if (p) {
        setProgress(p);
        // Scroll to specific draft if navigated from portfolio
        const scrollTo = searchParams.get('scrollTo');
        if (scrollTo) {
          setTimeout(() => {
            document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
        }
      } else {
        // Start diagnostic
        setLoading('diagnostic');
        try {
          const { result, activity } = await startDiagnostic(unit, state.courseGroups, state.units, state.allProgress);
          if (cancelled) return;

          setDiagnostic({ phase: 'activity', activity, messages: [], result: null });

          if (result.done) {
            // Agent assessed from profile alone
            const diagResult = {
              score: result.score || 0.7,
              feedback: result.feedback || result.message,
              strengths: result.strengths || [],
              improvements: result.improvements || [],
              recommendation: 'advance', passed: true,
            };
            setDiagnostic(prev => ({ ...prev, result: { unitId, result: diagResult } }));
            updateProfileInBackground(diagResult, unit, activity);
          }
        } catch (e) {
          if (!cancelled) setError(e.message || 'Failed to start diagnostic.');
        }
        if (!cancelled) setLoading('');
      }
    })();

    return () => { cancelled = true; };
  }, [unitId]);

  // Generate plan after diagnostic completes
  const handleStartCourse = useCallback(async () => {
    setLoading('plan');
    try {
      const diagResult = diagnostic.result?.result || null;
      const { plan, firstActivity } = await generatePlanAndFirstActivity(
        unit, diagResult, state.courseGroups, state.units, state.allProgress, state.preferences
      );
      const newProgress = {
        unitId, status: 'in_progress', currentActivityIndex: 0,
        diagnostic: diagnostic.activity ? {
          instruction: diagnostic.activity.instruction,
          messages: diagnostic.messages,
          result: diagResult,
        } : null,
        learningPlan: { activities: plan.activities, finalWorkProductDescription: plan.finalWorkProductDescription, workProductTool: plan.workProductTool },
        activities: [firstActivity], drafts: [],
        startedAt: Date.now(), completedAt: null, finalWorkProductUrl: null,
      };
      await saveUnitProgress(unitId, newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
      syncInBackground(`progress:${unitId}`);
      clearDiagnosticState();
      setProgress(newProgress);
      setDiagnostic({ phase: null, activity: null, messages: [], result: null });
    } catch (e) {
      setError(e.message || 'Failed to generate course.');
    }
    setLoading('');
  }, [unitId, unit, diagnostic, state, dispatch]);

  // Diagnostic message send
  const handleDiagnosticSend = useCallback(async (text) => {
    const newMsgs = [...diagnostic.messages, { role: 'user', content: text }];
    setDiagnostic(prev => ({ ...prev, messages: newMsgs }));
    setLoading('diagnostic-reply');

    try {
      const result = await sendDiagnosticMessage(text, unit, diagnostic.activity, diagnostic.messages, state.courseGroups, state.units, state.allProgress);
      const updatedMsgs = [...newMsgs, { role: 'assistant', content: JSON.stringify(result) }];
      setDiagnostic(prev => ({ ...prev, messages: updatedMsgs }));

      if (result.done) {
        const diagResult = {
          score: result.score || 0, feedback: result.feedback || result.message,
          strengths: result.strengths || [], improvements: result.improvements || [],
          recommendation: 'advance', passed: true,
        };
        setDiagnostic(prev => ({ ...prev, result: { unitId, result: diagResult } }));
        updateProfileInBackground(diagResult, unit, diagnostic.activity);
        // Don't auto-advance — let the user read the final message and click Continue
      }
    } catch (e) {
      setDiagnostic(prev => ({
        ...prev,
        messages: [...newMsgs, { role: 'assistant', content: JSON.stringify({ message: 'Something went wrong. Try again or skip.' }) }],
      }));
    }
    setLoading('');
  }, [diagnostic, unit, state, unitId, handleStartCourse]);

  // Skip diagnostic
  const handleSkipDiagnostic = useCallback(() => {
    const userText = diagnostic.messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
    if (userText) updateProfileFromFeedbackInBackground(userText, unit, diagnostic.activity || { type: 'diagnostic', goal: 'Skills check' });
    handleStartCourse();
  }, [diagnostic, unit, handleStartCourse]);

  // Activity Q&A
  const handleActivitySend = useCallback(async (text) => {
    if (!progress) return;
    const activity = progress.activities[progress.currentActivityIndex];
    if (!activity) return;

    // Show user message immediately
    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    const updatedActivities = progress.activities.map(a =>
      a.id === activity.id ? { ...a, messages: [...(a.messages || []), userMsg] } : a
    );
    const optimistic = { ...progress, activities: updatedActivities };
    setProgress(optimistic);

    setLoading('qa');
    try {
      const { newProgress } = await askAboutActivity(unit, progress, activity, text);
      setProgress(newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId, progress: newProgress });
    } catch { /* silent */ }
    setLoading('');
  }, [progress, unit, unitId, dispatch]);

  // Record draft
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
    if (!progress) return;
    const nextIndex = progress.currentActivityIndex + 1;
    let newProgress = { ...progress, currentActivityIndex: nextIndex };

    // Generate next activity if not yet generated
    if (!newProgress.activities[nextIndex]) {
      setLoading('generating');
      try {
        const nextActivity = await generateNextActivity(unit, newProgress, state.courseGroups, state.units, state.allProgress);
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
  }, [progress, unit, unitId, state, dispatch]);

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
  const planActivities = progress?.learningPlan?.activities;
  const isCompleted = progress?.status === 'completed';
  const diagMsgCount = diagnostic.messages.filter(m => m.role === 'user').length;
  const showSkip = diagMsgCount >= 2 && !diagnostic.result;
  const showContinue = !!diagnostic.result && !progress;
  const activityDrafts = activity ? (progress?.drafts?.filter(d => d.activityId === activity.id) || []) : [];
  const latestDraft = activityDrafts[activityDrafts.length - 1];
  const isPassed = latestDraft?.recommendation === 'advance';
  const remaining = planActivities ? planActivities.length - progress.currentActivityIndex - 1 : 0;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button
          className="back-btn"
          aria-label={courseGroup ? 'Back to units' : 'Back to courses'}
          onClick={() => navigate(courseGroup ? `/courses/${courseGroup.courseId}` : '/courses')}
        >&larr;</button>
        <div className="course-header-info">
          {courseGroup && <span className="course-header-group">{courseGroup.name}</span>}
          <h2>{unit.name}</h2>
        </div>
        {progress && <button className="reset-btn" onClick={handleReset} aria-label="Reset unit" title="Reset unit">&#8635;</button>}
      </div>

      <ChatArea>
        {/* Skills Check */}
        {(diagnostic.activity || progress?.diagnostic) && (
          <div className="chat-section-heading" role="separator">Skills Check</div>
        )}
        {diagnostic.activity && (
          <>
            <AssistantMessage content={diagnostic.activity.instruction} />
            {diagnostic.messages.map((m, i) => (
              m.role === 'user'
                ? <UserMessage key={i} content={m.content} />
                : <AssistantMessage key={i} content={m.content} />
            ))}
          </>
        )}
        {!diagnostic.activity && progress?.diagnostic && (
          <>
            <AssistantMessage content={progress.diagnostic.instruction || ''} />
            {progress.diagnostic.messages?.map((m, i) => (
              m.role === 'user'
                ? <UserMessage key={i} content={m.content} />
                : <AssistantMessage key={i} content={m.content} />
            ))}
          </>
        )}

        {loading === 'diagnostic' && <ThinkingSpinner text="Preparing your skills check..." />}
        {loading === 'diagnostic-reply' && <ThinkingSpinner />}
        {loading === 'plan' && <ThinkingSpinner text="Building your learning plan..." />}

        {showSkip && (
          <button className="skip-step-btn" onClick={handleSkipDiagnostic}>Skip to activities</button>
        )}
        {showContinue && (
          <button className="skip-step-btn" onClick={handleStartCourse} style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            Continue to activities
          </button>
        )}

        {/* Completed activities */}
        {progress?.activities?.slice(0, progress.currentActivityIndex).map((a, ai) => {
          const drafts = progress.drafts.filter(d => d.activityId === a.id);
          return (
            <div key={ai}>
              <div className="chat-section-heading" role="separator">
                {TYPE_LABELS[a.type] || a.type}: {a.goal}
              </div>
              <InstructionMessage text={a.instruction} />
              {renderTimeline(a, drafts)}
            </div>
          );
        })}

        {/* Current activity */}
        {activity && !isCompleted && (
          <>
            <div className="chat-section-heading" role="separator">
              {TYPE_LABELS[activity.type] || activity.type}: {activity.goal}
            </div>
            <InstructionMessage text={activity.instruction} />
            {renderTimeline(activity, activityDrafts, true, handleDispute, handleRecord)}

            {loading === 'recording' && <ThinkingSpinner text="Evaluating your work..." />}
            {loading === 'qa' && <ThinkingSpinner />}
            {loading === 'generating' && <ThinkingSpinner text="Preparing next activity..." />}

            {!activityDrafts.length && !loading && (
              <div style={{ textAlign: 'center', margin: '8px 0' }}>
                <button className="record-btn" onClick={handleRecord} aria-label="Capture screenshot">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '6px' }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  Capture
                </button>
              </div>
            )}
            {isPassed && remaining > 0 && (
              <button className="primary-btn" onClick={handleNextActivity}>
                Continue to next activity ({remaining} remaining)
              </button>
            )}
          </>
        )}

        {/* Completion */}
        {isCompleted && <CompletionSummary unit={unit} progress={progress} />}

        {error && <div className="msg msg-response" role="alert" aria-live="assertive" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      {/* Compose bar */}
      {diagnostic.phase === 'activity' && !diagnostic.result && !loading && (
        <ComposeBar
          placeholder="Describe what you know..."
          onSend={handleDiagnosticSend}
          disabled={!!loading}
        />
      )}
      {activity && !isCompleted && !loading && (
        <ComposeBar
          placeholder="Ask a question about this activity..."
          onSend={handleActivitySend}
          disabled={!!loading}
        />
      )}
    </div>
  );
}

/** Render timeline of drafts + Q&A messages for an activity. */
function renderTimeline(activity, drafts, isCurrent = false, onDispute, onRerecord) {
  // Merge drafts + messages, sort by timestamp
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
