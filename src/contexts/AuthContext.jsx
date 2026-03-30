import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authModule from '../../js/auth.js';
import { init as initDatabase, clearAllData } from '../../js/db.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    authModule.isLoggedIn().then(async (result) => {
      setLoggedIn(result);
      if (result) setUser(await authModule.getCurrentUser());
      setLoading(false);
    });
  }, []);

  // Listen for session expiry (e.g. refresh token rotated by another device)
  useEffect(() => {
    return authModule.onSessionExpired(() => setSessionExpired(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const authUser = await authModule.login(email, password);
    setLoggedIn(true);
    setUser(authUser);
    setSessionExpired(false);
    return authUser;
  }, []);

  const logout = useCallback(async () => {
    await authModule.logout();
    await clearAllData();
    try {
      if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        for (const db of dbs) { if (db.name) indexedDB.deleteDatabase(db.name); }
      }
    } catch { /* not supported in all WebView environments */ }
    await initDatabase();
    setLoggedIn(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loggedIn, user, loading, login, logout, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
