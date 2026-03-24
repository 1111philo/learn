import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';

export default function UnitsList() {
  const { courseGroupId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const { courseGroups, allProgress } = state;

  const group = courseGroups.find(cg => cg.courseId === courseGroupId);
  if (!group) return <p>Course not found.</p>;

  const groupUnits = group.units || [group];

  function statusIcon(status) {
    if (status === 'completed') return '\u2713';
    if (status === 'in_progress') return '\u25B6';
    return '\u25CB';
  }

  return (
    <>
      <div className="course-header" style={{ marginBottom: 'var(--space)' }}>
        <button className="back-btn" aria-label="Back to courses" onClick={() => navigate('/courses')}>&larr;</button>
        <div className="course-header-info">
          <h2>{group.name}</h2>
        </div>
      </div>
      <div className="course-list" role="list">
        {groupUnits.map((u, i) => {
          const progress = allProgress[u.unitId];
          const status = progress?.status || 'not_started';
          const locked = u.dependsOn && allProgress[u.dependsOn]?.status !== 'completed';
          const icon = statusIcon(status);
          const mins = (u.learningObjectives?.length || 1) * 5 + 2;
          const isRequired = !u.optional;
          return (
            <button
              key={u.unitId}
              className={`course-card${locked ? ' locked' : ''} stagger-item`}
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => !locked && navigate(`/unit/${u.unitId}`)}
              disabled={locked}
            >
              <span className="course-status" aria-hidden="true">{icon}</span>
              <div className="course-info">
                <strong>{u.name}</strong>
                {u.description && <p>{u.description}</p>}
                <small>
                  {locked ? 'Complete prerequisite first' : `~${mins} min`}
                  {isRequired ? '' : ' \u00b7 Optional'}
                </small>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
