import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useApp } from '../../contexts/AppContext.jsx';
import OnboardingCanvas from '../../components/OnboardingCanvas.jsx';
import WelcomeStep from './WelcomeStep.jsx';
import NameStep from './NameStep.jsx';
import ApiKeyStep from './ApiKeyStep.jsx';
import AboutYouStep from './AboutYouStep.jsx';
import {
  getOnboardingState, saveOnboardingState, clearOnboardingState,
  saveOnboardingComplete, savePreferences,
} from '../../../js/storage.js';
import { syncInBackground } from '../../lib/syncDebounce.js';

export default function OnboardingFlow() {
  const navigate = useNavigate();
  const { loggedIn } = useAuth();
  const { state, dispatch } = useApp();
  const [step, setStep] = useState(loggedIn ? 'about' : 'welcome');
  const [data, setData] = useState({ name: state.preferences?.name || '', messages: [], profileDone: false });

  // Restore conversation state on mount
  useEffect(() => {
    (async () => {
      const saved = await getOnboardingState();
      if (saved) setData(prev => ({ ...prev, ...saved }));
    })();
  }, []);

  const updateData = (updates) => {
    setData(prev => {
      const next = { ...prev, ...updates };
      saveOnboardingState({ name: next.name, messages: next.messages, profileDone: next.profileDone });
      return next;
    });
  };

  const complete = async () => {
    const prefs = { ...state.preferences, name: data.name };
    await savePreferences(prefs);
    dispatch({ type: 'SET_PREFERENCES', preferences: prefs });
    syncInBackground('preferences');
    await saveOnboardingComplete();
    await clearOnboardingState();
    navigate('/courses', { replace: true });
  };

  const showLogo = step === 'welcome';

  let content;
  switch (step) {
    case 'welcome':
      content = <WelcomeStep data={data} updateData={updateData} goTo={setStep} />;
      break;
    case 'name':
      content = <NameStep data={data} updateData={updateData} goTo={setStep} />;
      break;
    case 'apikey':
      content = <ApiKeyStep data={data} updateData={updateData} goTo={setStep} />;
      break;
    case 'about':
      content = <AboutYouStep data={data} updateData={updateData} onComplete={complete} />;
      break;
    default:
      content = <WelcomeStep data={data} updateData={updateData} goTo={setStep} />;
  }

  return (
    <div className="onboarding-backdrop">
      <OnboardingCanvas />
      {showLogo && (
        <a href="https://philosophers.group/" target="_blank" rel="noopener" className="onboarding-logo-link">
          <img src="assets/icon-128.png" alt="1111" className="onboarding-logo" />
        </a>
      )}
      <div className="onboarding-card">
        {content}
      </div>
    </div>
  );
}
