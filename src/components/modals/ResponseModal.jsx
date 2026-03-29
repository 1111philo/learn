import { useState, useRef } from 'react';
import { useModal } from '../../contexts/ModalContext.jsx';
import { useAutoResize } from '../../hooks/useAutoResize.js';

/**
 * Modal for submitting work — screenshot, text, or both.
 * Uses the app's existing modal system (ModalContext).
 */
export default function ResponseModal({ onSubmit }) {
  const { hide } = useModal();
  const [text, setText] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const hasContent = text.trim() || screenshot;

  const capture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const pageUrl = tab?.url || '';
      if (!pageUrl || pageUrl.startsWith('chrome://') || pageUrl.startsWith('about:') || pageUrl.startsWith('edge://')) {
        throw new Error('Navigate to a webpage first.');
      }
      const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      if (!hasPermission) {
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        if (!granted) throw new Error('Permission needed.');
      }
      const response = await chrome.runtime.sendMessage({ type: 'captureScreenshot' });
      if (!response?.dataUrl) throw new Error('Capture failed.');
      setScreenshot({ dataUrl: response.dataUrl, url: pageUrl });
    } catch {
      // silent — user can retry
    }
    setCapturing(false);
  };

  const submit = () => {
    if (!hasContent) return;
    hide();
    onSubmit({ text: text.trim() || null, screenshot });
  };

  return (
    <>
      <h2>Complete Activity</h2>

      {/* Text area — on top */}
      <textarea
        ref={inputRef}
        className="modal-textarea"
        rows={3}
        placeholder="Write your response..."
        value={text}
        onChange={(e) => { setText(e.target.value); handleResize(e); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') hide();
        }}
        autoFocus
      />

      {/* Screenshot area — below text */}
      {screenshot ? (
        <div className="compose-preview" style={{ marginBottom: '8px' }}>
          <img src={screenshot.dataUrl} alt="Captured" className="compose-preview-img" />
          <button className="compose-preview-remove" onClick={() => setScreenshot(null)} aria-label="Remove">&times;</button>
        </div>
      ) : (
        <button
          className="secondary-btn"
          style={{ width: '100%', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          onClick={capture}
          disabled={capturing}
        >
          {capturing ? (
            <span className="loading-spinner-inline" style={{ width: 14, height: 14 }} aria-hidden="true" />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          )}
          Capture Screenshot
        </button>
      )}

      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="primary-btn" onClick={submit} disabled={!hasContent}>Submit</button>
      </div>
    </>
  );
}
