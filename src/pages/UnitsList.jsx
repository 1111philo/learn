import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { COURSE_PHASES } from '../lib/constants.js';
import {
  getSummative, getCoursePhase, getJourney, getSummativeAttempts,
  getRubricReviewState,
} from '../../js/storage.js';
import {
  initCourse, sendRubricReviewMessage, confirmRubric,
  recordSummativeCapture, submitSummativeAttempt,
  generateGapAndJourney, requestSummativeRetake,
  generateRemediationActivities,
} from '../lib/unitEngine.js';
import { updateProfileOnMasteryInBackground } from '../lib/profileQueue.js';

import { useModal } from '../contexts/ModalContext.jsx';
import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import SummativeCard from '../components/chat/SummativeCard.jsx';
import RubricFeedback from '../components/chat/RubricFeedback.jsx';
import InstructionMessage from '../components/chat/InstructionMessage.jsx';
import DraftMessage from '../components/chat/DraftMessage.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';

export default function UnitsList() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const { courseGroups, allProgress } = state;

  const { show: showModal } = useModal();
  const group = courseGroups.find(cg => cg.courseId === courseGroupId);

  const handleResetCourse = () => {
    showModal(
      <ConfirmModal
        title="Reset Course?"
        message="This will delete all progress for this course — assessment, journey, and activities. You'll start from scratch."
        confirmLabel="Reset Course"
        onConfirm={async () => {
          const { deleteCourseProgress } = await import('../../js/storage.js');
          await deleteCourseProgress(courseGroupId);
          // Reset local state
          setPhase(null);
          setSummative(null);
          setJourney(null);
          setAttempts([]);
          setReviewMessages([]);
          setCaptures([]);
          setCurrentStep(0);
          // Reload — will trigger summative generation
          window.location.reload();
        }}
      />
    );
  };

  const [phase, setPhase] = useState(null);
  const [summative, setSummative] = useState(null);
  const [journey, setJourney] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [reviewMessages, setReviewMessages] = useState([]);
  const [captures, setCaptures] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Load course state on mount
  useEffect(() => {
    if (!group) return;
    let cancelled = false;

    (async () => {
      const existingPhase = await getCoursePhase(courseGroupId);
      if (cancelled) return;

      if (existingPhase) {
        setPhase(existingPhase);
        const s = await getSummative(courseGroupId);
        if (s) setSummative(s);
        const j = await getJourney(courseGroupId);
        if (j) setJourney(j);
        const a = await getSummativeAttempts(courseGroupId);
        setAttempts(a);
        const rs = await getRubricReviewState(courseGroupId);
        if (rs?.messages) setReviewMessages(rs.messages);
      } else {
        setLoading('summative');
        try {
          const s = await initCourse(group);
          if (cancelled) return;
          setSummative(s);
          setPhase(COURSE_PHASES.RUBRIC_REVIEW);
        } catch (e) {
          if (!cancelled) setError(e.message || 'Failed to generate summative.');
        }
        if (!cancelled) setLoading('');
      }
    })();

    return () => { cancelled = true; };
  }, [courseGroupId]);

  // Rubric review conversation
  const handleReviewSend = useCallback(async (text) => {
    if (!summative || !group) return;
    setLoading('review');
    try {
      const { result, summative: newSummative, messages } = await sendRubricReviewMessage(
        courseGroupId, text, summative, reviewMessages, group
      );
      setReviewMessages(messages);
      if (newSummative) setSummative(newSummative);
      if (result.done) {
        await confirmRubric(courseGroupId);
        setPhase(COURSE_PHASES.BASELINE_ATTEMPT);
        setCurrentStep(0);
        setCaptures([]);
      }
    } catch (e) {
      setError(e.message || 'Failed to send message.');
    }
    setLoading('');
  }, [courseGroupId, summative, reviewMessages, group]);

  const handleSkipReview = useCallback(async () => {
    await confirmRubric(courseGroupId);
    setCurrentStep(0);
    setCaptures([]);
    setPhase(COURSE_PHASES.BASELINE_ATTEMPT);
  }, [courseGroupId]);

  // Capture current summative step, then advance to next
  const handleStepCapture = useCallback(async () => {
    setLoading('capturing');
    try {
      const capture = await recordSummativeCapture(courseGroupId, currentStep);
      const newCaptures = [...captures, capture];
      setCaptures(newCaptures);

      const totalSteps = summative?.task?.steps?.length || 0;

      if (newCaptures.length === totalSteps) {
        // All steps captured — submit for assessment
        setLoading('assessing');
        const { attempt, mastery } = await submitSummativeAttempt(courseGroupId, group, newCaptures);
        setAttempts(prev => [...prev, attempt]);
        setCaptures([]);
        setCurrentStep(0);

        if (mastery) {
          setPhase(COURSE_PHASES.COMPLETED);
          updateProfileOnMasteryInBackground(group, attempt, []);
        } else if (attempt.isBaseline) {
          setLoading('journey');
          const { journey: j } = await generateGapAndJourney(courseGroupId, group);
          setJourney({ plan: j, phase: COURSE_PHASES.FORMATIVE_LEARNING });
          setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
        } else {
          setLoading('journey');
          const weakCriteria = (attempt.criteriaScores || [])
            .filter(cs => cs.score < 0.51)
            .map(cs => cs.criterion);
          const { journey: j } = await generateRemediationActivities(courseGroupId, group, weakCriteria);
          setJourney({ plan: j, phase: COURSE_PHASES.FORMATIVE_LEARNING });
          setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
        }
      } else {
        // Advance to next step
        setCurrentStep(newCaptures.length);
      }
    } catch (e) {
      setError(e.message || 'Capture failed.');
    }
    setLoading('');
  }, [courseGroupId, currentStep, captures, summative, group]);

  const handleRetake = useCallback(async () => {
    await requestSummativeRetake(courseGroupId);
    setCaptures([]);
    setCurrentStep(0);
    setPhase(COURSE_PHASES.SUMMATIVE_RETAKE);
  }, [courseGroupId]);

  if (!group) return <p>Course not found.</p>;

  function statusIcon(status) {
    if (status === 'completed') return '\u2713';
    if (status === 'in_progress') return '\u25B6';
    return '\u25CB';
  }

  const latestAttempt = attempts[attempts.length - 1];
  const journeyUnits = journey?.plan?.units || [];
  const steps = summative?.task?.steps || [];
  const isBaseline = phase === COURSE_PHASES.BASELINE_ATTEMPT;
  const isRetake = phase === COURSE_PHASES.SUMMATIVE_RETAKE;
  const isSummativeActive = isBaseline || isRetake;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{group.name}</h2>
        </div>
        {phase && <button className="reset-btn" onClick={handleResetCourse} aria-label="Reset course" title="Reset course">&#8635;</button>}
      </div>

      {/* Setup phase */}
      {(phase === COURSE_PHASES.SUMMATIVE_SETUP || loading === 'summative') && (
        <ChatArea>
          <ThinkingSpinner text="Designing your assessment..." />
        </ChatArea>
      )}

      {/* Rubric review phase */}
      {phase === COURSE_PHASES.RUBRIC_REVIEW && summative && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">Assessment Overview</div>
          <SummativeCard summative={summative} />
          {reviewMessages.map((m, i) => (
            m.role === 'user'
              ? <UserMessage key={i} content={m.content} />
              : <AssistantMessage key={i} content={m.content} />
          ))}
          {loading === 'review' && <ThinkingSpinner />}
          {!loading && (
            <div style={{ textAlign: 'center', margin: '8px 0' }}>
              <button className="primary-btn" onClick={handleSkipReview}>
                Start Assessment
              </button>
            </div>
          )}
        </ChatArea>
      )}

      {/* Summative attempt — step by step */}
      {isSummativeActive && summative && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">
            {isBaseline ? 'Diagnostic Assessment' : 'Summative Assessment'}
          </div>

          {/* Completed steps */}
          {captures.map((cap, i) => {
            const step = steps[cap.stepIndex];
            return (
              <div key={i}>
                <InstructionMessage text={step?.instruction} />
                <DraftMessage draft={{ screenshotKey: cap.screenshotKey, url: cap.url, timestamp: Date.now() }} />
              </div>
            );
          })}

          {/* Current step */}
          {currentStep < steps.length && !loading && (
            <>
              <InstructionMessage text={`Step ${currentStep + 1} of ${steps.length}: ${steps[currentStep].instruction}`} />
              <div style={{ textAlign: 'center', margin: '8px 0' }}>
                <button className="record-btn" onClick={handleStepCapture} aria-label="Capture screenshot">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '6px' }}>
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                  </svg>
                  Capture
                </button>
              </div>
            </>
          )}

          {loading === 'capturing' && <ThinkingSpinner text="Capturing..." />}
          {loading === 'assessing' && <ThinkingSpinner text="Evaluating your work..." />}
          {loading === 'journey' && <ThinkingSpinner text="Building your learning journey..." />}
        </ChatArea>
      )}

      {(phase === COURSE_PHASES.GAP_ANALYSIS || phase === COURSE_PHASES.JOURNEY_GENERATION) && (
        <ChatArea>
          <ThinkingSpinner text="Building your learning journey..." />
        </ChatArea>
      )}

      {/* Formative learning — show unit cards */}
      {phase === COURSE_PHASES.FORMATIVE_LEARNING && (
        <>
          {latestAttempt && (
            <div style={{ padding: '0 var(--space)' }}>
              <div className="chat-section-heading" role="separator">Assessment Results</div>
              <RubricFeedback attempt={latestAttempt} />
            </div>
          )}

          <div style={{ padding: '0 var(--space)', margin: 'var(--space) 0' }}>
            <div className="chat-section-heading" role="separator">Learning Journey</div>
          </div>

          <div className="course-list" role="list">
            {journeyUnits.map((ju, i) => {
              const unitDef = group.units?.find(u => u.unitId === ju.unitId);
              const progress = allProgress[ju.unitId];
              const status = progress?.status || 'not_started';
              const actCount = ju.activities?.length || 0;
              const criteria = ju.activities?.flatMap(a => a.rubricCriteria || []).filter((v, idx, arr) => arr.indexOf(v) === idx) || [];

              return (
                <button
                  key={ju.unitId}
                  className="course-card stagger-item"
                  style={{ animationDelay: `${i * 40}ms` }}
                  role="listitem"
                  onClick={() => navigate(`/unit/${ju.unitId}`)}
                >
                  <span className="course-status" aria-hidden="true">{statusIcon(status)}</span>
                  <div className="course-info">
                    <strong>{unitDef?.name || ju.unitId}</strong>
                    {unitDef?.description && <p>{unitDef.description}</p>}
                    <small>{actCount} activit{actCount !== 1 ? 'ies' : 'y'}</small>
                    {criteria.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '3px' }}>
                        {criteria.map((c, ci) => (
                          <span key={ci} style={{
                            fontSize: '0.65rem', padding: '1px 5px', borderRadius: '6px',
                            background: 'var(--color-primary-light, #e8f0fe)', color: 'var(--color-primary, #1a73e8)',
                          }}>{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ padding: '0 var(--space)', marginTop: 'var(--space)' }}>
            <button className="primary-btn" onClick={handleRetake} style={{ width: '100%' }}>
              Retake Summative Assessment
            </button>
          </div>
        </>
      )}

      {/* Completed */}
      {phase === COURSE_PHASES.COMPLETED && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">Summative Assessment</div>
          {latestAttempt && <RubricFeedback attempt={latestAttempt} />}
          <div className="completion-summary msg msg-response">
            <h3>Mastery Achieved!</h3>
            <div className="completion-stats">
              <span>{attempts.length} attempt{attempts.length !== 1 ? 's' : ''}</span>
              <span>{journeyUnits.length} unit{journeyUnits.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="action-bar">
              <button className="primary-btn" onClick={() => navigate('/courses')}>Next Course</button>
            </div>
          </div>
        </ChatArea>
      )}

      {error && <div style={{ padding: '8px var(--space)', color: 'var(--color-warning)' }} role="alert">{error}</div>}

      {/* Compose bar for rubric review */}
      {phase === COURSE_PHASES.RUBRIC_REVIEW && !loading && (
        <ComposeBar
          placeholder="Questions or feedback on the rubric..."
          onSend={handleReviewSend}
          disabled={!!loading}
        />
      )}
    </div>
  );
}
