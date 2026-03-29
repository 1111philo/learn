import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getCourseKB, getDrafts } from '../../js/storage.js';

export default function Portfolio() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { courses } = state;
  const [courseWork, setCourseWork] = useState([]);

  useEffect(() => {
    (async () => {
      const work = [];
      for (const c of courses) {
        const kb = await getCourseKB(c.courseId);
        if (!kb) continue;

        const drafts = await getDrafts(c.courseId);
        const isComplete = kb.status === 'completed';

        // Count screenshots vs text submissions
        const screenshots = drafts.filter(d => d.screenshotKey).length;
        const textResponses = drafts.filter(d => d.textResponse).length;

        work.push({
          courseId: c.courseId,
          courseName: c.name,
          exemplar: kb.exemplar,
          isComplete,
          activitiesCompleted: kb.activitiesCompleted || 0,
          learnerPosition: kb.learnerPosition,
          totalSubmissions: drafts.length,
          screenshots,
          textResponses,
        });
      }
      setCourseWork(work);
    })();
  }, [courses]);

  return (
    <>
      <h2>Work</h2>
      {courseWork.length === 0 ? (
        <p className="empty-state">Start a course to build your portfolio.</p>
      ) : (
        <ul className="work-list">
          {courseWork.map((cw, i) => (
            <li key={cw.courseId} style={{ animationDelay: `${(i + 1) * 0.04}s` }}>
              <button className="work-card" onClick={() => navigate(`/work/${cw.courseId}`)}>
                <strong className="work-card-title">{cw.courseName}</strong>
                <div className="work-card-status">
                  {cw.isComplete
                    ? <span className="work-badge work-badge-complete">Completed</span>
                    : <span className="work-badge">In progress</span>
                  }
                </div>
                <p className="work-card-position">{cw.learnerPosition}</p>
                <div className="work-card-stats">
                  <span>{cw.totalSubmissions} submission{cw.totalSubmissions !== 1 ? 's' : ''}</span>
                  {cw.screenshots > 0 && <span>{cw.screenshots} screenshot{cw.screenshots !== 1 ? 's' : ''}</span>}
                  {cw.textResponses > 0 && <span>{cw.textResponses} response{cw.textResponses !== 1 ? 's' : ''}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
