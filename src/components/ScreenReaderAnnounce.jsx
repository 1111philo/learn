import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ROUTE_NAMES = {
  '/courses': 'Courses',
  '/work': 'Work',
  '/settings': 'Settings',
  '/onboarding': 'Welcome',
};

/** Announces route changes to screen readers via an aria-live region. */
export default function ScreenReaderAnnounce() {
  const location = useLocation();
  const [message, setMessage] = useState('');

  useEffect(() => {
    const path = location.pathname;
    const name = ROUTE_NAMES[path];
    if (name) {
      setMessage(`Navigated to ${name}`);
    } else if (path.startsWith('/unit/')) {
      setMessage('Navigated to course');
    } else if (path.startsWith('/work/')) {
      setMessage('Navigated to work detail');
    } else if (path.startsWith('/courses/')) {
      setMessage('Navigated to units');
    }
  }, [location.pathname]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
    >
      {message}
    </div>
  );
}
