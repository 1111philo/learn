import { useState, useEffect, useRef } from 'react';
import { renderMd } from '../../lib/helpers.js';

// Track which summatives have been seen this session — skip stagger on revisit
const _seen = new Set();

export default function SummativeCard({ summative }) {
  const courseId = summative?.courseId || 'default';
  const alreadySeen = useRef(_seen.has(courseId));
  const [visibleCount, setVisibleCount] = useState(alreadySeen.current ? 3 : 0);
  const [showDetails, setShowDetails] = useState(false);
  const [expandedCriterion, setExpandedCriterion] = useState(null);

  const total = 3;

  useEffect(() => {
    if (!summative || alreadySeen.current) return;
    if (visibleCount >= total) {
      _seen.add(courseId);
      return;
    }
    const timer = setTimeout(() => setVisibleCount(v => v + 1), visibleCount === 0 ? 400 : 1000);
    return () => clearTimeout(timer);
  }, [visibleCount, summative, courseId]);

  if (!summative) return null;

  const { task, rubric, exemplar } = summative;
  const stepCount = task?.steps?.length || 0;

  return (
    <div role="log" aria-label="Assessment overview" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {visibleCount >= 1 && (
        <div className="msg msg-response">
          <p dangerouslySetInnerHTML={{ __html: renderMd(exemplar) }} style={{ margin: 0 }} />
        </div>
      )}

      {visibleCount >= 2 && (
        <div className="msg msg-response">
          <div dangerouslySetInnerHTML={{ __html: renderMd(task?.description || `${stepCount} steps. Each builds on the last.`) }} />
        </div>
      )}

      {visibleCount >= 3 && !showDetails && (
        <button
          className="skip-step-btn"
          onClick={() => setShowDetails(true)}
          style={{ alignSelf: 'flex-start' }}
        >
          View rubric and steps
        </button>
      )}

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
                    {['exceeds', 'meets', 'approaching', 'incomplete'].map(level => (
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
