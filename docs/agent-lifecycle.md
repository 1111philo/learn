# Agent Lifecycle: Exemplar-Driven Learning Loop

This documents every agent invocation as a learner moves through a course -- the order, what data goes in, what comes out, and what validation runs.

For the agent table and architecture overview, see [Architecture](architecture.md).

---

## Phase 1: Course Start

When a learner starts a course, three agents fire in sequence: Course Owner, Guide, and Activity Creator.

### 1. Course Owner Agent

| | |
|---|---|
| Prompt | [`course-owner.md`](../prompts/course-owner.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner opens a course for the first time ([`courseEngine.startCourse`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.initializeCourseKB()` |
| Validation | `validateCourseKB()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseId`, `courseName`, `courseDescription`
- `exemplar` -- from the course prompt markdown file
- `learningObjectives[]` -- from the course prompt
- `learnerProfile` -- summary string (or "New learner, no profile yet.")

**Output:**
```json
{
  "exemplar": "Full exemplar description",
  "objectives": [
    { "objective": "Can identify interests...", "evidence": "What demonstrates this objective" }
  ],
  "learnerPosition": "New learner beginning the course",
  "insights": [],
  "activitiesCompleted": 0,
  "status": "active"
}
```

The course KB is saved to the `course_kbs` table and synced as `courseKB:{courseId}`.

### 2. Guide Agent (course start)

| | |
|---|---|
| Prompt | [`guide.md`](../prompts/guide.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Fires immediately after Course Owner |
| Function | `courseEngine.callGuide()` → `orchestrator.converseStream('guide', messages)` |

**Input:** `{ checkpoint: "course_start", courseName, courseDescription, exemplar, learnerProfile, learnerPosition, activitiesCompleted }`

**Output:** Plain text (streamed token by token). The guide's system prompt includes the program knowledge base (`data/knowledge-base.md`).

The learner sees the guide's welcome message streamed in real time.

### 3. Activity Creator Agent

| | |
|---|---|
| Prompt | [`activity-creation.md`](../prompts/activity-creation.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Fires immediately after Guide |
| Function | `orchestrator.createActivity()` |
| Validation | `validateActivity()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseKB` -- exemplar, objectives, insights, learnerPosition, activitiesCompleted
- `learnerProfile` -- summary string
- `activityNumber` -- 1 (first activity)
- `priorActivities` -- "None" (no prior activities yet)

**Output:**
```json
{
  "instruction": "1. Go to wordpress.org/playground...\n2. Create a new page...\n3. Write your professional identity statement...\n4. Hit Capture to capture your screen.",
  "tips": ["Focus on authentic voice rather than formal language", "Include specific examples from your experience"]
}
```

The activity is saved to the `activities` table and an activity KB is created in `activity_kbs`. The instruction appears as an `InstructionMessage` in the chat.

---

## Phase 2: Learning Loop

The core loop repeats: learner submits → assessor evaluates → KB enriches → next activity (or complete).

### 4. Activity Assessor Agent (repeated per submission)

| | |
|---|---|
| Prompt | [`activity-assessment.md`](../prompts/activity-assessment.md) |
| Model | `MODEL_HEAVY` (screenshots) / `MODEL_LIGHT` (text) |
| Trigger | Learner submits work ([`courseEngine.handleSubmission`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.assessSubmission()` |
| Validation | `validateAssessment()` in [`validators.js`](../js/validators.js) |

**Input:**
- `courseKB` -- exemplar, objectives, insights, learnerPosition, activitiesCompleted
- `activityInstruction` -- the current activity's instruction text
- `priorAttempts[]` -- previous attempts on this activity (demonstrates, strengths, moved, needed)
- `learnerProfile` -- summary string
- Screenshot (base64 image) and/or text response

**Output:**
```json
{
  "achieved": false,
  "demonstrates": "The learner has created a WordPress page with a professional identity statement that includes personal values and career goals.",
  "strengths": ["Clear articulation of values", "Authentic personal voice"],
  "moved": "From no professional statement to a draft that captures key identity elements",
  "needed": "The statement needs to connect interests to specific professional goals and include technology perspective",
  "courseKBUpdate": {
    "insights": ["Learner writes authentically but needs prompting to connect personal to professional", "Strong self-awareness of values"],
    "learnerPosition": "Has drafted an identity statement; needs to deepen professional connections and add technology perspective"
  }
}
```

**After assessment, three things happen:**

1. **Draft saved** -- the assessment result is stored in the `drafts` table with `achieved`, `demonstrates`, `moved`, `needed`, `strengths`
2. **Activity KB updated** -- the attempt is appended to the activity KB's `attempts[]` array
3. **Course KB enriched** -- `updateCourseKBFromAssessment()` in [`courseOwner.js`](../js/courseOwner.js) merges `courseKBUpdate.insights` and `courseKBUpdate.learnerPosition` into the course KB, increments `activitiesCompleted`

### 5. Learner Profile Owner -- Incremental Update (code, no LLM)

| | |
|---|---|
| Model | None (code only) |
| Trigger | Fires automatically after every assessment |
| Function | `orchestrator.incrementalProfileUpdate()` via `profileQueue.updateProfileInBackground()` |

**Input:** `profile`, `courseId`, `assessmentResult`

**Output:** Updated profile with `activeCourses` tracked and `latestStrengths` updated.

This is a lightweight code-level update -- no LLM call. It runs through the sequential profile queue to prevent race conditions.

### 6. Activity Creator Agent (repeated)

Same as [Agent #3](#3-activity-creator-agent), but now with enriched context:

- `courseKB` -- contains accumulated `insights[]` and updated `learnerPosition` from all prior assessments
- `activityNumber` -- incremented
- `priorActivities` -- summary of all completed activities with their assessment results

Because the course KB grows with each assessment, each successive activity is more precisely tuned to the learner's demonstrated abilities and gaps.

**If `achieved: true`** in the assessment, the loop exits and moves to Phase 3 (Completion).

---

## Phase 3: Course Completion

When the Assessor returns `achieved: true`, the learner has demonstrated the exemplar.

### 7. Guide Agent (course complete)

| | |
|---|---|
| Prompt | [`guide.md`](../prompts/guide.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Assessment returns `achieved: true` |
| Function | `courseEngine.callGuide()` with checkpoint `"course_complete"` |

**Output:** Plain text celebration message, streamed to the learner.

### 8. Learner Profile Owner -- Deep Update (LLM)

| | |
|---|---|
| Prompt | [`learner-profile-owner.md`](../prompts/learner-profile-owner.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Course completed (`achieved: true`) |
| Function | `orchestrator.updateProfileOnCompletion()` via `profileQueue.updateProfileOnCompletionInBackground()` |

**Input:** `currentProfile`, `courseKB` (full enriched KB), `courseName`, `courseId`, `activitiesCompleted`

**Output:** `{ profile, summary }` -- comprehensive profile update reflecting all skills demonstrated throughout the course. Adds courseId to `masteredCourses`, updates strengths/weaknesses based on the full course KB.

The course KB status is set to `"completed"`.

---

## Ad-hoc: Guide Q&A

| | |
|---|---|
| Prompt | [`guide.md`](../prompts/guide.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner sends a message via the compose bar ([`courseEngine.askGuide`](../src/lib/courseEngine.js)) |
| Function | `orchestrator.converseStream('guide', messages)` |

**Input:** Recent conversation tail (last 10 messages) + the learner's question, with course KB context (exemplar, learner position, activities completed).

**Output:** Plain text response (streamed).

---

## Ad-hoc: Profile Feedback

| | |
|---|---|
| Prompt | [`learner-profile-update.md`](../prompts/learner-profile-update.md) |
| Model | `MODEL_LIGHT` |
| Trigger | Learner submits feedback in Settings |
| Function | `orchestrator.updateProfileFromFeedback()` via `profileQueue.updateProfileFromFeedbackInBackground()` |

**Input:** `currentProfile`, `learnerFeedback` text, `context` (courseName, activityType, activityGoal)

**Output:** `{ profile, summary }` -- updated profile incorporating the feedback.

---

## Data flow summary

```
Course Prompt (.md)
       │
  Course Owner ──→ Course KB (initialized)
       │                 │
     Guide        Activity Creator ←── reads enriched KB
       │                 │
  Welcome msg      Activity instruction
                         │
                   Learner submits
                         │
                   Activity Assessor
                    │           │
              courseKBUpdate   Draft saved
                    │           │
              KB enriched    Profile incremental update (code)
                    │
              ┌─────┴─────┐
              │            │
        not achieved    achieved
              │            │
        Next activity   Guide celebrates
        (enriched KB)   Profile deep update (LLM)
                        Course complete
```
