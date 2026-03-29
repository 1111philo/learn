import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { useStreamedText } from '../hooks/useStreamedText.js';
import { COURSE_PHASES, MSG_TYPES } from '../lib/constants.js';
import { launchConfetti } from '../lib/confetti.js';
import {
  getCourseKB, getActivities,
  getCourseMessages, deleteCourseProgress,
} from '../../js/storage.js';
import * as engine from '../lib/courseEngine.js';

import ChatArea from '../components/chat/ChatArea.jsx';
import ThinkingSpinner from '../components/chat/ThinkingSpinner.jsx';
import UserMessage from '../components/chat/UserMessage.jsx';
import AssistantMessage from '../components/chat/AssistantMessage.jsx';
import InstructionMessage from '../components/chat/InstructionMessage.jsx';
import DraftMessage from '../components/chat/DraftMessage.jsx';
import FeedbackCard from '../components/chat/FeedbackCard.jsx';
import ProgressBar from '../components/chat/ProgressBar.jsx';
import ComposeBar from '../components/chat/ComposeBar.jsx';
import ConfirmModal from '../components/modals/ConfirmModal.jsx';
import ResponseModal from '../components/modals/ResponseModal.jsx';

export default function CourseChat() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const { courses } = state;
  const { show: showModal } = useModal();
  const course = courses.find(c => c.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [courseKB, setCourseKB] = useState(null);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [actionTaken, setActionTaken] = useState(false);
  const [instructionPinned, setInstructionPinned] = useState(false);
  const instructionRef = useRef(null);
  const chatRef = useRef(null);

  // Streaming guide text
  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, p } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) {
        if (msgs.some(m => m.msgType === MSG_TYPES.ACTION)) setActionTaken(false);
        setMessages(prev => [...prev, ...msgs]);
      }
      if (p) setPhase(p);
      setLoading('');
    }
  }, [displayText]);

  // -- Pin instruction when scrolled past --------------------------------------

  useEffect(() => {
    const el = instructionRef.current;
    const root = chatRef.current;
    if (!el || !root) { setInstructionPinned(false); return; }

    const observer = new IntersectionObserver(
      ([entry]) => setInstructionPinned(!entry.isIntersecting),
      { root, threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [messages, currentActivity]);

  // -- Load on mount ----------------------------------------------------------

  useEffect(() => {
    if (!course) return;
    let cancelled = false;

    (async () => {
      const existingKB = await getCourseKB(courseGroupId);
      const existingMsgs = await getCourseMessages(courseGroupId);

      if (existingKB || existingMsgs.length > 0) {
        setCourseKB(existingKB);
        setMessages(existingMsgs);

        const currentPhase = existingKB?.status === 'completed'
          ? COURSE_PHASES.COMPLETED
          : existingMsgs.length > 0 ? COURSE_PHASES.LEARNING : COURSE_PHASES.COURSE_INTRO;
        setPhase(currentPhase);

        // Restore current activity
        if (currentPhase === COURSE_PHASES.LEARNING) {
          const activities = await getActivities(courseGroupId);
          if (activities.length) {
            setCurrentActivity(activities[activities.length - 1]);
          }
        }
      } else {
        // New course — guide welcome (no activity yet)
        setLoading('starting');
        setStreamingText('');
        try {
          const result = await engine.startCourse(
            courseGroupId, course,
            (partial) => { if (!cancelled) setStreamingText(partial); }
          );
          if (cancelled) return;
          setCourseKB(result.courseKB);
          pendingAfterStreamRef.current = { msgs: result.messages, p: result.phase };
          setStreamingText(null);
        } catch (e) {
          if (!cancelled) { setError(e.message || 'Failed to start course.'); setLoading(''); setStreamingText(null); }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [courseGroupId]);

  // -- Helpers ----------------------------------------------------------------

  const appendMessages = (newMsgs) => {
    if (newMsgs.some(m => m.msgType === MSG_TYPES.ACTION)) setActionTaken(false);
    setMessages(prev => [...prev, ...newMsgs]);
  };

  // -- Actions ----------------------------------------------------------------

  const handleAction = useCallback(async (action) => {
    setError('');
    setActionTaken(true);

    if (action === 'back_to_courses') {
      navigate('/courses');
      return;
    }

    // Both "Start First Activity" and "Next Activity" generate the next activity
    if (action === 'start_activity' || action === 'next_activity') {
      setLoading(action);
      try {
        const result = await engine.generateNextActivity(courseGroupId, course);
        appendMessages(result.messages);
        setCurrentActivity(result.activity);
        setPhase(result.phase);

        const freshKB = await getCourseKB(courseGroupId);
        setCourseKB(freshKB);
      } catch (e) {
        setError(e.message || 'Failed to create activity.');
      }
      setLoading('');
      return;
    }
  }, [courseGroupId, course, navigate]);

  // -- Send (Q&A) -------------------------------------------------------------

  const handleSend = useCallback(async (text) => {
    if (!text?.trim()) return;
    setError('');

    setLoading('qa');
    setStreamingText('');
    appendMessages([{ role: 'user', content: text, msgType: MSG_TYPES.USER, phase, timestamp: Date.now() }]);
    try {
      const result = await engine.askGuide(courseGroupId, course, text, currentActivity,
        (partial) => setStreamingText(partial));
      const assistantMsg = result.messages.find(m => m.role === 'assistant');
      pendingAfterStreamRef.current = { msgs: assistantMsg ? [assistantMsg] : [] };
      setStreamingText(null);
    } catch (e) {
      setError(e.message || 'Failed to send message.');
      setStreamingText(null);
      setLoading('');
    }
  }, [courseGroupId, course, phase, currentActivity]);

  // -- Submit Work ------------------------------------------------------------

  const handleSubmitWork = useCallback(async ({ text, screenshot }) => {
    if (!text && !screenshot) return;
    if (!currentActivity) return;
    setError('');
    setLoading('assessing');

    try {
      const result = await engine.handleSubmission(
        courseGroupId, course, currentActivity.id, screenshot, text || null
      );
      appendMessages(result.messages);
      setPhase(result.phase);
      if (result.achieved) launchConfetti();

      // Keep currentActivity so learner can resubmit — activity clears when next one loads
      const freshKB = await getCourseKB(courseGroupId);
      setCourseKB(freshKB);
    } catch (e) {
      setError(e.message || 'Submission failed.');
    }
    setLoading('');
  }, [courseGroupId, course, currentActivity]);

  // -- Reset ------------------------------------------------------------------

  const handleReset = () => {
    showModal(
      <ConfirmModal
        title="Reset Course?"
        message="This will delete all progress for this course. You'll start from scratch."
        confirmLabel="Reset Course"
        onConfirm={async () => {
          await deleteCourseProgress(courseGroupId);
          navigate('/courses');
        }}
      />
    );
  };

  // -- Render -----------------------------------------------------------------

  if (!course) return <p>Course not found.</p>;

  // Find the current activity's instruction message for ref attachment
  const currentInstructionIdx = currentActivity
    ? [...messages].reverse().findIndex(m => m.msgType === MSG_TYPES.INSTRUCTION && m.metadata?.activityId === currentActivity.id)
    : -1;
  const instructionMsgIdx = currentInstructionIdx >= 0 ? messages.length - 1 - currentInstructionIdx : -1;

  const renderMessage = (msg, idx) => {
    switch (msg.msgType) {
      case MSG_TYPES.GUIDE:
        return <AssistantMessage key={idx} content={msg.content} />;
      case MSG_TYPES.USER:
        return <UserMessage key={idx} content={msg.content} />;
      case MSG_TYPES.INSTRUCTION: {
        const isCurrentInstruction = idx === instructionMsgIdx;
        return (
          <div key={idx} ref={isCurrentInstruction ? instructionRef : undefined}>
            <InstructionMessage text={msg.content} tips={msg.metadata?.tips} activityNumber={msg.metadata?.activityNumber} />
          </div>
        );
      }
      case MSG_TYPES.SUBMISSION:
        return <DraftMessage key={idx} draft={msg.metadata || {}} />;
      case MSG_TYPES.FEEDBACK:
        return <FeedbackCard key={idx} draft={msg.metadata || {}} />;
      case MSG_TYPES.ACTION:
        // Action buttons render in the persistent bottom bar, not inline
        return null;
      case MSG_TYPES.SECTION:
        return <div key={idx} className="chat-section-heading" role="separator">{msg.content}</div>;
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  const showSubmitButton = phase === COURSE_PHASES.LEARNING && currentActivity;
  const busy = !!loading;

  // Find the latest pending action from messages
  const pendingAction = !actionTaken
    ? [...messages].reverse().find(m => m.msgType === MSG_TYPES.ACTION)?.metadata
    : null;

  // Submit is available when working on an activity and no pending action (assessment done)
  const showSubmit = showSubmitButton && !pendingAction;

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{course.name}</h2>
          <ProgressBar courseKB={courseKB} />
        </div>
        {phase && <button className="reset-btn" onClick={handleReset} aria-label="Reset course" title="Reset course">&#8635;</button>}
      </div>

      {/* Pinned activity bar — appears when instruction scrolls out of view */}
      {showSubmit && instructionPinned && (
        <div className="pinned-activity-bar">
          <span className="pinned-activity-label">Activity {currentActivity.activityNumber}</span>
          <button
            className="primary-btn btn-success action-icon-btn"
            onClick={() => showModal(<ResponseModal onSubmit={handleSubmitWork} />)}
            disabled={busy}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            Complete Activity
          </button>
        </div>
      )}

      <ChatArea ref={chatRef}>
        {messages.map(renderMessage)}
        {displayText != null && displayText.length > 0 && (
          <AssistantMessage content={displayText} />
        )}
        {loading === 'starting' && !displayText && <ThinkingSpinner text="Setting up your course..." />}
        {loading === 'start_activity' && <ThinkingSpinner text="Creating your first activity..." />}
        {loading === 'next_activity' && <ThinkingSpinner text="Creating your next activity..." />}
        {loading === 'assessing' && <ThinkingSpinner text="Evaluating your work..." />}
        {loading === 'qa' && !displayText && <ThinkingSpinner />}
        {error && <div className="msg msg-response" role="alert" style={{ color: 'var(--color-warning)' }}>{error}</div>}
      </ChatArea>

      {/* Bottom bar: action buttons + Q&A */}
      {phase && (
        <div className="course-bottom-bar">
          {pendingAction && (
            <button
              className="primary-btn action-icon-btn full-width"
              onClick={() => handleAction(pendingAction.action)}
              disabled={busy}
            >
              {pendingAction.action === 'back_to_courses' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              )}
              {pendingAction.label}
            </button>
          )}
          {showSubmit && !instructionPinned && (
            <button
              className="primary-btn btn-success action-icon-btn full-width"
              onClick={() => showModal(<ResponseModal onSubmit={handleSubmitWork} />)}
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              Complete Activity
            </button>
          )}
          {phase !== COURSE_PHASES.COMPLETED && (
            <ComposeBar
              placeholder={showSubmit
                ? 'Ask the guide about this activity...'
                : 'Ask the guide a question...'}
              onSend={handleSend}
              disabled={busy}
            />
          )}
        </div>
      )}
    </div>
  );
}
