import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, ThumbsUpIcon, TrendingUpIcon, SparklesIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MASTERY_LABELS, MASTERY_COLORS } from '@/lib/constants';

interface FeedbackDisplayProps {
  score: number;
  mastery: string;
  rationale: string;
  strengths: string[];
  improvements: string[];
  tips: string[];
  portfolioReadiness?: string;
  employerRelevanceNotes?: string;
  resumeBulletSeed?: string;
}

type ModalPanel = 'strengths' | 'improvements' | 'tips';

const PORTFOLIO_LABELS: Record<string, string> = {
  practice_only: 'Practice',
  emerging_portfolio_piece: 'Emerging',
  portfolio_ready: 'Portfolio Ready',
};

const PORTFOLIO_COLORS: Record<string, string> = {
  practice_only: 'bg-gray-100 text-gray-700',
  emerging_portfolio_piece: 'bg-yellow-100 text-yellow-700',
  portfolio_ready: 'bg-green-100 text-green-700',
};

export function FeedbackDisplay({
  score,
  mastery,
  rationale,
  strengths,
  improvements,
  tips,
  portfolioReadiness,
  employerRelevanceNotes,
  resumeBulletSeed,
}: FeedbackDisplayProps) {
  const [open, setOpen] = useState<ModalPanel | null>(null);

  const scoreColor =
    score >= 80
      ? 'text-green-600'
      : score >= 60
        ? 'text-yellow-600'
        : 'text-red-600';

  const panels: Record<ModalPanel, { title: string; items: string[]; icon: string }> = {
    strengths:    { title: 'Strengths',    items: strengths,    icon: '✓' },
    improvements: { title: 'Improvements', items: improvements, icon: '△' },
    tips:         { title: 'Tips',         items: tips,         icon: '→' },
  };

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      {/* Positive affirmation */}
      {mastery === 'exceeds' && (
        <p className="text-sm font-medium text-green-700" role="status">
          Outstanding! You've exceeded expectations.
        </p>
      )}
      {mastery === 'meets' && (
        <p className="text-sm font-medium text-green-700" role="status">
          Great work! You've demonstrated mastery.
        </p>
      )}
      {mastery === 'not_yet' && (
        <p className="text-sm font-medium text-yellow-700" role="status">
          Good progress! Here's what to focus on next.
        </p>
      )}

      {/* Score + mastery */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`text-3xl font-bold tabular-nums ${scoreColor}`}>{score}</span>
        <span className="text-sm text-foreground/50">/ 100</span>
        <Badge className={`ml-1 ${MASTERY_COLORS[mastery] ?? ''}`}>
          {MASTERY_LABELS[mastery] ?? mastery}
        </Badge>
        {portfolioReadiness && (
          <Badge className={`ml-1 ${PORTFOLIO_COLORS[portfolioReadiness] ?? ''}`}>
            {PORTFOLIO_LABELS[portfolioReadiness] ?? portfolioReadiness}
          </Badge>
        )}
      </div>

      {/* Rationale */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50 mb-1">Rationale</p>
        <p className="text-sm leading-relaxed border-l-2 pl-3">{rationale}</p>
      </div>

      {/* Employer relevance */}
      {employerRelevanceNotes && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50 mb-1">Employer Relevance</p>
          <p className="text-sm leading-relaxed border-l-2 border-blue-200 pl-3">{employerRelevanceNotes}</p>
        </div>
      )}

      {/* Resume bullet */}
      {resumeBulletSeed && (
        <div className="rounded-md bg-green-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-1">Resume Bullet</p>
          <p className="text-sm text-green-800">{resumeBulletSeed}</p>
        </div>
      )}

      {/* Detail buttons */}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        {strengths.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="cursor-pointer text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700" onClick={() => setOpen('strengths')}>
            <ThumbsUpIcon />
            Strengths
          </Button>
        )}
        {improvements.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="cursor-pointer text-yellow-600 border-yellow-200 hover:bg-yellow-50 hover:text-yellow-700" onClick={() => setOpen('improvements')}>
            <TrendingUpIcon />
            Improvements
          </Button>
        )}
        {tips.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="cursor-pointer text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={() => setOpen('tips')}>
            <SparklesIcon />
            Tips
          </Button>
        )}
      </div>

      {/* Modal */}
      <Dialog.Root open={open !== null} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-sm font-semibold">
                {open ? panels[open].title : ''}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 cursor-pointer">
                  <XIcon className="h-3.5 w-3.5" />
                  <span className="sr-only">Close</span>
                </Button>
              </Dialog.Close>
            </div>
            <ul className="space-y-2">
              {open && panels[open].items.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-0.5 shrink-0 font-medium text-foreground/40">{panels[open].icon}</span>
                  {item}
                </li>
              ))}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
