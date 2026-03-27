import { useState, useRef } from 'react';
import { useAutoResize } from '../../hooks/useAutoResize.js';

export default function ResponseModal({ onSubmit, onClose }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const handleResize = useAutoResize();

  const submit = () => {
    const val = text.trim();
    if (!val) return;
    onSubmit(val);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" role="dialog" aria-label="Submit your response">
        <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>Your Response</h3>
        <textarea
          ref={inputRef}
          className="chat-input"
          rows={4}
          placeholder="Write your response..."
          value={text}
          onChange={(e) => { setText(e.target.value); handleResize(e); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
            if (e.key === 'Escape') onClose();
          }}
          style={{ minHeight: '100px', maxHeight: '200px' }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
          <button className="feedback-action-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={submit} disabled={!text.trim()}>Submit</button>
        </div>
      </div>
    </div>
  );
}
