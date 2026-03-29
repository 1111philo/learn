import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { getScreenshot, getCourseKB, getActivities, getDrafts } from '../../js/storage.js';

export default function PortfolioDetail() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const course = state.courses.find(c => c.courseId === courseId);

  const [courseKB, setCourseKB] = useState(null);
  const [activities, setActivities] = useState([]);
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    if (!courseId) return;
    (async () => {
      setCourseKB(await getCourseKB(courseId));
      setActivities(await getActivities(courseId));
      setDrafts(await getDrafts(courseId));
    })();
  }, [courseId]);

  if (!course) return <p>Not found.</p>;

  // Build work items: each draft is a portfolio piece, grouped by activity
  const activityMap = new Map();
  for (const a of activities) {
    activityMap.set(a.id, a);
  }

  return (
    <>
      <div className="course-header" style={{ marginBottom: 'var(--space)' }}>
        <button className="back-btn" aria-label="Back to work" onClick={() => navigate('/work')}>&larr;</button>
        <div className="course-header-info">
          <h2>{course.name}</h2>
        </div>
      </div>

      {/* Learner position summary */}
      {courseKB && (
        <div className="portfolio-summary">
          <div className="portfolio-position">{courseKB.learnerPosition}</div>
          <div className="portfolio-stats">
            {courseKB.activitiesCompleted || 0} activities &middot; {drafts.length} submission{drafts.length !== 1 ? 's' : ''}
            {courseKB.status === 'completed' && <span className="work-badge work-badge-complete" style={{ marginLeft: '8px' }}>Completed</span>}
          </div>
        </div>
      )}

      {/* Work items — most recent first */}
      {drafts.length > 0 ? (
        <div className="portfolio-items">
          {[...drafts].reverse().map(draft => {
            const activity = activityMap.get(draft.activityId);
            return (
              <WorkItem
                key={draft.id}
                draft={draft}
                activityNumber={activity?.activityNumber}
                activityGoal={activity?.instruction?.split('\n')[0]}
              />
            );
          })}
        </div>
      ) : (
        <p className="empty-state" style={{ padding: '0 var(--space, 12px)' }}>
          No submissions yet. Start the course to build your work.
        </p>
      )}
    </>
  );
}

function WorkItem({ draft, activityNumber, activityGoal }) {
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const time = draft.timestamp ? new Date(draft.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const loadScreenshot = async () => {
    if (screenshot) { setScreenshot(null); return; }
    if (!draft.screenshotKey) return;
    setLoading(true);
    const data = await getScreenshot(draft.screenshotKey);
    setScreenshot(data);
    setLoading(false);
  };

  return (
    <div className="work-item">
      <div className="work-item-header">
        {activityNumber && <span className="work-item-number">{activityNumber}</span>}
        <div className="work-item-meta">
          <span className="work-item-time">{time}</span>
          {draft.achieved && <span className="work-badge work-badge-complete">Achieved</span>}
        </div>
      </div>

      {/* What was demonstrated */}
      {draft.demonstrates && (
        <p className="work-item-demonstrates">{draft.demonstrates}</p>
      )}

      {/* Strengths */}
      {draft.strengths?.length > 0 && (
        <div className="work-item-strengths">
          {draft.strengths.map((s, i) => (
            <span key={i} className="work-item-strength">{s}</span>
          ))}
        </div>
      )}

      {/* Text response preview */}
      {draft.textResponse && (
        <details className="work-item-text-detail">
          <summary>Your response</summary>
          <p className="work-item-text">{draft.textResponse}</p>
        </details>
      )}

      {/* Screenshot */}
      {draft.screenshotKey && (
        <button className="timeline-screenshot-btn" onClick={loadScreenshot} style={{ marginTop: '4px' }}>
          {loading ? '...' : screenshot ? 'Hide screenshot' : 'View screenshot'}
        </button>
      )}
      {screenshot && (
        <img src={screenshot} alt="Work screenshot" className="work-item-screenshot" />
      )}

      {/* Growth indicator */}
      {draft.moved && (
        <p className="work-item-moved">{draft.moved}</p>
      )}
    </div>
  );
}
