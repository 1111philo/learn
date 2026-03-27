import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getCoursePhase } from '../../js/storage.js';
import { COURSE_PHASES } from '../lib/constants.js';

const PHASE_LABELS = {
  [COURSE_PHASES.SUMMATIVE_SETUP]: 'Setting up...',
  [COURSE_PHASES.COURSE_INTRO]: 'Getting started',
  [COURSE_PHASES.BASELINE_ATTEMPT]: 'Diagnostic assessment',
  [COURSE_PHASES.BASELINE_RESULTS]: 'Diagnostic results',
  [COURSE_PHASES.GAP_ANALYSIS]: 'Analyzing...',
  [COURSE_PHASES.JOURNEY_GENERATION]: 'Building journey...',
  [COURSE_PHASES.JOURNEY_OVERVIEW]: 'Journey preview',
  [COURSE_PHASES.FORMATIVE_LEARNING]: 'In progress',
  [COURSE_PHASES.RETAKE_READY]: 'Ready to retake',
  [COURSE_PHASES.SUMMATIVE_RETAKE]: 'Retaking assessment',
  [COURSE_PHASES.COMPLETED]: 'Mastery achieved',
};

export default function CoursesList() {
  const { state } = useApp();
  const navigate = useNavigate();
  const { courseGroups } = state;
  const [phases, setPhases] = useState({});

  // Load phases for all courses
  useEffect(() => {
    (async () => {
      const p = {};
      for (const cg of courseGroups) {
        const phase = await getCoursePhase(cg.courseId);
        if (phase) p[cg.courseId] = phase;
      }
      setPhases(p);
    })();
  }, [courseGroups]);

  function statusIcon(courseId) {
    const phase = phases[courseId];
    if (phase === COURSE_PHASES.COMPLETED) return '\u2713';
    if (phase) return '\u25B6';
    return '\u25CB';
  }

  function progressLabel(cg, locked) {
    if (locked) return 'Complete prerequisite first';
    const phase = phases[cg.courseId];
    if (phase) return PHASE_LABELS[phase] || phase;
    const totalObjectives = (cg.units || []).reduce((sum, u) => sum + (u.learningObjectives?.length || 0), 0);
    const mins = totalObjectives * 5 + 10; // rough estimate
    return `~${mins} min`;
  }

  function checkPrerequisite(cg) {
    if (!cg.dependsOn) return true;
    const dep = courseGroups.find(g => g.courseId === cg.dependsOn);
    if (!dep) return true;
    return phases[dep.courseId] === COURSE_PHASES.COMPLETED;
  }

  return (
    <>
      <h2>Courses</h2>
      <div className="course-list" role="list">
        {courseGroups.map((cg, i) => {
          const locked = !checkPrerequisite(cg);
          const icon = statusIcon(cg.courseId);
          return (
            <button
              key={cg.courseId}
              className={`course-card${locked ? ' locked' : ''} stagger-item`}
              style={{ animationDelay: `${i * 40}ms` }}
              role="listitem"
              onClick={() => !locked && navigate(`/courses/${cg.courseId}`)}
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
