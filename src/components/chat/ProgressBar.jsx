import { COURSE_PHASES } from '../../lib/constants.js';

/**
 * Segmented progress bar for the course header.
 * Before journey: [Intro] [Diagnostic] [Learning]
 * After journey: [Intro] [Diagnostic] [Unit 1] ... [Unit N] [Retake]
 */
export default function ProgressBar({ phase, journey, allProgress }) {
  // Build segments
  const segments = [
    { id: 'intro', label: 'Intro', phases: [COURSE_PHASES.COURSE_INTRO] },
    { id: 'diagnostic', label: 'Diagnostic', phases: [COURSE_PHASES.BASELINE_ATTEMPT, COURSE_PHASES.BASELINE_RESULTS] },
  ];

  const journeyUnits = journey?.plan?.units || [];
  if (journeyUnits.length > 0) {
    for (const ju of journeyUnits) {
      segments.push({ id: ju.unitId, label: '', phases: [] });
    }
    segments.push({ id: 'retake', label: 'Retake', phases: [COURSE_PHASES.RETAKE_READY, COURSE_PHASES.SUMMATIVE_RETAKE] });
  } else {
    segments.push({ id: 'learning', label: 'Learning', phases: [COURSE_PHASES.FORMATIVE_LEARNING] });
  }

  // Determine segment states
  const PHASE_ORDER = [
    COURSE_PHASES.COURSE_INTRO,
    COURSE_PHASES.BASELINE_ATTEMPT, COURSE_PHASES.BASELINE_RESULTS,
    COURSE_PHASES.GAP_ANALYSIS, COURSE_PHASES.JOURNEY_GENERATION, COURSE_PHASES.JOURNEY_OVERVIEW,
    COURSE_PHASES.FORMATIVE_LEARNING,
    COURSE_PHASES.RETAKE_READY, COURSE_PHASES.SUMMATIVE_RETAKE,
    COURSE_PHASES.COMPLETED,
  ];
  const currentPhaseIndex = PHASE_ORDER.indexOf(phase);

  function getSegmentState(seg, idx) {
    // Unit segments during formative learning
    if (journeyUnits.length > 0 && idx >= 2 && idx < 2 + journeyUnits.length) {
      const ju = journeyUnits[idx - 2];
      const prog = allProgress?.[ju.unitId];
      if (prog?.status === 'completed') return 'completed';
      if (prog?.status === 'in_progress') return 'active';
      // If we're past formative learning, all units are complete
      if (currentPhaseIndex > PHASE_ORDER.indexOf(COURSE_PHASES.FORMATIVE_LEARNING)) return 'completed';
      return 'upcoming';
    }

    // Standard phase segments
    const segPhaseIndices = seg.phases.map(p => PHASE_ORDER.indexOf(p));
    const maxSegPhase = Math.max(...segPhaseIndices);
    const minSegPhase = Math.min(...segPhaseIndices);

    if (currentPhaseIndex > maxSegPhase) return 'completed';
    if (currentPhaseIndex >= minSegPhase) return 'active';
    return 'upcoming';
  }

  return (
    <div className="progress-bar" role="progressbar" aria-label="Course progress">
      {segments.map((seg, i) => {
        const state = getSegmentState(seg, i);
        return (
          <div
            key={seg.id}
            className={`progress-segment progress-${state}`}
            title={seg.label || seg.id}
          />
        );
      })}
    </div>
  );
}
