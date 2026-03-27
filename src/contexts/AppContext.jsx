import { createContext, useContext, useReducer, useEffect } from 'react';
import { getPreferences, getAllProgress } from '../../js/storage.js';
import { loadCourses, flattenCourses } from '../../js/courses.js';
import * as sync from '../../js/sync.js';
import * as auth from '../../js/auth.js';

const AppContext = createContext(null);

const initialState = {
  courseGroups: [],
  units: [],
  allProgress: {},
  preferences: { name: '' },
  generating: null, // { unitId, promise }
  loaded: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'INIT_DATA':
      return { ...state, ...action.payload, loaded: true };
    case 'SET_PROGRESS':
      return {
        ...state,
        allProgress: { ...state.allProgress, [action.unitId]: action.progress },
      };
    case 'UPDATE_ALL_PROGRESS':
      return { ...state, allProgress: action.allProgress };
    case 'SET_PREFERENCES':
      return { ...state, preferences: action.preferences };
    case 'SET_GENERATING':
      return { ...state, generating: action.generating };
    case 'RESET_UNIT': {
      const { [action.unitId]: _, ...rest } = state.allProgress;
      return { ...state, allProgress: rest };
    }
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    async function load() {
      const courseGroups = await loadCourses();
      const units = flattenCourses(courseGroups);

      // If logged in, sync BEFORE reading local data so profile/progress are fresh
      if (await auth.isLoggedIn()) {
        try { await sync.loadAll(); } catch { /* offline — local cache is fine */ }
      }

      const preferences = await getPreferences();
      const allProgress = await getAllProgress();
      dispatch({ type: 'INIT_DATA', payload: { preferences, courseGroups, units, allProgress } });
    }
    load();
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
