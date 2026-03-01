import { AUTH_TOKEN_KEY } from '@/lib/constants';

/**
 * Append the JWT token as a query parameter to an SSE URL.
 * EventSource can't send custom headers, so we pass the token via ?token=<jwt>.
 */
export function sseUrl(path: string): string {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}token=${encodeURIComponent(token)}`;
}
