# Architecture

1111 Learn is a Chrome extension (Manifest V3) that runs in the side panel. The UI is a React 18 app built with Vite. Service modules are vanilla JS (ES modules) in `js/`, imported by React components in `src/`.

## Agents

Ten agents drive the learning experience. Each loads a system prompt from `prompts/*.md` and returns structured JSON validated by `js/validators.js`.

| Agent | Prompt | Model | Purpose |
|-------|--------|-------|---------|
| Onboarding Conversation | [`onboarding-conversation.md`](../prompts/onboarding-conversation.md) | Heavy + vision | Multi-turn chat that builds a learner profile from screenshots |
| Onboarding Profile | [`onboarding-profile.md`](../prompts/onboarding-profile.md) | Light | Creates a profile from name + statement (fallback when conversation is skipped) |
| Summative Generation | [`summative-generation.md`](../prompts/summative-generation.md) | Light | Generates the summative assessment: task (with per-step format), rubric, exemplar, and learner-facing intro/summary from unit exemplars and formats |
| Guide | [`guide.md`](../prompts/guide.md) | Light | Appears at orientation checkpoints to orient the learner, explain what's next, and answer questions |
| Summative Assessment | [`summative-assessment.md`](../prompts/summative-assessment.md) | Heavy (screenshots) / Light (text) | Scores summative submissions (screenshots and/or text) against rubric criteria; produces learner summary |
| Gap Analysis | [`gap-analysis.md`](../prompts/gap-analysis.md) | Light | Identifies per-criterion gaps from baseline summative attempt |
| Journey Generation | [`course-creation.md`](../prompts/course-creation.md) | Light | Selects, orders, and sizes units with formative activities mapped to rubric criteria; respects unit formats and exemplars |
| Activity Creation | [`activity-creation.md`](../prompts/activity-creation.md) | Light | Generates one formative activity targeting specific rubric criteria; format-aware (screenshot ends with "Capture", text ends with "Submit") |
| Activity Assessment | [`activity-assessment.md`](../prompts/activity-assessment.md) | Heavy (screenshots) / Light (text) | Evaluates formative submissions with structured feedback and optional rubric scoring |
| Activity Q&A | *inline* | Light | Answers learner questions with enriched context (exemplar, rubric, latest scores) |
| Learner Profile | [`learner-profile-update.md`](../prompts/learner-profile-update.md) | Light | Updates learner profile after assessments, feedback, and mastery |

`MODEL_LIGHT` = `claude-haiku-4-5`. `MODEL_HEAVY` = `claude-sonnet-4-6`. See [`js/api.js`](../js/api.js) for model constants.

For the full invocation sequence with inputs and outputs, see [Agent Lifecycle](agent-lifecycle.md).

## Orchestration

[`js/orchestrator.js`](../js/orchestrator.js) is the central layer between agents and the app:

- **`converse(promptName, messages)`** -- multi-turn conversations (onboarding, guide checkpoints). Loads a prompt file, sends message history, returns parsed JSON.
- **`chatWithContext(systemPrompt, messages)`** -- one-off Q&A with an inline system prompt. Returns raw text.
- **Agent-specific functions** -- `generateSummative()`, `assessSummativeAttempt()`, `analyzeGaps()`, `generateJourney()`, `generateNextActivity()`, `assessDraft()`, `reassessDraft()`, and profile update functions. Each assembles context, calls the API, parses JSON, and runs validation.
- **Routing** -- if logged in, calls go to the learn-service Bedrock proxy; otherwise, they use the user's Anthropic API key directly.
- **Retry** -- validation failures retry once automatically. Transient API errors (503, 529, 500) retry up to twice with backoff (3s, 6s).

## Output validation

All agent outputs pass through deterministic validators in [`js/validators.js`](../js/validators.js) before reaching the user:

| Validator | Checks |
|-----------|--------|
| `validateSummative` | Task with steps array, rubric with 4 mastery levels per criterion, exemplar, `courseIntro`, `summaryForLearner`, content safety |
| `validateSummativeAssessment` | All criteria scored, ratchet rule (scores only go up), `summaryForLearner`, content safety |
| `validateGapAnalysis` | Criterion/level/priority structure |
| `validateJourney` | Valid unit IDs, activities with types/goals/rubricCriteria |
| `validateActivity` | Format-aware: screenshot ends with "Capture", text ends with "Submit"; max 4 steps, browser-only, no platform shortcuts, no multi-site, produces visible work, content safety |
| `validateAssessment` | Score 0-1, valid recommendation, feedback/strengths/improvements arrays, content safety |

