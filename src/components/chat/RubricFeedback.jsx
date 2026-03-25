import { renderMd } from '../../lib/helpers.js';

const LEVEL_COLORS = {
  mastery: '#2d7d46',
  proficient: '#3b82f6',
  developing: '#d97706',
  beginning: '#dc2626',
};

export default function RubricFeedback({ attempt, onRetake }) {
  if (!attempt) return null;

  const { criteriaScores, overallScore, mastery, feedback, nextSteps, isBaseline } = attempt;
  const overallPercent = Math.round((overallScore || 0) * 100);

  return (
    <div className="msg msg-response rubric-feedback">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span className="score-badge">{overallPercent}%</span>
        {mastery
          ? <span className="rec-label rec-advance">Mastery Achieved</span>
          : <span className="rec-label rec-revise">{isBaseline ? 'Baseline' : 'Not Yet'}</span>
        }
      </div>

      <p dangerouslySetInnerHTML={{ __html: renderMd(feedback || '') }} style={{ margin: '0 0 8px' }} />

      {/* Per-criterion scores */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
        {(criteriaScores || []).map((cs, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
            <span style={{
              display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
              background: LEVEL_COLORS[cs.level] || '#888', flexShrink: 0,
            }} aria-hidden="true" />
            <span style={{ fontWeight: 500, minWidth: '40%' }}>{cs.criterion}</span>
            <span style={{ textTransform: 'capitalize', color: LEVEL_COLORS[cs.level] || '#888' }}>
              {cs.level}
            </span>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {Math.round(cs.score * 100)}%
            </span>
          </div>
        ))}
      </div>

      {/* Next steps */}
      {nextSteps?.length > 0 && (
        <details className="feedback-details">
          <summary>Next steps</summary>
          <ul>{nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </details>
      )}

      {/* Criterion-level feedback */}
      {criteriaScores?.some(cs => cs.feedback) && (
        <details className="feedback-details">
          <summary>Detailed feedback</summary>
          {criteriaScores.filter(cs => cs.feedback).map((cs, i) => (
            <p key={i} style={{ margin: '4px 0' }}>
              <strong>{cs.criterion}:</strong> {cs.feedback}
            </p>
          ))}
        </details>
      )}

      {onRetake && !mastery && (
        <button className="primary-btn" onClick={onRetake} style={{ marginTop: '8px' }}>
          {isBaseline ? 'Start Learning Journey' : 'Continue Learning'}
        </button>
      )}
    </div>
  );
}
