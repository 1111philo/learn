import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ActivitySpec } from '@/api/types';

interface ActivityPanelProps {
  spec: ActivitySpec;
}

export function ActivityPanel({ spec }: ActivityPanelProps) {
  const [showHints, setShowHints] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs capitalize">
          {spec.activity_type.replace(/_/g, ' ')}
        </Badge>
      </div>

      {/* Prompt — the hero element */}
      <p className="text-base font-medium leading-snug">{spec.prompt}</p>

      {/* Instructions — constraints/guidance, secondary */}
      {spec.instructions && (
        <p className="text-sm text-muted-foreground">{spec.instructions}</p>
      )}

      {/* Scoring criteria + hints — collapsible */}
      <div className="flex flex-wrap gap-4 border-t pt-3">
        {spec.scoring_rubric.length > 0 && (
          <div className="flex-1 min-w-[160px]">
            <button
              type="button"
              aria-expanded={showCriteria}
              aria-controls="criteria-list"
              onClick={() => setShowCriteria(!showCriteria)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showCriteria ? '▾ Criteria' : '▸ Criteria'}
            </button>
            {showCriteria && (
              <ul id="criteria-list" className="mt-2 space-y-1">
                {spec.scoring_rubric.map((c, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5 shrink-0 text-muted-foreground/50">·</span>
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {spec.hints.length > 0 && (
          <div className="flex-1 min-w-[160px]">
            <button
              type="button"
              aria-expanded={showHints}
              aria-controls="hints-list"
              onClick={() => setShowHints(!showHints)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showHints ? '▾ Hints' : '▸ Hints'}
            </button>
            {showHints && (
              <ul id="hints-list" className="mt-2 space-y-1">
                {spec.hints.map((h, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5 shrink-0 text-muted-foreground/50">·</span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
