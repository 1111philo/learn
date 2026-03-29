import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getCourseKB } from '../../js/storage.js';

const STATUS_LABELS = {
  active: 'In progress',
  completed: 'Completed',
};

export default function CoursesList() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { courses } = state;
  const [statuses, setStatuses] = useState({});

  useEffect(() => {
    (async () => {
      const s = {};
      for (const c of courses) {
        const kb = await getCourseKB(c.courseId);
        if (kb) s[c.courseId] = kb.status || 'active';
      }
      setStatuses(s);
    })();
  }, [courses]);

  function statusIcon(courseId) {
    const status = statuses[courseId];
    if (status === 'completed') return '\u2713';
    if (status) return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(course) {
    const status = statuses[course.courseId];
    if (status) return STATUS_LABELS[status] || status;
    return `${course.learningObjectives.length} objectives`;
  }

  return (
    <>
      <h2>Courses</h2>
      <div className="course-list" role="list">
        {courses.map((c, i) => {
          const icon = statusIcon(c.courseId);
          return (
            <button
              key={c.courseId}
              className="course-card stagger-item"
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => navigate(`/courses/${c.courseId}`)}
            >
              <span className="course-status" aria-hidden="true">{icon}</span>
              <div className="course-info">
                <strong>{c.name}</strong>
                {c.description && <p>{c.description}</p>}
                <small>{progressLabel(c)}</small>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
