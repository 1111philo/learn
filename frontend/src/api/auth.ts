import { post, get } from './client';

export interface UserInfo {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: UserInfo;
}

export function register(email: string, password: string): Promise<AuthResponse> {
  return post<AuthResponse>('/api/auth/register', { email, password });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return post<AuthResponse>('/api/auth/login', { email, password });
}

export function getMe(): Promise<UserInfo> {
  return get<UserInfo>('/api/auth/me');
}
