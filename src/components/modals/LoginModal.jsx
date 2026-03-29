import { useState, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useModal } from '../../contexts/ModalContext.jsx';
import { useApp } from '../../contexts/AppContext.jsx';
import PasswordField from '../PasswordField.jsx';
import { getPreferences, savePreferences } from '../../../js/storage.js';
import * as sync from '../../../js/sync.js';
import { loadCourses } from '../../../js/courseOwner.js';
import { syncInBackground } from '../../lib/syncDebounce.js';

export default function LoginModal({ onSuccess }) {
  const [email, setEmail] = useState(globalThis.__envCredentials?.email || '');
  const [password, setPassword] = useState(globalThis.__envCredentials?.password || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef(null);
  const { login } = useAuth();
  const { hide } = useModal();
  const { dispatch } = useApp();

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const authUser = await login(email.trim(), password);

      // Sync auth name into preferences
      if (authUser?.name) {
        const prefs = { ...(await getPreferences()), name: authUser.name };
        await savePreferences(prefs);
        dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
        syncInBackground('preferences');
      }

      // Refresh data from server
      try {
        await sync.loadAll();
        const freshPrefs = await getPreferences();
        const courses = await loadCourses();
        dispatch({ type: 'INIT_DATA', payload: { preferences: freshPrefs, courses } });
      } catch { /* offline */ }

      setTimeout(() => {
        hide();
        if (onSuccess) onSuccess();
      }, 500);
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      setSubmitting(false);
    }
  };

  return (
    <>
      <h2>Sign In</h2>
      <p>Sign in to sync your data with{' '}
        <a href="https://learn.philosophers.group" target="_blank" rel="noopener">1111 Learn</a>.
      </p>
      <form className="settings-form" onSubmit={handleSubmit} action="#">
        <label htmlFor="modal-login-email">Email</label>
        <input
          id="modal-login-email"
          type="email"
          name="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') passwordRef.current?.focus(); }}
          disabled={submitting}
        />
        <label htmlFor="modal-login-password">Password</label>
        <PasswordField
          id="modal-login-password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          inputRef={passwordRef}
          required
          disabled={submitting}
        />
        {error && <div className="login-error-msg" role="status" aria-live="polite">{error}</div>}
        <div className="action-bar">
          <button type="button" className="secondary-btn" onClick={hide} disabled={submitting}>Cancel</button>
          <button type="submit" className="primary-btn" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </form>
    </>
  );
}
