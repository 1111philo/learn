import { get, put } from './client';

export interface ProfileData {
  display_name: string | null;
  experience_level: string | null;
  learning_goals: string[];
  interests: string[];
  learning_style: string | null;
  tone_preference: string | null;
  skill_signals: { strengths: string[]; gaps: string[] };
  version: number;
  career_interests: string[];
  target_roles: string[];
  portfolio_goals: string[];
}

export interface ProfileUpdateData {
  display_name?: string | null;
  experience_level?: string | null;
  learning_goals?: string[];
  interests?: string[];
  learning_style?: string | null;
  tone_preference?: string | null;
  career_interests?: string[];
  target_roles?: string[];
  portfolio_goals?: string[];
}

export function getProfile(): Promise<ProfileData> {
  return get<ProfileData>('/api/profile');
}

export function updateProfile(data: ProfileUpdateData): Promise<ProfileData> {
  return put<ProfileData>('/api/profile', data);
}
