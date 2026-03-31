import { useState, useEffect, useRef } from 'react';
import { onSyncFailure } from '../lib/syncDebounce.js';

export default function SyncStatusBanner() {
  const [failure, setFailure] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return onSyncFailure(({ error }) => {
      const isSessionExpiry = error?.message?.includes('Session expired');
      setFailure({
        message: isSessionExpiry
          ? 'Your session has expired. Please sign in again to save your progress.'
          : 'Unable to save your progress to the cloud. Your work is saved locally.',
        isSessionExpiry,
      });
      // Auto-dismiss transient errors after 8 seconds
      if (!isSessionExpiry) {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setFailure(null), 8000);
      }
    });
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!failure) return null;

  return (
    <div className="sync-status-banner" role="alert">
      <span>{failure.message}</span>
      <button
        className="sync-status-dismiss"
        onClick={() => { clearTimeout(timerRef.current); setFailure(null); }}
        aria-label="Dismiss sync warning"
      >
        &times;
      </button>
    </div>
  );
}
