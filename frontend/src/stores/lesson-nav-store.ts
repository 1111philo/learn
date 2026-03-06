import { create } from 'zustand';

export interface LessonSection {
  title: string;
  content: string;
}

interface LessonNavState {
  sections: LessonSection[];
  currentPage: number;
  setSections: (sections: LessonSection[]) => void;
  setCurrentPage: (page: number) => void;
}

export const useLessonNavStore = create<LessonNavState>((set) => ({
  sections: [],
  currentPage: 0,
  setSections: (sections) => set({ sections }),
  setCurrentPage: (page) => set({ currentPage: page }),
}));
