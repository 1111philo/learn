import { useState } from 'react';
import { renderMd } from '../../lib/helpers.js';

/**
 * Renders the summative assessment as bite-sized chat messages:
 * 1. Exemplar (the hook — what mastery looks like)
 * 2. Task overview (one sentence)
 * 3. Expandable rubric + steps (on demand)
 */
export default function SummativeCard({ summative, onStart }) {
  const [showDetails, setShowDetails] = useState(false);
  const [expandedCriterion, setExpandedCriterion] = useState(null);
  if (!summative) return null;

  const { task, rubric, exemplar } = summative;
  const stepCount = task?.steps?.length || 0;

  return (
    <>
      {/* Message 1: The hook */}
      <div className="msg msg-response">
        <p dangerouslySetInnerHTML={{ __html: renderMd(exemplar) }} style={{ margin: 0 }} />
      </div>

      {/* Message 2: What you'll do */}
      <div className="msg msg-response">
        <div dangerouslySetInnerHTML={{ __html: renderMd(task?.description || `This assessment has ${stepCount} step${stepCount !== 1 ? 's' : ''}. Each step builds on the last.`) }} />
      </div>

      {/* Details toggle */}
      {!showDetails && (
        <button
          className="skip-step-btn"
          onClick={() => setShowDetails(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          View rubric and steps
        </button>
      )}

      {/* Expanded details */}
      {showDetails && (
        <div className="msg msg-response" style={{ fontSize: '0.85rem' }}>
          {/* Steps */}
          <strong>Steps</strong>
          <ol className="instruction-steps" style={{ margin: '4px 0 10px' }}>
            {(task?.steps || []).map((step, i) => (
              <li key={i}>{step.instruction}</li>
            ))}
          </ol>

          {/* Rubric */}
          <strong>Rubric</strong>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            {(rubric || []).map((criterion, i) => (
              <div key={i}>
                <button
                  onClick={() => setExpandedCriterion(expandedCriterion === i ? null : i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0',
                    font: 'inherit', fontWeight: 500, fontSize: '0.8rem', textAlign: 'left',
                    width: '100%', color: 'var(--color-text)',
                  }}
                  aria-expanded={expandedCriterion === i}
                >
                  {expandedCriterion === i ? '\u25BC' : '\u25B6'} {criterion.name}
                </button>
                {expandedCriterion === i && (
                  <div style={{ paddingLeft: '16px', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {['mastery', 'proficient', 'developing', 'beginning'].map(level => (
                      <div key={level} style={{ marginBottom: '2px' }}>
                        <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{level}: </span>
                        {criterion.levels?.[level]}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
