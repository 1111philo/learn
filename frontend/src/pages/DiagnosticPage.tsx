import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getDiagnostic, submitDiagnostic } from '@/api/diagnostics';
import type { DiagnosticSpec } from '@/api/types';

export function DiagnosticPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [spec, setSpec] = useState<DiagnosticSpec | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) return;
    getDiagnostic(courseId)
      .then(({ diagnostic_spec }) => {
        if (diagnostic_spec) {
          setSpec(diagnostic_spec);
          setAnswers(new Array(diagnostic_spec.questions.length).fill(''));
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load diagnostic questions.');
        setLoading(false);
      });
  }, [courseId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!courseId || !spec) return;
    setSubmitting(true);
    setError(null);
    try {
      const responses = spec.questions.map((q, i) => ({
        question: q.question,
        answer: answers[i],
      }));
      await submitDiagnostic(courseId, responses);
      navigate(`/courses/${courseId}/generate`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Preparing Your Course</h1>
        <p className="text-muted-foreground">Loading diagnostic questions...</p>
      </div>
    );
  }

  const allAnswered = answers.every((a) => a.trim().length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Before We Begin</h1>
        <p className="text-muted-foreground">
          Answer a few questions so we can tailor this course to your background and experience level.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {spec?.questions.map((q, i) => (
          <div key={i} className="space-y-2">
            <label className="text-sm font-medium">
              {i + 1}. {q.question}
            </label>
            <Textarea
              value={answers[i]}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
              rows={3}
              placeholder="Your answer..."
            />
          </div>
        ))}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          type="submit"
          disabled={submitting || !allAnswered}
          className="w-full"
        >
          {submitting ? 'Analyzing your responses...' : 'Begin Course'}
        </Button>
      </form>
    </div>
  );
}
