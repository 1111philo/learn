import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface SubmissionFormProps {
  onSubmit: (text: string) => Promise<void>;
}

export function SubmissionForm({ onSubmit }: SubmissionFormProps) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(text.trim());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="activity-response" className="sr-only">
        Your response
      </label>
      <Textarea
        id="activity-response"
        placeholder="Type your response..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={submitting}
        aria-label="Your response"
      />
      <Button
        type="submit"
        disabled={submitting || !text.trim()}
        aria-busy={submitting}
      >
        {submitting ? 'Submitting...' : 'Submit'}
      </Button>
    </form>
  );
}
