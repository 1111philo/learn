import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { TYPE_LABELS } from '../lib/constants.js';

export default function Portfolio() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { units, allProgress } = state;

  const workedUnits = units.filter(u => allProgress[u.unitId]?.learningPlan);

  return (
    <>
      <h2>Work</h2>
      {workedUnits.length === 0 ? (
        <p className="empty-state">Complete activities to build your portfolio.</p>
      ) : (
        <ul className="work-list">
          {workedUnits.map((u, i) => {
            const p = allProgress[u.unitId];
            const plan = p.learningPlan;
            const workName = plan.finalWorkProductDescription || u.name;
            const draftCount = p.drafts?.length || 0;
            const isCompleted = p.status === 'completed';

            return (
              <li key={u.unitId} style={{ animationDelay: `${(i + 1) * 0.04}s` }}>
                <button className="work-card" onClick={() => navigate(`/work/${u.unitId}`)}>
                  <strong className="work-card-title">{workName}</strong>
                  <div className="work-card-stats">
                    <span>{isCompleted ? 'Completed' : 'In progress'}</span>
                    <span>{draftCount} capture{draftCount !== 1 ? 's' : ''}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
