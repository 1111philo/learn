import { useState, useEffect } from 'react';
import { useApp } from '../contexts/AppContext.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import {
  getApiKey, saveApiKey,
  savePreferences,
  getLearnerProfileSummary, getLearnerProfile,
  saveLearnerProfile, saveLearnerProfileSummary,
} from '../../js/storage.js';
import * as orchestrator from '../../js/orchestrator.js';
import { syncInBackground } from '../lib/syncDebounce.js';
import { ensureProfileExists, mergeProfile } from '../lib/profileQueue.js';

export default function Settings() {
  const { state, dispatch } = useApp();
  const { loggedIn } = useAuth();
  const { show: showModal } = useModal();
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keyFeedback, setKeyFeedback] = useState('');
  const [name, setName] = useState(state.preferences?.name || '');
  const [profileSummary, setProfileSummary] = useState('');

  useEffect(() => {
    (async () => {
      const key = await getApiKey();
      setHasKey(!!key);
      if (key) setApiKey('\u2022'.repeat(40));
      setProfileSummary(await getLearnerProfileSummary());
    })();
  }, []);

  const handleSaveKey = async () => {
    const val = apiKey.trim();
    if (!val || val === '\u2022'.repeat(40)) return;
    await saveApiKey(val); // API keys stay local only — never synced to server
    setHasKey(true);
    setApiKey('\u2022'.repeat(40));
    setKeyFeedback('Saved!');
    setTimeout(() => setKeyFeedback(''), 2000);
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    const prefs = { ...state.preferences, name: name.trim() };
    await savePreferences(prefs);
    dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
    syncInBackground('preferences');
  };

  const handleProfileFeedback = () => {
    showModal(<ProfileFeedbackModal onDone={async () => {
      setProfileSummary(await getLearnerProfileSummary());
    }} />);
  };

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      <div className="settings-section">
        <h3>AI Provider</h3>
        {loggedIn ? (
          <p className="settings-hint">
            AI is provided by your <a href="https://account.philosophers.group" target="_blank" rel="noopener">1111 Learn</a> account.
          </p>
        ) : (
          <>
            <p className="settings-hint">
              Enter your <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic API key</a> to enable AI-powered learning.
            </p>
            <div className="api-key-row">
              <PasswordField
                id="api-key-input"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveKey(); } }}
              />
              <button className="primary-btn" onClick={handleSaveKey}>Save</button>
            </div>
            {keyFeedback && <div className="key-feedback success">{keyFeedback}</div>}
          </>
        )}
      </div>

      <hr />

      {!loggedIn && (
        <div className="settings-section">
          <h3>Personalization</h3>
          <form className="settings-form" onSubmit={handleSaveName}>
            <label>
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="primary-btn">Save</button>
          </form>
        </div>
      )}

      <div className="settings-section">
        <h3>Learner Profile</h3>
        <p className="settings-hint">Updated automatically by the AI as you complete activities.</p>
        <div className="profile-display" aria-label="Learner profile summary">
          {profileSummary || <em>No profile yet. Complete an activity to build your profile.</em>}
        </div>
        <button className="secondary-btn profile-feedback-btn" onClick={handleProfileFeedback}>
          Add Feedback
        </button>
      </div>
    </div>
  );
}

function ProfileFeedbackModal({ onDone }) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { hide } = useModal();

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const profile = await ensureProfileExists();
      const result = await orchestrator.updateProfileFromFeedback(profile, text.trim(), {
        courseName: 'Settings', activityType: 'feedback', activityGoal: 'User-provided profile feedback',
      });
      if (result?.profile) {
        const merged = mergeProfile(profile, result.profile);
        await saveLearnerProfile(merged);
        if (result.summary) await saveLearnerProfileSummary(result.summary);
        syncInBackground('profile', 'profileSummary');
      }
      hide();
      if (onDone) onDone();
    } catch (e) {
      console.error('[1111] Profile feedback failed:', e?.message || e);
      setSubmitting(false);
    }
  };

  return (
    <>
      <h2>Add Profile Feedback</h2>
      <p>Share anything that seems inaccurate or missing — your device, experience level, learning style, or anything else.</p>
      <label htmlFor="profile-feedback-input" className="sr-only">Profile feedback</label>
      <textarea
        id="profile-feedback-input"
        className="feedback-textarea"
        rows={4}
        placeholder="e.g. I'm a complete beginner. I use a Chromebook and don't have admin access."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); } }}
      />
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="primary-btn" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Updating...' : 'Submit'}
        </button>
      </div>
    </>
  );
}
