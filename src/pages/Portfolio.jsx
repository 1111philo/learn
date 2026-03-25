import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getSummative, getSummativeAttempts, getJourney, getCoursePhase } from '../../js/storage.js';
import { COURSE_PHASES } from '../lib/constants.js';

export default function Portfolio() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { courseGroups, allProgress } = state;
  const [courseWork, setCourseWork] = useState([]);

  useEffect(() => {
    (async () => {
      const work = [];
      for (const cg of courseGroups) {
        const phase = await getCoursePhase(cg.courseId);
        if (!phase) continue; // no work started

        const summative = await getSummative(cg.courseId);
        const attempts = await getSummativeAttempts(cg.courseId);
        const journey = await getJourney(cg.courseId);

        // Count formative drafts across all units
        let draftCount = 0;
        for (const ju of journey?.plan?.units || []) {
          const p = allProgress[ju.unitId];
          draftCount += p?.drafts?.length || 0;
        }

        const isMastered = phase === COURSE_PHASES.COMPLETED;
        const workProductName = journey?.plan?.workProductDescription || summative?.exemplar?.slice(0, 40) || cg.name;

        work.push({
          courseId: cg.courseId,
          courseName: cg.name,
          workProductName,
          phase,
          isMastered,
          attemptCount: attempts.length,
          draftCount: draftCount + attempts.length, // summative + formative captures
        });
      }
      setCourseWork(work);
    })();
  }, [courseGroups, allProgress]);

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
                <div className="work-card-stats">
                  <span>{cw.isMastered ? 'Mastery achieved' : 'In progress'}</span>
                  <span>{cw.draftCount} capture{cw.draftCount !== 1 ? 's' : ''}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
