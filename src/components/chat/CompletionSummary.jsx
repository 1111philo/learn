import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDuration } from '../../lib/helpers.js';
import { launchConfetti } from '../../lib/confetti.js';

export default function CompletionSummary({ unit, progress }) {
  const navigate = useNavigate();
  const plan = progress.learningPlan;
  const totalActivities = plan?.activities?.length || 0;
  const draftCount = progress.drafts?.length || 0;
  const elapsed = progress.completedAt && progress.startedAt
    ? formatDuration(progress.completedAt - progress.startedAt) : null;

  useEffect(() => {
    launchConfetti(unit.unitId);
  }, [unit.unitId]);

  return (
    <div className="completion-summary msg msg-response">
      <h3>Course Complete!</h3>
      <div className="completion-stats">
        <span>{totalActivities} step{totalActivities !== 1 ? 's' : ''}</span>
        <span>{draftCount} capture{draftCount !== 1 ? 's' : ''}</span>
        {elapsed && <span>{elapsed}</span>}
      </div>
      <div className="action-bar">
        <button className="secondary-btn" onClick={() => navigate(`/work/${unit.unitId}`)}>
          View in Portfolio
        </button>
        <button className="primary-btn" onClick={() => navigate('/courses')}>
          Next Course
        </button>
      </div>
    </div>
  );
}
