import { renderMd } from '../../lib/helpers.js';

export default function FeedbackCard({ draft, isLatest, isPassed, onDispute, onRerecord }) {
  const scorePercent = Math.round((draft.score || 0) * 100);

  const recClass = draft.recommendation === 'advance' ? 'rec-advance' : 'rec-revise';
  const recLabel = draft.recommendation === 'advance' ? 'Advance'
    : draft.recommendation === 'revise' ? 'Revise' : draft.recommendation;

  return (
    <div className="feedback-card msg msg-response">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span className="score-badge">{scorePercent}%</span>
        <span className={`rec-label ${recClass}`}>{recLabel}</span>
      </div>
      {draft.rubricCriteriaScores?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
          {draft.rubricCriteriaScores.map((cs, i) => (
            <span key={i} style={{
              fontSize: '0.7rem', padding: '1px 6px', borderRadius: '8px',
              background: 'var(--color-surface-alt, #f0f0f0)', color: 'var(--color-text-secondary)',
            }}>
              {cs.criterion}: {cs.level}
            </span>
          ))}
        </div>
      )}
      <p dangerouslySetInnerHTML={{ __html: renderMd(draft.feedback || '') }} />
      {(draft.strengths?.length > 0 || draft.improvements?.length > 0) && (
        <details className="feedback-details">
          <summary>Details</summary>
          {draft.strengths?.length > 0 && (
            <>
              <strong>Strengths:</strong>
              <ul>{draft.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          {draft.improvements?.length > 0 && (
            <>
              <strong>Improvements:</strong>
              <ul>{draft.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
        </details>
      )}
      {isLatest && !isPassed && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
          {onDispute && (
            <button className="feedback-action-btn" onClick={onDispute} aria-label="Dispute this assessment">
              Dispute
            </button>
          )}
          {onRerecord && (
            <button className="feedback-action-btn feedback-action-record" onClick={onRerecord} aria-label="Re-capture your work">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: '4px' }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Re-capture
            </button>
          )}
        </div>
      )}
    </div>
  );
}
