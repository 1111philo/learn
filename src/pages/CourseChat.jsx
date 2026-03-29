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
  getUserCourseMarkdown, deleteUserCourse,
} from '../../js/storage.js';
import { invalidateCoursesCache, loadCourses } from '../../js/courseOwner.js';
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
  const { state, dispatch } = useApp();
  const { courses } = state;
  const { show: showModal } = useModal();
  const course = courses.find(c => c.courseId === courseGroupId);

  const [phase, setPhase] = useState(null);
  const [messages, setMessages] = useState([]);
  const [courseKB, setCourseKB] = useState(null);
  const [currentActivity, setCurrentActivity] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');
  const [takenActions, setTakenActions] = useState(new Set());

  // Streaming
  const [streamingText, setStreamingText] = useState(null);
  const displayText = useStreamedText(streamingText);
  const pendingAfterStreamRef = useRef(null);

  useEffect(() => {
    if (displayText === null && pendingAfterStreamRef.current) {
      const { msgs, p } = pendingAfterStreamRef.current;
      pendingAfterStreamRef.current = null;
      if (msgs) setMessages(prev => [...prev, ...msgs]);
      if (p) setPhase(p);
      setLoading('');
    }
  }, [displayText]);

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

        if (currentPhase === COURSE_PHASES.LEARNING) {
          const activities = await getActivities(courseGroupId);
          if (activities.length) setCurrentActivity(activities[activities.length - 1]);
        }

        // Mark all actions except the last as taken
        const actionIndices = existingMsgs
          .map((m, i) => m.msgType === MSG_TYPES.ACTION ? i : -1)
          .filter(i => i >= 0);
        if (actionIndices.length > 1) {
          setTakenActions(new Set(actionIndices.slice(0, -1)));
        }
      } else {
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

  const appendMessages = (newMsgs) => setMessages(prev => [...prev, ...newMsgs]);

  // -- Mark an action as taken by its message index --
  const markActionTaken = (idx) => setTakenActions(prev => new Set([...prev, idx]));

  // -- Actions ----------------------------------------------------------------

  const handleAction = useCallback(async (action, msgIdx) => {
    setError('');
    markActionTaken(msgIdx);

    if (action === 'back_to_courses') { navigate('/courses'); return; }

    if (action === 'start_activity' || action === 'next_activity') {
      setLoading(action);
      try {
        const result = await engine.generateNextActivity(courseGroupId, course);
        appendMessages(result.messages);
        setCurrentActivity(result.activity);
        setPhase(result.phase);
        setCourseKB(await getCourseKB(courseGroupId));
      } catch (e) {
        setError(e.message || 'Failed to create activity.');
      }
      setLoading('');
    }
  }, [courseGroupId, course, navigate]);

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

  const handleSubmitWork = useCallback(async ({ text, screenshot }, msgIdx) => {
    if (!text && !screenshot) return;
    if (!currentActivity) return;
    setError('');
    markActionTaken(msgIdx);
    setLoading('assessing');
    try {
      const result = await engine.handleSubmission(
        courseGroupId, course, currentActivity.id, screenshot, text || null
      );
      appendMessages(result.messages);
      setPhase(result.phase);
      if (result.achieved) launchConfetti();
      setCourseKB(await getCourseKB(courseGroupId));
    } catch (e) {
      setError(e.message || 'Submission failed.');
    }
    setLoading('');
  }, [courseGroupId, course, currentActivity]);

  const isCustomCourse = courseGroupId?.startsWith('custom-');

  const handleExport = useCallback(async () => {
    const markdown = await getUserCourseMarkdown(courseGroupId);
    if (!markdown) return;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course?.name || 'course'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [courseGroupId, course]);

  const handleReset = () => {
    showModal(
      <ConfirmModal
        title="Reset Course?"
        message="This will delete all progress for this course. You'll start from scratch."
        confirmLabel="Reset Course"
        onConfirm={async () => { await deleteCourseProgress(courseGroupId); navigate('/courses'); }}
      />
    );
  };

  const handleDelete = () => {
    showModal(
      <ConfirmModal
        title="Delete Course?"
        message="This will permanently delete this course and all its progress."
        confirmLabel="Delete Course"
        onConfirm={async () => {
          await deleteCourseProgress(courseGroupId);
          await deleteUserCourse(courseGroupId);
          invalidateCoursesCache();
          const refreshed = await loadCourses();
          dispatch({ type: 'REFRESH_COURSES', courses: refreshed });
          navigate('/courses');
        }}
      />
    );
  };

  // -- Render -----------------------------------------------------------------

  if (!course) return <p>Course not found.</p>;
  const busy = !!loading;

  const TAKEN_LABELS = {
    'Start First Activity': 'Started First Activity',
    'Load Next Activity': 'Loaded Next Activity',
    'Complete Activity': 'Completed Activity',
    'Next Course': 'Returned to Courses',
  };

  // Build a set of message indices that are grouped INTO an action card
  // (the INSTRUCTION or FEEDBACK right before an active ACTION)
  const groupedIntoCard = new Set();
  messages.forEach((msg, idx) => {
    if (msg.msgType !== MSG_TYPES.ACTION) return;
    if (takenActions.has(idx)) return;
    // Find the nearest preceding INSTRUCTION or FEEDBACK (skipping sections)
    for (let i = idx - 1; i >= 0; i--) {
      const prev = messages[i];
      if (prev.msgType === MSG_TYPES.INSTRUCTION || prev.msgType === MSG_TYPES.FEEDBACK) {
        groupedIntoCard.add(i);
        break;
      }
      if (prev.msgType !== MSG_TYPES.SECTION) break;
    }
  });

  const renderMessage = (msg, idx) => {
    // Skip messages that are grouped into an action card
    if (groupedIntoCard.has(idx)) return null;

    switch (msg.msgType) {
      case MSG_TYPES.GUIDE:
        return <AssistantMessage key={idx} content={msg.content} />;
      case MSG_TYPES.USER:
        return <UserMessage key={idx} content={msg.content} />;
      case MSG_TYPES.INSTRUCTION:
        return <InstructionMessage key={idx} text={msg.content} tips={msg.metadata?.tips} activityNumber={msg.metadata?.activityNumber} />;
      case MSG_TYPES.SUBMISSION:
        return <DraftMessage key={idx} draft={msg.metadata || {}} />;
      case MSG_TYPES.FEEDBACK:
        return <FeedbackCard key={idx} draft={msg.metadata || {}} />;
      case MSG_TYPES.ACTION: {
        const action = msg.metadata?.action;
        const label = msg.metadata?.label || msg.content;
        const taken = takenActions.has(idx);
        const isSubmit = action === 'complete_activity';

        if (taken) {
          return (
            <div key={idx} style={{ textAlign: 'center', margin: '6px 0' }}>
              <span className="action-taken-label">{TAKEN_LABELS[label] || label}</span>
            </div>
          );
        }

        // Find the grouped content to render inside the card
        let groupedContent = null;
        for (let i = idx - 1; i >= 0; i--) {
          const prev = messages[i];
          if (prev.msgType === MSG_TYPES.INSTRUCTION) {
            groupedContent = (
              <>
                <div className="action-card-header">Activity {prev.metadata?.activityNumber}</div>
                <InstructionMessage text={prev.content} tips={prev.metadata?.tips} />
              </>
            );
            break;
          }
          if (prev.msgType === MSG_TYPES.FEEDBACK) {
            groupedContent = (
              <>
                <div className="action-card-header">Assessment</div>
                <FeedbackCard draft={prev.metadata || {}} />
              </>
            );
            break;
          }
          if (prev.msgType !== MSG_TYPES.SECTION) break;
        }

        return (
          <div key={idx} className="action-card">
            {groupedContent}
            <button
              className={`primary-btn action-icon-btn full-width${isSubmit ? ' btn-success' : ''}`}
              onClick={() => isSubmit
                ? showModal(<ResponseModal onSubmit={({ text, screenshot }) => handleSubmitWork({ text, screenshot }, idx)} />)
                : handleAction(action, idx)}
              disabled={busy}
            >
              {isSubmit ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              ) : action === 'back_to_courses' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              )}
              {label}
            </button>
          </div>
        );
      }
      case MSG_TYPES.SECTION:
        return <div key={idx} className="chat-section-heading" role="separator">{msg.content}</div>;
      default:
        return <AssistantMessage key={idx} content={msg.content} />;
    }
  };

  return (
    <div className="course-layout">
      <div className="course-header">
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{course.name}</h2>
          <ProgressBar courseKB={courseKB} />
        </div>
        {isCustomCourse && (
          <button className="reset-btn" onClick={handleExport} aria-label="Export course" title="Export course markdown">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        )}
        {phase && <button className="reset-btn" onClick={handleReset} aria-label="Reset course" title="Reset course">&#8635;</button>}
        {isCustomCourse && (
          <button className="reset-btn" onClick={handleDelete} aria-label="Delete course" title="Delete course">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        )}
      </div>

      <ChatArea>
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

      {phase && phase !== COURSE_PHASES.COMPLETED && (
        <div className="course-bottom-bar">
          <ComposeBar
            placeholder="Ask the guide a question..."
            onSend={handleSend}
            disabled={busy}
          />
        </div>
      )}
    </div>
  );
}
