import { useState, useRef } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
}) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const send = () => {
    const val = text.trim();
    if (!val || disabled) return;
    setText('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(val);
  };

  return (
    <div className="chat-compose">
      <div className="compose-card">
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          disabled={disabled}
        />
        <div className="compose-actions">
          <button className={`compose-send-btn${text.trim() ? ' visible' : ''}`} aria-label="Send" onClick={send} disabled={disabled || !text.trim()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
