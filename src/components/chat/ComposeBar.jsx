import { useState, useRef } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ComposeBar({
  placeholder = 'Ask a question...',
  onSend,
  disabled = false,
  onCapture,
}) {
  const [text, setText] = useState('');
  const [screenshot, setScreenshot] = useState(null); // { dataUrl, screenshotKey, url }
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const hasContent = text.trim() || screenshot;

  const send = () => {
    if (!hasContent || disabled) return;
    const payload = { text: text.trim() || null, screenshot: screenshot || null };
    setText('');
    setScreenshot(null);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    onSend(payload);
  };

  const capture = async () => {
    if (!onCapture || capturing) return;
    setCapturing(true);
    try {
      const result = await onCapture();
      if (result) setScreenshot(result);
    } catch {
      // error handled by caller
    }
    setCapturing(false);
  };

  const removeScreenshot = () => setScreenshot(null);

  return (
    <div className="chat-compose">
      {/* Screenshot preview */}
      {screenshot && (
        <div className="compose-preview">
          <img
            src={screenshot.dataUrl}
            alt="Captured screenshot"
            className="compose-preview-img"
          />
          <button
            className="compose-preview-remove"
            onClick={removeScreenshot}
            aria-label="Remove screenshot"
            title="Remove"
          >&times;</button>
        </div>
      )}
      <div className="compose-input-row">
        {onCapture && (
          <button
            className={`capture-btn${screenshot ? ' capture-btn-active' : ''}`}
            aria-label={screenshot ? 'Recapture screenshot' : 'Capture screenshot'}
            onClick={capture}
            disabled={disabled || capturing}
            title={screenshot ? 'Recapture' : 'Capture screenshot'}
          >
            {capturing ? (
              <span className="loading-spinner-inline" style={{ width: 14, height: 14 }} aria-hidden="true" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
              </svg>
            )}
          </button>
        )}
        <label htmlFor="chat-input" className="sr-only">Your message</label>
        <textarea
          ref={inputRef}
          id="chat-input"
          className="chat-input"
          rows={1}
          placeholder={screenshot ? 'Add a message (optional)...' : placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); handleResize(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
          }}
          disabled={disabled}
        />
        <button className="send-btn" aria-label="Send" onClick={send} disabled={disabled || !hasContent}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M3 14V9l10-1L3 7V2l13 6z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
