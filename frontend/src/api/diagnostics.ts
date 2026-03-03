import { post, get } from './client';
import type { DiagnosticSpec } from './types';

export function getDiagnostic(
  courseId: string,
): Promise<{ status: string; diagnostic_spec: DiagnosticSpec | null }> {
  return get(`/api/courses/${courseId}/diagnostic`);
}

export function submitDiagnostic(
  courseId: string,
  responses: { question: string; answer: string }[],
): Promise<{ id: string; status: string }> {
  return post(`/api/courses/${courseId}/diagnostic/submit`, { responses });
}
