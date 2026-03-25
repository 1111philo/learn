import { useState, useEffect } from 'react';
import { renderMd } from '../../lib/helpers.js';
import ThinkingSpinner from './ThinkingSpinner.jsx';

/**
 * Renders the summative assessment as staggered chat messages.
 * Shows a spinner between reveals so the learner sees progress.
 */
export default function SummativeCard({ summative }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [expandedCriterion, setExpandedCriterion] = useState(null);

  const total = 3; // exemplar, task description, details button

  useEffect(() => {
    if (!summative) return;
    if (visibleCount >= total) return;
    const timer = setTimeout(() => setVisibleCount(v => v + 1), visibleCount === 0 ? 400 : 1000);
    return () => clearTimeout(timer);
  }, [visibleCount, summative]);

  if (!summative) return null;

  const { task, rubric, exemplar } = summative;
  const stepCount = task?.steps?.length || 0;
  const stillRevealing = visibleCount < total;

  return (
    <div role="log" aria-label="Assessment overview" aria-live="polite">
      {/* Message 1: The hook */}
      {visibleCount >= 1 && (
        <div className="msg msg-response">
          <p dangerouslySetInnerHTML={{ __html: renderMd(exemplar) }} style={{ margin: 0 }} />
        </div>
      )}

      {/* Message 2: What you'll do */}
      {visibleCount >= 2 && (
        <div className="msg msg-response">
          <div dangerouslySetInnerHTML={{ __html: renderMd(task?.description || `${stepCount} steps. Each builds on the last.`) }} />
        </div>
      )}

      {/* Message 3: Details toggle */}
      {visibleCount >= 3 && !showDetails && (
        <button
          className="skip-step-btn"
          onClick={() => setShowDetails(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          View rubric and steps
        </button>
      )}

      {/* Spinner while revealing */}
      {stillRevealing && <ThinkingSpinner />}

      {/* Expanded details */}
      {showDetails && (
        <div className="msg msg-response" style={{ fontSize: '0.85rem' }}>
          <strong>Steps</strong>
          <ol className="instruction-steps" style={{ margin: '4px 0 10px' }}>
            {(task?.steps || []).map((step, i) => (
              <li key={i}>{step.instruction}</li>
            ))}
          </ol>

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
    </div>
  );
}
