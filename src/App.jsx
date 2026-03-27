import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from './contexts/AppContext.jsx';
import { useAuth } from './contexts/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import OnboardingFlow from './pages/onboarding/OnboardingFlow.jsx';
import CoursesList from './pages/CoursesList.jsx';
import CourseChat from './pages/CourseChat.jsx';
import Portfolio from './pages/Portfolio.jsx';
import PortfolioDetail from './pages/PortfolioDetail.jsx';
import Settings from './pages/Settings.jsx';
import ScreenReaderAnnounce from './components/ScreenReaderAnnounce.jsx';
import { getOnboardingComplete, saveOnboardingComplete, getLearnerProfile } from '../js/storage.js';

export default function App() {
  const { state } = useApp();
  const { loggedIn, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect to onboarding on initial load only (not on every state change)
  useEffect(() => {
    if (!state.loaded || authLoading) return;
    // Skip if already on an onboarding route
    if (window.location.hash.includes('/onboarding')) return;
    (async () => {
      const done = await getOnboardingComplete();
      if (!done && loggedIn) {
        // Logged-in user — check if they already have a profile (synced from server)
        const profile = await getLearnerProfile();
        if (profile) {
          // Profile exists — skip onboarding, stamp the flag
          await saveOnboardingComplete();
        } else {
          // No profile yet — send to About You step to generate one
          navigate('/onboarding/about', { replace: true });
        }
      } else if (!done && !loggedIn) {
        navigate('/onboarding', { replace: true });
      }
    })();
    // Only run once on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.loaded, authLoading]);

  if (!state.loaded || authLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="loading-spinner-inline" aria-hidden="true" />
    </div>;
  }

  return (
    <AppShell>
      <ScreenReaderAnnounce />
      <Routes>
        <Route path="/onboarding/*" element={<OnboardingFlow />} />
        <Route path="/courses" element={<CoursesList />} />
        <Route path="/courses/:courseGroupId" element={<CourseChat />} />
        <Route path="/work" element={<Portfolio />} />
        <Route path="/work/:courseId" element={<PortfolioDetail />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/" element={<Navigate to="/courses" replace />} />
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </AppShell>
  );
}
