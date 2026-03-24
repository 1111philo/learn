import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAutoResize } from '../../hooks/useAutoResize.js';
import { esc, renderMd } from '../../lib/helpers.js';
import { saveLearnerProfile, saveLearnerProfileSummary } from '../../../js/storage.js';
import * as orchestrator from '../../../js/orchestrator.js';
import { syncInBackground } from '../../lib/syncDebounce.js';
import { ensureProfileExists, queueProfileUpdate } from '../../lib/profileQueue.js';

export default function AboutYouStep({ data, updateData, onComplete }) {
  const { loggedIn } = useAuth();
  const [messages, setMessages] = useState(data.messages || []);
  const [profileDone, setProfileDone] = useState(data.profileDone || false);
  const [thinking, setThinking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [input, setInput] = useState('');
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const initialGreeting = `Hi, ${data.name}. What brings you here? What do you want to build, become, or achieve?`;
  const userMsgCount = messages.filter(m => m.role === 'user').length;
  const hasExchanged = userMsgCount >= 2;

  // Scroll to bottom on new messages
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages.length, thinking]);

  // Sync messages back to parent
  useEffect(() => {
    updateData({ messages, profileDone });
  }, [messages, profileDone]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setThinking(true);

    try {
      const msgs = newMessages.map((m, i) =>
        i === 0 && m.role === 'user'
          ? { role: 'user', content: `My name is ${data.name}. ${m.content}` }
          : m
      );
      const result = await orchestrator.converse('onboarding-conversation', msgs, 1024);

      setMessages(prev => [...prev, { role: 'assistant', content: JSON.stringify(result) }]);

      if (result.done) {
        const profile = result.profile || {};
        profile.name = data.name;
        profile.createdAt = Date.now();
        profile.updatedAt = Date.now();
        await saveLearnerProfile(profile);
        await saveLearnerProfileSummary(result.summary || result.message);
        syncInBackground('profile', 'profileSummary');
        setProfileDone(true);
      }
    } catch (e) {
      console.warn('Onboarding conversation failed:', e);
      setMessages(prev => [...prev, { role: 'assistant', content: JSON.stringify({ message: "Sorry, something went wrong. You can try again or skip to courses." }) }]);
    }
    setThinking(false);
  };

  const handleSkip = async () => {
    // Save profile from whatever we have before navigating away
    if (!profileDone) {
      const userText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
      if (userText || data.name) {
        setSkipping(true);
        try {
          const result = await orchestrator.initializeLearnerProfile(data.name, userText || 'No details provided.');
          result.profile.createdAt = Date.now();
          result.profile.updatedAt = Date.now();
          await saveLearnerProfile(result.profile);
          await saveLearnerProfileSummary(result.summary);
          syncInBackground('profile', 'profileSummary');
        } catch (e) {
          console.warn('Profile creation on skip failed:', e);
        }
        setSkipping(false);
      }
    }
    onComplete();
  };

  const parseMessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.content);
      return parsed.message || msg.content;
    } catch {
      return msg.content;
    }
  };

  return (
    <div className="onboarding" style={{ paddingBottom: 0 }}>
      {!loggedIn && <span className="onboarding-step-label">Step 3 of 3 — About You</span>}
      {loggedIn && <span className="onboarding-step-label">Tell us about yourself</span>}

      <div className="chat" role="log" aria-label="Getting to know you" ref={chatRef}>
        <div className="msg msg-response"><p dangerouslySetInnerHTML={{ __html: renderMd(initialGreeting) }} /></div>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-response'}`}>
            <p dangerouslySetInnerHTML={{ __html: m.role === 'user' ? esc(m.content) : renderMd(parseMessage(m)) }} />
          </div>
        ))}
        {thinking && (
          <div className="msg msg-response" role="status" aria-live="polite">
            <span className="loading-spinner-inline" aria-hidden="true" />
            <span>{messages.length <= 1 ? 'Getting to know you...' : 'Thinking...'}</span>
          </div>
        )}
        {hasExchanged && !profileDone && !thinking && (
          <button className="skip-step-btn" onClick={handleSkip} disabled={skipping}>
            {skipping ? 'Building your profile...' : 'Skip to courses'}
          </button>
        )}
        {profileDone && (
          <button
            className="skip-step-btn"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderColor: 'var(--color-primary)' }}
            onClick={onComplete}
          >
            Continue to courses
          </button>
        )}
      </div>

      <div className="chat-compose">
        <div className="compose-input-row">
          <label htmlFor="onboarding-input" className="sr-only">Your response</label>
          <textarea
            ref={inputRef}
            id="onboarding-input"
            className="chat-input"
            rows={1}
            placeholder={profileDone ? 'Say more or ask a question...' : 'I want to...'}
            value={input}
            onChange={(e) => { setInput(e.target.value); handleResize(e); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
            }}
            disabled={thinking || skipping}
          />
          <button
            className="send-btn"
            aria-label="Send"
            onClick={sendMessage}
            disabled={thinking || skipping || !input.trim()}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M3 14V9l10-1L3 7V2l13 6z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
