import { Badge } from '@/components/ui/badge';
import { MASTERY_LABELS, MASTERY_COLORS } from '@/lib/constants';

interface FeedbackDisplayProps {
  score: number;
  mastery: string;
  rationale: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
}

export function FeedbackDisplay({
  score,
  mastery,
  rationale,
  strengths,
  improvements,
  tips,
}: FeedbackDisplayProps) {
  const scoreColor =
    score >= 80
      ? 'text-green-600'
      : score >= 60
        ? 'text-yellow-600'
        : 'text-red-600';

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      {/* Score + mastery */}
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        <Badge className={`ml-1 ${MASTERY_COLORS[mastery] ?? ''}`}>
          {MASTERY_LABELS[mastery] ?? mastery}
        </Badge>
      </div>

      {/* Rationale */}
      <p className="text-sm text-muted-foreground leading-relaxed border-l-2 pl-3">{rationale}</p>

      {/* Three columns of lists */}
      <div className="grid gap-4 sm:grid-cols-3">
        {strengths.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-1">Strengths</p>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-green-600 shrink-0">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {improvements.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-yellow-700 mb-1">Improve</p>
            <ul className="space-y-1">
              {improvements.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-yellow-600 shrink-0">△</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tips.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-1">Tips</p>
            <ul className="space-y-1">
              {tips.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span className="text-blue-500 shrink-0">→</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
