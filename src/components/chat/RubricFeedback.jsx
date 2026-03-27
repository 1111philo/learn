import { renderMd } from '../../lib/helpers.js';
import { scoreToLabel, levelToLabel } from '../../lib/constants.js';

const LEVEL_COLORS = {
  Exceeds: '#2d7d46',
  Meets: '#3b82f6',
  Approaching: '#d97706',
  Incomplete: '#dc2626',
};

export default function RubricFeedback({ attempt, onRetake }) {
  if (!attempt) return null;

  const { criteriaScores, overallScore, mastery, feedback, nextSteps, isBaseline, summaryForLearner } = attempt;
  const overallLabel = scoreToLabel(overallScore || 0);

  return (
    <div className="msg msg-response rubric-feedback">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span className="score-badge">{overallLabel}</span>
        {mastery
          ? <span className="rec-label rec-advance">Mastery Achieved</span>
          : <span className="rec-label rec-revise">{isBaseline ? 'Baseline' : 'Not Yet'}</span>
        }
      </div>

      <p dangerouslySetInnerHTML={{ __html: renderMd(summaryForLearner || feedback || '') }} style={{ margin: '0 0 8px' }} />

      {/* Per-criterion scores */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
        {(criteriaScores || []).map((cs, i) => {
          const label = levelToLabel(cs.level);
          const color = LEVEL_COLORS[label] || '#888';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              <span style={{
                display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                background: color, flexShrink: 0,
              }} aria-hidden="true" />
              <span style={{ fontWeight: 500, minWidth: '40%' }}>{cs.criterion}</span>
              <span style={{ color }}>{label}</span>
            </div>
          );
        })}
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
