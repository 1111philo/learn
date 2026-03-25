import { useState } from 'react';
import { renderMd } from '../../lib/helpers.js';

export default function SummativeCard({ summative }) {
  const [expanded, setExpanded] = useState(null);
  if (!summative) return null;

  const { task, rubric, exemplar } = summative;

  return (
    <div className="msg msg-response summative-card">
      <h3 style={{ margin: '0 0 8px' }}>Summative Assessment</h3>

      {/* Exemplar */}
      <div style={{ background: 'var(--color-surface-alt, #f8f8f8)', padding: '8px 12px', borderRadius: 'var(--radius)', marginBottom: '8px' }}>
        <strong style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
          What mastery looks like
        </strong>
        <p dangerouslySetInnerHTML={{ __html: renderMd(exemplar) }} style={{ margin: '4px 0 0' }} />
      </div>

      {/* Task steps */}
      <strong style={{ fontSize: '0.85rem' }}>Your task</strong>
      {task?.description && <p style={{ margin: '2px 0 6px', fontSize: '0.85rem' }}>{task.description}</p>}
      <ol className="instruction-steps" style={{ margin: '0 0 8px' }}>
        {(task?.steps || []).map((step, i) => (
          <li key={i}>{step.instruction}</li>
        ))}
      </ol>

      {/* Rubric */}
      <details open>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
          Rubric ({rubric?.length || 0} criteria)
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
          {(rubric || []).map((criterion, i) => (
            <div key={i}>
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                  font: 'inherit', fontWeight: 500, fontSize: '0.85rem', textAlign: 'left',
                  width: '100%', color: 'var(--color-text)',
                }}
                aria-expanded={expanded === i}
              >
                {expanded === i ? '\u25BC' : '\u25B6'} {criterion.name}
              </button>
              {expanded === i && (
                <div style={{ paddingLeft: '16px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
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
      </details>
    </div>
  );
}
