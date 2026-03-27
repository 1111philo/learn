import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { COURSE_PHASES, ORIENTATION_PHASES } from '../lib/constants.js';
import {
  getSummative, getCoursePhase, getJourney, getSummativeAttempts,
  getSummativeCaptureState, saveSummativeCaptureState,
  clearSummativeCaptureState, getScreenshot,
} from '../../js/storage.js';
import {
  initCourse, advancePhase, callGuide,
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
  const { state, dispatch } = useApp();
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
          await clearSummativeCaptureState(courseGroupId);
          const unitIds = (group.units || []).map(u => u.unitId);
          for (const uid of unitIds) dispatch({ type: 'RESET_UNIT', unitId: uid });
          navigate('/courses');
        }}
      />
    );
  };

  const [phase, setPhase] = useState(null);
  const [summative, setSummative] = useState(null);
  const [journey, setJourney] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [captures, setCaptures] = useState([]);
  const [textResponses, setTextResponses] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Guide agent conversation (resets on phase change)
  const [guideMessages, setGuideMessages] = useState([]);

  // Migrate old rubric_review phase to course_intro
  const normalizePhase = (p) => p === 'rubric_review' ? COURSE_PHASES.COURSE_INTRO : p;

  // Build phase-specific context for the Guide Agent
  const getGuideContext = useCallback(() => {
    const ctx = {};
    if (summative) {
      ctx.rubricCriteria = summative.rubric?.map(c => c.name);
      ctx.exemplar = summative.exemplar;
    }
    const latest = attempts[attempts.length - 1];
    if (latest) {
      ctx.latestScores = latest.criteriaScores;
      ctx.overallScore = latest.overallScore;
      ctx.mastery = latest.mastery;
      ctx.isBaseline = latest.isBaseline;
    }
    if (journey?.plan?.units) {
      ctx.journeyUnits = journey.plan.units.map(u => ({
        unitId: u.unitId,
        activities: u.activities?.length || 0,
      }));
    }
    return ctx;
  }, [summative, attempts, journey]);

  // Load course state on mount
  useEffect(() => {
    if (!group) return;
    let cancelled = false;

    (async () => {
      const existingPhase = await getCoursePhase(courseGroupId);
      if (cancelled) return;

      if (existingPhase) {
        const p = normalizePhase(existingPhase);
        setPhase(p);
        const s = await getSummative(courseGroupId);
        if (s) setSummative(s);
        const j = await getJourney(courseGroupId);
        if (j) setJourney(j);
        const a = await getSummativeAttempts(courseGroupId);
        setAttempts(a);
        // Restore in-progress summative captures
        const cs = await getSummativeCaptureState(courseGroupId);
        if (cs?.captures?.length) {
          const restored = [];
          for (const cap of cs.captures) {
            const dataUrl = await getScreenshot(cap.screenshotKey);
            if (dataUrl) restored.push({ ...cap, dataUrl });
          }
          if (restored.length && !cancelled) {
            setCaptures(restored);
            setCurrentStep(restored.length);
          }
        }
      } else {
        setLoading('summative');
        try {
          const s = await initCourse(group);
          if (cancelled) return;
          setSummative(s);
          // Don't clear loading — transition to guide loading seamlessly.
          // The phase change triggers the guide useEffect which sets loading='guide'.
          setLoading('guide');
          setPhase(COURSE_PHASES.COURSE_INTRO);
        } catch (e) {
          if (!cancelled) {
            setError(e.message || 'Failed to generate summative.');
            setLoading('');
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [courseGroupId]);

  // When entering an orientation phase, call the Guide Agent for the greeting
  useEffect(() => {
    if (!ORIENTATION_PHASES.includes(phase) || !group) return;
    let cancelled = false;
    setGuideMessages([]);
    setLoading('guide');

    (async () => {
      try {
        const result = await callGuide(group, phase, [], getGuideContext());
        if (!cancelled) {
          setGuideMessages([{ role: 'assistant', content: result.message, timestamp: Date.now() }]);
        }
      } catch (e) {
        if (!cancelled) {
          setGuideMessages([{ role: 'assistant', content: `Welcome to ${group.name}.`, timestamp: Date.now() }]);
        }
      }
      if (!cancelled) setLoading('');
    })();

    return () => { cancelled = true; };
  }, [phase, group]);

  // -- Guide Q&A --------------------------------------------------------------

  const handleGuideSend = useCallback(async (text) => {
    if (!group) return;

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    const updatedMessages = [...guideMessages, userMsg];
    setGuideMessages(updatedMessages);
    setLoading('guide');

    try {
      const result = await callGuide(group, phase, updatedMessages, getGuideContext());
      setGuideMessages(prev => [...prev, { role: 'assistant', content: result.message, timestamp: Date.now() }]);
    } catch (e) {
      setGuideMessages(prev => [...prev, { role: 'assistant', content: `Something went wrong: ${e.message}`, timestamp: Date.now() }]);
    }
    setLoading('');
  }, [group, phase, guideMessages, getGuideContext]);

  // -- Phase transitions ------------------------------------------------------

  const handleStartDiagnostic = useCallback(async () => {
    await advancePhase(courseGroupId, COURSE_PHASES.BASELINE_ATTEMPT);
    await clearSummativeCaptureState(courseGroupId);
    setCaptures([]);
    setTextResponses([]);
    setCurrentStep(0);
    setPhase(COURSE_PHASES.BASELINE_ATTEMPT);
  }, [courseGroupId]);

  const handleBuildJourney = useCallback(async () => {
    setLoading('journey');
    try {
      const { journey: j } = await generateGapAndJourney(courseGroupId, group);
      setJourney({ plan: j, phase: COURSE_PHASES.JOURNEY_OVERVIEW });
      setPhase(COURSE_PHASES.JOURNEY_OVERVIEW);
    } catch (e) {
      setError(e.message || 'Failed to build learning path.');
    }
    setLoading('');
  }, [courseGroupId, group]);

  const handleStartLearning = useCallback(async () => {
    await advancePhase(courseGroupId, COURSE_PHASES.FORMATIVE_LEARNING);
    setPhase(COURSE_PHASES.FORMATIVE_LEARNING);
  }, [courseGroupId]);

  const handleRetakeOrientation = useCallback(async () => {
    await requestSummativeRetake(courseGroupId);
    setPhase(COURSE_PHASES.RETAKE_READY);
  }, [courseGroupId]);

  const handleStartRetake = useCallback(async () => {
    await advancePhase(courseGroupId, COURSE_PHASES.SUMMATIVE_RETAKE);
    await clearSummativeCaptureState(courseGroupId);
    setCaptures([]);
    setTextResponses([]);
    setCurrentStep(0);
    setPhase(COURSE_PHASES.SUMMATIVE_RETAKE);
  }, [courseGroupId]);

  // -- Summative capture/submit -----------------------------------------------

  const checkAndSubmitAttempt = useCallback(async (newCaptures, newTextResponses) => {
    const totalSteps = summative?.task?.steps?.length || 0;
    const completedCount = newCaptures.length + newTextResponses.length;

    if (completedCount === totalSteps) {
      await clearSummativeCaptureState(courseGroupId);
      setLoading('assessing');
      const { attempt, mastery } = await submitSummativeAttempt(courseGroupId, group, newCaptures, newTextResponses);
      setAttempts(prev => [...prev, attempt]);
      setCaptures([]);
      setTextResponses([]);
      setCurrentStep(0);

      if (mastery) {
        setPhase(COURSE_PHASES.COMPLETED);
        updateProfileOnMasteryInBackground(group, attempt, []);
      } else if (attempt.isBaseline) {
        // Stop at baseline results — learner sees orientation before journey builds
        setPhase(COURSE_PHASES.BASELINE_RESULTS);
      } else {
        // Failed retake — generate remediation, then show journey overview
        setLoading('journey');
        const weakCriteria = (attempt.criteriaScores || [])
          .filter(cs => cs.score < 0.51)
          .map(cs => cs.criterion);
        const { journey: j } = await generateRemediationActivities(courseGroupId, group, weakCriteria);
        setJourney({ plan: j, phase: COURSE_PHASES.JOURNEY_OVERVIEW });
        setPhase(COURSE_PHASES.JOURNEY_OVERVIEW);
      }
      return true;
    }
    return false;
  }, [courseGroupId, summative, group]);

  const handleStepCapture = useCallback(async () => {
    setLoading('capturing');
    try {
      const capture = await recordSummativeCapture(courseGroupId, currentStep);
      const newCaptures = [...captures, capture];
      setCaptures(newCaptures);
      await saveSummativeCaptureState(courseGroupId, {
        captures: newCaptures.map(c => ({ screenshotKey: c.screenshotKey, stepIndex: c.stepIndex, url: c.url })),
      });
      const done = await checkAndSubmitAttempt(newCaptures, textResponses);
      if (!done) setCurrentStep(prev => prev + 1);
    } catch (e) {
      setError(e.message || 'Capture failed.');
    }
    setLoading('');
  }, [courseGroupId, currentStep, captures, textResponses, checkAndSubmitAttempt]);

  const handleStepTextSubmit = useCallback(async (text) => {
    if (!text?.trim()) return;
    setLoading('capturing');
    try {
      const newTextResponses = [...textResponses, { text, stepIndex: currentStep }];
      setTextResponses(newTextResponses);
      const done = await checkAndSubmitAttempt(captures, newTextResponses);
      if (!done) setCurrentStep(prev => prev + 1);
    } catch (e) {
      setError(e.message || 'Submission failed.');
    }
    setLoading('');
  }, [currentStep, captures, textResponses, checkAndSubmitAttempt]);

  // -- Render -----------------------------------------------------------------

  if (!group) return <p>Course not found.</p>;

  function statusIcon(status) {
    if (status === 'completed') return '\u2713';
    if (status === 'in_progress') return '\u25B6';
    return '\u25CB';
  }

  const latestAttempt = attempts[attempts.length - 1];
  const journeyUnits = journey?.plan?.units || [];
  const steps = summative?.task?.steps || [];
  const isOrientation = ORIENTATION_PHASES.includes(phase);
  const isSummativeActive = phase === COURSE_PHASES.BASELINE_ATTEMPT || phase === COURSE_PHASES.SUMMATIVE_RETAKE;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{group.name}</h2>
        </div>
        {phase && <button className="reset-btn" onClick={handleResetCourse} aria-label="Reset course" title="Reset course">&#8635;</button>}
      </div>

      {/* Setup — generating summative */}
      {(phase === COURSE_PHASES.SUMMATIVE_SETUP || loading === 'summative') && (
        <ChatArea><ThinkingSpinner /></ChatArea>
      )}

      {/* ── COURSE INTRO ── */}
      {phase === COURSE_PHASES.COURSE_INTRO && summative && (
        <ChatArea>
          {guideMessages.map((m, i) => (
            m.role === 'user'
              ? <UserMessage key={i} content={m.content} />
              : <AssistantMessage key={i} content={m.content} />
          ))}
          {loading === 'guide' && <ThinkingSpinner />}
          <div className="chat-section-heading" role="separator">Assessment Overview</div>
          <SummativeCard summative={summative} />
          <div style={{ textAlign: 'center', margin: '8px 0' }}>
            <button className="primary-btn" onClick={handleStartDiagnostic} disabled={loading && loading !== 'guide'}>
              Start Diagnostic Assessment
            </button>
          </div>
        </ChatArea>
      )}

      {/* ── SUMMATIVE ATTEMPT (baseline or retake) ── */}
      {isSummativeActive && summative && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">
            {phase === COURSE_PHASES.BASELINE_ATTEMPT ? 'Diagnostic Assessment' : 'Summative Assessment'}
          </div>

          {/* Completed screenshot steps */}
          {captures.map((cap, i) => {
            const step = steps[cap.stepIndex];
            return (
              <div key={`cap-${i}`}>
                <InstructionMessage text={step?.instruction} />
                <DraftMessage draft={{ screenshotKey: cap.screenshotKey, url: cap.url, timestamp: Date.now() }} />
              </div>
            );
          })}

          {/* Completed text steps */}
          {textResponses.map((tr, i) => {
            const step = steps[tr.stepIndex];
            return (
              <div key={`text-${i}`}>
                <InstructionMessage text={step?.instruction} />
                <DraftMessage draft={{ textResponse: tr.text, timestamp: Date.now() }} />
              </div>
            );
          })}

          {/* Current step */}
          {currentStep < steps.length && !loading && (
            <>
              <InstructionMessage text={`Step ${currentStep + 1} of ${steps.length}: ${steps[currentStep].instruction}`} />
              <ComposeBar
                placeholder={steps[currentStep].format === 'text' ? 'Write your response...' : 'Or type a response...'}
                onSend={(text, isSubmit) => { if (isSubmit || steps[currentStep].format === 'text') handleStepTextSubmit(text); }}
                disabled={!!loading}
                showSubmit
                onCapture={handleStepCapture}
              />
            </>
          )}

          {loading === 'capturing' && <ThinkingSpinner text="Capturing..." />}
          {loading === 'assessing' && <ThinkingSpinner text="Evaluating your work..." />}
          {loading === 'journey' && <ThinkingSpinner text="Building your learning path..." />}
        </ChatArea>
      )}

      {/* ── BASELINE RESULTS ── */}
      {phase === COURSE_PHASES.BASELINE_RESULTS && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">Diagnostic Results</div>
          {latestAttempt && <RubricFeedback attempt={latestAttempt} />}
          {guideMessages.map((m, i) => (
            m.role === 'user'
              ? <UserMessage key={i} content={m.content} />
              : <AssistantMessage key={i} content={m.content} />
          ))}
          {loading === 'guide' && <ThinkingSpinner />}
          {loading === 'journey' && <ThinkingSpinner text="Building your learning path..." />}
          <div style={{ textAlign: 'center', margin: '8px 0' }}>
            <button className="primary-btn" onClick={handleBuildJourney} disabled={loading === 'journey'}>
              Build My Learning Path
            </button>
          </div>
        </ChatArea>
      )}

      {(phase === COURSE_PHASES.GAP_ANALYSIS || phase === COURSE_PHASES.JOURNEY_GENERATION) && (
        <ChatArea><ThinkingSpinner text="Building your learning path..." /></ChatArea>
      )}

      {/* ── JOURNEY OVERVIEW ── */}
      {phase === COURSE_PHASES.JOURNEY_OVERVIEW && (
        <>
          <ChatArea>
            <div className="chat-section-heading" role="separator">Your Learning Path</div>
            {guideMessages.filter(m => m.role === 'assistant').length > 0 && (
              guideMessages.slice(0, 1).map((m, i) => <AssistantMessage key={i} content={m.content} />)
            )}
            {loading === 'guide' && !guideMessages.length && <ThinkingSpinner />}
          </ChatArea>
          <div className="course-list" role="list">
            {journeyUnits.map((ju, i) => {
              const unitDef = group.units?.find(u => u.unitId === ju.unitId);
              const actCount = ju.activities?.length || 0;
              return (
                <div key={ju.unitId} className="course-card stagger-item" style={{ animationDelay: `${i * 40}ms` }} role="listitem">
                  <span className="course-status" aria-hidden="true">{'\u25CB'}</span>
                  <div className="course-info">
                    <strong>{unitDef?.name || ju.unitId}</strong>
                    {unitDef?.description && <p>{unitDef.description}</p>}
                    <small>{actCount} activit{actCount !== 1 ? 'ies' : 'y'}</small>
                  </div>
                </div>
              );
            })}
          </div>
          <ChatArea>
            {guideMessages.slice(1).map((m, i) => (
              m.role === 'user'
                ? <UserMessage key={i} content={m.content} />
                : <AssistantMessage key={i} content={m.content} />
            ))}
            {loading === 'guide' && guideMessages.length > 0 && <ThinkingSpinner />}
            <div style={{ textAlign: 'center', margin: '8px 0' }}>
              <button className="primary-btn" onClick={handleStartLearning}>
                Start Learning
              </button>
            </div>
          </ChatArea>
        </>
      )}

      {/* ── FORMATIVE LEARNING ── */}
      {phase === COURSE_PHASES.FORMATIVE_LEARNING && (
        <>
          <div className="msg msg-response" style={{ fontSize: '0.85rem', margin: 'var(--space)' }}>
            Work through the units below. Retake the assessment when you're ready.
          </div>
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
            <button className="primary-btn" onClick={handleRetakeOrientation} style={{ width: '100%' }}>
              Retake Assessment
            </button>
          </div>
        </>
      )}

      {/* ── RETAKE READY ── */}
      {phase === COURSE_PHASES.RETAKE_READY && (
        <ChatArea>
          <div className="chat-section-heading" role="separator">Ready to Demonstrate Mastery</div>
          {latestAttempt && <RubricFeedback attempt={latestAttempt} />}
          {guideMessages.map((m, i) => (
            m.role === 'user'
              ? <UserMessage key={i} content={m.content} />
              : <AssistantMessage key={i} content={m.content} />
          ))}
          {loading === 'guide' && <ThinkingSpinner />}
          <div style={{ textAlign: 'center', margin: '8px 0' }}>
            <button className="primary-btn" onClick={handleStartRetake}>
              Start Assessment
            </button>
          </div>
        </ChatArea>
      )}

      {/* ── COMPLETED ── */}
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

      {/* Compose bar for Guide Q&A at orientation checkpoints */}
      {isOrientation && !loading && (
        <ComposeBar
          placeholder="Ask a question..."
          onSend={handleGuideSend}
          disabled={!!loading}
        />
      )}
    </div>
  );
}
