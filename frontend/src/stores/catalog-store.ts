import { create } from 'zustand';
import type { CatalogCourse } from '@/api/types';
import { fetchCatalog } from '@/api/catalog';

interface CatalogState {
  courses: CatalogCourse[];
  allCompleted: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useCatalogStore = create<CatalogState>((set) => ({
  courses: [],
  allCompleted: false,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const data = await fetchCatalog();
      set({ courses: data.courses, allCompleted: data.all_completed, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },
}));
