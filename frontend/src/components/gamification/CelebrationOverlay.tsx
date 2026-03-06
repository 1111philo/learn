import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type CelebrationTier = 'activity' | 'lesson' | 'course';

interface CelebrationOverlayProps {
  tier: CelebrationTier;
  message: string;
  onDismiss?: () => void;
}

const TIER_CONFIG: Record<CelebrationTier, { duration: number; emoji: string; className: string }> = {
  activity: { duration: 2000, emoji: '', className: 'bg-green-50 border-green-200 text-green-800' },
  lesson: { duration: 3000, emoji: '', className: 'bg-primary/10 border-primary/30 text-primary' },
  course: { duration: 4000, emoji: '', className: 'bg-yellow-50 border-yellow-300 text-yellow-800' },
};

export function CelebrationOverlay({ tier, message, onDismiss }: CelebrationOverlayProps) {
  const [visible, setVisible] = useState(true);
  const config = TIER_CONFIG[tier];

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, config.duration);
    return () => clearTimeout(timer);
  }, [config.duration, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-lg border px-4 py-3 text-center text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300',
        config.className,
      )}
    >
      <p>{message}</p>
      {tier === 'lesson' && (
        <div className="mt-1 flex justify-center gap-1" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60"
              style={{ animationDelay: `${i * 100}ms`, animation: 'pulse 0.6s ease-in-out infinite alternate' }}
            />
          ))}
        </div>
      )}
      {tier === 'course' && (
        <div className="mt-2 flex justify-center gap-0.5" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) => (
            <span
              key={i}
              className="inline-block h-2 w-0.5 rounded-full bg-current"
              style={{
                animation: `confetti-rise 0.8s ease-out ${i * 60}ms both`,
                opacity: 0.5 + Math.random() * 0.5,
                transform: `rotate(${-30 + i * 5}deg)`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
