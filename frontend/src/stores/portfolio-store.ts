import { create } from 'zustand';
import { getPortfolio, updateArtifact } from '@/api/portfolio';
import type { PortfolioArtifact } from '@/api/types';

interface PortfolioStore {
  artifacts: PortfolioArtifact[];
  loading: boolean;
  error: string | null;
  loadPortfolio: () => Promise<void>;
  updateArtifactStatus: (id: string, status: string) => Promise<void>;
}

export const usePortfolioStore = create<PortfolioStore>((set, get) => ({
  artifacts: [],
  loading: false,
  error: null,

  loadPortfolio: async () => {
    set({ loading: true, error: null });
    try {
      const artifacts = await getPortfolio();
      set({ artifacts, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  updateArtifactStatus: async (id: string, status: string) => {
    try {
      const updated = await updateArtifact(id, { status });
      set({
        artifacts: get().artifacts.map((a) => (a.id === id ? updated : a)),
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
