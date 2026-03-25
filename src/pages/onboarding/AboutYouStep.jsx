import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAutoResize } from '../../hooks/useAutoResize.js';
import { esc, renderMd } from '../../lib/helpers.js';
import { saveLearnerProfile, saveLearnerProfileSummary, saveScreenshot } from '../../../js/storage.js';
import { MODEL_HEAVY } from '../../../js/api.js';
import * as orchestrator from '../../../js/orchestrator.js';
import { syncInBackground } from '../../lib/syncDebounce.js';
import { ensureProfileExists, queueProfileUpdate } from '../../lib/profileQueue.js';

export default function AboutYouStep({ data, updateData, onComplete }) {
  const { loggedIn } = useAuth();
  const [messages, setMessages] = useState(data.messages || []);
  const [profileDone, setProfileDone] = useState(data.profileDone || false);
  const [thinking, setThinking] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [input, setInput] = useState('');
  const chatRef = useRef(null);
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const firstName = data.name?.split(' ')[0] || data.name;
  const initialGreeting = `${firstName}, navigate to something that represents you professionally — LinkedIn, portfolio, a project — and hit **Capture**.`;
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

  /** Send the current message history to the agent and process the response. */
  const callAgent = async (newMessages) => {
    setThinking(true);
    try {
      const msgs = newMessages.map((m, i) =>
        i === 0 && m.role === 'user' && typeof m.content === 'string'
          ? { role: 'user', content: `My name is ${data.name}. ${m.content}` }
          : m
      );
      // Use vision model since messages may contain screenshots
      const result = await orchestrator.converse('onboarding-conversation', msgs, 1024, { model: MODEL_HEAVY });

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

  /** Send a text message. */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || thinking || capturing) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    await callAgent(newMessages);
  };

  /** Capture a screenshot and send it as a message. */
  const captureScreenshot = async () => {
    if (thinking || capturing) return;
    setCapturing(true);

    try {
      // Request permission if needed
      const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      if (!hasPermission) {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (!granted) throw new Error('Permission needed to capture screenshots.');
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageUrl = tab?.url || '';
      if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:')) {
        throw new Error('Navigate to a webpage before capturing.');
      }

      const response = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
      if (response?.error) throw new Error(response.error);
      if (!response?.dataUrl) throw new Error('No screenshot data returned.');

      // Save screenshot to IndexedDB
      const screenshotKey = `onboarding-${Date.now()}`;
      await saveScreenshot(screenshotKey, response.dataUrl);

      // Build a message with image content
      const match = response.dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      const contentParts = [];
      if (match) {
        contentParts.push({
          type: 'image',
          source: { type: 'base64', media_type: match[1], data: match[2] }
        });
      }
      contentParts.push({
        type: 'text',
        text: `[Screenshot captured from ${pageUrl}]`
      });

      const newMessages = [...messages, { role: 'user', content: contentParts, _screenshotKey: screenshotKey, _pageUrl: pageUrl }];
      setMessages(newMessages);

      setCapturing(false);
      await callAgent(newMessages);
    } catch (e) {
      console.warn('Screenshot capture failed:', e);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: JSON.stringify({ message: `Capture failed: ${e.message || 'Unknown error'}. Make sure you have a webpage open in the main browser window.` })
      }]);
      setCapturing(false);
    }
  };

  const handleSkip = async () => {
    if (!profileDone) {
      const userText = messages
        .filter(m => m.role === 'user')
        .map(m => typeof m.content === 'string' ? m.content : '[screenshot]')
        .join(' ');
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
      return typeof msg.content === 'string' ? msg.content : '';
    }
  };

  const renderUserMessage = (msg) => {
    if (typeof msg.content === 'string') {
      return <p dangerouslySetInnerHTML={{ __html: esc(msg.content) }} />;
    }
    // Content array (screenshot + text)
    const textPart = msg.content?.find(p => p.type === 'text');
    return (
      <div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 8px', borderRadius: 'var(--radius)',
          background: 'var(--color-surface-alt, #f0f0f0)', fontSize: '0.8rem',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
          </svg>
          {textPart?.text || 'Screenshot captured'}
        </div>
      </div>
    );
  };

  return (
    <div className="onboarding" style={{ paddingBottom: 0, flex: 'none' }}>
      {!loggedIn && <span className="onboarding-step-label">Step 3 of 3 — Show Your Work</span>}
      {loggedIn && <span className="onboarding-step-label">Show us your work</span>}

      <div className="chat" role="log" aria-label="Getting to know you" ref={chatRef} style={{ flex: 'none', overflow: 'visible' }}>
        <div className="msg msg-response"><p dangerouslySetInnerHTML={{ __html: renderMd(initialGreeting) }} /></div>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-response'}`}>
            {m.role === 'user' ? renderUserMessage(m) : <p dangerouslySetInnerHTML={{ __html: renderMd(parseMessage(m)) }} />}
          </div>
        ))}
        {(thinking || capturing) && (
          <div className="msg msg-response" role="status" aria-live="polite">
            <span className="loading-spinner-inline" aria-hidden="true" />
            <span>{capturing ? 'Capturing...' : 'Thinking...'}</span>
          </div>
        )}
        {!profileDone && !thinking && !capturing && (
          <div style={{ textAlign: 'center', margin: '8px 0' }}>
            <button
              className="record-btn"
              onClick={captureScreenshot}
              disabled={thinking || capturing || skipping}
              aria-label="Capture screenshot"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '6px' }}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
              </svg>
              Capture
            </button>
          </div>
        )}
        {hasExchanged && !profileDone && !thinking && !capturing && (
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
            placeholder="Add a message..."
            value={input}
            onChange={(e) => { setInput(e.target.value); handleResize(e); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendMessage(); }
            }}
            disabled={thinking || capturing || skipping}
          />
          <button
            className="send-btn"
            aria-label="Send"
            onClick={sendMessage}
            disabled={thinking || capturing || skipping || !input.trim()}
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
