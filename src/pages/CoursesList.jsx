import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getCourseKB, getDraftCourseId, saveUserCourse } from '../../js/storage.js';
import { parseCoursePrompt, invalidateCoursesCache, loadCourses } from '../../js/courseOwner.js';

const STATUS_LABELS = {
  active: 'In progress',
  completed: 'Completed',
};

export default function CoursesList() {
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const { courses } = state;
  const [statuses, setStatuses] = useState({});
  const [hasDraft, setHasDraft] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const s = {};
      for (const c of courses) {
        const kb = await getCourseKB(c.courseId);
        if (kb) s[c.courseId] = kb.status || 'active';
      }
      setStatuses(s);
      setHasDraft(!!(await getDraftCourseId()));
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

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const markdown = await file.text();
    const courseId = `custom-${Date.now()}`;
    const course = parseCoursePrompt(courseId, markdown);

    if (!course.name || !course.exemplar || !course.learningObjectives.length) {
      alert('Invalid course file. Must have a title, exemplar, and learning objectives.');
      return;
    }

    await saveUserCourse(courseId, markdown);
    invalidateCoursesCache();
    const refreshed = await loadCourses();
    dispatch({ type: 'REFRESH_COURSES', courses: refreshed });

    // Reset file input so the same file can be re-imported
    if (fileRef.current) fileRef.current.value = '';
  };

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

        <button
          className="course-card course-card-create stagger-item"
          style={{ animationDelay: `${courses.length * 40}ms` }}
          role="listitem"
          onClick={() => navigate('/courses/create')}
        >
          <span className="course-status" aria-hidden="true">+</span>
          <div className="course-info">
            <strong>{hasDraft ? 'Continue Course Draft' : 'Create Your Own Course'}</strong>
            <p>{hasDraft ? 'Resume designing your course' : 'Design a custom course with AI guidance'}</p>
          </div>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".md,text/markdown"
          onChange={handleImport}
          className="sr-only"
          aria-label="Import course file"
        />
        <button
          className="course-card course-card-create stagger-item"
          style={{ animationDelay: `${(courses.length + 1) * 40}ms` }}
          role="listitem"
          onClick={() => fileRef.current?.click()}
        >
          <span className="course-status" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </span>
          <div className="course-info">
            <strong>Import Course</strong>
            <p>Load a course from a .md file</p>
          </div>
        </button>
      </div>
    </>
  );
}
