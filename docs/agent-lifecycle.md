# Agent Lifecycle: Course Start to Completion

This documents every agent invocation as a learner moves through a course -- the order, what data goes in, what comes out, and what validation runs.

For the agent table and architecture overview, see [Architecture](architecture.md).

---

## Phase 0: Onboarding (one-time, before any course)

### 1. Onboarding Conversation Agent

| | |
|---|---|
| Prompt | [`onboarding-conversation.md`](../prompts/onboarding-conversation.md) |
| Model | `MODEL_HEAVY` + vision |
| Trigger | "About You" step in onboarding wizard ([`AboutYouStep.jsx`](../src/pages/onboarding/AboutYouStep.jsx)) |
| Function | `orchestrator.converse('onboarding-conversation', messages)` |

**Input:** Multi-turn message history with learner screenshots (vision-capable -- the learner captures screenshots of their existing online work).

**Output:** `{ message, done, profile?, summary? }` -- when `done: true`, includes a full learner profile inferred from screenshots.

**Fallback:** If the learner skips, the **Onboarding Profile Agent** ([`onboarding-profile.md`](../prompts/onboarding-profile.md)) creates a profile from `{ name, statement }` via `orchestrator.initializeLearnerProfile()`.

---

## Phase 1: Summative Generation

### 2. Summative Generation Agent

