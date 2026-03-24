import { useState } from 'react';
import { getScreenshot } from '../../../js/storage.js';

export default function DraftMessage({ draft }) {
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const time = draft.timestamp ? new Date(draft.timestamp).toLocaleString([], {
    hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric',
  }) : '';

  const handleClick = async (e) => {
    e.preventDefault();
    if (screenshot) { setScreenshot(null); return; }
    if (!draft.screenshotKey) return;
    setLoading(true);
    const data = await getScreenshot(draft.screenshotKey);
    setScreenshot(data);
    setLoading(false);
  };

  return (
    <div className="msg msg-draft">
      <svg className="draft-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <div>
        {draft.screenshotKey ? (
          <a href="#" className="draft-link" onClick={handleClick}>
            {loading ? 'Loading...' : `Screenshot — ${time}`}
          </a>
        ) : (
          <span>Screenshot — {time}</span>
        )}
        {screenshot && (
          <img src={screenshot} alt="Screenshot" style={{ display: 'block', width: '100%', borderRadius: 'var(--radius)', marginTop: '6px' }} />
        )}
      </div>
    </div>
  );
}
