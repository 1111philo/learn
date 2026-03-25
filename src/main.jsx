import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ModalProvider } from './contexts/ModalContext.jsx';
import App from './App.jsx';
import { init as initDatabase } from '../js/db.js';
import '../sidepanel.css';

let initialized = false;

async function bootstrap() {
  if (initialized) return;
  initialized = true;

  // Seed from .env.js if present (dev convenience — file is gitignored).
  // Fetched at runtime (not bundled) since .env.js is copied to dist/ by viteStaticCopy.
  try {
    const envResp = await fetch('.env.js');
    if (!envResp.ok) throw new Error('no .env.js');
    const envText = await envResp.text();
    const envBlob = new Blob([envText], { type: 'application/javascript' });
    const envUrl = URL.createObjectURL(envBlob);
    const { ENV } = await import(/* @vite-ignore */ envUrl);
    URL.revokeObjectURL(envUrl);
    const { getApiKey, saveApiKey, getPreferences, savePreferences } = await import('../js/storage.js');
    if (ENV.apiKey && !(await getApiKey())) await saveApiKey(ENV.apiKey);
    if (ENV.name) {
      const prefs = await getPreferences();
      if (!prefs.name) await savePreferences({ ...prefs, name: ENV.name });
    }
    // Store credentials for form pre-fill (not auto-login)
    if (ENV.email || ENV.password) {
      globalThis.__envCredentials = { email: ENV.email || '', password: ENV.password || '' };
    }
  } catch { /* .env.js not present — that's fine */ }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HashRouter>
        <AppProvider>
          <AuthProvider>
            <ModalProvider>
              <App />
            </ModalProvider>
          </AuthProvider>
        </AppProvider>
      </HashRouter>
    </React.StrictMode>
  );
}

// Initialize database, then mount React
initDatabase().then(bootstrap).catch((err) => {
  console.error('Failed to initialize database:', err);
  document.getElementById('root').textContent = 'Failed to load. Please reload the extension.';
});
