# Agent Lifecycle: Course Start to Completion

This documents every agent invocation as a learner moves through a course -- the order, what data goes in, what comes out, and what validation runs.

For the agent table and architecture overview, see [Architecture](architecture.md).

---

## Phase 0: Onboarding (one-time, before any course)

### 1. Onboarding Conversation Agent

| | |
|---|---|
| Prompt | [`onboarding-conversation.md`](../prompts/onboarding-conversation.md) |
| Model | `MODEL_LIGHT` |
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
| Trigger | Learner starts a course ([`unitEngine.initCourse`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.generateSummative()` |
| Validation | `validateSummative()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseName`, `courseDescription`
- `learningObjectives` -- flattened from all units in the course
- `learnerProfile` -- summary string
- `personalizationNotes` -- null on first generation; set if regenerated from rubric review feedback

**Output:**
```json
{
  "courseIntro": "1-2 sentences explaining the course and assessment-backward process",
  "summaryForLearner": "1-3 sentences: what they'll build, the tool, what mastery looks like",
  "task": { "description": "...", "tool": "...", "steps": [{ "instruction": "..." }] },
  "rubric": [{ "name": "...", "levels": { "incomplete": "...", "approaching": "...", "meets": "...", "exceeds": "..." } }],
  "exemplar": "1-3 sentences describing mastery-level work"
}
```

The learner sees `courseIntro` and `summaryForLearner` first. The rubric and detailed data surface through conversation.

---

## Phase 2: Rubric Review

### 3. Summative Rubric Review Agent

| | |
|---|---|
| Prompt | [`summative-conversation.md`](../prompts/summative-conversation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner reviews rubric/exemplar ([`unitEngine.sendRubricReviewMessage`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.converse('summative-conversation', messages)` |

**Input:** First message is a JSON context block containing the full summative (task, rubric, exemplar), courseName, learningObjectives, and learnerProfile. Then the conversation history + new user message.

**Output:** `{ message, done, regenerate?, regenerationNotes? }`

**Side effect:** If `regenerate: true`, re-runs [Agent #2](#2-summative-generation-agent) with `personalizationNotes` from the learner's feedback.

---

## Phase 3: Summative Attempt (baseline or retake)

### 4. Summative Assessment Agent

| | |
|---|---|
| Prompt | [`summative-assessment.md`](../prompts/summative-assessment.md) |
| Model | `MODEL_HEAVY` + vision |
| Trigger | Learner submits all step screenshots ([`unitEngine.submitSummativeAttempt`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.assessSummativeAttempt()` |
| Validation | `validateSummativeAssessment()` -- enforces ratchet rule |

**Input:**
- `courseName`, `task`, `rubric`
- `attemptNumber`, `isBaseline` flag
- `priorAttemptScores` -- null for baseline, latest scores for retake
- `learnerProfile`
- Base64 screenshot images -- one per step, labeled by step index

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

The learner sees `summaryForLearner` as the primary message. Detailed per-criterion breakdown is available on request.

**Ratchet rule:** Each criterion score must be >= the prior attempt's score for that criterion. This is enforced by the validator.

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

## Phase 4: Gap Analysis + Journey

### 6. Gap Analysis Agent

| | |
|---|---|
| Prompt | [`gap-analysis.md`](../prompts/gap-analysis.md) |
| Model | `MODEL_LIGHT` |
| Trigger | After baseline attempt ([`unitEngine.generateGapAndJourney`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.analyzeGaps()` |
| Validation | `validateGapAnalysis()` |

**Input:** `courseName`, `rubric`, `baselineScores` (per-criterion from attempt), `overallScore`, `learnerProfile`

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
- `units[]` -- predefined units from [`courses.json`](../data/courses.json) (unitId, name, description, learningObjectives, dependsOn)
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

## Phase 5: Formative Learning (per unit, per activity)

### 8. Activity Creation Agent (repeated per activity)

| | |
|---|---|
| Prompt | [`activity-creation.md`](../prompts/activity-creation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner enters a unit or advances ([`unitEngine.generateFirstActivity`](../src/lib/unitEngine.js) / `generateNextActivity`) |
| Function | `orchestrator.generateNextActivity()` |
| Validation | `validateActivity()` |

**Input:**
- Unit info (name, learningObjectives)
- Activity `type`/`goal` from the journey plan slot
- `rubricCriteria` -- which summative criteria this activity targets
- `gapObservation` -- what the learner was missing
- `workProduct`/`workProductTool` -- the single work product for the course
- `priorActivities` -- summary of completed activities with best scores
- `learnerProfile`
- **Summative context:** `exemplar`, `summativeTask` (description), full `rubric` -- so activities build toward the exemplar

**Output:** `{ instruction, tips[] }`

### 9. Activity Assessment Agent (repeated per capture)

| | |
|---|---|
| Prompt | [`activity-assessment.md`](../prompts/activity-assessment.md) |
| Model | `MODEL_HEAVY` + vision |
| Trigger | Learner hits "Capture" ([`unitEngine.recordDraft`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.assessDraft()` |
| Validation | `validateAssessment()` |

**Input:** Unit/activity info, `rubricCriteria`, `pageUrl`, `priorDrafts` (score/feedback/recommendation), `learnerProfile`, base64 screenshot

**Output:** `{ feedback, strengths[], improvements[], score, recommendation, passed, rubricCriteriaScores? }`

### 10. Learner Profile Agent (background, repeated)

Same as [Agent #5](#5-learner-profile-agent-background), triggered after every formative assessment and after disputes.

### 11. Activity Q&A (inline, ad-hoc)

| | |
|---|---|
| Prompt | *Inline system prompt* (no prompt file) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner asks a question via compose bar ([`unitEngine.askAboutActivity`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.chatWithContext()` |

**Input (inline system prompt):** Activity instruction, rubric criteria, summative exemplar, latest draft feedback + rubric criteria scores, learner profile, Q&A message history.

**Output:** Plain text response (not JSON).

### 12. Reassessment (on dispute)

| | |
|---|---|
| Prompt | Same [`activity-assessment.md`](../prompts/activity-assessment.md) |
| Model | `MODEL_HEAVY` + vision |
| Trigger | Learner disputes a score ([`unitEngine.submitDispute`](../src/lib/unitEngine.js)) |
| Function | `orchestrator.reassessDraft()` |

**Input:** 3-message conversation:
1. Original assessment context + screenshot (user message)
2. Assistant's previous assessment (injected as assistant message)
3. Learner's dispute text (user message)

---

## Phase 6: Summative Retake

Repeats [Agent #4](#4-summative-assessment-agent) (Summative Assessment) and [Agent #5](#5-learner-profile-agent-background) (Profile Update). The ratchet rule is enforced.

- If mastery achieved → course complete → [Phase 7](#phase-7-course-mastery)
- If not mastery → re-runs [Agent #6](#6-gap-analysis-agent) (Gap Analysis) + [Agent #7](#7-journey-generation-agent) (Journey) with `completedFormatives` populated so it doesn't repeat activities → back to [Phase 5](#phase-5-formative-learning-per-unit-per-activity)

---

## Phase 7: Course Mastery

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
Summative Rubric ─── Gap Analysis ─── Journey ─── Activity Creation (rubricCriteria)
         │                                              │
         │                                    Activity Assessment (rubricCriteriaScores)
         │
    Exemplar ──────── Activity Creation ──── Activity Q&A context
```

- The **learner profile summary** is passed as context to every agent call.
- The **summative rubric** flows through: gap analysis → journey generation → activity creation (as `rubricCriteria` per activity) → formative assessment (as `rubricCriteriaScores`).
- The **exemplar** flows from summative generation → activity creation → Q&A context, ensuring all formative work builds toward the same mastery target.