## Content hierarchy

```
Course (courses.json)
  └── Units (each with format, exemplar, learningObjectives)
        ├── format: "screenshot" or "text" (how learners submit work)
        └── exemplar: mastery-level outcome description
  └── Summative Assessment (generated per course from all unit objectives/exemplars)
        ├── Task (multi-step, each step has a format)
        ├── Rubric (criteria with 4 mastery levels, FIXED once generated)
        └── Exemplar (what mastery looks like)
  └── Journey (selected/ordered units with formative activities)
        └── Formative Activities (generated per unit, targeting rubric criteria)
              └── Drafts (screenshot captures or text responses with AI assessment)
```

[`data/courses.json`](../data/courses.json) defines courses, each containing a `units` array. Each unit has a `unitId`, `learningObjectives`, `format` ("text" or "screenshot"), `exemplar` (mastery-level outcome description), and an optional `dependsOn` prerequisite. The `format` determines how learners submit work. The `exemplar` is an example of an outcome — learners match its quality and depth, not its content. The journey agent selects which units to include, their order, and how many activities per unit.

## Orientation checkpoints

Between every major step, the learner sees an orientation screen powered by the **Guide Agent**. The guide generates a personalized message based on the learner's profile, scores, and progress context, then handles follow-up Q&A via multi-turn conversation.

| Phase | Checkpoint | What the learner sees |
|-------|-----------|----------------------|
| `course_intro` | Before diagnostic | Guide greeting + rubric/exemplar overview |
| `baseline_results` | After diagnostic | Scores + guide framing results as a starting point |
| `journey_overview` | After journey generated | Guide overview + unit cards |
| `retake_ready` | Before retake | Prior scores + guide encouragement |

At each checkpoint, the compose bar is available for Q&A. The rubric is FIXED — the guide explains it but cannot change it.

## Storage

### SQLite (structured data)

All structured data lives in an in-memory SQLite database powered by [sql.js](https://github.com/sql-js/sql.js) (WASM). The database is serialized and persisted to `chrome.storage.local` under `_sqliteDb` (debounced, plus on `visibilitychange`).

- [`js/db.js`](../js/db.js) -- database lifecycle: init, schema creation, persistence, column migrations
- [`js/storage.js`](../js/storage.js) -- query API: getters/setters for all data types

Key tables: `summatives`, `summative_attempts`, `gap_analysis`, `journeys`, `units`, `activities`, `drafts`, `conversations`, `messages`, `profile`, `preferences`, `work_products`, `auth`, `pending_state`.

Activity IDs are scoped to their unit in the DB (`unitId::activityId`) to prevent cross-unit collisions. Drafts have both `screenshot_key` (for screenshots in IndexedDB) and `text_response` (for typed responses stored directly). Summative attempts have `text_responses` alongside `screenshots`. In-progress state (summative captures) is persisted to `pending_state` so it survives panel reloads.

### IndexedDB (binary assets)

Screenshots are stored in IndexedDB (`1111-blobs` store), referenced by `screenshot_key` in the `drafts` and `summative_attempts` tables. Text responses are stored directly in the SQLite `text_response` column — no IndexedDB needed.

## File structure

```
manifest.json            Chrome extension manifest (MV3)
background.js            Opens the side panel on icon click
sidepanel.html           Vite entry point
sidepanel.css            Global styles
vite.config.js           Vite build config
lib/                     Vendored sql.js (WASM)
js/                      Service modules (vanilla JS)
  db.js                  SQLite lifecycle
  storage.js             Query layer + IndexedDB
  courses.js             Course loading + prerequisites
  api.js                 Anthropic API client
  orchestrator.js        Agent orchestration
  validators.js          Output validators
  auth.js                Auth for learn-service
  sync.js                Cloud data sync
src/                     React app
  main.jsx               Entry: db init, React mount
  App.jsx                Routes
  contexts/              AppContext, AuthContext, ModalContext
  hooks/                 useViewTransition, useAutoResize
  lib/                   unitEngine, profileQueue, syncDebounce, helpers, constants
  components/            AppShell, chat/*, modals/*
  pages/                 CoursesList, UnitsList, UnitChat, Portfolio, Settings, onboarding/*
prompts/                 Agent system prompts (markdown)
data/courses.json        Course definitions (with unit formats + exemplars)
tests/                   Node test runner (manifest, courses, validators, storage)
docs/                    Documentation
dist/                    Build output (Chrome extension)
```
