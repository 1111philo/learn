import { renderMd, linkify, esc } from '../../lib/helpers.js';

export default function InstructionMessage({ text, tips, activityNumber }) {
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
      {activityNumber && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginBottom: '4px', fontWeight: 600 }}>
          Activity {activityNumber}
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
      {tips?.length > 0 && (
        <details className="feedback-details" style={{ marginTop: '6px' }}>
          <summary>Tips</summary>
          <ul>{tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
