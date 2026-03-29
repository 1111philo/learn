import { renderMd } from '../../lib/helpers.js';

export default function FeedbackCard({ draft }) {
  return (
    <div className="feedback-card msg msg-response">
      <p dangerouslySetInnerHTML={{ __html: renderMd(draft.demonstrates || '') }} />
      {draft.strengths?.length > 0 && (
        <>
          <strong>Strengths:</strong>
          <ul>{draft.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {draft.moved && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          <strong>Moved forward:</strong> {draft.moved}
        </p>
      )}
      {draft.achieved && (
        <div style={{ marginTop: '4px', color: '#2d7d46', fontWeight: 600 }}>
          Exemplar achieved
        </div>
      )}
    </div>
  );
}
