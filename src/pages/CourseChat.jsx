import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { COURSE_PHASES, MSG_TYPES } from '../lib/constants.js';
import {
  getCoursePhase, getSummative, getJourney, getSummativeAttempts,
  getUnitProgress, getCourseMessages, clearCourseMessages,
  getSummativeCaptureState, saveSummativeCaptureState, clearSummativeCaptureState,
  saveCourseMessage,
} from '../../js/storage.js';
import * as engine from '../lib/courseEngine.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import InstructionMessage from '../components/chat/InstructionMessage.jsx';
import DraftMessage from '../components/chat/DraftMessage.jsx';
import FeedbackCard from '../components/chat/FeedbackCard.jsx';
import RubricFeedback from '../components/chat/RubricFeedback.jsx';
import ActionButton from '../components/chat/ActionButton.jsx';
import ProgressBar from '../components/chat/ProgressBar.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import DisputeModal from '../components/modals/DisputeModal.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';

export default function CourseChat() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { courseGroups, allProgress } = state;
  const { show: showModal } = useModal();
  const group = courseGroups.find(cg => cg.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [summative, setSummative] = useState(null);
  const [journey, setJourney] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  // Summative step tracking
  const [captures, setCaptures] = useState([]);
  const [textResponses, setTextResponses] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);

  // Formative tracking
  const [currentUnitId, setCurrentUnitId] = useState(null);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [unitProgress, setUnitProgress] = useState(null);

  // Collapsed phases for conversation length management
  const [collapsedPhases, setCollapsedPhases] = useState(new Set());

  // -- Load on mount ----------------------------------------------------------

  useEffect(() => {
    if (!group) return;
    let cancelled = false;

    (async () => {
      const existingPhase = await getCoursePhase(courseGroupId);
      if (cancelled) return;

      if (existingPhase) {
        // Returning to an existing course — load state
        setPhase(existingPhase);

        const s = await getSummative(courseGroupId);
        if (s) setSummative(s);
        const j = await getJourney(courseGroupId);
        if (j) setJourney(j);
        const a = await getSummativeAttempts(courseGroupId);
        setAttempts(a);

        // Load conversation
        const msgs = await getCourseMessages(courseGroupId);
        setMessages(msgs);

        // Collapse old phases
        const currentPhaseMessages = msgs.filter(m => m.phase === normalizedPhase);
        if (msgs.length > 0 && currentPhaseMessages.length < msgs.length) {
          const oldPhases = new Set(msgs.map(m => m.phase).filter(p => p && p !== normalizedPhase));
          setCollapsedPhases(oldPhases);
        }

        // Restore formative state if in learning phase
        if (normalizedPhase === COURSE_PHASES.FORMATIVE_LEARNING && j?.plan?.units) {
          for (const ju of j.plan.units) {
            const prog = await getUnitProgress(ju.unitId);
            if (prog?.status === 'in_progress') {
              setCurrentUnitId(ju.unitId);
              setUnitProgress(prog);
              const act = prog.activities?.[prog.currentActivityIndex];
              if (act) setCurrentActivity(act);
              break;
            }
          }
        }

        // Restore summative captures
        if (normalizedPhase === COURSE_PHASES.BASELINE_ATTEMPT || normalizedPhase === COURSE_PHASES.SUMMATIVE_RETAKE) {
          const cs = await getSummativeCaptureState(courseGroupId);
          if (cs?.captures?.length) {
            setCaptures(cs.captures);
            setCurrentStep(cs.captures.length);
          }
        }
      } else {
        // New course — start with guide intro (no API except guide)
        setLoading('guide');
        try {
          const { messages: msgs, phase: p } = await engine.startCourse(courseGroupId, group);
          if (cancelled) return;
          setMessages(msgs);
          setPhase(p);
        } catch (e) {
          if (!cancelled) setError(e.message || 'Failed to start course.');
        }
        if (!cancelled) setLoading('');
      }
    })();

    return () => { cancelled = true; };
  }, [courseGroupId]);

  // -- Helpers ----------------------------------------------------------------

  const appendMessages = (newMsgs) => {
    setMessages(prev => [...prev, ...newMsgs]);
  };

  const isSummativeActive = phase === COURSE_PHASES.BASELINE_ATTEMPT || phase === COURSE_PHASES.SUMMATIVE_RETAKE;

  const totalSummativeSteps = summative?.task?.steps?.length || 0;

  // Find the last action message to determine which is clickable
  const lastActionIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].msgType === MSG_TYPES.ACTION) return i;
    }
    return -1;
  })();

  // -- Actions ----------------------------------------------------------------

  const handleAction = useCallback(async (action) => {
    setError('');

    if (action === 'back_to_courses') {
      navigate('/courses');
      return;
    }

    setLoading(action);
    try {
      if (action === 'start_diagnostic') {
        const result = await engine.startDiagnostic(courseGroupId, group);
        appendMessages(result.messages);
        setSummative(result.summative);
        setPhase(result.phase);
        setCaptures([]);
        setTextResponses([]);
        setCurrentStep(0);

      } else if (action === 'build_journey') {
        const result = await engine.buildJourney(courseGroupId, group);
        appendMessages(result.messages);
        setJourney({ plan: result.journey });
        setPhase(result.phase);

      } else if (action === 'start_learning' || action === 'continue_learning') {
        const result = await engine.startLearning(courseGroupId, group);
        appendMessages(result.messages);
        setCurrentUnitId(result.unit.unitId);
        setCurrentActivity(result.activity);
        setUnitProgress(result.progress);
        setPhase(result.phase);

      } else if (action === 'next_activity') {
        const j = journey || await getJourney(courseGroupId);
        const result = await engine.advanceActivity(courseGroupId, group, currentUnitId, unitProgress, j.plan);
        appendMessages(result.messages);
        if (result.activity) setCurrentActivity(result.activity);
        if (result.progress) setUnitProgress(result.progress);
        if (result.unit) setCurrentUnitId(result.unit.unitId);
        if (result.phase) setPhase(result.phase);

      } else if (action === 'start_retake') {
        const result = await engine.startRetake(courseGroupId);
        appendMessages(result.messages);
        setSummative(result.summative);
        setPhase(result.phase);
        setCaptures([]);
        setTextResponses([]);
        setCurrentStep(0);
      }
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    }
    setLoading('');
  }, [courseGroupId, group, journey, currentUnitId, unitProgress]);

  // -- Capture / Submit (summative steps) -------------------------------------

  const handleSummativeCapture = useCallback(async () => {
    setLoading('capturing');
    try {
      const capture = await engine.captureSummativeStep(courseGroupId, currentStep);
      const newCaptures = [...captures, capture];
      setCaptures(newCaptures);

      // Persist for panel reload recovery
      await saveSummativeCaptureState(courseGroupId, {
        captures: newCaptures.map(c => ({ screenshotKey: c.screenshotKey, stepIndex: c.stepIndex, url: c.url })),
      });

      // Submission message
      appendMessages([{
        role: 'user', content: '', msgType: MSG_TYPES.SUBMISSION, phase,
        metadata: { screenshotKey: capture.screenshotKey, url: capture.url, timestamp: Date.now() },
        timestamp: Date.now(),
      }]);

      const completedCount = newCaptures.length + textResponses.length;
      if (completedCount === totalSummativeSteps) {
        // All steps done — submit for assessment
        setLoading('assessing');
        await clearSummativeCaptureState(courseGroupId);
        const result = await engine.submitSummativeAttempt(courseGroupId, group, newCaptures, textResponses);
        appendMessages(result.messages);
        setAttempts(prev => [...prev, result.attempt]);
        setCaptures([]);
        setTextResponses([]);
        setCurrentStep(0);
        setPhase(result.phase);

        // If failed retake, build remediation
        if (!result.attempt.mastery && !result.attempt.isBaseline) {
          setLoading('journey');
          const remResult = await engine.buildRemediation(courseGroupId, group, result.attempt);
          appendMessages(remResult.messages);
          setJourney({ plan: remResult.journey });
          setPhase(remResult.phase);
        }
      } else {
        // Next step
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        const step = summative.task.steps[nextStep];
        const stepMsg = {
          role: 'assistant', content: `Step ${nextStep + 1} of ${totalSummativeSteps}: ${step.instruction}`,
          msgType: MSG_TYPES.INSTRUCTION, phase,
          metadata: { stepIndex: nextStep, totalSteps: totalSummativeSteps, format: step.format },
          timestamp: Date.now(),
        };
        appendMessages([stepMsg]);
        await saveCourseMessage(courseGroupId, stepMsg);
      }
    } catch (e) {
      setError(e.message || 'Capture failed.');
    }
    setLoading('');
  }, [courseGroupId, group, currentStep, captures, textResponses, summative, totalSummativeSteps, phase]);

  const handleSummativeTextSubmit = useCallback(async (text) => {
    if (!text?.trim()) return;
    setLoading('capturing');
    try {
      const newTextResponses = [...textResponses, { text, stepIndex: currentStep }];
      setTextResponses(newTextResponses);

      appendMessages([{
        role: 'user', content: text, msgType: MSG_TYPES.SUBMISSION, phase,
        metadata: { textResponse: text, timestamp: Date.now() },
        timestamp: Date.now(),
      }]);

      const completedCount = captures.length + newTextResponses.length;
      if (completedCount === totalSummativeSteps) {
        setLoading('assessing');
        await clearSummativeCaptureState(courseGroupId);
        const result = await engine.submitSummativeAttempt(courseGroupId, group, captures, newTextResponses);
        appendMessages(result.messages);
        setAttempts(prev => [...prev, result.attempt]);
        setCaptures([]);
        setTextResponses([]);
        setCurrentStep(0);
        setPhase(result.phase);

        if (!result.attempt.mastery && !result.attempt.isBaseline) {
          setLoading('journey');
          const remResult = await engine.buildRemediation(courseGroupId, group, result.attempt);
          appendMessages(remResult.messages);
          setJourney({ plan: remResult.journey });
          setPhase(remResult.phase);
        }
      } else {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        const step = summative.task.steps[nextStep];
        const stepMsg = {
          role: 'assistant', content: `Step ${nextStep + 1} of ${totalSummativeSteps}: ${step.instruction}`,
          msgType: MSG_TYPES.INSTRUCTION, phase,
          metadata: { stepIndex: nextStep, totalSteps: totalSummativeSteps, format: step.format },
          timestamp: Date.now(),
        };
        appendMessages([stepMsg]);
        await saveCourseMessage(courseGroupId, stepMsg);
      }
    } catch (e) {
      setError(e.message || 'Submission failed.');
    }
    setLoading('');
  }, [courseGroupId, group, currentStep, captures, textResponses, summative, totalSummativeSteps, phase]);

  // -- Capture / Submit (formative activities) --------------------------------

  const handleFormativeCapture = useCallback(async () => {
    if (!currentActivity || !unitProgress || !currentUnitId) return;
    const unit = group.units?.find(u => u.unitId === currentUnitId);
    if (!unit) return;

    setLoading('assessing');
    try {
      const result = await engine.recordScreenshotDraft(courseGroupId, unit, unitProgress, currentActivity);
      appendMessages(result.messages);
      setUnitProgress(result.newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId: currentUnitId, progress: result.newProgress });

      // If passed, show next activity action
      if (result.draft.recommendation === 'advance') {
        const actionMsg = {
          role: 'assistant', content: 'Next Activity', msgType: MSG_TYPES.ACTION,
          phase: COURSE_PHASES.FORMATIVE_LEARNING,
          metadata: { action: 'next_activity', label: 'Next Activity' },
          timestamp: Date.now(),
        };
        appendMessages([actionMsg]);
        await saveCourseMessage(courseGroupId, actionMsg);
      }
    } catch (e) {
      setError(e.message || 'Capture failed.');
    }
    setLoading('');
  }, [courseGroupId, group, currentUnitId, currentActivity, unitProgress, dispatch]);

  const handleFormativeTextSubmit = useCallback(async (text) => {
    if (!text?.trim() || !currentActivity || !unitProgress || !currentUnitId) return;
    const unit = group.units?.find(u => u.unitId === currentUnitId);
    if (!unit) return;

    setLoading('assessing');
    try {
      const result = await engine.recordTextDraft(courseGroupId, unit, unitProgress, currentActivity, text);
      appendMessages(result.messages);
      setUnitProgress(result.newProgress);
      dispatch({ type: 'SET_PROGRESS', unitId: currentUnitId, progress: result.newProgress });

      if (result.draft.recommendation === 'advance') {
        const actionMsg = {
          role: 'assistant', content: 'Next Activity', msgType: MSG_TYPES.ACTION,
          phase: COURSE_PHASES.FORMATIVE_LEARNING,
          metadata: { action: 'next_activity', label: 'Next Activity' },
          timestamp: Date.now(),
        };
        appendMessages([actionMsg]);
        await saveCourseMessage(courseGroupId, actionMsg);
      }
    } catch (e) {
      setError(e.message || 'Submission failed.');
    }
    setLoading('');
  }, [courseGroupId, group, currentUnitId, currentActivity, unitProgress, dispatch]);

  // -- Q&A send ---------------------------------------------------------------

  const handleSend = useCallback(async (text, isSubmit = false) => {
    if (!text?.trim()) return;

    // Text submission for formative activity
    if (isSubmit && phase === COURSE_PHASES.FORMATIVE_LEARNING) {
      return handleFormativeTextSubmit(text);
    }

    // Text submission for summative step
    if (isSubmit && isSummativeActive) {
      return handleSummativeTextSubmit(text);
    }

    // Q&A question
    setLoading('qa');
    try {
      if (phase === COURSE_PHASES.FORMATIVE_LEARNING && currentActivity) {
        const unit = group.units?.find(u => u.unitId === currentUnitId);
        const result = await engine.askQuestion(courseGroupId, group, unit, currentActivity, text, unitProgress);
        appendMessages(result.messages);
      } else {
        const result = await engine.askGuide(courseGroupId, group, text, [], {});
        appendMessages(result.messages);
      }
    } catch (e) {
      setError(e.message || 'Failed to send message.');
    }
    setLoading('');
  }, [courseGroupId, group, phase, currentActivity, currentUnitId, unitProgress, isSummativeActive, handleFormativeTextSubmit, handleSummativeTextSubmit]);

  // -- Capture handler (routes based on phase) --------------------------------

  const handleCapture = useCallback(async () => {
    if (isSummativeActive) return handleSummativeCapture();
    if (phase === COURSE_PHASES.FORMATIVE_LEARNING) return handleFormativeCapture();
  }, [isSummativeActive, phase, handleSummativeCapture, handleFormativeCapture]);

  // -- Reset ------------------------------------------------------------------

  const handleReset = () => {
    showModal(
      <ConfirmModal
        title="Reset Course?"
        message="This will delete all progress for this course. You'll start from scratch."
        confirmLabel="Reset Course"
        onConfirm={async () => {
          const { deleteCourseProgress } = await import('../../js/storage.js');
          await deleteCourseProgress(courseGroupId);
          await clearCourseMessages(courseGroupId);
          await clearSummativeCaptureState(courseGroupId);
          const unitIds = (group.units || []).map(u => u.unitId);
          for (const uid of unitIds) dispatch({ type: 'RESET_UNIT', unitId: uid });
          navigate('/courses');
        }}
      />
    );
  };

  // -- Render -----------------------------------------------------------------

  if (!group) return <p>Course not found.</p>;

  // Determine which phases to show collapsed (summary line) vs expanded
  const renderMessage = (msg, idx) => {
    // Collapse messages from old phases
    if (msg.phase && collapsedPhases.has(msg.phase)) return null;

    const isLastAction = idx === lastActionIndex;

    switch (msg.msgType) {
      case MSG_TYPES.GUIDE:
        return <AssistantMessage key={idx} content={msg.content} />;
      case MSG_TYPES.USER:
        return <UserMessage key={idx} content={msg.content} />;
      case MSG_TYPES.INSTRUCTION:
        return <InstructionMessage key={idx} text={msg.content} rubricCriteria={msg.metadata?.rubricCriteria} />;
      case MSG_TYPES.SUBMISSION:
        return <DraftMessage key={idx} draft={msg.metadata || {}} />;
      case MSG_TYPES.FEEDBACK:
        return <FeedbackCard key={idx} draft={msg.metadata || {}} isLatest={false} isPassed={msg.metadata?.recommendation === 'advance'} />;
      case MSG_TYPES.RUBRIC_RESULT:
        return <RubricFeedback key={idx} attempt={msg.metadata || {}} />;
      case MSG_TYPES.ACTION:
        return <ActionButton key={idx} label={msg.metadata?.label || msg.content} onClick={() => handleAction(msg.metadata?.action)} disabled={!isLastAction || !!loading} />;
      case MSG_TYPES.SECTION:
        return <div key={idx} className="chat-section-heading" role="separator">{msg.content}</div>;
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  // Phase collapse summaries (shown as a clickable line for old phases)
  const collapseSummaries = [];
  for (const p of collapsedPhases) {
    let label = '';
    if (p === COURSE_PHASES.COURSE_INTRO) label = 'Course Introduction';
    else if (p === COURSE_PHASES.BASELINE_ATTEMPT || p === COURSE_PHASES.BASELINE_RESULTS) label = 'Diagnostic Assessment';
    else if (p === COURSE_PHASES.JOURNEY_OVERVIEW) label = 'Learning Path';
    else if (p === COURSE_PHASES.FORMATIVE_LEARNING) label = 'Formative Activities';
    else if (p === COURSE_PHASES.RETAKE_READY || p === COURSE_PHASES.SUMMATIVE_RETAKE) label = 'Assessment Retake';
    if (label) {
      collapseSummaries.push(
        <button
          key={p}
          className="phase-collapse-btn"
          onClick={() => setCollapsedPhases(prev => { const s = new Set(prev); s.delete(p); return s; })}
          aria-label={`Expand ${label}`}
        >
          {label} <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>(tap to expand)</span>
        </button>
      );
    }
  }

  const showCapture = isSummativeActive || phase === COURSE_PHASES.FORMATIVE_LEARNING;
  const showSubmit = isSummativeActive || phase === COURSE_PHASES.FORMATIVE_LEARNING;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{group.name}</h2>
          <ProgressBar phase={phase} journey={journey} allProgress={allProgress} />
        </div>
        {phase && <button className="reset-btn" onClick={handleReset} aria-label="Reset course" title="Reset course">&#8635;</button>}
      </div>

      <ChatArea>
        {collapseSummaries}
        {messages.map(renderMessage)}
        {loading === 'guide' && <ThinkingSpinner />}
        {loading === 'start_diagnostic' && <ThinkingSpinner text="Generating your diagnostic assessment..." />}
        {loading === 'build_journey' && <ThinkingSpinner text="Building your learning path..." />}
        {loading === 'start_learning' && <ThinkingSpinner text="Preparing your first activity..." />}
        {loading === 'next_activity' && <ThinkingSpinner text="Preparing next activity..." />}
        {loading === 'start_retake' && <ThinkingSpinner text="Preparing assessment..." />}
        {loading === 'capturing' && <ThinkingSpinner text="Capturing..." />}
        {loading === 'assessing' && <ThinkingSpinner text="Evaluating your work..." />}
        {loading === 'journey' && <ThinkingSpinner text="Building your learning path..." />}
        {loading === 'qa' && <ThinkingSpinner />}
        {error && <div className="msg msg-response" role="alert" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      {!loading && phase && phase !== COURSE_PHASES.COMPLETED && (
        <ComposeBar
          placeholder={isSummativeActive ? 'Write your response or ask a question...' : (phase === COURSE_PHASES.FORMATIVE_LEARNING ? 'Write a response or ask a question...' : 'Ask a question...')}
          onSend={handleSend}
          disabled={!!loading}
          showSubmit={showSubmit}
          onCapture={showCapture ? handleCapture : undefined}
        />
      )}
    </div>
  );
}
