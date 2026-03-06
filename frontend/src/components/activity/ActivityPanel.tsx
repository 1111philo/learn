import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { XIcon, ListChecksIcon, LightbulbIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActivitySpec } from '@/api/types';

interface ActivityPanelProps {
  spec: ActivitySpec;
}

type ModalPanel = 'criteria' | 'hints';

export function ActivityPanel({ spec }: ActivityPanelProps) {
  const [open, setOpen] = useState<ModalPanel | null>(null);

  const panelContent: Record<ModalPanel, { title: string; items: string[] }> = {
    criteria: { title: 'Scoring Criteria', items: spec.scoring_rubric },
    hints:    { title: 'Hints',            items: spec.hints },
  };

  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
      {/* Activity type + portfolio badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="text-xs capitalize">
          {spec.activity_type.replace(/_/g, ' ')}
        </Badge>
        {spec.portfolio_eligible && (
          <Badge className="text-xs bg-green-100 text-green-700">Portfolio Eligible</Badge>
        )}
        {spec.artifact_type && (
          <Badge variant="outline" className="text-xs capitalize">
            {spec.artifact_type.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>

      {/* Prompt — hero */}
      <p className="text-base font-medium leading-snug">{spec.prompt}</p>

      {/* Instructions — format/constraints, secondary */}
      {spec.instructions && (
        <p className="text-sm text-muted-foreground">{spec.instructions}</p>
      )}

      {/* Employer skill signals */}
      {spec.employer_skill_signals && spec.employer_skill_signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Workplace skills:</span>
          {spec.employer_skill_signals.map((skill, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {skill}
            </Badge>
          ))}
        </div>
      )}

      {/* Professional quality checklist */}
      {spec.professional_quality_checklist && spec.professional_quality_checklist.length > 0 && (
        <div className="rounded-md bg-muted px-3 py-2">
          <p className="text-xs font-medium mb-1">For professional quality:</p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {spec.professional_quality_checklist.map((item, i) => (
              <li key={i}>• {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Helper buttons */}
      <div className="flex gap-2 border-t pt-3">
        {spec.scoring_rubric.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="cursor-pointer text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={() => setOpen('criteria')}>
            <ListChecksIcon />
            View criteria
          </Button>
        )}
        {spec.hints.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="cursor-pointer text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700" onClick={() => setOpen('hints')}>
            <LightbulbIcon />
            Need a hint?
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
                {open ? panelContent[open].title : ''}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <XIcon className="h-3.5 w-3.5" />
                  <span className="sr-only">Close</span>
                </Button>
              </Dialog.Close>
            </div>
            <ul className="space-y-2">
              {open && panelContent[open].items.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-0.5 shrink-0 font-medium text-foreground/40">{i + 1}.</span>
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
