/**
 * Progress bar showing activity-based progress toward the exemplar.
 * Fills proportionally based on activities completed vs estimated total.
 */
export default function ProgressBar({ courseKB }) {
  if (!courseKB) return null;

  const completed = courseKB.activitiesCompleted || 0;
  const isComplete = courseKB.status === 'completed';

  // Estimate total: ~2x the number of objectives is a reasonable course length.
  // The bar fills proportionally so the learner always sees progress.
  const totalObjectives = courseKB.objectives?.length || 10;
  const estimated = totalObjectives * 2;
  const pct = isComplete ? 100 : Math.min(Math.round((completed / estimated) * 100), 95);

  return (
    <div className="progress-bar" role="progressbar" aria-label="Course progress"
      aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`progress-fill ${isComplete ? 'progress-complete' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
