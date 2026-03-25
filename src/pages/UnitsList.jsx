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

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import SummativeCard from '../components/chat/SummativeCard.jsx';
import RubricFeedback from '../components/chat/RubricFeedback.jsx';
import CaptureStep from '../components/chat/CaptureStep.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';

export default function UnitsList() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const { courseGroups, allProgress } = state;

  const group = courseGroups.find(cg => cg.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [summative, setSummative] = useState(null);
  const [journey, setJourney] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [reviewMessages, setReviewMessages] = useState([]);
  const [captures, setCaptures] = useState([]);
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
        // First time: generate summative
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
      }
    } catch (e) {
      setError(e.message || 'Failed to send message.');
    }
    setLoading('');
  }, [courseGroupId, summative, reviewMessages, group]);

  // Skip rubric review
  const handleSkipReview = useCallback(async () => {
    await confirmRubric(courseGroupId);
    setPhase(COURSE_PHASES.BASELINE_ATTEMPT);
  }, [courseGroupId]);

  // Capture a summative step
  const handleSummativeCapture = useCallback(async (stepIndex) => {
    setLoading('capturing');
    try {
      const capture = await recordSummativeCapture(courseGroupId, stepIndex);
      const newCaptures = [...captures, capture];
      setCaptures(newCaptures);

      // Auto-submit when all steps captured
      if (newCaptures.length === (summative?.task?.steps?.length || 0)) {
        setLoading('assessing');
        const { attempt, mastery } = await submitSummativeAttempt(courseGroupId, group, newCaptures);
        setAttempts(prev => [...prev, attempt]);
        setCaptures([]);

        if (mastery) {
          setPhase(COURSE_PHASES.COMPLETED);
          // Update profile for mastery
          updateProfileOnMasteryInBackground(group, attempt, []);
        } else if (attempt.isBaseline) {
          // Baseline done → generate gap + journey
          setLoading('journey');
          const { journey: j } = await generateGapAndJourney(courseGroupId, group);
          setJourney({ plan: j, phase: COURSE_PHASES.FORMATIVE_LEARNING });
          setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
        } else {
          // Retake didn't achieve mastery → generate remediation activities
          setLoading('journey');
          const weakCriteria = (attempt.criteriaScores || [])
            .filter(cs => cs.score < 0.51)
            .map(cs => cs.criterion);
          const { journey: j } = await generateRemediationActivities(courseGroupId, group, weakCriteria);
          setJourney({ plan: j, phase: COURSE_PHASES.FORMATIVE_LEARNING });
          setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
        }
      }
    } catch (e) {
      setError(e.message || 'Capture failed.');
    }
    setLoading('');
  }, [courseGroupId, captures, summative, group]);

  // Request summative retake
  const handleRetake = useCallback(async () => {
    await requestSummativeRetake(courseGroupId);
    setCaptures([]);
    setPhase(COURSE_PHASES.SUMMATIVE_RETAKE);
  }, [courseGroupId]);

  // After baseline, start journey
  const handleStartJourney = useCallback(async () => {
    setLoading('journey');
    try {
      const { journey: j } = await generateGapAndJourney(courseGroupId, group);
      setJourney({ plan: j, phase: COURSE_PHASES.FORMATIVE_LEARNING });
      setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
    } catch (e) {
      setError(e.message || 'Failed to generate journey.');
    }
    setLoading('');
  }, [courseGroupId, group]);

  if (!group) return <p>Course not found.</p>;

  function statusIcon(status) {
    if (status === 'completed') return '\u2713';
    if (status === 'in_progress') return '\u25B6';
    return '\u25CB';
  }

  const latestAttempt = attempts[attempts.length - 1];
  const journeyUnits = journey?.plan?.units || [];

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{group.name}</h2>
        </div>
      </div>

      {/* Summative phases */}
      {(phase === COURSE_PHASES.SUMMATIVE_SETUP || loading === 'summative') && (
        <ChatArea>
          <ThinkingSpinner text="Designing your assessment..." />
        </ChatArea>
      )}

      {phase === COURSE_PHASES.RUBRIC_REVIEW && summative && (
        <ChatArea>
          <SummativeCard summative={summative} />
          {reviewMessages.map((m, i) => (
            m.role === 'user'
              ? <UserMessage key={i} content={m.content} />
              : <AssistantMessage key={i} content={m.content} />
          ))}
          {loading === 'review' && <ThinkingSpinner />}
          {!loading && (
            <button className="skip-step-btn" onClick={handleSkipReview} style={{ marginTop: '8px' }}>
              Skip to assessment
            </button>
          )}
        </ChatArea>
      )}

      {(phase === COURSE_PHASES.BASELINE_ATTEMPT || phase === COURSE_PHASES.SUMMATIVE_RETAKE) && summative && (
        <ChatArea>
          {phase === COURSE_PHASES.SUMMATIVE_RETAKE && (
            <div className="chat-section-heading" role="separator">Summative Retake</div>
          )}
          <SummativeCard summative={summative} />
          <CaptureStep
            steps={summative.task?.steps || []}
            captures={captures}
            onCapture={handleSummativeCapture}
            loading={!!loading}
          />
          {loading === 'capturing' && <ThinkingSpinner text="Capturing..." />}
          {loading === 'assessing' && <ThinkingSpinner text="Evaluating your work..." />}
          {loading === 'journey' && <ThinkingSpinner text="Building your learning journey..." />}
        </ChatArea>
      )}

      {phase === COURSE_PHASES.GAP_ANALYSIS && (
        <ChatArea>
          <ThinkingSpinner text="Analyzing your results..." />
        </ChatArea>
      )}

      {phase === COURSE_PHASES.JOURNEY_GENERATION && (
        <ChatArea>
          <ThinkingSpinner text="Building your learning journey..." />
        </ChatArea>
      )}

      {/* Formative learning phase — show unit cards */}
      {phase === COURSE_PHASES.FORMATIVE_LEARNING && (
        <>
          {/* Baseline/latest attempt feedback */}
          {latestAttempt && (
            <div style={{ padding: '0 var(--space)' }}>
              <RubricFeedback attempt={latestAttempt} />
            </div>
          )}

          {/* Retake button */}
          <div style={{ padding: '0 var(--space)', marginBottom: 'var(--space)' }}>
            <button className="primary-btn" onClick={handleRetake} style={{ width: '100%' }}>
              Retake Summative Assessment
            </button>
          </div>

          {/* Journey units */}
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
        </>
      )}

      {/* Completed */}
      {phase === COURSE_PHASES.COMPLETED && (
        <ChatArea>
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
