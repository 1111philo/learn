import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AssessmentSpec } from '@/api/types';

interface AssessmentFormProps {
  spec: AssessmentSpec;
  onSubmit: (responses: { objective: string; text: string }[]) => Promise<void>;
}

export function AssessmentForm({ spec, onSubmit }: AssessmentFormProps) {
  const [answers, setAnswers] = useState<Record<number, string>>(
    () => Object.fromEntries(spec.items.map((_, i) => [i, ''])),
  );
  const [submitting, setSubmitting] = useState(false);

  function update(i: number, text: string) {
    setAnswers((a) => ({ ...a, [i]: text }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const responses = spec.items.map((item, i) => ({
      objective: item.objective,
      text: answers[i]?.trim() ?? '',
    }));
    if (responses.some((r) => !r.text)) return;
    setSubmitting(true);
    try {
      await onSubmit(responses);
    } finally {
      setSubmitting(false);
    }
  }

  const allFilled = spec.items.every((_, i) => answers[i]?.trim());

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-lg font-semibold">{spec.assessment_title}</h2>
      {spec.items.map((item, i) => (
        <div key={i} className="space-y-2">
          <label htmlFor={`assessment-answer-${i}`} className="text-sm font-medium">
            {i + 1}. {item.objective}
          </label>
          <div className="rounded-md bg-muted p-3">
            <p className="text-sm">{item.prompt}</p>
          </div>
          <Textarea
            id={`assessment-answer-${i}`}
            placeholder="Your answer..."
            value={answers[i] ?? ''}
            onChange={(e) => update(i, e.target.value)}
            rows={4}
            disabled={submitting}
            aria-label={`Answer for: ${item.objective}`}
          />
        </div>
      ))}
      <Button type="submit" disabled={submitting || !allFilled} aria-busy={submitting} className="w-full">
        {submitting ? 'Submitting...' : 'Submit Assessment'}
      </Button>
    </form>
  );
}
