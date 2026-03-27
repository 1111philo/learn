import { useState, useRef } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  showSubmit = false,
  showCapture = false,
  onCapture,
  submitOnly = false,
}) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const send = (isSubmit = false) => {
    const val = text.trim();
    if (!val || disabled) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(val, isSubmit);
  };

  return (
    <div className="chat-compose">
      <div className="compose-input-row">
        <label htmlFor="chat-input" className="sr-only">Your message</label>
        <textarea
          ref={inputRef}
          id="chat-input"
          className="chat-input"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); handleResize(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (submitOnly && showSubmit) {
                send(true);
              } else {
                send(false);
              }
            }
          }}
          disabled={disabled}
        />
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {/* Submit button for text-format activities */}
          {showSubmit && (
            <button
              className="send-btn submit-btn"
              aria-label="Submit response"
              onClick={() => send(true)}
              disabled={disabled || !text.trim()}
              title="Submit your response"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5L15 4z" />
              </svg>
            </button>
          )}
          {/* Capture button inline */}
          {showCapture && onCapture && (
            <button
              className="send-btn capture-inline-btn"
              aria-label="Capture screenshot"
              onClick={onCapture}
              disabled={disabled}
              title="Capture screenshot"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
              </svg>
            </button>
          )}
          {/* Send button for Q&A (hidden in submitOnly mode) */}
          {!submitOnly && (
            <button className="send-btn" aria-label="Send" onClick={() => send(false)} disabled={disabled || !text.trim()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M3 14V9l10-1L3 7V2l13 6z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
