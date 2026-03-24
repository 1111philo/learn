import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useModal } from '../contexts/ModalContext.jsx';
import { useViewTransition } from '../hooks/useViewTransition.js';
import LoginModal from './modals/LoginModal.jsx';

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { loggedIn, user, logout } = useAuth();
  const { show: showModal } = useModal();
  const animClass = useViewTransition();
  const isOnboarding = location.pathname.startsWith('/onboarding');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const btnRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (!dropdownRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [dropdownOpen]);

  // Close dropdown on Escape
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') { setDropdownOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dropdownOpen]);

  const handleUserMenuClick = () => {
    if (!loggedIn) {
      showModal(<LoginModal />);
      return;
    }
    setDropdownOpen(!dropdownOpen);
  };

  const handleSignOut = () => {
    setDropdownOpen(false);
    showModal(
      <ConfirmSignOut onConfirm={async () => {
        await logout();
        navigate('/onboarding');
      }} />,
      'alertdialog',
      'Confirm sign out'
    );
  };

  const navTo = (path) => navigate(path);
  const currentNav = (path) => {
    if (path === '/courses') return location.pathname === '/courses' || location.pathname.startsWith('/unit') || location.pathname.startsWith('/courses/');
    if (path === '/work') return location.pathname.startsWith('/work');
    return location.pathname === path;
  };

  return (
    <>
      {!isOnboarding && (
        <header>
          <img src="assets/icon-32.png" alt="1111" className="logo" />
          <span className="header-title">Learn</span>
          <div className="header-spacer" />
          <div className="user-menu" id="user-menu">
            <button
              className="user-menu-btn"
              ref={btnRef}
              aria-label={loggedIn ? `Account: ${user?.email || 'signed in'}` : 'Login'}
              aria-haspopup={loggedIn ? 'true' : undefined}
              aria-expanded={loggedIn ? String(dropdownOpen) : undefined}
              aria-controls={loggedIn ? 'user-dropdown-menu' : undefined}
              onClick={handleUserMenuClick}
            >
              <span id="user-menu-label">{loggedIn ? (user?.email || 'Account') : 'Login'}</span>
            </button>
            {loggedIn && !dropdownOpen ? null : null}
            {dropdownOpen && (
              <div className="user-dropdown" id="user-dropdown-menu" role="menu" ref={dropdownRef}>
                <p className="user-dropdown-email">{user?.email || ''}</p>
                <button className="secondary-btn" style={{ width: '100%' }} onClick={handleSignOut}>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      <main id="main-content" className={animClass} tabIndex={-1} aria-label="App content">
        {children}
      </main>

      {!isOnboarding && (
        <nav aria-label="Main navigation">
          <button onClick={() => navTo('/courses')} aria-current={currentNav('/courses') ? 'page' : 'false'}>Courses</button>
          <button onClick={() => navTo('/work')} aria-current={currentNav('/work') ? 'page' : 'false'}>Work</button>
          <button onClick={() => navTo('/settings')} aria-current={currentNav('/settings') ? 'page' : 'false'}>Settings</button>
        </nav>
      )}
    </>
  );
}

function ConfirmSignOut({ onConfirm }) {
  const { hide } = useModal();
  return (
    <>
      <h2>Sign Out?</h2>
      <p>This will clear all local data and return you to the welcome screen.</p>
      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="danger-btn" onClick={() => { hide(); onConfirm(); }}>Sign Out</button>
      </div>
    </>
  );
}
