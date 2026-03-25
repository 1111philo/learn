import { renderMd, linkify, esc } from '../../lib/helpers.js';

export default function InstructionMessage({ text, rubricCriteria }) {
  if (!text) return null;

  // Split into intro + numbered steps
  const lines = text.split('\n');
  const steps = [];
  const intro = [];
  let inSteps = false;

  for (const line of lines) {
    const stepMatch = line.match(/^\d+[.)]\s+(.+)/);
    if (stepMatch) {
      inSteps = true;
      steps.push(stepMatch[1]);
    } else if (!inSteps) {
      intro.push(line);
    } else {
      steps.push(line);
    }
  }

  return (
    <div className="msg msg-response instruction-msg">
      {rubricCriteria?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
          {rubricCriteria.map((c, i) => (
            <span key={i} style={{
              fontSize: '0.7rem', padding: '1px 6px', borderRadius: '8px',
              background: 'var(--color-primary-light, #e8f0fe)', color: 'var(--color-primary, #1a73e8)',
            }}>
              {c}
            </span>
          ))}
        </div>
      )}
      {intro.length > 0 && (
        <p dangerouslySetInnerHTML={{ __html: renderMd(intro.join('\n')) }} />
      )}
      {steps.length > 0 && (
        <ol className="instruction-steps">
          {steps.map((step, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: linkify(esc(step)) }} />
          ))}
        </ol>
      )}
    </div>
  );
}
