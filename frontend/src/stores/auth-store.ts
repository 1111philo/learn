import { create } from 'zustand';
import { AUTH_TOKEN_KEY } from '@/lib/constants';
import { ApiError } from '@/api/client';
import * as authApi from '@/api/auth';

interface AuthState {
  token: string | null;
  user: authApi.UserInfo | null;
  loading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem(AUTH_TOKEN_KEY),
  user: null,
  loading: true,

  login: async (email, password) => {
    const res = await authApi.login(email, password);
    localStorage.setItem(AUTH_TOKEN_KEY, res.token);
    set({ token: res.token, user: res.user });
  },

  register: async (email, password) => {
    const res = await authApi.register(email, password);
    localStorage.setItem(AUTH_TOKEN_KEY, res.token);
    set({ token: res.token, user: res.user });
  },

  logout: () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    set({ token: null, user: null });
    window.location.href = '/login';
  },

  checkAuth: async () => {
    const { token } = get();
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const user = await authApi.getMe();
      set({ user, loading: false });
    } catch (err) {
      // Only clear token on auth rejection (401). Transient network errors
      // should not destroy the session — the user can retry on next navigation.
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        set({ token: null, user: null, loading: false });
      } else {
        set({ loading: false });
      }
    }
  },
}));
