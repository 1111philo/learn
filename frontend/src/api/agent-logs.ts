import { get } from './client';
import type { AgentLog } from './types';

export function listAgentLogs(courseId?: string): Promise<AgentLog[]> {
  const params = courseId ? `?course_id=${courseId}` : '';
  return get<AgentLog[]>(`/api/agent-logs${params}`);
}
