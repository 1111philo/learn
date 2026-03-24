import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { TYPE_LABELS, TYPE_LETTERS } from '../lib/constants.js';
import { getScreenshot } from '../../js/storage.js';

export default function PortfolioDetail() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const unit = state.units.find(u => u.unitId === unitId);
  const progress = state.allProgress[unitId];

  if (!unit || !progress) return <p>Not found.</p>;

  const plan = progress.learningPlan;

  return (
    <>
      <div className="course-header" style={{ marginBottom: 'var(--space)' }}>
        <button className="back-btn" aria-label="Back to work" onClick={() => navigate('/work')}>&larr;</button>
        <div className="course-header-info">
          <h2>{plan?.finalWorkProductDescription || unit.name}</h2>
        </div>
      </div>
      <div className="build-timeline">
        {(plan?.activities || []).map((slot, i) => {
          const activity = progress.activities?.[i];
          const drafts = progress.drafts?.filter(d => d.activityId === (activity?.id || slot.id)) || [];
          const isCurrent = i === progress.currentActivityIndex && progress.status !== 'completed';
          const isFuture = !activity;

          return (
            <div key={i} className={`timeline-step${isCurrent ? ' timeline-current' : ''}${isFuture ? ' timeline-future' : ''}`}>
              <div className="timeline-step-header">
                <span className="timeline-type-letter">{TYPE_LETTERS[slot.type] || '?'}</span>
                <strong>{TYPE_LABELS[slot.type] || slot.type}</strong>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>{slot.goal}</p>
              {drafts.map((d, di) => (
                <TimelineDraft key={d.id} draft={d} unitId={unitId} />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TimelineDraft({ draft, unitId }) {
  const navigate = useNavigate();
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const scorePercent = draft.score != null ? Math.round(draft.score * 100) + '%' : '';
  const time = draft.timestamp ? new Date(draft.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const loadScreenshot = async () => {
    if (screenshot) { setScreenshot(null); return; }
    if (!draft.screenshotKey) return;
    setLoading(true);
    const data = await getScreenshot(draft.screenshotKey);
    setScreenshot(data);
    setLoading(false);
  };

  const goToChat = () => {
    navigate(`/unit/${unitId}?scrollTo=${draft.id}`);
  };

  return (
    <div className="timeline-draft">
      <span className="timeline-draft-score">{scorePercent}</span>
      <span className="timeline-draft-time">{time}</span>
      <button className="timeline-draft-link" onClick={goToChat} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}>
        View in chat
      </button>
      {draft.url && <a className="timeline-draft-link" href={draft.url} target="_blank" rel="noopener">Open page</a>}
      {draft.screenshotKey && (
        <button className="timeline-screenshot-btn" onClick={loadScreenshot}>
          {loading ? '...' : screenshot ? 'Hide' : 'Screenshot'}
        </button>
      )}
      {screenshot && (
        <img src={screenshot} alt="Draft screenshot" style={{ width: '100%', borderRadius: 'var(--radius)', marginTop: '4px' }} />
      )}
    </div>
  );
}
