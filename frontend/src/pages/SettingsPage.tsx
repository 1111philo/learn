import { useEffect, useState } from 'react';
import { getProfile, updateProfile, type ProfileData, type ProfileUpdateData } from '@/api/profile';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const LEARNING_STYLES = ['visual', 'reading', 'hands-on', 'mixed'];
const TONE_PREFERENCES = ['formal', 'casual', 'encouraging'];

export function SettingsPage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [displayName, setDisplayName] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [learningStyle, setLearningStyle] = useState('');
  const [tonePreference, setTonePreference] = useState('');
  const [learningGoals, setLearningGoals] = useState('');
  const [interests, setInterests] = useState('');

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p);
        setDisplayName(p.display_name ?? '');
        setExperienceLevel(p.experience_level ?? '');
        setLearningStyle(p.learning_style ?? '');
        setTonePreference(p.tone_preference ?? '');
        setLearningGoals(p.learning_goals.join(', '));
        setInterests(p.interests.join(', '));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    const data: ProfileUpdateData = {
      display_name: displayName || null,
      experience_level: experienceLevel || null,
      learning_style: learningStyle || null,
      tone_preference: tonePreference || null,
      learning_goals: learningGoals
        ? learningGoals.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      interests: interests
        ? interests.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    };

    try {
      const updated = await updateProfile(data);
      setProfile(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading profile...
      </div>
    );
  }

  if (!profile) {
    return <p className="text-destructive">{error ?? 'Failed to load profile'}</p>;
  }

  const inputClass =
    'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Profile Settings</h1>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="display-name" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputClass}
            placeholder="Your name"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="experience-level" className="text-sm font-medium">
            Experience level
          </label>
          <select
            id="experience-level"
            value={experienceLevel}
            onChange={(e) => setExperienceLevel(e.target.value)}
            className={inputClass}
          >
            <option value="">Select...</option>
            {EXPERIENCE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="learning-style" className="text-sm font-medium">
            Learning style
          </label>
          <select
            id="learning-style"
            value={learningStyle}
            onChange={(e) => setLearningStyle(e.target.value)}
            className={inputClass}
          >
            <option value="">Select...</option>
            {LEARNING_STYLES.map((style) => (
              <option key={style} value={style}>
                {style.charAt(0).toUpperCase() + style.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="tone-preference" className="text-sm font-medium">
            Tone preference
          </label>
          <select
            id="tone-preference"
            value={tonePreference}
            onChange={(e) => setTonePreference(e.target.value)}
            className={inputClass}
          >
            <option value="">Select...</option>
            {TONE_PREFERENCES.map((tone) => (
              <option key={tone} value={tone}>
                {tone.charAt(0).toUpperCase() + tone.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="learning-goals" className="text-sm font-medium">
            Learning goals
          </label>
          <input
            id="learning-goals"
            type="text"
            value={learningGoals}
            onChange={(e) => setLearningGoals(e.target.value)}
            className={inputClass}
            placeholder="e.g., Master React, Learn system design"
          />
          <p className="text-xs text-muted-foreground">Comma-separated</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="interests" className="text-sm font-medium">
            Interests
          </label>
          <input
            id="interests"
            type="text"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            className={inputClass}
            placeholder="e.g., frontend, a11y, machine learning"
          />
          <p className="text-xs text-muted-foreground">Comma-separated</p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {success && (
            <span className="text-sm text-green-600">Profile updated</span>
          )}
          {error && (
            <span className="text-sm text-destructive">{error}</span>
          )}
        </div>
      </form>
    </div>
  );
}