| | |
|---|---|
| Prompt | [`summative-generation.md`](../prompts/summative-generation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner starts a course ([`courseEngine.initCourse`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.generateSummative()` |
| Validation | `validateSummative()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseName`, `courseDescription`
- `learningObjectives` -- flattened from all units in the course
- `unitExemplars` -- per-unit `{ unitId, name, format, exemplar }` from [`courses.json`](../data/courses.json)
- `learnerProfile` -- summary string

**Output:**
```json
{
  "courseIntro": "1-2 sentences explaining the course and assessment-backward process",
  "summaryForLearner": "1-3 sentences: what they'll demonstrate, what mastery looks like",
  "task": {
    "description": "...",
    "tool": "...",
    "steps": [{ "instruction": "...", "format": "screenshot|text" }]
  },
  "rubric": [{ "name": "...", "levels": { "incomplete": "...", "approaching": "...", "meets": "...", "exceeds": "..." } }],
  "exemplar": "1-3 sentences describing mastery-level work"
}
```

Each step has a `format` field ("screenshot" or "text") determined by the unit exemplars. The rubric is **FIXED** once generated — it cannot be changed.

---

## Phase 2: Course Intro (orientation checkpoint)

### 3. Guide Agent

| | |
|---|---|
| Prompt | [`guide.md`](../prompts/guide.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Phase transitions to `course_intro` ([`CourseChat.jsx`](../src/pages/CourseChat.jsx)) |
| Function | `courseEngine.callGuide()` → `orchestrator.converse('guide', messages)` |

**Input:** `{ checkpoint: "course_intro", courseName, learnerProfile, rubricCriteria, exemplar }`

**Output:** `{ message }` -- personalized 2-3 sentence greeting framing the diagnostic as low-stakes.

The learner sees the guide's message alongside the rubric/exemplar (SummativeCard). They can ask follow-up questions via the compose bar (multi-turn via `converse`). Clicking "Start Diagnostic Assessment" advances to the baseline attempt.

---

## Phase 3: Summative Attempt (baseline or retake)

### 4. Summative Assessment Agent

| | |
|---|---|
| Prompt | [`summative-assessment.md`](../prompts/summative-assessment.md) |
| Model | `MODEL_HEAVY` (screenshots) / `MODEL_LIGHT` (text-only) |
| Trigger | Learner submits all steps ([`courseEngine.submitSummativeAttempt`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.assessSummativeAttempt()` |
| Validation | `validateSummativeAssessment()` -- enforces ratchet rule |

**Input:**
- `courseName`, `task`, `rubric`
- `attemptNumber`, `isBaseline` flag
- `priorAttemptScores` -- null for baseline, latest scores for retake
- `learnerProfile`
- Screenshots (base64 images, one per screenshot-format step)
- Text responses (one per text-format step)

**Output:**
```json
{
  "criteriaScores": [{ "criterion": "...", "level": "approaching", "score": 0.45, "feedback": "..." }],
  "overallScore": 0.55,
  "mastery": false,
  "feedback": "Overall assessment summary",
  "nextSteps": ["Specific improvement suggestion"],
  "summaryForLearner": "Plain-language summary of how it went"
}
```

**Ratchet rule:** Each criterion score must be >= the prior attempt's score. Enforced by the validator.

### 5. Learner Profile Agent (background)

| | |
|---|---|
| Prompt | [`learner-profile-update.md`](../prompts/learner-profile-update.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Fires automatically after every summative attempt |
| Function | `orchestrator.updateProfileOnSummativeAttempt()` |

**Input:** `currentProfile`, `summativeAttempt` (courseId, scores, mastery), `context.event` (`summative_baseline` | `summative_retake` | `summative_mastery`)

**Output:** Updated `{ profile, summary }`

---

## Phase 4: Baseline Results (orientation checkpoint)

### Guide Agent (checkpoint: `baseline_results`)

After the baseline attempt scores come back, the Guide Agent appears with a personalized message framing the results as a starting point. The learner sees their per-criterion scores (RubricFeedback) and can ask questions. Clicking "Build My Learning Path" triggers gap analysis + journey generation.

---

## Phase 5: Gap Analysis + Journey

### 6. Gap Analysis Agent

| | |
|---|---|
| Prompt | [`gap-analysis.md`](../prompts/gap-analysis.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner clicks "Build My Learning Path" ([`courseEngine.generateGapAndJourney`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.analyzeGaps()` |
| Validation | `validateGapAnalysis()` |

**Input:** `courseName`, `rubric`, `baselineScores` (per-criterion), `overallScore`, `learnerProfile`

**Output:**
```json
{
  "gaps": [{ "criterion": "...", "currentLevel": "approaching", "targetLevel": "meets", "priority": "high", "observation": "..." }],
  "suggestedFocus": ["Theme grouping related gaps"]
}
```

### 7. Journey Generation Agent

| | |
|---|---|
| Prompt | [`course-creation.md`](../prompts/course-creation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Runs immediately after gap analysis |
| Function | `orchestrator.generateJourney()` |
| Validation | `validateJourney()` |

**Input:**
- `courseName`
- `units[]` -- predefined units from [`courses.json`](../data/courses.json) (unitId, name, description, learningObjectives, dependsOn, format, exemplar)
- `gapAnalysis` -- from Agent #6
- `rubric` -- the summative rubric
- `learnerProfile`
- `completedFormatives` -- empty on first journey; populated on remediation (after failed retake)

**Output:**
```json
{
  "units": [{ "unitId": "...", "activities": [{ "id": "...", "type": "explore", "goal": "...", "rubricCriteria": ["..."] }] }],
  "workProductTool": "Google Doc",
  "workProductDescription": "Professional Portfolio",
  "rationale": "Brief explanation of journey design choices"
}
```

---

## Phase 6: Journey Overview (orientation checkpoint)

### Guide Agent (checkpoint: `journey_overview`)

After the journey is generated, the Guide Agent appears with a brief overview of the personalized learning path. The learner can ask questions. Clicking "Start Learning" advances to formative learning — all activities flow inline in the chat.

---

## Phase 7: Formative Learning (per unit, per activity)

### 8. Activity Creation Agent (repeated per activity)

| | |
|---|---|
| Prompt | [`activity-creation.md`](../prompts/activity-creation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner enters a unit or advances ([`courseEngine.generateFirstActivity`](../src/lib/courseEngine.js) / `generateNextActivity`) |
| Function | `orchestrator.generateNextActivity()` |
| Validation | `validateActivity()` with `{ format }` |

**Input:**
- Unit info (name, learningObjectives, format, exemplar)
- Activity `type`/`goal` from the journey plan slot
- `format` -- "screenshot" or "text" (from unit definition)
- `rubricCriteria` -- which summative criteria this activity targets
- `gapObservation` -- what the learner was missing
- `workProduct`/`workProductTool` -- the single work product (screenshot-format units only)
- `priorActivities` -- summary of completed activities with best scores
- `learnerProfile`
- **Summative context:** `unitExemplar`, `exemplar`, `summativeTask`, full `rubric`

**Output:** `{ instruction, tips[] }`

Screenshot-format activities end with "Hit Capture to capture your screen." Text-format activities end with "Hit Submit to submit your response." Both capture and text submission are always available to the learner regardless of format.

### 9. Activity Assessment Agent (repeated per submission)

| | |
|---|---|
| Prompt | [`activity-assessment.md`](../prompts/activity-assessment.md) |
| Model | `MODEL_HEAVY` (screenshots) / `MODEL_LIGHT` (text) |
| Trigger | Learner captures screenshot ([`courseEngine.recordDraft`](../src/lib/courseEngine.js)) or submits text ([`courseEngine.recordTextDraft`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.assessDraft()` |
| Validation | `validateAssessment()` |

**Input:** Unit/activity info, `rubricCriteria`, `pageUrl`, `priorDrafts` (score/feedback/recommendation), `learnerProfile`, base64 screenshot OR text response

**Output:** `{ feedback, strengths[], improvements[], score, recommendation, passed, rubricCriteriaScores? }`

### 10. Learner Profile Agent (background, repeated)

Same as [Agent #5](#5-learner-profile-agent-background), triggered after every formative assessment and after disputes.

### 11. Activity Q&A (inline, ad-hoc)

| | |
|---|---|
| Prompt | *Inline system prompt* (no prompt file) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner asks a question via compose bar ([`courseEngine.askAboutActivity`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.chatWithContext()` |

**Input (inline system prompt):** Activity instruction, rubric criteria, summative exemplar, latest draft feedback + rubric criteria scores, learner profile, Q&A message history.

**Output:** Plain text response (not JSON).

### 12. Reassessment (on dispute)

| | |
|---|---|
| Prompt | Same [`activity-assessment.md`](../prompts/activity-assessment.md) |
| Model | `MODEL_HEAVY` (screenshots) / `MODEL_LIGHT` (text) |
| Trigger | Learner disputes a score ([`courseEngine.submitDispute`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.reassessDraft()` |

**Input:** 3-message conversation:
1. Original assessment context + screenshot/text (user message)
2. Assistant's previous assessment (injected as assistant message)
3. Learner's dispute text (user message)

---

## Phase 8: Retake Ready (orientation checkpoint)

### Guide Agent (checkpoint: `retake_ready`)

After completing formative activities, the learner sees the Guide Agent with encouragement and a reminder that scores can only go up (ratchet rule). They can ask questions. Clicking "Start Assessment" advances to the summative retake.

---

## Phase 9: Summative Retake

Repeats [Agent #4](#4-summative-assessment-agent) (Summative Assessment) and [Agent #5](#5-learner-profile-agent-background) (Profile Update). The ratchet rule is enforced.

- If mastery achieved → course complete → [Phase 10](#phase-10-course-mastery)
- If not mastery → re-runs [Agent #6](#6-gap-analysis-agent) (Gap Analysis) + [Agent #7](#7-journey-generation-agent) (Journey) with `completedFormatives` populated so it doesn't repeat activities → back to [Journey Overview](#phase-6-journey-overview-orientation-checkpoint) with remediation units

---

## Phase 10: Course Mastery

### 13. Learner Profile Agent -- Mastery Update

| | |
|---|---|
| Prompt | [`learner-profile-update.md`](../prompts/learner-profile-update.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Summative returns `mastery: true` |
| Function | `orchestrator.updateProfileOnMastery()` |

**Input:** `currentProfile`, `courseCompletion` (courseId, courseName, rubric criteria scores, overall score, formative summaries), `context.event: 'course_mastery'`

**Output:** Updated profile with courseId in `masteredCourses`, comprehensive strength updates, contradicted weaknesses removed.

---

## Data flow

```
Learner Profile ──────────────────────── threads through every agent call
         │
Guide Agent ──── appears at checkpoints (course_intro, baseline_results,
         │       journey_overview, retake_ready) with personalized context
         │
Summative Rubric ─── Gap Analysis ─── Journey ─── Activity Creation (rubricCriteria)
         │                                              │
         │                                    Activity Assessment (rubricCriteriaScores)
         │
Unit Exemplars ─── Summative Generation ─── Activity Creation ─── Activity Q&A
         │
   Unit Formats ─── Activity Creation (screenshot vs text ending)
                 ─── Activity Assessment (vision vs text model)
```

- The **learner profile summary** is passed as context to every agent call.
- The **Guide Agent** receives phase-specific context (scores, journey, rubric) at each orientation checkpoint and generates personalized orientation messages.
- The **summative rubric** flows through: gap analysis → journey generation → activity creation (as `rubricCriteria` per activity) → formative assessment (as `rubricCriteriaScores`). The rubric is FIXED once generated.
- The **unit exemplars** flow from courses.json → summative generation → activity creation, ensuring all work builds toward mastery-level outcomes.
- The **unit format** ("text" or "screenshot") determines: how activities end (Capture vs Submit), which model assesses (Heavy vs Light), and how submissions are stored (IndexedDB vs SQLite).
