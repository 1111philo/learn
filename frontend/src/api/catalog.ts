import { get, post } from './client';
import type { CatalogResponse } from './types';

export function fetchCatalog(): Promise<CatalogResponse> {
  return get<CatalogResponse>('/api/catalog');
}

export function startCatalogCourse(
  courseId: string,
): Promise<{ id: string; status: string }> {
  return post<{ id: string; status: string }>(
    `/api/catalog/${courseId}/start`,
  );
}
