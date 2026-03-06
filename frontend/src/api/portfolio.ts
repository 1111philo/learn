import { get, patch } from './client';
import type { PortfolioArtifact, PortfolioSummary } from './types';

export function getPortfolio(): Promise<PortfolioArtifact[]> {
  return get<PortfolioArtifact[]>('/api/portfolio');
}

export function getArtifact(id: string): Promise<PortfolioArtifact> {
  return get<PortfolioArtifact>(`/api/portfolio/${id}`);
}

export function updateArtifact(
  id: string,
  data: { title?: string; status?: string },
): Promise<PortfolioArtifact> {
  return patch<PortfolioArtifact>(`/api/portfolio/${id}`, data);
}

export function getPortfolioSummary(): Promise<PortfolioSummary> {
  return get<PortfolioSummary>('/api/portfolio/summary');
}
