import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext.jsx';
import { TYPE_LABELS, TYPE_LETTERS, scoreToLabel, levelToLabel } from '../lib/constants.js';
import { getScreenshot, getSummative, getSummativeAttempts, getJourney } from '../../js/storage.js';

export default function PortfolioDetail() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { state } = useApp();
  const courseGroup = state.courseGroups.find(cg => cg.courseId === courseId);

  const [summative, setSummative] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [journey, setJourney] = useState(null);

  useEffect(() => {
    if (!courseId) return;
    (async () => {
      const s = await getSummative(courseId);
      setSummative(s);
      const a = await getSummativeAttempts(courseId);
      setAttempts(a);
      const j = await getJourney(courseId);
      setJourney(j);
    })();
  }, [courseId]);

  if (!courseGroup) return <p>Not found.</p>;

  const journeyUnits = journey?.plan?.units || [];

  return (
    <>
      <div className="course-header" style={{ marginBottom: 'var(--space)' }}>
        <button className="back-btn" aria-label="Back to work" onClick={() => navigate('/work')}>&larr;</button>
        <div className="course-header-info">
          <h2>{courseGroup.name}</h2>
        </div>
      </div>

      {/* Summative section */}
      {summative && (
        <div style={{ marginBottom: 'var(--space)' }}>
          <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px', padding: '0 var(--space, 12px)' }}>
            Summative Assessment
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 8px', padding: '0 var(--space, 12px)' }}>
            {summative.task?.description || 'Assessment task'}
          </p>
          <div className="build-timeline">
            {attempts.map((attempt, ai) => (
              <div key={attempt.id} className="timeline-step">
                <div className="timeline-step-header">
                  <span className="timeline-type-letter">{attempt.isBaseline ? 'B' : `R${attempt.attemptNumber - 1}`}</span>
                  <strong>{attempt.isBaseline ? 'Baseline' : `Retake ${attempt.attemptNumber - 1}`}</strong>
                  {attempt.mastery && <span style={{ color: '#2d7d46', marginLeft: '8px', fontWeight: 600 }}>Mastery</span>}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                  {scoreToLabel(attempt.overallScore || 0)}
                </div>
                {/* Per-criterion scores */}
                {attempt.criteriaScores?.map((cs, ci) => (
                  <div key={ci} style={{ fontSize: '0.75rem', display: 'flex', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 500, minWidth: '40%' }}>{cs.criterion}</span>
                    <span>{levelToLabel(cs.level)}</span>
                  </div>
                ))}
                {/* Screenshot thumbnails */}
                {attempt.screenshots?.map((ss, si) => (
                  <SummativeScreenshot key={si} screenshotKey={ss.screenshot_key} stepIndex={ss.step_index} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Formative section */}
      {journeyUnits.length > 0 && (
        <div>
          <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px', padding: '0 var(--space, 12px)' }}>
            Learning Journey
          </h3>
          <div className="build-timeline">
            {journeyUnits.map((ju, ui) => {
              const unitDef = courseGroup.units?.find(u => u.unitId === ju.unitId);
              const progress = state.allProgress[ju.unitId];
              if (!progress?.activities?.length) return null;

              return (
                <div key={ju.unitId}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, margin: '8px 0 4px', padding: '0 var(--space, 12px)' }}>
                    {unitDef?.name || ju.unitId}
                  </div>
                  {progress.activities.map((activity, ai) => {
                    const drafts = (progress.drafts || []).filter(d => d.activityId === activity.id);
                    return (
                      <div key={ai} className="timeline-step">
                        <div className="timeline-step-header">
                          <span className="timeline-type-letter">{TYPE_LETTERS[activity.type] || '?'}</span>
                          <strong>{TYPE_LABELS[activity.type] || activity.type}</strong>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginBottom: '4px' }}>
                          {activity.goal}
                        </p>
                        {activity.rubricCriteria?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
                            {activity.rubricCriteria.map((c, ci) => (
                              <span key={ci} style={{
                                fontSize: '0.65rem', padding: '1px 5px', borderRadius: '6px',
                                background: 'var(--color-primary-light, #e8f0fe)', color: 'var(--color-primary, #1a73e8)',
                              }}>{c}</span>
                            ))}
                          </div>
                        )}
                        {drafts.map(d => (
                          <TimelineDraft key={d.id} draft={d} unitId={ju.unitId} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function SummativeScreenshot({ screenshotKey, stepIndex }) {
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadScreenshot = async () => {
    if (screenshot) { setScreenshot(null); return; }
    if (!screenshotKey) return;
    setLoading(true);
    const data = await getScreenshot(screenshotKey);
    setScreenshot(data);
    setLoading(false);
  };

  return (
    <div style={{ marginTop: '4px' }}>
      <button className="timeline-screenshot-btn" onClick={loadScreenshot}>
        {loading ? '...' : screenshot ? 'Hide' : `Step ${stepIndex + 1} screenshot`}
      </button>
      {screenshot && (
        <img src={screenshot} alt={`Step ${stepIndex + 1} screenshot`} style={{ width: '100%', borderRadius: 'var(--radius)', marginTop: '4px' }} />
      )}
    </div>
  );
}

function TimelineDraft({ draft, unitId }) {
  const navigate = useNavigate();
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const scoreLabel = draft.score != null ? scoreToLabel(draft.score) : '';
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
      <span className="timeline-draft-score">{scoreLabel}</span>
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
