import { useEffect, useState } from 'react';
import { Loader2, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePortfolioStore } from '@/stores/portfolio-store';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  revised: 'Revised',
  portfolio_ready: 'Portfolio Ready',
  tool_ready: 'Tool Ready',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  revised: 'bg-yellow-100 text-yellow-700',
  portfolio_ready: 'bg-green-100 text-green-700',
  tool_ready: 'bg-blue-100 text-blue-700',
};

const FILTER_OPTIONS = ['all', 'draft', 'revised', 'portfolio_ready', 'tool_ready'] as const;

export function PortfolioPage() {
  const { artifacts, loading, error, loadPortfolio, updateArtifactStatus } = usePortfolioStore();
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  const filtered = filter === 'all'
    ? artifacts
    : artifacts.filter((a) => a.status === filter);

  const statusCounts = artifacts.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading portfolio...
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive">{error}</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Briefcase className="h-5 w-5" />
        <h1 className="text-xl sm:text-2xl font-bold">My Portfolio</h1>
        <Badge variant="secondary" className="ml-auto">
          {artifacts.length} artifact{artifacts.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {/* Stats */}
      {artifacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(statusCounts).map(([status, count]) => (
            <Badge key={status} className={STATUS_COLORS[status] ?? ''}>
              {STATUS_LABELS[status] ?? status}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt}
            variant={filter === opt ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(opt)}
            className="text-xs capitalize"
          >
            {opt === 'all' ? 'All' : (STATUS_LABELS[opt] ?? opt)}
          </Button>
        ))}
      </div>

      {/* Artifact list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {artifacts.length === 0
            ? 'No portfolio artifacts yet. Complete course activities to build your portfolio.'
            : 'No artifacts match this filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((artifact) => {
            const isExpanded = expandedId === artifact.id;
            return (
              <div
                key={artifact.id}
                className="rounded-lg border bg-card p-4 space-y-2"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : artifact.id)}
                      className="text-sm font-medium text-left hover:underline"
                    >
                      {artifact.title}
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <Badge variant="outline" className="text-xs capitalize">
                        {artifact.artifact_type.replace(/_/g, ' ')}
                      </Badge>
                      <Badge className={`text-xs ${STATUS_COLORS[artifact.status] ?? ''}`}>
                        {STATUS_LABELS[artifact.status] ?? artifact.status}
                      </Badge>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(artifact.updated_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Skills */}
                {artifact.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {artifact.skills.map((skill, i) => (
                      <Badge key={i} variant="outline" className="text-[10px]">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t pt-3 space-y-2 text-sm">
                    {artifact.content_pointer && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Content</p>
                        <p className="whitespace-pre-wrap text-sm bg-muted rounded p-3 max-h-60 overflow-y-auto">
                          {artifact.content_pointer}
                        </p>
                      </div>
                    )}
                    {artifact.audience && (
                      <p><span className="font-medium">Audience:</span> {artifact.audience}</p>
                    )}
                    {artifact.employer_use_case && (
                      <p><span className="font-medium">Employer relevance:</span> {artifact.employer_use_case}</p>
                    )}
                    {artifact.resume_bullet_seed && (
                      <div className="rounded-md bg-green-50 px-3 py-2">
                        <p className="text-xs font-medium text-green-700 mb-0.5">Resume Bullet</p>
                        <p className="text-sm text-green-800">{artifact.resume_bullet_seed}</p>
                      </div>
                    )}

                    {/* Promote action */}
                    {artifact.status === 'portfolio_ready' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateArtifactStatus(artifact.id, 'tool_ready')}
                      >
                        Promote to Tool Ready
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
