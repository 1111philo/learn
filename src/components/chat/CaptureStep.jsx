export default function CaptureStep({ steps, captures, onCapture, loading }) {
  if (!steps?.length) return null;

  return (
    <div className="msg msg-response capture-steps">
      <strong style={{ fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
        Capture each step
      </strong>
      <ol style={{ margin: 0, paddingLeft: '20px' }}>
        {steps.map((step, i) => {
          const captured = captures.some(c => c.stepIndex === i);
          return (
            <li key={i} style={{ marginBottom: '8px', opacity: captured ? 0.7 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ flexShrink: 0, fontSize: '0.85rem' }}>
                  {captured ? '\u2713' : '\u25CB'}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.85rem' }}>{step.instruction}</p>
                  {step.capturePrompt && (
                    <small style={{ color: 'var(--color-text-secondary)' }}>{step.capturePrompt}</small>
                  )}
                  {!captured && onCapture && (
                    <button
                      className="record-btn"
                      onClick={() => onCapture(i)}
                      disabled={loading}
                      style={{ marginTop: '4px', fontSize: '0.8rem', padding: '4px 10px' }}
                      aria-label={`Capture step ${i + 1}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: '4px' }}>
                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                      </svg>
                      Capture
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {captures.length === steps.length && (
        <p style={{ margin: '8px 0 0', fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-primary)' }}>
          All steps captured! Submitting for assessment...
        </p>
      )}
    </div>
  );
}
