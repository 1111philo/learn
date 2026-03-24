import { useState, useRef } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ComposeBar({ placeholder = 'Ask a question...', onSend, disabled = false }) {
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          disabled={disabled}
        />
        <button className="send-btn" aria-label="Send" onClick={send} disabled={disabled || !text.trim()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M3 14V9l10-1L3 7V2l13 6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
