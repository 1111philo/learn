import { useState } from 'react';
import { getScreenshot } from '../../../js/storage.js';

export default function DraftMessage({ draft }) {
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);

  const time = draft.timestamp ? new Date(draft.timestamp).toLocaleString([], {
    hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric',
  }) : '';

  const handleClick = async (e) => {
    e.preventDefault();
    if (image) { setImage(null); return; }
    if (!draft.screenshotKey) return;
    setLoading(true);
    const data = await getScreenshot(draft.screenshotKey);
    setImage(data);
    setLoading(false);
  };

  // Text response draft
  if (draft.textResponse) {
    return (
      <div className="msg msg-draft">
        <svg className="draft-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
            Response — {time}
          </span>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
            {draft.textResponse}
          </p>
        </div>
      </div>
    );
  }

  // Image draft
  return (
    <div className="msg msg-draft">
      <svg className="draft-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <div>
        {draft.screenshotKey ? (
          <a href="#" className="draft-link" onClick={handleClick}>
            {loading ? 'Loading...' : `Image — ${time}`}
          </a>
        ) : (
          <span>Image — {time}</span>
        )}
        {image && (
          <img src={image} alt="Uploaded image" style={{ display: 'block', width: '100%', borderRadius: 'var(--radius)', marginTop: '6px' }} />
        )}
      </div>
    </div>
  );
}
