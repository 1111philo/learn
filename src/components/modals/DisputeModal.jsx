import { useState } from 'react';
import { useModal } from '../../contexts/ModalContext.jsx';

export default function DisputeModal({ onSubmit }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { hide } = useModal();

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    await onSubmit(text.trim());
    hide();
  };

  return (
    <>
      <h2>Dispute Assessment</h2>
      <p>Explain why you think this assessment is wrong. The AI will re-evaluate your work.</p>
      <label htmlFor="dispute-input" className="sr-only">Your dispute</label>
      <textarea
        id="dispute-input"
        className="feedback-textarea"
        rows={3}
        placeholder="e.g. I did complete the task — the result is in the bottom right corner"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
        }}
      />
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Re-evaluating...' : 'Submit'}
        </button>
      </div>
    </>
  );
}
