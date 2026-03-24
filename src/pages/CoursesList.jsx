import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';

export default function CoursesList() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { courseGroups, units, allProgress } = state;

  function courseGroupStatus(cg) {
    const groupUnits = cg.units || [cg];
    const statuses = groupUnits.map(u => allProgress[u.unitId]?.status || 'not_started');
    if (statuses.every(s => s === 'completed')) return 'completed';
    if (statuses.some(s => s === 'in_progress' || s === 'completed')) return 'in_progress';
    return 'not_started';
  }

  function statusIcon(status) {
    if (status === 'completed') return '\u2713';
    if (status === 'in_progress') return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(cg, locked) {
    if (locked) return 'Complete prerequisite first';
    const groupUnits = cg.units || [cg];
    const completed = groupUnits.filter(u => allProgress[u.unitId]?.status === 'completed').length;
    const total = groupUnits.length;
    const mins = groupUnits.reduce((sum, u) => sum + (u.learningObjectives?.length || 1) * 5 + 2, 0);
    if (completed === total) return 'Completed';
    return `${completed} of ${total} units \u00b7 ~${mins} min`;
  }

  function checkCourseGroupPrerequisite(cg) {
    if (!cg.dependsOn) return true;
    const dep = courseGroups.find(g => g.courseId === cg.dependsOn);
    if (!dep) return true;
    const depUnits = dep.units || [dep];
    return depUnits.every(u => allProgress[u.unitId]?.status === 'completed');
  }

  const handleClick = (cg) => {
    if (!checkCourseGroupPrerequisite(cg)) return;
    if (cg.units) {
      navigate(`/courses/${cg.courseId}`);
    } else {
      navigate(`/unit/${cg.unitId}`);
    }
  };

  return (
    <>
      <h2>Courses</h2>
      <div className="course-list" role="list">
        {courseGroups.map((cg, i) => {
          const status = courseGroupStatus(cg);
          const locked = !checkCourseGroupPrerequisite(cg);
          const icon = statusIcon(status);
          return (
            <button
              key={cg.courseId}
              className={`course-card${locked ? ' locked' : ''} stagger-item`}
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => handleClick(cg)}
              disabled={locked}
            >
              <span className="course-status" aria-hidden="true">{icon}</span>
              <div className="course-info">
                <strong>{cg.name}</strong>
                {cg.description && <p>{cg.description}</p>}
                <small>{progressLabel(cg, locked)}</small>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
